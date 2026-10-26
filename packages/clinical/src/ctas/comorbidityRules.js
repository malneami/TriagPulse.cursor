/**
 * Chronic illness + presenting problem → CTAS floor (escalate-only).
 *
 * Clinically approved rule table (TriagePulse clinical lead, 2026-10-15). A rule
 * applies only when the illness was stated in the conversation (or a probable one
 * was confirmed by the nurse) AND its trigger is present. It can only raise acuity:
 * the nurse may still go lower through «Change» with a documented reason.
 *
 * Some rules require a bedside check (capillary glucose, ketones, SpO₂). Until the
 * check is recorded the screen shows «at least CTAS n» and prompts for it.
 */
import { getAgeGroup, isPediatricAgeGroup, getNorms } from './ageNorms.js';

export const COMORBIDITY_RULES_VERSION = '1.1.0';
const YES = 'نعم';
const YES_RE = /^(نعم|yes|true|1)$/i;

/** Glucose above this (mmol/L) in a diabetic child with symptoms → CTAS 2 (CTAS hyperglycaemia modifier). */
export const GLUCOSE_HIGH_MMOL = 14;

const PAIN_KEYS = new Set([
  'chest_pain_cardiac', 'chest_pain_non_cardiac', 'abdominal_pain', 'back_pain', 'headache',
  'upper_extremity_injury', 'lower_extremity_injury', 'traumatic_back_spine', 'uti',
]);
const CHEST_KEYS = new Set(['chest_pain_cardiac', 'chest_pain_non_cardiac', 'shortness_of_breath', 'wheezing', 'stridor_resp', 'urti_complaints']);
const BREATHLESS_KEYS = new Set(['shortness_of_breath', 'wheezing', 'stridor_resp', 'respiratory_arrest']);
const BLEEDING_KEYS = new Set(['epistaxis', 'vaginal_bleed', 'blood_in_stools', 'laceration', 'multisystem_trauma_blunt', 'multisystem_trauma_penetrating', 'amputation']);
const DROWSY_KEYS = new Set(['altered_loc', 'confusion', 'seizure']);

const CUES = {
  lethargy: /letharg\w*|drows\w*|sleepy|floppy|not (?:himself|herself)|خمول|خامل|نعسان|نعسانة|كسل|مرتخي|ارتخاء/i,
  poorFeeding: /poor (?:feeding|oral intake)|not (?:feeding|eating|drinking)|refus\w* (?:feeds?|to (?:eat|drink))|ما\s*(?:ياكل|يأكل|يرضع|يشرب)|رفض\s*(?:الأكل|الرضاعة)|قلة\s*(?:الأكل|الرضاعة)/i,
  cyanosis: /cyano\w*|blue (?:lips|colour|color)|turn(?:ed|s|ing)? blue|ازرقاق|مزرق/i,
  bleeding: /bleed\w*|haemorrhag\w*|hemorrhag\w*|blood (?:in|from)|haematemesis|hematemesis|نزيف|ينزف|دم\s*(?:من|في)/i,
  palpitations: /palpitation\w*|خفقان/i,
  weakness: /weak(?:ness)?|fatigue|tired|ضعف|إرهاق|تعب/i,
  breathless: /short(?:ness)? of breath|breathless|difficulty breathing|tachypn\w*|fast breathing|ضيق\s*(?:في\s*)?(?:ال)?تنفس|صعوبة\s*(?:في\s*)?(?:ال)?تنفس|نهجان|تنفس\s*سريع/i,
  headache: /headache|head pain|صداع/i,
  vomiting: /vomit\w*|قيء|استفراغ|ترجيع/i,
  diarrhoea: /diarrh\w*|loose stools?|إسهال|اسهال/i,
  // Cyanosis that is NEW or WORSE than usual (the word "cyanotic" in the history is not a trigger).
  newCyanosis: /(?:more|increas\w*|worse|new|bluer)\s+(?:cyano\w*|blue)|blue spell|tet spell|turn(?:ed|s|ing)? (?:more )?blue|زاد\s*(?:ال)?ازرقاق|ازرقاق\s*(?:أكثر|زايد|جديد)|نوبة\s*ازرقاق/i,
  notUsual: /not (?:his|her|their) usual(?: self)?|different from (?:his|her|their )?usual|not (?:him|her)self|مو\s*(?:زي|مثل)\s*عادت(?:ه|ها)|غير\s*(?:طبيعته|طبيعتها|المعتاد)|مو\s*طبيعي/i,
  emergencyLetter: /emergency (?:letter|protocol|plan|card)|protocol letter|care plan|رسالة\s*طوارئ|خطة\s*طوارئ|بطاقة\s*طوارئ/i,
  secretions: /secretion\w*|blocked tube|tube (?:out|dislodged|displaced)|إفرازات|انسداد\s*(?:ال)?أنبوب/i,
};

