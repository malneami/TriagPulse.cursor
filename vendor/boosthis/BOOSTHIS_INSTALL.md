A SANDBOX PREVIEW CANNOT SHOW WHAT THIS KIT DOES: a sandboxed preview, canvas, or artifact environment cannot reach what this kit talks to. Those sandboxes have no network and no access to boosthis.com, so the kit always looks broken there — sign-in and telemetry cannot load, hand-copied icon bytes come out scrambled, and the console errors belong to the mock, not the kit. A preview, mock-up or re-implementation shown as "the Boosthis UI" describes the sandbox rather than the product. Three checks say something real: (1) a passing kit verification (verify_kit_install, or the same check over HTTPS when a tool reply is withheld) — which proves the FILES ON DISK and nothing more, never that anything is measured; (2) opening the REAL running host app, with network access, and looking at the kit's own bubble and dashboard there; and (3) asking Boosthis whether this project key has seen a check-in — the only one of the three that proves the install is finished (closing step of this guide). SANDBOX INSTALL CHECK: a blocked or unreachable package registry (registry.npmjs.org, pypi.org, proxy.golang.org, Maven Central, etc.) is almost always a sandboxed environment rather than the developer's real project. Workarounds do not change that: the install only counts in the real project (Replit, Claude Code, Cursor, or their local machine). Even there the install is unfinished until check (3), which answers from inside a sandbox too and names which of the states the project is in.

## Requirements for this kit

Read from this kit's own files; the same two sections open every Boosthis kit guide.

- **Runtime:** Node.js 24.13.0 — the lowest version this kit's own tests and proofs have run on (`scripts/live-proofs/crash-kill-modes/proof-record.json`).
  No floor is declared: the kit's package.json carries no engines entry. Nothing older than the version above has been tried, which means untested, not known to fail.
