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
      'traumatic_back_spine', 'limb_pain', 'general',
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
    pathways: ['limb_pain', 'general'],
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
    pathways: ['limb_pain', 'general'],
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
    text_ar: 'هل يوجد تنفس سريع (>20) ونبض سريع (>90) معاً؟ (معايير SIRS)',
    text_en: 'Both tachypnea (>20) AND tachycardia (>90)? (SIRS)',
    answer_type: 'yes_no',
    options: [
      { value: 'نعم', label_ar: 'نعم', label_en: 'Yes', next: [], ctas_hint: 2 },
      { value: 'لا', label_ar: 'لا', label_en: 'No', next: [] },
      { value: 'غير معروف', label_ar: 'غير معروف', label_en: 'Unknown', next: [] },
    ],
    clinical_relevance: 'Looks septic',
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

/** Normalize CEDIS pathway to family aliases used by Step-4 engine + bank matching. */
export function normalizePathwayFamily(pathway = 'general') {
  const p = String(pathway || 'general');
  if (p.startsWith('chest_pain') || p === 'palpitations' || p === 'cool_pulseless_limb') return 'chest_pain';
  if (p.includes('stroke') || p === 'stroke_symptoms' || p === 'tia') return 'stroke_symptoms';
  if (
    p.includes('trauma') || p === 'head_injury' || p === 'traumatic_back_spine'
    || p === 'sexual_assault' || p === 'limb_pain'
  ) return 'trauma';
  if (p.includes('headache') || p === 'migraine') return 'headache';
  if (p.includes('allerg') || p === 'anaphylaxis') return 'allergic_reaction';
  if (p.includes('fever') || p === 'urti_complaints') return 'fever';
  if (p.includes('abdominal') || p === 'flank_pain') return 'abdominal_pain';
  if (p.includes('dyspnea') || p.includes('shortness') || p.includes('asthma')
    || p.includes('copd') || p.includes('respirat')) return 'dyspnea';
  if (p === 'back_pain') return 'back_pain';
  return p || 'general';
}

function matchesLevelAndPathway(q, level, pathway) {
  const lvl = Number(level);
  if (!q.levels?.includes(lvl)) return false;
  if (!q.pathways?.length) return true;
  if (q.pathways.includes(pathway)) return true;
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

/**
 * Fetch clarifying questions for a modified CTAS level + pathway, resolved against answers.
 * @param {{ level?: number, pathway?: string, answers?: Record<string, string> }} [opts]
 * @returns {{ questions: Array<{ id?: string, field: string, text_ar: string, text_en: string, answer_type: string, answer_options?: string[], clinical_relevance?: string, source?: string }>, source: 'bank'|'empty', level: number, pathway: string, bankIds: string[] }}
 */
export function getClarifyingQuestions({ level, pathway, answers = {} } = {}) {
  const lvl = Number(level) || 5;
  const path = pathway || 'general';
  const slice = CLARIFYING_QUESTION_BANK.filter((q) => matchesLevelAndPathway(q, lvl, path));
  if (!slice.length) {
    return { questions: [], source: 'empty', level: lvl, pathway: path, bankIds: [] };
  }
  const questions = resolveVisibleQuestions(slice, answers);
  return {
    questions,
    source: 'bank',
    level: lvl,
    pathway: path,
    bankIds: questions.map((q) => q.id).filter(Boolean),
  };
}

export function getBankQuestionById(id) {
  return byId.get(id) || null;
}
