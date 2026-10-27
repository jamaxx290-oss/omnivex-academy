import crypto from "node:crypto";
import { Router, type Request, type Response } from "express";
import { and, desc, eq, isNull, sql, lt } from "drizzle-orm";
import { z } from "zod";
import { db, sqlite } from "../db";
import {
  conversationParticipants,
  conversations,
  groupMembers,
  groupJoinRequests,
  groups,
  messageReads,
  messages,
  user,
  uploads,
} from "../db/schema";
import { requireMember, type SessionUser } from "../middleware";
import { getIO } from "../realtime";
import { notify, broadcastToUsers } from "../notifications";

function uuid(): string {
  return crypto.randomUUID();
}

const router = Router();

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

type PublicUser = { id: string; name: string };

async function displayUsers(ids: string[]): Promise<Record<string, PublicUser>> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return {};
  const rows = await db
    .select({ id: user.id, name: user.name })
    .from(user)
    .where(sql`${user.id} IN (${sql.join(unique.map((id) => sql`${id}`), sql`, `)})`);
  const map: Record<string, PublicUser> = {};
  for (const r of rows) map[r.id] = { id: r.id, name: r.name };
  return map;
}

export async function isGroupMember(groupId: string, userId: string): Promise<boolean> {
  const m = await db.query.groupMembers.findFirst({
    where: and(eq(groupMembers.group_id, groupId), eq(groupMembers.user_id, userId)),
  });
  return Boolean(m);
}

export async function isGroupAdmin(groupId: string, userId: string): Promise<boolean> {
  const m = await db.query.groupMembers.findFirst({
    where: and(eq(groupMembers.group_id, groupId), eq(groupMembers.user_id, userId)),
  });
  return m?.role === "admin";
}

export async function canSendInGroup(
  groupId: string,
  u: SessionUser,
): Promise<{ allowed: boolean; reason?: string }> {
  if (u.is_admin) return { allowed: true };
  const g = await db.query.groups.findFirst({ where: eq(groups.id, groupId) });
  if (!g) return { allowed: false, reason: "Group not found" };
  const m = await db.query.groupMembers.findFirst({
    where: and(eq(groupMembers.group_id, groupId), eq(groupMembers.user_id, u.id)),
  });
  if (!m) return { allowed: false, reason: "Not a member of this group" };
  if (g.send_policy === "admins_only" && m.role !== "admin") {
    return { allowed: false, reason: "Only admins can send messages in this group" };
  }
  return { allowed: true };
}

type MessageRow = typeof messages.$inferSelect;

export type SerializedMessage = {
  id: string;
  scope: "group" | "dm";
  groupId: string | null;
  conversationId: string | null;
  senderId: string;
  senderName: string;
  type: string;
  body: string | null;
  mediaPath: string | null;
  mediaUrl: string | null;
  mediaMime: string | null;
  fileName: string | null;
  fileSize: number | null;
  durationMs: number | null;
  replyToId: string | null;
  replyTo: null | {
    id: string;
    senderId: string;
    senderName: string;
    body: string | null;
    type: string;
    mediaUrl: string | null;
    deleted: boolean;
  };
  createdAt: string;
  deleted: boolean;
};

async function serializeMessages(rows: MessageRow[]): Promise<SerializedMessage[]> {
  if (!rows.length) return [];
  const senderIds = rows.map((r) => r.sender_id);
  const replyIds = rows
    .map((r) => r.reply_to_id)
    .filter((x): x is string => Boolean(x));
  const users = await displayUsers([...senderIds, ...replyIds]);

  // original filenames + sizes (documents are opened externally by name)
  const mediaPaths = [
    ...new Set(
      rows.map((r) => r.media_path).filter((p): p is string => Boolean(p)),
    ),
  ];
  const fileMap: Record<
    string,
    { original_name: string | null; size: number | null }
  > = {};
  if (mediaPaths.length) {
    const fileRows = sqlite
      .prepare(
        `SELECT path, original_name, size FROM uploads WHERE path IN (${mediaPaths
          .map(() => "?")
          .join(",")})`,
      )
      .all(...mediaPaths) as {
      path: string;
      original_name: string | null;
      size: number | null;
    }[];
    for (const f of fileRows) fileMap[f.path] = f;
  }

  // load referenced replies
  let replyMap: Record<string, MessageRow> = {};
  if (replyIds.length) {
    const uniq = [...new Set(replyIds)];
    const refs = sqlite
      .prepare(
        `SELECT * FROM messages WHERE id IN (${uniq.map(() => "?").join(",")})`,
      )
      .all(...uniq) as MessageRow[];
    replyMap = Object.fromEntries(refs.map((r) => [r.id, r]));
  }

  return rows.map((r) => {
    const reply = r.reply_to_id ? replyMap[r.reply_to_id] : undefined;
    const mediaUrl = r.media_path ? `/media/${r.media_path}` : null;
    const file = r.media_path ? fileMap[r.media_path] : undefined;
    return {
      id: r.id,
      scope: r.scope as "group" | "dm",
      groupId: r.group_id,
      conversationId: r.conversation_id,
      senderId: r.sender_id,
      senderName: users[r.sender_id]?.name || "Member",
      type: r.type,
      body: r.deleted_at ? null : r.body,
      mediaPath: r.media_path,
      mediaUrl: r.deleted_at ? null : mediaUrl,
      mediaMime: r.media_mime ?? null,
      fileName: r.deleted_at ? null : (file?.original_name ?? null),
      fileSize: file?.size ?? r.media_size ?? null,
      durationMs: r.duration_ms,
      replyToId: r.reply_to_id,
      replyTo: reply
        ? {
            id: reply.id,
            senderId: reply.sender_id,
            senderName: users[reply.sender_id]?.name || "Member",
            body: reply.deleted_at ? null : reply.body,
            type: reply.type,
            mediaUrl: reply.media_path && !reply.deleted_at ? `/media/${reply.media_path}` : null,
            deleted: Boolean(reply.deleted_at),
          }
        : null,
      createdAt: r.created_at.toISOString(),
      deleted: Boolean(r.deleted_at),
    };
  });
}

