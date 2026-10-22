#!/usr/bin/env bash
# =============================================================
# Omnivex Academy — one-command container deploy for a small VPS
# Tuned for: 1 vCPU / 1 GB RAM / 2 GB swap / ~35 GB SSD.
# The app runs in Docker so it stays isolated from the other
# apps on the server.
#
#   git pull            (you do this yourself)
#   ./deploy.sh         (this script does the rest)
#
# Helpers:
#   ./deploy.sh logs      tail the app logs
#   ./deploy.sh restart   restart the container
#   ./deploy.sh stop      stop the container
#   ./deploy.sh status    container status
#   ./deploy.sh backup    tar the database + uploads to ./omnivex-backup-*.tar.gz
# =============================================================
set -euo pipefail
cd "$(dirname "$0")"

APP_NAME="omnivex"          # compose service + container name
VOLUME_NAME="omnivex_omnivex-data"  # compose project (name: omnivex) + volume omnivex-data

say()  { echo "==> $*"; }
warn() { echo "!!  $*"; }

# ---- helper subcommands --------------------------------------
case "${1:-deploy}" in
  logs)    exec docker compose logs -f --tail 100 "$APP_NAME" ;;
  restart) exec docker compose restart "$APP_NAME" ;;
  stop)    exec docker compose stop "$APP_NAME" ;;
  status)  exec docker compose ps ;;
  backup)
    ts="$(date +%Y%m%d-%H%M%S)"
    out="omnivex-backup-${ts}.tar.gz"
    docker run --rm -v "$VOLUME_NAME":/data -v "$PWD":/backup alpine \
      tar czf "/backup/$out" -C /data .
    say "Backup written: $out"
    exit 0
    ;;
  deploy) ;;
  *) echo "Usage: $0 [deploy|logs|restart|stop|status|backup]"; exit 2 ;;
esac

echo "==> Omnivex Academy — container deploy"

# ---- 1. Docker present and running? --------------------------
if ! command -v docker >/dev/null 2>&1; then
  warn "Docker is not installed. Install it first:"
  echo "    curl -fsSL https://get.docker.com | sh"
  exit 1
fi
if ! docker compose version >/dev/null 2>&1; then
  warn "Docker Compose v2 ('docker compose') is required but missing."
  exit 1
fi
if ! docker info >/dev/null 2>&1; then
  warn "Cannot talk to the Docker daemon (running? permission?)."
  echo "    sudo usermod -aG docker \"\$USER\"   # then re-login"
  exit 1
fi

# ---- 2. Swap advisory (a 1 GB box needs it to build) ---------
swap_kb="$(awk '/SwapTotal/ {print $2}' /proc/meminfo 2>/dev/null || echo 0)"
if [ "${swap_kb:-0}" -lt 1572864 ]; then
  warn "Swap is ${swap_kb} kB — 2 GB is recommended on a 1 GB box. Once:"
  echo "    sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile"
  echo "    sudo mkswap /swapfile && sudo swapon /swapfile"
  echo "    echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab"
fi

# ---- 3. Secrets ---------------------------------------------
if [ ! -f .env ]; then
  if [ -f env.template ]; then
    cp env.template .env
    echo ""
    warn "Created .env from env.template."
    warn "Fill in the secrets now:   nano .env"
    warn "(ADMIN_PASSWORD and APP_URL at minimum), then run ./deploy.sh again."
    exit 1
  fi
  warn "No .env file found. Create one (see env.template) and run ./deploy.sh again."
  exit 1
fi

# Read only what this script needs — never print secret values.
app_port_raw="$(grep -E '^PORT=' .env | tail -1 | cut -d= -f2- | tr -d '"' | tr -d "'" || true)"
HOST_PORT="${app_port_raw:-3000}"
grep -qE '^ADMIN_PASSWORD[[:space:]]*=[[:space:]]*$' .env \
  && warn "ADMIN_PASSWORD is empty in .env — the bootstrap admin cannot be created."
grep -qE '^APP_URL[[:space:]]*=[[:space:]]*$' .env \
  && warn "APP_URL is empty — email links and Paystack callbacks will be wrong."
true  # grep -q returns 1 when the line is absent; keep set -e happy

# ---- 4. Build the image -------------------------------------
say "Building the container image (npm ci + typecheck + vite build, memory-bounded)"
docker compose build

# ---- 5. (Re)start with the persistent data mount ------------
say "Starting container — database + uploads live on the ${VOLUME_NAME} volume"
docker compose up -d

# ---- 6. Health check ----------------------------------------
printf '==> Waiting for the app on port %s' "$HOST_PORT"
for _ in $(seq 1 45); do
  if curl -fsS "http://127.0.0.1:${HOST_PORT}/api/health" >/dev/null 2>&1; then
    echo ""
    say "✅ Deployed and healthy on port ${HOST_PORT}"
    echo "   URL:      set APP_URL in .env to your domain, then open it"
    echo "   Logs:     ./deploy.sh logs"
    echo "   Restart:  ./deploy.sh restart    Stop: ./deploy.sh stop"
    echo "   Backup:   ./deploy.sh backup     (tar of database + uploads)"
    exit 0
  fi
  echo -n "."
  sleep 2
done

echo ""
warn "The app did not become healthy in 90 seconds."
echo "   Check: ./deploy.sh logs"
exit 1
