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
};

export function canAccess(role: Role, permission: string): boolean {
  return (PERMISSIONS[permission] || []).includes(role);
}
