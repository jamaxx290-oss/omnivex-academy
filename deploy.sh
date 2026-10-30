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
#   * puts the web server already on port 80 in front of the app
#     (nginx / Apache / Caddy are all recognized and wired up; nginx is
#     installed only when port 80 is free)
#   * when port 80/443 is held by a service it may not touch, falls back to
#     a Cloudflare Worker front (edge TLS → a port published only by this
#     app's container); force it with PROXY_MODE=worker in .env
#   * points Cloudflare at the server (DNS record, proxied) and sets the
#     SSL mode automatically when CLOUDFLARE_API_TOKEN is in .env
#   * gets a Let's Encrypt certificate on 443 (certbot) for Full (strict)
#   * prints only the keys and webhook URLs you still need to fill in
#
#   git pull            (you do this yourself)
#   ./deploy.sh         (this script does ALL of the above)
#
# Helpers:
#   ./deploy.sh logs      show the last 200 app log lines (-f to follow)
#   ./deploy.sh restart   recreate the container (applies .env changes)
#   ./deploy.sh stop      stop the container
#   ./deploy.sh status    show container status + health
#   ./deploy.sh doctor    one-shot crash report (state, logs, boot test,
#                         native-module test, kernel segfaults, memory)
#   ./deploy.sh backup    snapshot the database + uploads into ./backups
#   ./deploy.sh proxy     install/configure nginx in front of the app (port 80)
#   ./deploy.sh worker    ONE-TIME Cloudflare Worker front, driven entirely by
#                         the token in .env: origin port + Worker + routes +
#                         DNS + SSL mode (idempotent — safe to re-run)
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
  logs [-f]  show the last 200 app log lines (-f follows live output)
  restart   recreate the container (applies .env changes)
  stop      stop the container
  status    show container status + health
  backup    snapshot database + uploads into ./backups
  proxy     reverse proxy in front of the app (fixes Cloudflare error 525);
            falls back to a Cloudflare Worker when port 80/443 is blocked
  worker    ONE-TIME Cloudflare Worker front: publishes this app's origin port,
            uploads the Worker, attaches the routes, creates the DNS record and
            keeps the zone on Full — everything from CLOUDFLARE_API_TOKEN in
            .env, no dashboard clicks; re-running only re-applies the same state
  tls EMAIL get a Let's Encrypt certificate on 443 (Cloudflare Full strict)
  doctor    one-shot crash report — run this when the app is down
  help      show this help
EOF
}

case "${CMD}" in
  "") ;;
  help | -h | --help)
    usage
    exit 0
    ;;
  logs | restart | stop | status | backup | proxy | tls | worker | doctor) ;;
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

# ---- reverse proxy in front of the app (Cloudflare origin) -----
# What is holding port 80? Sets port80_line (ss output) + port80_owner.
port80_line=""
port80_owner=""
front_server=""

port80_info() {
  port80_line="$(ss -H -ltnp 2>/dev/null | awk '$4 ~ /:80$/' | head -1 || true)"
  port80_owner="$(printf '%s' "$port80_line" | sed -n 's/.*users:(("\([^"]*\)".*/\1/p')"
}

# nginx: manage it directly. otherwise reuse whatever already owns :80.
detect_front() {
  if command -v nginx >/dev/null 2>&1; then
    front_server="nginx"
    return 0
  fi
  port80_info
  case "$port80_owner" in
    apache2 | httpd | apache) front_server="apache" ;;
    caddy) front_server="caddy" ;;
    nginx) front_server="nginx-container" ;;
    docker | docker-proxy | dockerd | containerd | containerd-shim*) front_server="docker" ;;
    "") front_server="free" ;;
    *) front_server="other" ;;
  esac
}

service_reload() {
  local svc="$1"
  if command -v systemctl >/dev/null 2>&1; then
    run_root systemctl enable "$svc" >/dev/null 2>&1 || true
    if systemctl is-active --quiet "$svc" 2>/dev/null; then
      run_root systemctl reload "$svc"
    else
      run_root systemctl start "$svc"
    fi
  elif command -v service >/dev/null 2>&1; then
    if service "$svc" status >/dev/null 2>&1; then
      run_root service "$svc" reload
    else
      run_root service "$svc" start
    fi
  fi
}

# nginx (installed by us or already present) — one server block for our domain.
setup_nginx_proxy() {
  local domain="$1" port="$2"
  local conf_path conf_link="0" tmp fullcfg

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

  service_reload nginx
}

