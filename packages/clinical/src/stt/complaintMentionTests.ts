import { extractComplaintMentions } from './extractFields';

type Assert = (cond: boolean, id: string, name: string, detail?: string) => void;

const summary = (t: string) => extractComplaintMentions(t).map((m) => `${m.complaint}×${m.count}`).join(', ');

export function runComplaintMentionTests(assert: Assert): void {
  const cases: Array<[string, string, string]> = [
    ['CM-01', 'patient complains of fever. again patient complains of fever', 'Fever×2'],
    ['CM-02', 'patient complains of fever. later patient complains of cough. again patient complains of cough', 'Fever×1, Cough×2'],
    ['CM-03', 'patient complains of fever. patient complains of cough', 'Fever×1, Cough×1'],
  ];
  for (const [id, input, expected] of cases) {
    const got = summary(input);
    assert(got === expected, id, `complaint mentions: ${input.slice(0, 50)}`, `expected "${expected}", got "${got}"`);
  }
  const ar = summary('مريض يشتكي من حمى. ثم يشتكي من سعال. وأيضا يشتكي من حمى.');
  assert(ar === 'Fever×2, Cough×1', 'CM-06', 'Arabic repeats and cross-language labels', `got "${ar}"`);
  const first = extractComplaintMentions('patient complains of fever. patient complains of cough')[0];
  assert(first?.complaint === 'Fever', 'CM-04', 'first mention is the primary complaint', `got ${first?.complaint}`);
  // CM-07: screenshot case (2026-11-14). Fever was dropped from the boxes; eye trauma was labelled as multisystem trauma.
  const shot = summary('Complaint eye trauma. Pain score 5. Pain score 3. Blood pressure 110 over 70. Complaint also. Fever. The complaint. Eye trauma and fever. Penetrating');
  assert(shot === 'Eye injury×2, Fever×2', 'CM-07', 'screenshot transcript keeps fever and eye injury', `got "${shot}"`);
  // CM-08: two Arabic complaints in one sentence, joined by a conjunction.
  const joined = summary('المريض عنده حمى ويشتكي من سعال');
  assert(joined.includes('Fever×1') && joined.includes('Cough×1'), 'CM-08', 'Arabic joined complaints both captured', `got "${joined}"`);
  // CM-09: filler words are not complaints.
  const filler = summary('patient complains of fever. also. the complaint.');
  assert(!/also|the|complaint/i.test(filler), 'CM-09', 'filler words are not complaints', `got "${filler}"`);
  // Re-running on the same transcript must not double-count (the pipeline re-reads the full text).
  const once = summary('patient complains of fever. again patient complains of fever');
  const twice = summary('patient complains of fever. again patient complains of fever');
  assert(once === twice, 'CM-05', 'idempotent on re-run', `${once} vs ${twice}`);
}
