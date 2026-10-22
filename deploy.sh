#!/usr/bin/env bash
# =============================================================
# Omnivex Academy — one-command deploy for a small VPS/container
# (designed for 1 vCPU / 1 GB RAM / ~35 GB disk)
#
#   1. git pull            (you do this yourself)
#   2. ./deploy.sh         (this script does the rest)
#
# What it does: installs dependencies, builds the frontend, keeps the
# database + uploads on the persistent data folder, and starts/restarts
# the backend under pm2 with the secrets from .env.
# =============================================================
set -euo pipefail

cd "$(dirname "$0")"

APP_NAME="omnivex"
APP_PORT="${PORT:-3000}"

echo "==> Omnivex Academy deploy"

# ---- 1. Environment secrets --------------------------------
if [ ! -f .env ]; then
  if [ -f env.template ]; then
    cp env.template .env
    echo ""
    echo "!! Created .env from env.template."
    echo "!! Fill in the secrets now:   nano .env"
    echo "!! (ADMIN_PASSWORD and APP_URL at minimum), then run ./deploy.sh again."
    exit 1
  fi
  echo "!! No .env file found. Create one (see env.template) and run ./deploy.sh again."
  exit 1
fi

# Pull the values into this shell (the app also reads them at runtime)
set -a
# shellcheck disable=SC1091
. ./.env
set +a
APP_PORT="${PORT:-3000}"

# Warn about obviously-unfilled essentials
if [ -z "${ADMIN_PASSWORD:-}" ]; then
  echo "!! ADMIN_PASSWORD is empty in .env — the bootstrap admin cannot be created."
fi

# ---- 2. Dependencies ---------------------------------------
if [ ! -d node_modules ] || [ package-lock.json -nt node_modules ]; then
  echo "==> Installing dependencies (npm ci)"
  npm ci --no-audit --no-fund
else
  echo "==> Dependencies up to date"
fi

# ---- 3. Build the frontend (bounded memory for 1 GB boxes) --
echo "==> Building frontend (typecheck + vite build)"
NODE_OPTIONS="--max-old-space-size=512" npm run build

# ---- 4. Persistent data folder (SQLite + uploads) ----------
DATA_DIR_PATH="${DATA_DIR:-./data}"
mkdir -p "$DATA_DIR_PATH/uploads"
echo "==> Data folder: $DATA_DIR_PATH (database + uploads live here)"

# ---- 5. Process manager ------------------------------------
if ! command -v pm2 >/dev/null 2>&1; then
  echo "==> Installing pm2"
  npm install -g pm2 --no-audit --no-fund
fi

# ---- 6. Start / restart the backend ------------------------
export NODE_ENV="${NODE_ENV:-production}"
export PORT="$APP_PORT"

if pm2 describe "$APP_NAME" >/dev/null 2>&1; then
  echo "==> Restarting $APP_NAME"
  pm2 restart "$APP_NAME" --update-env
else
  echo "==> Starting $APP_NAME"
  pm2 start npm --name "$APP_NAME" --cwd "$PWD" -- start
fi
pm2 save >/dev/null 2>&1 || true

# Best effort: survive a reboot when systemd is available
if command -v systemctl >/dev/null 2>&1 && systemctl is-system-running >/dev/null 2>&1; then
  pm2 startup systemd -u "$(whoami)" --hp "$HOME" >/dev/null 2>&1 || true
  pm2 save >/dev/null 2>&1 || true
fi

# ---- 7. Health check ---------------------------------------
echo -n "==> Waiting for the app"
for _ in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:${APP_PORT}/api/health" >/dev/null 2>&1; then
    echo ""
    echo "✅ Deployed and healthy on port ${APP_PORT}"
    echo "   APP_URL in .env: $(grep -E '^APP_URL=' .env | cut -d= -f2- || echo '(not set)')"
    echo "   Logs anytime:    pm2 logs ${APP_NAME} --lines 40"
    exit 0
  fi
  echo -n "."
  sleep 1
done

echo ""
echo "❌ The app did not become healthy in 30 seconds."
echo "   Check: pm2 logs ${APP_NAME} --lines 40"
exit 1
