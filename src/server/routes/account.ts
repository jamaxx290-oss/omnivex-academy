import crypto from "node:crypto";
import { Router, type Request, type Response } from "express";
import { eq, desc, and, isNull } from "drizzle-orm";
import { z } from "zod";
import { db, getSetting, getMembershipPriceKobo, getTerms } from "../db";
import {
  notifications,
  notificationPrefs,
  pushSubscriptions,
  announcements,
  account,
  session,
} from "../db/schema";
import {
  requireAuth,
  requireVerified,
  requireMember,
  hasActiveMembership,
  type SessionUser,
} from "../middleware";
import { getPrefs, getVapidPublicKey, unreadCount } from "../notifications";

function uuid(): string {
  return crypto.randomUUID();
}

const router = Router();

/* ------------------------------------------------------------------ */
/* Public settings (price, terms, payment readiness)                   */
/* ------------------------------------------------------------------ */

router.get("/settings", (_req: Request, res: Response) => {
  const terms = getTerms();
  res.json({
    appName: getSetting("app_name") || "Omnivex Academy",
    priceKobo: getMembershipPriceKobo(),
    currency: "NGN",
    termsText: terms.text,
    termsVersion: terms.version,
    pushPublicKey: getVapidPublicKey(),
  });
});

/* ------------------------------------------------------------------ */
/* Current user profile                                                */
/* ------------------------------------------------------------------ */

router.get("/me", (req: Request, res: Response) => {
  const u = req.appUser;
  if (!u) return res.json({ user: null });
  res.json({
    user: {
      id: u.id,
      name: u.name,
      email: u.email,
      emailVerified: u.emailVerified,
      whatsappNumber: u.whatsapp_number,
      country: u.country,
      stateRegion: u.state_region,
      gender: u.gender,
      isAdmin: u.is_admin,
      membershipStatus: hasActiveMembership(u) ? "active" : u.membership_status,
      membershipExpiresAt: u.membership_expires_at
        ? u.membership_expires_at.toISOString()
        : null,
      banned: Boolean(u.banned_at),
      createdAt: u.createdAt?.toISOString?.() || null,
      unreadNotifications: unreadCount(u.id),
    },
  });
});

/* ------------------------------------------------------------------ */
/* Notifications                                                       */
/* ------------------------------------------------------------------ */

router.get(
  "/notifications",
  requireVerified,
  async (req: Request, res: Response) => {
    const u = req.appUser as SessionUser;
    const rows = await db.query.notifications.findMany({
      where: eq(notifications.user_id, u.id),
      orderBy: [desc(notifications.created_at)],
      limit: 100,
    });
    res.json({
      notifications: rows.map((n) => ({
        id: n.id,
        type: n.type,
        title: n.title,
        body: n.body,
        link: n.link,
        read: Boolean(n.read_at),
        createdAt: n.created_at.toISOString(),
      })),
      unread: rows.filter((n) => !n.read_at).length,
    });
  },
);

router.post(
  "/notifications/read-all",
  requireVerified,
  async (req: Request, res: Response) => {
    const u = req.appUser as SessionUser;
    await db
      .update(notifications)
      .set({ read_at: new Date() })
      .where(and(eq(notifications.user_id, u.id), isNull(notifications.read_at)));
    res.json({ ok: true });
  },
);

router.get(
  "/notifications/prefs",
  requireAuth,
  async (req: Request, res: Response) => {
    const u = req.appUser as SessionUser;
    const prefs = await getPrefs(u.id);
    res.json({
      prefs: {
        push_enabled: prefs.push_enabled,
        inapp_enabled: prefs.inapp_enabled,
        group_message_push: prefs.group_message_push,
        reply_push: prefs.reply_push,
        dm_push: prefs.dm_push,
        announcement_push: prefs.announcement_push,
      },
    });
  },
);

const prefsSchema = z.object({
  push_enabled: z.boolean().optional(),
  inapp_enabled: z.boolean().optional(),
  group_message_push: z.boolean().optional(),
  reply_push: z.boolean().optional(),
  dm_push: z.boolean().optional(),
  announcement_push: z.boolean().optional(),
});

