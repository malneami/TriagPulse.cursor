/**
 * Post-CTAS ED zone only (adult + pediatric journey charts).
 * Age < 14 uses pediatric zones — same cutoff as visual triage.
 * Discharge / OR / admission are out of scope.
 */

const YES_RE = /^(نعم|yes|true|1)$/i;

/** Canonical post-CTAS destinations with bilingual labels. */
export const CTAS_DESTINATIONS = {
  RESUSCITATION: {
    destination: 'RESUSCITATION',
    destination_ar: 'منطقة الإنعاش',
    destination_en: 'Resuscitation Area',
    color: '#E24B4A',
  },
  ADULT_OBSERVATION: {
    destination: 'ADULT_OBSERVATION',
    destination_ar: 'منطقة الملاحظة',
    destination_en: 'Observation Area',
    color: '#0F6E56',
  },
  FM_IM: {
    destination: 'FM_IM',
    destination_ar: 'طب الأسرة والباطنة',
    destination_en: 'Family Medicine & Internal Medicine',
    color: '#378ADD',
  },
  PEDIATRIC_RESUS: {
    destination: 'PEDIATRIC_RESUS',
    destination_ar: 'إنعاش الأطفال',
    destination_en: 'Pediatric Resuscitation',
    color: '#E24B4A',
  },
  PEDIATRIC_OBSERVATION: {
    destination: 'PEDIATRIC_OBSERVATION',
    destination_ar: 'ملاحظة الأطفال',
    destination_en: 'Pediatric Observation',
    color: '#0F6E56',
  },
  PEDS_FAST_TRACK: {
    destination: 'PEDS_FAST_TRACK',
    destination_ar: 'المسار السريع (إجراءات بسيطة)',
    destination_en: 'Fast Track (minor procedures)',
    color: '#378ADD',
  },
  PEDIATRIC_CLINIC: {
    destination: 'PEDIATRIC_CLINIC',
    destination_ar: 'عيادة الأطفال / المسار السريع',
    destination_en: 'Pediatric Clinic / Fast Track',
    color: '#888780',
  },
  RESPIRATORY: {
    destination: 'RESPIRATORY',
    destination_ar: 'المنطقة التنفسية',
    destination_en: 'Respiratory Area',
    color: '#9F4EBB',
  },
};

export function isPediatricDestinationAge(age) {
  const n = parseFloat(age);
  return Number.isFinite(n) && n < 14;
}

function isYes(value) {
  return YES_RE.test(String(value ?? '').trim());
}

function extractDestCode(visualDestination) {
  if (!visualDestination) return null;
  if (typeof visualDestination === 'string') return visualDestination;
  if (typeof visualDestination === 'object') {
    return visualDestination.destination || visualDestination.vt_destination || null;
  }
  return null;
}

function firstDestinationHint(directionApplied = [], applied = []) {
  const fromDir = (directionApplied || []).find((a) => a?.destination_hint)?.destination_hint;
  if (fromDir) return fromDir;
  return (applied || []).find((a) => a?.destination_hint)?.destination_hint || null;
}

function isResusHint(hint) {
  return hint === 'RESUSCITATION' || hint === 'PEDIATRIC_RESUS';
}

function resusForAge(pediatric) {
  return pediatric ? CTAS_DESTINATIONS.PEDIATRIC_RESUS : CTAS_DESTINATIONS.RESUSCITATION;
}

function observationForAge(pediatric) {
  return pediatric ? CTAS_DESTINATIONS.PEDIATRIC_OBSERVATION : CTAS_DESTINATIONS.ADULT_OBSERVATION;
}

function clinicForAge(pediatric) {
  return pediatric ? CTAS_DESTINATIONS.PEDIATRIC_CLINIC : CTAS_DESTINATIONS.FM_IM;
}

/**
 * Map legacy modifier hints onto chart zones.
 * URGENT_CARE / ACUTE_CARE → observation; FAST_TRACK → FM/IM or peds clinic.
 */
export function aliasDestinationHint(hint, pediatric) {
  if (!hint) return null;
  if (isResusHint(hint)) return resusForAge(pediatric);
  if (hint === 'PEDS_FAST_TRACK') return CTAS_DESTINATIONS.PEDS_FAST_TRACK;
  if (hint === 'PEDIATRIC_CLINIC') return CTAS_DESTINATIONS.PEDIATRIC_CLINIC;
  if (hint === 'FM_IM' || hint === 'FAST_TRACK') return clinicForAge(pediatric);
  if (
    hint === 'URGENT_CARE'
    || hint === 'ACUTE_CARE'
    || hint === 'ADULT_OBSERVATION'
    || hint === 'PEDIATRIC_OBSERVATION'
  ) {
    return observationForAge(pediatric);
  }
  if (hint === 'RESPIRATORY') return CTAS_DESTINATIONS.RESPIRATORY;
  return CTAS_DESTINATIONS[hint] || null;
}

function chartDestination(level, pediatric, answers = {}) {
  const lvl = Number(level) || 5;
  if (pediatric) {
    if (lvl <= 2) return CTAS_DESTINATIONS.PEDIATRIC_RESUS;
    if (lvl === 3) return CTAS_DESTINATIONS.PEDIATRIC_OBSERVATION;
    if (lvl === 4 && isYes(answers.minor_procedure)) return CTAS_DESTINATIONS.PEDS_FAST_TRACK;
    return CTAS_DESTINATIONS.PEDIATRIC_CLINIC;
  }
  if (lvl <= 2) return CTAS_DESTINATIONS.RESUSCITATION;
  if (lvl === 3) return CTAS_DESTINATIONS.ADULT_OBSERVATION;
  return CTAS_DESTINATIONS.FM_IM;
}

/**
 * Resolve post-CTAS ED zone from acuity, age, direction hints, and visual isolation.
 * @param {object} [opts]
 * @param {number} [opts.level]
 * @param {number|string} [opts.age]
 * @param {Record<string, unknown>} [opts.answers]
 * @param {string|Record<string, unknown>|null} [opts.visualDestination]
 * @param {Array<Record<string, unknown>>} [opts.applied]
 * @param {Array<Record<string, unknown>>} [opts.directionApplied]
 */
export function resolveCtasDestination({
  level,
  age,
  answers = {},
  visualDestination = null,
  applied = [],
  directionApplied = [],
} = {}) {
  const lvl = Number(level) || 5;
  const pediatric = isPediatricDestinationAge(age);
  const dirHint = firstDestinationHint(directionApplied, applied);
  const visualCode = extractDestCode(visualDestination);

  // Life-threat modifiers still force resus (adult or peds by age).
  if (isResusHint(dirHint)) {
    return { ...resusForAge(pediatric), from_direction_rule: true };
  }
  // Chart 1–2 is resus; observation/clinic hints must not downgrade.
  if (lvl <= 2) {
    return { ...resusForAge(pediatric) };
  }
  // Infectious protocol from visual triage holds unless resus won above.
  if (visualCode === 'RESPIRATORY') {
    return { ...CTAS_DESTINATIONS.RESPIRATORY, from_isolation_hold: true };
  }

  const aliased = aliasDestinationHint(dirHint, pediatric);
  if (aliased) {
    return { ...aliased, from_direction_rule: true };
  }

  return { ...chartDestination(lvl, pediatric, answers) };
}
