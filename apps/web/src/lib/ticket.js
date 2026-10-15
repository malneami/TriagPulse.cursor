/**
 * Public ticket code for a journey, e.g. T042: the last three digits of its
 * database ticket number. Used where names must not appear (the wall display)
 * and on staff cards so the two can be matched.
 */
export function ticketCode(ticketNo) {
  if (ticketNo == null || Number.isNaN(Number(ticketNo))) return 'T---';
  return `T${String(Number(ticketNo) % 1000).padStart(3, '0')}`;
}
