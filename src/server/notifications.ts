import crypto from "node:crypto";
import webpush from "web-push";
import { eq, inArray, and, isNull } from "drizzle-orm";
import { db, sqlite, getSetting, setSetting } from "./db";
import {
  notifications,
  notificationPrefs,
  pushSubscriptions,
  user,
} from "./db/schema";
import { env } from "./env";
import { getIO } from "./realtime";

function uuid(): string {
  return crypto.randomUUID();
}

let vapidReady = false;
let vapidKeys: { publicKey: string; privateKey: string } | null = null;

/** VAPID keys: from env, else generated once and persisted in settings. */
export function ensureVapidKeys(): { publicKey: string; privateKey: string } | null {
  if (vapidKeys) return vapidKeys;
  let pub = env.vapidPublicKey;
  let priv = env.vapidPrivateKey;
  if (!pub || !priv) {
    pub = getSetting("vapid_public_key") || "";
    priv = getSetting("vapid_private_key") || "";
    if (!pub || !priv) {
      if (env.isProd) {
        console.warn("[push] VAPID keys missing — web push disabled until VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY are set.");
        return null;
      }
      const keys = webpush.generateVAPIDKeys();
      pub = keys.publicKey;
      priv = keys.privateKey;
      setSetting("vapid_public_key", pub);
      setSetting("vapid_private_key", priv);
      console.log("[push] generated VAPID keys (stored in settings)");
    }
  }
  vapidKeys = { publicKey: pub, privateKey: priv };
  try {
    webpush.setVapidDetails(env.vapidSubject, pub, priv);
    vapidReady = true;
  } catch (err) {
    console.error("[push] invalid VAPID keys:", err);
    vapidReady = false;
  }
  return vapidKeys;
}

export function getVapidPublicKey(): string | null {
  const keys = ensureVapidKeys();
  return keys ? keys.publicKey : null;
}

export type NotifyArgs = {
  userId: string;
  type: "reply" | "dm" | "group" | "announcement" | "system";
  actorId?: string | null;
  title: string;
  body?: string | null;
  link?: string | null;
  /** push payload */
  pushBody?: string;
};

const DEFAULT_PREFS = {
  push_enabled: true,
  inapp_enabled: true,
  group_message_push: false,
  reply_push: true,
  dm_push: true,
  announcement_push: true,
};

export async function getPrefs(userId: string) {
  const row = await db.query.notificationPrefs.findFirst({
    where: eq(notificationPrefs.user_id, userId),
  });
  return { ...DEFAULT_PREFS, ...(row || {}), user_id: userId };
}

function prefAllows(
  prefs: Awaited<ReturnType<typeof getPrefs>>,
  type: NotifyArgs["type"],
): boolean {
  if (!prefs.push_enabled) return false;
  switch (type) {
    case "reply":
      return prefs.reply_push;
    case "dm":
      return prefs.dm_push;
    case "announcement":
      return prefs.announcement_push;
    case "group":
      return prefs.group_message_push;
    default:
      return true;
  }
}

/** Creates an in-app notification and (when permitted) delivers a web push. */
export async function notify(args: NotifyArgs): Promise<void> {
  const prefs = await getPrefs(args.userId);

  if (prefs.inapp_enabled) {
    await db.insert(notifications).values({
      id: uuid(),
      user_id: args.userId,
      type: args.type,
      actor_id: args.actorId ?? null,
      title: args.title,
      body: args.body ?? null,
      link: args.link ?? null,
      created_at: new Date(),
    });
    const io = getIO();
    if (io) {
      const unread = unreadCount(args.userId);
      io.to(`user:${args.userId}`).emit("notification:new", {
        id: uuid(),
        type: args.type,
        title: args.title,
        body: args.body ?? null,
        link: args.link ?? null,
        createdAt: new Date().toISOString(),
        unread,
      });
    }
  }

  if (prefAllows(prefs, args.type)) {
    await sendPush(args.userId, {
      title: args.title,
      body: args.pushBody || args.body || "",
      link: args.link || "/app/notifications",
      tag: `${args.type}:${args.actorId || "system"}`,
    });
  }
}

export type PushPayload = {
  title: string;
  body: string;
  link: string;
  tag?: string;
};

export async function sendPush(userId: string, payload: PushPayload): Promise<void> {
  try {
    if (!ensureVapidKeys() || !vapidReady) return;
    const subs = await db.query.pushSubscriptions.findMany({
      where: eq(pushSubscriptions.user_id, userId),
    });
    if (!subs.length) return;
    const stale: string[] = [];
    await Promise.all(
      subs.map(async (s) => {
        try {
          await webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            JSON.stringify(payload),
            { TTL: 60 * 60 * 24, urgency: "normal" },
          );
        } catch (err: unknown) {
          const status = (err as { statusCode?: number }).statusCode;
          if (status === 404 || status === 410) stale.push(s.endpoint);
          else console.warn("[push] send failed:", status || err);
        }
      }),
    );
    if (stale.length) {
      for (const endpoint of stale) {
        await db
          .delete(pushSubscriptions)
          .where(eq(pushSubscriptions.endpoint, endpoint));
      }
    }
  } catch (err) {
    console.warn("[push] error:", err);
  }
}

export function unreadCount(userId: string): number {
  const row = sqlite
    .prepare(
      "SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND read_at IS NULL",
    )
    .get(userId) as { c: number };
  return row.c;
}

export async function broadcastToUsers(
  userIds: string[],
  event: string,
  payload: unknown,
): Promise<void> {
  const io = getIO();
  if (!io || !userIds.length) return;
  for (const id of userIds) io.to(`user:${id}`).emit(event, payload);
}

/** Active member ids (for announcements). */
export async function activeMemberIds(): Promise<string[]> {
  const rows = await db
    .select({ id: user.id })
    .from(user)
    .where(and(isNull(user.banned_at)));
  const all = rows.map((r) => r.id);
  if (!all.length) return [];
  const inChunks: string[] = [];
  for (let i = 0; i < all.length; i += 500) {
    const chunk = all.slice(i, i + 500);
    const got = await db
      .select({ id: user.id })
      .from(user)
      .where(inArray(user.id, chunk));
    inChunks.push(...got.map((r) => r.id));
  }
  return inChunks;
}
