# Supabase development database

TriagePulse uses a Supabase Postgres project for **development and demos only**.
Project ref: `wfewtexpnuprlpsvpbdz`.

> **Synthetic or test patients only.** Supabase has no region in Saudi Arabia,
> so real patient data must not be entered here. Before the Takhassusi PoC the
> database moves to Cloud SQL (Dammam) or HMG infrastructure: the same Prisma
> migrations build it, and `pg_dump` / restore carries over any test data.

Supabase is used as **plain Postgres**. The NestJS API is the only way into the
data: we do not use Supabase Auth, Storage or the auto-generated Data API.

## 1. Connection strings

In the Supabase dashboard, open the project and use the **Connect** button to
copy the pooler connection strings. Replace `[YOUR-PASSWORD]` with the
database password set when the project was created.

| Variable | Use | Supabase connection | Port |
|---|---|---|---|
| `DATABASE_URL` | The running API | Transaction pooler, add `?pgbouncer=true&connection_limit=1` | 6543 |
| `DIRECT_URL` | `prisma migrate deploy` only | Session pooler (or direct connection) | 5432 |

```env
DATABASE_URL=postgresql://postgres.wfewtexpnuprlpsvpbdz:[YOUR-PASSWORD]@<pooler-host>:6543/postgres?pgbouncer=true&connection_limit=1
DIRECT_URL=postgresql://postgres.wfewtexpnuprlpsvpbdz:[YOUR-PASSWORD]@<pooler-host>:5432/postgres
```

Keep these in `.env` locally (never committed) and in the hosting provider's
secret store. Never paste them into chat, issues or commits.

## 2. Create the schema (once, on an empty project)

Either:

- **SQL editor:** paste `prisma/supabase-init.sql` into the SQL editor and run it.
  It creates every table, enables row-level security, and records the migrations
  in `_prisma_migrations` so later deploys only apply new migrations; or
- **CLI:** with `DIRECT_URL` set, run `npm run db:migrate:deploy` from the repo root.

`prisma/supabase-init.sql` is generated from `prisma/migrations/`. After adding a
new migration, apply it with `npm run db:migrate:deploy`, not by editing that file.

## 3. Security settings to keep

- **Row-level security is on for every table, with no policies** (migration
  `20261014000000_enable_row_level_security`). Supabase's Data API roles
  (`anon`, `authenticated`) therefore cannot read or write anything. The API
  connects as the table owner, which bypasses RLS.
- **Data API:** turn it off in the project's API settings, or expose no schemas.
  Nothing in TriagePulse uses it.
- **Database password:** long and random; rotate it if it is ever shared.
- **Plan:** use a paid plan. Free projects pause after inactivity, which would
  take the API down (the same failure as the old Render setup).

## 4. Create the first real user

Demo accounts are never created outside local development. With `DATABASE_URL`
pointing at Supabase, run from the repo root:

```bash
ADMIN_EMAIL=you@example.com ADMIN_NAME="Dr Your Name" npm run admin:create
```

It prints a one-time random password. Add further users the same way with
`ADMIN_ROLE=nurse` or `ADMIN_ROLE=physician`; `RESET=1` issues a new password.

## 5. Run locally against Supabase

```bash
npm install
cp .env.example .env   # then fill DATABASE_URL, DIRECT_URL and JWT_SECRET
npm run build --workspace=@triagepulse/clinical
npm run db:generate --workspace=@triagepulse/api
npm run dev
```
