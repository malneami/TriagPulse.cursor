/**
 * Public tracking code: T + last 3 of the internal counter + last 3 of MRN.
 * Example: ticket 1017, MRN …255 → T017-255. Until the suffix is entered: T017-•••.
 * Pass (ticketNo, mrnSuffix) or a patient/journey object with ticket_no / mrn_suffix.
 */
export function ticketCode(ticketNo, mrnSuffix) {
  if (ticketNo != null && typeof ticketNo === 'object') {
    return formatTicketCode(ticketNo.ticket_no, ticketNo.mrn_suffix);
  }
  return formatTicketCode(ticketNo, mrnSuffix);
}

function formatTicketCode(ticketNo, mrnSuffix) {
  const seq = ticketNo == null || Number.isNaN(Number(ticketNo))
    ? 'T---'
    : `T${String(Number(ticketNo) % 1000).padStart(3, '0')}`;
  const suffix = /^\d{3}$/.test(String(mrnSuffix ?? '').trim()) ? String(mrnSuffix).trim() : '•••';
  return `${seq}-${suffix}`;
}

/**
 * How a patient is shown on staff screens (PDPL): the HIS visit/voucher number — never a name,
 * ID or phone. Before the number is linked, "not linked" with the ticket code beside it.
 */
export function patientLabel(p) {
  return p?.encounter_no ? String(p.encounter_no) : 'غير مربوط · Not linked';
}

/** Short staff label: tracking code plus the visit number when linked, e.g. "T017-255 · 264409220". */
export function patientShort(p) {
  if (!p) return '—';
  const code = ticketCode(p);
  return p.encounter_no ? `${code} · ${p.encounter_no}` : code;
}
