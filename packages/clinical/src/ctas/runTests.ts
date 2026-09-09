import { computeLiveCTAS } from './vitalRanges.js';
import { validateTriageReady } from '../validation/triageValidation.js';
import { detectRedFlags } from '../alerts/redFlagEngine.js';
import { CTAS_TEST_CASES } from './ctasTestCases.js';
import {
  getClarifyingQuestions,
  resolveVisibleQuestions,
  resolveCtasHintsFromAnswers,
  CLARIFYING_QUESTION_BANK,
  normalizePathwayFamily,
} from './clarifyingQuestionBank.js';
import {
  detectKnownModifier,
  evaluateModifierEngine,
  selectMissingModifiers,
  resolveCtasDestination,
} from './modifierEngine.js';
import { CTAS_MODIFIER_LIBRARY } from './modifierLibrary.js';
import { runSttTests } from '../stt/runSttTests.js';
import { runFeverValidationSuite } from './ctasFeverValidation.js';
import { runClarifyingQuestionPipeline } from './questionPipeline.js';
import { resolveClinicalPathway } from './resolveClinicalPathway.js';
import { resolveChiefComplaint, matchComplaint } from './resolveChiefComplaint.js';
import { detectSymptomChronicity } from './detectSymptomChronicity.js';
import { evaluateCtasRules } from './ctasRulesEngine.js';

let passed = 0;
let failed = 0;

function assert(cond: boolean, id: string, name: string, detail = '') {
  if (cond) {
    console.log(`✓ ${id} ${name}`);
    passed++;
  } else {
    console.error(`✗ ${id} ${name}${detail ? ` — ${detail}` : ''}`);
    failed++;
  }
}

// ── Clarifying MC bank + second-order pathway aliases ───────────────────────
{
  const bankL2 = getClarifyingQuestions({
    level: 2,
    pathway: 'chest_pain_cardiac',
    answers: {},
  });
  assert(
    bankL2.source === 'bank' && bankL2.questions.some((q) => q.field === 'radiation'),
    'CQ-01',
    'bank fetch CTAS2 chest_pain_cardiac includes radiation',
    `got ${bankL2.questions.map((q) => q.field).join(',')}`,
  );

  const branched = getClarifyingQuestions({
    level: 2,
    pathway: 'chest_pain_cardiac',
    answers: { radiation: 'نعم' },
  });
  assert(
    branched.questions.some((q) => q.field === 'radiation_site'),
    'CQ-02',
    'branch unlocks radiation_site after radiation=نعم',
    `fields=${branched.questions.map((q) => q.field).join(',')}`,
  );

  const bankL5 = getClarifyingQuestions({
    level: 5,
    pathway: 'chest_pain_non_cardiac',
    answers: {},
  });
  assert(
    bankL5.source === 'bank'
      && bankL5.questions.some((q) => q.field === 'chest_pain_reproducible')
      && !bankL5.questions.some((q) => q.field === 'radiation'),
    'CQ-03',
    'CTAS5 non-cardiac uses different set (no radiation roots)',
    `fields=${bankL5.questions.map((q) => q.field).join(',')}`,
  );

  const slice = CLARIFYING_QUESTION_BANK.filter((q) =>
    q.pathways.includes('chest_pain_cardiac') && q.levels.includes(2),
  );
  const resolved = resolveVisibleQuestions(slice, { radiation: 'نعم', diaphoresis: 'نعم' });
  assert(
    resolved.some((q) => q.field === 'nausea_vomiting'),
    'CQ-04',
    'resolveVisibleQuestions follows diaphoresis→nausea branch',
  );

  const soPatient = {
    age: 55,
    chief_complaint: 'ألم في الصدر',
    hr: 88,
    bp_systolic: 130,
    bp_diastolic: 80,
    spo2: 98,
    rr: 18,
    temperature: 36.8,
    gcs: 15,
    pain_score: 6,
  };
  const baseline = computeLiveCTAS(soPatient, {
    _selectedModifier: { ctas: 3, modifier: 'possible_acs' },
  });
  const upgraded = computeLiveCTAS(soPatient, {
    _selectedModifier: { ctas: 3, modifier: 'possible_acs' },
    radiation: 'نعم',
  });
  assert(
    (upgraded?.level ?? 99) <= 2 && (upgraded?.level ?? 99) <= (baseline?.level ?? 99),
    'CQ-05',
    'chest_pain_cardiac pathway + radiation upgrades via Step 4 aliases',
    `baseline=${baseline?.level} upgraded=${upgraded?.level} pathway=${upgraded?.assessment_trail?.step2_complaint?.pathway}`,
  );

  // Nearby-level fallback: CTAS 1 chest pain has no exact bank row → falls back to level 2 set
  const nearby = getClarifyingQuestions({
    level: 1,
    pathway: 'chest_pain_cardiac',
    answers: {},
  });
  assert(
    nearby.source === 'bank' && nearby.questions.some((q) => q.field === 'radiation'),
    'CQ-05b',
    'CTAS1 chest_pain falls back to nearby bank levels with radiation',
    `source=${nearby.source} level=${nearby.level} fields=${nearby.questions.map((q) => q.field).join(',')}`,
  );
}

