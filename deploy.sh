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
#     secrets (admin login, generated auth secret, Let's Encrypt email,
#     optional Cloudflare API token) interactively — once
#   * builds the image, starts the container, waits for /api/health
#   * installs + configures nginx in front of the app (port 80)
#   * points Cloudflare at the server (DNS record, proxied) and sets the
#     SSL mode automatically when CLOUDFLARE_API_TOKEN is in .env
#   * gets a Let's Encrypt certificate on 443 (certbot) for Full (strict)
#   * prints only the keys and webhook URLs you still need to fill in
#
#   git pull            (you do this yourself)
#   ./deploy.sh         (this script does ALL of the above)
#
# Helpers:
#   ./deploy.sh logs      tail the app logs
#   ./deploy.sh restart   recreate the container (applies .env changes)
#   ./deploy.sh stop      stop the container
#   ./deploy.sh status    show container status + health
#   ./deploy.sh backup    snapshot the database + uploads into ./backups
#   ./deploy.sh proxy     install/configure nginx in front of the app (port 80)
#   ./deploy.sh tls       get a Let's Encrypt certificate via certbot (443)
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
  (none)    everything: prerequisites → build → start → nginx → Cloudflare
            DNS/SSL mode → HTTPS certificate → summary
  logs      follow the app logs (Ctrl-C to stop)
  restart   recreate the container (applies .env changes)
  stop      stop the container
  status    show container status + health
  backup    snapshot database + uploads into ./backups
  proxy     nginx in front of the app (fixes Cloudflare error 525)
  tls EMAIL get a Let's Encrypt certificate on 443 (Cloudflare Full strict)
  help      show this help
EOF
}

case "${CMD}" in
  "") ;;
  help | -h | --help)
    usage
    exit 0
    ;;
  logs | restart | stop | status | backup | proxy | tls) ;;
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

# ---- nginx in front of the app (Cloudflare origin) ------------
setup_proxy() {
  ensure_curl
  local domain="omnivex-academy.xyz"
  local port conf_path conf_link="0" tmp listeners fullcfg

  port="$(get_env_val PORT)"
  port="${port:-3000}"

  if ! command -v nginx >/dev/null 2>&1; then
    listeners="$(ss -H -ltn 2>/dev/null | awk '{print $4}' | grep -E ':80$' || true)"
    if [ -n "$listeners" ]; then
      warn "Port 80 is already used by a service that is not nginx:"
      printf '%s\n' "$listeners"
      warn "Make that server proxy to http://127.0.0.1:${port} for ${domain}, or free port 80 and re-run ./deploy.sh proxy."
      exit 1
    fi
    say "Installing nginx…"
    if command -v apt-get >/dev/null 2>&1; then
      run_root apt-get update -y >/dev/null 2>&1 || true
      run_root apt-get install -y nginx >/dev/null
    elif command -v dnf >/dev/null 2>&1; then
      run_root dnf install -y nginx >/dev/null
    elif command -v yum >/dev/null 2>&1; then
      run_root yum install -y nginx >/dev/null
    else
      warn "No supported package manager — install nginx yourself, then re-run ./deploy.sh proxy."
      exit 1
    fi
  fi

  # Debian keeps extra includes in nginx.conf (conf.d), RHEL uses conf.d too;
  # fall back to the sites-available/sites-enabled layout when present.
  if grep -qs 'conf\.d' /etc/nginx/nginx.conf; then
    conf_path="/etc/nginx/conf.d/omnivex-academy.conf"
  elif [ -d /etc/nginx/sites-available ]; then
    conf_path="/etc/nginx/sites-available/omnivex-academy"
    conf_link="1"
  else
    conf_path="/etc/nginx/conf.d/omnivex-academy.conf"
  fi

  tmp="$(mktemp .nginx.tmp.XXXXXX)"
  cat >"$tmp" <<NGINX
# Managed by ./deploy.sh proxy — regenerate any time with: ./deploy.sh proxy
map \$http_upgrade \$omnivex_connection {
    default upgrade;
    ''      close;
}
server {
    listen 80;
    listen [::]:80;
    server_name ${domain} www.${domain};

    # Voice notes, images and video attachments in chat.
    client_max_body_size 100m;

    location / {
        proxy_pass http://127.0.0.1:${port};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection \$omnivex_connection;
        proxy_read_timeout 120s;
        proxy_send_timeout 120s;
        proxy_buffering off;
    }
}
NGINX
  run_root install -m 644 "$tmp" "$conf_path"
  rm -f "$tmp"
  if [ "$conf_link" = "1" ]; then
    run_root ln -sf "$conf_path" /etc/nginx/sites-enabled/omnivex-academy
  fi

  # Validate before touching the running server; roll back if it is broken.
  if ! run_root nginx -t; then
    warn "nginx config test failed — our file was removed; existing sites are untouched."
    run_root rm -f "$conf_path"
    if [ "$conf_link" = "1" ]; then
      run_root rm -f /etc/nginx/sites-enabled/omnivex-academy
    fi
    exit 1
  fi

  # Is our server block actually included?
  fullcfg="$(run_root nginx -T 2>/dev/null || true)"
  case "$fullcfg" in
    *"server_name ${domain}"*) ;;
    *)
      warn "Our server block is not in the effective nginx config (conf.d is not included?)."
      warn "Merge ${conf_path} into your nginx http {} config and reload nginx."
      exit 1
      ;;
  esac

  if command -v systemctl >/dev/null 2>&1; then
    run_root systemctl enable nginx >/dev/null 2>&1 || true
    if systemctl is-active --quiet nginx 2>/dev/null; then
      run_root systemctl reload nginx
    else
      run_root systemctl start nginx
    fi
  elif command -v service >/dev/null 2>&1; then
    if service nginx status >/dev/null 2>&1; then
      run_root service nginx reload
    else
      run_root service nginx start
    fi
  else
    run_root nginx -s reload 2>/dev/null || run_root nginx
  fi

  if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q '^Status: active'; then
    run_root ufw allow 80/tcp >/dev/null 2>&1 || true
    run_root ufw allow 443/tcp >/dev/null 2>&1 || true
    say "ufw: allowed ports 80 and 443."
  fi

  if curl -fsS --max-time 5 -H "Host: ${domain}" "http://127.0.0.1/api/health" >/dev/null 2>&1; then
    say "✔ nginx front is live: http://${domain} → 127.0.0.1:${port}"
  else
    warn "nginx is configured, but the app did not answer on 127.0.0.1:${port}."
    warn "Container down? Check ./deploy.sh status / ./deploy.sh logs, then re-run ./deploy.sh proxy."
  fi
}