# Existing Apache on :80 — additive vhost, validated before reload.
setup_apache() {
  local domain="$1" port="$2"
  local conf="/etc/apache2/sites-available/omnivex-academy.conf" tmp
  say "Apache owns port 80 — adding a vhost for ${domain}…"
  if ! command -v a2enmod >/dev/null 2>&1; then
    warn "Apache detected but the Debian tooling is missing — point a vhost at http://127.0.0.1:${port} manually."
    exit 1
  fi
  run_root a2enmod proxy proxy_http proxy_wstunnel rewrite headers >/dev/null 2>&1 || true
  tmp="$(mktemp .apache.tmp.XXXXXX)"
  cat >"$tmp" <<APACHE
# Managed by ./deploy.sh proxy — regenerate any time with: ./deploy.sh proxy
<VirtualHost *:80>
    ServerName ${domain}
    ServerAlias www.${domain}

    ProxyPreserveHost On
    ProxyRequests Off

    RewriteEngine On
    RewriteCond %{HTTP:Upgrade} =websocket [NC]
    RewriteRule ^/(.*) ws://127.0.0.1:${port}/\$1 [P,L]
    RewriteRule ^/(.*) http://127.0.0.1:${port}/\$1 [P,L]

    ProxyPassReverse / http://127.0.0.1:${port}/
    RequestHeader set X-Forwarded-Proto "http"
</VirtualHost>
APACHE
  run_root install -m 644 "$tmp" "$conf"
  rm -f "$tmp"
  run_root a2ensite omnivex-academy.conf >/dev/null 2>&1 || true
  if ! run_root apache2ctl -t; then
    warn "Apache config test failed — our file was removed; existing sites are untouched."
    run_root rm -f "$conf"
    run_root a2dissite omnivex-academy.conf >/dev/null 2>&1 || true
    exit 1
  fi
  service_reload apache2
}

# Existing Caddy on :80 — one site block; Caddy also provisions HTTPS itself.
setup_caddy() {
  local domain="$1" port="$2"
  local conf="/etc/caddy/Caddyfile" tmp
  say "Caddy owns port 80 — adding ${domain}…"
  if [ ! -f "$conf" ]; then
    warn "No ${conf} found — point a Caddy site at http://127.0.0.1:${port} manually."
    exit 1
  fi
  if grep -q "${domain}" "$conf"; then
    say "Caddy already proxies ${domain} — nothing to change."
    return 0
  fi
  tmp="$(mktemp .caddy.tmp.XXXXXX)"
  cp "$conf" "$tmp"
  cat >>"$tmp" <<BLOCK

# --- omnivex-academy (managed by ./deploy.sh proxy) ---
${domain}, www.${domain} {
    reverse_proxy 127.0.0.1:${port}
}
BLOCK
  if command -v caddy >/dev/null 2>&1; then
    if ! run_root caddy validate --config "$tmp" --adapter caddyfile >/dev/null 2>&1; then
      warn "Caddy config test failed — nothing was changed."
      rm -f "$tmp"
      exit 1
    fi
  fi
  run_root install -m 644 "$tmp" "$conf"
  rm -f "$tmp"
  service_reload caddy
}

# ---- Cloudflare Worker front (edge → this server) -------------
# Used when the existing port-80/443 service cannot be wired safely, or
# with PROXY_MODE=worker. The Worker terminates TLS at Cloudflare's edge
# (zone mode and other domains untouched) and proxies to a public origin
# port published only by this app's container.
cf_account_id=""

cf_account() {
  local resp
  if [ -n "$cf_account_id" ]; then return 0; fi
  resp="$(cf_call GET "/accounts" || true)"
  if ! cf_ok "$resp"; then return 1; fi
  cf_account_id="$(printf '%s' "$resp" | grep -o '"id":"[a-f0-9]\{32\}"' | head -1 | cut -d'"' -f4 || true)"
  [ -n "$cf_account_id" ]
}

render_worker_js() {
  local out="$1" ip="$2" wport="$3"
  cat >"$out" <<WORKER
// Managed by ./deploy.sh proxy — Cloudflare Worker front for omnivex-academy.xyz
const ORIGIN = "http://${ip}:${wport}";

export default {
  async fetch(request) {
    const src = new URL(request.url);
    const target = new URL(ORIGIN + src.pathname + src.search);

    // WebSocket (live chat / calls): bridge client ⇄ origin explicitly.
    const upgrade = (request.headers.get("Upgrade") || "").toLowerCase();
    if (upgrade === "websocket") {
      const up = await fetch(target.href, { headers: request.headers });
      const upWS = up.webSocket;
      if (!upWS) return new Response("origin refused the websocket", { status: 502 });
      upWS.accept();
      const pair = new WebSocketPair();
      const client = pair[0];
      const server = pair[1];
      server.accept();
      const pipe = (a, b) => {
        a.addEventListener("message", (e) => { try { b.send(e.data); } catch (_) {} });
        a.addEventListener("close", (e) => { try { b.close(e.code, e.reason); } catch (_) {} });
      };
      pipe(server, upWS);
      pipe(upWS, server);
      return new Response(null, { status: 101, webSocket: client });
    }

    // Plain HTTP: transparent pass-through (stream bodies, manual redirects).
    const headers = new Headers(request.headers);
    headers.delete("Accept-Encoding");
    const init = { method: request.method, headers, redirect: "manual" };
    if (request.method !== "GET" && request.method !== "HEAD") init.body = request.body;
    return fetch(target.href, init);
  },
};
WORKER
}