function unreadForGroup(groupId: string, userId: string): number {
  const readRow = sqlite
    .prepare(
      `SELECT last_read_message_id FROM message_reads
       WHERE user_id = ? AND scope = 'group' AND IFNULL(group_id,'') = ?`,
    )
    .get(userId, groupId) as { last_read_message_id: string | null } | undefined;

  const lastRead = readRow?.last_read_message_id;
  if (!lastRead) {
    const row = sqlite
      .prepare(
        `SELECT COUNT(*) AS c FROM messages
         WHERE group_id = ? AND scope = 'group' AND deleted_at IS NULL AND sender_id != ?`,
      )
      .get(groupId, userId) as { c: number };
    return row.c;
  }
  const last = sqlite
    .prepare("SELECT created_at FROM messages WHERE id = ?")
    .get(lastRead) as { created_at: number } | undefined;
  if (!last) return 0;
  const row = sqlite
    .prepare(
      `SELECT COUNT(*) AS c FROM messages
       WHERE group_id = ? AND scope = 'group' AND deleted_at IS NULL
         AND sender_id != ? AND created_at > ?`,
    )
    .get(groupId, userId, last.created_at) as { c: number };
  return row.c;
}

/* ------------------------------------------------------------------ */
/* Group listing                                                       */
/* ------------------------------------------------------------------ */

router.get("/groups", requireMember, async (req: Request, res: Response) => {
  const u = req.appUser as SessionUser;
  const memberships = await db
    .select({ group_id: groupMembers.group_id, role: groupMembers.role })
    .from(groupMembers)
    .where(eq(groupMembers.user_id, u.id));
  const roleByGroup = new Map(memberships.map((m) => [m.group_id, m.role]));

  const myRequests = await db
    .select()
    .from(groupJoinRequests)
    .where(eq(groupJoinRequests.user_id, u.id));
  const requestByGroup = new Map(myRequests.map((r) => [r.group_id, r.status]));

  // Every non-archived group is visible so members can discover and join
  // (or request to join) — access to contents is gated separately.
  const rows = await db.query.groups.findMany({
    where: isNull(groups.archived_at),
    orderBy: [desc(groups.created_at)],
  });

  const result = await Promise.all(
    rows.map(async (g) => {
      const role = roleByGroup.get(g.id) || null;
      const isMember = role !== null;
      const memberCount = sqlite
        .prepare("SELECT COUNT(*) AS c FROM group_members WHERE group_id = ?")
        .get(g.id) as { c: number };

      // Only members (and admins) see the last message + unread count.
      if (!isMember && !u.is_admin) {
        return {
          id: g.id,
          name: g.name,
          description: g.description,
          pictureUrl: g.picture_path ? `/media/${g.picture_path}` : null,
          sendPolicy: g.send_policy,
          joinPolicy: g.join_policy as "open" | "request",
          role,
          isMember,
          joinRequest: (requestByGroup.get(g.id) || "none") as
            | "none"
            | "pending"
            | "approved"
            | "denied",
          memberCount: memberCount.c,
          unread: 0,
          lastMessage: null,
        };
      }

      const last = await db.query.messages.findFirst({
        where: and(eq(messages.group_id, g.id), eq(messages.scope, "group")),
        orderBy: [desc(messages.created_at)],
      });
      const users = last ? await displayUsers([last.sender_id]) : {};
      return {
        id: g.id,
        name: g.name,
        description: g.description,
        pictureUrl: g.picture_path ? `/media/${g.picture_path}` : null,
        sendPolicy: g.send_policy,
        joinPolicy: g.join_policy as "open" | "request",
        role: role || "member",
        isMember,
        joinRequest: (requestByGroup.get(g.id) || "none") as
          | "none"
          | "pending"
          | "approved"
          | "denied",
        memberCount: memberCount.c,
        unread: isMember ? unreadForGroup(g.id, u.id) : 0,
        lastMessage: last
          ? {
              body: last.deleted_at ? "Message deleted" : last.body || (last.type !== "text" ? last.type : ""),
              senderName: users[last.sender_id]?.name || "Member",
              type: last.type,
              at: last.created_at.toISOString(),
            }
          : null,
      };
    }),
  );

  res.json({
    groups: result.sort((a, b) =>
      (b.lastMessage?.at || "").localeCompare(a.lastMessage?.at || ""),
    ),
  });
});

