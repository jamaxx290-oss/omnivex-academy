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
chmod +x deploy.sh
./deploy.sh     # ONE command: prerequisites → .env prompts → build → start
                # → nginx → Cloudflare DNS/SSL → HTTPS certificate
```

Every deploy after that:


```bash
git pull && ./deploy.sh
```

`deploy.sh` handles the whole box itself — no manual prerequisite steps:

- installs **curl, Docker Engine and the Compose plugin** when they are
  missing (Docker's official `get.docker.com` installer) and starts the
  daemon if it is not running;
- creates a **2 GB swap file** (and wires it into `/etc/fstab`) when the box
  reports under 1.5 GB swap, so the memory-bounded image build survives;
- creates `.env` from `env.template` and, on an interactive terminal, **prompts
  once** for the admin email/password, a generated `BETTER_AUTH_SECRET`, a
  Let's Encrypt email and an optional Cloudflare API token — all saved to
  `.env`, never asked again;
- builds the image, starts the container and waits for `/api/health` (on
  timeout it prints container state, OOM flag and logs);
- **configures nginx** in front of the app (`omnivex-academy.xyz` →
  `127.0.0.1:3000`, WebSocket upgrade, 100 MB uploads, `nginx -t` guarded,
  ufw 80/443 opened when ufw is active);
- **automates Cloudflare** when `CLOUDFLARE_API_TOKEN` is set: creates/updates
  the proxied A record to this server and sets the SSL mode (Flexible now,
  Full (strict) once the certificate exists). Without a token it prints the
  two dashboard steps instead;
- **gets the HTTPS certificate** (certbot + Let's Encrypt on 443, 80 → 443
  redirect) when `LETSENCRYPT_EMAIL` is set — skipped if one already exists;
- finishes by listing any keys you still need to add and the webhook URLs to
  register.

Helper subcommands: `./deploy.sh logs [-f] | restart | stop | status | backup | proxy | tls | doctor`
(`logs` prints the last 200 lines and returns — add `-f` to follow; `restart`
recreates the container so `.env` edits take effect; `backup` writes a
`VACUUM INTO` database snapshot plus an uploads tarball to `./backups/`;
`doctor` is the one-shot crash report: container state, logs, a 30-second
direct boot of the app with its exit code, native-module and tsx-loader
tests, kernel segfault records and memory/swap — run it whenever the app is
down and send the output).

**Domain + HTTPS (Cloudflare):** handled by the plain `./deploy.sh` run —
you only intervene if it prints a manual step. If another web server already
owns port 80, `deploy.sh` recognizes it (nginx, Apache or Caddy) and adds a
vhost/site block for `omnivex-academy.xyz` to **that** server instead —
nothing else on the box is touched, and every change is config-tested before
a reload. Caddy fronts get HTTPS automatically (no certbot); nginx/Apache
get a Let's Encrypt certificate via certbot. Error 525 means Cloudflare
reached the VPS but no origin answered the TLS handshake; `./deploy.sh proxy`
runs just that step on its own, and `./deploy.sh tls you@example.com` runs
just the certificate. With `CLOUDFLARE_API_TOKEN` in `.env` there is nothing
to click in the dashboard at all: the DNS record is created/proxied and the
SSL mode flips from Flexible to Full (strict) automatically.

What the container gives you:

- **Persistent data.** SQLite + uploads live on the named Docker volume
  `omnivex_omnivex-data`, mounted at `/app/data`, so rebuilds never touch your data.
- **Isolation.** `mem_limit: 768m` + a fixed Node heap keep the app inside its
  slice of the box while other services run alongside it.
- **Secrets stay out of the image.** `.env` is passed at runtime via `env_file`
  and excluded from the build context (`.dockerignore`).
- **Health checks.** Docker polls `/api/health` and restarts the container if it
  stops answering.

Environment: `.env` is created from `env.template` on the first run (the
script prompts for `ADMIN_PASSWORD`; `APP_URL` already defaults to
`https://omnivex-academy.xyz`, the root domain). `RESEND_API_KEY`,
`RESEND_WEBHOOK_SECRET` and `PAYSTACK_*` are optional extras the script
reminds you about after each deploy.
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