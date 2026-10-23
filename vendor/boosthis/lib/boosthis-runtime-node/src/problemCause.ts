import { KIND_RULES } from "./dependencyKinds";
export const CAUSE_DESTINATIONS = [
  // boosthis:cause-destinations:begin
  "signin", "storage", "payments", "messaging", "search", "other", "database", "ai",
  // boosthis:cause-destinations:end
] as const;
export type CauseDestination = (typeof CAUSE_DESTINATIONS)[number];
export type ProblemCause =
  | { readAt: number; retry: { to: CauseDestination; service?: string; attempts: number; spanMs: number } }
  | { readAt: number; fanOut: { hosts: number; windowMs: number; destinations: { to: CauseDestination; hosts: number }[] } };
/** Rebuild from closed words, even after the candidate has been on disk. */
export function safeProblemCause(value: unknown, kind: string, count?: number): ProblemCause | undefined {
  try {
    const v = value as Record<string, any>;
    const n = (x: unknown, min = 0): x is number => typeof x === "number" && Number.isSafeInteger(x) && x >= min && x <= Number.MAX_SAFE_INTEGER;
    const destination = (x: unknown): x is CauseDestination => CAUSE_DESTINATIONS.includes(x as CauseDestination);
    if (!v || !n(v.readAt, 1)) return undefined;
    if (kind === "retry-storm" && v.retry && !v.fanOut) {
      const r = v.retry;
      if (!destination(r.to) || !n(r.attempts, 1) || !n(r.spanMs) || r.spanMs > 10_000 || (count !== undefined && r.attempts !== count)) return undefined;
      const service = typeof r.service === "string" && KIND_RULES.some(rule => rule.kind === r.to && rule.service === r.service) ? r.service : undefined;
      return { readAt: v.readAt, retry: { to: r.to, ...(service ? { service } : {}), attempts: r.attempts, spanMs: r.spanMs } };
    }
    if (kind === "api-thundering-herd" && v.fanOut && !v.retry) {
      const f = v.fanOut;
      if (!n(f.hosts, 1) || f.hosts > 200 || !n(f.windowMs) || f.windowMs > 50 || (count !== undefined && f.hosts !== count) || !Array.isArray(f.destinations) || f.destinations.length < 1 || f.destinations.length > 8) return undefined;
      const seen = new Set<string>();
      const rows: { to: CauseDestination; hosts: number }[] = [];
      for (const row of f.destinations) {
        if (!destination(row.to) || !n(row.hosts, 1) || seen.has(row.to)) return undefined;
        seen.add(row.to);
        rows.push({ to: row.to, hosts: row.hosts });
      }
      if (rows.reduce((sum, r) => sum + r.hosts, 0) !== f.hosts) return undefined;
      rows.sort((a, b) => b.hosts - a.hosts || (a.to < b.to ? -1 : a.to > b.to ? 1 : 0));
      return { readAt: v.readAt, fanOut: { hosts: f.hosts, windowMs: f.windowMs, destinations: rows } };
    }
  } catch { /* invalid local input is never a report */ }
  return undefined;
}
