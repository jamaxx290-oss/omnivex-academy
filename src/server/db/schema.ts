import { sqliteTable, text, integer, uniqueIndex, index } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

/* ------------------------------------------------------------------ */
/* Better Auth core tables                                             */
/*                                                                     */
/* Property names MUST match Better Auth's logical field names         */
/* (emailVerified, createdAt, ...). SQL column names are snake_case.   */
/* ------------------------------------------------------------------ */

const ts = (name: string) =>
  integer(name, { mode: "timestamp_ms" }).notNull();
const tsNull = (name: string) => integer(name, { mode: "timestamp_ms" });

export const user = sqliteTable(
  "user",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull().unique(),
    emailVerified: integer("email_verified", { mode: "boolean" })
      .notNull()
      .default(false),
    image: text("image"),
    createdAt: ts("created_at"),
    updatedAt: ts("updated_at"),
    // registration profile (Better Auth additionalFields)
    whatsapp_number: text("whatsapp_number"),
    country: text("country"),
    state_region: text("state_region"),
    gender: text("gender"),
    // application columns (not managed by Better Auth; DB defaults)
    is_admin: integer("is_admin", { mode: "boolean" }).notNull().default(false),
    membership_status: text("membership_status").notNull().default("none"),
    membership_expires_at: tsNull("membership_expires_at"),
    banned_at: tsNull("banned_at"),
  },
  (t) => [index("user_membership_idx").on(t.membership_status)],
);

export const session = sqliteTable(
  "session",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    token: text("token").notNull().unique(),
    expiresAt: ts("expires_at"),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: ts("created_at"),
    updatedAt: ts("updated_at"),
  },
  (t) => [index("session_user_idx").on(t.userId)],
);

export const account = sqliteTable(
  "account",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    providerId: text("provider_id").notNull(),
    accountId: text("account_id").notNull(),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: tsNull("access_token_expires_at"),
    refreshTokenExpiresAt: tsNull("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: ts("created_at"),
    updatedAt: ts("updated_at"),
  },
  (t) => [index("account_user_idx").on(t.userId)],
);

export const verification = sqliteTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: ts("expires_at"),
    createdAt: ts("created_at"),
    updatedAt: ts("updated_at"),
  },
  (t) => [index("verification_identifier_idx").on(t.identifier)],
);

export const rateLimit = sqliteTable("rateLimit", {
  key: text("key").primaryKey(),
  count: integer("count").notNull(),
  lastRequest: integer("last_request").notNull(),
});

export const authSchema = {
  user,
  session,
  account,
  verification,
  rateLimit,
};

/* ------------------------------------------------------------------ */
/* Application tables                                                  */
/* ------------------------------------------------------------------ */

export const groups = sqliteTable(
  "groups",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description"),
    picture_path: text("picture_path"),
    send_policy: text("send_policy").notNull().default("everyone"), // 'everyone' | 'admins_only'
    join_policy: text("join_policy").notNull().default("open"), // 'open' | 'request'
    archived_at: tsNull("archived_at"),
    created_at: ts("created_at"),
  },
  (t) => [index("groups_archived_idx").on(t.archived_at)],
);

