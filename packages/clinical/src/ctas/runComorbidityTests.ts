/**
 * Chronic illness + presenting problem rules (escalate-only), bedside test extraction,
 * the paediatric hydration question and direction effects of "No" answers.
 */
import { buildCaseDetails } from './caseDetails.js';
import { evaluateComorbidityRules, extractBedsideTests } from './comorbidityRules.js';
import { applyModifierLibraryEffects } from './modifierLibrary.js';
import { selectMissingModifiers } from './modifierEngine.js';
import { extractFieldsFromTranscript, mapSttSessionToPatientUpdates } from '../stt/extractFields.js';

type Assert = (cond: boolean, id: string, name: string, detail?: string) => void;

function rules(transcript: string, patient: Record<string, unknown> = {}, answers: Record<string, unknown> = {}) {
  const caseDetails = buildCaseDetails(transcript);
  return { caseDetails, r: evaluateComorbidityRules({ patient, caseDetails, answers, transcript }) };
}

export function runComorbidityTests(assert: Assert) {
  // The reported case: 4 y, known diabetic, abdominal pain + vomiting.
  const t = 'Patient four years old came with abdominal pain and vomiting, known case of diabetic, pain score three, heart rate 120';
  {
    const { r } = rules(t, { age: '4', pain_score: 3, hr: '120' });
    assert(r.floor === 3 && r.pendingChecks.map((c) => c.key).join(',') === 'glucose,ketones',
      'CR-01', 'diabetic child + vomiting → at least CTAS 3, glucose and ketones required', JSON.stringify(r));
  }
  {
    const { r } = rules(t, { age: '4', glucose: '19.5' });
    assert(r.floor === 2, 'CR-02', 'glucose > 14 → CTAS 2', JSON.stringify(r.applied));
  }
  {
    const { r } = rules(t, { age: '4', glucose: '8', ketones: 'positive' });
    assert(r.floor === 2, 'CR-03', 'ketones positive → CTAS 2', JSON.stringify(r.applied));
  }
  {
    const { r } = rules(t, { age: '4', glucose: '7', ketones: 'negative' });
    assert(r.floor === 3 && r.pendingChecks.length === 0, 'CR-04', 'normal checks → stays at least CTAS 3, nothing pending', JSON.stringify(r));
  }
  {
    const { r } = rules('45 year old with vomiting, known diabetic', { age: '45' });
    assert(r.floor == null, 'CR-05', 'diabetes rule is for children only', JSON.stringify(r.applied));
  }
  {
    const { r } = rules('child with vomiting, not diabetic', { age: '6' });
    assert(r.floor == null, 'CR-06', 'denied illness never triggers a rule', JSON.stringify(r.applied));
  }
  {
    const { r, caseDetails } = rules('child 8 years with vomiting, on insulin', { age: '8' });
    assert(r.floor == null && r.confirmQuestions.some((q) => q.field === 'confirm_condition_diabetes'),
      'CR-07', 'illness known only from a medicine → confirm question, no floor yet', JSON.stringify({ r, c: caseDetails.conditions }));
    const after = evaluateComorbidityRules({ patient: { age: '8' }, caseDetails, answers: { confirm_condition_diabetes: 'نعم' }, transcript: 'child 8 years with vomiting, on insulin' });
    assert(after.floor === 3, 'CR-08', 'confirmed by the nurse → rule applies', JSON.stringify(after.applied));
  }
  {
    const { r } = rules('طفل عمره 6 سنوات عنده حرارة، معروف عنده فقر الدم المنجلي', { age: '6', temperature: '38.6' });
    assert(r.floor === 2, 'CR-09', 'sickle cell + fever → CTAS 2', JSON.stringify(r.applied));
  }
  {
    const { r } = rules('70 year old fell and hit his head, head injury, takes warfarin', { age: '70' });
    assert(r.floor === 2 && r.applied[0]?.id === 'CR-ANTICOAG', 'CR-10', 'blood thinner + head injury → CTAS 2', JSON.stringify(r.applied));
  }
  {
    const { r } = rules('child with fever, on chemotherapy for leukemia', { age: '7', temperature: '38.4' });
    assert(r.floor === 2 && r.applied.some((x) => x.id === 'CR-IMMUNO'), 'CR-11', 'chemotherapy + fever → CTAS 2', JSON.stringify(r.applied));
  }
  {
    const { r } = rules('child with VP shunt, headache and vomiting', { age: '9' });
    assert(r.floor === 2, 'CR-12', 'VP shunt + headache/vomiting → CTAS 2', JSON.stringify(r.applied));
  }
  {
    const { r } = rules('infant with known metabolic disorder, cough and runny nose', { age: '1' });
    assert(r.floor === 2 && r.pendingChecks.some((c) => c.key === 'glucose'), 'CR-13', 'metabolic disorder + any illness → CTAS 2, glucose required', JSON.stringify(r));
  }
  {
    const { r } = rules('baby with congenital heart disease, fast breathing', { age: '0.5', rr: '60' });
    assert(r.floor === 2, 'CR-14', 'congenital heart + breathlessness → CTAS 2', JSON.stringify(r.applied));
  }
  {
    const a = rules('dialysis patient with weakness', { age: '60' }).r;
    const b = rules('chronic kidney disease with weakness', { age: '60' }).r;
    assert(a.floor === 2 && b.floor == null, 'CR-15', 'dialysis (not CKD alone) + weakness → CTAS 2', JSON.stringify({ a: a.applied, b: b.applied }));
  }
  {
    const { r } = rules('sickle cell disease, here for prescription refill', { age: '20' });
    assert(r.floor == null, 'CR-16', 'illness without its trigger does nothing', JSON.stringify(r.applied));
  }

  // Bedside tests from dictation.
  {
    const a = extractBedsideTests('capillary glucose 22 mmol, ketones positive');
    const b = extractBedsideTests('RBS 300 mg/dl, ketones 0.3');
    const c = extractBedsideTests('السكر 18 والكيتونات إيجابية');
    const d = extractBedsideTests('known diabetic on insulin');
    assert(a.glucose?.value === 22 && a.ketones?.value === 'positive'
      && b.glucose?.value === 16.7 && b.glucose?.converted_from_mgdl && b.ketones?.value === 'negative'
      && c.glucose?.value === 18 && c.ketones?.value === 'positive'
      && d.glucose == null && d.ketones == null,
      'CR-17', 'glucose (mmol/L, mg/dL converted) and ketones are read from dictation, never assumed', JSON.stringify({ a, b, c, d }));
  }

  // Paediatric hydration question: asked for vomiting/diarrhoea only; grades follow CTAS.
  {
    const pick = (transcript: string, age: string) => selectMissingModifiers({
      pathway: 'abdominal_pain', level: 5, patient: { age, chief_complaint: 'abdominal pain' }, answers: {}, transcript, maxQuestions: 6,
    }).questions.map((q: { field: string }) => q.field);
    const withVomiting = pick('abdominal pain and vomiting', '4');
    const without = pick('abdominal pain since morning', '4');
    const adult = pick('abdominal pain and vomiting', '30');
    assert(withVomiting.includes('hydration_status') && !without.includes('hydration_status') && !adult.includes('hydration_status'),
      'CR-18', 'hydration question only for a child with vomiting/diarrhoea', JSON.stringify({ withVomiting, without, adult }));
    const lvl = (v: string) => applyModifierLibraryEffects({ hydration_status: v }, 5).level;
    assert(lvl('جفاف شديد / Severe') === 1 && lvl('جفاف متوسط / Moderate') === 2 && lvl('جفاف خفيف / Mild') === 3
      && lvl('لا جفاف مع استمرار الفقد / Potential') === 4 && lvl('غير معروف') === 5,
      'CR-19', 'dehydration grades: severe 1, moderate 2, mild 3, potential 4, unknown unchanged');
  }

  // Direction: "No" never applies a question's destination.
  {
    const no = applyModifierLibraryEffects({ recent_abdominal_surgery: 'لا' }, 5);
    const yes = applyModifierLibraryEffects({ recent_abdominal_surgery: 'نعم' }, 5);
    assert(no.direction_applied.length === 0 && yes.direction_applied.length === 1,
      'CR-20', '"No" to recent abdominal surgery does not change direction; "Yes" does',
      JSON.stringify({ no: no.direction_applied, yes: yes.direction_applied.map((d: { destination_hint: string }) => d.destination_hint) }));
  }

  // Dictation fills onset, medicines and history fields (3-year-old asthma case).
  {
    const t = 'مريضة عمرها ثلاث سنوات تشتكي من كحة وضيق في التنفس تعاني من ربو. المريضة تأخذ علاجات مزمنة. بلميكورت وفنتولين الأعراض بدأت من يومين';
    const u = mapSttSessionToPatientUpdates(extractFieldsFromTranscript(t)).updates as Record<string, string>;
    const cd = buildCaseDetails(t);
    assert(/يومين/.test(String(u.onset_duration || '')), 'CR-21', 'Arabic onset "بدأت من يومين" fills the onset field', JSON.stringify(u.onset_duration));
    assert(cd.drug_classes.includes('bronchodilator') && cd.drug_classes.includes('inhaled_steroid'),
      'CR-22', 'asthma medicines are recognised (Ventolin, Pulmicort)', JSON.stringify(cd.medications));
    const e = mapSttSessionToPatientUpdates(extractFieldsFromTranscript('cough for 3 days, history of asthma, takes salbutamol and montelukast, allergic to penicillin')).updates as Record<string, string>;
    assert(/3 days/.test(String(e.onset_duration)) && /salbutamol/.test(String(e.current_medications)) && /asthma/.test(String(e.relevant_history)),
      'CR-23', 'English onset, medicines and history are copied to the form', JSON.stringify(e));
    const a = mapSttSessionToPatientUpdates(extractFieldsFromTranscript('عمره خمس سنوات، حرارة من البارحة')).updates as Record<string, string>;
    assert(!/سنوات/.test(String(a.onset_duration || '')), 'CR-24', 'age ("five years") is not taken as onset', JSON.stringify(a.onset_duration));
  }
}