- **Platforms:** wherever Node.js runs — the kit ships as source, with no prebuilt binaries; its own tests and proofs run on Linux (x86_64).
- **What it cannot measure there:** [the runtime coverage table](https://www.boosthis.com/pricing#runtime-coverage), generated from the kits themselves, with the reason under every "Not applicable".

## Install in one command

The complete kit is one archive, `https://www.boosthis.com/api/kit/node/archive`, sent with your project key as an `Authorization: Bearer` header, and every release of it is signed. The steps save it as `boosthis-node-kit.tar.gz` with its signed release list and signature, check the signature with `ssh-keygen` against the signers file at https://www.boosthis.com/.well-known/boosthis-kit-release-keys and the archive against the list, list it (`tar -tzf`), unpack it in the project root (`tar -xzf`) and end with the check below; a failed signature check ends them there, with nothing unpacked. The dashboard Setup page prints those lines with the address filled in. If you are reading this inside the unpacked archive, only the check is left to run.

The check, from the project root:

```
sha256sum -c BOOSTHIS_CHECKSUMS.txt          # Linux
shasum -a 256 -c BOOSTHIS_CHECKSUMS.txt  # macOS
```

Windows (PowerShell):

```
$n = 0; $bad = 0; foreach ($l in (Get-Content -LiteralPath BOOSTHIS_CHECKSUMS.txt -ErrorAction Stop)) { if (-not $l) { continue }; $n++; $h, $p = $l -split '  ', 2; $f = Get-FileHash -Algorithm SHA256 -LiteralPath $p -ErrorAction SilentlyContinue; if (-not $f -or $f.Hash -ne $h) { $bad++; "FAILED: $p" } }; "$n checked, $bad failed"; if ($bad) { cmd /c exit 1 }
```

A pass is an OK line for every file but BOOSTHIS_CHECKSUMS.txt itself (PowerShell: "0 failed"); fewer lines than the kit has files, less one, is a short list checking a short kit.

**Fallback, by value.** Where no shell can fetch the archive, the same files arrive by value in this kit's files[]: every entry written to its exact path, `BOOSTHIS_CHECKSUMS.txt` at the project root included, then the check alone — `sha256sum -c BOOSTHIS_CHECKSUMS.txt` (Linux), `shasum -a 256 -c BOOSTHIS_CHECKSUMS.txt` (macOS) or the PowerShell check above (Windows) — from the project root. No Python is needed for any of it.

# Boosthis — node runtime install

Boosthis is a paid performance product with open signup. This is the **node**
runtime: it times every request an Express, Next.js, Fastify, Hono, NestJS or
plain Node server **that this project starts and keeps** answers, rates it
against a shared scoring
model, exposes the live picture as JSON, and ships a 123-rule Node performance
checklist. A project key issued from your account dashboard is what this kit
needs before it can register, report, or fetch fixes; without one it measures
in-process only. It is a workspace package (not on npm); you get it from your own Boosthis account, either as the archive you just unpacked or by value over an AI connection.

## Privacy contract

- Detection runs **entirely in-process**.
- Unregistered installs (no project key) send **nothing**.
- A registered install sends only **code-defined labels + numbers**: `METHOD
  /route` samples rated by real latency, the PII-filtered meter snapshot,
  full-stack trace spans, privacy-safe issue/fix signatures, and code-derived
  crash fingerprints — never request bodies, query values, headers, cookies,
  or source code. Every outbound payload passes the shared PII guard.
- **What the AI-call meter reads.** The one exception is the AI-call meter:
  to tell repeated prompts apart it reads up to the first 4,096 characters
  of an outbound request body to an AI provider, inside your own process,
  and reduces it immediately to a single number — no body text is stored,
  uploaded or recoverable. It happens on the way out of your app, before the
  provider answers. It is not the only bounded read this kit makes: the leak
  watch reads up to 8 KB of an ERROR response to see whether a stack trace
  is about to reach one of your users, the bubble buffers an HTML page so
  its script tag can be written into it, the cookie check reads the flags
  on the cookies you set (never the value) and matches each cookie's name
  against a fixed word list to tell a session or token cookie from a CSRF
  or preference one (the name is never kept or sent), and a fixed
  list of named headers is read for timings and cache verdicts. Every one
  of them, with its limit and what survives it, is listed at
  https://www.boosthis.com/docs/what-boosthis-collects.
  §12 says which destinations count as an AI call; whether the trade suits
  your project is your call, which is why it is stated here rather than
  only on our website.
- **How much** of that arrives is tunable: see §6 (sharing / issues-only /
  crash detail) and the settings table in §12.
- `BOOSTHIS_DISABLED=1` silences the entire runtime; `forget()` erases this
  install's server data (see §11).

## What this kit adds to your app

Decide this before you ship, not after. Two kinds of thing arrive with
an install: something your users can see, and addresses your app starts
answering.

### What your users see

- A floating bubble in the corner of the page: a score, a rating word, and a panel it opens.
- Where: Injected into HTML pages this service itself serves. Pages served by a separate frontend are a different process and get nothing.
- The floating bubble is for the app's owner only. On a live site it shows only in a browser switched on with the owner link from the project's page on Boosthis; on the machine itself, opening one of the app's pages with ?boosthis=on switches a browser on, and a request relayed through a proxy does not count as the machine itself. ?boosthis=off, or the switch-off control in the bubble, switches that browser off. No setting shows it in any other browser. BOOSTHIS_BUBBLE set to 0 hides it everywhere and the kit carries on measuring; BOOSTHIS_DISABLED stops the kit altogether. Each name is read from the environment where this runtime has one, and otherwise from a value of the same name on the host.

### What your app starts answering

- `/_boosthis` — The kit's own page: static markup that draws the panel by fetching the panel read below. Both spellings are the same page, because a developer types one or the other and neither habit should 404.
  Who can reach it: only a browser switched on with the owner link from the project's page on Boosthis, or a direct connection from the machine itself; anyone else gets your app's own answer for an address it does not know.
  What it does not contain: No measurements, no route or screen labels, no credential: every number on it arrives afterwards from the panel read.
- `/_boosthis/` — The kit's own page: static markup that draws the panel by fetching the panel read below. Both spellings are the same page, because a developer types one or the other and neither habit should 404.
  Who can reach it: only a browser switched on with the owner link from the project's page on Boosthis, or a direct connection from the machine itself; anyone else gets your app's own answer for an address it does not know.
  What it does not contain: No measurements, no route or screen labels, no credential: every number on it arrives afterwards from the panel read.
- `/_boosthis/pulse` — One coarse reading for the bubble itself: a score, a rating word, and how many samples it came from.
  Who can reach it: only a browser switched on with the owner link from the project's page on Boosthis, or a direct connection from the machine itself; anyone else gets your app's own answer for an address it does not know.
  What it does not contain: No route or screen labels, no durations, no per-route rows, no credential, nothing about a visitor.
- `/_boosthis/panel` — What the bubble's panel draws: per-meter scores, rating words, meter labels and the numeric captions beside them.
  Who can reach it: only a browser switched on with the owner link from the project's page on Boosthis, or a direct connection from the machine itself; anyone else gets your app's own answer for an address it does not know.
  What it does not contain: No route or screen labels, no URLs, no raw samples, no install token and no account credential. The account read that does carry one is local-only, below.
- `/_boosthis/account` — The sign-in context the bubble's account card needs, including the token that claims this install.
  Who can reach it: local requests only — nothing opens it remotely.
- `/_boosthis/status` — The standalone “is Boosthis working?” page — the surface a back-end service with no UI has instead of a bubble.
  Who can reach it: local requests only — nothing opens it remotely.
- `/_boosthis/dev` — This kit's detailed local view: the per-route table, learned budgets, recent samples and the “Connect your AI” card.
  Who can reach it: local requests only (your `allowRemote` opt-in can open it).
- `/_boosthis/healthz` — Whether the kit is running, as JSON.
  Who can reach it: local requests only (your `allowRemote` opt-in can open it).
- `/_boosthis/summary` — Per-route timings and ratings, as JSON.
  Who can reach it: local requests only (your `allowRemote` opt-in can open it).
- `/_boosthis/recent` — Recent individual samples, as JSON.
  Who can reach it: local requests only (your `allowRemote` opt-in can open it).
- `/_boosthis/budgets` — The budgets this app has learned per route, as JSON.
  Who can reach it: local requests only (your `allowRemote` opt-in can open it).
- `/_boosthis/connect` — The install id, a read-only token and a paste-ready AI config.
  Who can reach it: local requests only — nothing opens it remotely.

The same list for every runtime, alongside what each address returns, is
published at https://www.boosthis.com/docs/what-boosthis-adds.

## 0. Check you have the whole kit

These notes reach you two ways and read the same either way: unpacked
from the `boosthis-kit-<runtime>.tar.gz` archive you downloaded from your
Boosthis dashboard, or handed to you by value over an AI connection. Do
the check that matches what you are actually holding — one of them, not
both.

**If you unpacked an archive**, there is a `BOOSTHIS_CHECKSUMS.txt` beside this
file. From the folder you unpacked into, run:

```sh
sha256sum -c BOOSTHIS_CHECKSUMS.txt
```

On macOS without GNU coreutils, `shasum -a 256 -c BOOSTHIS_CHECKSUMS.txt` does the
same thing. Every line must end in `OK`. On Windows, the same check in
PowerShell is the line below, and a pass ends in `0 failed`:

```powershell
$n = 0; $bad = 0; foreach ($l in (Get-Content -LiteralPath BOOSTHIS_CHECKSUMS.txt -ErrorAction Stop)) { if (-not $l) { continue }; $n++; $h, $p = $l -split '  ', 2; $f = Get-FileHash -Algorithm SHA256 -LiteralPath $p -ErrorAction SilentlyContinue; if (-not $f -or $f.Hash -ne $h) { $bad++; "FAILED: $p" } }; "$n checked, $bad failed"; if ($bad) { cmd /c exit 1 }
```

That is the whole check: it needs no network, no account and no Boosthis
tooling. If a line fails, or the checksum file is not there, the download
was incomplete — fetch the archive again and unpack it into a clean folder.

**If you received a `files[]` array instead**, compare its length with the
`file_count` the same payload carries. A shorter array means the transport
truncated it: write nothing, and fetch the complete kit from
`kit_download_url` instead.

## 1. Add the files & make the packages resolvable

Write every file at its **exact** `path` from the project root, **byte-for-byte**. Reformatting, renaming, reorganizing, merging, splitting or 'improving' a kit file changes its sha256, and so does a run of a formatter or linter: the verify check reports the result as `modified`.

The kit carries TWO packages — write both at their exact paths:

- `lib/boosthis-runtime-node/` — the runtime.
- `lib/boosthis-checklist/` — its rule-data dependency (the 123 Node rules).

The runtime depends on the bundled checklist beside it via a relative file
reference already written in its package.json; never edit those kit bytes.
`express` is an **optional peer**: the Express recipe runs on an Express app,
which already provides it, and an app wired with `attach()` does not need it
at all. The kit ships **TypeScript source**, so your
project must run or compile TS (tsx / ts-node / your bundler / tsc).

- **Workspace repo:** add `"@workspace/boosthis-runtime-node": "workspace:*"`
  to the consuming app's `package.json`. Both packages resolve through the workspace globs, so `lib/*` has to be among them for the install to find anything.
- **Plain app:** add
  `"@workspace/boosthis-runtime-node": "file:./lib/boosthis-runtime-node"`
  and `"boosthis-checklist": "file:./lib/boosthis-checklist"`, then install.

Pick the branch by detection: a `workspaces` field / `pnpm-workspace.yaml`
means workspace repo; otherwise it is a plain app.

## 1b. Verify before wiring

A kit file that is not byte-perfect on disk produces wiring that looks
installed and measures nothing, so this check belongs before any change to
the build or app code. Either route below is a complete check on its own,
and at least one of them works in every environment.

**From the unpacked archive — offline, no account needed:**

```sh
sha256sum -c BOOSTHIS_CHECKSUMS.txt
```

`BOOSTHIS_CHECKSUMS.txt` lists every other file the archive carries, so a
run with no `FAILED` and no missing-file line is a complete pass. If it
names a file, unpack the archive over the same folder again and re-run it.
(macOS without GNU coreutils: `shasum -a 256 -c BOOSTHIS_CHECKSUMS.txt`.) On Windows, the
same check in PowerShell is the line below, and a pass ends in `0 failed`:

```powershell
$n = 0; $bad = 0; foreach ($l in (Get-Content -LiteralPath BOOSTHIS_CHECKSUMS.txt -ErrorAction Stop)) { if (-not $l) { continue }; $n++; $h, $p = $l -split '  ', 2; $f = Get-FileHash -Algorithm SHA256 -LiteralPath $p -ErrorAction SilentlyContinue; if (-not $f -or $f.Hash -ne $h) { $bad++; "FAILED: $p" } }; "$n checked, $bad failed"; if ($bad) { cmd /c exit 1 }
```

**Over an AI connection, where there is one:** the `verify_kit_install`
tool takes the sha256 of each written file as
`{ runtime:"node", files:[{path,sha256},…] }`, and the same JSON POSTed to
`https://www.boosthis.com/api/kit/node/verify` answers identically. Only a `pass` verdict
says the files are the ones this server shipped. A `fail` names the exact
files in `missing` / `modified`; rewritten from the kit, they verify.

## 2. Wire it once, at startup

Name two things before writing any wiring: the server this project runs, and
**which host** it is deployed to. A Node process the project **starts and
keeps** is one answer; **Vercel Functions** and **AWS Lambda** are two more.
The last two columns are function hosts with no path: one the kit can name,
where it stops before registering, and one it cannot recognise at all, where
nothing stops it and the install reports almost nothing. For some pairs —
Next.js on Vercel among them — the answer is that there is no path. This
table is the whole answer:

| Framework | A Node server you start and keep | Vercel Functions | AWS Lambda | A function host the kit names but has not proven | A function host the kit cannot recognise |
|---|---|---|---|---|---|
| Express | **Proven on a real run.** `app.use(boosthis())` before your routes. | **Proven against this host's contract, not on a deployment.** The same middleware, unchanged. | **Proven against this host's contract, not on a deployment.** The same middleware, unchanged. | **The kit refuses to start.** The kit names the host and stops before it registers. | **No path, and no refusal either.** Nothing stops the install: the kit reads no marker, starts as if on an ordinary Node server, and loses what it gathers when the invocation freezes. |
| Next.js | **Proven on a real run.** `attach()` in the custom server file, before `createServer(...)`. | **No path.** No custom server file to put `attach()` in, and a route handler is not a bare handler. | **No path.** The adapter hands the framework the request; no server of yours, and no bare handler. | **The kit refuses to start.** The kit names the host and stops before it registers. | **No path, and no refusal either.** Nothing stops the install: the kit reads no marker, starts as if on an ordinary Node server, and loses what it gathers when the invocation freezes. |
| Fastify | **Proven on a real run.** `attach()` before the Fastify instance is created. | **No path.** The adapter hands the framework the request; no server of yours, and no bare handler. | **No path.** The adapter hands the framework the request; no server of yours, and no bare handler. | **The kit refuses to start.** The kit names the host and stops before it registers. | **No path, and no refusal either.** Nothing stops the install: the kit reads no marker, starts as if on an ordinary Node server, and loses what it gathers when the invocation freezes. |
| Hono | **Proven on a real run.** `attach({ serverKind: "hono" })` before `serve()`, on the Node adapter. | **No path.** The adapter hands the framework the request; no server of yours, and no bare handler. | **No path.** The adapter hands the framework the request; no server of yours, and no bare handler. | **The kit refuses to start.** The kit names the host and stops before it registers. | **No path, and no refusal either.** Nothing stops the install: the kit reads no marker, starts as if on an ordinary Node server, and loses what it gathers when the invocation freezes. |
| NestJS | **Proven on a real run.** `attach()` before `NestFactory.create(...)`, on either adapter. | **No path.** The adapter hands the framework the request; no server of yours, and no bare handler. | **No path.** The adapter hands the framework the request; no server of yours, and no bare handler. | **The kit refuses to start.** The kit names the host and stops before it registers. | **No path, and no refusal either.** Nothing stops the install: the kit reads no marker, starts as if on an ordinary Node server, and loses what it gathers when the invocation freezes. |
| Plain Node server | **Proven on a real run.** `attach()` before `createServer(...)`. | **Proven against this host's contract, not on a deployment.** Wrap the exported handler in `withBoosthis()`. | **Proven against this host's contract, not on a deployment.** Wrap the exported handler in `withBoosthis()`. | **The kit refuses to start.** The kit names the host and stops before it registers. | **No path, and no refusal either.** Nothing stops the install: the kit reads no marker, starts as if on an ordinary Node server, and loses what it gathers when the invocation freezes. |
| Remix | **No recipe of its own.** The Plain Node server line, where the app ends in one — with no run of our own on this framework. | **No path.** The adapter hands the framework the request; no server of yours, and no bare handler. | **No path.** The adapter hands the framework the request; no server of yours, and no bare handler. | **The kit refuses to start.** The kit names the host and stops before it registers. | **No path, and no refusal either.** Nothing stops the install: the kit reads no marker, starts as if on an ordinary Node server, and loses what it gathers when the invocation freezes. |
| SvelteKit | **No recipe of its own.** The Plain Node server line, where the app ends in one — with no run of our own on this framework. | **No path.** The adapter hands the framework the request; no server of yours, and no bare handler. | **No path.** The adapter hands the framework the request; no server of yours, and no bare handler. | **The kit refuses to start.** The kit names the host and stops before it registers. | **No path, and no refusal either.** Nothing stops the install: the kit reads no marker, starts as if on an ordinary Node server, and loses what it gathers when the invocation freezes. |
| Nuxt | **No recipe of its own.** The Plain Node server line, where the app ends in one — with no run of our own on this framework. | **No path.** The adapter hands the framework the request; no server of yours, and no bare handler. | **No path.** The adapter hands the framework the request; no server of yours, and no bare handler. | **The kit refuses to start.** The kit names the host and stops before it registers. | **No path, and no refusal either.** Nothing stops the install: the kit reads no marker, starts as if on an ordinary Node server, and loses what it gathers when the invocation freezes. |
| Astro | **No recipe of its own.** The Plain Node server line, where the app ends in one — with no run of our own on this framework. | **No path.** The adapter hands the framework the request; no server of yours, and no bare handler. | **No path.** The adapter hands the framework the request; no server of yours, and no bare handler. | **The kit refuses to start.** The kit names the host and stops before it registers. | **No path, and no refusal either.** Nothing stops the install: the kit reads no marker, starts as if on an ordinary Node server, and loses what it gathers when the invocation freezes. |

Every cell was earned, or refused, for that exact pair — the framework, the host and the wiring together. Nothing carries across from the column beside it.

**Proven on a real run** means an app of that kind was started and driven on that host and the measurements arrived. **Proven against this host's contract** means the host's published contract — its environment markers, its handler signature, its freeze on response — was reproduced here against the shipped kit: we hold no account on Vercel or AWS and have never published to either, so those cells are not a run on a deployment of yours or of ours.

**No custom server file, and a route handler is not a bare handler.**

No path for Next.js on Vercel Functions. Vercel never runs a custom server file, so the Next.js recipe has no file to go in — and a Next.js route handler or page is not the bare `(event, context)` handler `withBoosthis()` wraps, so there is nowhere to send from before the invocation freezes. Next's own `instrumentation.ts` hook does run early enough to patch the server in a Next app you host yourself, but on Vercel each route is served by the platform's own runtime, which we cannot get inside and have never recorded. Unsupported rather than untested: `docs/decisions/next-on-vercel.md` says what would reopen it.

**The adapter owns the request, and the kit is not inside it.**

No path for Fastify, Hono, NestJS, Remix, SvelteKit, Nuxt and Astro on Vercel Functions; no path for Next.js, Fastify, Hono, NestJS, Remix, SvelteKit, Nuxt and Astro on AWS Lambda. On a function host each of these is deployed through an adapter that hands the framework a request with no Node server of yours in the process, so there is nothing for `attach()` to watch — and their route handlers are not the bare `(event, context)` handler `withBoosthis()` wraps, so there is nowhere to send from before the invocation freezes. We have never recorded a run of any of these combinations.

**The kit refuses a function host it can name but has not proven.**

The kit refuses to start for every framework above on a function host the kit names but has not proven — exactly Netlify Functions, Google Cloud Functions and Azure Functions today, the function hosts the kit's own detection can name and has not been proven on. It names the host, prints why, and stops: nothing registers, nothing is measured, and no dashboard shows a project that looks measured and is not. That is the kit's own behaviour and it is recorded (`scripts/live-proofs/serverless-invocation`, arm `unproven-platform-refused`), not advice — following the Express or bare-handler recipe on such a host changes nothing, because the refusal happens before either of them can report. This list is the whole of the refusal: a host not on it is the next column, not this one.

**A host the kit cannot name does not get refused — it gets misread.**

No path, and no refusal either, for every framework above on a function host the kit cannot recognise. Detection reads the host's own environment markers, so the only function hosts it knows of are the ones it has markers for: Vercel Functions and AWS Lambda, which it runs on, and Netlify Functions, Google Cloud Functions and Azure Functions, which it refuses. Anywhere else there is nothing to read: the kit sees an ordinary Node process, does NOT refuse, starts, registers and then loses almost everything it gathers when the invocation freezes — the silent half-measured install this whole table exists to prevent. An unrecognised function host is unsupported even though nothing stops the kit from starting there. Setting `BOOSTHIS_SERVERLESS=1` tells the kit what it cannot detect, and it then refuses by the same path as the column before this one; it is a way to make the kit stop, not a way to make it work.

Where a cell is not **Proven**, these are the ways out:

- Run the app as a Node server you start yourself — any host that runs `node …` and keeps the process (a container or VM host: Cloud Run, Render, Fly.io, Railway, your own machine). Where the table above says proven on a real run, that framework's own recipe then applies unchanged. For Remix, SvelteKit, Nuxt and Astro it does not: the table gives them no recipe of its own, so what applies is the generic Plain Node server line, and we have never run those frameworks ourselves. What it does not cover: anything you leave behind on the function host stays unmeasured, this is a hosting change rather than a setting, and where the table gives a framework no recipe of its own you are getting the plain-Node line, not an answer anybody has taken on that framework.
- Measure the browser half instead, with the Boosthis browser kit: it is a tag on the page and does not care who hosts the app, Vercel included. What it does not cover: the server side. No per-request timings for your routes, no database or queue work, no background jobs, and nothing that never reaches a browser.
- Where the kit refused the host outright: ask us to prove it — support@boosthis.com, naming the host. What it does not cover: nothing changes while you wait. The kit stays switched off there, the app runs exactly as it did before, and we will not switch it on until a recorded run on that host shows the measurements really arrive.
- Where the kit did not recognise the host: set `BOOSTHIS_SERVERLESS=1` in that environment. The kit then refuses to start there, exactly as it does on a function host it can name, instead of registering an install that reports almost nothing. What it does not cover: it does not make the host work — it makes the kit stop, so nothing measured is the answer you see rather than the answer you discover a month later.

The recipes below are for a server the project starts and keeps. Every one of
them was verified in a real running app of that kind — started for real,
driven with traffic, and confirmed to report per-request timings. For a
framework that is not listed, use **Plain Node server** where the app ends in
a Node `http` server this process starts. Improvised glue is how a project ends up registered, showing a panel, and measuring nothing at all.

`attach()` and `enableTelemetry()` go in the same startup file in either
order, but `attach()` must run **before the server is created** — it cannot
see a server that already exists.

### Express

In the file that builds the Express app, before the routes are registered:

```ts
import { boosthis, mount, enableTelemetry } from "@workspace/boosthis-runtime-node";

app.use(boosthis({ bubble: true })); // before your routes
mount(app);                          // in-app page at /_boosthis

enableTelemetry({
  installId: "<a stable UUID v4 generated ONCE and reused>",
  inviteKey: process.env.BOOSTHIS_INVITE_KEY,
  endpoint: "https://www.boosthis.com/api",
  appName: "My Service",
});
```

Unchanged. An Express project that is already wired this way needs no edit — `attach()` is for projects that are not Express, and an Express app may use either. `mount(app)` is the optional second line: the middleware alone serves the status page and the badge reads, and mounting adds the in-app page at /_boosthis plus the local JSON reads. Leave it out and those addresses say so themselves rather than falling through to your own 404.

### Next.js

In the custom server file that creates the Node server, before the server is created (a Next app without a custom server file needs one — the standard `createServer` + `getRequestHandler()` file from the Next docs):

```ts
import { attach, enableTelemetry } from "@workspace/boosthis-runtime-node";

attach(); // before the server is created

enableTelemetry({
  installId: "<a stable UUID v4 generated ONCE and reused>",
  inviteKey: process.env.BOOSTHIS_INVITE_KEY,
  endpoint: "https://www.boosthis.com/api",
  appName: "My Service",
});
```

Node runtime only. Routes running on the edge runtime are a different runtime with no Node server in it, and the kit says so instead of pretending: it refuses to attach and names the reason at startup.

### Fastify

In the entry file, before the Fastify instance is created:

```ts
import { attach, enableTelemetry } from "@workspace/boosthis-runtime-node";

attach(); // before Fastify is created

enableTelemetry({
  installId: "<a stable UUID v4 generated ONCE and reused>",
  inviteKey: process.env.BOOSTHIS_INVITE_KEY,
  endpoint: "https://www.boosthis.com/api",
  appName: "My Service",
});
```

No Fastify plugin to register, and no change to the app's own hooks.

### Hono (Node adapter)

In the entry file, before `serve()` is called:

```ts
import { attach, enableTelemetry } from "@workspace/boosthis-runtime-node";

attach({ serverKind: "hono" }); // before serve()

enableTelemetry({
  installId: "<a stable UUID v4 generated ONCE and reused>",
  inviteKey: process.env.BOOSTHIS_INVITE_KEY,
  endpoint: "https://www.boosthis.com/api",
  appName: "My Service",
});
```

Pass `serverKind: "hono"` exactly as shown. Hono is the one setup the kit cannot name by itself, and the name is only a label on the project page — the measurements do not depend on it, but without the hint the page would call a Hono app a plain Node server.

### NestJS

In the bootstrap file, before `NestFactory.create(...)`:

```ts
import { attach, enableTelemetry } from "@workspace/boosthis-runtime-node";

attach(); // before NestFactory.create()

enableTelemetry({
  installId: "<a stable UUID v4 generated ONCE and reused>",
  inviteKey: process.env.BOOSTHIS_INVITE_KEY,
  endpoint: "https://www.boosthis.com/api",
  appName: "My Service",
});
```

Works on either Nest adapter (Express or Fastify) and needs no Nest middleware, interceptor or module.

### Plain Node server

In the entry file, before `createServer(...)`:

```ts
import { attach, enableTelemetry } from "@workspace/boosthis-runtime-node";

attach(); // before createServer()

enableTelemetry({
  installId: "<a stable UUID v4 generated ONCE and reused>",
  inviteKey: process.env.BOOSTHIS_INVITE_KEY,
  endpoint: "https://www.boosthis.com/api",
  appName: "My Service",
});
```

This is also the answer for any framework not named above: anything that ends in a Node server is measured. It is named `node-http` on the project page because the kit will not claim to recognise a framework it cannot see.


### A function, not a server

Vercel Functions and AWS Lambda are recognised automatically — but recognition is not wiring, and they are the only function hosts the kit runs on at all. What earns them that word is the host's published contract — its environment markers, its handler signature, its freeze on response — reproduced here against the shipped kit: we hold no account on either host and have never published to one, so no claim here is a run on a deployment. On Netlify Functions, Google Cloud Functions and Azure Functions the kit names the host and stops before registering, rather than draw a panel over nothing. On a function host it has no marker for it cannot tell at all: nothing refuses, the kit starts as if this were an ordinary Node server, and almost everything it gathers dies with the invocation — set `BOOSTHIS_SERVERLESS=1` to make it stop instead. A function is frozen the moment it answers, so even on the two recognised hosts the kit can only measure code it is already inside: an Express app's `boosthis()` middleware, or a bare handler wrapped with `withBoosthis()`. A framework that owns the request itself — a Next.js route handler or page, or the serverless adapter of Remix, SvelteKit, Nuxt or Astro — gives neither of those anywhere to sit, and has no path on either. The table above says which is which, per framework and per host.

Anything shaped `export const handler = ...` has no server for the recipes
above to hook. Wrap the exported handler as well:

```ts
import { withBoosthis } from "@workspace/boosthis-runtime-node";

export const handler = withBoosthis(async (event, context) => {
  // your handler, untouched
  return { statusCode: 200, body: "ok" };
});
```

A function host freezes the invocation the moment the response completes, so
anything not yet sent is lost. The wrapper finishes the send inside the
invocation — through the platform's own after-response mechanism where one
exists (Vercel), otherwise by holding the response for a bounded moment. It
is also the only place any of these hosts states the function's time limit,
so wrapping is what makes the timeout-headroom reading possible; without it
that reading abstains rather than guessing.

An **Express** app on either proven host needs no wrapper: `boosthis()`
already sits on the request boundary and holds the response until the send
has finished.

On a function host the kit can NAME but has not proven, neither wiring is
worth writing: it names the host and stops at startup, before the middleware
or the wrapper could report anything. The answer there is a door out of the
table above, not a different line of code.

On a function host the kit has no marker for, nothing refuses — detection
reads the host's own environment variables, and there is nothing there to
read. It starts as if this were an ordinary Node server, registers, and then
loses almost everything it gathered when the invocation freezes. Set
`BOOSTHIS_SERVERLESS=1` in that environment and it refuses by the same path
instead: that switches the kit off, it does not make the host work.

The floating bubble is for the app's owner only, not decoration: it is where
the owner signs in, sets telemetry, and accepts terms, in a browser they
switched on with the owner link from the project's page on Boosthis, or with `?boosthis=on` on the machine itself; no other
browser draws it. On Express keep `bubble: true`; `attach()` injects it by
default. A settings entry is an extra and does not replace it.

Generate `installId` once and reuse the same value forever — it identifies
this service across restarts. Keep the project key in an env var.
Never change that first-installed value. A new value does not repair a
connection: it registers a SECOND device under the same project and leaves
the real one as a duplicate; fix the project key and use the dashboard's
Repair instead.
If this codebase already reports under another project key, set `BOOSTHIS_PROJECT_KEY_NODE`.

## 3. The project key

One `bk_...` project key both **registers** this app and **fetches fixes**. It
cannot mint other keys, so it is safe to keep in the app config. If your AI
connected over the hosted MCP, the key was handed to it automatically; check
the kit response's `invite_key` field. With no key, skip `inviteKey` and the
app stays 100% on-device. Leaving the key out means the app measures itself
on the device and will NEVER appear on the Boosthis dashboard, so an absent
key can never be treated as a finished install.

## 4. Verify

### Is Boosthis running? Read the badge, then the startup line

Boosthis draws a small badge in the corner of any HTML page this service
serves, the moment it starts — before it reads the project key and before it
tries to register. A badge therefore appears even when the key is wrong.

- **Badge on the page = the kit is running.** Read the badge; it says what it
  is doing.
- **No badge where one can appear = the kit was never switched on.** A badge can appear only in a browser the app's owner switched on with the owner link from the project's page on Boosthis, or with `?boosthis=on` on the machine itself; anywhere else, no badge says nothing about the kit. In a switched-on browser with `BOOSTHIS_BUBBLE` set to 0, that setting is the reason no badge shows. The key, the network
  and the preview are all irrelevant until a badge appears. (A JSON-only API
  has no page to draw on — for those, the startup line below IS the badge.)

The kit also says one line the moment it starts, and that line is the anchor
for every diagnosis:

```
[boosthis] Boosthis starting: project key ...1a2b. Registering next.
```

No line means the kit never started, whatever anyone believes. It is never
silenced by a quiet mode, a privacy setting or a hidden badge.

**Step 1, before anything else: find that line.** The server log either shows a line beginning "[boosthis] Boosthis starting:" or it does not. Quoted exactly as printed — including the four characters of the key it names — that line settles what the kit is configured with; paraphrased, or recalled from memory, it settles nothing, and every other explanation (the key, the network, a sandbox, a preview pane) is guesswork while it is unread.

**Step 2.** Start the server and hit a couple of routes, then open `/_boosthis` —
the in-app page every Boosthis kit serves, showing the live score, every
meter, and a plain statement when the kit has not registered or sharing is
off. This kit's detailed local view (per-route table, learned budgets,
recent samples, the Connect your AI card) is at `/_boosthis/dev` and stays
localhost-only. Or GET `/_boosthis/summary` (JSON).

