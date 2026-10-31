import crypto from "node:crypto";
import { Router, type Request, type Response } from "express";
import { eq, desc, like, or, and } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  sqlite,
  getSetting,
  setSetting,
  getMembershipPriceKobo,
  getTerms,
} from "../db";
import {
  user,
  account,
  session,
  announcements,
  broadcasts,
  emailDeliveries,
  groupMembers,
  groupJoinRequests,
  groups,
  payments,
  uploads,
} from "../db/schema";
import { env } from "../env";
import { requireAdmin, type SessionUser } from "../middleware";
import { notify, broadcastToUsers, activeMemberIds } from "../notifications";
import {
  revokeMembership,
  paystackConfigured,
  verifyPayment,
  publicBaseUrl,
} from "../payments";
import { sendBroadcast, emailConfigured, fromAddress } from "../email";
import { broadcastEmail, stripHtml } from "../emailTemplates";
import { getIO } from "../realtime";

function uuid(): string {
  return crypto.randomUUID();
}

const router = Router();
router.use(requireAdmin);

/* ------------------------------------------------------------------ */
/* Dashboard statistics                                                */
/* ------------------------------------------------------------------ */

router.get("/stats", async (_req: Request, res: Response) => {
  const totalMembers = (
    sqlite.prepare("SELECT COUNT(*) AS c FROM user").get() as { c: number }
  ).c;
  const activeMembers = (
    sqlite
      .prepare(
        "SELECT COUNT(*) AS c FROM user WHERE membership_status = 'active' AND banned_at IS NULL",
      )
      .get() as { c: number }
  ).c;
  const verifiedMembers = (
    sqlite
      .prepare("SELECT COUNT(*) AS c FROM user WHERE email_verified = 1")
      .get() as { c: number }
  ).c;
  const pay = sqlite
    .prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) AS success,
         SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
         SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
         SUM(CASE WHEN status = 'success' THEN amount_kobo ELSE 0 END) AS revenue
       FROM payments`,
    )
    .get() as {
    total: number;
    success: number | null;
    pending: number | null;
    failed: number | null;
    revenue: number | null;
  };
  const recent = await db.query.user.findMany({
    orderBy: [desc(user.createdAt)],
    limit: 8,
  });

  res.json({
    totalMembers,
    activeMembers,
    verifiedMembers,
    payments: {
      total: pay.total || 0,
      success: pay.success || 0,
      pending: pay.pending || 0,
      failed: pay.failed || 0,
      revenueKobo: pay.revenue || 0,
    },
    priceKobo: getMembershipPriceKobo(),
    paystackConfigured: paystackConfigured(),
    groupsCount: (
      sqlite.prepare("SELECT COUNT(*) AS c FROM groups").get() as { c: number }
    ).c,
    recentSignups: recent.map((r) => ({
      id: r.id,
      name: r.name,
      email: r.email,
      status: r.membership_status,
      createdAt: r.createdAt.toISOString(),
    })),
  });
});

/* ------------------------------------------------------------------ */
/* Members                                                             */
/* ------------------------------------------------------------------ */

router.get("/members", async (req: Request, res: Response) => {
  const q = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 80) : "";
  const status = typeof req.query.status === "string" ? req.query.status : "";
  const page = Math.max(1, Number(req.query.page) || 1);
  const perPage = 25;

  let where = undefined as unknown;
  const conditions = [];
  if (q) {
    conditions.push(
      or(
        like(user.name, `%${q}%`),
        like(user.email, `%${q}%`),
        like(user.whatsapp_number, `%${q}%`),
      ),
    );
  }
  if (status) conditions.push(eq(user.membership_status, status));
  if (conditions.length) where = and(...(conditions.filter(Boolean) as never[]));

  const rows = await db.query.user.findMany({
    where: where as never,
    orderBy: [desc(user.createdAt)],
    limit: perPage,
    offset: (page - 1) * perPage,
  });
  const total = (
    sqlite
      .prepare(
        q
          ? "SELECT COUNT(*) AS c FROM user WHERE name LIKE ? OR email LIKE ? OR IFNULL(whatsapp_number,'') LIKE ?"
          : "SELECT COUNT(*) AS c FROM user",
      )
      .all(...(q ? [`%${q}%`, `%${q}%`, `%${q}%`] : [])) as { c: number }[]
  )[0]?.c || 0;

  res.json({
    members: rows.map((r) => ({
      id: r.id,
      name: r.name,
      email: r.email,
      whatsappNumber: r.whatsapp_number,
      country: r.country,
      stateRegion: r.state_region,
      gender: r.gender,
      emailVerified: r.emailVerified,
      isAdmin: r.is_admin,
      membershipStatus: r.membership_status,
      membershipExpiresAt: r.membership_expires_at
        ? r.membership_expires_at.toISOString()
        : null,
      banned: Boolean(r.banned_at),
      createdAt: r.createdAt.toISOString(),
    })),
    total,
    page,
    perPage,
  });
});

router.get("/members/:id", async (req: Request, res: Response) => {
  const u = await db.query.user.findFirst({ where: eq(user.id, String(req.params.id)) });
  if (!u) return res.status(404).json({ error: "Member not found" });
  const pays = await db.query.payments.findMany({
    where: eq(payments.user_id, u.id),
    orderBy: [desc(payments.created_at)],
  });
  res.json({
    member: {
      id: u.id,
      name: u.name,
      email: u.email,
      whatsappNumber: u.whatsapp_number,
      country: u.country,
      stateRegion: u.state_region,
      gender: u.gender,
      emailVerified: u.emailVerified,
      isAdmin: u.is_admin,
      membershipStatus: u.membership_status,
      membershipExpiresAt: u.membership_expires_at
        ? u.membership_expires_at.toISOString()
        : null,
      banned: Boolean(u.banned_at),
      createdAt: u.createdAt.toISOString(),
    },
    payments: pays.map((p) => ({
      reference: p.reference,
      amountKobo: p.amount_kobo,
      status: p.status,
      channel: p.channel,
      createdAt: p.created_at.toISOString(),
      verifiedAt: p.verified_at ? p.verified_at.toISOString() : null,
    })),
  });
});

const memberAction = z.object({
  action: z.enum([
    "grant_membership",
    "revoke_membership",
    "ban",
    "unban",
    "delete",
    "resend_verification",
    "set_expiry",
  ]),
  expiresAt: z.string().datetime().optional(),
});

router.post("/members/:id/action", async (req: Request, res: Response) => {
  const parsed = memberAction.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid action" });
  const target = await db.query.user.findFirst({
    where: eq(user.id, String(req.params.id)),
  });
  if (!target) return res.status(404).json({ error: "Member not found" });

  const { action } = parsed.data;
  switch (action) {
    case "grant_membership": {
      await db
        .update(user)
        .set({
          membership_status: "active",
          membership_expires_at: parsed.data.expiresAt
            ? new Date(parsed.data.expiresAt)
            : null,
          updatedAt: new Date(),
        })
        .where(eq(user.id, target.id));
      await notify({
        userId: target.id,
        type: "system",
        title: "Membership activated",
        body: "An administrator activated your academy membership.",
        link: "/app/groups",
      });
      getIO()?.to(`user:${target.id}`).emit("membership:changed", {
        status: "active",
      });
      break;
    }
    case "revoke_membership":
      await revokeMembership(target.id);
      break;
    case "ban":
      // Ban is reversible: revoke every live session (kicking sockets too) but
      // keep the credential account so an unban restores full access.
      await db
        .update(user)
        .set({ banned_at: new Date(), updatedAt: new Date() })
        .where(eq(user.id, target.id));
      await db.delete(session).where(eq(session.userId, target.id));
      getIO()?.to(`user:${target.id}`).emit("banned", {});
      break;
    case "unban":
      await db
        .update(user)
        .set({ banned_at: null, updatedAt: new Date() })
        .where(eq(user.id, target.id));
      break;
    case "delete": {
      if (target.is_admin) {
        return res.status(400).json({ error: "Cannot delete an administrator" });
      }
      // remove from conversations/groups; cascade handles most rows
      await db.delete(user).where(eq(user.id, target.id));
      const io = getIO();
      if (io) {
        for (const s of io.sockets.sockets.values()) {
          const data = s.data as { user?: { id?: string } };
          if (data.user?.id === target.id) s.disconnect(true);
        }
      }
      res.json({ ok: true, deleted: true });
      return;
    }
    case "resend_verification": {
      if (target.emailVerified) {
        return res.status(400).json({ error: "Email is already verified" });
      }
      // Trigger a fresh OTP through Better Auth's email OTP plugin endpoint logic
      try {
        const { auth } = await import("../auth");
        await auth.api.sendVerificationOTP({
          body: { email: target.email, type: "email-verification" },
          headers: req.headers as never,
        });
      } catch (err) {
        console.error("[admin] resend verification failed:", err);
        return res.status(500).json({ error: "Could not send verification email" });
      }
      res.json({ ok: true, sent: true });
      return;
    }
    case "set_expiry": {
      if (!parsed.data.expiresAt) {
        return res.status(400).json({ error: "expiresAt required" });
      }
      await db
        .update(user)
        .set({
          membership_expires_at: new Date(parsed.data.expiresAt),
          updatedAt: new Date(),
        })
        .where(eq(user.id, target.id));
      break;
    }
  }
  res.json({ ok: true });
});

/* ------------------------------------------------------------------ */
/* Groups management                                                   */
/* ------------------------------------------------------------------ */

router.get("/groups", async (_req: Request, res: Response) => {
  const rows = await db.query.groups.findMany({ orderBy: [desc(groups.created_at)] });
  const result = await Promise.all(
    rows.map(async (g) => {
      const members = await db
        .select({ user_id: groupMembers.user_id, role: groupMembers.role, name: user.name })
        .from(groupMembers)
        .leftJoin(user, eq(user.id, groupMembers.user_id))
        .where(eq(groupMembers.group_id, g.id));
      const msgCount = (
        sqlite
          .prepare("SELECT COUNT(*) AS c FROM messages WHERE group_id = ?")
          .get(g.id) as { c: number }
      ).c;
      const pendingRequests = (
        sqlite
          .prepare(
            "SELECT COUNT(*) AS c FROM group_join_requests WHERE group_id = ? AND status = 'pending'",
          )
          .get(g.id) as { c: number }
      ).c;
      return {
        id: g.id,
        name: g.name,
        description: g.description,
        pictureUrl: g.picture_path ? `/media/${g.picture_path}` : null,
        sendPolicy: g.send_policy,
        joinPolicy: g.join_policy as "open" | "request",
        archived: Boolean(g.archived_at),
        createdAt: g.created_at.toISOString(),
        messageCount: msgCount,
        pendingRequests,
        members: members.map((m) => ({
          id: m.user_id,
          name: m.name || "Member",
          role: m.role,
        })),
      };
    }),
  );
  res.json({ groups: result });
});

const groupSchema = z.object({
  name: z.string().min(1).max(80),
  description: z.string().max(500).optional().nullable(),
  picturePath: z.string().max(500).optional().nullable(),
  sendPolicy: z.enum(["everyone", "admins_only"]).default("everyone"),
  joinPolicy: z.enum(["open", "request"]).default("open"),
  memberIds: z.array(z.string()).max(2000).optional(),
});

router.post("/groups", async (req: Request, res: Response) => {
  const admin = req.appUser as SessionUser;
  const parsed = groupSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid group data", details: parsed.error.issues });
  }
  const id = uuid();
  const now = new Date();
  const data = parsed.data;

  await db.insert(groups).values({
    id,
    name: data.name,
    description: data.description || null,
    picture_path: data.picturePath || null,
    send_policy: data.sendPolicy,
    join_policy: data.joinPolicy,
    created_at: now,
  });

  // add admin + selected members
  const memberSet = new Set(data.memberIds || []);
  memberSet.add(admin.id);
  for (const uid of memberSet) {
    const exists = await db.query.user.findFirst({ where: eq(user.id, uid) });
    if (!exists) continue;
    await db
      .insert(groupMembers)
      .values({
        group_id: id,
        user_id: uid,
        role: uid === admin.id ? "admin" : "member",
        joined_at: now,
      })
      .onConflictDoNothing();
  }

  // assign avatar upload scope
  if (data.picturePath) {
    await db
      .update(uploads)
      .set({ group_id: id, kind: "avatar" })
      .where(eq(uploads.path, data.picturePath));
  }

  // notify members they were added
  for (const uid of memberSet) {
    if (uid === admin.id) continue;
    getIO()?.to(`user:${uid}`).emit("group:added", { groupId: id, name: data.name });
  }

  res.status(201).json({ id });
});

router.patch("/groups/:id", async (req: Request, res: Response) => {
  const g = await db.query.groups.findFirst({ where: eq(groups.id, String(req.params.id)) });
  if (!g) return res.status(404).json({ error: "Group not found" });
  const parsed = groupSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid group data", details: parsed.error.issues });
  }
  const d = parsed.data;
  const sets: Record<string, unknown> = {};
  if (d.name !== undefined) sets.name = d.name;
  if (d.description !== undefined) sets.description = d.description;
  if (d.picturePath !== undefined) sets.picture_path = d.picturePath;
  if (d.sendPolicy !== undefined) sets.send_policy = d.sendPolicy;
  if (d.joinPolicy !== undefined) sets.join_policy = d.joinPolicy;
  if (Object.keys(sets).length) {
    await db.update(groups).set(sets).where(eq(groups.id, g.id));
    if (d.picturePath) {
      await db
        .update(uploads)
        .set({ group_id: g.id, kind: "avatar" })
        .where(eq(uploads.path, d.picturePath));
    }
    getIO()?.to(`group:${g.id}`).emit("group:updated", {
      id: g.id,
      name: d.name ?? g.name,
      sendPolicy: d.sendPolicy ?? g.send_policy,
      joinPolicy: d.joinPolicy ?? g.join_policy,
    });
  }
  res.json({ ok: true });
});

/* ------------------------------------------------------------------ */
/* Join requests (approval)                                            */
/* ------------------------------------------------------------------ */

router.get("/groups/:id/requests", async (req: Request, res: Response) => {
  const g = await db.query.groups.findFirst({ where: eq(groups.id, String(req.params.id)) });
  if (!g) return res.status(404).json({ error: "Group not found" });
  const rows = await db
    .select({
      id: groupJoinRequests.id,
      user_id: groupJoinRequests.user_id,
      status: groupJoinRequests.status,
      created_at: groupJoinRequests.created_at,
      name: user.name,
      email: user.email,
    })
    .from(groupJoinRequests)
    .leftJoin(user, eq(user.id, groupJoinRequests.user_id))
    .where(eq(groupJoinRequests.group_id, g.id))
    .orderBy(desc(groupJoinRequests.created_at));

  res.json({
    requests: rows.map((r) => ({
      id: r.id,
      groupId: g.id,
      userId: r.user_id,
      userName: r.name || "Member",
      userEmail: r.email,
      status: r.status as "pending" | "approved" | "denied",
      createdAt: r.created_at.toISOString(),
    })),
  });
});

const requestDecision = z.object({
  userId: z.string().min(1),
  action: z.enum(["approve", "deny"]),
});

router.post("/groups/:id/requests", async (req: Request, res: Response) => {
  const admin = req.appUser as SessionUser;
  const g = await db.query.groups.findFirst({ where: eq(groups.id, String(req.params.id)) });
  if (!g) return res.status(404).json({ error: "Group not found" });
  const parsed = requestDecision.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request" });
  const { userId, action } = parsed.data;

  const record = await db.query.groupJoinRequests.findFirst({
    where: and(eq(groupJoinRequests.group_id, g.id), eq(groupJoinRequests.user_id, userId)),
  });
  if (!record || record.status !== "pending") {
    return res.status(404).json({ error: "No pending request for this member" });
  }

  if (action === "approve") {
    await db
      .insert(groupMembers)
      .values({
        group_id: g.id,
        user_id: userId,
        role: "member",
        joined_at: new Date(),
      })
      .onConflictDoNothing();
    await db
      .update(groupJoinRequests)
      .set({ status: "approved", decided_at: new Date(), decided_by: admin.id })
      .where(eq(groupJoinRequests.id, record.id));
    getIO()?.to(`user:${userId}`).emit("group:added", { groupId: g.id, name: g.name });
    void notify({
      userId,
      type: "system",
      title: `You joined ${g.name}`,
      body: "Your request to join was approved.",
      link: `/app/groups/${g.id}`,
    });
  } else {
    await db
      .update(groupJoinRequests)
      .set({ status: "denied", decided_at: new Date(), decided_by: admin.id })
      .where(eq(groupJoinRequests.id, record.id));
  }
  res.json({ ok: true, status: action === "approve" ? "approved" : "denied" });
});

router.delete("/groups/:id", async (req: Request, res: Response) => {
  const g = await db.query.groups.findFirst({ where: eq(groups.id, String(req.params.id)) });
  if (!g) return res.status(404).json({ error: "Group not found" });
  // soft archive keeps history but hides the group everywhere
  await db
    .update(groups)
    .set({ archived_at: new Date() })
    .where(eq(groups.id, g.id));
  getIO()?.to(`group:${g.id}`).emit("group:archived", { id: g.id });
  res.json({ ok: true });
});

const memberOps = z.object({
  userId: z.string().min(1),
  role: z.enum(["member", "admin"]).optional(),
  op: z.enum(["add", "remove", "set_role"]),
});

router.post("/groups/:id/members", async (req: Request, res: Response) => {
  const g = await db.query.groups.findFirst({ where: eq(groups.id, String(req.params.id)) });
  if (!g) return res.status(404).json({ error: "Group not found" });
  const parsed = memberOps.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request" });
  const { userId, role, op } = parsed.data;

  if (op === "add") {
    const exists = await db.query.user.findFirst({ where: eq(user.id, userId) });
    if (!exists) return res.status(404).json({ error: "User not found" });
    await db
      .insert(groupMembers)
      .values({
        group_id: g.id,
        user_id: userId,
        role: "member",
        joined_at: new Date(),
      })
      .onConflictDoNothing();
    getIO()?.to(`user:${userId}`).emit("group:added", { groupId: g.id, name: g.name });
  } else if (op === "remove") {
    await db
      .delete(groupMembers)
      .where(
        and(eq(groupMembers.group_id, g.id), eq(groupMembers.user_id, userId)),
      );
    const io = getIO();
    // drop any sockets in that group room for this user
    for (const s of io?.sockets.sockets.values() || []) {
      const data = s.data as { user?: { id?: string } };
      if (data.user?.id === userId) void s.leave(`group:${g.id}`);
    }
  } else if (op === "set_role") {
    await db
      .update(groupMembers)
      .set({ role: role || "member" })
      .where(
        and(eq(groupMembers.group_id, g.id), eq(groupMembers.user_id, userId)),
      );
  }
  res.json({ ok: true });
});

/* ------------------------------------------------------------------ */
/* Payments records                                                    */
/* ------------------------------------------------------------------ */

router.get("/payments", async (req: Request, res: Response) => {
  const status = typeof req.query.status === "string" ? req.query.status : "";
  const q = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 80) : "";
  const page = Math.max(1, Number(req.query.page) || 1);
  const perPage = 25;

  const rows = await db.query.payments.findMany({
    orderBy: [desc(payments.created_at)],
    limit: perPage,
    offset: (page - 1) * perPage,
  });
  const users = await db.query.user.findMany({});
  const userMap = Object.fromEntries(users.map((u) => [u.id, u]));

  let filtered = rows;
  if (status) filtered = filtered.filter((p) => p.status === status);
  if (q) {
    filtered = filtered.filter((p) => {
      const u = userMap[p.user_id];
      return (
        p.reference.includes(q) ||
        (u && (u.email.includes(q) || u.name.includes(q)))
      );
    });
  }

  res.json({
    payments: filtered.map((p) => {
      const u = userMap[p.user_id];
      return {
        id: p.id,
        reference: p.reference,
        userId: p.user_id,
        userName: u?.name || "Unknown",
        userEmail: u?.email || "unknown",
        amountKobo: p.amount_kobo,
        currency: p.currency,
        status: p.status,
        channel: p.channel,
        termsVersion: p.terms_version_at_purchase,
        createdAt: p.created_at.toISOString(),
        verifiedAt: p.verified_at ? p.verified_at.toISOString() : null,
      };
    }),
  });
});

router.post("/payments/:reference/reverify", async (req: Request, res: Response) => {
  const outcome = await verifyPayment(String(req.params.reference), "admin");
  if (!outcome.ok) return res.status(502).json({ error: outcome.error });
  res.json({ status: outcome.status, message: outcome.message });
});

/* ------------------------------------------------------------------ */
/* Settings: price + terms + senders                                   */
/* ------------------------------------------------------------------ */

router.get("/settings", (req: Request, res: Response) => {
  const base = publicBaseUrl(req);
  res.json({
    priceKobo: getMembershipPriceKobo(),
    terms: getTerms(),
    emailProvider: "resend",
    senderName: env.resendSenderName,
    senderEmail: env.resendSenderEmail,
    resendConfigured: emailConfigured(),
    resendWebhookConfigured: Boolean(env.resendWebhookSecret),
    paystackConfigured: paystackConfigured(),
    /* Absolute URLs to paste into the Resend & Paystack dashboards. Derived
       from the incoming request when APP_URL is unset, so they are never
       localhost in production. */
    webhooks: {
      resend: `${base}/api/webhooks/resend`,
      paystack: `${base}/api/payments/webhook`,
      paystackCallback: `${base}/pay/callback`,
    },
  });
});

const settingsSchema = z.object({
  priceNaira: z.number().min(0).max(10_000_000).optional(),
  termsText: z.string().max(100_000).optional(),
});

router.put("/settings", async (req: Request, res: Response) => {
  const parsed = settingsSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid settings" });
  const d = parsed.data;

  if (d.priceNaira !== undefined) {
    const kobo = Math.round(d.priceNaira * 100);
    setSetting("membership_price_kobo", String(kobo));
  }
  if (d.termsText !== undefined) {
    const current = getSetting("terms_text") ?? "";
    if (d.termsText !== current) {
      setSetting("terms_text", d.termsText);
      const version = Number(getSetting("terms_version") || "1") + 1;
      setSetting("terms_version", String(version));
    }
  }
  res.json({
    priceKobo: getMembershipPriceKobo(),
    terms: getTerms(),
  });
});

/* ------------------------------------------------------------------ */
/* Email broadcasts (Resend)                                           */
/* ------------------------------------------------------------------ */

const broadcastSchema = z.object({
  subject: z.string().min(1).max(200),
  html: z.string().min(1).max(200_000),
  /** Optional plain-text fallback; derived from the HTML when omitted. */
  text: z.string().max(100_000).optional(),
  /** When set, the broadcast goes only to this address (marked [TEST]). */
  testEmail: z.string().email().optional(),
});

/** POST /api/admin/broadcast — sends a branded HTML email to every member. */
router.post("/broadcast", async (req: Request, res: Response) => {
  const admin = req.appUser as SessionUser;
  const parsed = broadcastSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid broadcast", details: parsed.error.issues });
  }
  const { html } = parsed.data;
  let subject = parsed.data.subject;

  // Audience: every verified, active, non-banned member (admins included).
  let recipients: { email: string; userId: string; firstName: string }[] = [];
  if (parsed.data.testEmail) {
    subject = `[TEST] ${subject}`;
    recipients = [
      { email: parsed.data.testEmail, userId: admin.id, firstName: admin.name.split(/\s+/)[0] || "there" },
    ];
  } else {
    const rows = await db.query.user.findMany({
      where: and(
        eq(user.emailVerified, true),
        eq(user.membership_status, "active"),
      ),
    });
    recipients = rows
      .filter((u) => !u.banned_at)
      .map((u) => ({
        email: u.email,
        userId: u.id,
        firstName: u.name.split(/\s+/)[0] || "there",
      }));
  }

  if (!recipients.length) {
    return res.status(400).json({ error: "No active members to send to" });
  }

  const broadcastId = uuid();
  const fallbackText = parsed.data.text?.trim() || stripHtml(html);

  // Parent row must exist before deliveries reference it (FK constraint).
  await db.insert(broadcasts).values({
    id: broadcastId,
    admin_id: admin.id,
    subject,
    html,
    text: fallbackText,
    total_sent: 0,
    send_failed: 0,
    created_at: new Date(),
  });

  const result = await sendBroadcast({
    broadcastId,
    recipients,
    subject,
    buildHtml: (firstName) => broadcastEmail(subject, html, firstName).html,
    buildText: (firstName) =>
      `${firstName},\n\n${subject}\n\n${fallbackText}\n\n— Omnivex Academy`,
  });

  await db
    .update(broadcasts)
    .set({ total_sent: result.sent, send_failed: result.failed })
    .where(eq(broadcasts.id, broadcastId));

  res.status(201).json({
    id: broadcastId,
    sent: result.sent,
    failed: result.failed,
    mode: result.mode,
    sender: fromAddress(),
  });
});

/** GET /api/admin/broadcasts — history with live delivery counts. */
router.get("/broadcasts", async (_req: Request, res: Response) => {
  const rows = await db.query.broadcasts.findMany({
    orderBy: [desc(broadcasts.created_at)],
    limit: 50,
  });
  const result = await Promise.all(
    rows.map(async (b) => {
      const deliveries = await db.query.emailDeliveries.findMany({
        where: eq(emailDeliveries.broadcast_id, b.id),
      });
      const count = (s: string) => deliveries.filter((d) => d.status === s).length;
      return {
        id: b.id,
        subject: b.subject,
        createdAt: b.created_at.toISOString(),
        totalSent: b.total_sent,
        sendFailed: b.send_failed,
        delivered: count("delivered"),
        bounced: count("bounced"),
        complained: count("complained"),
        failed: count("failed") + count("suppressed"),
        pending: deliveries.filter((d) =>
          ["queued", "sent", "delayed"].includes(d.status),
        ).length,
      };
    }),
  );
  res.json({ broadcasts: result });
});

/** GET /api/admin/broadcasts/:id — per-recipient delivery rows. */
router.get("/broadcasts/:id", async (req: Request, res: Response) => {
  const b = await db.query.broadcasts.findFirst({
    where: eq(broadcasts.id, String(req.params.id)),
  });
  if (!b) return res.status(404).json({ error: "Broadcast not found" });
  const deliveries = await db.query.emailDeliveries.findMany({
    where: eq(emailDeliveries.broadcast_id, b.id),
    orderBy: [desc(emailDeliveries.updated_at)],
    limit: 1000,
  });
  res.json({
    broadcast: {
      id: b.id,
      subject: b.subject,
      html: b.html,
      createdAt: b.created_at.toISOString(),
      totalSent: b.total_sent,
      sendFailed: b.send_failed,
    },
    deliveries: deliveries.map((d) => ({
      email: d.email,
      status: d.status,
      detail: d.detail,
      updatedAt: d.updated_at.toISOString(),
    })),
  });
});

/** GET /api/admin/email/activity — recent transactional + broadcast sends. */
router.get("/email/activity", async (_req: Request, res: Response) => {
  const rows = await db.query.emailDeliveries.findMany({
    orderBy: [desc(emailDeliveries.updated_at)],
    limit: 50,
  });
  const users = await db.query.user.findMany({});
  const names = Object.fromEntries(users.map((u) => [u.id, u.name]));
  res.json({
    configured: emailConfigured(),
    sender: fromAddress(),
    activity: rows.map((d) => ({
      email: d.email,
      userName: d.user_id ? names[d.user_id] || null : null,
      broadcastId: d.broadcast_id,
      status: d.status,
      detail: d.detail,
      updatedAt: d.updated_at.toISOString(),
    })),
  });
});

/* ------------------------------------------------------------------ */
/* Announcements                                                       */
/* ------------------------------------------------------------------ */

router.get("/announcements", async (_req: Request, res: Response) => {
  const rows = await db.query.announcements.findMany({
    orderBy: [desc(announcements.created_at)],
    limit: 100,
  });
  res.json({
    announcements: rows.map((a) => ({
      id: a.id,
      title: a.title,
      body: a.body,
      createdAt: a.created_at.toISOString(),
    })),
  });
});

const announceSchema = z.object({
  title: z.string().min(1).max(150),
  body: z.string().min(1).max(5000),
});

router.post("/announcements", async (req: Request, res: Response) => {
  const admin = req.appUser as SessionUser;
  const parsed = announceSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid announcement" });

  const id = uuid();
  await db.insert(announcements).values({
    id,
    admin_id: admin.id,
    title: parsed.data.title,
    body: parsed.data.body,
    created_at: new Date(),
  });

  const targets = await activeMemberIds();
  for (const uid of targets) {
    await notify({
      userId: uid,
      type: "announcement",
      actorId: admin.id,
      title: parsed.data.title,
      body: parsed.data.body.slice(0, 200),
      link: "/app/notifications",
      pushBody: parsed.data.body.slice(0, 120),
    });
  }
  await broadcastToUsers(targets, "announcement:new", { id });

  res.status(201).json({ id, delivered: targets.length });
});

export default router;
