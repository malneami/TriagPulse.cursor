/**
 * Chronic illness + presenting problem rules (escalate-only), bedside test extraction,
 * the paediatric hydration question and direction effects of "No" answers.
 */
import { buildCaseDetails } from './caseDetails.js';
import { evaluateComorbidityRules, extractBedsideTests } from './comorbidityRules.js';
import { applyModifierLibraryEffects } from './modifierLibrary.js';
import { selectMissingModifiers } from './modifierEngine.js';
import { extractFieldsFromTranscript, mapSttSessionToPatientUpdates, findVitalConflicts, normalizeSpokenNumbers } from '../stt/extractFields.js';
import { evaluateModifierEngine, detectKnownModifier } from './modifierEngine.js';
import { buildKnownFacts } from './knownFactsEngine.js';
import { getActiveModifiers } from './modifierLibrary.js';
import { resolveClinicalPathway } from './resolveClinicalPathway.js';

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

  // Arabic numbers said one after another are separate numbers.
  {
    const n = (t: string) => normalizeSpokenNumbers(t);
    assert(n('الأكسجين أربعة وتسعين سبعة وتسعين') === 'الأكسجين 94 97' && n('الوعي خمسة عشر') === 'الوعي 15'
      && n('مئة وأربعين على تسعين') === '140 على 90' && n('الوعي خمسة عشر، الألم صفر') === 'الوعي 15، الألم 0' && n('الوزن سبعتعشر') === 'الوزن 17' && n('ثلاث مية') === '300',
      'CR-25', 'Arabic: 94 then 97 (not 191); teens, hundreds and colloquial teens', JSON.stringify([n('الأكسجين أربعة وتسعين سبعة وتسعين'), n('الوزن سبعتعشر')]));
  }
  // Two different readings for one vital are flagged for the nurse to confirm.
  {
    const a = findVitalConflicts('الأكسجين أربعة وتسعين سبعة وتسعين. الأكسجين سبعة وتسعين تنفس ثلاثين');
    const b = findVitalConflicts('HR 110, BP 120/80, later pulse 128 and BP 100/60');
    const c = findVitalConflicts('HR 110, SpO2 98, RR 20, BP 120/80, then heart rate 110 again');
    assert(a.length === 1 && a[0].field === 'spo2' && a[0].values.join() === '94,97'
      && b.map((x) => x.field).sort().join() === 'bp,hr' && c.length === 0,
      'CR-26', 'conflicting readings are detected (repeat of the same value is not a conflict)', JSON.stringify({ a, b, c }));
  }
  // Child with a breathing complaint: respiratory distress grade is asked and graded.
  {
    const q = selectMissingModifiers({ pathway: 'shortness_of_breath', level: 4, patient: { age: '3', chief_complaint: 'SOB' }, answers: {}, transcript: 'cough and shortness of breath', maxQuestions: 4 })
      .questions.map((x: { field: string }) => x.field);
    const adult = selectMissingModifiers({ pathway: 'shortness_of_breath', level: 4, patient: { age: '30', chief_complaint: 'SOB' }, answers: {}, transcript: 'shortness of breath', maxQuestions: 6 })
      .questions.map((x: { field: string }) => x.field);
    assert(q.includes('resp_distress_grade') && !adult.includes('resp_distress_grade'), 'CR-27', 'distress grade asked for a child with SOB, not an adult', JSON.stringify({ q, adult }));
    const lvl = (v: string) => applyModifierLibraryEffects({ resp_distress_grade: v }, 4).level;
    assert(lvl('شديدة / Severe') === 1 && lvl('متوسطة / Moderate') === 2 && lvl('خفيفة / Mild') === 3 && lvl('لا توجد / None') === 4,
      'CR-28', 'distress grades: severe 1, moderate 2, mild 3, none unchanged');
  }
  // A critical question that is only being asked does not raise the critical banner.
  {
    const e = evaluateModifierEngine({ patient: { age: '4', chief_complaint: 'abdominal pain', pain_score: 3, hr: '120', bp_systolic: '110', spo2: '99', rr: '20', temperature: '36', gcs: '15' },
      answers: {}, transcript: 'abdominal pain and vomiting', pathway: 'abdominal_pain', initialLevel: 5, maxQuestions: 3 }) as unknown as { critical_alert: boolean, critical_question_pending: boolean };
    const yes = evaluateModifierEngine({ patient: { age: '4', chief_complaint: 'abdominal pain', pain_score: 3, hr: '120', bp_systolic: '110', spo2: '99', rr: '20', temperature: '36', gcs: '15' },
      answers: { rigidity_guarding: 'نعم' }, transcript: 'abdominal pain and vomiting', pathway: 'abdominal_pain', initialLevel: 5, maxQuestions: 3 }) as unknown as { updated_ctas: number };
    // After "Yes" the level rises to CTAS 2, which shows the red banner on the screen.
    assert(!e.critical_alert && e.critical_question_pending && yes.updated_ctas <= 2, 'CR-29', 'no critical banner while the question is pending; "Yes" escalates to CTAS 2',
      JSON.stringify({ pending: e.critical_alert, flag: e.critical_question_pending, yes: yes.updated_ctas }));
  }

  // Negation must be a whole word close to the finding ("known" is not "no").
  {
    const mod = getActiveModifiers().find((m: { field: string }) => m.field === 'stridor');
    const st = (t: string) => (buildKnownFacts({ patient: {}, answers: {}, transcript: t, modifiers: [mod] }) as Record<string, { value?: string }>).stridor?.value ?? null;
    const det = (t: string) => detectKnownModifier(mod, { patient: {}, answers: {}, transcript: t }).value ?? null;
    const cases: Array<[string, string | null]> = [
      ['known asthmatic, has stridor', 'نعم'],
      ['no stridor', 'لا'],
      ['denies any stridor', 'لا'],
      ['الاسهال مع صرير', 'نعم'],
      ['لا يوجد استرايدر', 'لا'],
      ['عنده سترايدر', 'نعم'],
      ['no fever. stridor present', 'نعم'],
      ['noisy breathing', 'نعم'],
    ];
    const bad = cases.filter(([t, want]) => st(t) !== want || det(t) !== want).map(([t, want]) => `${t}: want ${want}, got ${st(t)}/${det(t)}`);
    assert(bad.length === 0, 'CR-30', 'stridor stated vs denied is read correctly (no "no" inside "known", no «لا» inside words)', bad.join('; '));
  }
  // Age phrasing without "old" / «عمر».
  {
    const age = (t: string) => (mapSttSessionToPatientUpdates(extractFieldsFromTranscript(t)).updates as Record<string, string>).age;
    assert(age('child 3 years with cough') === '3' && age('girl aged 5 yrs') === '5' && age('طفل 4 سنوات عنده حرارة') === '4',
      'CR-31', 'age from "child 3 years", "aged 5 yrs", «طفل 4 سنوات»', JSON.stringify([age('child 3 years with cough'), age('girl aged 5 yrs'), age('طفل 4 سنوات عنده حرارة')]));
  }

  {
    const mod = getActiveModifiers().find((m: { field: string }) => m.field === 'prior_cardiac_history');
    const v = (t: string) => (mod ? detectKnownModifier(mod, { patient: {}, answers: {}, transcript: t }).value ?? null : 'missing');
    assert(v('chest pain non cardiac') === 'لا' && v('non-cardiac chest pain') === 'لا',
      'CR-32', '"non cardiac" / "non-cardiac" negate a cardiac finding', JSON.stringify([v('chest pain non cardiac'), v('non-cardiac chest pain')]));
  }

  // Safety findings count whatever the complaint is (approved 2026-10-16).
  {
    const sel = (age: string, cc: string, pathway: string, t: string) => selectMissingModifiers({
      pathway, level: 4, patient: { age, chief_complaint: cc, transcription: t }, answers: {}, transcript: t, maxQuestions: 3,
    }) as { autoAnswers: Record<string, unknown>; questions: Array<{ field: string }> };
    const a = sel('3', 'cough', 'general', 'child 3 years, cough. now stridor at rest and severe retractions');
    assert(a.autoAnswers.stridor === 'نعم' && applyModifierLibraryEffects({ stridor: 'نعم' }, 5).level === 1
      && a.questions.some((q) => q.field === 'resp_distress_grade'),
      'CR-33', 'stridor said with a cough complaint → stridor Yes (CTAS 1) and the distress grade is asked', JSON.stringify(a.autoAnswers));
    const b = sel('3', 'cough', 'general', 'child 3 years, cough, no stridor');
    assert(b.autoAnswers.stridor === 'لا', 'CR-34', '"no stridor" with a cough complaint stays No', JSON.stringify(b.autoAnswers));
    const c = sel('40', 'abdominal pain', 'abdominal_pain', 'abdominal pain, heavy bleeding per rectum');
    assert(c.autoAnswers.uncontrolled_bleeding === 'نعم', 'CR-35', 'heavy bleeding counts with an abdominal-pain complaint', JSON.stringify(c.autoAnswers));
    const d = sel('40', 'abdominal pain', 'abdominal_pain', 'abdominal pain, had a seizure in the waiting area');
    assert(d.autoAnswers.ongoing_seizure == null && d.questions[0]?.field === 'ongoing_seizure',
      'CR-36', 'a seizure mentioned with another complaint asks ongoing / post-ictal / resolved (not guessed)', JSON.stringify({ auto: d.autoAnswers, q: d.questions.map((q) => q.field) }));
    const e = sel('30', 'seizure', 'seizure', 'seizure at home, now drowsy');
    assert(e.autoAnswers.ongoing_seizure == null && e.questions.some((q) => q.field === 'ongoing_seizure'),
      'CR-37', 'the word "seizure" no longer silently answers the seizure-status question', JSON.stringify(e.autoAnswers));
    const f = sel('8', 'ضيق تنفس', 'shortness_of_breath', 'طفل 8 سنوات عنده نوبة ربو وكتمة');
    assert(!f.questions.some((q) => q.field === 'ongoing_seizure'), 'CR-38', '«نوبة ربو» (asthma attack) is not a seizure');
    const g = sel('2', 'حرارة', 'fever', 'طفل عمره سنتين حرارة وعنده صرير');
    assert(g.autoAnswers.stridor === 'نعم', 'CR-39', '«صرير» with a fever complaint counts', JSON.stringify(g.autoAnswers));
  }

  {
    const age = (t: string) => (mapSttSessionToPatientUpdates(extractFieldsFromTranscript(t)).updates as Record<string, string>).age;
    const got = ['طفل عمره سنتين، عنده حرارة', 'طفل عمره سنة، عنده كحة', 'عمره سنة و نص', 'منذ سنة يعاني من الربو، عمره 40 سنة'].map(age);
    assert(JSON.stringify(got) === JSON.stringify(['2', '1', '1.5', '40']), 'CR-40', 'Arabic «سنتين» / «سنة» / «سنة و نص» ages', JSON.stringify(got));
  }

  // The wound case (2026-10-16): uncontrolled bleeding in Arabic/English, contradictions, «درجة الحرارة».
  {
    const sel = (t: string) => selectMissingModifiers({
      pathway: 'general', level: 4, patient: { age: '5', chief_complaint: 'Bleeding', transcription: t }, answers: {}, transcript: t, maxQuestions: 3,
    }) as { autoAnswers: Record<string, unknown>; questions: Array<{ field: string }> };
    const last = 'خمس سنوات يشتكي من جرح في القدم مع نزيف النزيف لا يتوقف. ييرجد أنه لا يمكن التحكم فيه. Bleeding huge and uncontrolled';
    assert(sel(last).autoAnswers.uncontrolled_bleeding === 'نعم' && applyModifierLibraryEffects({ uncontrolled_bleeding: 'نعم' }, 5).level === 2,
      'CR-41', '«النزيف لا يتوقف» / "bleeding huge and uncontrolled" → uncontrolled bleeding (CTAS 2)', JSON.stringify(sel(last).autoAnswers));
    const both = sel('wound in the foot, no bleeding. Patient still bleeding, needs suturing');
    assert(both.autoAnswers.uncontrolled_bleeding == null && both.questions[0]?.field === 'uncontrolled_bleeding',
      'CR-42', '"no bleeding … still bleeding" asks whether bleeding is controlled (not read as No)', JSON.stringify({ a: both.autoAnswers, q: both.questions.map((q) => q.field) }));
    const mod = getActiveModifiers().find((m: { field: string }) => m.field === 'uncontrolled_bleeding');
    const v = (t: string) => detectKnownModifier(mod, { patient: {}, answers: {}, transcript: t }).value ?? null;
    assert(v('الألم لا يمكن التحكم فيه') == null && v('bleeding stopped with pressure') == null && v('no active bleeding') === 'لا',
      'CR-43', 'uncontrolled pain, stopped bleeding and "no active bleeding" are not uncontrolled bleeding', JSON.stringify([v('الألم لا يمكن التحكم فيه'), v('bleeding stopped with pressure'), v('no active bleeding')]));
    const pw = (t: string) => resolveClinicalPathway({ patient: { chief_complaint: '' }, transcript: t }).pathway;
    assert(pw('جرح، درجة الحرارة 36') !== 'fever' && pw('عنده حرارة من يومين') === 'fever',
      'CR-44', '«درجة الحرارة ٣٦» (a reading) is not a fever complaint; «عنده حرارة» is', JSON.stringify([pw('جرح، درجة الحرارة 36'), pw('عنده حرارة من يومين')]));
  }
}
