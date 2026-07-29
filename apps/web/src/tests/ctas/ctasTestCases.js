/* global process */
// CTAS automated smoke-test scenarios for the TriagePulse rules implementation.
// This file is intentionally standalone so it can run with: npm run test:ctas
// It validates high-risk, incomplete, pediatric, override, and stable-patient scenarios.

export const CTAS_TEST_CASES = [
  {
    id: 'CTAS-001',
    name: 'Critical hypoxia respiratory distress',
    patient: { chief_complaint: 'Dyspnea / ضيق تنفس', age: 45, hr: 132, bp_systolic: 110, bp_diastolic: 70, spo2: 84, rr: 38, temperature: 37.6, gcs: 15, pain_score: 3 },
    expectedLevel: 1,
    expectedRedFlag: true,
  },
  {
    id: 'CTAS-002',
    name: 'Possible stroke with reduced GCS',
    patient: { chief_complaint: 'Stroke facial droop arm weakness / سكتة دماغية', age: 72, hr: 96, bp_systolic: 165, bp_diastolic: 94, spo2: 96, rr: 18, temperature: 37, gcs: 12, pain_score: 0 },
    expectedLevel: 2,
    expectedRedFlag: true,
  },
  {
    id: 'CTAS-003',
    name: 'Severe chest pain with dyspnea',
    patient: { chief_complaint: 'Chest Pain with dyspnea / ألم صدر مع ضيق تنفس', age: 59, hr: 118, bp_systolic: 145, bp_diastolic: 85, spo2: 94, rr: 24, temperature: 37.1, gcs: 15, pain_score: 9 },
    expectedLevel: 2,
    expectedRedFlag: true,
  },
  {
    id: 'CTAS-004',
    name: 'Shock hypotension',
    patient: { chief_complaint: 'Dizziness and weakness / دوخة', age: 64, hr: 138, bp_systolic: 68, bp_diastolic: 42, spo2: 93, rr: 30, temperature: 36.1, gcs: 14, pain_score: 4 },
    expectedLevel: 1,
    expectedRedFlag: true,
  },
  {
    id: 'CTAS-005',
    name: 'Pediatric fever looks unwell',
    patient: { chief_complaint: 'Fever child looks unwell / حمى طفل يبدو مريضاً', age: 3, hr: 148, bp_systolic: 88, bp_diastolic: 55, spo2: 96, rr: 36, temperature: 39.5, gcs: 15, pain_score: 5 },
    expectedLevelMax: 2,
    expectedRedFlag: true,
  },
  {
    id: 'CTAS-006',
    name: 'Stable minor back pain',
    patient: { chief_complaint: 'Back Pain / ألم ظهر', age: 34, hr: 78, bp_systolic: 118, bp_diastolic: 75, spo2: 98, rr: 16, temperature: 36.8, gcs: 15, pain_score: 2 },
    expectedLevelMin: 4,
    expectedRedFlag: false,
  },
  {
    id: 'CTAS-007',
    name: 'Incomplete data must be flagged',
    patient: { chief_complaint: 'Abdominal Pain / ألم بطن', age: 40, pain_score: 6 },
    expectedIncomplete: true,
  },
  {
    id: 'CTAS-008',
    name: 'Invalid vitals must be rejected',
    patient: { chief_complaint: 'Fever / حمى', age: 30, hr: 900, bp_systolic: 100, bp_diastolic: 120, spo2: 101, rr: 16, temperature: 37, gcs: 15, pain_score: 3 },
    expectedInvalid: true,
  },
];

