import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { env } from "./env";
import { db, sqlite } from "./db";
import { emailDeliveries } from "./db/schema";

function uuid(): string {
  return crypto.randomUUID();
}

/** Canonical sender: "Omnivex Academy <hello@omnivex.manuskripta.xyz>". */
export function fromAddress(): string {
  return `${env.resendSenderName} <${env.resendSenderEmail}>`;
}

export function emailConfigured(): boolean {
  return Boolean(env.resendApiKey);
}

type SendArgs = {
  to: string;
  subject: string;
  text: string;
  html?: string;
  /** Optional delivery grouping (broadcast id) for admin visibility. */
  broadcastId?: string;
  userId?: string;
};

/**
 * Development capture. Stores the plain-text body first (so the OTP regex in
 * /api/dev/last-otp stays reliable), followed by the rendered HTML when the
 * message has one — letting developers preview premium templates locally.
 */
function captureDev(
  to: string,
  subject: string,
  text: string,
  html?: string,
): void {
  const body = html ? `${text}\n\n--- HTML ---\n\n${html}` : text;
  sqlite
    .prepare(
      "INSERT INTO dev_outbox (id, to_email, subject, body, created_at) VALUES (?, ?, ?, ?, ?)",
    )
    .run(uuid(), to, subject, body, Date.now());
}

function recordDelivery(args: {
  id: string;
  to: string;
  broadcastId?: string;
  resendId: string | null;
  userId?: string;
  status: string;
  detail?: string;
}): void {
  try {
    db.insert(emailDeliveries)
      .values({
        id: args.id,
        broadcast_id: args.broadcastId || null,
        resend_email_id: args.resendId,
        user_id: args.userId || null,
        email: args.to,
        status: args.status,
        detail: args.detail || null,
        updated_at: new Date(),
      })
      .run();
  } catch (err) {
    console.warn("[email] could not record delivery:", err);
  }
}

/**
 * Sends one email through Resend's REST API.
 *
 * Without an API key (development), the message is written to dev_outbox so
 * OTP/reset flows stay testable — and a synthetic delivery row is recorded so
 * the webhook/status pipeline can be exercised end to end.
 * In production a missing key throws loudly.
 */
export async function sendEmail(args: SendArgs): Promise<void> {
  const { to, subject, text, html } = args;
  const deliveryId = uuid();

  if (!emailConfigured()) {
    if (env.isProd) {
      throw new Error(
        "RESEND_API_KEY is not configured — cannot send email in production.",
      );
    }
    captureDev(to, subject, text, html);
    recordDelivery({
      id: deliveryId,
      to,
      broadcastId: args.broadcastId,
      userId: args.userId,
      resendId: `dev-${deliveryId}`,
      status: "sent",
      detail: "captured in dev_outbox (no RESEND_API_KEY)",
    });
    console.log(`[dev-mail] to=${to} subject="${subject}"`);
    return;
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: fromAddress(),
      to: [to],
      subject,
      html: html || undefined,
      text,
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error(`[email] Resend failed: ${res.status} ${detail}`);
    recordDelivery({
      id: deliveryId,
      to,
      broadcastId: args.broadcastId,
      userId: args.userId,
      resendId: null,
      status: "failed",
      detail: `Resend ${res.status}: ${detail.slice(0, 300)}`,
    });
    if (env.isProd) {
      throw new Error(`Resend email delivery failed (${res.status})`);
    }
    // development fallback so OTP flows remain testable
    captureDev(to, subject, text + `\n\n[delivery failed: ${res.status}]`);
    return;
  }

  const body = (await res.json().catch(() => ({}))) as { id?: string };
  recordDelivery({
    id: deliveryId,
    to,
    broadcastId: args.broadcastId,
    userId: args.userId,
    resendId: body.id || null,
    status: "sent",
  });
}

/* ------------------------------------------------------------------ */
/* Batch (broadcasts)                                                  */
/* ------------------------------------------------------------------ */

export type BatchRecipient = { email: string; userId: string; firstName: string };

export type BatchResult = {
  sent: number;
  failed: number;
  mode: "resend" | "dev";
};

const BATCH_LIMIT = 100; // Resend's documented per-request maximum

/**
 * Sends one broadcast to many recipients.
 * - Resend mode: chunks of 100 through POST /emails/batch, per-recipient
 *   delivery rows keyed by the returned Resend ids (webhook-matched later).
 * - Dev mode (no key): captured in dev_outbox with synthetic ids.
 */
export async function sendBroadcast(args: {
  broadcastId: string;
  recipients: BatchRecipient[];
  subject: string;
  buildHtml: (firstName: string) => string;
  buildText: (firstName: string) => string;
}): Promise<BatchResult> {
  let sent = 0;
  let failed = 0;

  const record = (
    r: BatchRecipient,
    resendId: string | null,
    status: string,
    detail?: string,
  ) => {
    recordDelivery({
      id: uuid(),
      broadcastId: args.broadcastId,
      userId: r.userId,
      to: r.email,
      resendId,
      status,
      detail,
    });
  };

  for (let i = 0; i < args.recipients.length; i += BATCH_LIMIT) {
    const chunk = args.recipients.slice(i, i + BATCH_LIMIT);

    if (!emailConfigured()) {
      for (const r of chunk) {
        try {
          captureDev(r.email, args.subject, args.buildText(r.firstName));
          const id = `dev-${uuid()}`;
          record(r, id, "sent", "captured in dev_outbox (no RESEND_API_KEY)");
          sent++;
        } catch {
          record(r, null, "failed", "dev capture failed");
          failed++;
        }
      }
      continue;
    }

    try {
      const res = await fetch("https://api.resend.com/emails/batch", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.resendApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(
          chunk.map((r) => ({
            from: fromAddress(),
            to: [r.email],
            subject: args.subject,
            html: args.buildHtml(r.firstName),
            text: args.buildText(r.firstName),
          })),
        ),
      });

      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        console.error(`[email] Resend batch failed: ${res.status} ${detail}`);
        for (const r of chunk) record(r, null, "failed", `Resend ${res.status}`);
        failed += chunk.length;
        continue;
      }

      const body = (await res.json().catch(() => ({}))) as {
        data?: { id?: string }[];
      };
      chunk.forEach((r, idx) => {
        const id = body.data?.[idx]?.id;
        if (id) {
          record(r, id, "sent");
          sent++;
        } else {
          record(r, null, "failed", "no id returned by Resend");
          failed++;
        }
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "unknown error";
      for (const r of chunk) record(r, null, "failed", msg);
      failed += chunk.length;
    }
  }

  return { sent, failed, mode: emailConfigured() ? "resend" : "dev" };
}

/** Marks a delivery with a status coming from a Resend webhook event. */
export async function applyDeliveryEvent(
  resendEmailId: string,
  status: string,
  detail?: string,
): Promise<boolean> {
  const existing = await db.query.emailDeliveries.findFirst({
    where: eq(emailDeliveries.resend_email_id, resendEmailId),
  });
  if (!existing) return false;
  await db
    .update(emailDeliveries)
    .set({ status, detail: detail || existing.detail, updated_at: new Date() })
    .where(eq(emailDeliveries.id, existing.id));
  return true;
}
