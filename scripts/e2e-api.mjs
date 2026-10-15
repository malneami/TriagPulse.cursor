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
    triageRecord: { ctas_level: 4, clinician_final_ctas: 4, chief_complaint: 'Back Pain', missing_fields: '' },
    // An attacker-style extra field: must be ignored, not written to the journey (review B3).
    journeyUpdate: { createdById: 'someone-else', arrivalTime: '2000-01-01T00:00:00.000Z' },
  },
});
check(saved.status === 201 && saved.json?.success, 'triage save succeeds', `status ${saved.status} ${saved.text.slice(0, 300)}`);

const after = await call(`/journeys/${journeyId}`, { token: nurse });
check(after.status === 200, 'saved journey can be read back');
check(after.json.currentStatus === 'completed', 'saved journey is marked completed', after.json.currentStatus);
check(after.json.clinicianFinalCtas === 4, 'saved journey carries the final CTAS level');
check(after.json.createdById === me.json.id, 'client-sent journey fields are ignored (owner unchanged)');
check(!String(after.json.arrivalTime).startsWith('2000'), 'client-sent journey fields are ignored (arrival time unchanged)');

const board = await call('/tracking/board', { token: nurse });
check(board.status === 200 && Array.isArray(board.json), 'tracking board loads');

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

console.log(`\nAll ${passed} checks passed.`);
