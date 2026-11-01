/**
 * System CTAS vs the nurse/PCT decision, checked against the physician and the outcome.
 *
 * - System CTAS (at decision): the level the system showed when the nurse pressed Confirm or
 *   Change (stored as ai/rules_recommended_ctas).
 * - System first CTAS: the first level right after dictation, before the questions
 *   (validated_payload.initial_assessment.level); missing when the story was typed.
 * - Outcome reference: a high-acuity outcome (life-saving intervention, ICU within 24 h or
 *   death) should have been CTAS 1–2; any other completed outcome CTAS 3–5.
 */

export type LevelVerdict = 'agree' | 'under' | 'over';

const lvl = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : v == null || v === '' ? NaN : Number(v);
  return Number.isInteger(n) && n >= 1 && n <= 5 ? n : null;
};

/** Level vs a reference level: CTAS 1 is most urgent, so a higher number is under-triage. */
export function versusLevel(level: unknown, reference: unknown): LevelVerdict | null {
  const a = lvl(level); const r = lvl(reference);
  if (a == null || r == null) return null;
  if (a === r) return 'agree';
  return a > r ? 'under' : 'over';
}

/** Level vs the outcome: high acuity needs CTAS 1–2; otherwise CTAS 1–2 is over-triage. */
export function versusOutcome(level: unknown, highAcuity: boolean | null | undefined): LevelVerdict | null {
  const a = lvl(level);
  if (a == null || highAcuity == null) return null;
  if (highAcuity) return a <= 2 ? 'agree' : 'under';
  return a <= 2 ? 'over' : 'agree';
}

export type SystemCtasInput = {
  aiRecommendedCtas?: number | null;
  rulesRecommendedCtas?: number | null;
  nurseCtas?: number | null;
  ctasLevel?: number | null;
  validatedPayload?: unknown;
};

/** System level at decision, the very first system level, the nurse level, and whether she changed it. */
export function systemCtasOf(r: SystemCtasInput) {
  const system = lvl(r.aiRecommendedCtas) ?? lvl(r.rulesRecommendedCtas);
  const p = r.validatedPayload && typeof r.validatedPayload === 'object' ? r.validatedPayload as Record<string, unknown> : null;
  const init = p?.initial_assessment && typeof p.initial_assessment === 'object' ? p.initial_assessment as Record<string, unknown> : null;
  const first = lvl(init?.level);
  const nurse = lvl(r.nurseCtas) ?? lvl(r.ctasLevel);
  return {
    system,
    first,
    nurse,
    nurseChanged: system != null && nurse != null && system !== nurse,
    questionsChanged: first != null && system != null && first !== system,
  };
}

/** When the nurse changed the level, who matched the reference better. */
export function overrideWinner(system: number | null, nurse: number | null, ref: ((l: number) => LevelVerdict | null) | null) {
  if (system == null || nurse == null || system === nurse || !ref) return null;
  const s = ref(system); const n = ref(nurse);
  if (s == null || n == null) return null;
  if (n === 'agree' && s !== 'agree') return 'nurse';
  if (s === 'agree' && n !== 'agree') return 'system';
  if (s === 'agree' && n === 'agree') return 'both';
  // Both wrong: the safer (more urgent) error is less harmful.
  if (s === 'under' && n === 'over') return 'nurse_safer';
  if (n === 'under' && s === 'over') return 'system_safer';
  return 'neither';
}

export type SystemNurseCase = SystemCtasInput & {
  physicianCtas?: number | null;
  physicianConditionChanged?: boolean | null;
  highAcuityOutcome?: boolean | null;
};

const pct = (n: number, d: number) => (d ? Math.round((n / d) * 1000) / 10 : null);

/** Summary for the AI evaluation page: system vs nurse vs physician vs outcome. */
export function computeSystemNurseComparison(rows: SystemNurseCase[]) {
  const cases = rows.map((r) => {
    const s = systemCtasOf(r);
    const phys = r.physicianConditionChanged ? null : lvl(r.physicianCtas);
    return { ...s, phys, outcome: r.highAcuityOutcome ?? null };
  });
  const tally = (list: typeof cases, pick: (c: (typeof cases)[number]) => LevelVerdict | null) => {
    const v = list.map(pick).filter((x): x is LevelVerdict => x != null);
    return {
      n: v.length,
      agree_pct: pct(v.filter((x) => x === 'agree').length, v.length),
      under_pct: pct(v.filter((x) => x === 'under').length, v.length),
      over_pct: pct(v.filter((x) => x === 'over').length, v.length),
      under: v.filter((x) => x === 'under').length,
    };
  };
  const changed = cases.filter((c) => c.nurseChanged);
  const winners = (ref: 'physician' | 'outcome') => {
    const out = { nurse: 0, system: 0, both: 0, nurse_safer: 0, system_safer: 0, neither: 0 };
    let n = 0;
    for (const c of changed) {
      const f = ref === 'physician'
        ? (c.phys == null ? null : (l: number) => versusLevel(l, c.phys))
        : (c.outcome == null ? null : (l: number) => versusOutcome(l, c.outcome));
      const w = overrideWinner(c.system, c.nurse, f);
      if (w) { out[w as keyof typeof out] += 1; n += 1; }
    }
    return { n, ...out };
  };
  const withFirst = cases.filter((c) => c.first != null && c.system != null);
  return {
    cases: cases.length,
    with_system_level: cases.filter((c) => c.system != null).length,
    nurse_changed: changed.length,
    nurse_changed_pct: pct(changed.length, cases.filter((c) => c.system != null && c.nurse != null).length),
    changed_up: changed.filter((c) => (c.nurse as number) < (c.system as number)).length,
    changed_down: changed.filter((c) => (c.nurse as number) > (c.system as number)).length,
    questions_changed: withFirst.filter((c) => c.questionsChanged).length,
    questions_changed_pct: pct(withFirst.filter((c) => c.questionsChanged).length, withFirst.length),
    vs_physician: {
      system: tally(cases, (c) => versusLevel(c.system, c.phys)),
      nurse: tally(cases, (c) => versusLevel(c.nurse, c.phys)),
      first: tally(cases, (c) => versusLevel(c.first, c.phys)),
    },
    vs_outcome: {
      system: tally(cases, (c) => versusOutcome(c.system, c.outcome)),
      nurse: tally(cases, (c) => versusOutcome(c.nurse, c.outcome)),
      first: tally(cases, (c) => versusOutcome(c.first, c.outcome)),
    },
    when_nurse_changed: { vs_physician: winners('physician'), vs_outcome: winners('outcome') },
  };
}
