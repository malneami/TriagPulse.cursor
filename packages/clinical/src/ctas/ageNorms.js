/**
 * Configured age-group vital norms (CTAS reference ranges).
 * Do not invent SD tables here — only approved configured bounds.
 */

export function getAgeGroup(age) {
  if (age == null || age === '') return 'adult';
  const a = parseFloat(age);
  if (isNaN(a)) return 'adult';
  if (a < 0.083) return 'neonate';
  if (a < 0.25) return 'infant_1_3m';
  if (a < 1) return 'infant';
  if (a < 5) return 'toddler';
  if (a < 12) return 'child';
  if (a < 18) return 'adolescent';
  if (a >= 70) return 'elderly';
  return 'adult';
}

export function isPediatricAgeGroup(ageGroup) {
  return !['adult', 'elderly'].includes(ageGroup);
}

/** Approved pediatric/adult vital bounds — not LLM-invented. */
export const AGE_NORMS = {
  neonate: { HR: { low: 100, high: 180 }, RR: { low: 30, high: 60 }, SBP: { low: 60, high: 90 } },
  infant_1_3m: { HR: { low: 100, high: 160 }, RR: { low: 30, high: 60 }, SBP: { low: 70, high: 100 } },
  infant: { HR: { low: 80, high: 150 }, RR: { low: 24, high: 40 }, SBP: { low: 70, high: 100 } },
  toddler: { HR: { low: 70, high: 130 }, RR: { low: 22, high: 34 }, SBP: { low: 80, high: 115 } },
  child: { HR: { low: 60, high: 120 }, RR: { low: 18, high: 30 }, SBP: { low: 90, high: 120 } },
  adolescent: { HR: { low: 55, high: 110 }, RR: { low: 12, high: 20 }, SBP: { low: 100, high: 135 } },
  adult: { HR: { low: 60, high: 100 }, RR: { low: 12, high: 20 }, SBP: { low: 100, high: 140 } },
  elderly: { HR: { low: 55, high: 100 }, RR: { low: 12, high: 20 }, SBP: { low: 100, high: 150 } },
};

/** SD-based pediatric hemodynamic bands — not configured in tranche 1. */
export const PEDIATRIC_SD_HEMODYNAMIC_RULES = null;

export function getNorms(ageGroup) {
  return AGE_NORMS[ageGroup] || AGE_NORMS.adult;
}
