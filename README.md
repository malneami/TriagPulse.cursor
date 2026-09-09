# TriagePulse

Emergency triage platform rebuilt with NestJS, PostgreSQL, and React — migrated from the Base44 reference app.

## Stack

- **Frontend:** React 18 + Vite (`apps/web`)
- **Backend:** NestJS + JWT auth (`apps/api`)
- **Database:** PostgreSQL + Prisma (`prisma/`)
- **Clinical logic:** Shared TypeScript package (`packages/clinical`)

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env

# 3. Start PostgreSQL
npm run db:up

# 4. Run migrations and seed demo users
npm run db:migrate
npm run db:seed

# 5. Build clinical package
npm run build --workspace=@triagepulse/clinical

# 6. Start dev servers (API + Web)
npm run dev
```

- **Web:** http://localhost:5173
- **API:** http://localhost:3001/api/health

## GitHub Pages

The frontend deploys as a static site via GitHub Actions (`.github/workflows/deploy-pages.yml`) on every push to `main`.

- **Live UI:** https://malneami.github.io/TriagPulse.cursor/
- **Full deploy guide (API host checklist):** [docs/DEPLOY.md](docs/DEPLOY.md)

> **Note:** GitHub Pages hosts the **web UI only**. The NestJS API, PostgreSQL, and realtime STT require a separate backend host. Set repository secret `VITE_API_URL` (e.g. `https://your-api.example.com`) so the built UI can call a remote API, then re-run the Pages workflow.

## Demo Users

| Role | Email | Password |
|------|-------|----------|
| Nurse | nurse@triagepulse.local | triage123 |
| Physician | physician@triagepulse.local | triage123 |
| Admin | admin@triagepulse.local | triage123 |

## MVP Features

- Visual Triage (Section A/B + destination routing)
- CTAS Triage (vitals, voice STT auto-fill, manual override)
- Patient Tracking board (12-hour active window)

## Tests

```bash
npm run test --workspace=@triagepulse/clinical
node scripts/stt-wer-harness.mjs
bash scripts/e2e-smoke.sh
```

See [docs/stt-module.md](docs/stt-module.md) for voice capture setup and PHI handling.

## Reference

The original Base44 app is kept in `reference/` for comparison only.
