const CTAS_WAIT_LIMITS: Record<number, number> = {
  1: 0,
  2: 15,
  3: 30,
  4: 60,
  5: 120,
};

export function waitMins(arrivalTime: string | Date | null | undefined, ctasLevel?: number | null): number | null {
  if (!arrivalTime || !ctasLevel) return null;
  const arrival = new Date(arrivalTime);
  if (Number.isNaN(arrival.getTime())) return null;
  const elapsed = Math.floor((Date.now() - arrival.getTime()) / 60000);
  const limit = CTAS_WAIT_LIMITS[ctasLevel] ?? 120;
  return Math.max(0, elapsed - limit);
}

export function waitTimeColor(waitMins: number | null, ctasLevel?: number | null): string {
  if (waitMins === null || !ctasLevel) return 'bg-gray-100';
  if (ctasLevel <= 2 && waitMins > 0) return 'bg-red-100 border-red-400';
  if (waitMins > 30) return 'bg-red-100 border-red-400';
  if (waitMins > 15) return 'bg-amber-100 border-amber-400';
  return 'bg-green-50 border-green-200';
}

/** Seconds from CTAS start to CTAS completion. Not door-to-physician wait. */
export function triageDurationSec(
  startedAt: string | Date | null | undefined,
  completedAt: string | Date | null | undefined,
): number | null {
  if (!startedAt || !completedAt) return null;
  const a = new Date(startedAt).getTime();
  const b = new Date(completedAt).getTime();
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) return null;
  return Math.round((b - a) / 1000);
}

export function isActiveJourney(arrivalTime: string | Date, hoursWindow = 12): boolean {
  const arrival = new Date(arrivalTime);
  if (Number.isNaN(arrival.getTime())) return false;
  return Date.now() - arrival.getTime() < hoursWindow * 60 * 60 * 1000;
}

export const ROLES = {
  nurse: 'nurse',
  physician: 'physician',
  admin: 'admin',
} as const;

export type Role = (typeof ROLES)[keyof typeof ROLES];

export const PERMISSIONS: Record<string, Role[]> = {
  register_patient: ['nurse', 'physician', 'admin'],
  perform_triage: ['nurse', 'physician', 'admin'],
  view_triage_log: ['nurse', 'physician', 'admin'],
  override_ctas: ['nurse', 'physician', 'admin'],
  acknowledge_critical_alert: ['nurse', 'physician', 'admin'],
  view_dashboard: ['nurse', 'physician', 'admin'],
  manage_security: ['admin'],
  manage_clinical_libraries: ['admin'],
  manage_routing: ['admin'],
  set_zone_status: ['nurse', 'physician', 'admin'],
  view_clinical_analytics: ['admin', 'physician'],
  /** Physician agrees or disagrees with the nurse CTAS level (validation, not Seen). */
  review_ctas: ['physician', 'admin'],
  /** A nurse's own private accuracy page ("My triage"). */
  view_own_feedback: ['nurse', 'physician', 'admin'],
  /** HIS/manual ED outcome after physician CTAS validation. */
  review_outcome: ['nurse', 'physician', 'admin'],
  /** Admin assigns the physician who may complete Outcome Review. */
  assign_outcome_physician: ['admin'],
};

export function canAccess(role: Role, permission: string): boolean {
  return (PERMISSIONS[permission] || []).includes(role);
}
