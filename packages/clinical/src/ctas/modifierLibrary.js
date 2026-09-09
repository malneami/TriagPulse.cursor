/**
 * Configurable CTAS Modifier Library — TriagePulse MVP.
 * Each modifier is optional clarification that may change CTAS, destination, or escalation.
 * Protocol source: CTAS 2025 Quick Look Booklet + ED operational modifiers.
 */
import { getRuntimeModifiers } from '../libraries/runtime.js';

/**
 * @typedef {'adult'|'pediatric'|'both'} AgeApplicability
 * @typedef {'yes_no'|'options'|'multiple_choice'} AnswerType
 * @typedef {'ctas_modifier'|'patient_direction'|'safety_escalation'} QuestionCategory
 * @typedef {{
 *   id: string,
 *   name: string,
 *   name_ar: string,
 *   pathways: string[],
 *   age_applicability: AgeApplicability,
 *   field: string,
 *   detect_patterns: RegExp[],
 *   related_medications?: RegExp[],
 *   question_ar: string,
 *   question_en: string,
 *   answer_type: AnswerType,
 *   options: Array<{ value: string, label_ar: string, label_en: string, ctas_effect?: number|null, destination_hint?: string|null }>,
 *   ctas_effect_yes?: number|null,
 *   destination_effect?: string|null,
 *   shown_when_ctas?: number[],
 *   critical_alert?: boolean,
 *   team_leader_review?: boolean,
 *   question_category: QuestionCategory,
 *   potential_ctas_effect?: number|null,
 *   potential_destination_effect?: string|null,
 *   safety_alert_effect?: boolean,
 *   clinical_explanation_ar: string,
 *   clinical_explanation_en: string,
 *   priority: number,
 *   active: boolean,
 *   protocol_source: string,
 *   version: string,
 *   review_date: string,
 * }} CtasModifier
 */

