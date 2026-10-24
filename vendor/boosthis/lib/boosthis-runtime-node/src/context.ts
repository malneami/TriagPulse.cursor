/**
 * Generate the AI-agent context block for Node/Express projects.
 *
 * Mirrors the Python `boosthis context` surface: a drop-in markdown block for a
 * consumer project's `replit.md` so even no-tool AI agents (Replit AI, Claude,
 * Cursor) immediately learn Boosthis exists, what tools to call, and what data
 * they can ask for. Regenerate with:
 *
 *   pnpm --filter @workspace/boosthis-runtime-node run context
 */

import { CHECKLIST_COUNT } from "./checklist";
import { summary } from "./samples";
import { SCORE_THRESHOLDS } from "./thresholds";
import { DEFAULT_TELEMETRY_ENDPOINT } from "./telemetry";

/**
 * One-page markdown overview ready to inline into a consumer project's
 * `replit.md`. Designed so a Replit AI agent reading that file knows Boosthis
 * is installed, what MCP tools and HTTP endpoints exist, and how it classifies
 * latency.
 */
export function renderMarkdownContext(): string {
  const s = summary();
  const poor = Object.values(s.byRoute).filter(
    (r) => r.worst_rating === "poor",
  ).length;

  return `<!-- BOOSTHIS:BEGIN  Do not edit manually. Run \`pnpm --filter @workspace/boosthis-runtime-node run context\` to regenerate. -->
## Boosthis — perf toolkit for this project

This project is instrumented with **Boosthis** (workspace-installed perf toolkit —
installed via \`"@workspace/boosthis-runtime-node": "workspace:*"\`, not from npm).
It times every Express request, classifies it against shared thresholds, and
ships ${CHECKLIST_COUNT} Node.js performance rules.

**For AI agents (you, reading this):** Boosthis exposes itself via a local MCP
server and the in-app HTTP endpoints \`mount(app)\` installs. Both run on demand:

| What you need | How to ask Boosthis |
|---|---|
| All rules | MCP: \`boosthis.list_rules\` |
| Rule detail (fix template + when-to-apply) | MCP: \`boosthis.get_rule\` |
| Which rules might apply to a file | MCP: \`boosthis.match_rules_for_code\` |
| Recent perf samples + p50/p75/p99 | MCP: \`boosthis.session_summary\` · HTTP: \`GET /_boosthis/summary\` |
| Last 50 samples | MCP: \`boosthis.recent_samples\` · HTTP: \`GET /_boosthis/recent\` |
| Auto-learned budgets + regressions | MCP: \`boosthis.budgets\` · HTTP: \`GET /_boosthis/budgets\` |
| What to look at next | MCP: \`boosthis.what_should_i_look_at_next\` |

Run the MCP server (stdio) with
\`pnpm --filter @workspace/boosthis-runtime-node run mcp\`. The HTTP endpoints are
live whenever the app calls \`mount(app)\` (default prefix \`/_boosthis\`).

**Score thresholds** — used to classify any duration_ms measurement:
- TTFF: good ≤${SCORE_THRESHOLDS.ttff.good}ms · poor ≥${SCORE_THRESHOLDS.ttff.poor}ms
- TTI:  good ≤${SCORE_THRESHOLDS.tti.good}ms · poor ≥${SCORE_THRESHOLDS.tti.poor}ms
- FID:  good ≤${SCORE_THRESHOLDS.fid.good}ms · poor ≥${SCORE_THRESHOLDS.fid.poor}ms

A request is rated against the TTI thresholds by default: good if ≤${SCORE_THRESHOLDS.tti.good}ms,
poor if ≥${SCORE_THRESHOLDS.tti.poor}ms, needs-work in between.

**Current session:** ${s.total} samples, ${poor} route(s) currently rated poor.

**Telemetry (registered projects only):** for a registered app, privacy-safe issue signatures
and fix resolutions are sent always-on to \`${DEFAULT_TELEMETRY_ENDPOINT}\`. Full
per-route samples are ALSO sent unless \`issuesOnly: true\` is passed to
\`enableTelemetry()\`. Route labels are normalized and PII-redacted before being
recorded or transmitted, and source code, diffs, and raw values are never sent.
\`BOOSTHIS_DISABLED=1\` (or \`forget()\`) silences everything.

**Privacy contract:** Boosthis refuses to transmit any payload whose keys match
its 83-entry PII denylist. If you generate code that calls \`safeTransmit()\` or
\`assertNoPII()\`, do not strip those guards.
<!-- BOOSTHIS:END -->
`;
}
