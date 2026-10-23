# Boosthis — Terms of Service & Privacy Policy

_Last updated: 2026-10-22_

This single document contains **both** the Terms of Service (Part A) and the
Privacy Policy (Part B) for **Boosthis**, a developer
performance toolkit ("Boosthis", "we", "us", "our"). By installing, enabling,
or otherwise using Boosthis, you ("you", "your", or the "User") agree to this
entire document. If you do not agree, do not install or use Boosthis.

---

# Part A — Terms of Service

## 1. Acceptance and eligibility

- By installing, enabling, configuring, or using Boosthis — including adding it
  to source code, running its runtimes, calling its APIs, or connecting to its
  servers — you accept these Terms.
- **To hold a Boosthis account you must be at least 18 years old.** Boosthis
  is a developer tool and is not intended for children. We chose 18 so that
  everyone holding an account has full legal capacity under the law of the
  Kingdom of Saudi Arabia, where Boosthis is operated: there is no route for a
  parent or guardian to agree to these Terms on a younger person's behalf, so
  we open no account for anyone younger. Until 4 October 2026 this floor was
  16, and an account opened before then is not closed by the change.
- **To buy a Paid Plan you must also have reached the age of majority where
  you live**, if that is higher than 18, and you must meet this floor even
  when buying on behalf of an organization. This is a different floor
  answering a different question — contractual capacity. Below the age of
  majority a person generally cannot be held to a subscription, which would
  make the subscription voidable and the payment disputable, so we do not sell
  one. The age of majority is higher than 18 in some places, and being old
  enough to hold an account there is not the same as being old enough to be
  billed.
- Both floors are asked as their own question, and both are enforced: no
  account is created without an answer to the first, and no payment is started
  without an answer to the second. Neither is verified — both are your own
  declaration — and answering either falsely is a breach of these Terms that
  may cost you the account under Section 14.
- You may use Boosthis only if you can form a binding contract with us.
- If you use Boosthis on behalf of a company or other organization, you
  represent that you have authority to bind that organization to these Terms,
  and "you" includes that organization.

## 2. Definitions

- **"Boosthis" / "the Service"** — the Boosthis software (the runtime kits we
  publish — for phone apps, browsers, servers and hosted edge functions — and
  any other runtimes we add), the rule book, the command-line tools, the MCP
  and HTTP servers, the hosted telemetry API, the developer and admin
  dashboards, and all related documentation. The kits are listed, with what
  each one can measure, on our public pricing page; what a kit measures differs
  by runtime, as described in Part B.
- **"Telemetry"** — everything your app sends to Boosthis: the always-on issue
  signatures and fix-resolution signals, and any optional full performance
  samples you choose to enable. It also covers anything submitted to the rule
  book **through the MCP server or the HTTP API** — including a draft rule an
  AI you have connected writes and submits on your behalf. Defined in detail
  in Part B.
- **"Project Key"** (still called an **"invite key"** in parts of the
  product's code and API field names) — a credential that lets one registered
  project of yours report to the hosted service. There are three kinds, and
  Section 3 says how each may be used. A **key for your AI connection and
  server code** is the kind the dashboard creates unless you choose otherwise:
  it lets the project report and lets an AI you connect read the project's
  measurements, so it must stay secret. A **published-app key** is created from
  the dashboard for code inside a published app, such as a website's JavaScript
  or a phone app: it lets that app report, fetch fixes and upload build maps,
  but it cannot read the project's measurements or create other keys, and it is
  made to be built into an app that anyone can download. A **key the Maintainer
  issued by hand**, which some older accounts hold, can also be used to claim
  an Account and to create further keys, so it must stay secret.
- **"Account"** — the developer account you create to use the hosted web and
  mobile dashboards. Creating one is open to the public and requires your full
  name, an email address that can receive mail, and a password (see Section 3).
- **"Workspace"** — an Account together with any teammates its owner has
  invited, and the projects, keys, and data they share.
- **"Veqtara Tech Company"** (the **"Company"**) — Veqtara Tech Company,
  commercial registration (CR) number 7054832287, registered in the Kingdom of
  Saudi Arabia and trading as **Boosthis**. The Company is the Maintainer: the
  legal entity that operates the Service, that you contract with under these
  Terms, and that sells and invoices every Paid Plan.
- **"Maintainer"** — the creator, owner, and operator(s) of Boosthis.
- **"Protected Parties"** — the Maintainer together with Boosthis's owner,
  creator, administrator(s), operator(s), contributors, and licensors, and each
  of their respective affiliates, officers, employees, and agents. Every
  disclaimer, limitation, release, and indemnity in these Terms runs in favour
  of all Protected Parties.
- **"Paid Plan"** — an optional paid subscription to the hosted Boosthis
  service (described in Section 15).
- **"Payment Processor"** — the third-party payment platform (currently Moyasar)
  whose form is embedded in Boosthis checkout and that processes subscription payments on the Maintainer's
  behalf.

## 3. Accounts, Project Keys, and workspaces

- **Anyone can create an account.** Sign-up is open to the public. You give
  your **full name**, an email address, and a password; you must keep those
  details accurate, keep your password and sign-in codes confidential, and you
  are responsible for everything done under your Account, except activity
  caused by a failure on Boosthis's side (see the next point). One person, one
  Account — do not share Account credentials. Accounts created before the name
  became mandatory are asked for it once, the next time the account holder
  opens the dashboard.
- **Sign-up can be refused.** The Maintainer may refuse a sign-up, or an
  invitation to a workspace, for an email address that cannot receive mail —
  for example an address at a domain with no mail server, or at a throwaway-mail
  service. A refused attempt creates no Account. What is recorded about it is
  only the domain of the address, the reason it was refused, whether it was a
  sign-up or an invitation, and a count per day, and
  that record is kept for **180 days**.
- **Project Keys are yours to create and to protect.** You mint them from your
  dashboard (how many you may hold at once depends on your plan). You must not
  share, resell, sublicense, publish, or transfer a Project Key, with one
  exception: building a published-app key into the published app it was created
  for, and publishing that app, is the use that key is made for, and it breaches
  neither this Section nor Section 17. Every other kind of key must stay secret,
  so never put one in code that ships inside a published app. Anyone who holds
  a copy of a published app can read the key inside it and use that key to send
  made-up readings to the project; if that happens, you can switch that key off
  on its own and your other keys keep working. You are
  responsible for the activity that occurs under your Project Keys and install
  IDs, **except activity caused by a failure on Boosthis's side** — for
  example, a key that Boosthis itself exposed. If you think a key has leaked,
  rotate it from your dashboard and tell the Maintainer promptly.
- **Keys we switch off for security.** We may switch off a Project Key, or any
  other credential, that we believe is exposed or at risk — at any time, and
  even when you did nothing wrong. When we switch off a Project Key, we tell
  you by email. Switching off a key for security does not suspend your
  Account: your other keys, and the data stored under them, are untouched —
  except that switching off a key the Maintainer issued by hand also switches
  off the Project Keys created from the dashboard of each Account that holds
  it. The data stored under a switched-off key is kept if its projects move
  onto another of your keys within the 60 days described in Section 14; you can
  move them from your own dashboard, or ask the Maintainer to move them for
  you. Moving them cancels the deletion countdown, unless your access is also
  cut off for another reason.
- We may also rotate, disable, or revoke keys as Sections 5 and 14 allow.
  Subject to the exceptions in Section 12, which apply here in full, we are not
  liable for the consequences of a revoked or expired key.
- **Access can be limited or ended.** Creating an Account does not entitle you
  to the Service indefinitely: access to the telemetry program and the hosted
  services may be refused, limited, suspended, or ended — for example for
  abuse, non-payment, or breach of these Terms — in the cases and with the
  notice described in Section 14.
- **Teammates see your workspace data, and admins can act on it.** You may
  invite teammates by email address, each as a **member** or an **admin**, and
  only the workspace owner can make someone an admin. Anyone who accepts can see
  that workspace's projects, their performance data, and its activity log. A
  member can look but cannot change anything. An admin can also act on the
  workspace's projects: connect an AI to a project or create a project's AI key,
  and switch off a project's AI access; move a project onto another key; cut
  off, repair or remove an app; turn on **full performance details** for a
  project, which changes what Boosthis collects from it (see Part B); declare
  releases, choose which chat destination a project's alerts go to, upload build
  maps and act on alerts; and invite and remove members, but never another admin
  or the owner. The following stay with the workspace owner alone: billing;
  creating, renaming, rotating, switching off and removing Project Keys; the
  account-wide AI key; cutting off every app at once; teammates' roles; email
  settings; and connecting chat destinations. The number of seats depends on
  your plan. Invite only people you are willing to share that data with, make
  admin only someone you trust to change what is collected, and remove teammates
  when they no longer need access.

## 4. License to use Boosthis, and restrictions

- The Boosthis software is licensed to you under the terms of the project
  `LICENSE` (Apache License 2.0). That license governs your rights to use,
  copy, and modify the **code**. These Terms govern your use of the **Service**
  (including the hosted telemetry API, the hosted dashboards, and the AI
  tooling). Where the
  Apache License and these Terms both apply, the Apache License controls your
  rights in the **code**, and these Terms control your use of the **Service**;
  nothing in these Terms limits, modifies, or adds conditions to the rights the
  Apache License grants in the code.
- Except as permitted by the `LICENSE` — and in every case when interacting
  with the Service — you must **not**:
  - use Boosthis or its servers in any unlawful way, or in violation of these
    Terms;
  - probe, scan, overload, rate-abuse, or attempt to gain unauthorized access
    to the telemetry API, admin dashboard, or any Boosthis infrastructure;
  - attempt to bypass, disable, or weaken the PII guard, the privacy
    chokepoint, or any access control;
  - tamper with, remove, disable, or circumvent — or assist or direct anyone
    or anything (including any AI agent or automated tool) to tamper with,
    remove, disable, or circumvent — the Service's activation, entitlement,
    kill-switch, or integrity-verification mechanisms, or misrepresent your
    install's identity, version, or integrity state to the Service;
  - submit false, poisoned, automated, or bulk telemetry intended to corrupt
    the rule book or analytics;
  - remove, obscure, or misrepresent any notice, license, or attribution; or
  - use Boosthis to build a competing dataset or service from telemetry you do
    not own.

## 5. Acceptable use

You are solely responsible for your own application, your source code, your
data, your users, and for what you place into route names, labels, metadata,
the optional app display name, and exception messages. The optional app display
name is developer-provided metadata: it is transmitted to and stored by the
Maintainer, shown back to you in your own dashboard so you can tell your
installs apart, and — like every other field — must not contain personal data
or anything you are not entitled to share. You must not use Boosthis to process,
transmit, or expose unlawful content or to violate the rights of any third
party.

**You — not the Maintainer — are responsible for your end users.** Boosthis runs
inside your application; you are the controller of any data your app handles. If
any law, contract, or privacy regime that applies to you requires you to
disclose to, or obtain consent from, your own end users before collecting,
processing, or transmitting performance telemetry from their use of your app,
**that disclosure and consent are your responsibility, not the Maintainer's.**
The consent screens, notices, and controls Boosthis ships govern the
relationship between you (the developer/integrator) and the Maintainer; they are
**not** a substitute for any notice or consent you owe your own users, and the
Maintainer makes no representation that they satisfy your obligations.

**You must have the right to instrument the application.** You represent and
warrant that, for every application, service, or site you install Boosthis into,
you either own it or are authorised by its owner to install monitoring software
in it and to transmit its telemetry to the Maintainer. You must never install
Boosthis into an application you do not own or control, and you must never use a
Project Key to collect telemetry on behalf of anyone who has not authorised it.

**Prohibited uses.** In addition to Section 4, you must not use Boosthis, its
API, its dashboards, or its AI tooling:

- for any unlawful purpose, or in furtherance of any criminal activity;
- to monitor, profile, track, locate, or gather information about any person, or
  about any organisation's application, without the right to do so — including
  covert surveillance, stalking, or harassment;
- to collect, infer, or transmit personal data, special-category data, payment
  card data, authentication credentials, or secrets through any Boosthis field,
  label, name, or message;
- to develop, host, distribute, test, or operate malware, ransomware,
  credential-stuffing, denial-of-service, scraping, or intrusion tooling, or to
  support, plan, or conceal an attack on any system;
- to reach, read, or attempt to reach any project, key, install, account, or
  telemetry that is not yours;
- in breach of applicable export-control or sanctions law (see Section 18); or
- in any way that would place the Maintainer in breach of any law, or of any
  payment-network, registry, or hosting-provider rule.

**Enforcement.** Where the Maintainer reasonably believes this Section has been
breached, it may — immediately, without notice, and in addition to every right
in Section 14 — suspend or terminate your account, revoke or rotate your Project
Keys, disable affected installs through the Service's activation and kill-switch
mechanisms, and refuse further service. No refund is due for a suspension or
termination under this Section. The Maintainer may also preserve and disclose
records where it is required to do so by law, or where it reasonably believes
disclosure is necessary to prevent serious harm. It answers only lawful
requests from competent authorities. When it answers one, it discloses only the
narrowest data the request needs, and it tells the affected customer about the
request unless the law forbids it.

**Reporting misuse.** If you believe Boosthis is being used in breach of this
Section, email <support@boosthis.com> with "abuse" in the subject. Include
whatever detail you can; reports are reviewed by the Maintainer.

**What the Maintainer can and cannot see.** Boosthis receives performance and
crash telemetry. It does not receive your application's source code, your
files or your end users' data, except in three cases. A build map you upload
can embed the source text it was built from: that text is discarded on
arrival, and only file paths, identifier names and the table joining them to
positions are kept, for 90 days (see Part B). A message you send to support can
carry attachments: only each attachment's name, size and type are kept, and its
contents are never downloaded. And the telemetry can include personal data
about your end users, which Boosthis processes on your behalf under the Data
Processing Agreement described in Section 25. None of this lets the Maintainer
inspect, supervise, or police what your application does, and nothing in this
Section is a representation that it does so. Operating your own application lawfully is your responsibility
alone; this Section defines what is forbidden on the Service and what the
Maintainer will do when it learns of a breach.

## 6. Boosthis intellectual property

- As between you and the Maintainer, the Maintainer owns all right, title, and
  interest in and to Boosthis — including the software, the rule book, the
  detectors, the scoring model, the documentation, the name "Boosthis", and all
  associated logos, trademarks, and trade dress — except for the rights
  expressly granted to you under the `LICENSE`.
- Nothing in these Terms transfers any Boosthis intellectual property to you,
  and no rights are granted by implication or estoppel.

## 7. Ownership and assignment of Telemetry

By installing, enabling, or otherwise using Boosthis with a registered app, you
agree to the following about **everything your app sends to Boosthis** — the
**issue signatures**, the **fix-resolution signals**, and any **optional full
performance samples** you choose to turn on — **and everything submitted to the
rule book through the MCP server or the HTTP API**, including a draft rule an
AI you have connected writes and submits on your behalf (together, the
"Telemetry"):

- **You assign it all to Boosthis, except personal data.** Subject only to the
  next point, you hereby waive, and irrevocably assign to the Maintainer, all
  right, title, and interest you may have in and to the Telemetry, and to any
  rules, thresholds, aggregated statistics, models, or other improvements
  derived from it. **This applies to every piece of
  Telemetry you send — whether it is the always-on issue & fix signals or the
  optional full performance samples you enable with `enableTelemetry()` /
  `boosthis.enable_telemetry()`. Turning full data on does not give you any
  ownership claim over what you send.** You will not claim ownership of — or any
  royalty or other compensation for — the Telemetry or anything Boosthis builds
  from it.
- **Personal data in the Telemetry is never assigned.** Where a piece of
  Telemetry can relate to an identifiable person — an install identifier, or a
  route label, metadata field or exception message your own code built from
  someone's data — nobody acquires ownership of it under this Section. It stays
  under the Data Processing Agreement and Part B, the person it is about keeps
  every right Part B describes, and an erasure erases it. What the Maintainer
  owns is what Boosthis builds with the person taken out: rules, fixes,
  signatures, thresholds, aggregated statistics, and what is submitted to the
  rule book. This point overrides every other point in this Section.
- **This expressly includes every issue, error, bug, and fix.** When an issue,
  error, bug, defect, crash, or performance problem is surfaced by the Telemetry
  your app sends, or is identified, reproduced, diagnosed, derived, or generated
  by Boosthis — together with every fix, patch, workaround, rule, remediation,
  signature, insight, or rule-book entry Boosthis creates from or about it — all
  right, title, and interest in that Telemetry, finding, fix, rule, and rule-book
  entry belongs to the Maintainer, and you irrevocably waive, and will not
  assert, any ownership, authorship, inventorship, royalty, or other claim over
  them. This is about Boosthis's record and remediation of the problem, not the
  underlying defect in your own code: as stated below, the assignment never
  reaches your source code, diffs, file contents, or application, which remain
  entirely yours.
- **The doorway does not change the terms.** It makes no difference whether
  material reaches the rule book from your app, from the **MCP server**, or
  from the **HTTP API**, and it makes no difference whether a person or an AI
  you connected wrote it. A draft rule submitted through any of those doorways
  — its title, when it applies, its fix text, and the pattern it was drafted
  from — is assigned on exactly the same terms as an issue signature,
  including everything Boosthis builds from it, surviving erasure and
  termination, with no royalty, authorship, or other claim left behind.
- **You warrant that it was yours to send.** For anything you, or an AI you
  connected, submits to Boosthis, you represent and warrant that it was yours
  to send: that it is **your own material, or material you are free to
  contribute**; and that it is **not any third party's proprietary,
  confidential, or licensed material**. What the kits send is listed in
  Part B, and some of it can relate to a person: every install carries a random
  install identifier, and a route label, metadata field or exception message
  carries whatever your own code put into it. For that, you warrant that you
  have a lawful basis for it and have told the people it is about, as your own
  privacy policy and the Data Processing Agreement require. You also warrant
  that nothing submitted to the rule book through the MCP server or the HTTP
  API — a draft rule's title, conditions, fix text or pattern — names or
  describes an identifiable person. You are
  responsible for everything submitted under your Project Keys, including
  material an AI you connected generated, except material submitted because of
  a failure on Boosthis's side — for example, through a key that Boosthis
  itself exposed. A breach of this warranty is indemnified under Section 13.
- **This covers only what you send — never your code or app.** The Telemetry is
  the data described in Part B (the issue & fix signals, plus, in full mode,
  route labels, durations, and ratings), together with anything submitted to
  the rule book through the MCP server or the HTTP API. Apart from the build
  maps and support attachments described in Section 5, Boosthis does not
  receive your source code, diffs, file contents, or your application, and this
  assignment gives the Maintainer **no rights over any of them**, nor over a
  build map or an attachment you send. Your code and your app remain entirely
  yours.
- **The assignment survives erasure and termination.** Running `forget` stops
  the Telemetry tied to your install going forward, but it does not claw back
  rules or aggregate improvements already derived and shipped from Telemetry
  you contributed while using Boosthis. This Section survives termination of
  these Terms.
- **Why this exists.** Boosthis's purpose is a shared, ever-improving rule
  book. This Section makes clear that the Maintainer may keep, aggregate, and
  ship those improvements to everyone without any later ownership claim being
  made over them.

## 8. Feedback

If you send the Maintainer any feedback, ideas, suggestions, or bug reports
about Boosthis, you grant the Maintainer a perpetual, irrevocable, worldwide,
royalty-free, fully sublicensable license to **use, copy, edit, adapt,
publish, distribute, and sublicense** them for any purpose, without
obligation, attribution, confidentiality, or compensation to you. This Section
is the catch-all: anything that reaches the Maintainer outside the doorways
named in Section 7 is covered here.

## 9. AI-generated suggestions are not approvals

Boosthis surfaces performance rules and AI-assisted fix suggestions through its
MCP server, HTTP API, and documentation. **These are suggestions, not
approvals.** You are solely responsible for reviewing, testing, and deciding
whether to apply any suggested change before you ship it. The Maintainer is not
responsible for any outcome of an applied suggestion.

**Rule text may be machine-generated.** A rule's title and fix text may be
written by the Maintainer's own model, by an AI a developer connected to
Boosthis, or by the Maintainer, and an approved rule may be served **as
written**. Every rule a developer can fetch is **human-reviewed**: a person
decides that it may be served. That review is a **review, not a verification**
— it is not a check that the rule is correct, safe, or suitable for your
application, and no Protected Party warrants that it is.

**Applying a fix automatically is your decision and your risk.** If you let an
AI assistant, an agent, or any other automated tool fetch a fix and apply it to
your code without a person reading it first, that is your choice and the risk
is yours. Boosthis never applies a change to your code.

**A rule may change or be withdrawn at any time, without notice.** A rule
served through the MCP server or the HTTP API may be re-worded, replaced, or
withdrawn at any time and without notice to you, and the Maintainer is under no
obligation to keep serving a rule you have previously received.

**The "Ask Boosthis" assistant.** The dashboard assistant answers questions
about your own telemetry. It is **software, not a person**; it is **not
professional advice of any kind** — medical, psychological, legal, or
financial; and it is **not an emergency or crisis service**. If what you type
appears to describe self-harm or harm to another person, the assistant replies
with crisis-line information instead of an AI answer. That reply is
**automatic**: nothing is monitored, no one is alerted, and no one is watching
the box. In an emergency, contact your local emergency number or a crisis line
directly.

## 10. Third-party dependencies and services

Boosthis may rely on third-party software, registries, AI providers, and
hosting platforms. Your use of those is subject to their own terms, and the
Maintainer is not responsible for them.

**Destinations you connect.** You can send your project alerts to places outside
Boosthis: an alert webhook at an address you supply, or a chat workspace you
connect, such as Slack. Only project alerts go there, along with the test
message sent when you connect a destination or ask for one; billing, account and
security notices are never sent to a destination you connect. A destination
receives what you route to it, on your instruction: the workspace owner connects
it, and the owner or an admin chooses which project's alerts go where. The
service behind it is one you chose, not one the Maintainer engaged, and what it
does with what it receives is your responsibility and is governed by your own
agreement with it. Boosthis keeps each destination's address sealed while it is
stored, and you can disconnect a destination at any time.

## 11. Disclaimer of warranties

BOOSTHIS IS PROVIDED **"AS IS" AND "AS AVAILABLE," WITH ALL FAULTS AND WITHOUT
WARRANTY OF ANY KIND**, whether express, implied, or statutory, including
without limitation any implied warranties of merchantability, fitness for a
particular purpose, title, non-infringement, accuracy, and any warranties
arising from course of dealing or usage of trade. **No Protected Party**
warrants that Boosthis will be uninterrupted, timely, error-free, secure, or
free of harmful components, that any defect will be corrected, or that the PII
guard will catch every identifier or secret — the PII guard is a **best-effort
defence against common identifier and secret field names**, not a guarantee. No
advice or information, oral or written, obtained from any Protected Party
creates any warranty not expressly stated here. You assume the entire risk as
to the quality, performance, and results of Boosthis and use it **entirely at
your own risk**. Boosthis is **not designed, intended, or licensed for use in
high-risk activities** — including medical or life-support systems, aviation,
nuclear facilities, weapons systems, or any other environment where a failure
could lead to death, personal injury, or severe physical or environmental
damage — and no Protected Party is liable for any use of Boosthis in such
activities. This disclaimer does not withdraw the security measures the
Maintainer describes in Part B and maintains; it means only that no measure is
guaranteed to stop every incident. This restates and supplements the warranty
disclaimer in the `LICENSE` (Apache License 2.0, Section 7); to the extent of
any conflict, the broader disclaimer applies to your use of the Service,
always subject to the exceptions in Section 12. Some jurisdictions do not allow
the exclusion of certain warranties, so some exclusions may not apply to you.

## 12. Limitation of liability, assumption of risk, and release

**Use at your own risk — no liability.** You use Boosthis entirely at your own
risk. To the maximum extent permitted by law, and subject to the exceptions below,
none of the Protected Parties (defined in Section 2 — including the owner,
creator, and administrator of Boosthis, its maintainers and contributors) will
have any liability of any kind to you or anyone else for
any loss or damage arising from or relating to Boosthis — including any data
exposure, leak, loss, corruption, downtime, security incident, or business
loss. This clause works together with Sections 11–13. If you do not accept
this, do not install or use Boosthis.

**No liability.** SUBJECT TO THE EXCEPTIONS BELOW, AND TO
THE FULLEST EXTENT PERMITTED BY LAW, IN NO EVENT WILL ANY
PROTECTED PARTY (INCLUDING THE OWNER, CREATOR, AND ADMINISTRATOR OF BOOSTHIS) BE
**LIABLE TO YOU OR ANY THIRD PARTY** FOR ANY INDIRECT, INCIDENTAL, SPECIAL,
CONSEQUENTIAL, EXEMPLARY, OR PUNITIVE DAMAGES, OR FOR ANY LOSS OF PROFITS,
REVENUE, BUSINESS, DATA, GOODWILL, OR OTHER INTANGIBLE LOSSES, OR FOR ANY **DATA
EXPOSURE, LEAK, LOSS, CORRUPTION, DOWNTIME, SECURITY INCIDENT, OR REGULATORY
PENALTY**, ARISING OUT OF OR RELATED TO BOOSTHIS OR THESE TERMS — WHETHER BASED
ON WARRANTY, CONTRACT, TORT (INCLUDING NEGLIGENCE), STRICT LIABILITY, STATUTE,
OR ANY OTHER LEGAL THEORY, AND WHETHER OR NOT ANY PROTECTED PARTY HAS BEEN
ADVISED OF THE POSSIBILITY OF SUCH DAMAGES, AND EVEN IF A REMEDY FAILS OF ITS
ESSENTIAL PURPOSE.

**Liability cap.** SUBJECT TO THE EXCEPTIONS BELOW, AND TO
THE EXTENT ANY LIABILITY CANNOT BE FULLY EXCLUDED, THE
PROTECTED PARTIES' TOTAL AGGREGATE LIABILITY FOR ALL CLAIMS WILL NOT EXCEED
**THE GREATER OF (A) THE TOTAL AMOUNT YOU ACTUALLY PAID THE MAINTAINER FOR
BOOSTHIS IN THE TWELVE MONTHS BEFORE THE CLAIM AND (B) SAR 100.** THIS CAP IS
AGGREGATE ACROSS ALL CLAIMS, NOT PER-INCIDENT. FOR ANY NO-CHARGE PRODUCT THE
LOWER CAP IN SECTION 16 APPLIES INSTEAD.

**Assumption of risk.** You acknowledge that Boosthis is an automated
performance tool that runs inside your own application, that you alone control
what data your application handles and exposes, and that you **knowingly and
voluntarily assume the risk** arising from your use of Boosthis and from any
change you make in reliance on it — except risk caused by a failure on
Boosthis's side, or by anything listed in the exceptions below.

**Release.** To the extent the law allows, you release the Protected Parties
from claims arising from a change you chose to make to your own application in
reliance on a Boosthis finding or an AI-suggested change, because applying it
was your decision. This release does not reach claims you could not have known
about when you accepted these Terms, claims caused by a failure on Boosthis's
side, or anything listed in the exceptions below.

**Exceptions — what these Terms never exclude or limit.** Nothing in these
Terms — including every exclusion, limit, cap, release, disclaimer, and
assumption of risk in Sections 3, 11, 12, 13, 14, 16, and 19 and in Part B —
excludes or limits liability for (a) fraud or fraudulent misrepresentation; (b)
gross negligence or wilful misconduct; (c) death or harm to a person; or (d)
anything else that applicable law does not allow to be excluded or limited.
These Terms also keep every right and remedy that applicable consumer-protection
law gives you and that a contract cannot take away, such as the refund rights in
Section 15. These exceptions apply to every Protected Party alike.

This Section restates and supplements the limitation of liability in the
`LICENSE` (Apache License 2.0, Section 8); to the extent of any conflict, the
broader limitation applies to your use of the Service, always subject to the
exceptions above. Some jurisdictions do not allow certain limitations, so some
of the above may not apply to you; in that case the Protected Parties' liability
is limited to the minimum permitted by law.

## 13. Indemnification

To the fullest extent permitted by law, you agree to **defend, indemnify, and
hold harmless** the Protected Parties from and against any claims,
damages, liabilities, losses, and expenses (including reasonable legal fees)
arising out of or related to: (a) your application, source code, data, or
users; (b) the data you place into route names, labels, or metadata; (c) your
breach of these Terms or your violation of any law; (d) your violation of any
third party's rights; or (e) any material you, or an AI you connected,
submitted to Boosthis — including any breach of the warranty in Section 7 that
it was yours to send, that it is not any third party's proprietary,
confidential, or licensed material, that you have a lawful basis for and have
disclosed any personal data your own code put into it, and that nothing
submitted to the rule book describes an identifiable person. Ordinary use of
Boosthis as these Terms allow is not, by itself, a ground for this indemnity,
and it never covers a claim to the extent it was caused by a failure on
Boosthis's side (for example, a key that Boosthis itself exposed) or by
anything listed in the exceptions in Section 12.

## 14. Term, suspension, and termination

- These Terms apply for as long as you use Boosthis.
- **Suspension without notice is limited.** The Maintainer may **suspend or
  terminate** your access (including your Account, your Project Keys, and
  telemetry participation) without notice only: to deal with a security threat;
  for abuse or unlawful use; for non-payment, once the renewal retries described
  in Section 15 have run out (which freezes your plan rather than deleting
  anything); for tampering, as described below; or where a law, a court, or a
  competent authority requires it.
- **Notice and a chance to fix it.** In every other case — including any other
  breach of these Terms — the Maintainer first tells you by email what is wrong
  and gives you a reasonable chance to fix it before it suspends or terminates
  your access.
- **Pro-rata refund when it is not your fault.** If you are on a Paid Plan and
  your access ends for a reason that is not your fault, the Maintainer refunds
  the unused part of your paid period pro rata, through the same refund process
  as any other refund under Section 15 (with a credit note where a tax invoice
  was issued). Subject to that refund and to the exceptions in Section 12, a
  suspension or termination under this Section is without liability to you.
- **Tampering is a material breach.** Tampering with, removing, disabling, or
  circumventing the Service's activation, entitlement, kill-switch, or
  integrity-verification mechanisms (or assisting or directing anyone or
  anything to do so) is a **material breach** of these Terms, and the
  Maintainer **may terminate** your access, Project Keys, and telemetry
  participation immediately, without notice or liability (subject to the
  exceptions in Section 12). What the Service does by itself when it detects
  tampering is narrower: it **cuts off the install** concerned, so that
  install's reports and reads are refused; it keeps that install's data **as
  evidence**; and it **starts no deletion countdown**, which begins only if
  your access is then revoked or suspended under this Section. The Maintainer
  **may** also pursue any remedy available at law or in equity for such
  breach; no remedy is exclusive, and declining to pursue a remedy is not a
  waiver.
- You may stop at any time: disable optional samples, set the kill-switch
  `BOOSTHIS_DISABLED=1`, or run `forget` to erase your data (see Part B).
- **A lapsed or missing plan is a freeze, never deletion.** If a Paid Plan
  lapses, if a free trial ends without a plan, or if an Account has no plan,
  the Account is **frozen, not deleted**; all three are the same state. While
  it is frozen:
  - your apps' reports are refused, so **nothing new is measured**;
  - the dashboard's measurements, snapshots, findings, traces, monthly report
    and rule book, and **Ask Boosthis**, are unavailable, and so is anything
    that creates or grows something, such as a new Project Key;
  - billing, signing in, the support form, past receipts and invoices,
    security settings, the data export, closing your Account, leaving a
    workspace, every control that switches something off or removes it, and
    the language setting stay available;
  - **nothing is deleted** because of the freeze and no deletion countdown
    starts: everything already collected is kept, for the periods Part B
    states, and can be downloaded through the data export.

  Activating a plan opens everything again straight away — the dashboard on
  your next click, and your installed apps at their next check-in — with no
  new key and no code change (see Section 15).
- **Revocation or suspension starts a deletion countdown.** If your access is
  revoked or suspended, a **60-day countdown to deletion** of the associated
  stored data begins. Restoring your access before it ends cancels the
  countdown. When a single Project Key is switched off — including for
  security, as described in Section 3 — the countdown covers only the data
  stored under that key, and moving its projects onto another of your keys
  before the 60 days end cancels it, unless your access is also cut off for
  another reason. Running `forget` on an install made with a server kit
  deletes immediately at any time; on a website's or phone app's install one
  copy's `forget` erases nothing pooled, and Part B says how its owner erases
  it. Learning signals survive deletion only in permanently de-identified form,
  as described in Section 7 and Part B.
- Sections that by their nature should survive termination — including 6, 7, 8,
  11, 12, 13, 15 (for fees already owed), 16, 17, 20, 22, and 26 — survive.

## 15. Subscriptions, billing, and payment

Boosthis offers optional **Paid Plans** — subscriptions billed either monthly
or yearly, whichever you choose at checkout, that unlock higher limits and
additional features on the hosted service. The plans, prices, the billing
period, and what each includes are shown on the billing page at the time of
purchase.

- **How a subscription is concluded.** You choose a plan on the billing page,
  where its price, its billing period and what it includes are shown, and you
  are then taken to Boosthis-hosted checkout embedding Moyasar's payment form to pay. The
  contract is concluded, and your obligation to pay arises, **when that payment
  is confirmed** — not when a plan is selected. A receipt is issued for every
  payment and is available on the billing page, and the plan shows as active on
  your Account as soon as the payment confirms. If the payment is not
  confirmed, no contract is concluded and nothing is charged.
- **How the service is delivered.** Boosthis is an online service: **nothing is
  shipped and there is no physical delivery**, so no shipping cost, duty or
  delivery charge is ever added to the price. Delivery is the enabling of the
  paid features on your Account, and it happens immediately when the payment
  confirms — normally within seconds, with no further step by you. You then use
  the service over the web at **www.boosthis.com** and in the Boosthis app,
  wherever you are. If the paid features are not enabled after a confirmed
  payment, write to the registered postal address in Part B, or email
  <support@boosthis.com>. We notify you
  promptly of any anticipated activation delay, explain the problem and any
  proposed revised delivery date, and promptly correct a paid activation
  failure or return the full payment through Moyasar to the original method.
  You do not have to wait fifteen days to report it. Where Article 14 of the
  Saudi E-Commerce Law applies, a delay in delivery or execution exceeding
  fifteen days from the agreed date may also entitle you to rescind and recover
  the payment and applicable delay costs, subject to that article's agreed-date
  and force-majeure provisions. Immediate normal activation does not exclude
  these mandatory remedies.
- **Payment is handled by the Payment Processor.** Checkout happens on the
  Boosthis-hosted page embedding Moyasar's payment form. Card details are
  sent directly from your browser to Moyasar, under its own terms and privacy
  policy, and never to Boosthis's servers. Card authentication may redirect
  you to your issuer; Apple Pay uses the payment sheet on your device.
  **Your card details go to the Payment Processor and never touch
  Boosthis's servers.** Boosthis stores which plan you
  are on, a reference to your subscription, and — so renewals work and you can
  recognize the card — your card's brand, its last four digits, and a reusable
  payment token issued by the Payment Processor (never the card number
  itself). With each payment it also keeps the country of the bank that issued
  your card, as the Payment Processor reports it, as part of the record of that
  payment.
- **Checking a card you save.** When you save a card, or replace it, from the
  billing page, the Maintainer checks that the card works by asking the
  Payment Processor to hold SAR 1 and releasing the hold at once, so nothing is
  charged. If the Payment Processor will not place a hold, the check is made
  instead by charging SAR 1 and refunding it at once. Either may briefly appear
  on your statement as pending.
- **Billing contacts.** You can name up to 3 extra email addresses as billing
  contacts. Each one receives a copy of every receipt and invoice and of every
  notice about a payment problem, and nothing else. A billing contact cannot
  sign in or act on your Account, and only the account holder can change the
  list.
- **Changing plans.** An **upgrade** takes effect immediately: you pay only the
  prorated difference for the remainder of the current period, and your renewal
  date does not move. A **downgrade** takes effect at your next renewal, so you
  keep what you paid for until then. If a quoted upgrade price is no longer
  valid by the time payment completes, the payment is refunded rather than
  applied.
- **Failed or declined renewals.** If a renewal payment is declined, your plan
  stays fully active and we email the Account address. We try the card again
  automatically about 1, 3, 7 and 14 days after the renewal date, and email you
  again before the last try. If the last try is declined too, the plan lapses
  into the frozen state described below — nothing is deleted, and paying
  resumes full access. Where the card's bank marks a decline as final (for
  example a card reported lost or stolen, or a closed account), we do not try
  that card again: we ask you for a new card straight away, and the plan stays
  active until the same day it would otherwise have lapsed. Replacing the card
  on your billing page at any time tries again straight away. The first charge
  after a free trial is the exception: if it is declined, the trial ends. We
  also email you before your next renewal if your saved card will have expired
  by then.
