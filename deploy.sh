#!/usr/bin/env bash
# =============================================================
# Omnivex Academy — one-command container deploy for a small VPS
# Tuned for: 1 vCPU / 1 GB RAM / 2 GB swap / ~35 GB SSD.
# The app runs in Docker so it stays isolated from the other
# apps on the server.
#
# Everything happens in this script — no manual prerequisite
# steps left on the shell:
#   * installs curl / Docker Engine / the Compose plugin if missing
#   * starts the Docker daemon when it is not running
#   * creates a 2 GB swap file when the box has under 1.5 GB swap
#   * creates .env from env.template and prompts for the first-run
#     secrets (admin login + generated auth secret) interactively
#   * builds the image, starts the container, waits for /api/health
#   * prints the keys and webhook URLs you still need to fill in
#
#   git pull            (you do this yourself)
#   ./deploy.sh         (this script does the rest)
#
# Helpers:
#   ./deploy.sh logs      tail the app logs
#   ./deploy.sh restart   recreate the container (applies .env changes)
#   ./deploy.sh stop      stop the container
#   ./deploy.sh status    show container status + health
#   ./deploy.sh backup    snapshot the database + uploads into ./backups
#   ./deploy.sh help      show usage
# =============================================================
set -euo pipefail
cd "$(dirname "$0")"

CMD="${1:-}"

say() { printf '\033[1;35m%s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m%s\033[0m\n' "$*"; }

usage() {
  cat <<'EOF'
Usage: ./deploy.sh [command]

Commands:
  (none)    install prerequisites, build the image, start the app
  logs      follow the app logs (Ctrl-C to stop)
  restart   recreate the container (applies .env changes)
  stop      stop the container
  status    show container status + health
  backup    snapshot database + uploads into ./backups
  help      show this help
EOF
}

case "${CMD}" in
  "") ;;
  help | -h | --help)
    usage
    exit 0
    ;;
  logs | restart | stop | status | backup) ;;
  *)
    usage >&2
    exit 1
    ;;
esac

# ---- small helpers ---------------------------------------------
# Run a privileged command as root (directly, or via passwordless sudo).
run_root() {
  if [ "$(id -u)" = "0" ]; then
    "$@"
  elif command -v sudo >/dev/null 2>&1 && sudo -n true 2>/dev/null; then
    sudo "$@"
  else
    warn "Root is needed for: $*"
    warn "Re-run as root:  sudo ./deploy.sh ${CMD}"
    return 1
  fi
}

get_env_val() {
  if [ ! -f .env ]; then return 0; fi
  awk -v k="$1" 'index($0, k "=") == 1 { print substr($0, length(k) + 2); exit }' .env
}

# set_env KEY VALUE — write KEY=VALUE into .env (replacing or appending).
set_env() {
  local k="$1" v="$2" tmp
  tmp="$(mktemp .env.tmp.XXXXXX)"
  K="$k" V="$v" awk '
    BEGIN { k = ENVIRON["K"]; v = ENVIRON["V"]; done = 0 }
    index($0, k "=") == 1 { print k "=" v; done = 1; next }
    { print }
    END { if (!done) print k "=" v }' .env >"$tmp"
  chmod 600 "$tmp"
  mv "$tmp" .env
}

gen_secret() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -base64 32 | tr -d '\n'
  else
    head -c 48 /dev/urandom | base64 | tr -d '\n'
  fi
}

# ---- 0. Prerequisites (installed here when missing) -----------
ensure_curl() {
  if command -v curl >/dev/null 2>&1; then return 0; fi
  say "curl is missing — installing it…"
  if command -v apt-get >/dev/null 2>&1; then
    run_root apt-get update -y >/dev/null 2>&1 || true
    run_root apt-get install -y curl >/dev/null
  elif command -v dnf >/dev/null 2>&1; then
    run_root dnf install -y curl >/dev/null
  elif command -v yum >/dev/null 2>&1; then
    run_root yum install -y curl >/dev/null
  elif command -v apk >/dev/null 2>&1; then
    run_root apk add curl >/dev/null
  else
    warn "No supported package manager found — install curl manually."
    exit 1
  fi
}

