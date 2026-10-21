# Omnivex Academy

A premium, mobile-first mentorship & community platform for Amazon KDP authors:
real-time group chats and DMs, email-OTP authentication, naira payments through
Paystack, web push notifications, and a full admin panel — packaged as an
installable PWA.

## Stack

- **Frontend:** React 19 + Vite + TypeScript, TanStack Query, Tailwind CSS v4,
  Socket.IO client, vite-plugin-pwa (injectManifest)
- **Backend:** Express 5, Better Auth (Drizzle adapter, email-OTP plugin),
  Drizzle ORM, Socket.IO, web-push, Zod, multer
- **Database:** SQLite (better-sqlite3) with ordered, idempotent migrations
- **Payments:** Paystack (initialize → redirect → server-side verify + webhook)

## Quick start

```bash
npm install
cp README-env.md .env    # then edit the values — see below
npm run dev              # API on :3000, Vite dev server on :5173
```

Production-style run (single process serving API + built frontend):

```bash
npm run build            # typecheck + icons + vite build → dist/
npm start                # Express serves dist/ + /api + /socket.io on $PORT
```

Other scripts: `npm test` (integration suite), `npm run typecheck`,
`npm run icons` (regenerates the PWA icon set with zero dependencies).

## Environment variables

Copy this block into `.env` (see `.env.example` conventions) and edit it:

```bash
# App
PORT=3000
APP_URL=http://localhost:3000          # public URL (used in Paystack callbacks)
BETTER_AUTH_URL=http://localhost:3000
BETTER_AUTH_SECRET=change-me-to-a-long-random-string

# Data (optional — defaults shown)
# DATA_DIR=./data
# DATABASE_URL=./data/omnivex.db

# Admin bootstrap: created or promoted to admin on first boot (never hardcoded)
ADMIN_EMAIL=founder@example.com
ADMIN_PASSWORD=choose-a-strong-password

# Membership price in kobo until changed in the admin panel (₦5,000 = 500000)
MEMBERSHIP_PRICE_KOBO=500000

# Transactional email + broadcasts (Resend). The sending domain
# (omnivex.manuskripta.xyz) must be verified in the Resend dashboard first.
# Without a key, outgoing mail is captured in the dev_outbox table; in
# development the OTP is readable at GET /api/dev/last-otp?email=you@example.com
RESEND_API_KEY=
RESEND_FROM_NAME="Omnivex Academy"
RESEND_FROM_EMAIL=hello@omnivex.manuskripta.xyz
# Signing secret from Resend → Webhooks (starts with whsec_). Enables
# POST /api/webhooks/resend → live delivered/bounced status in the admin panel.
RESEND_WEBHOOK_SECRET=

# Payments (Paystack). Checkout stays disabled until both keys are set.
PAYSTACK_SECRET_KEY=
PAYSTACK_PUBLIC_KEY=

# Web push (VAPID). Auto-generated and persisted in the database when unset.
VAPID_SUBJECT=mailto:admin@omnivex.academy
```

> `.env` / `.env.local` are loaded automatically by the Freebuff environment.
> Never commit real secrets.

## Product flows

1. **Join** — sign up with name/email/password → 6-digit OTP emailed by Resend →
   `/verify` auto-submits the code → session established.
2. **Activate** — paywall shows the current price and terms (versioned; members
   must accept the latest version). Paystack checkout opens; on return,
   `/pay/callback` verifies the reference **server-side** before granting
   access. The webhook is HMAC-SHA512 signature-checked and idempotent, so
   activation works even if the browser never returns.
3. **Community** — mentorship groups with unread badges, replies with
   jump-to-message, image/video upload, voice notes (MediaRecorder), emoji, and
   1:1 DMs — all live through Socket.IO rooms (`group:<id>`, `dm:<id>`,
   `user:<id>`).
4. **Admin panel** (`/admin`) — dashboard stats, member search + actions
   (grant/revoke membership, ban/unban, set expiry, resend verification,
   delete), group management (create/edit/archive, member rosters, post
   policies), payment records with re-verification, pricing & terms editor,
   one-click announcements with push delivery, and an **Email studio**: a
   tap-in HTML snippet composer (headings, paragraphs, buttons, cards,
   callouts, images) with live inbox preview, test sends, broadcasts to every
   active member through the premium template, per-recipient delivery status
   from Resend webhooks, and copy-ready webhook URLs for the Resend and
   Paystack dashboards.

## Security notes

- Media files are stored outside the web root and served through
  `/media/*` with per-user ACL checks (owner, group members, conversation
  participants, admins) and HTTP Range support.
- Admin routes read the role from the database on every request; there is no
  client-side path to grant it.
- Banning revokes all sessions but keeps credentials, so unban restores access.
- Password changes revoke every session, then require a fresh sign-in.
- Rate limits: 60 requests/15min on `/api/auth`, 60 uploads/10min, and a global
  600/min API limiter (relaxed automatically in tests).

## PWA

`vite-plugin-pwa` (injectManifest) compiles `src/sw.ts`, which precaches the
build, serves an offline shell, and renders web-push notifications
(with click-through focus). Icons are generated by
`scripts/generate-icons.mjs` (pure Node, no image dependencies) during build.