# Upload the Worker script. Module workers need the
# "application/javascript+module" part type; a validation rejection (400/415/422)
# is retried once with the classic type, and every failure reports Cloudflare's
# own errors[] so the fix is never guessed at.
cf_upload_worker() {
  local js="$1" out http body msg ctype
  for ctype in application/javascript+module application/javascript; do
    out="$(curl -sS --max-time 30 -w $'\n%{http_code}' -X PUT \
      "${CF_API}/accounts/${cf_account_id}/workers/scripts/omnivex-academy-proxy" \
      -H "Authorization: Bearer ${cf_token}" \
      -F 'metadata={"main_module":"worker.js","compatibility_date":"2025-01-01"};type=application/json' \
      -F "worker.js=@${js};type=${ctype}" 2>&1)" || {
        warn "Could not reach the Cloudflare API: $(printf '%s' "$out" | tr '\n' ' ' | cut -c1-200)"
        return 1
      }
    http="${out##*$'\n'}"
    body="${out%$'\n'*}"
    case "$http" in 200|201) return 0 ;; esac
    if [ "$ctype" = "application/javascript+module" ]; then
      case "$http" in 400|415|422) continue ;; esac
    fi
    msg="$(cf_error_text "$body")"
    if [ -z "$msg" ]; then msg="$(printf '%s' "$body" | tr -d '\n' | cut -c1-200)"; fi
    warn "Cloudflare rejected the Worker upload (HTTP ${http}): ${msg}"
    case "$http" in
      401|403) warn "  Token scope needed: Workers Scripts — Edit (Account)." ;;
      404)     warn "  Token scope needed: Account Settings — Read (account id could not be matched)." ;;
    esac
    return 1
  done
  return 1
}

cf_ensure_route() {
  local pattern="$1" resp rid
  resp="$(cf_call GET "/zones/${cf_zone_id}/workers/routes" || true)"
  if ! cf_ok "$resp"; then
    warn "Cloudflare could not list routes for ${pattern}: $(cf_error_text "$resp")"
    return 1
  fi
  rid="$(printf '%s' "$resp" | grep -o '{[^{}]*}' | grep -F "\"pattern\":\"${pattern}\"" \
    | grep -o '"id":"[a-f0-9]\{32\}"' | head -1 | cut -d'"' -f4 || true)"
  if [ -n "$rid" ]; then
    resp="$(cf_call PUT "/zones/${cf_zone_id}/workers/routes/${rid}" \
      "{\"pattern\":\"${pattern}\",\"script\":\"omnivex-academy-proxy\"}" || true)"
  else
    resp="$(cf_call POST "/zones/${cf_zone_id}/workers/routes" \
      "{\"pattern\":\"${pattern}\",\"script\":\"omnivex-academy-proxy\"}" || true)"
  fi
  if ! cf_ok "$resp"; then
    warn "Cloudflare rejected route ${pattern}: $(cf_error_text "$resp")"
    return 1
  fi
}