router.put(
  "/notifications/prefs",
  requireAuth,
  async (req: Request, res: Response) => {
    const u = req.appUser as SessionUser;
    const parsed = prefsSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid preferences" });

    const current = await getPrefs(u.id);
    const merged = { ...current, ...parsed.data, updated_at: new Date() };
    await db
      .insert(notificationPrefs)
      .values({
        user_id: u.id,
        push_enabled: merged.push_enabled,
        inapp_enabled: merged.inapp_enabled,
        group_message_push: merged.group_message_push,
        reply_push: merged.reply_push,
        dm_push: merged.dm_push,
        announcement_push: merged.announcement_push,
        updated_at: new Date(),
      })
      .onConflictDoUpdate({
        target: notificationPrefs.user_id,
        set: {
          push_enabled: merged.push_enabled,
          inapp_enabled: merged.inapp_enabled,
          group_message_push: merged.group_message_push,
          reply_push: merged.reply_push,
          dm_push: merged.dm_push,
          announcement_push: merged.announcement_push,
          updated_at: new Date(),
        },
      });
    res.json({ ok: true });
  },
);

/* ------------------------------------------------------------------ */
/* Web push subscriptions                                              */
/* ------------------------------------------------------------------ */

router.get("/push/public-key", (_req: Request, res: Response) => {
  res.json({ publicKey: getVapidPublicKey() });
});

const pushSubSchema = z.object({
  endpoint: z.string().url().max(2000),
  keys: z.object({ p256dh: z.string().max(500), auth: z.string().max(500) }),
});

router.post(
  "/push/subscribe",
  requireAuth,
  async (req: Request, res: Response) => {
    const u = req.appUser as SessionUser;
    const parsed = pushSubSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid subscription" });
    const { endpoint, keys } = parsed.data;
    await db
      .insert(pushSubscriptions)
      .values({
        id: uuid(),
        user_id: u.id,
        endpoint,
        p256dh: keys.p256dh,
        auth: keys.auth,
        created_at: new Date(),
      })
      .onConflictDoUpdate({
        target: pushSubscriptions.endpoint,
        set: { user_id: u.id },
      });
    res.status(201).json({ ok: true });
  },
);

router.delete(
  "/push/unsubscribe",
  requireAuth,
  async (req: Request, res: Response) => {
    const u = req.appUser as SessionUser;
    const endpoint = z
      .object({ endpoint: z.string().url().max(2000) })
      .safeParse(req.body);
    if (!endpoint.success) return res.status(400).json({ error: "endpoint required" });
    await db
      .delete(pushSubscriptions)
      .where(eq(pushSubscriptions.endpoint, endpoint.data.endpoint));
    res.json({ ok: true });
  },
);

/* ------------------------------------------------------------------ */
/* Announcements (member view)                                         */
/* ------------------------------------------------------------------ */

router.get(
  "/announcements",
  requireMember,
  async (_req: Request, res: Response) => {
    const rows = await db.query.announcements.findMany({
      orderBy: [desc(announcements.created_at)],
      limit: 50,
    });
    res.json({
      announcements: rows.map((a) => ({
        id: a.id,
        title: a.title,
        body: a.body,
        createdAt: a.created_at.toISOString(),
      })),
    });
  },
);

/* ------------------------------------------------------------------ */
/* Password change (signed-in)                                         */
/* ------------------------------------------------------------------ */

router.post(
  "/me/password",
  requireAuth,
  async (req: Request, res: Response) => {
    const u = req.appUser as SessionUser;
    const parsed = z
      .object({
        currentPassword: z.string().min(1),
        newPassword: z.string().min(8).max(128),
      })
      .safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Password must be at least 8 characters" });
    }
    try {
      const { verifyPassword, hashPassword } = await import("better-auth/crypto");
      const acct = await db.query.account.findFirst({
        where: and(eq(account.userId, u.id), eq(account.providerId, "credential")),
      });
      if (!acct?.password) return res.status(400).json({ error: "No password set" });
      const ok = await verifyPassword({
        hash: acct.password,
        password: parsed.data.currentPassword,
      });
      if (!ok) return res.status(400).json({ error: "Current password is incorrect" });

      const newHash = await hashPassword(parsed.data.newPassword);
      await db
        .update(account)
        .set({ password: newHash, updatedAt: new Date() })
        .where(eq(account.id, acct.id));

      // revoke all other sessions for safety
      await db.delete(session).where(eq(session.userId, u.id));

      res.json({ ok: true });
    } catch (err) {
      console.error("[me/password]", err);
      res.status(500).json({ error: "Could not change password" });
    }
  },
);

export default router;