For a service with **no UI at all** — a pure API, where the floating bubble
has nowhere to appear — open the status page in a browser on the same
machine:

```
http://localhost:<your port>/_boosthis/status
```

That page is the fastest answer to "is Boosthis working?". It is served by
the kit on YOUR app's own port and rendered on the server (no scripts, no
fetches), so it answers even when nothing else does. It shows the install
ID, whether this app registered, whether sharing is on, the telemetry mode,
when the last upload was accepted, how many requests have been measured, the
kit version, and a link to the dashboard — and when nothing is being sent it
says why. It works with `app.use(boosthis())` alone (`mount(app)` is not
required) and with `attach()` on any other Node server.

The page is **local-only**: it is served only to requests whose real TCP
peer is loopback and that carry no proxy/forwarding headers, exactly like
`/_boosthis/account`. A remote caller gets 403 and learns nothing. It shows
no credential — the install token is never rendered there. `allowRemote`
does not open it.

**What `mount(app)` adds, and what happens without it.** The middleware
serves three paths itself — the status page and the two badge reads
(`/_boosthis/pulse`, `/_boosthis/panel`) — so the bubble and the status page
work with `app.use(boosthis())` alone. `mount(app)` registers the rest: the
in-app page at `/_boosthis` and the local reads `/dev`, `/healthz`,
`/summary`, `/recent`, `/budgets`, `/connect`, `/account`. Without it those
addresses answer with the kit's own short page — installed, measuring, this
surface needs the mount call, status page here — never the host's bare 404,
which would look exactly like no kit at all. `attach()` serves every one of
them with no mount call.

