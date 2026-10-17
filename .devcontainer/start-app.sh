#!/usr/bin/env bash
# Runs each time the codespace is opened (postAttachCommand): pull the latest commits,
# update the database (new tables are added, nothing is removed), rebuild, start.
set -uo pipefail
cd "$(dirname "$0")/.."

git pull --ff-only -q || true

# Install libraries when the lockfile changed since the last install (new libraries such as
# helmet would otherwise be missing and the API would not start).
LOCK_HASH="$(sha1sum package-lock.json | cut -d' ' -f1)"
if [ ! -d node_modules ] || [ "$(cat node_modules/.tp-lock-hash 2>/dev/null)" != "$LOCK_HASH" ]; then
  npm install --no-audit --no-fund && echo "$LOCK_HASH" > node_modules/.tp-lock-hash
fi

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