setup_worker() {
  local domain="omnivex-academy.xyz" port wport ip js
  local i healthy=0 ok=0 r
  port="$(get_env_val PORT)"; port="${port:-3000}"
  wport="$(get_env_val WORKER_ORIGIN_PORT)"; wport="${wport:-8443}"

  say "Cloudflare Worker mode: edge → this server on port ${wport}."

  if [ -z "$cf_zone_id" ]; then cf_init; fi
  if [ -z "$cf_zone_id" ]; then
    warn "Worker mode needs a usable Cloudflare token (Zone.DNS + Zone.SSL + Workers)."
    return 1
  fi
  if ! cf_account; then
    warn "Cannot list Cloudflare accounts. Add to CLOUDFLARE_API_TOKEN:"
    warn "  Account Settings: Read, Workers Scripts: Edit (Account), Workers Routes: Edit (Zone)."
    return 1
  fi

  # 1. Publish the origin port (override file keeps the repo compose file clean).
  cat >docker-compose.override.yml <<OVERRIDE
# Managed by ./deploy.sh proxy (Cloudflare Worker mode) — do not edit.
services:
  omnivex:
    ports:
      - "${wport}:3000"
OVERRIDE
  say "Publishing the origin on port ${wport}…"
  "${COMPOSE[@]}" up -d

  # 2. Container was recreated — re-check health.
  for i in $(seq 1 20); do
    if curl -fsS --max-time 4 "http://127.0.0.1:${port}/api/health" >/dev/null 2>&1; then healthy=1; break; fi
    sleep 3
  done
  if [ "$healthy" != "1" ]; then
    warn "App not healthy after publishing port ${wport} — ./deploy.sh logs"
    return 1
  fi

  # 3. Generate + upload the Worker.
  ip="$(curl -4 -sS --max-time 10 https://api.ipify.org 2>/dev/null || true)"
  if [ -z "$ip" ]; then
    warn "Could not detect this server's public IP for the Worker origin."
    return 1
  fi
  js="$(mktemp .worker.XXXXXX.js)"
  render_worker_js "$js" "$ip" "$wport"
  if ! cf_upload_worker "$js"; then
    rm -f "$js"
    warn "Worker upload did not complete — Cloudflare's reply is printed above."
    return 1
  fi
  rm -f "$js"
  say "✔ Worker script uploaded (omnivex-academy-proxy)."

  # 4. Routes: only the apex (+www) — the sibling subdomain is untouched.
  if ! cf_ensure_route "${domain}/*"; then
    warn "Route attach failed — the Cloudflare reply is printed above"
    warn "(usual missing scope: Workers Routes — Edit, zone ${domain})."
    return 1
  fi
  cf_ensure_route "www.${domain}/*" || true
  say "✔ Route ${domain}/* → omnivex-academy-proxy"

  # 5. Best effort: only Cloudflare may reach the origin port (when ufw is on).
  if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q '^Status: active'; then
    for r in $(curl -fsS --max-time 10 https://www.cloudflare.com/ips-v4 2>/dev/null || true) \
      $(curl -fsS --max-time 10 https://www.cloudflare.com/ips-v6 2>/dev/null || true); do
      run_root ufw allow from "$r" to any port "$wport" proto tcp >/dev/null 2>&1 || true
    done
    say "ufw: origin port ${wport} limited to Cloudflare address ranges."
  fi

  # 6. End-to-end check through the edge.
  say "Verifying https://${domain} through the Worker…"
  for i in $(seq 1 20); do
    if curl -fsS --max-time 8 "https://${domain}/api/health" >/dev/null 2>&1; then ok=1; break; fi
    sleep 3
  done
  if [ "$ok" = "1" ]; then
    say "✔ https://${domain} answers through the Cloudflare Worker."
  else
    warn "Edge check has not passed yet (DNS may still be propagating) — ./deploy.sh status later."
  fi
  front_server="worker"
  return 0
}

# Port 80/443 is published by another container (e.g. the sibling app's
# proxy). Caddy containers get wired automatically (Caddy also provisions
# the certificate); everything else is reported with full detail.
setup_docker_proxy() {
  local domain="$1" port="$2"
  local c image gw host_conf tmp

  c="$("${DOCKER[@]}" ps --filter publish=80 --format '{{.Names}}' 2>/dev/null | head -1 || true)"
  if [ -z "$c" ]; then
    c="$("${DOCKER[@]}" ps --filter publish=443 --format '{{.Names}}' 2>/dev/null | head -1 || true)"
  fi
  if [ -z "$c" ]; then
    warn "No container publishes 80/443 — full report: ./deploy.sh doctor (section 9)."
    return 1
  fi
  image="$("${DOCKER[@]}" inspect "$c" --format '{{.Config.Image}}' 2>/dev/null || true)"
  gw="$("${DOCKER[@]}" inspect "$c" --format '{{range .NetworkSettings.Networks}}{{.Gateway}} {{end}}' 2>/dev/null | awk '{print $1}' || true)"
  say "Ports 80/443 are published by container '${c}' (image: ${image})."

  case "$image" in
    *caddy*)
      host_conf="$("${DOCKER[@]}" inspect "$c" --format '{{range .Mounts}}{{if eq .Destination "/etc/caddy/Caddyfile"}}{{.Source}}{{end}}{{end}}' 2>/dev/null || true)"
      if [ -z "$host_conf" ]; then
        host_conf="$("${DOCKER[@]}" inspect "$c" --format '{{range .Mounts}}{{if eq .Destination "/etc/caddy"}}{{.Source}}{{end}}{{end}}' 2>/dev/null || true)"
        host_conf="${host_conf:+${host_conf}/Caddyfile}"
      fi
      if [ -z "$host_conf" ] || [ ! -f "$host_conf" ]; then
        warn "Caddy container found, but its Caddyfile is not a mounted file — cannot edit it safely."
        warn "Mounts of ${c}:"
        "${DOCKER[@]}" inspect "$c" --format '{{range .Mounts}}  {{.Source}} -> {{.Destination}}{{println}}{{end}}' 2>/dev/null || true
        return 1
      fi
      if grep -q "${domain}" "$host_conf"; then
        say "Caddy already proxies ${domain} — nothing to change."
        front_server="docker-caddy"
        return 0
      fi
      tmp="$(mktemp .caddy.tmp.XXXXXX)"
      cp "$host_conf" "$tmp"
      cat >>"$tmp" <<BLOCK

# --- omnivex-academy (managed by ./deploy.sh proxy) ---
${domain}, www.${domain} {
    reverse_proxy ${gw}:${port}
}
BLOCK
      cp "$host_conf" "${host_conf}.deploy-backup"
      run_root install -m 644 "$tmp" "$host_conf"
      rm -f "$tmp"
      if ! "${DOCKER[@]}" exec "$c" caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1; then
        run_root cp "${host_conf}.deploy-backup" "$host_conf"
        run_root rm -f "${host_conf}.deploy-backup"
        warn "Caddy config test failed — rolled back, nothing was changed."
        return 1
      fi
      run_root rm -f "${host_conf}.deploy-backup"
      if ! "${DOCKER[@]}" exec "$c" caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile; then
        warn "Caddy reload failed — config was written; check: docker logs ${c}"
        return 1
      fi
      say "✔ ${domain} added to the Caddy container (it provisions HTTPS itself)."
      front_server="docker-caddy"
      ;;
    *nginx*)
      host_conf="$("${DOCKER[@]}" inspect "$c" --format '{{range .Mounts}}{{if eq .Destination "/etc/nginx"}}{{.Source}}{{end}}{{end}}' 2>/dev/null || true)"
      warn "The proxy is an nginx container (${c}). Its TLS certificate for"
      warn "${domain} must exist before the domain can be wired in:"
      if [ -n "$host_conf" ]; then
        warn "  • its /etc/nginx is mounted at ${host_conf} (edits are persistent)"
        warn "  • grant the Cloudflare token 'Origin CA Keys: Edit' and rerun — the"
        warn "    origin certificate is then created and installed automatically"
      else
        warn "  • its /etc/nginx is NOT mounted, so config edits would not survive a restart"
      fi
      warn "Mounts of ${c}:"
      "${DOCKER[@]}" inspect "$c" --format '{{range .Mounts}}  {{.Source}} -> {{.Destination}}{{println}}{{end}}' 2>/dev/null || true
      return 1
      ;;
    *)
      warn "Container '${c}' runs image '${image}' — not auto-wirable yet. Mounts:"
      "${DOCKER[@]}" inspect "$c" --format '{{range .Mounts}}  {{.Source}} -> {{.Destination}}{{println}}{{end}}' 2>/dev/null || true
      warn "Tell me which proxy it is (Caddy gets wired in one command)."
      return 1
      ;;
  esac
}