For a registered app the first request flips it from "connected,
awaiting telemetry" to reporting in the maintainer's dashboard. Confirm the
`/installs/consent` call returns 200.

### Troubleshooting: consent returns 400 `invalid_install_id`

If `/installs/consent` answers **400** with
`{"error":"invalid_install_id"}` (`install_id must be a UUID v4`), the
install ID this app registered with is not a UUID, so the install will never
appear in the dashboard. The kit prints a one-time warning and the floating
bubble shows "Registration rejected — install ID must be a UUID" instead of
looking connected. It does **not** retry: an unchanged bad ID can never be
accepted.

Fix it by minting a real UUID v4 once — `uuidgen` on macOS/Linux, `powershell -Command "[guid]::NewGuid()"` on Windows, `crypto.randomUUID()`, or
`python3 -c 'import uuid;print(uuid.uuid4())'` — persisting that exact value
(env var / config / database), passing it as `installId`, and restarting so
the app registers again. An invented non-UUID "stable id" such as `my-app-prod` is rejected by the server: no other shape is accepted.

## 5. (Optional) local rule-book MCP server

The kit ships a local stdio MCP server exposing the 123-rule Node checklist and
live-read tools. Run it with:

```sh
pnpm --filter @workspace/boosthis-runtime-node run mcp
```

