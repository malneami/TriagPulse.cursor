/**
 * HIS visit/voucher number is the mandatory handoff gate between nurse CTAS
 * completion and physician validation. No number = no physician board, no Agree/Disagree.
 */

export function hasHisEncounter(encounterNo: string | null | undefined): boolean {
  return String(encounterNo ?? '').trim() !== '';
}

/** Backend rule: CTAS finished and a non-empty HIS encounter/visit number is linked. */
export function physicianValidationEligible(input: {
  ctasCompletedAt?: string | Date | null;
  encounterNo?: string | null;
}): boolean {
  return Boolean(input.ctasCompletedAt) && hasHisEncounter(input.encounterNo);
}

export type HisHandoffStatus = 'awaiting_his_link' | 'pending_physician_validation';

/** Status immediately after the nurse saves CTAS. */
export function statusAfterCtasComplete(encounterNo: string | null | undefined): HisHandoffStatus {
  return hasHisEncounter(encounterNo) ? 'pending_physician_validation' : 'awaiting_his_link';
}