# ---- Let's Encrypt certificate (Cloudflare Full strict) --------
do_tls() {
  local email="${1:-}"
  local domain="omnivex-academy.xyz"

  if ! command -v nginx >/dev/null 2>&1; then
    warn "nginx is not installed — run ./deploy.sh proxy first."
    return 1
  fi
  if ! command -v certbot >/dev/null 2>&1; then
    say "Installing certbot + the nginx plugin…"
    if command -v apt-get >/dev/null 2>&1; then
      run_root apt-get update -y >/dev/null 2>&1 || true
      run_root apt-get install -y certbot python3-certbot-nginx >/dev/null
    elif command -v dnf >/dev/null 2>&1; then
      run_root dnf install -y certbot python3-certbot-nginx >/dev/null
    elif command -v yum >/dev/null 2>&1; then
      run_root yum install -y certbot python3-certbot-nginx >/dev/null
    fi
  fi
  if ! command -v certbot >/dev/null 2>&1; then
    warn "certbot could not be installed — issue the certificate manually: certbot --nginx -d ${domain}"
    return 1
  fi

  if [ -z "$email" ] && [ -t 0 ]; then
    read -r -p "Email for Let's Encrypt expiry notices: " email || true
  fi
  if [ -z "$email" ]; then
    warn "An email is required:  ./deploy.sh tls you@example.com"
    return 1
  fi

  say "Requesting a certificate for ${domain}…"
  if ! run_root certbot --nginx -d "$domain" --non-interactive --agree-tos -m "$email" --redirect; then
    warn "certbot failed. Common causes: DNS not propagated yet, or a Cloudflare WAF/bot rule"
    warn "blocking /.well-known/acme-challenge. Retry later, or run interactively:"
    warn "  certbot --nginx -d ${domain}"
    return 1
  fi

  say "✔ Certificate installed (80 → 443 redirect enabled)."
  say "Now set Cloudflare → SSL/TLS → Overview to Full (strict)."
}

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
    if [ -z "$(get_env_val LETSENCRYPT_EMAIL)" ]; then
      ans=""
      read -r -p "Email for Let's Encrypt (blank = skip automatic HTTPS): " ans || true
      if [ -n "$ans" ]; then set_env LETSENCRYPT_EMAIL "$ans"; fi
    fi
    if [ -z "$(get_env_val CLOUDFLARE_API_TOKEN)" ]; then
      ans=""
      read -r -s -p "Cloudflare API token (blank = do DNS/SSL steps manually): " ans || true
      echo
      if [ -n "$ans" ]; then
        set_env CLOUDFLARE_API_TOKEN "$ans"
        say "Saved CLOUDFLARE_API_TOKEN — DNS + SSL mode will be automated."
      fi
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
  for i in $(seq 1 60); do
    if curl -fsS "http://127.0.0.1:${port}/api/health" >/dev/null 2>&1; then
      healthy=1
      break
    fi
    sleep 3
  done
  if [ "$healthy" != "1" ]; then
    warn "The app did not answer /api/health in time."
    warn "--- container state (crash / OOM / restarts) ---"
    "${COMPOSE[@]}" ps -a || true
    "${DOCKER[@]}" inspect omnivex --format 'state={{.State.Status}} exit={{.State.ExitCode}} oom={{.State.OOMKilled}} restarts={{.RestartCount}} error={{.State.Error}}' 2>/dev/null || true
    warn "--- logs ---"
    "${COMPOSE[@]}" logs --tail=150 || true
    exit 1
  fi

  say "✔ Omnivex Academy is up on port ${port}"
  "${COMPOSE[@]}" ps

  # ---- 6. nginx in front of the app ---------------------------
  say "Configuring nginx in front of the app…"
  setup_proxy

  # ---- 7. Cloudflare: DNS record + SSL mode -------------------
  local cert_ready=0
  if has_cert; then cert_ready=1; fi
  cf_init
  if [ -n "$cf_zone_id" ]; then
    cf_ensure_dns
    if [ "$cert_ready" = "1" ]; then cf_set_ssl strict; else cf_set_ssl flexible; fi
  else
    cf_hint
  fi

  # ---- 8. HTTPS certificate (Let's Encrypt) -------------------
  if [ "$cert_ready" = "1" ]; then
    say "✔ TLS certificate already installed."
  else
    local le_email
    le_email="$(get_env_val LETSENCRYPT_EMAIL)"
    if [ -z "$le_email" ] && [ -t 0 ]; then
      read -r -p "Email for Let's Encrypt: " le_email || true
    fi
    if [ -n "$le_email" ]; then
      say "Requesting the HTTPS certificate…"
      if do_tls "$le_email"; then
        cert_ready=1
      else
        warn "Certificate not issued — the site still works over HTTP; retry with ./deploy.sh tls <email>."
      fi
    else
      warn "No Let's Encrypt email — no certificate yet (./deploy.sh tls you@example.com)."
    fi
  fi
  if [ "$cert_ready" = "1" ] && [ -n "$cf_zone_id" ]; then
    cf_set_ssl strict
  fi

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
  if [ ! -f /etc/nginx/conf.d/omnivex-academy.conf ] && [ ! -f /etc/nginx/sites-enabled/omnivex-academy ]; then
    warn "• No nginx front-end yet — if the domain shows Cloudflare error 525, run ./deploy.sh proxy"
  fi
  echo
  say "Helpers: ./deploy.sh logs | restart | stop | status | backup | proxy | tls"
}