export const groupMembers = sqliteTable(
  "group_members",
  {
    group_id: text("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    user_id: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("member"), // 'member' | 'admin'
    joined_at: ts("joined_at"),
  },
  (t) => [
    uniqueIndex("group_members_pk").on(t.group_id, t.user_id),
    index("group_members_user_idx").on(t.user_id),
  ],
);

export const groupJoinRequests = sqliteTable(
  "group_join_requests",
  {
    id: text("id").primaryKey(),
    group_id: text("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    user_id: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("pending"), // 'pending' | 'approved' | 'denied'
    created_at: ts("created_at"),
    decided_at: tsNull("decided_at"),
    decided_by: text("decided_by"),
  },
  (t) => [
    uniqueIndex("group_join_requests_uniq").on(t.group_id, t.user_id),
    index("group_join_requests_group_idx").on(t.group_id, t.status),
  ],
);

export const conversations = sqliteTable(
  "conversations",
  {
    id: text("id").primaryKey(),
    pair_key: text("pair_key").notNull().unique(), // sorted "id1:id2"
    created_at: ts("created_at"),
  },
);

export const conversationParticipants = sqliteTable(
  "conversation_participants",
  {
    conversation_id: text("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    user_id: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    joined_at: ts("joined_at"),
  },
  (t) => [
    uniqueIndex("conv_participants_pk").on(t.conversation_id, t.user_id),
    index("conv_participants_user_idx").on(t.user_id),
  ],
);

export const messages = sqliteTable(
  "messages",
  {
    id: text("id").primaryKey(),
    scope: text("scope").notNull(), // 'group' | 'dm'
    group_id: text("group_id").references(() => groups.id, {
      onDelete: "cascade",
    }),
    conversation_id: text("conversation_id").references(
      () => conversations.id,
      { onDelete: "cascade" },
    ),
    sender_id: text("sender_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    type: text("type").notNull().default("text"), // 'text' | 'image' | 'video' | 'audio'
    body: text("body"),
    media_path: text("media_path"),
    media_mime: text("media_mime"),
    media_size: integer("media_size"),
    duration_ms: integer("duration_ms"),
    reply_to_id: text("reply_to_id"),
    created_at: ts("created_at"),
    edited_at: tsNull("edited_at"),
    deleted_at: tsNull("deleted_at"),
  },
  (t) => [
    index("messages_group_idx").on(t.group_id, t.created_at),
    index("messages_conv_idx").on(t.conversation_id, t.created_at),
    index("messages_sender_idx").on(t.sender_id),
  ],
);

export const messageReads = sqliteTable(
  "message_reads",
  {
    id: text("id").primaryKey(),
    user_id: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    scope: text("scope").notNull(),
    group_id: text("group_id"),
    conversation_id: text("conversation_id"),
    last_read_message_id: text("last_read_message_id"),
    updated_at: ts("updated_at"),
  },
  (t) => [
    uniqueIndex("message_reads_uniq").on(
      t.user_id,
      t.scope,
      t.group_id,
      t.conversation_id,
    ),
  ],
);

export const notifications = sqliteTable(
  "notifications",
  {
    id: text("id").primaryKey(),
    user_id: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    type: text("type").notNull(), // 'reply' | 'dm' | 'group' | 'announcement' | 'system'
    actor_id: text("actor_id"),
    title: text("title").notNull(),
    body: text("body"),
    link: text("link"),
    read_at: tsNull("read_at"),
    created_at: ts("created_at"),
  },
  (t) => [
    index("notifications_user_idx").on(t.user_id, t.created_at),
    index("notifications_unread_idx").on(t.user_id, t.read_at),
  ],
);

export const pushSubscriptions = sqliteTable(
  "push_subscriptions",
  {
    id: text("id").primaryKey(),
    user_id: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    endpoint: text("endpoint").notNull().unique(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    created_at: ts("created_at"),
  },
  (t) => [index("push_subs_user_idx").on(t.user_id)],
);

export const notificationPrefs = sqliteTable("user_notification_prefs", {
  user_id: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  push_enabled: integer("push_enabled", { mode: "boolean" }).notNull().default(true),
  inapp_enabled: integer("inapp_enabled", { mode: "boolean" }).notNull().default(true),
  group_message_push: integer("group_message_push", { mode: "boolean" }).notNull().default(false),
  reply_push: integer("reply_push", { mode: "boolean" }).notNull().default(true),
  dm_push: integer("dm_push", { mode: "boolean" }).notNull().default(true),
  announcement_push: integer("announcement_push", { mode: "boolean" }).notNull().default(true),
  updated_at: ts("updated_at"),
});

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value"),
  updated_at: ts("updated_at"),
});

export const payments = sqliteTable(
  "payments",
  {
    id: text("id").primaryKey(),
    user_id: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    reference: text("reference").notNull().unique(),
    amount_kobo: integer("amount_kobo").notNull(),
    currency: text("currency").notNull().default("NGN"),
    status: text("status").notNull().default("pending"), // pending | success | failed
    channel: text("channel"),
    paystack_response: text("paystack_response"),
    terms_version_at_purchase: integer("terms_version_at_purchase"),
    created_at: ts("created_at"),
    verified_at: tsNull("verified_at"),
  },
  (t) => [
    index("payments_user_idx").on(t.user_id),
    index("payments_status_idx").on(t.status),
  ],
);

export const announcements = sqliteTable("announcements", {
  id: text("id").primaryKey(),
  admin_id: text("admin_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  body: text("body").notNull(),
  created_at: ts("created_at"),
});

export const broadcasts = sqliteTable("broadcasts", {
  id: text("id").primaryKey(),
  admin_id: text("admin_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  subject: text("subject").notNull(),
  html: text("html").notNull(),
  text: text("text").notNull(),
  total_sent: integer("total_sent").notNull().default(0),
  send_failed: integer("send_failed").notNull().default(0),
  created_at: ts("created_at"),
});

export const emailDeliveries = sqliteTable(
  "email_deliveries",
  {
    id: text("id").primaryKey(),
    broadcast_id: text("broadcast_id").references(() => broadcasts.id, {
      onDelete: "cascade",
    }),
    resend_email_id: text("resend_email_id"),
    user_id: text("user_id"),
    email: text("email").notNull(),
    status: text("status").notNull().default("queued"),
    detail: text("detail"),
    updated_at: ts("updated_at"),
  },
  (t) => [uniqueIndex("email_deliveries_resend_idx").on(t.resend_email_id)],
);

export const calls = sqliteTable(
  "calls",
  {
    id: text("id").primaryKey(),
    group_id: text("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    started_by: text("started_by")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    created_at: ts("created_at"),
    ended_at: tsNull("ended_at"),
  },
  (t) => [index("calls_group_idx").on(t.group_id, t.ended_at)],
);

export const devOutbox = sqliteTable("dev_outbox", {
  id: text("id").primaryKey(),
  to_email: text("to_email").notNull(),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  created_at: ts("created_at"),
});

export const uploads = sqliteTable(
  "uploads",
  {
    id: text("id").primaryKey(),
    owner_id: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    path: text("path").notNull().unique(),
    mime: text("mime").notNull(),
    size: integer("size").notNull(),
    original_name: text("original_name"), // filename as chosen by the uploader
    kind: text("kind").notNull().default("message"), // 'message' | 'avatar'
    group_id: text("group_id"),
    conversation_id: text("conversation_id"),
    created_at: ts("created_at"),
  },
  (t) => [index("uploads_owner_idx").on(t.owner_id)],
);