// ── CTAS Modifier Engine (suppress known + level change explanation) ─────────
{
  const cardiacMod = CTAS_MODIFIER_LIBRARY.find((m) => m.id === 'mod_cp_prior_cardiac');
  const known = detectKnownModifier(cardiacMod, {
    patient: {},
    answers: {},
    transcript: 'Patient is diabetic and has chest pain',
  });
  assert(
    known.known === true && known.value === 'نعم',
    'ME-01',
    'detectKnownModifier recognizes diabetes from transcript',
    JSON.stringify(known),
  );

  const selection = selectMissingModifiers({
    pathway: 'chest_pain_cardiac',
    level: 3,
    patient: { age: 55, chief_complaint: 'chest pain', gender: 'male' },
    answers: {},
    transcript: 'I am diabetic',
    maxQuestions: 3,
  });
  assert(
    selection.known_modifiers.some((k) => k.field === 'prior_cardiac_history')
      && !selection.questions.some((q) => q.field === 'prior_cardiac_history'),
    'ME-02',
    'suppresses prior-cardiac question when diabetes already stated',
    `known=${selection.known_modifiers.map((k) => k.field).join(',')} asked=${selection.questions.map((q) => q.field).join(',')}`,
  );

  const evalResult = evaluateModifierEngine({
    patient: {
      age: 55,
      chief_complaint: 'ألم في الصدر',
      hr: 88,
      bp_systolic: 130,
      bp_diastolic: 80,
      spo2: 98,
      rr: 18,
      temperature: 36.8,
      gcs: 15,
      pain_score: 7,
    },
    answers: {
      _selectedModifier: { ctas: 3, modifier: 'possible_acs' },
      return_visit_72h: 'نعم',
    },
    pathway: 'chest_pain_cardiac',
    initialLevel: 3,
  });
  assert(
    evalResult.updated_ctas === 3
      && evalResult.ctas_changed === false
      && evalResult.team_leader_review === true
      && (evalResult.direction_applied || []).some((a) => a.field === 'return_visit_72h'),
    'ME-03',
    'return visit alone does NOT upgrade CTAS; triggers patient-direction + team leader',
    `level=${evalResult.updated_ctas} changed=${evalResult.ctas_changed} tl=${evalResult.team_leader_review} dir=${JSON.stringify(evalResult.direction_applied)}`,
  );

  const surgeryEval = evaluateModifierEngine({
    patient: {
      age: 45,
      chief_complaint: 'ألم بطن',
      hr: 82,
      bp_systolic: 122,
      bp_diastolic: 78,
      spo2: 98,
      rr: 16,
      temperature: 36.8,
      gcs: 15,
      pain_score: 5,
    },
    answers: {
      recent_abdominal_surgery: 'نعم',
    },
    pathway: 'abdominal_pain',
    initialLevel: 5,
  });
  const surgeryDir = (surgeryEval.direction_applied || []).find((a) => a.field === 'recent_abdominal_surgery');
  assert(
    !!surgeryDir
      && surgeryDir.ctas_effect == null
      && surgeryDir.category === 'patient_direction'
      && !/→\s*CTAS\s*\d+/i.test(String(surgeryDir.label_en ?? ''))
      && !(surgeryEval.applied_modifiers || []).some(
        (a) => a.field === 'recent_abdominal_surgery' && a.ctas_effect != null,
      ),
    'ME-03b',
    'recent abdominal surgery is patient_direction only — no CTAS floor; copy must not claim CTAS floor',
    `level=${surgeryEval.updated_ctas} dir=${JSON.stringify(surgeryDir)} applied=${JSON.stringify(surgeryEval.applied_modifiers)}`,
  );

  assert(
    selection.questions.length <= 3,
    'ME-04',
    'asks at most 3 clarifying questions',
    `count=${selection.questions.length}`,
  );
}

