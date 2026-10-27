# Omnivex Academy

Self-hosted **Amazon KDP mentorship & community platform** (PWA) for Omnivex:
email/OTP auth, gated mentorship groups, DMs, voice notes/images/video in chat,
**document attachments (PDF/DOCX/… that open in an external app)**, calls,
announcements, web push, broadcast email (Resend), and one-time Paystack
membership activation.

- **Stack:** React 19 + Vite 8 + Tailwind v4 (frontend), Express 5 + Socket.IO,
  better-auth + Drizzle + SQLite (backend), `node-cron`-style scheduler not used.
- **Preview commands:** `install: npm install` · `start: npm start` (API + built
  `dist/` on `PORT`) · `build: npm run build` (typecheck + vite build → `dist/`).
- **Sign-up fields:** full name, WhatsApp number, country, state/region, gender.
- **Logo source of truth:** `public/logo.svg` (white compass ring, violet accent
  arc and needle on transparent background) plus exported `public/logo.png`.
- **Emails:** all templates live in `src/server/emailTemplates.ts`, styled with
  the brand tokens declared in `src/server/emailTheme.ts`. Every template takes
  a preheader, a headline, human-readable intro copy and an optional CTA.
- **Auth screens** (`src/pages/Auth.tsx`) use a light gradient background
  (`#eef2ff → #e0e7ff → #f5f3ff`), a floating canvas-colored card that overlaps
  a left-side brand hero, violet accents and semantic field labels.

## Deploy to a VPS (one command)

The app is containerised, so it stays isolated from the other apps on your
server. It is sized for a small box: **1 vCPU / 1 GB RAM / 2 GB swap / 35 GB SSD**
(the image build is memory-bounded and the runtime heap is capped).

First time only:

```bash
curl -fsSL https://get.docker.com | sh   # if Docker isn't installed
chmod +x deploy.sh
./deploy.sh                              # creates .env from env.template → fill it → run again
```

Every deploy after that:

```bash
git pull && ./deploy.sh
```

`deploy.sh` installs nothing exotic: it checks Docker/Compose, warns if swap is
below 1.5 GB (and prints the 2 GB swap one-liner), builds the image, starts the
container, waits for `/api/health`, and prints status. Helper subcommands:
`./deploy.sh logs | restart | stop | status | backup`.

What the container gives you:

- **Persistent data.** SQLite + uploads live on the named Docker volume
  `omnivex_omnivex-data`, mounted at `/app/data`, so rebuilds never touch your data.
- **Isolation.** `mem_limit: 768m` + a fixed Node heap keep the app inside its
  slice of the box while other services run alongside it.
- **Secrets stay out of the image.** `.env` is passed at runtime via `env_file`
  and excluded from the build context (`.dockerignore`).
- **Health checks.** Docker polls `/api/health` and restarts the container if it
  stops answering.

Environment: fill `.env` from `env.template` — at minimum `ADMIN_PASSWORD`
(`APP_URL` already defaults to `https://omnivex-academy.xyz`, the root domain;
`PAYSTACK_*` and `RESEND_API_KEY` are optional extras).
If you already have a `./data/omnivex.db` from the old pm2 setup, copy it into
the volume before first start:

```bash
docker compose down 2>/dev/null || true
docker run --rm -v "$PWD/data:/src" -v omnivex_omnivex-data:/dst alpine \
  sh -c "cp -a /src/. /dst/ && chown -R 1000:1000 /dst"
```

## Development

```bash
npm install
npm run dev      # frontend only → http://localhost:5173 (needs the API running too)
npm start        # API + built dist/ → http://127.0.0.1:3000 (root domain via your reverse proxy)
npm run typecheck
npm test         # end-to-end suite over the real express app + sqlite
npm run build    # typecheck + vite build
```

Earlier handoff notes: `.logo-preview.png` / `logo-preview.png` / `run.js` /
`score.js` / `score2.js` are throwaway logo-generation scratch files from a prior
task and are not part of the app. `isolate/assets/` is a stale generated bundle
snapshot from that scratch work, also ignored by git.