ensure_docker() {
  if command -v docker >/dev/null 2>&1; then return 0; fi
  ensure_curl
  say "Docker is not installed — installing Docker Engine + Compose plugin (one-time)…"
  curl -fsSL https://get.docker.com | run_root sh
  if ! command -v docker >/dev/null 2>&1; then
    warn "Automatic Docker install failed. Install it manually:  curl -fsSL https://get.docker.com | sh"
    exit 1
  fi
  say "Docker installed."
}

DOCKER=(docker)
ensure_daemon() {
  if "${DOCKER[@]}" info >/dev/null 2>&1; then return 0; fi
  if [ "$(id -u)" != "0" ]; then
    if command -v sudo >/dev/null 2>&1 && sudo -n docker info >/dev/null 2>&1; then
      DOCKER=(sudo docker)
      return 0
    fi
    if ! { command -v sudo >/dev/null 2>&1 && sudo -n true 2>/dev/null; }; then
      warn "Cannot reach Docker as $(id -un) and sudo needs a password."
      warn "Re-run as root:  sudo ./deploy.sh ${CMD}"
      exit 1
    fi
  fi
  say "Starting the Docker daemon…"
  if command -v systemctl >/dev/null 2>&1; then
    run_root systemctl enable --now docker >/dev/null 2>&1 || true
  elif command -v service >/dev/null 2>&1; then
    run_root service docker start >/dev/null 2>&1 || true
  fi
  local i
  for i in $(seq 1 15); do
    if "${DOCKER[@]}" info >/dev/null 2>&1; then return 0; fi
    if [ "$(id -u)" != "0" ] && command -v sudo >/dev/null 2>&1 && sudo -n docker info >/dev/null 2>&1; then
      DOCKER=(sudo docker)
      return 0
    fi
    sleep 2
  done
  warn "The Docker daemon did not come up. Check:  systemctl status docker"
  exit 1
}

COMPOSE=()
ensure_compose() {
  if "${DOCKER[@]}" compose version >/dev/null 2>&1; then
    COMPOSE=("${DOCKER[@]}" compose)
    return 0
  fi
  if command -v docker-compose >/dev/null 2>&1; then
    COMPOSE=(docker-compose)
    return 0
  fi
  say "Docker Compose plugin is missing — installing it…"
  if command -v apt-get >/dev/null 2>&1; then
    run_root apt-get update -y >/dev/null 2>&1 || true
    run_root apt-get install -y docker-compose-plugin >/dev/null 2>&1 ||
      run_root apt-get install -y docker-compose-v2 >/dev/null 2>&1 ||
      true
  elif command -v dnf >/dev/null 2>&1; then
    run_root dnf install -y docker-compose-plugin >/dev/null 2>&1 || true
  fi
  if "${DOCKER[@]}" compose version >/dev/null 2>&1; then
    COMPOSE=("${DOCKER[@]}" compose)
    return 0
  fi
  if command -v docker-compose >/dev/null 2>&1; then
    COMPOSE=(docker-compose)
    return 0
  fi
  warn "Docker Compose could not be installed automatically."
  warn "Install it with:  apt-get install -y docker-compose-plugin"
  exit 1
}