setup_proxy() {
  ensure_curl
  local domain="omnivex-academy.xyz" port forced_worker=0
  port="$(get_env_val PORT)"
  port="${port:-3000}"

  if [ "$(get_env_val PROXY_MODE)" = "worker" ]; then forced_worker=1; fi

  if [ "$forced_worker" = "1" ]; then
    if ! setup_worker; then
      warn "Worker front failed — full report: ./deploy.sh doctor (section 9)."
      exit 1
    fi
  else
    detect_front
    case "$front_server" in
      nginx)
        say "nginx found — configuring our server block…"
        setup_nginx_proxy "$domain" "$port"
        ;;
      free)
        say "Port 80 is free — installing nginx…"
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
        front_server="nginx"
        setup_nginx_proxy "$domain" "$port"
        ;;
      apache) setup_apache "$domain" "$port" ;;
      caddy) setup_caddy "$domain" "$port" ;;
      docker | nginx-container)
        if ! setup_docker_proxy "$domain" "$port"; then
          say "Native wiring unavailable — falling back to the Cloudflare Worker front…"
          if ! setup_worker; then
            warn "Worker front failed too — full report: ./deploy.sh doctor (section 9)."
            exit 1
          fi
        fi
        ;;
      *)
        warn "Port 80 is held by a process this script does not manage (${front_server}):"
        printf '%s\n' "$port80_line"
        if command -v docker >/dev/null 2>&1; then
          docker ps --filter "publish=80" --format '  container: {{.Names}}   image: {{.Image}}' 2>/dev/null || true
        fi
        say "Trying the Cloudflare Worker front instead (that service is left untouched)…"
        if ! setup_worker; then
          warn "Worker front unavailable. Free port 80, or wire the domain into that"
          warn "service yourself. Full report: ./deploy.sh doctor (section 9)."
          exit 1
        fi
        ;;
    esac
    # Leaving Worker mode behind a native front: drop the origin-port override.
    if [ "$front_server" != "worker" ] && grep -qs "Cloudflare Worker mode" docker-compose.override.yml; then
      say "Leaving Worker mode — removing the origin-port override…"
      rm -f docker-compose.override.yml
      "${COMPOSE[@]}" up -d
    fi
  fi

  # Firewall — applies to every front type.
  if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q '^Status: active'; then
    run_root ufw allow 80/tcp >/dev/null 2>&1 || true
    run_root ufw allow 443/tcp >/dev/null 2>&1 || true
    say "ufw: allowed ports 80 and 443."
  fi

  if curl -fsS --max-time 5 -H "Host: ${domain}" "http://127.0.0.1/api/health" >/dev/null 2>&1; then
    say "✔ ${front_server} front is live: http://${domain} → 127.0.0.1:${port}"
  else
    warn "The proxy is configured, but the app did not answer on 127.0.0.1:${port}."
    warn "Container down? ./deploy.sh status / ./deploy.sh logs, then re-run ./deploy.sh proxy."
  fi
}

