#!/bin/bash
# Google Cloud VM startup script for the TriagePulse server (runs as root at every boot).
#
# Everything it needs comes from instance metadata and Secret Manager; nothing secret is
# stored in the repository or in metadata:
#   metadata  tp-image       container image to run (set by deploy.sh)
#             tp-domain      e.g. triage-pulse.com
#             tp-compose     deploy/gcp/compose.yml
#             tp-caddyfile   deploy/gcp/Caddyfile
#             tp-admin-email / tp-admin-name   first admin (created once, on an empty database)
#             tp-rev         change it to make the server re-read secrets and restart the app
#   secrets   tp-jwt-secret, tp-db-password, tp-admin-password (required)
#             tp-speechmatics-key, tp-openai-key, tp-boosthis-key (optional; empty = feature off)
#
# A small service (triagepulse-watch) re-deploys whenever tp-image or tp-rev changes, so
# releases do not need SSH: deploy.sh only updates metadata.
set -euo pipefail
exec > >(logger -t triagepulse-startup) 2>&1

DIR=/opt/triagepulse
mkdir -p "$DIR"

# ── Shared helpers (also used by the watch service) ──
cat > "$DIR/lib.sh" <<'LIB'
MD=http://metadata.google.internal/computeMetadata/v1
H="Metadata-Flavor: Google"
attr() { curl -sf -H "$H" "$MD/instance/attributes/$1" || true; }
project() { curl -sf -H "$H" "$MD/project/project-id"; }
token() {
  curl -sf -H "$H" "$MD/instance/service-accounts/default/token" \
    | python3 -c 'import sys, json; print(json.load(sys.stdin)["access_token"])'
}
# Latest version of a Secret Manager secret; empty when the secret or a version is missing.
secret() {
  curl -sf -H "Authorization: Bearer $(token)" \
    "https://secretmanager.googleapis.com/v1/projects/$(project)/secrets/$1/versions/latest:access" \
    | python3 -c 'import sys, json, base64; print(base64.b64decode(json.load(sys.stdin)["payload"]["data"]).decode().strip(), end="")' \
    || true
}
LIB

# ── Deploy: refresh config and secrets, pull, (re)start ──
cat > "$DIR/up.sh" <<'UP'
#!/bin/bash
set -euo pipefail
DIR=/opt/triagepulse
. "$DIR/lib.sh"
cd "$DIR"

IMAGE="$(attr tp-image)"
DOMAIN="$(attr tp-domain)"
[ -n "$IMAGE" ] && [ -n "$DOMAIN" ] || { echo "tp-image or tp-domain not set; waiting."; exit 0; }
attr tp-compose > compose.yml
attr tp-caddyfile > Caddyfile

JWT="$(secret tp-jwt-secret)"; DBPW="$(secret tp-db-password)"
[ -n "$JWT" ] && [ -n "$DBPW" ] || { echo "Required secrets missing (tp-jwt-secret, tp-db-password)."; exit 1; }

umask 077
printf 'IMAGE=%s\nDOMAIN=%s\nDB_PASSWORD=%s\n' "$IMAGE" "$DOMAIN" "$DBPW" > .env
{
  echo "NODE_ENV=production"
  echo "PORT=3001"
  echo "DATABASE_URL=postgresql://triagepulse:${DBPW}@db:5432/triagepulse"
  echo "DIRECT_URL=postgresql://triagepulse:${DBPW}@db:5432/triagepulse"
  echo "JWT_SECRET=${JWT}"
  echo "CORS_ORIGIN=https://${DOMAIN}"
  echo "SPEECHMATICS_API_KEY=$(secret tp-speechmatics-key)"
  echo "OPENAI_API_KEY=$(secret tp-openai-key)"
  # Boosthis performance monitoring: off while tp-boosthis-key has no version.
  # Fixed install id so restarts count as one install; owner badge off on clinical pages.
  echo "BOOSTHIS_PROJECT_KEY=$(secret tp-boosthis-key)"
  echo "BOOSTHIS_INSTALL_ID=1b996770-fec7-4fb6-bf6a-134efa4b8c92"
  echo "BOOSTHIS_BUBBLE=0"
  echo "BOOTSTRAP_ADMIN_EMAIL=$(attr tp-admin-email)"
  echo "BOOTSTRAP_ADMIN_NAME=$(attr tp-admin-name)"
  echo "BOOTSTRAP_ADMIN_PASSWORD=$(secret tp-admin-password)"
} > app.env

REGISTRY="${IMAGE%%/*}"
token | docker login -u oauth2accesstoken --password-stdin "https://${REGISTRY}" > /dev/null
docker compose pull -q
docker compose up -d --remove-orphans
docker image prune -f > /dev/null
echo "Deployed ${IMAGE} for ${DOMAIN}"
UP
chmod 700 "$DIR/up.sh"

# ── Watch metadata; re-deploy when tp-image or tp-rev changes ──
cat > "$DIR/watch.sh" <<'WATCH'
#!/bin/bash
DIR=/opt/triagepulse
. "$DIR/lib.sh"
# Result of each deploy is published as a guest attribute (triagepulse/status), readable with
# `gcloud compute instances get-guest-attributes` — no SSH needed. It never contains secrets.
report() {
  curl -sf -X PUT -H "$H" --data-binary "$1" "$MD/instance/guest-attributes/triagepulse/status" > /dev/null || true
}
last=""
while true; do
  now="$(attr tp-image)|$(attr tp-rev)"
  if [ "$now" != "$last" ]; then
    if out="$("$DIR/up.sh" 2>&1)"; then
      last="$now"; report "ok $(date -u +%FT%TZ) $(echo "$out" | tail -1)"
    else
      report "error $(date -u +%FT%TZ) $(echo "$out" | tail -5 | tr '\n' ' ' | cut -c1-900)"
    fi
    echo "$out"
  fi
  sleep 20
done
WATCH
chmod 700 "$DIR/watch.sh"

# ── One-time machine setup ──
if [ ! -f /swapfile ]; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

if ! command -v docker > /dev/null || ! docker compose version > /dev/null 2>&1; then
  apt-get update -q
  apt-get install -y -q ca-certificates curl gnupg python3
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  . /etc/os-release
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian ${VERSION_CODENAME} stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -q
  apt-get install -y -q docker-ce docker-ce-cli containerd.io docker-compose-plugin
  systemctl enable --now docker
fi

# Automatic security updates for the operating system.
if ! dpkg -s unattended-upgrades > /dev/null 2>&1; then
  apt-get install -y -q unattended-upgrades
fi

cat > /etc/systemd/system/triagepulse-watch.service <<'UNIT'
[Unit]
Description=TriagePulse deploy watcher
After=docker.service network-online.target
Wants=network-online.target
Requires=docker.service

[Service]
ExecStart=/opt/triagepulse/watch.sh
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable triagepulse-watch
systemctl restart triagepulse-watch
echo "TriagePulse startup complete"
