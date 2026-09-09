/**
 * Config-driven CTAS clarifying question bank.
 * Questions are fetched by modified CTAS level + CEDIS pathway and branch on answers.
 */

/** @typedef {{ value: string, label_ar: string, label_en: string, next?: string[], ctas_hint?: number }} BankOption */
/** @typedef {{
 *   id: string,
 *   field: string,
 *   levels: number[],
 *   pathways: string[],
 *   text_ar: string,
 *   text_en: string,
 *   answer_type: 'yes_no' | 'multiple_choice' | 'options',
 *   options: BankOption[],
 *   clinical_relevance?: string,
 *   root?: boolean,
 * }} BankQuestion */

/** @type {BankQuestion[]} */
export const CLARIFYING_QUESTION_BANK = [
  // ── Chest pain (cardiac / non-cardiac) ────────────────────────────────────
  {
    id: 'cp_radiation',
    field: 'radiation',
    levels: [2, 3],
    pathways: ['chest_pain_cardiac', 'chest_pain_non_cardiac'],
    text_ar: 'هل يمتد الألم إلى الكتف أو الفك أو الذراع؟',
    text_en: 'Does the pain radiate to shoulder, jaw, or arm?',
    answer_type: 'yes_no',
    options: [
      { value: 'نعم', label_ar: 'نعم', label_en: 'Yes', next: ['cp_radiation_site', 'cp_diaphoresis'] },
      { value: 'لا', label_ar: 'لا', label_en: 'No', next: ['cp_diaphoresis'] },
      { value: 'غير معروف', label_ar: 'غير معروف', label_en: 'Unknown', next: ['cp_diaphoresis'] },
    ],
    clinical_relevance: 'ACS radiation feature',
    root: true,
  },
  {
    id: 'cp_radiation_site',
    field: 'radiation_site',
    levels: [2, 3],
    pathways: ['chest_pain_cardiac', 'chest_pain_non_cardiac'],
    text_ar: 'إلى أين يمتد الألم؟ (وفق CTAS)',
    text_en: 'Where does the pain radiate? (per CTAS)',
    answer_type: 'options',
    options: [
      { value: 'الكتف الأيسر / Left shoulder', label_ar: 'الكتف الأيسر', label_en: 'Left shoulder', next: [] },
      { value: 'الفك / Jaw', label_ar: 'الفك', label_en: 'Jaw', next: [] },
      { value: 'الذراع / Arm', label_ar: 'الذراع', label_en: 'Arm', next: [] },
      { value: 'الظهر / Back', label_ar: 'الظهر', label_en: 'Back', next: [] },
      { value: 'لا يمتد / No radiation', label_ar: 'لا يمتد', label_en: 'No radiation', next: [] },
    ],
    clinical_relevance: 'Radiation site for ACS',
  },
  {
    id: 'cp_diaphoresis',
    field: 'diaphoresis',
    levels: [2, 3],
    pathways: ['chest_pain_cardiac', 'chest_pain_non_cardiac'],
    text_ar: 'هل يوجد تعرق مع الألم؟',
    text_en: 'Is there diaphoresis (sweating) with the pain?',
    answer_type: 'yes_no',
    options: [
      { value: 'نعم', label_ar: 'نعم', label_en: 'Yes', next: ['cp_nausea'] },
      { value: 'لا', label_ar: 'لا', label_en: 'No', next: ['cp_prior_cardiac'] },
      { value: 'غير معروف', label_ar: 'غير معروف', label_en: 'Unknown', next: ['cp_prior_cardiac'] },
    ],
    clinical_relevance: 'ACS autonomic feature',
    root: true,
  },
  {
    id: 'cp_nausea',
    field: 'nausea_vomiting',
    levels: [2, 3],
    pathways: ['chest_pain_cardiac', 'chest_pain_non_cardiac'],
    text_ar: 'هل يوجد غثيان أو قيء؟',
    text_en: 'Is there nausea or vomiting?',
    answer_type: 'yes_no',
    options: [
      { value: 'نعم', label_ar: 'نعم', label_en: 'Yes', next: ['cp_prior_cardiac'] },
      { value: 'لا', label_ar: 'لا', label_en: 'No', next: ['cp_prior_cardiac'] },
      { value: 'غير معروف', label_ar: 'غير معروف', label_en: 'Unknown', next: ['cp_prior_cardiac'] },
    ],
    clinical_relevance: 'Associated ACS symptom',
  },
  {
    id: 'cp_prior_cardiac',
    field: 'prior_cardiac_history',
    levels: [2, 3, 4],
    pathways: ['chest_pain_cardiac', 'chest_pain_non_cardiac', 'palpitations'],
    text_ar: 'هل لدى المريض تاريخ مرض قلبي سابق؟',
    text_en: 'Does the patient have prior cardiac history?',
    answer_type: 'yes_no',
    options: [
      { value: 'نعم', label_ar: 'نعم', label_en: 'Yes', next: ['cp_blood_thinners'], ctas_hint: 2 },
      { value: 'لا', label_ar: 'لا', label_en: 'No', next: [] },
      { value: 'غير معروف', label_ar: 'غير معروف', label_en: 'Unknown', next: [] },
    ],
    clinical_relevance: 'Raises second-order cardiac risk',
    root: true,
  },
  {
    id: 'cp_blood_thinners',
    field: 'on_blood_thinners',
    levels: [2, 3, 4],
    pathways: ['chest_pain_cardiac', 'chest_pain_non_cardiac', 'palpitations'],
    text_ar: 'هل يتناول أسبرين أو مضادات التخثر؟',
    text_en: 'Is the patient on aspirin or anticoagulants?',
    answer_type: 'yes_no',
    options: [
      { value: 'نعم', label_ar: 'نعم', label_en: 'Yes', next: [], ctas_hint: 2 },
      { value: 'لا', label_ar: 'لا', label_en: 'No', next: [] },
      { value: 'غير معروف', label_ar: 'غير معروف', label_en: 'Unknown', next: [] },
    ],
    clinical_relevance: 'Anticoagulant risk',
  },
  // CTAS 4–5 non-cardiac / lower-acuity chest pain set
  {
    id: 'cp_reproducible',
    field: 'chest_pain_reproducible',
    levels: [4, 5],
    pathways: ['chest_pain_non_cardiac', 'chest_pain_cardiac'],
    text_ar: 'هل الألم يزداد بالضغط على الصدر أو بالحركة؟',
    text_en: 'Is the pain reproducible with chest wall pressure or movement?',
    answer_type: 'yes_no',
    options: [
      { value: 'نعم', label_ar: 'نعم', label_en: 'Yes', next: ['cp_pleuritic'] },
      { value: 'لا', label_ar: 'لا', label_en: 'No', next: ['cp_pleuritic'] },
      { value: 'غير معروف', label_ar: 'غير معروف', label_en: 'Unknown', next: ['cp_pleuritic'] },
    ],
    clinical_relevance: 'Musculoskeletal vs visceral pain',
    root: true,
  },
  {
    id: 'cp_pleuritic',
    field: 'pleuritic_pain',
    levels: [4, 5],
    pathways: ['chest_pain_non_cardiac', 'chest_pain_cardiac'],
    text_ar: 'هل الألم يزداد مع التنفس العميق؟',
    text_en: 'Does the pain worsen with deep breathing?',
    answer_type: 'yes_no',
    options: [
      { value: 'نعم', label_ar: 'نعم', label_en: 'Yes', next: [] },
      { value: 'لا', label_ar: 'لا', label_en: 'No', next: [] },
      { value: 'غير معروف', label_ar: 'غير معروف', label_en: 'Unknown', next: [] },
    ],
    clinical_relevance: 'Pleuritic feature for CTAS 4–5 pathway',
    root: true,
  },

  // ── Dyspnea / respiratory ─────────────────────────────────────────────────
  {
    id: 'dys_speak',
    field: 'cannot_speak_sentences',
    levels: [2, 3, 4],
    pathways: ['shortness_of_breath', 'dyspnea', 'asthma', 'copd', 'respiratory_distress'],
    text_ar: 'هل يعجز المريض عن إكمال جملة كاملة بسبب ضيق التنفس؟',
    text_en: 'Is the patient unable to speak full sentences due to dyspnea?',
    answer_type: 'yes_no',
    options: [
      { value: 'نعم', label_ar: 'نعم', label_en: 'Yes', next: ['dys_stridor'], ctas_hint: 2 },
      { value: 'لا', label_ar: 'لا', label_en: 'No', next: ['dys_type'] },
      { value: 'غير معروف', label_ar: 'غير معروف', label_en: 'Unknown', next: ['dys_type'] },
    ],
    clinical_relevance: 'Severe respiratory distress',
    root: true,
  },
  {
    id: 'dys_stridor',
    field: 'stridor',
    levels: [1, 2, 3],
    pathways: ['shortness_of_breath', 'dyspnea', 'asthma', 'copd', 'respiratory_distress', 'allergic_reaction'],
    text_ar: 'هل يوجد صرير (stridor)؟',
    text_en: 'Is there stridor?',
    answer_type: 'yes_no',
    options: [
      { value: 'نعم', label_ar: 'نعم', label_en: 'Yes', next: [], ctas_hint: 1 },
      { value: 'لا', label_ar: 'لا', label_en: 'No', next: [] },
      { value: 'غير معروف', label_ar: 'غير معروف', label_en: 'Unknown', next: [] },
    ],
    clinical_relevance: 'Airway threat',
  },
  {
    id: 'dys_type',
    field: 'dyspnea_type',
    levels: [2, 3, 4, 5],
    pathways: ['shortness_of_breath', 'dyspnea', 'asthma', 'copd', 'respiratory_distress'],
    text_ar: 'هل ضيق التنفس في الراحة أم عند المجهود فقط؟',
    text_en: 'Is dyspnea at rest or only on exertion?',
    answer_type: 'options',
    options: [
      { value: 'في الراحة / At rest', label_ar: 'في الراحة', label_en: 'At rest', next: [], ctas_hint: 2 },
      { value: 'عند المجهود / On exertion', label_ar: 'عند المجهود', label_en: 'On exertion', next: [] },
      { value: 'كلاهما / Both', label_ar: 'كلاهما', label_en: 'Both', next: [], ctas_hint: 2 },
    ],
    clinical_relevance: 'Rest dyspnea upgrades acuity',
    root: true,
  },

  // ── Abdominal pain ────────────────────────────────────────────────────────
  {
    id: 'abd_rigidity',
    field: 'rigidity_guarding',
    levels: [2, 3, 4],
    pathways: ['abdominal_pain', 'abdominal_pain_unspecified', 'flank_pain'],
    text_ar: 'هل يوجد صلابة بطنية أو دفاع عضلي؟',
    text_en: 'Is there abdominal rigidity or guarding?',
    answer_type: 'yes_no',
    options: [
      { value: 'نعم', label_ar: 'نعم', label_en: 'Yes', next: [], ctas_hint: 2 },
      { value: 'لا', label_ar: 'لا', label_en: 'No', next: [] },
      { value: 'غير معروف', label_ar: 'غير معروف', label_en: 'Unknown', next: [] },
    ],
    clinical_relevance: 'Acute abdomen',
    root: true,
  },

  // ── Trauma / head injury ──────────────────────────────────────────────────
  {
    id: 'tr_moi',
    field: 'high_energy_mechanism',
    levels: [2, 3, 4],
    pathways: [
      'head_injury', 'multisystem_trauma_blunt', 'multisystem_trauma_penetrating',
      'traumatic_back_spine',
    ],
    text_ar: 'هل الإصابة نتيجة آلية عالية الطاقة (سقوط عالٍ، تدهور، قذف، دهس)؟',
    text_en: 'Was there a high-energy mechanism (high fall, rollover, ejection, pedestrian struck)?',
    answer_type: 'yes_no',
    options: [
      { value: 'نعم', label_ar: 'نعم', label_en: 'Yes', next: ['tr_loc'], ctas_hint: 2 },
      { value: 'لا', label_ar: 'لا', label_en: 'No', next: ['tr_loc'] },
      { value: 'غير معروف', label_ar: 'غير معروف', label_en: 'Unknown', next: ['tr_loc'] },
    ],
    clinical_relevance: 'Trauma MOI upgrade',
    root: true,
  },
  {
    id: 'tr_moi_limb',
    field: 'high_energy_mechanism',
    levels: [2, 3, 4],
    pathways: ['limb_pain', 'lower_extremity_injury', 'upper_extremity_injury'],
    text_ar: 'هل الإصابة نتيجة آلية عالية الطاقة (سقوط عالٍ، تدهور، قذف، دهس)؟',
    text_en: 'Was there a high-energy mechanism (high fall, rollover, ejection, pedestrian struck)?',
    answer_type: 'yes_no',
    options: [
      { value: 'نعم', label_ar: 'نعم', label_en: 'Yes', next: [], ctas_hint: 2 },
      { value: 'لا', label_ar: 'لا', label_en: 'No', next: [] },
      { value: 'غير معروف', label_ar: 'غير معروف', label_en: 'Unknown', next: [] },
    ],
    clinical_relevance: 'Limb trauma MOI',
    root: true,
  },
  {
    id: 'tr_loc',
    field: 'loc_any',
    levels: [2, 3, 4],
    pathways: ['head_injury', 'multisystem_trauma_blunt', 'multisystem_trauma_penetrating'],
    text_ar: 'هل حدث فقدان للوعي؟',
    text_en: 'Was there any loss of consciousness?',
    answer_type: 'yes_no',
    options: [
      { value: 'نعم', label_ar: 'نعم', label_en: 'Yes', next: [], ctas_hint: 2 },
      { value: 'لا', label_ar: 'لا', label_en: 'No', next: [] },
      { value: 'غير معروف', label_ar: 'غير معروف', label_en: 'Unknown', next: [] },
    ],
    clinical_relevance: 'LOC after head injury',
    root: true,
  },
  {
    id: 'tr_weight',
    field: 'weight_bearing',
    levels: [3, 4, 5],
    pathways: ['limb_pain', 'lower_extremity_injury', 'upper_extremity_injury'],
    text_ar: 'هل يستطيع تحمل وزنه على الطرف المصاب؟',
    text_en: 'Can the patient bear weight on the injured limb?',
    answer_type: 'yes_no',
    options: [
      { value: 'نعم', label_ar: 'نعم', label_en: 'Yes', next: [] },
      { value: 'لا', label_ar: 'لا', label_en: 'No', next: ['tr_deformity'], ctas_hint: 3 },
      { value: 'غير معروف', label_ar: 'غير معروف', label_en: 'Unknown', next: [] },
    ],
    clinical_relevance: 'Ottawa weight-bearing',
    root: true,
  },
  {
    id: 'tr_deformity',
    field: 'swelling_deformity',
    levels: [3, 4, 5],
    pathways: ['limb_pain', 'lower_extremity_injury', 'upper_extremity_injury'],
    text_ar: 'هل يوجد تورم أو تشوه ظاهر؟',
    text_en: 'Is there visible swelling or deformity?',
    answer_type: 'options',
    options: [
      { value: 'تورم فقط / Swelling only', label_ar: 'تورم فقط', label_en: 'Swelling only', next: [] },
      { value: 'تشوه ظاهر / Deformity', label_ar: 'تشوه ظاهر', label_en: 'Deformity', next: [], ctas_hint: 3 },
      { value: 'لا شيء / None', label_ar: 'لا شيء', label_en: 'None', next: [] },
    ],
    clinical_relevance: 'Fracture suspicion',
  },

  // ── Fever ─────────────────────────────────────────────────────────────────
  {
    id: 'fev_unwell',
    field: 'looks_unwell',
    levels: [2, 3, 4, 5],
    pathways: ['fever', 'fever_unspecified', 'urti_complaints'],
    text_ar: 'هل يبدو المريض معتلاً (شاحب، خامل، مضطرب)؟',
    text_en: 'Does the patient look unwell (pale, lethargic, agitated)?',
    answer_type: 'yes_no',
    options: [
      { value: 'نعم', label_ar: 'نعم', label_en: 'Yes', next: ['fev_sirs', 'fev_immuno'], ctas_hint: 3 },
      { value: 'لا', label_ar: 'لا', label_en: 'No', next: ['fev_immuno'] },
      { value: 'غير معروف', label_ar: 'غير معروف', label_en: 'Unknown', next: ['fev_immuno'] },
    ],
    clinical_relevance: 'Looks unwell / septic appearance',
    root: true,
  },
  {
    id: 'fev_sirs',
    field: 'sirs_criteria_count',
    levels: [2, 3],
    pathways: ['fever', 'fever_unspecified'],
    text_ar: 'هل توجد ≥3 معايير SIRS معروفة (حرارة شاذة، نبض >90، تنفس >20، و/أو كريات بيض شاذة إن توفرت)؟',
    text_en: 'Are ≥3 known SIRS criteria present (abnormal temp, HR>90, RR>20, and/or abnormal WBC if available)? Pulse and HR count as one.',
    answer_type: 'yes_no',
    options: [
      // No direct ctas_hint — fever CTAS 2 requires full rule evaluation (immuno / ≥3 SIRS / compromise / RD / AMS)
      { value: 'نعم', label_ar: 'نعم', label_en: 'Yes', next: [] },
      { value: 'لا', label_ar: 'لا', label_en: 'No', next: [] },
      { value: 'غير معروف', label_ar: 'غير معروف', label_en: 'Unknown', next: [] },
    ],
    clinical_relevance: 'Feeds structured SIRS tally — does not auto-floor CTAS',
  },
  {
    id: 'fev_immuno',
    field: 'immunocompromised',
    levels: [2, 3, 4, 5],
    pathways: ['fever', 'fever_unspecified'],
    text_ar: 'هل يعاني من ضعف مناعة أو أدوية مثبطة؟',
    text_en: 'Immunocompromised or on immunosuppressive meds?',
    answer_type: 'yes_no',
    options: [
      { value: 'نعم', label_ar: 'نعم', label_en: 'Yes', next: [], ctas_hint: 2 },
      { value: 'لا', label_ar: 'لا', label_en: 'No', next: ['fev_chills'] },
      { value: 'غير معروف', label_ar: 'غير معروف', label_en: 'Unknown', next: ['fev_chills'] },
    ],
    clinical_relevance: 'Immunocompromised + fever',
    root: true,
  },
  {
    id: 'fev_chills',
    field: 'chills',
    levels: [3, 4, 5],
    pathways: ['fever', 'fever_unspecified'],
    text_ar: 'هل يوجد قشعريرة أو رجفة؟',
    text_en: 'Are there chills or rigors?',
    answer_type: 'yes_no',
    options: [
      { value: 'نعم', label_ar: 'نعم', label_en: 'Yes', next: [], ctas_hint: 3 },
      { value: 'لا', label_ar: 'لا', label_en: 'No', next: [] },
      { value: 'غير معروف', label_ar: 'غير معروف', label_en: 'Unknown', next: [] },
    ],
    clinical_relevance: 'Rigors',
  },

  // ── Symptom chronicity (injected when conversation-unclear; also in bank) ──
  {
    id: 'symptom_chronicity_baseline',
    field: 'symptom_chronicity',
    // Not level 1 — avoid stealing nearby-level bank fallback for CTAS 1 pathways
    levels: [2, 3, 4, 5],
    pathways: [
      'general', 'fever', 'shortness_of_breath', 'general_weakness', 'headache',
      'abdominal_pain', 'syncope', 'back_pain', 'urti_complaints', 'palpitations', 'hypertension',
    ],
    text_ar: 'هل هذا جديد أو مختلف عن خط الأساس المعتاد للمريض؟',
    text_en: 'Is this new or different from the patient’s usual baseline?',
    answer_type: 'multiple_choice',
    options: [
      { value: 'new', label_ar: 'جديد / لأول مرة', label_en: 'New / first time', next: [] },
      { value: 'acute_on_chronic', label_ar: 'حاد على مزمن / تفاقم', label_en: 'Acute on chronic / flare', next: [] },
      { value: 'worse_than_baseline', label_ar: 'أسوأ من المعتاد', label_en: 'Worse than usual baseline', next: [] },
      { value: 'chronic_unchanged', label_ar: 'مزمن بدون تغير', label_en: 'Chronic unchanged / same as baseline', next: [] },
      { value: 'uncertain', label_ar: 'غير واضح', label_en: 'Uncertain', next: [] },
    ],
    clinical_relevance: 'Chronic stable findings must not score as acute',
    root: true,
  },

  // ── Headache / neuro ──────────────────────────────────────────────────────
  {
    id: 'ha_thunder',
    field: 'thunderclap',
    levels: [2, 3, 4],
    pathways: ['headache', 'migraine'],
    text_ar: 'هل بدأ الصداع فجأة وبلغ أقصى شدة خلال ثوانٍ (رعدي)؟',
    text_en: 'Did headache reach peak intensity within seconds (thunderclap)?',
    answer_type: 'yes_no',
    options: [
      { value: 'نعم', label_ar: 'نعم', label_en: 'Yes', next: ['ha_meningitis'], ctas_hint: 2 },
      { value: 'لا', label_ar: 'لا', label_en: 'No', next: ['ha_worst'] },
      { value: 'غير معروف', label_ar: 'غير معروف', label_en: 'Unknown', next: ['ha_worst'] },
    ],
    clinical_relevance: 'SAH risk',
    root: true,
  },
  {
    id: 'ha_worst',
    field: 'worst_headache_ever',
    levels: [2, 3, 4],
    pathways: ['headache', 'migraine'],
    text_ar: 'هل هذا أشد صداع مرّ على المريض؟',
    text_en: 'Is this the worst headache of their life?',
    answer_type: 'yes_no',
    options: [
      { value: 'نعم', label_ar: 'نعم', label_en: 'Yes', next: ['ha_meningitis'], ctas_hint: 2 },
      { value: 'لا', label_ar: 'لا', label_en: 'No', next: [] },
      { value: 'غير معروف', label_ar: 'غير معروف', label_en: 'Unknown', next: [] },
    ],
    clinical_relevance: 'Worst-ever headache',
    root: true,
  },
  {
    id: 'ha_meningitis',
    field: 'fever_neck_stiffness',
    levels: [2, 3],
    pathways: ['headache', 'migraine', 'fever'],
    text_ar: 'هل يوجد حمى أو تيبس رقبة؟',
    text_en: 'Is there fever or neck stiffness?',
    answer_type: 'yes_no',
    options: [
      { value: 'نعم', label_ar: 'نعم', label_en: 'Yes', next: [], ctas_hint: 2 },
      { value: 'لا', label_ar: 'لا', label_en: 'No', next: [] },
      { value: 'غير معروف', label_ar: 'غير معروف', label_en: 'Unknown', next: [] },
    ],
    clinical_relevance: 'Meningitis features',
  },
];