/* ------------------------------------------------------------------ */
/* Join / request / leave                                              */
/* ------------------------------------------------------------------ */

router.post("/groups/:id/join", requireMember, async (req: Request, res: Response) => {
  const u = req.appUser as SessionUser;
  const g = await db.query.groups.findFirst({
    where: eq(groups.id, String(req.params.id)),
  });
  if (!g || g.archived_at) return res.status(404).json({ error: "Group not found" });

  if (await isGroupMember(g.id, u.id)) {
    return res.status(200).json({ status: "member" });
  }

  if (g.join_policy === "open") {
    await db
      .insert(groupMembers)
      .values({
        group_id: g.id,
        user_id: u.id,
        role: "member",
        joined_at: new Date(),
      })
      .onConflictDoNothing();
    await db
      .delete(groupJoinRequests)
      .where(
        and(eq(groupJoinRequests.group_id, g.id), eq(groupJoinRequests.user_id, u.id)),
      );
    getIO()?.to(`group:${g.id}`).emit("group:member:joined", { groupId: g.id, userId: u.id });
    return res.status(201).json({ status: "member" });
  }

  // join_policy === "request" → create/refresh a pending request
  const existing = await db.query.groupJoinRequests.findFirst({
    where: and(
      eq(groupJoinRequests.group_id, g.id),
      eq(groupJoinRequests.user_id, u.id),
    ),
  });
  if (existing && existing.status === "pending") {
    return res.status(200).json({ status: "pending" });
  }
  if (existing) {
    await db
      .update(groupJoinRequests)
      .set({ status: "pending", created_at: new Date(), decided_at: null, decided_by: null })
      .where(eq(groupJoinRequests.id, existing.id));
  } else {
    await db.insert(groupJoinRequests).values({
      id: uuid(),
      group_id: g.id,
      user_id: u.id,
      status: "pending",
      created_at: new Date(),
    });
  }
  // Notify group admins of the pending request
  const admins = await db
    .select({ user_id: groupMembers.user_id })
    .from(groupMembers)
    .where(and(eq(groupMembers.group_id, g.id), eq(groupMembers.role, "admin")));
  for (const a of admins) {
    void notify({
      userId: a.user_id,
      type: "system",
      actorId: u.id,
      title: `${u.name} requested to join ${g.name}`,
      body: "Review the request in the admin panel.",
      link: "/admin",
    });
  }
  res.status(201).json({ status: "pending" });
});

router.post("/groups/:id/leave", requireMember, async (req: Request, res: Response) => {
  const u = req.appUser as SessionUser;
  const g = await db.query.groups.findFirst({
    where: eq(groups.id, String(req.params.id)),
  });
  if (!g) return res.status(404).json({ error: "Group not found" });
  await db
    .delete(groupMembers)
    .where(and(eq(groupMembers.group_id, g.id), eq(groupMembers.user_id, u.id)));
  const io = getIO();
  for (const s of io?.sockets.sockets.values() || []) {
    const data = s.data as { user?: { id?: string } };
    if (data.user?.id === u.id) void s.leave(`group:${g.id}`);
  }
  res.json({ ok: true });
});

