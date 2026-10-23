/**
 * boosthis-checklist — the React Native performance rule book (pure data).
 *
 * This is the EDITABLE SOURCE of truth for the RN checklist, the sibling of
 * `lib/boosthis-runtime-node/src/checklist.ts` (Node) and
 * `lib/boosthis-py/boosthis/checklist.py` (Python). It builds to `dist/` via the
 * root `tsc --build` (the package is referenced from the root tsconfig). The
 * built `dist/index.js` is what Metro and the blind-copied drop-in kit consume
 * at runtime, so `dist/` is committed alongside this source.
 *
 * Each entry ships its DETECTOR on-device (`whenToApply` + `evidence`); the
 * prescriptive fix text lives server-only in `lib/boosthis-fixes`.
 */

export type Category = "case-study" | "industry" | "operational";

export interface BoosthisChecklistEntry {
  id: string;
  title: string;
  /** When this rule applies — what code shape triggers a check. */
  whenToApply: string;
  /** Files / commits / external references where this rule was
   *  validated against a real regression. */
  evidence: string[];
  /** Provenance bucket, shared shape with the Node/Python/Web checklists so
   *  cross-runtime tooling can group any rule entry uniformly. */
  category: Category;
  /** Always ["react-native"] for this pack. Present for cross-runtime symmetry
   *  with the Node (["node"]), Python (["python"]) and Web (["web"]) packs. */
  languages: ReadonlyArray<"react-native">;
}

/**
 * Category provenance for each RN rule — the single source of truth for RN rule
 * categories (previously duplicated in the mobile dashboard's score.ts). The 25
 * case-study + 17 operational ids are enumerated explicitly; every other rule is
 * "industry". These counts are cross-checked by the rule-count guard against the
 * mobile dashboard's CATEGORY_COUNT literal (25 / 76 / 17), so keep them in sync.
 */
const CASE_STUDY_IDS: ReadonlySet<string> = new Set([
  "split-driver-jitter",
  "registration-retry-no-cooldown",
  "background-render-leak",
  "masked-layer-overdraw",
  "wave-subtree-under-attribution",
  "un-cached-image-spike",
  "persistent-mount-gesture",
  "heavy-asset-preload",
  "unbounded-search-results",
  "oversized-thumbnail-fetch",
  "heavyready-tier-stagger",
  "unguarded-render-crash",
  "rn-fetch-abortcontroller-timeout",
  "hermes-web-global-instanceof",
  "hermes-unbound-native-fetch",
  "rn-xhr-reused-socket-drop",
  "resilient-transport-must-throw",
  "unguarded-native-promise",
  "eager-hydration-blocks-first-paint",
  "duplicate-react-native",
  "first-run-call-gated-on-own-result",
  "rn-install-id-reuse",
  "rn-credential-callback-value-change",
  "guard-nullish-values-in-render",
  "guard-cart-item-render-data",
]);

const OPERATIONAL_IDS: ReadonlySet<string> = new Set([
  "useeffect-cleanup-required",
  "tracker-on-every-screen",
  "prefer-perception-over-raw-score",
  "ingest-token-is-public-by-design",
  "check-version-regression-before-ship",
  "credentialed-refusal-signin-challenge",
  "generic-refusal-message",
  "strict-credential-scheme-parsing",
  "silent-protection-fail-open",
  "rn-websocket-reconnect-storm",
  "rn-realtime-no-heartbeat",
  "rn-socket-never-closed",
  "rn-socket-reconnect-per-screen",
  "rn-crash-swallowed-process-keeps-running",
  "rn-after-response-work-lost",
  "rn-stream-timing-at-handler-return",
  "rn-shed-on-wake-stall",
]);

function categoryFor(id: string): Category {
  if (CASE_STUDY_IDS.has(id)) return "case-study";
  if (OPERATIONAL_IDS.has(id)) return "operational";
  return "industry";
}

const RAW_ENTRIES: ReadonlyArray<
  Omit<BoosthisChecklistEntry, "category" | "languages">
