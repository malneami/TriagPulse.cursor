/** CTAS 2025 pregnancy and postpartum modifiers (approved 2026-10-30). */
// @ts-nocheck — JS modules
import { computeLiveCTAS } from './vitalRanges.js';
import { gestationWeeks } from './rules/pregnancyRules.js';

type Assert = (cond: boolean, id: string, label: string, detail?: string) => void;

export function runPregnancyTests(assert: Assert) {
  const base = { gender: 'female', age: '29', hr: '88', rr: '16', spo2: '99', temperature: '36.8', bp_systolic: '118', bp_diastolic: '72', gcs: '15', pain_score: 0 };
  const run = (p: Record<string, unknown>, a: Record<string, unknown> = {}) => (computeLiveCTAS as any)({ ...base, ...p }, a);
  const lvl = (p: Record<string, unknown>, a: Record<string, unknown> = {}) => run(p, a).level;
  const qs = (p: Record<string, unknown>, a: Record<string, unknown> = {}) => (run(p, a).hr_questions || []).map((q: { field: string }) => q.field);
  const cases: Array<[string, Record<string, unknown>, number, Record<string, unknown>?]> = [
    ['PG-01 A5-4 32 weeks, abdominal pain 6, headache, BP 150 → 2 (pre-eclampsia symptoms)', { chief_complaint: 'abdominal pain and headache, 32 weeks pregnant', bp_systolic: '150', pain_score: 6 }, 2],
    ['PG-02 30 weeks, BP 165/95, no symptoms → 2 (SBP > 160)', { chief_complaint: 'routine check, 30 weeks pregnant', bp_systolic: '165', bp_diastolic: '95' }, 2],
    ['PG-03 30 weeks, BP 138/104 → 2 (DBP > 100; SBP or DBP)', { chief_complaint: 'feels unwell, 30 weeks pregnant', bp_systolic: '138', bp_diastolic: '104' }, 2],
    ['PG-04 28 weeks, BP 145/88 → 3 (SBP > 140)', { chief_complaint: 'check up, 28 weeks pregnant', bp_systolic: '145', bp_diastolic: '88' }, 3],
    ['PG-05 34 weeks, decreased fetal movement → 2', { chief_complaint: 'decreased fetal movement, 34 weeks pregnant' }, 2],
    ['PG-06 36 weeks, no fetal movement since morning → 1', { chief_complaint: '36 weeks pregnant, baby not moving since morning' }, 1],
    ['PG-07 38 weeks, contractions every 3 minutes → 2', { chief_complaint: '38 weeks pregnant, contractions every 3 minutes' }, 2],
    ['PG-08 38 weeks, contractions every 10 minutes → 3', { chief_complaint: '38 weeks pregnant, contractions every 10 minutes' }, 3],
    ['PG-09 35 weeks, waters broke → 3', { chief_complaint: '35 weeks pregnant, waters broke an hour ago' }, 3],
    ['PG-10 33 weeks, heavy vaginal bleeding → 1', { chief_complaint: '33 weeks pregnant, heavy vaginal bleeding' }, 1],
    ['PG-11 37 weeks, seizure at home → 1 (eclampsia)', { chief_complaint: '37 weeks pregnant, had a seizure at home' }, 1],
    ['PG-12 30 weeks, car accident → 2 (major blunt trauma)', { chief_complaint: '30 weeks pregnant, car accident' }, 2],
    ['PG-13 10 weeks, heavy bleeding with clots → 2', { chief_complaint: 'heavy vaginal bleeding with clots, 10 weeks pregnant', pain_score: 3 }, 2],
    ['PG-14 10 weeks, mild bleeding → 3', { chief_complaint: 'vaginal bleeding, 10 weeks pregnant', pain_score: 2 }, 3],
    ['PG-15 8 weeks, spotting only → 4', { chief_complaint: 'spotting, 8 weeks pregnant' }, 4],
    ['PG-16 9 weeks, persistent vomiting → 3', { chief_complaint: '9 weeks pregnant, persistent vomiting, cannot keep fluids down' }, 3],
    ['PG-17 Postpartum day 5, BP 170/105, headache → 2', { chief_complaint: 'headache, delivered 5 days ago', bp_systolic: '170', bp_diastolic: '105' }, 2],
    ['PG-18 Postpartum, BP 150/92 → 3', { chief_complaint: 'check after delivery, gave birth 2 weeks ago', bp_systolic: '150', bp_diastolic: '92' }, 3],
    ['PG-19 Arabic: حامل في الشهر السابع مع صداع وزغللة → 2', { chief_complaint: 'حامل في الشهر السابع، صداع وزغللة في النظر' }, 2],
    ['PG-20 Arabic: قلة حركة الجنين، حامل 34 أسبوع → 2', { chief_complaint: 'قلة حركة الجنين، حامل 34 أسبوع' }, 2],
  ];
  for (const [label, p, want, a] of cases) {
    const got = lvl(p, a || {});
    assert(got === want, label.slice(0, 5), label.slice(6), `got ${got}`);
  }
  assert(qs({ chief_complaint: 'pregnant, abdominal pain', pain_score: 4 }).includes('gestation_weeks'), 'PG-21', 'Pregnant, gestation not stated → asks "How many weeks?"');
  assert(lvl({ chief_complaint: 'pregnant, headache' }) === 2 && lvl({ chief_complaint: 'pregnant, headache' }, { gestation_weeks: 'under_20' }) > 2,
    'PG-22', 'Gestation unknown → > 20-week findings apply (headache → 2); answered under 20 → not pre-eclampsia');
  assert(lvl({ chief_complaint: 'ankle sprain', pain_score: 2 }) === 5, 'PG-23', 'Not pregnant → no pregnancy rule');
  assert(lvl({ chief_complaint: 'no bleeding, 30 weeks pregnant, routine check' }) > 3, 'PG-24', '"No bleeding" is not bleeding');
  assert(gestationWeeks('حامل في الشهر السابع') === 30 && gestationWeeks('G2P1 at 32 weeks gestation') === 32, 'PG-25', 'Gestation read from Arabic month and English weeks');
}
