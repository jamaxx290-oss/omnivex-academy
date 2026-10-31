import http from "node:http";
import { env } from "./env";
import { createApp } from "./app";
import { bootstrapSettings, bootstrapAdmin } from "./bootstrap";
import { initRealtime } from "./realtime";
import { ensureVapidKeys } from "./notifications";
import { closeStaleCalls } from "./calls";
import { appUrlIsLocal, reconcilePendingPayments } from "./payments";

async function main(): Promise<void> {
  bootstrapSettings();
  await closeStaleCalls();
  ensureVapidKeys();
  await bootstrapAdmin();

  const app = createApp();
  const server = http.createServer(app);
  initRealtime(server);

  server.listen(env.port, "0.0.0.0", () => {
    console.log(
      `[server] Omnivex Academy listening on http://0.0.0.0:${env.port} (${env.nodeEnv})`,
    );
    if (!env.resendApiKey && !env.isProd) {
      console.log(
        `[server] RESEND_API_KEY missing — outgoing mail is captured in dev_outbox (sender: ${env.resendSenderName} <${env.resendSenderEmail}>)`,
      );
    }
    if (!env.resendWebhookSecret && !env.isProd) {
      console.log("[server] RESEND_WEBHOOK_SECRET missing — /api/webhooks/resend returns 503");
    }
    if (!env.paystackSecretKey) {
      console.log("[server] PAYSTACK_SECRET_KEY missing — checkout will be unavailable");
    } else if (!env.paystackPublicKey) {
      console.log("[server] PAYSTACK_PUBLIC_KEY missing — checkout will be unavailable");
    }
    if (appUrlIsLocal()) {
      console.log(
        "[server] APP_URL is not a public URL — payment callback/webhook URLs are " +
          "derived from the request host. Set APP_URL=https://omnivex-academy.xyz in .env.",
      );
    }
  });

  // Safety net: someone who closes the browser right after paying still gets
  // access, even if the webhook is delayed or was never configured.
  const sweep = () => {
    void reconcilePendingPayments().catch((err) =>
      console.error("[payments] reconcile error:", err),
    );
  };
  setTimeout(sweep, 10_000).unref();
  setInterval(sweep, 120_000).unref();

  const shutdown = () => {
    console.log("[server] shutting down");
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("[server] failed to start:", err);
  process.exit(1);
});