// ── Clarifying Question Engine: suppression, categories, max-3 ───────────────
{
  const stentEval = evaluateModifierEngine({
    patient: {
      age: 60,
      chief_complaint: 'chest pain',
      hr: 80,
      bp_systolic: 120,
      bp_diastolic: 70,
      spo2: 98,
      rr: 16,
      temperature: 36.6,
      gcs: 15,
      pain_score: 5,
    },
    answers: {},
    transcript: 'I had a stent three years ago and I use insulin every day',
    pathway: 'chest_pain_cardiac',
    initialLevel: 3,
    maxQuestions: 3,
  });
  assert(
    (stentEval.known_modifiers || []).some((k) => k.field === 'prior_cardiac_history')
      && !(stentEval.questions || []).some((q) => q.field === 'prior_cardiac_history'),
    'CQE-01',
    'stent/insulin suppresses prior-cardiac re-ask',
    `known=${(stentEval.known_modifiers || []).map((k) => k.field).join(',')} asked=${(stentEval.questions || []).map((q) => q.field).join(',')}`,
  );

  const revisitKnown = evaluateModifierEngine({
    patient: { age: 40, chief_complaint: 'abdominal pain', pain_score: 4, hr: 78, bp_systolic: 118, spo2: 98, rr: 16, temperature: 36.7, gcs: 15 },
    answers: {},
    transcript: 'I was discharged yesterday and came back because the abdominal pain is still there',
    pathway: 'abdominal_pain',
    initialLevel: 4,
  });
  assert(
    (revisitKnown.known_facts || []).some((f) => f.field === 'return_visit_72h' && f.status === 'known_positive')
      && !(revisitKnown.questions || []).some((q) => q.field === 'return_visit_72h'),
    'CQE-02',
    'return visit auto-detected from transcript; question suppressed',
    `facts=${JSON.stringify(revisitKnown.known_facts)} asked=${(revisitKnown.questions || []).map((q) => q.field).join(',')}`,
  );

  const withRadiation = evaluateModifierEngine({
    patient: {
      age: 55,
      chief_complaint: 'chest pain',
      hr: 88,
      bp_systolic: 130,
      spo2: 98,
      rr: 18,
      temperature: 36.8,
      gcs: 15,
      pain_score: 7,
    },
    answers: {
      _selectedModifier: { ctas: 3 },
      radiation: 'نعم',
    },
    pathway: 'chest_pain_cardiac',
    initialLevel: 3,
  });
  assert(
    (withRadiation.updated_ctas ?? 99) <= 2
      && (
        (withRadiation.applied_modifiers || []).some((a: Record<string, unknown>) => (
          a.field === 'radiation' || a.category === 'ctas_modifier'
        ))
        || /radiation|إشعاع/i.test(
          (withRadiation.applied_modifiers || [])
            .map((a: Record<string, unknown>) => `${a.label_en || ''} ${a.label_ar || ''}`)
            .join(' '),
        )
      ),
    'CQE-03',
    'CTAS modifier answer (radiation) can raise acuity',
    `level=${withRadiation.updated_ctas} applied=${JSON.stringify(withRadiation.applied_modifiers)}`,
  );

  assert(
    (stentEval.questions || []).length <= 3,
    'CQE-04',
    'engine caps at 3 questions',
    `count=${(stentEval.questions || []).length}`,
  );

  const lockedCtas = evaluateModifierEngine({
    patient: {
      age: 55,
      chief_complaint: 'chest pain',
      hr: 88,
      bp_systolic: 130,
      spo2: 98,
      rr: 18,
      temperature: 36.8,
      gcs: 15,
      pain_score: 7,
    },
    answers: { _selectedModifier: { ctas: 2, modifier: 'possible_acs' } },
    transcript: 'chest pain started one hour ago',
    pathway: 'chest_pain_cardiac',
    initialLevel: 2,
    skipCtasVerification: true,
  });
  assert(
    !(lockedCtas.questions || []).some((q) => (q.question_category || q.category) === 'ctas_modifier')
      && !(lockedCtas.questions || []).some((q) => q.field === 'return_visit_72h'),
    'CQE-05',
    'after Step 2 CTAS lock: no ctas_modifier re-verify Qs and no blank return-visit checklist',
    `asked=${(lockedCtas.questions || []).map((q) => `${q.field}:${q.question_category || q.category}`).join(',')}`,
  );
}