> = [
  {
    id: "split-driver-jitter",
    title: "Single-driver rule for animated components",
    whenToApply:
      "Any component whose geometry is driven by a Reanimated worklet (UI thread) AND whose style props (color, opacity, fill) are driven by a separate JS setInterval / setState. Symptom: motion is 60fps-smooth but color/style 'pops' in steps and re-renders neighbours on the JS thread.",
    evidence: ["app/(tabs)/messages.tsx VizBar", "components/HandshakeOutlineRing.tsx"],
  },
  {
    id: "background-render-leak",
    title: "Focus-gate continuous animations",
    whenToApply:
      "Any component running a continuous loop (rAF, Reanimated withRepeat, Animated.loop, setInterval) that doesn't check screen focus. Symptom: foreground frame drops because a backgrounded tab is still spinning.",
    evidence: ["components/PlayerIDCard.tsx (gold-shimmer)", "components/HandshakeOutlineRing.tsx"],
  },
  {
    id: "masked-layer-overdraw",
    title: "Rasterize large rotating layers under MaskedView",
    whenToApply:
      "Rotation worklet drives a large gradient / bitmap (>~600px) sitting inside a MaskedView. Symptom: rotation is on the UI thread (smooth on paper) but visually jittery on iOS due to per-frame mask re-composition.",
    evidence: ["components/PlayerIDCard.tsx (gold-shimmer rotation)"],
  },
  {
    id: "wave-subtree-under-attribution",
    title: "Track wave-revealed subpages under their own screen name",
    whenToApply:
      "A drag-down wave page (Feed→Fan Power, Activities→Rival League, Profile→Card) mounts inside its parent tab's `openContent` prop. Without its own usePerfTracker, the wave page's mount cost is invisibly folded into the parent tab's number.",
    evidence: ["wave/profile-card", "wave/rival-league", "perfDiagnose changelog 2026-05-14"],
  },
  {
    id: "un-cached-image-spike",
    title: "Use expo-image with cache policy for repeated assets",
    whenToApply:
      "Lists or grids that show recurring small images (team crests, rank badges, avatars) using stock `<Image>`. Symptom: scroll triggers heavy-commit flags and frame drops because each cell decodes / fetches afresh.",
    evidence: ["app/rival/[id].tsx", "app/create-profile.tsx", "app/(tabs)/matches"],
  },
  {
    id: "persistent-mount-gesture",
    title: "Keep gesture-handler subtrees permanently mounted",
    whenToApply:
      "A PanGestureHandler / GestureDetector / Modal-with-drag lives inside a conditional mount (e.g. `isOpen && <Overlay>`) that the user opens and closes repeatedly. Symptom: first interaction works, second drag is dead — and on close/re-open you see a brief freeze as RNGH re-attaches handlers.",
    evidence: [
      "commit 17ca9a8 (modal persistently mounted)",
      "commit 6b9f693 (wave overlay permanently mounted)",
      "commit c64d524 (gesture handler re-init fix)",
    ],
  },
  {
    id: "heavy-asset-preload",
    title: "Pre-warm large textures / GL assets before the screen mounts",
    whenToApply:
      "A screen mounts a Three.js / GLView / large-texture component (3D Earth, sphere, model viewer) and the textures are loaded inline at mount time. Symptom: the navigation transition itself stutters, then a visible 'pop-in' as textures upload to the GPU.",
    evidence: [
      "components/three/EarthSceneShared.tsx (preloadEarthAssets)",
      "commit 9015abe (3D Earth globe loading)",
    ],
  },
  {
    id: "unbounded-search-results",
    title: "Cap & memoize live-search dropdowns",
    whenToApply:
      "An overlay/dropdown filters a local dataset (players, teams, groups) on every keystroke and renders all matches. Symptom: typing feels sluggish, keyboard input lags 1-2 frames behind the screen, and Boosthis flags messages-style sync blocks on the search screen.",
    evidence: ["app/(tabs)/search.tsx", "commit fb5144c"],
  },
  {
    id: "oversized-thumbnail-fetch",
    title: "Match thumbnail resolution to the rendered size",
    whenToApply:
      "Feed/grid tiles request high-res media (`hqdefault.jpg`, full-width images, `original` from a CDN) but render at <200px wide. Symptom: scroll-time heavy-commits, memory pressure on long sessions, slow first paint of the feed.",
    evidence: [
      "components/feed/TrendingFeed.tsx",
      "commit b9ef25a (video tile + trending feed)",
    ],
  },
  {
    id: "heavyready-tier-stagger",
    title: "Stagger multiple heavy components onto different idle frames",
    whenToApply:
      "A screen has 2+ heavy children (Map + Globe, 3D card + Masonry grid, etc.) all gated by the SAME `useStagedHeavyReady()` hook. Symptom: even after the gate opens, you still see a single deferred-work hump because all heavies mount in the same frame.",
    evidence: [
      "hooks/useStagedHeavyReady.ts",
      "app/(tabs)/index.tsx",
      "app/(tabs)/profile.tsx",
    ],
  },
  {
    id: "registration-retry-no-cooldown",
    title: "Cool down failed registration/handshake retries — never re-attempt on every flush",
    whenToApply:
      "A one-time 'first contact' call (install/device registration, consent, enrollment, license activation, first token mint) is lazily retried from a hot path — every upload flush, AppState change, timer tick, or screen focus — until it succeeds, with no cool-down and no special handling for HTTP 429. Symptom: a client that cannot finish registering (offline at setup, pending invite, busy server) silently re-attempts dozens of times an hour; behind a shared proxy/NAT egress IP those retries drain the server's per-IP registration rate bucket and starve OTHER clients' genuine first registrations — the failure surfaces on a different machine than the bug. Distinct from a tight retry loop (a tight loop retried too fast): each attempt here is cadence-driven and looks harmless in isolation, so the hammering hides in normal traffic.",
    evidence: [
      "Boosthis production incident (Jul 2026) — per-flush consent retries starved a shared per-IP registration rate bucket and blocked new installs",
      "Google SRE Book — Handling Overload (retry amplification)",
    ],
  },
  /* ─────────── Industry-mined entries (Shopify · Discord · Margelo · Callstack · Indeed · RN docs) ─────────── */
  {
    id: "viewport-first-render",
    title: "Render only what's in the viewport on first paint",
    whenToApply:
      "A screen renders carousels, grids, or feeds where N items are needed for smooth interaction but only the first 1-2 are actually visible at first paint. Symptom: first-paint cost scales with the full item count instead of the visible-cell count.",
    evidence: ["Shopify Engineering — Improving Shopify App's Performance (Mar 2024)"],
  },
  {
    id: "screen-load-budget-500ms-p75",
    title: "Treat 500ms P75 as the per-screen budget — technology-agnostic",
    whenToApply:
      "Any user-facing screen. Once a screen exceeds 500ms P75 in the snapshot/diff, escalate it regardless of which pattern caused the regression — Boosthis's classifier tells you the cause, the budget tells you whether you're allowed to ship it.",
    evidence: ["Shopify Engineering — Five Years of React Native at Shopify (Jan 2025)"],
  },
  {
    id: "cold-start-budget-2s-p75",
    title: "Treat 2s P75 as the cold-start app-launch budget",
    whenToApply:
      "App launch / cold-start path. Boosthis currently focuses on screen-mount cost; cold start is a separate ladder (JS bundle load → root render → first navigation → first paint).",
    evidence: ["Shopify Engineering — Five Years of React Native at Shopify (Jan 2025)"],
  },
  {
    id: "subscribe-at-the-leaf",
    title: "Subscribe to frequently-updating stores at the leaf, never at the root",
    whenToApply:
      "A top-level component (layout, root navigator, app shell) consumes a store/context that updates frequently (online presence, message stream, user list, websocket). Symptom: every store emit re-renders the entire tree because the subscription lives at the root and propagates down through non-pure children.",
    evidence: [
      "Discord Engineering — How Discord achieves native iOS performance with React Native (Nov 2019)",
    ],
  },
  {
    id: "dispatch-action-budget-10ms",
    title: "Flag any store dispatch / reducer that exceeds 10ms",
    whenToApply:
      "Flux/Redux/Zustand/Jotai dispatch handlers, reducer functions, or store-effect callbacks. Symptom: no visible jank, but the JS thread is wasting CPU + battery on every action.",
    evidence: [
      "Discord Engineering — How Discord achieves native iOS performance with React Native (Nov 2019)",
    ],
  },
  {
    id: "shared-value-async-write",
    title: "`sharedValue.value = x` is NOT a synchronous write",
    whenToApply:
      "Any code that reads back a Reanimated shared value immediately after writing it from the JS thread, OR that writes to multiple shared values in sequence and assumes they're applied in the same frame.",
    evidence: [
      "Margelo Blog — How Margelo Helped Discord Improve React Native's New Architecture Performance (Apr 2026)",
    ],
  },
  {
    id: "enable-new-architecture-first",
    title: "Enable Fabric + TurboModules + JSI before micro-optimizing anything",
    whenToApply:
      "Any RN app that's still on the old bridge architecture. Symptom: you're hand-tuning render paths and getting single-digit gains — when the foundation alone delivers ~30% smoother UI rendering for free.",
    evidence: [
      "Callstack — Ultimate Guide to React Native Optimization (2025)",
      "Shopify Engineering — Migrating to React Native's New Architecture (2025)",
    ],
  },
  {
    id: "frame-budget-16-67ms",
    title: "Every frame must paint within 16.67ms — anything over is a missed frame",
    whenToApply:
      "Steady-state animation, scroll, gesture, or interaction code. The FrameSampler's jankFraction (>32ms = double frame) catches the worst; the underlying budget is 16.67ms = 60fps.",
    evidence: ["React Native official docs — Performance Overview (reactnative.dev/docs/performance)"],
  },
  {
    id: "dev-mode-not-prod-perf",
    title: "Never measure perf in dev mode — Hermes optimizations only kick in production builds",
    whenToApply:
      "Anyone running Boosthis against a Metro/dev build and treating the numbers as ground truth. Symptom: `phase:afterCommit` 2-5× higher than the same screen in TestFlight / Play Internal.",
    evidence: ["React Native official docs — Performance Overview"],
  },
  {
    id: "native-thresholds-stricter-than-web",
    title: "Native budgets are ~6× stricter than Core Web Vitals",
    whenToApply:
      "Whenever you're tempted to copy web perf thresholds (LCP < 2.5s, FID < 100ms) into a mobile app. Native has no network for first paint, no HTML/CSS parse, no JS download — users rightfully expect it to be much faster.",
    evidence: ["Indeed Engineering — Bringing Lighthouse to the App (Mar 2026)"],
  },
  {
    id: "console-log-blocks-jsthread",
    title: "Strip console.log from production — they accumulate on the JS thread",
    whenToApply:
      "Production builds shipping with `console.log` / `console.warn` calls in hot paths (render, store dispatch, gesture handlers, render loops). Symptom: latent JS-thread cost that doesn't show up in dev.",
    evidence: ["React Native official docs — Performance Overview"],
  },
  {
    id: "single-event-perf-logging",
    title: "Log all perf metrics for a screen in ONE event, not three",
    whenToApply:
      "Instrumentation that emits TTFF, TTI, and FID as separate events. Symptom: querying for 'sessions where TTI > 500ms AND FID > 100ms' becomes a join across three event streams.",
    evidence: ["Indeed Engineering — Bringing Lighthouse to the App (Mar 2026)"],
  },
  {
    id: "components-self-report-interactive",
    title: "Components self-report when they're interactive — don't infer it",
    whenToApply:
      "Trying to algorithmically detect when a screen is 'really ready' (data loaded + UI rendered + handlers attached). Symptom: the inferred TTI fires either too early (before data) or too late (after a useless idle window).",
    evidence: ["Indeed Engineering — Bringing Lighthouse to the App (Mar 2026)"],
  },
  {
    id: "pure-children-prevent-fanout",
    title: "Make heavy children pure so upstream re-renders don't fan out",
    whenToApply:
      "An ancestor component re-renders for any reason and you see 10+ child components in the React DevTools profile re-rendering even though their props are unchanged. Symptom: a small upstream change is amplified into a large render commit.",
    evidence: [
      "Discord Engineering — How Discord achieves native iOS performance with React Native (Nov 2019)",
    ],
  },
  /* ─────────── 2026-05-15 audit additions — pair with novel detectors and clarify operations ─────────── */
  {
    id: "useeffect-cleanup-required",
    title: "Every useEffect that opens something must return a cleanup that closes it",
    whenToApply:
      "Any useEffect that calls setInterval / setTimeout / addEventListener / .subscribe() / a WebSocket constructor / requestAnimationFrame, or fires off any other long-lived work. Symptom: Boosthis's `stranded-interval` detector reports events tagged for a screen firing AFTER its last unmount; battery drains in the background; race conditions on remount.",
    evidence: [
      "lib/perfNovelDetectors.ts — detectStrandedIntervals",
      "BOOSTHIS_AUDIT 2026-05-15 §4 (1)",
    ],
  },
  {
    id: "tracker-on-every-screen",
    title: "Put usePerfTracker on every screen route — not in shared layouts",
    whenToApply:
      "A new screen file in `app/**` that doesn't call `usePerfTracker(name)` at the top of its component. Or worse: a layout (`_layout.tsx`, a TabBar wrapper, a root navigator) that calls usePerfTracker once and inherits the metric across many screens. Symptom: the screen never appears in /dev/perf rows, or its number is wrong because the timer resolved at the wrong tree depth.",
    evidence: ["hooks/usePerfTracker.ts", "BOOSTHIS_AUDIT 2026-05-15 §4 (2)"],
  },
  {
    id: "prefer-perception-over-raw-score",
    title: "Triage with perceptionScore, not the raw score",
    whenToApply:
      "Looking at /dev/perf or a snapshot diff and trying to decide which slow screen to fix first. The raw score charges you for all of TTI; the perception score subtracts the ~280ms slide-animation occlusion window the user can't see through. A screen with raw 62 / perception 91 feels instant; a screen with raw 75 / perception 70 doesn't.",
    evidence: [
      "lib/perfNovelDetectors.ts — computePerceptionScore",
      "BOOSTHIS_AUDIT 2026-05-15 §4 (3)",
    ],
  },
  {
    id: "ingest-token-is-public-by-design",
    title:
      "EXPO_PUBLIC_BOOSTHIS_INGEST_TOKEN ships in the bundle — treat it as anti-abuse, not a secret",
    whenToApply:
      "Any code or doc that assumes the ingest token confers privacy or authentication strength. Symptom: someone proposes putting user IDs in samples 'because the endpoint is authenticated'; or someone removes server-side validation 'because the token already gates access'.",
    evidence: [
      "lib/perfProdSampler.ts (file header)",
      "api-server/src/routes/perf.ts (rate limit + validation)",
      "BOOSTHIS_AUDIT 2026-05-15 §4 (4)",
    ],
  },
  {
    id: "check-version-regression-before-ship",
    title: "Diff /perf/by-version against the prior release before tagging the next one",
    whenToApply:
      "Before cutting any new app version (TestFlight build, Play Internal track, prod deploy). The api-server's `/perf/by-version` endpoint groups every persisted prod sample by appVersion → screen, computes p50/p75 score + p75 TTI per cell, and flags screens where the latest version is meaningfully worse than the previous one (≥5 score points or ≥100ms TTI at p75, with ≥3 samples per side).",
    evidence: [
      "api-server/src/routes/perf.ts — /perf/by-version + analyzeByVersion()",
      "BOOSTHIS_AUDIT 2026-05-15 §6 item #1 (now shipped)",
    ],
  },
  {
    id: "unguarded-render-crash",
    title: "Wrap injected/risky subtrees in a React error boundary",
    whenToApply:
      "Any component that renders a third-party widget, a drop-in / injected component, or a complex dynamic subtree (especially one whose props come from network / remote data) directly under a tab, modal, or the app root WITHOUT a surrounding React error boundary. React error boundaries catch render-phase throws only; an uncaught render throw that reaches the root unmounts the ENTIRE React tree, so one bad component - or one bad prop from upstream data - turns a localized bug into a full-app white-screen crash. Symptom: a small component error takes the whole app down, and a frozen TestFlight / store build cannot be hotfixed. Especially critical for guest / drop-in code running inside someone else's app.",
    evidence: [
      "lib/boosthis-runtime-rn/src/ui/BoosthisErrorBoundary.tsx",
      "Boosthis crash-safety hardening - host app 'Rival' taken down by an uncaught render throw in a drop-in component that shipped with zero error boundaries",
    ],
  },
  {
    id: "rn-fetch-abortcontroller-timeout",
    title: "Avoid AbortController-based fetch timeouts in React Native",
    whenToApply:
      "Any consumer RN code that creates an AbortController and passes its `signal` into fetch() (or a fetch wrapper) to implement a request timeout or cancel — typically a `fetchWithTimeout` / `fetchResilient` helper that does `new AbortController()`, `setTimeout(() => controller.abort(), ms)`, then `fetch(url, { signal })`. On some React Native / Hermes runtimes (seen in real TestFlight builds) passing `signal` to fetch throws SYNCHRONOUSLY before any network I/O, so the request never leaves the device and every call fails — even though a signal-free fetch to the same host on the same device succeeds. Symptom: a feature that does network I/O (sign-in, upload, claim) dies instantly with a generic 'could not reach server' error while other requests work, and retry/backoff can't help because each attempt dies on the same signal before the network is ever touched.",
    evidence: [
      "lib/boosthis-runtime-rn/src/ui/account.ts — fetchWithTimeout regression: AbortController signal (alpha.25) replaced by a Promise.race timer (alpha.27)",
      "lib/boosthis-runtime-rn/src/__tests__/account.test.ts",
    ],
  },
  {
    id: "hermes-web-global-instanceof",
    title: "Never use `instanceof` against a web global on Hermes / New Architecture",
    whenToApply:
      "Any RN code — especially a custom fetch wrapper, a header/body normalizer, a file-upload path, a polyfill/feature check, or a vendored expo/fetch transport — that does `x instanceof Headers`, `instanceof Request`, `instanceof Response`, `instanceof ReadableStream`, `instanceof Blob`, `instanceof File`, `instanceof FormData`, or `instanceof AbortSignal`. On Hermes + the New Architecture these web globals are frequently UNDEFINED in a RELEASE bundle, and `instanceof` against an undefined right-hand side throws SYNCHRONOUSLY ('right operand of instanceof is not an object') before any network or render work runs. Symptom: a feature that touches the network (sign-in, upload, claim) dies in ~1ms with a generic 'could not reach server' on every shipped TestFlight / Play build, while the exact same code works in dev (where the globals exist). Guard every such check with `typeof X !== 'undefined' && x instanceof X`, or avoid it entirely by passing primitive shapes (array-tuple headers, string bodies) so no detection runs.",
    evidence: [
      "Rival host-app iOS/Hermes sign-in incident — build 173 expo/fetch normalizeHeadersInit `headers instanceof Headers` threw synchronously in ~1ms; fixed in build 174 by passing array-tuple headers so the throwing branch is never reached",
      "expo/fetch normalizeHeadersInit (web-global instanceof on Hermes)",
    ],
  },
  {
    id: "hermes-unbound-native-fetch",
    title: "Bind native `fetch` to its global before storing a reference (Hermes release crash)",
    whenToApply:
      "Any RN code that captures, destructures, or re-exports the native `fetch` as a BARE reference — `const f = globalThis.fetch`, `const { fetch } = globalThis`, passing `fetch` as a callback, or a telemetry/transport wrapper that stores `fetch` to call later. On Hermes the native `fetch` is bound to its host object; an UNBOUND reference invoked later throws 'fetch is not a function' in the RELEASE bundle even though it works in dev (Metro). Symptom: network code that ran fine in development dies on every TestFlight / Play build with 'is not a function'. Always resolve it bound — `const doFetch = (typeof fetch === 'function' ? fetch : globalThis.fetch).bind(globalThis)` — or call `globalThis.fetch(...)` directly at the call site instead of caching a reference.",
    evidence: [
      "Rival host-app iOS/Hermes sign-in incident — a stored globalThis.fetch wrapper threw 'is not a function' in release; resolved by binding the native fetch to globalThis before use",
      "lib/boosthis-runtime-rn/src/ui/account.ts (resolveFetch binds the native fetch)",
    ],
  },
  {
    id: "rn-xhr-reused-socket-drop",
    title: "RN's built-in XHR can silently drop responses on reused iOS sockets — use expo/fetch for critical requests",
    whenToApply:
      "An Expo iOS app on Hermes + the New Architecture making REPEATED requests to the same host via RN's built-in `fetch` / `XMLHttpRequest` (RCTNetworking) in a RELEASE build — auth, upload, claim, polling. RCTNetworking can silently lose the response on a REUSED connection: the request reaches the server and the server replies in under a second, but the device never fires readyState 2/3/4, so the call looks like a status-0 stall / timeout. The FIRST call on a fresh socket (e.g. a launch-time consent/ping) succeeds, which masks the bug and makes a later call (sign-in) look uniquely broken. Symptom: correct and wrong inputs behave identically (no response either way); the server logs show 200/401 in <1s while the device traces a transport failure with no readyState 2/3. Route critical requests through `expo/fetch` (URLSession-backed, separate from RCTNetworking) with Hermes-safe argument shapes (array-tuple headers, string body), and verify on the SECOND+ request of a session, not just at launch.",
    evidence: [
      "Rival host-app iOS/Hermes sign-in incident — PROVEN root cause: device→server reused-socket response drop; consent on a fresh socket worked, login on a reused socket hung; resolved by routing auth through expo/fetch (URLSession)",
    ],
  },
  {
    id: "resilient-transport-must-throw",
    title: "A retrying transport must THROW on transport failure, never resolve a synthetic response",
    whenToApply:
      "Any retry / timeout / backoff wrapper around the network (a `fetchResilient` / `fetchWithRetry` helper, or a host-supplied `fetchImpl` / transport adapter) whose retry path only fires on a REJECTED promise. If the underlying transport catches a transport-level failure (status ≤ 0, network error, timeout, a dropped/reset socket) and RESOLVES a synthetic `{ status: 0, ok: false }` instead of throwing, the resolved value is treated as success and skips the retry/backoff entirely — defeating the exact dead-socket recovery the wrapper exists for. Symptom: retries never engage over a flaky/dead connection, so one silent drop becomes a permanent failure. Contract: a transport must THROW on transport failure and RESOLVE only on a genuine HTTP response; when reading a raw XHR, read `xhr.status` only at `readyState === 4`, inside try/catch with a single 'settled' guard, and keep each attempt's timeout below the wrapper's per-attempt race.",
    evidence: [
      "Rival host-app iOS/Hermes sign-in incident — a host adapter resolved {status:0} which skipped the kit's retry-over-dead-socket; fixed by throwing on status ≤ 0; reading xhr.status mid-flight (build 167) also aborted the handler",
    ],
  },
  {
    id: "unguarded-native-promise",
    title: "Guard every fire-and-forget native call — an unhandled rejection is a red LogBox crash",
    whenToApply:
      "Any RN code that calls an async native / Expo API for its side effect and neither awaits it nor attaches a `.catch` — e.g. `Haptics.impactAsync(...)`, `Clipboard.setStringAsync(...)`, `SecureStore.setItemAsync(...)`, `AsyncStorage.setItem(...)`, `Linking.openURL(...)`, `Sharing.shareAsync(...)`, or any promise-returning module method fired inside a synchronous handler (onPress, onLongPress, a gesture callback, a render effect). These calls reject on real devices for benign reasons — haptics unavailable on the simulator / older hardware, clipboard or keychain permission denied, a backgrounded app, a stale URL — and an unhandled rejection surfaces as a red LogBox 'Possible unhandled promise rejection' / 'Uncaught (in promise)' overlay in dev and a silent reliability hole in release. Symptom: tapping a button that 'just' buzzes, copies, or persists a flag throws a red error box even though the visible feature still works. Fix shape: either `await` the call inside an `async` handler wrapped in try/catch, or attach `.catch(() => {})` (or a logged no-op) to every fire-and-forget call so a benign native rejection can never escape. Especially critical for guest / drop-in code running inside someone else's app, where one stray rejection erodes trust in the host.",
    evidence: [
      "Boosthis mobile dashboard — the re-render Haptics.impactAsync button and the Apps-tab copy/select/delete/toggle handlers fired native promises with no .catch, surfacing red LogBox 'Uncaught (in promise)' overlays; hardened by wrapping each fire-and-forget call in safeAsync/.catch",
      ".agents/memory/rn-unhandled-native-promises.md",
    ],
  },
  {
    id: "flatlist-virtualization-config",
    title: "Tune FlatList/SectionList virtualization for long lists — defaults aren't sized for big or heavy rows",
    whenToApply:
      "A `FlatList`, `SectionList`, or `VirtualizedList` rendering a long, growing, or remotely-fetched data set that scrolls with blank flashes, dropped frames, or climbing memory, where the virtualization and batching props are left at their defaults for the content — the first paint mounts far more than one screenful of rows, a long Android list keeps off-screen rows attached, or fixed-height rows force async on-scroll measurement and janky scroll-to-index. Heavy per-row contents amplify all of this. Symptom: white space while flinging fast, a slow first render, or memory that grows with scroll distance instead of staying flat. The prescriptive prop tuning lives in the server-side fix.",
    evidence: [
      "React Native docs — Optimizing FlatList Configuration (windowSize, maxToRenderPerBatch, updateCellsBatchingPeriod, initialNumToRender, removeClippedSubviews)",
      "React Native docs — FlatList props getItemLayout / keyExtractor for fixed-height rows and scroll performance",
    ],
  },
  {
    id: "scrollview-for-long-lists",
    title: "Never render a long or dynamic list inside a ScrollView — use FlatList/SectionList",
    whenToApply:
      "A `ScrollView` whose children are produced by mapping over an array — `{items.map((it) => <Row …/>)}` — especially when that array is large, grows over time, or comes from the network. A ScrollView renders and mounts ALL of its children up front and keeps them mounted, so there is no virtualization: mount time, view count, and memory all scale with list length. Symptom: a list that feels fine with 10 items but mounts slowly, stutters on scroll, and bloats memory as it grows to hundreds. Scope guard: a genuinely short, bounded, mostly-static ScrollView (a settings page, a form, a few cards) is fine and is NOT this rule — the trigger is an unbounded or growing mapped list. The virtualized-list replacement lives in the server-side fix.",
    evidence: [
      "React Native docs — ScrollView vs FlatList: ScrollView renders all children at once, FlatList for long/lazy lists",
      "React Native docs — Optimizing FlatList Configuration / VirtualizedList same-orientation nesting warning",
    ],
  },
  {
    id: "scroll-event-throttle",
    title: "Throttle onScroll and drive scroll-linked animation on the native thread",
    whenToApply:
      "A `ScrollView`/`FlatList`/`Animated.ScrollView` with an `onScroll` handler that drives state or animation but leaves the scroll handler unthrottled, or whose onScroll calls `setState` on every event. The scroll event can fire continuously; with the handler unthrottled the JS callback runs more often than needed, and a `setState` per event triggers a re-render storm that drops frames during the gesture. A heavy onScroll handler that reads layout or allocates on every event makes it worse. Symptom: scrolling feels heavy or stutters, CPU spikes while dragging, a parallax/sticky-header effect lags behind the finger. The throttle value and the native-driver animation approach are in the server-side fix.",
    evidence: [
      "React Native docs — ScrollView.scrollEventThrottle (controls onScroll frequency; 16 ≈ once per frame)",
      "React Native docs — Animations: useNativeDriver for Animated.event scroll mapping off the JS thread",
    ],
  },
  {
    id: "context-value-identity",
    title: "Memoize Context provider values — a fresh value object re-renders every consumer",
    whenToApply:
      "A React Context `Provider` whose `value` is an object, array, or function literal created inline in render — `<Ctx.Provider value={{ user, setUser }}>` or `value={[state, dispatch]}` — with no memoization. Because the value's identity changes on every render of the provider component, EVERY consumer that reads it with `useContext` re-renders even when the underlying data is unchanged. This is most expensive for a high-level/app-root provider (auth, theme, settings) with many consumers, where one unrelated parent re-render cascades through the whole tree. Symptom: distant components re-render on every keystroke/tick in a parent; the profiler shows consumers updating with identical data. The memoization shape (and when to split one context into several) lives in the server-side fix.",
    evidence: [
      "React docs — useContext: a fresh provider `value` object re-renders all consumers; memoize it (useMemo) and its callbacks (useCallback)",
      "React docs — Scaling Up with Reducer and Context / Passing Data Deeply with Context (memoizing the context value)",
    ],
  },
  {
    id: "inline-callbacks-break-memo",
    title: "Don't pass inline function/object props to a memoized child — it defeats React.memo",
    whenToApply:
      "TIGHTLY scoped: a child component wrapped in `React.memo` (or a class `PureComponent`) that receives a prop created fresh on every parent render — an inline arrow function, or an object/array literal passed straight into the JSX. React.memo/PureComponent skip re-rendering only when props are shallow-equal between renders; a new function or object identity each render fails that check, so the memoized child re-renders anyway and the memo adds cost without benefit. This matters most for a memoized row rendered many times in a list. Symptom: a `React.memo` child still re-renders on every parent update; the profiler shows it updating because a handler or object prop 'changed'. Scope guard: this applies ONLY when the receiving child is `React.memo`/`PureComponent` — inline arrows/objects on a NON-memoized child are NOT this rule (there is no memo to break). The stabilization shape lives in the server-side fix.",
    evidence: [
      "React docs — React.memo: a memoized component still re-renders when a prop changes by reference; memoize object/function props with useMemo/useCallback",
      "React docs — useCallback: caching a function definition between renders so a memoized child can skip re-rendering",
    ],
  },
  {
    id: "remote-null-field-read",
    title: "Guard remote/async object fields before reading them — unchecked deref is the #1 RN crash",
    whenToApply:
      "Any component, selector, or effect that reads NESTED fields off an object sourced from the network, a remote cache, route/navigation, or async storage that can be null/undefined or partially shaped before the first successful load — e.g. `data.user.name`, `props.profile.avatar.uri`, `res.items[0].id` — and dereferences them directly on the first render. While the request is in flight (or after it fails) the object is null/undefined and the deref throws `undefined is not an object (evaluating 'x.y')` / `cannot read property 'y' of undefined`, the single most common React Native production crash. Symptom: a screen that works once data is cached crashes on a cold open, on a slow network, or when an upstream field is missing or renamed. Scope note: reading a field off a value already proven non-null (local state with a sensible initial value, a prop typed and supplied by a parent) is NOT this rule — the trigger is dereferencing a value that can legitimately arrive empty.",
    evidence: [
      "React Native production-crash guides (2025) — 'undefined is not an object' / 'cannot read property of undefined' is the most common RN crash, from unchecked access to async/remote data",
      "Sentry mobile — render loading & error states; never dereference optional network data before it resolves",
    ],
  },
  {
    id: "unsafe-json-response-parse",
    title: "Parse network responses defensively — JSON.parse / response.json() on a bad body throws",
    whenToApply:
      "Any code that turns a network, file, or storage payload into an object via `JSON.parse(text)` or `await response.json()` directly on the raw reply. A non-2xx reply, an empty 204, an HTML error page from a proxy or captive portal, or a truncated payload makes `JSON.parse` throw `SyntaxError: Unexpected token … in JSON` (or `Unexpected end of input`), and `response.json()` rejects — crashing the handler or surfacing an unhandled rejection. Symptom: a feature that works against the happy-path API dies when the server returns 500 / 302 / an empty body, or on a flaky connection that truncates the response. Distinct from request-timeout / transport rules: this is the DECODE step specifically — turning a body that is not guaranteed to be well-formed JSON into an object.",
    evidence: [
      "MDN — Response.json() rejects on an empty or invalid body; JSON.parse throws SyntaxError on non-JSON (HTML error pages, empty 204, truncated payloads)",
      "React Native networking docs — check response.ok / status before decoding the body",
    ],
  },
  {
    id: "unguarded-list-shape",
    title: "Prove a value is an array before .map / indexing — .map on undefined crashes the render",
    whenToApply:
      "Render or transform code that calls `.map(...)`, `.forEach`, `.length`, or `list[i]` on a value ASSUMED to be an array but sourced from the network, an optional field, a response that can come back empty, or a union shape — e.g. `data.results.map(...)`, `payload.items.map(...)` — treating it as a list before the data has proven to be one. When the field is null/undefined, or the API returns an object/error instead of a list, `.map` / `.length` throws `undefined is not a function` / `cannot read property 'map' of undefined` during render. Symptom: a list screen renders fine with seeded data but crashes on an empty result, a not-yet-loaded fetch, or an API that returns `{}` on error. Distinct from list VIRTUALIZATION tuning (that rule is scroll perf; this is the value SHAPE — whether it is even an array).",
    evidence: [
      "React docs — Rendering Lists with .map(); the value must be an array (Array.isArray / default to [])",
      "React Native production-crash guides — '.map is not a function' / 'cannot read property map of undefined' on null or non-array API results",
    ],
  },
  {
    id: "navigation-param-guard",
    title: "Validate navigation / deep-link params — a missing route param crashes the destination screen",
    whenToApply:
      "A screen that reads route or deep-link parameters as if they are always present and well-typed — `route.params.id`, `useLocalSearchParams().slug`, `useRoute().params.user`, `navigation.getParam(...)` — then immediately dereferences or fetches with them. Params are absent or malformed whenever the screen is reached by a deep link, a push notification, a cold-start restore to that route, a typo'd link, or a programmatic navigate that omitted an argument; reading `params.id` off an undefined `params` (or fetching with an undefined id) throws or fires a broken request. Symptom: a screen that works when you navigate to it from inside the app crashes — or shows a permanent spinner / 404 — when opened from a link, a notification, or a restored session.",
    evidence: [
      "React Navigation docs — Params: route.params may be undefined; provide initialParams and validate before use",
      "Expo Router docs — useLocalSearchParams returns strings/undefined for deep links; validate params before dereferencing",
    ],
  },
  {
    id: "async-state-after-unmount",
    title: "Don't setState after a screen unmounts — a late async callback warns and risks a crash",
    whenToApply:
      "An async flow — a `fetch`/`await` continuation, a `setTimeout`/`setInterval` callback, a subscription or event listener, or a `.then()` — that calls a `useState` setter, `this.setState`, or `dispatch` AFTER the component may have gone away, while a slow request is still in flight. If the user navigates away (or a list row recycles) before the request resolves, the resolution still runs and updates state on a component that is no longer there: the classic 'Can't perform a React state update on an unmounted component' warning, leaked work, and — when the late update touches a now-disposed native view or ref — a hard crash. Symptom: warnings or intermittent crashes when you back out of a screen quickly, or flip tabs while something is still in flight. Distinct from the continuous-animation lifecycle rule: this is a one-shot async resolving late, after the screen is gone.",
    evidence: [
      "React docs — Synchronizing with Effects: clean up async work / subscriptions so state is not set after unmount",
      "React Native — 'Can't perform a React state update on an unmounted component' (cancel async work, mounted guard, or AbortController)",
    ],
  },
  {
    id: "main-thread-sync-work",
    title: "Move heavy synchronous work off the JS thread — long tasks freeze the UI (ANR / app-hang)",
    whenToApply:
      "A synchronous, CPU-heavy operation on the JS thread inside render, a `useEffect`, an event handler, or a data-prep step — a large `for`/`while` loop, `.sort()`/`.filter()`/`.reduce()` over a big array, encode/decode of a large blob, base64 work, hashing/crypto, image/CSV processing, or building a huge derived structure — run inline and to completion on every pass. The JS thread is single-threaded: a task that blocks it for hundreds of ms freezes touch and animation, and a multi-second block trips the OS watchdog — an Android ANR ('Application Not Responding') or an iOS app-hang termination, a freeze that becomes a crash. Symptom: the app stutters or fully freezes for a beat when a screen loads a big payload, applies a filter/sort, or processes a file; Boosthis' Stability axis shows long blocks. Distinct from the console.log-on-the-JS-thread rule: this is general heavy compute.",
    evidence: [
      "Sentry — ANR (Application Not Responding, main thread blocked >5s) and iOS App Hangs as crash and early-warning signals",
      "React Native performance docs — keep heavy work off the JS thread (InteractionManager, batching, native modules)",
    ],
  },
  {
    id: "rn-regex-redos",
    title: "Avoid catastrophic-backtracking regexes on user input — one bad string freezes the JS thread (ReDoS)",
    whenToApply:
      "A regular expression with nested or overlapping quantifiers — patterns like `(a+)+`, `(.*)*`, `(\\w+\\s?)*`, alternations whose branches can match the same text (`(a|a)*`), or an ambiguous group followed by a required character that can fail late — applied to user-controlled or network-supplied text: search boxes, form validation (emails, URLs, phone numbers), deep-link/route parsing, markdown or log highlighting, or filtering a synced payload. On a pathological input the regex engine backtracks exponentially and the SINGLE JS thread it runs on locks solid — touches, animations, and timers all stop, and a multi-second lock trips the OS watchdog (Android ANR / iOS app-hang) so the freeze becomes a crash. Symptom: typing one more character into a search/validation field suddenly freezes the app for seconds, or a specific synced/deep-linked string reliably hangs one screen; Boosthis' Stability axis shows a huge long-task block with no obvious loop. Distinct from the general heavy-synchronous-work rule: this is specifically regex backtracking blowup, and the fix is a safe pattern (or input cap), not moving compute.",
    evidence: [
      "OWASP — Regular expression Denial of Service (ReDoS): nested quantifiers and ambiguous alternation cause exponential backtracking",
      "React Native — the JS thread is single-threaded; a blocking regex freezes touch/animation and can trip the ANR / app-hang watchdog",
    ],
  },
  {
    id: "unbounded-media-memory",
    title: "Cap image / media / payload size in memory — unbounded media is a top OOM crash cause",
    whenToApply:
      "Retaining or accumulating media/data whose footprint grows without limit — rendering full-resolution remote images at thumbnail size, decoding large base64 data-URIs into memory, holding many large `Image` sources in memory at once, accumulating an ever-growing in-memory array/log/buffer that is never trimmed, or reading a whole large file/response into one string. Native image decoding and large buffers live in native memory; as the footprint climbs the OS eventually kills the app — an out-of-memory crash or watchdog termination, most often on lower-RAM Android devices and after long sessions. Symptom: the app slows then crashes after browsing many images or a long session, or dies while decoding one very large asset, with no JS error — just a native OOM. Distinct from list VIRTUALIZATION (off-screen row recycling) and image-FETCH spikes (network cost): this is retained MEMORY footprint.",
    evidence: [
      "React Native performance docs — out-of-memory from large or unbounded images; resize remote images and cap caches",
      "Sentry mobile — out-of-memory / watchdog terminations; reduce the memory footprint of media and in-memory caches",
    ],
  },
  /* ─── Expansion — memory / battery / layout / data-fetch / bundle ─── */
  {
    id: "unbounded-store-accumulation",
    title: "Cap in-memory stores — an ever-growing global/state collection leaks until OOM",
    whenToApply:
      "A global store (Redux / Zustand / Jotai / MobX / React Context) or a module-level array / Map / object accumulates entries from a stream that never stops — chat messages, log lines, websocket ticks, analytics events, scroll history, an undo stack — and only ever pushes/sets, never trimming or evicting. Symptom: memory climbs the longer the session runs, later screens get janky, and the OS eventually kills the app on lower-RAM Android — a native OOM with no JS error. Distinct from list virtualization (off-screen row recycling) and image memory (native decode footprint): this is a JS-heap collection that grows without bound.",
    evidence: [
      "React Native performance docs — watch retained memory across long sessions",
      "Redux style guide — don't keep unbounded or non-serializable data in the store",
    ],
  },
  {
    id: "background-task-battery-drain",
    title: "Pause timers, loops & subscriptions when the app backgrounds — don't drain the battery",
    whenToApply:
      "Timers (setInterval), animation loops (requestAnimationFrame / Reanimated withRepeat / Animated.loop), polling fetches, or subscriptions (accelerometer, network, websocket keep-alive) keep running while the app is backgrounded because nothing listens to AppState; or expo-background-fetch / TaskManager is scheduled with too small a minimumInterval. Symptom: users report fast battery drain and a warm phone in-pocket, and iOS may kill the app for background CPU use. Distinct from the focus-gate rule (which pauses per-screen animations on navigation): this is whole-app background lifecycle.",
    evidence: [
      "React Native AppState docs — pause work on the 'background' state",
      "Expo BackgroundFetch docs — minimumInterval and its battery cost",
    ],
  },
  {
    id: "location-high-accuracy-battery",
    title: "Right-size location accuracy & cadence — continuous Highest-accuracy GPS is a battery sink",
    whenToApply:
      "expo-location `watchPositionAsync` (or a native geolocation watch) is started with `Accuracy.Highest` / `BestForNavigation`, a tiny `distanceInterval` / `timeInterval`, and left running after the screen that needs it — often for a feature that only needs coarse, occasional location (a nearby list, a city, a one-time check-in). Symptom: the GPS chip stays powered continuously and the battery drops fast; on Android a persistent foreground-service location notification appears. Distinct from the background-task rule: this is specifically the accuracy, cadence, and lifetime of the location subscription.",
    evidence: [
      "Expo Location docs — accuracy levels and their power cost",
      "Android developer guide — optimize location for battery",
    ],
  },
  {
    id: "layout-shift-async-content",
    title: "Reserve space for async content — late images/data cause layout shift & extra render passes",
    whenToApply:
      "A screen renders before its async content has dimensions: images with no fixed width/height (or aspectRatio), remote data that expands a row once it loads, custom fonts that swap after first paint, or a placeholder sized differently from the final content. Symptom: content visibly jumps/reflows after mount, tap targets move under the user's finger, and the extra layout passes drop frames on first render — the RN analog of web CLS. Distinct from the image-cache and thumbnail-fetch rules (network/decode cost): this is unreserved layout space.",
    evidence: [
      "web.dev — Cumulative Layout Shift (the same failure mode applies to RN lists)",
      "expo-image docs — set explicit dimensions / a placeholder to avoid reflow",
    ],
  },
  {
    id: "client-refetch-no-cache",
    title: "Cache & dedupe data fetches — don't re-request the same data on every mount/focus",
    whenToApply:
      "A screen fetches the same data every time it mounts or regains focus — a bare `useEffect(() => { fetch(...) }, [])` that re-runs on remount, or `useFocusEffect` with no cache — with no staleness window, no in-flight dedup, and no shared cache, so navigating away and back (or two screens needing the same resource) hits the network repeatedly. Symptom: redundant network traffic, spinners on already-seen screens, and slow perceived TTI because cached data isn't reused. Distinct from the server ORM/N+1 rules: this is the client re-requesting instead of caching.",
    evidence: [
      "TanStack Query docs — staleTime, caching, and request deduplication",
      "React Navigation docs — useFocusEffect refetch trade-offs",
    ],
  },
  {
    id: "barrel-import-bundle-bloat",
    title: "Import only what you use — barrel / whole-library imports bloat the JS bundle & startup",
    whenToApply:
      "Code imports from a large library's barrel or the whole package instead of the specific submodule — `import _ from 'lodash'` (or `import { debounce } from 'lodash'` rather than `lodash/debounce`), a whole icon set for one glyph, an entire date / i18n / UI-kit package, or a local `index.ts` barrel that re-exports a big tree. Metro has limited tree-shaking, so the whole module graph ships. Symptom: a larger JS bundle → longer parse/eval on startup (worse TTI) and more memory. Distinct from image/asset preload: this is JavaScript bundle weight.",
    evidence: [
      "Metro docs — bundle size and limited tree-shaking",
      "lodash / date-fns docs — import per-method to keep bundles small",
    ],
  },
  /* ─── Expansion — bytecode / native-driver / image cache / fetch waterfall ─── */
  {
    id: "hermes-bytecode-not-precompiled",
    title: "Ship Hermes bytecode — don't parse & compile JS on every cold start",
    whenToApply:
      "The release build runs the JS engine without Hermes precompiled bytecode: Hermes is disabled (JSC), Metro/EAS isn't emitting the `.hbc` bundle, or lazy module evaluation (`inlineRequires` / RAM bundle) is off so every module in the graph is evaluated at launch instead of on first use. Symptom: slow cold start (high TTI) that scales with bundle size, worst on low-end Android. Distinct from the barrel-import rule (bundle *size*): this is how the bundle is *compiled and evaluated* at boot.",
    evidence: [
      "React Native docs — Hermes and bytecode precompilation",
      "Metro docs — inlineRequires / lazy module evaluation",
    ],
  },
  {
    id: "animated-js-driver-jank",
    title: "Drive animations on the native thread (useNativeDriver / Reanimated worklets)",
    whenToApply:
      "An `Animated` timing/spring/loop runs without `useNativeDriver: true`, animates layout props the native driver can't own (width/height/top/flex), or an animation is driven by JS `setState` / `setInterval` every frame. Each frame then round-trips through the JS thread, so any JS work (list render, data parse) stutters the animation. Symptom: animations drop frames whenever the app is busy — visible during navigation or scroll. Distinct from the focus-gate rule (pausing off-screen loops): this is *which thread* owns a running animation.",
    evidence: [
      "React Native Animated docs — useNativeDriver",
      "Reanimated docs — run animations on the UI thread with worklets",
    ],
  },
  {
    id: "image-cache-unbounded-growth",
    title: "Cap the image/media cache — an unbounded decode cache grows all session until OOM",
    whenToApply:
      "Images are shown through a caching layer with no memory ceiling — stock `<Image>` accumulating decoded bitmaps, a hand-rolled `{ [uri]: data }` map that's never evicted, or `expo-image` on long, varied feeds without a bounded cache policy / `recyclingKey`. Each newly-seen image adds to a native decode cache that only grows. Symptom: memory climbs the longer the user scrolls varied imagery and the OS eventually kills the app (native OOM, no JS error), worst on low-RAM Android. Distinct from the thumbnail-fetch rule (network/decode cost per image) and unbounded-media-memory (a JS-heap list of media): this is the *cache that retains* decoded images.",
    evidence: [
      "expo-image docs — memory/disk cache policy and recyclingKey",
      "Sentry mobile — image caches as a common OOM source",
    ],
  },
  {
    id: "per-item-fetch-waterfall",
    title: "Batch list data in one request — don't fire a fetch per row",
    whenToApply:
      "A list renders rows that each fetch their own data — a child with `useEffect(() => fetch(`/user/${id}`))`, an N-length map that awaits one request per item, or a screen that loads a parent then loops to load each child. Symptom: opening the screen fires tens/hundreds of parallel (or serialized) requests — a client-side N+1 — so TTI is gated by the slowest of many round-trips, the network saturates, and spinners flicker per row. Distinct from client-refetch-no-cache (re-requesting the *same* data): this is fanning *one screen* into many requests instead of one batched/joined call.",
    evidence: [
      "REST / GraphQL batching — dataloader & `?ids=` batch endpoints",
      "TanStack Query docs — useQueries and batching related requests",
    ],
  },
  {
    id: "eager-hydration-blocks-first-paint",
    title: "Render on auth-known - don't hydrate all persisted state before first paint",
    whenToApply:
      "Any root / boot path that awaits reading ALL persisted state (auth + settings + cached lists / blobs) before it renders the first screen, so cold time-to-first-screen scales with how much data is stored. Symptom: the app's JS is up in a few ms but the first screen doesn't appear for seconds on a COLD start. Related hazard: a save fires before hydration finishes and clobbers stored data (read-everything-then-write-back on boot).",
    evidence: [
      "Rival app cold-boot fix: first screen 6.3s -> sub-second by rendering on auth-known and lazy-loading the rest behind a hydrating-write guard",
    ],
  },
  {
    id: "duplicate-react-native",
    title: "Exactly one react-native / react copy in node_modules",
    whenToApply:
      "An app crashes INSTANTLY the moment a native-backed view or hook runs — a Modal / pop-up render, a sign-in screen, 'Invalid hook call', or 'Tried to register two views with the same name' — right after installing or updating a library that declares react / react-native as peer dependencies. Root-cause shape: the library's peer range doesn't cover the app's installed version, so npm (v7+) auto-installs a SECOND, nested copy under node_modules/<lib>/node_modules; anything touching the never-initialized second copy crashes on first use. Check: `npm ls react-native react` shows more than one resolution, or the lockfile lists two react-native versions.",
    evidence: [
      "Host-app incident (July 2026): two instant crashes (dashboard pop-up, then sign-in) both traced to a nested second React Native copy pulled in by a too-tight peer range; aligning versions + reinstall fixed both",
      "npm v7+ auto-installs unsatisfied peer dependencies (npm RFC 0025)",
    ],
  },
  {
    id: "first-run-call-gated-on-own-result",
    title: "Never gate a first-run registration call on state only its own success can unlock",
    whenToApply:
      "Any bootstrap / registration / activation / handshake network call that is skipped while the app is in a 'locked', 'inactive', or 'unregistered' state, when that state can only be cleared by the SAME call succeeding (or by data it returns — a token, an entitlement, a remote flag). Classic shape: an access-control or copy-protection gate added around a whole runtime also swallows the one call that would activate it. Symptom: existing installs keep working (they activated before the gate landed) but every FRESH install silently hangs — never registers, never appears on a dashboard, no error anywhere. Check every early-return guard on the startup path: if a guard's condition is set by the guarded call's own success, it is a first-launch deadlock.",
    evidence: [
      "Boosthis RN kit (July 2026): a runtime-wide inert gate silently swallowed first-launch registration — fresh installs never appeared on the dashboard while every existing install kept working; fixed by narrowing the gate to hard-killed-only and firing registration eagerly at startup",
      "lib/boosthis-runtime-rn/src/__tests__ activation-lock regression suite",
    ],
  },
  {
    id: "rn-install-id-reuse",
    title: "Never reuse a registration/install ID across installs — mint a fresh UUID each time",
    whenToApply:
      "Any first-contact identity value — an install id, device id, instance id, or registration/enrollment key — that is HARD-CODED, copied from docs or another app, or persisted-and-reused across logical installs, rather than freshly minted per install. Classic shape: a constant string, a build-time id, or an id read back from storage and re-presented on a fresh install as if it were configuration. If an earlier install using that id is ever orphaned server-side (consent recorded but its token lost / never issued), every LATER install that presents the SAME id inherits the orphan — the server keeps returning a token-less success forever, a deadlock no server-side lever can undo because the id already 'exists'. Symptom: existing installs work, but a fresh reinstall (or a second device) silently never gets a credential and never appears on the dashboard, while the server shows a stale registration under a shared id. Fix shape: treat the id as IDENTITY, not configuration — mint a real UUID (v4 / crypto-random) once per logical install/instance, persist it only for that install's lifetime, and never seed it from a literal, a doc snippet, or a previous install.",
    evidence: [
      "Boosthis production incident (Jul 2026) — host code persisted-and-reused a hard-coded install id; once the original install was orphaned (consented, token lost) every later install presenting that id got a token-less success forever, an unfixable server-side deadlock; resolved by minting a fresh UUID per install",
      "RFC 4122 — a UUID is intended to be unique per instance; identifiers must not be reused across entities",
    ],
  },
  {
    id: "rn-credential-callback-value-change",
    title: "Credential-issued callbacks must fire on VALUE change, never once-only",
    whenToApply:
      "Any 'credential issued / changed' host callback — an `onTokenIssued`, `onCredentialChanged`, `onAuthReady`, or similar hook the kit invokes so the host can persist a token/credential — that is gated behind a FIRED-ONCE latch (a `hasFired` boolean, a one-shot ref, a `useEffect([], ...)` mount-only trigger). The latch means the callback fires for the first value and then never again: when the host restores a STALE persisted token on boot and the server rotates / re-issues a new one, the callback never re-fires, so the host keeps persisting and presenting the stale credential and 401-loops forever. Symptom: sign-in works on a clean install but a returning install that had an old token stored is stuck in a persistent 401 / re-auth loop the server can't break, because the freshly issued credential is never delivered to the host. Fix shape: compare each issued value against the LAST DELIVERED value and fire whenever it differs — including immediately after restore-from-storage — never gate on 'already fired once'.",
    evidence: [
      "Boosthis production incident (Jul 2026) — an onTokenIssued-style callback used a fired-once latch; after the host restored a stale persisted token and the server re-issued, the callback never fired again and the host 401-looped forever; fixed by firing on value change vs. the last delivered value",
      "React docs — Synchronizing with Effects: react to VALUE changes (dependency-driven), not a one-time mount latch (react.dev/learn/synchronizing-with-effects)",
    ],
  },
  {
    id: "dead-end-tap",
    title: "Every tappable control must lead somewhere — no dead-end taps",
    whenToApply:
      "A screen renders a control that LOOKS interactive (a button, pressable, list row, or card) but does nothing on tap: `onPress`/`onClick` is missing, empty, a `() => {}` stub, or it navigates to a route that does not exist / the current route. Symptom: users tap and nothing happens, so they double-tap, back out, or churn — the action looks live but is a dead end, and there is no error anywhere. Register your screen graph with `registerNavigationMap()` so Boosthis can cross-check every tap target against the routes that actually exist and flag taps that resolve to nowhere. Detection is on-device only — no route names or code leave the device.",
    evidence: [
      "lib/boosthis-runtime-rn/src/circuitMap.ts (dead-end-tap detector + CIRCUIT_RULE_MAP)",
      "Nielsen Norman Group — dead clicks/taps as a top user-frustration signal",
    ],
  },
  {
    id: "unreachable-screen",
    title: "Every registered screen must be reachable — no orphan screens",
    whenToApply:
      "A screen/route is registered in the navigator but nothing in the app ever routes to it (no `navigate('X')`, `<Link>`, or deep-link entry point resolves to it from the app's entry screen), or an orphan screen sits outside the reachable graph entirely. Symptom: dead code that still ships and mounts and can silently drift out of sync, or a feature users can never reach. Register your navigation map with `registerNavigationMap()` so Boosthis walks the graph on-device and lists every screen with zero inbound paths — no code or route names leave the device.",
    evidence: [
      "lib/boosthis-runtime-rn/src/circuitMap.ts (orphan-screen + unreachable-screen detectors)",
      "Reachability-graph analysis: a registered node with no inbound edge from the entry point is unreachable",
    ],
  },
  // ─────────── Circuit lens — graph/wiring fault detectors ───────────
  {
    id: "rn-nav-loop-oscillation",
    title: "No navigation ping-pong — screens that bounce A→B→A are an oscillating loop",
    whenToApply:
      "Two screens keep navigating to each other in a tight A→B→A→B cycle within one session: a guard/redirect effect on screen A sends users to B, and B's own guard immediately sends them back (an auth gate vs. an onboarding check with opposing conditions, a param-driven redirect whose param flips each hop, or a `navigate()` called during render). Symptom: visible flicker or a frozen shuffle between two screens, the back stack grows with duplicate entries, repeated mount/unmount churn burns CPU and battery, and screen-time analytics show impossible sub-second visits. A control loop that oscillates is a classic wiring fault — Boosthis watches the on-device navigation graph for a repeated two-node cycle inside one session and flags it only on repeat, exactly like dead-end taps (screen labels + counts only, nothing leaves the device).",
    evidence: [
      "Control-systems oscillation: two coupled guards with opposing conditions form an unstable feedback loop",
      "lib/boosthis-runtime-rn/src/circuitMap.ts — the same on-device navigation-graph engine as dead-end-tap / unreachable-screen",
    ],
  },
  {
    id: "rn-fanout-overload",
    title: "Bound the burst — one screen firing N concurrent requests is fan-out overload",
    whenToApply:
      "A single screen or user action fires an anomalously large burst of concurrent downstream calls the moment it runs: a mount effect that fetches once per list item (the client-side N+1), a hook that re-subscribes on every render so requests multiply, or a 'refresh everything' action fanning out to a dozen endpoints at once. Symptom: the screen lands with a request storm — spinners everywhere, the radio held hot, server rate limiters tripped, and perceived latency set by the SLOWEST of the N parallel calls. In circuit terms this is over-current: one node driving more parallel load than the path is rated for. Boosthis counts concurrent outbound calls per action on-device and flags the outliers (counts + coarse buckets only, no URLs or payloads).",
    evidence: [
      "Electrical over-current / fan-out limits: one node sourcing more parallel branches than the circuit is rated for",
      "Sibling of the client N+1 rules (oversized-thumbnail-fetch, unbounded-search-results) — this rule measures the burst itself",
    ],
  },
  {
    id: "rn-highest-leverage-node",
    title: "Fix the highest-leverage screen first — centrality × latency beats absolute-slowest",
    whenToApply:
      "You are choosing what to optimize next and several screens look slow. One screen usually sits on far more user paths than any other (the home hub, a list screen feeding every detail screen) — and fixing a mildly slow screen that EVERY flow crosses improves the aggregate experience more than perfecting the slowest screen nobody visits. Symptom of getting it wrong: weeks of tuning rarely-visited screens while overall perceived speed barely moves, because the traffic-weighted constraint went untouched. In a series circuit the largest voltage drop dominates; in Lean, throughput is set by the constraint. Boosthis combines how many observed flows pass through each screen (centrality on the on-device navigation graph) with that screen's own timing to rank the single highest-leverage fix — a derived ranking over data already collected, nothing new leaves the device.",
    evidence: [
      "Theory of Constraints — improving anything but the constraint is an illusion of progress",
      "Betweenness centrality (graph theory): the node the most paths cross has the highest leverage on aggregate latency",
    ],
  },
  {
    id: "rn-cut-vertex-spof",
    title: "Know your cut-vertex screens — one screen every flow funnels through is a single point of failure",
    whenToApply:
      "One screen is an articulation point of your navigation graph: remove it and whole regions of the app become unreachable (an auth gate, a home hub, a wizard step every flow funnels through). If that one screen is slow, broken, or crashing, everything behind it is blocked at once — and latency meters give no warning, because the risk is structural concentration, not current slowness. Symptom: a single regression takes out most of the app simultaneously, and 'why does everything go through this screen?' is discovered only during the incident. Boosthis finds cut vertices in the observed on-device navigation graph and flags the concentration risk (structure + screen labels only, nothing leaves the device).",
    evidence: [
      "Graph theory — articulation points / cut vertices disconnect the graph when removed",
      "Power-grid N-1 contingency planning: no single element's loss may take down the network",
    ],
  },
  {
    id: "rn-crash-cascade",
    title: "Trace the crash cascade — 'when A crashes, B crashes next' is one fault, not two",
    whenToApply:
      "Crash signatures fire in correlated sequences: when screen A's crash signature fires, screen B — the screen users land on next, or the component consuming A's half-written state — tends to crash right after. Treating each crash as isolated hides the blast radius, so you patch the downstream symptom while the upstream trip keeps firing. Symptom: 'unrelated' crash signatures that always spike together in the same sessions, in the same order. Like a cascading grid failure, the first trip propagates. Boosthis correlates code-derived crash signatures along the on-device navigation graph — 'when A fires, B tends to fire next' — and surfaces the directional pair (signatures + counts only, never raw messages or user data).",
    evidence: [
      "Power-grid cascading-failure analysis — one breaker trip overloads and trips the next line",
      "Boosthis crash-risk feed (code-derived signatures) — this rule adds the along-the-graph correlation",
    ],
  },
  /* ─────────── 2026-08 field-learned promotions — served rules proven out and folded into the book ─────────── */
  {
    id: "guard-nullish-values-in-render",
    title: "Guard nullish and incomplete data before rendering summaries",
    whenToApply:
      'Apply this when a render-time TypeError points to a summary or detail component, such as "Cannot read properties of undefined/null" or a crash at a render function or JSX line. Use it when the failing render path reads nested fields, formats numbers or dates, or maps a collection while the screen is rendering with missing or partial inputs.',
    evidence: [
      "Boosthis field-learned rule (Aug 2026) — drafted from live crash telemetry across registered projects and promoted after proving out as a served rule",
      "React docs — Conditional rendering and defensive data handling",
    ],
  },
  {
    id: "guard-cart-item-render-data",
    title: "Guard item render paths against missing or invalid data",
    whenToApply:
      "Apply this when a React Native render crash points to an item-render function, row, cell, or card with a TypeError such as reading a property, calling a method, or formatting a value from the item. Use it when the failing render path receives null, undefined, or wrong-type item fields during screen render, list render, refresh, or first paint.",
    evidence: [
      "Boosthis field-learned rule (Aug 2026) — drafted from live crash telemetry across registered projects and promoted after proving out as a served rule",
      "React Native docs — FlatList renderItem (items can render before data settles)",
    ],
  },
  {
    id: "vendored-copy-drifts-from-source",
    title: "Regenerate embedded/vendored copies in CI — never hand-edit the copy",
    whenToApply:
      "The RN app or its kit embeds a GENERATED or COPIED artefact that duplicates a source of truth — a committed `dist/` build alongside its TS source, a bundled rule manifest, a vendored/patched dependency under a local folder, a checked-in `Podfile.lock` or generated native bridge, or a duplicated config — and someone edits the SOURCE while the embedded copy keeps serving its old bytes. Symptom: nothing errors and no test fails, but Metro / the blind-copied drop-in kit loads the stale committed copy, so consumers silently get behaviour that no longer matches the source (a rule that reads its old text, a bundle that lacks the latest fix). The drift is invisible because both files parse fine and the copy is a plausible past version of the source.",
    evidence: [
      "Boosthis production incident (Aug 2026) — a rule edited in the checklist source kept serving old text because the committed dist/ copy the kit loads was not regenerated",
      "lib/boosthis-checklist/src/index.ts (dist/ committed alongside source and consumed at runtime)",
    ],
  },
  {
    id: "restart-old-process-holds-port",
    title: "A restart must prove the NEW build owns the port — fail loud on bind conflict",
    whenToApply:
      "A local dev/reload flow (Metro, an Expo dev server, a bundled Node sidecar, an adb-reverse'd port) restarts a process but the OLD one is still bound — an orphaned child, a detached `--watch` process, or a reload loop that respawns without killing the previous pid. Symptom: either the new process dies with EADDRINUSE, OR (worse) it silently falls back to a random free port while the OLD process keeps answering on the expected one, so the app connects to a stale bundle and looks healthy while serving the PREVIOUS build. Distinct from a crash: nothing throws, the port answers, and the version you're debugging is not the version running.",
    evidence: [
      "Boosthis production incident (Aug 2026) — a reload respawned Metro while the orphaned old process kept serving the previous bundle on the same port",
      "Node.js net docs — a listen() EADDRINUSE must be fatal, never silently swapped for a random port",
    ],
  },
  {
    id: "observer-never-attached",
    title: "Assert the perf observer is actually registered — drive one real event end to end",
    whenToApply:
      "A tracker, PerformanceObserver, navigation listener, interaction/frame-timing hook, or error-boundary reporter is IMPLEMENTED and compiles, but nothing ever registers it — the `usePerfTracker` is defined but not mounted on the screen, the observer is constructed but `.observe()` is never called, or the listener is passed to a navigator that never fires it. Symptom: the metric it feeds reads zero forever and its dashboard tile shows empty or permanently 'warming up', yet every unit test passes because the hook works in isolation. The bug is the missing wiring, which no in-isolation test can see.",
    evidence: [
      "Boosthis production incident (Aug 2026) — a screen tracker compiled and unit-tested green but was never mounted, so its route metric read zero indefinitely",
      "MDN PerformanceObserver — an observer collects nothing until observe() is called",
    ],
  },
  {
    id: "fixed-ms-timing-assert",
    title: "Wait for the condition, never a fixed millisecond sleep, before asserting",
    whenToApply:
      "A test, readiness gate, or health check hinges on a FIXED number of milliseconds — a hardcoded `setTimeout`/`await sleep(300)` before a Testing Library assertion, an `expect(elapsed).toBeLessThan(200)` reading a wall-clock delta the test itself measured, or a probe that sleeps then asserts an Animated value / InteractionManager task has settled. On a busy CI runner, a throttled emulator, or a laptop mid-Metro-build, wall time measures the MACHINE not the code, so the check screams when nothing is wrong AND stays quiet on an idle box even after the code got slower — both directions fail. Fix it with the framework's OWN waiters: React Native Testing Library `waitFor`/`findBy*` polling to a generous deadline, `act()` to flush pending work, jest fake timers (`jest.useFakeTimers()` + `advanceTimersByTime`) to drive time deterministically instead of really sleeping, and assert ORDERING/causality or the operation's OWN reported duration rather than the test clock. Keep real latency budgets as p75/p95 measured from production telemetry, never a constant in a unit test, and where a hard timeout must exist make it a generous bound on HANGING (in seconds), not a performance assertion.",
    evidence: [
      "Boosthis production incident (Aug 2026) — a gate asserted a finish-time by reading the instant it ran instead of waiting for it with a bounded waitFor, so it failed on a loaded runner while the code was correct",
      "React Native Testing Library / jest fake-timers docs — poll waitFor/findBy* to a deadline and advance fake timers; never gate on a real setTimeout sleep",
    ],
  },
  {
    id: "credentialed-refusal-signin-challenge",
    title: "Do not turn a credentialed refusal into a sign in restart",
    whenToApply:
      "In React Native response handling through fetch or Axios interceptors and AsyncStorage credential state, a response with status 401 and an authenticate challenge clears a stored credential and starts sign in even though the request carried an authorization header. The app turns one refused call into a forced login and reports a healthy reachable service as unavailable.",
    evidence: [
      "React Native networking and credential storage documentation",
      "HTTP authentication status and challenge semantics",
    ],
  },
  {
    id: "generic-refusal-message",
    title: "Give every refusal a distinct actionable code and message",
    whenToApply:
      "In React Native, distinct failures such as offline transport expired session permission refusal and server fault all become the same generic message. Users and support cannot tell which action can recover the request.",
    evidence: [
      "React Native error boundary and networking documentation",
      "HTTP problem detail and stable error code guidance",
    ],
  },
  {
    id: "strict-credential-scheme-parsing",
    title: "Normalize credential schemes and token whitespace before parsing",
    whenToApply:
      "In React Native, authorization headers are built by concatenating a scheme with a pasted or stored token without trimming surrounding whitespace quotes or line breaks. A valid credential becomes a near miss before fetch or Axios sends it.",
    evidence: [
      "React Native fetch and Axios header documentation",
      "HTTP authentication scheme parsing guidance",
    ],
  },
  {
    id: "silent-protection-fail-open",
    title: "Surface every degraded protection even when it fails open",
    whenToApply:
      "In React Native, a local protection such as certificate validation credential refresh input validation or request gating catches an unavailable dependency or bad configuration and continues without recording that protection is degraded. The app silently sends work through an unprotected path.",
    evidence: [
      "React Native networking and security documentation",
      "Mobile degraded mode observability guidance",
    ],
  },
  {
    id: "rn-validated-url-native-reresolves",
    title: "Do not treat a JavaScript URL check as a pinned connection",
    whenToApply:
      "React Native code accepts an import callback image or fetch URL, approves its hostname with `URL`, a regular expression, or an allowlist, and then gives the name to `fetch`, Axios, an Image source, or a native networking module with redirects enabled. The iOS NSURLSession or Android OkHttp stack resolves and redirects independently after the JavaScript check, so the connection can reach loopback private link local or cloud metadata addresses.",
    evidence: [
      "React Native networking uses native NSURLSession and OkHttp stacks",
      "NSURLSession redirection delegate documentation",
      "OkHttp DNS and followRedirects documentation",
    ],
  },
  {
    id: "rn-global-error-hooks-replaced",
    title: "Do not replace React Native logging and fatal error hooks",
    whenToApply:
      "A React Native library or bootstrap calls `ErrorUtils.setGlobalHandler` without retaining `ErrorUtils.getGlobalHandler`, overwrites `console.error` or `console.warn`, changes LogBox handling globally, or installs a rejection tracker that displaces the host reporter. The host crash destination formatting redaction and development diagnostics silently stop receiving errors.",
    evidence: [
      "React Native ErrorUtils global handler API",
      "React Native console and LogBox documentation",
      "Hermes unhandled promise rejection tracking",
    ],
  },
  {
    id: "rn-nonreentrant-mutex-reacquired",
    title: "Do not reacquire a non reentrant JavaScript mutex",
    whenToApply:
      "React Native code holds an `async-mutex` Mutex or an `async-lock` key left in its default non reentrant mode across an await and then invokes a helper callback observer getter store action or native completion that acquires the same Mutex or key. Unless the lock is explicitly configured to recognize the same logical owner, the library queues the inner acquisition behind the outer one, so the outer operation waits forever for work that cannot enter.",
    evidence: [
      "async-mutex Mutex acquire and runExclusive documentation",
      "async-lock same key queueing and opt-in reentrancy documentation",
      "React Native JavaScript async callback execution model",
    ],
  },
  {
    id: "rn-retry-leaves-native-request-running",
    title: "Do not retry while the native request is still running",
    whenToApply:
      "A React Native timeout or retry wrapper uses `Promise.race` around `fetch`, Axios, XHR, an upload, or a native module promise and starts a replacement attempt when the timer wins without aborting the native operation. The JavaScript promise was abandoned but NSURLSession or OkHttp work and its socket remain live, so retries consume connection and pool capacity in parallel.",
    evidence: [
      "React Native XMLHttpRequest abort networking API",
      "Axios AbortController signal cancellation documentation",
      "NSURLSessionTask cancel and OkHttp Call cancel documentation",
    ],
  },

  // ── Realtime connections (4) — long-lived socket/stream lifecycle on a phone ──
  {
    id: "rn-websocket-reconnect-storm",
    title: "Back off websocket reconnects exponentially",
    whenToApply:
      "A React Native `WebSocket` wrapper reconnects straight away from `onclose` or `onerror` with no growing delay, no jitter and no attempt ceiling. A phone loses its connection constantly — a lift, a tunnel, a wifi-to-cellular handover, the screen locking — so the loop is entered far more often than on a desktop. Symptom: the app redials as fast as the radio allows while out of coverage, draining the battery and the user's data allowance; when the network returns, every device that was offline redials in the same instant and the server takes the stampede.",
    evidence: [
      "React Native WebSocket close and error handling",
      "AWS Architecture Blog — exponential backoff and jitter",
      "Apple and Android guidance — radio wake-ups dominate mobile battery drain",
    ],
  },
  {
    id: "rn-realtime-no-heartbeat",
    title: "Send a heartbeat so a dead socket is noticed",
    whenToApply:
      "A long-lived `WebSocket` or event stream is held open with no application-level ping, no expectation of a periodic server message, and no timer that reconnects when nothing has arrived for a while. On a phone this is worse than on a desktop: a carrier NAT or the OS itself will silently discard an idle socket while backgrounded, and the JavaScript side is never told. Symptom: the app returns from the background, the socket still reads `OPEN`, and chat, presence or live prices never update again until the user force-quits.",
    evidence: [
      "RFC 6455 section 5.5.2 — Ping and Pong frames",
      "React Native AppState — the app is suspended without notice",
      "React Native WebSocket readyState semantics",
    ],
  },
  {
    id: "rn-socket-never-closed",
    title: "Close a live connection when the screen that opened it is gone",
    whenToApply:
      "A screen or hook opens a `WebSocket` or event stream and never closes it — no cleanup returned from `useEffect`, no `close()` when the screen is popped, or a cleanup that only clears a reference. In a stack navigator the previous screen stays mounted, so nothing forces the connection shut. Symptom: connections accumulate one per visit, each still firing handlers and holding state, the same message is processed several times, and the app hits the server's per-device limit while appearing to hold a single connection.",
    evidence: [
      "React documentation — cleaning up an Effect that opens a connection",
      "React Navigation — screens remain mounted in a stack",
      "React Native WebSocket close",
    ],
  },
  {
    id: "rn-socket-reconnect-per-screen",
    title: "Keep one live connection across screen changes",
    whenToApply:
      "The live connection is created inside a screen component instead of in a provider above the navigator, so every navigation closes it and opens a new one. Symptom: ordinary tab-switching produces a reconnect per tap — handshake, auth round trip and state resync each time — which reads on the server as a reconnect storm from a perfectly healthy user, drops anything sent during the gap, and makes presence flap between online and offline as the user browses.",
    evidence: [
      "React Navigation — screen mount and unmount lifecycle",
      "React documentation — lifting a long-lived resource above the tree that re-renders",
    ],
  },
  {
    id: "rn-dependency-call-no-timeout",
    title: "Put a deadline on every outside-service call — sign-in first",
    whenToApply:
      "A screen or hook calls an outside service directly — a hosted identity provider, object storage, a payments, analytics or messaging vendor — with no `AbortSignal.timeout(...)` on the fetch, no timeout option on the SDK client, and no deadline of the app's own. Symptom: on a poor mobile network the provider does not fail, it stalls, so the launch or checkout screen holds a spinner with nothing to render and no error to show, and the user's only move is to force-quit. Sign-in is the worst place for it, because it sits in front of every session and makes the whole app look dead before a single screen paints. Distinct from rn-fetch-abortcontroller-timeout in what it protects: the stalled party here is a third party you cannot make faster, and the wait lands on the user's first screen.",
    evidence: [
      "React Native networking — fetch accepts an AbortSignal",
      "Google SRE Book — Addressing Cascading Failures (a slow dependency is more dangerous than a dead one)",
    ],
  },
  {
    id: "rn-dependency-retry-uncapped",
    title: "Cap retries against an outside service — the phone pays for the provider's bad minute",
    whenToApply:
      "The app re-attempts a failed outside-service call with no attempt ceiling and no total budget — a `useEffect` that re-fires on every screen focus, a NetInfo listener that replays the queue on every connectivity change, an AppState `active` handler that re-attempts on every foreground, or a hand-rolled loop with a fixed delay. Nothing reads `Retry-After` and a 4xx is retried exactly like a 5xx. Symptom: the provider's bad minute is paid for in the user's battery and cellular data, because every phone in the fleet re-attempts on the same triggers, and a permanently-refused payload is retried on every screen focus for as long as the app is installed.",
    evidence: [
      "RFC 9110 — Retry-After",
      "AWS Architecture Blog — exponential backoff and jitter",
    ],
  },
  {
    id: "rn-dependency-calls-serial",
    title: "Start independent outside-service calls together, not one after another",
    whenToApply:
      "A screen awaits several outside-service calls one after another where no call needs the previous call's answer — verify the session, then fetch the avatar from object storage, then look up the customer at the payment gateway — usually a run of `await`s inside one `useEffect` or route loader. Symptom: the screen waits for the SUM of every provider's latency instead of the slowest one, so a screen that should appear in 300ms appears in 900ms; on a mobile network, where each round trip is already expensive, that difference is exactly what a user calls slow, and no single provider looks slow enough to blame.",
    evidence: [
      "MDN — Promise.all",
      "Google SRE Book — Latency (serial dependencies add, parallel dependencies max)",
    ],
  },
  {
    id: "rn-dependency-on-visitor-path",
    title: "Take an outside service off the user's path when the user never sees its answer",
    whenToApply:
      "A screen awaits an outside-service call whose answer it never shows the user before it advances — posting an analytics event, sending a welcome message, syncing a record to a CRM, uploading a derived thumbnail — so the transition, the button's spinner, or the next screen waits on it. Symptom: the user pays the full latency and inherits the full failure of work whose result they will never see, so a slow analytics vendor makes the app feel slow and a broken one makes a working action look failed. Distinct from a rule about work having no runner: this work already has a runner — the user's own tap — and that is exactly the problem.",
    evidence: [
      "Google SRE Book — Addressing Cascading Failures (shed non-critical work from the serving path)",
      "React Native AppState — work started on a screen is not guaranteed to finish once the app is backgrounded",
    ],
  },
  {
    id: "rn-job-without-time-limit",
    title: "Give every background task a deadline of its own — the platform's kill is not one",
    whenToApply:
      "A background entry point runs work with no deadline of its own — an Android headless JS task registered with `AppRegistry.registerHeadlessTask`, a background-fetch or background-task handler, or a flush kicked off from an AppState transition — and the handler awaits a call that can stall. Nothing races the work against a timeout and nothing reports a result on the timeout path. Symptom: the work hangs until the platform kills the process, which on Android can be a long time on the user's battery; because the task never reported a result, the OS records a kill rather than a completion and schedules the app less generously afterwards, so background work quietly stops happening and nothing in the app can see why.",
    evidence: [
      "React Native headless JS — the task promise must resolve for Android to consider the task finished",
      "iOS background execution — a task that does not report completion is terminated and counted against future scheduling",
    ],
  },
  {
    id: "rn-job-retries-forever",
    title: "Cap background retries and give the last failure somewhere to go",
    whenToApply:
      "A background sync or upload queue re-enqueues its own failure with no attempt ceiling and nothing persisted across launches — a `catch` that pushes the item back onto the queue, a retry counter held only in memory, or an unconditional re-registration of the background task. A 400 that will never succeed is retried exactly like a 503. Symptom: a permanently-rejected payload is retried on every app launch, every foreground and every connectivity change for the life of the install, on the user's battery and cellular data, and because the failure is never recorded anywhere it is invisible to the user and to the backend that could fix it.",
    evidence: [
      "AWS Architecture guidance — a poison message needs a destination other than the queue it fails in",
      "React Native AsyncStorage — state that must survive a relaunch has to be persisted",
    ],
  },
  {
    id: "rn-ai-call-no-timeout",
    title: "Put a deadline on every AI provider call",
    whenToApply:
      "A React Native screen or hook calls an AI provider directly through the built-in `fetch`, `expo/fetch`, Axios, or a JavaScript provider client with no finite client timeout and no cancellation deadline tested on the app's supported iOS and Android versions. React Native has no first-party AI client of its own, and provider JavaScript SDK support varies, so many apps use the HTTP API directly. Symptom: generation stalls on a weak mobile connection while the screen holds a spinner, the native NSURLSession or OkHttp request remains live, and the radio spends battery on an answer the user may no longer be waiting for. Distinct from rn-dependency-call-no-timeout in scope: this check covers unusually long and streamed AI generation calls and their token budget, not every outside service.",
    evidence: [
      "React Native networking — fetch and XMLHttpRequest APIs",
      "OpenAI API reference — Responses and streaming responses",
    ],
  },
  {
    id: "rn-ai-retry-ignores-retry-after",
    title: "Honor the AI provider's Retry-After before retrying",
    whenToApply:
      "A React Native AI helper catches a 429 or overloaded response from an OpenAI-family or Anthropic HTTP endpoint and schedules another `fetch` or Axios call with `setTimeout`, a fixed delay, or exponential backoff without first reading the response's `Retry-After` header. A provider SDK error may expose the same header on its response object, but the wrapper discards it while normalizing the error. Symptom: the phone retries before the provider will accept work, spends cellular data and battery on guaranteed refusals, and can keep itself rate-limited after the original burst has passed. Distinct from rn-dependency-retry-uncapped in what it detects: even a correctly capped AI retry loop is wrong when it ignores the provider's stated wait.",
    evidence: [
      "RFC 9110 — Retry-After",
      "OpenAI API documentation — rate limits",
    ],
  },
  {
    id: "rn-ai-calls-serial",
    title: "Run independent AI calls concurrently with Promise.all",
    whenToApply:
      "A React Native event handler, hook, or screen loader awaits independent AI completions, embeddings, classifications, or moderation HTTP calls one after another even though no prompt consumes an earlier answer — commonly several `await fetch(...)`, Axios, or provider-client calls inside one callback. Symptom: a mobile screen waits for the SUM of several multi-second generations while the JS promise chain advances one call at a time; starting a fixed handful together with `Promise.all` makes it wait for the slowest call instead. Distinct from rn-dependency-calls-serial in scope: these calls carry AI token cost and generation latency, and only logically independent prompts may be combined.",
    evidence: [
      "MDN — Promise.all",
      "OpenAI API reference — Responses and Moderations",
    ],
  },
  {
    id: "rn-ai-duplicate-prompt",
    title: "Send each logical AI prompt only once per request",
    whenToApply:
      "One React Native user action sends the same messages and parameters to the same AI model more than once — an effect runs again after a state update, React Strict Mode exposes an unsafe effect in development, both prefetch and `onPress` start the request, two components call the same hook independently, or a retry continues after one attempt succeeded. Symptom: the phone uploads the same prompt and pays for the same input and output tokens twice, often races two answers into screen state, and discards whichever response arrives last. Keep one in-flight promise per logical action rather than deduplicating by persisting sensitive prompt text. Distinct from rn-ai-calls-serial: those are different prompts that should overlap; these are duplicate prompts that should not be sent.",
    evidence: [
      "React documentation — Strict Mode re-runs Effects in development",
      "OpenAI API reference — usage object",
    ],
  },
  {
    id: "rn-ai-prompt-cache-cold",
    title: "Keep large shared prompt prefixes stable so provider caching hits",
    whenToApply:
      "A React Native AI feature repeatedly sends a large system instruction, tool schema, examples, or shared document through `fetch`, Axios, or a provider client, but cached-input usage remains zero or absent. The request builder inserts device locale timestamps request ids random object ordering or the current user's text before that reusable content, so the provider sees a different prefix on every tap; rebuilding an equivalent schema with unstable array ordering has the same effect. Symptom: every phone repeatedly uploads and is billed for the full prefix, increasing radio time, first-token latency, and token cost. Keep the shared prefix byte-stable, put changing content last, and use the provider's wire-level cache controls where supported.",
    evidence: [
      "OpenAI API documentation — prompt caching",
      "Anthropic documentation — prompt caching",
    ],
  },
  {
    id: "rn-ai-stream-usage-not-requested",
    title: "Request usage metadata on every streamed AI response",
    whenToApply:
      "A React Native feature opens an OpenAI-family streamed chat completion over `fetch`, `expo/fetch`, or a compatible JavaScript client with `stream: true` but omits the wire-level `stream_options: { include_usage: true }`, or closes its SSE reader as soon as content finishes. Symptom: tokens appear progressively on the phone but the final usage block never arrives, so the app cannot attribute input output or cached tokens to the user action and reports an apparently free call. The transport must also support incremental response bodies on the app's target React Native version; otherwise proxy the stream through the app's backend. This rule is specific to OpenAI-compatible streams because providers with a different event contract expose usage differently.",
    evidence: [
      "OpenAI API reference — stream_options.include_usage",
      "Expo documentation — expo/fetch API",
    ],
  },
  // ─────────── Security (five concepts) — the faults AI-written apps ship most: open CORS, routes that never say who may call them, stored text rendered as markup, whole records sent back, access decided from request input ───────────
  {
    id: "rn-direct-table-without-row-policy",
    title: "Give every table the app reads directly a row policy — never ship with it switched off",
    whenToApply:
      "A React Native app reads and writes a hosted database straight from the phone — supabase-js with the project's anon key, or the Firebase JS SDK or @react-native-firebase/firestore — and a table or collection has no rule saying who may touch it: Supabase row level security never enabled on a table in an exposed schema, a policy whose condition is simply true, Firestore rules left in test mode or set to allow everything, or a storage bucket marked public that holds private files. The anon key and Firebase config ship inside the app bundle by design, so every such table is an HTTP route anyone can call without the app. Symptom: the app works perfectly, because the app is the only client you ever test with. Distinct from rn-row-policy-trusts-user-editable-field: this asks whether a table has a rule at all; that one asks whether an existing rule decides from the verified identity.",
    evidence: [
      "Supabase documentation — Row Level Security, and why the anon key is safe only with it enabled",
      "Firebase documentation — Cloud Firestore security rules and test mode",
    ],
  },
  {
    id: "rn-stored-content-rendered-unescaped",
    title: "Escape stored text before it reaches a WebView — never build its HTML or script by hand",
    whenToApply:
      "A React Native screen shows text users saved — a comment, a message, a profile field from the API — inside react-native-webview by building the page itself: a source html string assembled from a template literal with the stored value interpolated, injectJavaScript or injectedJavaScript strings that splice the value into code, or Markdown and rich text rendered to HTML and loaded unsanitised. React Native's own Text component never interprets markup, so the WebView is where stored text becomes script — and that script can call window.ReactNativeWebView.postMessage, so an onMessage handler that trusts what arrives turns it into actions inside the app. Symptom: ordinary content renders perfectly; nothing looks wrong until someone saves a script tag or an onerror attribute.",
    evidence: [
      "react-native-webview documentation — source html, injectJavaScript, onMessage and originWhitelist",
      "OWASP Mobile Application Security Testing Guide — testing WebViews",
    ],
  },
  {
    id: "rn-direct-table-returns-every-column",
    title: "Keep private columns out of tables the app reads directly — a narrower query protects nothing",
    whenToApply:
      "A React Native app reads a hosted database straight from the phone — supabase-js select of every column, or a Firestore document fetched whole — from a table whose rows mix public and private fields: a profiles table holding display names next to email addresses, phone numbers, push tokens or a role flag, readable by other users because the app shows their names. Row level security and Firestore rules decide which ROWS or documents a caller may read, never which columns, so every column of every readable row reaches anyone holding the anon key, and asking for fewer columns in the app's own query protects nothing — anyone can send the same request asking for all of them. Symptom: the screen shows a name and an avatar; the response could carry everything. Distinct from rn-direct-table-without-row-policy: that one asks whether a table has a row rule at all; this one asks which columns a permitted read returns.",
    evidence: [
      "Supabase documentation — column level security and column privileges",
      "Firebase documentation — Cloud Firestore security rules apply to whole documents",
    ],
  },
  {
    id: "rn-row-policy-trusts-user-editable-field",
    title: "Base every row rule on the verified user — never on a field the user can edit",
    whenToApply:
      "A React Native app relies on Supabase row level security or Firestore rules that decide from something the user can change: a policy reading auth.jwt() user_metadata, which any signed-in user can rewrite for themselves with supabase.auth.updateUser; a role or is_admin column the same user may update through the table's own update policy; an insert or update policy with no WITH CHECK, so a row can be written with another user's user_id or moved to another owner; a Firestore rule that trusts an ownerId or role field in the data being written, or a role kept in the user's own editable document; or an admin check made only in the app's own code. Anyone can call the database without the app, so a rule the user can satisfy by editing their own data protects nothing. Symptom: honest users never notice; one call from outside the app makes someone an admin or writes into another account. Distinct from rn-direct-table-without-row-policy: that one asks whether a table has a rule at all; this one asks whether an existing rule decides from the verified identity.",
    evidence: [
      "Supabase documentation — row level security helper functions, and raw_user_meta_data is editable by the user",
      "Firebase documentation — control access with custom claims and security rules",
    ],
  },
  // ─────────── Memory harvest (12) — lessons first met in our own Node.js build history, written for React Native ───────────
  {
    id: "rn-nul-byte-text-write",
    title: "Reject NUL characters before a React Native app writes them to SQLite or a hosted database",
    whenToApply:
      "A React Native app writes a string built by joining parts — a composite cache or dedupe key, a file name, a field parsed from an imported file, a scanned code, a value from a server response — through expo-sqlite, op-sqlite, WatermelonDB or a Drizzle schema on top of them, or sends it to a hosted PostgreSQL database through supabase-js or its own API, and nothing rejects the NUL character (U+0000) first. A JavaScript string holds U+0000 without complaint, and depending on the library the native binding either stores it inside the value — where SQLite's length(), LIKE and GLOB stop at it — or cuts the value off at it, so the rest is lost without an error. The hosted database refuses the same value outright, with 22P05 unsupported Unicode escape sequence, so a record that saved on the phone fails to sync. Symptom: two different keys match the same row, a search misses a record that is plainly there, a saved value comes back shorter than it went in, or a record that saved on the phone is refused by the server every time it syncs.",
    evidence: [
      "Boosthis engineering memory (2026) — first met in our own Node.js build history: a composite key joined with a NUL separator failed at its first INSERT, in code that typechecked and reviewed clean",
      "SQLite C interface — Binding values to prepared statements: when the length given for a text value is negative, the text runs only up to the first zero terminator",
    ],
  },
  {
    id: "rn-same-timestamp-insert-order",
    title: "Give rows created together a tiebreaker before a React Native app orders them by time",
    whenToApply:
      "A React Native app inserts several rows in one loop, transaction or sync batch with a createdAt taken from Date.now() and a random primary key — a UUID, the random string id WatermelonDB assigns, an id from the server — then reads them back from expo-sqlite, op-sqlite or WatermelonDB ordered by createdAt alone. Rows written in the same millisecond tie, and SQLite returns tied rows in whatever order its plan happens to produce — usually rowid order, until an index on createdAt is added, an INSERT OR REPLACE deletes a row and inserts it again under a new rowid, or a sync rewrites the table. Symptom: messages or log lines from one batch swap places between two reads, a list item jumps when it is updated, and paging on createdAt repeats or skips rows at a page boundary.",
    evidence: [
      "Boosthis engineering memory (2026) — first met in our own Node.js build history: rows inserted in the same millisecond with random ids came back in a different order between two identical reads",
      "SQLite documentation — SELECT, ORDER BY: the order in which two rows for which all ORDER BY expressions evaluate to equal values are returned is undefined",
    ],
  },
  {
    id: "rn-expression-index-sort-mismatch",
    title: "Sort and filter a React Native SQLite query by the exact expression its index was built from",
    whenToApply:
      "A React Native app creates an index on an expression — lower(name), ifnull or coalesce, a CASE rank, substr of a column, json_extract — in a migration run through expo-sqlite or op-sqlite, or in a Drizzle schema, and a query sorts or filters by what is meant to be the same expression but is written differently: lower(trim(name)) against an index on lower(name), name COLLATE NOCASE against lower(name), y + x against x + y. SQLite uses an expression index only when the query repeats the expression as it was written, so the plan falls back to scanning the table and sorting it in a temporary b-tree — fast with test data, slower with every row a user keeps. Symptom: a list screen that opened instantly in testing takes seconds on the phones of long-time users, and EXPLAIN QUERY PLAN shows SCAN and USE TEMP B-TREE FOR ORDER BY.",
    evidence: [
      "Boosthis engineering memory (2026) — first met in our own Node.js build history: a reworded CASE rank stopped matching its expression index; the page still returned correct rows, only slowly",
      "SQLite documentation — Indexes On Expressions: the planner does no algebra, so an expression in the query matches the index only when written the same way, apart from white space",
    ],
  },
  {
    id: "rn-row-lock-across-network-call",
    title: "Never make a network call inside a SQLite transaction or WatermelonDB writer — commit first, then send",
    whenToApply:
      "A React Native app opens a database transaction — expo-sqlite's withTransactionAsync or withExclusiveTransactionAsync, an op-sqlite transaction, a WatermelonDB database.write block — and inside it awaits something outside the database: a fetch or Axios call, a Supabase or Firebase call, a file upload, a payment SDK, or any async function that ends in one. WatermelonDB runs one writer at a time, so every other write in the app waits behind the call; an exclusive transaction makes other writes fail with database is locked; and expo-sqlite's withTransactionAsync is not exclusive, so queries the rest of the app runs while the call is outstanding land inside the open transaction and are rolled back with it if the call fails. On a slow, captive or failing network the call takes seconds or tens of seconds. Symptom: the app hangs on save while a sync is running, writes made on another screen vanish after a failed send, or database is locked errors appear only on mobile data.",
    evidence: [
      "Boosthis engineering memory (2026) — first met in our own Node.js build history: a row lock held across a vendor call blocked every writer behind a hung provider",
      "Expo documentation — SQLite withTransactionAsync: the transaction is not exclusive and can be interrupted by other async queries",
    ],
  },
  {
    id: "rn-purge-without-revalidation",
    title: "Re-check the condition in the DELETE itself, not in the React Native query that chose the rows",
    whenToApply:
      "A React Native app clears old data in two steps — a query or a JavaScript filter picks the rows that look finished, expired or orphaned (sent messages older than 30 days, drafts nobody has touched, downloads nobody opened), then a later statement deletes them by id, or WatermelonDB records fetched earlier are passed to destroyPermanently or markAsDeleted — while sync, a background task or the user on another screen can change those same rows between the two steps. A delete by id judges nothing about the row, so a draft the user edited, a message marked unsent again or an item that came back into use after the pick is deleted anyway. Symptom: a draft or record the user has just touched disappears after a cleanup run, rarely and never reproducibly, and only where cleanup and sync overlap.",
    evidence: [
      "Boosthis engineering memory (2026) — first met in our own Node.js build history: a purge that checked eligibility before deleting removed data that had been restored in between",
      "SQLite documentation — DELETE: if a WHERE clause is supplied, only the rows for which it is true are deleted; rows for which it is false or NULL are retained",
    ],
  },
  {
    id: "rn-crash-swallowed-process-keeps-running",
    title: "Let a fatal JavaScript error end or reload a React Native app — do not keep running on torn state",
    whenToApply:
      "A React Native app replaces the JavaScript error handler — ErrorUtils.setGlobalHandler, or a library such as react-native-exception-handler — with one that records a fatal error and returns without calling the handler it replaced, or sets a native fatal handler (RCTSetFatalHandler on iOS, a custom JSExceptionHandler on Android) that only logs. In a release build the default handler ends the app on a fatal JavaScript error; a handler that swallows it leaves the app running after an exception left something half-done: a store holds half-applied state, a module that threw during start-up is missing its exports, a flag set before the throw is never cleared, and a render error that reached the root has removed the whole React tree, leaving a blank screen over a JavaScript runtime that carries on. Symptom: after a rare error the app does not crash but shows a white screen, or misbehaves until it is killed — buttons that do nothing, a spinner that never ends, data saved twice — while the crash count stays low and users report problems. Distinct from rn-global-error-hooks-replaced, which asks whether the handlers the host installed still receive errors; this one asks whether the app keeps running after a fatal one.",
    evidence: [
      "Boosthis engineering memory (2026) — first met in our own Node.js build history: a crash handler that kept the process alive left the host serving on corrupt state",
      "React documentation — Catching rendering errors with an error boundary: by default, an error thrown during rendering makes React remove the UI of the app from the screen",
    ],
  },
  {
    id: "rn-after-response-work-lost",
    title: "Record work that must happen in a durable outbox before showing done — not in a promise the suspended app abandons",
    whenToApply:
      "A React Native app tells the user something is done — a toast, a confirmation screen, navigating back — and then starts the work that makes it true in a promise nobody keeps track of: a fetch that uploads the photo, sends the message, syncs the change or records the purchase after the screen has moved on, or a setTimeout that sends it later. When the user leaves the app, iOS suspends it seconds later and Android can kill the process in the background, timers stop, and an in-flight request is cut off, so the work stops half-way or never starts and nothing records that it was owed. Symptom: users say a message showed as sent but never arrived, or a change saved on the phone never reached the server, and no log shows a failure. Distinct from rn-dependency-on-visitor-path, which asks whether the user waits on work they never see; this one asks whether work moved off the path was recorded durably before the user was told it was done.",
    evidence: [
      "Boosthis engineering memory (2026) — first met in our own Node.js build history: work deferred until after the response vanished on suspend or restart, with nothing recording that it never ran",
      "Apple documentation — Extending your app's background execution time: shortly after an app moves to the background, the system suspends it",
    ],
  },
  {
    id: "rn-stream-timing-at-handler-return",
    title: "Time a React Native network call when its body has been read, not when the response object arrives",
    whenToApply:
      "A React Native app measures how long its network calls take — for analytics, a slow-call report or a performance trace — and stops the clock at a point that comes before the body: an XMLHttpRequest timed at readyState 2 (HEADERS_RECEIVED) or at its first progress event, a streaming fetch — expo/fetch, or a polyfill with text streaming switched on — timed when its promise resolves, or a server-sent-events or AI response stream timed when the connection opens. All of these fire as soon as the status line and headers are in; the body is still on the wire. The built-in fetch, which waits for the whole body before it resolves, is not the fault; the timer placed on a streaming client is. A large download, a slow server sending a long array a piece at a time, or a stream that stalls mid-body all report the time to the first byte as the time of the call. Symptom: recorded durations look fine while users wait on spinners, a download that takes a minute reports a few hundred milliseconds, and a call that fails mid-body is recorded as a fast success.",
    evidence: [
      "Boosthis engineering memory (2026) — first met in our own Node.js build history: an adapter that timed a streamed response at handler return reported construction time, not the wait of the visitor",
      "MDN — XMLHttpRequest readyState: 2, HEADERS_RECEIVED, means send() has been called and the headers and status are available",
    ],
  },
  {
    id: "rn-remote-lookup-in-request-path",
    title: "Start a React Native app from flags and settings stored on the device, not from a round trip on every launch",
    whenToApply:
      "A React Native app waits on a network round trip before it can show a screen or act on a tap, for something that rarely changes: Firebase Remote Config fetched and awaited with fetchAndActivate on every launch, a feature-flag SDK whose initialisation is awaited before the first render, a settings endpoint called from each screen's useEffect, an access token fetched again before every API call, or the user profile requested on each screen to read one field. Every launch and screen then pays a full round trip, and on a slow or offline connection the screen waits until the request gives up — or shows the wrong variant because a default was used while the fetch was pending. Symptom: cold start and screen opens are fast on Wi-Fi and slow on mobile data, the app is unusable offline although nothing it shows needs the network, and the flag provider's quota or rate limit is reached. Distinct from client-refetch-no-cache, which asks about the data a screen displays; this one asks about configuration the app consults before it can do anything.",
    evidence: [
      "Boosthis engineering memory (2026) — first met in our own Node.js build history: a remote lookup on every server-rendered request added fixed latency to a page with no data of its own",
      "Firebase documentation — Remote Config loading strategies: activate values fetched earlier at startup and fetch new ones in the background for the next session",
    ],
  },
  {
    id: "rn-shed-on-wake-stall",
    title: "Do not trip a breaker or lower quality on the slow first call after a React Native app returns to the foreground",
    whenToApply:
      "A React Native app adapts to slow calls — opens a circuit breaker, switches to low-resolution images or a lighter feed, shows an offline banner, or reports the backend as degraded — from the duration of the first few calls after AppState changes back to active or the device wakes. Those calls pay for a new connection: the native networking under fetch (NSURLSession on iOS, OkHttp on Android) has let its idle connections go, the radio has to wake, and DNS, TCP and TLS run again, so the first call after a pause is slow for reasons that say nothing about the server. Symptom: every morning, or whenever the user comes back after a few minutes away, the app drops into its degraded mode for the first screen, and the readings that triggered it are always the first ones after a quiet stretch.",
    evidence: [
      "Boosthis engineering memory (2026) — first met in our own Node.js build history: an idle-wake stall of roughly a quarter-second tripped a 200ms lag threshold with nothing in flight",
      "OkHttp documentation — ConnectionPool: the default pool holds up to 5 idle connections, which are evicted after 5 minutes of inactivity",
    ],
  },
  {
    id: "rn-client-gone-false-positive",
    title: "Do not treat an aborted request or a backgrounded React Native app as the user giving up",
    whenToApply:
      "A React Native app reads an aborted request or an AppState change as the user abandoning the action — an AbortError from a fetch whose screen unmounted taken to mean the user cancelled the upload, so the draft is deleted, the order marked abandoned or the attempt counted as a drop-off, or AppState moving to inactive or background read as the user leaving checkout. On iOS the app passes through inactive whenever a system sheet covers it — Apple Pay, a Face ID prompt, a permission dialog, Control Center, an incoming call — and a screen unmounts, aborting its requests, when navigation replaces it for reasons of its own, such as a sign-in refresh or a deep link. Symptom: payments that succeeded are recorded as abandoned, drafts and uploads vanish when the user glances at a notification, and abandonment figures rise on iPhones and on flaky connections while users never cancelled anything.",
    evidence: [
      "Boosthis engineering memory (2026) — first met in our own Node.js build history: a client-gone check read true on healthy uploads and abandoned good requests",
      "React Native documentation — AppState: inactive occurs when moving between foreground and background, and during periods such as entering the multitasking view, opening the Notification Center or an incoming call",
    ],
  },
  {
    id: "rn-hidden-handler-signature",
    title: "Give decorator-driven libraries explicit types — Metro's Babel build emits no parameter metadata",
    whenToApply:
      "A React Native app uses a library that reads TypeScript's emitted decorator metadata at run time — TypeORM entities on expo-sqlite or react-native-sqlite-storage whose columns give no type, tsyringe or InversifyJS constructor injection without explicit tokens, class-transformer or class-validator relying on reflected property types — and the code is built by Metro, whose Babel transform does not emit the design:type and design:paramtypes metadata that tsc writes with emitDecoratorMetadata. The code typechecks, and unit tests that run under ts-jest, which uses tsc, pass, yet the app fails at run time. Symptom: at the first database open or first injection the app throws — TypeORM's ColumnTypeUndefinedError saying a column type is not defined and cannot be guessed, tsyringe's TypeInfo not known, InversifyJS asking for a missing inject annotation — or a nested object arrives as a plain object instead of its class.",
    evidence: [
      "Boosthis engineering memory (2026) — first met in our own Node.js build history: a decorator wrapper hid the parameter types of a handler, and the framework answered with a validation error instead",
      "babel-plugin-transform-typescript-metadata README — the Babel TypeScript preset strips all types and does not emit the decorator metadata the TypeScript compiler writes",
    ],
  },
];

/**
 * The RN checklist, each entry enriched with its `category` + `languages` so it
 * shares the exact shape of the Node/Python/Web packs. This is the exported,
 * runtime-consumed source of truth (the blind-copied kit reads the built form).
 */
export const BOOSTHIS_CHECKLIST: ReadonlyArray<BoosthisChecklistEntry> =
  RAW_ENTRIES.map((e) => ({
    ...e,
    category: categoryFor(e.id),
    languages: ["react-native"] as const,
  }));

/** Look up a single entry by id. Returns undefined if not found. */
export function getChecklistEntry(id: string): BoosthisChecklistEntry | undefined {
  return BOOSTHIS_CHECKLIST.find((e) => e.id === id);
}

/** All entry ids, in the order they appear in the checklist. */
export function listChecklistIds(): readonly string[] {
  return BOOSTHIS_CHECKLIST.map((e) => e.id);
}

export const CHECKLIST_VERSION = "0.1.0";

/** Total count — useful for "X / N rules satisfied" UI. */
export const CHECKLIST_COUNT: number = BOOSTHIS_CHECKLIST.length;
