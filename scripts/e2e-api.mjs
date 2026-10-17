#!/usr/bin/env node
/**
 * End-to-end API checks against a running TriagePulse API with seeded demo users.
 * Covers the core triage flow plus the Phase 0 security fixes.
 *
 *   API_URL=http://localhost:3001 node scripts/e2e-api.mjs
 *
 * Exits non-zero on the first failure, printing which check failed.
 */
import { io } from 'socket.io-client';
import { randomUUID } from 'node:crypto';

const BASE = (process.env.API_URL || 'http://localhost:3001').replace(/\/$/, '');
const API = `${BASE}/api`;
const DEMO_PASSWORD = process.env.DEMO_PASSWORD || 'triage123';

let passed = 0;
function check(condition, label, detail = '') {
  if (!condition) {
    console.error(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`);
    process.exit(1);
  }
  passed += 1;
  console.log(`ok    ${label}`);
}

async function call(path, { token, method = 'GET', body } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
  return { status: res.status, json, text };
}

async function login(email) {
  const r = await call('/auth/login', { method: 'POST', body: { email, password: DEMO_PASSWORD } });
  check(r.status === 201 && r.json?.access_token, `login as ${email}`, `status ${r.status} ${r.text.slice(0, 200)}`);
  return r.json.access_token;
}

/** Connects to a namespace; resolves with the first matching event or a connect error. */
function socketProbe(namespace, { token, emit, waitFor, timeoutMs = 8000 }) {
  return new Promise((resolve) => {
    const socket = io(`${BASE}${namespace}`, {
      transports: ['websocket'],
      auth: token ? { token } : {},
      reconnection: false,
      timeout: timeoutMs,
    });
    const done = (result) => { clearTimeout(timer); socket.close(); resolve(result); };
    const timer = setTimeout(() => done({ kind: 'timeout' }), timeoutMs);
    socket.on('connect_error', (err) => done({ kind: 'connect_error', message: err?.message }));
    for (const event of waitFor) {
      socket.on(event, (payload) => done({ kind: 'event', event, payload }));
    }
    socket.on('connect', () => { if (emit) socket.emit(emit.event, emit.data); });
  });
}

// ── Health and authentication ────────────────────────────────────────
const health = await call('/health');
check(health.status === 200 && health.json?.status === 'ok', 'health endpoint responds');

const badLogin = await call('/auth/login', {
  method: 'POST',
  body: { email: 'nurse@triagepulse.local', password: 'wrong-password' },
});
check(badLogin.status === 401, 'wrong password is rejected (401)', `got ${badLogin.status}`);

const anon = await call('/journeys');
check(anon.status === 401, 'REST without a token is rejected (401)', `got ${anon.status}`);

const nurse = await login('nurse@triagepulse.local');
const physician = await login('physician@triagepulse.local');
const me = await call('/auth/me', { token: nurse });
check(me.status === 200 && me.json?.id, 'GET /auth/me returns the user');

// ── Live channels (review B1, B2) ────────────────────────────────────
const trackingAnon = await socketProbe('/tracking', { waitFor: ['board_update'] });
check(
  trackingAnon.kind === 'connect_error' && /unauthori[sz]ed/i.test(trackingAnon.message || ''),
  '/tracking socket refuses a client with no token',
  JSON.stringify(trackingAnon),
);

const trackingBad = await socketProbe('/tracking', { token: 'not-a-real-token', waitFor: ['board_update'] });
check(trackingBad.kind === 'connect_error', '/tracking socket refuses an invalid token', JSON.stringify(trackingBad));

const trackingOk = await socketProbe('/tracking', { token: nurse, waitFor: ['board_update'] });
check(
  trackingOk.kind === 'event' && Array.isArray(trackingOk.payload),
  '/tracking socket sends the board to a signed-in nurse',
  JSON.stringify(trackingOk).slice(0, 200),
);

const sttAnon = await socketProbe('/stt', { waitFor: ['stt_ready'] });
check(sttAnon.kind === 'connect_error', '/stt socket refuses a client with no token', JSON.stringify(sttAnon));

const strangerSession = await socketProbe('/stt', {
  token: nurse,
  emit: { event: 'join_session', data: { sessionId: randomUUID() } },
  waitFor: ['session_joined', 'stt_error'],
});
check(
  strangerSession.kind === 'event' && strangerSession.event === 'stt_error',
  '/stt socket will not join a session the user does not own',
  JSON.stringify(strangerSession),
);

const created = await call('/stt/session', { token: nurse, method: 'POST', body: {} });
check(created.status === 201 && created.json?.sessionId, 'nurse can start an STT session');
const sessionId = created.json.sessionId;

const ownJoin = await socketProbe('/stt', {
  token: nurse,
  emit: { event: 'join_session', data: { sessionId } },
  waitFor: ['session_joined', 'stt_error'],
});
check(ownJoin.kind === 'event' && ownJoin.event === 'session_joined', 'nurse can join her own STT session', JSON.stringify(ownJoin));

const foreignField = await call('/stt/field', {
  token: physician,
  method: 'POST',
  body: { sessionId, fieldKey: 'hr', value: { value: 99 } },
});
check(foreignField.status === 404, "another user cannot write to the nurse's STT session (404)", `got ${foreignField.status}`);

// ── Triage flow ──────────────────────────────────────────────────────
const journey = await call('/journeys', {
  token: nurse,
  method: 'POST',
  body: { patientNameAr: 'اختبار آلي', patientNameEn: 'E2E Test', age: 40 },
});
check(journey.status === 201 && journey.json?.id, 'create journey');
check(journey.json.patientNameEn === 'E2E Test' && journey.json.age === 40, 'journey keeps the name and age sent');
const journeyId = journey.json.id;

const vt = await call(`/journeys/${journeyId}/visual-triage`, {
  token: nurse,
  method: 'POST',
  body: {
    sectionA: { breathing: 'green', consciousness: 'green', bleeding: 'green', skin: 'green', mobility: 'green' },
    respiratorySymptoms: {},
    monkeypoxRisk: 'none',
    age: 40,
  },
});
check(vt.status === 201 && vt.json?.destination?.destination, 'visual triage returns a destination');

const badStatus = await call(`/journeys/${journeyId}/status`, { token: nurse, method: 'PATCH', body: { status: 'not_a_status' } });
check(badStatus.status === 400, 'invalid journey status is rejected (400)', `got ${badStatus.status}`);

const start1 = await call(`/journeys/${journeyId}/status`, { token: nurse, method: 'PATCH', body: { status: 'ctas_in_progress' } });
check(start1.status === 200 && start1.json?.ctasStartedAt, 'starting CTAS stamps a start time');
await new Promise((r) => setTimeout(r, 1100));
const start2 = await call(`/journeys/${journeyId}/status`, { token: nurse, method: 'PATCH', body: { status: 'ctas_in_progress' } });
check(
  start2.status === 200 && start2.json?.ctasStartedAt === start1.json.ctasStartedAt,
  'reopening CTAS does not restart the triage clock',
  `${start1.json?.ctasStartedAt} vs ${start2.json?.ctasStartedAt}`,
);

const evaluated = await call('/triage/evaluate', {
  token: nurse,
  method: 'POST',
  body: { patient: { chief_complaint: 'Back Pain', age: 34, hr: 78, bp_systolic: 118, spo2: 98, rr: 16, temperature: 36.8, gcs: 15, pain_score: 2 } },
});
check(evaluated.status === 201 && evaluated.json?.ctas?.level, 'CTAS evaluate returns a level');

const saved = await call('/triage/save', {
  token: nurse,
  method: 'POST',
  body: {
    journeyId,
    triageRecord: {
      ctas_level: 4, clinician_final_ctas: 4, chief_complaint: 'Back Pain', missing_fields: '',
      disposition: 'FM_IM | Family Medicine & Internal Medicine',
      // Sex not captured and a vital typed as text must not fail the save.
      gender: '', hr: '88',
    },
    // An attacker-style extra field: must be ignored, not written to the journey (review B3).
    journeyUpdate: { createdById: 'someone-else', arrivalTime: '2000-01-01T00:00:00.000Z' },
  },
});
check(saved.status === 201 && saved.json?.success, 'triage save succeeds', `status ${saved.status} ${saved.text.slice(0, 300)}`);

const after = await call(`/journeys/${journeyId}`, { token: nurse });
check(after.status === 200, 'saved journey can be read back');
check(after.json.currentStatus === 'completed', 'saved journey is marked completed', after.json.currentStatus);
check(after.json.clinicianFinalCtas === 4, 'saved journey carries the final CTAS level');
check(after.json.currentLocation === 'FM_IM | Family Medicine & Internal Medicine', 'saved journey carries the confirmed patient direction', after.json.currentLocation);
check(after.json.createdById === me.json.id, 'client-sent journey fields are ignored (owner unchanged)');
check(!String(after.json.arrivalTime).startsWith('2000'), 'client-sent journey fields are ignored (arrival time unchanged)');

const board = await call('/tracking/board', { token: nurse });
check(board.status === 200 && Array.isArray(board.json), 'tracking board loads');
const onBoard = board.json.find((j) => j.id === journeyId);
check(!!onBoard, 'a triaged patient stays on the board until seen');
check(Number.isInteger(onBoard?.ticketNo) && onBoard.ticketNo > 0, 'board entries carry a ticket number', String(onBoard?.ticketNo));

// ── Stage A: encounter number, physician re-triage, private nurse feedback ─
const unlinked = await call('/journeys/unlinked?hours=24', { token: nurse });
check(unlinked.status === 200 && unlinked.json.some((j) => j.id === journeyId), 'a triaged patient with no encounter number is on the "Not linked" list');
const badEnc = await call(`/journeys/${journeyId}/encounter`, { token: nurse, method: 'PATCH', body: { encounterNo: 'x!' } });
check(badEnc.status === 400, 'a malformed encounter number is rejected (400)', `got ${badEnc.status}`);
const encNo = `9${Date.now().toString().slice(-8)}`;
const linked = await call(`/journeys/${journeyId}/encounter`, { token: nurse, method: 'PATCH', body: { encounterNo: ` ${encNo} ` } });
check(linked.status === 200 && linked.json?.encounterNo === encNo, 'the nurse links the Transaction No. (spaces trimmed)', `status ${linked.status} ${linked.text.slice(0, 200)}`);
const other = await call('/journeys', { token: nurse, method: 'POST', body: { patientNameEn: 'E2E Other', age: 30, gender: 'female' } });
const dupEnc = await call(`/journeys/${other.json.id}/encounter`, { token: nurse, method: 'PATCH', body: { encounterNo: encNo } });
check(dupEnc.status === 409, 'the same encounter number cannot be linked to a second patient (409)', `got ${dupEnc.status}`);
const encAtStart = `8${Date.now().toString().slice(-8)}`;
const started = await call('/journeys', { token: nurse, method: 'POST', body: { patientNameEn: 'E2E Start', age: 25, encounterNo: encAtStart } });
check(started.status === 201 && started.json?.encounterNo === encAtStart && started.json?.encounterLinkedAt, 'a new patient can be started with the encounter number', `status ${started.status} ${started.text.slice(0, 200)}`);
const dupStart = await call('/journeys', { token: nurse, method: 'POST', body: { patientNameEn: 'E2E Dup', encounterNo: encAtStart } });
check(dupStart.status === 409, 'starting a second patient with the same encounter number is refused (409)', `got ${dupStart.status}`);
const badStart = await call('/journeys', { token: nurse, method: 'POST', body: { patientNameEn: 'E2E Bad', encounterNo: 'x!' } });
check(badStart.status === 400, 'a malformed encounter number at start is refused (400)', `got ${badStart.status}`);
const mrnStart = await call('/journeys', { token: nurse, method: 'POST', body: { patientNameEn: 'E2E MRN', encounterNo: '1234567' } });
check(mrnStart.status === 400 && /MRN/.test(mrnStart.text), 'the 7-digit patient file number (MRN) is refused as an encounter (400)', `got ${mrnStart.status}`);
const unlinked2 = await call('/journeys/unlinked?hours=24', { token: nurse });
check(!unlinked2.json.some((j) => j.id === journeyId), 'a linked patient leaves the "Not linked" list');

const nurseReview = await call(`/journeys/${journeyId}/ctas-review`, { token: nurse, method: 'POST', body: { level: 3, reason: 'x' } });
check(nurseReview.status === 403, 'a nurse cannot re-triage (physician only)', `got ${nurseReview.status}`);
const noReason = await call(`/journeys/${journeyId}/ctas-review`, { token: physician, method: 'POST', body: { level: 3 } });
check(noReason.status === 400, 'a re-triage to a different level needs a reason (400)', `got ${noReason.status}`);
const retriage = await call(`/journeys/${journeyId}/ctas-review`, { token: physician, method: 'POST', body: { level: 3, reason: 'Pain — e2e', markSeen: false } });
check(retriage.status === 201 && retriage.json?.review?.nurseLevel === 4 && retriage.json?.review?.reviewedLevel === 3 && retriage.json?.review?.reviewerRole === 'physician',
  'the physician re-triages 4 → 3 with a reason; role is recorded', `status ${retriage.status} ${retriage.text.slice(0, 300)}`);
check(retriage.json?.journey?.ctasLevel === 3 && retriage.json?.journey?.ctasReviewedAt, 'the board level follows the re-triage');
const reviewId = retriage.json?.review?.id;
const boardRt = await call('/tracking/board', { token: nurse });
check(boardRt.json.some((j) => j.id === journeyId), 're-triage without Seen keeps the patient on the board');

const mine = await call('/feedback/me', { token: nurse });
check(mine.status === 200 && mine.json?.summary?.cases >= 1, "the nurse's own feedback page loads", `status ${mine.status} ${mine.text.slice(0, 200)}`);
check(!mine.text.includes('E2E Test'), 'the feedback page carries no patient name');
const physResp = await call(`/feedback/${reviewId}/respond`, { token: physician, method: 'POST', body: { action: 'understood' } });
check(physResp.status === 403, "only the triaging nurse can answer a review of her case (403)", `got ${physResp.status}`);
const emptyDispute = await call(`/feedback/${reviewId}/respond`, { token: nurse, method: 'POST', body: { action: 'disputed' } });
check(emptyDispute.status === 400, 'a dispute needs a reason (400)', `got ${emptyDispute.status}`);
const dispute = await call(`/feedback/${reviewId}/respond`, { token: nurse, method: 'POST', body: { action: 'disputed', comment: 'Pain was 3/10 at triage' } });
check(dispute.status === 201 && dispute.json?.action === 'disputed', 'the nurse disputes with a reason', `status ${dispute.status} ${dispute.text.slice(0, 200)}`);
const deptNurse = await call('/feedback/department', { token: nurse });
check(deptNurse.status === 403, 'a nurse cannot open the department feedback view (403)', `got ${deptNurse.status}`);
const dept = await call('/feedback/department', { token: physician });
check(dept.status === 200 && dept.json?.summary && dept.json?.breakdown?.matrix?.length === 5 && Array.isArray(dept.json?.highRisk) && !dept.text.includes('nurse@triagepulse') && !dept.text.includes('E2E Test'), 'the department view has totals and no names', `status ${dept.status}`);

const seen = await call(`/journeys/${journeyId}/status`, { token: physician, method: 'PATCH', body: { status: 'seen' } });
check(seen.status === 200 && seen.json?.seenAt, "a physician can mark a nurse's patient as seen", `status ${seen.status} ${seen.text.slice(0, 200)}`);

const boardAfter = await call('/tracking/board', { token: nurse });
check(!boardAfter.json.some((j) => j.id === journeyId), 'a seen patient leaves the board');

// ── Single-port mode (SERVE_WEB_DIR): the API also serves the web app ─
if (process.env.EXPECT_WEB === '1') {
  for (const path of ['/', '/login', '/tracking']) {
    const res = await fetch(`${BASE}${path}`, { headers: { Accept: 'text/html' } });
    const html = await res.text();
    check(
      res.status === 200 && html.includes('id="root"'),
      `web app page served at ${path}`,
      `status ${res.status}`,
    );
  }
  const apiStill = await call('/health');
  check(apiStill.json?.status === 'ok', 'API still answers alongside the web app');
}

// ── Security headers and sign-in protection (review H2, H4) ─────────
const hdr = await fetch(`${BASE}/api/health`);
check(/default-src 'self'/.test(hdr.headers.get('content-security-policy') || ''), 'content security policy header is set');
check(hdr.headers.get('x-frame-options') === 'SAMEORIGIN' || /frame-ancestors 'none'/.test(hdr.headers.get('content-security-policy') || ''), 'the app cannot be framed');
check(hdr.headers.get('x-content-type-options') === 'nosniff', 'no MIME sniffing');

// The admin account is not used above, so locking it here affects nothing else.
const lockEmail = 'admin@triagepulse.local';
for (let i = 0; i < 5; i += 1) {
  await call('/auth/login', { method: 'POST', body: { email: lockEmail, password: 'wrong-password' } });
}
const locked = await call('/auth/login', { method: 'POST', body: { email: lockEmail, password: DEMO_PASSWORD } });
check(locked.status === 429, '5 wrong passwords lock the account (correct password refused with 429)', `got ${locked.status}`);
check(/locked/i.test(locked.text), 'the lock message says the account is locked', locked.text.slice(0, 120));

console.log(`\nAll ${passed} checks passed.`);
