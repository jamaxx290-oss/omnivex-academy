import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { emailOTP } from "better-auth/plugins";
import { fromNodeHeaders } from "better-auth/node";
import type { IncomingHttpHeaders } from "node:http";
import { db } from "./db";
import { authSchema } from "./db/schema";
import { env } from "./env";
import { sendEmail } from "./email";
import { passwordResetEmail, verificationOtpEmail } from "./emailTemplates";

/** Profile details every member must provide at sign-up (editable, never clearable). */
const REQUIRED_PROFILE_FIELDS = [
  "whatsapp_number",
  "country",
  "state_region",
  "gender",
] as const;

export const auth = betterAuth({
  baseURL: env.betterAuthUrl,
  secret: env.betterAuthSecret,
  database: drizzleAdapter(db, {
    provider: "sqlite",
    schema: authSchema,
  }),
  trustedOrigins: async (request?: globalThis.Request) => {
    const origins = new Set<string>([
      env.appUrl,
      env.betterAuthUrl,
      "http://localhost:5173",
      "http://127.0.0.1:5173",
      "http://localhost:3000",
      "http://127.0.0.1:3000",
    ]);
    if (request) {
      const headers = request.headers;
      const host = headers.get("x-forwarded-host") || headers.get("host");
      const proto =
        headers.get("x-forwarded-proto") ||
        (headers.get("x-forwarded-proto") === null && host?.startsWith("localhost")
          ? "http"
          : null) ||
        "https";
      // Only host-derived origins: an Origin header from another site has a
      // different host, so cross-site requests stay rejected (CSRF-safe).
      if (host) {
        origins.add(`${proto}://${host}`);
        origins.add(`http://${host}`);
        origins.add(`https://${host}`);
      }
    }
    return [...origins];
  },
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false,
    minPasswordLength: 8,
    revokeSessionsOnPasswordReset: true,
    sendResetPassword: async ({ user, url }) => {
      const t = passwordResetEmail(user.name, url);
      await sendEmail({
        to: user.email,
        subject: t.subject,
        html: t.html,
        text:
          `Hello ${user.name},\n\n` +
          `Use the link below to choose a new password. It expires in 1 hour:\n\n${url}\n\n` +
          `If you did not request this, you can safely ignore this email.\n\n` +
          `— Omnivex Academy`,
        userId: user.id,
      });
    },
  },
  emailVerification: {
    autoSignInAfterVerification: true,
  },
  user: {
    additionalFields: {
      whatsapp_number: {
        type: "string",
        required: true,
        input: true,
        returned: false,
      },
      country: { type: "string", required: true, input: true, returned: false },
      state_region: {
        type: "string",
        required: true,
        input: true,
        returned: false,
      },
      gender: { type: "string", required: true, input: true, returned: false },
    },
  },
  databaseHooks: {
    user: {
      create: {
        // Profile details are mandatory at sign-up — never optional.
        before: async (data) => {
          for (const f of REQUIRED_PROFILE_FIELDS) {
            const v = (data as Record<string, unknown>)[f];
            if (typeof v !== "string" || !v.trim()) {
              throw new APIError("BAD_REQUEST", {
                message: `${f.replace(/_/g, " ")} is required`,
              });
            }
          }
          return { data };
        },
      },
      update: {
        // Fields can be edited but never cleared/deleted.
        before: async (data) => {
          for (const f of REQUIRED_PROFILE_FIELDS) {
            const v = (data as Record<string, unknown>)[f];
            if (v !== undefined && v !== null && (typeof v !== "string" || !v.trim())) {
              throw new APIError("BAD_REQUEST", {
                message: `${f.replace(/_/g, " ")} cannot be cleared`,
              });
            }
          }
          return { data };
        },
      },
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 30, // 30 days
    updateAge: 60 * 60 * 24, // refresh daily
    freshAge: 60 * 60 * 24,
  },
  rateLimit: { enabled: false }, // application-level limits are applied in Express
  plugins: [
    emailOTP({
      sendVerificationOTP: async ({ email, otp, type }) => {
        if (type === "email-verification") {
          const t = verificationOtpEmail("there", otp);
          await sendEmail({
            to: email,
            subject: t.subject,
            html: t.html,
            text: `Your Omnivex Academy verification code is: ${otp}\n\n` +
              `It expires in 10 minutes. If you did not create an account, ignore this email.`,
          });
          return;
        }
        await sendEmail({
          to: email,
          subject: `Your Omnivex code: ${otp}`,
          text: `Your code is: ${otp}\n\nIt expires in 10 minutes.`,
        });
      },
      sendVerificationOnSignUp: true,
      expiresIn: 600, // 10 minutes
      allowedAttempts: 5,
      otpLength: 6,
      storeOTP: "hashed",
    }),
  ],
});

export type Auth = typeof auth;

export async function getSessionFromHeaders(
  headers: IncomingHttpHeaders | Headers,
) {
  const h =
    headers instanceof Headers ? headers : fromNodeHeaders(headers as IncomingHttpHeaders);
  return auth.api.getSession({ headers: h });
}
