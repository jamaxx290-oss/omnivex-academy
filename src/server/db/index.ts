import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { env } from "../env";
import * as schema from "./schema";

const dbFile = env.databaseUrl.startsWith("file:")
  ? env.databaseUrl.slice(5)
  : env.databaseUrl;
fs.mkdirSync(path.dirname(dbFile), { recursive: true });

export const sqlite = new Database(dbFile);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");
sqlite.pragma("busy_timeout = 5000");

export type DB = BetterSQLite3Database<typeof schema>;

export const db: DB = drizzle(sqlite, { schema });

/* ------------------------------------------------------------------ */
/* Migrations: ordered, idempotent, recorded in schema_migrations      */
/* ------------------------------------------------------------------ */

type Migration = { id: string; sql: string };

const migrations: Migration[] = [
  {
    id: "001_auth_core",
    sql: `
CREATE TABLE IF NOT EXISTS user (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  email_verified INTEGER NOT NULL DEFAULT 0,
  image TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  whatsapp_number TEXT,
  country TEXT,
  state_region TEXT,
  is_admin INTEGER NOT NULL DEFAULT 0,
  membership_status TEXT NOT NULL DEFAULT 'none',
  membership_expires_at INTEGER,
  banned_at INTEGER
);
CREATE TABLE IF NOT EXISTS session (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  expires_at INTEGER NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS session_user_idx ON session (user_id);
CREATE TABLE IF NOT EXISTS account (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  provider_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  access_token TEXT,
  refresh_token TEXT,
  id_token TEXT,
  access_token_expires_at INTEGER,
  refresh_token_expires_at INTEGER,
  scope TEXT,
  password TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS account_user_idx ON account (user_id);
CREATE TABLE IF NOT EXISTS verification (
  id TEXT PRIMARY KEY NOT NULL,
  identifier TEXT NOT NULL,
  value TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS verification_identifier_idx ON verification (identifier);
CREATE TABLE IF NOT EXISTS "rateLimit" (
  key TEXT PRIMARY KEY NOT NULL,
  count INTEGER NOT NULL,
  last_request INTEGER NOT NULL
);
`,
  },
  {
    id: "002_app_tables",
    sql: `
CREATE TABLE IF NOT EXISTS groups (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  picture_path TEXT,
  send_policy TEXT NOT NULL DEFAULT 'everyone',
  archived_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS group_members (
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member',
  joined_at INTEGER NOT NULL,
  PRIMARY KEY (group_id, user_id)
);
CREATE INDEX IF NOT EXISTS group_members_user_idx ON group_members (user_id);
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY NOT NULL,
  pair_key TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS conversation_participants (
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  joined_at INTEGER NOT NULL,
  PRIMARY KEY (conversation_id, user_id)
);
CREATE INDEX IF NOT EXISTS conv_participants_user_idx ON conversation_participants (user_id);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY NOT NULL,
  scope TEXT NOT NULL,
  group_id TEXT REFERENCES groups(id) ON DELETE CASCADE,
  conversation_id TEXT REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  type TEXT NOT NULL DEFAULT 'text',
  body TEXT,
  media_path TEXT,
  media_mime TEXT,
  media_size INTEGER,
  duration_ms INTEGER,
  reply_to_id TEXT,
  created_at INTEGER NOT NULL,
  edited_at INTEGER,
  deleted_at INTEGER
);
CREATE INDEX IF NOT EXISTS messages_group_idx ON messages (group_id, created_at);
CREATE INDEX IF NOT EXISTS messages_conv_idx ON messages (conversation_id, created_at);
CREATE INDEX IF NOT EXISTS messages_sender_idx ON messages (sender_id);
CREATE TABLE IF NOT EXISTS message_reads (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  scope TEXT NOT NULL,
  group_id TEXT,
  conversation_id TEXT,
  last_read_message_id TEXT,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS message_reads_uniq
  ON message_reads (user_id, scope, IFNULL(group_id,''), IFNULL(conversation_id,''));
CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  actor_id TEXT,
  title TEXT NOT NULL,
  body TEXT,
  link TEXT,
  read_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications (user_id, created_at);
CREATE INDEX IF NOT EXISTS notifications_unread_idx ON notifications (user_id, read_at);
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS push_subs_user_idx ON push_subscriptions (user_id);
CREATE TABLE IF NOT EXISTS user_notification_prefs (
  user_id TEXT PRIMARY KEY REFERENCES user(id) ON DELETE CASCADE,
  push_enabled INTEGER NOT NULL DEFAULT 1,
  inapp_enabled INTEGER NOT NULL DEFAULT 1,
  group_message_push INTEGER NOT NULL DEFAULT 0,
  reply_push INTEGER NOT NULL DEFAULT 1,
  dm_push INTEGER NOT NULL DEFAULT 1,
  announcement_push INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  reference TEXT NOT NULL UNIQUE,
  amount_kobo INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'NGN',
  status TEXT NOT NULL DEFAULT 'pending',
  channel TEXT,
  paystack_response TEXT,
  terms_version_at_purchase INTEGER,
  created_at INTEGER NOT NULL,
  verified_at INTEGER
);
CREATE INDEX IF NOT EXISTS payments_user_idx ON payments (user_id);
CREATE INDEX IF NOT EXISTS payments_status_idx ON payments (status);
CREATE TABLE IF NOT EXISTS announcements (
  id TEXT PRIMARY KEY NOT NULL,
  admin_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS dev_outbox (
  id TEXT PRIMARY KEY NOT NULL,
  to_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS uploads (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  path TEXT NOT NULL UNIQUE,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  kind TEXT NOT NULL DEFAULT 'message',
  group_id TEXT,
  conversation_id TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS uploads_owner_idx ON uploads (owner_id);
`,
  },
  {
    id: "003_email_broadcasts",
    sql: `
CREATE TABLE IF NOT EXISTS broadcasts (
  id TEXT PRIMARY KEY NOT NULL,
  admin_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  subject TEXT NOT NULL,
  html TEXT NOT NULL,
  text TEXT NOT NULL,
  total_sent INTEGER NOT NULL DEFAULT 0,
  send_failed INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS broadcasts_created_idx ON broadcasts (created_at);
CREATE TABLE IF NOT EXISTS email_deliveries (
  id TEXT PRIMARY KEY NOT NULL,
  broadcast_id TEXT REFERENCES broadcasts(id) ON DELETE CASCADE,
  resend_email_id TEXT,
  user_id TEXT,
  email TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  detail TEXT,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS email_deliveries_broadcast_idx ON email_deliveries (broadcast_id);
CREATE UNIQUE INDEX IF NOT EXISTS email_deliveries_resend_idx ON email_deliveries (resend_email_id);
`,
  },
  {
    id: "004_profile_and_join_policy",
    sql: `
ALTER TABLE user ADD COLUMN gender TEXT;
ALTER TABLE groups ADD COLUMN join_policy TEXT NOT NULL DEFAULT 'open';
CREATE TABLE IF NOT EXISTS group_join_requests (
  id TEXT PRIMARY KEY NOT NULL,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL,
  decided_at INTEGER,
  decided_by TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS group_join_requests_uniq ON group_join_requests (group_id, user_id);
CREATE INDEX IF NOT EXISTS group_join_requests_group_idx ON group_join_requests (group_id, status);
`,
  },
];