Point your AI tool's MCP config at that command to browse rules and (with
`BOOSTHIS_INSTALL_ID` + `BOOSTHIS_READ_TOKEN`) read this app's live meter.

## 6. How much data leaves — sharing, issues-only, crash detail

The default for a registered app is **full telemetry**: privacy-safe
`METHOD /route` samples, the PII-filtered meter **snapshot** (the whole meter
page), and full-stack trace **spans** all upload. Three optional fields on
`enableTelemetry({ … })` change *how much* arrives — each with **no error** if
you get it wrong, just more or less data:

```ts
enableTelemetry({
  installId: "<stable UUID v4>",
  inviteKey: process.env.BOOSTHIS_INVITE_KEY,
  issuesOnly: true,        // ship only privacy-safe issue + fix signals
  shareMeterWithAI: true,  // in issuesOnly mode, ALSO mirror the snapshot/spans
  crashDetails: true,      // add a scrubbed message line + sanitized frames
});
```

- **`issuesOnly?: boolean`** (default `false`). When `true`, the client
  auto-submits privacy-safe issue signatures + fix resolutions ONLY — never
  per-route samples: `transmit()` becomes a no-op and full samples are never
  queued.
- **`shareMeterWithAI?: boolean`** (default `false`) — the **full-sharing /
  consent opt-in**. In full mode the snapshot + spans ship anyway, so this
  flag only matters in `issuesOnly` mode, where it (or the dashboard directive
  below) is the ONLY thing that lets the screen-bearing snapshot and trace
  spans leave the process. It never enables the raw per-route sampler.
- **`crashDetails?: boolean`** (default `false`). When `true`, uploaded crash
  fingerprints additionally carry a PII-scrubbed first message line and
  sanitized stack frames (function + file basename + line/col). Crash
  reporting itself is ALWAYS-ON for a registered app either way (see below).

**Precedence — passing `shareMeterWithAI: false` does NOT switch sharing off.**
The snapshot/span gate is an OR of: full mode, OR the explicit
`shareMeterWithAI` argument, OR a **persisted dashboard directive** the server
sends once the developer connects an AI (or turns on "Full telemetry") from
the web dashboard. A dashboard grant wins over an in-code `false`. The ONLY
things that stop these uploads outright are `disable()`, `forget()`, and the
`BOOSTHIS_DISABLED` kill-switch (see below) — they beat any directive.

**Always-on channels.** Privacy-safe issue signatures, fix resolutions, and
crash fingerprints are always-on for any **registered** app (an install that
obtained a delete token). They are NOT gated by `disable()`/`enable()` or by
`issuesOnly`; only `BOOSTHIS_DISABLED` or `forget()` stop them.

## 7. Full-stack traces — join separate services into ONE trace

The kit adopts (or mints) a trace id per request, on either wiring (the
Express middleware or `attach()`), exposes it as
`req.boosthisTraceId`, and echoes it in the response header. To make a
downstream hop (another Node service, a Python worker) join the SAME trace
instead of starting its own, forward the trace headers on every outbound
call:

```ts
import { forwardTraceHeaders } from "@workspace/boosthis-runtime-node";

app.get("/checkout", async (req, res) => {
  const r = await fetch(WORKER_URL, { headers: forwardTraceHeaders(req) });
  res.json(await r.json());
});
```

`forwardTraceHeaders(req)` returns a header map (the trace id + a relative
elapsed-ms offset) for the next hop. Without it each service traces itself in
isolation and the waterfall never links up — a silent gap, not an error.
The example is an Express handler; on a plain http server, pass the `req`
your request handler receives in the same way.
Related helpers: `getTraceId(req)`, `traceHeaders(id?)`, `adoptTraceId(value)`.

## 8. Measure non-HTTP work (background jobs, queues, CLI, MCP tools)

The kit times the HTTP requests this process serves, through the Express
middleware or through `attach()` on any other Node server. Anything that is
not an HTTP request in this process is invisible until you wrap it:

```ts
import { trackPerf, perf, mcpTool } from "@workspace/boosthis-runtime-node";

// Wrap a function so its latency lands in the sample buffer:
const processOrder = trackPerf("processOrder", async (id) => { /* … */ });

// Or time an ad-hoc scope inline:
await perf("syncInventory", async () => { /* … */ });

// Time one stdio MCP tool handler (HTTP MCP is auto-labelled):
server.setToolHandler("search", mcpTool("search", async (args) => { /* … */ }));
```

Labels are developer-authored code identifiers (`processOrder`), never user
input: any label that looks PII-shaped (whitespace, UUID, long id, email) is
silently dropped rather than recorded.

## 8b. Report a scheduled job so a missed run is noticed

Timing a job says how long it took. It does not say the job was SUPPOSED to
run. Report each run of scheduled work and Boosthis can warn when an expected
run never arrives — the most common way a working app quietly stops working:

```ts
import {
  trackJob,
  reportJobRun,
  flushJobRunsNow,
} from "@workspace/boosthis-runtime-node";

// Wrap the work — sync or async. Your return value and your errors pass
// through untouched; a job that throws is reported as a run that failed.
await trackJob("nightly-billing", async () => { /* … */ });

// Or report a run you timed yourself (finishedAt defaults to now):
reportJobRun({ job: "queue-drain", durationMs: 812, ok: true });
```

- Job names are developer-authored labels (`nightly-billing`), clamped to 80
  characters and screened like every other label: a name built out of a value
  (an id, an email, a UUID) is dropped rather than recorded.
- Only the name, that it ran, whether it succeeded, and how long it took is
  sent. Nothing about the job's arguments, payload, or data is collected.
- Runs are batched and shipped about every 30s. In a process that exits right
  after the job, `await flushJobRunsNow()` before exit (it returns the number
  of runs accepted, and 0 when there is nothing to send).
- Best-effort by design: an unregistered app, the kill-switch, or a failed
  send is silent and never delays or fails the job.
- A warning needs an expectation. On the project page, say how often each job
  should run and how late is too late; until then the job simply shows its
  runs. Boosthis only blames a job while it can still hear the app.

## 9. Flush before a short-lived process exits

Samples, spans, and the snapshot are batched on a timer. A server that runs
forever ships them on cadence, but a **short-lived process** (a CLI, a cron
job, a serverless invocation) can exit with everything still queued — and
nothing arrives, with no error. Flush explicitly before you exit:

```ts
import {
  reportNow,             // drain pending per-route samples + findings
  flushSpansNow,         // ship buffered trace spans now
  uploadPerfSnapshotNow, // upload one meter snapshot now
} from "@workspace/boosthis-runtime-node";

await reportNow();
await flushSpansNow();          // Promise<number> — spans accepted
await uploadPerfSnapshotNow();  // Promise<number> — 1 on success
```

Each flush still obeys every gate above: an unregistered app, a disabled
client, or the kill-switch makes them no-ops (they return 0), so flushing is
always safe to call.

## 10. Diagnose an empty dashboard

If the maintainer's dashboard stays empty, the app is silent for one of a few
code-checkable reasons. Read them directly instead of guessing:

```ts
import {
  getRegistrationRejection, // "install-id-not-uuid" | null
  getEntitlementStatus,     // "active" | "revoked" | "unpaid" | "tampered" | "paused"
  getEntitlementMessage,    // human-readable reason, or null
} from "@workspace/boosthis-runtime-node";

const client = enableTelemetry({ /* … */ });
console.log({
  enabled: client.enabled,                 // false ⇒ disable()/kill-switch, or not registered
  readToken: client.readToken,             // null until consent issued one
  rejection: getRegistrationRejection(),   // non-null ⇒ installId was not a UUID
  entitlement: getEntitlementStatus(),     // non-"active" ⇒ project locked (see message)
  entitlementMessage: getEntitlementMessage(),
});
```

Checklist for a silent install:

1. **Not registered** — no `inviteKey` was passed, so the app is on-device
   only and sends nothing. Expected when you skipped the project key.
2. **`getRegistrationRejection() === "install-id-not-uuid"`** — the
   `installId` is not a UUID v4; the server rejects it and the kit does NOT
   retry. Mint a real UUID and restart (see §4).
3. **`client.enabled === false`** — `disable()` was called, or
   `BOOSTHIS_DISABLED` is set. Full samples/snapshots/spans are paused.
