/**
 * Case details beyond the CTAS minimum dataset: every presenting complaint, chronic
 * illnesses (present / absent, never assumed), regular medicines with their drug class,
 * and whether a history was asked at all.
 *
 * Rules run on every transcript update (live while dictating). An optional LLM result
 * is merged in, but only items whose quoted evidence is actually in the transcript are
 * kept, so nothing can be invented. Missing information stays unknown.
 *
 * This module records information only. CTAS effects of chronic illness live in
 * comorbidityRules.js (approved rule table); `high_risk` marks illnesses a rule can use.
 */
import { findComplaintMentions, matchComplaint } from './resolveChiefComplaint.js';
import { extractBedsideTests } from './comorbidityRules.js';

export const CASE_DETAILS_VERSION = '1.0.0';

/**
 * Chronic illness vocabulary. `high_risk` marks conditions proposed as CTAS-relevant
 * (pending sign-off); `peds` marks paediatric-specific entries.
 */
export const CONDITION_VOCAB = [
  { id: 'diabetes', en: 'Diabetes', ar: 'السكري', high_risk: true,
    rx: /\bdiabet\w*|\bdm\b|\bt[12]dm\b|سكري|مرض\s*السكر|عنده\s*سكر|عندها\s*سكر/i },
  { id: 'hypertension', en: 'Hypertension', ar: 'ارتفاع ضغط الدم', high_risk: false,
    rx: /hypertensi\w*|high blood pressure|\bhtn\b|ارتفاع\s*(?:في\s*)?ضغط\s*الدم|مريض\s*ضغط|مريضة\s*ضغط|عنده\s*ضغط|عندها\s*ضغط/i },
  { id: 'coronary_disease', en: 'Coronary disease / stent', ar: 'مرض الشرايين التاجية / دعامة', high_risk: true,
    rx: /coronary|ischemic heart|\bihd\b|\bcad\b|heart attack|myocardial infarction|\bstents?\b|\bcabg\b|bypass surgery|angioplasty|قسطرة|دعامة|دعامات|جلطة\s*(?:في\s*)?القلب|جلطة\s*قلبية|نوبة\s*قلبية|مريض\s*قلب/i },
  { id: 'heart_failure', en: 'Heart failure', ar: 'قصور القلب', high_risk: true,
    rx: /heart failure|\bchf\b|\bhfref\b|قصور\s*(?:في\s*)?القلب|ضعف\s*(?:في\s*)?عضلة\s*القلب/i },
  { id: 'arrhythmia', en: 'Arrhythmia / pacemaker', ar: 'اضطراب نظم القلب / منظم', high_risk: true,
    rx: /atrial fibrillation|\ba-?fib\b|arrhythmi\w*|pacemaker|\bicd\b|رجفان|اضطراب\s*(?:في\s*)?نظم|منظم\s*(?:ضربات\s*)?القلب/i },
  { id: 'congenital_heart', en: 'Congenital heart disease', ar: 'مرض قلب خلقي', high_risk: true, peds: true,
    rx: /congenital heart|cyanotic heart|\bchd\b|\bvsd\b|\basd\b|tetralogy|\btof\b|single ventricle|fontan|glenn|norwood|\bbt shunt|blalock|hypoplastic left|\bhlhs\b|قلب\s*أزرق|عيب\s*خلقي\s*(?:في\s*)?القلب|ثقب\s*(?:في\s*)?القلب|قلب\s*خلقي/i },
  { id: 'stroke_history', en: 'Previous stroke / TIA', ar: 'سكتة دماغية سابقة', high_risk: false,
    rx: /(?:previous|prior|old|history of)\s+(?:a\s+)?(?:stroke|cva)|\btia\b|(?:سكتة|جلطة)\s*دماغية\s*سابقة/i },
  { id: 'kidney_disease', en: 'Chronic kidney disease / dialysis', ar: 'مرض الكلى المزمن / غسيل كلى', high_risk: true,
    rx: /chronic kidney|\bckd\b|\besrd\b|renal failure|dialysis|haemodialysis|hemodialysis|فشل\s*كلوي|قصور\s*كلوي|غسيل\s*(?:ال)?كل(?:ى|ي|وي)/i },
  { id: 'copd', en: 'COPD', ar: 'الانسداد الرئوي المزمن', high_risk: false,
    rx: /\bcopd\b|emphysema|chronic bronchitis|انسداد\s*رئوي\s*مزمن/i },
  { id: 'asthma', en: 'Asthma', ar: 'الربو', high_risk: false,
    rx: /asthma\w*|(?<![\u0600-\u06FF])(?:ال)?ربو(?![\u0600-\u06FF])|حساسية\s*(?:ال)?صدر/i },
  { id: 'interstitial_lung', en: 'Interstitial lung disease / chronic lung disease', ar: 'مرض رئوي مزمن', high_risk: true,
    rx: /interstitial lung|pulmonary fibrosis|\bild\b|chronic lung disease|bronchopulmonary dysplasia|\bbpd\b|تليف\s*(?:ال)?رئ(?:ة|وي)|مرض\s*رئوي\s*مزمن/i },
  { id: 'home_oxygen', en: 'Home oxygen', ar: 'أكسجين منزلي', high_risk: true,
    rx: /home oxygen|on o2 at home|home o2|أكسجين\s*(?:في\s*)?(?:ال)?منزل(?:ي)?|أكسجين\s*بالبيت/i },
  { id: 'sickle_cell', en: 'Sickle cell disease', ar: 'فقر الدم المنجلي', high_risk: true,
    rx: /sickle|\bscd\b|فقر\s*(?:ال)?دم\s*(?:ال)?منجلي|أنيميا\s*منجلية|منجلي/i },
  { id: 'immunocompromised', en: 'Immunocompromised / chemotherapy / transplant', ar: 'ضعف المناعة / علاج كيميائي / زراعة', high_risk: true,
    rx: /immuno-?compromis\w*|immunosuppress\w*|chemo\w*|transplant\w*|\bhiv\b|neutropeni\w*|ضعف\s*(?:في\s*)?المناعة|نقص\s*(?:ال)?مناعة|كيماوي|علاج\s*كيميائي|زراعة\s*(?:كلى|كلية|كبد|نخاع|قلب)/i },
  { id: 'cancer', en: 'Cancer', ar: 'السرطان', high_risk: true,
    rx: /cancer|malignan\w*|carcinoma|leuk(?:a)?emia|lymphoma|metasta\w*|سرطان|ورم\s*خبيث|لوكيميا|لمفوما/i },
  { id: 'epilepsy', en: 'Epilepsy', ar: 'الصرع', high_risk: false,
    rx: /epilep\w*|seizure disorder|known seizures|صرع|نوبات\s*صرع/i },
  { id: 'vp_shunt', en: 'VP shunt / hydrocephalus', ar: 'صمام دماغي / استسقاء', high_risk: true, peds: true,
    rx: /\bvp\s*shunt|(?<!\b(?:bt|blalock|central|sano|cardiac)[\s-]*)\bshunt\b|hydroceph\w*|استسقاء\s*(?:ال)?دماغ|صمام\s*(?:في\s*)?(?:ال)?(?:رأس|دماغ)/i },
  { id: 'metabolic_disorder', en: 'Metabolic disorder', ar: 'اضطراب استقلابي', high_risk: true, peds: true,
    rx: /metabolic disorder|inborn error|\bpku\b|mitochondrial|urea cycle|\bmsud\b|maple syrup|\bmcad\w*|fatty acid oxidation|organic acid\w*|propionic|methylmalonic|galactos\w*|glycogen storage|\biem\b|اضطراب\s*استقلابي|مرض\s*استقلابي|التمثيل\s*الغذائي/i },
  { id: 'adrenal_insufficiency', en: 'Adrenal insufficiency', ar: 'قصور الغدة الكظرية', high_risk: true,
    rx: /adrenal insufficiency|addison\w*|\bcah\b|congenital adrenal|قصور\s*(?:ال)?غدة\s*(?:ال)?كظرية|الكظرية/i },
  { id: 'genetic_syndrome', en: 'Genetic syndrome', ar: 'متلازمة وراثية', high_risk: true, peds: true,
    rx: /down(?:'s)? syndrome|trisomy|genetic syndrome|chromosom\w* (?:disorder|abnormalit\w*)|متلازمة\s*(?:داون|وراثية)|مرض\s*وراثي|تثلث\s*صبغي/i },
  { id: 'cerebral_palsy', en: 'Cerebral palsy / neurodisability', ar: 'شلل دماغي / إعاقة عصبية', high_risk: true, peds: true,
    rx: /cerebral palsy|\bcp\b(?=.*(?:child|boy|girl|wheelchair|gtube|g-tube|peg))|neurodisab\w*|global developmental delay|شلل\s*دماغي|إعاقة\s*(?:ذهنية|حركية)/i },
  { id: 'tracheostomy', en: 'Tracheostomy', ar: 'فغر الرغامى', high_risk: true,
    rx: /tracheostom\w*|\btrach\b|trachy|فتحة\s*(?:في\s*)?(?:ال)?رقبة|فغر\s*(?:ال)?رغامى|أنبوب\s*(?:في\s*)?(?:ال)?رقبة/i },
  { id: 'home_ventilation', en: 'Home ventilation (BiPAP / ventilator)', ar: 'تنفس صناعي منزلي', high_risk: true,
    rx: /home ventilat\w*|ventilator at home|home bipap|home cpap|\bbipap\b|جهاز\s*تنفس\s*(?:في\s*)?(?:ال)?بيت|تنفس\s*صناعي\s*منزلي/i },
  { id: 'gastrostomy', en: 'Feeding tube (gastrostomy / NG)', ar: 'أنبوب تغذية', high_risk: false, peds: true,
    rx: /gastrostom\w*|g-?tube|\bpeg\b|feeding tube|ng tube|أنبوب\s*(?:ال)?تغذية|تغذية\s*بالأنبوب/i },
  { id: 'liver_disease', en: 'Chronic liver disease', ar: 'مرض الكبد المزمن', high_risk: true,
    rx: /cirrho\w*|liver failure|chronic liver|تليف\s*(?:ال)?كبد|تشمع\s*(?:ال)?كبد|فشل\s*كبدي/i },
  { id: 'prematurity', en: 'Born premature', ar: 'ولادة مبكرة (خداج)', high_risk: false, peds: true,
    rx: /premature|preterm|ex-?prem|born at \d{2} weeks|خداج|ولادة\s*مبكرة|مولود\s*قبل\s*(?:ال)?موعد/i },
  { id: 'pregnancy', en: 'Pregnant', ar: 'حامل', high_risk: true,
    rx: /pregnan\w*|(?<![\u0600-\u06FF])حامل(?![\u0600-\u06FF])(?!\s*(?:ل|لل)[\u0600-\u06FF])|في\s*(?:ال)?شهر\s*\S+\s*(?:من\s*)?(?:ال)?حمل/i },
];

/** Drug-class vocabulary for regular medicines. */
export const DRUG_CLASSES = [
  { id: 'anticoagulant', en: 'Anticoagulant', ar: 'مميّع دم',
    rx: /warfarin|coumadin|apixaban|eliquis|rivaroxaban|xarelto|dabigatran|pradaxa|edoxaban|enoxaparin|clexane|heparin|anticoagul\w*|blood thinner|وارفارين|اليكويس|إليكويس|زاريلتو|كليكسان|هيبارين|مميع|مسيل\s*(?:لل)?دم|سيولة/i },
  { id: 'antiplatelet', en: 'Antiplatelet', ar: 'مضاد صفائح',
    rx: /aspirin|clopidogrel|plavix|ticagrelor|brilinta|prasugrel|أسبرين|اسبرين|بلافيكس|كلوبيدوقريل/i },
  { id: 'insulin', en: 'Insulin', ar: 'إنسولين', rx: /insulin|lantus|novorapid|humalog|إنسولين|انسولين/i },
  { id: 'oral_hypoglycaemic', en: 'Oral diabetes medicine', ar: 'دواء سكري فموي',
    rx: /metformin|glucophage|gliclazide|glimepiride|sitagliptin|januvia|empagliflozin|jardiance|dapagliflozin|forxiga|ميتفورمين|متفورمين|جلوكوفاج/i },
  { id: 'immunosuppressant', en: 'Immunosuppressant / chemotherapy', ar: 'مثبط مناعة / كيميائي',
    rx: /tacrolimus|cyclosporin\w*|mycophenol\w*|cellcept|azathioprine|methotrexate|sirolimus|biologic|chemo\w*|تاكروليمس|ميثوتركسات|كيماوي/i },
  { id: 'steroid', en: 'Regular steroid', ar: 'كورتيزون منتظم',
    rx: /prednisolone|prednisone|dexamethasone|hydrocortisone|methylpred\w*|steroid|بريدنيزولون|ديكساميثازون|هيدروكورتيزون|كورتيزون/i },
  { id: 'beta_blocker', en: 'Beta-blocker', ar: 'حاصر بيتا',
    rx: /\w+olol\b|beta.?blocker|بيسوبرولول|كونكور|بروبرانولول|أتينولول/i },
  { id: 'bronchodilator', en: 'Bronchodilator', ar: 'موسّع شعب',
    rx: /salbutamol|albuterol|ventolin|atrovent|ipratropium|فنتولين|فينتولين|سالبيوتامول|أتروفنت/i },
  { id: 'inhaled_steroid', en: 'Inhaled steroid', ar: 'كورتيزون استنشاقي',
    rx: /budesonide|pulmicort|flixotide|fluticasone|seretide|symbicort|beclomet\w*|clenil|بلميكورت|ميكورت|فليكسوتايد|سيريتايد|سيمبيكورت/i },
  { id: 'leukotriene', en: 'Leukotriene antagonist', ar: 'مضاد ليكوترين',
    rx: /montelukast|singulair|سينجولير|سينغولير|مونتيلوكاست/i },
  { id: 'antiepileptic', en: 'Antiepileptic', ar: 'مضاد صرع',
    rx: /levetiracetam|keppra|valpro\w*|depakine|carbamazepine|tegretol|phenytoin|lamotrigine|topiramate|كيبرا|ديباكين|تجريتول/i },
];

/** The patient was asked and has no chronic illness. */
const NO_HISTORY_RX = /no (?:significant |known )?(?:past )?medical history|no (?:known )?chronic (?:illness|disease|conditions?)|previously (?:fit and )?(?:healthy|well)|no comorbidit\w*|\bnil pmh\b|لا\s*(?:يعاني|تعاني)\s*من\s*(?:أي\s*)?أمراض|(?:ما|لا)\s*(?:عنده|عندها|فيه|فيها)\s*(?:أي\s*)?أمراض|بدون\s*أمراض\s*مزمنة|سليم\s*سابق(?:اً|ا)|لا\s*توجد\s*أمراض/i;
/** A history question was asked or answered (even if empty). */
const HISTORY_ASKED_RX = /history|chronic|comorbid|medical (?:background|problems)|known case|medications?|meds\b|takes|taking|\bon\s+\w+|تاريخ|مزمن|أمراض|أدوية|يتناول|تتناول|يستخدم|معروف/i;
const NEGATION_BEFORE = /(?:^|\s)(?:no|not|non|denies|denied|without|negative for|never|لا|ليس|ليست|بدون|ينفي|تنفي|غير|ما\s*(?:عنده|عندها|فيه|فيها))\s*(?:\S+\s*){0,3}$/i;
const NON_PREFIX = /\bnon-?\s*$/i;

function clauses(text) {
  return String(text || '').split(/[.!?؟;,،\n]+/).map((s) => s.trim()).filter(Boolean);
}

/** Words before a match, from the last "but" onwards ("not on insulin but diabetic"). */
function lead(clause, index) {
  return clause.slice(0, index).split(/\b(?:but|however|although|except)\b|لكن|ولكن|بس|إلا/i).pop();
}

/** Normalize text for evidence checks (case, spacing, punctuation, Arabic letter forms). */
export function normalizeForEvidence(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[إأآا]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')
    .replace(/[ً-ْ]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** True when `evidence` really appears in `transcript` (after normalization). */
export function evidenceInTranscript(evidence, transcript) {
  const ev = normalizeForEvidence(evidence);
  if (!ev || ev.length < 3) return false;
  return normalizeForEvidence(transcript).includes(ev);
}

function conditionFromText(text) {
  return CONDITION_VOCAB.find((c) => c.rx.test(text)) || null;
}

/** Drug classes for a medicine name or phrase. */
export function classifyMedication(name) {
  return DRUG_CLASSES.filter((d) => d.rx.test(String(name || ''))).map((d) => d.id);
}

/**
 * Chronic illnesses mentioned in the transcript, each present or absent.
 * Absent only when explicitly negated ("not diabetic", "لا يعاني من السكري").
 */
export function extractConditions(transcript) {
  const found = new Map();
  for (const clause of clauses(transcript)) {
    for (const c of CONDITION_VOCAB) {
      const m = clause.match(c.rx);
      if (!m) continue;
      const before = lead(clause, m.index);
      const negated = NEGATION_BEFORE.test(before) || NON_PREFIX.test(before);
      const status = negated ? 'absent' : 'present';
      const prev = found.get(c.id);
      // A positive statement wins over a negated one ("not on insulin, but diabetic").
      if (!prev || (prev.status === 'absent' && status === 'present')) {
        found.set(c.id, { id: c.id, label_en: c.en, label_ar: c.ar, status, high_risk: c.high_risk, evidence: clause.slice(0, 120), source: 'rules' });
      }
    }
  }
  return [...found.values()];
}

/** Regular medicines named in the transcript, with drug classes. */
/**
 * @param {string} transcript
 * @param {string[]} [listed]
 */
export function extractMedications(transcript, listed = []) {
  const meds = new Map();
  const add = (name, evidence, source, stated = false) => {
    const clean = String(name || '').trim().replace(/^(?:on|takes|taking|uses|يتناول|تتناول|يستخدم|تستخدم|على)\s+/i, '');
    if (!clean || clean.length < 3) return;
    const key = clean.toLowerCase();
    if (meds.has(key)) return;
    const classes = classifyMedication(clean);
    // Unknown words are kept only when the extractor listed them as a medicine.
    if (!classes.length && !stated) return;
    meds.set(key, { name: clean, classes, evidence: String(evidence || clean).slice(0, 120), source });
  };
  // Listed by the field extractor; a phrase that names an illness or a negation is not a medicine.
  for (const m of listed || []) {
    const t = String(m || '');
    if (/^(?:no|not|non|denies|لا|ليس|ما)\b|allerg|حساسي/i.test(t) || conditionFromText(t)) continue;
    add(m, m, 'rules', true);
  }
  // Named drugs anywhere in the text, even without "on …".
  for (const clause of clauses(transcript)) {
    for (const d of DRUG_CLASSES) {
      const re = new RegExp(d.rx.source, 'gi');
      for (const hit of clause.matchAll(re)) {
        if (NEGATION_BEFORE.test(lead(clause, hit.index))) continue;
        const word = hit[0];
        // Generic phrases ("blood thinner", "steroid") are kept as the phrase itself.
        add(word, clause, 'rules');
      }
    }
  }
  return [...meds.values()];
}

/** Every presenting complaint, in order of first mention. */
export function extractComplaints(transcript) {
  return findComplaintMentions(transcript).map((m) => ({
    key: m.complaintKey,
    text: m.term,
    label_en: m.label_en,
    label_ar: m.label_ar,
    default_ctas: m.default_ctas,
    evidence: m.clause.slice(0, 120),
    source: 'rules',
  }));
}

/**
 * Validate and normalize the LLM's case details against the transcript.
 * Items without real evidence in the transcript are dropped.
 */
export function normalizeLlmCaseDetails(llm, transcript) {
  if (!llm || typeof llm !== 'object') return { complaints: [], conditions: [], medications: [], rejected: 0 };
  let rejected = 0;
  const ok = (ev) => {
    const good = evidenceInTranscript(ev, transcript);
    if (!good) rejected += 1;
    return good;
  };
  const complaints = [];
  for (const c of Array.isArray(llm.complaints) ? llm.complaints : []) {
    if (!c?.text || !ok(c.evidence)) continue;
    const hit = findComplaintMentions(`${c.text}`)[0] || null;
    const match = hit ? null : matchComplaint(String(c.text));
    complaints.push({
      key: hit?.complaintKey || match?.complaintKey || null,
      text: String(c.text).slice(0, 80),
      label_en: hit?.label_en || match?.complaint?.label_en || String(c.text),
      label_ar: hit?.label_ar || match?.complaint?.label_ar || String(c.text),
      default_ctas: hit?.default_ctas || match?.complaint?.default_ctas || null,
      evidence: String(c.evidence).slice(0, 120),
      source: 'llm',
    });
  }
  const conditions = [];
  for (const c of Array.isArray(llm.conditions) ? llm.conditions : []) {
    if (!c?.name || !ok(c.evidence)) continue;
    const v = conditionFromText(`${c.name} ${c.evidence}`);
    conditions.push({
      id: v?.id || `other:${normalizeForEvidence(c.name).slice(0, 40)}`,
      label_en: v?.en || String(c.name),
      label_ar: v?.ar || String(c.name),
      status: c.status === 'absent' ? 'absent' : 'present',
      high_risk: !!v?.high_risk,
      evidence: String(c.evidence).slice(0, 120),
      source: 'llm',
    });
  }
  const medications = [];
  for (const m of Array.isArray(llm.medications) ? llm.medications : []) {
    if (!m?.name || !ok(m.evidence || m.name)) continue;
    medications.push({ name: String(m.name).slice(0, 60), classes: classifyMedication(`${m.name} ${m.evidence || ''}`), evidence: String(m.evidence || m.name).slice(0, 120), source: 'llm' });
  }
  return { complaints, conditions, medications, rejected };
}

function mergeBy(list, keyOf) {
  const out = new Map();
  for (const item of list) {
    const k = keyOf(item);
    if (!k) continue;
    if (!out.has(k)) out.set(k, item);
  }
  return [...out.values()];
}

/**
 * All case details for one transcript: rules first, then validated LLM items that
 * the rules did not find. A present statement for a condition wins over absent.
 */
/**
 * @param {string} transcript
 * @param {{ medications?: string[], llm?: any }} [opts]
 */
export function buildCaseDetails(transcript, { medications = [], llm = null } = {}) {
  const text = String(transcript || '');
  const fromLlm = llm ? normalizeLlmCaseDetails(llm, text) : { complaints: [], conditions: [], medications: [], rejected: 0 };

  const complaints = mergeBy(
    [...extractComplaints(text), ...fromLlm.complaints],
    (c) => c.key || normalizeForEvidence(c.text),
  );

  const condMap = new Map();
  for (const c of [...extractConditions(text), ...fromLlm.conditions]) {
    const prev = condMap.get(c.id);
    if (!prev || (prev.status === 'absent' && c.status === 'present')) condMap.set(c.id, c);
  }
  // Medicines imply a condition only as "probable", shown but never treated as stated.
  const meds = mergeBy([...extractMedications(text, medications), ...fromLlm.medications], (m) => m.name.toLowerCase());
  const classSet = new Set(meds.flatMap((m) => m.classes));
  const implied = [
    ['insulin', 'diabetes'], ['oral_hypoglycaemic', 'diabetes'], ['immunosuppressant', 'immunocompromised'],
  ];
  for (const [cls, id] of implied) {
    if (classSet.has(cls) && !condMap.has(id)) {
      const v = CONDITION_VOCAB.find((x) => x.id === id);
      condMap.set(id, { id, label_en: v.en, label_ar: v.ar, status: 'probable', high_risk: v.high_risk, evidence: meds.find((m) => m.classes.includes(cls))?.evidence || '', source: 'medication' });
    }
  }

  const conditions = [...condMap.values()];
  const noKnownHistory = NO_HISTORY_RX.test(text) && !conditions.some((c) => c.status === 'present');
  return {
    version: CASE_DETAILS_VERSION,
    complaints,
    conditions,
    medications: meds,
    drug_classes: [...classSet],
    no_known_history: noKnownHistory,
    history_asked: noKnownHistory || conditions.length > 0 || meds.length > 0 || HISTORY_ASKED_RX.test(text),
    llm_rejected: fromLlm.rejected,
    // Capillary glucose / ketones said aloud (fills the bedside tiles when empty).
    bedside: extractBedsideTests(text),
  };
}
