#!/usr/bin/env bash
# One-time setup for a new codespace: config, dependencies, database, demo users.
# Runs automatically when the codespace is created. Safe to re-run.
set -euo pipefail
cd "$(dirname "$0")/.."

# 1. Local config. Never committed (.gitignore). JWT secret is random per codespace.
if [ ! -f .env ]; then
  JWT=$(node -e "console.log(require('crypto').randomBytes(48).toString('base64'))")
  cat > .env <<EOF
# Created by .devcontainer/setup.sh for this codespace only.
DATABASE_URL=postgresql://triagepulse:triagepulse@localhost:5432/triagepulse
DIRECT_URL=postgresql://triagepulse:triagepulse@localhost:5432/triagepulse
JWT_SECRET=${JWT}
JWT_EXPIRES_IN=8h
PORT=3001
CORS_ORIGIN=http://localhost:5174
OPENAI_API_KEY=
EOF
  echo "Created .env for this codespace."
fi

# Export .env values without overriding anything already set
# (Codespaces secrets such as DATABASE_URL take priority).
while IFS='=' read -r key value; do
  [[ -z "$key" || "$key" == \#* ]] && continue
  if [[ -z "${!key:-}" ]]; then export "$key=$value"; fi
done < .env

# 2. Dependencies and builds.
npm ci
npm run build --workspace=@triagepulse/clinical
npm run db:generate --workspace=@triagepulse/api

# 3. Database: wait for Postgres, apply migrations.
if [[ "$DATABASE_URL" == *localhost* ]]; then
  for i in $(seq 1 30); do
    node -e "require('net').connect(5432,'localhost').on('connect',()=>process.exit(0)).on('error',()=>process.exit(1))" && break
    echo "Waiting for Postgres... ($i)"; sleep 2
  done
fi
npm run db:migrate:deploy

# 4. Demo users (local test database only; never seeded into a shared database).
if [[ "$DATABASE_URL" == *localhost* ]]; then
  npm run db:seed
else
  echo "Using an external database: skipped demo users. Create users with: npm run admin:create"
fi

echo ""
echo "TriagePulse is ready. The app starts automatically (npm run codespace:app)"
echo "and opens on port 3001. Demo login: nurse@triagepulse.local / triage123"
echo "(also physician@ and admin@)."
