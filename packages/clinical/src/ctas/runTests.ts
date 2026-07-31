import { computeLiveCTAS } from './vitalRanges.js';
import { validateTriageReady } from '../validation/triageValidation.js';
import { detectRedFlags } from '../alerts/redFlagEngine.js';
import { CTAS_TEST_CASES } from './ctasTestCases.js';
import {
  getClarifyingQuestions,
  resolveVisibleQuestions,
  CLARIFYING_QUESTION_BANK,
} from './clarifyingQuestionBank.js';
import { runSttTests } from '../stt/runSttTests.js';

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

// ── STT code-switching (Arabic/English) ─────────────────────────────────────
runSttTests(assert);

console.log(`\nCTAS tests: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