const byId = new Map(CLARIFYING_QUESTION_BANK.map((q) => [q.id, q]));

/** CEDIS key synonyms used by bank + modifier pathway matching. */
export const PATHWAY_KEY_ALIASES = {
  vaginal_bleed: ['vaginal_bleeding'],
  vaginal_bleeding: ['vaginal_bleed'],
  blood_in_stools: ['gi_bleed'],
  gi_bleed: ['blood_in_stools'],
};

/** True when two pathway keys are the same or listed aliases of each other. */
export function pathwaysAreAliases(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  const aliases = PATHWAY_KEY_ALIASES[a] || [];
  return aliases.includes(b);
}

/** Normalize CEDIS pathway to family aliases used by Step-4 engine + bank matching. */
export function normalizePathwayFamily(pathway = 'general') {
  const p = String(pathway || 'general');
  if (p.startsWith('chest_pain') || p === 'palpitations') return 'chest_pain';
  if (p.includes('stroke') || p === 'stroke_symptoms' || p === 'tia') return 'stroke_symptoms';
  // Keep facial/ENT trauma out of head/limb trauma families
  if (p === 'nasal_trauma' || p === 'ear_injury') return p;
  if (
    p === 'limb_pain'
    || p === 'upper_extremity_injury'
    || p === 'lower_extremity_injury'
  ) return 'limb_trauma';
  if (
    p === 'head_injury'
    || p === 'traumatic_back_spine'
    || p === 'sexual_assault'
    || p === 'multisystem_trauma_blunt'
    || p === 'multisystem_trauma_penetrating'
    || p === 'trauma'
  ) return 'head_trauma';
  if (p.includes('headache') || p === 'migraine') return 'headache';
  if (p.includes('allerg') || p === 'anaphylaxis') return 'allergic_reaction';
  if (p.includes('fever') || p === 'urti_complaints') return 'fever';
  if (p.includes('abdominal') || p === 'flank_pain') return 'abdominal_pain';
  if (
    p.includes('dyspnea') || p.includes('shortness') || p.includes('asthma')
    || p.includes('copd') || p.includes('respirat')
    || p === 'wheezing' || p === 'stridor_resp'
  ) return 'dyspnea';
  if (p === 'back_pain') return 'back_pain';
  return p || 'general';
}

