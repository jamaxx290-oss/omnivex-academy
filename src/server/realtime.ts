import type { Server as HttpServer } from "node:http";
import { Server, type Socket } from "socket.io";
import { and, eq } from "drizzle-orm";
import { db } from "./db";
import { conversationParticipants, groupMembers, user } from "./db/schema";
import { auth } from "./auth";
import type { SessionUser } from "./middleware";
import {
  getActiveCall,
  addParticipant,
  removeParticipant,
  snapshot,
} from "./calls";

let io: Server | null = null;

export function getIO(): Server | null {
  return io;
}

async function identify(socket: Socket): Promise<SessionUser | null> {
  const cookieHeader = socket.handshake.headers.cookie;
  if (!cookieHeader) return null;
  try {
    const session = await auth.api.getSession({
      headers: { cookie: cookieHeader } as never,
    });
    if (!session?.user?.id) return null;
    const row = await db.query.user.findFirst({
      where: eq(user.id, session.user.id),
    });
    return (row as unknown as SessionUser) ?? null;
  } catch {
    return null;
  }
}

const callRoom = (groupId: string) => `call:${groupId}`;
const callUserRoom = (groupId: string, userId: string) =>
  `callu:${groupId}:${userId}`;

async function isGroupMemberLocal(
  groupId: string,
  userId: string,
): Promise<boolean> {
  const m = await db.query.groupMembers.findFirst({
    where: and(
      eq(groupMembers.group_id, groupId),
      eq(groupMembers.user_id, userId),
    ),
  });
  return Boolean(m);
}

async function broadcastRoster(groupId: string): Promise<void> {
  const state = getActiveCall(groupId);
  if (!state || !io) return;
  io.to(callRoom(groupId)).emit("call:roster", await snapshot(state));
}

