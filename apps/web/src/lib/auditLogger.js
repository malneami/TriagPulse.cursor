export function createAuditEvent(action, user, details = {}) {
  return {
    action,
    at: new Date().toISOString(),
    by: user?.full_name || user?.email || 'unknown',
    details,
  };
}

export function appendAuditTrail(existing, event) {
  const list = Array.isArray(existing) ? existing : [];
  return [...list, event];
}

export function serializeAuditTrail(events = []) {
  return JSON.stringify(events, null, 2);
}