// ── Pathway relevance: fever must not get trauma clarifying questions ────────
{
  const feverPatient = {
    age: 30,
    chief_complaint: 'ذ كم؟',
    hr: 90,
    bp_systolic: 105,
    bp_diastolic: 65,
    spo2: 99,
    rr: 20,
    temperature: 39,
    gcs: 15,
    pain_score: 0,
  };
  const resolved = resolveClinicalPathway({ patient: feverPatient });
  assert(
    resolved.pathway === 'fever' && resolved.source === 'vital_fever',
    'PATH-01',
    'temp ≥38 infers fever pathway when complaint is garbled',
    JSON.stringify(resolved),
  );

  const feverPipe = runClarifyingQuestionPipeline({
    patient: feverPatient,
    pathway: 'general',
    level: 3,
    maxQuestions: 3,
  });
  const traumaFields = ['high_energy_mechanism', 'weight_bearing', 'loc_any', 'swelling_deformity'];
  assert(
    feverPipe.source === 'modifier_engine'
      && (feverPipe.questions || []).some((q) => q.field === 'looks_unwell' || q.field === 'immunocompromised')
      && !(feverPipe.questions || []).some((q) => traumaFields.includes(String(q.field))),
    'PATH-02',
    'fever case asks looks_unwell/immuno — never trauma MOI/weight-bearing',
    `source=${feverPipe.source} asked=${(feverPipe.questions || []).map((q) => q.field).join(',')}`,
  );

  const bankGeneral = getClarifyingQuestions({ level: 3, pathway: 'general', answers: {} });
  assert(
    !(bankGeneral.questions || []).some((q) => traumaFields.includes(String(q.field))),
    'PATH-03',
    'bank general pathway no longer includes trauma checklist questions',
    `asked=${(bankGeneral.questions || []).map((q) => q.field).join(',')}`,
  );

  // After Step 2 lock: pathway bank still offers complaint-specific Qs
  const lockedChestPipe = runClarifyingQuestionPipeline({
    patient: {
      age: 55,
      chief_complaint: 'chest pain',
      hr: 88,
      bp_systolic: 130,
      spo2: 98,
      rr: 18,
      temperature: 36.8,
      gcs: 15,
      pain_score: 7,
    },
    pathway: 'chest_pain_cardiac',
    level: 2,
    selectedModifier: { ctas: 2, modifier: 'possible_acs' },
    maxQuestions: 3,
  });
  assert(
    (lockedChestPipe.questions || []).some((q) => q.field === 'radiation' || q.field === 'diaphoresis')
      && !(lockedChestPipe.questions || []).some((q) => q.field === 'return_visit_72h')
      && !(lockedChestPipe.questions || []).some((q) => traumaFields.includes(String(q.field))),
    'PATH-04',
    'after Step 2 lock, chest pathway bank still offers radiation/diaphoresis (no blank return-visit / trauma)',
    `source=${lockedChestPipe.source} asked=${(lockedChestPipe.questions || []).map((q) => q.field).join(',')}`,
  );

  const limbBank = getClarifyingQuestions({ level: 4, pathway: 'limb_pain', answers: {} });
  assert(
    (limbBank.questions || []).some((q) => q.field === 'weight_bearing' || q.field === 'high_energy_mechanism')
      && !(limbBank.questions || []).some((q) => q.field === 'loc_any'),
    'PATH-05',
    'limb_pain asks weight-bearing/MOI — never LOC',
    `asked=${(limbBank.questions || []).map((q) => q.field).join(',')}`,
  );

  const extremityBank = getClarifyingQuestions({ level: 4, pathway: 'lower_extremity_injury', answers: {} });
  assert(
    (extremityBank.questions || []).some((q) => q.field === 'weight_bearing')
      && !(extremityBank.questions || []).some((q) => q.field === 'loc_any'),
    'PATH-06',
    'lower_extremity_injury asks weight-bearing — never LOC',
    `asked=${(extremityBank.questions || []).map((q) => q.field).join(',')}`,
  );

  const coolBank = getClarifyingQuestions({ level: 2, pathway: 'cool_pulseless_limb', answers: {} });
  assert(
    !(coolBank.questions || []).some((q) => q.field === 'radiation' || q.field === 'diaphoresis'),
    'PATH-07',
    'cool_pulseless_limb does not inherit cardiac radiation via family',
    `family=${normalizePathwayFamily('cool_pulseless_limb')} asked=${(coolBank.questions || []).map((q) => q.field).join(',')}`,
  );

  assert(
    normalizePathwayFamily('cool_pulseless_limb') === 'cool_pulseless_limb'
      && normalizePathwayFamily('limb_pain') === 'limb_trauma'
      && normalizePathwayFamily('head_injury') === 'head_trauma'
      && normalizePathwayFamily('wheezing') === 'dyspnea'
      && normalizePathwayFamily('nasal_trauma') === 'nasal_trauma',
    'PATH-08',
    'pathway families: cool_pulseless identity; limb vs head trauma split; wheezing→dyspnea; nasal stays facial',
    `cool=${normalizePathwayFamily('cool_pulseless_limb')} limb=${normalizePathwayFamily('limb_pain')} head=${normalizePathwayFamily('head_injury')}`,
  );

  const limbEngine = selectMissingModifiers({
    pathway: 'limb_pain',
    level: 3,
    patient: { age: 25, chief_complaint: 'ankle injury' },
    answers: {},
    skipCtasVerification: false,
  });
  assert(
    !(limbEngine.questions || []).some((q) => q.field === 'loc_any'),
    'PATH-09',
    'modifier engine: limb_pain must not ask head-injury LOC',
    `asked=${(limbEngine.questions || []).map((q) => q.field).join(',')}`,
  );

  const bleedAlias = selectMissingModifiers({
    pathway: 'blood_in_stools',
    level: 3,
    patient: { age: 40, chief_complaint: 'melena' },
    answers: {},
    skipCtasVerification: false,
  });
  assert(
    (bleedAlias.questions || []).some((q) => q.field === 'uncontrolled_bleeding')
      || (bleedAlias.known_modifiers || []).some((k) => k.field === 'uncontrolled_bleeding'),
    'PATH-10',
    'blood_in_stools aliases to gi_bleed bleed modifiers',
    `asked=${(bleedAlias.questions || []).map((q) => q.field).join(',')} known=${(bleedAlias.known_modifiers || []).map((k) => k.field).join(',')}`,
  );
}