- **Refunds, when issued**, are returned through the Payment Processor to the
  original payment method.
- **Plans renew automatically** at the end of each billing period — every month
  on a monthly plan, every year on a yearly one — until you cancel, except a
  plan paid with Apple Pay, as the next point explains. A monthly
  plan renews on the same date every month, and a yearly plan on the same date
  every year. Where that date does not exist in a shorter month, the renewal
  falls on the last day of that month and the next one returns to the usual
  date: a plan that renews on the 31st renews on 28 (or 29) February and then
  on 31 March, and a yearly plan that renews on 29 February renews on 28
  February in the years that have no 29th. Dates are counted in Coordinated
  Universal Time (UTC), the time zone your receipts are dated in. You can
  cancel at any time from the billing page; if you cannot access it, write to
  us using the contact details below for assistance. Cancellation takes effect
  at the end of the current billing period, and you
  keep the paid features until then.
- **A plan paid with Apple Pay does not renew automatically.** An Apple Pay
  payment leaves no card that can be charged again, so there is nothing to take
  a renewal from. About a week before the period ends, the Maintainer emails
  you that a card is needed. When the period ends, nothing is charged or declined
  and the plan stays on: it is not stopped before the Maintainer has written to
  you and given you at least 14 days to answer, and you are not asked to pay
  for the time since the period ended. Adding a card on the billing page
  resumes automatic renewals.
- **Free trials.** Where a free trial is offered, **no payment card is
  required and nothing is charged to start one**. A free trial gives your
  Account the **Team** plan's features for the length of the trial. It is
  limited to **one trial per Account and one per confirmed email address**. **When the trial period
  ends (currently 3 days, as stated on the billing page at the time you start),
  the trial simply ends: nothing is charged, and no payment is attempted.** Your
  Account then enters the frozen state described in Section 14: your projects,
  project keys and everything already measured stay in your Account, and
  subscribing at any time afterwards switches everything back on. You may end the trial earlier from the billing page. If you
  subscribe while the trial is still running, you are charged once at the
  ordinary price and the period you have paid for begins on the day the trial
  would have ended. The Maintainer emails the Account address when the trial
  starts, during the trial, and when it ends, and may withdraw or change trial
  offers at any time for Accounts that have not yet started one. Trials started
  before 19 September 2026 took a payment card, and where such a trial is still
  running the terms stated at the time it started continue to apply to it.
- **Fees are paid in advance.** Refund rights include Saudi seven-day
  rescission where applicable, the EU/EEA/UK withdrawal right below and
  mandatory remedies for failed or defective service. Otherwise fees are
  non-refundable unless the Maintainer grants a discretionary refund.
- **Accepting the renewal terms.** Before the card form appears, checkout asks
  you to tick a control whose own words state the recurring amount, how often
  it is taken, that it is taken automatically until you cancel, and where to
  cancel. Payment cannot be completed without it. The exact sentence you
  accepted, and the moment you accepted it, are recorded against that payment
  and restated in the receipt emailed to you, so what was agreed does not
  depend on what this page says later.
- **Saudi seven-day rescission.** Where Saudi Arabia's E-Commerce Law applies, Article 13 may give you seven days following the service-contract date to rescind, provided you have not used, received or benefited from the service and no statutory exception applies. For this hosted subscription, the service-contract date is the date payment is confirmed, not the date you first use it. Our working reading of use or benefit is actual use of paid functionality, such as processing telemetry using paid limits or opening paid reports; merely activating access, saving a card or ticking the immediate-start request is not, by itself, treated as a waiver. We assess the facts and applicable exceptions for the component supplied, rather than treating all hosted SaaS as downloaded software. Defective or non-conforming service and other mandatory remedies remain protected. To exercise the right, send a clear written rescission request identifying your account or payment and the contract date to Veqtara Tech Company, Rabwa District, Al Noaim Street, Riyadh, Saudi Arabia, or email support@boosthis.com. You do not need an account to write to us. We use when your request reached us, not when staff process it, to record whether it arrived within the seven-day window; this timing record does not itself decide eligibility. If entitled, you receive the full payment through Moyasar to the original payment method, without a deduction for processor fees. We initiate an approved refund promptly and within seven calendar days of confirming entitlement. Moyasar's published typical posting times are 24 hours to three business days for mada and seven to fourteen business days for credit cards; your issuer may take longer. Write to us if overdue. Rescission of the paid contract is separate from cancelling renewal, which stops future charges without itself refunding the current period.
- **Your cancellation window (EU, EEA and UK consumers).** If you are a
  consumer in the European Union, the European Economic Area or the United
  Kingdom, you may withdraw from a subscription within 14 days of making it
  without giving a reason. The checkout page asks whether you expressly
  request immediate service; starting an ongoing service does not by itself
  end your withdrawal right. If you request immediate service and then
  withdraw, a proportionate charge for service already provided may apply
  where the law permits; what you were asked and what you answered are recorded
  against the payment. Use the right by writing to the postal address in Part B
  within 14 days of payment, or email support@boosthis.com. This is separate
  from cancelling at any time from the billing page,
  which stops future charges and keeps your access to the end of the paid period.
- **Taxes and currency.** All Fees are charged in Saudi Riyal (SAR), and the
  SAR figure shown at purchase is the total amount charged; it does not change
  with how tax applies to your purchase. The Maintainer is not registered for
  VAT with the Zakat, Tax and Customs Authority (ZATCA), so no VAT is charged on
  any purchase and every purchase receives an invoice that carries no VAT.
  Before buying, you state your country and whether you buy as a person or for
  a company; a company gives its name and address, which its invoices name, and
  may add its tax or registration number. Anyone, in Saudi Arabia or outside
  it, a person or a company, buys at the same SAR price. A company outside
  Saudi Arabia accounts for any tax in its own country where that country
  applies a reverse charge. If the Maintainer registers for VAT, these Terms
  will say so before any invoice carries VAT, and the SAR figure shown at
  purchase will still be the total amount charged. Where a price is also shown
  in US dollars, that figure is an indicative conversion at a fixed rate and is
  never the amount charged: your card issuer converts the SAR amount at its own
  rate, which may include a fee.
- **Price changes.** The Maintainer may change plan prices or features; changes
  take effect at your next renewal, and any change to what you pay is emailed
  to you at least 14 days before the first renewal charged at the new price —
  a renewal falling inside those 14 days is charged at the old price.
  Continued renewal after a change means you accept it.
- **A plan arranged with the Maintainer.** A plan that is not sold through
  checkout, such as Enterprise, is arranged with the Maintainer in writing.
  The Maintainer places your Account on such a plan only after you have
  agreed to it, and to its price, by email, and records the day your
  agreement arrived. Nothing is charged for it before your next renewal,
  which charges its price to your saved card. When it is booked for that
  renewal you are emailed the plan, the amount and the date, and until that
  day you can keep your current plan instead from your billing page.
- **Non-payment never deletes your data.** A lapsed subscription freezes the
  Account as Section 14 describes: your apps' reports are refused, so nothing
  new is measured, and the dashboard's measurements, Ask Boosthis and traces
  are unavailable, but everything already collected is kept and can be
  downloaded through the data export, nothing is deleted, and full access
  returns as soon as a plan is active again.
- **A Payment Processor outage never downgrades you.** If the Payment Processor
  cannot be reached, your last known plan state remains in effect.
- **Complimentary access.** The Maintainer may grant free or complimentary
  access at its discretion; such access is a no-charge product under
  Section 16 and may be modified or withdrawn at any time.

## 16. Free, beta, and no-charge products