/** @type {CtasModifier[]} */
export const CTAS_MODIFIER_LIBRARY = [
  // ── Universal: return visit (Patient Direction — does NOT auto-raise CTAS) ─
  {
    id: 'mod_return_visit_72h',
    name: 'Return visit within 72 hours',
    name_ar: 'مراجعة خلال 72 ساعة',
    pathways: ['*'],
    age_applicability: 'both',
    field: 'return_visit_72h',
    detect_patterns: [
      /return(?:ed)?\s+(?:visit|within|in)\s*(?:the\s+)?(?:last\s+)?72/i,
      /revisited|came\s+back|second\s+visit|bounce\s*back/i,
      /(?:was|were)\s+here\s+(?:yesterday|two\s+days?\s+ago|a\s+couple\s+of\s+days)/i,
      /discharged\s+yesterday|came\s+back\s+because/i,
      /مراجعة\s*(?:خلال|في)?\s*72|عاد\s+(?:خلال|لنفس)|راجع\s+مرة\s+ثانية|زيارة\s+ثانية/i,
      /كنت\s+هنا\s+(?:أمس|قبل\s+يومين)|خرجت\s+أمس|راجعت\s+أمس/i,
    ],
    question_ar: 'هل راجع المريض قسم الطوارئ لنفس المشكلة خلال آخر 72 ساعة؟',
    question_en: 'Has the patient visited the Emergency Department for the same problem within the last 72 hours?',
    answer_type: 'yes_no',
    options: [
      { value: 'نعم', label_ar: 'نعم', label_en: 'Yes', destination_hint: 'ACUTE_CARE' },
      { value: 'لا', label_ar: 'لا', label_en: 'No' },
      { value: 'غير معروف', label_ar: 'غير معروف', label_en: 'Unknown' },
    ],
    ctas_effect_yes: null,
    destination_effect: 'ACUTE_CARE',
    critical_alert: false,
    team_leader_review: true,
    question_category: 'patient_direction',
    potential_ctas_effect: null,
    potential_destination_effect: 'ACUTE_CARE',
    safety_alert_effect: false,
    clinical_explanation_ar: 'مراجعة خلال 72 ساعة تتطلب مراجعة قائد الفريق وتوجيه الوجهة — دون رفع CTAS تلقائياً',
    clinical_explanation_en: 'Return visit within 72 hours requires team-leader review and destination guidance — does not automatically raise CTAS',
    priority: 45,
    active: true,
    protocol_source: 'CTAS 2025 + ED operations',
    version: '1.1.0',
    review_date: '2026-08-05',
  },

  // ── Chest pain ────────────────────────────────────────────────────────────
  {
    id: 'mod_cp_prior_cardiac',
    name: 'Prior cardiac disease or diabetes',
    name_ar: 'مرض قلبي سابق أو سكري',
    pathways: ['chest_pain_cardiac', 'chest_pain_non_cardiac', 'palpitations', 'chest_pain'],
    age_applicability: 'both',
    field: 'prior_cardiac_history',
    detect_patterns: [
      /\b(?:diabet\w*|cardiac|heart\s+disease|mi|cabg|stent|acs)\b/i,
      /سكري|مرض\s*قلب|قلب\s*سابق|دعامة|جلطة\s*قلب/i,
    ],
    related_medications: [/insulin|metformin|aspirin|clopidogrel|atorvastatin|إنسولين|متفورمين|أسبرين/i],
    question_ar: 'هل لدى المريض تاريخ مرض قلبي أو سكري؟',
    question_en: 'Does the patient have a history of heart disease or diabetes?',
    answer_type: 'yes_no',
    options: [
      { value: 'نعم', label_ar: 'نعم', label_en: 'Yes', ctas_effect: 2 },
      { value: 'لا', label_ar: 'لا', label_en: 'No' },
      { value: 'غير معروف', label_ar: 'غير معروف', label_en: 'Unknown' },
    ],
    ctas_effect_yes: 2,
    clinical_explanation_ar: 'تاريخ قلبي/سكري مع ألم صدر يرفع خطر ACS → CTAS 2',
    clinical_explanation_en: 'Cardiac history/diabetes with chest pain raises ACS risk → CTAS 2',
    priority: 20,
    active: true,
    protocol_source: 'CTAS 2025 Cardiovascular',
    version: '1.0.0',
    review_date: '2026-08-05',
  },
  {
    id: 'mod_cp_radiation',
    name: 'Pain radiation',
    name_ar: 'إشعاع الألم',
    pathways: ['chest_pain_cardiac', 'chest_pain_non_cardiac', 'chest_pain'],
    age_applicability: 'both',
    field: 'radiation',
    detect_patterns: [
      /radiat\w*|to\s+(?:the\s+)?(?:jaw|arm|shoulder|back)/i,
      /يمتد|إشعاع|للكتف|للفك|للذراع/i,
    ],
    question_ar: 'هل يمتد الألم إلى الكتف أو الفك أو الذراع؟',
    question_en: 'Does the pain radiate to shoulder, jaw, or arm?',
    answer_type: 'yes_no',
    options: [
      { value: 'نعم', label_ar: 'نعم', label_en: 'Yes', ctas_effect: 2 },
      { value: 'لا', label_ar: 'لا', label_en: 'No' },
      { value: 'غير معروف', label_ar: 'غير معروف', label_en: 'Unknown' },
    ],
    ctas_effect_yes: 2,
    clinical_explanation_ar: 'إشعاع الألم يرفع اشتباه قلبي → CTAS 2',
    clinical_explanation_en: 'Pain radiation raises cardiac concern → CTAS 2',
    priority: 15,
    active: true,
    protocol_source: 'CTAS 2025 Cardiovascular',
    version: '1.0.0',
    review_date: '2026-08-05',
  },
  {
    id: 'mod_cp_diaphoresis',
    name: 'Diaphoresis with pain',
    name_ar: 'تعرق مع الألم',
    pathways: ['chest_pain_cardiac', 'chest_pain_non_cardiac', 'chest_pain'],
    age_applicability: 'both',
    field: 'diaphoresis',
    detect_patterns: [/diaphores\w*|sweat(?:ing|y)?|clammy/i, /تعرق|عرق\s*بارد/i],
    question_ar: 'هل يوجد تعرق مع الألم؟',
    question_en: 'Is there diaphoresis (sweating) with the pain?',
    answer_type: 'yes_no',
    options: [
      { value: 'نعم', label_ar: 'نعم', label_en: 'Yes', ctas_effect: 2 },
      { value: 'لا', label_ar: 'لا', label_en: 'No' },
      { value: 'غير معروف', label_ar: 'غير معروف', label_en: 'Unknown' },
    ],
    ctas_effect_yes: 2,
    clinical_explanation_ar: 'تعرق مع ألم الصدر علامة ACS → CTAS 2',
    clinical_explanation_en: 'Diaphoresis with chest pain is an ACS feature → CTAS 2',
    priority: 16,
    active: true,
    protocol_source: 'CTAS 2025 Cardiovascular',
    version: '1.0.0',
    review_date: '2026-08-05',
  },
  {
    id: 'mod_cp_anticoagulants',
    name: 'Anticoagulant / antiplatelet',
    name_ar: 'مضادات التخثر',
    pathways: [
      'chest_pain_cardiac', 'chest_pain_non_cardiac', 'chest_pain',
      'head_injury', 'multisystem_trauma_blunt', 'multisystem_trauma_penetrating',
      'active_bleeding', 'stroke_symptoms',
    ],
    age_applicability: 'both',
    field: 'on_blood_thinners',
    detect_patterns: [
      /blood\s*thinn\w*|anticoagul\w*|warfarin|heparin|apixaban|rivaroxaban|aspirin/i,
      /مميع|مضاد\s*تخثر|وارفارين|أسبرين|هيبارين/i,
    ],
    related_medications: [/warfarin|heparin|apixaban|rivaroxaban|clopidogrel|أسبرين|وارفارين/i],
    question_ar: 'هل يتناول المريض أدوية مميعة للدم؟',
    question_en: 'Is the patient taking blood-thinning medication?',
    answer_type: 'yes_no',
    options: [
      { value: 'نعم', label_ar: 'نعم', label_en: 'Yes', ctas_effect: 2 },
      { value: 'لا', label_ar: 'لا', label_en: 'No' },
      { value: 'غير معروف', label_ar: 'غير معروف', label_en: 'Unknown' },
    ],
    ctas_effect_yes: 2,
    critical_alert: true,
    team_leader_review: true,
    clinical_explanation_ar: 'مضادات التخثر ترفع خطر النزف والمضاعفات → CTAS 2 حد أدنى',
    clinical_explanation_en: 'Anticoagulants raise bleeding/complication risk → CTAS 2 minimum',
    priority: 18,
    active: true,
    protocol_source: 'CTAS 2025 Bleeding / Trauma',
    version: '1.0.0',
    review_date: '2026-08-05',
  },

  // ── Dyspnea / shortness of breath ─────────────────────────────────────────
  {
    id: 'mod_dys_speak',
    name: 'Cannot speak full sentences',
    name_ar: 'عجز عن إكمال جملة',
    pathways: [
      'shortness_of_breath', 'dyspnea', 'asthma', 'copd', 'respiratory_distress',
      'wheezing', 'stridor_resp',
    ],
    age_applicability: 'both',
    field: 'cannot_speak_sentences',
    detect_patterns: [/cannot\s+speak|can't\s+speak|unable\s+to\s+(?:speak|finish)|speaks?\s+in\s+words/i, /لا\s*يستطع\s*إكمال|عجز\s*عن\s*الكلام|يتحدث\s*بكلمات/i],
    question_ar: 'هل يعجز المريض عن إكمال جملة بسبب ضيق التنفس؟',
    question_en: 'Is the patient unable to speak full sentences because of dyspnea?',
    answer_type: 'yes_no',
    options: [
      { value: 'نعم', label_ar: 'نعم', label_en: 'Yes', ctas_effect: 2, destination_hint: 'RESUSCITATION' },
      { value: 'لا', label_ar: 'لا', label_en: 'No' },
      { value: 'غير معروف', label_ar: 'غير معروف', label_en: 'Unknown' },
    ],
    ctas_effect_yes: 2,
    destination_effect: 'RESUSCITATION',
    critical_alert: true,
    clinical_explanation_ar: 'عجز عن إكمال جملة = ضيق تنفس شديد → CTAS 2',
    clinical_explanation_en: 'Cannot speak sentences = severe dyspnea → CTAS 2',
    priority: 12,
    active: true,
    protocol_source: 'CTAS 2025 Respiratory',
    version: '1.0.0',
    review_date: '2026-08-05',
  },
  {
    id: 'mod_dys_stridor',
    name: 'Stridor / airway threat',
    name_ar: 'صرير / تهديد مجرى الهواء',
    pathways: [
      'shortness_of_breath', 'dyspnea', 'asthma', 'copd', 'respiratory_distress',
      'wheezing', 'stridor_resp', 'allergic_reaction', 'altered_loc',
    ],
    age_applicability: 'both',
    field: 'stridor',
    detect_patterns: [/stridor|noisy\s+breathing|airway\s+(?:threat|compromise)/i, /صرير|تنفس\s*مزعج|انسداد\s*مجرى/i],
    question_ar: 'هل يوجد صرير (صوت تنفس عالي النبرة)؟',
    question_en: 'Is there stridor (high-pitched breathing noise)?',
    answer_type: 'yes_no',
    options: [
      { value: 'نعم', label_ar: 'نعم', label_en: 'Yes', ctas_effect: 1, destination_hint: 'RESUSCITATION' },
      { value: 'لا', label_ar: 'لا', label_en: 'No' },
      { value: 'غير معروف', label_ar: 'غير معروف', label_en: 'Unknown' },
    ],
    ctas_effect_yes: 1,
    destination_effect: 'RESUSCITATION',
    critical_alert: true,
    team_leader_review: true,
    clinical_explanation_ar: 'صرير = تهديد مجرى الهواء → CTAS 1',
    clinical_explanation_en: 'Stridor = airway threat → CTAS 1',
    priority: 5,
    active: true,
    protocol_source: 'CTAS 2025 Respiratory / Allergy',
    version: '1.0.0',
    review_date: '2026-08-05',
  },

  // ── Stroke ────────────────────────────────────────────────────────────────
  {
    id: 'mod_stroke_fast',
    name: 'FAST positive signs',
    name_ar: 'علامات FAST إيجابية',
    pathways: ['stroke_symptoms', 'tia', 'altered_loc', 'seizure'],
    age_applicability: 'both',
    field: 'fast_face',
    detect_patterns: [
      /\bfast\b|facial\s+droop|arm\s+weak(?:ness)?|slurred\s+speech|stroke/i,
      /سكتة|جلطة\s*دماغ|انحراف\s*وجه|ضعف\s*ذراع|تلعثم/i,
    ],
    question_ar: 'هل توجد علامة FAST إيجابية (وجه / ذراع / كلام)؟',
    question_en: 'Is there a positive FAST sign (face / arm / speech)?',
    answer_type: 'yes_no',
    options: [
      { value: 'نعم', label_ar: 'نعم', label_en: 'Yes', ctas_effect: 2, destination_hint: 'RESUSCITATION' },
      { value: 'لا', label_ar: 'لا', label_en: 'No' },
      { value: 'غير معروف', label_ar: 'غير معروف', label_en: 'Unknown' },
    ],
    ctas_effect_yes: 2,
    destination_effect: 'RESUSCITATION',
    critical_alert: true,
    team_leader_review: true,
    clinical_explanation_ar: 'علامة FAST إيجابية → اشتباه سكتة → CTAS 2',
    clinical_explanation_en: 'Positive FAST sign → suspected stroke → CTAS 2',
    priority: 8,
    active: true,
    protocol_source: 'CTAS 2025 Neurology',
    version: '1.0.0',
    review_date: '2026-08-05',
  },

  // ── Abdominal pain ────────────────────────────────────────────────────────
  {
    id: 'mod_abd_rigidity',
    name: 'Abdominal rigidity / guarding',
    name_ar: 'صلابة / توتر بطني',
    pathways: ['abdominal_pain', 'abdominal_pain_unspecified', 'flank_pain'],
    age_applicability: 'both',
    field: 'rigidity_guarding',
    detect_patterns: [/rigidity|guarding|periton\w*|board[- ]?like/i, /صلابة|توتر\s*بطن|بطن\s*حاد/i],
    question_ar: 'هل يوجد صلابة أو توتر بطني؟',
    question_en: 'Is there abdominal rigidity or guarding?',
    answer_type: 'yes_no',
    options: [
      { value: 'نعم', label_ar: 'نعم', label_en: 'Yes', ctas_effect: 2 },
      { value: 'لا', label_ar: 'لا', label_en: 'No' },
      { value: 'غير معروف', label_ar: 'غير معروف', label_en: 'Unknown' },
    ],
    ctas_effect_yes: 2,
    critical_alert: true,
    clinical_explanation_ar: 'صلابة بطنية → اشتباه بطن حاد → CTAS 2',
    clinical_explanation_en: 'Abdominal rigidity → acute abdomen concern → CTAS 2',
    priority: 14,
    active: true,
    protocol_source: 'CTAS 2025 Abdominal',
    version: '1.0.0',
    review_date: '2026-08-05',
  },
  {
    id: 'mod_abd_recent_surgery',
    name: 'Recent abdominal surgery',
    name_ar: 'جراحة بطنية حديثة',
    pathways: ['abdominal_pain', 'abdominal_pain_unspecified', 'flank_pain'],
    age_applicability: 'both',
    field: 'recent_abdominal_surgery',
    detect_patterns: [
      /recent\s+(?:abdominal\s+)?surg\w*|post[- ]?op(?:erative)?|laparoscop/i,
      /عملية\s*(?:بطن|جراحية)?\s*حديث|جراحة\s*حديث|بعد\s*العملية/i,
    ],
    question_ar: 'هل أجرى المريض جراحة بطنية حديثة؟',
    question_en: 'Has the patient had recent abdominal surgery?',
    answer_type: 'yes_no',
    options: [
      { value: 'نعم', label_ar: 'نعم', label_en: 'Yes', destination_hint: 'URGENT_CARE' },
      { value: 'لا', label_ar: 'لا', label_en: 'No' },
      { value: 'غير معروف', label_ar: 'غير معروف', label_en: 'Unknown' },
    ],
    ctas_effect_yes: null,
    destination_effect: 'URGENT_CARE',
    team_leader_review: true,
    question_category: 'patient_direction',
    clinical_explanation_ar: 'جراحة بطنية حديثة مع ألم بطن ترفع خطر المضاعفات — توجيه عاجل ومراجعة قائد الفريق دون رفع CTAS تلقائياً',
    clinical_explanation_en: 'Recent abdominal surgery with pain raises complication risk — urgent destination guidance and team-leader review; does not automatically raise CTAS',
    priority: 22,
    active: true,
    protocol_source: 'CTAS 2025 Abdominal + ED ops',
    version: '1.1.0',
    review_date: '2026-08-06',
  },
  {
    id: 'mod_pregnancy',
    name: 'Possible pregnancy',
    name_ar: 'احتمال حمل',
    pathways: [
      'abdominal_pain', 'abdominal_pain_unspecified', 'flank_pain',
      'vaginal_bleeding', 'vaginal_bleed', 'syncope', 'pelvic_pain',
    ],
    age_applicability: 'adult',
    field: 'possible_pregnancy',
    detect_patterns: [/pregnan\w*|gravida|gestation|ectopic/i, /حمل|حامل|حمل\s*خارج/i],
    question_ar: 'هل هناك احتمال حمل (للإناث في سن الإنجاب)؟',
    question_en: 'Is pregnancy possible (female of childbearing age)?',
    answer_type: 'yes_no',
    options: [
      { value: 'نعم', label_ar: 'نعم', label_en: 'Yes', destination_hint: 'URGENT_CARE' },
      { value: 'لا', label_ar: 'لا', label_en: 'No' },
      { value: 'غير معروف', label_ar: 'غير معروف', label_en: 'Unknown' },
      { value: 'لا ينطبق', label_ar: 'لا ينطبق', label_en: 'Not applicable' },
    ],
    ctas_effect_yes: null,
    destination_effect: 'URGENT_CARE',
    critical_alert: true,
    team_leader_review: true,
    question_category: 'patient_direction',
    clinical_explanation_ar: 'احتمال حمل مع أعراض بطنية/نزيف/إغماء → خطر حمل خارج الرحم — توجيه عاجل ومراجعة قائد الفريق دون رفع CTAS تلقائياً',
    clinical_explanation_en: 'Possible pregnancy with abdominal/bleed/syncope → ectopic risk — urgent destination and team-leader review; does not automatically raise CTAS',
    priority: 11,
    active: true,
    protocol_source: 'CTAS 2025 Obstetrics / Abdominal',
    version: '1.1.0',
    review_date: '2026-08-06',
  },
  {
    id: 'mod_minor_procedure',
    name: 'Minor procedure needed',
    name_ar: 'إجراء بسيط مطلوب',
    pathways: [
      'laceration',
      'upper_extremity_injury',
      'lower_extremity_injury',
      'limb_pain',
      'foreign_body_nose',
      'foreign_body_ear',
      'ear_injury',
      'nasal_trauma',
    ],
    age_applicability: 'pediatric',
    field: 'minor_procedure',
    shown_when_ctas: [4],
    detect_patterns: [
      /suture|stitches|minor\s+proc(?:edure)?|needs?\s+(?:a\s+)?(?:cast|splint|glue)|wound\s+repair/i,
      /خياطة|غرز|إجراء\s*بسيط|جبيرة|تجبير|لصق\s*الجرح/i,
    ],
    question_ar: 'هل يحتاج الطفل إجراءً بسيطاً (خياطة، جبيرة، إزالة جسم غريب)؟',
    question_en: 'Does the child need a minor procedure (sutures, splint, foreign-body removal)?',
    answer_type: 'yes_no',
    options: [
      { value: 'نعم', label_ar: 'نعم', label_en: 'Yes', destination_hint: 'PEDS_FAST_TRACK' },
      { value: 'لا', label_ar: 'لا', label_en: 'No' },
      { value: 'غير معروف', label_ar: 'غير معروف', label_en: 'Unknown' },
    ],
    ctas_effect_yes: null,
    destination_effect: 'PEDS_FAST_TRACK',
    critical_alert: false,
    team_leader_review: false,
    question_category: 'patient_direction',
    potential_ctas_effect: null,
    potential_destination_effect: 'PEDS_FAST_TRACK',
    safety_alert_effect: false,
    clinical_explanation_ar: 'CTAS 4 مع إجراء بسيط → المسار السريع للأطفال — دون تغيير مستوى CTAS',
    clinical_explanation_en: 'CTAS 4 with a minor procedure → pediatric Fast Track — does not change CTAS',
    priority: 18,
    active: true,
    protocol_source: 'ED pediatric journey chart',
    version: '1.0.0',
    review_date: '2026-08-18',
  },

  // ── Head injury / trauma ──────────────────────────────────────────────────
  {
    id: 'mod_hi_loc',
    name: 'Any loss of consciousness',
    name_ar: 'فقدان وعي',
    pathways: ['head_injury', 'multisystem_trauma_blunt', 'multisystem_trauma_penetrating', 'altered_loc', 'seizure'],
    age_applicability: 'both',
    field: 'loc_any',
    detect_patterns: [
      /loss\s+of\s+consciousness|\bloc\b|knocked\s+out|unconscious|passed\s+out/i,
      /فقدان\s*وعي|أغمي|فقد\s*الوعي/i,
    ],
    question_ar: 'هل فقد المريض الوعي ولو للحظة؟',
    question_en: 'Was there any loss of consciousness, even briefly?',
    answer_type: 'yes_no',
    options: [
      { value: 'نعم', label_ar: 'نعم', label_en: 'Yes', ctas_effect: 2 },
      { value: 'لا', label_ar: 'لا', label_en: 'No' },
      { value: 'غير معروف', label_ar: 'غير معروف', label_en: 'Unknown' },
    ],
    ctas_effect_yes: 2,
    critical_alert: true,
    clinical_explanation_ar: 'أي فقدان وعي بعد إصابة رأس → CTAS 2',
    clinical_explanation_en: 'Any LOC after head injury → CTAS 2',
    priority: 9,
    active: true,
    protocol_source: 'CTAS 2025 Trauma / Head injury',
    version: '1.0.0',
    review_date: '2026-08-05',
  },
  {
    id: 'mod_hi_high_energy',
    name: 'High-energy mechanism',
    name_ar: 'آلية عالية الطاقة',
    pathways: [
      'head_injury', 'multisystem_trauma_blunt', 'multisystem_trauma_penetrating',
      'limb_pain', 'upper_extremity_injury', 'lower_extremity_injury',
    ],
    age_applicability: 'both',
    field: 'high_energy_mechanism',
    detect_patterns: [
      /high[- ]?(?:energy|speed)|rollover|ejection|fall\s*(?:from|>)\s*(?:height|18|6)/i,
      /آلية\s*عالية|سقوط\s*من\s*ارتفاع|تدهور|قذف/i,
    ],
    question_ar: 'هل الإصابة نتيجة آلية عالية الخطورة (سقوط مرتفع، تدهور، قذف)؟',
    question_en: 'Was there a high-risk mechanism of injury (high fall, rollover, ejection)?',
    answer_type: 'yes_no',
    options: [
      { value: 'نعم', label_ar: 'نعم', label_en: 'Yes', ctas_effect: 2, destination_hint: 'RESUSCITATION' },
      { value: 'لا', label_ar: 'لا', label_en: 'No' },
      { value: 'غير معروف', label_ar: 'غير معروف', label_en: 'Unknown' },
    ],
    ctas_effect_yes: 2,
    destination_effect: 'RESUSCITATION',
    critical_alert: true,
    clinical_explanation_ar: 'آلية عالية الطاقة ترفع حدة الرضح → CTAS 2',
    clinical_explanation_en: 'High-energy mechanism raises trauma acuity → CTAS 2',
    priority: 13,
    active: true,
    protocol_source: 'CTAS 2025 Trauma',
    version: '1.0.0',
    review_date: '2026-08-05',
  },

  // ── Fever / infection ─────────────────────────────────────────────────────
  {
    id: 'mod_fev_immuno',
    name: 'Immunocompromised',
    name_ar: 'نقص مناعة',
    pathways: ['fever', 'fever_unspecified', 'urti_complaints', 'infection'],
    age_applicability: 'both',
    field: 'immunocompromised',
    detect_patterns: [
      /immuno\w*|neutropeni\w*|chemotherap\w*|steroid|transplant|hiv/i,
      /نقص\s*مناعة|كيمياء|سترويد|زراعة|نقص\s*كريات\s*بيضاء/i,
    ],
    related_medications: [/prednisone|dexamethasone|methotrexate|سترويد|كورتيزون/i],
    question_ar: 'هل يعاني المريض من ضعف المناعة أو يتناول مثبطات مناعة؟',
    question_en: 'Is the patient immunocompromised or on immunosuppressive therapy?',
    answer_type: 'yes_no',
    options: [
      { value: 'نعم', label_ar: 'نعم', label_en: 'Yes', ctas_effect: 2 },
      { value: 'لا', label_ar: 'لا', label_en: 'No' },
      { value: 'غير معروف', label_ar: 'غير معروف', label_en: 'Unknown' },
    ],
    ctas_effect_yes: 2,
    critical_alert: true,
    team_leader_review: true,
    clinical_explanation_ar: 'نقص مناعة + حمى → CTAS 2',
    clinical_explanation_en: 'Immunocompromised + fever → CTAS 2',
    priority: 12,
    active: true,
    protocol_source: 'CTAS 2025 Fever / SIRS',
    version: '1.0.0',
    review_date: '2026-08-05',
  },
  {
    id: 'mod_fev_looks_unwell',
    name: 'Looks unwell / septic appearance',
    name_ar: 'يبدو معتلاً',
    pathways: ['fever', 'fever_unspecified', 'urti_complaints', 'infection'],
    age_applicability: 'both',
    field: 'looks_unwell',
    detect_patterns: [/looks?\s+unwell|toxic\s+appear|septic|lethargic|flushed/i, /يبدو\s*معتل|خامل|وجه\s*متورم|إنتان/i],
    question_ar: 'هل يبدو المريض معتلاً (شاحب، خامل، مضطرب)؟',
    question_en: 'Does the patient look unwell (flushed, lethargic, anxious, agitated)?',
    answer_type: 'yes_no',
    options: [
      { value: 'نعم', label_ar: 'نعم', label_en: 'Yes', ctas_effect: 3 },
      { value: 'لا', label_ar: 'لا', label_en: 'No' },
      { value: 'غير معروف', label_ar: 'غير معروف', label_en: 'Unknown' },
    ],
    ctas_effect_yes: 3,
    clinical_explanation_ar: 'حمى مع مظهر معتَل → CTAS 3 على الأقل',
    clinical_explanation_en: 'Fever with unwell appearance → CTAS 3 minimum',
    priority: 17,
    active: true,
    protocol_source: 'CTAS 2025 Fever',
    version: '1.0.0',
    review_date: '2026-08-05',
  },

  // ── Active bleeding ───────────────────────────────────────────────────────
  {
    id: 'mod_bleed_uncontrolled',
    name: 'Uncontrolled bleeding',
    name_ar: 'نزيف غير مسيطر عليه',
    pathways: [
      'active_bleeding', 'epistaxis', 'gi_bleed', 'blood_in_stools',
      'vaginal_bleeding', 'vaginal_bleed',
      'head_injury', 'multisystem_trauma_blunt', 'multisystem_trauma_penetrating',
    ],
    age_applicability: 'both',
    field: 'uncontrolled_bleeding',
    detect_patterns: [
      /uncontrolled\s+bleed|heavy\s+bleed|soaking|hemorrhage|active\s+bleed/i,
      /نزيف\s*(?:غير\s*)?مسيطر|نزيف\s*غزير|ينزف\s*الآن/i,
    ],
    question_ar: 'هل النزيف غير مسيطر عليه حالياً؟',
    question_en: 'Is bleeding currently uncontrolled?',
    answer_type: 'yes_no',
    options: [
      { value: 'نعم', label_ar: 'نعم', label_en: 'Yes', ctas_effect: 2, destination_hint: 'RESUSCITATION' },
      { value: 'لا', label_ar: 'لا', label_en: 'No' },
      { value: 'غير معروف', label_ar: 'غير معروف', label_en: 'Unknown' },
    ],
    ctas_effect_yes: 2,
    destination_effect: 'RESUSCITATION',
    critical_alert: true,
    team_leader_review: true,
    clinical_explanation_ar: 'نزيف غير مسيطر → CTAS 2',
    clinical_explanation_en: 'Uncontrolled bleeding → CTAS 2',
    priority: 7,
    active: true,
    protocol_source: 'CTAS 2025 Bleeding',
    version: '1.0.0',
    review_date: '2026-08-05',
  },

  // ── Seizure / altered LOC ─────────────────────────────────────────────────
  {
    id: 'mod_sz_ongoing',
    name: 'Ongoing seizure / post-ictal',
    name_ar: 'نوبة مستمرة / ما بعد النوبة',
    pathways: ['seizure', 'altered_loc', 'stroke_symptoms'],
    age_applicability: 'both',
    field: 'ongoing_seizure',
    detect_patterns: [
      /seiz(?:ure|ing)|convuls\w*|status\s+epileptic|post[- ]?ictal/i,
      /نوبة|تشنج|صرع|بعد\s*النوبة/i,
    ],
    question_ar: 'هل النوبة مستمرة أو المريض لا يزال بعد النوبة؟',
    question_en: 'Is the seizure ongoing or is the patient still post-ictal?',
    answer_type: 'options',
    options: [
      { value: 'مستمرة / Ongoing', label_ar: 'مستمرة', label_en: 'Ongoing', ctas_effect: 1, destination_hint: 'RESUSCITATION' },
      { value: 'بعد النوبة / Post-ictal', label_ar: 'بعد النوبة', label_en: 'Post-ictal', ctas_effect: 2 },
      { value: 'انتهت / Resolved', label_ar: 'انتهت', label_en: 'Resolved' },
      { value: 'غير معروف', label_ar: 'غير معروف', label_en: 'Unknown' },
    ],
    critical_alert: true,
    team_leader_review: true,
    clinical_explanation_ar: 'نوبة مستمرة → CTAS 1؛ ما بعد النوبة → CTAS 2',
    clinical_explanation_en: 'Ongoing seizure → CTAS 1; post-ictal → CTAS 2',
    priority: 6,
    active: true,
    protocol_source: 'CTAS 2025 Neurology',
    version: '1.0.0',
    review_date: '2026-08-05',
  },
];

/** Default categories when a library row omits question_category. */
const CATEGORY_BY_ID = {
  mod_return_visit_72h: 'patient_direction',
  mod_abd_recent_surgery: 'patient_direction',
  mod_pregnancy: 'patient_direction',
  mod_minor_procedure: 'patient_direction',
  mod_dys_stridor: 'safety_escalation',
  mod_stroke_fast: 'safety_escalation',
  mod_bleed_uncontrolled: 'safety_escalation',
  mod_sz_ongoing: 'safety_escalation',
  mod_hi_loc: 'safety_escalation',
  mod_hi_high_energy: 'safety_escalation',
};

function enrichModifier(mod) {
  const category = mod.question_category
    || CATEGORY_BY_ID[mod.id]
    || 'ctas_modifier';
  return {
    ...mod,
    question_category: category,
    potential_ctas_effect: mod.potential_ctas_effect !== undefined
      ? mod.potential_ctas_effect
      : (category === 'ctas_modifier' || category === 'safety_escalation'
        ? (mod.ctas_effect_yes ?? null)
        : null),
    potential_destination_effect: mod.potential_destination_effect ?? mod.destination_effect ?? null,
    safety_alert_effect: mod.safety_alert_effect ?? !!mod.critical_alert,
  };
}

export const MODIFIER_LIBRARY_VERSION = '1.2.0';

export function getActiveModifiers() {
  const runtime = getRuntimeModifiers();
  const list = runtime || CTAS_MODIFIER_LIBRARY;
  return list.filter((m) => m.active !== false).map(enrichModifier);
}

const YES_RE = /^(نعم|yes|true|1)$/i;

/**
 * Apply library option ctas_effect floors from answers (acuity only increases).
 * Patient-direction questions never raise CTAS — destination/team-leader only.
 * Safe to call from computeLiveCTAS — no circular imports.
 */
export function applyModifierLibraryEffects(answers = {}, levelIn = 5) {
  let level = Number(levelIn) || 5;
  const applied = [];
  const directionApplied = [];
  const safetyApplied = [];
  const byField = new Map(getActiveModifiers().map((m) => [m.field, m]));

  for (const [field, value] of Object.entries(answers || {})) {
    if (field.startsWith('_') || value == null || value === '') continue;
    const mod = byField.get(field);
    if (!mod) continue;
    const opt = (mod.options || []).find(
      (o) => o.value === value || o.label_ar === value || o.label_en === value,
    );
    const category = mod.question_category || 'ctas_modifier';
    const destinationHint = opt?.destination_hint || mod.destination_effect || null;
    const isYes = YES_RE.test(String(value).trim());

    if (category === 'patient_direction') {
      if (isYes || destinationHint) {
        directionApplied.push({
          id: mod.id,
          field,
          category,
          label_ar: mod.clinical_explanation_ar,
          label_en: mod.clinical_explanation_en,
          result: 'patient_direction',
          source: 'modifier_library',
          ctas_effect: null,
          destination_hint: destinationHint,
          critical_alert: !!mod.critical_alert,
          team_leader_review: !!mod.team_leader_review,
          safety_alert: !!mod.safety_alert_effect,
        });
      }
      continue;
    }

    const effect = opt?.ctas_effect
      ?? (isYes ? mod.ctas_effect_yes : null);
    if (effect == null) {
      if (category === 'safety_escalation' && (isYes || mod.critical_alert)) {
        safetyApplied.push({
          id: mod.id,
          field,
          category,
          label_ar: mod.clinical_explanation_ar,
          label_en: mod.clinical_explanation_en,
          result: 'safety_escalation',
          source: 'modifier_library',
          destination_hint: destinationHint,
          critical_alert: true,
          team_leader_review: true,
          safety_alert: true,
        });
      }
      continue;
    }
    const next = Math.min(level, Number(effect));
    if (next < level) {
      level = next;
      const row = {
        id: mod.id,
        field,
        category,
        label_ar: mod.clinical_explanation_ar,
        label_en: mod.clinical_explanation_en,
        result: `CTAS ${effect} floor`,
        source: 'modifier_library',
        ctas_effect: effect,
        destination_hint: destinationHint,
        critical_alert: !!mod.critical_alert,
        team_leader_review: !!mod.team_leader_review,
        safety_alert: !!mod.safety_alert_effect,
      };
      applied.push(row);
      if (category === 'safety_escalation') safetyApplied.push(row);
    }
  }

  return {
    level,
    applied,
    direction_applied: directionApplied,
    safety_applied: safetyApplied,
  };
}