# 2 GB swap when the box is under 1.5 GB — created here, not printed.
ensure_swap() {
  local want_kb=1572864 cur_kb
  cur_kb="$(awk '/^SwapTotal:/ {print $2}' /proc/meminfo 2>/dev/null || echo 0)"
  if [ "${cur_kb:-0}" -ge "$want_kb" ]; then return 0; fi
  say "Swap is below 1.5 GB — creating a 2 GB swap file…"
  if run_root test -f /swapfile; then
    if awk 'NR > 1 && $1 == "/swapfile" { found = 1 } END { exit !found }' /proc/swaps; then
      warn "/swapfile already exists and is in use but is small — leaving it alone."
      warn "To grow it (safe order):  swapoff /swapfile && fallocate -l 2G /swapfile && mkswap /swapfile && swapon /swapfile"
      return 0
    fi
    run_root mkswap /swapfile >/dev/null 2>&1 || true
    run_root swapon /swapfile || true
  else
    if ! run_root fallocate -l 2G /swapfile 2>/dev/null; then
      run_root dd if=/dev/zero of=/swapfile bs=1M count=2048 status=none
    fi
    run_root chmod 600 /swapfile
    run_root mkswap /swapfile >/dev/null
    run_root swapon /swapfile
  fi
  if ! grep -qE '^/swapfile ' /etc/fstab 2>/dev/null; then
    run_root sh -c 'echo "/swapfile none swap sw 0 0" >> /etc/fstab'
  fi
  cur_kb="$(awk '/^SwapTotal:/ {print $2}' /proc/meminfo 2>/dev/null || echo 0)"
  say "Swap now: $((cur_kb / 1024)) MB."
}

# ---- 0b. Preflight --------------------------------------------
ensure_docker
ensure_daemon
ensure_compose

# ---- helper subcommands ----------------------------------------
require_env() {
  if [ ! -f .env ]; then
    warn "No .env yet — run ./deploy.sh once to create it."
    exit 1
  fi
}

do_status() {
  require_env
  ensure_curl
  "${COMPOSE[@]}" ps
  local port
  port="$(get_env_val PORT)"
  port="${port:-3000}"
  if curl -fsS "http://127.0.0.1:${port}/api/health" >/dev/null 2>&1; then
    say "✔ healthy — http://127.0.0.1:${port}/api/health is answering"
  else
    warn "✗ /api/health is not answering on port ${port} — logs: ./deploy.sh logs"
    exit 1
  fi
}

do_backup() {
  require_env
  local ts
  ts="$(date +%Y%m%d-%H%M%S)"
  mkdir -p backups
  say "Snapshotting the database (VACUUM INTO)…"
  "${COMPOSE[@]}" exec -T omnivex rm -f /app/data/snapshot.db 2>/dev/null || true
  if ! "${COMPOSE[@]}" exec -T omnivex node --input-type=commonjs -e \
    "const D = require('better-sqlite3'); const s = new D('/app/data/omnivex.db'); s.prepare('VACUUM INTO ?').run('/app/data/snapshot.db'); s.close();"; then
    warn "Database snapshot failed — is the container running? (./deploy.sh status)"
    exit 1
  fi
  "${COMPOSE[@]}" cp omnivex:/app/data/snapshot.db "backups/omnivex-${ts}.db"
  "${COMPOSE[@]}" exec -T omnivex rm -f /app/data/snapshot.db
  say "Copying uploads…"
  if ! "${COMPOSE[@]}" exec -T omnivex tar czf - -C /app/data uploads >"backups/uploads-${ts}.tgz"; then
    warn "Upload copy failed — check ./deploy.sh status"
    exit 1
  fi
  say "✔ backups/omnivex-${ts}.db  +  backups/uploads-${ts}.tgz"
}

