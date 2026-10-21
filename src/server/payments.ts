import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { db, getMembershipPriceKobo, getTerms } from "./db";
import { payments, user } from "./db/schema";
import { env } from "./env";
import { notify } from "./notifications";

function uuid(): string {
  return crypto.randomUUID();
}

export function paystackConfigured(): boolean {
  return Boolean(env.paystackSecretKey);
}

const API = "https://api.paystack.co";

async function paystackFetch(path: string, init?: RequestInit) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${env.paystackSecretKey}`,
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });
  const data = (await res.json().catch(() => ({}))) as {
    status?: boolean;
    message?: string;
    data?: Record<string, unknown>;
  };
  return { ok: res.ok, status: res.status, body: data };
}

export function verifyPaystackSignature(rawBody: Buffer, signature: string | undefined): boolean {
  if (!signature || !env.paystackSecretKey) return false;
  const expected = crypto
    .createHmac("sha512", env.paystackSecretKey)
    .update(rawBody)
    .digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}

export function generateReference(): string {
  return `ovx_${Date.now()}_${crypto.randomBytes(6).toString("hex")}`;
}

/**
 * Creates a pending payment record and initializes a Paystack transaction.
 * Returns authorization_url for the client to redirect to.
 */
export async function initializePayment(userId: string): Promise<
  | { ok: true; reference: string; authorizationUrl: string; amountKobo: number }
  | { ok: false; error: string; code?: string }
> {
  if (!paystackConfigured()) {
    return {
      ok: false,
      error: "Payments are not configured yet. Please contact the administrator.",
      code: "PAYSTACK_NOT_CONFIGURED",
    };
  }
  const priceKobo = getMembershipPriceKobo();
  if (priceKobo === null || priceKobo <= 0) {
    return {
      ok: false,
      error: "Membership price has not been configured yet.",
      code: "PRICE_NOT_SET",
    };
  }
  const u = await db.query.user.findFirst({ where: eq(user.id, userId) });
  if (!u) return { ok: false, error: "User not found" };

  const terms = getTerms();
  const reference = generateReference();

  await db.insert(payments).values({
    id: uuid(),
    user_id: userId,
    reference,
    amount_kobo: priceKobo,
    currency: "NGN",
    status: "pending",
    terms_version_at_purchase: terms.version,
    created_at: new Date(),
  });

  const callbackUrl = `${env.appUrl}/pay/callback?reference=${encodeURIComponent(reference)}`;
  const { ok, body } = await paystackFetch("/transaction/initialize", {
    method: "POST",
    body: JSON.stringify({
      email: u.email,
      amount: priceKobo,
      currency: "NGN",
      reference,
      callback_url: callbackUrl,
      metadata: { user_id: userId, terms_version: terms.version },
    }),
  });

  if (!ok || !body.status || !body.data) {
    await db
      .update(payments)
      .set({ status: "failed", paystack_response: JSON.stringify(body) })
      .where(eq(payments.reference, reference));
    return {
      ok: false,
      error: body.message || "Could not initialize payment with Paystack",
    };
  }

  const authorizationUrl = String(
    (body.data as { authorization_url?: string }).authorization_url || "",
  );
  if (!authorizationUrl) {
    return { ok: false, error: "Paystack did not return a checkout URL" };
  }
  return { ok: true, reference, authorizationUrl, amountKobo: priceKobo };
}

export type VerifyOutcome =
  | { ok: true; status: "success" | "failed" | "pending"; message: string }
  | { ok: false; error: string; status?: string };

/**
 * Verifies a transaction against Paystack's server-side verify endpoint and
 * grants membership only when charge status is "success" with matching amount/currency.
 * Idempotent: repeated calls for an already-successful payment are safe.
 */
export async function verifyPayment(
  reference: string,
  source: "callback" | "webhook" | "admin",
): Promise<VerifyOutcome> {
  const record = await db.query.payments.findFirst({
    where: eq(payments.reference, reference),
  });
  if (!record) return { ok: false, error: "Unknown payment reference" };
  if (record.status === "success") {
    return { ok: true, status: "success", message: "Already verified" };
  }

  if (!paystackConfigured()) {
    return { ok: false, error: "Payments are not configured" };
  }

  const { ok, body } = await paystackFetch(
    `/transaction/verify/${encodeURIComponent(reference)}`,
  );
  if (!ok || !body.status || !body.data) {
    return {
      ok: false,
      error: body.message || "Verification failed at Paystack",
    };
  }

  const data = body.data as {
    status?: string;
    amount?: number;
    currency?: string;
    channel?: string;
    paid_at?: string;
  };
  const chargeStatus = data.status || "failed";

  if (chargeStatus !== "success") {
    await db
      .update(payments)
      .set({
        status: chargeStatus === "abandoned" || chargeStatus === "failed" ? "failed" : "pending",
        channel: data.channel || null,
        paystack_response: JSON.stringify(body),
        verified_at: new Date(),
      })
      .where(eq(payments.reference, reference));
    return {
      ok: true,
      status: chargeStatus === "success" ? "success" : "failed",
      message: `Payment status: ${chargeStatus}`,
    };
  }

  // amount + currency must match what we charged
  if (data.amount !== record.amount_kobo || data.currency !== "NGN") {
    await db
      .update(payments)
      .set({
        status: "failed",
        paystack_response: JSON.stringify({ ...body, mismatch: true }),
        verified_at: new Date(),
      })
      .where(eq(payments.reference, reference));
    return { ok: false, error: "Payment amount/currency mismatch" };
  }

  await grantMembership(record.user_id, record.id, body, source);
  return { ok: true, status: "success", message: "Payment confirmed" };
}

/** Marks payment success + activates membership (idempotent). */
export async function grantMembership(
  userId: string,
  paymentId: string,
  responseBody: unknown,
  source: string,
): Promise<void> {
  const now = new Date();
  const updated = await db
    .update(payments)
    .set({
      status: "success",
      verified_at: now,
      paystack_response: JSON.stringify(responseBody).slice(0, 20000),
    })
    .where(eq(payments.id, paymentId))
    .returning({ id: payments.id, user_id: payments.user_id });

  if (!updated.length) return; // another process already granted

  await db
    .update(user)
    .set({ membership_status: "active", updatedAt: now })
    .where(eq(user.id, userId));

  await notify({
    userId,
    type: "system",
    title: "Welcome to Omnivex Academy 🎉",
    body: "Your payment was confirmed and membership is now active.",
    link: "/app/groups",
  });

  const io = (await import("./realtime")).getIO();
  io?.to(`user:${userId}`).emit("membership:changed", { status: "active" });
  console.log(`[payments] membership granted to ${userId} via ${source}`);
}

export async function revokeMembership(userId: string): Promise<void> {
  await db
    .update(user)
    .set({ membership_status: "revoked", updatedAt: new Date() })
    .where(eq(user.id, userId));
  const io = (await import("./realtime")).getIO();
  io?.to(`user:${userId}`).emit("membership:changed", { status: "revoked" });
}
