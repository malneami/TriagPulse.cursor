import { appHref } from '@/lib/appUrl';

const API_URL = import.meta.env.DEV
  ? ''
  : (import.meta.env.VITE_API_URL || '');

/**
 * Sign-in tokens (review H3).
 * The short access token lives only in this page's memory: never in localStorage, so a
 * script or a copied browser profile cannot lift a long-lived login. The renewal token is
 * an HttpOnly cookie the page cannot read; /auth/refresh exchanges it for a new access
 * token (on page load, and when a request comes back 401).
 */
let accessToken: string | null = null;

// Tokens from before H3 were kept in localStorage: remove any leftover copy.
try { localStorage.removeItem('triagepulse_token'); } catch { /* storage unavailable */ }

export function getToken() {
  return accessToken;
}

export function getAuthToken() {
  return getToken();
}

export function setToken(token) {
  accessToken = token || null;
}

/** Seconds until the access token expires (0 if none or unreadable). */
function secondsLeft(token) {
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return Math.max(0, payload.exp - Date.now() / 1000);
  } catch {
    return 0;
  }
}

let refreshing = null;

/**
 * Renew the access token from the session cookie. Concurrent callers share one request.
 * Resolves to { access_token, user } or null when the session has ended.
 */
export function refreshSession() {
  if (!refreshing) {
    refreshing = fetch(`${API_URL}/api/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'X-TriagePulse-Refresh': '1' },
    })
      .then(async (res) => {
        if (!res.ok) { setToken(null); return null; }
        const body = await res.json();
        setToken(body.access_token);
        return body;
      })
      .catch(() => null)
      .finally(() => { refreshing = null; });
  }
  return refreshing;
}

/** An access token valid for at least another minute (for the live speech connection). */
export async function getFreshToken() {
  if (accessToken && secondsLeft(accessToken) > 60) return accessToken;
  const renewed = await refreshSession();
  return renewed?.access_token || null;
}

/** Ends this device's session on the server (best effort) and forgets the token. */
export async function signOutOnServer() {
  const headers = accessToken ? { Authorization: `Bearer ${accessToken}` } : {};
  setToken(null);
  try {
    await fetch(`${API_URL}/api/auth/logout`, { method: 'POST', credentials: 'include', headers });
  } catch { /* offline: the session still ends by itself when idle */ }
}

const NO_RETRY = ['/auth/login', '/auth/refresh', '/auth/logout'];

async function request(path, options = {}, retried = false) {
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  let res;
  try {
    res = await fetch(`${API_URL}/api${path}`, { ...options, headers, credentials: 'include' });
  } catch {
    throw new Error(
      import.meta.env.DEV
        ? 'Cannot reach API. Run npm run dev from the project root (starts API + web).'
        : 'Cannot reach API server.',
    );
  }
  if (res.status === 401 && !NO_RETRY.includes(path)) {
    // The access token expired (10 min): renew once from the session cookie and retry.
    if (!retried && await refreshSession()) return request(path, options, true);
    setToken(null);
    window.location.href = appHref('/login');
    throw new Error('Unauthorized');
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const message = Array.isArray(err.message)
      ? err.message.join(', ')
      : err.message;
    if (res.status === 502 || res.status === 503) {
      throw new Error('API server is not running. Start it with: npm run dev:api');
    }
    throw new Error(message || `Request failed: ${res.status}`);
  }
  return res.json();
}

function snakeToCamel(obj) {
  if (Array.isArray(obj)) return obj.map(snakeToCamel);
  if (obj && typeof obj === 'object' && obj.constructor === Object) {
    return Object.fromEntries(
      Object.entries(obj).map(([k, v]) => [
        k.replace(/_([a-z])/g, (_, c) => c.toUpperCase()),
        snakeToCamel(v),
      ]),
    );
  }
  return obj;
}

function mapJourney(j) {
  if (!j) return j;
  const statusMap = {
    visual_triage: 'registration',
    awaiting_ctas: 'ctas_pending',
    ctas_in_progress: 'ctas_in_progress',
    awaiting_his_link: 'awaiting_his_link',
    pending_physician_validation: 'pending_physician_validation',
    validated: 'validated',
    awaiting_outcome_review: 'awaiting_outcome_review',
    outcome_reviewed: 'outcome_reviewed',
    closed: 'closed',
    completed: 'complete',
    seen: 'seen',
  };
  return {
    id: j.id,
    patient_id: j.patientId,
    ticket_no: j.ticketNo,
    seen_at: j.seenAt,
    age: j.age,
    gender: j.gender,
    arrival_time: j.arrivalTime,
    mode_of_arrival: j.modeOfArrival,
    vt_completed: j.vtCompleted,
    vt_completed_at: j.vtCompletedAt,
    vt_duration_sec: j.vtDurationSec,
    vt_section_a_breathing: j.vtSectionABreathing,
    vt_section_a_consciousness: j.vtSectionAConsciousness,
    vt_section_a_bleeding: j.vtSectionABleeding,
    vt_section_a_skin: j.vtSectionASkin,
    vt_section_a_mobility: j.vtSectionAMobility,
    vt_respiratory_score: j.vtRespiratoryScore,
    vt_respiratory_symptoms: j.vtRespiratorySymptoms,
    vt_monkeypox_risk: j.vtMonkeypoxRisk,
    vt_destination: j.vtDestination,
    vt_destination_ar: j.vtDestinationAr,
    vt_destination_en: j.vtDestinationEn,
    vt_mask_given: j.vtMaskGiven,
    vt_hand_hygiene_done: j.vtHandHygieneDone,
    vt_alert_team_notified: j.vtAlertTeamNotified,
    reg_completed: j.regCompleted,
    reg_completed_at: j.regCompletedAt,
    ctas_started_at: j.ctasStartedAt,
    ctas_completed_at: j.ctasCompletedAt,
    ctas_level: j.ctasLevel,
    nurse_ctas: j.nurseCtas ?? j.ctasLevel,
    chief_complaint: j.chiefComplaint,
    hr: j.hr,
    bp_systolic: j.bpSystolic,
    spo2: j.spo2,
    rr: j.rr,
    temperature: j.temperature,
    gcs: j.gcs,
    pain_score: j.painScore,
    triage_duration_sec: j.triage_duration_sec,
    current_status: statusMap[j.currentStatus] || j.currentStatus,
    current_location: j.currentLocation,
    clinician_final_ctas: j.clinicianFinalCtas,
    ctas_reviewed_at: j.ctasReviewedAt,
    assigned_physician_id: j.assignedPhysicianId,
    assigned_physician: j.assignedPhysician
      ? { id: j.assignedPhysician.id, full_name: j.assignedPhysician.fullName, role: j.assignedPhysician.role }
      : null,
    encounter_no: j.encounterNo,
    encounter_linked_at: j.encounterLinkedAt,
    mrn_suffix: j.mrnSuffix,
    rules_recommended_ctas: j.rulesRecommendedCtas,
    ai_recommended_ctas: j.aiRecommendedCtas,
    wait_mins: j.wait_mins,
    wait_color: j.wait_color,
  };
}

export const api = {
  auth: {
    login: (email, password) =>
      request('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
    me: () => request('/auth/me'),
    logoutEverywhere: () => request('/auth/logout-all', { method: 'POST' }),
    changePassword: (currentPassword, newPassword) =>
      request('/auth/change-password', { method: 'POST', body: JSON.stringify({ currentPassword, newPassword }) }),
  },
  journeys: {
    // The API DTOs are camelCase; sending snake_case made the whitelist strip every field.
    create: (data) =>
      request('/journeys', { method: 'POST', body: JSON.stringify(data) }).then(mapJourney),
    listActive: () => request('/journeys?status=active').then((list) => list.map(mapJourney)),
    get: (id) => request(`/journeys/${id}`).then(mapJourney),
    visualTriage: (id, data) =>
      request(`/journeys/${id}/visual-triage`, { method: 'POST', body: JSON.stringify(data) }).then((r) => ({
        journey: mapJourney(r.journey),
        destination: r.destination,
      })),
    /** Server enum values include HIS handoff and outcome-review statuses. */
    setStatus: (id, status) =>
      request(`/journeys/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }).then(mapJourney),
    /** Marks CTAS as started. The server stamps ctas_started_at once, with server time. */
    startCtas: (id) =>
      request(`/journeys/${id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'ctas_in_progress' }),
      }).then(mapJourney),
    /** Attach the HIS visit/voucher number and/or last-3 MRN (scanned or typed). */
    linkEncounter: (id, encounterNoOrBody, mrnSuffix) => {
      const body = encounterNoOrBody && typeof encounterNoOrBody === 'object'
        ? encounterNoOrBody
        : { encounterNo: encounterNoOrBody, mrnSuffix };
      return request(`/journeys/${id}/encounter`, { method: 'PATCH', body: JSON.stringify(body) }).then(mapJourney);
    },
    /** The patient already linked to this visit/voucher number, or null. */
    findByEncounter: (encounterNo) =>
      request(`/journeys/by-encounter/${encodeURIComponent(encounterNo)}`).then(mapJourney).catch((err) => {
        if (/no patient has this/i.test(err?.message || '')) return null;
        throw err;
      }),
    /** Completed CTAS still waiting for a HIS visit number. */
    unlinked: (hours = 24) => request(`/journeys/unlinked?hours=${hours}`).then((list) => list.map(mapJourney)),
    /** Physician agrees with the nurse CTAS, or records a different level with a reason. */
    reviewCtas: (id, { level, reason, conditionChanged = false }) =>
      request(`/journeys/${id}/ctas-review`, {
        method: 'POST',
        body: JSON.stringify({ level, reason: reason || undefined, conditionChanged }),
      }).then((r) => ({ journey: mapJourney(r.journey), review: r.review })),
    findByPatientId: async (patientId) => {
      if (!patientId) return null;
      const all = await request('/journeys?status=active');
      return mapJourney(all.find((j) => j.patientId === patientId)) || null;
    },
  },
  triage: {
    evaluate: (patient, answers = {}) =>
      request('/triage/evaluate', { method: 'POST', body: JSON.stringify({ patient, answers }) }),
    // The server derives every journey field it updates from the triage record.
    save: ({ journey_id, triage_record }) =>
      request('/triage/save', {
        method: 'POST',
        body: JSON.stringify({ journeyId: journey_id, triageRecord: triage_record }),
      }),
  },
  clinicalLibraries: {
    current: () => request('/clinical-libraries/current'),
    history: () => request('/clinical-libraries/history'),
    publish: (body) =>
      request('/clinical-libraries/publish', { method: 'POST', body: JSON.stringify(body) }),
    activate: (id) =>
      request(`/clinical-libraries/${id}/activate`, { method: 'POST', body: '{}' }),
    get: (id) => request(`/clinical-libraries/${id}`),
  },
  routingConfig: {
    current: () => request('/routing-config/current'),
    history: () => request('/routing-config/history'),
    publish: (body) =>
      request('/routing-config/publish', { method: 'POST', body: JSON.stringify(body) }),
    activate: (id) =>
      request(`/routing-config/${id}/activate`, { method: 'POST', body: '{}' }),
    useBuiltin: () => request('/routing-config/use-builtin', { method: 'POST', body: '{}' }),
    setBusy: (department, zone, busy) =>
      request('/routing-config/zone-status', { method: 'POST', body: JSON.stringify({ department, zone, busy }) }),
  },
  analytics: {
    agreement: (days = 30) => request(`/analytics/agreement?days=${days}`),
    exportValidated: (limit = 200, flaggedOnly = false) =>
      request(`/analytics/export/validated?limit=${limit}&flaggedOnly=${flaggedOnly ? 'true' : 'false'}`),
    evaluation: (days = 30) => request(`/analytics/evaluation?days=${days}`),
  },
  /** Staff accounts (admin). Passwords are sent only to set them, never read back. */
  users: {
    list: () => request('/users'),
    create: (data) => request('/users', { method: 'POST', body: JSON.stringify(data) }),
    update: (id, data) => request(`/users/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    resetPassword: (id, password) =>
      request(`/users/${id}/reset-password`, { method: 'POST', body: JSON.stringify({ password }) }),
    unlock: (id) => request(`/users/${id}/unlock`, { method: 'POST', body: '{}' }),
  },
  feedback: {
    /** The signed-in nurse's own Riyadh week (Sunday–Saturday). */
    mine: (week) => request(`/feedback/me${week ? `?week=${week}` : ''}`),
    respond: (reviewId, action, comment) =>
      request(`/feedback/${reviewId}/respond`, { method: 'POST', body: JSON.stringify({ action, comment: comment || undefined }) }),
    department: (period) => {
      if (period && typeof period === 'object') {
        if (period.month) return request(`/feedback/department?month=${period.month}`);
        if (period.week) return request(`/feedback/department?week=${period.week}`);
        return request('/feedback/department');
      }
      return request(`/feedback/department${period ? `?week=${period}` : ''}`);
    },
  },
  tracking: {
    board: () => request('/tracking/board').then((list) => list.map(mapJourney)),
  },
  outcomes: {
    list: ({ status = 'awaiting', q = '' } = {}) => {
      const p = new URLSearchParams({ status });
      if (q) p.set('q', q);
      return request(`/outcomes?${p}`);
    },
    awaitingCount: () => request('/outcomes/awaiting-count').then((r) => r.count),
    physicians: () => request('/outcomes/physicians'),
    assignPhysician: (journeyId, physicianId) =>
      request(`/outcomes/${journeyId}/assign`, { method: 'POST', body: JSON.stringify({ physicianId }) }),
    save: (journeyId, body) =>
      request(`/outcomes/${journeyId}`, { method: 'PUT', body: JSON.stringify(body) }),
    close: (journeyId) =>
      request(`/outcomes/${journeyId}/close`, { method: 'POST', body: '{}' }),
    exportCsv: async ({ status = 'awaiting', q = '' } = {}) => {
      const p = new URLSearchParams({ status });
      if (q) p.set('q', q);
      const headers = {};
      const token = getToken();
      if (token) headers.Authorization = `Bearer ${token}`;
      const res = await fetch(`${API_URL}/api/outcomes/export.csv?${p}`, { credentials: 'include', headers });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || 'Could not export');
      }
      return res.blob();
    },
  },
  stt: {
    status: () => request('/stt/status'),
    createSession: (journeyId) =>
      request('/stt/session', {
        method: 'POST',
        body: JSON.stringify({ journeyId: journeyId || undefined }),
      }),
    extract: (sessionId, transcript, isFinal = false, forceLlm = false) =>
      request('/stt/extract', {
        method: 'POST',
        body: JSON.stringify({ sessionId, transcript, isFinal, forceLlm }),
      }),
    transcribe: ({ sessionId, audioBase64, mimeType, languageHint }) =>
      request('/stt/transcribe', {
        method: 'POST',
        body: JSON.stringify({ sessionId, audioBase64, mimeType, languageHint }),
      }),
    updateField: (sessionId, fieldKey, value) =>
      request('/stt/field', {
        method: 'POST',
        body: JSON.stringify({ sessionId, fieldKey, value }),
      }),
  },
};
