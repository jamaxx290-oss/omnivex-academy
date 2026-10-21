import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";

const isTest = process.env.NODE_ENV === "test";
const isProd = process.env.NODE_ENV === "production";

const DATA_DIR = path.resolve(
  process.env.DATA_DIR || path.join(process.cwd(), "data"),
);
fs.mkdirSync(DATA_DIR, { recursive: true });

/**
 * Better Auth secret: taken from env when provided, otherwise persisted to a
 * file inside DATA_DIR so sessions survive restarts without hardcoding secrets.
 */
function resolveAuthSecret(): string {
  if (process.env.BETTER_AUTH_SECRET) return process.env.BETTER_AUTH_SECRET;
  const file = path.join(DATA_DIR, ".auth-secret");
  if (fs.existsSync(file)) return fs.readFileSync(file, "utf8").trim();
  const generated = crypto.randomBytes(32).toString("base64");
  fs.writeFileSync(file, generated, { mode: 0o600 });
  if (isProd) {
    console.warn(
      "[env] BETTER_AUTH_SECRET not set — generated a persistent secret at " +
        file +
        ". Prefer setting BETTER_AUTH_SECRET in the environment.",
    );
  }
  return generated;
}

const PORT = Number(process.env.PORT) || 3000;

export const env = {
  nodeEnv: process.env.NODE_ENV || "development",
  isProd,
  isTest,
  port: PORT,
  dataDir: DATA_DIR,
  uploadsDir: path.join(DATA_DIR, "uploads"),
  databaseUrl:
    process.env.DATABASE_URL || path.join(DATA_DIR, "omnivex.db"),
  appUrl: (process.env.APP_URL || `http://localhost:${PORT}`).replace(
    /\/+$/,
    "",
  ),
  betterAuthSecret: resolveAuthSecret(),
  betterAuthUrl:
    process.env.BETTER_AUTH_URL || process.env.APP_URL || `http://localhost:${PORT}`,

  resendApiKey: process.env.RESEND_API_KEY || "",
  resendSenderName: process.env.RESEND_FROM_NAME || "Omnivex Academy",
  resendSenderEmail:
    process.env.RESEND_FROM_EMAIL || "hello@omnivex.manuskripta.xyz",
  resendWebhookSecret: process.env.RESEND_WEBHOOK_SECRET || "",

  paystackSecretKey: process.env.PAYSTACK_SECRET_KEY || "",
  paystackPublicKey: process.env.PAYSTACK_PUBLIC_KEY || "",

  adminEmail: process.env.ADMIN_EMAIL || "",
  adminPassword: process.env.ADMIN_PASSWORD || "",

  vapidPublicKey: process.env.VAPID_PUBLIC_KEY || "",
  vapidPrivateKey: process.env.VAPID_PRIVATE_KEY || "",
  vapidSubject: process.env.VAPID_SUBJECT || "mailto:admin@omnivex.academy",

  initialPriceKobo: process.env.MEMBERSHIP_PRICE_KOBO
    ? Number(process.env.MEMBERSHIP_PRICE_KOBO)
    : null,
};

fs.mkdirSync(env.uploadsDir, { recursive: true });
