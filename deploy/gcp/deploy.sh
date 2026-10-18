#!/bin/bash
# Release the current commit to the TriagePulse server (Google Cloud, Dammam).
#
#   PROJECT=triagepulse-123456 bash deploy/gcp/deploy.sh
#
# Builds the image in Cloud Build, stores it in Artifact Registry (me-central2), then sets
# the server's tp-image metadata. The server notices within ~20 s, pulls and restarts
# (database migrations run on start). Prints the server's deploy status at the end.
set -euo pipefail
cd "$(dirname "$0")/../.."

: "${PROJECT:?Set PROJECT to the Google Cloud project ID}"
REGION="${REGION:-me-central2}"
ZONE="${ZONE:-${REGION}-a}"
TAG="${TAG:-$(git rev-parse --short HEAD 2>/dev/null || date +%Y%m%d%H%M%S)}"
IMAGE="${REGION}-docker.pkg.dev/${PROJECT}/triagepulse/app:${TAG}"
g() { gcloud --project="$PROJECT" --quiet "$@"; }

if ! g artifacts docker images describe "$IMAGE" > /dev/null 2>&1; then
  echo "== Building $IMAGE"
  g builds submit --region="$REGION" --tag="$IMAGE" --machine-type=e2-highcpu-8 .
fi

# Keep the server's scripts in step with the repository, then point it at the new image.
g compute instances add-metadata triagepulse --zone="$ZONE" \
  --metadata-from-file=startup-script=deploy/gcp/startup.sh,tp-compose=deploy/gcp/compose.yml,tp-caddyfile=deploy/gcp/Caddyfile \
  --metadata=tp-image="$IMAGE"

echo "== Waiting for the server to deploy $TAG"
for _ in $(seq 1 60); do
  status="$(g compute instances get-guest-attributes triagepulse --zone="$ZONE" \
    --query-path=triagepulse/status --format='value(value)' 2>/dev/null || true)"
  case "$status" in
    ok*"$TAG"*) echo "$status"; exit 0 ;;
    error*) echo "$status" ;;
  esac
  sleep 10
done
echo "No confirmation yet. Check: gcloud compute instances get-guest-attributes triagepulse --zone=$ZONE"
exit 1