4. **`getEntitlementStatus() !== "active"`** — the project is revoked,
   unpaid, paused, or flagged; `getEntitlementMessage()` explains it. Resolve
   it on the Boosthis dashboard.
5. **No traffic yet** — a registered app only reports once real requests are
   handled (see §4). Hit a couple of routes.

The `boosthis({ bubble: true })` panel surfaces these same states visually,
and so does `http://localhost:<your port>/_boosthis/status` — use the status
page when this service has no UI to put the bubble on (see §4).

**When the project is locked.** The kit asks Boosthis whether this project
is active. Any other answer (unpaid, revoked or paused, for example) locks
it at once: it stops measuring and sending, takes its hooks off and throws
away what it held, and your app answers as it would without the kit. Its
local pages, its reads and the tools of its AI connection show only the
renew notice, to the same people as before. An active answer brings it
back; with no answer at all, the last active answer holds for at most seven
days. A project that stays locked past its owner's delay is dissolved: the
kit erases what it stored on this machine about your app, except its
install id, takes itself out of your app and asks again only after a
restart. Nothing is erased on Boosthis, so the project's history is kept.
Both states survive a restart. A copy installed before this behaviour
arrived keeps its old behaviour until the kit is updated.

## 11. Remove / uninstall

BEFORE YOU START — do not remove the Boosthis connection from your AI tool
until removal is confirmed. The erase step runs over that connection while
this app still holds its own delete credential, so if the connection goes
first there is nothing left to erase this app's data on the Boosthis server
and nothing left to check whether it was erased — the owner is left with an
open question instead of an answer. Take the Boosthis connection out LAST,
after the erase step has run.

IF THE CONNECTION WAS ALREADY REMOVED FIRST — nothing is lost and no support
ticket is needed, because removing it never told Boosthis anything. Add the
Boosthis connection back with the same project key, put the erase call back
if the wiring was already stripped, run it once, then confirm. To confirm at
any time, sign in at https://www.boosthis.com/dashboard and read the Data
erasure list: it shows every erase Boosthis actually carried out, with the
date, and says plainly when no erase ever arrived for a project instead of
presenting silence as gone.

To stop reporting and erase this install's data:

- **Silence the whole runtime, keep the code:** set `BOOSTHIS_DISABLED=1`.
  Every channel (samples, snapshot, spans, issues, fixes, crashes) goes quiet
  while the code stays wired.
- **Erase this install:** `await client.forget()` — wipes local state (the
  persisted delete/read tokens on disk included) and asks the server to delete
  this install's uploaded data. Returns a number; best-effort, never throws.
- **Uninstall entirely:** remove the `boosthis()` / `mount()` /
  `enableTelemetry()` calls and drop the `@workspace/boosthis-runtime-node`
  and `boosthis-checklist` dependencies. Nothing Boosthis-shaped is left
  running.

`client.disable()` pauses only the optional full samples/snapshot/spans;
issue + fix + crash signals stay on until `forget()` or `BOOSTHIS_DISABLED`.

## 12. Settings & environment variables

Every setting a Node install honours. Code arguments to `enableTelemetry()` /
`boosthis()` and the env vars are separate mechanisms; where both exist the
precedence is called out.

### Core

| Env var | Values | Effect |
|---|---|---|
| `BOOSTHIS_DISABLED` | `1`/`true` (any truthy) | Kill-switch: silences the ENTIRE runtime, hides the bubble, and beats every option and dashboard directive. |
| `BOOSTHIS_PROJECT_KEY_NODE` | `bk_…` project key | Node-specific key; wins over every other source. |
| Project key passed in code | `enableTelemetry({ inviteKey })` | Wins after the Node-specific environment variable. |
| `BOOSTHIS_PROJECT_KEY` | `bk_…` project key | Shared key; used after the key passed in code. |
| `BOOSTHIS_INVITE_KEY` / `BOOSTEN_INVITE_KEY` | `bk_…` project key | Legacy key names; read last. |
| `BOOSTHIS_NO_PROJECT_KEY` | `1`/`true`/`yes`/`on` | Deliberately run without a project key when no key source above is present. A present key always wins. |
| `BOOSTHIS_INSTALL_ID` | UUID v4 | Pins this app's install id at startup — the same value on every instance and every restart, so a fleet counts as ONE install. An `installId` passed in code wins over it; nothing the kit has saved outranks it. |
| `BOOSTHIS_READ_TOKEN` | read token | Read only by the **local stdio MCP server**, paired with `BOOSTHIS_INSTALL_ID`. The runtime persists its own read token to disk automatically. |
| `BOOSTHIS_AI_ENDPOINTS` | comma-separated hostnames or URLs | Model endpoints this app calls that are NOT public providers — your own model server, a private gateway, a regional endpoint. Without this the AI meters cannot see those calls at all (see below). Full URLs are reduced to a hostname; the addresses are compared inside your process and never sent. Merged with the `aiEndpoints` middleware option. |
| `BOOSTHIS_BUBBLE` | `1`/`true`/`yes`/`on` = show, `0`/`false`/`no`/`off` = hide | Floating-bubble visibility. **Overrides the `bubble` option**; `BOOSTHIS_DISABLED` still wins and hides it. Default: visible. |
| `BOOSTHIS_NO_BUBBLE` | `1`/`true`/`yes`/`on` | Legacy hide alias. Loses to `BOOSTHIS_BUBBLE`; beats `BOOSTHIS_FORCE_BUBBLE` and the `bubble` option. |
| `BOOSTHIS_FORCE_BUBBLE` | `1`/`true`/`yes`/`on` | Legacy show alias. Loses to `BOOSTHIS_BUBBLE` and `BOOSTHIS_NO_BUBBLE`; beats the `bubble` option. |

### `enableTelemetry({ … })` arguments (not env vars)

| Argument | Type / default | Effect |
|---|---|---|
| `installId` | UUID v4 string, **required** | Stable identity across restarts. A non-UUID is rejected at registration (see §10). |
| `inviteKey` | string | The project key. Omit ⇒ on-device only. |
| `endpoint` | string, default `https://www.boosthis.com/api` | Hosted API base. Set by this argument — the runtime does NOT read `BOOSTHIS_ENDPOINT` (that env var is only for the stdio MCP CLI / community tooling). |
| `appName` | string ≤ 60 chars | Friendly name in your dashboard. Developer metadata — never PII. |
| `issuesOnly` | boolean, default `false` | Issue + fix signals only; no per-route samples (see §6). |
| `shareMeterWithAI` | boolean, default `false` | In `issuesOnly` mode, also mirror snapshot + spans. `false` is NOT a veto — a dashboard directive still enables it (see §6). |
| `crashDetails` | boolean, default `false` | Add scrubbed message line + sanitized frames to crash reports. |

### `boosthis({ … })` and `attach({ … })` options (not env vars)

`attach()` takes every option below as well as its own.

| Option | Type / default | Effect |
|---|---|---|
| `bubble` | boolean, default `true`/visible | Force the floating bubble on/off. `BOOSTHIS_BUBBLE` overrides it; `BOOSTHIS_DISABLED` hides it regardless. |
| `fallbackName` | string, default `"unknown"` | Route label for a request that carries no path at all. Every other request is labelled with the route the framework matched where it gives one (Express does), or else with its own path, id-like segments replaced by `:id`. |
| `rate` | `(ms) => "good"|"needs-work"|"poor"` | Override the default TTI rating function. |
| `aiEndpoints` | `string[]`, default none | Your own model endpoints, as hostnames or full URLs. Merged with `BOOSTHIS_AI_ENDPOINTS`. |
| `declaredWaits` | `{ routes?: string[], calls?: string[] }`, default none | Routes this app answers and calls it makes that wait on purpose, such as long-polls. See below. |

### Your own model endpoint, and what happens without a declaration

An AI call is recognised by its DESTINATION, matched against a maintained
list of the public providers. A call to a model you host yourself, a private
gateway or a regional endpoint matches nothing on that list, so it is not
reported as zero and not reported as unknown — the AI Wait, AI Spend and AI
Headroom rows are simply absent, which looks exactly like an app with no AI
in it.

Declare the endpoints and those calls are timed and counted like any other:

```ts
app.use(boosthis({ aiEndpoints: ["llm.internal", "https://ai.example.com/v1"] }));
// on any other Node server:  attach({ aiEndpoints: ["llm.internal"] })
// or, with no code change:  BOOSTHIS_AI_ENDPOINTS=llm.internal,ai.example.com
```

The address is compared inside your process and never sent. Every declared
endpoint, in every install, reports the same fixed provider code, so a reading
can neither name your endpoint nor tell two of yours apart. Tokens are counted
and the money is deliberately left blank — a model you run has no list price,
and a private gateway's price is your contract — so the kit reports how many
calls it declined to price instead of pricing them from a model name it
happens to recognise. A cost your endpoint reports itself IS used.

If you forget, the kit now says so rather than staying silent: a call whose
request PATH is an inference shape (`/v1/chat/completions`, `/v1/messages`,
`/api/generate` and a few more) sent to a host that matched nobody is counted,
and the AI Wait row appears carrying nothing but that count and the sentence
"AI-shaped calls went to an endpoint Boosthis could not recognise". It is
evidence, not an identification: those calls are never timed, never scored,
never counted as AI calls and never priced, and only the count leaves the
process — no hostname, no path, no distinct-endpoint total.

