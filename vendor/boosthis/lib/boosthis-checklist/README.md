# boosthis-checklist

> 118 battle-tested React Native performance rules. Pure data. Zero deps.

**Private workspace package — not published to any registry.** This package lives inside the Boosthis monorepo and is consumed by `@workspace/boosthis-runtime-rn` via `workspace:*`. There are no `npm publish` scripts, no `publishConfig`, and the package is marked `"private": true`.

The checklist is the foundation of Boosthis — every rule corresponds to at least one historical regression that bit a real codebase. Each entry is structured so an LLM, a CI script, or a human can match suspicious code shapes against it programmatically.

## Use (inside this monorepo only)

Add `"boosthis-checklist": "workspace:*"` to your package's `dependencies`, then `pnpm install`.

```ts
import { BOOSTHIS_CHECKLIST, getChecklistEntry } from "boosthis-checklist";

// Iterate every rule
for (const rule of BOOSTHIS_CHECKLIST) {
  console.log(rule.id, "—", rule.title);
}

// Look up a specific rule (e.g. from a Boosthis finding)
const rule = getChecklistEntry("split-driver-jitter");
console.log(rule?.whenToApply);
```

## Schema

```ts
interface BoosthisChecklistEntry {
  id:           string;        // stable identifier — never renamed
  title:        string;        // one-line headline
  whenToApply:  string;        // code shape that triggers this rule
  evidence:     string[];      // commits / files / external refs proving the rule
}
```

> **Detector-only by design.** This package ships only the fields needed to
> *detect* a rule on-device. The prescriptive **fix text** for each rule is
> deliberately NOT bundled here — it lives server-side and is served one rule at
> a time (so the rule IP can't be bulk-copied). `getChecklistEntry(...)` returns
> no `fixTemplate`; fetch the fix via the Boosthis MCP / `GET /rules/fix`.

## Sources

- **14 industry-mined** entries — Shopify, Discord, Margelo, Callstack, Indeed, React Native docs.
- **25 case-study** entries — distilled from production fixes in the Rival app and Boosthis's own mobile app.
- **5 operational** entries — cleanup, tracker placement, perception triage, ingest token semantics, version regression.

## Why pure data?

So an AI agent reading a Boosthis diagnosis report can also pull the checklist programmatically and propose code patches without ever loading the runtime. The checklist is the trust-builder; the runtime is the upgrade.

## License

Apache-2.0