function matchesLevelAndPathway(q, level, pathway) {
  const lvl = Number(level);
  if (!q.levels?.includes(lvl)) return false;
  if (!q.pathways?.length) return true;
  if (q.pathways.includes(pathway)) return true;
  if (q.pathways.some((p) => pathwaysAreAliases(p, pathway))) return true;
  const family = normalizePathwayFamily(pathway);
  return q.pathways.some((p) => normalizePathwayFamily(p) === family);
}

/** Convert bank question to ClarifyingQuestions UI shape. */
export function toUiQuestion(q) {
  if (!q) return null;
  const answer_type = q.answer_type === 'multiple_choice' ? 'options' : q.answer_type;
  return {
    id: q.id,
    field: q.field,
    text_ar: q.text_ar,
    text_en: q.text_en,
    answer_type,
    answer_options: (q.options || []).map((o) => o.value),
    clinical_relevance: q.clinical_relevance || '',
    source: 'bank',
  };
}

/**
 * Resolve which bank questions are visible given current answers (branching).
 * Roots matching level+pathway always start; follow-ups unlock via options[].next.
 * @param {BankQuestion[]} bankSlice
 * @param {Record<string, string>} [answers]
 * @returns {Array<{ id?: string, field: string, text_ar: string, text_en: string, answer_type: string, answer_options?: string[], clinical_relevance?: string, source?: string }>}
 */