What this meter reads out of the call itself — a bounded slice of the
outbound request body, reduced to one number without leaving your process —
is stated in full in the privacy contract at the top of this guide, beside
every other place this kit reads a body, a header, a cookie or a query
value inside your process. None of them is sent anywhere, and the decision
to accept this one is yours.

### Routes and calls that wait on purpose (long-polls)

A long-poll waits on purpose: a route that answers only when there is news,
or a call your app holds open on another service (a bot polling Telegram is
held up to 30 seconds a call). Nothing in the traffic tells that wait from a
slow one, so the kit times it like any other: the route reads as your
slowest and drags every reading built on request times down with it, and a
call still open after ten seconds reads as an outside service that stalled.
Only you know which ones wait on purpose, so you name them:

```ts
app.use(boosthis({
  declaredWaits: {
    routes: ["GET /updates"],                                  // routes this app answers
    calls: ["https://api.telegram.org/bot:token/getUpdates"],  // calls this app makes
  },
}));
// on any other Node server:  attach({ declaredWaits: { routes: ["/updates"] } })
```

- **Routes** are named as your dashboard shows them: `GET /updates`, or
  `/updates` for every method of that route. The name is also compared with
  the request's own path, so the route you wrote matches even where the
  dashboard shows a segment as `:id`; there a `:name` segment stands for one
  segment that changes. A declared route's time stays out of the score, Code
  Health, resilience, the latency floor, load deflection, learned budgets,
  route timings, slow-route alerts and traces. Its errors and in-flight
  counts still count, and the panel shows it as declared.
- **Calls** are named by full address without the query. A segment written
  `:name` stands for exactly one segment that changes — here the bot token,
  so never paste the real one. A declared call is never counted as stalled,
  however long it waits; its time stays out of the outbound-call and
  outside-service readings and the traces; its failures still count. The
  address is compared inside your process and never sent: only counts are.
- **Matching is exact.** A wildcard, a prefix, a pattern, a host on its own
  and the kit's own routes are refused, each with its reason on the startup
  line. At most 10 names in each list; a longer list is refused whole, never
  cut to ten.
- **Nothing is hidden.** The startup line names what you declared. Every
  call kept out is counted and sent, your project page says what you
  declared and how many calls it kept out, and a window where every call was
  declared reads *nothing judged*, never good. There is no time limit that
  does this by itself: only the names you give.
- The declaration lives in your code, so it applies to the process that ran
  it; its counts start again when the process does.

### Advanced (rarely needed)

These change deep behaviour and are safe to leave unset.

| Env var | Values | Effect |
|---|---|---|
| `BOOSTHIS_STATE_DIR` | path (default `~/.boosthis`) | Where persisted tokens + caches live. |
| `BOOSTHIS_TURBO` | `0` opts out (only that exact value) | Turns off the first-run faster snapshot cadence, keeping the flat 60s interval. |
| `BOOSTHIS_BUILD_COMMIT` | commit string | Stamps uploaded build identity (commit) for the dashboard. |
| `BOOSTHIS_BUILD_TIME` | ISO time / epoch | Stamps uploaded build identity (build age). |
| `BOOSTHIS_DEP_INVENTORY` | `1` = on (default off) | Adds resolved package versions to the additive build identity. |
| `BOOSTHIS_EVENT_LOOP_HISTOGRAM` | `1` = on | Opt-in event-loop delay histogram meter. |
| `BOOSTHIS_PERF_ENTRIES` | `1` = on | Opt-in performance-entry backlog meter. |
| `BOOSTHIS_ASYNC_RESOURCE_TYPES` | `1` = on | Opt-in async-resource diversity meter. |
| `BOOSTHIS_DIAGNOSTICS` | `1` = on | Opt-in diagnostics-channel error volume/activity meter. |
| `BOOSTHIS_DIAGNOSTICS_CHANNELS` | comma list | Explicit channel names for `BOOSTHIS_DIAGNOSTICS`. |

### Several workers of one app

State — install identity, project key, consent token, entitlement cache, buffered crashes — lives in ONE file per application: `<BOOSTHIS_STATE_DIR>/boosthis-<hash of the app's directory>/node-runtime-store.json`. The hash is of `BOOSTHIS_PROJECT_ROOT` (else the working directory), which is what keeps two unrelated services on one machine out of each other's state. It is taken from the folder's settled spelling — `..` and a trailing separator resolved, and on Windows and macOS the letter case and short names the disk itself records — so one folder typed two ways (`C:\App`, `c:\app`) stays one install. Older kits hashed the root exactly as typed and recorded no root, so their store is found by trying the spellings it most likely came from: the root as typed today, and on Windows and macOS any spelling that differs from the settled one only in folder names written wholly in lower or upper case (the last six names each on its own, any before them all together) or in the drive letter's case. A store found that way is moved across. One kept under any other spelling — a name in mixed case of its own, such as `myApp` for `MyApp` — is not found, and that start registers as a new install, as it would have before. A link or junction is not followed: two paths that reach one folder through a link stay two names, as before.

Running several workers — `cluster`, `pm2 -i`, a process per core behind one port — is a supported shape. They share that file on purpose: one install, one identity, one project key, one project on the dashboard. Writes are atomic (temp file + rename) and taken under a lock that re-reads before merging. A buffered crash is owned by the process that captured it — another worker picks it up only once that process is gone. The exception is `forget()`: it erases the shared install's crash payloads and run history, including live siblings, and revokes their older in-memory crashes.

Node and Bun crash persistence and upload admission require writable shared state. One exclusive lock — a lock file created in the state directory, which works the same on Linux, macOS and Windows and needs no outside program — protects erasure, spool commits and upload admission. The wait for a sibling holding it is bounded: if the holder is still running when the wait runs out, the pass is skipped and tried again later, never forced. A lock is broken only when its holder is provably gone — its process has ended, or its process id now belongs to a different process — and only a lock naming no holder that can be checked falls back to its age. An unusable directory, or a lock that cannot be made at all, drops crashes with a warning rather than writing or uploading unguarded. After erasure, sibling processes must restart before collecting again. Server-side erase refusal still protects the remote boundary.

If two services genuinely share a working directory and must NOT share an identity, give one its own `BOOSTHIS_STATE_DIR` (or `BOOSTHIS_PROJECT_ROOT`).

If the state file cannot be read, the kit says so on stderr rather than behaving like a fresh install: unparseable is moved aside as `…json.unreadable-<timestamp>` and it starts empty; unreadable (permissions, a mount that went away) is never written over — state is kept in memory for that run and reported as not durable.

> Note: `BOOSTHIS_ICON_URI` and `BOOSTHIS_CHECKLIST` appear in the source but
> are exported CONSTANTS (the bubble icon; the 72-rule pack), **not** settings
> — do not set them as env vars.

## Kit files are vendored, not hand-edited

Boosthis files are vendored. An edit made in place is overwritten by the next re-fetch and shows up as `modified` in the verify check, so re-fetching the kit is what changes Boosthis behaviour. Where drift is suspected, the `verify_kit_install` check names every `missing`/`modified` file and `get_integration_kit` returns clean copies.

## WHICH PROJECT KEY THIS KIT TAKES

This kit reads its project key from the environment (the shared `BOOSTHIS_PROJECT_KEY` where nothing more specific is wired in), so the key never travels inside anything a user downloads. A normal (`fix`) key covers it: it both registers this project and authenticates the Boosthis AI connection's reads.

The narrower `ship` scope exists for the kits whose key ends up inside a published artifact (the React Native kit, the browser kit, the Flutter kit, the Swift kit and the Kotlin kit). Where a project's key is one, because its website or phone app carries it, server code reports with that same key and the app stays one project. On a server a published-app key registers and uploads; the reads, rule proposals, promise writes and build-map replacement a normal key opens are refused for it. A connection made by signing in carries the reads and the kits instead, and a newly made key for the server would be a new, separate project.

A key committed to a repository is a key in a public artifact from the moment the repository is one, which is the case the environment setting avoids.

## What Boosthis costs your app

PER REQUEST. Measured on 2026-10-22, against the same application file with
the kit never imported, installed the way this guide says
(app.use(boosthis()) + mount(app) on a real Express app, the shipped
recipe): each request costs the process 0.29 ms more of its time — between
0.27 and 0.31 ms across the run's rounds. That is arithmetic on the two
throughputs the rig measured with 4 callers, each starting its next request
the moment the last one answered: 1000 ÷ 2,730.36 requests a second with the
kit, minus 1000 ÷ 12,597.47 without it. It is capacity — how much less work
the process gets through — and not the delay one request feels when nothing
else is running, which this rig did not time.

WORST CASE: A ROUTE THAT DOES ALMOST NOTHING. Without the kit, the rig's
route took 0.079 ms of the process's time per request, so the same added
time shows as a 78.33% fall in throughput there. That percentage is the
worst case, not a forecast for your app: a bare health check, doing even
less work, would show the same added time as a larger share. The rig's
verdict on this run is OVER CEILING: it is above the 5% we hold this kit to,
and the breach is recorded here rather than hidden. The run's 3 interleaved
rounds placed that percentage at ±1.24 points.

