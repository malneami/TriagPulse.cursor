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
4. The app opens in a new tab. If it does not, open the **Ports** tab and
   click the globe icon next to **TriagePulse app (5174)**.
5. Sign in with a test account:

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
- The app restarts with `npm run dev` in the terminal if you closed it.
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