# ---- Let's Encrypt certificate (Cloudflare Full strict) --------
do_tls() {
  local email="${1:-}"
  local front="${2:-nginx}"
  local domain="omnivex-academy.xyz"
  local plugin="--nginx" pkg="python3-certbot-nginx"

  if [ "$front" = "worker" ]; then
    say "Worker front — HTTPS is at Cloudflare's edge; no origin certificate needed."
    return 0
  fi
  if [ "$front" = "caddy" ]; then
    say "Caddy provisions its own certificate — nothing to request here."
    return 0
  fi
  if [ "$front" = "apache" ]; then
    plugin="--apache"
    pkg="python3-certbot-apache"
    if ! command -v apache2ctl >/dev/null 2>&1; then
      warn "Apache front expected but apache2ctl is missing — run ./deploy.sh proxy first."
      return 1
    fi
  elif ! command -v nginx >/dev/null 2>&1; then
    warn "nginx is not installed — run ./deploy.sh proxy first."
    return 1
  fi
  if ! command -v certbot >/dev/null 2>&1; then
    say "Installing certbot + the web-server plugin…"
    if command -v apt-get >/dev/null 2>&1; then
      run_root apt-get update -y >/dev/null 2>&1 || true
      run_root apt-get install -y certbot "$pkg" >/dev/null
    elif command -v dnf >/dev/null 2>&1; then
      run_root dnf install -y certbot "$pkg" >/dev/null
    elif command -v yum >/dev/null 2>&1; then
      run_root yum install -y certbot "$pkg" >/dev/null
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
  if ! run_root certbot ${plugin} -d "$domain" --non-interactive --agree-tos -m "$email" --redirect; then
    warn "certbot failed. Common causes: DNS not propagated yet, or a Cloudflare WAF/bot rule"
    warn "blocking /.well-known/acme-challenge. Retry later, or run interactively:"
    warn "  certbot ${plugin} -d ${domain}"
    return 1
  fi

  say "✔ Certificate installed (80 → 443 redirect enabled)."
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

  # ---- 6. Cloudflare: DNS + a SAFE SSL mode (before any proxy work) ----
  # Never "flexible": the mode is zone-wide and other hostnames on this zone
  # (e.g. resurreccion.omnivex-academy.xyz) serve their own HTTPS — flexible
  # makes their http→https redirect loop forever. "full" is safe for all.
  local cert_ready=0
  if has_cert; then cert_ready=1; fi
  cf_init
  if [ -n "$cf_zone_id" ]; then
    cf_ensure_dns
    cf_set_ssl full
  else
    cf_hint
  fi

  # ---- 7. reverse proxy in front of the app ----------------------
  say "Configuring the web server in front of the app…"
  setup_proxy

  # ---- 8. HTTPS certificate (per front-end) --------------------
  case "$front_server" in
    worker)
      say "✔ Worker front: HTTPS terminates at Cloudflare's edge — no origin certificate needed."
      cert_ready=1
      ;;
    caddy | docker-caddy)
      say "Caddy obtains its own certificate — waiting for HTTPS…"
    if wait_https; then
      cert_ready=1
      say "✔ HTTPS is live (certificate managed by Caddy)."
    else
      warn "HTTPS not up within 90 s — Caddy will finish on its own; check ./deploy.sh status."
    fi
    ;;
  *)
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
        if do_tls "$le_email" "$front_server"; then
          cert_ready=1
        else
          warn "Certificate not issued — the site still works over HTTP; retry with ./deploy.sh tls <email>."
        fi
      else
        warn "No Let's Encrypt email — no certificate yet (./deploy.sh tls you@example.com)."
      fi
    fi
    ;;
  esac
  if [ "$cert_ready" = "1" ] && [ -n "$cf_zone_id" ]; then
    say "Cloudflare stays on Full — safe for every domain on this zone."
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
  echo
  say "Helpers: ./deploy.sh logs [-f] | restart | stop | status | backup | proxy | tls | doctor"
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

