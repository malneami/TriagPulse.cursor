import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { patientShort, ticketCode } from './ticket.js';

describe('ticketCode', () => {
  it('formats T + last 3 of ticket + last 3 of MRN', () => {
    assert.equal(ticketCode(1017, '255'), 'T017-255');
    assert.equal(ticketCode(42, '001'), 'T042-001');
  });

  it('shows ••• until the suffix is known — never invents digits', () => {
    assert.equal(ticketCode(1017), 'T017-•••');
    assert.equal(ticketCode(1017, ''), 'T017-•••');
    assert.equal(ticketCode(1017, '1793255'), 'T017-•••');
    assert.equal(ticketCode(null), 'T----•••');
  });

  it('reads ticket_no and mrn_suffix from a patient object', () => {
    assert.equal(ticketCode({ ticket_no: 1017, mrn_suffix: '255' }), 'T017-255');
    assert.equal(ticketCode({ ticket_no: 1017 }), 'T017-•••');
  });
});

describe('patientShort', () => {
  it('adds the visit number when linked', () => {
    assert.equal(
      patientShort({ ticket_no: 1017, mrn_suffix: '255', encounter_no: '264409220' }),
      'T017-255 · 264409220',
    );
    assert.equal(patientShort({ ticket_no: 1017 }), 'T017-•••');
  });
});
