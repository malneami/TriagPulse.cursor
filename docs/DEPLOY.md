# TriagePulse deploy checklist

## Production server (Google Cloud, Dammam)

- **URL:** https://triage-pulse.com — the whole app (web + API + database) on one server in me-central2.
- **How:** see [`deploy/gcp/README.md`](../deploy/gcp/README.md). Setup once with `deploy/gcp/setup.sh`;
  release with `deploy/gcp/deploy.sh` after merging to `main`.
- **Image:** the root `Dockerfile` (CI job "Production image" builds and smoke-tests it on every PR).
- The old GitHub Pages copy of the UI is retired (its workflow is disabled).

---

## API host checklist (Render / Railway / Fly / VM)

Recommended shape: **managed Postgres** + **one Node web service** for Nest (`apps/api`).

### 1. Database

- [ ] Provision PostgreSQL 16+
- [ ] Copy the connection string into `DATABASE_URL` (include SSL params if required, e.g. `?sslmode=require`)
- [ ] Confirm the host allows outbound connections from your API service

### 2. API service build & start

From repo root (monorepo):

```bash
npm ci
npm run build:api
npm run start:api
```

`start:api` runs `prisma migrate deploy`, seeds demo users, then starts Nest.

Host settings typically:

| Setting | Value |
|--------|--------|
| Root directory | repository root |
| Build command | `npm ci && npm run build:api` |
| Start command | `npm run start:api` |
| Node | 20+ |

### 3. Environment variables (API)

| Variable | Required | Notes |
|----------|----------|--------|
| `DATABASE_URL` | Yes | Managed Postgres URL |
| `JWT_SECRET` | Yes | Long random string (not the example value) |
| `JWT_EXPIRES_IN` | Optional | Default `8h` |
| `PORT` | Usually set by host | e.g. Render sets `$PORT` |
| `CORS_ORIGIN` | Yes | Exact Pages URL: `https://malneami.github.io` **or** full site origin if your CORS setup requires path — use the browser origin that loads the SPA (typically `https://malneami.github.io`) |
| `OPENAI_API_KEY` | Optional | Needed for OpenAI STT / Realtime; leave empty for browser-speech fallback |
| `OPENAI_STT_MODEL` / related | Optional | See `.env.example` |
| `OPENAI_REALTIME_VAD` | Optional | `off` is safer for continuous dictation |

Clinical / governance notes:

- Prefer an in-Kingdom / DPA-approved OpenAI endpoint before enabling STT in production.
- Treat all traffic as PHI; use HTTPS only; do not log transcripts to third-party analytics.

### 4. Wire the static UI to the API

- [ ] Deploy API and confirm `GET https://<api-host>/api/health` returns `{"status":"ok",...}`
- [ ] In GitHub → Settings → Secrets → Actions, add:
  - `VITE_API_URL` = `https://<api-host>` (no `/api` suffix; the client adds `/api`)
- [ ] Re-run workflow **Deploy GitHub Pages** (Actions → Run workflow)
- [ ] On the Pages site, open DevTools → Network and confirm login calls `VITE_API_URL`

### 5. Smoke test after cutover

- [ ] Login: `nurse@triagepulse.local` / `triage123`
- [ ] Visual triage → CTAS with chief complaint only
- [ ] Save triage / tracking board loads
- [ ] Voice: labeled vital re-dictation updates fields (if OpenAI key set) or browser STT fallback works

### 6. CORS / WebSocket gotchas

- Nest CORS uses a **single** `CORS_ORIGIN`. Match the Pages origin exactly.
- Socket.IO STT uses the API host. If `VITE_API_URL` is set, the client connects there for `/stt` and `/socket.io`.
- If login works but voice fails, check WebSocket upgrade / proxy idle timeouts on the host.

### 7. Security before any real patients

- [ ] Rotate `JWT_SECRET` and demo passwords
- [ ] Restrict who can access the Pages URL / API (VPN, IP allowlist, or IdP)
- [ ] Confirm backups for Postgres
- [ ] Do not commit `.env`; keep secrets only in the host + GitHub Actions secrets

---

## Quick “is it published?” table

| Layer | Published? | Where |
|-------|------------|--------|
| Web UI | Yes (after merge to `main`) | https://malneami.github.io/TriagPulse.cursor/ |
| API | Not until you host it | Your Render/Railway/Fly/VM URL |
| UI → API link | Not until `VITE_API_URL` secret + Pages rebuild | GitHub Actions secret |
