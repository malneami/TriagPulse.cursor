/**
 * The Boosthis checklist — Node.js edition.
 *
 * 123 Node-specific rules covering the most common Express / Fastify / async
 * I/O / event-loop pitfalls. Same shape as the Python checklist
 * (`lib/boosthis-py/boosthis/checklist.py`) so cross-runtime tooling can treat
 * any rule entry uniformly:
 *
 *   { id, title, whenToApply, evidence, category, languages }
 *
 * Previously this file re-exported the React Native rule pack as a stopgap.
 * Now the Node runtime ships its own corpus so `match_rules_for_code` against
 * a `.js` / `.ts` file returns advice that actually fits the runtime the
 * developer is on.
 *
 * The React Native runtime continues to import the 118-rule pack from
 * `boosthis-checklist` directly — it is unaffected by this file.
 */

export type Category = "case-study" | "industry" | "operational";

export interface BoosthisChecklistEntry {
  id: string;
  title: string;
  /** When this rule applies — what code shape triggers a check. */
  whenToApply: string;
  /** Files / commits / docs where this rule was validated. */
  evidence: ReadonlyArray<string>;
  category: Category;
  /** Always ["node"] for this pack. Present for cross-runtime symmetry. */
  languages: ReadonlyArray<"node">;
}

export const BOOSTHIS_CHECKLIST: ReadonlyArray<BoosthisChecklistEntry> = [
  // ─────────── Case Study (28) — real Node prod incidents ───────────
  {
    id: "node-registration-retry-no-cooldown",
    title: "Cool down failed registration/handshake retries — never re-attempt on every flush",
    whenToApply:
      "A one-time 'first contact' call (install/device registration, consent, enrollment, license activation, first token mint) is lazily retried from a hot path — every upload flush, queue drain, timer tick, or request — until it succeeds, with no cool-down and no special handling for HTTP 429. Symptom: a client that cannot finish registering (offline at setup, pending invite, busy server) silently re-attempts dozens of times an hour; behind a shared proxy/NAT egress IP those retries drain the server's per-IP registration rate bucket and starve OTHER clients' genuine first registrations — the failure surfaces on a different machine than the bug. Distinct from client-retry-storm (a tight loop retried too fast): each attempt here is cadence-driven and looks harmless in isolation, so the hammering hides in normal traffic.",
    evidence: [
      "Boosthis production incident (Jul 2026) — per-flush consent retries starved a shared per-IP registration rate bucket and blocked new installs",
      "Google SRE Book — Handling Overload (retry amplification)",
    ],
    category: "case-study",
    languages: ["node"],
  },
  {
    id: "sync-fs-in-handler",
    title: "Never call `fs.*Sync` from a request handler",
    whenToApply:
      "An Express / Fastify / Koa route reads or writes the filesystem with `fs.readFileSync`, `fs.writeFileSync`, `fs.existsSync`, or `fs.statSync`. Symptom: throughput collapses under concurrency because the entire event loop blocks for the duration of the disk I/O — every other in-flight request waits.",
    evidence: [
      "Node.js docs — Don't Block the Event Loop",
      "Express performance best practices",
    ],
    category: "case-study",
    languages: ["node"],
  },
  {
    id: "await-in-loop",
    title: "Parallelize independent awaits with `Promise.all`",
    whenToApply:
      "A route loops over N items and `await`s an independent async call each iteration (`for (const id of ids) { results.push(await fetchUser(id)); }`). Symptom: route latency is O(N × per-call latency) when it could be O(max per-call latency). Boosthis flags this as a long tail on the route's p99.",
    evidence: [
      "ESLint rule no-await-in-loop",
      "Node.js docs — Concurrency model",
    ],
    category: "case-study",
    languages: ["node"],
  },
  {
    id: "unbounded-json-body",
    title: "Set explicit body-size limits on `express.json()` / `fastify`",
    whenToApply:
      "`app.use(express.json())` or `fastify({ bodyLimit: ... })` is called without an explicit `limit` option (Express default is 100kb, easy to forget to lower; some setups override to unlimited). Symptom: a single malicious or buggy client can post a 50MB JSON payload and tie up parsing + memory across multiple requests.",
    evidence: [
      "OWASP — Denial of Service via large bodies",
      "Express body-parser docs — limit option",
    ],
    category: "case-study",
    languages: ["node"],
  },
  {
    id: "missing-compression",
    title: "Enable response compression for JSON / HTML responses",
    whenToApply:
      "An Express / Fastify app serves JSON or HTML responses larger than ~1kb without `compression` middleware (Express) or `@fastify/compress` (Fastify) installed. Symptom: TTFB is fine but TTI on the client is bloated by 3–10× because gzip-able payloads ship raw over the wire.",
    evidence: [
      "expressjs/compression — README",
      "Fastify docs — @fastify/compress",
    ],
    category: "case-study",
    languages: ["node"],
  },
  {
    id: "no-keepalive-outbound",
    title: "Reuse outbound HTTP connections with a keep-alive agent",
    whenToApply:
      "Outbound calls to the same upstream are made via `http.request` / `https.request` with no shared agent (default `http.globalAgent` has `keepAlive: false`), or via `axios` / `node-fetch` without passing a keep-alive agent, or via a new `Agent` / `Dispatcher` instance constructed per request. Symptom: each call pays a full TCP + TLS handshake (~50–200ms WAN), and connection churn shows up as elevated p75 on proxy routes. Note: Node 18+ `fetch` (built on undici) already pools and keeps connections alive via the global dispatcher, so it is NOT the typical offender — focus on the http/https/axios paths.",
    evidence: [
      "Node.js docs — http.Agent keepAlive",
      "undici docs — Dispatcher and Agent defaults",
    ],
    category: "case-study",
    languages: ["node"],
  },
  {
    id: "connection-pool-not-configured",
    title: "Use a pooled DB client, not one connection per request",
    whenToApply:
      "Code creates a new `pg.Client`, `mysql.createConnection`, or `mongodb.MongoClient` inside a handler instead of reusing a pool. Symptom: each request pays connection + auth handshake (~10–50ms), and the database side runs out of connection slots under modest concurrency.",
    evidence: [
      "node-postgres docs — Pooling",
      "PostgreSQL wiki — Number Of Database Connections",
    ],
    category: "case-study",
    languages: ["node"],
  },
  {
    id: "sync-crypto-on-hot-path",
    title: "Push CPU-bound crypto off the event loop",
    whenToApply:
      "A login / signup / token route calls `bcrypt.hashSync`, `crypto.pbkdf2Sync`, `crypto.scryptSync`, or any sync KDF directly. Symptom: a single login burns 100–500ms of CPU on the event loop; 10 concurrent logins serialize and the rest of the API stalls for the full chain.",
    evidence: [
      "Node.js docs — Don't Block the Event Loop (CPU-bound)",
      "bcrypt npm — async vs sync",
    ],
    category: "case-study",
    languages: ["node"],
  },
  {
    id: "log-on-every-request-prod",
    title: "Sample request logs in production, don't log every line at info",
    whenToApply:
      "Production logs every request body / response via `morgan('combined')`, `pino` at `info` with the full request object, or a custom middleware that serializes large objects. Symptom: log I/O becomes the bottleneck — JSON.stringify of every request body dominates CPU, and disk / stdout throughput limits requests-per-second.",
    evidence: [
      "pino — Benchmarks & best practices",
      "Honeycomb — High-cardinality logging tradeoffs",
    ],
    category: "case-study",
    languages: ["node"],
  },
  {
    id: "regex-redos",
    title: "Block catastrophic regex on user-controlled input (ReDoS)",
    whenToApply:
      "A route validates / parses a query param, header, or body field with a regex that contains nested quantifiers (`(a+)+`, `(a|a)*`, `(.*)*`) or alternation with overlap. Symptom: a crafted ~30-character input pegs one CPU core for seconds — single-threaded Node means the entire process stops serving everything.",
    evidence: [
      "OWASP — Regular expression Denial of Service (ReDoS)",
      "node-re2 — RE2 bindings for Node",
    ],
    category: "case-study",
    languages: ["node"],
  },
  {
    id: "n-plus-one-orm-node",
    title: "Eager-load relations in Sequelize / Prisma / TypeORM list routes",
    whenToApply:
      "A list endpoint serializes parent rows and accesses a related field inside the map (`orders.map(o => ({ ...o, customer: await o.getCustomer() }))`, or Prisma without `include`). Symptom: route is O(1) queries at dev seed but O(N) under production data — flagged by Boosthis as a long p99 with linear scaling vs result count.",
    evidence: [
      "Prisma docs — include / select",
      "Sequelize docs — Eager Loading",
    ],
    category: "case-study",
    languages: ["node"],
  },
  {
    id: "unbounded-in-memory-cache",
    title: "Bound in-memory caches with a max size + TTL eviction",
    whenToApply:
      "A module-scope `Map`, plain object, or array is used as a cache / dedup store and only ever grows — `cache.set(key, value)` on every request with no eviction, TTL, or size cap (memoizing per-user or per-URL results, accumulating seen ids, etc.). Symptom: RSS climbs steadily the longer the process runs until the container OOM-kills and restarts — often misread as a 'memory leak in a dependency'. Boosthis flags steadily rising heap with no correlated traffic increase.",
    evidence: [
      "Node.js docs — process.memoryUsage & heap growth",
      "lru-cache — bounded cache with max + ttl",
    ],
    category: "case-study",
    languages: ["node"],
  },
  {
    id: "sync-child-process-in-handler",
    title: "Never shell out with `execSync` / `spawnSync` on the request path",
    whenToApply:
      "A route invokes `child_process.execSync`, `spawnSync`, or `execFileSync` (image conversion via ImageMagick, `git`, `ffmpeg`, a shell one-liner) inside the handler. Symptom: the entire event loop blocks for the full duration of the subprocess — every other in-flight request stalls — and a slow or hung binary takes the whole process down with it. Same class as sync fs, but usually far longer.",
    evidence: [
      "Node.js docs — child_process (async vs sync)",
      "Node.js docs — Don't Block the Event Loop",
    ],
    category: "case-study",
    languages: ["node"],
  },
  {
    id: "unbounded-result-set",
    title: "Cap query result size with `LIMIT` + pagination",
    whenToApply:
      "A read query selects rows with no `LIMIT` / pagination — `SELECT *` from a table that grows over time, `Model.findAll()` / `prisma.x.findMany()` with no `take`, returning the full collection to the client. Symptom: fine on dev seed data, but as the table grows the query, ORM hydration, serialization, and JSON payload all scale linearly until a single request pulls hundreds of MB into memory and times out. Distinct from N+1 (that is query COUNT; this is row COUNT per query).",
    evidence: [
      "Prisma docs — Pagination (take / cursor)",
      "Use The Index, Luke — Pagination done right",
    ],
    category: "case-study",
    languages: ["node"],
  },
  {
    id: "emitter-listener-leak",
    title: "Don't attach a new event listener per request without removing it",
    whenToApply:
      "A handler calls `emitter.on(...)`, `process.on(...)`, `stream.on(...)`, or `req.on(...)` on a long-lived emitter inside the request path (or in a loop) and never `removeListener` / `off`s it. Symptom: Node prints `MaxListenersExceededWarning: Possible EventEmitter memory leak`, listeners — and the closures and objects they capture — accumulate forever, and heap climbs until OOM. Boosthis flags growing listener counts on a shared emitter.",
    evidence: [
      "Node.js docs — events (MaxListenersExceededWarning)",
      "Node.js docs — emitter.removeListener / once",
    ],
    category: "case-study",
    languages: ["node"],
  },
  {
    id: "db-write-in-loop",
    title: "Batch DB writes — don't run one INSERT / UPDATE per row in a loop",
    whenToApply:
      "A handler or job loops over a collection and issues a separate write each iteration — `for (const row of rows) { await db.query('INSERT ...', [row]); }`, `await Model.create(row)` per item, or a `create()` inside `for await`. Symptom: N network round-trips and N transactions (each with its own commit / fsync) make a bulk operation O(N × RTT); 1k rows that should take ~50ms as one statement take many seconds while holding a pooled connection the whole time. Distinct from await-in-loop (parallelizing INDEPENDENT reads) and from N+1 (which is reads): this is WRITES that should be coalesced into one round-trip.",
    evidence: [
      "node-postgres docs — multi-row INSERT / UNNEST",
      "Prisma docs — createMany / batch writes",
    ],
    category: "case-study",
    languages: ["node"],
  },
  {
    id: "regex-recompiled-per-call",
    title: "Hoist `new RegExp(...)` out of the hot path — compile the pattern once",
    whenToApply:
      "A regex is rebuilt from a string on every call — `new RegExp(pattern)` per request, or a `.test()` / `.replace()` whose pattern is reconstructed each iteration. Compiling a regex is real work (parse + automaton build); doing it per request wastes CPU, and a recreated global/sticky (`g` / `y`) regex also resets `lastIndex` in ways that cause subtle skip bugs. Symptom: a route's CPU profile is dominated by regex CONSTRUCTION, not matching. Distinct from the ReDoS rule (that's catastrophic backtracking at MATCH time; this is needless re-COMPILE cost).",
    evidence: [
      "MDN — RegExp (compilation cost & literal caching)",
      "V8 blog — the RegExp engine (Irregexp) internals",
    ],
    category: "case-study",
    languages: ["node"],
  },
  {
    id: "node-registration-idempotent-single-winner",
    title: "First-contact/registration endpoints must be idempotent single-winner",
    whenToApply:
      "A 'first contact' route that mints a credential on first success — registration, enrollment, activation, device consent, or a token mint — persists with an upsert or a naive read-then-insert instead of a single-winner insert. Symptom: two registrations race (client double-fire, a retry after a slow response, React StrictMode double-mount, two call sites) and the second call re-mints and CLOBBERS the credential the first call already returned, so the client keeps a token the server no longer honors and every later authenticated call 401s with no self-service recovery. Fix pattern: `INSERT ... ON CONFLICT DO NOTHING ... RETURNING` (Postgres) / `.onConflictDoNothing()` (Drizzle) / a guarded create — exactly ONE caller mints the credential; the loser gets a credential-less success response and the client MUST keep its existing credentials on such a response rather than treating an empty body as 'rotate mine'. Any first-contact endpoint that is not single-winner idempotent silently rotates or destroys credentials under concurrent or retried calls. Distinct from upsert-clobbers-issued-secret (the UPDATE branch rewriting the column): here the whole endpoint must be redesigned so only one writer wins and the response contract makes the loser a no-op.",
    evidence: [
      "Boosthis production incident (Jul 2026) — a fresh-consent registration upsert clobbered the already-issued install token when two registrations raced",
      "Stripe API docs — Idempotent requests (single-winner retries)",
    ],
    category: "case-study",
    languages: ["node"],
  },
  {
    id: "node-install-id-reuse",
    title: "Never reuse a registration/install ID across installs — one stable UUID per install, minted once",
    whenToApply:
      "Host or bootstrap code hard-codes, copies from docs / another app, or persists-and-reuses a registration / install / device ID across logical installs instead of minting a fresh one — a constant `installId = 'boosthis-app'`, an ID lifted from an example, or an ID carried forward after a reinstall. Symptom: once the original install is orphaned (it consented but lost or never stored its token), every later install that presents that SAME id gets a token-less 'success' forever — a permanent deadlock no server-side lever can break, because the server correctly treats the id as an already-registered identity. Rule: mint a FRESH unique id (a real `crypto.randomUUID()`) ONCE per logical install / instance, PERSIST it, and re-present that same id on every later start of that same instance; never copy an id from docs, another app, or a previous install, and never treat the id as configuration you can reuse — it is IDENTITY. The mirror-image bug is just as real: minting a new id on every process start (or every container, every replica, every cold start) makes each boot a brand-new install, so a clustered, autoscaled or rolling deployment registers dozens of one-request identities an hour, exhausts the provider's FRESH-registration cap, and gets throttled. \"Fresh\" means fresh per install, not fresh per boot — if the instance cannot persist anything, derive the id deterministically from something stable about the instance instead. Distinct from the single-winner rule (server-side conflict handling): this is the client side never presenting a recycled identity in the first place.",
    evidence: [
      "Boosthis production incident (Jul 2026) — a persisted-and-reused install id left every later install stuck on a token-less success after the first was orphaned",
      "RFC 4122 — UUIDs: generate a fresh unique identifier per instance",
    ],
    category: "case-study",
    languages: ["node"],
  },
  {
    id: "node-credential-callback-value-change",
    title: "Credential-issued callbacks must fire on VALUE change, never once-only",
    whenToApply:
      "An `onTokenIssued` / `onCredentialChanged` style callback (in a Node client, an SDK, or an isomorphic module) is gated behind a fired-once latch — `if (!hasFired) { hasFired = true; cb(token); }` — so it delivers the credential a single time per process and never again. Symptom: the host restores a STALE token from storage on boot, the server rotates or re-issues, but the callback never fires on the new value, so the host keeps persisting and presenting the stale credential and 401-loops forever. Rule: any 'credential issued / changed' callback must compare against the last DELIVERED value and fire whenever the value DIFFERS — including immediately after a restore-from-storage that turns out to disagree with the server — never gate on 'already fired once'. Keep the last-delivered value, not a boolean latch.",
    evidence: [
      "Boosthis production incident (Jul 2026) — a fired-once onTokenIssued latch never re-fired after a rotate, so the host 401-looped on a stale restored token",
      "MDN — React useEffect / effect re-runs on dependency VALUE change, not once",
    ],
    category: "case-study",
    languages: ["node"],
  },
  {
    id: "node-session-cookie-payment-redirect",
    title: "Never rely on session cookies surviving a payment/3DS redirect",
    whenToApply:
      "A payment return / confirm / callback route (the leg the bank or gateway redirects the browser BACK to after 3-D Secure / a hosted checkout) requires the login session — it reads `req.session.userId` or a session-scoped cart and 302s to `/login` when absent. Symptom: the cross-site 3DS hop drops the session cookie (`SameSite=Lax/Strict`, a fresh browser context, an in-app webview), so a customer who ALREADY PAID lands on a login page and the order is never recorded — a real charge with no fulfilment. Rule: payment return / confirm legs must be SESSION-FREE by design — verify the payment server-to-server with the provider using the id carried in the URL / callback params (not trusting cookie state), give the leg its own rate-limit bucket, and run a background sweep that reconciles stranded/paid-but-unfinished checkouts. Distinct from the session-fixation / auth rules: this is a redirect leg that must not DEPEND on the cookie at all.",
    evidence: [
      "Boosthis production incident (Jul 2026) — a 3DS return leg required the login session; the cross-site redirect dropped the cookie and stranded a paid customer at /login",
      "web.dev — SameSite cookies and cross-site redirects (cookie not sent on top-level cross-site navigation)",
    ],
    category: "case-study",
    languages: ["node"],
  },
  {
    id: "node-background-work-needs-scheduler",
    title: "Scheduled/background work must never depend on page visits",
    whenToApply:
      "Work that MUST happen on a schedule — subscription renewals, data-retention purges, invoice/digest sends, reconciliation sweeps, token cleanup — is triggered from inside a request handler (often an admin or dashboard page load) instead of a real timer / cron / worker. Symptom: when nobody opens that page, the renewals never bill and the legally-required purges never run, silently, until a customer or auditor notices months later. Rule: anything time-driven needs a real `setInterval` / cron / queue worker owned by an ALWAYS-ON process (or an external scheduler), never piggybacked on the request handler of an optional page — that is a silent-failure design. Verify by asking: 'what runs this if no human ever opens the page?' — if the honest answer is 'nothing', it is broken. Distinct from idle-interval-burn (a poller that runs too eagerly): here the scheduled work does not reliably run AT ALL.",
    evidence: [
      "Boosthis production incident (Jul 2026) — billing renewals and retention purges ran only inside an admin page handler and silently never fired when unvisited",
      "Google SRE Book — Cron and reliable scheduled/periodic execution",
    ],
    category: "case-study",
    languages: ["node"],
  },

  {
    id: "await-and-handle-promise-failures",
    title: "Await every critical promise and convert rejections into handled errors",
    whenToApply:
      "Apply this when production crashes are reported as unhandled promise rejections, especially from anonymous or bundled frames where the original call site is obscured. It commonly appears when async work is started without await, without a returned promise, or without a terminal error handler.",
    evidence: [
      "Boosthis field-learned rule (Aug 2026) — drafted from live crash telemetry across registered projects and promoted after proving out as a served rule",
      "Node.js docs — process 'unhandledRejection' event",
    ],
    category: "case-study",
    languages: ["node"],
  },
  {
    id: "handle-ui-data-fetch-promises",
    title: "Always await and handle UI-triggered data fetch promises",
    whenToApply:
      "Apply this when crashes or noisy logs point to unhandled promise rejections around async data loading triggered by a screen, route, or user action. It commonly appears when a fetch helper is called from UI code without await, without a catch path, or after the owning view has already been replaced.",
    evidence: [
      "Boosthis field-learned rule (Aug 2026) — drafted from live crash telemetry across registered projects and promoted after proving out as a served rule",
      "MDN — Using promises: error handling and unhandled rejections",
    ],
    category: "case-study",
    languages: ["node"],
  },
  {
    id: "bound-recursive-async-retries",
    title: "Bound async recursion and retries to prevent stack or promise growth",
    whenToApply:
      "Apply this when a Node.js app shows unhandled promise rejections with RangeError around a data-loading function, especially if the same loader can call itself again on empty results, failure, or state changes. This pattern often appears in retry, pagination, polling, or normalization code that recurses without a strict exit condition.",
    evidence: [
      "Boosthis field-learned rule (Aug 2026) — drafted from live crash telemetry across registered projects and promoted after proving out as a served rule",
      "AWS Architecture Blog — Exponential Backoff And Jitter (bounded retries)",
    ],
    category: "case-study",
    languages: ["node"],
  },
  {
    id: "bound-background-node-work",
    title: "Bound and deduplicate background work in Node.js services",
    whenToApply:
      "Apply when a Node.js service shows idle-burn: event-loop delay, CPU, memory, active handles, or pending tasks keep rising while request volume is flat or low. Also apply when logs or metrics show overlapping interval runs, repeated retries for the same item, duplicate queue jobs, or background work continuing after shutdown starts.",
    evidence: [
      "Boosthis owner shortlist (Sep 2026) — promoted by hand from the owner's shortlist of recurring problems after an idle-work reading, not from demand measured across projects, and proved out as a served rule",
      "Node.js docs — The Node.js Event Loop, Timers, and process.nextTick()",
    ],
    category: "case-study",
    languages: ["node"],
  },
  {
    id: "baseline-route-latency-regression",
    title: "Investigate and cap route latency regressions against baseline",
    whenToApply:
      "Apply when monitoring or load-test results show one specific HTTP route exceeding its own recent latency baseline or budget for the same percentile over multiple measurement windows, while the route still returns successful responses. Use it when the regression is isolated to that route in route-level timing data rather than a process-wide outage.",
    evidence: [
      "Boosthis cross-project finding (Sep 2026) — drafted from a route-latency regression finding that recurred across separate registered projects, and promoted after proving out as a served rule",
      "Google SRE Book — Monitoring Distributed Systems",
    ],
    category: "case-study",
    languages: ["node"],
  },
  {
    id: "enforce-route-latency-budget",
    title: "Keep each route within its defined latency budget",
    whenToApply:
      "Apply when route-level telemetry for a specific endpoint or middleware shows p95 or p99 latency above its documented budget under normal production traffic, or when a latency alert for that route is firing. Use it for the identified route or middleware only, not as a general performance review.",
    evidence: [
      "Boosthis cross-project finding (Oct 2026) — drafted from a slow-route finding that recurred across separate registered projects, and promoted after proving out as a served rule",
      "Google SRE Book — Service Level Objectives",
    ],
    category: "case-study",
    languages: ["node"],
  },

  // ─────────── Industry (13) — well-documented engineering patterns ───────────
  {
    id: "event-loop-monitoring-missing",
    title: "Monitor event-loop lag and expose it as a metric",
    whenToApply:
      "Production Node service has no signal for event-loop lag. Symptom: when something blocks the loop (CPU spike, sync I/O, GC), latency degrades across ALL endpoints simultaneously and you have no way to attribute it. Boosthis's per-route timing tells you what's slow but not WHY when the cause is loop-wide.",
    evidence: [
      "Node.js docs — perf_hooks.monitorEventLoopDelay",
      "Netflix Tech Blog — Node.js in production lessons",
    ],
    category: "industry",
    languages: ["node"],
  },
  {
    id: "worker-thread-cpu-bound",
    title: "Move CPU-bound pure-JS work to a worker thread",
    whenToApply:
      "A route does CPU-heavy synchronous work in JS land — image processing without `sharp`, large-array transforms, heavy `JSON.parse` on >1MB strings, PDF/markdown rendering, ML inference. Symptom: that route's CPU usage blocks every concurrent request because Node runs JS on a single thread.",
    evidence: [
      "Node.js docs — worker_threads",
      "piscina — Node.js worker pool",
    ],
    category: "industry",
    languages: ["node"],
  },
  {
    id: "streams-not-piped",
    title: "Pipe streams instead of buffering whole payloads",
    whenToApply:
      "A route fetches a large response (file proxy, S3 download, upstream API streaming JSON) and accumulates it via `response.arrayBuffer()`, `await response.text()`, or `chunks.push(chunk)` then `Buffer.concat`. Symptom: memory balloons proportional to payload × concurrency, and big payloads cause RSS spikes that trigger GC pauses across other requests.",
    evidence: [
      "Node.js docs — stream.pipeline",
      "AWS SDK v3 — Streaming responses",
    ],
    category: "industry",
    languages: ["node"],
  },
  {
    id: "gzip-static-at-build",
    title: "Pre-compress static assets at build time, not per request",
    whenToApply:
      "Node serves static files (`express.static`, `@fastify/static`, custom file server) and gzips them on the fly for every request. Symptom: CPU wasted re-compressing the same `bundle.js` thousands of times; cold-cache requests pay full compression latency.",
    evidence: [
      "expressStaticGzip — npm",
      "web.dev — Reduce network payloads using text compression",
    ],
    category: "industry",
    languages: ["node"],
  },
  {
    id: "single-process-on-multicore",
    title: "Run one Node process per core in production",
    whenToApply:
      "Production deploys a single `node server.js` process on a host with multiple CPU cores and no orchestrator (no Kubernetes replicas, no PM2 cluster mode, no `node:cluster`). Symptom: throughput plateaus at one core's worth even when the box has 4–16. Latency degrades sharply once that single core saturates.",
    evidence: [
      "Node.js docs — cluster module",
      "PM2 docs — Cluster Mode",
    ],
    category: "industry",
    languages: ["node"],
  },
  {
    id: "client-retry-storm",
    title: "Cap outbound retries with backoff + jitter, never a tight retry loop",
    whenToApply:
      "An outbound call (`fetch`, `axios`, an SDK client, a DB/Redis driver) is retried on failure inside a `while`/`for` loop or a recursive catch with no exponential backoff, no jitter, and no max-attempts ceiling. Symptom: the moment an upstream slows or returns 5xx, every worker hammers it as fast as the event loop allows — a self-inflicted thundering herd that turns a brief blip into a sustained outage and pegs CPU on retry bookkeeping. Boosthis flags it as a burst of repeated same-target outbound calls clustered in time on one route.",
    evidence: [
      "AWS Architecture Blog — Exponential Backoff And Jitter",
      "Google SRE Book — Handling Overload (retry amplification)",
    ],
    category: "industry",
    languages: ["node"],
  },
  {
    id: "idle-interval-burn",
    title: "Park or unref background `setInterval` polling when nothing is happening",
    whenToApply:
      "A `setInterval`/`setTimeout` poller (cache refresh, queue drain, heartbeat, metrics flush) keeps firing on a fixed short cadence even when there is no work — and is neither `unref()`-ed nor paused when idle. Symptom: the process never goes quiet between requests; the event loop wakes constantly, CPU stays warm, containers never scale to zero, and on mobile/edge the battery/credits drain doing nothing. Boosthis flags steady periodic wake-ups with no correlated request or queue activity.",
    evidence: [
      "Node.js docs — timers.unref() and keeping the loop alive",
      "Node.js docs — Don't Block the Event Loop (idle work)",
    ],
    category: "industry",
    languages: ["node"],
  },
  {
    id: "fetch-no-timeout-node",
    title: "Set a timeout on every outbound `fetch` / `axios` call",
    whenToApply:
      "A route makes an outbound HTTP call with `fetch(url)` (no `AbortSignal`), `axios.get(url)` (no `timeout`), or `http.request` without a `timeout` option. Symptom: when the upstream hangs, the request never resolves — the socket and its event-loop bookkeeping stay pinned, and under load every worker ends up parked on a dead upstream. A slow dependency becomes a full outage with no error to alert on.",
    evidence: [
      "Node.js docs — http.request timeout & AbortSignal",
      "undici docs — fetch with AbortSignal.timeout",
    ],
    category: "industry",
    languages: ["node"],
  },
  {
    id: "db-query-no-timeout",
    title: "Bound every DB query with a statement / query timeout",
    whenToApply:
      "DB queries run with no per-query or pool-level timeout — `pg` Pool without `statement_timeout` / `query_timeout`, a `mysql2` connection without `timeout`, Prisma / TypeORM with no transaction or query timeout. Symptom: one slow or lock-blocked query holds a pooled connection open indefinitely; a handful of them exhaust the pool and every subsequent request queues forever, turning a slow query into a site-wide hang.",
    evidence: [
      "node-postgres docs — statement_timeout / query_timeout",
      "PostgreSQL docs — statement_timeout",
    ],
    category: "industry",
    languages: ["node"],
  },
  {
    id: "missing-cache-headers",
    title: "Send `Cache-Control` / `ETag` on cacheable GET responses",
    whenToApply:
      "A GET route that returns identical, non-personalized data for many clients (public config, product catalog, static-ish JSON, rarely-changing reference data) sends no `Cache-Control`, `ETag`, or `Last-Modified` header, so every client and every CDN / proxy re-fetches the full body each time. Symptom: avoidable origin load and TTFB for data that could be served from cache. Do NOT apply to per-user or rapidly-changing responses — those should stay `no-store`.",
    evidence: [
      "MDN — HTTP caching (Cache-Control, ETag)",
      "Express docs — res.set / static caching",
    ],
    category: "industry",
    languages: ["node"],
  },
  {
    id: "server-timeout-unset",
    title: "Set server `requestTimeout` / `headersTimeout` to shed slow clients",
    whenToApply:
      "An `http.Server` / Express / Fastify app starts without configuring `server.requestTimeout`, `server.headersTimeout`, or `server.keepAliveTimeout`. Symptom: a slow or malicious client (Slowloris — dribbling headers a byte at a time) can hold connections open indefinitely, and behind a load balancer a mismatched `keepAliveTimeout` causes sporadic 502s on idle-reused connections. The server has no upper bound on how long one client can occupy a socket.",
    evidence: [
      "Node.js docs — server.requestTimeout & headersTimeout",
      "OWASP — Slowloris / slow HTTP DoS",
    ],
    category: "industry",
    languages: ["node"],
  },
  {
    id: "large-json-serialize-sync",
    title: "Stream or schema-serialize large JSON responses — don't `JSON.stringify` a huge object inline",
    whenToApply:
      "A route returns a large array / object via `res.json(big)` or `JSON.stringify(big)` on the response path, serializing megabytes synchronously in one shot. This is pure CPU on the event loop — `JSON.stringify` is single-shot and blocking, so while it runs every other request stalls, and the intermediate string spikes RSS. Symptom: p99 on a list / export route scales with payload size and correlates with event-loop lag. Distinct from streams-not-piped (buffering an INBOUND / proxied body) and from worker-thread-cpu-bound (general CPU offload): the targeted fix here is a streaming or precompiled-schema serializer on the OUTBOUND response.",
    evidence: [
      "fast-json-stringify — schema-based serialization",
      "json-stream-stringify — streaming JSON.stringify",
    ],
    category: "industry",
    languages: ["node"],
  },
  {
    id: "blocking-dns-lookup",
    title: "Cache DNS / use `dns.resolve` — default `dns.lookup` ties up the libuv threadpool",
    whenToApply:
      "A service opens many outbound connections by hostname (HTTP clients, DB / Redis drivers) and relies on Node's default name resolution. `dns.lookup` — what `http`, `https`, and most drivers call implicitly — runs `getaddrinfo`, a blocking C call, on the libuv threadpool (only 4 threads by default). Symptom: under load or a slow resolver, DNS resolutions queue behind those 4 slots and contend with other threadpool work (`fs`, `crypto`, `zlib`), so latency spikes across unrelated operations even though CPU looks idle. Distinct from keep-alive reuse (which avoids handshakes on an already-resolved host): this is the resolution step itself.",
    evidence: [
      "Node.js docs — dns.lookup vs dns.resolve & UV_THREADPOOL_SIZE",
      "cacheable-lookup — DNS cache for http.Agent",
    ],
    category: "industry",
    languages: ["node"],
  },

  // ─────────── Operational (3) — production hygiene ───────────
  {
    id: "no-graceful-shutdown",
    title: "Handle SIGTERM so deploys don't drop in-flight requests",
    whenToApply:
      "The Node process exits immediately on SIGTERM (the default) — no `process.on('SIGTERM', ...)`, no `server.close()` to drain. Symptom: every deploy / autoscale event drops in-flight requests; users see intermittent 502 / connection-reset errors that correlate with deploys.",
    evidence: [
      "Kubernetes docs — Pod Lifecycle (terminationGracePeriodSeconds)",
      "Node.js docs — Signal Events",
    ],
    category: "operational",
    languages: ["node"],
  },
  {
    id: "healthz-does-db-query",
    title: "Keep `/healthz` cheap — don't query the DB on every probe",
    whenToApply:
      "The liveness / readiness endpoint does `SELECT 1` (or worse, a real query) on every call. Symptom: with k8s probing every 5s × N replicas, the DB sees a constant baseline of health-check traffic — and during a real DB outage, the healthz failures amplify the load when the DB is least able to handle it.",
    evidence: [
      "Kubernetes docs — Liveness vs Readiness probes",
      "Google SRE Book — Cascading failures",
    ],
    category: "operational",
    languages: ["node"],
  },
  {
    id: "boosthis-not-mounted-in-mcp",
    title: "Wire Boosthis into your AI editor's MCP config so the agent can read live perf state",
    whenToApply:
      "Project has `@workspace/boosthis-runtime-node` installed and `boosthis()` middleware mounted, but no MCP entry in `.cursor/mcp.json`, `claude_desktop_config.json`, or the Replit AI MCP config. Without the MCP wire-up the agent has to be told manually each time which routes are slow and which rule applies; the whole point of the Node runtime is that this becomes self-service.",
    evidence: [
      "Model Context Protocol — spec.modelcontextprotocol.io",
      "lib/boosthis-vscode/ — Install MCP config command",
    ],
    category: "operational",
    languages: ["node"],
  },
  {
    id: "upsert-clobbers-issued-secret",
    title: "Don't let a conflicting upsert overwrite an already-issued credential",
    whenToApply:
      "A 'first contact' route (signup / registration / device consent / enrollment) mints a secret — an API token, session key, or per-install delete/read token — on first insert AND persists the row with an upsert: `INSERT ... ON CONFLICT (id) DO UPDATE`, Drizzle `.onConflictDoUpdate(...)`, Prisma `upsert`, Mongo `updateOne(..., { upsert: true })`, or MySQL `INSERT ... ON DUPLICATE KEY UPDATE` — whose UPDATE branch rewrites the credential column. Symptom: when a client fires the same registration twice in the same instant (React StrictMode double-mount, a retry, or two call sites), the second request overwrites the stored secret with a freshly-minted one while the client kept the first; every later authenticated call then fails with 401 and the account/install is permanently locked out with no self-service recovery.",
    evidence: [
      "PostgreSQL docs — INSERT ... ON CONFLICT (upsert semantics)",
      "Boosthis case study — consent double-registration token desync",
    ],
    category: "case-study",
    languages: ["node"],
  },
  // ─────────── Expansion (5) — leaks / streams / concurrency / hygiene ───────────
  {
    id: "timer-captures-request-scope",
    title: "Don't leak per-request timers / listeners that capture `req` & `res`",
    whenToApply:
      "A request handler registers a `setInterval` / `setTimeout`, an `EventEmitter` `.on(...)` listener, or a subscription that closes over `req` / `res` / large per-request objects and is never cleared or removed when the response finishes. Symptom: each request retains its whole scope (and often the socket) past completion — heap and active-handle count climb request-over-request until the process OOMs, and `MaxListenersExceededWarning` may fire. Distinct from the unbounded-store rule: here the leak is timers/listeners holding request closures alive.",
    evidence: [
      "Node.js docs — timers and clearInterval / clearTimeout",
      "Node.js docs — EventEmitter memory-leak warning (setMaxListeners)",
    ],
    category: "industry",
    languages: ["node"],
  },
  {
    id: "stream-backpressure-ignored",
    title: "Respect stream backpressure — use `pipeline` instead of ignoring `write()`'s return",
    whenToApply:
      "Code copies between streams by hand — `readable.on('data', chunk => writable.write(chunk))` — and ignores the `false` return from `write()` (buffer full) without pausing the source, or builds a big response by concatenating chunks into one Buffer/string. Symptom: when the destination (slow client, disk, socket) can't keep up, Node buffers unbounded in memory and RSS balloons on large files/exports until the process is killed. Distinct from sync-fs: this is async streaming with no flow control.",
    evidence: [
      "Node.js docs — stream backpressure & stream.pipeline",
      "Node.js docs — Writable.write() return value / 'drain' event",
    ],
    category: "industry",
    languages: ["node"],
  },
  {
    id: "unbounded-promise-concurrency",
    title: "Bound fan-out concurrency — `Promise.all(items.map(...))` over a big list floods I/O",
    whenToApply:
      "A handler maps an unbounded / large array straight into `Promise.all(items.map(fetchOrQuery))`, firing every async call at once. Symptom: hundreds or thousands of simultaneous DB queries or HTTP requests exhaust the connection pool, trip rate/socket limits, spike memory, and can crash the process or the downstream — the opposite failure mode to await-in-loop (too serial). Boosthis flags a route whose latency and error rate explode with input size.",
    evidence: [
      "Node.js docs — Promise.all has no built-in concurrency limit",
      "p-limit / p-map — bounded-concurrency mapping",
    ],
    category: "industry",
    languages: ["node"],
  },
  {
    id: "no-request-coalescing",
    title: "Coalesce concurrent misses on a hot key — avoid a cache stampede",
    whenToApply:
      "A cached value (config, token, expensive query, rendered page) is recomputed on miss with no single-flight, so when it expires under load every concurrent request sees the miss and all recompute / hit the origin at once (a cache stampede / thundering herd). Symptom: periodic latency and DB/CPU spikes exactly at expiry, sometimes cascading into an outage, even though the value is 'cached'. Distinct from simply adding a cache: the gap is deduping concurrent misses.",
    evidence: [
      "AWS Builders' Library — avoiding cache stampede / request coalescing",
      "Wikipedia — cache stampede (locking / promise memoization)",
    ],
    category: "industry",
    languages: ["node"],
  },
  {
    id: "heap-growth-unmonitored",
    title: "Watch heap / RSS in long-running processes — catch leaks before OOM restarts",
    whenToApply:
      "A long-running Node service (API server, worker, socket gateway) runs with no visibility into heap/RSS growth — no `process.memoryUsage()` gauge, no `--max-old-space-size`, no leak alert — so a slow leak is noticed only when the container is OOM-killed and restarts, dropping in-flight requests. Symptom: memory sawtooths upward across hours/days and the app periodically dies with `JavaScript heap out of memory`. Operational hygiene rather than one code smell.",
    evidence: [
      "Node.js docs — process.memoryUsage() and V8 heap statistics",
      "Node.js diagnostics — heap snapshots to find leaks",
    ],
    category: "operational",
    languages: ["node"],
  },
  // ─────────── Expansion v2 (4) — parse / revalidate / parallelism / indexing ───────────
  {
    id: "large-json-parse-sync",
    title: "Bound & offload large JSON parsing — `JSON.parse` of a big body blocks the event loop",
    whenToApply:
      "A handler `JSON.parse`s a large request body, an upstream API response, or a file read into one string. `JSON.parse` is synchronous and CPU-bound, so a multi-MB payload freezes the whole event loop for tens of ms — every other in-flight request waits. Symptom: p99 latency spikes whenever a big document arrives and the event-loop-delay metric jumps. Distinct from unbounded-json-body (accepting too much) and large-json-serialize-sync (the write side): this is the synchronous *parse* on the hot path.",
    evidence: [
      "Node.js docs — JSON.parse is synchronous / event-loop blocking",
      "Node.js docs — worker_threads for CPU-bound JSON work",
    ],
    category: "industry",
    languages: ["node"],
  },
  {
    id: "no-etag-conditional-get",
    title: "Send ETag / Last-Modified so clients revalidate with 304 instead of refetching",
    whenToApply:
      "A read endpoint (JSON API, static-ish resource, rendered page) returns the full body every time with no `ETag` / `Last-Modified`, so conditional requests (`If-None-Match` / `If-Modified-Since`) can't short-circuit. Every poll or navigation re-transfers identical bytes even when nothing changed. Symptom: high egress and repeated full-payload responses for unchanged resources; a client refresh always pays full download cost. Distinct from missing-cache-headers (Cache-Control freshness): this is *revalidation* — letting an unchanged resource answer 304 Not Modified.",
    evidence: [
      "MDN — HTTP conditional requests (ETag / If-None-Match)",
      "Express docs — etag setting and static caching",
    ],
    category: "industry",
    languages: ["node"],
  },
  {
    id: "blanket-no-store",
    title: "Don't send `no-store` on everything — reserve it for genuinely private responses",
    whenToApply:
      "Almost every successful GET response carries `Cache-Control: no-store` (often from one blanket middleware, a security template, or a copied header block), so nothing — browser, CDN, or proxy — may reuse ANY of it. Public assets, shared reference data and rendered marketing pages are then re-fetched in full on every visit and every navigation. Symptom: origin traffic and egress that scale with page views rather than with content changes, and a CDN reporting near-zero hit rate. `no-store` is CORRECT for per-user, secret or transactional responses — apply this only when the never-cache instruction is being sent indiscriminately. Distinct from missing-cache-headers (no instruction at all) and no-etag-conditional-get (cacheable but no validator): this is an explicit instruction NOT to cache, sent where it was never needed.",
    evidence: [
      "MDN — Cache-Control no-store vs no-cache vs private",
      "RFC 9111 — HTTP Caching, storing responses in caches",
    ],
    category: "industry",
    languages: ["node"],
  },
  {
    id: "sequential-independent-awaits",
    title: "Run independent awaits in parallel — don't serialize calls that don't depend on each other",
    whenToApply:
      "A handler `await`s several independent async calls one after another — `const a = await getA(); const b = await getB(); const c = await getC();` — where none uses the previous result. Total latency becomes the SUM of the calls instead of the MAX. Symptom: a route's latency is the added-up time of its dependencies (DB + cache + upstream) even though they could run at once. Distinct from await-in-loop (iterating) and unbounded-promise-concurrency (too many at once): this is a *fixed, small* set of independent awaits needlessly serialized.",
    evidence: [
      "MDN — Promise.all for concurrent independent work",
      "Node.js docs — avoid awaiting independent promises sequentially",
    ],
    category: "industry",
    languages: ["node"],
  },
  {
    id: "query-missing-index-full-scan",
    title: "Index the columns hot queries filter/sort on — an unindexed predicate is a full-table scan",
    whenToApply:
      "A frequently-hit query filters, joins, or sorts on a column with no supporting index — `WHERE email = $1`, `WHERE status = $1 ORDER BY created_at`, a foreign key used in joins, or an `ORDER BY ... LIMIT` with no index to satisfy it. The database scans the whole table (or does an on-the-fly sort) that gets slower as rows grow. Symptom: a query that's instant on dev seed data degrades linearly in production; `EXPLAIN` shows `Seq Scan` / `filesort`. Distinct from n-plus-one (many queries): this is *one* query doing too much work for lack of an index.",
    evidence: [
      "PostgreSQL docs — indexes and EXPLAIN / query planning",
      "Use The Index, Luke — indexing WHERE, JOIN, ORDER BY",
    ],
    category: "industry",
    languages: ["node"],
  },
  // ─────────── Operational — cross-runtime trace / proxy hygiene ───────────
  {
    id: "proxy-drops-trace-header",
    title:
      "Forward the `x-boosthis-*` correlation headers through every reverse proxy / gateway",
    whenToApply:
      "A reverse proxy, API gateway, load balancer, or relay sits in front of your Node service (nginx `proxy_pass`, `http-proxy-middleware` / `express-http-proxy`, HAProxy, Envoy, or a cloud gateway with a header allowlist) and does NOT explicitly forward custom request headers. Proxies commonly forward only a known header set and silently DROP unknown `x-*` headers (nginx also strips headers whose names contain underscores by default). Symptom: cross-runtime traces arrive fragmented — each hop mints a NEW id instead of adopting the caller's, so one user action never stitches RN → Node → Python and the waterfall shows disconnected single-hop traces. Worse, a relay that rewrites or strips headers it doesn't recognize can make requests arrive malformed and fail instantly with an opaque error that LOOKS like a connection/timeout problem but is really a dropped header — and this bites hardest right after a kit upgrade adds or changes an on-wire header the deployed proxy was never told to pass. Distinct from missing-keep-alive (connection reuse) and CORS (browser origin policy): this is request-header PASS-THROUGH.",
    evidence: [
      "Boosthis full-stack cross-runtime trace — x-boosthis-trace / x-boosthis-trace-elapsed correlation headers",
      "nginx docs — proxy_set_header, underscores_in_headers, and custom header forwarding",
    ],
    category: "operational",
    languages: ["node"],
  },
  // ─────────── Cross-runtime parity (1) — heavy dependency / cold-start weight ───────────
  {
    id: "heavy-dependency-cold-start",
    title:
      "Keep the cold-start dependency graph lean — heavy top-level require/import slows every boot",
    whenToApply:
      "A serverless function, container, or worker eagerly loads heavy modules at the top of the file (`aws-sdk` / `@aws-sdk/*`, `googleapis`, `firebase-admin`, `moment` + locales, all of `lodash` via a default import, an ORM, a headless-browser or image/ML library) even when a given invocation never uses them, or `require`s them in the module scope of a rarely-hit route. Symptom: cold starts and process boot are slow and get slower with every dependency added — the runtime must parse and evaluate the whole transitive graph before serving the first request, which on autoscale/serverless shows up as p99 spikes on the first request after a scale-up or scale-to-zero. Distinct from event-loop-lag (per-request blocking) and n-plus-one (query fan-out): this is startup/parse weight, not request-time work.",
    evidence: [
      "AWS Lambda docs — cold starts, package size, lazy initialization",
      "Node.js docs — module resolution cost; import only what you use",
    ],
    category: "industry",
    languages: ["node"],
  },
  // ─────────── Circuit lens — graph/wiring fault detectors ───────────
  {
    id: "node-retry-redirect-loop",
    title: "Break retry/redirect cycles — a request path that round-trips to itself is an oscillating loop",
    whenToApply:
      "A request path forms a closed cycle: a handler 302-redirects to a route whose own guard redirects straight back (login ↔ callback with a condition that never settles), two services retry INTO each other on failure (A's fallback calls B, B's fallback calls A), or a client hammers the same route after every non-2xx while the handler's own upstream retry does the same — multiplying attempts per lap. Symptom: bursts of identical or alternating requests in tight succession, redirect chains ending in `ERR_TOO_MANY_REDIRECTS`, load that spikes exactly when an upstream degrades, and duplicate side effects when a non-idempotent handler runs once per lap. Distinct from plain retry amplification (one call retried too hard): this is a loop that feeds itself. Boosthis sees the repeated hop pattern in the cross-runtime trace and flags the cycle (route labels + counts only).",
    evidence: [
      "Google SRE Book — cascading failures and retry amplification",
      "RFC 9110 — 3xx redirection and redirect-loop behavior",
    ],
    category: "industry",
    languages: ["node"],
  },
  {
    id: "node-fanout-overload",
    title: "Bound per-request fan-out — one request driving N concurrent downstream calls is over-current",
    whenToApply:
      "A single incoming request fans out to an anomalously high number of concurrent downstream calls: `Promise.all(items.map(item => fetch(...)))` with unbounded N (the service-layer N+1), an aggregator endpoint that calls every internal service on each hit, or per-request middleware calls multiplied across a burst. Symptom: downstream services see your traffic multiplied N×, sockets and agent pools exhaust, p99 tracks the slowest of the N calls, and one hot route can effectively DoS your own internal APIs. Distinct from n-plus-one (database queries inside a loop): this is service-to-service fan-out at the request layer. Boosthis counts concurrent outbound spans per request in the trace and flags outlier fan-out (counts + coarse buckets only).",
    evidence: [
      "Google SRE Book — Handling Overload (fan-out and load amplification)",
      "AWS Builders' Library — avoiding retry storms and fan-out amplification",
    ],
    category: "industry",
    languages: ["node"],
  },
  {
    id: "node-highest-leverage-node",
    title: "Fix the highest-leverage route first — centrality × latency beats absolute-slowest",
    whenToApply:
      "You must pick the next performance fix and several routes look slow. One route usually carries far more of the aggregate experience than any other — the gateway route every page calls, the auth check in every middleware chain — and fixing a mildly slow route that EVERY flow crosses moves overall p75 more than perfecting the absolute-slowest, rarely-hit endpoint. Symptom of getting it wrong: optimization effort poured into the slowest endpoint on the dashboard while user-perceived latency barely moves, because the traffic-weighted constraint went untouched. Boosthis ranks each route by how many traced flows cross it (centrality) combined with its latency/failure contribution, naming the single highest-leverage fix — a ranking layer over spans already stored, no new collection.",
    evidence: [
      "Theory of Constraints — throughput is set by the constraint; improve the constraint first",
      "Betweenness centrality (graph theory) — the node on the most paths dominates aggregate latency",
    ],
    category: "industry",
    languages: ["node"],
  },
  {
    id: "node-cut-vertex-spof",
    title: "Know your cut-vertex routes — one route every flow funnels through is a single point of failure",
    whenToApply:
      "One route or internal service is an articulation point of your request graph: every traced flow funnels through it (a shared gateway route, a single auth service, one internal API every feature calls). If it degrades, everything behind it is blocked at once — and per-route latency meters give no warning, because the risk is structural concentration, not current slowness. Symptom: a single deploy or dependency blip takes out most user flows simultaneously, and the postmortem discovers 'everything goes through X'. Boosthis finds cut vertices in the cross-runtime trace graph and flags the concentration risk (route labels + structure only).",
    evidence: [
      "Graph theory — articulation points / cut vertices disconnect the graph when removed",
      "Power-grid N-1 contingency planning: no single element's loss may take down the network",
    ],
    category: "industry",
    languages: ["node"],
  },
  {
    id: "node-crash-cascade",
    title: "Trace the crash cascade — 'when A throws, B fails next' is one fault, not two",
    whenToApply:
      "Error/crash signatures fire in correlated sequences across your service graph: when upstream handler A starts throwing, downstream consumer B's own signature fires next — half-written state, a malformed fallback response, or timeouts surfacing as unhandled rejections one hop later. Treating each signature in isolation hides the blast radius, so you patch the downstream symptom while the upstream trip keeps firing. Symptom: 'independent' error signatures that always spike together in the same window, in the same order. Boosthis correlates code-derived crash signatures along trace edges — 'when A fires, B tends to follow' — and surfaces the directional pair (signatures + counts only, never raw messages).",
    evidence: [
      "Power-grid cascading-failure analysis — one trip overloads and trips the next element",
      "Boosthis crash-risk feed (code-derived signatures) — this rule adds the along-the-trace correlation",
    ],
    category: "industry",
    languages: ["node"],
  },
  // ─────────── Expansion v3 (4) — quadratic hot-path CPU / sync compression ───────────
  {
    id: "node-quadratic-string-concat",
    title: "Don't build large strings / buffers by repeated `+=` or `concat` in a loop — it's O(n²)",
    whenToApply:
      "A hot path assembles a large payload by re-copying the whole accumulator every iteration — `result += chunk` / `html += row` in a `for` loop, `acc = acc.concat(item)` per element, `buf = Buffer.concat([buf, chunk])` inside an `on('data')` handler, or `acc = { ...acc, [k]: v }` / `[...acc, x]` spread inside a `reduce`/loop. Each step reallocates and copies everything accumulated so far, so total work is O(n²): fine on dev-sized input, then a large export / CSV build / template render pegs one CPU core and blocks the event loop as input grows. Symptom: a build/serialize route's CPU time and event-loop-delay scale with the SQUARE of row/chunk count, not linearly. Distinct from large-json-serialize-sync (one `JSON.stringify` of a big object) and stream-backpressure-ignored (memory/flow control): this is the quadratic reallocation COST of incremental accumulation.",
    evidence: [
      "V8 blog — string concatenation and cons-string / flattening cost",
      "Node.js docs — collect chunks into an array then join / Buffer.concat once",
    ],
    category: "industry",
    languages: ["node"],
  },
  {
    id: "node-array-membership-in-loop",
    title: "Replace `array.includes` / `indexOf` / `find` inside a loop with a `Set` / `Map` lookup",
    whenToApply:
      "A hot path does a linear membership or lookup scan of an array on every iteration of another loop — `for (const x of a) if (b.includes(x))`, `items.filter(i => seen.indexOf(i.id) !== -1)`, `rows.map(r => list.find(l => l.id === r.id))`, or de-duping with `if (!acc.includes(x)) acc.push(x)`. Each `includes` / `indexOf` / `find` is O(m), so nesting it in an O(n) loop is O(n×m) — effectively O(n²) — and a route that's instant on a few dozen rows pegs a CPU core and blocks the event loop as the collections grow. Symptom: a join / filter / de-dupe route's CPU time scales quadratically with input size and dominates its profile. Distinct from n-plus-one (many DB queries): this is pure in-process array scanning that a `Set`/`Map` turns into O(1) lookups.",
    evidence: [
      "MDN — Set / Map O(1) has vs Array.includes / indexOf O(n)",
      "V8 blog — algorithmic complexity of Array.prototype.includes / find",
    ],
    category: "industry",
    languages: ["node"],
  },
  {
    id: "node-json-deep-clone",
    title: "Use `structuredClone` instead of `JSON.parse(JSON.stringify(x))` to deep-copy on the hot path",
    whenToApply:
      "A handler deep-copies an object with `JSON.parse(JSON.stringify(obj))` on the request path — cloning config, a cache entry before mutating, request/response bodies, or per-request defaults. This does a full synchronous serialize-then-parse of the whole object twice over, is CPU-bound and blocks the event loop for large objects, spikes RSS with the throwaway intermediate string, AND silently corrupts data: it drops `undefined`, functions, and `Symbol`s, mangles `Date` into a string, and throws / loses `Map`, `Set`, `BigInt`, and circular references. Symptom: a route's CPU profile is dominated by `JSON.parse` + `JSON.stringify` doing clone work, latency scales with object size, and mutation of a 'copy' leaks back to the original when the clone quietly failed. Distinct from large-json-parse-sync (parsing an external body) and large-json-serialize-sync (the response write): this is round-tripping JSON purely to CLONE.",
    evidence: [
      "MDN — structuredClone() structured deep copy",
      "Node.js docs — structuredClone is a global; JSON round-trip loses types",
    ],
    category: "industry",
    languages: ["node"],
  },
  {
    id: "node-sync-zlib-on-hot-path",
    title: "Never call `zlib.gzipSync` / `brotliCompressSync` on the request path — use the async zlib API",
    whenToApply:
      "A route compresses or decompresses dynamic data synchronously — `zlib.gzipSync`, `zlib.deflateSync`, `zlib.brotliCompressSync`, `zlib.gunzipSync`, or `zlib.inflateSync` on a response body, an outbound payload, or an uploaded blob inside the handler. Compression is CPU-bound; the `*Sync` variants run it on the event loop, so a single multi-MB gzip freezes the whole process for tens of ms and every other in-flight request stalls. The async callbacks (`zlib.gzip`, `zlib.brotliCompress`, …) run on the libuv threadpool and keep the loop free. Symptom: p99 spikes and event-loop-delay jumps whenever a large body is (de)compressed, and CPU-heavy compression serializes concurrent requests. Distinct from missing-compression (enable gzip at all) and gzip-static-at-build (precompress STATIC assets once): this is using the BLOCKING sync zlib API for dynamic per-request data.",
    evidence: [
      "Node.js docs — zlib Convenience Methods run sync work on the event loop",
      "Node.js docs — Don't Block the Event Loop (CPU-bound zlib on libuv threadpool)",
    ],
    category: "industry",
    languages: ["node"],
  },
  // ─────────── Cross-language wave 1 (6) — concepts proven in other runtimes ───────────
  {
    id: "node-abort-cancel-client-only",
    title: "AbortSignal cancels only your side of the request — never assume upstream stopped",
    whenToApply:
      "Outbound fetch/undici/http calls use `AbortSignal.timeout()` or an AbortController and the code treats the abort as if the upstream operation was undone — retrying a mutation immediately after a timeout, or assuming a cancelled downstream write never happened. Aborting rejects the local promise and tears down the socket, but the upstream server usually finishes the work it already received. Symptom: timeout-then-retry produces duplicate writes upstream (double charges, double inserts), and aborted requests leak half-consumed response bodies that pin sockets in the pool until they time out.",
    evidence: [
      "undici docs — abort tears down the client request; the origin may still complete it",
      "Stripe API docs — idempotency keys exist precisely because client timeouts don't cancel server work",
    ],
    category: "industry",
    languages: ["node"],
  },
  {
    id: "node-bootstrap-self-gate",
    title: "Never gate the first bootstrap/registration call on state only that call can change",
    whenToApply:
      "Process init suppresses the first registration/handshake/enrollment request behind a flag that only that same call's success would set — `if (!config.registered) return;` before the register call, a readiness guard satisfied only by the bootstrap response, or a queued 'first contact' that only flushes once a credential (which the contact would mint) is present. Symptom: a fresh deploy runs forever unregistered with zero errors and zero outbound attempts — the gate can never open without the call it blocks — and the deadlock hides in dev where a leftover credential satisfies the guard.",
    evidence: [
      "Boosthis production incident (Jul 2026) — a first-run call gated on its own result left fresh installs permanently unregistered",
      "Control-systems deadlock: a guard whose only unlocking event is the action it blocks",
    ],
    category: "industry",
    languages: ["node"],
  },
  {
    id: "node-remote-data-null-guard",
    title: "Validate request/upstream/cache data before nested property access",
    whenToApply:
      "A handler dereferences nested fields straight off external input — `req.body.user.email` with no body validation, `(await res.json()).data.items[0].id` from an upstream API, a cache/DB row assumed present (`row.settings.plan`). `req.body` is `undefined` without body-parsing middleware, upstream payloads go partial on errors and version skew, and cache misses return null. Symptom: `TypeError: Cannot read properties of undefined` 500s that appear only for malformed clients, upstream degradation, or cold caches — and each one is an unhandled path an attacker can hit at will.",
    evidence: [
      "Express docs — req.body is undefined unless a body parser is mounted",
      "OWASP — improper input validation; schema-validate at the boundary (zod/joi/ajv)",
    ],
    category: "industry",
    languages: ["node"],
  },
  {
    id: "node-unsafe-payload-parse",
    title: "Parse untrusted bodies defensively — JSON.parse throws on real-world payloads",
    whenToApply:
      "`JSON.parse(...)` or `await response.json()` runs on untrusted content with no try/catch and no status/content-type check — a webhook body, a file read, a queue message, or an upstream API that returns an HTML error page on 502/maintenance. Symptom: one malformed payload throws `SyntaxError: Unexpected token` inside the handler (a 500, or a crashed process if it escapes into an async gap), and the log shows the parse error instead of the upstream failure the body was actually describing. A single bad message can also poison a queue consumer into a crash-redeliver loop.",
    evidence: [
      "Node.js docs — JSON.parse throws SyntaxError on malformed input",
      "Google SRE Book — defense in depth at data boundaries; a poison message must not kill the consumer",
    ],
    category: "industry",
    languages: ["node"],
  },
  {
    id: "node-transport-must-throw",
    title: "Retrying HTTP helpers must reject on transport failure — never return a sentinel response",
    whenToApply:
      "A retry/timeout wrapper around fetch/undici/http catches transport-level failures (ECONNREFUSED, ECONNRESET, ETIMEDOUT, DNS failure, socket hangup) and RESOLVES a sentinel object (`{ ok: false, status: 0 }` or `null`) instead of rethrowing. Since the retry path only fires on rejection, the sentinel is treated as a final answer and the recovery logic silently never engages. Symptom: retries never trigger on exactly the failures they exist for — one connection reset becomes a permanent failure with the retry counter at zero, and downstream code branches on a fake status it was never designed for.",
    evidence: [
      "Boosthis production incident (Jul 2026) — a transport adapter resolved {status:0}, skipping the retry-over-dead-socket path entirely",
      "undici docs — request errors reject with typed connection/timeout errors; there is no HTTP status for a failed transport",
    ],
    category: "industry",
    languages: ["node"],
  },
  {
    id: "node-single-event-perf-logging",
    title: "Log all timing fields for one request/job in a single structured event",
    whenToApply:
      "Per-request instrumentation emits separate log lines for each phase — one line for DB time, another for cache time, another for downstream latency, another for total — so no single record holds the full breakdown of one request. Symptom: correlating 'requests where DB was slow AND total was slow' requires joining log lines on request-id across interleaved concurrent output; lines get sampled/dropped independently, and the join breaks exactly during incidents when volume spikes. One structured object per request (all durations as fields) makes every such question a single filter.",
    evidence: [
      "pino docs — one structured log object per request with merged fields",
      "Honeycomb — wide events: one event per request with many fields beats many narrow events",
    ],
    category: "industry",
    languages: ["node"],
  },
  // ─────────── Case Study (3) — cross-runtime batch (vendored drift, restart port hold, detached observer) ───────────
  {
    id: "node-vendored-copy-drifts-from-source",
    title: "Regenerate generated/vendored artefacts in CI and fail on diff — never hand-edit the copy",
    whenToApply:
      "The repo embeds a GENERATED or COPIED artefact that duplicates a source of truth — a committed build output shipped from source (tsc `dist/`, a bundled `.js`), a generated OpenAPI/Prisma client or GraphQL types, a checked-in `package-lock.json`/`pnpm-lock.yaml`, a snapshot/manifest emitted by a build script, or a vendored dependency under `patches/` — and code edits the SOURCE while the embedded copy keeps serving old bytes. Symptom: nothing throws and the type-check passes, but `require`/`import` resolves the STALE committed copy, so a route serves an old schema or a client sends fields that no longer exist. The two files both parse, so the drift never surfaces as an error — only as wrong behaviour downstream.",
    evidence: [
      "Boosthis production incident (Aug 2026) — a rule manifest edited at source kept serving old bytes because the generated copy in dist was not regenerated in CI",
      "The Twelve-Factor App — build/release/run: a generated artefact must be produced by the build, never hand-edited in place",
    ],
    category: "case-study",
    languages: ["node"],
  },
  {
    id: "node-restart-old-process-holds-port",
    title: "listen() bind failures must be fatal — verify the new pid owns the port after restart",
    whenToApply:
      "A restart / reload / zero-downtime deploy stops the old Node process by NAME or signal and starts a new one, but the old one survives — an orphaned `child_process`/cluster worker, a detached `--watch`/nodemon, or a reload loop respawning without reaping. Symptom: the new `server.listen()` either throws EADDRINUSE, OR the app catches that error and silently retries on `port 0` (a random free port) while the OLD process keeps answering on the expected port — so health checks pass, the service looks live, and it is serving the PREVIOUS build. Any `on('error')` handler that maps EADDRINUSE to a fallback port instead of exiting is this bug.",
    evidence: [
      "Boosthis production incident (Aug 2026) — a graceful-restart script killed by name, missed an orphaned worker, and the new server fell back to a random port while the old one served stale responses",
      "Node.js cluster/net docs — bind conflicts and reusing a listening socket across restarts; PM2 docs — stop by process id, not by name match",
    ],
    category: "case-study",
    languages: ["node"],
  },
  {
    id: "node-observer-never-attached",
    title: "Assert middleware/observers are registered at boot and prove one real request moves the counter",
    whenToApply:
      "A metrics middleware, an Express/Fastify `onRequest`/`onResponse` hook, a `PerformanceObserver`, a `prom-client` histogram wrapper, or an OpenTelemetry instrumentation exists and compiles, but nothing wires it into the app — `app.use()` is never called, the plugin is defined but not `register()`ed, or the observer is constructed but `.observe()` is never invoked. Symptom: the counter/histogram it feeds stays at zero forever, its Grafana tile is empty or perpetually warming, and the whole middleware suite passes because each unit is tested in isolation with a fabricated request rather than a real one flowing through the assembled app.",
    evidence: [
      "Boosthis production incident (Aug 2026) — a latency middleware was written and unit-tested but never added to app.use(), so its metric read zero in prod",
      "prom-client / OpenTelemetry docs — a metric only moves when its instrument is registered and actually observed on the live request path",
    ],
    category: "case-study",
    languages: ["node"],
  },
  {
    id: "node-fixed-ms-timing-assert",
    title: "Poll to a deadline; never assert a hardcoded millisecond duration",
    whenToApply:
      "A vitest/jest test, a readiness gate, or a `/healthz` probe hinges on a FIXED number of milliseconds — an `await setTimeout(300)` (timers/promises) before the assertion, an `expect(Date.now() - start).toBeLessThan(200)` reading a wall-clock delta the test itself measured, or a probe `timeout` treated as a latency budget. On a shared CI runner, a CPU-throttled container, or a laptop mid-build, wall time measures the MACHINE not the code, so the check flakes red when nothing is wrong AND passes on an idle box even after the code got slower — both directions fail. Fix it with the runtime's own mechanisms: `await` the actual event/promise (or poll the CONDITION to a generous deadline, p-wait-for style) instead of sleeping; drive time deterministically with `vi.useFakeTimers()`/`vi.advanceTimersByTimeAsync` rather than really waiting; assert ORDERING/causality or the operation's OWN `perf_hooks` (`performance.now()` / PerformanceObserver) duration, not the test clock. Keep real latency budgets as p95/p99 measured from production telemetry, never a constant in a unit test, and where a hard timeout must exist make it a generous HANG bound in seconds (`AbortSignal.timeout(...)`, a probe `timeoutSeconds`), not a performance assertion.",
    evidence: [
      "Boosthis production incident (Aug 2026) — a gate asserted a finish-time by reading the instant it ran instead of awaiting it with a bounded poll, so it failed on a loaded runner while the code was correct",
      "Node.js timers/promises & perf_hooks docs; vitest fake-timers — await the event or fake the clock, and read a monotonic duration rather than gating on a real setTimeout",
    ],
    category: "case-study",
    languages: ["node"],
  },
  {
    id: "node-credentialed-refusal-signin-challenge",
    title: "Do not challenge a caller whose credential was understood",
    whenToApply:
      "In Express Fastify or Koa middleware, a request that carried an authorization header receives status 401 plus an authenticate challenge even though the credential was understood but expired out of scope or forbidden for this resource. The caller discards a usable identity and treats the fast refusal as an outage.",
    evidence: [
      "Node.js HTTP authentication middleware documentation",
      "HTTP authentication status and challenge semantics",
    ],
    category: "operational",
    languages: ["node"],
  },
  {
    id: "node-generic-refusal-message",
    title: "Give every refusal a distinct actionable code and message",
    whenToApply:
      "In Express Fastify or Koa middleware, different refusal causes return byte identical bodies with no stable machine code. Callers cannot distinguish expired credentials missing scope throttling and policy denial, so every refusal looks like the same outage.",
    evidence: [
      "Express and Fastify error handler documentation",
      "HTTP problem detail and stable error code guidance",
    ],
    category: "operational",
    languages: ["node"],
  },
  {
    id: "node-strict-credential-scheme-parsing",
    title: "Normalize credential schemes and token whitespace before parsing",
    whenToApply:
      "In Node.js authentication middleware, credential parsing compares the scheme with exact letter case or splits on one literal space and leaves surrounding token whitespace quotes or line breaks intact. A harmless paste variation is refused as if the service were down.",
    evidence: [
      "Node.js HTTP header parsing documentation",
      "HTTP authentication scheme parsing guidance",
    ],
    category: "operational",
    languages: ["node"],
  },
  {
    id: "node-shared-allowance-no-caller-key",
    title: "Partition shared allowances by caller and keep a global backstop",
    whenToApply:
      "In Node.js, rate limiter middleware uses one process wide or route wide counter for every caller. One noisy caller exhausts the allowance and unrelated callers receive refusals until the shared window resets.",
    evidence: [
      "rate limiter flexible and express rate limit key generator documentation",
      "OWASP denial of service and rate limiting guidance",
    ],
    category: "operational",
    languages: ["node"],
  },
  {
    id: "node-silent-protection-fail-open",
    title: "Surface every degraded protection even when it fails open",
    whenToApply:
      "In Node.js, an authorization quota validation or rate limit gate catches a backing store timeout missing configuration or dependency failure and allows the request with no metric log or health signal. The protection disappears while the service still looks healthy.",
    evidence: [
      "Express Fastify and Koa middleware error handling documentation",
      "Security control degraded mode observability guidance",
    ],
    category: "operational",
    languages: ["node"],
  },
  {
    id: "node-validated-host-resolved-again",
    title: "Do not validate a hostname and then connect by name",
    whenToApply:
      "A Node.js webhook callback import or URL fetch validates only the supplied hostname or a result from `dns.promises.lookup` and then passes the original name to `fetch`, undici, axios, `http.request`, or `https.request`, or automatically follows redirects. The client performs another lookup or follows a new Location, so DNS rebinding or a redirect can connect to loopback link local private ranges or a cloud metadata address that the check rejected.",
    evidence: [
      "Node.js dns.lookup and http Agent lookup documentation",
      "undici Dispatcher connect and redirect handling documentation",
      "OWASP server side request forgery prevention guidance",
    ],
    category: "industry",
    languages: ["node"],
  },
  {
    id: "node-logging-hooks-replaced",
    title: "Do not replace host logging and fatal error hooks",
    whenToApply:
      "A Node.js library or bootstrap overwrites `console` methods, calls `process.removeAllListeners` for `uncaughtException` or `unhandledRejection`, installs `process.setUncaughtExceptionCaptureCallback`, or replaces a global Pino Winston or OpenTelemetry logger without preserving and invoking the host setup. Existing levels formatting destinations and redaction silently stop applying.",
    evidence: [
      "Node.js process uncaughtException and unhandledRejection documentation",
      "Node.js process setUncaughtExceptionCaptureCallback documentation",
      "OpenTelemetry JavaScript global diagnostics documentation",
    ],
    category: "industry",
    languages: ["node"],
  },
  {
    id: "node-nonreentrant-lock-reacquired",
    title: "Do not reacquire a non reentrant lock from its holder",
    whenToApply:
      "Code holds an `async-mutex` Mutex, an `async-lock` key left in its default non reentrant mode, a `proper-lockfile` advisory lock, or a SharedArrayBuffer lock built with `Atomics` and awaits or invokes a helper callback observer or getter that acquires the same lock or key again. Unless the primitive is explicitly configured to recognize the same logical owner, it cannot infer same async ownership, so the inner acquire waits behind the outer acquire while the outer waits for the inner call.",
    evidence: [
      "async-mutex Mutex acquire and runExclusive documentation",
      "async-lock same key queueing and opt-in reentrancy documentation",
      "Node.js worker threads Atomics wait documentation",
    ],
    category: "industry",
    languages: ["node"],
  },
  {
    id: "node-retry-leaves-attempt-running",
    title: "Do not retry while the timed out attempt is still running",
    whenToApply:
      "A Node.js retry wrapper gives up through `Promise.race`, a timer, or a response deadline and immediately starts another fetch axios request stream query or worker task without cancelling or destroying the first attempt. The abandoned promise socket request or pool checkout remains live, so each timeout adds another concurrent attempt and consumes resources nobody will read.",
    evidence: [
      "Node.js AbortController and AbortSignal documentation",
      "undici fetch cancellation and response body documentation",
      "Node.js http ClientRequest destroy documentation",
    ],
    category: "industry",
    languages: ["node"],
  },
  {
    id: "ai-call-no-timeout",
    title: "Put a deadline on every AI provider call",
    whenToApply:
      "A request handler calls an AI SDK or provider endpoint with `fetch` but supplies no SDK timeout, `AbortSignal.timeout(...)`, or enclosing deadline. AI generation can take minutes or stall, so one slow answer keeps the incoming request, outbound connection, and worker state open indefinitely.",
    evidence: ["Node.js docs — AbortSignal.timeout", "OpenAI Node SDK — timeout and maxRetries options"],
    category: "industry",
    languages: ["node"],
  },
  {
    id: "ai-retry-ignores-retry-after",
    title: "Honor the AI provider's Retry-After before retrying",
    whenToApply:
      "Code catches an AI provider 429 or overloaded response and retries on a fixed or exponential delay without first reading `Retry-After` or the provider SDK's response headers. Retrying before the published deadline sustains the rate limit and spends attempts on guaranteed refusals.",
    evidence: ["RFC 9110 — Retry-After", "OpenAI API docs — rate limits"],
    category: "industry",
    languages: ["node"],
  },
  {
    id: "ai-calls-serial",
    title: "Run independent AI calls concurrently with Promise.all",
    whenToApply:
      "Independent AI completions, embeddings, classifications, or moderation calls are awaited one after another in the same request even though no call consumes another call's result. Since each call takes seconds, serial awaits add their latencies; start them together and await `Promise.all`.",
    evidence: ["MDN — Promise.all", "OpenAI Node SDK — async API examples"],
    category: "industry",
    languages: ["node"],
  },
  {
    id: "ai-duplicate-prompt",
    title: "Send each logical AI prompt only once per request",
    whenToApply:
      "One incoming request sends the same messages or prompt to the same AI model more than once, commonly through duplicate helper calls, retries after a successful result, or both a prefetch and handler path. The duplicate pays for the same input and output tokens twice and usually discards one answer.",
    evidence: ["OpenAI API docs — token usage", "Anthropic API docs — usage fields"],
    category: "industry",
    languages: ["node"],
  },
  {
    id: "ai-prompt-cache-cold",
    title: "Keep large shared prompt prefixes stable so provider caching hits",
    whenToApply:
      "Large system instructions, tool schemas, or retrieved documents are repeatedly sent to an AI provider but cached-input usage remains zero. Dynamic values, timestamps, random ordering, or request-specific text placed before the shared prefix prevent provider prompt-cache reuse; keep the reusable prefix byte-stable and put changing content last.",
    evidence: ["OpenAI API docs — prompt caching", "Anthropic docs — prompt caching"],
    category: "industry",
    languages: ["node"],
  },
  {
    id: "ai-stream-usage-not-requested",
    title: "Request usage metadata on every streamed AI response",
    whenToApply:
      "An OpenAI-family streamed completion is created without `stream_options: { include_usage: true }`, so the stream never emits its final usage block. The application can display tokens as they arrive but cannot measure or attribute the call's input, output, cached tokens, or cost.",
    evidence: ["OpenAI API reference — stream_options.include_usage", "OpenAI Node SDK — streaming responses"],
    category: "industry",
    languages: ["node"],
  },
  // ─────────── Outside services (4) — the dependency reading's own fixes ───
  // The four shapes the outside-services meter can actually SEE, named here so
  // a founder who learns "sign-in is what is slow" is handed a repair rather
  // than a worry. Generic rules already exist for a missing deadline and for
  // serialized awaits; these are deliberately separate because the reading
  // that raises them is about a DEPENDENCY — sign-in, uploads, payments,
  // messaging, stored-knowledge search — and the advice differs when the slow
  // thing is somebody else's service that you cannot make faster.
  {
    id: "dependency-call-no-timeout",
    title: "Put a deadline on every outside-service call — sign-in first",
    whenToApply:
      "A handler calls an outside service (an identity provider, an object store, a payment gateway, an email/SMS sender, a vector or search service) with no client timeout, no `AbortSignal.timeout(...)`, and no enclosing request deadline. Symptom: the dependency degrades rather than fails, and because nothing gives up, your own request never ends either — a request holds its socket, its pooled connection and its worker for as long as the other side is willing to stall. Sign-in is the worst place for this: it sits in front of every session, so a stalling identity provider makes the whole product look down before a single page renders. Distinct from fetch-no-timeout-node (the general rule) in what it protects: here the un-bounded wait is on the visitor's critical path and the slow party is one you do not control.",
    evidence: [
      "Node.js docs — AbortSignal.timeout",
      "Google SRE Book — Addressing Cascading Failures (a dependency that is slow is more dangerous than one that is down)",
    ],
    category: "industry",
    languages: ["node"],
  },
  {
    id: "dependency-retry-uncapped",
    title: "Cap retries against an outside service — an unbounded retry turns their bad minute into your outage",
    whenToApply:
      "Code retries a failed call to an outside service with no attempt ceiling, no total-elapsed budget, no jitter, or no special handling for 429 and `Retry-After`. Symptom: the dependency has a bad minute, every one of your in-flight requests starts retrying at once, and the retries themselves become the load that keeps it down — while each individual request's latency quietly multiplies by the attempt count. Boosthis sees this as a kind whose call count is far above its request count and whose failures cluster.",
    evidence: [
      "RFC 9110 — Retry-After",
      "Google SRE Book — Handling Overload (retry amplification)",
    ],
    category: "industry",
    languages: ["node"],
  },
  {
    id: "dependency-calls-serial",
    title: "Start independent outside-service calls together, not one after another",
    whenToApply:
      "One request awaits several outside-service calls in sequence — verify the session, then fetch the avatar from object storage, then look up the customer at the payment gateway — where no call consumes the previous call's result. Symptom: the request's wait is the SUM of every dependency's latency instead of the slowest one, so a page that should wait 200ms waits 700ms and no single service looks slow enough to blame. Distinct from sequential-independent-awaits in the fix: these are network calls to different parties, so the ceiling is the slowest dependency, and a partial-failure policy has to be chosen deliberately.",
    evidence: [
      "MDN — Promise.all",
      "Google SRE Book — Latency (serial dependencies add, parallel dependencies max)",
    ],
    category: "industry",
    languages: ["node"],
  },
  {
    id: "dependency-on-visitor-path",
    title: "Take a dependency off the visitor's path when the visitor does not need its answer",
    whenToApply:
      "A request the user is waiting on calls an outside service whose result it never returns — sending a welcome email or an SMS, writing an audit event to a logging service, syncing a record to a CRM, warming a search index, uploading a derived thumbnail. Symptom: the visitor pays the full latency (and inherits the full failure) of work whose answer they will never see, so a slow email provider makes signup slow and a broken one makes signup fail. Distinct from node-background-work-needs-scheduler (which is about work having no runner at all): the work here already has a runner — the visitor's own request — and that is exactly the problem.",
    evidence: [
      "Google SRE Book — Addressing Cascading Failures (shed non-critical work from the serving path)",
      "Boosthis outside-services reading — a dependency whose kind never contributes to the response body",
    ],
    category: "industry",
    languages: ["node"],
  },

  // ─────────── Realtime connections (3) — long-lived socket/stream lifecycle ───────────
  {
    id: "node-websocket-reconnect-storm",
    title: "Back off outbound websocket reconnects exponentially",
    whenToApply:
      "A Node.js process that CONSUMES a websocket — a `ws` client, a Socket.IO client, an exchange or vendor feed, a service-to-service stream — redials immediately from its `close` or `error` handler with no growing delay, no jitter and no attempt ceiling. Symptom: the moment the upstream blips, every instance of the service redials in lockstep at full speed, so the upstream comes back up into a synchronized stampede and goes straight back down; the reconnect loop also burns CPU and file descriptors while looking, in the logs, like ordinary connection activity.",
    evidence: [
      "ws client close and error event documentation",
      "AWS Architecture Blog — exponential backoff and jitter",
      "Google SRE Book — Handling Overload (retry amplification)",
    ],
    category: "operational",
    languages: ["node"],
  },
  {
    id: "node-realtime-no-heartbeat",
    title: "Ping long-lived connections so dead peers are reaped",
    whenToApply:
      "A websocket server (`ws`, Socket.IO, a raw `upgrade` handler) or an SSE endpoint keeps sockets open with no periodic ping/pong sweep and no idle deadline — no `ws.ping()` interval with a `pong` liveness flag, no comment keepalive written to the event stream, no `socket.setTimeout`. A client that vanishes without a close frame (killed app, lost mobile radio, hard NAT timeout) leaves a socket the server still counts as connected. Symptom: the connection count only ever rises, memory and per-connection state grow with it, broadcasts are written to sockets nobody is reading, and a restart is the only thing that clears them.",
    evidence: [
      "ws documentation — how to detect and close broken connections",
      "RFC 6455 section 5.5.2 — Ping and Pong frames",
      "Node.js net.Socket setTimeout documentation",
    ],
    category: "operational",
    languages: ["node"],
  },
  {
    id: "node-socket-never-closed",
    title: "End long-lived responses and upgraded sockets on the way out",
    whenToApply:
      "An SSE handler or upgraded socket is opened per request and never ended: the `close` event on the request is not subscribed to, so the broadcast interval, subscription or database listener created for that client keeps running after the client is gone; or shutdown closes the HTTP server without closing the connections held open on it, so the process never exits. Symptom: handles, timers and listeners accumulate for every client that ever connected, a rolling restart hangs until it is killed, and the leak is invisible to request-based readings because the request never finished.",
    evidence: [
      "Node.js http IncomingMessage close event documentation",
      "Node.js http server close and closeAllConnections documentation",
      "MDN Server-sent events — closing the connection from either end",
    ],
    category: "operational",
    languages: ["node"],
  },
  // ─────────── Background work (4) — jobs, queues and schedules ───────────
  // The four shapes the background-work meter can actually SEE. Each one is
  // named here because a number with no fix beside it is a complaint: a
  // developer who learns their jobs overlap and is told nothing else has been
  // given a worry, not a repair. These are deliberately about the JOB, not
  // about slowness — a nightly import is supposed to take an hour.
  {
    id: "node-job-without-time-limit",
    title: "Give every background job a deadline — a hung run is invisible without one",
    whenToApply:
      "A queue consumer or scheduled task (`bullmq` `Worker`, `pg-boss` `work()`, a `node-cron` callback, a bare `setInterval` doing real work) runs a handler with no timeout of its own: no `AbortSignal.timeout`, no `Promise.race` against a deadline, no `lockDuration`/visibility timeout short enough to matter. Symptom: a run that hangs — a socket that never returns, a lock never granted, a third-party call with no timeout — occupies its worker slot forever. Nothing throws, nothing is logged, and no error monitor fires, because from the process's point of view the job is still working. Concurrency silently drops by one with each hung run until the queue stops draining entirely; the first visible sign is a backlog with a healthy-looking worker attached to it. Distinct from a slow job: a slow job finishes.",
    evidence: [
      "BullMQ docs — stalled jobs, lockDuration and maxStalledCount: a job whose lock is never renewed is only recovered if the lock can expire",
      "Node.js docs — AbortSignal.timeout() and passing a signal into fetch / stream operations",
    ],
    category: "industry",
    languages: ["node"],
  },
  {
    id: "node-job-retries-forever",
    title: "Cap job retries and send the last failure somewhere — an endless retry is a hidden outage",
    whenToApply:
      "A job is enqueued with unlimited attempts, or a handler catches its own failure and re-enqueues itself, with no attempt ceiling and no dead-letter destination: `attempts` left unset (or set absurdly high) in BullMQ, `retryLimit` unset in pg-boss, a `catch` block that calls `queue.add(...)` again. Symptom: a job that can never succeed — a deleted row, a permanently-rejected payload, a revoked credential — is retried for the life of the system. It consumes a worker slot on every cycle, costs money at every external call it makes, and produces the same log line so often that nobody reads it. The queue depth stays flat, so a backlog alarm never fires. The bug is not the failure; it is that the failure has no end and no destination.",
    evidence: [
      "BullMQ docs — attempts, backoff strategies and the failed set as a dead-letter destination",
      "pg-boss docs — retryLimit / retryBackoff and the dead-letter queue",
      "AWS Architecture guidance — dead-letter queues exist so a poison message leaves the main queue",
    ],
    category: "industry",
    languages: ["node"],
  },
  {
    id: "node-scheduled-job-overlaps-itself",
    title: "Stop a scheduled job starting again while the last run is still going",
    whenToApply:
      "A recurring task fires on a fixed cadence (`node-cron`, `setInterval`, a repeatable queue job, a platform cron trigger) with no guard against a run that has not finished. Symptom: the moment one run takes longer than the interval, two copies run at once — then three. They compete for the same rows, the same connection pool and the same external rate limit, so each one is slower than the last and the overlap compounds. The classic damage is not slowness but duplication: the same email sent twice, the same charge attempted twice, a counter incremented by two runs that both read the old value. Note that a lock held in a module variable is NOT a guard once more than one process runs the same schedule.",
    evidence: [
      "node-cron docs — a scheduled task fires on the cadence regardless of whether the previous invocation has returned",
      "Boosthis background-work meter (Aug 2026) — overlapping runs are counted per job name precisely because they are invisible in any per-run log",
    ],
    category: "industry",
    languages: ["node"],
  },
  {
    id: "node-queue-falling-behind",
    title: "Measure how long a job WAITED, not just how long it ran",
    whenToApply:
      "A worker records how long each job took but never how long it sat in the queue first — no use of BullMQ's `job.timestamp`/`processedOn`, no `startafter`/`createdon` comparison in pg-boss, no queue-depth reading anywhere. Symptom: every run is fast and every dashboard is green while users wait minutes for work that the system reports as instant. The service is not slow; it is late, and the two are measured in different places. A queue that is falling behind is only visible in the gap between enqueue and start, which nobody is looking at — and when it is finally noticed, the usual reflex is to add workers, which cannot help when the real cause is a single job class saturating a downstream limit.",
    evidence: [
      "BullMQ docs — job.timestamp, processedOn and finishedOn expose the wait separately from the run",
      "Google SRE Book — Monitoring Distributed Systems: saturation and latency are separate signals; a fast handler on a growing backlog is a saturated system",
    ],
    category: "industry",
    languages: ["node"],
  },
  {
    id: "node-app-far-from-its-data",
    title: "Put the service and the data it queries in the same region \u2014 and judge distance from connection setup, never from call time",
    whenToApply:
      "A Node service is published in one region while the managed database, object store, AI provider or payment API it calls was created in another \u2014 usually because the hosting platform and the data platform each chose a default and nobody chose deliberately. Every query then pays the round trip to the other region, often more than the query itself takes, and the cost lands on every request rather than on one slow endpoint. Symptom: request times that look uniformly padded, a database whose own reported query time is small, and no single slow function to blame \u2014 so the developer rewrites application code that was never the problem. Diagnose it with CONNECTION SETUP time (the TCP connect plus the TLS handshake, measured before the first byte of the request is sent), never with total call time: a round trip contains the distance AND however long the service spent thinking, so a slow-but-nearby service will be misread as a distant one and someone will move a database that was merely busy. On a long-running server connections are pooled and reused, so new setups are rare \u2014 gather several before drawing any conclusion instead of judging on one or two.",
    evidence: [
      "Database wire protocols (PostgreSQL, MySQL, Redis) \u2014 every statement costs at least one network round trip, so per-query cost tracks distance rather than query complexity",
      "Node undici diagnostics channels \u2014 client:beforeConnect / client:connected expose connection establishment separately from the response, which is what makes distance measurable without confusing it with slowness",
    ],
    category: "industry",
    languages: ["node"],
  },

  // ─────────── Account-size scaling (1) — a page whose cost grows with the customer ───────────
  {
    id: "node-page-cost-scales-with-account",
    title:
      "Keep a page at a fixed cost as the account grows \u2014 measure it against a large account, not seed data",
    whenToApply:
      "A signed-in page or list endpoint does strictly more work for a bigger customer: a read sits inside the per-row loop that builds the response (one lookup, one count, one cache miss per project, order or member), or a headline number is an aggregate that re-scans the account's entire history on every load. Symptom: nothing looks slow in development, where the seeded account holds five rows, and no individual query is slow in production either \u2014 the page is simply several times slower for the customer with fifty projects than for the one with three, and it degrades a little every month as their data accumulates. It shows up first on the largest and most valuable accounts, and the reflex is to tune the individual query, which cannot help: the query was never the problem, the COUNT of queries and rows is what tracks account size. Distinct from the N+1 rule, which batches one named relation, and from the unbounded-result rule, which caps the rows a single query returns \u2014 this one asks whether the WHOLE page holds a fixed budget as the account grows, and whether anyone has ever rendered it against a large account to find out.",
    evidence: [
      "Boosthis dashboard audit (Sep 2026) \u2014 signed-in project pages held a per-project read inside the render loop and a whole-history aggregate, so page cost tracked the size of the account while every individual query stayed fast",
      "Google SRE Book \u2014 Monitoring Distributed Systems: saturation is only visible in a measurement taken at more than one size, so a page that is quick on seed data is not evidence of anything",
    ],
    category: "case-study",
    languages: ["node"],
  },

  // ─────────── Memory harvest (14) — Postgres write/read traps, crash-handler
  // ownership, deferred work, response-path honesty, SSRF and shutdown ───────────
  {
    id: "node-nul-byte-text-write",
    title: "Reject NUL bytes before they reach a text or key column",
    whenToApply:
      "A string built by joining parts (a composite cache key, a slug, a path, an imported CSV/JSON field, a scraped value) is written to a Postgres text/varchar/jsonb column through pg, Prisma, Drizzle, Knex, Sequelize or TypeORM, and nothing strips U+0000 first. Postgres rejects a NUL byte in text outright, so the write throws at the first INSERT rather than at build or review time.",
    evidence: [
      "Boosthis engineering memory (2026) — a composite key joined with a NUL separator failed at its first INSERT, in code that typechecked and reviewed clean",
      "PostgreSQL manual — Character Types: text values may not contain the zero byte",
    ],
    category: "case-study",
    languages: ["node"],
  },
  {
    id: "node-same-millisecond-insert-order",
    title: "Give same-millisecond rows a tiebreaker before ordering by time",
    whenToApply:
      "Rows are inserted in one loop, transaction or seed run, carry a createdAt/timestamp default and a random primary key (uuid/cuid/nanoid), and are later read back with ORDER BY createdAt through Prisma, Drizzle, Knex or raw pg. Writes landing inside the same millisecond come back in an order the database never promised, so children render before parents and pagination repeats or skips rows.",
    evidence: [
      "Boosthis engineering memory (2026) — same-millisecond inserts with random ids returned nondeterministic order between identical reads",
      "PostgreSQL manual — SELECT: row order is undefined without a total ORDER BY",
    ],
    category: "case-study",
    languages: ["node"],
  },
  {
    id: "node-indexed-expression-name-ceiling",
    title: "Cap generated index and constraint names at 63 bytes yourself",
    whenToApply:
      "A migration written with Knex, Prisma, Drizzle Kit, Sequelize or TypeORM lets the tool derive an index, unique-constraint or foreign-key name from a long table name plus several column names, or from an expression. Postgres truncates any identifier past 63 bytes, so two different indexes can collide under one name, and a name cut mid-token reaches production as something nobody wrote.",
    evidence: [
      "Boosthis engineering memory (2026) — an over-long indexed expression arrived truncated mid-token and only failed at migration time",
      "PostgreSQL manual — Identifiers and Key Words: identifiers are truncated to NAMEDATALEN-1 (63) bytes",
    ],
    category: "case-study",
    languages: ["node"],
  },
  {
    id: "node-expression-index-sort-mismatch",
    title: "Build a query's ORDER BY from the same expression as its index",
    whenToApply:
      "An index is created over an expression (lower(email), a CASE rank, a coalesce, a jsonb path, date_trunc) and a page later sorts or filters by what looks like the same expression, but built a second time in a query builder, a template literal or a reworded CASE. Postgres matches an expression index by parse tree, so a cosmetic difference silently drops the index and the page falls back to a full sort with no error to notice.",
    evidence: [
      "Boosthis engineering memory (2026) — a reworded CASE rank stopped matching its expression index; the page still returned correct rows, just slowly",
      "PostgreSQL manual — Indexes on Expressions: the planner matches an index only when the query expression matches the indexed one",
    ],
    category: "case-study",
    languages: ["node"],
  },
  {
    id: "node-row-lock-across-network-call",
    title: "Never hold a row lock across an email, payment or webhook call",
    whenToApply:
      "A pg/Prisma/Drizzle transaction takes SELECT ... FOR UPDATE (or an UPDATE that locks a row) and then awaits an outbound call inside the same transaction: Stripe, Resend, an S3 upload, a webhook POST, or any fetch/axios request. Every writer queued behind that row now waits on a third party's timeout, so one slow vendor becomes a database-wide stall.",
    evidence: [
      "Boosthis engineering memory (2026) — a lock held across a vendor call blocked every writer behind a hung provider",
      "PostgreSQL manual — Explicit Locking: row locks are held until the end of the transaction",
    ],
    category: "case-study",
    languages: ["node"],
  },
  {
    id: "node-purge-without-revalidation",
    title: "Re-check eligibility inside the same transaction that deletes",
    whenToApply:
      "A destructive job (account closure, retention prune, GDPR erase, stale-row sweep) runs a SELECT to decide what is eligible, then issues the DELETE in a separate statement, request or worker tick. A restore, an un-cancel or a payment landing in that window is deleted anyway, because nothing revalidated the predicate under the same lock.",
    evidence: [
      "Boosthis engineering memory (2026) — a purge that checked eligibility before deleting removed data that had been restored in between",
      "PostgreSQL manual — Transaction Isolation: a read in one statement does not constrain a later write",
    ],
    category: "case-study",
    languages: ["node"],
  },
  {
    id: "node-crash-handler-replaces-host",
    title: "Observe uncaught exceptions; do not silently keep the process alive",
    whenToApply:
      "process.on('uncaughtException', ...) is registered to log or report a crash and then simply returns, so Node's default abort is replaced and the process limps on with torn state: half-open transactions, a corrupt in-memory cache, sockets nobody owns. Common in crash reporters, drop-in observability packages, and 'keep the server up' handlers.",
    evidence: [
      "Boosthis engineering memory (2026) — a crash reporter that replaced the default behaviour left the host running on corrupt state",
      "Node.js documentation — process 'uncaughtException': resuming normally is undefined behaviour; use 'uncaughtExceptionMonitor' to observe without overriding",
    ],
    category: "case-study",
    languages: ["node"],
  },
  {
    id: "node-after-response-work-lost",
    title: "Give post-response work an idempotent, awaitable backstop",
    whenToApply:
      "Work is fired after the response is sent — res.on('finish'), setImmediate, a floating promise, an unawaited analytics or email call, a cache warm — in an environment that can suspend or recycle the process: a serverless function, an autoscaled container, or any host that freezes at response completion. The work is silently lost on suspend, restart or deploy, and nothing records that it never ran.",
    evidence: [
      "Boosthis engineering memory (2026) — deferred after-response work needs an idempotent backstop and must remain awaitable, or a suspend drops it without trace",
      "Node.js documentation — process 'exit': only synchronous work runs once the event loop is drained",
    ],
    category: "case-study",
    languages: ["node"],
  },
  {
    id: "node-stream-timing-at-handler-return",
    title: "Time a streamed response at close, not when the handler returns",
    whenToApply:
      "Middleware measures request duration by stopping its timer when the handler returns or when res.json/res.send is called, while the route actually streams: a pipe, SSE, a chunked download, a React/Next streaming render, or a proxied upstream body. The recorded number describes how long it took to start answering, not what the visitor waited for, so the slowest routes in the app look like the fastest.",
    evidence: [
      "Boosthis engineering memory (2026) — an adapter timing a streamed response at handler return reported construction time, not the visitor's wait",
      "Node.js documentation — http.ServerResponse 'finish' and 'close' events mark the end of a response",
    ],
    category: "case-study",
    languages: ["node"],
  },
  {
    id: "node-remote-lookup-in-render-path",
    title: "Keep remote config and secret lookups off the per-request path",
    whenToApply:
      "A server-rendered request (Express view, Next.js server component, Remix loader, Nuxt/Nitro handler) calls out to fetch a feature flag, remote config, a secrets-manager value or a JWKS document on every render, without a process-level cache or a boot-time fetch. Fixed vendor latency is added to a page that may have no data of its own, and the vendor's outage becomes the page's outage.",
    evidence: [
      "Boosthis engineering memory (2026) — a remote lookup on every server-rendered request added fixed latency to a page with no data",
      "Google SRE Book — Addressing Cascading Failures: a synchronous dependency on the request path inherits its failure modes",
    ],
    category: "case-study",
    languages: ["node"],
  },
  {
    id: "node-shed-on-wake-stall",
    title: "Do not shed load on the stall that woke the container",
    whenToApply:
      "A load-shed or circuit-breaker valve reads event-loop lag, p95 latency or queue depth and starts refusing requests above a fixed threshold, on a host that scales to zero or recycles idle containers. A cold wake produces a large one-off stall with no work in flight, so the valve rejects the very burst that started the process and the app reports overload while completely idle.",
    evidence: [
      "Boosthis engineering memory (2026) — an idle-wake stall of roughly a quarter-second tripped a 200ms lag threshold with nothing in flight",
      "Google SRE Book — Handling Overload: shed on real queueing, not on a single unrepresentative sample",
    ],
    category: "case-study",
    languages: ["node"],
  },
  {
    id: "node-client-gone-false-positive",
    title: "Do not read req.destroyed as proof the visitor left",
    whenToApply:
      "A handler checks req.destroyed, req.aborted, res.writableEnded or a socket flag to decide whether to abandon work, skip a write or stop an upload. Those flags read true during perfectly healthy requests once the body has been consumed, so real work is thrown away and the client is told nothing; the resulting failures look like network flakiness.",
    evidence: [
      "Boosthis engineering memory (2026) — req.destroyed reads true on healthy uploads, so a 'client gone' check abandoned good requests",
      "Node.js documentation — http.IncomingMessage 'aborted'/'close': the destroyed flag reflects socket state, not visitor intent",
    ],
    category: "case-study",
    languages: ["node"],
  },
  {
    id: "node-hidden-handler-signature",
    title: "Keep handler parameter types visible to the framework",
    whenToApply:
      "A NestJS, tsoa, routing-controllers or type-driven handler is wrapped by a decorator, higher-order function or transpile step (SWC, esbuild, isolatedModules) that drops emitDecoratorMetadata or rewrites the signature. The framework can no longer see the parameter types it validates and injects from, so requests fail validation or lose dependency injection at runtime while the code still compiles.",
    evidence: [
      "Boosthis engineering memory (2026) — a decorator wrapper hid a handler's parameter types and the framework answered a validation error instead",
      "TypeScript documentation — Decorators and emitDecoratorMetadata: metadata emission depends on the compiler and is not preserved by every transpiler",
    ],
    category: "industry",
    languages: ["node"],
  },
  {
    id: "node-embedded-profiler-nondaemon-thread",
    title: "Unref or close profiling resources so shutdown can finish",
    whenToApply:
      "An in-process profiler, inspector session, metrics exporter, watcher or worker thread is started for observability (node:inspector, a Worker, a setInterval flush, a file watcher) and never unref'd, closed or terminated on shutdown. The event loop stays alive after the server closes, so SIGTERM does not end the process and the platform kills it after a timeout — losing whatever the graceful path was meant to flush.",
    evidence: [
      "Boosthis engineering memory (2026) — an in-process recording consumer on a non-daemon thread kept the application alive after shutdown",
      "Node.js documentation — timers.unref() and worker.terminate(): a referenced handle keeps the event loop alive",
    ],
    category: "operational",
    languages: ["node"],
  },
  // ─────────── Security (five concepts) — the faults AI-written apps ship most: open CORS, routes that never say who may call them, stored text rendered as markup, whole records sent back, access decided from request input ───────────
  {
    id: "node-cors-allows-any-origin",
    title: "Name the sites allowed to call your API from a browser — never reflect any origin",
    whenToApply:
      "An Express, Fastify, Koa, NestJS or Next.js server answers cross-origin requests from every site: cors() with origin: true, @fastify/cors with origin: true, app.enableCors() in NestJS with no allow-list, a Next.js route handler that sets Access-Control-Allow-Origin to whatever arrived, or a hand-written middleware that copies the request Origin header straight into the response. The dangerous form adds credentials: true, because then any page a signed-in user happens to visit can read your API with that user's own cookies. Symptom: nothing ever fails, because a CORS mistake is only visible when the policy is too strict; the site that abuses a loose one is someone else's. An API that serves only public data and never reads a cookie or session may answer every origin on purpose, and should say so in code.",
    evidence: [
      "MDN Web Docs — Cross-Origin Resource Sharing and requests with credentials",
      "Express cors middleware documentation — the origin and credentials options",
    ],
    category: "industry",
    languages: ["node"],
  },
  {
    id: "node-route-open-by-default",
    title: "Make every route require a signed-in caller unless it is named public",
    whenToApply:
      "An Express, Fastify, Koa, NestJS or Next.js server protects routes one at a time — requireAuth added to each handler by hand, a NestJS guard placed with @UseGuards on some controllers only, tRPC routers where a new procedure starts from publicProcedure, or Next.js route handlers and server actions that each read the session themselves (a middleware.ts matcher that misses a path protects nothing there, and every server action is a public POST endpoint whatever page imports it). The route nobody remembered is open: an admin export, a debug endpoint, a new mutation. Symptom: the app works and every page you test is behind sign-in, because you test through the UI; the forgotten route answers anyone who calls it directly. Distinct from node-access-check-trusts-request-input: this asks whether a route checks who is calling at all; that one asks whether an existing check decides from the verified identity.",
    evidence: [
      "OWASP Top 10 (2021) — A01 Broken Access Control, deny by default",
      "NestJS documentation — global guards registered with APP_GUARD and a public-route decorator",
    ],
    category: "industry",
    languages: ["node"],
  },
  {
    id: "node-stored-content-rendered-unescaped",
    title: "Escape stored text where it is rendered — never build HTML from it by hand",
    whenToApply:
      "A Node server renders text that users saved — a comment, a display name, a product description, a message — into HTML without escaping: a template literal or string concatenation passed to res.send, an EJS unescaped output tag, a Handlebars triple-stash, Pug's unescaped != or !{} forms, server rendering with React's dangerouslySetInnerHTML, or Markdown turned into HTML with marked or markdown-it and sent on unsanitised. The text was harmless when it was saved and runs as script for every person who later views it, with their session. Symptom: nothing looks wrong until someone saves a script tag or an onerror attribute; ordinary names and comments render perfectly. Stored content placed inside a script block as data, or into an href, needs its own encoding, not HTML escaping.",
    evidence: [
      "OWASP Cheat Sheet Series — Cross Site Scripting Prevention",
      "EJS documentation — escaped and unescaped output tags",
    ],
    category: "industry",
    languages: ["node"],
  },
  {
    id: "node-response-returns-whole-record",
    title: "Send back only the fields the caller needs — map every response through an explicit shape",
    whenToApply:
      "An Express, Fastify, Koa, NestJS or Next.js handler sends a database record straight to the client: res.json(user) with a Prisma, Drizzle, TypeORM, Sequelize or Mongoose result, a list endpoint returning whole rows, or an included relation (each comment with its author's entire user row) — so the response carries every column the table has, including the password hash, reset tokens, an email address or internal flags. Hiding fields with delete user.password, a toJSON that strips one column, or class-transformer's Exclude decorator is a deny-list, and the next column anyone adds goes out by default. Symptom: the page shows a name and an avatar while the network tab carries the whole row. This is the output half of mass assignment, which asks which fields a request may set; this one asks which fields a response sends back.",
    evidence: [
      "OWASP API Security Top 10 (2023) — API3 Broken Object Property Level Authorization",
      "Prisma documentation — select fields, and excluding fields from query results",
    ],
    category: "industry",
    languages: ["node"],
  },
  {
    id: "node-access-check-trusts-request-input",
    title: "Decide access from the verified session — never from an id or role the request carries",
    whenToApply:
      "An Express, Fastify, Koa, NestJS or Next.js server decides who may read or change a record from something the caller sent: a userId, ownerId or role read from req.body, req.query or req.params; an x-user-id or x-role header; a role kept in a cookie or local storage and sent back; a JWT read with jwt.decode, which never checks the signature; a Next.js server action or tRPC procedure that takes the acting user's id as an argument; or a lookup by id that never compares the record's owner with the signed-in user, so GET /api/invoices/:id answers for any id. Symptom: everything works when you test as yourself; change one id in the address or one field in the body and someone else's record comes back or changes. Distinct from node-route-open-by-default: that one asks whether a route checks who is calling at all; this one asks whether an existing check decides from the verified identity.",
    evidence: [
      "OWASP API Security Top 10 (2023) — API1 Broken Object Level Authorization",
      "node-jsonwebtoken documentation — jwt.verify checks the signature, jwt.decode does not",
    ],
    category: "industry",
    languages: ["node"],
  },
];

export const CHECKLIST_VERSION = "0.4.0";
export const CHECKLIST_COUNT: number = BOOSTHIS_CHECKLIST.length;

/** Look up a single entry by id. Returns undefined if not found. */
export function getChecklistEntry(id: string): BoosthisChecklistEntry | undefined {
  return BOOSTHIS_CHECKLIST.find((r) => r.id === id);
}

/** All entry ids, in declaration order. */
export function listChecklistIds(): ReadonlyArray<string> {
  return BOOSTHIS_CHECKLIST.map((r) => r.id);
}