export function resolveVisibleQuestions(bankSlice, answers = {}) {
  const sliceById = new Map(bankSlice.map((q) => [q.id, q]));
  const visibleIds = new Set();

  const roots = bankSlice.filter((q) => q.root !== false && (
    q.root === true
    || !bankSlice.some((other) => (other.options || []).some((o) => (o.next || []).includes(q.id)))
  ));

  // Prefer explicit root:true; fallback to questions never referenced as next
  const startNodes = bankSlice.some((q) => q.root === true)
    ? bankSlice.filter((q) => q.root === true)
    : roots;

  for (const q of startNodes) visibleIds.add(q.id);

  let changed = true;
  while (changed) {
    changed = false;
    for (const id of [...visibleIds]) {
      const q = sliceById.get(id);
      if (!q) continue;
      const ans = answers[q.field];
      if (ans == null || ans === '') continue;
      const opt = (q.options || []).find((o) => o.value === ans || o.label_ar === ans || o.label_en === ans);
      for (const nextId of opt?.next || []) {
        if (sliceById.has(nextId) && !visibleIds.has(nextId)) {
          visibleIds.add(nextId);
          changed = true;
        }
      }
    }
  }

  return [...visibleIds]
    .map((id) => sliceById.get(id))
    .filter(Boolean)
    .map(toUiQuestion);
}