/* Group detail (members visible to members only) */
router.get("/groups/:id", requireMember, async (req: Request, res: Response) => {
  const u = req.appUser as SessionUser;
  const g = await db.query.groups.findFirst({ where: eq(groups.id, String(req.params.id)) });
  if (!g || g.archived_at) return res.status(404).json({ error: "Group not found" });
  const isMember = u.is_admin || (await isGroupMember(g.id, u.id));

  const myReq = await db.query.groupJoinRequests.findFirst({
    where: and(eq(groupJoinRequests.group_id, g.id), eq(groupJoinRequests.user_id, u.id)),
  });
  const joinRequest = (myReq?.status || "none") as
    | "none"
    | "pending"
    | "approved"
    | "denied";

  // Non-members can see that the group exists, but not its members or contents.
  if (!isMember) {
    const memberCount = sqlite
      .prepare("SELECT COUNT(*) AS c FROM group_members WHERE group_id = ?")
      .get(g.id) as { c: number };
    return res.json({
      id: g.id,
      name: g.name,
      description: g.description,
      pictureUrl: g.picture_path ? `/media/${g.picture_path}` : null,
      sendPolicy: g.send_policy,
      joinPolicy: g.join_policy as "open" | "request",
      members: [],
      myRole: "member",
      canSend: false,
      isMember: false,
      joinRequest,
      memberCount: memberCount.c,
    });
  }

  const memberRows = await db
    .select({
      user_id: groupMembers.user_id,
      role: groupMembers.role,
      name: user.name,
    })
    .from(groupMembers)
    .leftJoin(user, eq(user.id, groupMembers.user_id))
    .where(eq(groupMembers.group_id, g.id));

  res.json({
    id: g.id,
    name: g.name,
    description: g.description,
    pictureUrl: g.picture_path ? `/media/${g.picture_path}` : null,
    sendPolicy: g.send_policy,
    joinPolicy: g.join_policy as "open" | "request",
    members: memberRows.map((m) => ({
      id: m.user_id,
      name: m.name || "Member",
      role: m.role,
    })),
    myRole: u.is_admin
      ? "admin"
      : memberRows.find((m) => m.user_id === u.id)?.role || "member",
    canSend: (await canSendInGroup(g.id, u)).allowed,
    isMember: true,
    joinRequest,
    memberCount: memberRows.length,
  });
});

/* ------------------------------------------------------------------ */
/* Message history                                                     */
/* ------------------------------------------------------------------ */

router.get(
  "/groups/:id/messages",
  requireMember,
  async (req: Request, res: Response) => {
    const u = req.appUser as SessionUser;
    const groupId = String(req.params.id);
    if (!u.is_admin && !(await isGroupMember(groupId, u.id))) {
      return res.status(403).json({ error: "Not a member of this group" });
    }
    const limit = Math.min(Number(req.query.limit) || 50, 100);
    const before = typeof req.query.before === "string" ? req.query.before : null;

    let rows: MessageRow[];
    if (before) {
      const anchor = await db.query.messages.findFirst({
        where: eq(messages.id, before),
      });
      rows = await db.query.messages.findMany({
        where: and(
          eq(messages.group_id, groupId),
          eq(messages.scope, "group"),
          anchor ? lt(messages.created_at, anchor.created_at) : undefined,
        ),
        orderBy: [desc(messages.created_at)],
        limit: limit + 1,
      });
    } else {
      rows = await db.query.messages.findMany({
        where: and(eq(messages.group_id, groupId), eq(messages.scope, "group")),
        orderBy: [desc(messages.created_at)],
        limit: limit + 1,
      });
    }

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    page.reverse();
    res.json({
      messages: await serializeMessages(page),
      hasMore,
    });
  },
);

/** Fetch a single message (used by reply-jump when target is outside the window). */
router.get(
  "/messages/:id",
  requireMember,
  async (req: Request, res: Response) => {
    const u = req.appUser as SessionUser;
    const m = await db.query.messages.findFirst({
      where: eq(messages.id, String(req.params.id)),
    });
    if (!m) return res.status(404).json({ error: "Message not found" });
    if (m.scope === "group") {
      if (!u.is_admin && !(await isGroupMember(m.group_id || "", u.id))) {
        return res.status(403).json({ error: "Not allowed" });
      }
    } else if (!u.is_admin) {
      const p = await db.query.conversationParticipants.findFirst({
        where: and(
          eq(conversationParticipants.conversation_id, m.conversation_id || ""),
          eq(conversationParticipants.user_id, u.id),
        ),
      });
      if (!p) return res.status(403).json({ error: "Not allowed" });
    }
    const [serialized] = await serializeMessages([m]);
    res.json({ message: serialized });
  },
);

/* ------------------------------------------------------------------ */
/* Send message                                                        */
/* ------------------------------------------------------------------ */

const sendSchema = z.object({
  body: z.string().max(4000).optional(),
  type: z.enum(["text", "image", "video", "audio", "file"]).default("text"),
  mediaPath: z.string().max(500).optional(),
  durationMs: z.number().int().min(0).max(3600000).optional(),
  replyToId: z.string().max(100).optional(),
  clientId: z.string().max(100).optional(),
});

