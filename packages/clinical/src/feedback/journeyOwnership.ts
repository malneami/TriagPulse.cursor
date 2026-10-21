/**
 * First physician who checks the CTAS level owns later physician actions.
 * Nurses may still mark Seen (department board). Admin may always act.
 */
export function physicianMayAct(
  user: { id: string; role: string },
  assignedPhysicianId: string | null | undefined,
): boolean {
  if (user.role === 'admin' || user.role === 'nurse') return true;
  if (user.role !== 'physician') return true;
  return !assignedPhysicianId || assignedPhysicianId === user.id;
}