// ── Clarifying ctas_hint floors (hint-only, combined, no-downgrade) ──────────
{
  const hintResolved = resolveCtasHintsFromAnswers({
    sirs_criteria_count: 'نعم',
    prior_cardiac_history: 'نعم',
  });
  assert(
    hintResolved.hints.some((h) => h.field === 'prior_cardiac_history' && h.ctas_hint === 2)
      && !hintResolved.hints.some((h) => h.field === 'sirs_criteria_count'),
    'CQ-06',
    'resolveCtasHintsFromAnswers returns cardiac ctas_hint; SIRS has no auto-floor hint',
    `hints=${JSON.stringify(hintResolved.hints.map((h) => `${h.field}:${h.ctas_hint}`))}`,
  );

  // SIRS yes alone must NOT floor to CTAS 2 (fever+HR without ≥3 SIRS / immuno / compromise)
  const feverPatient = {
    age: 40,
    chief_complaint: 'حمى',
    hr: 88,
    bp_systolic: 120,
    bp_diastolic: 75,
    spo2: 98,
    rr: 18,
    temperature: 38.5,
    gcs: 15,
    pain_score: 2,
  };
  const feverBaseline = computeLiveCTAS(feverPatient, {
    _selectedModifier: { ctas: 4, modifier: 'fever_looks_well' },
    looks_unwell: 'لا',
  });
  const feverSirsAnswerOnly = computeLiveCTAS(feverPatient, {
    _selectedModifier: { ctas: 4, modifier: 'fever_looks_well' },
    looks_unwell: 'لا',
    sirs_criteria_count: 'نعم',
  });
  assert(
    (feverBaseline?.level ?? 99) >= 4
      && (feverSirsAnswerOnly?.level ?? 0) >= 3
      && (feverSirsAnswerOnly?.level ?? 0) !== 1,
    'CQ-07',
    'SIRS yes answer alone does not force CTAS 1/2 without structured ≥3 SIRS or shock',
    `baseline=${feverBaseline?.level} sirsOnly=${feverSirsAnswerOnly?.level}`,
  );

  // Combined: second-order radiation + hint prior_cardiac — both contribute, more urgent wins
  const chestPatient = {
    age: 55,
    chief_complaint: 'ألم في الصدر',
    hr: 88,
    bp_systolic: 130,
    bp_diastolic: 80,
    spo2: 98,
    rr: 18,
    temperature: 36.8,
    gcs: 15,
    pain_score: 6,
  };
  const combined = computeLiveCTAS(chestPatient, {
    _selectedModifier: { ctas: 3, modifier: 'possible_acs' },
    radiation: 'نعم',
    prior_cardiac_history: 'نعم',
  });
  const step4Applied = (combined?.assessment_trail?.step4_second_order?.applied || []) as Array<{
    source?: string;
    label_en?: string;
    label_ar?: string;
  }>;
  assert(
    (combined?.level ?? 99) <= 2
      && step4Applied.length >= 1
      && (
        step4Applied.some((m) => m.source === 'ctas_hint')
        || step4Applied.some((m) => /radiation|cardiac|hint/i.test(m.label_en || ''))
      ),
    'CQ-08',
    'combined: second-order + ctas_hint both apply; final is more urgent',
    `level=${combined?.level} applied=${JSON.stringify(step4Applied)}`,
  );

  // No downgrade: already CTAS 2; answering looks_unwell (hint 3) must stay ≤ 2
  const noDowngrade = computeLiveCTAS(chestPatient, {
    _selectedModifier: { ctas: 2, modifier: 'cardiac_ischemia' },
    looks_unwell: 'نعم',
  });
  assert(
    (noDowngrade?.level ?? 99) <= 2,
    'CQ-09',
    'ctas_hint never worsens acuity (hint 3 on CTAS 2 stays ≤ 2)',
    `level=${noDowngrade?.level}`,
  );
}


for (const testCase of CTAS_TEST_CASES) {
  const { patient, expectedLevel, expectedLevelMin, expectedLevelMax, expectedRedFlag, expectedIncomplete, expectedInvalid, name, id } = testCase;

  if (expectedInvalid) {
    const validation = validateTriageReady(patient);
    if (!validation.ok) {
      console.log(`✓ ${id} ${name}`);
      passed++;
    } else {
      console.error(`✗ ${id} ${name} — expected invalid vitals`);
      failed++;
    }
    continue;
  }

  if (expectedIncomplete) {
    const validation = validateTriageReady(patient);
    if (!validation.ok && validation.missing.length > 0) {
      console.log(`✓ ${id} ${name}`);
      passed++;
    } else {
      console.error(`✗ ${id} ${name} — expected incomplete data flag`);
      failed++;
    }
    continue;
  }

  const result = computeLiveCTAS(patient);
  const redFlags = detectRedFlags(patient);

  let ok = true;
  if (expectedLevel !== undefined && result?.level !== expectedLevel) {
    console.error(`✗ ${id} ${name} — expected CTAS ${expectedLevel}, got ${result?.level}`);
    ok = false;
  }
  if (expectedLevelMin !== undefined && (result?.level ?? 99) > expectedLevelMin) {
    console.error(`✗ ${id} ${name} — expected CTAS <= ${expectedLevelMin}, got ${result?.level}`);
    ok = false;
  }
  if (expectedLevelMax !== undefined && (result?.level ?? 0) > expectedLevelMax) {
    console.error(`✗ ${id} ${name} — expected CTAS <= ${expectedLevelMax}, got ${result?.level}`);
    ok = false;
  }
  if (expectedRedFlag === true && !redFlags) {
    console.error(`✗ ${id} ${name} — expected red flag`);
    ok = false;
  }
  if (expectedRedFlag === false && redFlags) {
    console.error(`✗ ${id} ${name} — unexpected red flag`);
    ok = false;
  }

  if (ok) {
    console.log(`✓ ${id} ${name} — CTAS ${result?.level}`);
    passed++;
  } else {
    failed++;
  }
}