export function initRealtime(server: HttpServer): Server {
  io = new Server(server, {
    path: "/socket.io",
    cors: { origin: true, credentials: true },
    transports: ["websocket", "polling"],
    serveClient: false,
  });

  io.use(async (socket, next) => {
    const u = await identify(socket);
    if (!u || !u.emailVerified || u.banned_at) {
      return next(new Error("unauthorized"));
    }
    (socket.data as { user: SessionUser }).user = u;
    next();
  });

  io.on("connection", async (socket) => {
    const u = (socket.data as { user: SessionUser }).user;
    await socket.join(`user:${u.id}`);
    const data = socket.data as { user: SessionUser; callGroupId?: string };

    // Join group rooms for every group the user belongs to
    try {
      const memberships = await db
        .select({ group_id: groupMembers.group_id })
        .from(groupMembers)
        .where(eq(groupMembers.user_id, u.id));
      for (const m of memberships) await socket.join(`group:${m.group_id}`);

      const convs = await db
        .select({ conversation_id: conversationParticipants.conversation_id })
        .from(conversationParticipants)
        .where(eq(conversationParticipants.user_id, u.id));
      for (const c of convs) await socket.join(`dm:${c.conversation_id}`);
    } catch (err) {
      console.warn("[socket] room join failed:", err);
    }

    // Re-validate membership when groups change elsewhere
    socket.on("groups:sync", async (cb?: (ids: string[]) => void) => {
      try {
        const memberships = await db
          .select({ group_id: groupMembers.group_id })
          .from(groupMembers)
          .where(eq(groupMembers.user_id, u.id));
        const ids = memberships.map((m) => m.group_id);
        if (typeof cb === "function") cb(ids);
      } catch {
        if (typeof cb === "function") cb([]);
      }
    });

    socket.on("leave:group", async (groupId: unknown) => {
      if (typeof groupId === "string") await socket.leave(`group:${groupId}`);
    });

    socket.on("join:group", async (groupId: unknown) => {
      if (typeof groupId !== "string") return;
      const member = await db.query.groupMembers.findFirst({
        where: and(
          eq(groupMembers.group_id, groupId),
          eq(groupMembers.user_id, u.id),
        ),
      });
      if (member) await socket.join(`group:${groupId}`);
    });

    /* ---------------------------------------------------------------- */
    /* Group calls (audio rooms)                                         */
    /* ---------------------------------------------------------------- */

    async function leaveCall(groupId: string): Promise<void> {
      await socket.leave(callRoom(groupId));
      await socket.leave(callUserRoom(groupId, u.id));
      data.callGroupId = undefined;
      const others = await io
        ?.in(callUserRoom(groupId, u.id))
        .fetchSockets();
      if (others?.length) return; // another tab of this user is still in
      const state = getActiveCall(groupId);
      if (state && state.participants.has(u.id)) {
        removeParticipant(state, u.id);
        io?.to(callRoom(groupId)).emit("call:peer:left", { userId: u.id });
        await broadcastRoster(groupId);
      }
    }

    socket.on(
      "call:join",
      async (groupId: unknown, ack?: (r: unknown) => void) => {
        try {
          if (typeof groupId !== "string") {
            if (typeof ack === "function") ack({ error: "Invalid group" });
            return;
          }
          if (!u.is_admin && !(await isGroupMemberLocal(groupId, u.id))) {
            if (typeof ack === "function")
              ack({ error: "Not a member of this group" });
            return;
          }
          const state = getActiveCall(groupId);
          if (!state) {
            if (typeof ack === "function") ack({ error: "No active call" });
            return;
          }
          await addParticipant(state, u.id);
          await socket.join(callRoom(groupId));
          await socket.join(callUserRoom(groupId, u.id));
          data.callGroupId = groupId;
          if (typeof ack === "function") {
            ack({ ok: true, call: await snapshot(state) });
          }
          io?.to(callRoom(groupId)).emit("call:peer:joined", {
            userId: u.id,
            name: state.participants.get(u.id)?.name || u.name,
          });
          await broadcastRoster(groupId);
        } catch (err) {
          console.warn("[socket] call:join failed:", err);
          if (typeof ack === "function") ack({ error: "Join failed" });
        }
      },
    );

    socket.on("call:leave", async (groupId: unknown) => {
      if (typeof groupId !== "string") return;
      await leaveCall(groupId);
    });

    /**
     * Mic toggle. A participant may always turn their mic OFF. They may only
     * turn it ON when the host has not admin-muted them — a host mute blocks
     * self-unmute until the host lifts it.
     */
    socket.on("call:mic", async (payload: unknown) => {
      const p = payload as { groupId?: unknown; on?: unknown } | null;
      if (!p || typeof p.groupId !== "string" || typeof p.on !== "boolean")
        return;
      const state = getActiveCall(p.groupId);
      const part = state?.participants.get(u.id);
      if (!state || !part) return;
      if (p.on) {
        if (part.adminMuted) return; // host-blocked: ignore the attempt
        part.selfMuted = false;
        part.publishing = true;
      } else {
        part.selfMuted = true;
        part.publishing = false;
      }
      io?.to(callRoom(p.groupId)).emit("call:peer:mic", {
        userId: u.id,
        publishing: part.publishing,
        selfMuted: part.selfMuted,
      });
      await broadcastRoster(p.groupId);
    });

    /** Raise / lower hand — everyone in the call sees it (with a sound). */
    socket.on("call:hand", async (payload: unknown) => {
      const p = payload as
        | { groupId?: unknown; raised?: unknown }
        | null;
      if (!p || typeof p.groupId !== "string" || typeof p.raised !== "boolean")
        return;
      const state = getActiveCall(p.groupId);
      const part = state?.participants.get(u.id);
      if (!state || !part) return;
      part.handRaised = p.raised;
      io?.to(callRoom(p.groupId)).emit("call:hand", {
        userId: u.id,
        name: part.name,
        raised: p.raised,
      });
      await broadcastRoster(p.groupId);
    });

    /**
     * Host mute / lift. Muting forces the mic off and blocks self-unmute;
     * lifting lets the person unmute themselves (it never unmutes for them).
     */
    socket.on("call:admin-mic", async (payload: unknown) => {
      const p = payload as
        | { groupId?: unknown; userId?: unknown; muted?: unknown }
        | null;
      if (
        !u.is_admin ||
        !p ||
        typeof p.groupId !== "string" ||
        typeof p.userId !== "string" ||
        typeof p.muted !== "boolean"
      )
        return;
      const state = getActiveCall(p.groupId);
      const part = state?.participants.get(p.userId);
      if (!state || !part) return;
      part.adminMuted = p.muted;
      if (p.muted) {
        // Force-mute: mic off now, and the person stays muted after the host
        // lifts it — they must unmute themselves (never force-unmuted).
        part.selfMuted = true;
        part.publishing = false;
        // Tell the target's own sockets to kill the live mic immediately.
        io?.to(`user:${p.userId}`).emit("call:forced-mute", {
          groupId: p.groupId,
          muted: true,
        });
      }
      io?.to(callRoom(p.groupId)).emit("call:peer:mic", {
        userId: p.userId,
        publishing: part.publishing,
        adminMuted: part.adminMuted,
      });
      await broadcastRoster(p.groupId);
    });

    /** WebRTC signaling relay (SDP / ICE) between two people in the call. */
    socket.on("call:signal", (payload: unknown) => {
      const p = payload as
        | { groupId?: unknown; to?: unknown; data?: unknown }
        | null;
      if (!p || typeof p.groupId !== "string" || typeof p.to !== "string")
        return;
      const state = getActiveCall(p.groupId);
      if (!state || !state.participants.has(u.id)) return; // must be in the call
      io?.to(callUserRoom(p.groupId, p.to)).emit("call:signal", {
        from: u.id,
        data: p.data,
      });
    });

    socket.on("disconnect", async () => {
      const gid = data.callGroupId;
      if (!gid) return;
      const others = await io?.in(callUserRoom(gid, u.id)).fetchSockets();
      if (others?.length) return;
      const state = getActiveCall(gid);
      if (state && state.participants.has(u.id)) {
        removeParticipant(state, u.id);
        io?.to(callRoom(gid)).emit("call:peer:left", { userId: u.id });
        await broadcastRoster(gid);
      }
    });
  });

  return io;
}
