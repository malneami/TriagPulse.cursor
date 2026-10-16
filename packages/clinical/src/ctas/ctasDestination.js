/**
 * Post-CTAS ED zone only (adult + pediatric journey charts).
 * Age < 14 uses pediatric zones — same cutoff as visual triage.
 * Discharge / OR / admission are out of scope.
 */

import { resolveDirection } from '../routing/routingConfig.js';


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

/**
 * Resolve the post-CTAS ED zone. Delegates to the configurable routing engine:
 * the CTAS core (resus for CTAS 1–2 and life threats, respiratory isolation, a zone
 * only takes levels it accepts) plus the active center configuration (zones, hours,
 * busy, overflow and direction rules). Center-specific routing lives in the
 * configuration, never here.
 * @param {object} [opts]
 * @param {number} [opts.level]
 * @param {number|string} [opts.age]
 * @param {Record<string, unknown>} [opts.answers]
 * @param {string|Record<string, unknown>|null} [opts.visualDestination]
 * @param {Array<Record<string, unknown>>} [opts.applied]
 * @param {Array<Record<string, unknown>>} [opts.directionApplied]
 * @param {Array<{key?: string|null, text?: string, label_en?: string, label_ar?: string}>} [opts.complaints]
 * @param {Date} [opts.now]
 * @param {object} [opts.config]
 */
export function resolveCtasDestination(opts = {}) {
  return resolveDirection(opts);
}