// ── Validation gate: chief complaint only; blanks are non-blocking ───────────
{
  const complaintOnly = validateTriageReady({ chief_complaint: 'Abdominal Pain / ألم بطن' });
  assert(
    complaintOnly.ok === true && complaintOnly.missing.length === 0,
    'VAL-01',
    'chief complaint alone is enough for validateTriageReady',
    JSON.stringify(complaintOnly),
  );

  const noComplaint = validateTriageReady({ age: 40, hr: 80 });
  assert(
    noComplaint.ok === false && noComplaint.missing.some((f) => f.key === 'chief_complaint'),
    'VAL-02',
    'missing chief complaint blocks triage ready',
    JSON.stringify(noComplaint),
  );

  const blankVitalsLevel = computeLiveCTAS({ chief_complaint: 'Back Pain / ألم ظهر', age: 34 });
  assert(
    blankVitalsLevel?.level != null && blankVitalsLevel.level >= 1 && blankVitalsLevel.level <= 5,
    'VAL-03',
    'blank vitals still yield a CTAS level (treated as non-abnormal)',
    `level=${blankVitalsLevel?.level}`,
  );

  const badWeight = validateTriageReady({ chief_complaint: 'Fever / حمى', weight: 900 });
  assert(
    badWeight.ok === false && badWeight.errors.length > 0,
    'VAL-04',
    'out-of-range weight still fails validation',
    JSON.stringify(badWeight),
  );
}

// ── Rare complaint resolver + chronicity ─────────────────────────────────────
{
  const heat = resolveChiefComplaint({ chiefComplaint: 'heat stroke' });
  assert(
    heat.selected?.complaintKey === 'heat_related'
      || (heat.candidates[0]?.complaintKey === 'heat_related' && heat.candidates[0].confidence > (heat.candidates.find((c) => c.complaintKey === 'stroke_cva')?.confidence || 0)),
    'CC-01',
    'heat stroke maps to heat_related not stroke',
    JSON.stringify(heat.candidates?.slice(0, 3)),
  );

  const dizzy = resolveChiefComplaint({ chiefComplaint: 'dizziness' });
  assert(
    dizzy.needs_confirmation === true && (dizzy.candidates?.length || 0) >= 1,
    'CC-02',
    'dizziness requires provider confirmation with candidates',
    `status=${dizzy.status} n=${dizzy.candidates?.length}`,
  );

  const chest = resolveChiefComplaint({ chiefComplaint: 'chest pain cardiac features' });
  assert(
    chest.status === 'auto' && chest.selected?.complaintKey === 'chest_pain_cardiac',
    'CC-03',
    'clear cardiac chest pain auto-maps',
    `status=${chest.status} key=${chest.selected?.complaintKey}`,
  );

  const neck = resolveChiefComplaint({ chiefComplaint: 'neck pain' });
  assert(
    neck.needs_confirmation === true && (neck.candidates?.length || 0) >= 1,
    'CC-04',
    'neck pain needs confirmation (not silent general)',
    `status=${neck.status}`,
  );

  const confirmed = matchComplaint('whatever', { confirmedKey: 'tinnitus' });
  assert(confirmed?.complaintKey === 'tinnitus', 'CC-05', 'confirmed key wins for matchComplaint');

  const chronNew = detectSymptomChronicity({
    transcript: 'This is a new symptom, first time, suddenly started',
    patient: { pain_score: 7 },
  });
  assert(chronNew.status === 'new' && chronNew.question_needed === false, 'CH-01', 'detects new from transcript', JSON.stringify(chronNew));

  const chronStable = detectSymptomChronicity({
    transcript: 'SpO2 always around 90% on home oxygen, same as usual baseline',
    patient: { spo2: '90', pain_score: 2 },
  });
  assert(
    chronStable.status === 'chronic_unchanged' && chronStable.question_needed === false,
    'CH-02',
    'detects chronic unchanged and suppresses question',
    JSON.stringify(chronStable),
  );

  const chronAsk = detectSymptomChronicity({
    patient: { pain_score: 8, spo2: '93' },
    transcript: '',
  });
  assert(
    chronAsk.status === 'uncertain' && chronAsk.question_needed === true,
    'CH-03',
    'asks chronicity when unclear and CTAS-relevant',
    JSON.stringify(chronAsk),
  );

  const spo2Chronic = evaluateCtasRules({
    patient: {
      age: 68,
      chief_complaint: 'Shortness of Breath',
      confirmed_complaint_key: 'shortness_of_breath',
      spo2: 90,
      hr: 88,
      symptom_chronicity: 'chronic_unchanged',
      baseline_spo2: 90,
      transcription: 'home oxygen, same as usual baseline SpO2 90%',
    },
    answers: { home_oxygen: 'نعم' },
    transcript: 'home oxygen, same as usual baseline SpO2 90%',
  });
  const spo2Suppressed = !!spo2Chronic?.assessment_trail?.chronicity?.spo2_floor_suppressed;
  const noAcuteHypoxia = !(spo2Chronic?.assessment_trail?.step3_primary_modifiers?.respiratory?.candidates || [])
    .some((c: { rule_id?: string }) => String(c.rule_id || '').includes('hypoxia'));
  assert(
    spo2Suppressed || noAcuteHypoxia,
    'CH-04',
    'chronic unchanged baseline SpO₂ does not force acute hypoxia CTAS',
    `level=${spo2Chronic?.level} suppressed=${spo2Suppressed}`,
  );

  const spo2Acute = evaluateCtasRules({
    patient: {
      age: 68,
      chief_complaint: 'Shortness of Breath',
      confirmed_complaint_key: 'shortness_of_breath',
      spo2: 90,
      hr: 88,
      symptom_chronicity: 'worse_than_baseline',
      transcription: 'worse than usual baseline',
    },
    answers: {},
    transcript: 'worse than usual baseline',
  });
  assert(
    (spo2Acute?.level ?? 5) <= 3,
    'CH-05',
    'worsening hypoxia still applies acute SpO₂ floors',
    `level=${spo2Acute?.level}`,
  );

  const ambiguous = resolveChiefComplaint({ chiefComplaint: 'tinnitus and cough' });
  assert(
    ambiguous.needs_confirmation === true || (ambiguous.candidates?.length || 0) >= 2,
    'CC-06',
    'ambiguous multi-cue presents candidates',
    `status=${ambiguous.status} n=${ambiguous.candidates?.length}`,
  );
}

