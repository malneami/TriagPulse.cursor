import { redactIdentifiers, stripIdentifiers, findIdentifierKeys, REDACTED } from './redact.js';
import { buildLlmExtractPrompt, LLM_CTAS_JSON_SCHEMA } from '../stt/llmExtractSchema.js';
import { extractFieldsFromTranscript, mapSttSessionToPatientUpdates } from '../stt/extractFields.js';

type Assert = (cond: boolean, id: string, name: string, detail?: string) => void;

/** PDPL: only the Transaction No. identifies a patient; names and ID numbers never leave the server. */
export function runPrivacyTests(assert: Assert) {
  const r = (s: string) => redactIdentifiers(s);

  const a = r('رقم الهوية 1023456789 والجوال 0551234567');
  assert(!/\d{7,}/.test(a) && a.includes('رقم الهوية') && a.includes('والجوال'), 'PV-01', 'National ID and mobile removed, words kept', a);
  const b = r('call +966 55 123 4567 or 00966551234567, iqama 2345678901');
  assert(!/\d/.test(b), 'PV-02', 'Phone in +966 / 00966 forms and iqama removed', b);
  const c = r('١٠٢٣٤٥٦٧٨٩ ID in Arabic digits');
  assert(c.startsWith(REDACTED), 'PV-03', 'Arabic-Indic digits removed', c);
  const v = r('HR 120 BP 150/90 SpO2 95 temp 38.5 RR 22 GCS 14 pain 7 since 3 days, age 45');
  assert(v.includes('120') && v.includes('150/90') && v.includes('38.5') && v.includes('45') && !v.includes(REDACTED), 'PV-04', 'Vitals, ages and scores are kept', v);
  const d = r('اسمه محمد أحمد عنده ألم في الصدر');
  assert(!d.includes('محمد') && !d.includes('أحمد') && d.includes('عنده ألم في الصدر'), 'PV-05', 'Arabic spoken name removed; complaint kept', d);
  const e = r('my name is Sara Khalid and I have chest pain');
  assert(!/Sara|Khalid/.test(e) && e.includes('and I have chest pain'), 'PV-06', 'English spoken name removed; complaint kept', e);
  const f = r('name is unknown, brought by ambulance');
  assert(f === 'name is unknown, brought by ambulance', 'PV-07', 'No name after the cue → unchanged', f);
  const g = r('Transaction No. 4006021234 on the ticket');
  assert(!g.includes('4006021234'), 'PV-08', 'Even the Transaction No. is not sent out inside free text', g);
  const h = r('اسم المريضة: نورة. تشتكي من صداع');
  assert(!h.includes('نورة') && h.includes('تشتكي من صداع'), 'PV-09', 'Name after "اسم المريضة:" removed', h);

  const keep = 'started 2026-10-19T04:35:02.545Z rule 3f50e239-1234567-8a9b library 12345678abc id 0f3ce23f-e3f4';
  assert(r(keep) === keep, 'PV-17', 'Dates, times and record IDs are not touched', r(keep));
  const grouped = r('ID 1023-456-789 date 2026-10-19 and 19-10-2026');
  assert(!grouped.includes('1023-456-789') && grouped.includes('2026-10-19') && grouped.includes('19-10-2026'), 'PV-18', 'Dash-grouped ID removed; dates kept', grouped);

  const blob = {
    patient_name_ar: 'محمد', mrn: '1234567', phone: '0551234567', age: 45,
    trail: { patient: { patientNameEn: 'Ali', hr: 110, note: 'id 1023456789' }, steps: ['HR 110', 'اسمها هند عندها حرارة'] },
  };
  const s = stripIdentifiers(blob) as Record<string, any>;
  assert(!('patient_name_ar' in s) && !('mrn' in s) && !('phone' in s) && s.age === 45, 'PV-10', 'Identifier keys dropped, clinical keys kept', JSON.stringify(s));
  assert(!('patientNameEn' in s.trail.patient) && s.trail.patient.hr === 110 && !s.trail.patient.note.includes('1023456789'), 'PV-11', 'Nested keys dropped and strings redacted', JSON.stringify(s.trail));
  assert(!s.trail.steps[1].includes('هند') && s.trail.steps[1].includes('عندها حرارة'), 'PV-12', 'Names inside arrays redacted', s.trail.steps[1]);
  assert(findIdentifierKeys(blob).length === 4 && findIdentifierKeys(s).length === 0, 'PV-13', 'Identifier finder', findIdentifierKeys(blob).join(','));

  // The outside extraction step is never asked for a name and never sees one.
  const prompt = buildLlmExtractPrompt('his name is Omar Saleh, ID 1023456789, chest pain HR 120', []);
  assert(!/Omar|Saleh|1023456789/.test(prompt) && prompt.includes('HR 120'), 'PV-14', 'Extraction prompt is redacted', prompt.slice(-200));
  const schemaKeys = Object.keys((LLM_CTAS_JSON_SCHEMA as { properties: Record<string, unknown> }).properties);
  assert(!schemaKeys.some((k) => /name_ar|name_en/.test(k)) && !/patient_name/.test(prompt), 'PV-15', 'Extraction schema has no patient-name fields');

  // Speech capture no longer fills a name into the triage form.
  const fields = extractFieldsFromTranscript('اسمه خالد عمره 30 سنة عنده ألم بطن');
  const { updates } = mapSttSessionToPatientUpdates(fields);
  assert(!('patient_name_ar' in updates) && !('patient_name_en' in updates), 'PV-16', 'Dictated name is not captured', JSON.stringify(updates));
}
