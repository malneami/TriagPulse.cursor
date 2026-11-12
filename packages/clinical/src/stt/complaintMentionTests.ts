import { extractComplaintMentions } from './extractFields';

type Assert = (cond: boolean, id: string, name: string, detail?: string) => void;

const summary = (t: string) => extractComplaintMentions(t).map((m) => `${m.complaint}×${m.count}`).join(', ');

export function runComplaintMentionTests(assert: Assert): void {
  const cases: Array<[string, string, string]> = [
    ['CM-01', 'patient complains of fever. again patient complains of fever', 'fever×2'],
    ['CM-02', 'patient complains of fever. later patient complains of cough. again patient complains of cough', 'fever×1, cough×2'],
    ['CM-03', 'patient complains of fever. patient complains of cough', 'fever×1, cough×1'],
  ];
  for (const [id, input, expected] of cases) {
    const got = summary(input);
    assert(got === expected, id, `complaint mentions: ${input.slice(0, 50)}`, `expected "${expected}", got "${got}"`);
  }
  const first = extractComplaintMentions('patient complains of fever. patient complains of cough')[0];
  assert(first?.complaint === 'fever', 'CM-04', 'first mention is the primary complaint', `got ${first?.complaint}`);
  // Re-running on the same transcript must not double-count (the pipeline re-reads the full text).
  const once = summary('patient complains of fever. again patient complains of fever');
  const twice = summary('patient complains of fever. again patient complains of fever');
  assert(once === twice, 'CM-05', 'idempotent on re-run', `${once} vs ${twice}`);
}
