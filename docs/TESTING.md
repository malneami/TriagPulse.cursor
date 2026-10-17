# Testing TriagePulse from GitHub

No Render, no hosting, nothing to install. Two ways to test every change:

## 1. Try it yourself in a Codespace (the full app in your browser)

A Codespace is a private cloud computer from GitHub that runs the whole app:
web, API and its own empty Postgres database with test users.

1. Open the repository on GitHub and switch to the branch you want to test
   (for example a pull request's branch).
2. Click **Code → Codespaces → Create codespace on &lt;branch&gt;**.
3. Wait for the first-time setup (about 3–5 minutes). It installs everything,
   builds, creates the database and adds the test users.
4. The app opens in a new tab. If it does not (pop-up blockers often stop
   it), open the **Ports** tab in the bottom panel and click the globe icon
   next to **TriagePulse app (3001)**. The address looks like
   `https://<codespace-name>-3001.app.github.dev`.
5. Sign in with a test account (type it in; the login page does not list
   demo accounts in this build):

| Role | Email | Password |
|------|-------|----------|
| Nurse | nurse@triagepulse.local | triage123 |
| Physician | physician@triagepulse.local | triage123 |
| Admin | admin@triagepulse.local | triage123 |

These accounts exist only inside your codespace's own database. Use made-up
patients only.

- **Stop it** when you finish (GitHub → Codespaces → ⋯ → Stop) to save your
  free monthly hours. **Delete it** when the branch is merged.
- Testing another branch: create a new codespace on that branch.
- If you closed the app's terminal, start it again with `npm run codespace:app`.
  It builds the web app and serves it, with the API, on port 3001.
- For live code editing with hot reload use `npm run dev` instead (web on
  port 5174, API on 3001). Codespaces forwarding of port 5174 has proved
  unreliable, so port 3001 is the default.
- Voice transcription uses browser speech only (no OpenAI key is set).

## 2. Automatic checks on every pull request

`.github/workflows/ci.yml` runs on each pull request and shows a green tick
or red cross on the PR:

- Clinical engine tests (CTAS rules and speech extraction).
- Web and API builds; the production bundle must contain no demo passwords.
- End-to-end API checks (`scripts/e2e-api.mjs`) against a real API and a
  throwaway database: login, the live channels' login requirement, voice
  session ownership, Visual Triage → CTAS → save, the CTAS start clock, and
  that the API refuses to start with a weak secret.

Run the same checks locally against a running API with seeded demo users:

```bash
node scripts/e2e-api.mjs            # API at http://localhost:3001
API_URL=https://... node scripts/e2e-api.mjs
```
