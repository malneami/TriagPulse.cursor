export interface AuditEventInput {
  action: string;
  at: string;
  by: string;
  details?: Record<string, unknown>;
}

export function createAuditEvent(
  action: string,
  user: { full_name?: string; email?: string } | null,
  details: Record<string, unknown> = {},
): AuditEventInput {
  return {
    action,
    at: new Date().toISOString(),
    by: user?.full_name || user?.email || 'unknown',
    details,
  };
}

export function appendAuditTrail(existing: AuditEventInput[] | null | undefined, event: AuditEventInput) {
  const list = Array.isArray(existing) ? existing : [];
  return [...list, event];
}
