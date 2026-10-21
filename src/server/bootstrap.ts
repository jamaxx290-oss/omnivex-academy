import { eq } from "drizzle-orm";
import { hashPassword } from "better-auth/crypto";
import { db, getSetting, setSetting } from "./db";
import { user, account } from "./db/schema";
import { env } from "./env";

function uuid(): string {
  return globalThis.crypto.randomUUID();
}

/** Seeds settings rows on first boot. Prices/terms are never hardcoded. */
export function bootstrapSettings(): void {
  if (getSetting("terms_version") === null) {
    setSetting("terms_version", "1");
  }
  if (getSetting("terms_text") === null) {
    setSetting("terms_text", "");
  }
  if (getSetting("membership_price_kobo") === null) {
    setSetting(
      "membership_price_kobo",
      env.initialPriceKobo !== null ? String(env.initialPriceKobo) : "",
    );
  }
  if (getSetting("app_name") === null) setSetting("app_name", "Omnivex Academy");
  if (getSetting("announcement_counter") === null) setSetting("announcement_counter", "0");
}

/**
 * Creates or promotes the single administrator from ADMIN_EMAIL / ADMIN_PASSWORD.
 * Credentials are never hardcoded — they come only from the environment.
 */
export async function bootstrapAdmin(): Promise<void> {
  if (!env.adminEmail || !env.adminPassword) {
    if (env.isProd) {
      console.warn(
        "[admin] ADMIN_EMAIL / ADMIN_PASSWORD not set — no administrator account exists.",
      );
    }
    return;
  }
  const email = env.adminEmail.toLowerCase();
  const existing = await db.query.user.findFirst({ where: eq(user.email, email) });

  if (existing) {
    if (!existing.is_admin) {
      await db.update(user).set({ is_admin: true }).where(eq(user.id, existing.id));
      console.log(`[admin] promoted ${email} to administrator`);
    }
    return;
  }

  const id = uuid();
  const now = new Date();
  const passwordHash = await hashPassword(env.adminPassword);

  await db.insert(user).values({
    id,
    name: "Academy Admin",
    email,
    emailVerified: true,
    is_admin: true,
    membership_status: "active",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(account).values({
    id: uuid(),
    userId: id,
    providerId: "credential",
    accountId: id,
    password: passwordHash,
    createdAt: now,
    updatedAt: now,
  });
  console.log(`[admin] bootstrapped administrator ${email}`);
}
