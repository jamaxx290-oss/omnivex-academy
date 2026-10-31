import path from "node:path";
import fs from "node:fs";
import express, {
  type Express,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import helmet from "helmet";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { toNodeHandler } from "better-auth/node";
import { auth } from "./auth";
import { env } from "./env";
import { attachUser } from "./middleware";
import { sqlite } from "./db";
import mediaRouter from "./routes/media";
import groupsRouter from "./routes/groups";
import callsRouter from "./routes/calls";
import accountRouter from "./routes/account";
import paymentsRouter, { paymentWebhookRaw } from "./routes/payments";
import adminRouter from "./routes/admin";
import webhooksRouter from "./routes/webhooks";
import { getVapidPublicKey } from "./notifications";

export function createApp(): Express {
  const app = express();

  app.set("trust proxy", 1);
  app.disable("x-powered-by");

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          imgSrc: ["'self'", "data:", "blob:"],
          mediaSrc: ["'self'", "blob:"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          connectSrc: ["'self'", "wss:", "ws:"],
          workerSrc: ["'self'"],
          manifestSrc: ["'self'"],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
        },
      },
      crossOriginEmbedderPolicy: false,
      crossOriginResourcePolicy: { policy: "cross-origin" },
    }),
  );
  app.use(
    cors({
      origin: (origin, cb) => {
        // same-origin app; allow configured origins for tooling
        if (!origin) return cb(null, true);
        const allowed = [
          env.appUrl,
          env.betterAuthUrl,
          // The two hostnames the app is actually served from (the Cloudflare
          // Worker proxies both to this container). Listed explicitly so CORS
          // keeps exact-match strictness instead of suffix matching.
          "https://app.omnivex-academy.xyz",
          "https://omnivex-academy.xyz",
          "http://localhost:5173",
          "http://127.0.0.1:5173",
        ];
        // Exact origin match only: a suffix test would accept look-alikes such
        // as https://evil-omnivex-academy.xyz with credentials attached.
        const normalized = origin.replace(/\/+$/, "");
        cb(
          null,
          allowed.some((a) => Boolean(a) && a.replace(/\/+$/, "") === normalized),
        );
      },
      credentials: true,
    }),
  );

  /* Paystack webhook must receive the raw body for signature validation */
  app.post("/api/payments/webhook", paymentWebhookRaw);

  /* Resend delivery webhook must receive the raw body (svix signature) */
  app.use(
    "/api/webhooks/resend",
    express.raw({ type: "application/json", limit: "1mb" }),
  );
  app.use(webhooksRouter);

  /* Better Auth handler — must be mounted before body parsers */
  app.all("/api/auth/*splat", toNodeHandler(auth));

  app.use(express.json({ limit: "2mb" }));
  app.use(express.urlencoded({ extended: false }));

  /* Rate limits */
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: env.isTest ? 10000 : 60,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many attempts, please try again later" },
  });
  const uploadLimiter = rateLimit({
    windowMs: 10 * 60 * 1000,
    limit: env.isTest ? 10000 : 60,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many uploads, please slow down" },
  });
  const apiLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: env.isTest ? 100000 : 600,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many requests" },
  });

  app.use("/api/auth", authLimiter);
  app.use("/api", apiLimiter);

  /* Session loading for all API + media routes */
  app.use("/api", attachUser);
  app.use("/media", attachUser);

  /* Lightweight unauthenticated endpoints */
  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, app: "omnivex-academy", time: Date.now() });
  });
  app.get("/api/bootstrap", (req, res) => {
    const u = req.appUser;
    res.json({
      appName: "Omnivex Academy",
      pushPublicKey: getVapidPublicKey(),
      user: u
        ? {
            id: u.id,
            name: u.name,
            email: u.email,
            emailVerified: u.emailVerified,
            isAdmin: u.is_admin,
            membershipStatus: u.membership_status,
            banned: Boolean(u.banned_at),
          }
        : null,
    });
  });

  /* Dev-only: read the last OTP email (never enabled in production) */
  if (!env.isProd) {
    app.get("/api/dev/last-otp", (req: Request, res: Response) => {
      const email = String(req.query.email || "").toLowerCase();
      if (!email) return res.status(400).json({ error: "email query required" });
      const row = sqlite
        .prepare(
          "SELECT body FROM dev_outbox WHERE to_email = ? ORDER BY created_at DESC LIMIT 1",
        )
        .get(email) as { body: string } | undefined;
      if (!row) return res.status(404).json({ error: "No OTP mail found" });
      const m = /code is:? ?(\d{4,8})/i.exec(row.body) || /(\d{4,8})/.exec(row.body);
      res.json({ otp: m ? m[1] : null, body: row.body });
    });
  }

  app.use(mediaRouter); // registers POST /api/uploads and GET /media/*path
  app.use("/api", groupsRouter);
  app.use("/api", callsRouter);
  app.use("/api", accountRouter);
  app.use("/api", paymentsRouter);
  app.use("/api/admin", adminRouter);

  /* Anything else under /api is a 404 */
  app.use("/api", (_req, res) => res.status(404).json({ error: "Not found" }));

  /* Static frontend (production build) with SPA fallback */
  const dist = path.resolve(process.cwd(), "dist");
  if (fs.existsSync(path.join(dist, "index.html"))) {
    app.use(
      express.static(dist, {
        index: false,
        maxAge: "1h",
        setHeaders: (res, filePath) => {
          if (/\.(js|css|woff2?|png|jpg|svg|ico)$/.test(filePath) && /\/assets\//.test(filePath)) {
            res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
          }
          if (filePath.endsWith("sw.js")) {
            res.setHeader("Cache-Control", "no-cache");
          }
        },
      }),
    );
    app.get(/.*/, (req, res, next) => {
      if (req.method !== "GET") return next();
      if (req.path.startsWith("/api") || req.path.startsWith("/socket.io")) return next();
      res.sendFile(path.join(dist, "index.html"));
    });
  } else {
    app.get("/", (_req, res) => {
      res
        .status(200)
        .type("text/plain")
        .send(
          "Omnivex Academy API is running. Frontend build not found — run `npm run build`.",
        );
    });
  }

  /* Final error handler: JSON only, never a stack trace. */
  app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) return next(err);
    const e = err as { status?: number; statusCode?: number; message?: string };
    const status = Number(e?.status || e?.statusCode) || 500;
    if (status >= 500) console.error("[server] unhandled route error:", err);
    res.status(status).json({
      error:
        status >= 500
          ? "Something went wrong on our side. Please try again."
          : e?.message || "Request failed",
    });
  });

  return app;
}