router.post(
  "/groups/:id/messages",
  requireMember,
  async (req: Request, res: Response) => {
    const u = req.appUser as SessionUser;
    const groupId = String(req.params.id);
    const parsed = sendSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid message", details: parsed.error.issues });
    }
    const input = parsed.data;

    const g = await db.query.groups.findFirst({ where: eq(groups.id, groupId) });
    if (!g || g.archived_at) return res.status(404).json({ error: "Group not found" });

    const perm = await canSendInGroup(groupId, u);
    if (!perm.allowed) return res.status(403).json({ error: perm.reason });

    const hasText = Boolean(input.body && input.body.trim());
    if (input.type === "text" && !hasText) {
      return res.status(400).json({ error: "Message cannot be empty" });
    }
    if (input.type !== "text" && !input.mediaPath) {
      return res.status(400).json({ error: "Media path required" });
    }

    // validate reply target belongs to same conversation
    let replyToId: string | null = null;
    if (input.replyToId) {
      const target = await db.query.messages.findFirst({
        where: eq(messages.id, input.replyToId),
      });
      if (!target || target.group_id !== groupId) {
        return res.status(400).json({ error: "Reply target not found in this group" });
      }
      replyToId = target.id;
    }

    // validate media ownership/scoping
    const mediaRec = input.mediaPath
      ? await db.query.uploads.findFirst({
          where: eq(uploads.path, input.mediaPath),
        })
      : null;
    if (input.mediaPath) {
      const rec = mediaRec;
      if (!rec || rec.owner_id !== u.id) {
        return res.status(400).json({ error: "Unknown media path" });
      }
      if (rec.group_id && rec.group_id !== groupId) {
        return res.status(400).json({ error: "Media was uploaded for a different target" });
      }
    }

    const id = uuid();
    const now = new Date();
    await db.insert(messages).values({
      id,
      scope: "group",
      group_id: groupId,
      conversation_id: null,
      sender_id: u.id,
      type: input.type,
      body: input.type === "text" ? (input.body || "").trim() : input.body || null,
      media_path: input.mediaPath || null,
      media_mime: input.mediaPath ? mediaRec?.mime ?? null : null,
      media_size: input.mediaPath ? mediaRec?.size ?? null : null,
      duration_ms: input.durationMs ?? null,
      reply_to_id: replyToId,
      created_at: now,
    });

    if (input.mediaPath) {
      await db
        .update(uploads)
        .set({ group_id: groupId })
        .where(eq(uploads.path, input.mediaPath));
    }

    const [row] = await db.query.messages.findMany({
      where: eq(messages.id, id),
      limit: 1,
    });
    const [serialized] = await serializeMessages([row!]);

    const io = getIO();
    io?.to(`group:${groupId}`).emit("group:message", serialized);

    // mark sender as having read up to this message
    await markRead(u.id, "group", groupId, null, id);

    // notifications: reply → original sender; general group activity → members (in-app only via prefs)
    const memberRows = await db
      .select({ user_id: groupMembers.user_id })
      .from(groupMembers)
      .where(eq(groupMembers.group_id, groupId));

    if (replyToId) {
      const target = await db.query.messages.findFirst({
        where: eq(messages.id, replyToId),
      });
      if (target && target.sender_id !== u.id) {
        const gName = g.name;
        await notify({
          userId: target.sender_id,
          type: "reply",
          actorId: u.id,
          title: `${u.name} replied to your message in ${gName}`,
          body:
            input.type === "text"
              ? (input.body || "").slice(0, 140)
              : `Sent a ${input.type}`,
          link: `/app/groups/${groupId}?jump=${replyToId}`,
          pushBody: `${u.name}: ${input.type === "text" ? (input.body || "").slice(0, 100) : `sent a ${input.type}`}`,
        });
      }
    }

    // push to members with group_message_push enabled (notify() applies prefs)
    const targets = memberRows
      .map((m) => m.user_id)
      .filter((id2) => id2 !== u.id && id2 !== replyToId);
    if (targets.length) {
      void broadcastToUsers(targets, "group:activity", { groupId });
      for (const t of targets.slice(0, 50)) {
        // best-effort push for opted-in members; in-app notification only for replies
        void notifyGroupActivity(t, u, g.name, input, id, groupId);
      }
    }

    res.status(201).json({ message: serialized });
  },
);

async function notifyGroupActivity(
  targetId: string,
  actor: SessionUser,
  groupName: string,
  input: { type: string; body?: string },
  messageId: string,
  groupId: string,
): Promise<void> {
  try {
    const { getPrefs, sendPush } = await import("../notifications");
    const prefs = await getPrefs(targetId);
    if (!prefs.push_enabled || !prefs.group_message_push) return;
    await sendPush(targetId, {
      title: groupName,
      body: `${actor.name}: ${
        input.type === "text" ? (input.body || "").slice(0, 100) : `sent a ${input.type}`
      }`,
      link: `/app/groups/${groupId}?jump=${messageId}`,
      tag: `group:${groupId}`,
    });
  } catch {
    /* non-fatal */
  }
}

