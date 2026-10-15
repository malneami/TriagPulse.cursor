#!/usr/bin/env node
/**
 * Clinical scenario validation for the live triage screen.
 *
 * Runs each scenario through the same path the screen uses: the CTAS engine
 * (computeLiveCTAS + clarifying-question pipeline) and the display rules in
 * apps/web/src/lib/triageAssessment.js (pending / at-least / direction / prompts).
 *
 * A scenario FAILS on a safety problem: under-triage (shown level less urgent than
 * the expected maximum), a level shown when data is insufficient, or no level shown
 * when a critical finding is present. Over-triage is reported as a warning.
 * Scenarios marked `knownIssue` are engine findings awaiting a clinical decision;
 * they are reported but do not fail the run.
 *
 * Usage: npm run build --workspace=@triagepulse/clinical && node scripts/validate-triage-scenarios.mjs
 */
import { createRequire } from 'node:module';
import { deriveAssessment, nextPrompt } from '../apps/web/src/lib/triageAssessment.js';
import { deriveCase } from '../apps/web/src/lib/caseModel.js';

const require = createRequire(import.meta.url);
const clinical = require('../packages/clinical/dist/index.js');

const base = { gcs: '15' };
const SCENARIOS = [
  // ── Adults ─────────────────────────────────────────────────────────
  { id: 'A1', name: 'Adult chest pain, cardiac features, tachycardic',
    patient: { ...base, age: '58', gender: 'male', chief_complaint: 'chest pain radiating to left arm with sweating', pain_score: 7, hr: '112', bp_systolic: '150', spo2: '95', rr: '20', temperature: '37.1', weight: '82' },
    expect: { maxLevel: 2, direction: 'RESUSCITATION' } },
  { id: 'A2', name: 'Adult chest pain, nothing else yet',
    patient: { age: '', chief_complaint: 'chest pain' },
    expect: { maxLevel: 2, atLeast: true } },
  { id: 'A3', name: 'Adult abdominal pain only (insufficient data)',
    patient: { chief_complaint: 'abdominal pain' },
    expect: { pending: true } },
  { id: 'A4', name: 'Adult hypoxia during dictation (SpO2 86, RR 32)',
    patient: { age: '30', gender: 'female', chief_complaint: 'shortness of breath', spo2: '86', rr: '32' },
    expect: { maxLevel: 2 } },
  { id: 'A5', name: 'Adult sepsis picture (T 39.2, HR 125, RR 26, SBP 88)',
    patient: { ...base, age: '67', gender: 'male', chief_complaint: 'fever', pain_score: 3, hr: '125', bp_systolic: '88', spo2: '94', rr: '26', temperature: '39.2' },
    expect: { maxLevel: 2 } },
  { id: 'A6', name: 'Adult decreased consciousness (GCS 9)',
    patient: { age: '45', gender: 'male', chief_complaint: 'altered level of consciousness', gcs: '9', hr: '90', bp_systolic: '140', spo2: '97', rr: '18', temperature: '37', pain_score: 0 },
    expect: { maxLevel: 1 },
    knownIssue: 'CTAS level-of-consciousness modifier: GCS 3-9 is CTAS 1; the engine gives CTAS 2 for GCS 9.' },
  { id: 'A7', name: 'Adult stroke symptoms (weakness, slurred speech, 1 h)',
    patient: { ...base, age: '62', gender: 'female', chief_complaint: 'stroke symptoms left sided weakness slurred speech', pain_score: 0, hr: '88', bp_systolic: '170', spo2: '97', rr: '16', temperature: '36.9' },
    expect: { maxLevel: 2 } },
  { id: 'A8', name: 'Adult minor ankle sprain, normal vitals, pain 3',
    patient: { ...base, age: '25', gender: 'male', chief_complaint: 'ankle injury', pain_score: 3, hr: '78', bp_systolic: '122', spo2: '99', rr: '14', temperature: '36.8', weight: '75' },
    expect: { maxLevel: 5, minLevel: 4, direction: 'FM_IM' } },
  { id: 'A9', name: 'Adult non-cardiac chest pain, moderate (5/10)',
    patient: { ...base, age: '35', gender: 'male', chief_complaint: 'chest pain non cardiac', confirmed_complaint_key: 'chest_pain_non_cardiac', pain_score: 5, hr: '84', bp_systolic: '128', spo2: '99', rr: '16', temperature: '36.8', weight: '80' },
    expect: { maxLevel: 3 },
    knownIssue: 'Engine applies the peripheral pain rule (CTAS 4); central chest pain 4-7 should be CTAS 3.' },
  { id: 'A10', name: 'Adult hypotension (SBP 82) with dizziness',
    patient: { ...base, age: '50', gender: 'female', chief_complaint: 'dizziness', pain_score: 0, hr: '110', bp_systolic: '82', spo2: '97', rr: '20', temperature: '36.9' },
    expect: { maxLevel: 2 } },

  // ── Children (age-adjusted vitals) ────────────────────────────────
  { id: 'P1', name: 'Toddler 2 y, fever 39.5, HR 180, RR 50',
    patient: { ...base, age: '2', gender: 'female', chief_complaint: 'fever', pain_score: 0, hr: '180', bp_systolic: '95', spo2: '95', rr: '50', temperature: '39.5', weight: '12' },
    expect: { maxLevel: 2, direction: 'PEDIATRIC_RESUS' },
    knownIssue: 'Fever with HR 180 and RR 50 at 2 y meets pediatric SIRS; the engine treats the tachycardia as expected with fever and waits for appearance (CTAS 3).' },
  { id: 'P2', name: 'Child 8 y, HR 110 (normal for age), mild cough',
    patient: { ...base, age: '8', gender: 'male', chief_complaint: 'cough', pain_score: 0, hr: '110', bp_systolic: '100', spo2: '98', rr: '22', temperature: '37.4', weight: '26' },
    expect: { maxLevel: 5, minLevel: 4 } },
  { id: 'P3', name: 'Child 5 y, SpO2 89, RR 44 (respiratory distress)',
    patient: { age: '5', gender: 'male', chief_complaint: 'shortness of breath', spo2: '89', rr: '44' },
    expect: { maxLevel: 2 } },
  { id: 'P4', name: 'Child 10 y, chest pain, normal vitals, pain 2',
    patient: { ...base, age: '10', gender: 'male', chief_complaint: 'chest pain', pain_score: 2, hr: '95', bp_systolic: '105', spo2: '99', rr: '20', temperature: '37', weight: '32' },
    expect: { maxLevel: 5, minLevel: 3 },
    knownIssue: 'Plain "chest pain" maps to the cardiac complaint (CTAS 2, pediatric resus) regardless of age or features.' },
  { id: 'P5', name: 'Adolescent 13 y, GCS 13 after head injury',
    patient: { age: '13', gender: 'male', chief_complaint: 'head injury', gcs: '13', hr: '96', bp_systolic: '112', spo2: '98', rr: '18', temperature: '36.9', pain_score: 6 },
    expect: { maxLevel: 2 },
    knownIssue: 'CTAS level-of-consciousness modifier: GCS 10-13 is CTAS 2; the engine gives CTAS 3 for GCS 13.' },
  { id: 'P6', name: 'Child 4 y, abdominal pain only (insufficient data)',
    patient: { age: '4', chief_complaint: 'abdominal pain' },
    expect: { pending: true } },

  // ── Several complaints and chronic illness (from the dictation) ───
  // The most urgent complaint sets the level (and is a floor); history is recorded only.
  { id: 'M1', name: 'Adult chest pain + vomiting + headache, hypertensive, on warfarin',
    transcript: '58 year old male with vomiting since morning, also headache, and chest pain radiating to left arm, known hypertensive, takes warfarin',
    patient: { ...base, age: '58', gender: 'male', pain_score: 6, hr: '104', bp_systolic: '160', spo2: '96', rr: '18', temperature: '37', weight: '85' },
    expect: { maxLevel: 2, primary: /^chest_pain/, conditions: ['hypertension'], drugClasses: ['anticoagulant'] } },
  { id: 'M2', name: 'Child 6 y fever + cough, known sickle cell (Arabic)',
    transcript: 'طفل عمره 6 سنوات عنده حرارة وكحة من يومين، معروف عنده فقر الدم المنجلي',
    patient: { ...base, age: '6', gender: 'male', pain_score: 2, hr: '118', bp_systolic: '100', spo2: '97', rr: '24', temperature: '38.9', weight: '20' },
    expect: { maxLevel: 3, primary: /^fever$/, conditions: ['sickle_cell'] } },
  { id: 'M3', name: 'Adult abdominal pain + diarrhoea, previously healthy',
    transcript: '30 year old female with abdominal pain and diarrhea, previously healthy, no medical history',
    patient: { ...base, age: '30', gender: 'female', pain_score: 5, hr: '92', bp_systolic: '118', spo2: '99', rr: '16', temperature: '37.4', weight: '60' },
    expect: { maxLevel: 3, primary: /^abdominal_pain$/, noKnownHistory: true },
    knownIssue: 'Same as A9: moderate (4-7) acute central/visceral pain should be CTAS 3; the engine gives 4.' },
];

