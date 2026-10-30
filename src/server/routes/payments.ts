import { Router, type Request, type Response } from "express";
import { eq } from "drizzle-orm";
import { db, getTerms } from "../db";
import { payments } from "../db/schema";
import { requireAuth, requireVerified, type SessionUser } from "../middleware";
import {
  initializePayment,
  verifyPayment,
  verifyPaystackSignature,
  paystackConfigured,
} from "../payments";
import { getIO } from "../realtime";

const router = Router();

/** Payment status + price for the paywall. */
router.get("/payments/status", requireAuth, async (req: Request, res: Response) => {
  const u = req.appUser as SessionUser;
  const rows = await db.query.payments.findMany({
    where: eq(payments.user_id, u.id),
  });
  res.json({
    configured: paystackConfigured(),
    membershipStatus: u.membership_status,
    payments: rows
      .sort((a, b) => b.created_at.getTime() - a.created_at.getTime())
      .slice(0, 20)
      .map((p) => ({
        reference: p.reference,
        amountKobo: p.amount_kobo,
        currency: p.currency,
        status: p.status,
        channel: p.channel,
        createdAt: p.created_at.toISOString(),
        verifiedAt: p.verified_at ? p.verified_at.toISOString() : null,
      })),
  });
});

/** Step 1: create pending payment + get Paystack checkout URL. */
router.post(
  "/payments/initialize",
  requireVerified,
  async (req: Request, res: Response) => {
    const u = req.appUser as SessionUser;
    if (u.membership_status === "active") {
      return res.status(400).json({ error: "Membership is already active" });
    }
    // The terms are a must-read: checkout only starts when the client confirms
    // it accepted the terms version currently in force.
    const terms = getTerms();
    const acceptedVersion = Number(req.body?.termsVersion);
    if (!Number.isFinite(acceptedVersion) || acceptedVersion !== terms.version) {
      return res.status(400).json({
        error: `Please read and accept the academy terms (v${terms.version}) before paying.`,
        code: "TERMS_REQUIRED",
      });
    }
    const result = await initializePayment(u.id);
    if (!result.ok) {
      return res
        .status(result.code === "PAYSTACK_NOT_CONFIGURED" ? 503 : 400)
        .json({ error: result.error, code: result.code });
    }
    res.json({
      reference: result.reference,
      authorizationUrl: result.authorizationUrl,
      amountKobo: result.amountKobo,
    });
  },
);

/**
 * Step 2: server-side verification of a completed transaction.
 * Called by our client after Paystack redirects back.
 */
router.post(
  "/payments/verify/:reference",
  requireVerified,
  async (req: Request, res: Response) => {
    const u = req.appUser as SessionUser;
    const reference = String(req.params.reference || "");
    const record = await db.query.payments.findFirst({
      where: eq(payments.reference, reference),
    });
    if (!record) return res.status(404).json({ error: "Unknown reference" });
    if (record.user_id !== u.id && !u.is_admin) {
      return res.status(403).json({ error: "Not your payment" });
    }
    const outcome = await verifyPayment(reference, "callback");
    if (!outcome.ok) {
      return res.status(502).json({ error: outcome.error });
    }
    const refreshed = await db.query.payments.findFirst({
      where: eq(payments.reference, reference),
    });
    res.json({
      status: refreshed?.status || outcome.status,
      message: outcome.message,
      membershipStatus:
        refreshed?.status === "success" ? "active" : u.membership_status,
    });
  },
);

/**
 * Paystack webhook: signature-checked with HMAC-SHA512 over the raw body.
 * Grants membership only after server-side verification. Idempotent.
 */
export function paymentWebhookRaw(req: Request, res: Response): void {
  const chunks: Buffer[] = [];
  req.on("data", (c: Buffer) => chunks.push(c));
  req.on("end", async () => {
    const raw = Buffer.concat(chunks);
    const signature = req.header("x-paystack-signature");
    if (!verifyPaystackSignature(raw, signature)) {
      res.status(401).json({ error: "Invalid signature" });
      return;
    }
    try {
      const event = JSON.parse(raw.toString("utf8")) as {
        event?: string;
        data?: { reference?: string; channel?: string; status?: string };
      };
      const reference = event.data?.reference;
      if (!reference) {
        res.status(200).json({ received: true });
        return;
      }
      if (
        event.event === "charge.success" ||
        event.event === "charge.failed" ||
        event.event === "charge.pending"
      ) {
        await verifyPayment(reference, "webhook");
      }
      const io = getIO();
      if (io) {
        const rec = await db.query.payments.findFirst({
          where: eq(payments.reference, reference),
        });
        if (rec) {
          io.to(`user:${rec.user_id}`).emit("payment:updated", {
            reference,
            status: rec.status,
          });
        }
      }
      res.status(200).json({ received: true });
    } catch (err) {
      console.error("[webhook] error:", err);
      res.status(200).json({ received: true }); // avoid Paystack retries storms on our bugs
    }
  });
}

/** Terms currently in force (used by the checkout dialog). */
router.get("/payments/terms", (_req: Request, res: Response) => {
  res.json(getTerms());
});

export default router;
