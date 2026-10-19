/**
 * Public ticket code for a journey, e.g. T042: the last three digits of its
 * database ticket number. Used where names must not appear (the wall display)
 * and on staff cards so the two can be matched.
 */
export function ticketCode(ticketNo) {
  if (ticketNo == null || Number.isNaN(Number(ticketNo))) return 'T---';
  return `T${String(Number(ticketNo) % 1000).padStart(3, '0')}`;
}

/**
 * How a patient is shown on staff screens (PDPL): the HIS Transaction No. — never a name,
 * ID or phone. Before the number is linked, "not linked" with the ticket code beside it.
 */
export function patientLabel(p) {
  return p?.encounter_no ? String(p.encounter_no) : 'غير مربوط · Not linked';
}

/** Short staff label: ticket code plus the Transaction No. when linked, e.g. "T042 · 4006021234". */
export function patientShort(p) {
  if (!p) return '—';
  return p.encounter_no ? `${ticketCode(p.ticket_no)} · ${p.encounter_no}` : ticketCode(p.ticket_no);
}
