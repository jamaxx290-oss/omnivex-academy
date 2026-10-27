/**
 * Omnivex Academy server integration suite.
 *
 * Boots the real Express app on an ephemeral port against a throwaway SQLite
 * database, then exercises the full product surface with real HTTP calls:
 * auth (sign-up → OTP → verify), membership gating, admin flows, group chat,
 * replies, read receipts, DMs, media ACL, notifications, and payments.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { io as ioClient, type Socket as ClientSocket } from "socket.io-client";

/* Environment must be set before any server module is imported. */
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ovx-test-"));
process.env.NODE_ENV = "test";
process.env.DATA_DIR = tmpDir;
process.env.BETTER_AUTH_SECRET = "test-secret-do-not-use-in-prod";
process.env.ADMIN_EMAIL = "admin@omnivex.test";
process.env.ADMIN_PASSWORD = "admin-pass-123";
process.env.MEMBERSHIP_PRICE_KOBO = "500000"; // ₦5,000
// Payment keys must never come from the developer machine: the suite asserts
// the unconfigured-payment behaviour deterministically.
delete process.env.PAYSTACK_SECRET_KEY;
delete process.env.PAYSTACK_PUBLIC_KEY;
// Same for Resend: with a live key the suite would attempt real sends instead
// of the deterministic dev_outbox capture the OTP tests rely on.
delete process.env.RESEND_API_KEY;
// Deterministic Resend webhook secret so the svix signature tests are exact.
process.env.RESEND_WEBHOOK_SECRET =
  "whsec_" + Buffer.from("omnivex-test-webhook-secret-32b!").toString("base64");

type Json = Record<string, unknown> | null;

const { createApp } = await import("../src/server/app");
const { bootstrapSettings, bootstrapAdmin } = await import("../src/server/bootstrap");
const { initRealtime, getIO } = await import("../src/server/realtime");

let server: Server;
let base = "";

/* ------------------------------------------------------------------ */
/* Tiny cookie-jar HTTP client                                         */
/* ------------------------------------------------------------------ */

class Client {
  cookies = new Map<string, string>();

  private header(): string {
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  }

  cookieHeader(): string {
    return this.header();
  }

  async req(
    route: string,
    opts: {
      method?: string;
      body?: unknown;
      raw?: BodyInit;
      headers?: Record<string, string>;
    } = {},
  ): Promise<{ status: number; data: Json }> {
    const hasBody = opts.raw !== undefined || opts.body !== undefined;
    const headers: Record<string, string> = {
      Origin: base,
      ...(this.cookies.size ? { Cookie: this.header() } : {}),
      ...(hasBody && opts.raw === undefined
        ? { "Content-Type": "application/json" }
        : {}),
      ...(opts.headers || {}),
    };
    const res = await fetch(base + route, {
      method: opts.method || "GET",
      headers,
      body: opts.raw ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
    });
    for (const c of res.headers.getSetCookie?.() || []) {
      const [pair] = c.split(";");
      const idx = pair.indexOf("=");
      if (idx > 0) {
        this.cookies.set(pair.slice(0, idx).trim(), pair.slice(idx + 1));
      }
    }
    const text = await res.text();
    let data: Json = null;
    if (text) {
      try {
        data = JSON.parse(text) as Json;
      } catch {
        data = null;
      }
    }
    return { status: res.status, data };
  }
}

const member = new Client();
const admin = new Client();

const memberEmail = "writer@omnivex.test";
let memberName = "";
let memberNameFromMe = "";
let groupId = "";
let callGroupId = "";
let memberId = "";
let conversationId = "";

async function otpFor(email: string): Promise<string> {
  const res = await member.req(`/api/dev/last-otp?email=${encodeURIComponent(email)}`);
  const otp = (res.data as { otp?: string } | null)?.otp;
  if (!otp) throw new Error(`No OTP found for ${email}: ${JSON.stringify(res.data)}`);
  return otp;
}

beforeAll(async () => {
  const app = createApp();
  bootstrapSettings();
  await bootstrapAdmin();
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  const addr = server.address();
  if (typeof addr === "object" && addr) base = `http://127.0.0.1:${addr.port}`;
  initRealtime(server);
});

afterAll(async () => {
  try {
    getIO()?.close();
  } catch {
    /* best effort */
  }
  await new Promise<void>((resolve) => server?.close(() => resolve()));
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
});

/* ------------------------------------------------------------------ */
/* Auth                                                                */
/* ------------------------------------------------------------------ */