function sliceForLevelPathway(level, pathway) {
  return CLARIFYING_QUESTION_BANK.filter((q) => matchesLevelAndPathway(q, level, pathway));
}

function sliceForPathwayAnyLevel(pathway) {
  const path = pathway || 'general';
  const family = normalizePathwayFamily(path);
  return CLARIFYING_QUESTION_BANK.filter((q) => {
    if (!q.pathways?.length) return false;
    if (q.pathways.includes(path)) return true;
    if (q.pathways.some((p) => pathwaysAreAliases(p, path))) return true;
    return q.pathways.some((p) => normalizePathwayFamily(p) === family);
  });
}

/**
 * Fetch clarifying questions for a modified CTAS level + pathway, resolved against answers.
 * If the exact level has no bank coverage, tries nearby levels then any level for the pathway family
 * so clarifying MCQs still appear after CTAS is built.
 * @param {{ level?: number, pathway?: string, answers?: Record<string, string> }} [opts]
 * @returns {{ questions: Array<{ id?: string, field: string, text_ar: string, text_en: string, answer_type: string, answer_options?: string[], clinical_relevance?: string, source?: string }>, source: 'bank'|'empty', level: number, pathway: string, bankIds: string[] }}
 */
export function getClarifyingQuestions({ level, pathway, answers = {} } = {}) {
  const lvl = Number(level) || 5;
  const path = pathway || 'general';
  let slice = sliceForLevelPathway(lvl, path);
  let resolvedLevel = lvl;

  if (!slice.length) {
    const nearby = [lvl - 1, lvl + 1, lvl - 2, lvl + 2].filter((l) => l >= 1 && l <= 5);
    for (const tryLvl of nearby) {
      slice = sliceForLevelPathway(tryLvl, path);
      if (slice.length) {
        resolvedLevel = tryLvl;
        break;
      }
    }
  }

  if (!slice.length) {
    slice = sliceForPathwayAnyLevel(path);
    resolvedLevel = lvl;
  }

  if (!slice.length) {
    return { questions: [], source: 'empty', level: lvl, pathway: path, bankIds: [] };
  }
  const questions = resolveVisibleQuestions(slice, answers);
  return {
    questions,
    source: questions.length ? 'bank' : 'empty',
    level: resolvedLevel,
    pathway: path,
    bankIds: questions.map((q) => q.id).filter(Boolean),
  };
}