const num = (v) => {
  const n = parseFloat(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};

/**
 * What the rules look at, gathered once.
 * @param {{ patient?: any, caseDetails?: any, answers?: any, transcript?: string }} input
 */
function context({ patient = {}, caseDetails = null, answers = {}, transcript = '' }) {
  const ageGroup = getAgeGroup(patient.age);
  const pediatric = patient.age !== '' && patient.age != null && isPediatricAgeGroup(ageGroup);
  const complaints = (caseDetails?.complaints || []).map((c) => c.key).filter(Boolean);
  const keys = new Set(complaints);
  if (patient.confirmed_complaint_key) keys.add(patient.confirmed_complaint_key);
  const text = [transcript, patient.transcription, patient.chief_complaint].filter(Boolean).join(' \n ');
  const temp = num(patient.temperature);
  const rr = num(patient.rr);
  const norms = getNorms(ageGroup);

  const confirmed = (id) => answers?.[`confirm_condition_${id}`] === YES;
  const conditionStatus = new Map();
  for (const c of caseDetails?.conditions || []) {
    if (c.status === 'present' || (c.status === 'probable' && confirmed(c.id))) conditionStatus.set(c.id, c);
  }
  const drugClasses = new Set(caseDetails?.drug_classes || (caseDetails?.medications || []).flatMap((m) => m.classes || []));

  return {
    patient, answers, pediatric, keys, text,
    has: (id) => conditionStatus.has(id),
    condition: (id) => conditionStatus.get(id) || null,
    drug: (cls) => drugClasses.has(cls),
    any: (set) => [...keys].some((k) => set.has(k)),
    cue: (name) => CUES[name].test(text),
    fever: keys.has('fever') || (temp != null && temp >= 38),
    fastBreathing: rr != null && norms?.RR?.high != null && rr > norms.RR.high,
    painScore: num(patient.pain_score),
    anyComplaint: keys.size > 0 || !!patient.chief_complaint,
    glucose: num(patient.glucose),
    spo2: num(patient.spo2),
    cyanotic: /cyanotic|fontan|glenn|norwood|single ventricle|hlhs|hypoplastic left|\bbt shunt|blalock|sano|قلب\s*أزرق/i.test(text)
      || (num(patient.baseline_spo2 ?? answers.baseline_spo2) ?? 100) < 95,
    complex: ['genetic_syndrome', 'cerebral_palsy', 'tracheostomy', 'home_ventilation', 'gastrostomy'].some((id) => conditionStatus.has(id)),
    ketones: patient.ketones === 'positive' ? 'positive' : patient.ketones === 'negative' ? 'negative' : null,
  };
}

const CHECKS = {
  glucose: { key: 'glucose', ar: 'سكر الدم الشعري', en: 'Capillary glucose' },
  ketones: { key: 'ketones', ar: 'الكيتونات', en: 'Ketones' },
  spo2: { key: 'spo2', ar: 'تشبع الأكسجين مقارنة بالمعتاد', en: 'SpO₂ against the usual baseline' },
};

/**
 * The approved rule table. `when` returns the trigger text (truthy) or null.
 * `floor` may be a function of the context (e.g. glucose result).
 */
export const COMORBIDITY_RULES = [
  {
    id: 'CR-DM-PED',
    condition: 'diabetes',
    label_ar: 'سكري لدى طفل', label_en: 'Diabetes in a child',
    when: (c) => {
      if (!c.pediatric || !c.has('diabetes')) return null;
      if (c.keys.has('vomiting_nausea') || c.cue('vomiting')) return { ar: 'قيء', en: 'vomiting' };
      if (c.keys.has('abdominal_pain')) return { ar: 'ألم بطن', en: 'abdominal pain' };
      if (c.keys.has('hyperglycemia')) return { ar: 'ارتفاع السكر', en: 'high glucose' };
      if (c.any(DROWSY_KEYS) || c.keys.has('general_weakness') || c.cue('lethargy')) return { ar: 'خمول', en: 'lethargy' };
      if (c.fastBreathing || c.cue('breathless')) return { ar: 'تنفس سريع', en: 'fast breathing' };
      return null;
    },
    requires: ['glucose', 'ketones'],
    // CTAS 2016 «Congenital problem in children»: vomiting/diarrhoea with type 1 diabetes → CTAS 2.
    floor: (c) => ((c.keys.has('vomiting_nausea') || c.cue('vomiting') || c.cue('diarrhoea')
      || (c.glucose != null && c.glucose > GLUCOSE_HIGH_MMOL) || c.ketones === 'positive') ? 2 : 3),
    note: (c) => ((c.keys.has('vomiting_nausea') || c.cue('vomiting') || c.cue('diarrhoea'))
      ? { ar: 'قيء/إسهال مع سكري (CTAS 2016) — افحص السكر والكيتونات', en: 'Vomiting/diarrhoea with diabetes (CTAS 2016) — check glucose and ketones' }
      : (c.glucose != null && c.glucose > GLUCOSE_HIGH_MMOL) || c.ketones === 'positive'
      ? { ar: 'خطر الحماض الكيتوني: سكر > 14 أو كيتونات إيجابية', en: 'DKA risk: glucose > 14 or ketones positive' }
      : { ar: 'افحص السكر والكيتونات — يصبح CTAS 2 إذا كان السكر > 14 أو الكيتونات إيجابية', en: 'Check glucose and ketones — CTAS 2 if glucose > 14 or ketones positive' }),
  },
  {
    id: 'CR-SCD',
    condition: 'sickle_cell',
    label_ar: 'فقر الدم المنجلي', label_en: 'Sickle cell disease',
    when: (c) => {
      if (!c.has('sickle_cell')) return null;
      if (c.fever) return { ar: 'حمى', en: 'fever' };
      if (c.any(CHEST_KEYS) || c.cue('breathless')) return { ar: 'أعراض صدرية / ضيق تنفس', en: 'chest symptoms / breathlessness' };
      if (c.any(PAIN_KEYS) || (c.painScore != null && c.painScore >= 4)) return { ar: 'ألم', en: 'pain' };
      return null;
    },
    floor: 2,
  },
  {
    id: 'CR-IMMUNO',
    condition: 'immunocompromised',
    label_ar: 'ضعف المناعة / علاج كيميائي / زراعة', label_en: 'Immunocompromised / chemotherapy / transplant',
    when: (c) => ((c.has('immunocompromised') || (c.has('cancer') && c.drug('immunosuppressant'))) && c.fever
      ? { ar: 'حمى', en: 'fever' } : null),
    floor: 2,
  },
  {
    id: 'CR-ANTICOAG',
    condition: 'anticoagulant',
    label_ar: 'مميّع دم', label_en: 'On a blood thinner',
    when: (c) => {
      if (!c.drug('anticoagulant')) return null;
      if (c.keys.has('head_injury')) return { ar: 'إصابة رأس', en: 'head injury' };
      if (c.any(BLEEDING_KEYS) || c.cue('bleeding')) return { ar: 'نزيف', en: 'active bleeding' };
      return null;
    },
    floor: 2,
  },
  {
    id: 'CR-VPS',
    condition: 'vp_shunt',
    label_ar: 'صمام دماغي', label_en: 'VP shunt',
    when: (c) => {
      if (!c.has('vp_shunt')) return null;
      if (c.fever) return { ar: 'حمى', en: 'fever' };
      if (c.keys.has('headache') || c.cue('headache')) return { ar: 'صداع', en: 'headache' };
      if (c.keys.has('vomiting_nausea') || c.cue('vomiting')) return { ar: 'قيء', en: 'vomiting' };
      if (c.any(DROWSY_KEYS) || c.cue('lethargy')) return { ar: 'نعاس / خمول', en: 'drowsiness' };
      return null;
    },
    floor: 2,
  },
  {
    id: 'CR-METABOLIC',
    condition: 'metabolic_disorder',
    label_ar: 'اضطراب استقلابي / قصور الكظرية', label_en: 'Metabolic disorder / adrenal insufficiency',
    when: (c) => {
      if (!c.has('metabolic_disorder') && !c.has('adrenal_insufficiency')) return null;
      // CTAS 2016 + BIMDG: vomiting/diarrhoea, poor intake, lethargy, fever or an emergency letter → 2.
      // A minor unrelated problem in a child who is eating and alert is NOT upgraded.
      if (c.keys.has('vomiting_nausea') || c.cue('vomiting')) return { ar: 'قيء', en: 'vomiting' };
      if (c.keys.has('diarrhea') || c.cue('diarrhoea')) return { ar: 'إسهال', en: 'diarrhoea' };
      if (c.cue('poorFeeding')) return { ar: 'قلة الرضاعة / الأكل', en: 'poor feeding' };
      if (c.any(DROWSY_KEYS) || c.cue('lethargy')) return { ar: 'خمول / نعاس', en: 'lethargy' };
      if (c.fever) return { ar: 'حمى', en: 'fever' };
      if (c.cue('emergencyLetter')) return { ar: 'رسالة طوارئ', en: 'emergency letter' };
      // BIMDG: any infection can trigger a metabolic crisis → at least CTAS 3 (approved 2026-10-26).
      if (c.keys.has('urti_complaints') || c.keys.has('sore_throat') || c.keys.has('ear_pain') || c.keys.has('uti')
        || /cough|runny nose|coryza|\bcold\b|sore throat|ear (?:pain|ache|infection)|\burti\b|infection|كحة|سعال|زكام|رشح|التهاب/i.test(c.text)) {
        return { ar: 'عدوى', en: 'infection', floor: 3 };
      }
      return null;
    },
    requires: ['glucose'],
    floor: 2,
    note: (c) => (c.has('adrenal_insufficiency')
      ? { ar: 'قصور الكظرية: جرعة الهيدروكورتيزون الطارئة مستحقة — لا تؤخرها', en: 'Adrenal insufficiency: emergency hydrocortisone is due — do not delay' }
      : { ar: 'لا تنتظر نتيجة السكر؛ نقص السكر علامة متأخرة. اطلب رسالة الطوارئ', en: 'Do not wait for glucose (low glucose is a late sign). Ask for the emergency letter' }),
  },
  {
    id: 'CR-CHD',
    condition: 'congenital_heart',
    label_ar: 'مرض قلب خلقي', label_en: 'Congenital heart disease',
    when: (c) => {
      if (!c.has('congenital_heart')) return null;
      if (c.any(BREATHLESS_KEYS) || c.cue('breathless') || c.fastBreathing) return { ar: 'ضيق تنفس', en: 'breathlessness' };
      if (c.cue('newCyanosis')) return { ar: 'ازرقاق جديد أو أشد', en: 'new or worse cyanosis' };
      if (c.fever) return { ar: 'حمى', en: 'fever' };
      if (c.cyanotic) {
        // Cyanotic / single-ventricle physiology (local HMG rule, expert-based): dehydration is dangerous.
        if (c.keys.has('vomiting_nausea') || c.cue('vomiting')) return { ar: 'قيء', en: 'vomiting' };
        if (c.keys.has('diarrhea') || c.cue('diarrhoea')) return { ar: 'إسهال', en: 'diarrhoea' };
        if (c.cue('poorFeeding')) return { ar: 'قلة الأكل / الرضاعة', en: 'poor feeding' };
        if (c.cue('lethargy')) return { ar: 'خمول', en: 'lethargy' };
        if (c.anyComplaint) return { ar: 'مرض حاد', en: 'acute illness', floor: 3 };
      }
      return null;
    },
    requires: ['spo2'],
    floor: 2,
  },
  {
    id: 'CR-AIRWAY-DEVICE',
    condition: 'tracheostomy',
    label_ar: 'فغر رغامى / تنفس صناعي منزلي', label_en: 'Tracheostomy / home ventilation',
    // APAGBI/NTSP 2018: a blocked or displaced tube is a time-critical emergency.
    when: (c) => {
      if (!c.has('tracheostomy') && !c.has('home_ventilation')) return null;
      if (c.any(BREATHLESS_KEYS) || c.cue('breathless') || c.fastBreathing) return { ar: 'ضيق تنفس', en: 'breathing difficulty' };
      if (c.cue('secretions')) return { ar: 'إفرازات / مشكلة بالأنبوب', en: 'secretions / tube problem' };
      if (c.keys.has('urti_complaints') || /cough|كحة|سعال/i.test(c.text)) return { ar: 'سعال', en: 'cough' };
      if (c.spo2 != null && c.spo2 < 95) return { ar: 'نقص الأكسجين', en: 'low SpO₂' };
      return null;
    },
    floor: 2,
  },
  {
    id: 'CR-COMPLEX',
    condition: 'medical_complexity',
    label_ar: 'طفل ذو احتياجات طبية معقدة', label_en: 'Child with medical complexity',
    // CTAS 2016: «Caregivers identifying need for care» → CTAS 3.
    when: (c) => {
      if (!c.complex) return null;
      if (YES_RE.test(String(c.answers.different_from_usual ?? '')) || c.cue('notUsual')) {
        return { ar: 'الأهل: ليس كعادته', en: 'parents: not their usual self' };
      }
      return null;
    },
    floor: 3,
  },
  {
    id: 'CR-DIALYSIS',
    condition: 'kidney_disease',
    label_ar: 'غسيل كلى', label_en: 'Dialysis',
    when: (c) => {
      const kd = c.condition('kidney_disease');
      if (!kd || !/dialys|غسيل/i.test(`${kd.evidence || ''} ${c.text}`)) return null;
      if (c.keys.has('general_weakness') || c.cue('weakness')) return { ar: 'ضعف', en: 'weakness' };
      if (c.any(BREATHLESS_KEYS) || c.cue('breathless')) return { ar: 'ضيق تنفس', en: 'breathlessness' };
      if (c.keys.has('palpitations') || c.cue('palpitations')) return { ar: 'خفقان', en: 'palpitations' };
      return null;
    },
    floor: 2,
  },
];

/** Conditions that can trigger a rule; a "probable" one needs the nurse to confirm it first. */
const RULE_CONDITIONS = new Set(['diabetes', 'sickle_cell', 'immunocompromised', 'vp_shunt', 'metabolic_disorder', 'adrenal_insufficiency', 'congenital_heart', 'kidney_disease', 'tracheostomy', 'home_ventilation', 'genetic_syndrome', 'cerebral_palsy', 'gastrostomy']);

/**
 * Evaluate the rule table.
 * @param {{ patient?: any, caseDetails?: any, answers?: any, transcript?: string }} input
 * @returns {{
 *   version: string,
 *   applied: Array<{ id: string, version: string, condition: string, label_ar: string, label_en: string, trigger_ar: string, trigger_en: string, floor: number, note_ar?: string, note_en?: string }>,
 *   floor: number|null,
 *   required: Array<{ key: string, ar: string, en: string, done: boolean, rule: string }>,
 *   pendingChecks: Array<{ key: string, ar: string, en: string, rule: string }>,
 *   confirmQuestions: Array<Record<string, any>>,
 * }}
 */
export function evaluateComorbidityRules(input = {}) {
  const c = context(input);
  const applied = [];
  const required = [];
  for (const rule of COMORBIDITY_RULES) {
    const trigger = rule.when(c);
    if (!trigger) continue;
    const floor = trigger.floor ?? (typeof rule.floor === 'function' ? rule.floor(c) : rule.floor);
    const note = rule.note ? rule.note(c) : null;
    applied.push({
      id: rule.id,
      version: COMORBIDITY_RULES_VERSION,
      condition: rule.condition,
      label_ar: rule.label_ar,
      label_en: rule.label_en,
      trigger_ar: trigger.ar,
      trigger_en: trigger.en,
      floor,
      ...(note ? { note_ar: note.ar, note_en: note.en } : {}),
    });
    for (const k of rule.requires || []) {
      if (required.some((r) => r.key === k)) continue;
      const done = k === 'glucose' ? c.glucose != null
        : k === 'ketones' ? c.ketones != null
          : num(c.patient.spo2) != null;
      required.push({ ...CHECKS[k], done, rule: rule.id });
    }
  }
  const floors = applied.map((a) => a.floor).filter((n) => n != null);

  // A condition known only from a medicine is confirmed by one question before any rule uses it.
  const confirmQuestions = (input.caseDetails?.conditions || [])
    .filter((x) => x.status === 'probable' && RULE_CONDITIONS.has(x.id) && !(input.answers || {})[`confirm_condition_${x.id}`])
    .map((x) => ({
      id: `confirm_condition_${x.id}`,
      field: `confirm_condition_${x.id}`,
      text_ar: `هل المريض مصاب بـ${x.label_ar}؟`,
      text_en: `Does the patient have ${String(x.label_en).toLowerCase()}?`,
      answer_type: 'yes_no',
      question_category: 'ctas_modifier',
      priority: 1,
      source: 'comorbidity_confirm',
      evidence: x.evidence,
    }));

  // Known chronic low oxygen with a low reading and no usual level yet: ask for it (rule A).
  const chronicLowO2 = c.cyanotic || ['copd', 'home_oxygen', 'interstitial_lung'].some((id) => c.has(id));
  const hasUsual = Number.isFinite(parseFloat(c.patient.baseline_spo2 ?? (input.answers || {}).baseline_spo2))
    || /(?:baseline|usual(?:ly)?|normally|runs? at|المعتاد|معتاد|عادة)[^\d]{0,30}\d{2}/i.test(c.text);
  if (chronicLowO2 && c.spo2 != null && c.spo2 < 95 && !hasUsual && (input.answers || {}).baseline_spo2 == null) {
    confirmQuestions.push({
      id: 'baseline_spo2', field: 'baseline_spo2',
      text_ar: 'ما تشبع الأكسجين المعتاد للمريض (حسب الأهل أو خطة الرعاية)؟',
      text_en: "Patient's usual SpO₂ (family or care plan)?",
      answer_type: 'options',
      options: [
        { value: '94', label_ar: '90–94', label_en: '90–94' },
        { value: '89', label_ar: '85–89', label_en: '85–89' },
        { value: '84', label_ar: '80–84', label_en: '80–84' },
        { value: '79', label_ar: '75–79', label_en: '75–79' },
        { value: '74', label_ar: '70–74', label_en: '70–74' },
        { value: 'unknown', label_ar: 'غير معروف', label_en: 'Unknown' },
      ],
      question_category: 'ctas_modifier', priority: 1, source: 'comorbidity_baseline_spo2',
      reason_en: 'Within 3 of usual → not new hypoxia; more than 3 below → CTAS 2; below 70 → CTAS 1. Unknown → standard cut-offs. (Top of the range is used, which errs towards urgency.)',
      reason_ar: 'ضمن 3 من المعتاد → ليس نقصاً جديداً؛ أقل بأكثر من 3 → CTAS 2؛ أقل من 70 → CTAS 1.',
    });
  }

  // Child with medical complexity: ask the family whether the child is different from usual.
  if (c.complex && c.pediatric && (input.answers || {}).different_from_usual == null && !c.cue('notUsual')) {
    confirmQuestions.push({
      id: 'different_from_usual', field: 'different_from_usual',
      text_ar: 'هل يقول الأهل إن الطفل مختلف عن حالته المعتادة؟', text_en: 'Do the parents say the child is different from their usual self?',
      answer_type: 'yes_no', question_category: 'ctas_modifier', priority: 1, source: 'comorbidity_complex',
    });
  }

  return {
    version: COMORBIDITY_RULES_VERSION,
    applied,
    floor: floors.length ? Math.min(...floors) : null,
    required,
    pendingChecks: required.filter((r) => !r.done).map(({ done, ...r }) => r),
    confirmQuestions,
  };
}

/**
 * Capillary glucose (mmol/L) and ketones from the dictation. mg/dL values are
 * converted (÷ 18). Returns nulls when not mentioned; never inferred.
 * @param {string} transcript
 */
export function extractBedsideTests(transcript) {
  const text = String(transcript || '');
  let glucose = null;
  const g = text.match(/(?:capillary\s+)?(?:blood\s+)?(?:glucose|sugar|\brbs\b|\bcbg\b|\bbg\b|\bbs\b|سكر(?:\s*الدم)?|السكر|الجلوكوز)\s*(?:level\s*)?(?:is|was|of|=|:)?\s*(\d{1,3}(?:[.,]\d)?)\s*(mmol(?:\/l)?|mg\s*\/?\s*dl|ملي\s*مول)?/i);
  if (g) {
    const v = parseFloat(g[1].replace(',', '.'));
    const unit = (g[2] || '').toLowerCase();
    const mgdl = /mg/.test(unit) || (!unit && v > 35);
    const mmol = mgdl ? Math.round((v / 18) * 10) / 10 : v;
    if (mmol > 0.5 && mmol < 60) glucose = { value: mmol, evidence: g[0].trim(), converted_from_mgdl: mgdl };
  }
  let ketones = null;
  const k = text.match(/(?:ketones?|ketonuria|كيتون(?:ات)?)\s*(?:is|are|were|:)?\s*(positive|negative|nil|trace|large|moderate|small|\+{1,4}|\d(?:[.,]\d)?|إيجابي(?:ة)?|سلبي(?:ة)?)/i);
  if (k) {
    const v = k[1].toLowerCase();
    const n = parseFloat(v.replace(',', '.'));
    const positive = /positive|large|moderate|small|\+|إيجابي/.test(v) || (Number.isFinite(n) && n >= 1.5);
    const negative = /negative|nil|سلبي/.test(v) || (Number.isFinite(n) && n < 0.6);
    if (positive || negative) ketones = { value: positive ? 'positive' : 'negative', evidence: k[0].trim() };
  }
  return { glucose, ketones };
}
