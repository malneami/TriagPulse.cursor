import { hasHisEncounter } from './hisHandoff.js';

export const OUTCOME_DISPOSITIONS = [
  'discharged_ed',
  'admitted',
  'transferred',
  'left_before_completion',
  'other',
] as const;

export const ADMISSION_LOCATIONS = ['ward', 'icu', 'picu', 'nicu', 'or', 'other'] as const;
export const DISCHARGE_DESTINATIONS = ['home', 'clinic_followup'] as const;
export const DIRECTION_APPROPRIATE = ['yes', 'no', 'uncertain'] as const;

/**
 * Outcome-based reference measures for the accuracy study. A high-acuity outcome is any of:
 * a life-saving intervention, ICU-level admission within 24 h, or death. Low acuity: discharged
 * home with few ED resources. Each answer can be 'unknown' until the HIS shows it.
 */
export const LIFE_SAVING_INTERVENTIONS = [
  'intubation',
  'noninvasive_ventilation',
  'cpr',
  'defibrillation_cardioversion_pacing',
  'vasopressors_inotropes',
  'blood_transfusion',
  'emergency_surgery_procedure',
  'thrombolysis_pci',
  'other_lifesaving',
] as const;

/** ED resources, counted by category as in ESI (each category once; complex procedure = 2). */
export const ED_RESOURCES = [
  'labs',
  'ecg_xray',
  'advanced_imaging',
  'iv_fluids',
  'iv_im_neb_meds',
  'specialty_consult',
  'simple_procedure',
  'complex_procedure',
] as const;

export const YES_NO_UNKNOWN = ['yes', 'no', 'unknown'] as const;
export const OUTCOME_DEATH = ['none', 'died_in_ed', 'died_in_hospital', 'unknown'] as const;
export const RETURN_72H = ['no', 'yes_discharged', 'yes_admitted', 'unknown'] as const;

/** ICD-10 code: letter, two digits, optional dot and up to 4 more characters (e.g. R07.4, J45.909). */
export const ICD10_PATTERN = /^[A-Z][0-9][0-9A-Z](\.[0-9A-Z]{1,4})?$/;

export function normalizeIcd10(raw: unknown): string | null {
  const s = String(raw ?? '').trim().toUpperCase().replace(/\s+/g, '');
  if (!s) return null;
  // Accept "R074" as "R07.4" (HIS exports often drop the dot).
  const withDot = /^[A-Z][0-9][0-9A-Z][0-9A-Z]{1,4}$/.test(s) ? `${s.slice(0, 3)}.${s.slice(3)}` : s;
  return ICD10_PATTERN.test(withDot) ? withDot : null;
}

/** ESI-style resource count: one per category; a complex procedure counts 2. */
export function resourceCount(resources: readonly string[]): number {
  return resources.reduce((n, r) => n + (r === 'complex_procedure' ? 2 : r === 'none' ? 0 : 1), 0);
}

/** Composite high-acuity outcome; null while any part is still unknown and none is positive. */
export function highAcuityOutcome(o: {
  interventions?: readonly string[] | null;
  icuWithin24h?: string | null;
  death?: string | null;
}): boolean | null {
  const lsi = (o.interventions || []).some((i) => i !== 'none');
  const icu = o.icuWithin24h === 'yes';
  const died = o.death === 'died_in_ed' || o.death === 'died_in_hospital';
  if (lsi || icu || died) return true;
  const known = (o.interventions || []).length > 0 && o.icuWithin24h != null && o.icuWithin24h !== 'unknown'
    && o.death != null && o.death !== 'unknown';
  return known ? false : null;
}

export type OutcomeDisposition = (typeof OUTCOME_DISPOSITIONS)[number];
export type AdmissionLocation = (typeof ADMISSION_LOCATIONS)[number];
export type DischargeDestination = (typeof DISCHARGE_DESTINATIONS)[number];
export type DirectionAppropriate = (typeof DIRECTION_APPROPRIATE)[number];

