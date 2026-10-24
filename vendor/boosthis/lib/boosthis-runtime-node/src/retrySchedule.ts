export const REGISTRATION_RETRY_SCHEDULE_MS = [15_000, 45_000, 120_000, 300_000] as const;
export const FIRST_VERDICT_SCHEDULE_MS = [1_000, 2_000, 4_000, 8_000] as const;
export const RENEWAL_RETRY_SCHEDULE_MS = [60_000, 120_000, 300_000] as const;
export const RENEWAL_ANSWERED_WAIT_MS = 3_600_000;

let scale = 1;
/** Test-only clock seam; production values stay fixed. */
export function _setRecoveryWaitScaleForTests(value: number): void { scale = value; }
export function retryWait(schedule: readonly number[], step: number, floor = 0): number {
  const base = schedule[Math.min(step, schedule.length - 1)] * scale;
  return Math.round(floor > 0
    ? Math.max(base, floor) * (1 + Math.random() * 0.2)
    : base * (0.8 + Math.random() * 0.4));
}
export function temporaryConsentStatus(status: number): boolean {
  return status === 0 || status === 404 || status === 429 || status >= 500;
}