/* ------------------------------------------------------------------ */
/* Message deletion (admin can delete anyone's message in any group)   */
/* ------------------------------------------------------------------ */

router.delete(
  "/messages/:id",
  requireMember,
  async (req: Request, res: Response) => {
    const u = req.appUser as SessionUser;
    const m = await db.query.messages.findFirst({
      where: eq(messages.id, String(req.params.id)),
    });
    if (!m) return res.status(404).json({ error: "Message not found" });
    if (m.deleted_at) return res.json({ ok: true, deleted: true });

    // Platform admins can delete any message; no one else can delete at all.
    if (!u.is_admin) {
      return res
        .status(403)
        .json({ error: "Admin access required", code: "FORBIDDEN" });
    }

    await db
      .update(messages)
      .set({ deleted_at: new Date() })
      .where(eq(messages.id, m.id));

    const io = getIO();
    if (m.scope === "group" && m.group_id) {
      io?.to(`group:${m.group_id}`).emit("message:deleted", { id: m.id });
    } else if (m.conversation_id) {
      io?.to(`dm:${m.conversation_id}`).emit("message:deleted", { id: m.id });
    }

    res.json({ ok: true, deleted: true });
  },
);

/* ------------------------------------------------------------------ */
/* Read markers                                                        */
/* ------------------------------------------------------------------ */

export async function markRead(
  userId: string,
  scope: "group" | "dm",
  groupId: string | null,
  conversationId: string | null,
  lastReadMessageId: string,
): Promise<void> {
  const existing = sqlite
    .prepare(
      `SELECT id, last_read_message_id FROM message_reads
       WHERE user_id = ? AND scope = ? AND IFNULL(group_id,'') = ? AND IFNULL(conversation_id,'') = ?`,
    )
    .get(userId, scope, groupId || "", conversationId || "") as
    | { id: string; last_read_message_id: string | null }
    | undefined;

  if (existing) {
    await db
      .update(messageReads)
      .set({ last_read_message_id: lastReadMessageId, updated_at: new Date() })
      .where(eq(messageReads.id, existing.id));
  } else {
    await db.insert(messageReads).values({
      id: uuid(),
      user_id: userId,
      scope,
      group_id: groupId,
      conversation_id: conversationId,
      last_read_message_id: lastReadMessageId,
      updated_at: new Date(),
    });
  }
}

router.post(
  "/groups/:id/read",
  requireMember,
  async (req: Request, res: Response) => {
    const u = req.appUser as SessionUser;
    const groupId = String(req.params.id);
    if (!u.is_admin && !(await isGroupMember(groupId, u.id))) {
      return res.status(403).json({ error: "Not a member of this group" });
    }
    const last = await db.query.messages.findFirst({
      where: and(eq(messages.group_id, groupId), eq(messages.scope, "group")),
      orderBy: [desc(messages.created_at)],
    });
    if (last) await markRead(u.id, "group", groupId, null, last.id);
    res.json({ ok: true, unread: 0 });
  },
);

/* ------------------------------------------------------------------ */
/* Direct messages (1:1)                                               */
/* ------------------------------------------------------------------ */