Parts of Boosthis may be provided at no charge — including free features,
trials, beta or pre-release versions (such as TestFlight builds of the mobile
app), and complimentary or maintainer-granted access (together, **"No-Charge
Products"**).

- No-Charge Products are provided **"AS IS", with no warranty, no support
  commitment, and no availability commitment**. They may be changed, limited,
  suspended, or discontinued at any time, and may never become generally
  available.
- Beta and pre-release versions are by definition unfinished and may contain
  defects; do not rely on them for production-critical decisions.
- IN PLACE OF THE CAP IN SECTION 12, THE PROTECTED PARTIES' TOTAL AGGREGATE
  LIABILITY ARISING OUT OF OR RELATED TO ANY NO-CHARGE PRODUCT WILL NOT EXCEED
  **SAR 50**. THIS CAP IS SUBJECT TO THE EXCEPTIONS IN SECTION 12, AND NOTHING
  IN THIS SECTION OVERRIDES THEM.

## 17. Confidentiality, publicity, and benchmarks

- Parts of Boosthis are **not public**. Non-public information you receive
  through it — including the contents of the rule book and fix corpus,
  non-public documentation, Project Keys and other credentials, non-public
  dashboards, roadmaps, and pricing not publicly listed — is
  **Confidential Information** of the Maintainer.
- You will use Confidential Information only to use Boosthis as permitted by
  these Terms, and will not disclose or publish it.
- You will not publicly disclose **benchmarks or comparative analyses** of
  Boosthis, and will not publicly announce or advertise your use of Boosthis
  (in marketing, press, talks, or public repositories), without the
  Maintainer's prior written consent.
- These obligations do not apply to information that becomes public through no
  fault of yours, to a published-app key built into a published app as
  Section 3 allows, or to information that you are required to disclose by law
  (with prior notice to the Maintainer where lawful). This Section survives
  termination.

## 18. Export controls and sanctions

You represent that you are not located in, or ordinarily resident in, any
country or territory subject to comprehensive sanctions or embargoes, and that
you are not on any government sanctions or denied-party list. You agree to
comply with all applicable export-control and sanctions laws in your use of
Boosthis.

## 19. Changes to Boosthis and to these Terms

- The Maintainer may modify, suspend, or discontinue any part of Boosthis. If
  it discontinues a paid feature during a period you have already paid for, it
  refunds the unused part of that period pro rata, through the same refund
  process as Section 15. Subject to that refund and to the exceptions in
  Section 12, it does so without liability.
- The Maintainer may update these Terms; the "Last updated" date will change
  with every update. A **material change** takes effect no sooner than **30
  days** after the Maintainer tells you about it, by email to your Account's
  address and with a notice on your dashboard. A change that the law requires,
  or that only adds to your rights, may take effect sooner. If you do not accept
  a material change, you may stop using Boosthis before it takes effect; your
  continued use after a change takes effect means you accept the updated Terms.
  A new use of personal data is added to Part B's list of uses, with its legal
  ground, before the use starts, and when that addition is a material change it
  takes effect only as described above. A use whose ground is your consent does
  not start until you give that consent, and a consent you gave never extends
  to a new use.

## 20. Governing law and dispute resolution

- These Terms are governed by the laws of the Kingdom of Saudi Arabia, without
  regard to conflict-of-laws rules.
- **Informal resolution first.** Before filing any claim, you agree to contact
  the Maintainer and attempt in good faith to resolve the dispute informally for
  at least 30 days.
- **Binding arbitration.** Any dispute, claim, or controversy arising out of or
  relating to Boosthis or these Terms that is not resolved informally will be
  finally settled by binding arbitration administered by the **Saudi Center for
  Commercial Arbitration (SCCA)** under its Arbitration Rules, before a single
  arbitrator, seated in Riyadh, Kingdom of Saudi Arabia, conducted in English
  unless the parties agree otherwise. The award is final and binding, and
  judgment on it may be entered in any court of competent jurisdiction.
- **Equitable relief.** Nothing in these Terms prevents the Maintainer from
  seeking injunctive or other equitable relief in any court of competent
  jurisdiction to protect its intellectual property or confidential
  information.
- **Attorneys' fees.** In any action or proceeding to enforce these Terms, the
  prevailing party will be entitled to recover its reasonable attorneys' fees
  and costs, in addition to any other relief awarded. This never applies
  against a consumer, as the next point explains.
- **If you are a consumer.** If you use Boosthis as a consumer — for purposes
  outside your trade, business or profession — nothing in this Section takes
  away a protection that the law of the country where you live gives you and
  that a contract cannot exclude, and you may bring a claim in the courts of
  that country instead of in arbitration. The choice of Saudi law applies to
  you only to the extent that it does not remove those protections, and the
  prevailing-party fees in this Section are never charged to you.
- **Time limit on claims.** A claim arising out of or related to Boosthis or
  these Terms must be brought within the period that the laws of the Kingdom of
  Saudi Arabia set for that kind of claim. These Terms do not shorten that
  period.

## 21. Severability

If any provision of these Terms is held unenforceable, that provision will be
limited or removed to the minimum extent necessary, and the remaining
provisions will remain in full force.

## 22. No waiver

The Maintainer's failure to enforce any provision is not a waiver of its right
to do so later.

## 23. Assignment

You may not assign or transfer these Terms, your Account, or your Project
Keys without the
Maintainer's prior written consent. The Maintainer may assign these Terms
freely, including in connection with a merger, acquisition, or sale of assets.

## 24. Force majeure

The Maintainer is not liable for any delay or failure caused by events beyond
its reasonable control, including outages of third-party infrastructure,
network failures, or acts of nature.

## 25. Entire agreement

These Terms (together with the `LICENSE`, the privacy policy in Part B, and
the **Data Processing Agreement** published at
<https://www.boosthis.com/processing>) are the entire agreement between you and
the Maintainer regarding Boosthis and supersede any prior understanding on the
subject.

**The Data Processing Agreement is incorporated into these Terms by
reference.** Where you install a Boosthis kit in your own application, Boosthis
processes personal data about your end users on your behalf: for that data you
are the controller and the Maintainer is the processor, and the agreement at
<https://www.boosthis.com/processing> is the written record of that
relationship — what we do with the data, on whose instructions, what happens at
the end, what help we give with a request or an incident, and what we commit to
on security. Accepting these Terms accepts that agreement; there is no separate
signature and no countersigned copy to chase. It states its own in-force date
and keeps every earlier revision listed, so which version you accepted stays
answerable later. The companies that receive anything are deliberately **not**
listed inside it — they are at <https://www.boosthis.com/subprocessors>, on the
notice period stated there, so a change of provider does not require amending
an agreement you have already accepted.

**Which document governs.** Where documents that form part of this agreement
say different things: the Data Processing Agreement governs the personal data
the Maintainer processes on your behalf; the renewal sentence recorded against
a payment, as described in Section 15, governs the amount and the billing
period of that payment; a written arrangement for a plan arranged with the
Maintainer overrides these Terms only where it says so expressly; and in every
other case these Terms govern. Between the English and the Arabic text of these
Terms, the English text binds, as the Language clause states.

**Language.** These Terms are written in English, and the English text is the
binding version. The Arabic translation is published only to help you read
them: it is not a second agreement or an authorised version, and if it differs
from the English text in meaning or in detail, the English text alone binds
the parties and is the one relied on in any dispute.

## 26. Notices

- Any notice you are required or permitted to give the Maintainer under these
  Terms must be given in writing, either by email to **support@boosthis.com**
  or by post to the registered postal address in the **Contact** section of
  Part B, and is deemed given when actually received. The registered postal
  address is a valid route for every notice to the Maintainer under these
  Terms, including any notice for which another passage names only the email
  address.
- The Maintainer may give you any notice under these Terms by email to the
  address on your account (if any), by a message or banner inside Boosthis or
  its dashboards, or by a note in the release notes; such notice is deemed
  given when sent or posted.
- **Complaints.** If you are unhappy with the Service, with a charge, or with
  how a request of yours was handled, write to the registered postal address
  in Part B (no account required), or email <support@boosthis.com> with
  "complaint" in the subject, saying what happened and what you would like
  done about it. Complaints are handled by the Maintainer directly — there is
  no separate department you are passed to. Yours is acknowledged when it is
  received and answered **within 30 days**; if an answer will take longer than
  that, you are told why and when to expect it. If the answer does not satisfy
  you, a consumer in the Kingdom of Saudi Arabia may also raise the matter with
  the Ministry of Commerce through its own consumer channels, and the dispute
  resolution route in Section 20 stays open to you either way.

## 27. Copyright and other intellectual-property complaints

**What this section is for.** Boosthis has no public feed, profile or gallery of customer material. Human-approved rule proposals can be delivered to other accounts, including title and fix text you or your connected AI submitted; Part B
sets out what the Maintainer holds and who can see it. A few paths do accept
material you supply — build and source maps you upload, the free text of a
rule you propose, messages to the "Ask Boosthis" assistant, mail to support,
and the display names you choose for a project or an app. If you believe
anything held on the Service infringes your copyright or another
intellectual-property right of yours, this section is how to say so and what
the Maintainer will do about it.

**Where to send a complaint.** Email <support@boosthis.com> with "copyright"
in the subject, addressed to the **Copyright Complaints contact, Veqtara Tech
Company**. The same complaint may be sent by post to the registered address in
the **Contact** section of Part B. That contact is published on the public
Terms page at <https://www.boosthis.com/terms> and in the Arabic reading of
these Terms, so a rights holder never needs an account to find it.

**What a complaint must contain.** So that the Maintainer can act on a
complaint rather than write back asking, include all of the following:

- your name, postal address, email address, and a telephone number where you
  have one;
- identification of the work you say is infringed — a copy, a link, or enough
  description to identify it;
- identification of the material on the Service you say infringes it, in
  enough detail to find it: normally the project, the install, the upload, or
  the exact text complained of;
- a statement that you believe in good faith that the use complained of is not
  authorized by the rights holder, its agent, or the law;
- a statement that the information in the complaint is accurate and that you
  are the rights holder or are authorized to act for them; and
- your signature, electronic or physical.

A complaint missing something is not discarded. The Maintainer will say what
is missing and hold the complaint open until you answer.

**What happens next.** The Maintainer acknowledges a complete complaint once
received. Where it concludes the material is likely infringing it
removes or disables that material, and tells the customer who supplied it what
was removed, why, and that they may reply. Where an approved rule was served to other accounts, removal disables its future delivery; other material may be deleted from the Maintainer's systems. Approved rule text may reach other accounts. The Maintainer may act sooner, and
without waiting for a reply, where a complaint is plainly well founded, and
may refuse a complaint it concludes is not well founded, saying why.

**Counter-notice.** If your material was removed and you believe that was
wrong, email the same address with "copyright counter-notice" in the subject,
or send it by post to the registered address in the **Contact** section of
Part B. Identify what was removed and where it was, say why you believe the removal
was a mistake or a misidentification, and give your name, postal address,
email address, and signature. The Maintainer passes a counter-notice to the
complainant. Where the complainant does not say within **10 business days**
that it is taking the matter further, the Maintainer may restore the material;
where restoration is impossible because the material was deleted, it will tell
you so rather than leave you waiting.

**Repeat infringers.** An account that is the subject of repeated upheld
infringement complaints has its access terminated under Section 14, and the
Maintainer may revoke its Project Keys under Section 5. What counts as
repeated is a judgement on the facts rather than a counter: one deliberate,
large-scale infringement can be enough, and a complaint that is not upheld
never counts toward it.

**Misusing this channel.** A complaint made in bad faith, or a
misrepresentation that material is infringing, is itself a breach of Section 5
and may cost you your account. It may also leave you liable to the person
whose material was removed.

**This is a process, not a forum.** Nothing in this Section changes Section 20,
which continues to govern these Terms and every dispute under them. Where the
law of a country the Maintainer is subject to prescribes a particular
procedure for such complaints, that procedure applies in addition to this one;
this Section is the floor, not the ceiling.

## 28. Applications directed at children

**The case this Section is about.** Section 1 sets the age at which you may
hold an account and the age at which you may buy a Paid Plan. Neither says
anything about the people who use *your* application. Boosthis measures your
application while real people are using it, and your application may be
directed at children. That is your decision, and these are the terms on which
you may make it while running Boosthis.

**Yours, not the Maintainer's.** Where your application is directed at
children, or you know that children use it, you are the party responsible for
every notice and consent the law where your users are requires — including any
verifiable parental or guardian consent — before Boosthis runs inside it and
sends measurements. The Maintainer has no relationship with your users, cannot
see who they are, and cannot obtain a consent on your behalf. Part B and the
Maintainer's published statement of what the toolkit collects, at
<https://www.boosthis.com/docs/what-boosthis-collects>, give you the facts you
need to describe Boosthis accurately in your own notice; neither tells you
what your notice must say.

**What you must not send.** The prohibition in Section 5 on sending personal
data through Telemetry applies to your users' personal data whatever their
age, and applies with no exception to a child's. Do not put a user's name,
email address, account identifier, or any other value that identifies a person
into a route label, a screen name, a job name, a project or application
display name, a rule proposal, or any other field the toolkit carries. Those
fields are for labels, not values, and the Maintainer holds what arrives in
them as written.

**Telling the Maintainer an application is child-directed.** You may tell the
Maintainer that a project's application is directed at children by emailing
<support@boosthis.com> with "child-directed" in the subject and naming the
project, or by writing to the registered postal address in Part B. On receiving a child-directed report, the Maintainer will review the project's settings and work with you to disable optional detailed modes; there is not yet an automatic child-directed lock. Do not enable optional detailed modes for a child-directed project. Request project telemetry erasure explicitly and provide the project reference; a guardian should contact you, as only you can identify your user. The Maintainer handles project erasure requests from you; guardians should contact you about user-specific requests. The Maintainer does not verify the statement and does not police your
application — Section 5 says why it cannot.

**Where the Maintainer learns of it another way.** If the Maintainer comes to
believe that data identifying a child has reached it through your Telemetry,
it may delete that data without notice, suspend the affected project's
reporting, and require you to confirm what you have corrected before
reporting resumes. No refund is due for a suspension under this Section.

---

# Part B — Privacy Policy

**Boosthis is a developer toolkit.** It runs inside your
own app on your own machine. For a **general install**, nothing leaves your
device. For a **registered app**, the kit reports the readings described below
— issue & fix signals, crash reports, and the measurements your project's own
pages are built from — and Boosthis uses them for the uses listed in one place,
under "The legal ground for each use": your project's dashboard, alerts,
reports and emails, the AI connections you set up, the "Ask Boosthis"
assistant, and the shared rule book. See exactly what is sent, and every way it
stops, below. To use the hosted web and mobile dashboards and manage billing,
anyone can create a **developer account** (name, email, and password) — what we
store for an account is described under **"Account data"** below. A registered
app reports under a project key that belongs to an account, so what it reports
is tied to that account and is shown to it and to its teammates.

> **Scope of this policy — please read.** Boosthis's role is stated one way
> only. For the data a registered kit reports about your end users, you are the
> controller and the Maintainer is the processor, under the Data Processing
> Agreement incorporated in Part A, Section 25; for your own developer account,
> the Maintainer is the controller. The kit itself is a library that runs inside
> your application's own process, so everything else your application handles
> stays yours alone and never reaches us. The PII protections described below
> are **best-effort defences against common identifier and secret field
> names** — they are not a substitute for the host application's own privacy
> review, Data Protection Impact Assessment, or compliance posture. Treat Boosthis samples like any other application log:
> review what your code puts into route names, metadata fields, and exception
> messages before exposing them to AI tools or third-party endpoints.

> **Use at your own risk — limited liability for data exposure.** Boosthis is
> provided **"as is," with no warranty of any kind**, and you use it at your own
> risk, within the limits and exceptions of Part A, Sections 11–12: liability
> for fraud, gross negligence, wilful misconduct, harm to a person, or anything
> the law does not allow to be limited is never excluded, and the security
> measures described below still apply. Because Boosthis runs inside your own
> application, **you remain responsible** for the data your app handles, for
> what you place into route names and metadata, and for reviewing any
> AI-suggested change before you ship it — except where a failure on Boosthis's
> side, such as a key Boosthis exposed, caused the problem.

Boosthis sends two very different things, and they are controlled differently.
This document tells you exactly what each is, what is never sent, what it is
used for, and how to stop it.

> **1. Issue & fix signals — always on for registered apps.** Once your app is
> registered, Boosthis automatically
> reports the *candidate rule signatures* and *fix-resolution signals* described
> below (rule kind + bucketed severity + bucketed count, plus a before→after
> rating bucket when an issue is fixed). This is how the shared rule book
> improves, and it is **not** a per-app on/off setting — `disableTelemetry()`
> does not turn it off. It stops in each of the ways listed under "Every way
> reporting stops" below: your app's user switching Boosthis off on their device,
> a frozen plan, a switched-off project key, erasing your data (`forget`), or the
> emergency kill-switch `BOOSTHIS_DISABLED=1`. This applies **only** to
> registered apps — a general install reports nothing.
>
> **2. Full performance details — optional, off unless you turn it on.**
> Separately, you may switch on fuller per-route performance samples (route
> label, duration, rating) by calling `enableTelemetry()` /
> `boosthis.enable_telemetry()`. This is the **only** channel that
> `disableTelemetry()` / `boosthis.disable_telemetry()` controls — turning
> telemetry "off" stops these full samples but does **not** stop the always-on
> issue & fix signals above. The per-sample "Route label" and "Duration" items
> below apply only to this full-details mode. Route and screen labels also travel
> outside it, with the other readings that name one — the screen or route a
> crash happened on (always on), the page map and the health-meter snapshot (on
> switches of their own), and the steps of a trace — each described where it is
> listed. In issues-only registrations
> (`issuesOnly: true`) this channel is never enabled: `transmit()` is a hard
> no-op and the production sampler is never granted consent.
>
> The emergency kill-switch `BOOSTHIS_DISABLED=1` silences the entire runtime —
> issue signals included — and always wins over everything else.

## What we use your data for

Every use we make of your data is listed in one place: the table under "The
legal ground for each use" below, with the ground each use rests on. Nothing
elsewhere in this document adds a use. What a registered app reports runs your
project's own dashboard, alerts, reports and emails, the AI connections you set
up and the "Ask Boosthis" assistant — for that, the Maintainer works as your
processor, as the note under that table says — and it improves the Boosthis
rule book: new rules, better thresholds on existing ones, and patterns that
recur across many apps, caught in the next release of a kit or straight away
through the rule book Boosthis serves over its API.

We do **not**:

- Sell your data to anyone, ever
- Share it with advertisers, data brokers, or marketing platforms
- Use it for advertising, profiling, lead generation, or any purpose the table
  does not list
- Train general-purpose AI / large language models on it
- Use it to single out or profile any of your app's users

A new use is added to that table before it starts, under the rule for changes
to these Terms in Part A, Section 19.

## Ownership of what you send

Everything you send to Boosthis (the "Telemetry") is **assigned to Boosthis**,
except personal data. You waive any ownership claim over the issue & fix signals
and the optional full performance samples, and over any rules or improvements
derived from them — even if you turn on full data mode. Where a piece of
Telemetry can relate to an identifiable person, nobody owns it under that
assignment: it stays under the Data Processing Agreement and this Part B, the
person keeps every right described below, and an erasure erases it. What
Boosthis owns is what it builds with the person taken out — rules, fixes,
signatures, thresholds, aggregated statistics, and rule-book submissions. This
covers only what you send, never your source code or application. The full
clause is in **Part A, Section 7 (Ownership and assignment of Telemetry)**.

## What we collect

- **An install ID** — a random UUIDv4 generated on your machine the first time
  your app registers. It is made from nothing about your users, their devices,
  your IP or your hostname. It is linked to the project key the install
  registered with, and so to the account that holds that key: that link is how
  your dashboard, alerts and AI connections show you your own installs.
- **Candidate rule signatures** (auto-submitted; always on for registered
  apps) — when the engine sees a recurring perf pattern that doesn't map to any
  shipped rule, it produces a privacy-safe signature of the form
  `<detector-kind>:<severity-bucket>:<count-bucket>` (e.g.
  `ghost-mount:med:<10`): the detector kind, a 3-level severity bucket derived
  from p95, and a coarse occurrence-count bucket. The screen or route name is
  never part of the signature. The Node and browser kits send it beside the
  signature: each of their submissions says where the latest sighting was —
  the code-defined route or screen label, put through the same identifier
  guard as every label, or, where it cannot be named, a reason from a fixed
  list (no screen or route was open, the kit does not track them there, or the
  label was refused). The other kits send no screen or route with a signature.
  The runtime auto-submits these signatures
  the moment they cross the local recurrence threshold — you don't have to click
  anything, and turning telemetry "off" does not stop them (see "Every way
  reporting stops" below). For a general (unregistered) install, nothing ever
  leaves your device. Server stores one row per `(install, signature)` — repeat
  submissions of the same signature from the same install just bump a counter.
- **Fix-resolution signals** (auto-submitted; always on for registered apps) —
  when a rule the engine was tracking later **improves** (its severity bucket
  drops, e.g. a screen that was rated `poor` becomes `needs-work` or `good`),
  the runtime auto-submits a privacy-safe *resolution*: the rule and its kind,
  the before→after **rating bucket only** (`good` / `needs-work` / `poor`), how
  many times it was seen, and the severity and count buckets it was proven
  under. This is "the fix landed" metadata, **not the fix itself** — a
  resolution carries no source code, diffs, file paths, screen names,
  durations, or any values. The server stores one row per `(install, rule)`.
  Like candidate signatures, it is not user-toggleable; it stops only in the
  ways listed under "Every way reporting stops" below.
- **Crash reports** (auto-submitted; always on for registered apps) — when your
  app hits an uncaught error, an unhandled promise rejection, a render crash, a
  crash inside a background job, or — on Android and Apple — a native crash or
  an "app not responding" kill that the operating system recorded,
  Boosthis records a privacy-safe **crash code**: the error *type* (e.g.
  `TypeError`), a **redacted code location** (the top stack frame reduced to a
  function name + file *basename* + line number — never an absolute path, URL,
  query string, argument, or value), where it came from beyond that top frame
  (that no stack came with the error at all; which part of the framework caught
  it, as a word from a fixed list; for a Flutter debug or profile build, the
  file *basename* + line of the widget the framework named as the cause; the
  **first frame in the app's own code**, reduced the same way, when the top
  frame is in the framework, the language SDK or another package; and that it
  came from a debug build — which packages are the app's is decided on the
  device and never sent), a stable hashed signature derived **only**
  from those code-defined tokens (never from the error message text), and an
  occurrence count (how many times that same crash has recurred since the last
  report). Every crash report, always on and not only in detailed crash mode,
  also says **where in your app it happened**: the code-defined label of the
  screen or route that was open, put through the same identifier guard as every
  label, or, where none can be named, a reason from a fixed list (no screen or
  route was open, the kit does not track them there, or the label was refused).
  **Website crash cause facts** are sent by default with every crash report:
  a word from a fixed list for the kind of mistake — read a value from nothing;
  used a name that is not defined or not ready yet; called something that is
  not a function; a request failed and nothing caught it; data could not be
  read; a code file from another release failed to load; storage was full or
  refused; the browser blocked an action; the browser hid the details; or not
  recognised. The kit decides on the visitor's device from the error's wording;
  the wording itself stays there. For a name not defined, something not a
  function, or reading from nothing, it also sends the one variable, function
  or property name the browser printed from the site's code, if it is shaped
  like a code name (letters, digits, _ and $, in at most five dot-joined
  segments and at most 80 characters) and passes both the identifier guard and
  the route-label guard; otherwise it sends a word saying the name was withheld
  or not printed. This is the same kind of fact as the function names in crash
  locations: a code name, not a value or any other part of the message.
  A word from a fixed list also says whose code was running: written into the
  page itself, a file on the site's own address, the store platform's own
  scripts, a named outside service, another address, or no address. For the
  store platform or a named service, it names which service from the fixed list
  of platforms, backends, ad pixels, tag managers, analytics, chat widgets,
  store apps and public code libraries. That decision is made on the device
  from the full file address, which stays there. For an error with no stack,
  the browser's file name and line are cut back like every other redacted code
  location. The mistake word and code name are not part of the crash signature.
  Boosthis also keeps a count per screen or route label for each crash, keeping
  the twelve largest, and counts website crash reports by browser family as
  described under "Where an IP address or browser description goes".
  Where the crash happened in the middle of an action the kit was tracing, it
  also carries that action's **trace reference** — the 32-character trace id
  and, where there is one, the 16-character id of the step in flight — the same
  random references described under "Reading your own data back" below, so
  the crash can be placed in that action rather than only by time. This is the
  minimum Boosthis needs to identify
  and fix the crash — it is the crash's *code* and its place in your app, not
  your users' data, your values, your message text, or your source, all of
  which are dropped. Like every
  other finding, a crash Boosthis records and the fix it derives become a Boosthis
  rule (see Part A, Section 7). The server stores one row per
  `(install, signature)`; repeats just bump a counter. Beside it, Boosthis keeps
  a day-by-day record of each crash — the UTC day it happened, how many times,
  how many of those were dated by arrival, and the environment the project had
  declared — so it can say whether a crash stopped or came back; that record
  is shown to you, included in your data export, and kept for 200 days from
  the day it records. Not user-toggleable — it stops only in the ways listed
  under "Every way reporting stops" below — and nothing is ever sent for a
  general (unregistered) install.
  A crash that cannot be sent at once waits on the device. The phone and native
  kits (React Native, Flutter, Android and Apple) keep an unsent crash in the
  app's own storage, offer it again at the next launch, and drop it unsent once
  it is 30 days old. The browser kit keeps an unsent crash in the site's local
  storage for up to 30 days in the same way, and beside it a short crash
  history: for each recent run of a page, when it started and was last seen,
  when each crash in it happened, and how many errors it set aside as a browser
  extension's or a browser notice rather than the app's — counts only, nothing
  about which extension — pruned to the last 24 hours and to at most 32 runs.
  Both are described under "What the toolkit stores on a device" below.
  A current kit also sends a short-lived, non-readable fingerprint for each
  crash batch so a lost response can be retried without double-counting. When
  Boosthis refuses a batch, it keeps the same fingerprint with how many crash
  occurrences the batch carried, so a refused batch offered again is counted
  once and is recognised if it is accepted later. This operational
  duplicate-suppression metadata is not customer history, is excluded from
  exports, is kept for no more than 30 days, 1,024 receipts and 10,000 refused
  batches per install, and is erased with the install.
  For a native crash or a not-responding kill, the Android kit (Android 11 and
  later) and the Apple kit (iOS 15 and later) read the operating system's own
  record of the app's death at the next launch, and send only which of the two
  it was, the signal or exception-type name (e.g. `SIGSEGV`, or `ANR`), a fixed
  placeholder in place of the code location, and when it happened — never the
  system's description of the death, process or thread names, memory details,
  or the native stack. An error the app caught and survived is not a crash: the
  phone and browser kits do not send it as one.
  A kit may also state *when* each crash happened. Boosthis keeps that time only
  when it is plausible — never later than the upload arrived, never earlier than
  the install registered — and otherwise dates the crash by when it reached us,
  recording which of the two clocks dated it.
  When Boosthis refuses a crash upload (a credential it does not accept, an
  account being closed, a rate limit, a project not accepting data, or a crash
  kind it does not know), it keeps a small record of its own decision against
  the install: the reason; how many crash reports and uploads it refused,
  retries included; how many refused batches it counted once and the crash
  occurrences they carried, and how many of those batches and occurrences
  arrived later; how many uploads could not be told apart from their own
  retries and the crash reports they carried; and when the first and the
  latest refusal arrived, when it began counting each batch once,
  and when its record of refused batches was full. That record carries nothing
  your app sent except the install ID, is shown to you on the project page and
  included in your data export, is kept for 90 days after the latest refusal it
  counts, and is deleted with the install.
- **Learning from experience — new bugs, issues & fixes** (auto-submitted;
  always on for registered apps) — when Boosthis runs into a slow or buggy
  pattern it doesn't yet have a rule for, it may send a small, privacy-safe
  note about the *kind* of problem: the runtime, a coarse category, a severity
  bucket, a timing bucket, a hashed signature, and a recurrence count. Exactly
  like a candidate rule signature, this is buckets and a hash — **never** a
  screen name, a value, your users' data, or your source. If you have connected
  your own AI to Boosthis, that AI may additionally attach a *suggested* rule (a
  short title, when it applies, and a suggested fix); every part of a suggestion
  is put through the same PII / secret / URL guard before it leaves the device,
  and it is assigned under **Part A, Section 7** (anything arriving outside that
  Section's doorways is covered by the feedback licence in **Section 8**).
  **Nothing a consumer sends ever becomes a live rule automatically** — a
  suggestion only lands in the maintainer's private review queue, and a human
  decides whether it becomes a rule. An approved suggestion may be served **as
  written**, straight away through the API, rather than waiting for a kit
  release (see "How candidate rules become real rules" below and
  **Part A, Sections 7–9**).
- **Package version + runtime** — e.g. `boosthis 0.2.0 (py)`.
- **Where a server runs** — when a server kit registers, the hosting platform
  it recognised from the markers that platform publishes about itself, as a
  word from a fixed list; the region code the platform declares, such as
  `us-east-1`, as the platform wrote it; and whether this is production, a
  preview or development, or unknown where the platform does not say. It is
  what keeps a preview's numbers from being shown as your live app's. A server
  kit release that reports it also sends the operating system family the
  server runs on — one word from a fixed list: `linux`, `macos`, `windows`, or
  `other` for anything else — and a word not on that list is dropped. It is a
  family, not a version or a machine name. Never a hostname, an address or any
  other value read from the machine.
- **Your application's own version** — on a phone, read straight out of the
  build your app shipped in (`CFBundleShortVersionString` on iOS,
  `versionName` on Android) and sent **beside** the Boosthis version above,
  never merged with it. It is the version string you ship and nothing else:
  not the build's contents, not its signing identity, not a build number, not
  anything about the device.
- **The releases your project declares** — when a release of your app goes
  out, your app, a deploy script, a build step or you on your dashboard can
  tell Boosthis so, from any runtime: the version string as given (at most 60
  characters, screened like every other name), when it shipped, how it was
  declared (through the install's own credential, on the dashboard, read out of
  a phone build, or handed to the kit by your app) and when it was first and
  last declared. Declaring the same version again moves only that last time,
  and an install can hold at most 200. Nothing about what the release
  contains. Kept while the project is on the service; you can withdraw one
  yourself, and all of them are deleted when you erase the project (`forget`)
  or close your account.
- **Scheduled job names, and how each run went** — if your app runs work on a
  schedule, the job's name as written in your source, how long each run took,
  whether it succeeded, and — if your code states one — how often it should
  run. Never an argument, a payload, a result, a log line, or anything the job
  touched.
- **Anonymous daily reach tag (React Native)** — a small random value your
  device mints fresh each calendar day, **never** derived from your device,
  user, account, or install ID. The server folds it into a coarse rolling
  estimate of roughly how many distinct devices hit the same issue this week
  ("≈1", "≈2–9", "≈10+") and **never stores the tag itself**. Because it
  rotates daily it cannot track a device across days, and erasing your data
  (`forget`) also deletes the tag on your device.
- **Anonymous daily visit tag (browser kit 1.0.0-alpha.146 and later)** — a
  small random value each visitor's browser makes fresh every UTC day,
  **never** derived from the visitor, the browser, the device, the page, an
  account, or the install ID. It rides, as one header, the uploads and the
  registration the browser kit already sends — no request is added — beside the
  install ID and the kit version. The server folds it into estimates of roughly
  how many browsers sent readings to your site that day, how many were refused,
  and which kit versions they ran, and **never stores or logs the tag itself**.
  Because it changes every UTC day it cannot link a browser across days. Where
  the browser lets the kit keep its storage, the day's value is kept there;
  where it does not, each page load makes its own and is counted apart, never
  added to the browser count. Erasing your data (`forget`) deletes it from the
  browser, and a visitor who switches off the kit's storage on their device
  erases it with everything else the kit keeps there.


### The names you choose yourself

Neither of these is sent by every install, so they are listed apart from the
section above rather than inside it:

- **The name your app registers under** — sent only if your own code or build
  gives the kit one. The field is optional, and an install that sends none is
  listed by its identifier instead.
- **The name you type for the project** — typed on your Boosthis dashboard and
  sent by nothing. No kit ever sees it.

Both are held **as written**, apart from surrounding spaces being dropped and a
60-character clamp. Nothing else normalises, rewrites or shortens them, because
a rewritten name would make your dashboard, your alerts and our AI answers
disagree with one another. They are free-text fields: **a name containing a
person's name is held as written**, so choose them as you would any label you
publish internally. Two things do happen to a name on the way out — one
carrying a value rather than a label (an address, a phone number, a token or a
long numeric id) is withheld from answers rather than repeated back, and a
registration whose name trips the same identifier guard that screens telemetry
is refused at the door rather than stored.

### Only in the optional full-details mode (`enableTelemetry()`)

These are sent **only** if you explicitly switch on full performance samples,
and they stop the moment you call `disableTelemetry()` /
`boosthis.disable_telemetry()`:

- **Route label** — the code-defined name of the function or route you
  instrumented (e.g. `/api/users`, `get_orders`). Boosthis's PII guard refuses
  to transmit this field if it contains an email, IP, JWT, phone number, or
  other identifier. If you put user content in your route names, the sample is
  dropped.
- **Duration in milliseconds.**
- **Rating** — one of `good`, `needs-work`, `poor`.
- **Rule ID** (optional) — if you attached a Boosthis rule to the sample.

The page map described below is **not** one of these fields: it has a switch of
its own and travels with the health-meter snapshot, on either of that
snapshot's two switches.

### The page map (web and React Native)

Boosthis's server can already draw the map of an app's *server* side, because
it can see the calls one part makes to another. It cannot see the front: a
browser page or a phone screen moving to another one makes no request, so
nothing tells the server that your checkout screen is reached from the basket
and never from search. The page map is the front half of that picture, and the
browser and React Native kits are the only ones that can draw it.

It is drawn **progressively, from your app's own traffic** — it is whatever
paths people have actually walked, not a route table read out of your config —
and it is a picture of how your app is navigated **now**, not a history: each
upload replaces what that copy of your app previously said.

**What travels: the route labels of the screens your app moves between, and
which of them leads to which** — the same code-defined labels as the route
label above, in pairs, with a count of how often each path was taken. They go
through the same PII guard, so a label carrying an email, IP, token or other
identifier is refused exactly as a sample's would be.

**What never travels: the name or caption of any control, and the gesture that
moved you.** Not "the *Pay now* button", not "swiped", not "tapped at these
coordinates". This is not a setting you could turn the wrong way — the kits
have no wire shape that can carry those things, so they cannot be swept along
by accident. Nothing about who navigated, when they did it, or what they typed
is collected either.

**It has a switch of its own, and it rides the health-meter snapshot.**
In the browser kit from version 1.0.0-alpha.144, and in the React Native kit
from version 1.0.0-alpha.297, it is on unless your own code turns it off
(`sendPageMap: false`); an older React Native kit sends it only when your own
code asks for it (`sendPageMap: true`). Nothing we send back can turn it on or
off. With it on, the map travels with the
snapshot described below and on that snapshot's two switches: it is sent only
when full details are on, or when you explicitly switch on meter sharing so a
connected AI can read the live picture. In issues-only mode with neither of
those on, no map leaves the device. `disableTelemetry()` /
`boosthis.disable_telemetry()`, `forget` and `BOOSTHIS_DISABLED=1` each stop
it. A path that stops being reported is
deleted after 45 days, and `forget` deletes your map immediately along with
everything else that project sent.

### Health-meter numbers (the dashboard meter page)

Boosthis scores your app on a set of named **health meters** — the tiles you see
on the dashboard (the boot ladder, Speed, Smoothness, Scroll, Stability, Render,
Frustration and Idle, plus the runtime-specific meters such as event-loop lag,
garbage-collection pressure, memory growth, worker health and startup cost). The
whole meter page is captured as one small snapshot so you — and an AI you choose
to connect — can read your own numbers back.

It rides the **same optional full-details channel** as the samples above: the
snapshot is uploaded only when full details are on, or when you explicitly switch
on meter sharing so a connected AI can read the live picture. `disableTelemetry()`
/ `boosthis.disable_telemetry()`, `forget`, and `BOOSTHIS_DISABLED=1` all stop it.

Every meter reports the same three things and nothing else:

- **A score** (0–100) and a **rating bucket** — `good`, `needs-work`, or `poor`.
- **A handful of plain numbers** — counts, timings, rates, percentages and sizes.
  For example: milliseconds spent loading modules before startup finished and how
  many modules were loaded, kilobytes of memory growth per request, worker
  restarts per hour, subprocess spawns per minute, how many errors were logged in
  the window, queue and lock waits in milliseconds, garbage-collection pauses,
  pending task counts, thread and worker counts, hours of heap headroom left,
  megabytes read from and written to storage, major page-fault and
  context-switch counts, or how many open descriptors are sockets versus files.
- **Nothing else.** No message text, no log lines, no file, module, thread,
  worker or command names, no source code, no values from your app, and nothing
  about your users.

**The meter set grows over time, and the boundary does not.** New meters ship
regularly and they differ per runtime (a Python service reports things a browser
cannot, and the other way round). Every meter — the ones shipped today and the
ones added later — stays inside the same limit: a score, a rating bucket, and
numeric counts and timings. That limit is enforced, not just promised. The server
keeps a fixed allowlist of numeric meter fields, silently drops any field that is
not on it, and rejects any allowlisted field whose value is not a plain number —
so no prose can ride in a slot that should hold a measurement. Even the one-line
caption a kit computes for its own on-device display is dropped at the door and
rebuilt on our side from the numbers. A genuinely new *category* of data would
require a change to this document, not just a new meter.

Two promises spelled out, because these meters count things that sound sensitive:

- **A logged-error meter counts errors; it never carries the log.** We receive
  how many errors your app logged and survived during the window and the rate per
  hour — never the message, the log line, the logger name, the level, the stack,
  or any value.
- **A subprocess meter counts spawns; it never carries the command.** We receive
  how many subprocesses were spawned per minute and the total for the window —
  never the command line, its arguments, its path, its environment, or its
  output. In the same way, thread, worker, handle, timer, module and descriptor
  meters report only *how many*, never their names — a descriptor meter says
  how many open descriptors are sockets, pipes or files, never what any of them
  points at.


### The whole route list (the app map, including pages nobody visited)

Alongside the meter snapshot, and on **exactly the same two switches**, some
kits send **the list of routes your app has** — not only the ones traffic
reached. The kit asks your own running framework for its route table (Express,
Fastify, Koa and Hapi; FastAPI, Starlette, Flask and Django; Vue Router,
React Router or Angular Router if you hand the kit your router; React
Navigation on React Native if you hand the kit your navigator's screen
configuration). It is a question
put to a running framework through the framework's
own interface. **Boosthis never reads your source code, never opens a file of
yours, and never crawls or clicks through your app to discover pages.**

**Be aware of what this adds, because it is the one thing here that travels
before any traffic does.** Until now, a route label only reached us because a
real request went to it. A route list includes paths your traffic would never
have revealed — an admin page, an internal webhook, a feature not launched
yet, a route left behind. If the *existence* of a path is sensitive to you,
this is the setting to turn off.

- **What each entry is.** A code-defined route template and nothing else — for
  example `GET /orders/:id`, `/admin/users/<int:user_id>`, or a screen name
  like `Checkout`. Parameters arrive as the template your framework holds, so
  a real order number or user id is never in it. Each entry also records
  whether it came from the framework, from a list you declared by hand, or
  both.
- **What each entry is not.** No timings, no counts, no scores and no ratings
  ride on a route the kit has not measured — an unvisited route carries a
  name and nothing else. We never send query strings, handler names, file
  paths, source, or anything a request carried.
- **The same guard, and a stricter disposal.** Every label goes through the
  same PII guard that governs route labels on samples. A label that fails it
  is **dropped entirely** rather than redacted, because a redacted route
  would otherwise draw on your map as a page of your app.
- **It is capped, and says so.** At most 200 routes travel; the list states
  how many the kit found, so a larger app reads as "at least this many"
  rather than as a complete picture.
- **How to turn it off.** `BOOSTHIS_ROUTE_LIST=0` (Node and Python), or
  `setRouteListEnabled(false)` (browser and React Native). With it off, the
  kit says so rather than going quiet, so your map can tell "switched off"
  from "this kit cannot ask". `disableTelemetry()` /
  `boosthis.disable_telemetry()`, `forget`, and `BOOSTHIS_DISABLED=1` all stop
  it like everything else.
- **Where it cannot be done at all.** Only the kits named above can ask. Every
  other runtime's map shows the pages traffic reached and says so on the page,
  rather than implying your app has no others.
- **A quiet route is never called broken.** A route the framework lists and
  traffic never reached is shown as **not seen** — never "dead", "unused" or
  "broken". We cannot know why it is quiet, and we do not guess.


### The controls on a page (the pins on the map)

On **exactly the same two switches** as the meter snapshot, a kit that lives
inside a rendered interface also sends **a count of the controls on a
rendered page** — and which of them have never been pressed. It is the same
question the route list puts to your framework, one level down: the kit is
already inside your page, so it asks the page how many interactive elements
it has. **Boosthis never reads your source code, never opens a file of yours,
and never crawls, clicks or drives anything to discover controls.**

**Structure travels; text never does.** Every product that can tell you which
button is broken earns that by recording the user's screen. This one does not
look.

- **How a control is identified.** By **a hash of its position in the page**
  and nothing else. Not its text, not its label, not its accessibility name,
  not its value or placeholder, not its id or class — nothing a person typed
  is read at all, and what travels is a short opaque string no name, id or
  value can produce. Boosthis has a count and a set of positions, and **no
  name for any of your controls**.
- **What rides alongside it.** Only what kind of control it is, from a fixed
  list of five words (press, link, field, choice, other), whether it has been
  pressed while Boosthis was watching, and whether pressing it opened another
  page. Where it did, **the route name a control was seen to open** travels —
  a route name of exactly the kind your app already sends, through exactly
  the same guard, dropped entirely rather than redacted if it fails. A
  control that was pressed and left you where you were records that it
  stayed, which is a fact about the control and not a fault with it.
- **Which control was pressed and did nothing.** A kit inside your page has
  always counted how many presses on it did nothing at all — no navigation,
  no change, no scroll. That whole-page count is unchanged. What is added is
  *which control it was*: alongside a control's position, the entry carries
  **a count of presses that did nothing**, a count of presses that changed
  something, and a count of presses the kit could not judge either way. A
  control that changed something is reported as having **responded** — never
  as *correct*: Boosthis sees that something changed, never whether it was
  the right thing. Nothing about the press itself travels: no coordinate, no
  time of day, no order, nothing about the person who made it. A press we
  could not attribute is counted apart from both and never as a fault.
- **It is capped, and says when it stopped early.** **At most 300 controls**
  travel individually. The scan also stops on a very large page, or at its
  own few-millisecond budget, and says which — so the count reads as "at
  least this many" rather than as the whole page. A control behind a closed
  menu or an unopened dialog is not rendered, so it is not in the count.
- **How to turn it off.** `setControlCensusEnabled(false)` (browser and React
  Native), or `BOOSTHIS_CONTROL_CENSUS=0`. With it off, nothing about controls
  is collected at all, and the kit says it is off rather than going quiet, so
  your map can tell "switched off" from "this kit cannot ask".
  `disableTelemetry()`, `forget`, and `BOOSTHIS_DISABLED=1` all stop it like
  everything else.
- **Where it cannot be done at all.** Only a kit inside a rendered interface
  can ask. The React Native kit sends the block and says in it that it sees a
  control was pressed but not *which* one — its touch observation carries a
  timestamp and nothing else, so it reports no dead presses against any
  control rather than a number you could not act on. For every server-side
  kit — Node, Python, Java,
  Go, PHP, .NET, Ruby, Rust, Elixir and edge — there is no interface to ask,
  so **nothing at all is sent**, and your map says that in words for that
  part of your app rather than showing a page with no controls on it.
- **An unpressed control is never called broken.** A control the page has and
  nobody has pressed is shown as **never pressed** — never "dead", "unused"
  or "broken". We cannot know why it is untouched, and we do not guess.

### What the phone platform allows (phone apps only)

The four phone kits — React Native, Flutter, Swift/iOS and Android/Kotlin —
report, alongside the meter snapshot and on **exactly the same two switches**,
a short closed list of observations about **what the operating system let the
app do**. Nothing here is about your app, your handset, or the person holding
it.

Why it exists: a phone app is held to more rules than any server — background
execution windows, doze and app-standby, per-app memory ceilings the system
enforces by killing you, timers that quietly stop — those rules changed with
almost every OS release, and the published documentation is frequently wrong.
So each kit records what actually **happened** on the platform it was running
on, we pool it across installs, and the rules Boosthis gives you for phones are
then written from what the platform really does rather than from what it says
about itself.

Exactly this travels, and nothing else:

- **The platform's name and one version number** — the operating system word
  (`ios`, `ipados` or `android`) and either the iOS major version or the
  Android API level. The version is here for one reason: a rule that changed
  between two OS releases, filed under a single name, is a *wrong* answer
  rather than a vague one. Both are read from the operating system's own
  version report; nothing is inferred about the handset.
- **The manufacturer — Android only, and only from a short fixed list** —
  Samsung, Xiaomi, Google, Sony and a handful of others whose own battery
  management genuinely changes whether a background job runs at all. A maker
  not on the list is dropped rather than sent, because a rare name is closer to
  naming one handset than to naming a platform. Never the model, the device
  name, a device identifier, the OS build string, the carrier, the locale, the
  screen, the battery, or anything else about the phone.
- **Up to seven yes/no observations, each of something the kit watched
  happen** — whether work already in flight finished while the app was in the
  background, whether a timer already scheduled fired while it was away,
  whether the system warned the app before it ran short of memory, whether the
  app could read its own memory ceiling and its own CPU clock, and, on Apple
  platforms, whether the system will say how much background time is left and
  whether that number counts down. Each arrives as a plain `1` or `0`, and a
  fact this kit could not observe is **left out of the block entirely** rather
  than reported as a `0` — a limit we never watched being reached is not a
  limit we may claim. No measurement is taken to answer these: each one is a
  by-product of work the kit was doing anyway.

**These are facts about a platform, not about a device.** They are pooled per
platform band: what survives is "on Android API 34, this many installs saw a
background job run in the background and this many did not". No line is shown
until at least **three separate installs** have reported it, each install
counts once per fact however many times it uploads, and nothing in the pooled
record can be traced to a particular phone. Your own install row additionally
remembers **which band and maker it reported** — that, and nothing more about
the device — so your dashboard can tell you which platform your project runs
on; `forget` and account closure delete it with the rest of the row.


### Three phone readings the React Native kit takes without being asked

Most of what the React Native kit measures, it measures because your code
asked it to — you time a screen, you wrap a call. **Three readings are
different: the kit starts them itself** when `enableTelemetry()` runs, with no
setting to pass. They ride the meter snapshot and its **same two switches**,
they stay inside the meter boundary above — a score, a rating bucket and plain
numbers — and each one can be refused by name.

They start themselves because the alternative was worse. Left as switches, all
three sat off in ordinary apps for ever, and their meters said "measuring…"
about something no code had started. A reading nobody can get is not a choice
we were offering.

- **How long your app's own requests take, and how they ended** — the kit
  observes your app's global `fetch` and `XMLHttpRequest` and records two
  values per attempt: a duration in milliseconds, and one word for how it
  finished (`ok`, `error`, `timeout` or `near-hang`). There is **no field
  anywhere in that path** for a URL, a host, a path, a query string, a header,
  a request or response body, or a status code — not dropped later, not
  redacted: never read. Your app's behaviour is unchanged, because the kit
  calls your transport's own implementation, hands back the exact object it
  returned, and re-throws its exact error. Boosthis's own uploads are excluded,
  so an app that makes no requests of its own reports nothing here.
- **A count of unhandled errors and unhandled promise rejections** — how many
  of each happened, and nothing about any of them: never the error, never its
  message, never its stack, never its type. The kit **chains** the app's
  existing handler rather than replacing it — yours is always called, with the
  original fatal/non-fatal flag — so your own crash reporter and React
  Native's red box behave exactly as they did before.
- **How much bigger an image was than the space it filled** — for React Native
  `<Image>` elements the kit reads four numbers as each image loads and lays
  out: the decoded width and height, and the displayed width and height. Never
  the image, never its URL or file name, never anything drawn in it.
- **How to refuse any of them.** Pass `autoWrapNetwork: false`,
  `trackUnhandledErrors: false` or `trackImageWeight: false` to
  `enableTelemetry()`. The kit then wires nothing for that reading, **and the
  meter says it is switched off in this build** rather than going quiet or
  claiming to measure. `disableTelemetry()`, `forget`, and
  `BOOSTHIS_DISABLED=1` stop all three like everything else.

### What every traced step carries

Every kit that traces sends each traced step in the same basic shape, whatever
it runs in, so one action crossing a phone, a browser and your servers can be
drawn as one line; what a particular kind of step adds is described in its own
section below:

- **A trace ID** — 32 random hexadecimal characters, minted in your app or
  taken from the request another of your instrumented services sent (see "What
  we never collect" below for exactly what is read). It ties together the steps
  of one action.
- **A span ID** — a shorter value, 16 random hexadecimal characters, naming
  the step itself — and, where the step has one, the span ID of its **parent**
  step: either a step the kit made itself, or the span ID that the caller of
  your app put on its request.
- The code-defined **route label** of the step, when it started after the
  action began, how long it took, and a rating bucket for that time.
- **The kind of work** it was — one word from a fixed list of eight: `handler`,
  `db`, `http`, `cache`, `queue`, `job`, `render` or `other` — and whether it
  ended **ok or in error**. Both are optional: a kit that does not report them
  sends neither, and a step with no outcome is recorded as not reported, never
  as ok.

None of these is derived from a person, the device, the account or the
install. When each kind of step travels, and how to stop it, is set out in the
sections below; Boosthis keeps traced steps for **7 days**, at most 20 for each
trace (see "Retention").

### The React Native screen circuit (on by default)

From React Native kit 1.0.0-alpha.297, `traceScreens` is on unless your own
code sets it to `false`; an older kit records nothing unless your code switches
it on. It records only while what it makes may travel — on the health-meter
snapshot's two switches: only when full details are on, or when meter sharing
is switched on — and never while your app has recorded that its user withheld
permission (`setEndUserConsent("withheld")`). Until then, and with it off,
nothing changes: no request's address is read, and there are no screen spans,
no call spans and no trace header on any request. The blind Network axis is
separate and unchanged; it still reads no URL, host, path or status.

- **What a traced screen sends** — the navigator's **route name** for each
  screen the app moves to, how long it took and its place after the previous
  screen. A route name is code the developer wrote in the navigator. The kit
  never reads screen params, titles or anything a person typed.
- **What a call from that screen sends** — its method, an **id-redacted path**,
  how long it took and whether it failed. Never its query string, request or
  response body, headers, response status number or destination host. The trace
  header is written only to a host the developer named in `propagateTo`; name
  no host and it is written nowhere. A request that already carries a trace
  header the app added itself is left as it was, and is not recorded twice.
- **How to stop it** — `traceScreens: false` turns it off;
  `disableTelemetry()`, `forget` and `BOOSTHIS_DISABLED=1` stop it like
  everything else.

### The browser kit's calls to your own server (on by default)

From browser kit 1.0.0-alpha.144, each `fetch` or XHR request a page makes to
its own origin — the same scheme, host and port as the page — carries three
**trace headers** to your server: a random trace ID, a random step ID and an
elapsed time of zero. None of them is derived from the visitor, the device, the
account or the install. The kit also records one traced step for that request,
and your server's kit records the request as that step's child, which is what
draws the line from a page to the server route it called.

- **What a traced step sends** — the page's **route label** (the same
  code-defined label as the page map), how long the request took and whether it
  failed. Never the request's address, query string, request or response body,
  headers, response status number or anything a person typed.
- **Other hosts** — a request to any other host carries no trace header unless
  the developer named that host in `tracePropagateTo`; name no host and none is
  written to any other host. A request that already carries a trace header the
  app added itself is left as it was.
- **When it travels, and how to stop it** — with the other traced steps, on the
  health-meter snapshot's two switches: only when full details are on, or when
  meter sharing is switched on, and the headers are added only when the step
  may travel. Nothing new is stored in the visitor's browser.
  `traceSameOrigin: false` stops it on the page's own origin;
  `disableTelemetry()`, `forget` and `BOOSTHIS_DISABLED=1` stop it like
  everything else.

### The Flutter kit's outgoing calls, and the optional Dio add-on

The Flutter kit watches the requests your app sends through Dart's own HTTP
client, which covers `package:http` and Dio on its default adapter. The
optional `boosthis_dio` add-on watches every call a Dio instance makes, on any
adapter, once your code adds its interceptor to that instance. Each call is
counted once, whichever of the two sees it.

- **What every call feeds** — how long it took and whether it stalled, folded
  into the network reading, and, where the host is one the kit recognises as
  an AI provider, the AI-call readings described above. The host and the path
  are read inside your app only for that check; neither is sent.
- **What a traced call sends** — only while full details are on for the
  project: one step labelled with the request's method and the fixed word
  `/outbound` (for example `GET /outbound`), how long it took, its place after
  the trace began, its trace ID, its own step ID and the step it came from,
  the kind `http`, and whether it ended ok or in error. Never its address,
  host, path, query string, headers, body or response status number.
- **What the request itself carries** — while the kit is not switched off,
  each such request carries three trace headers to whatever host it goes to: a
  random trace ID, the call's random step ID and the milliseconds since the
  trace began, in place of any of ours the app set itself. None of them is
  derived from a person, the device, the account or the install. Unlike the
  browser and React Native kits, the Flutter kit has no list of hosts that
  limits where they are written.
- **How to stop it** — removing the interceptor stops the add-on; turning full
  details off stops the traced step; `forget` stops anything being sent.
  Only `BOOSTHIS_DISABLED`, set when the app is built, stops the headers being
  written: until then they are added even where nothing is being sent. In a
  Flutter app running in a browser, the kit and the add-on stand down: nothing
  is measured and no header is added.

### The server kits' calls to a database or another service

From Node kit 1.0.0-alpha.200, Python kit 1.0.0a168, PHP kit 1.0.83, Java kit
1.0.0a146, Go kit 1.0.0a146, Ruby kit 1.0.0a86, .NET kit 1.0.89, Rust kit
1.0.0a81, Elixir kit 1.0.0a78 and edge kit 1.0.0-alpha.32, the kit on your
server also records, for each request it traces, one **linked step** for each
kind of call that request made to a database or to an outside service, linked
to that request's own traced step. That is what draws the lines on your
project's map from a route to its database and to each outside service. On
the Node, Python, Java and Go kits a run of a background job is treated the
same way: one step for the run, under the job name the kit already sends, with
the run's calls linked to it. The edge kit links the calls a queue, cron or
email run makes to the step it already sends for that run.

- **What a linked step sends** — whether the call went to a database or to an
  outside service, and **one fixed word** for it: `database` (a database your
  app reaches over the web counts as one), or for an outside service one of
  `signin`, `storage`, `payments`, `messaging`, `search` and `other`, the same
  groups the outside-services reading already uses. With it go when the first
  such call started after the request began, how long calls of that kind were
  in flight, a rating bucket for that time and whether any of them failed.
  Never the statement or query, a table name, the service's host or address,
  a path, a query string, a body, headers, a response status number or any
  value.
- **How many** — repeated calls of the same kind inside one request are folded
  into one step, so one request sends seven at most. A call still in flight
  when the request answers is not linked to it, and a call to an AI provider
  is never linked: the AI reading measures it. On the kits that name a
  background job, a run's steps are sent only when that run made such a call,
  and at most once a minute for each job name.
- **When it travels, and how to stop it** — only together with its request's
  (or run's) own traced step, on the health-meter snapshot's two switches:
  only when full details are on, or when meter sharing is switched on.
  `disableTelemetry()` / `boosthis.disable_telemetry()` (each kit has its own
  spelling of it), `forget` and `BOOSTHIS_DISABLED=1` stop it like everything
  else.


### The server kits pass the trace on to your own services (Node and Python, on by default)

When your server calls another of your own services while it handles a traced
request, the Node and Python kits add three **trace headers** to that call, so
one action crossing two of your services is shown as one traced action and
your project's map draws the line between them. Nothing new is sent to
Boosthis: the headers go only to the service your app was already calling.

- **What the headers carry** — the request's trace ID (a random one the kits
  mint, or the one another of your instrumented services already put on the
  request), the milliseconds since that trace began and a random ID for the
  call. None of them is derived from a person, the device, the account or the
  install. A call that already carries a trace header your app added itself is
  left as it was.
- **Where they go by default** — to addresses that cannot be on the public
  internet (a loopback or private-network address, a single-label name such as
  `billing`, or a name under a reserved suffix such as `.internal` or
  `.local`), and, from Node kit 1.0.0-alpha.204 and Python kit 1.0.0a171, to
  hosts on the **same site as the request being served**, such as
  `api.example.com` called while serving `www.example.com`. The same site
  means the same registrable domain under the public-suffix list, so two apps
  that share only a hosting address, such as two apps on `replit.app`, are two
  sites and neither receives the other's headers. A name on your own domain
  that you have pointed at another company's service, such as a help desk at
  `help.example.com`, is on your site by that rule and receives them too.
  Earlier releases pass them on to internal addresses only.
- **Nobody else, unless you name them** — under the default, a call to a
  payment provider, a model vendor, a hosting provider's own metadata address
  or any other company's own domain carries none of them. The site is read
  from the request's own `Host`, never from a forwarded header.
- **How to change it, and how to stop it** — one setting on your server,
  `BOOSTHIS_TRACE_PROPAGATION`. `none` attaches nothing to any call;
  `internal` keeps internal addresses only; a list of hosts replaces the
  default, so `internal,same-site,beta.replit.app` keeps both rules and adds
  one host. The kit's own status page states the rule in force.
  `BOOSTHIS_DISABLED=1` stops it like everything else.

### Only in the optional detailed crash mode (opt-in, per app)

A specific app can be switched into **detailed crash mode**. When it is, a crash
report may additionally include — still scrubbed and still passed through the PII
guard before it leaves the device:

- **The first line of the error message — but only if it passes the PII guard.**
  Boosthis takes just the first line, cut to at most **300 characters**; if the
  guard detects anything identifier-shaped in it (an email, token, IP, phone
  number, etc.) the **entire line is dropped** rather than sent. It is never
  partially redacted, and only the first line is ever considered. Whatever that
  line says is kept as written — an error message is text your code or a
  library wrote, so choose your own error messages as you would any label.
- **Sanitized stack frames** — up to 20, each reduced to a function name + file
  *basename* + line/column. The kit reads each frame's file path inside your
  process in order to cut it back; absolute paths, URLs, query strings,
  function arguments, and local variables are never included in what leaves
  it.

This mode is off unless you turn it on, and even then it never adds your source
code, raw stack traces, or any user value.

For the website kit, turn it on per project with the **Detailed crash reports**
switch on the project page of your Boosthis dashboard (carried to the kit when
it registers), with the hosted script tag attribute `data-crash-details="on"`,
or in the kit's code settings. Other kits use their code setting.


### Build maps you upload (so crash frames read as source)

A production crash frame reads as a compiled position — `a.b.c
(bundle.js:1:48291)`. To make it read as your own file and line, a developer
can upload the **build map** their build already produced: a JavaScript source
map, an Android `mapping.txt`, an Apple dSYM, a Dart symbols file or a Portable
PDB. **Nothing is uploaded unless a developer does it** — by hand from the
project page, or by a step added to your own build. **No kit fetches a build
map's contents**, and Boosthis never asks your build system for one; a project
that has uploaded none holds none. One kit asks a question *about* a map rather
than for its contents: the browser kit's development-posture check makes one
HEAD request to your own site for the first script's `.map` address and keeps
only whether the answer was OK, as a 1 or a 0. Nothing is downloaded, and the
address is neither stored nor sent.

**What is kept, and what is discarded on arrival.** The file is parsed the
moment it arrives and only the parts needed to place a frame survive:

- **The original source paths that build recorded** — or, for an Android
  mapping file, the original class names. They keep the directory chain the
  build wrote, because a crash frame already carries the file's basename and a
  resolved frame that adds no directory adds nothing. Bundler schemes are
  stripped, an absolute machine path is cut back to its last few segments, each
  path is length-bounded, and every one is screened by the same PII guard that
  screens telemetry — a path that trips it is replaced with a visible
  "withheld" marker rather than stored.
- **The original identifier, method or symbol names** from that build.
- **The table that joins those to positions in the compiled output.**

**The uploaded file itself is not kept**, and `sourcesContent` — the copy of
your actual source text that a source map may embed — is **discarded at the
door and never written down**. What a build map hands back, it hands back only
to you: your own crash frames resolved to your file, line and original
identifier name, and — in your data export — the list of maps held with their
source paths and expiry dates. The uploaded file is never served back to
anyone, the mapping table and the table of identifier names are never handed
over as tables, and no build map is ever an answer to anybody but you.

**How long.** Each build map is kept for **90 days from the day it was
uploaded**, then deleted. Uploading the same app version again replaces the map
already held rather than adding a second one, and restarts that clock. The
project page lists every map the project holds — which release, which generated
file, when it arrived and the date it ages out — warns 14 days before one ages
out, and says when a release crashes are still arriving under has no map. Your
data export lists the maps held, for which build, with your own source paths
and each one's expiry date. The reasoning behind both the clock and keeping the
full path is written down in `docs/decisions/build-map-retention-and-paths.md`.

### Reading your own data back over MCP (the "Connect your AI" and "Connect AI" cards)

When you connect an AI agent, it can **read back** what your app has already
uploaded and the records Boosthis keeps about your project, so it can answer
"which screen is slowest, and what should I fix first?" with your real numbers
instead of a placeholder: the per-screen meters you see in the dashboard (boot
ladder, Speed, Smoothness, Scroll, Stability, Render, the Frustration and Idle
axes), the health-meter numbers described above (a named set that grows over
time — always scores, rating buckets, counts and timings), the per-route rows,
the session summary, the budgets, the crashes recorded, traces, background
jobs, and the promises and changes recorded for the project. Nothing is read
back until **you** give an agent one of the four credentials below, and each
reaches a different amount:

- **An install's read credentials** — the `install_id` and read token shown in
  the in-app dashboard's dev-only "Connect your AI" card. They read **one
  install**: that copy of your app's own uploaded data, and nothing of any
  other install. They are read-only — not the token that erases your data —
  so they **cannot** delete your data (`forget`, which needs the separate
  delete token), submit telemetry, or change anything. They stop working when
  that install is replaced, for example when a server restarts on a host that
  keeps no disk.
- **A project AI key** — made with "Connect AI" on a project's row in the web
  dashboard. It reads **one project**: at each read it is matched to whichever
  of that project's installs is reporting, so it keeps working when an install
  is replaced. It is read-only, and you can revoke it on its own without
  touching anything else.
- **An account AI token** — made on your dashboard. It reads **every project
  your account holds a project key for**. Closing your account pauses it at
  once. A project AI key and an account AI token each expire **90 days** after
  they are made, and making a new one replaces the old; one made before these
  tokens had an expiry date lasts until you revoke or replace it. An account
  AI token also has a **write
  switch**, separate from its reads: a token made since that switch was added
  writes nothing until you turn writing on, and a token made before it keeps
  the writing it had until you turn writing off; you can change it at any time
  without revoking the token's reads. With writing on, and presented together
  with that project's key, an agent can **save** into the project a promise for
  Boosthis to watch, a record of a change it made, a piece of work it says it
  will build and its closing, and its report of whether a crash fix worked —
  each described below. A token can never erase data, send telemetry, or change
  your account, plan, keys or teammates.
- **Signing in from an AI app (OAuth)** — an AI app can connect by sending you
  to a Boosthis sign-in page where you type a project key. What the app
  receives stands in for that key on the hosted connection, opens what the key
  opens there and nothing more, and is read-only. It lasts 30 days, can be
  renewed for up to 180, and ends at once if you revoke that project key.

The rest of this section applies to all four:
- The agent reads what this Part already describes your app sending, and the
  records it describes Boosthis keeping about your project — **no new
  categories of data** are collected for this feature. The same PII guard
  still applies to every read.
- **Your recorded crashes too — the "potential crashes" feed.** The connected
  agent can also read back the crashes your app has *already* recorded
  (described above under **Crash reports**): for each, the error type, the
  redacted code location — and, where a build map you uploaded resolves it,
  the readable file, line and original name, as described under "Build maps
  you upload" — the screen or route it happened on, how often it recurred, when it was
  first and last seen, whether it is still happening, and whether a fix was
  reported against it and what came of it, newest first, joined with your
  app's stability (app-not-responding) signal — so it can answer "what is most
  likely to crash, and what should I harden first?". This reads the **same**
  crash data already collected for a registered app — **no new categories of
  data** — through the same PII guard as every other read, and only within what
  the credential opens.
- **The hosted Boosthis MCP server can serve this read** when — and only when —
  one of these credentials is presented on the request. It keeps no copy of an
  install's read token, a project AI key or an account AI token, only the
  one-way hash it checks each against; an OAuth sign-in is kept as described
  under "Account data". It never reads one project's data on behalf of
  another: each call sees only what the credential presented with it opens.
  With no credential, the hosted server returns the on-device note instead of
  any live data.
- **Treat every one of these credentials like a password — and note it will
  appear in your AI's transcript.** Because you paste it into your AI agent's
  tool configuration, the credential (and, for the install pair, your install
  id) will, by design, appear in that agent's tool call history / transcript.
  Anyone who can read that transcript or copy the credential can read what it
  opens, and, with an account AI token whose writing is on, save what it may
  save; nobody holding one can delete your data or send telemetry as you. Keep
  them on your own machine and to agents you trust. Revoking a credential ends
  what it can do at once, and erasing an install (`forget`) leaves nothing of
  it to read.
- **What a tool reply can contain — the exact identifier categories.** A reply
  served to a connected AI is limited to: the **install ID** (the
  same UUID described above — the connection-status tool lists it per app so
  you can tell your installs apart and match the "Connect your AI" card);
  **trace IDs** (a random 32-character hex value minted inside your app purely
  to stitch the steps of one user action into a waterfall — never derived from
  your device, user, account, or install ID); **span IDs** (a shorter, random
  16-character hex value naming one step within a trace; a step's parent can be
  a span ID that the caller of your app sent with its request, from a service
  that is not yours to measure); for each step, the **kind of work** it did
  (such as a database query, an outgoing call or a background job, as a word
  from a fixed list) and whether it ended **ok or in error**, where the kit
  recorded that; code-defined route/screen labels and background-job names;
  durations, ratings, scores and counts; crash signatures (error type plus a
  redacted code location) and, where a build map you uploaded resolves one, the
  readable file, line and original name; whether a crash is still happening,
  and whether a fix was reported against it and with what outcome; the release
  versions your project declared; the words an assistant saved through a
  connection — a promise, a change it filed, a piece of work it said it would
  build — and Boosthis's reading of them; **coarse timestamps** (when a sample
  or crash was recorded, when it was first and last seen, and when an app last
  checked in); **connection-status
  facts** (each install's coarse connection status, when it was registered,
  whether it has ever checked in, whether a measurement has ever arrived from
  it, when the most recent one arrived and a coarse band of how many have
  arrived, and a yes/no of whether server-side credentials are on file — never
  any credential value, and never a measurement value itself); the **project
  name and short code the reply is about** (the name you gave that project on
  your dashboard, plus the first characters of its project key's fingerprint,
  so a connected AI holding two connections can always say which project a set
  of numbers belongs to); the **app name and runtime label of the install being
  read** (the name your app reported when it registered, so a connected AI can
  tell one measured place of a project from another instead of judging the
  whole project on half its numbers); rule IDs
  and fix guidance from the rule book; and — inside the integration-kit reply only —
  an echo of the **same project key that connection itself presented** (so the
  kit can self-register; never anyone else's key or any other credential).
  Tool replies never include account data, emails, IP addresses, internal
  database row IDs, or anything from a project or install the credential
  presented with that call does not open.

## Checking a sentence your assistant wrote

Nothing your assistant writes is sent to be checked on its own, and Boosthis
never reads a session to get it: a sentence arrives for checking only when one
of two things you set up sends it. The first is the Claude Code Stop hook Boosthis publishes on
your dashboard and in the private setup guide — configuration you add to your
own Claude Code settings, needing both your project key and your owner account
token. Until you add it the hook sends nothing, and deleting it from those
settings stops it. The second is the claim-check tool offered to any assistant
you connect to Boosthis: the assistant can call it with one sentence at a
time, and only the sentence it was asked about is sent. Neither lets Boosthis
take anything that was not submitted to it.

What the hook sends is at most 4 of the closing lines your assistant has just
written, each no longer than 240 characters, with fenced code blocks removed
on your own machine before anything leaves it. Not the conversation, not your
prompts, not a file, not your repository. They are the closing lines as they
were written, so if your assistant ended a turn with a line of code or a diff
line that was not inside a code fence, that line can be one of them. Each line
then goes through the same screen a written promise goes through — length,
credentials, personal data — before it is read against your project's
measurements or answered, and one that fails the screen is not read, not
answered and not stored. One thing is taken from a line before that screen
runs, and only where your project has no kit installed: whether the line
states a number or a length of time. That single yes-or-no fact is recorded in
the row described next, with no part of the line beside it, and nothing else
happens to the line — with nothing measured to check it against, it is not
read, not answered and not kept.

The sentence itself is not kept, with one exception set out next. What is
stored is how it was read: one row holding which of a closed list of outcome
words applied, which reader ran, and a few yes-or-no facts about the
sentence's shape — no account, no project, no install, no subject and no text,
so the row cannot be tied back to you or your project by anyone holding the
whole table. Where Boosthis worked out what the change was aimed at, it also
records that aim in your project's own list of witnessed changes: the measured
subject's label, which measurement of it, the line it was held to and the
judgement. That is what Boosthis read the sentence as, in its own bounded
words, and again never the sentence.

The exception is a sentence that reads as a promise about something your
project measures and that Boosthis cannot judge yet. That one is recorded, in
its own words, as a standing promise on your project — screened first, capped
in number, listed on your project page beside everything else you have
promised, and removable there at any time. Standing promises are covered
above: they appear in your data export and are deleted when the project is
erased or the account closed. Where the wording cannot be matched to something
your project measures, nothing of it is recorded.

A sentence the plain word match cannot read may be sent once to the AI
provider named above, to be mapped onto one subject your project already
measures, and only on a call that proved the account owns the project. It goes
with a numbered list of up to 40 of the things your project measures, each
with its current numbers, as described under "The companies that can see your
data" below — never on its own, and never with anything else. What
the hook sends never goes that way: it is read by the plain word match alone
and reaches no model provider.

Checking a sentence is not the only thing a connected assistant can send in
words it wrote itself. Holding your project key and your owner account token,
it can also file a one-line summary of a change it has just made (at most 300
characters, with an optional screen, endpoint or job name of at most 80), name
one thing it is about to build so your project page can later say whether it
appeared (at most 80 characters, at most 24 outstanding at a time), and write
down a standing promise as described above (at most 240 characters). Each is
one short line the assistant chose to send, never a transcript, a file or a
diff, and each goes through the same screen for personal data and credentials
before it is stored — one that fails is refused whole and nothing of it is
kept. What is stored is kept on your project, shown to you on its own pages,
and deleted when you erase the project (forget) or close your account.

## The Covenant hooks in Claude Code and other editors

Boosthis also publishes a second hook for Claude Code, the Covenant hook, and a
Covenant hook for each of Codex, Gemini CLI, Kiro, Cursor, Windsurf and GitHub
Copilot, on your project's Setup page and in the private setup guide. Each is
configuration you add to one project's own settings for that editor, never to
your user-wide ones, and it reads that project's AI key from your environment
each time it runs and writes it nowhere. Until you add it nothing is sent, and
deleting it from those settings stops it. In Claude Code, Codex, Gemini CLI and
Kiro it fetches your project's Covenant from Boosthis and hands it to your
assistant when a session starts, resumes, is cleared or has its context
compacted, at whichever of those moments the editor reports to its hooks; when
your assistant starts a helper agent, where the editor reports that; and each
time you submit a prompt. Cursor, Windsurf and GitHub Copilot do not let a hook
add to what your assistant sees, so there it fetches nothing and hands nothing
over. On each prompt, in every one of these editors, it also reports that the
prompt happened, so your project page can show, editor by editor, whether every
request had the Covenant. Your project page also has a switch, off unless you
turn it on, that asks your assistant in Claude Code for its own account of each
rule Boosthis does not check: while it is on, the hand-over asks your assistant
to end each reply with one line saying, rule by rule, whether it applied the
rule, whether the rule did not apply, or that it couldn't, and the Claude Code
hook runs once more when each reply ends to report that line. Boosthis keeps
what comes back as your assistant's claim and checks none of it.

What it sends is only this: that a prompt happened, and when; a session tag and
an event tag, which the hook makes on your own machine as keyed hashes under a
random value that never leaves it, so neither reveals anything about the
session; the hook's own version and which editor it runs in; which Covenant
version it handed over or, when it could not hand the current one over, what it
handed over instead and why, from a fixed list of reasons, or, in an editor that
cannot hand anything over, that nothing was; and, to fetch the Covenant, which
of those moments called it, which version your session already holds and how
much text it may add. When a reply ends in Claude Code while that switch is on,
it sends the two tags of the request the reply answers and either what the
reply's last line said in its fixed form — each rule's short tag, one of three
answers (applied, not applicable or couldn't) and the Covenant version the line
named — or that the reply had no such line. The hook reads that one line on your
machine, and nothing else from the reply leaves it. An editor may hand its hook
your prompt along with the moment; the hook reads only the moment and the
session and prompt identifiers from what it is handed (and, as a reply ends in
Claude Code, that one line), and drops the rest on your machine. It never sends
your prompt, the conversation, your assistant's replies, a file or anything from
your repository, and the report has no field that could carry them: Boosthis
refuses one with any field it does not know. A teammate's prompts are counted
only on a machine where that teammate has put a project credential in their own
environment.

Each counted request is stored as one row against your project key: when it
happened, in which editor, the two tags, the hook's version, the Covenant
version and, for a miss, its reason — with no account, no person and no install
beside it, so the record is your project's and is never broken down by person.
While the switch is on, a request counted in Claude Code also holds the rule
tags your assistant was asked about and what came back when the reply ended: the
answers and the version the line named, or that no such line was given, and when
that arrived. The switch, when it was last pressed and each rule's tag are kept
with your project's Covenant. A daily count per project key is kept beside it,
so that a daily ceiling on how many requests are recorded can hold and your page
can say when counting stopped. Both appear in your data export and are deleted
when you close your account, or when the project key is revoked and the purge
window ends.

## Reading your own chat messages in your editor

The Boosthis extension for Visual Studio Code can read the messages you typed
to an AI assistant, on your own machine, and turn them into the list of things
you asked for on your project's board. It is off until you turn it on, it is
turned on for one project at a time rather than for your machine, and there is
one switch. Nothing is read for a project you have not switched on, and
switching it off stops the reading.

Only your own messages are kept. The extension opens the conversation files
your assistant already keeps on your disk and reads and parses each one whole,
on your own machine — your assistant's replies included, because they sit in
the same file — and then keeps only the turns you typed yourself. Your
assistant's replies are set aside at that step: nothing in them is worked on,
kept or sent, because they are where code, diffs, stack traces, file paths,
database rows and credentials end up, and an assistant's account of having
finished something is no evidence in any case. The extension writes nothing
back to those files.

No conversation text reaches Boosthis. Your messages are read, the names of the
things you asked for are worked out, and each name is screened for personal
data, credentials and addresses — all of it on your machine, before anything is
sent. What is then sent is the same thing the connection already accepts from
an assistant: a work-item name of at most 80 characters, the time it was asked
for, and that it is open. Never a message, a prompt, your reasoning, a file, a
diff or any code. A name that fails the screen is not sent at all, and no
shortened version of it is sent instead. You can see the exact list before it
goes.

Every item on your board says where it came from — told by your assistant
through the connection, or read from your own messages — on the wire, in
storage and on every screen that shows it. The two are never merged into one
list of items that simply appeared.

Nothing read from a conversation can ever mark a piece of work as finished. An
item your assistant told Boosthis about is closed when your assistant tells
Boosthis through the connection that it is done, or files a change against its
name; an item read from your own messages refuses both. Boosthis reads an item
whose route your running app serves as finished, and you can drop an item
yourself. A name read from your own messages is a phrase you typed rather than
a route your app registers, so in practice you are the one who drops it.
Boosthis also publishes which assistants this
reader can read and which it cannot, with the reason for each, so a tool it
cannot read is never left to look like a tool with nothing to report.

A tool Boosthis cannot read is not a tool with nothing to report. Where there
is no reader, nothing about that assistant's conversations reaches your board
at all, and the reason is stated rather than left as a blank row.

| Assistant | Read? | What is read, or what is missing |
|---|---|---|
| GitHub Copilot Chat (Visual Studio Code) | Read | Your own messages: `requests[].message.text` (with `requests[].message.parts[].text` where the editor split it), and the request's own `timestamp`. Not read: `requests[].response`, `requests[].result` and every other field of the entry: that is the assistant's half. |
| Claude Code (command line) | Read | Your own messages: Lines with `type: "user"`, taking `message.content` when it is a string and the `text` of its `type: "text"` blocks when it is a list. Not read: Every line with `type: "assistant"`, and every other line type in the file. A `user` line carrying a tool result, or marked `isMeta`, is written by the tool rather than typed by the developer, and is skipped. The directory name flattens the project's path, so two projects whose paths differ only in punctuation share one directory; a session is read only where the session's own `cwd` records this project, and one recording another project, or none at all, is skipped. |
| OpenAI Codex CLI | Read | Your own messages: Lines whose message has `role: "user"`, taking the `text` of their `input_text` content parts, whether the message sits at the top level or under `payload`. Not read: Every line whose message has any other role, including the assistant's own. |
| Continue (Visual Studio Code) | Read | Your own messages: `history[].message.content` where `history[].message.role` is `user`, taking the `text` of its parts when the content is a list. Not read: Every turn with any other role, and the `contextItems` beside each turn — those carry file content. |
| Aider | Read | Your own messages: Lines beginning `#### `, which is the prefix Aider writes in front of what the developer typed and in front of nothing else. Not read: Every unprefixed line — the assistant's prose — and every fenced block. The transcript carries no timestamps, so an item read from it is stamped with the time of the read rather than the time it was asked for, and the preview says so. |
| Cline (Visual Studio Code) | **Not read** | What is missing: anything beside the conversation saying which project the task belonged to. Its tasks are readable — the panel's own events are in a JSON file, and the developer's replies are marked in it — but every task for every project sits in one directory, and Boosthis has found nothing stored beside a task that records the folder it ran in. Reading them would put asks typed in another repository onto this project's board, and this switch is per project. There is a second problem even where that is solved: the message that OPENS a task is stored with the same marker as the assistant's own prose, so a developer's first ask cannot be told apart from a reply. |
| Cursor | **Not read** | What is missing: a conversation store in a file that can be read without a database driver. Cursor keeps its conversations inside a SQLite database in its own user directory rather than in files. Reading it would mean shipping a native database driver inside the extension, and the keys the conversations sit under are undocumented and have changed between releases — a reader written against them would quietly start reporting the wrong half of a conversation the first time they moved. |
| Windsurf | **Not read** | What is missing: an on-disk conversation store on the developer's machine. The conversation is held by the service rather than written to the developer's disk, so there is nothing local to read. Anything Boosthis could obtain would have to come from the provider, which would put Boosthis inside the conversation — the one thing this feature refuses to do. |
| Gemini CLI | **Not read** | What is missing: a store whose shape we have verified, with the developer's own turns marked in it. It writes session files under the home directory, but the layout is undocumented and has changed between releases, and Boosthis has not verified which entries are the developer's own typing. A reader written against a guess would either miss the asks or report the assistant's words as the developer's, and both are worse than an empty row that says so. |
| JetBrains AI Assistant and Junie | **Not read** | What is missing: a Boosthis extension in that editor. This reader ships inside the Boosthis extension for Visual Studio Code, and these run in the JetBrains IDEs. Nothing about their store has been examined, and nothing is read from a machine using them. |
| Assistants used in a browser (ChatGPT, Claude, Gemini on the web) | **Not read** | What is missing: any local copy of the conversation at all. The conversation exists only on the provider's servers. There is no file on the developer's machine to read, and Boosthis does not ask a provider for one. |

## Account data (the optional developer account)

If you create a developer account to use the hosted web or mobile dashboard,
we store the following — to operate your account and the projects it holds,
and to help a new account finish setting up (see "Account emails" below). Each
item says how long it is kept, and "Retention" below gathers every period in
one place:

- **Your full name, your email address, and a password hash.** The name and
  email are required to create an account: the name identifies the account
  holder and becomes the "Billed to" name on receipts, and the email is how you
  sign in and how we reach you. An older account without a name on file is
  asked for one on the dashboard; nothing else about the account changes, and
  the name is never shown to the projects you monitor. The password itself is never stored, only a
  secure one-way hash. Sign-in uses short-lived, single-use one-time codes
  (emailed, or from an authenticator app if you enroll one, plus one-time
  recovery codes if you generate them); the emailed and recovery codes are
  also stored only as hashes. An authenticator app's codes are never stored at
  all, but the secret the app shares with us cannot be a hash, because we have
  to work out the same code your app does: it is stored encrypted and removed
  when you remove the app or close your account.
- **What else the account record holds.** The language you chose for the
  dashboard and emails, and whether you have ever chosen Arabic, so the
  dashboard keeps offering the way back to it. When you agreed to these Terms
  and which revision you agreed to; when you confirmed at sign-up that you are
  old enough to hold an account, and, before a first payment, that you are old
  enough to buy one (both ages are in Part A, Section 1) — only a "yes" is ever
  stored, because sign-up and checkout are refused otherwise. One coarse word
  for how you reached the sign-up form, such as a search engine, another page
  of ours, a link we posted or the phone app, read from the one request that
  opened the form and used only to count which channels lead to accounts —
  never a trail across pages. Your email choices (described under "Account
  emails" below) and when each reminder or notice was last sent, so that none
  is sent twice. The account's status and, if it was frozen or suspended, the
  reason recorded. What closing the account leaves of these is stated under
  "Retention" below.
- **The Maintainer can see your account.** In the admin dashboard the
  Maintainer sees the account holder's **name and email address**, along with
  the plan, the number of projects, and the account's status (active, frozen,
  suspended). This is how accounts are supported, billing questions are
  answered, and abuse is spotted. It is never sold or shared with advertisers.
- **Teammates and the workspace activity log.** If you invite a teammate, we
  store the email address you invited and, once they join, the link between
  their account and your workspace. Actions taken in a workspace (who invited
  or removed whom, who created or revoked a key, who changed the plan) are
  recorded in an activity log visible to the workspace owner and admins, kept
  for up to a year. No IP addresses are stored in it.
- **AI connection credentials (OAuth sign-in and "Connect AI" tokens).** If
  you connect an AI assistant through the OAuth sign-in flow, or make a
  project AI key or an account AI token on your dashboard, we store that
  authorization so the assistant can act with its **own revocable credential**
  instead of your password. A dashboard-made key or token is stored only as a
  one-way hash, with the date it expires and, for an account AI token, whether
  writing is switched on. An OAuth sign-in keeps the project key you typed,
  encrypted, so the connection can stand in for it, and it inherits that key's
  status: revoking the key immediately ends that assistant's access. None of
  them is ever stored as plain text, and each grants no more than what is
  described under "Reading your own data back over MCP" above — reading only,
  except an account AI token whose writing you switched on.
- **AI read events (for the "AI impact" view).** When a connected AI assistant
  actually reads a project's data with one of the credentials above, we record
  the time of that read (collapsed so bursts count once per hour) together
  with a snapshot of the project's open crash-group counters at that moment.
  This exists solely to power the dashboard's honest before/after "AI impact"
  view; it contains only identifiers and counters we already store — no new
  content, and never anything about what the AI itself said or did. These
  events are deleted with the project's other operational data on erasure and
  pruned after a year.
- **Session records and cookies.** The web dashboard sets essential cookies
  and one preference cookie, and no others. The essential ones are your
  sign-in session, which workspace you are currently viewing, a short-lived
  cookie during the one-time-code step, a short-lived cookie during the code
  step that confirms a billing change, a short-lived cookie that carries a
  team invitation through sign-in, a short-lived cookie during the step that
  connects your Slack workspace, a short-lived cookie during the code step
  that confirms a full data export, and, only in a browser signed in as a
  Boosthis administrator, a marker that tells our own pages to measure
  themselves — never set for a customer, and it grants access to nothing. The
  preference cookie remembers a choice you made: which environment you last
  chose to look at (development or production), set only when you choose one
  and kept for 180 days so the dashboard opens where you left it.
  Boosthis sets **no advertising, analytics, or cross-site
  tracking cookies**. The dashboard uses a small amount of your browser's own storage for
   convenience — for example, remembering that you dismissed the "update
   available" banner — not for tracking.
- **Account emails.** We send account emails — a welcome note when you sign
  up, sign-in codes, password resets, receipts and renewal reminders,
  plain-language notices when a payment is declined or your access or plan
  changes, a security notice when one of your project keys is used by an app,
  a hosting platform or an AI client it has never been used by before (it
  names that app, platform or client and links to where you replace the key;
  at most three a day), performance-alert emails (a new account is emailed about serious
  problems only, by default: a new crash, a project that has stopped
  reporting, or a large slowdown, gathered into at most one email a day under
  a weekly limit and never about a preview environment; you can choose every
  alert or dashboard only in your dashboard settings instead, an account
  opened before this default keeps the setting it had, and every alert email
  carries a link that stops it), an optional weekly summary of your projects, occasional low-frequency update notes about the
  toolkit, and occasional notes about using Boosthis, such as a new tutorial
  video — through **Resend**, our email delivery provider, which processes
  your email address for delivery only (see "The companies that can see your
  data" below). Each note about using Boosthis is sent at most once to each
  open account, and every one carries a link that stops these notes and
  nothing else; you can also turn them off, or back on, in your dashboard
  settings. A new account, one opened in the last 30 days, may also get a short
  setup-help note: one when it holds a project key but no app has registered
  with it, and one when an app has registered but we have not yet accepted a
  reading from it. Which note fits is worked out only from what we stored
  about the account — its keys, the apps that registered, and the readings we
  accepted — never from what an installed kit says about itself. A note is
  sent only when the Maintainer chooses to send it, only to a confirmed
  address, and at most once for each of the two; it says what we saw and
  invites a reply to support, and it never guesses at a cause. Every
  setup-help note carries a link that stops these notes and nothing else;
  there is no dashboard setting for them, so to have them again, write to
  support. If you configure an alert webhook, the
  alerts you asked for are also POSTed to the URL you supply; where that URL
  goes, and what the receiving service does with it, is your responsibility.
  If you connect a chat workspace instead, those same alerts are posted into
  the channel you picked there.
- **Phone notifications.** If you turn on notifications in the Boosthis phone
  app on an iPhone, we store that phone's push address against the sign-in it
  was turned on from, encrypted, and a record of each notification written for
  you: which problem it was about, its kind, and when it was sent or why it was
  not. The app asks for permission on its Alerts screen after you sign in —
  never when it first opens — and refusing changes nothing else. A
  notification is sent only for a serious problem (the same list, daily batch
  and weekly limit as the serious-problem email), only for projects you can
  access, and it says only the kind of problem, such as "New crash in
  production", with an opaque reference; the project's name and details load
  from Boosthis after you open it. Notifications pass through **Expo** and
  **Apple** (see "The companies that can see your data" below), and neither
  receives anything before **21 October 2026**. You can turn notifications off
  on each phone in the app; signing out on that phone, or closing your
  account, removes its push address, and so does Expo or Apple telling us the
  address is no longer valid. The record of notifications written for you is
  deleted after 30 days.
- **Billing status.** If you subscribe to a Paid Plan, we store which plan
  you are on, a reference to your subscription with the Payment Processor,
  your billing country, whether you buy as a person or company, and, for a
  company, its name, address and (if given) tax or registration number for its
  invoices. These buyer details are not sent to the Payment Processor. We also
  store — so renewals work and you can recognize the card — your card's brand,
  its last four digits, its expiry month and year (so we can tell you before it
  runs out), and a reusable payment token issued by the Payment Processor
  (never the card number itself). With each payment we keep the country of the
  bank that issued your card, as the Payment Processor reports it, and, where
  the checkout asked whether you wanted the service to start at once, what you
  answered, as part of the record of that payment. Every charge we ask the Payment
  Processor to make — a first payment, an upgrade, a card check or a renewal —
  carries our own references with it, so that a payment in its records can be
  matched to one account: your account's ID and its short reference (such as
  `AC-748601E6`, which also appears in the charge's description beside the
  plan's name) and the checkout reference; a renewal also carries the plan and
  the word "renewal". None of these is a name, an address or an email.
  **Your card details never touch Boosthis's servers** — checkout happens on
  Boosthis-hosted checkout embedding Moyasar's payment form, which sends card
  details directly from your browser to Moyasar under its own privacy policy (see
  Part A, Section 15).
- **Billing contacts.** You can ask us to send copies of your receipts and
  payment-problem notices to up to three other addresses, such as an accounts
  inbox or a bookkeeper. We store each address you add, and a record of which
  address each receipt or notice was handed to our email provider for. A
  billing contact receives that mail and nothing else — never a sign-in code, a
  security notice or product mail — and an address there opens nothing. Only
  you see the list; removing an address stops the mail at once, though the
  record of what was handed over for it stays until your account closes, and
  closing your account deletes the list and the record.
- **A request to rescind a purchase.** If you ask to rescind a payment under
  the Saudi seven-day rule (Part A, Section 15), we record when the request
  reached us and how, which payment it concerns, the contract date and the
  window that applied, our decision and its reason, any refund and credit
  note, and when we answered. The text of your request is not copied into this record; it stays
  with your support message, on that message's own clock. A contact address
  you gave for the request is held encrypted and removed once the outcome and
  our answer are recorded, or when the account is closed. The rest belongs to
  the payment record and is kept like it (see "Payments" under "Retention").
- **A security log.** Actions the Maintainer's own staff take on the service,
  including on your account, are recorded in an append-only security log with
  the IP address they came from and the staff member's email, so we can
  investigate abuse. A refused attempt to sign in to the Maintainer's staff
  pages is recorded with the network it came from rather than the full
  address. Nothing you do on your own dashboard writes to it. The address and
  the staff email in an entry are erased automatically two years after the entry was written;
  the bare record of the action stays. It is a security record, not telemetry,
  and is never shown to other users.
- **Watching for leaked keys.** So that a leaked key is noticed, we keep, for
  each of your project keys, the names of the apps, the hosting platforms and
  the AI clients that have used it, with when each was first and last seen —
  never an address or a country. After a key's first week of use, a name never
  seen before brings the security notice described under "Account emails"
  above. If one of your keys turns up in a public place — public code, a
  search result or a web archive — or GitHub reports finding it, we keep where
  and when it was found beside a one-way hash of the key, never the key
  itself. These are security records, not telemetry, used only to notice a
  leaked key. Each is deleted **400 days** after it was last seen, except a
  find the Maintainer has not yet dealt with, which is kept until it is. They
  are part of your data download; closing your account deletes the record of
  what used your keys and removes your account from any find about them.
- **Support messages.** If you write to support — by email or from the
  dashboard, and whether or not you have an account — we keep your message
  (your address, the subject, the text and, for an attachment, only its name,
  size and type) so we can reply and keep a record of the request, together
  with the replies we send you, the support desk's own notes on the request
  and when it was marked done or reopened. Once your request is closed we keep
  it for **365 days** and then delete it automatically; while a request is
  still open we keep it until it is closed, because we cannot answer you
  otherwise. Closing your account deletes it sooner. That is the copy in our
  support desk. Email sent to the support address also passes through Google
  Workspace, the domain's mail service named under "The companies that can see
  your data", and a copy stays in the owner's mailbox there with **no deletion
  schedule**: it stays until the owner deletes it, and neither the 365 days nor
  closing your account removes it. A reply the owner writes from that mailbox,
  rather than from the support desk, is kept there the same way. The notice
  that tells the owner a support message has arrived, by email or from the
  dashboard, repeats its address, subject and text and the plan of any account
  the address matches, and it stays in the owner's mailbox with no deletion
  schedule as well. Support mail is kept in
  a store of its own, apart from telemetry, and the two meet in one place
  only: when the Maintainer opens a support message, the address it came from
  is matched against our accounts and teams, and the projects and installs of
  the matching account, and of any team it belongs to, are shown beside it:
  each install's runtime,
  when it last sent data, and any crash reports we refused from it. This is
  how we judge whether a message is genuine and what can safely be said in
  reply. The match is made afresh each time the message is opened and is not
  stored; the opening itself is recorded in the security log above, as a staff
  look at the account. What is kept with an emailed message is the result of
  the standard sender checks (SPF, DKIM and DMARC) for the domain it came
  from, as passed, failed or not known, and it is kept and deleted with the
  message.
- **Feedback.** If you send feedback from the dashboard — a rating, a
  message, or both — we keep it with your account, together with which page
  you sent it from and the language you were using, so we can read it and
  improve Boosthis. It is deleted along with your account.
- **Chat connections.** If you connect a Slack workspace to receive alerts, we
  store the workspace's ID and name, the credential Slack issues to Boosthis
  (encrypted, never shown and never exported) and who Boosthis is inside that
  workspace. For each channel you pick or webhook address you paste, we store
  its name, the channel's ID and name or the address (sealed, because anyone
  holding it can post there), which projects send alerts to it, and when a post
  last worked or failed with the error. For each post we owe a channel, we keep
  a record of what it says, the alert it repeats and what became of it
  (delivered, failed, may have arrived or cancelled), so that the channel's card
  can show a post that did not arrive; each record is deleted **30 days** after
  we stop trying to send that post. When the hourly notification limit holds
  alerts back, we note which projects and kinds of alert it held in that hour,
  so that a summary can tell you about them once the hour is over, and delete
  that note **30 days** after the hour. If you link your Slack user to your
  Boosthis account, so that the buttons on an alert posted in Slack can act for
  you, we store Slack's ID for that workspace and for your Slack user against
  your account: a press in Slack names the Slack user who pressed, and the link
  is how we know it was you and what your role lets you change. You can remove
  the link on your Team page; it is also removed when you leave that Boosthis
  workspace or are removed from it, and when the Slack workspace is
  disconnected. Disconnecting deletes the connection and its channels; closing
  your account deletes all of them.
- **What became of the emails we sent.** For each email we send, we keep the
  address, the kind of email and what our email provider later reported about
  it — delivered, bounced or marked as spam — so that a sign-in code or receipt
  that never arrived is noticed. For the notes about using Boosthis and the
  setup-help notes, we also keep which note went to which address, so none is
  sent twice. The provider's reports are kept for 31 days (see "Retention"
  below) and the record of which note went where while the account is open;
  closing your account deletes both.
- **Requests about your data.** If you ask to be told how your data is used,
  to see, copy, correct, limit or delete it, to take it elsewhere, to object to
  a use or to withdraw a consent — whether or not you have an account — we
  record the request: the
  address it came from and any other contact you gave (encrypted), what you
  asked for, how and when it reached us, when the answer is due and any
  extension with its reason, whether use of the data was paused meanwhile, how
  we checked it was you, and the answer, with any ground for refusing. Your own
  words are not copied into this record. Where a correction or a deletion has
  to be passed on to one of the companies listed below, we record that it was
  passed on; that record holds your address — and, for a corrected billing
  name, the old and new names, encrypted — only until the notice goes. How
  long each is kept is under "Retention" below.
- **Emails about changes to the list of companies.** If you ask, on our trust
  page, to be told when the list of companies that can see your data changes —
  no account is needed — we store your address, whether you confirmed it, the
  language you asked for and which change we last told you about. The link in
  the confirmation email is stored only as a one-way hash.
- **A breach record.** If a personal-data breach ever exposed your account's
  data, our record of that breach lists your account by its ID so that you can
  be told; closing your account removes it from the record, which keeps only
  its count.
- **Questions you ask the assistant.** Questions put to "Ask Boosthis" and the
  answers returned are stored against your account so the conversation and your
  usage allowance work; see the next section for what is sent to the AI
  provider.
- **Your project's Covenant: promises and rules.** A project can hold a short
  list of plain-language entries, its **Covenant**, that you want kept as the
  project changes. An entry can be a promise about the app, such as "the list
  screen stays under a second", or a rule for how your AI assistant works, such
  as "run the tests before saying a change is done". You write them on your
  dashboard, a connected AI assistant can write one down on your behalf, or you
  accept one Boosthis offers from your own numbers. We store the sentence
  itself, who wrote it, whether you have confirmed it, where you placed it in
  the list's order, and the single measurement and threshold it maps to when
  there is one — and where there is none, it is labelled as remembered only,
  never as something we check. If you ask your AI assistant for its own
  account of each rule, each remembered-only entry also gets a short tag, such
  as R3, that never changes and is never given to another entry; what that
  sends and keeps is under "The Covenant hooks in Claude Code and other
  editors". We also store when the list last changed, and a daily count of the
  times a project's AI assistant fetched the whole list, with the version it
  was handed, for **30 days**. The Covenant is held against
  the **project key**, so every runtime of that project and every teammate on
  the account sees one shared list. The text of the entries you confirmed is
  handed to an AI assistant that connects with a credential your project's team
  holds: the project's AI key, or the account credential of someone on the
  account. A project key built into an app, which anyone with a copy of the app
  can read, gets the number of entries and no text, and an entry an AI
  assistant or your code wrote is handed to no assistant until you confirm it.
  Entries are screened going in and coming out: an entry containing a
  credential, a token or someone's personal data is refused whole and nothing
  is stored. Chat transcripts, source files and documents are never stored this
  way — each entry is capped at a couple of sentences and a project holds only
  a handful. You can correct, reorder or delete any entry at any time; the
  Covenant appears in your data export and is deleted when you close the
  account, or when its project key is revoked and the purge window ends. It is
  **never** deleted because installs were removed or erased, and **never** for
  non-payment.

**How account data and telemetry meet.** Telemetry is stored against install
IDs, and each install is tied to the project key it registered with and so to
the account that holds that key: that link is what lets your dashboard, alerts,
reports, the AI connection and "Ask Boosthis" show you your own projects. It is
used only for the uses listed under "The legal ground for each use" — never for
profiling, for advertising, or to work out who an end user of your app is. You can **delete your account
yourself**, without asking anyone: **Dashboard → Delete account**, or the same
option in the Boosthis phone app. You are shown exactly what is deleted and
what we must keep before you confirm, and you can download everything we hold
about you first (**Dashboard → Your data → Download**). `forget` erases the
telemetry of an install made with a server kit at any time, independently of
your account; a website's or phone app's install is erased as described under
"How to stop reporting / delete your data".

## The companies that can see your data

Boosthis is operated by **Veqtara Tech Company**. A small number of outside
companies are involved in running it, and each one is named here. This is the
whole list of companies **Boosthis engages**, and no other company we engage
receives your account data or your telemetry. Three destinations sit outside
that list because **you** chose them rather than us — an **alert webhook** you
configure, a **chat workspace** you connect, and an **AI assistant** you
connect — and each of those does receive what you point it at. They are
described immediately after the list.

- **Moyasar** — *payments.* Provides the payment form embedded in Boosthis-hosted checkout and processes subscription charges;
  this is the **Payment Processor** defined in **Part A, Section 2** and
  described in **Part A, Section 15**. **What reaches it:** your card details,
  sent directly from your browser through the embedded form to Moyasar and never to Boosthis's servers; the amount
  and currency of each charge; the billing name and email on the payment; the
  reusable payment token that makes a renewal work; and, with each charge, your
  account's id, its short reference and Boosthis's own reference for that
  charge — a renewal also names the plan it renews. **Where it runs:** the
  **Kingdom of Saudi Arabia**. If you pay with Apple Pay, the payment sheet is
  additionally between your own device, Apple and Moyasar — Boosthis's servers
  only ask Moyasar to validate the session.
- **Resend** — *email delivery.* Sends the account emails listed under "Account
  data" above, and receives the support mail written to Boosthis: Google
  Workspace, below, passes each message sent to the support address on to
  Resend, which hands it to the support inbox. **What reaches it:** your email
  address, the subject, and the body of that message; and, for support mail,
  the sender's address and name, the subject, the body and any attachments of
  each message passed on to it. Most messages Boosthis sends are only a code, a receipt or a notice
  about your account. An alert email also states the finding in words, names
  the project and its environment, and names the install it concerns by its
  install identifier, so an alert
  about a browser or phone install of your app carries that install's
  identifier, which can relate to one of your end users; Resend is therefore
  on the sub-processor list for that data too. Nothing travels beside the
  message: there is no telemetry feed to Resend, and nothing else about your
  account goes with it. **Where it runs:** the **United States**.
- **OpenAI**, reached through a gateway operated by **Replit** — *AI
  processing.* Generates the answers from "Ask Boosthis" and helps draft
  candidate rules on our side. **Two companies sit in this path and both are
  named here, so the answer to "who processes this" needs no
  cross-referencing:** the call leaves Boosthis to Replit's AI Integrations
  gateway, on Replit's own account and credential, and Replit passes it to
  OpenAI, which generates the answer. Replit is also the hosting recipient
  named below; on this path it is the intermediary, and what it can see is the
  call itself. **What reaches it:** from your account, the
  two things described under "The 'Ask Boosthis' assistant" below — your
  screened question and a privacy-safe digest of numbers — and, for rule
  drafting, the aggregated privacy-safe signals described there. One thing more, on a different path: a short sentence a developer
  or their assistant wrote — a promise being written down, or a claim
  submitted to be checked — sent once, after the wording screen has passed
  it, together with a numbered list of up to 40 of the things that project
  already measures (route labels with their middle, typical-slow and slow-end
  times; problems with how often each was reported; daily readings with their
  worst reported day; and job names with how many days they reported, their
  quietest day's runs, their worst day's failures and their usual run time),
  so the model can map the sentence onto one of them; see "Checking a sentence
  your assistant wrote" above. It also
  receives **the text of our own rule book**, which is ours and not yours:
  rule titles, the conditions that decide when a rule applies and the
  detector patterns behind them, and — on the maintainer-side drafting and
  review calls that cannot do their work without it — the prescriptive fix
  text itself. **OpenAI publishes that what its API receives is not used to
  train its models** — the provider's published position, not a setting we
  can show you for the account we reach it on; see "What the AI provider may
  keep, and what we cannot show" below. **Where it runs:** OpenAI is a **United States** company, and
  its published residency options do not include the Kingdom — so what
  reaches it leaves. Which country actually processes it is **not
  confirmed**, because we reach the model through Replit's gateway rather
  than an OpenAI account of our own; see "Where Boosthis runs, and whether
  your data crosses a border" below.
- **Replit** — *hosting and the database.* Runs the Boosthis servers and the
  managed PostgreSQL database, and operates the AI gateway above. **What
  reaches it:** everything this document describes as stored — account data,
  telemetry, and the operational database as a whole. **Where it runs:** on
  Google Cloud infrastructure in the **United States**.
- **Google Cloud** — *backup storage.* Holds the routine backups of the
  operational database described under "Retention" below, in a private bucket
  provided through Replit's App Storage. **What reaches it:** a copy of the
  operational database. **Where it runs:** the **United States**.
- **Expo** — *phone notifications.* Named ahead: **receives nothing before
  21 October 2026**. Passes each serious-problem notification from Boosthis to
  Apple's notification service, for an iPhone whose owner turned notifications
  on in the Boosthis phone app (see "Phone notifications" under "Account data"
  above). **What reaches it:** the push address of each such phone, and each
  notification — the kind of problem, such as "New crash in production", and
  an opaque reference; never a project name or anything about the problem
  itself. When notifications are turned on, the phone app asks Expo for that
  push address, handing it the phone's Apple notification address, an
  installation identifier and the app's identifiers, and Expo sees the network
  address that request comes from. Expo's own terms also let it use what it
  handles, once aggregated or de-identified, to improve its own products.
  **Where it runs:** the **United States**.
- **Apple** — *phone notifications.* Named ahead: **receives nothing before
  21 October 2026**. Apple's push notification service delivers each
  notification to the iPhone it is addressed to; Boosthis reaches it only
  through Expo. **What reaches it:** the Apple notification address of each
  such phone, which Apple issued to that phone itself, and each notification
  as Expo hands it over — the kind of problem and an opaque reference.
  **Where it runs:** Apple is a **United States** company and publishes no
  location for its notification service, so which country processes a
  notification is **not confirmed**.
- **Google Workspace** — *receiving email.* Named late: **receiving since
  10 September 2026 at the latest, and named here only on 10 October 2026.**
  The domain's mail moved to Google Workspace in September 2026, and Google was
  not added to this list when it did: nobody treated the mail service as a
  company receiving data until it was named, so the receiving began without
  the notice this list promises. It is the mail service for the boosthis.com
  domain: it receives every message sent to an address there, including the
  support address, and passes support mail on to Resend for the support inbox.
  **What reaches it:** each message sent to a boosthis.com address — the
  sender's address and name, the subject, the body and any attachments. A copy
  of each support message stays in the owner's mailbox there with **no
  deletion schedule**: it stays until the owner deletes it. A reply written
  from that mailbox rather than from the app is sent through it too. Boosthis
  sends it no telemetry, no account record and nothing about an app.
  **Where it runs:** Google is a **United States** company. Which country holds
  the mail is **not confirmed**: the Workspace edition this account is on, and
  whether a data region is set for it, have not yet been read from its
  settings. The United States is our best understanding, and the only data
  regions Workspace offers are the United States and Europe.

The three named in that sentence are **not** on the list above, because they
are yours rather than ours, and here is what each one is: an **alert webhook**
you configure (the alerts go to whatever
URL you supply, and what the receiving service does with them is your
responsibility), a **chat workspace you connect** (if you connect Slack, the
alerts you route there are posted into the channel you picked, inside your own
workspace, using a credential you granted us and can revoke at any time — Slack
is a company you chose, not one we engaged, and what it does with what it
receives is governed by your own agreement with it),
and an **AI assistant you connect** through "Connect AI" or the OAuth sign-in
flow (that assistant is your tool, reading your data with a credential you can
revoke at any time; whoever operates it is a company you chose, not one we
engaged).

**We never sell your data.** Personal information — your name, your email
address, your account, your billing details — is never sold, rented, traded, or
shared for anyone else's marketing or advertising, and neither is telemetry. No
money and no data change hands for advertising purposes. Each company above may
use what it receives only to do the job named beside it, apart from the further
use Expo's own terms give it, named in its entry.

**Notice before this list changes.** Before another company starts receiving
account data or telemetry, it is named here first — with the revision date at
the top of this document moved — at least **14 days** before it begins, unless
a change has to be made sooner to keep the service running or secure, in which
case it is named here as soon as it takes effect. This document is the notice:
the same list stays in the same place, so a change is visible by comparing it.
That promise has been broken once: Google Workspace, above, was receiving
support mail from September 2026 before it was named here on 10 October 2026.
Its entry says so instead of being dated back, and the notice that announced
it carries the same admission.

**The same list, at its own address.** The list above is also published on its
own page at <https://www.boosthis.com/subprocessors>, with one further column
of detail per company: on whose instructions it acts, what its own published
sub-processor practice is, and what happens on an onward transfer. That page —
not this document — is the list the Data Processing Agreement (Section 25)
points at, which is why a company can be added or replaced without amending an
agreement you have already accepted. **You can subscribe rather than watch**:
<https://www.boosthis.com/trust> emails a notice of each change to anyone who
confirms their address, without an account, and the page at its own address
also publishes a feed at <https://www.boosthis.com/subprocessors.xml>.
Those companies' own published sub-processor lists are re-read on a weekly
clock and compared with what was recorded, so a change further down somebody
else's chain is something we find out about rather than something we assume
away.

## Where Boosthis runs, and whether your data crosses a border

Two questions, two answers. They are easy to blur, and the difference is
exactly what matters, so both are stated separately here. Both are taken from
the recipient list above and held to it by an automated check, so they cannot
drift from it, from each other, or from the same two sentences on the served
`/terms` page.

- Where the service runs: the Boosthis servers and the database behind them run
  in the United States.
- Whether your data crosses a border: some of it does. Moyasar holds what
  reaches it in the Kingdom of Saudi Arabia; Resend, Replit, Google Cloud and
  Expo hold what reaches them in the United States; what reaches OpenAI, Apple
  and Google Workspace leaves the Kingdom of Saudi Arabia too, but which
  country processes it is not confirmed.

These are two answers to two questions, and neither one implies the other. That
the service runs in the United States does not mean nothing leaves it, and that
something leaves it does not mean the service runs anywhere else.

Every company outside the Kingdom is on that list because a part of the service
cannot be provided without it, and each receives only what is named beside it.
The basis for that processing is set out under "Your rights over your data"
below. If you would rather nothing crossed a border at all, a **general
install** of the toolkit sends nothing anywhere.

## The "Ask Boosthis" assistant (AI processing)

The dashboard includes an optional assistant you can ask plain-English
questions about your app's performance. When you use it, two things — and only
those two things — are processed by **OpenAI**, reached through Replit's AI
Integrations gateway (see "The companies that can see your data" above), to
generate the answer:

- **Your typed question.** It is checked first: a question containing personal
  data or a link is rejected rather than sent.
- **A privacy-safe digest of your app's already-uploaded performance
  snapshot** — numbers, ratings, and code-defined labels only. Free-form
  prose and anything identifier-shaped is dropped or blocked before it leaves
  the server, and the answer that comes back is screened again before you see
  it.

Nothing new is collected for the assistant, and it runs only when you ask a
question. OpenAI's published position for its API is that what it receives is
not used to train its models — that is the provider's published position, and
what we can and cannot show you about it for this account is set out under
"What the AI provider may keep, and what we cannot show" below.

**Rule drafting on our side.** Separately from the assistant, the Maintainer
uses the same provider — OpenAI, through the same gateway — on a schedule to
help draft candidate rules from the aggregated, privacy-safe signals described
above — rule kinds,
severity and timing buckets, redacted code locations, and occurrence counts;
never route labels from full samples, never your question, and never anything
identifier-shaped. Drafts only ever land in the maintainer's private review
queue, and a human decides what ships (see "How candidate rules become real
rules"). This is rule-book improvement — the single purpose described above.
The provider's published position on training covers this traffic too, subject
to the same limit on what we can show you.

**What the AI provider may keep, and what we cannot show.** Whether your data
trains a model is not a question we can answer yes or no, so here are all four
answers: what is known, what is not, why, and what would settle it.

*What is known.* **OpenAI's own published position for its API**, read on
**14 September 2026**, is that what it receives is not used to train its
models. **The gateway operator publishes a position of its own**, read on
**15 September 2026**: training is disabled for paid model providers, prompts
**may** be used for training by free ones, and zero-retention endpoints are
enforced only for Enterprise accounts held with the gateway operator itself
(its own customer accounts, not the Boosthis Enterprise plan).

*What is not known, and why.* Whether either statement governs this path.
Turning training off is a choice made **on an account**, and we reach the
model on **Replit's gateway account**, not one of our own — so the provider's
default is something we can quote to you and not something we can show you is
in force here. The gateway operator's own statement turns on two facts this
server cannot read: which plan that account holds, and whether the model we
call counts as a paid provider in that sentence. What the gateway itself does
with a prompt in transit it does not publish at all.

*What we believe, marked as a belief.* That nothing on this path is used for
training. Both published positions point that way and neither contradicts it.
That is a belief resting on published defaults, and we will not put it to you
as a fact about your own data.

*What would settle it.* Either of two things, and this page will say so when
one happens. A statement from the gateway operator naming the plan that
account runs on, and whether the model we call is a paid provider under its
own policy, would settle it for the path in use today. Moving Boosthis onto an
OpenAI account of our own would settle it a second way, because the setting
would then be ours to hold and to show you. Neither has happened. Until one
does, read the assistant as sending your question down a path whose training
position we cannot demonstrate.

**How long a prompt survives is not established, and we record that as unknown
rather than assume it.** OpenAI's published default deletes an API input after
**at most 30 days** of abuse monitoring, with immediate deletion available only
by prior arrangement, which we have not sought. Whether the gateway operator's
account runs on that default is not published. The gateway operator does
publish a position of its own, which we read on **15 September 2026**, and it
settles nothing here: it states that training is disabled for paid model
providers, and that zero-retention endpoints are enforced **only for Enterprise
accounts held with the gateway operator itself** (not the Boosthis Enterprise
plan). Neither branch names the plan this path runs on, and the
gateway publishes nothing about what it logs or for how long. A prompt may
therefore survive in
two places on this path, and we are not in a position to tell you for how long
at either. Settling it needs an answer from the gateway operator; until then
this paragraph says so.

**Does your own contribution reach a third-party model?** What a customer sends
— a question, a measurement — is covered above. The rule book's own text is
ours rather than yours, and it does reach the provider when we draft and review
rules: the prescriptive fix wording for a rule under review, and for the
language passes, the rule being translated. Every call that carries it is
listed in our code, with the reason the answer needs it, and the sending of it
is bounded — a drafting call carries one rule, or two fixed examples, never a
sweep of the book.

## Security reports from our own website

Every page on the Boosthis website carries a browser security policy. On the
public pages, the ones anyone can open without signing in, your browser
**enforces** it: if a page tries to load something the policy does not allow,
the browser refuses it and sends us a short report. On the pages behind sign-in
the wider policy is **report-only**: nothing is blocked there, and your browser
only sends the report. Most reports are a browser extension rewriting the page;
occasionally one is the signature of injected code.

From that report we keep three coarse things: which kind of content was
involved (for example a script or an image), the **scheme and host name only**
of where it came from, such as `https://cdn.example.com` — or, where there is
no host, a keyword such as `inline`, `eval` or `data`, and where the host is a
bare IP address, only the fact that it was one — never a full link, path, or
query string; and a stripped-down label for the page it happened on
(identifier-shaped parts replaced), with the day and how many times. No IP address,
no account, no session, no device, and nothing else about you is stored, and
identical reports are counted rather than stored twice. These reports are about
the security of our own website, are visible only to the Maintainer, and are
deleted after 90 days. The first report of each kind from a public page is also
emailed to the Maintainer, made from those same three things and nothing else.

## Counting visits to our website

We count visits to the public Boosthis website — the pages anyone can open
without signing in — so we can tell how many people come and what they read. It
is a counter, not tracking: **Boosthis's own code sets no cookie on these
pages**, counting runs no script of ours in your browser, and nothing kept can
be tied back to you.

**One cookie we do not set.** Our hosting platform's edge, which every request
to this domain passes through, adds a cookie named `GAESA` to its responses.
Boosthis neither sets nor reads it, and nothing we keep is linked to it. We
check the live public pages every day, and we are told if any other cookie
starts arriving on them.

For each public page we answer we add one to a small set of counts, kept per
hour: which page it was, which of our public addresses it was opened on, the
**host name only** of the site that linked to you (never the full link), an
approximate **two-letter country**, a coarse **device class** (phone, tablet or
computer) plus a broad browser family, and whether the request named itself as
a known crawler. That is the whole of it — counts against those labels, never a
record of a visit, and only counts for pages we already publish by name
(anything else is counted as simply "other").

For these counts, your **IP address is never stored**. It is used in memory for
two things and then discarded: working out the two-letter country (on our own server, from a
table that ships with the software — we never send your address to anyone
else), and building a **daily de-duplication tag** so the same visitor counts
as one person that day rather than one per page. That tag is a one-way hash
salted with a secret *and with the day itself*, cannot be turned back into an
address, and is deleted within days — which is exactly why we cannot tell a
returning visitor from a new one, and cannot follow anyone from one day to the
next. The full browser description and the full referring link are discarded in
the same breath; neither is written down for these counts. Every other place an
address or a browser description reaches is listed under "Where an IP address
or browser description goes" below.

The country is approximate and can be wrong (a VPN or a company network moves
it), and where it cannot be told it reads "unknown" rather than being guessed.
These counts are visible only to the Maintainer.

## Where an IP address or browser description goes

Every place on our side that receives the IP address a request came from, or
the full description a browser gives of itself, is listed here with how long
it lasts. There is no other.

- **Website crash browser counts.** On arrival, the server reads the browser
  description the upload already carries and counts reports per crash by
  browser family from a fixed list: Chrome, Safari, Firefox, Edge, Samsung
  Internet, Opera, the in-app browsers of Instagram, Facebook, TikTok and
  Snapchat, another browser, or not said. The description itself is not stored.
  The counts stay with the crash record. The legal ground is legitimate
  interest in diagnosing the customer's crashes.

- **The server's request log.** Every request to Boosthis, public pages
  included, writes one line to the server's own operational log. A request that
  reaches our front-door server first is passed on to that server with its
  address and browser description, and the front door keeps neither. The log
  line holds no IP address, no full browser description and no email address. In
  their place it carries a **same-day tag** — a one-way keyed hash of the
  address, under a key that is held only in memory and replaced every day and
  whenever the server restarts, so a tag cannot be turned back into an address
  or matched across days — plus a coarse device class and a broad browser
  family. Our host keeps these logs for **30 days** (see "Retention" below).
  Lines written before this revision of the policy took effect held the full
  address and browser description, and two maintainer actions also wrote an
  email address; the host keeps those older lines for the same 30 days and no
  longer.
- **The security log.** The IP address a staff action came from, kept with
  the entry and erased two years after it was written, and the network a
  refused staff sign-in came from, as described under "Account data" above.
- **Counting visits to our website.** The address is read in memory for an
  approximate country and the same-day de-duplication tag described above,
  then discarded; the tag is deleted within days. The browser description is
  reduced to a device class and a browser family on arrival.
- **Checkout.** When you start a payment, the address is read in memory to
  work out an approximate country, which decides only whether the checkout
  asks about a legal right to withdraw from the purchase. It is never stored.
- **Security reports from our own website.** No address is kept from a
  report, as described above.
- **Security watches.** When a member of the Maintainer's staff signs in to
  the staff pages, or somebody fetches one of the decoy addresses we plant so
  that a leak is noticed, the address is read in memory for an approximate
  two-letter country. Only that country is kept, for **400 days** after it was
  last seen; the address is never stored. A decoy fetch also keeps a broad
  client family (such as "a web browser"), never the full browser description.
- **Abuse limits.** Rate limits count requests per account, project key or
  install. Three of them also count per address, so that one source cannot
  guess passwords or use up an allowance everyone shares: signing in to an
  account, signing in to our staff pages, and registering a new AI connection.
  Those counts are kept under a one-way keyed hash of the address, made with a
  secret the server holds outside its database and backups, never under the
  address itself, and they hold no account or email address. Each count covers
  one hour and is deleted within **48 hours**.
- **Telemetry.** The kits never put an end user's IP address into what they
  send, and no telemetry record holds one. An upload is still a request, so its
  line in the request log above can name the install in the address it was sent
  to, beside the same-day tag (or, in lines written before this revision took
  effect, beside the full address).

## What the toolkit stores on a device

The browser kit keeps a small amount of state in the browser's own **local
storage**, on the site it is running on. **The kit sets no cookie in the
application it runs in**, and nothing it writes is readable by any other site.

Every entry's name begins with `boosthis:`, so the kit never collides with —
and never enumerates — the application's own storage. What is kept is:

- the install's own identifier, the project it reports to, and the token that
  lets that application read its own measurements back;
- the version of the Boosthis notice the user agreed to, where the
  application shows one;
- measurements taken but not yet uploaded — a crash waiting to be sent, which
  is retried and dropped after 30 days, a page-view tally, the page map, and
  the baselines a candidate rule is compared against;
- a short crash history: for each time the site was opened in the last 24
  hours, at most 32 of them, when it began and was last in use, the times of
  its crashes and how many errors from browser extensions were set aside —
  times and counts only, each dropped after 24 hours;
- the day's visit tag (see "Anonymous daily visit tag" above), replaced each
  day, and when the current visit began, so that pages opened within 30
  minutes of one another share one clock while they settle;
- where Boosthis has asked the kit to hold back its uploads for a while, the
  time until which it should;
- where someone signs in to a Boosthis account from the kit's own panel, that
  sign-in and the email address cut down to its first letter and its domain,
  such as `f…@example.com`;
- the cached answer to whether the install is still switched on, so that a
  page load does not have to ask again;
- where the site's owner opened it with the owner link from their project's
  page on Boosthis, the owner pass Boosthis gave that browser in exchange and
  the time it runs out, so the bubble is drawn there while Boosthis keeps
  confirming it; `?boosthis=off`, the switch-off control in the bubble, or a
  refusal from Boosthis removes it.

Where a server kit's dashboard bubble is switched on, the kit sets two cookies
in that one browser, on your application's own domain: `boosthis_owner_pass`,
holding the owner pass Boosthis confirmed when the owner link was opened,
which the page's scripts cannot read, and `boosthis_owner`, set to 1 to mark
the browser as switched on (on the machine the application runs on,
`?boosthis=on` sets only this one). Both last about 30 days, and
`?boosthis=off`, the switch-off control in the bubble, or a refusal from
Boosthis removes them. No other browser is given either cookie or the bubble's
script. That script keeps one entry in local storage — once the notice inside
the bubble is accepted, the version of that notice — and removes the owner
flag earlier kit versions kept there. It keeps nothing else on the device.

None of it is a profile and none of it is shared: it is the state one install
needs in order to keep working across reloads. Where the browser refuses
storage — private mode, a sandboxed frame, storage switched off — the kit
falls back to memory that dies with the page rather than failing. Clearing the
site's data removes all of it, and so does the kit's own `forget()`, which
also stops that browser sending. What that browser already uploaded stays with
the site's install, which all of its visitors' browsers share, until the site's
owner erases the install (see "How to stop reporting / delete your data").

In a phone app, the React Native, Flutter, Swift and Kotlin kits keep the same
kind of state in that app's own private storage, which no other app can read.
They set no cookie. What is kept is:

- the install's own identifier, the project it reports to, the app's name and
  the credentials Boosthis issued to the install;
- whether the install has registered, the answer about sharing that Boosthis
  last gave it, and when it was switched on;
- measurements taken but not yet uploaded — a crash waiting to be sent is
  kept, tried again at each later launch and dropped after 30 days — with the
  time of the last upload, the screen map and the baselines a candidate rule
  is compared against;
- the cached answer to whether the install is still switched on;
- on the React Native kit, the day's reach tag (see "Anonymous daily reach
  tag" above), replaced each day;
- where your code hands a Flutter, Swift or Kotlin kit its outgoing calls to
  watch for bursts, the host names called in the last ten seconds and when,
  at most 200 of them.

Removing the app removes all of it, and so does the kit's own `forget()`. On
both the browser and the phone kits, an end user's consent switch set to
withheld or to this session only erases it too (see "Every way reporting
stops" below). What a phone already uploaded stays with the app's install,
which every phone running that build shares, until the app's owner erases the
install.

On a server, the server kits keep their own working state — the install's
identifier and credentials, measurements not yet uploaded and the baselines a
candidate rule is compared against — in a folder of their own on that machine,
by default `.boosthis` in the home folder. It stays until the kit's own
`forget()` removes it or you delete the folder. That machine is yours, and
nothing in that folder is written to anyone else's device.

## What we never collect

- IP addresses — never as part of telemetry, and never used to identify you
  or joined to your telemetry. The only stored copies are the ones listed
  under "Where an IP address or browser description goes" above, each with
  its lifetime; none is used for profiling or joined to telemetry.
- User IDs, emails, names, phone numbers, addresses, device IDs, or any other
  identifier — the 83-entry PII denylist blocks them at both ends. (The email
  addresses we do hold — your own, the teammates you invite, the billing
  contacts you add, and the people who write to support, make a request about
  their data or subscribe to a notice — are listed under "Account data" above;
  none of them ever arrives as telemetry or is added to it.)
- Request bodies, response bodies, query strings, headers — none of it is
  collected, and none of it is uploaded.
  Reading something inside your process and collecting it are two different
  things, and this is the whole of the first. The one exception is the AI-call
  meter: to tell repeated prompts apart it reads up to the first 4,096
  characters of an outbound request body to an AI provider, inside your own
  process, and reduces it immediately to a single number — no body text is
  stored, uploaded or recoverable. Nine other bounded reads work the same way
  — inside your own process, reduced on the spot to a number, a flag or a
  label from a fixed list: the same meter reads the provider's reply as it
  streams back, holding at most 8,192 characters of a partial line at a time,
  to take the token counts the provider states in it; when a provider refuses
  a call, the meter takes its own copy of that error reply to say which kind
  of refusal it was — the Python kit stops accumulating at 8,192 characters,
  and in Node and the browser the runtime hands the reply over as one string,
  of which anything longer than 8,192 characters is dropped without being
  examined; the leak watch reads up to the first 8,192 bytes of an ERROR
  response your app is about to return, to see whether a stack trace or a
  secret-shaped string is about to reach one of your users; in the browser,
  and only if you switch it on, a copy of a JSON answer to one of your app's
  own calls is read to see whether it is error-shaped despite its 200: the
  copy is taken only where the server declared a length of 65,536 bytes or
  less, and because a declared length can understate what arrives, the copy
  the browser hands back is checked again and dropped unexamined past 65,536
  characters; on an MCP endpoint your app serves, up to the first 64 KB of the
  JSON-RPC request is mirrored as your app reads it, to take the method name
  out of the envelope — never the arguments, and never a byte of what the app
  itself receives is changed; in the edge kit, the repeated-work and database
  readings fold up to 4,096 characters at each end of an outgoing call's
  query, and of its body when the body is text, into one number, so that two
  different calls to the same address are never counted as the same work; the
  number is compared inside the request and dropped with it; the cookie check
  reads the Set-Cookie headers your app sends — at most 20 per response, and
  at most 2,048 characters of the attribute tail on each, which is 2,048 bytes
  in the kits whose strings are bytes — for the Secure, HttpOnly and SameSite
  flags and the size, never the value; the Node kit also reads each cookie's
  name, up to 1,024 characters and stopping where the name ends, and matches
  it against a fixed word list only to decide whether a missing HttpOnly
  matters — a session or token cookie needs it, a CSRF or preference cookie is
  meant to be read by your page's own script — and the name is never kept or
  sent; the Cookie header your users send is not read at all; a fixed list of
  headers is looked up by name and turned straight
  into a number or a fixed label: the content type, length and encoding, the
  Accept header your user's browser sent, whether your reply is marked as a
  download (Content-Disposition), the cache instructions and validators on
  your app's own reply (Cache-Control, ETag, Last-Modified), the
  elapsed-milliseconds offset a previous instrumented hop wrote, the
  queue-start timestamp a proxy adds, the presence (never the value) of a
  reverse proxy's forwarding headers (X-Forwarded-For, X-Forwarded-Host,
  X-Forwarded-Proto, X-Real-IP), whether the Host and Origin headers on a
  request for one of the kit's local-only answers name this machine (a yes or
  no that decides whether the kit answers; neither value is kept), whether a
  request carried an Origin header and whether the cross-origin headers on
  your app's own reply (Access-Control-Allow-Origin and
  Access-Control-Allow-Credentials) answer any origin, repeat that Origin
  back, or pair any origin with credentials (yes-or-no answers that become
  counts; no origin or header value is kept), a hosting
  platform's cache verdict, an AI provider's rate-limit headroom, retry delay
  and service-side processing time, and whether an authorization header or an
  authentication challenge is
  present — never its value, and never a header nobody named: the list is the
  claim, and a kit that starts reading a header outside it fails our own build
  before it ships; and the query values the kit reads on its way OUT are the
  ones in URLs the kit itself builds for its own uploads, read key by key so
  the guard can refuse anything identifier-shaped before it leaves your
  process; your app's own query strings are cut off, unread, before a route
  label is made. One bounded read is not a reduction at all, because what it
  holds is your own page on its way to your own visitor: where the dashboard
  bubble is switched on, an HTML page is buffered so the one script tag can be
  written into it — up to 2 MB, 4 MB on .NET, past which the page is passed
  through untouched. Those bytes are handed back with one script tag added and
  nothing taken from them. One read is neither narrowed to a label from a
  fixed list nor limited in length, because the value IS the question being
  asked of the kit's own endpoint: the kit's own local read endpoints — the
  panel and the JSON reads it serves under its own path, behind their loopback
  or key gate — read the query of requests made TO THEM: how many rows to
  return, and which route name to filter to; the row count becomes a number,
  the route name is compared, exactly as the caller wrote it and with no limit
  on its length, against the route names the kit is already holding, so a name
  matching none of them simply returns nothing; neither value is recorded, and
  these endpoints read no other query string in your app. Nothing checks it
  against a list first, no cap is put on how long it may be, and nothing is
  derived from it or kept once the reply has gone. One bounded read does not
  stay inside your process, and the difference is set out here rather than
  left to be inferred: on a request arriving at your app, the kits on your
  servers read two headers for their VALUE rather than for a label — the trace
  id and the caller's span id that another Boosthis-instrumented service of
  yours wrote on it. A value is taken only if it is exactly the shape the kits
  mint (32 hexadecimal characters for the trace, 16 for the span), and
  anything else is discarded, the trace id replaced with a fresh random one.
  An adopted trace id then IS that request's trace id: it is put on the hops
  your app makes while handling the request, and it is uploaded with that
  request's timings; an adopted span id is uploaded as the parent of that
  request's own step. That is the only way one action crossing several of
  your services can be shown as one line rather than several unrelated ones.
  Those two ids are the only things read here that are carried onward or
  uploaded with your app's readings; each is an identifier the kits mint and
  nothing is derived from it, and no other header's value is read. Two reads send what they hold to Boosthis,
  because what is held is a credential Boosthis itself issued and only
  Boosthis can say whether it still stands: where the dashboard bubble is
  switched on, the kit looks in a page's address for one key, boosthis — a
  server kit in the address of each page request your app receives, the
  browser kit in the page's own address — and only for one of three answers: a
  one-time owner proof from your project's page on Boosthis, which is sent to
  Boosthis to be swapped for an owner pass that lasts about 30 days (a server
  kit keeps it in a cookie of its own, the browser kit in that browser's own
  storage); off, which forgets that pass; or on, which only a server kit
  honours, and only from the machine itself; when the kit acts on one, the
  browser is left at the same address without that key, no other key in the
  address is used or kept, and the switch-off control in a server kit's bubble
  only ever writes that key, as off, into the address of the page it is on;
  and a server kit looks in the cookie header of each request your app
  receives for two cookies of its own and uses no other:
  `boosthis_owner_pass`, which holds the owner pass Boosthis issued through an
  owner link, and `boosthis_owner`, which holds only 1, marking the browser as
  switched on; the pass is sent to Boosthis to ask whether it still stands,
  and the kit keeps the answer for up to ten minutes (thirty seconds when
  Boosthis did not answer); a request without that cookie makes no call at
  all; the bubble's script in the page reads the second cookie to decide
  whether to draw; where a kit can only set its cookies by rewriting the
  response's Set-Cookie lines, it takes the ones your app already put there
  and hands them back unchanged beside its own; and on a page that carries the
  bubble it adds Cookie to your app's Vary header, keeping what was there. One
  read is neither bounded nor reduced to a number, and you ask for it
  yourself: one endpoint the Python kit's panel serves takes a POST — the rule
  matcher — and it reads that request's body in full, because the code you
  paste in IS the question being asked: it is matched against the rule book
  inside your own process, behind the same loopback or key gate as the rest of
  the panel, the answer is a list of rule names, and neither the code nor any
  part of it is stored, logged or uploaded. Apart from the trace id and span id
  another instrumented service already put on the request, the owner link's one key,
  boosthis, in a page's address and the kit's own two owner cookies, none of
  what is read here is stored, uploaded or recoverable from what is uploaded,
  and the guard on the upload path refuses outright any payload carrying a
  request or response body, a header, a cookie or a query value — and those
  ids are uploaded as fields of their own, never as the header they arrived in, and
  the owner proof and pass go to Boosthis on calls of their own, never inside
  an upload.
- Raw stack traces, raw error messages, or log lines — a crash report records
  a redacted code location (function + file basename + line), the error
  *type*, the screen or route it happened on (or why that is not known) and
  the trace references described under "Crash reports" above; website reports
  also carry the closed mistake and whose-code words, the screened code name
  or its absence reason, and service word described there, with browser-family
  and screen or route counts. Only if you opt
  an app into detailed crash mode does it add the first line of the message,
  cut to at most 300 characters *and only if it passes the PII guard*, and up
  to 20 redacted frames. Never a raw stack, never a value. A health meter that
  watches logged errors records only **how many** and how often — never the
  line, the message, the logger, or the level.
- Command lines, arguments, environments, or output of processes your app
  spawns — the subprocess meter records only how many spawns happened and how
  often
- The **names** of the things meters count — threads, workers, modules,
  handles, timers, files, pools or queues. A meter reports *how many* and *how
  long*, never *which*.
- Your source code. Boosthis will **never read your codebase** — no kit opens,
  scans, indexes or uploads a source file, and no source text is stored on our
  servers, including from a build map, whose embedded copy of your source is
  discarded the moment the map arrives and is never written down.
- Hostnames, and the values of your environment variables, are never sent,
  with two exceptions. The first is the region code a hosting platform
  publishes about itself, such as `us-east-1`, sent as described under "Where
  a server runs" above. The second is an outside service your app calls in a
  burst: where a kit watches your app's outgoing calls for one host being
  called again and again without backing off — five or more calls to it
  within ten seconds, typically less than a second apart — it reports that as
  a problem named after the host alone, such as `api.example.com`, never a
  path, query string, port or anything else from the address. The Node kit
  watches for this on its own, and some other kits do so only where your code
  hands them each outgoing call. A kit does read environment variables inside
  your own process — its own settings, and the markers a hosting platform
  publishes about itself — and, apart from that region code, what leaves is a
  word from a fixed list or a number worked out there, never the value it
  read; the browser kit's development-posture check, for one, reads `NODE_ENV`
  to report whether a development build is running, as a 1 or a 0. File paths are never sent from your machine either, with one
  exception, named here rather than further down the page: a build map a
  developer uploads keeps its own original source paths, for as long as that
  map is kept (see "Build maps you upload" above). Two things read paths
  without sending them: a kit reads the paths in an error's stack inside your
  process only to cut each one back to its file name, so a crash frame's file
  is a basename; and the editor extension's chat reader opens the conversation
  files your assistant keeps on your disk, and compares the working folder a
  session records with your project's, as described under "Reading your own
  chat messages in your editor" above.
- Screen contents, screenshots, video, audio

## How your connection and our pages are protected

<!-- These three paragraphs are generated from
     artifacts/api-server/src/lib/transportSecurityPosture.ts and checked
     against the headers the server actually sets. Edit that module, not this
     text. -->

Every connection to Boosthis is HTTPS. Our hosting edge sends a two-year
Strict-Transport-Security instruction covering this domain and its subdomains,
so a browser that has seen us once refuses to talk to us over plain HTTP again.
We deliberately do not send a second copy of that header ourselves: a reader
that receives two of them acts on only the first, so adding ours would change
nothing and would make the response look malformed to a scanner. We check every
day that the instruction is still arriving, and we are told if it stops.

Our public pages, the ones anyone can open without signing in, carry a
Content-Security-Policy that the browser enforces. Scripts may load only from
our own address, no script written into the page itself is allowed to run, and
no site may frame the page, which is what stops clickjacking. When a browser
blocks something on one of these pages it reports it to us, and we are told.

Our other pages, the dashboards behind sign-in above all, carry a
Content-Security-Policy that forbids any site from framing them. The wider
policy that describes every script, stylesheet and connection those pages
legitimately use runs in report-only mode: the browser does not block on it, it
reports to us when a page loads something outside it. It is report-only because
our dashboards render scripts and styles inline, and a blocking policy that
permits inline code would not be blocking anything. That is an honest limit: a
script injected inline into one of those pages would not be reported, while a
script loaded from anywhere we do not use would be.

## Defense in depth

The same PII denylist runs on the client AND on the server. A malicious or
out-of-date client cannot bypass the guard by renaming fields — both layers
reject the whole batch on the first hit, and the server logs the offending field
name (but not its value) for diagnostics. The PII guard runs **even when the
kill-switch (`BOOSTHIS_DISABLED=1`) is active** — disabling the runtime cannot be
used to smuggle PII past the chokepoint.

## How candidate rules become real rules

The submission is automatic, the promotion is not.

1. The runtime watches your local perf events. When the same privacy-safe
   signature recurs and your app is registered, the signature is uploaded
   automatically — no click required, no review queue on your side.
2. The server upserts on `(install, signature)`, so the same signature from the
   same install can never inflate the corpus. Aggregation happens across distinct
   installs.
3. A human maintainer reads aggregated signatures (never any one install's
   data) and decides whether they become a rule. The words themselves may be
   written by the Maintainer's own model, by the developer's own connected AI,
   or by the maintainer; what a maintainer approves may be the words as
   submitted, or the maintainer's own rewrite of them.
4. An approved rule reaches developers by one of two routes. It may be
   **hand-landed in the shipped rule book**, arriving in the next Boosthis
   release for everyone; or it may be **served as written, immediately, over
   the HTTP API and the MCP server**, with no kit release involved. Which
   route a rule takes is the maintainer's decision at the moment of approval.
   Either way the rule is **human-reviewed** before any developer can fetch
   it: it takes an explicit, per-proposal approval by the maintainer, and the
   wording has passed the same privacy and safety screen as everything else
   Boosthis stores or serves. A served rule may be re-worded or withdrawn at
   any time without notice (Part A, Section 9).
5. After a signature has been turned into a rule, the aggregated row
   stays on the server so it can keep informing rule-usage and trend
   analysis; it is not deleted when the rule ships. It is permanently
   de-identified if you erase your data (`forget`) — see Retention below.

We do **not** and will not auto-publish unreviewed rules. The shortlisting is
automatic; a human decides every rule that reaches a developer.

## Retention

- Full performance samples: each is kept for **30 days** from when it
  arrives, and routine housekeeping then deletes it. Samples are also deleted
  immediately by `forget`, and by the 60-day countdown after a revocation or
  suspension.
- Traced steps (cross-runtime traces): at most **20** steps are kept for any
  one trace, and each is deleted once it is older than **7 days**. Routine
  housekeeping deletes steps past that age, a batch at a time and oldest first,
  and so does a share of the uploads that bring new traced steps, from any
  project, so a step can outlive 7 days by as long as a backlog takes to
  clear. The daily record of how each traced action was wired — how many
  routes, runtimes and layers it touched, never the steps themselves — is kept
  for **90 days**, and only that share of uploads deletes it, so it can
  outlive 90 days: longer when few steps are arriving, and with no limit while
  none arrive at all. Both are deleted by `forget` and when you close your
  account.
- Candidate rule signatures: one row per install and signature, and repeats
  just add to a counter. A row is deleted **365 days** after the signature was
  last reported, unless the rule book still stands on it — as evidence behind
  a proposal waiting for a decision or accepted, behind a rule we serve or
  have withdrawn, or behind
  an open question about measuring it — in which case it stays until it no
  longer does; it is not deleted when a rule ships. If you erase your data
  (`forget`) first, the signature is
  retained but permanently de-identified (see below), and the de-identified
  row is deleted **180 days** after it was last reported.
- Crash reports: one row per recurring crash signature, on the same clocks as
  candidate signatures — deleted **365 days** after the crash was last
  reported, or **180 days** once de-identified, unless the rule book still
  stands on the signature in one of those ways. If you erase your data
  (`forget`), the row is
  permanently de-identified — your install ID is replaced with a random
  anonymous key that cannot be traced back to you, and any opt-in detailed
  fields (message summary, stack frames) are removed — and the remaining
  code-derived signature is retained as part of the shared rule book (Part A,
  Section 7) until that clock runs out.
- Crash day-by-day record: one row per crash signature per day it happened,
  holding only the signature, the day, two counts and the environment the
  project had declared. Kept for 200 days from the day it records; deleted
  outright — not de-identified — when you erase your data (`forget`) or close
  your account.
- Crash refusal record: one row per install per refusal reason, holding only
  the reason, its counts and four times. Kept for 90 days after the latest
  refusal it counts; deleted outright — not de-identified — when you erase your
  data (`forget`) or close your account.
- Install credential record: for each install, per hour, how many requests
  Boosthis refused for their install credential on each of its own routes and
  for which reason, each time a credential was issued, handed back, retired by
  a cut or issued by Repair and what caused it, and each erase request a copy
  was declined, each with the first and the latest time in the hour. The
  credential record carries nothing your app sent except the install ID, and
  it is included in your data export. Kept for 90 days after the latest event it
  counts; deleted outright — not de-identified — when you erase your data
  (`forget`) or close your account.
- Fix-resolution signals and learned rules follow the same rule on erasure:
  retained, permanently de-identified. A fix-resolution signal is deleted
  **365 days** after it was last reported, or **180 days** once de-identified,
  whatever the rule book stands on. A rule proposal waiting for a decision,
  accepted, served or withdrawn is kept with no end date, because it is the
  record behind a rule; one the Maintainer rejected is deleted **365 days**
  after that decision, where the date of the decision was recorded (an early
  rejection with no recorded date stays until it is decided again).
- Claim-check readings: one row per sentence Boosthis was asked to read, holding
  only how it was read and never the sentence. Pruned after 31 days. They carry
  no account, project or install, so erasing a project or closing an account
  leaves nothing in them to delete.
- Changes Boosthis witnessed: one row per aim a checked sentence resolved to —
  the subject, the measurement, the line and the judgement, never the sentence.
  There is no timed expiry: a row is kept while the project is on the service,
  and is deleted when you erase the project (forget) or close your account.
- Changes your assistant filed: one row per change an assistant said it had
  made on your project — the line it wrote and, where it gave one, the screen,
  endpoint or job it names. There is no timed expiry: a row is kept while the
  project is on the service, appears in your data export, and is deleted when
  you erase the project (forget) or close your account.
- Things an assistant said it would build: one row per name declared — the
  name as the app would register it, and nothing else. A name nothing has been
  heard about for 45 days stops counting as outstanding but is not deleted; a
  row is kept while the project is on the service and is deleted when you
  erase the project (forget) or close your account.

- Dashboard snapshots: only the **latest** snapshot per app is kept — each
  upload replaces the previous one; `forget` deletes it.
- The **register of your app's parts**: the route and screen names your
  project has been **observed** to have, pooled across your installs so that
  replacing an install does not restart a part's history. It is built only
  from readings that arrived — never from a route list your framework or
  navigator declares — and each entry is kept for **180 days** after that part
  was last seen, so a part that has gone quiet stays on the list, marked
  quiet, with the date it was last seen. `forget` on your project's last
  install deletes the register, and so does closing your account.
- **Which kits your project needs**: the list of Boosthis kit names your
  project was worked out to need — the kit names only, from our own published
  list — with when and under which version of the scanner's rules it was
  worked out. It arrives when you ask the Boosthis connection which kits this
  project needs, or when you deliberately send the hosted scanner's answer,
  and it is kept for **365 days** after it was last given so your project row
  can show the languages that are not reporting yet. The scanner reads file
  names and manifest contents on your machine, and its answer, if you send
  it, carries kit names only. The connection accepts only names on Boosthis's
  published signal list — file names such as `package.json` and framework
  names such as `express` — plus folder labels your assistant chooses;
  anything else it is sent is dropped on arrival, unused and unkept, and its
  answer says how many items were dropped. No manifest contents, no
  dependency names outside that list and no source code are asked for, and
  nothing from your project is stored but the kit names. Closing your account
  deletes it, and so does erasing the project.
- Your project's day-by-day figures — the daily numbers your dashboard draws
  its trends, scores and alerts from, never a single request — are each on a
  clock of their own: the project's daily figures and scores for **400
  days**; the figures for each route or screen for **90 days**; each
  background job's runs for **97 days**; the links on the page map for **45
  days**; the estimated number of browsers that reported to a website each day
  for **35 days**; and, for each control on a website's pages, how many
  presses did something and how many did nothing, for **90 days**. The record
  of alerts Boosthis held back (a count per project, reason and day) is kept
  for **90 days**. A finding of the watch that compares a project's recent
  numbers with its earlier ones is deleted when the watch no longer finds it,
  and at the latest **30 days** after the last check that touched it. Erasing
  the project (`forget`) or closing your account deletes all of them.
- Your AI usage and connection records: the monthly count of your questions
  to "Ask Boosthis" against your allowance, and how much text each answer used
  and which model wrote it, for **13 months**; each time an AI assistant read
  one of your projects through the connection, for **365 days**; which rules
  and fixes Boosthis handed a project's assistant, for **365 days** after the
  last time it handed one over; a daily count of the connections made with a
  project's credentials, and of those refused, for **90 days**; and a daily
  count of the times a project's AI assistant fetched its whole Covenant, with
  the version it was handed, for **30 days**. Closing your account deletes all
  of them.
- The Covenant hooks' record of each request they counted — when it happened, in
  which editor, the two tags made on your machine, the hook's version, the
  Covenant version, for a miss its reason, and, while you ask your assistant in
  Claude Code for its own account of each rule, the rule tags it was asked about
  and the answers that came back — and its daily count per project key are each
  kept for **30 days** after they reach Boosthis; what came back when a reply
  ended goes with its request. Closing your account deletes them.
- Aggregated rule-usage counts with no install ID attached may be retained
  longer for trend analysis.
- Short-lived operational rows (sessions, one-time codes, rate-limit
  counters) expire and are pruned automatically within hours to days;
  rate-limit counters within **48 hours**.
- Payments: the record of each payment actually made — the amount, the date,
  its references, the VAT charged, any refund or credit note, and the billing
  name, address and buyer details on it — is kept with **no deletion clock**.
  Tax law requires it for at least **six years** from the end of the tax
  period it relates to (Article 66(1) of the VAT Implementing Regulations),
  and nothing deletes it after that; it also survives closing your account
  (see the account-data entry below). An attempt that never became a payment,
  with the card brand and last four digits it carried, is deleted **30 days**
  after it began.
- Sign-up refusals — the domain of a refused address, the reason, whether it
  was a sign-up or an invitation, and a count per day — are kept for **180
  days**. Registrations Boosthis turned away — for each project key or
  install, a count per day with the latest reason and time — are kept for
  **90 days** after the latest refusal they count, and deleted when you close
  your account.
- Email delivery records — for each email we sent, the address, what kind of
  email it was, when it was sent and what the email provider later reported
  about it (delivered, bounced or marked as spam) — are deleted **31 days**
  after they were recorded, and when you close your account.
- Requests to use your rights: the record of each request — who asked, for
  what, when it arrived, its deadlines and any extension, how identity was
  checked, and the answer — is kept with **no end date**, because it is the
  evidence that the request was answered. Closing your account removes your
  address and the account link from it; a request from someone with no
  account keeps the address it came from. The record that a correction or a
  deletion was passed on to another company is also kept with no end date,
  for the same reason, but without your address once the notice has gone.
- Emails about changes to the list of companies: an address that asks to be
  told but never confirms is deleted once the confirmation link has expired,
  **7 days** after the request; a confirmed address is kept until the stop
  link in any notice is used, or the account with that address is closed.
- Challenges to an AI answer — which surface it was on, the reason picked and
  a pointer to the answer, never the answer's text or who challenged it — are
  deleted after **31 days**.
- Questions you ask "Ask Boosthis" and its answers are each deleted **365
  days** after they were written; closing your account deletes them sooner.
- Erase receipts are described under `forget` above: they have no timed
  expiry, and each is deleted when the account it was linked to, or the
  account that holds its Project Key, is closed.
- Counts of the emails sent to one typed address — invitations, signup
  confirmation codes and monthly-report test copies, so that no address can be
  sent more than a few a day whoever asks — are kept under a keyed one-way
  fingerprint of the mailbox, never the address itself. Each count covers one
  day (UTC) and is deleted within **48 hours**.
- Routine backups of the operational database are kept for up to **30 days**
  and rotate out automatically — data you erase disappears from backups as
  they rotate. Two exceptions, both narrow. A particular backup is occasionally
  **held past that window** when it is the last remaining evidence in an open
  question about our own records; every hold is recorded with its reason and
  lifted once the question is answered. And a small, separate copy of the
  records we are **required by law to keep** — payment and receipt records —
  does not rotate out with the rest: like the records themselves (see
  "Payments" above), it has no deletion clock; it contains nothing beyond
  those records. Backups are held in a
  private bucket on **Google Cloud**, in the **United States**.
- Where the service itself runs, and whether anything crosses a border, are
  two separate answers, both set out under "Where Boosthis runs, and whether
  your data crosses a border" above; the basis for processing outside the
  Kingdom is under "Your rights over your data" below.
- Account data (name, email, password hash, sessions, billing status,
  receipts): kept while your account is active. You can **close your account
  yourself** from **Dashboard → Delete account** or from the Boosthis phone
  app — no email to support required. Doing so needs your password and a typed
  confirmation, ends every other sign-in, cancels any live subscription, and
  is held for **24 hours** first: we email you a link to stop it, and until
  that window closes nothing has been deleted. Take your **data download**
  first if you want a copy (**Dashboard → Your data → Download**) — after
  deletion we cannot produce one. When it goes ahead we delete your projects
  and everything tied to them exactly as `forget` does, stop your project keys
  working, remove your sessions, password and payment card details, and strip
  your name and email from the account record. Of what identified you, the only
  things kept are one-way fingerprints of the email address, and of any card
  used for a trial started before 19 September 2026, which cannot be turned
  back into an address, a card or a person — they exist solely so the **one
  free trial per Account and per confirmed email address** limit above still
  holds after an account is closed. The closed record otherwise keeps only
  dates and settings that name nobody, such as when it was opened and closed, which
  revision of these Terms it agreed to and when, when its age confirmations
  were given, the coarse word for how it signed up, and its display language,
  in which a receipt still sent about one of its payments is written.
  Records we must keep for tax
  and accounting purposes (payment and receipt records, and the billing name
  and address on them where a payment was actually made) are retained at
  least as long as the law requires, with no deletion clock after that (see
  "Payments" above), even after an account is closed. As with `forget`,
  learning signals already contributed survive only in permanently
  de-identified form (Part A, Section 7).
- Workspace activity-log entries are pruned after a year; a support message is
  deleted **365 days** after your request is closed, and while a request is
  still open we keep it until it is closed, because we cannot answer you
  otherwise — the copy of an emailed message in the owner's mailbox at Google
  Workspace has **no deletion schedule** and stays until the owner deletes it,
  and so does the notice of each support message sent to the owner's mailbox;
  website security reports are deleted after 90 days.
- In the security log, the IP address and the staff member's email in an entry
  are erased automatically two years after the entry was written; the bare
  record of the action (what was done, to which internal record, and when)
  stays, because it is the record that an action happened at all.
- Leak-watch records — what used each of your project keys, any find of one
  in a public place, and the country of each staff sign-in — are deleted
  **400 days** after they were last seen; a find the Maintainer has not yet
  dealt with is kept until it is.
- The server's own request log is kept by our host, not by us: its monitoring
  documentation (read 1 October 2026) says deployment logs are kept for
  **30 days**. Whatever a log line held is kept that long — including, for
  lines written before this revision took effect, the full IP address and
  browser description described under "Where an IP address or browser
  description goes".
- If your access is revoked or suspended, the associated stored data is
  deleted after the **60-day countdown** described in Part A, Section 14
  (restoring access cancels it; on an install made with a server kit, `forget`
  is immediate). When a single Project
  Key is switched off — including for security — the countdown covers only the
  data stored under that key, and moving its projects onto another of your keys
  before it ends cancels it, unless your access is also cut off for another
  reason.

## Every way reporting stops

Reporting from an install stops, or is held back, in each of these ways:

- **Your app's user, on their own device.** Where your app puts the kit's
  end-user consent setting in front of the people using it — on the browser
  kit and the four phone kits — each person's choice applies to their own
  device. `granted`, which is where it starts, lets the kit work as described
  on this page. `withheld` erases what the kit stored on that device, stops it
  measuring there and asks the server to erase; for a website's or phone app's
  install, which every device running it shares, that clears only that device
  (see "A website's or phone app's install is erased by its owner" below).
  `memory-only` — for this session only — erases what the kit stored on the
  device and keeps measuring only in memory that is lost when the page or the
  app closes.
- **A frozen plan.** While the account a project belongs to is frozen (Part A,
  Section 14), its apps' reports are refused, so nothing new is measured;
  nothing already sent is deleted because of the freeze, and paying again
  opens everything at the apps' next check-in.
- **A switched-off project key.** When a Project Key is revoked, by you or by
  us under Part A, Section 14, every install reporting under it is refused
  from then on, and its data is deleted after the 60-day countdown.
- **Erasing your data.** `forget` deletes the install's data, as described
  below, and the kit stops sending.
- **The kill-switch.** `BOOSTHIS_DISABLED=1` silences the whole runtime with
  no code change, and wins over every other setting.

Turning full details off, or `disableTelemetry()`, stops only the optional
full samples: the always-on issue and fix signals keep flowing until one of
the five above applies.

## How to stop reporting / delete your data

**Stop the optional full samples** — stops per-route samples but keeps the
always-on issue & fix signals (and your install ID):

```bash
boosthis telemetry disable
```

or in code: `boosthis.disable_telemetry()` / `disableTelemetry()`.

**Stop everything immediately** — the emergency kill-switch silences the entire
runtime, issue & fix signals included, with no code change:

```bash
BOOSTHIS_DISABLED=1
```

Set it in your app's environment. The PII guard still runs first, so the
kill-switch can never be used to smuggle data past the chokepoint, and it always
wins over every other setting.

**Delete everything** — wipe your install ID and all data we hold:

```bash
boosthis telemetry forget
```

This calls `POST /api/installs/forget` with your install ID; the server deletes
the install row and every sample, snapshot, trace, and alert associated with
it, and permanently de-identifies the aggregated learning signals (candidate
signatures, fix-resolutions, crash signatures with detailed fields removed,
and learned rules) by replacing your install ID with a random anonymous key, so
that none of those can be linked to you, your app, or your install again. One
record is kept on purpose: a **receipt** that the erase happened, written only
once it has, so that you can check on your dashboard that your data really is
gone rather than having to take silence for it. The receipt holds the install
ID, the fingerprint of the Project Key it reported under, the account it was
linked to (if any), its runtime, the app's name and when it was erased —
nothing the app ever uploaded. It has no timed expiry: it is deleted when the
account it was linked to, or the account that holds its Project Key, is
closed, and a receipt that neither names is kept with no end date. Then we
delete the local config file.
Irreversible. (As stated in Part A,
Section 7, the assignment of Telemetry survives erasure: de-identified learning
signals and rules already derived are retained.)

**A website's or phone app's install is erased by its owner, not by one
copy.** Every visitor's browser on a website reports into the site's one
install, and every phone running an app into the app's one install, so what is
held for it is pooled from all of them. When one of those copies asks to erase
it — a visitor or app user switching Boosthis off, the end-user consent
setting's `withheld`, or a website or phone kit's `forget()` — that device is
cleared and stops sending, and the server answers that nothing pooled was
erased. Which kind of install it is comes from the server's own record,
written when the install first registered; a later request cannot change it.
To erase a website's or phone app's install, revoke the Project Key it reports
under, which deletes its data after the 60-day countdown in Part A, Section
14, or close your account.

## The legal ground for each use

Every use the Maintainer makes of personal data as its controller rests on one
of four grounds: the **contract** with you, a **legitimate interest** we name,
your **consent**, or a **legal obligation**. Where we rely on a legitimate
interest, the last column is the balancing test: why that interest is not
outweighed by yours.

| What we do | Legal ground | Why that ground holds |
|---|---|---|
| Running your account and the hosted service: signing you in, your projects and keys, your dashboard, teammates you invite, the emails you asked for (sign-in codes, receipts, alerts you set up), replies to support, and the "Ask Boosthis" assistant when you use it | Contract | Without it there is no account or service to provide. |
| Taking payment and issuing receipts | Contract | A plan cannot be sold without it. |
| Keeping payment and receipt records, and the billing name and address on them, after a payment | Legal obligation | Tax and accounting law requires them, for as long as it says, even after an account is closed. |
| Answering a request to use your rights, and keeping the record of having answered it | Legal obligation | Data-protection law requires the answer, and the record shows it was given. |
| Keeping the service and its accounts safe from abuse: the security log, the request log's same-day tag, rate limits, refusing a signup address at a known throwaway-mail service or with no mail server, and one free trial per account and per confirmed email address | Legitimate interest: protecting the service, its customers and their data | Each record holds the least that does the job (a tag instead of an address, a network instead of an address for a refused staff sign-in, a domain instead of an address for a refused signup) and each has a stated end, so the intrusion is small against a protection every account relies on. |
| Counting visits to our public website, and keeping security reports from it | Legitimate interest: knowing which public pages are read, and whether code is being injected into them | Counts and coarse labels only, with no cookie, no stored address and nothing that follows a person from one day to the next. |
| Improving the rule book from what installs send | Legitimate interest: better detection for every customer | It uses code-derived signatures, counts and fixes, which describe code rather than a person; what is tied to an install is de-identified when it is erased, and personal data in telemetry is never assigned to us (Part A, Section 7). |
| Occasional notes about using Boosthis, such as a new tutorial | Legitimate interest: helping existing customers use what they already have | One copy per account per note, each carries a link that stops these notes, and there is no marketing path. |
| A setup-help note to a new account that holds a project key with no app registered, or an app with no reading accepted, worked out from what we stored about the account | Legitimate interest: helping a new customer finish setting up what they signed up for | At most one copy of each of the two notes, sent only to a confirmed address and only when the Maintainer chooses to send it; it names no cause we cannot see, each carries a link that stops these notes, and there is no marketing path. |
| Reading your own chat messages in your editor | Consent | Off until you turn it on, per project; switching it off stops the reading at once. |

Personal data in what installs send from your app's users is different: there
the Maintainer acts as your processor under the processing agreement
incorporated in Part A, Section 25, and the legal ground is yours to establish
as the controller.

## Your rights over your data

Everything you can ask us to do is listed here. Two of these need nobody's
permission — they are buttons — and the rest are one message away.

- **Get a copy of what we hold about you.** **Dashboard → Your data →
  Download**, at any time, without asking anyone. It is a machine-readable
  export of your account and your projects' data. Take it before you close your
  account: after deletion we cannot produce one.
- **Take it with you.** The same download is your right to data portability:
  a JSON file, a common machine-readable format, holding the data you gave us
  and the data your projects produced, which you can keep or hand to another
  service yourself. If you want us to send it to another service directly,
  write to us and we will do so where that is technically possible.
- **Have it corrected.** Your account-holder name and email address are
  editable from your dashboard. For anything else that is wrong, write to us
  and we will correct it.
- **Have it deleted.** **Dashboard → Delete account** (or the same option in
  the Boosthis phone app) closes your account and deletes your data as
  described under "Retention"; `boosthis telemetry forget` erases the telemetry
  of an install made with a server kit immediately, independently of any
  account, and revoking the Project Key a website's or phone app's install
  reports under erases it after the 60-day countdown (see "How to stop
  reporting / delete your data"). None of these needs an email to support.
- **Object to a use, or ask us to stop one.** Telemetry can be stopped from
  inside your own app at any time — `disableTelemetry()` for the optional full
  details, `BOOSTHIS_DISABLED=1` for everything. For any other use described in
  this document, write to us and name it; we will stop it or explain why we
  cannot, and where we cannot you can delete the data instead.
- **Have its use restricted.** While you contest whether something we hold is
  accurate, while you object to a use and we are considering it, when a use
  should not happen but you want the data kept rather than deleted, or when you
  need it kept for a legal claim after we no longer would, write to us and name
  the data. We will keep it but stop using it for anything other than storing
  it, and tell you before the restriction is lifted.
- **Withdraw a consent you gave.** The one use above that rests on your
  consent, the reading of your own chat messages in your editor, is switched
  off from the same switch that turned it on, at any time, and withdrawing it
  does not undo what was lawfully done before. The levers above remain
  available either way.
- **Complain.** If our answer does not satisfy you, you can complain to the
  **Saudi Data & AI Authority (SDAIA)**, the supervisory authority for personal
  data in the Kingdom of Saudi Arabia, or to the data-protection authority of
  the country you live in.

**Decisions made by a program alone.** Four automatic steps can turn you away or
change what you have without a person deciding: a signup address at a known
throwaway-mail service or with no mail server is refused; a free trial is
refused where the account already had one or a paid plan, or where its confirmed
email address already had one on another account; rate limits refuse requests
past a set pace; and a plan lapses into the frozen state once the last renewal
attempt is declined (see "Failed or declined renewals" in Part A). Each step
acts on the fact it names and on nothing else, and none of them builds a profile
of you. A free trial or a paid period also ends on the date these Terms
describe; that is the agreed term running out, not a decision about you. If one
of them turned you away or froze your plan and you think it was wrong, write to
us and a person will look at it.

**How "the same email address" is judged for a free trial.** We do not
compare addresses. We compare a one-way fingerprint of the confirmed address,
made after setting aside the differences that still reach the same inbox:
capital letters and anything after a "+" for every address, and for Gmail
addresses the dots in the name and the googlemail.com spelling, because Gmail
delivers all of those to one inbox. This changes nothing about the address you
sign in with. Only the fingerprint is kept, on the account that had the trial;
it cannot be turned back into an address, and it is kept for as long as that
account exists and after it is closed (see the account-data line under
"Retention" above), solely so the one-trial limit still holds. If a trial was
refused this way and you think the two addresses belong to different people,
write to us and a person will look at it.

**What you must give us, and what is up to you.** To open an account we need
your full name, your email address, a password, and your confirmation of the
Terms and of your age; without them we cannot open one. To buy a plan we also
need the billing details the checkout asks for and a card, which goes to
Moyasar and never to us. Everything else (teammates, support messages, the
assistant, AI connections, the chat reader) is used only if you choose to use
it, and leaving it out costs you only that feature.

**How to ask, and how long we take.** Email **support@boosthis.com**, or write
to the postal address under "Contact" below. We answer within **30 days** of
receiving a request: the 30 days run from the day it reaches us. If we need
something to identify you — normally only that you write from the email
address on the account — we will ask for it, and asking neither stops nor
restarts those 30 days. Where a request genuinely needs longer, we may extend
that time **once**, by up to **30 more days**, and only by telling you, with
the reason, before the first 30 days are up. There is no charge. The
self-serve levers above are immediate and do not go through this route at all.

**Processing outside the Kingdom.** Boosthis is operated from the Kingdom of
Saudi Arabia. As "Where Boosthis runs, and whether your data crosses a border"
above sets out, some of the companies that run it hold what reaches them
outside the Kingdom. That processing is **necessary in order to provide the
hosted service you asked for** — there is no version of the hosted dashboard,
email or assistant that does without them — and by creating an account or
registering a project you agree to it. Each company receives only what is
listed beside its name and may use it only for the purpose named there, and for
each one we keep a written record of the ground relied on and the safeguards
that apply. If you would rather nothing crossed a border, a **general install**
of the toolkit sends nothing anywhere.

## Children

Boosthis is a developer tool. It is not intended for anyone under 18. We do
not knowingly collect data from anyone under 16, and since 4 October 2026 we
open no account for anyone who does not confirm they are at least 18. Buying a
paid plan also requires you to have reached the age of majority where you
live, if that is higher than 18. Section 1 of Part A says why that is a
separate question, and what the change of floor means for an account opened
before it.

**Children using your application.** Boosthis measures your application while
real people are using it, and those people are not our users. We have no
relationship with them, cannot see who they are, and never receive anything
that identifies them. Where your application is directed at children, or you
know that children use it, the notice and consent that requires is yours to
obtain and not ours — **Section 28** of Part A sets out what that means, what
you must not send us, and what we do when you tell us an application is
child-directed. You can tell us by emailing **support@boosthis.com** with
"child-directed" in the subject and naming the project.

## Changes

If we change this policy, the "Last updated" date at the top moves with the
change, and Part A, Section 19 decides when it takes effect: a material change
no sooner than 30 days after we tell you. The agreement screen that a phone
app or a kit shows its own users asks again only when the version of the
consent text it shows changes, not with every revision of this document. A
change to the list of companies under "The companies that can see your data"
is announced there at least 14 days in advance, as that section describes. You can also be emailed when that list
changes, without an account, from the security and trust page at
boosthis.com/trust.

## Contact

Deleting your account and getting a copy of what we hold about you are both
**self-serve** — you do not need to email anyone. Use **Dashboard → Delete
account** (also in the Boosthis phone app) and **Dashboard → Your data →
Download**. Everything else you can ask for is under "Your rights over your
data" above.

**If an app measured you and you are not our customer**, read
<https://www.boosthis.com/your-data>. That page is written for an end user of
somebody else's application — what is held, how to ask about it, how a request
is proved without handing us anything more about you, what you can do yourself
without asking anyone, and what needs the application owner. We are the
processor for that data and they are the controller, so most of it is theirs to
decide; the page says plainly which parts are and which are not.

For any other terms or privacy question, email **support@boosthis.com**. If you
email support, we keep your message (address, subject, and text) so we can
reply and keep a record of the request; support mail is never stored with
telemetry, and what we match it against when we read it is described under
"Support messages" above. Once your request is closed we keep it for **365 days** and then
delete it automatically, and while a request is still open we keep it until it
is closed. A copy of an emailed message also stays in the owner's mailbox at
Google Workspace, with **no deletion schedule**, until the owner deletes it.
So does the notice of your message sent to the owner's mailbox.

By post: **Veqtara Tech Company** (trading as Boosthis), commercial
registration 7054832287, Rabwa District, Al Noaim Street, Riyadh, Kingdom of
Saudi Arabia.