describe("auth & verification", () => {
  it("serves health and bootstrap", async () => {
    const health = await member.req("/api/health");
    expect(health.status).toBe(200);
    const boot = await member.req("/api/bootstrap");
    expect(boot.status).toBe(200);
    expect((boot.data as { user: unknown }).user).toBeNull();
  });

  it("registers a member and delivers a 6-digit OTP", async () => {
    const res = await member.req("/api/auth/sign-up/email", {
      method: "POST",
      body: {
        name: "Amaka Writer",
        email: memberEmail,
        password: "member-pass-123",
        whatsapp_number: "+2348011112222",
        country: "Nigeria",
        state_region: "Lagos",
        gender: "female",
      },
    });
    expect(res.status).toBe(200);
    const otp = await otpFor(memberEmail);
    expect(otp).toMatch(/^\d{6}$/);
  });

  it("rejects sign-up when required profile details are missing", async () => {
    const res = await member.req("/api/auth/sign-up/email", {
      method: "POST",
      body: {
        name: "No Details",
        email: "nodetails@omnivex.test",
        password: "password123",
      },
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it("verifies the OTP and establishes a session", async () => {
    const otp = await otpFor(memberEmail);
    const res = await member.req("/api/auth/email-otp/verify-email", {
      method: "POST",
      body: { email: memberEmail, otp },
    });
    expect(res.status).toBe(200);
    expect(member.cookies.has("better-auth.session_token")).toBe(true);

    const me = await member.req("/api/me");
    const user = (me.data as { user: Record<string, unknown> }).user;
    expect(user.email).toBe(memberEmail);
    expect(user.emailVerified).toBe(true);
    expect(user.membershipStatus).toBe("none");
    memberNameFromMe = String(user.name);
  });

  it("rejects a wrong OTP", async () => {
    const res = await member.req("/api/auth/email-otp/verify-email", {
      method: "POST",
      body: { email: memberEmail, otp: "000000" },
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it("signs the admin in with password", async () => {
    const res = await admin.req("/api/auth/sign-in/email", {
      method: "POST",
      body: { email: "admin@omnivex.test", password: "admin-pass-123" },
    });
    expect(res.status).toBe(200);
    const me = await admin.req("/api/me");
    const user = (me.data as { user: Record<string, unknown> }).user;
    expect(user.isAdmin).toBe(true);
    expect(user.membershipStatus).toBe("active");
    memberName = String(user.name);
    expect(memberName).toBeTruthy();
  });

  it("rejects a wrong password", async () => {
    const bad = new Client();
    const res = await bad.req("/api/auth/sign-in/email", {
      method: "POST",
      body: { email: "admin@omnivex.test", password: "nope" },
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});

/* ------------------------------------------------------------------ */
/* Gating                                                              */
/* ------------------------------------------------------------------ */

describe("membership gating", () => {
  it("blocks groups for verified users without membership", async () => {
    const res = await member.req("/api/groups");
    expect(res.status).toBe(403);
    expect((res.data as { code?: string }).code).toBe("MEMBERSHIP_REQUIRED");
  });

  it("exposes public settings with the configured price", async () => {
    const res = await member.req("/api/settings");
    expect(res.status).toBe(200);
    const s = res.data as { priceKobo: number; currency: string };
    expect(s.priceKobo).toBe(500000);
    expect(s.currency).toBe("NGN");
  });

  it("reports Paystack as unconfigured and refuses checkout", async () => {
    const status = await member.req("/api/payments/status");
    expect(status.status).toBe(200);
    expect((status.data as { configured: boolean }).configured).toBe(false);

    const terms = await member.req("/api/payments/terms");
    expect(terms.status).toBe(200);
    const version = (terms.data as { version: number }).version;

    const init = await member.req("/api/payments/initialize", {
      method: "POST",
      body: { termsVersion: version },
    });
    expect(init.status).toBeGreaterThanOrEqual(400);
    expect((init.data as { code?: string }).code).toBe("PAYSTACK_NOT_CONFIGURED");
  });

  it("refuses checkout until the current terms are accepted", async () => {
    const terms = await member.req("/api/payments/terms");
    const version = (terms.data as { version: number }).version;

    const missing = await member.req("/api/payments/initialize", { method: "POST" });
    expect(missing.status).toBe(400);
    expect((missing.data as { code?: string }).code).toBe("TERMS_REQUIRED");

    const stale = await member.req("/api/payments/initialize", {
      method: "POST",
      body: { termsVersion: version + 1 },
    });
    expect(stale.status).toBe(400);
    expect((stale.data as { code?: string }).code).toBe("TERMS_REQUIRED");
  });

  it("rejects an unsigned webhook", async () => {
    const res = await member.req("/api/payments/webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      raw: JSON.stringify({ event: "charge.success", data: { reference: "x" } }),
    });
    expect(res.status).toBe(401);
  });

  it("keeps admin APIs away from members", async () => {
    const res = await member.req("/api/admin/stats");
    expect(res.status).toBe(403);
    expect((res.data as { code?: string }).code).toBe("FORBIDDEN");
  });
});

/* ------------------------------------------------------------------ */
/* Admin flows                                                         */
/* ------------------------------------------------------------------ */

describe("admin flows", () => {
  it("returns dashboard stats", async () => {
    const res = await admin.req("/api/admin/stats");
    expect(res.status).toBe(200);
    const s = res.data as { totalMembers: number; paystackConfigured: boolean };
    expect(s.totalMembers).toBeGreaterThanOrEqual(2);
    expect(s.paystackConfigured).toBe(false);
  });

  it("lists and searches members", async () => {
    const res = await admin.req(`/api/admin/members?q=${encodeURIComponent(memberEmail)}`);
    expect(res.status).toBe(200);
    const rows = (res.data as { members: { email: string }[] }).members;
    expect(rows.some((m) => m.email === memberEmail)).toBe(true);
  });

  it("activates the member's membership", async () => {
    const dir = await admin.req(`/api/admin/members?q=${encodeURIComponent(memberEmail)}`);
    const target = (dir.data as { members: { id: string }[] }).members[0];
    expect(target).toBeTruthy();
    memberId = target!.id;
    const res = await admin.req(`/api/admin/members/${memberId}/action`, {
      method: "POST",
      body: { action: "grant_membership" },
    });
    expect(res.status).toBe(200);
  });

  it("creates a group with the member inside", async () => {
    const created = await admin.req("/api/admin/groups", {
      method: "POST",
      body: {
        name: "Launch Lab",
        description: "Weekly launch reviews",
        sendPolicy: "everyone",
        memberIds: [memberId],
      },
    });
    expect(created.status).toBe(201);
    groupId = String((created.data as { id: string }).id);
    expect(groupId).toBeTruthy();

    const detail = await admin.req(`/api/groups/${groupId}`);
    expect(detail.status).toBe(200);
    const members = (detail.data as { members: { id: string }[] }).members;
    expect(members.some((m) => m.id === memberId)).toBe(true);
  });

  it("updates pricing through admin settings", async () => {
    const res = await admin.req("/api/admin/settings", {
      method: "PUT",
      body: { priceNaira: 7500 },
    });
    expect(res.status).toBe(200);
    expect((res.data as { priceKobo: number }).priceKobo).toBe(750000);

    const pub = await admin.req("/api/settings");
    expect((pub.data as { priceKobo: number }).priceKobo).toBe(750000);
  });

  it("publishes an announcement to members", async () => {
    const res = await admin.req("/api/admin/announcements", {
      method: "POST",
      body: { title: "Live session Friday", body: "AMS ads review at 7pm WAT." },
    });
    expect(res.status).toBe(201);
    expect((res.data as { delivered: number }).delivered).toBeGreaterThanOrEqual(1);
  });
});

/* ------------------------------------------------------------------ */
/* Group chat                                                          */
/* ------------------------------------------------------------------ */

describe("group chat", () => {
  it("lets the active member into the group", async () => {
    const res = await member.req("/api/groups");
    expect(res.status).toBe(200);
    const groups = (res.data as { groups: { id: string; name: string }[] }).groups;
    expect(groups.some((g) => g.id === groupId)).toBe(true);
  });

  it("sends a text message", async () => {
    const res = await member.req(`/api/groups/${groupId}/messages`, {
      method: "POST",
      body: { type: "text", body: "My cover B hit 4.8% CTR 🎉" },
    });
    expect(res.status).toBe(201);
    const msg = (res.data as { message: { id: string; body: string } }).message;
    expect(msg.body).toContain("4.8%");
  });

  it("rejects an empty message", async () => {
    const res = await member.req(`/api/groups/${groupId}/messages`, {
      method: "POST",
      body: { type: "text", body: "   " },
    });
    expect(res.status).toBe(400);
  });

  it("replies to a message and notifies the sender", async () => {
    const history = await member.req(`/api/groups/${groupId}/messages?limit=10`);
    const first = (history.data as { messages: { id: string }[] }).messages.at(-1)!;

    const res = await admin.req(`/api/groups/${groupId}/messages`, {
      method: "POST",
      body: { type: "text", body: "Brilliant — test the A variant next", replyToId: first.id },
    });
    expect(res.status).toBe(201);
    const sent = (res.data as { message: { replyTo: { id: string } | null } }).message;
    expect(sent.replyTo?.id).toBe(first.id);

    const notes = await member.req("/api/notifications");
    expect(notes.status).toBe(200);
    const items = (notes.data as { notifications: { type: string }[] }).notifications;
    expect(items.some((n) => n.type === "reply")).toBe(true);
  });

  it("tracks unread counts and read receipts", async () => {
    const list = await member.req("/api/groups");
    const g = (list.data as { groups: { id: string; unread: number }[] }).groups.find(
      (x) => x.id === groupId,
    )!;
    expect(g.unread).toBeGreaterThan(0);

    const read = await member.req(`/api/groups/${groupId}/read`, { method: "POST" });
    expect(read.status).toBe(200);

    const after = await member.req("/api/groups");
    const g2 = (after.data as { groups: { id: string; unread: number }[] }).groups.find(
      (x) => x.id === groupId,
    )!;
    expect(g2.unread).toBe(0);
  });

  it("fetches a single message for reply jumps", async () => {
    const history = await member.req(`/api/groups/${groupId}/messages?limit=5`);
    const target = (history.data as { messages: { id: string }[] }).messages[0];
    const res = await member.req(`/api/messages/${target.id}`);
    expect(res.status).toBe(200);
    expect((res.data as { message: { id: string } }).message.id).toBe(target.id);
  });

  it("surfaces announcements to members", async () => {
    const res = await member.req("/api/announcements");
    expect(res.status).toBe(200);
    const items = (res.data as { announcements: { title: string }[] }).announcements;
    expect(items.some((a) => a.title === "Live session Friday")).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* Direct messages                                                     */
/* ------------------------------------------------------------------ */

describe("direct messages", () => {
  it("creates a conversation and exchanges messages", async () => {
    const dir = await member.req("/api/members?q=Academy");
    const adminRow = (dir.data as { members: { id: string; name: string }[] }).members.find(
      (m) => m.name.includes("Academy"),
    );
    expect(adminRow).toBeTruthy();

    const created = await member.req("/api/dm/conversations", {
      method: "POST",
      body: { userId: adminRow!.id },
    });
    expect(created.status).toBe(201);
    conversationId = String((created.data as { id: string }).id);

    const sent = await member.req(`/api/dm/${conversationId}/messages`, {
      method: "POST",
      body: { type: "text", body: "Hi mentor, quick question about ads." },
    });
    expect(sent.status).toBe(201);

    const list = await member.req("/api/dm/conversations");
    const convs = (list.data as { conversations: { id: string; unread: number }[] })
      .conversations;
    expect(convs.some((c) => c.id === conversationId)).toBe(true);
  });

  it("delivers the DM to the admin with an unread badge", async () => {
    const list = await admin.req("/api/dm/conversations");
    const conv = (list.data as { conversations: { id: string; unread: number }[] })
      .conversations.find((c) => c.id === conversationId)!;
    expect(conv).toBeTruthy();
    expect(conv.unread).toBeGreaterThan(0);

    const replied = await admin.req(`/api/dm/${conversationId}/messages`, {
      method: "POST",
      body: { type: "text", body: "Ask away — that's what I'm here for." },
    });
    expect(replied.status).toBe(201);
  });

  it("records the DM read for the member", async () => {
    const read = await member.req(`/api/dm/${conversationId}/read`, { method: "POST" });
    expect(read.status).toBe(200);
    const notes = await member.req("/api/notifications");
    const items = (notes.data as { notifications: { type: string }[] }).notifications;
    expect(items.some((n) => n.type === "dm")).toBe(true);

    const all = await member.req("/api/notifications/read-all", { method: "POST" });
    expect(all.status).toBe(200);
    const after = await member.req("/api/notifications");
    expect((after.data as { unread: number }).unread).toBe(0);
  });

  it("starts a conversation idempotently", async () => {
    const dir = await member.req("/api/members?q=Academy");
    const adminRow = (dir.data as { members: { id: string }[] }).members[0];
    const again = await member.req("/api/dm/conversations", {
      method: "POST",
      body: { userId: adminRow.id },
    });
    expect(again.status).toBe(201);
    expect((again.data as { id: string }).id).toBe(conversationId);
  });

  it("honours notification preferences", async () => {
    const prefs = await member.req("/api/notifications/prefs");
    expect(prefs.status).toBe(200);
    const set = await member.req("/api/notifications/prefs", {
      method: "PUT",
      body: { group_message_push: false },
    });
    expect(set.status).toBe(200);
    const after = await member.req("/api/notifications/prefs");
    expect((after.data as { prefs: { group_message_push: boolean } }).prefs.group_message_push).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* Media                                                               */
/* ------------------------------------------------------------------ */

describe("media uploads", () => {
  let mediaPath = "";
  let pdfPath = "";

  it("uploads an image and serves it to the owner", async () => {
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    );
    const fd = new FormData();
    fd.append("file", new Blob([png], { type: "image/png" }), "cover.png");
    fd.append("group_id", groupId);

    const res = await member.req("/api/uploads", { method: "POST", raw: fd });
    expect(res.status).toBe(201);
    mediaPath = String((res.data as { path: string }).path);
    expect(mediaPath).toMatch(/^\d{4}\/\d{2}\//);

    const fetchRes = await fetch(`${base}/media/${mediaPath}`, {
      headers: { Cookie: [...member.cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ") },
    });
    expect(fetchRes.status).toBe(200);
    expect(fetchRes.headers.get("content-type")).toContain("image/png");
  });

  it("refuses anonymous media access", async () => {
    const res = await fetch(`${base}/media/${mediaPath}`);
    expect(res.status).toBe(401);
  });

  it("allows admins to access group media", async () => {
    const res = await fetch(`${base}/media/${mediaPath}`, {
      headers: { Cookie: [...admin.cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ") },
    });
    expect(res.status).toBe(200);
  });

  it("rejects unsupported file types", async () => {
    const fd = new FormData();
    fd.append("file", new Blob(["MZ"], { type: "application/x-msdownload" }), "evil.exe");
    const res = await member.req("/api/uploads", { method: "POST", raw: fd });
    expect(res.status).toBe(400);
  });

  it("sends the uploaded image as a chat message", async () => {
    const res = await member.req(`/api/groups/${groupId}/messages`, {
      method: "POST",
      body: { type: "image", mediaPath },
    });
    expect(res.status).toBe(201);
    const msg = (res.data as { message: { type: string; mediaUrl: string } }).message;
    expect(msg.type).toBe("image");
    expect(msg.mediaUrl).toContain("/media/");
  });

  it("uploads a PDF and serves it as a download, never inline", async () => {
    const fd = new FormData();
    fd.append(
      "file",
      new Blob([Buffer.from("%PDF-1.4\n% omnivex")], { type: "application/pdf" }),
      "kdp-checklist.pdf",
    );
    fd.append("group_id", groupId);

    const res = await member.req("/api/uploads", { method: "POST", raw: fd });
    expect(res.status).toBe(201);
    pdfPath = String((res.data as { path: string }).path);
    expect((res.data as { name: string }).name).toBe("kdp-checklist.pdf");

    const dl = await fetch(`${base}/media/${pdfPath}`, {
      headers: { Cookie: [...member.cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ") },
    });
    expect(dl.status).toBe(200);
    expect(dl.headers.get("content-type")).toContain("application/pdf");
    expect(dl.headers.get("content-disposition")).toBe(
      'attachment; filename="kdp-checklist.pdf"',
    );
    expect(dl.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("accepts DOCX and other document formats", async () => {
    const fd = new FormData();
    fd.append(
      "file",
      new Blob([Buffer.from("PK\x03\x04 docx-bytes")], {
        type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      }),
      "chapter-one.docx",
    );
    fd.append("group_id", groupId);
    const docx = await member.req("/api/uploads", { method: "POST", raw: fd });
    expect(docx.status).toBe(201);
    expect(String((docx.data as { mime: string }).mime)).toContain("wordprocessingml");
    expect(String((docx.data as { name: string }).name)).toBe("chapter-one.docx");

    const csv = new FormData();
    csv.append("file", new Blob([Buffer.from("title,rank\n")], { type: "text/csv" }), "ranks.csv");
    csv.append("group_id", groupId);
    const csvRes = await member.req("/api/uploads", { method: "POST", raw: csv });
    expect(csvRes.status).toBe(201);
    expect((csvRes.data as { mime: string }).mime).toBe("text/csv");
  });

  it("sends a document as a file message carrying its filename", async () => {
    const res = await member.req(`/api/groups/${groupId}/messages`, {
      method: "POST",
      body: { type: "file", mediaPath: pdfPath },
    });
    expect(res.status).toBe(201);
    const msg = (res.data as {
      message: { type: string; fileName: string | null; mediaUrl: string | null };
    }).message;
    expect(msg.type).toBe("file");
    expect(msg.fileName).toBe("kdp-checklist.pdf");
    expect(msg.mediaUrl).toContain("/media/");
  });

  it("rejects media uploaded for another target", async () => {
    const res = await member.req(`/api/dm/${conversationId}/messages`, {
      method: "POST",
      body: { type: "image", mediaPath },
    });
    expect(res.status).toBe(400);
  });
});

/* ------------------------------------------------------------------ */
/* Email broadcasts + Resend webhook                                   */
/* ------------------------------------------------------------------ */

describe("email broadcasts & webhooks", () => {
  let broadcastId = "";

  it("exposes Resend sender config and webhook URLs to admins", async () => {
    const res = await admin.req("/api/admin/settings");
    expect(res.status).toBe(200);
    const s = res.data as {
      emailProvider: string;
      senderName: string;
      senderEmail: string;
      resendConfigured: boolean;
      resendWebhookConfigured: boolean;
      webhooks: { resend: string; paystack: string };
    };
    expect(s.emailProvider).toBe("resend");
    expect(s.senderName).toBe("Omnivex Academy");
    expect(s.senderEmail).toBe("hello@omnivex.manuskripta.xyz");
    expect(s.resendConfigured).toBe(false); // no key in the test env
    expect(s.resendWebhookConfigured).toBe(true);
    expect(s.webhooks.resend.endsWith("/api/webhooks/resend")).toBe(true);
    expect(s.webhooks.paystack.endsWith("/api/payments/webhook")).toBe(true);
  });

  it("sends a broadcast in dev mode and records deliveries", async () => {
    const res = await admin.req("/api/admin/broadcast", {
      method: "POST",
      body: {
        subject: "Friday live session",
        html: '<p style="color:#4b5266;">AMS ads review at 7pm WAT.</p>',
      },
    });
    expect(res.status).toBe(201);
    const body = res.data as { id: string; sent: number; mode: string };
    expect(body.mode).toBe("dev");
    expect(body.sent).toBeGreaterThanOrEqual(2); // admin + member
    broadcastId = body.id;

    // Dev mode captures the branded email for every recipient.
    const { sqlite } = await import("../src/server/db");
    const rows = sqlite
      .prepare("SELECT to_email, subject FROM dev_outbox WHERE subject = ?")
      .all("Friday live session") as { to_email: string }[];
    expect(rows.length).toBe(body.sent);
    expect(rows.some((r) => r.to_email === memberEmail)).toBe(true);
  });

  it("lists the broadcast with per-recipient status", async () => {
    const list = await admin.req("/api/admin/broadcasts");
    expect(list.status).toBe(200);
    const items = (list.data as { broadcasts: { id: string; subject: string; totalSent: number }[] })
      .broadcasts;
    const row = items.find((b) => b.id === broadcastId)!;
    expect(row.subject).toBe("Friday live session");
    expect(row.totalSent).toBeGreaterThanOrEqual(2);

    const detail = await admin.req(`/api/admin/broadcasts/${broadcastId}`);
    expect(detail.status).toBe(200);
    const deliveries = (detail.data as {
      deliveries: { email: string; status: string }[];
    }).deliveries;
    expect(deliveries.length).toBe(row.totalSent);
    expect(deliveries.every((d) => d.status === "sent")).toBe(true);
    expect(deliveries.some((d) => d.email === memberEmail)).toBe(true);
  });

  it("sends a marked [TEST] broadcast to one address", async () => {
    const res = await admin.req("/api/admin/broadcast", {
      method: "POST",
      body: {
        subject: "Layout check",
        html: "<p>Preview body</p>",
        testEmail: "qa@omnivex.test",
      },
    });
    expect(res.status).toBe(201);
    const body = res.data as { sent: number };
    expect(body.sent).toBe(1);

    const { sqlite } = await import("../src/server/db");
    const row = sqlite
      .prepare("SELECT subject FROM dev_outbox WHERE to_email = ? ORDER BY created_at DESC LIMIT 1")
      .get("qa@omnivex.test") as { subject: string } | undefined;
    expect(row?.subject).toContain("[TEST] Layout check");
  });

  it("records a signed Resend webhook and updates delivery status", async () => {
    const { sqlite } = await import("../src/server/db");
    const delivery = sqlite
      .prepare(
        "SELECT resend_email_id FROM email_deliveries WHERE broadcast_id = ? AND resend_email_id IS NOT NULL LIMIT 1",
      )
      .get(broadcastId) as { resend_email_id: string } | undefined;
    expect(delivery).toBeTruthy();

    const payload = JSON.stringify({
      type: "email.delivered",
      created_at: new Date().toISOString(),
      data: {
        email_id: delivery!.resend_email_id,
        to: [memberEmail],
        subject: "Friday live session",
      },
    });
    const id = "msg_test_123";
    const ts = Math.floor(Date.now() / 1000);
    const secret = process.env.RESEND_WEBHOOK_SECRET!;
    const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
    const signature = crypto
      .createHmac("sha256", key)
      .update(`${id}.${ts}.${payload}`)
      .digest("base64");

    const res = await admin.req("/api/webhooks/resend", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "svix-id": id,
        "svix-timestamp": String(ts),
        "svix-signature": `v1,${signature}`,
      },
      raw: payload,
    });
    expect(res.status).toBe(200);

    const after = sqlite
      .prepare("SELECT status FROM email_deliveries WHERE resend_email_id = ?")
      .get(delivery!.resend_email_id) as { status: string };
    expect(after.status).toBe("delivered");

    const history = await admin.req("/api/admin/broadcasts");
    const row = (history.data as { broadcasts: { id: string; delivered: number }[] })
      .broadcasts.find((b) => b.id === broadcastId)!;
    expect(row.delivered).toBeGreaterThanOrEqual(1);
  });

  it("rejects webhooks with a bad signature or missing headers", async () => {
    const payload = JSON.stringify({ type: "email.delivered", data: { email_id: "x" } });
    const ts = Math.floor(Date.now() / 1000);

    const bad = await admin.req("/api/webhooks/resend", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "svix-id": "msg_bad",
        "svix-timestamp": String(ts),
        "svix-signature": "v1,not-a-real-signature",
      },
      raw: payload,
    });
    expect(bad.status).toBe(401);

    const missing = await admin.req("/api/webhooks/resend", {
      method: "POST",
      raw: payload,
    });
    expect(missing.status).toBe(400);

    const stale = await admin.req("/api/webhooks/resend", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "svix-id": "msg_stale",
        "svix-timestamp": String(ts - 3600),
        "svix-signature": "v1,whatever",
      },
      raw: payload,
    });
    expect(stale.status).toBe(401);
  });

  it("lists recent email activity for the admin", async () => {
    const res = await admin.req("/api/admin/email/activity");
    expect(res.status).toBe(200);
    const a = res.data as {
      configured: boolean;
      sender: string;
      activity: { email: string; status: string }[];
    };
    expect(a.configured).toBe(false);
    expect(a.sender).toBe("Omnivex Academy <hello@omnivex.manuskripta.xyz>");
    expect(a.activity.length).toBeGreaterThan(0);
  });

  it("keeps member-facing APIs admin-only for broadcasts", async () => {
    const res = await member.req("/api/admin/broadcast", {
      method: "POST",
      body: { subject: "x", html: "<p>y</p>" },
    });
    expect(res.status).toBe(403);
  });
});

/* ------------------------------------------------------------------ */
/* Profile & moderation                                                */
/* ------------------------------------------------------------------ */

describe("profile & moderation", () => {
  it("updates profile fields through better-auth", async () => {
    const res = await member.req("/api/auth/update-user", {
      method: "POST",
      body: {
        name: memberNameFromMe,
        whatsapp_number: "+2348012345678",
        country: "Nigeria",
        state_region: "Lagos",
        gender: "female",
      },
    });
    expect(res.status).toBe(200);
    const me = await member.req("/api/me");
    const u = (me.data as { user: Record<string, unknown> }).user;
    expect(u.whatsappNumber).toBe("+2348012345678");
    expect(u.stateRegion).toBe("Lagos");
    expect(u.gender).toBe("female");
  });

  it("refuses to clear a required profile detail", async () => {
    const res = await member.req("/api/auth/update-user", {
      method: "POST",
      body: { whatsapp_number: "" },
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    const me = await member.req("/api/me");
    const u = (me.data as { user: Record<string, unknown> }).user;
    expect(u.whatsappNumber).toBe("+2348012345678");
  });

  it("changes the member password and revokes other sessions", async () => {
    const res = await member.req("/api/me/password", {
      method: "POST",
      body: { currentPassword: "member-pass-123", newPassword: "member-pass-456" },
    });
    expect(res.status).toBe(200);

    const relogin = new Client();
    const ok = await relogin.req("/api/auth/sign-in/email", {
      method: "POST",
      body: { email: memberEmail, password: "member-pass-456" },
    });
    expect(ok.status).toBe(200);
    // adopt the fresh session for later tests
    member.cookies = relogin.cookies;
  });

  it("bans and unbans the member", async () => {
    const dir = await admin.req(`/api/admin/members?q=${encodeURIComponent(memberEmail)}`);
    const target = (dir.data as { members: { id: string }[] }).members[0];

    const ban = await admin.req(`/api/admin/members/${target.id}/action`, {
      method: "POST",
      body: { action: "ban" },
    });
    expect(ban.status).toBe(200);

    // Banning revokes every live session immediately.
    const blocked = await member.req("/api/groups");
    expect([401, 403]).toContain(blocked.status);

    const unban = await admin.req(`/api/admin/members/${target.id}/action`, {
      method: "POST",
      body: { action: "unban" },
    });
    expect(unban.status).toBe(200);

    // The credential account survives the ban, so the member signs back in.
    const relogin = new Client();
    const ok = await relogin.req("/api/auth/sign-in/email", {
      method: "POST",
      body: { email: memberEmail, password: "member-pass-456" },
    });
    expect(ok.status).toBe(200);
    member.cookies = relogin.cookies;

    const restored = await member.req("/api/groups");
    expect(restored.status).toBe(200);
  });

  it("revokes and re-grants membership", async () => {
    const dir = await admin.req(`/api/admin/members?q=${encodeURIComponent(memberEmail)}`);
    const target = (dir.data as { members: { id: string }[] }).members[0];

    await admin.req(`/api/admin/members/${target.id}/action`, {
      method: "POST",
      body: { action: "revoke_membership" },
    });
    const blocked = await member.req("/api/groups");
    expect(blocked.status).toBe(403);

    await admin.req(`/api/admin/members/${target.id}/action`, {
      method: "POST",
      body: { action: "grant_membership" },
    });
    const restored = await member.req("/api/groups");
    expect(restored.status).toBe(200);
  });

  it("archives the group", async () => {
    const res = await admin.req(`/api/admin/groups/${groupId}`, { method: "DELETE" });
    expect(res.status).toBe(200);
    const list = await member.req("/api/groups");
    const groups = (list.data as { groups: { id: string }[] }).groups;
    expect(groups.some((g) => g.id === groupId)).toBe(false);
  });

  it("signs members out", async () => {
    const res = await member.req("/api/auth/sign-out", { method: "POST" });
    expect(res.status).toBe(200);
    const me = await member.req("/api/me");
    expect((me.data as { user: unknown }).user).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* Group join policy (open vs request)                                 */
/* ------------------------------------------------------------------ */

describe("group join policy", () => {
  let requestGroupId = "";
  let openGroupId = "";

  beforeAll(async () => {
    // member signs back in (password was changed earlier)
    const login = new Client();
    await login.req("/api/auth/sign-in/email", {
      method: "POST",
      body: { email: memberEmail, password: "member-pass-456" },
    });
    member.cookies = login.cookies;
  });

  it("creates a request-to-join group without the member", async () => {
    const created = await admin.req("/api/admin/groups", {
      method: "POST",
      body: { name: "Cover Clinic", joinPolicy: "request" },
    });
    expect(created.status).toBe(201);
    requestGroupId = String((created.data as { id: string }).id);
  });

  it("shows the group to a non-member but hides contents", async () => {
    const list = await member.req("/api/groups");
    expect(list.status).toBe(200);
    const g = (list.data as { groups: Record<string, unknown>[] }).groups.find(
      (x) => x.id === requestGroupId,
    );
    expect(g).toBeTruthy();
    expect(g!.isMember).toBe(false);
    expect(g!.joinPolicy).toBe("request");
    expect(g!.lastMessage).toBeNull();

    const detail = await member.req(`/api/groups/${requestGroupId}`);
    expect(detail.status).toBe(200);
    const d = detail.data as { isMember: boolean; members: unknown[]; canSend: boolean };
    expect(d.isMember).toBe(false);
    expect(d.members).toEqual([]);
    expect(d.canSend).toBe(false);

    // contents are gated
    const msgs = await member.req(`/api/groups/${requestGroupId}/messages`);
    expect(msgs.status).toBe(403);
    const send = await member.req(`/api/groups/${requestGroupId}/messages`, {
      method: "POST",
      body: { type: "text", body: "let me in" },
    });
    expect(send.status).toBe(403);
  });

  it("requests to join and records a pending request", async () => {
    const join = await member.req(`/api/groups/${requestGroupId}/join`, { method: "POST" });
    expect(join.status).toBe(201);
    expect((join.data as { status: string }).status).toBe("pending");

    const list = await member.req("/api/groups");
    const g = (list.data as { groups: Record<string, unknown>[] }).groups.find(
      (x) => x.id === requestGroupId,
    );
    expect(g!.joinRequest).toBe("pending");
  });

  it("lists the pending request for admins", async () => {
    const res = await admin.req(`/api/admin/groups/${requestGroupId}/requests`);
    expect(res.status).toBe(200);
    const reqs = (res.data as { requests: { status: string; userEmail: string }[] }).requests;
    expect(reqs.some((r) => r.status === "pending" && r.userEmail === memberEmail)).toBe(true);
  });

  it("approves the request and grants access", async () => {
    const dir = await admin.req(`/api/admin/members?q=${encodeURIComponent(memberEmail)}`);
    const target = (dir.data as { members: { id: string }[] }).members[0];

    const decide = await admin.req(`/api/admin/groups/${requestGroupId}/requests`, {
      method: "POST",
      body: { userId: target.id, action: "approve" },
    });
    expect(decide.status).toBe(200);

    const detail = await member.req(`/api/groups/${requestGroupId}`);
    const d = detail.data as { isMember: boolean; members: unknown[] };
    expect(d.isMember).toBe(true);
    expect(d.members.length).toBeGreaterThan(0);

    const msgs = await member.req(`/api/groups/${requestGroupId}/messages`);
    expect(msgs.status).toBe(200);
  });

  it("lets an open group be joined instantly", async () => {
    const created = await admin.req("/api/admin/groups", {
      method: "POST",
      body: { name: "AMS Ads", joinPolicy: "open" },
    });
    openGroupId = String((created.data as { id: string }).id);

    const join = await member.req(`/api/groups/${openGroupId}/join`, { method: "POST" });
    expect(join.status).toBe(201);
    expect((join.data as { status: string }).status).toBe("member");

    const msgs = await member.req(`/api/groups/${openGroupId}/messages`);
    expect(msgs.status).toBe(200);
  });

  it("lets a member leave a group", async () => {
    const leave = await member.req(`/api/groups/${openGroupId}/leave`, { method: "POST" });
    expect(leave.status).toBe(200);
    const detail = await member.req(`/api/groups/${openGroupId}`);
    expect((detail.data as { isMember: boolean }).isMember).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* Group calls                                                         */
/* ------------------------------------------------------------------ */

type CallSnap = {
  id: string;
  groupId: string;
  startedBy: string;
  startedByName: string | null;
  participants: {
    userId: string;
    name: string;
    selfMuted: boolean;
    adminMuted: boolean;
    handRaised: boolean;
    publishing: boolean;
  }[];
};

function connectSocket(c: Client): ClientSocket {
  const s = ioClient(base, {
    path: "/socket.io",
    // Note: no withCredentials — in Node it drops extraHeaders on the WS upgrade.
    extraHeaders: { Cookie: c.cookieHeader(), Origin: base },
    transports: ["websocket"],
  });
  s.on("connect_error", (err: Error) => {
    console.error("[test-socket] connect_error:", err.message);
  });
  return s;
}

function waitForEvent<T = Record<string, unknown>>(
  s: ClientSocket,
  event: string,
  timeout = 4000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const handler = (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    };
    const timer = setTimeout(() => {
      s.off(event, handler);
      reject(new Error(`timeout waiting for ${event}`));
    }, timeout);
    s.on(event, handler);
  });
}

function joinCall(s: ClientSocket, groupId: string): Promise<{ ok?: boolean; call?: CallSnap; error?: string }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("join timeout")), 4000);
    s.emit("call:join", groupId, (r: { ok?: boolean; call?: CallSnap; error?: string }) => {
      clearTimeout(timer);
      resolve(r);
    });
  });
}

/** Polls the authoritative HTTP snapshot until the predicate holds. */
async function waitCallState(
  pred: (call: CallSnap) => boolean,
  timeout = 4000,
): Promise<CallSnap> {
  const t0 = Date.now();
  for (;;) {
    const res = await member.req(`/api/groups/${callGroupId}/call`);
    const call = (res.data as { call: CallSnap | null }).call;
    if (call && pred(call)) return call;
    if (Date.now() - t0 > timeout) {
      throw new Error("timeout waiting for call state");
    }
    await new Promise((r) => setTimeout(r, 50));
  }
}

describe("group calls", () => {
  let memberSocket: ClientSocket;
  let adminSocket: ClientSocket;
  let callMemberId = "";
  let outsiderGroupId = "";

  beforeAll(async () => {
    const meRes = await member.req("/api/me");
    callMemberId = String((meRes.data as { user: { id: string } }).user.id);
    // The main group was deleted by the moderation block — create a fresh one.
    const created = await admin.req("/api/admin/groups", {
      method: "POST",
      body: { name: "Live Class Room", memberIds: [memberId] },
    });
    expect(created.status).toBe(201);
    callGroupId = String((created.data as { id: string }).id);
    // A group the member does not belong to.
    const outsider = await admin.req("/api/admin/groups", {
      method: "POST",
      body: { name: "Outsider Room" },
    });
    expect(outsider.status).toBe(201);
    outsiderGroupId = String((outsider.data as { id: string }).id);
  });

  afterAll(() => {
    memberSocket?.close();
    adminSocket?.close();
  });

  it("refuses to let a member start a call", async () => {
    const res = await member.req(`/api/groups/${callGroupId}/call`, { method: "POST" });
    expect(res.status).toBe(403);
  });

  it("lets the admin start a call and notifies the group members", async () => {
    const res = await admin.req(`/api/groups/${callGroupId}/call`, { method: "POST" });
    expect(res.status).toBe(201);
    const call = (res.data as { call: CallSnap }).call;
    expect(call.groupId).toBe(callGroupId);
    expect(call.participants).toEqual([]);

    const notes = await member.req("/api/notifications");
    const items = (notes.data as { notifications: { title: string }[] }).notifications;
    expect(items.some((n) => n.title.includes("Live class started"))).toBe(true);
  });

  it("returns the active call to members but not to non-members", async () => {
    const asMember = await member.req(`/api/groups/${callGroupId}/call`);
    expect(asMember.status).toBe(200);
    expect((asMember.data as { call: CallSnap | null }).call?.groupId).toBe(callGroupId);

    // A group the member does not belong to → cannot see its call.
    const asNonMember = await member.req(`/api/groups/${outsiderGroupId}/call`);
    expect(asNonMember.status).toBe(403);
  });

  it("does not start a second concurrent call in the same group", async () => {
    const res = await admin.req(`/api/groups/${callGroupId}/call`, { method: "POST" });
    expect(res.status).toBe(200);
    expect((res.data as { alreadyActive: boolean }).alreadyActive).toBe(true);
  });

  it("admits group members to the call over socket", async () => {
    memberSocket = connectSocket(member);
    adminSocket = connectSocket(admin);
    await Promise.all([
      new Promise<void>((r) => memberSocket.on("connect", () => r())),
      new Promise<void>((r) => adminSocket.on("connect", () => r())),
    ]);

    const adminJoin = await joinCall(adminSocket, callGroupId);
    expect(adminJoin.ok).toBe(true);

    const rosterEvent = waitForEvent(memberSocket, "call:peer:joined");
    const join = await joinCall(memberSocket, callGroupId);
    expect(join.ok).toBe(true);
    expect(join.call?.participants.some((p) => p.userId === callMemberId)).toBe(true);
    // everyone joins muted
    expect(join.call?.participants.every((p) => p.selfMuted && !p.publishing)).toBe(true);
    const peerJoined = await rosterEvent as { userId: string };
    expect(peerJoined.userId).toBe(callMemberId);
  });

  it("lets a member unmute, then the host mutes them and blocks self-unmute", async () => {
    // member turns mic on → becomes publishing
    memberSocket.emit("call:mic", { groupId: callGroupId, on: true });
    const afterUnmute = await waitCallState((c) =>
      c.participants.some((p) => p.userId === callMemberId && p.publishing),
    );
    expect(
      afterUnmute.participants.find((p) => p.userId === callMemberId)?.selfMuted,
    ).toBe(false);

    // admin force-mutes the member → member is told directly
    const forced = waitForEvent<{ groupId: string; muted: boolean }>(
      memberSocket,
      "call:forced-mute",
    );
    adminSocket.emit("call:admin-mic", { groupId: callGroupId, userId: callMemberId, muted: true });
    const mutePayload = await forced;
    expect(mutePayload.muted).toBe(true);

    const snap2 = await waitCallState((c) =>
      c.participants.some(
        (p) => p.userId === callMemberId && p.adminMuted && !p.publishing,
      ),
    );
    expect(
      snap2.participants.find((p) => p.userId === callMemberId)?.selfMuted,
    ).toBe(true);

    // the blocked member tries to unmute → server ignores it
    memberSocket.emit("call:mic", { groupId: callGroupId, on: true });
    await new Promise((r) => setTimeout(r, 300));
    const stillBlocked = await member.req(`/api/groups/${callGroupId}/call`);
    const meRow = (stillBlocked.data as { call: CallSnap }).call.participants.find(
      (p) => p.userId === callMemberId,
    );
    expect(meRow?.adminMuted).toBe(true);
    expect(meRow?.publishing).toBe(false);
  });

  it("lets the host lift the mute so the person can unmute themselves", async () => {
    adminSocket.emit("call:admin-mic", { groupId: callGroupId, userId: callMemberId, muted: false });

    // block lifted, but the person is still self-muted (never force-unmuted)
    await waitCallState((c) =>
      c.participants.some(
        (p) =>
          p.userId === callMemberId &&
          !p.adminMuted &&
          p.selfMuted &&
          !p.publishing,
      ),
    );

    memberSocket.emit("call:mic", { groupId: callGroupId, on: true });
    const snap = await waitCallState((c) =>
      c.participants.some((p) => p.userId === callMemberId && p.publishing),
    );
    expect(
      snap.participants.find((p3) => p3.userId === callMemberId)?.publishing,
    ).toBe(true);
  });

  it("broadcasts raised hands to everyone in the call", async () => {
    const heard = waitForEvent<{ userId: string; name: string; raised: boolean }>(
      adminSocket,
      "call:hand",
    );
    memberSocket.emit("call:hand", { groupId: callGroupId, raised: true });
    const hand = await heard;
    expect(hand.userId).toBe(callMemberId);
    expect(hand.raised).toBe(true);

    const snap = await waitCallState((c) =>
      c.participants.some((p) => p.userId === callMemberId && p.handRaised),
    );
    expect(
      snap.participants.find((p) => p.userId === callMemberId)?.handRaised,
    ).toBe(true);
  });

  it("removes a participant when they leave the call", async () => {
    memberSocket.emit("call:leave", callGroupId);
    const snap = await waitCallState((c) =>
      !c.participants.some((p) => p.userId === callMemberId),
    );
    expect(snap.participants.some((p) => p.userId === callMemberId)).toBe(false);
  });

  it("ends the call for everyone when the admin ends it", async () => {
    const ended = waitForEvent<{ groupId: string }>(adminSocket, "call:ended");
    const res = await admin.req(`/api/groups/${callGroupId}/call/end`, { method: "POST" });
    expect(res.status).toBe(200);
    const payload = await ended;
    expect(payload.groupId).toBe(callGroupId);

    const after = await member.req(`/api/groups/${callGroupId}/call`);
    expect((after.data as { call: CallSnap | null }).call).toBeNull();

    // re-starting after an end works
    const restart = await admin.req(`/api/groups/${callGroupId}/call`, { method: "POST" });
    expect(restart.status).toBe(201);
    const endAgain = await admin.req(`/api/groups/${callGroupId}/call/end`, { method: "POST" });
    expect(endAgain.status).toBe(200);
  });
});

/* ------------------------------------------------------------------ */
/* Admin message moderation                                            */
/* ------------------------------------------------------------------ */

describe("admin message moderation", () => {
  let messageId = "";
  let modGroupId = "";

  beforeAll(async () => {
    const created = await admin.req("/api/admin/groups", {
      method: "POST",
      body: { name: "Moderation Room", memberIds: [memberId] },
    });
    expect(created.status).toBe(201);
    modGroupId = String((created.data as { id: string }).id);
  });

  it("a member cannot delete someone's message", async () => {
    const sent = await admin.req(`/api/groups/${modGroupId}/messages`, {
      method: "POST",
      body: { type: "text", body: "Announcement about the live class" },
    });
    expect(sent.status).toBe(201);
    messageId = String((sent.data as { message: { id: string } }).message.id);

    const res = await member.req(`/api/messages/${messageId}`, { method: "DELETE" });
    expect(res.status).toBe(403);
  });

  it("the admin can delete any message in any group", async () => {
    const res = await admin.req(`/api/messages/${messageId}`, { method: "DELETE" });
    expect(res.status).toBe(200);

    const history = await member.req(`/api/groups/${modGroupId}/messages?limit=100`);
    const msg = (history.data as {
      messages: { id: string; body: string | null; deleted: boolean }[];
    }).messages.find((m) => m.id === messageId);
    expect(msg?.deleted).toBe(true);
    expect(msg?.body).toBeNull();
  });

  it("404s for an unknown message", async () => {
    const res = await admin.req("/api/messages/does-not-exist", { method: "DELETE" });
    expect(res.status).toBe(404);
  });
});