router.get("/dm/conversations", requireMember, async (req: Request, res: Response) => {
  const u = req.appUser as SessionUser;
  const parts = await db
    .select({ conversation_id: conversationParticipants.conversation_id })
    .from(conversationParticipants)
    .where(eq(conversationParticipants.user_id, u.id));
  if (!parts.length) return res.json({ conversations: [] });

  const ids = parts.map((p) => p.conversation_id);
  const result = [];
  for (const cid of ids) {
    const others = await db
      .select({ user_id: conversationParticipants.user_id, name: user.name })
      .from(conversationParticipants)
      .leftJoin(user, eq(user.id, conversationParticipants.user_id))
      .where(
        and(
          eq(conversationParticipants.conversation_id, cid),
          sql`${conversationParticipants.user_id} != ${u.id}`,
        ),
      );
    const other = others[0];
    if (!other) continue;
    const last = await db.query.messages.findFirst({
      where: and(
        eq(messages.conversation_id, cid),
        eq(messages.scope, "dm"),
      ),
      orderBy: [desc(messages.created_at)],
    });
    const readRow = sqlite
      .prepare(
        `SELECT last_read_message_id FROM message_reads
         WHERE user_id = ? AND scope = 'dm' AND IFNULL(conversation_id,'') = ?`,
      )
      .get(u.id, cid) as { last_read_message_id: string | null } | undefined;
    let unread = 0;
    if (last) {
      if (readRow?.last_read_message_id) {
        const ref = sqlite
          .prepare("SELECT created_at FROM messages WHERE id = ?")
          .get(readRow.last_read_message_id) as { created_at: number } | undefined;
        if (ref) {
          unread = (
            sqlite
              .prepare(
                `SELECT COUNT(*) AS c FROM messages
                 WHERE conversation_id = ? AND scope = 'dm' AND deleted_at IS NULL
                   AND sender_id != ? AND created_at > ?`,
              )
              .get(cid, u.id, ref.created_at) as { c: number }
          ).c;
        }
      } else {
        unread = (
          sqlite
            .prepare(
              `SELECT COUNT(*) AS c FROM messages
               WHERE conversation_id = ? AND scope = 'dm' AND deleted_at IS NULL AND sender_id != ?`,
            )
            .get(cid, u.id) as { c: number }
        ).c;
      }
    }
    result.push({
      id: cid,
      partnerId: other.user_id,
      partnerName: other.name || "Member",
      unread,
      lastMessage: last
        ? {
            body: last.deleted_at ? "Message deleted" : last.body || (last.type !== "text" ? last.type : ""),
            type: last.type,
            at: last.created_at.toISOString(),
            mine: last.sender_id === u.id,
          }
        : null,
    });
  }
  result.sort((a, b) => (b.lastMessage?.at || "").localeCompare(a.lastMessage?.at || ""));
  res.json({ conversations: result });
});

router.post(
  "/dm/conversations",
  requireMember,
  async (req: Request, res: Response) => {
    const u = req.appUser as SessionUser;
    const parsed = z.object({ userId: z.string().min(1) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "userId required" });
    const otherId = parsed.data.userId;
    if (otherId === u.id) return res.status(400).json({ error: "Cannot message yourself" });

    const other = await db.query.user.findFirst({ where: eq(user.id, otherId) });
    if (!other || other.banned_at) {
      return res.status(404).json({ error: "Member not found" });
    }

    const pair = [u.id, otherId].sort();
    const pairKey = pair.join(":");
    let conv = await db.query.conversations.findFirst({
      where: eq(conversations.pair_key, pairKey),
    });
    if (!conv) {
      const id = uuid();
      await db.insert(conversations).values({
        id,
        pair_key: pairKey,
        created_at: new Date(),
      });
      await db.insert(conversationParticipants).values([
        { conversation_id: id, user_id: u.id, joined_at: new Date() },
        { conversation_id: id, user_id: otherId, joined_at: new Date() },
      ]);
      conv = { id, pair_key: pairKey, created_at: new Date() };
      const io = getIO();
      io?.to(`user:${u.id}`).to(`user:${otherId}`).emit("dm:conversation:new", {
        id,
        partnerId: u.id,
        partnerName: u.name,
      });
    }
    res.status(201).json({
      id: conv.id,
      partnerId: other.id,
      partnerName: other.name,
    });
  },
);

router.get(
  "/dm/:id/messages",
  requireMember,
  async (req: Request, res: Response) => {
    const u = req.appUser as SessionUser;
    const convId = String(req.params.id);
    const p = await db.query.conversationParticipants.findFirst({
      where: and(
        eq(conversationParticipants.conversation_id, convId),
        eq(conversationParticipants.user_id, u.id),
      ),
    });
    if (!p && !u.is_admin) {
      return res.status(403).json({ error: "Not allowed" });
    }
    const limit = Math.min(Number(req.query.limit) || 50, 100);
    const before = typeof req.query.before === "string" ? req.query.before : null;
    const anchor = before
      ? await db.query.messages.findFirst({ where: eq(messages.id, before) })
      : null;

    const rows = await db.query.messages.findMany({
      where: and(
        eq(messages.conversation_id, convId),
        eq(messages.scope, "dm"),
        anchor ? lt(messages.created_at, anchor.created_at) : undefined,
      ),
      orderBy: [desc(messages.created_at)],
      limit: limit + 1,
    });
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    page.reverse();
    res.json({ messages: await serializeMessages(page), hasMore });
  },
);

const dmSendSchema = sendSchema;

