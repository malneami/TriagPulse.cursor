#!/usr/bin/env bash
# Runs each time the codespace is opened (postAttachCommand): pull the latest commits,
# update the database (new tables are added, nothing is removed), rebuild, start.
set -uo pipefail
cd "$(dirname "$0")/.."

git pull --ff-only -q || true

# Export .env without overriding values already set (Codespaces secrets win).
if [ -f .env ]; then
  while IFS='=' read -r key value; do
    [[ -z "$key" || "$key" == \#* ]] && continue
    if [[ -z "${!key:-}" ]]; then export "$key=$value"; fi
  done < .env
fi

npm run build --workspace=@triagepulse/clinical
npm run db:generate --workspace=@triagepulse/api
npm run db:migrate:deploy || echo "Database migration did not run — check DATABASE_URL."
npm run build --workspace=@triagepulse/web
SERVE_WEB_DIR=../web/dist exec npm run dev:api
