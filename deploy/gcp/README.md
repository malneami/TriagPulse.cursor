# TriagePulse server — Google Cloud

> **Current server: Doha (me-central1), project `triagepulse-512022`, IP 34.18.122.113.**
> Dammam (me-central2) is the target: Google opens it only to accounts billed through
> CNTXT (Google's Saudi reseller, cloud.cntxt.com) or on invoiced billing. Once the project
> is on such a billing account, run the scripts with `REGION=me-central2`, restore the
> database there (`pg_dump` from the Doha server), switch the DNS A record, then delete
> the Doha server. Until then: **test patients only** (data is outside KSA).

One small server runs the whole app at **https://triage-pulse.com**:

| Part | What | Where the data lives |
|---|---|---|
| `caddy` | HTTPS (automatic Let's Encrypt certificates), `www` → apex redirect | — |
| `app` | TriagePulse image: API + web app on one port, migrations on start | — |
| `db` | Postgres 16 | Server disk in the region; daily snapshots kept 14 days in the same region |

Secrets are in Secret Manager (stored only in the server's region) and are read by the server at
start. They are never in the repository, in metadata, or printed by the scripts.

## First setup (once)

1. Google Cloud: create a project and link billing (owner does this in the console).
2. `gcloud auth login` (owner).
3. Create everything:
   ```bash
   PROJECT=<project-id> ADMIN_EMAIL=<owner email> ADMIN_NAME="Dr Name" bash deploy/gcp/setup.sh
   ```
   It prints the server's IP address.
4. DNS at Namecheap (Advanced DNS): remove the parking records, then
   `A  @  -> <IP>` and `CNAME  www  -> triage-pulse.com.`
5. Release: `PROJECT=<project-id> bash deploy/gcp/deploy.sh`
6. First sign-in: the owner opens Secret Manager → `tp-admin-password` → view the value,
   signs in with `ADMIN_EMAIL`, and must set a new password. Then add staff under
   Menu → Staff.

## Speech keys (optional)

Add a version to `tp-speechmatics-key` (and/or `tp-openai-key`) in Secret Manager, then
make the server re-read secrets:
```bash
gcloud compute instances add-metadata triagepulse --zone=me-central1-a --metadata=tp-rev=$(date +%s)
```
Empty keys = voice capture is off; the rest of the app works.

## Boosthis performance monitoring (optional)

The API carries the Boosthis Node kit (vendored in `vendor/boosthis`, bundled at build
time). It starts only when `tp-boosthis-key` has a version. It sends request timings and
labels such as `GET /api/journeys/:id`, never bodies, headers, cookies or query values.
Add the project key without it showing on screen or in shell history:
```bash
read -rs K && printf %s "$K" | gcloud secrets versions add tp-boosthis-key --data-file=- && unset K
gcloud compute instances add-metadata triagepulse --zone=me-central1-a --metadata=tp-rev=$(date +%s)
```
(On a server made before this section existed: create the secret first with
`gcloud secrets create tp-boosthis-key --replication-policy=user-managed --locations=me-central1`
and grant `roles/secretmanager.secretAccessor` to the server's service account; and after the
release that brings this section, re-run the startup script once so the server picks up the
new settings: `gcloud compute ssh triagepulse --zone=me-central1-a --command='sudo google_metadata_script_runner startup'`.)
Switch it off: disable the secret version and bump `tp-rev`. The owner badge is off
(`BOOSTHIS_BUBBLE=0`); readings are on the Boosthis dashboard.

## Releases

Merge to `main`, then `PROJECT=<project-id> bash deploy/gcp/deploy.sh`. The server pulls the
new image within ~20 seconds; downtime is a few seconds while the app restarts.

## Checking the server (no SSH needed)

```bash
gcloud compute instances get-guest-attributes triagepulse --zone=me-central1-a   # last deploy result
gcloud logging read 'logName:"gcplogs-docker-driver"' --limit=50 --freshness=1h   # app/db/caddy logs
```

## Restore from a snapshot

Compute Engine → Snapshots → pick a `triagepulse` snapshot → Create disk → stop the VM,
swap the boot disk, start. The database is inside the disk (Docker volume `triagepulse_pgdata`).

## Before real patient data

Test patients only until the PDPL decision on identifiers is made and HMG approves hosting.
