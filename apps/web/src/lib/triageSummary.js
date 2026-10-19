import { CTAS_CONFIG } from '@triagepulse/clinical';

/**
 * Structured case summary shown after the triage is confirmed (and printed). Built only
 * from what was recorded: empty values stay empty, nothing is inferred.
 */

const has = (v) => !(v === '' || v == null);
const num = (v) => (has(v) && Number.isFinite(Number(v)) ? Number(v) : null);

function minutesBetween(a, b) {
  if (!a || !b) return null;
  const m = Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60000);
  return Number.isFinite(m) && m >= 0 ? m : null;
}

export function buildTriageSummary(r) {
  const p = r.patient || {};
  const final = CTAS_CONFIG[r.finalLevel] || {};
  const cc = r.caseModel || { complaints: [], conditions: [], medications: [] };
  const vitals = [
    { key: 'hr', ar: 'النبض', en: 'HR', value: num(p.hr), unit: '/min' },
    { key: 'bp', ar: 'الضغط', en: 'BP', value: has(p.bp_systolic) ? `${p.bp_systolic}/${has(p.bp_diastolic) ? p.bp_diastolic : '—'}` : null, unit: 'mmHg' },
    { key: 'spo2', ar: 'الأكسجين', en: 'SpO₂', value: num(p.spo2), unit: '%' },
    { key: 'rr', ar: 'التنفس', en: 'RR', value: num(p.rr), unit: '/min' },
    { key: 'temp', ar: 'الحرارة', en: 'Temp', value: num(p.temperature), unit: '°C' },
    { key: 'gcs', ar: 'الوعي', en: 'GCS', value: num(p.gcs), unit: '/15' },
    { key: 'pain', ar: 'الألم', en: 'Pain', value: num(p.pain_score), unit: '/10' },
    ...(has(p.glucose) ? [{ key: 'glucose', ar: 'السكر', en: 'Glucose', value: num(p.glucose), unit: 'mmol/L' }] : []),
    ...(has(p.weight) ? [{ key: 'weight', ar: 'الوزن', en: 'Weight', value: num(p.weight), unit: 'kg' }] : []),
  ];
  const present = (cc.conditions || []).filter((c) => c.status === 'present');
  const probable = (cc.conditions || []).filter((c) => c.status === 'probable');
  const absent = (cc.conditions || []).filter((c) => c.status === 'absent');

  return {
    level: r.finalLevel ?? null,
    levelAr: final.ar || '',
    levelEn: final.en || '',
    waitMin: final.wait_min ?? null,
    aiLevel: r.aiLevel ?? null,
    initialLevel: r.initialLevel ?? null,
    overridden: !!r.overridden,
    overrideReason: r.overrideReason || null,
    direction: r.direction ? { ar: r.direction.destination_ar, en: r.direction.destination_en } : null,
    aiDirection: r.aiDirection ? { ar: r.aiDirection.destination_ar, en: r.aiDirection.destination_en } : null,
    patient: {
      age: has(p.age) ? p.age : null,
      sex: p.gender === 'male' ? { ar: 'ذكر', en: 'Male' } : p.gender === 'female' ? { ar: 'أنثى', en: 'Female' } : null,
      ticket: r.ticket || null,
      encounterNo: r.encounterNo || null,
    },
    times: {
      arrival: p.arrival_time || null,
      completed: r.completedAt || null,
      triageMin: minutesBetween(p.ctas_started_at, r.completedAt),
      doorToTriageMin: minutesBetween(p.arrival_time, r.completedAt),
    },
    complaint: {
      main: p.chief_complaint || '',
      list: (cc.complaints || []).map((c) => ({ label: c.label_ar || c.text || c.label_en, labelEn: c.label_en || '', level: c.level || null, primary: cc.primary?.id === c.id })),
      onset: p.onset_duration || '',
    },
    vitals,
    history: {
      conditions: [
        ...present.map((c) => ({ label: c.label_ar || c.label_en, labelEn: c.label_en, kind: 'present' })),
        ...probable.map((c) => ({ label: c.label_ar || c.label_en, labelEn: c.label_en, kind: 'probable' })),
      ],
      denied: absent.map((c) => c.label_ar || c.label_en),
      noneKnown: !!cc.noKnownHistory && !present.length,
      medications: (cc.medications || []).map((m) => m.name).filter(Boolean),
      medicationsText: p.current_medications || '',
      historyText: p.relevant_history || '',
      allergies: p.allergies || '',
    },
    why: r.whyGroups || [],
    answers: (r.answers || []).map((a) => ({ q: a.text_ar || a.text_en || a.field, qEn: a.text_ar && a.text_en ? a.text_en : '', a: a.value_ar || a.value_en || String(a.value ?? '') })),
    outstanding: r.outstandingLabels || [],
    safety: r.safetyAlerts || [],
    nurse: r.nurse || '',
  };
}