export type OutcomeReviewFields = {
  disposition: OutcomeDisposition;
  admissionSpecialty: string | null;
  admissionLocation: AdmissionLocation | null;
  hospitalUnitName: string | null;
  dischargeDestination: DischargeDestination | null;
  finalDiagnosis: string | null;
  reviewerComment: string | null;
  directionAppropriate: DirectionAppropriate | null;
  directionComment: string | null;
  finalDiagnosisCode: string;
  interventions: string[];
  icuWithin24h: (typeof YES_NO_UNKNOWN)[number];
  death: (typeof OUTCOME_DEATH)[number];
  resources: string[];
  resourceCount: number;
  return72h: (typeof RETURN_72H)[number];
};

/** Eligible after physician CTAS validation and a linked HIS visit number. */
export function outcomeReviewEligible(input: {
  ctasReviewedAt?: string | Date | null;
  encounterNo?: string | null;
}): boolean {
  return Boolean(input.ctasReviewedAt) && hasHisEncounter(input.encounterNo);
}

export type OutcomeActor = { id: string; role: string };
export type OutcomeAssignment = {
  ctasNurseId?: string | null;
  outcomePhysicianId?: string | null;
};

/**
 * Only the physician an admin assigned may fill the outcome review, and never the nurse who
 * triaged the case: the outcome is a reference for her accuracy, so she must not record it.
 * Admin cannot submit the form.
 */
export function outcomeReviewMayAct(user: OutcomeActor, assignment: OutcomeAssignment): boolean {
  if (!user?.id) return false;
  if (assignment.ctasNurseId && user.id === assignment.ctasNurseId) return false;
  if (user.role === 'physician') {
    return Boolean(assignment.outcomePhysicianId) && user.id === assignment.outcomePhysicianId;
  }
  return false;
}

/** Admin sees every eligible case so they can assign. Actors see only their own. */
export function outcomeReviewVisible(user: OutcomeActor, assignment: OutcomeAssignment): boolean {
  if (user.role === 'admin') return true;
  return outcomeReviewMayAct(user, assignment);
}

function clip(raw: unknown, max: number): string | null {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  return s.slice(0, max);
}

function oneOf<T extends string>(raw: unknown, allowed: readonly T[]): T | null {
  const s = String(raw ?? '').trim();
  return (allowed as readonly string[]).includes(s) ? (s as T) : null;
}

/** A pick list: known codes only, de-duplicated; 'none' must stand alone. */
function picks(raw: unknown, allowed: readonly string[]): { ok: true; value: string[] } | { ok: false } {
  const list = Array.isArray(raw) ? raw : raw == null || raw === '' ? [] : [raw];
  const values = [...new Set(list.map((x) => String(x ?? '').trim()).filter(Boolean))];
  if (!values.length) return { ok: false };
  if (values.includes('none')) return values.length === 1 ? { ok: true, value: ['none'] } : { ok: false };
  return values.every((v) => allowed.includes(v)) ? { ok: true, value: values } : { ok: false };
}

/**
 * Conditional HIS form: admitted reveals admission fields, discharged reveals discharge.
 * Never includes nurse or physician CTAS.
 */
