export const ROLES = {
  nurse: 'nurse',
  physician: 'physician',
  admin: 'admin',
};

export const ROLE_LABELS = {
  nurse: 'Nurse / ممرض',
  physician: 'Physician / طبيب',
  admin: 'Admin / مسؤول',
};

export const PERMISSIONS = {
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
  /** Physician agreement at "Seen" or re-triage: the reference for nurse feedback. */
  review_ctas: ['physician', 'admin'],
  /** A nurse's own private accuracy page ("My triage"). */
  view_own_feedback: ['nurse', 'physician', 'admin'],
  /** HIS/manual ED outcome after physician CTAS validation. */
  review_outcome: ['nurse', 'physician', 'admin'],
  /** Admin assigns the physician who may complete Outcome Review. */
  assign_outcome_physician: ['admin'],
};

export function getUserRole(user) {
  const role = user?.clinical_role || user?.role;
  if (role === ROLES.physician || role === ROLES.admin || role === ROLES.nurse) return role;
  if (role === 'user') return ROLES.nurse;
  return ROLES.nurse;
}

export function canAccess(user, permission) {
  const allowed = PERMISSIONS[permission] || [];
  return allowed.includes(getUserRole(user));
}

export function getAccessSummary(user) {
  const role = getUserRole(user);
  return Object.fromEntries(
    Object.keys(PERMISSIONS).map((permission) => [permission, canAccess({ ...user, role }, permission)])
  );
}