# ---- 1. Environment secrets ------------------------------------
deploy() {
  ensure_curl
  local fresh_env=0
  if [ ! -f .env ]; then
    if [ ! -f env.template ]; then
      warn "No .env and no env.template — cannot configure the app."
      exit 1
    fi
    cp env.template .env
    chmod 600 .env
    fresh_env=1
    say ".env created from env.template."
  fi

  if [ -t 0 ]; then
    # Interactive terminal: collect the secrets only you can provide.
    local ans pw cur
    if [ "$fresh_env" = "1" ]; then
      cur="$(get_env_val ADMIN_EMAIL)"
      cur="${cur:-admin@omnivex-academy.xyz}"
      ans=""
      read -r -p "Admin email [$cur]: " ans || true
      if [ -n "$ans" ]; then set_env ADMIN_EMAIL "$ans"; fi
    fi
    if [ -z "$(get_env_val ADMIN_PASSWORD)" ]; then
      pw=""
      read -r -s -p "Admin password (first sign-in): " pw || true
      echo
      if [ -n "$pw" ]; then
        set_env ADMIN_PASSWORD "$pw"
        say "Saved ADMIN_PASSWORD in .env."
      else
        warn "ADMIN_PASSWORD left empty — no admin account will be created."
      fi
    fi
    if [ -z "$(get_env_val BETTER_AUTH_SECRET)" ]; then
      set_env BETTER_AUTH_SECRET "$(gen_secret)"
      say "Generated BETTER_AUTH_SECRET in .env."
    fi
  elif [ "$fresh_env" = "1" ]; then
    warn "Non-interactive shell: fill in .env (at least ADMIN_PASSWORD), then run ./deploy.sh again."
    exit 1
  fi

  # ---- 2. Swap for the memory-bounded build ---------------------
  ensure_swap

  local port
  port="$(get_env_val PORT)"
  port="${port:-3000}"

  # ---- 3. Persistent data folder -------------------------------
  mkdir -p data
  if [ "$(id -u)" = "0" ]; then chown -R 1000:1000 data || true; fi

  # ---- 4. Build + start the container --------------------------
  say "Building the image (bounded memory)…"
  "${COMPOSE[@]}" build --build-arg NODE_OPTIONS=--max-old-space-size=512

  say "Starting the container…"
  "${COMPOSE[@]}" up -d

  # ---- 5. Health check -----------------------------------------
  say "Waiting for the app to become healthy…"
  local i healthy=0
  for i in $(seq 1 40); do
    if curl -fsS "http://127.0.0.1:${port}/api/health" >/dev/null 2>&1; then
      healthy=1
      break
    fi
    sleep 3
  done
  if [ "$healthy" != "1" ]; then
    warn "The app did not answer /api/health in time. Logs:"
    "${COMPOSE[@]}" logs --tail=120
    exit 1
  fi

  say "✔ Omnivex Academy is up on port ${port}"
  "${COMPOSE[@]}" ps
  reminders
}

# ---- 6. What is still missing / what to register ---------------
reminders() {
  local port app_url
  port="$(get_env_val PORT)"
  port="${port:-3000}"
  app_url="$(get_env_val APP_URL)"
  if [ -z "$app_url" ]; then app_url="http://localhost:${port}"; fi

  echo
  if [ -z "$(get_env_val ADMIN_PASSWORD)" ]; then
    warn "• ADMIN_PASSWORD is empty in .env — no admin account exists. Add it, then ./deploy.sh restart"
  fi
  if [ -z "$(get_env_val RESEND_API_KEY)" ]; then
    warn "• RESEND_API_KEY is empty — sign-up OTP and password-reset emails will fail. Add it, then ./deploy.sh restart"
  elif [ -z "$(get_env_val RESEND_WEBHOOK_SECRET)" ]; then
    warn "• RESEND_WEBHOOK_SECRET is empty — delivery webhooks are rejected. Add it, then ./deploy.sh restart"
  else
    say "• Resend webhook to register: ${app_url}/api/webhooks/resend"
  fi
  if [ -z "$(get_env_val PAYSTACK_SECRET_KEY)" ]; then
    warn "• PAYSTACK_SECRET_KEY is empty — checkout is disabled. Add it, then ./deploy.sh restart"
  else
    say "• Paystack webhook to register: ${app_url}/api/payments/webhook"
  fi
  echo
  say "Helpers: ./deploy.sh logs | restart | stop | status | backup"
}

case "$CMD" in
  "") deploy ;;
  logs)
    require_env
    exec "${COMPOSE[@]}" logs -f --tail=200
    ;;
  restart)
    require_env
    say "Recreating the container (applies .env changes)…"
    "${COMPOSE[@]}" up -d --force-recreate
    say "✔ restarted — health: ./deploy.sh status"
    ;;
  stop)
    require_env
    "${COMPOSE[@]}" down
    say "✔ stopped"
    ;;
  status) do_status ;;
  backup) do_backup ;;
esac