# First errors[].message values from a Cloudflare response (empty when none).
# Keeps failures actionable: the API tells us what is wrong, we do not guess.
cf_error_text() {
  printf '%s' "$1" | grep -o '"message":[[:space:]]*"[^"]*"' | head -3 \
    | sed 's/^"message":[[:space:]]*"//; s/"$//' \
    | awk 'NR>1{printf " / "}{printf "%s",$0} END{print ""}' || true
}

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
  warn "No CLOUDFLARE_API_TOKEN in .env — one dashboard fix keeps every domain working:"
  warn "  SSL/TLS → Overview → Encryption mode: Full (NOT Flexible — Flexible loops any"
  warn "  domain on the zone that redirects http→https, e.g. a sibling app)"
  warn "  DNS → omnivex-academy.xyz → A record to this server, status Proxied (orange cloud)"
}

has_cert() { run_root test -f /etc/letsencrypt/live/omnivex-academy.xyz/fullchain.pem 2>/dev/null; }

# Poll https://omnivex-academy.xyz from this box (Caddy provisions its own cert).
wait_https() {
  local i
  for i in $(seq 1 30); do
    if curl -ksS --max-time 5 --resolve "omnivex-academy.xyz:443:127.0.0.1" \
      "https://omnivex-academy.xyz/api/health" >/dev/null 2>&1; then
      return 0
    fi
    sleep 3
  done
  return 1
}

segf_count() { dmesg 2>/dev/null | grep -ci 'segfault' || true; }

# ---- one-shot crash report -------------------------------------
do_doctor() {
  require_env
  local brc=0

  say "== 1. container state (exit / OOM / restarts / log driver) =="
  "${COMPOSE[@]}" ps -a || true
  "${DOCKER[@]}" inspect omnivex --format \
    'state={{.State.Status}} exit={{.State.ExitCode}} oom={{.State.OOMKilled}} restarts={{.RestartCount}} started={{.State.StartedAt}} logdriver={{.HostConfig.LogConfig.Type}}' \
    2>/dev/null || true
  echo

  say "== 2. container logs (empty = died before printing anything) =="
  "${COMPOSE[@]}" logs --tail 60 omnivex 2>&1 | tail -60 || true
  echo

  say "== 3. direct boot of the app (30 s cap, output + exit code) =="
  local s0 s1 out
  s0="$(segf_count)"
  brc=0
  timeout 30 "${COMPOSE[@]}" run -T --rm --entrypoint "" omnivex \
    node --max-old-space-size=384 --import tsx src/server/index.ts \
    >/tmp/omnivex-doctor-boot.log 2>&1 || brc=$?
  s1="$(segf_count)"
  tail -25 /tmp/omnivex-doctor-boot.log
  case "$brc" in
    0) say "exit code 0 — the app started cleanly when run directly" ;;
    124) say "still running after 30 s — log above shows how far boot got" ;;
    *) warn "exit code: ${brc}  (139 = segmentation fault)" ;;
  esac
  warn "new kernel segfaults during this test: $((s1 - s0))"
  echo

  say "== 4. native module test (better-sqlite3) =="
  s0="$(segf_count)"
  brc=0
  out="$("${COMPOSE[@]}" run -T --rm --entrypoint "" omnivex \
    node --input-type=commonjs -e \
    "const D=require('better-sqlite3'); const d=new D(':memory:'); d.exec('create table t(a)'); console.log('sqlite native OK');" 2>&1)" || brc=$?
  s1="$(segf_count)"
  printf '%s\n' "$out" | tail -15
  if [ "$brc" = "0" ]; then
    say "✔ better-sqlite3 loads and queries"
  else
    warn "✗ better-sqlite3 failed — exit code ${brc} (139 = segfault)"
  fi
  warn "new kernel segfaults during this test: $((s1 - s0))"
  echo

  say "== 4b. which better-sqlite3 artifact is baked into the image =="
  "${COMPOSE[@]}" run -T --rm --entrypoint "" omnivex sh -c \
    'node -p process.version; ls -la /app/node_modules/better-sqlite3/build/Release/ 2>/dev/null; ls -la /app/node_modules/better-sqlite3/prebuilds/ 2>/dev/null' 2>&1 | tail -14 || true
  echo

  say "== 5. tsx loader test (the --import tsx boot path) =="
  brc=0
  out="$("${COMPOSE[@]}" run -T --rm --entrypoint "" omnivex \
    node --import tsx -e "console.log('tsx loader OK')" 2>&1)" || brc=$?
  printf '%s\n' "$out" | tail -8
  if [ "$brc" = "0" ]; then
    say "✔ tsx loader works"
  else
    warn "✗ tsx loader failed — exit code ${brc}"
  fi
  echo

  say "== 6. container command + environment =="
  "${DOCKER[@]}" inspect omnivex --format 'cmd={{.Config.Cmd}}{{println}}entrypoint={{.Config.Entrypoint}}' 2>/dev/null || true
  "${COMPOSE[@]}" run -T --rm --entrypoint "" omnivex \
    node -p 'process.version + " " + process.arch' 2>&1 | tail -3 || true
  "${COMPOSE[@]}" run -T --rm --entrypoint "" omnivex \
    sh -c 'ls -lan /app/data | head -5' 2>&1 | tail -6 || true
  echo

  say "== 7. kernel segfault / OOM records =="
  if dmesg 2>/dev/null | grep -iE 'segfault|oom-kill' | tail -10; then
    :
  else
    warn "(no segfault records readable — dmesg restricted or none recorded)"
  fi
  echo

  say "== 8. host memory / swap =="
  free -h || true
  swapon --show || true
  echo

  say "== 9. web front: ports 80/443, containers, Cloudflare mode =="
  port80_info
  local l443
  l443="$(ss -H -ltnp 2>/dev/null | awk '$4 ~ /:443$/' | head -1 || true)"
  say "port 80 : ${port80_line:-free}"
  say "port 443: ${l443:-free}"
  if command -v docker >/dev/null 2>&1; then
    "${DOCKER[@]}" ps --format '  container: {{.Names}}  image: {{.Image}}  ports: {{.Ports}}' 2>/dev/null || true
    local pub
    for pub in $("${DOCKER[@]}" ps --filter publish=80 --format '{{.Names}}' 2>/dev/null || true); do
      say "mounts of ${pub}:"
      "${DOCKER[@]}" inspect "$pub" --format '{{range .Mounts}}  {{.Source}} -> {{.Destination}}{{println}}{{end}}' 2>/dev/null || true
    done
  fi
  cf_init
  if [ -n "$cf_zone_id" ]; then
    local ssl_resp
    ssl_resp="$(cf_call GET "/zones/${cf_zone_id}/settings/ssl" || true)"
    say "Cloudflare SSL mode: $(printf '%s' "$ssl_resp" | grep -o '"value":"[a-z_]*"' | head -1 || echo unknown)"
  else
    warn "Cloudflare: no API token in .env — check SSL/TLS → Overview manually."
  fi
  if command -v certbot >/dev/null 2>&1; then
    run_root certbot certificates 2>/dev/null | grep -E 'Certificate Name|Domains' || say "(no certbot certificates)"
  fi

  echo
  say "Send the output of sections 3–9 for the fix."
}