function runMigrations(): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY NOT NULL,
      applied_at INTEGER NOT NULL
    );
  `);
  const applied = new Set(
    sqlite
      .prepare("SELECT id FROM schema_migrations")
      .all()
      .map((r) => (r as { id: string }).id),
  );
  for (const m of migrations) {
    if (applied.has(m.id)) continue;
    const tx = sqlite.transaction(() => {
      sqlite.exec(m.sql);
      sqlite
        .prepare("INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)")
        .run(m.id, Date.now());
    });
    tx();
    console.log(`[db] applied migration ${m.id}`);
  }
}

runMigrations();

/* ------------------------------------------------------------------ */
/* Settings helpers                                                    */
/* ------------------------------------------------------------------ */

export function getSetting(key: string): string | null {
  const row = sqlite
    .prepare("SELECT value FROM settings WHERE key = ?")
    .get(key) as { value: string | null } | undefined;
  return row ? row.value : null;
}

export function setSetting(key: string, value: string | null): void {
  sqlite
    .prepare(
      `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
    .run(key, value, Date.now());
}

/** membership price in kobo (₦1 = 100 kobo) */
export function getMembershipPriceKobo(): number | null {
  const raw = getSetting("membership_price_kobo");
  if (raw === null || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export function getTerms(): { text: string; version: number } {
  return {
    text: getSetting("terms_text") || "",
    version: Number(getSetting("terms_version") || "1"),
  };
}
