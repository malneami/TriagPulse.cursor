import { appHref } from '@/lib/appUrl';

const API_URL = import.meta.env.DEV
  ? ''
  : (import.meta.env.VITE_API_URL || '');

export function getToken() {
  return localStorage.getItem('triagepulse_token');
}

export function getAuthToken() {
  return getToken();
}

export function setToken(token) {
  if (token) localStorage.setItem('triagepulse_token', token);
  else localStorage.removeItem('triagepulse_token');
}

async function request(path, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  let res;
  try {
    res = await fetch(`${API_URL}/api${path}`, { ...options, headers });
  } catch {
    throw new Error(
      import.meta.env.DEV
        ? 'Cannot reach API. Run npm run dev from the project root (starts API + web).'
        : 'Cannot reach API server.',
    );
  }
  if (res.status === 401) {
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

function camelToSnake(obj) {
  if (Array.isArray(obj)) return obj.map(camelToSnake);
  if (obj && typeof obj === 'object' && obj.constructor === Object) {
    return Object.fromEntries(
      Object.entries(obj).map(([k, v]) => [
        k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`),
        camelToSnake(v),
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
    completed: 'complete',
  };
  return {
    id: j.id,
    patient_id: j.patientId,
    mrn: j.mrn,
    id_number: j.idNumber,
    patient_name_ar: j.patientNameAr,
    patient_name_en: j.patientNameEn,
    dob: j.dob,
    age: j.age,
    gender: j.gender,
    nationality: j.nationality,
    phone: j.phone,
    insurance: j.insurance,
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
    chief_complaint: j.chiefComplaint,
    current_status: statusMap[j.currentStatus] || j.currentStatus,
    current_location: j.currentLocation,
    clinician_final_ctas: j.clinicianFinalCtas,
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
  },
  journeys: {
    create: (data) =>
      request('/journeys', { method: 'POST', body: JSON.stringify(camelToSnake(data)) }).then(mapJourney),
    listActive: () => request('/journeys?status=active').then((list) => list.map(mapJourney)),
    get: (id) => request(`/journeys/${id}`).then(mapJourney),
    visualTriage: (id, data) =>
      request(`/journeys/${id}/visual-triage`, { method: 'POST', body: JSON.stringify(data) }).then((r) => ({
        journey: mapJourney(r.journey),
        destination: r.destination,
      })),
    update: async (id, data) => {
      if (data.current_status === 'ctas_in_progress') {
        return request(`/journeys/${id}/status`, {
          method: 'PATCH',
          body: JSON.stringify({ status: 'ctas_in_progress' }),
        }).then(mapJourney);
      }
      return mapJourney(data);
    },
    filter: async ({ patient_id }) => {
      const all = await request('/journeys?status=active');
      return all.filter((j) => j.patientId === patient_id).map(mapJourney);
    },
    list: async () => request('/journeys?status=active').then((list) => list.map(mapJourney)),
  },
  triage: {
    evaluate: (patient, answers = {}) =>
      request('/triage/evaluate', { method: 'POST', body: JSON.stringify({ patient, answers }) }),
    save: (payload) =>
      request('/triage/save', {
        method: 'POST',
        body: JSON.stringify({
          journeyId: payload.journey_id,
          triageRecord: payload.triage_record,
          journeyUpdate: payload.journey_update,
        }),
      }),
  },
  tracking: {
    board: () => request('/tracking/board').then((list) => list.map(mapJourney)),
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

export const legacyBase44 = {
  auth: {
    me: () => api.auth.me().then((u) => ({ ...u, full_name: u.full_name })),
    logout: () => { setToken(null); window.location.href = appHref('/login'); },
  },
  entities: {
    PatientJourney: {
      create: (data) => api.journeys.create(data),
      update: (id, data) => api.journeys.update(id, data),
      filter: (query) => api.journeys.filter(query),
      list: () => api.journeys.list(),
      subscribe: (cb) => {
        const interval = setInterval(async () => {
          try { cb(await api.journeys.listActive()); } catch { /* ignore */ }
        }, 15000);
        return () => clearInterval(interval);
      },
    },
    TriageRecord: {
      list: () => Promise.resolve([]),
      filter: () => Promise.resolve([]),
    },
  },
  functions: {
    invoke: (name, payload) => {
      if (name === 'saveTriageRecord') return api.triage.save(payload);
      throw new Error(`Unknown function: ${name}`);
    },
  },
  integrations: {
    Core: {
      InvokeLLM: () => Promise.reject(new Error('AI extraction is not available')),
      UploadFile: () => Promise.reject(new Error('File upload not available in MVP')),
    },
  },
};