# ---- 0b. Preflight ---------------------------------------------
ensure_docker
ensure_daemon
ensure_compose

case "$CMD" in
  "") deploy ;;
  logs)
    require_env
    if [ "${2:-}" = "-f" ] || [ "${2:-}" = "--follow" ]; then
      exec "${COMPOSE[@]}" logs -f --tail 200
    fi
    "${COMPOSE[@]}" logs --tail 200
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
  proxy)
    require_env
    cf_init
    setup_proxy
    if [ -n "$cf_zone_id" ]; then
      cf_ensure_dns
      cf_set_ssl full
    else
      cf_hint
    fi
    ;;
  worker)
    # One-time Worker front: every step reads the token already in .env.
    require_env
    ensure_curl
    say "One-time Cloudflare Worker setup (token read from .env)…"
    cf_init
    if [ -z "$cf_zone_id" ]; then
      warn "CLOUDFLARE_API_TOKEN in .env could not resolve the zone omnivex-academy.xyz."
      warn "Fix the token, then re-run:  ./deploy.sh worker"
      exit 1
    fi
    # The proxied A record must exist before the route can receive traffic.
    cf_ensure_dns
    if ! setup_worker; then
      warn "Worker setup did not complete — the message above names the missing step."
      exit 1
    fi
    cf_set_ssl full
    echo
    say "✔ One-time Worker setup complete. Re-running './deploy.sh worker' is safe:"
    say "  it only re-applies the same port, script, routes, DNS record and SSL mode."
    ;;
  tls)
    require_env
    detect_front
    rc=0
    do_tls "${2:-}" "$front_server" || rc=1
    if [ "$rc" = "0" ]; then
      cf_init
      if [ -n "$cf_zone_id" ]; then cf_set_ssl full; else cf_hint; fi
    fi
    exit "$rc"
    ;;
  doctor)
    mkdir -p backups
    do_doctor 2>&1 | tee "backups/doctor-$(date +%Y%m%d-%H%M%S).log"
    ;;
esac