UNDER LOAD. With the 4 callers running, a request took 1.08 ms longer at the
median and 1.61 ms longer at the 95th percentile. Those latencies include
any time a request spent waiting behind the other callers' requests in the
process, so they describe the process kept busy, not one request on its own.

ON A ROUTE THAT DOES REAL WORK — arithmetic on the figure above, not a
measurement. Where a route takes 5 ms of the process's time per request
without the kit, adding 0.29 ms costs 5.5% of the requests it can serve; at
20 ms, 1.4%; at 100 ms, 0.29%. The share is added ÷ (time without the kit +
added). That assumes the added time stays the same on heavier work: the
rig's route did a fixed piece of arithmetic and made no database or network
calls, and nothing heavier was measured. A process running near its CPU
limit would feel this, because every added millisecond is time it no longer
has for requests; one running well below that limit has the time to spare
and serves the same traffic.

FIRST REQUESTS. In the window straight after the process started, while the
kit loads, registers and warms up, it cost more than once settled: 0.39 ms
per request (0.38 to 0.41 ms), 82.46% of throughput, and 2.4 ms added at the
95th percentile.

SETTINGS. Today only switching the kit off changes the work it does on each
request: with BOOSTHIS_DISABLED=1 set, its request handling is a
pass-through. issuesOnly: true and disable() stop samples being uploaded and
nothing more; the kit still measures every request. No setting measures only
some requests. The rig measured the kit as this guide installs it, with
samples uploaded, and measured none of these settings.

MEMORY. The same paired arms, with the whole process tree's resident memory
sampled from the kernel while the traffic ran: the kit adds 90.79 MB once
the process has settled (±8.44 MB across the rounds), and 90.82 MB at its
largest single sample — the figure that decides whether a container with a
fixed memory limit survives. Measured 2026-09-25. Resident memory is what
the operating system says the process holds. A runtime that manages its own
heap — the JVM, .NET, the BEAM — answers extra allocation by growing that
heap, so part of a large figure here is the heap responding to the kit's
work rather than the kit's own structures. It is still memory the machine
must have, which is why it is published; it is not a number to read as the
size of the kit.

EVERY RUNTIME, FOR COMPARISON. The same rig, the same workload, the same
kit-absent control, one runtime at a time — time added per request once
settled, and in brackets the throughput that came to on the rig's near-empty
route: Edge isolates (Deno) 0.031 ms (35.34%), Java 0.036 ms (36.94%), Go
0.058 ms (51.7%), .NET 0.083 ms (51.56%), Browser (web page) 0.14 ms per
page operation (7.92%), Bun 0.21 ms (74.9%), Node.js 0.29 ms (78.33%), Rust
0.39 ms (88.63%), Elixir 0.61 ms (87.39%), Ruby 0.82 ms (44.91%), Python 2.0
ms (61.71%), PHP 5.2 ms (96.34%). Measured on different days; each runtime's
own date is in the record. No figure yet, each with a written reason and
what would take one: React Native, Flutter, Swift / Apple platforms, Kotlin
/ Android, Cloudflare Workers (workerd isolate). Nothing is estimated for
those, and nothing here is an average — an average over runtimes would
describe no app that exists.

WHAT THE KIT DOES AND DOES NOT PROMISE. Every public entry point in this kit
is wrapped so that a bug inside Boosthis returns a value to your code
instead of throwing into it, and each runtime's own test suite has a case
that checks it. That is a discipline we keep and check — it is not a
guarantee that nothing can go wrong inside your process. It cannot cover a
fault that starves your process rather than throwing in it, and it says
nothing at all about speed: the figures above are what this kit costs,
measured, and they are not zero. If you find a sentence in this kit's
release notes saying Boosthis "can never slow or crash your app", that
sentence is superseded by this one — the speed half was never measured and
the figures above contradict it. Boosthis is supplied as is and used at your
own risk — the LICENSE and TERMS shipped inside this kit say so, and nothing
here promises otherwise.


Coverage check before you finish: this is a SERVER kit, so it measures this service and nothing else. Most projects with a back end also have something the person actually looks at — a React Native/Expo app, or browser-served pages — and each of those has its own kit. One kit per runtime, the same project key for all of them — the remaining ones come from this same boosthis.get_integration_kit tool, and its `runtimes` list takes every runtime this project still needs in ONE further call; `runtime` on its own is the single-runtime form, for a project deliberately spanning one. The names: "flutter", "kotlin", "rn", "swift" for an app on a device, "web" for browser-served pages, and "bun", "dotnet", "edge", "elixir", "go", "java", "node", "php", "python", "ruby", "rust" for a back end. Worth a quick look around the whole repo before calling this done (package.json naming react-native or expo → the "rn" kit; naming a browser framework such as react, vue or svelte → the "web" kit; a server-rendered one such as next, nuxt or @sveltejs/kit → "web" and a back-end kit). Boosthis serves a small shell script at https://www.boosthis.com/scan to a caller presenting this project's key: it reads file names and manifest contents only, never source code, uploads nothing, walks monorepo subdirectories, names each Boosthis runtime the project spans and lists the stacks it recognises that have no kit. With only a server kit installed the developer sees no bubble anywhere (see the note above), which reads exactly like a failed install. If a runtime is genuinely out of scope here, telling the developer so up front saves the confusion.

STILL UNANSWERED: WHAT ELSE THIS PROJECT SPANS: the node kit covers the node runtime and no other, and nothing here establishes which other runtimes this project has — so this delivery answers one runtime out of an unknown number rather than finishing the install. One further call settles it: boosthis.which_kits reads the manifest file NAMES already visible in the project (nothing downloaded, nothing executed, no source code read) and names the kit each one implies; boosthis.get_integration_kit then takes every runtime it named in a single `runtimes` list. A host that cannot list files, or a developer who says the project is this one runtime, is served exactly the same kit either way — what is left unestablished is what the project spans, and saying that plainly is more use to the developer than an install reported as complete. What is already registered under this project key is deliberately not named in this file: every reader of this kit gets the same bytes, and the kit's own verification compares them. The kit reply's `project_span`, boosthis.connection_status and the dashboard each name it for THIS key.

COMPLETE INSTALL PATH: the archive at kit_archive_url (or every manifest file downloaded by hand) puts the files on disk. What turns them into an install is this kit's version-matched INSTALL.md, all the way through its runtime-specific dependency, startup wiring, and first real run. Files on disk alone are not an install.
PROJECT KEY: this kit's project-key option or environment setting takes the served invite_key; the exact runtime-specific name and startup call are in the guide above.
CONTROL HOW MUCH DATA ARRIVES: the guide's issues-only/private-mode switch limits collection to crashes and issues, while its share-with-AI switch opts the meter/span and snapshot mirror back in. Use the exact symbols listed for this runtime above; these are separate choices, not synonyms.
FLUSH: a short-lived worker, CLI, test, or backgrounded app exits with its queue undrained unless the runtime-specific flush call named above runs first. Where this runtime has no separate flush call, its guide says so and names the lifecycle event that drains the queue instead.
DIAGNOSTICS: the runtime's diagnostics/status calls named above, plus the first ungated console line, separate not-started, not-registered, disabled and connected. An unknown state is unknown: it is not evidence of a healthy install.
TURN IT OFF OR FORGET DATA: BOOSTHIS_DISABLED silences collection without deleting stored data. The runtime's forget/remove call named above deletes this install's stored Boosthis data and credentials on a server; these are deliberately different operations. On a website or a phone app every visitor's browser, or every phone running the app, is a copy of one install, so the same call there clears that one device and stops it sending while what the install already holds stays for its owner to erase.

FILES ON DISK ARE NOT AN INSTALL — THREE THINGS STILL HAVE TO HAPPEN AFTER THE FILES ARE WRITTEN, AND THIS IS THE POINT AT WHICH AN INSTALL IS USUALLY LEFT HALF-FINISHED. A passing file check (verify_kit_install, or its plain-HTTPS twin) says exactly one thing: the bytes written to disk match the bytes we served. It says nothing about whether anything is measured. The work that remains is that the kit is wired into the app's own startup path, that reporting is switched on with the project key, and that the app has actually been run (a back-end service also needs one real request). Files written with none of that is a project that is completely dark, and from the inside it looks exactly like a correct one — which is why the closing step is never a reading of the project from the inside, a screenshot, a preview pane, or a passing file check.
THE FINISHING QUESTION IS WHETHER BOOSTHIS HAS SEEN THE APP CHECK IN. One request answers it from anywhere — a restricted preview, a machine with no browser, a project that has never been published, a session whose tool replies are being screened: GET https://www.boosthis.com/api/connection-status, authenticated with the same project key.
Ordinary HTTPS is the route this guide uses; boosthis.connection_status is the same answer by a more convenient path, from the same builder. The state can change after the app runs, so the answer is only current as of when it was asked.
THERE ARE EXACTLY TWO STATES THIS WORK CAN END IN, and they are not the same: “reporting — Boosthis has seen this app check in”, and “files written but not switched on — nothing is being measured yet”, the second of which leaves something outstanding and someone who has to do it. Written files are not an installed, verified or finished state while Boosthis has not seen a check-in.