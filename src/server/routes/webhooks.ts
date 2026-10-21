import crypto from "node:crypto";
import { Router, type Request, type Response } from "express";
import { env } from "../env";
import { applyDeliveryEvent } from "../email";

const router = Router();

/**
 * Manual svix verification (Resend's documented scheme):
 *   signed content = `${svix-id}.${svix-timestamp}.${rawBody}`
 *   HMAC-SHA256 with the base64-decoded secret (after the `whsec_` prefix)
 *   compare against every `v1,<sig>` token in the space-separated header.
 */
function verifySignature(
  raw: string,
  id: string,
  timestamp: string,
  signatureHeader: string,
  secret: string,
): boolean {
  const secretBase64 = secret.replace(/^whsec_/, "");
  const key = Buffer.from(secretBase64, "base64");
  const signed = `${id}.${timestamp}.${raw}`;
  const expected = crypto.createHmac("sha256", key).update(signed).digest("base64");

  return signatureHeader.split(" ").some((token) => {
    const [version, signature] = token.split(",");
    if (version !== "v1" || !signature) return false;
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  });
}

/** Maps Resend event types onto our delivery statuses. */
const EVENT_STATUS: Record<string, string> = {
  "email.sent": "sent",
  "email.delivered": "delivered",
  "email.delivery_delayed": "delayed",
  "email.bounced": "bounced",
  "email.complained": "complained",
  "email.failed": "failed",
  "email.suppressed": "suppressed",
};

/**
 * POST /api/webhooks/resend
 *
 * Configure this URL in the Resend dashboard (Webhooks → + Add endpoint),
 * ticking: sent, delivered, delivery delayed, bounced, complained, failed,
 * suppressed. Requires RESEND_WEBHOOK_SECRET (the `whsec_…` signing secret).
 */
router.post("/api/webhooks/resend", async (req: Request, res: Response) => {
  if (!env.resendWebhookSecret) {
    return res.status(503).json({
      error:
        "RESEND_WEBHOOK_SECRET is not configured — set it in the environment, then restart.",
    });
  }

  const id = req.header("svix-id") || "";
  const timestamp = req.header("svix-timestamp") || "";
  const signature = req.header("svix-signature") || "";
  if (!id || !timestamp || !signature) {
    return res.status(400).json({ error: "Missing svix signature headers" });
  }

  // Reject stale timestamps (5-minute tolerance) to blunt replay attempts.
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > 300) {
    return res.status(401).json({ error: "Stale webhook timestamp" });
  }

  const raw = Buffer.isBuffer(req.body)
    ? req.body.toString("utf8")
    : typeof req.body === "string"
      ? req.body
      : "";
  if (!raw) {
    return res.status(400).json({ error: "Missing raw request body" });
  }
  if (!verifySignature(raw, id, timestamp, signature, env.resendWebhookSecret)) {
    return res.status(401).json({ error: "Invalid signature" });
  }

  let event: { type?: string; data?: { email_id?: string; to?: string[] } };
  try {
    event = JSON.parse(raw);
  } catch {
    return res.status(400).json({ error: "Invalid JSON payload" });
  }

  const status = EVENT_STATUS[event.type || ""];
  const emailId = event.data?.email_id;
  if (status && emailId) {
    const recipient = event.data?.to?.[0];
    const detail =
      event.type === "email.bounced" || event.type === "email.failed"
        ? `Resend event ${event.type}${recipient ? ` → ${recipient}` : ""}`
        : `Resend event ${event.type}`;
    await applyDeliveryEvent(emailId, status, detail);
  }

  res.json({ received: true });
});

export default router;