export function normalizeOutcomeReview(body: Record<string, unknown> | Partial<OutcomeReviewFields>):
  { ok: true; value: OutcomeReviewFields } | { ok: false; error: string } {
  const disposition = oneOf(body.disposition, OUTCOME_DISPOSITIONS);
  if (!disposition) return { ok: false, error: 'Select a final disposition.' };

  const directionAppropriate = oneOf(body.directionAppropriate, DIRECTION_APPROPRIATE);
  const directionComment = clip(body.directionComment, 500);
  if (directionAppropriate === 'no' && !directionComment) {
    return { ok: false, error: 'Say why the TriagePulse direction was not appropriate.' };
  }

  const finalDiagnosisCode = normalizeIcd10(body.finalDiagnosisCode);
  if (!finalDiagnosisCode) return { ok: false, error: 'Enter the ICD-10 code of the final diagnosis (for example R07.4).' };

  const lsi = picks(body.interventions, LIFE_SAVING_INTERVENTIONS);
  if (!lsi.ok) return { ok: false, error: 'Select the life-saving interventions, or "None".' };
  const icuWithin24h = oneOf(body.icuWithin24h, YES_NO_UNKNOWN);
  if (!icuWithin24h) return { ok: false, error: 'Answer ICU admission within 24 h (yes, no or unknown).' };
  const death = oneOf(body.death, OUTCOME_DEATH);
  if (!death) return { ok: false, error: 'Answer death (none, in the ED, in hospital or unknown).' };
  const res = picks(body.resources, ED_RESOURCES);
  if (!res.ok) return { ok: false, error: 'Select the ED resources used, or "None".' };
  const return72h = oneOf(body.return72h, RETURN_72H);
  if (!return72h) return { ok: false, error: 'Answer the return visit within 72 h (or unknown).' };

  // Contradictions that would corrupt the reference.
  if (disposition === 'discharged_ed' && icuWithin24h === 'yes') {
    return { ok: false, error: 'A patient discharged from the ED cannot have an ICU admission within 24 h.' };
  }
  if (death === 'died_in_ed' && (disposition === 'discharged_ed' || disposition === 'admitted' || disposition === 'transferred')) {
    return { ok: false, error: 'Death in the ED does not fit a discharged, admitted or transferred disposition; use "Other".' };
  }

  const value: OutcomeReviewFields = {
    disposition,
    admissionSpecialty: null,
    admissionLocation: null,
    hospitalUnitName: null,
    dischargeDestination: null,
    finalDiagnosis: clip(body.finalDiagnosis, 500),
    reviewerComment: clip(body.reviewerComment, 500),
    directionAppropriate,
    directionComment: directionAppropriate === 'no' ? directionComment : null,
    finalDiagnosisCode,
    interventions: lsi.value,
    icuWithin24h,
    death,
    resources: res.value,
    resourceCount: resourceCount(res.value),
    return72h,
  };

  if (disposition === 'admitted') {
    const specialty = clip(body.admissionSpecialty, 120);
    const location = oneOf(body.admissionLocation, ADMISSION_LOCATIONS);
    if (!specialty) return { ok: false, error: 'Enter the admission specialty or service.' };
    if (!location) return { ok: false, error: 'Select the admission location.' };
    value.admissionSpecialty = specialty;
    value.admissionLocation = location;
    value.hospitalUnitName = clip(body.hospitalUnitName, 120);
  }

  if (disposition === 'discharged_ed') {
    const dest = oneOf(body.dischargeDestination, DISCHARGE_DESTINATIONS);
    if (!dest) return { ok: false, error: 'Select discharged home or clinic follow-up.' };
    value.dischargeDestination = dest;
  }

  return { ok: true, value };
}

/**
 * A case can be closed only when the 72-hour return is known, which needs 72 h since arrival.
 * Returns an error message, or null when closing is allowed.
 */
export function outcomeCloseProblem(
  row: { return72h?: string | null },
  arrivalTime: string | Date | null | undefined,
  now = new Date(),
): string | null {
  const arrived = arrivalTime ? new Date(arrivalTime).getTime() : NaN;
  if (!Number.isFinite(arrived) || now.getTime() - arrived < 72 * 3600 * 1000) {
    return 'Close the case 72 h after arrival, once the return visit is known.';
  }
  if (!row.return72h || row.return72h === 'unknown') {
    return 'Record the return visit within 72 h before closing.';
  }
  return null;
}

export function outcomeFieldSnapshot(row: OutcomeReviewFields): Record<string, string | null> {
  return {
    disposition: row.disposition,
    admissionSpecialty: row.admissionSpecialty,
    admissionLocation: row.admissionLocation,
    hospitalUnitName: row.hospitalUnitName,
    dischargeDestination: row.dischargeDestination,
    finalDiagnosis: row.finalDiagnosis,
    reviewerComment: row.reviewerComment,
    directionAppropriate: row.directionAppropriate,
    directionComment: row.directionComment,
    finalDiagnosisCode: row.finalDiagnosisCode ?? null,
    interventions: row.interventions ? row.interventions.join('|') : null,
    icuWithin24h: row.icuWithin24h ?? null,
    death: row.death ?? null,
    resources: row.resources ? row.resources.join('|') : null,
    return72h: row.return72h ?? null,
  };
}