# ---- Cloudflare (automated when CLOUDFLARE_API_TOKEN is set) ----
CF_API="https://api.cloudflare.com/client/v4"
cf_token=""
cf_zone_id=""

cf_call() {
  local method="$1" path="$2" body="${3:-}"
  if [ -n "$body" ]; then
    curl -sS --max-time 20 -X "$method" "${CF_API}${path}" \
      -H "Authorization: Bearer ${cf_token}" \
      -H "Content-Type: application/json" --data "$body"
  else
    curl -sS --max-time 20 -X "$method" "${CF_API}${path}" \
      -H "Authorization: Bearer ${cf_token}"
  fi
}

cf_ok() { printf '%s' "$1" | grep -q '"success"[[:space:]]*:[[:space:]]*true'; }

# Resolve the zone id once; falls back to "manual" mode when unavailable.
cf_init() {
  cf_token="$(get_env_val CLOUDFLARE_API_TOKEN)"
  cf_zone_id=""
  if [ -z "$cf_token" ]; then return 0; fi
  local resp
  resp="$(cf_call GET "/zones?name=omnivex-academy.xyz" || true)"
  if ! cf_ok "$resp"; then
    warn "Cloudflare API token rejected — falling back to manual dashboard steps."
    cf_token=""
    return 0
  fi
  cf_zone_id="$(printf '%s' "$resp" | grep -o '"id":"[a-f0-9]\{32\}"' | head -1 | cut -d'"' -f4 || true)"
  if [ -z "$cf_zone_id" ]; then
    warn "No Cloudflare zone for omnivex-academy.xyz with this token — falling back to manual steps."
    cf_token=""
  fi
}

