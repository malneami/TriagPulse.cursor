#!/bin/sh
# Container start: apply database migrations, create the first admin on a new server
# (only if none exists), then run the API, which also serves the web app.
set -e
cd /app/apps/api
npx prisma migrate deploy --schema=../../prisma/schema.prisma
node prisma/bootstrap-admin.mjs
exec node dist/src/main.js
