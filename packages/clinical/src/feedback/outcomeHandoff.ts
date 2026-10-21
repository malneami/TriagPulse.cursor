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

/** CTAS nurse, or the physician an admin assigned. Admin cannot submit the form. */
export function outcomeReviewMayAct(user: OutcomeActor, assignment: OutcomeAssignment): boolean {
  if (!user?.id) return false;
  if (user.role === 'nurse') return Boolean(assignment.ctasNurseId) && user.id === assignment.ctasNurseId;
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
  };
}