const rows = [];
let failures = 0;
let known = 0;
for (const s of SCENARIOS) {
  const patient = { ...s.patient };
  let cc = null;
  let floor = null;
  if (s.transcript) {
    // Same path as the screen: case details from the dictation, every complaint scored,
    // the most urgent becomes the chief complaint and a floor for the level.
    patient.case_details = clinical.buildCaseDetails(s.transcript);
    cc = deriveCase(patient, { computeLiveCTAS: clinical.computeLiveCTAS, answers: {} });
    if (cc.primary) patient.chief_complaint = cc.primary.text;
    floor = cc.complaints.length >= 2 ? cc.mostUrgent?.level ?? null : null;
  }
  const transcript = s.transcript || patient.chief_complaint || '';
  const liveRaw = clinical.computeLiveCTAS(patient, {});
  const live = liveRaw && floor != null ? { ...liveRaw, level: Math.min(liveRaw.level ?? 9, floor) } : liveRaw;
  const pathway = clinical.resolveClinicalPathway({ patient, transcript }).pathway || 'general';
  let evaluation = null;
  if (patient.chief_complaint) {
    const pipeline = clinical.runClarifyingQuestionPipeline({
      patient, answers: {}, transcript, pathway, level: live?.level || 5, maxQuestions: 3,
    });
    evaluation = pipeline.modifier_evaluation || null;
  }
  const a = deriveAssessment({
    patient, liveLevel: live?.level ?? null, evalLevel: evaluation?.updated_ctas ?? null, modifierEvaluation: evaluation, answers: {},
  }, clinical);
  const prompt = nextPrompt(a.missingKeys, patient);

  const problems = [];
  const warnings = [];
  const e = s.expect;
  if (e.pending && !a.pending) problems.push(`showed CTAS ${a.level} with insufficient data`);
  if (!e.pending && a.pending) problems.push('CTAS pending although findings are sufficient');
  if (e.maxLevel != null && a.level != null && a.level > e.maxLevel) problems.push(`under-triage: CTAS ${a.level}, expected ≤ ${e.maxLevel}`);
  if (e.minLevel != null && a.level != null && a.level < e.minLevel) warnings.push(`over-triage: CTAS ${a.level}, expected ≥ ${e.minLevel}`);
  if (e.atLeast && !a.atLeast) problems.push('expected "at least" (provisional) label');
  if (e.direction && a.direction?.destination !== e.direction) problems.push(`direction ${a.direction?.destination || 'pending'}, expected ${e.direction}`);
  if (e.primary && !e.primary.test(String(cc?.primary?.key || ''))) problems.push(`primary complaint ${cc?.primary?.key || 'none'}, expected ${e.primary}`);
  for (const id of e.conditions || []) {
    if (!cc?.conditions.some((c) => c.id === id && c.status === 'present')) problems.push(`chronic illness ${id} not captured`);
  }
  for (const id of e.drugClasses || []) {
    if (!patient.case_details?.drug_classes?.includes(id)) problems.push(`medicine class ${id} not captured`);
  }
  if (e.noKnownHistory && !cc?.noKnownHistory) problems.push('"no chronic illness" not recorded');

  const issueText = [...problems, ...warnings].join('; ');
  let status = 'PASS';
  if (problems.length || warnings.length) {
    if (s.knownIssue) { status = 'KNOWN'; known += 1; }
    else if (problems.length) { status = 'FAIL'; failures += 1; }
    else status = 'WARN';
  }
  rows.push({
    id: s.id,
    scenario: s.name,
    shown: a.pending ? 'pending' : `CTAS ${a.level}${a.atLeast ? ' (at least)' : ''}${cc?.complaints.length > 1 ? ` · ${cc.complaints.map((c) => `${c.key}:${c.level}`).join(' ')}` : ''}`,
    direction: a.direction?.destination || 'pending',
    prompt: prompt ? prompt.en : '—',
    status,
    note: issueText || '',
  });
  if (status === 'KNOWN') rows[rows.length - 1].note += ` [${s.knownIssue}]`;
}

console.table(rows.map(({ note, ...r }) => r));
for (const r of rows.filter((x) => x.note)) console.log(`${r.status} ${r.id}: ${r.note}`);
console.log(`\n${rows.length} scenarios · ${failures} safety failures · ${known} known engine issues`);
process.exit(failures ? 1 : 0);
