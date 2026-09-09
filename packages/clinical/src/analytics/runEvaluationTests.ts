import { computeEvaluationReport } from './computeEvaluation.js';

let passed = 0;
let failed = 0;

function assert(cond: boolean, id: string, name: string, detail = '') {
  if (cond) {
    passed += 1;
    console.log(`✓ ${id} ${name}`);
  } else {
    failed += 1;
    console.log(`✗ ${id} ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

{
  const safeCases = Array.from({ length: 25 }, (_, i) => ({
    id: `s${i}`,
    createdAt: new Date(Date.now() - i * 86400000).toISOString(),
    age: 40 + (i % 20),
    chiefComplaint: 'chest pain',
    nurseCtas: 2,
    aiRecommendedCtas: 2,
    clinicianFinalCtas: 2,
    agreement: true,
    triageDurationMin: 8,
    missingFields: [],
    assessmentTrail: { clarifying: { questions_shown: ['q1', 'q2'] } },
  }));

  const safe = computeEvaluationReport(safeCases, 30);
  assert(safe.overall_decision === 'go' || safe.overall_decision === 'cautious_go', 'EV-01', 'safe cohort is not NO-GO', safe.overall_decision);
  assert((safe.sample_sizes.expert_labeled || 0) === 25, 'EV-02', 'counts expert-labeled cases');
  assert((safe.hero_cards || []).some((c) => c.id === 'critical_sensitivity'), 'EV-03', 'hero cards include critical sensitivity');
}

{
  // Critical expert CTAS 1 assigned AI CTAS 5 → veto NO-GO
  const unsafe = [
    {
      id: 'u1',
      createdAt: new Date().toISOString(),
      age: 55,
      chiefComplaint: 'chest pain',
      nurseCtas: 2,
      aiRecommendedCtas: 5,
      clinicianFinalCtas: 1,
      agreement: false,
      overrideReason: 'missed ACS',
      assessmentTrail: {},
      missingFields: [],
    },
    ...Array.from({ length: 24 }, (_, i) => ({
      id: `ok${i}`,
      createdAt: new Date().toISOString(),
      age: 30,
      chiefComplaint: 'fever',
      nurseCtas: 4,
      aiRecommendedCtas: 4,
      clinicianFinalCtas: 4,
      agreement: true,
      assessmentTrail: {},
      missingFields: [],
    })),
  ];
  const report = computeEvaluationReport(unsafe, 30);
  const missGate = (report.safety_gates || []).find((g) => g.id === 'missed_critical_as_low');
  assert(missGate?.status === 'no_go', 'EV-04', 'CTAS 1 missed as 4–5 is NO-GO gate', JSON.stringify(missGate));
  assert(report.overall_decision === 'no_go', 'EV-05', 'overall decision vetoes to NO-GO', report.overall_decision);
  assert((report.case_reviews || []).some((c) => c.critical_missed_as_low), 'EV-06', 'case review flags unsafe miss');
}

{
  const empty = computeEvaluationReport([], 30);
  assert(empty.overall_decision === 'insufficient_data', 'EV-07', 'empty window → insufficient_data');
}

console.log(`\nEvaluation tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