# Make sure the A record exists, points at this server and is proxied.
cf_ensure_dns() {
  local ip resp record_id
  ip="$(curl -4 -sS --max-time 10 https://api.ipify.org 2>/dev/null || true)"
  if [ -z "$ip" ]; then
    warn "Could not detect this server's public IP — create the A record manually."
    return 0
  fi
  resp="$(cf_call GET "/zones/${cf_zone_id}/dns_records?type=A&name=omnivex-academy.xyz" || true)"
  if ! cf_ok "$resp"; then
    warn "Cloudflare DNS lookup failed — create the A record manually."
    return 0
  fi
  record_id="$(printf '%s' "$resp" | grep -o '"id":"[a-f0-9]\{32\}"' | head -1 | cut -d'"' -f4 || true)"
  if [ -n "$record_id" ]; then
    resp="$(cf_call PATCH "/zones/${cf_zone_id}/dns_records/${record_id}" \
      "{\"type\":\"A\",\"name\":\"omnivex-academy.xyz\",\"content\":\"${ip}\",\"ttl\":1,\"proxied\":true}" || true)"
  else
    resp="$(cf_call POST "/zones/${cf_zone_id}/dns_records" \
      "{\"type\":\"A\",\"name\":\"omnivex-academy.xyz\",\"content\":\"${ip}\",\"ttl\":1,\"proxied\":true}" || true)"
  fi
  if cf_ok "$resp"; then
    say "✔ Cloudflare DNS: omnivex-academy.xyz → ${ip} (proxied)"
  else
    warn "Could not write the DNS record — set omnivex-academy.xyz → ${ip}, Proxied, manually."
  fi
}

# cf_set_ssl flexible|strict  — Cloudflare → SSL/TLS → Overview.
cf_set_ssl() {
  local mode="$1" resp
  if [ -z "$cf_zone_id" ]; then return 0; fi
  resp="$(cf_call PATCH "/zones/${cf_zone_id}/settings/ssl" "{\"value\":\"${mode}\"}" || true)"
  if cf_ok "$resp"; then
    say "✔ Cloudflare SSL mode: ${mode}"
  else
    warn "Could not set the SSL mode — choose ${mode} in SSL/TLS → Overview."
  fi
}

cf_hint() {
  warn "No CLOUDFLARE_API_TOKEN in .env — do these two clicks in the Cloudflare dashboard:"
  warn "  1. DNS → omnivex-academy.xyz → A record to this server, status Proxied (orange cloud)"
  warn "  2. SSL/TLS → Overview → Encryption mode: Flexible now, Full (strict) after HTTPS"
}

has_cert() { run_root test -f /etc/letsencrypt/live/omnivex-academy.xyz/fullchain.pem 2>/dev/null; }

# ---- commands that do not need Docker --------------------------
case "$CMD" in
  proxy)
    require_env
    setup_proxy
    cf_init
    if [ -n "$cf_zone_id" ]; then
      cf_ensure_dns
      if has_cert; then cf_set_ssl strict; else cf_set_ssl flexible; fi
    else
      cf_hint
    fi
    exit 0
    ;;
  tls)
    require_env
    rc=0
    do_tls "${2:-}" || rc=1
    if [ "$rc" = "0" ]; then
      cf_init
      if [ -n "$cf_zone_id" ]; then cf_set_ssl strict; else cf_hint; fi
    fi
    exit "$rc"
    ;;
esac

# ---- 0b. Preflight ---------------------------------------------
ensure_docker
ensure_daemon
ensure_compose

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