// ── Post-CTAS destinations (adult / pediatric journey charts) ───────────────
{
  const dest = (opts: Record<string, unknown>) => resolveCtasDestination(opts).destination;

  assert(dest({ level: 1, age: 40 }) === 'RESUSCITATION', 'DEST-01', 'adult CTAS 1 → RESUSCITATION');
  assert(dest({ level: 2, age: 40 }) === 'RESUSCITATION', 'DEST-02', 'adult CTAS 2 → RESUSCITATION');
  assert(dest({ level: 3, age: 40 }) === 'ADULT_OBSERVATION', 'DEST-03', 'adult CTAS 3 → ADULT_OBSERVATION');
  assert(dest({ level: 4, age: 40 }) === 'FM_IM', 'DEST-04', 'adult CTAS 4 → FM_IM');
  assert(dest({ level: 5, age: 40 }) === 'FM_IM', 'DEST-05', 'adult CTAS 5 → FM_IM');

  assert(dest({ level: 2, age: 8 }) === 'PEDIATRIC_RESUS', 'DEST-06', 'age 8 CTAS 2 → PEDIATRIC_RESUS');
  assert(dest({ level: 3, age: 8 }) === 'PEDIATRIC_OBSERVATION', 'DEST-07', 'age 8 CTAS 3 → PEDIATRIC_OBSERVATION');
  assert(
    dest({ level: 4, age: 8, answers: { minor_procedure: 'نعم' } }) === 'PEDS_FAST_TRACK',
    'DEST-08',
    'age 8 CTAS 4 + minor procedure → PEDS_FAST_TRACK',
  );
  assert(dest({ level: 5, age: 8 }) === 'PEDIATRIC_CLINIC', 'DEST-09', 'age 8 CTAS 5 → PEDIATRIC_CLINIC');
  assert(
    dest({ level: 4, age: 8 }) === 'PEDIATRIC_CLINIC',
    'DEST-09b',
    'age 8 CTAS 4 without minor procedure → PEDIATRIC_CLINIC',
  );
  assert(
    dest({ level: 4, age: 40, visualDestination: 'RESPIRATORY' }) === 'RESPIRATORY',
    'DEST-10',
    'visual RESPIRATORY + CTAS 4 stays RESPIRATORY',
  );
  assert(
    dest({ level: 2, age: 40, visualDestination: 'RESPIRATORY' }) === 'RESUSCITATION',
    'DEST-11',
    'visual RESPIRATORY + CTAS 2 still resus (resus wins)',
  );

  const obsHint = dest({
    level: 4,
    age: 45,
    directionApplied: [{ destination_hint: 'URGENT_CARE' }],
  });
  assert(obsHint === 'ADULT_OBSERVATION', 'DEST-12', 'URGENT_CARE hint remaps to adult observation', `got ${obsHint}`);

  const acuteHint = dest({
    level: 5,
    age: 45,
    directionApplied: [{ destination_hint: 'ACUTE_CARE' }],
  });
  assert(acuteHint === 'ADULT_OBSERVATION', 'DEST-13', 'ACUTE_CARE hint remaps to adult observation', `got ${acuteHint}`);

  const ftHint = dest({
    level: 4,
    age: 45,
    directionApplied: [{ destination_hint: 'FAST_TRACK' }],
  });
  assert(ftHint === 'FM_IM', 'DEST-14', 'FAST_TRACK hint remaps to FM_IM in adults', `got ${ftHint}`);

  const pedsFtAlias = dest({
    level: 4,
    age: 8,
    directionApplied: [{ destination_hint: 'FAST_TRACK' }],
  });
  assert(pedsFtAlias === 'PEDIATRIC_CLINIC', 'DEST-15', 'FAST_TRACK hint remaps to peds clinic', `got ${pedsFtAlias}`);

  const resusHint = dest({
    level: 4,
    age: 45,
    applied: [{ destination_hint: 'RESUSCITATION' }],
  });
  assert(resusHint === 'RESUSCITATION', 'DEST-16', 'RESUSCITATION safety hint still wins at CTAS 4', `got ${resusHint}`);

  const pedsResusHint = dest({
    level: 4,
    age: 8,
    applied: [{ destination_hint: 'RESUSCITATION' }],
  });
  assert(pedsResusHint === 'PEDIATRIC_RESUS', 'DEST-17', 'RESUSCITATION hint is pediatric resus when age < 14', `got ${pedsResusHint}`);

  const pedsAsk = selectMissingModifiers({
    pathway: 'laceration',
    level: 4,
    patient: { age: 8, chief_complaint: 'cut on the arm' },
    answers: {},
    skipCtasVerification: true,
  });
  assert(
    pedsAsk.questions.some((q) => q.field === 'minor_procedure'),
    'DEST-18',
    'peds CTAS 4 laceration asks minor_procedure',
    `fields=${pedsAsk.questions.map((q) => q.field).join(',')}`,
  );

  const pedsL5 = selectMissingModifiers({
    pathway: 'laceration',
    level: 5,
    patient: { age: 8 },
    answers: {},
    skipCtasVerification: true,
  });
  assert(
    !pedsL5.questions.some((q) => q.field === 'minor_procedure'),
    'DEST-19',
    'minor_procedure hidden when CTAS is not 4',
    `fields=${pedsL5.questions.map((q) => q.field).join(',')}`,
  );

  const adultL4 = selectMissingModifiers({
    pathway: 'laceration',
    level: 4,
    patient: { age: 30 },
    answers: {},
    skipCtasVerification: true,
  });
  assert(
    !adultL4.questions.some((q) => q.field === 'minor_procedure'),
    'DEST-20',
    'minor_procedure is pediatric only',
    `fields=${adultL4.questions.map((q) => q.field).join(',')}`,
  );

  const enginePeds = evaluateModifierEngine({
    patient: {
      age: 8,
      chief_complaint: 'laceration',
      hr: 90,
      bp_systolic: 100,
      spo2: 99,
      rr: 20,
      temperature: 36.8,
      gcs: 15,
      pain_score: 3,
    },
    answers: {
      minor_procedure: 'نعم',
      _selectedModifier: { ctas: 4, modifier: 'Sutures Required' },
    },
    pathway: 'laceration',
    initialLevel: 4,
    skipCtasVerification: true,
  });
  const pedsDest = (enginePeds.suggested_destination as { destination?: string } | null)?.destination;
  assert(
    pedsDest === 'PEDS_FAST_TRACK'
      && (enginePeds.direction_applied || []).some((a) => a.field === 'minor_procedure')
      && !(enginePeds.applied_modifiers || []).some(
        (a) => a.field === 'minor_procedure' && a.ctas_effect != null,
      ),
    'DEST-21',
    'engine: peds CTAS 4 + minor procedure → PEDS_FAST_TRACK without CTAS effect',
    `dest=${pedsDest} level=${enginePeds.updated_ctas}`,
  );

  const isolationEngine = evaluateModifierEngine({
    patient: {
      age: 40,
      chief_complaint: 'cough',
      hr: 80,
      bp_systolic: 120,
      spo2: 97,
      rr: 16,
      temperature: 37.2,
      gcs: 15,
      pain_score: 1,
    },
    answers: {},
    pathway: 'urti_complaints',
    initialLevel: 4,
    visualTriage: { destination: 'RESPIRATORY' },
    skipCtasVerification: true,
  });
  const isolationDest = (isolationEngine.suggested_destination as { destination?: string } | null)?.destination;
  assert(
    isolationDest === 'RESPIRATORY',
    'DEST-22',
    'engine: visual RESPIRATORY + CTAS 4 stays RESPIRATORY',
    `dest=${isolationDest}`,
  );
}

// ── Fever / SIRS / hemodynamic release-gate validation ───────────────────────
runFeverValidationSuite(assert);

// ── STT code-switching (Arabic/English) ─────────────────────────────────────
runSttTests(assert);

console.log(`\nCTAS tests: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