export function getBankQuestionById(id) {
  return byId.get(id) || null;
}

/**
 * Resolve CTAS acuity floors from clarifying answers whose options declare `ctas_hint`.
 * Matches by field + option value/label across the full bank (any pathway/level).
 * Acuity can only increase (lower CTAS number); callers apply Math.min.
 *
 * @param {Record<string, string>} [answers]
 * @returns {{ hints: Array<{ field: string, value: string, ctas_hint: number, question_id?: string, text_ar: string, text_en: string }> }}
 */
export function resolveCtasHintsFromAnswers(answers = {}) {
  const hints = [];
  const seen = new Set();

  for (const q of CLARIFYING_QUESTION_BANK) {
    const ans = answers[q.field];
    if (ans == null || ans === '') continue;
    const opt = (q.options || []).find(
      (o) => o.value === ans || o.label_ar === ans || o.label_en === ans,
    );
    if (!opt || opt.ctas_hint == null) continue;
    const hint = Number(opt.ctas_hint);
    if (!Number.isFinite(hint) || hint < 1 || hint > 5) continue;

    const key = `${q.field}:${hint}`;
    if (seen.has(key)) continue;
    seen.add(key);

    hints.push({
      field: q.field,
      value: String(ans),
      ctas_hint: hint,
      question_id: q.id,
      text_ar: q.text_ar || q.field,
      text_en: q.text_en || q.field,
    });
  }

  return { hints };
}
