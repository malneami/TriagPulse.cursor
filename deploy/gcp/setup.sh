#!/bin/bash
# One-time setup of the TriagePulse server in Google Cloud, Dammam (me-central2).
# Safe to re-run: existing resources are kept. Needs a signed-in gcloud with Owner/Editor.
#
#   PROJECT=triagepulse-123456 ADMIN_EMAIL=you@example.com ADMIN_NAME="Dr Name" \
#     bash deploy/gcp/setup.sh
#
# Creates: Artifact Registry repo, a service account for the server, secrets (kept in
# me-central2), a static IP, a firewall rule for HTTPS, a daily disk-snapshot schedule
# (14 days, stored in me-central2) and the VM. Then run deploy/gcp/deploy.sh.
set -euo pipefail
cd "$(dirname "$0")"

: "${PROJECT:?Set PROJECT to the Google Cloud project ID}"
: "${ADMIN_EMAIL:?Set ADMIN_EMAIL for the first admin account}"
ADMIN_NAME="${ADMIN_NAME:-Administrator}"
DOMAIN="${DOMAIN:-triage-pulse.com}"
REGION="${REGION:-me-central2}"
ZONE="${ZONE:-${REGION}-a}"
MACHINE="${MACHINE:-e2-small}"
VM=triagepulse
SA="triagepulse-vm@${PROJECT}.iam.gserviceaccount.com"
g() { gcloud --project="$PROJECT" --quiet "$@"; }
exists() { "$@" > /dev/null 2>&1; }

echo "== APIs"
g services enable compute.googleapis.com artifactregistry.googleapis.com cloudbuild.googleapis.com \
  secretmanager.googleapis.com logging.googleapis.com

echo "== Artifact Registry"
exists g artifacts repositories describe triagepulse --location="$REGION" \
  || g artifacts repositories create triagepulse --repository-format=docker --location="$REGION" \
       --description="TriagePulse images"

echo "== Service account for the server (least privilege)"
exists g iam service-accounts describe "$SA" \
  || g iam service-accounts create triagepulse-vm --display-name="TriagePulse server"
for role in roles/artifactregistry.reader roles/logging.logWriter roles/monitoring.metricWriter; do
  g projects add-iam-policy-binding "$PROJECT" --member="serviceAccount:$SA" --role="$role" \
    --condition=None > /dev/null
done

echo "== Secrets (stored only in $REGION; values are generated here and never printed)"
make_secret() { # name, value-or-empty
  if ! exists g secrets describe "$1"; then
    g secrets create "$1" --replication-policy=user-managed --locations="$REGION" > /dev/null
    if [ -n "$2" ]; then printf '%s' "$2" | g secrets versions add "$1" --data-file=- > /dev/null; fi
  fi
  g secrets add-iam-policy-binding "$1" --member="serviceAccount:$SA" \
    --role=roles/secretmanager.secretAccessor > /dev/null
}
make_secret tp-jwt-secret "$(openssl rand -hex 48)"
make_secret tp-db-password "$(openssl rand -hex 24)"
make_secret tp-admin-password "$(openssl rand -base64 18 | tr '+/' '-_')"
make_secret tp-speechmatics-key ""
make_secret tp-openai-key ""

echo "== Static IP"
exists g compute addresses describe triagepulse-ip --region="$REGION" \
  || g compute addresses create triagepulse-ip --region="$REGION"
IP="$(g compute addresses describe triagepulse-ip --region="$REGION" --format='value(address)')"

echo "== Firewall: HTTP/HTTPS only to this server"
exists g compute firewall-rules describe triagepulse-web \
  || g compute firewall-rules create triagepulse-web --network=default --direction=INGRESS \
       --allow=tcp:80,tcp:443,udp:443 --target-tags=triagepulse-web --source-ranges=0.0.0.0/0

echo "== Daily disk snapshots (14 days, kept in $REGION)"
exists g compute resource-policies describe triagepulse-daily --region="$REGION" \
  || g compute resource-policies create snapshot-schedule triagepulse-daily --region="$REGION" \
       --daily-schedule --start-time=23:00 --max-retention-days=14 \
       --on-source-disk-delete=keep-auto-snapshots --storage-location="$REGION"

echo "== Server"
if ! exists g compute instances describe "$VM" --zone="$ZONE"; then
  g compute instances create "$VM" --zone="$ZONE" --machine-type="$MACHINE" \
    --image-family=debian-12 --image-project=debian-cloud \
    --boot-disk-size=30GB --boot-disk-type=pd-balanced \
    --address="$IP" --tags=triagepulse-web \
    --service-account="$SA" --scopes=cloud-platform \
    --shielded-secure-boot --shielded-vtpm --shielded-integrity-monitoring \
    --metadata-from-file=startup-script=startup.sh,tp-compose=compose.yml,tp-caddyfile=Caddyfile \
    --metadata=enable-guest-attributes=TRUE,tp-domain="$DOMAIN",tp-admin-email="$ADMIN_EMAIL",tp-admin-name="$ADMIN_NAME"
  g compute disks add-resource-policies "$VM" --zone="$ZONE" --resource-policies=triagepulse-daily
else
  # Keep the server's scripts in step with the repository.
  g compute instances add-metadata "$VM" --zone="$ZONE" \
    --metadata-from-file=startup-script=startup.sh,tp-compose=compose.yml,tp-caddyfile=Caddyfile
fi

echo
echo "Server address: $IP"
echo "DNS: A record  @  ->  $IP   (and CNAME www -> $DOMAIN)"
echo "Next: PROJECT=$PROJECT bash deploy/gcp/deploy.sh"