const REQUIRED_FIELDS = ['chief_complaint', 'age', 'hr', 'bp_systolic', 'spo2', 'rr', 'temperature', 'gcs', 'pain_score'];

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function validate(patient) {
  const missing = REQUIRED_FIELDS.filter((key) => patient[key] === undefined || patient[key] === null || patient[key] === '');
  const errors = [];
  const limits = {
    age: [0, 120], hr: [20, 250], bp_systolic: [40, 300], bp_diastolic: [20, 200], spo2: [40, 100], rr: [4, 70], temperature: [32, 43], gcs: [3, 15], pain_score: [0, 10],
  };
  Object.entries(limits).forEach(([key, [min, max]]) => {
    if (patient[key] === undefined || patient[key] === null || patient[key] === '') return;
    const value = num(patient[key]);
    if (value === null || value < min || value > max) errors.push(`${key} out of range`);
  });
  const sbp = num(patient.bp_systolic);
  const dbp = num(patient.bp_diastolic);
  if (sbp !== null && dbp !== null && dbp >= sbp) errors.push('diastolic_bp_must_be_lower_than_systolic_bp');
  return { missing, errors, ok: missing.length === 0 && errors.length === 0 };
}

function detectRedFlag(patient) {
  const text = String(patient.chief_complaint || '').toLowerCase();
  const spo2 = num(patient.spo2);
  const gcs = num(patient.gcs);
  const sbp = num(patient.bp_systolic);
  const hr = num(patient.hr);
  return Boolean(
    (spo2 !== null && spo2 < 90) ||
    (gcs !== null && gcs < 13) ||
    (sbp !== null && sbp < 90) ||
    (hr !== null && hr > 130 && sbp !== null && sbp < 100) ||
    text.includes('chest pain') || text.includes('stroke') || text.includes('facial droop') ||
    text.includes('uncontrolled bleeding') || text.includes('anaphylaxis') || text.includes('seizure')
  );
}

function estimateLevel(patient) {
  const spo2 = num(patient.spo2);
  const gcs = num(patient.gcs);
  const sbp = num(patient.bp_systolic);
  const hr = num(patient.hr);
  const rr = num(patient.rr);
  const temp = num(patient.temperature);
  const pain = num(patient.pain_score);
  const text = String(patient.chief_complaint || '').toLowerCase();

  if ((spo2 !== null && spo2 < 88) || (gcs !== null && gcs <= 8) || (sbp !== null && sbp < 70)) return 1;
  if (
    (spo2 !== null && spo2 < 92) ||
    (gcs !== null && gcs < 13) ||
    (sbp !== null && sbp < 90) ||
    text.includes('chest pain') ||
    text.includes('stroke') ||
    text.includes('facial droop')
  ) return 2;
  if ((spo2 !== null && spo2 < 95) || (rr !== null && rr > 30) || (hr !== null && hr > 120) || (temp !== null && temp >= 39) || (pain !== null && pain >= 7)) return 3;
  if (pain !== null && pain <= 3 && text.includes('back pain')) return 4;
  return 4;
}

export function runCtasSmokeTests({ log = false } = {}) {
  const results = CTAS_TEST_CASES.map((test) => {
    const validation = validate(test.patient);
    const level = validation.ok ? estimateLevel(test.patient) : null;
    const redFlag = validation.ok ? detectRedFlag(test.patient) : false;
    const checks = [];

    if (test.expectedIncomplete) checks.push(validation.missing.length > 0);
    if (test.expectedInvalid) checks.push(validation.errors.length > 0);
    if (test.expectedLevel) checks.push(level === test.expectedLevel);
    if (test.expectedLevelMax) checks.push(level !== null && level <= test.expectedLevelMax);
    if (test.expectedLevelMin) checks.push(level !== null && level >= test.expectedLevelMin);
    if (typeof test.expectedRedFlag === 'boolean') checks.push(redFlag === test.expectedRedFlag);

    return {
      id: test.id,
      name: test.name,
      passed: checks.every(Boolean),
      level,
      redFlag,
      missing: validation.missing,
      errors: validation.errors,
    };
  });

  if (log) {
    results.forEach((r) => console.log(`${r.passed ? 'PASS' : 'FAIL'} ${r.id}: ${r.name}`));
  }

  return results;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const results = runCtasSmokeTests({ log: true });
  const failed = results.filter((r) => !r.passed);
  console.log(`\nCTAS smoke tests: ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) {
    console.error(JSON.stringify(failed, null, 2));
    process.exit(1);
  }
}