router.post(
  "/dm/:id/messages",
  requireMember,
  async (req: Request, res: Response) => {
    const u = req.appUser as SessionUser;
    const convId = String(req.params.id);
    const parsed = dmSendSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid message", details: parsed.error.issues });
    }
    const input = parsed.data;

    const participants = await db
      .select({ user_id: conversationParticipants.user_id })
      .from(conversationParticipants)
      .where(eq(conversationParticipants.conversation_id, convId));
    const ids = participants.map((p) => p.user_id);
    if (!ids.includes(u.id) && !u.is_admin) {
      return res.status(403).json({ error: "Not allowed" });
    }
    const otherId = ids.find((id) => id !== u.id);
    if (!otherId) return res.status(404).json({ error: "Conversation not found" });

    const hasText = Boolean(input.body && input.body.trim());
    if (input.type === "text" && !hasText) {
      return res.status(400).json({ error: "Message cannot be empty" });
    }
    if (input.type !== "text" && !input.mediaPath) {
      return res.status(400).json({ error: "Media path required" });
    }

    let replyToId: string | null = null;
    if (input.replyToId) {
      const target = await db.query.messages.findFirst({
        where: eq(messages.id, input.replyToId),
      });
      if (!target || target.conversation_id !== convId) {
        return res.status(400).json({ error: "Reply target not in this conversation" });
      }
      replyToId = target.id;
    }

    const mediaRec = input.mediaPath
      ? await db.query.uploads.findFirst({
          where: eq(uploads.path, input.mediaPath),
        })
      : null;
    if (input.mediaPath) {
      const rec = mediaRec;
      if (!rec || rec.owner_id !== u.id) {
        return res.status(400).json({ error: "Unknown media path" });
      }
      if (rec.group_id) {
        return res
          .status(400)
          .json({ error: "Media was uploaded for a different target" });
      }
      if (rec.conversation_id && rec.conversation_id !== convId) {
        return res.status(400).json({ error: "Media was uploaded for a different target" });
      }
    }

    const id = uuid();
    await db.insert(messages).values({
      id,
      scope: "dm",
      group_id: null,
      conversation_id: convId,
      sender_id: u.id,
      type: input.type,
      body: input.type === "text" ? (input.body || "").trim() : input.body || null,
      media_path: input.mediaPath || null,
      media_mime: input.mediaPath ? mediaRec?.mime ?? null : null,
      media_size: input.mediaPath ? mediaRec?.size ?? null : null,
      duration_ms: input.durationMs ?? null,
      reply_to_id: replyToId,
      created_at: new Date(),
    });

    if (input.mediaPath) {
      await db
        .update(uploads)
        .set({ conversation_id: convId })
        .where(eq(uploads.path, input.mediaPath));
    }

    const [row] = await db.query.messages.findMany({
      where: eq(messages.id, id),
      limit: 1,
    });
    const [serialized] = await serializeMessages([row!]);

    const io = getIO();
    io?.to(`dm:${convId}`).emit("dm:message", serialized);
    await markRead(u.id, "dm", null, convId, id);

    await notify({
      userId: otherId,
      type: "dm",
      actorId: u.id,
      title: `New message from ${u.name}`,
      body:
        input.type === "text"
          ? (input.body || "").slice(0, 140)
          : `Sent a ${input.type}`,
      link: `/app/dm/${convId}`,
      pushBody:
        input.type === "text"
          ? (input.body || "").slice(0, 100)
          : `Sent a ${input.type}`,
    });
    io?.to(`user:${otherId}`).emit("dm:unread", { conversationId: convId });

    res.status(201).json({ message: serialized });
  },
);

router.post(
  "/dm/:id/read",
  requireMember,
  async (req: Request, res: Response) => {
    const u = req.appUser as SessionUser;
    const convId = String(req.params.id);
    const p = await db.query.conversationParticipants.findFirst({
      where: and(
        eq(conversationParticipants.conversation_id, convId),
        eq(conversationParticipants.user_id, u.id),
      ),
    });
    if (!p && !u.is_admin) return res.status(403).json({ error: "Not allowed" });
    const last = await db.query.messages.findFirst({
      where: and(eq(messages.conversation_id, convId), eq(messages.scope, "dm")),
      orderBy: [desc(messages.created_at)],
    });
    if (last) await markRead(u.id, "dm", null, convId, last.id);
    res.json({ ok: true });
  },
);

/* ------------------------------------------------------------------ */
/* Member directory for starting DMs (names only — no private fields)  */
/* ------------------------------------------------------------------ */

router.get("/members", requireMember, async (req: Request, res: Response) => {
  const u = req.appUser as SessionUser;
  const q = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 60) : "";
  const rows = await db
    .select({ id: user.id, name: user.name, status: user.membership_status })
    .from(user)
    .where(and(isNull(user.banned_at), user.emailVerified))
    .limit(500);

  const filtered = rows
    .filter((r) => r.id !== u.id)
    .filter((r) => r.status === "active")
    .filter((r) => (q ? r.name.toLowerCase().includes(q.toLowerCase()) : true))
    .slice(0, 100)
    .map((r) => ({ id: r.id, name: r.name }));

  res.json({ members: filtered });
});

export { serializeMessages, unreadForGroup, displayUsers };
export default router;
