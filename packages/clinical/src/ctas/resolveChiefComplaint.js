/**
 * Scored CEDIS chief-complaint resolver.
 * Deterministic synonym/label matching — never silently guesses a pathway when confidence is low.
 *
 * Auto-select when top confidence ≥ AUTO_MIN and margin over #2 ≥ AUTO_MARGIN.
 * Otherwise returns top 2–3 candidates for provider confirmation.
 */
import { CTAS_DB } from './ctasDatabase.js';

export const COMPLAINT_RESOLVER_VERSION = '1.0.0';
export const AUTO_MIN = 0.82;
export const AUTO_MARGIN = 0.12;

/** Extra synonyms keyed by complaintKey (beyond DB labels). Longer phrases score higher. */
const EXTRA_SYNONYMS = {
  chest_pain_cardiac: [
    'chest pain', 'cardiac chest pain', 'chest pain cardiac', 'angina', 'acs',
    'ألم صدري', 'ألم في الصدر', 'ألم صدري قلبي', 'ذبحة',
  ],
  chest_pain_non_cardiac: [
    'chest pain non cardiac', 'non-cardiac chest', 'no cardiac features',
    'musculoskeletal chest pain', 'reproducible chest pain',
    'ألم صدري غير قلبي', 'ألم صدر عضلي',
  ],
  shortness_of_breath: [
    'shortness of breath', 'dyspnea', 'sob', 'breathless', 'difficulty breathing',
    'ضيق تنفس', 'ضيق في التنفس', 'صعوبة التنفس', 'لهثان',
  ],
  syncope: [
    'syncope', 'presyncope', 'pre-syncope', 'fainted', 'passed out', 'near syncope',
    'dizziness', 'dizzy', 'vertigo', 'lightheaded', 'light-headed',
    'إغماء', 'ما قبل الإغماء', 'دوخة', 'دوار', 'دوار رأسي',
  ],
  stroke_cva: [
    'stroke', 'cva', 'facial droop', 'arm weakness stroke', 'slurred speech',
    'جلطة دماغية', 'سكتة دماغية', 'تعثر كلام', 'ضعف ذراع',
  ],
  heat_related: [
    'heat stroke', 'heatstroke', 'heat exhaustion', 'heat related', 'heat cramps',
    'ضربة شمس', 'إجهاد حراري', 'حرارة بيئية',
  ],
  fever: [
    'fever', 'febrile', 'pyrexia', 'حمى', 'سخونة', 'سخون', 'سخونية',
    'عنده حرارة', 'عندها حرارة', 'ارتفاع حرارة', 'ارتفاع في الحرارة', 'ارتفاع درجة الحرارة',
  ],
  nasal_congestion: [
    'nasal congestion', 'hay fever', 'allergic rhinitis', 'stuffy nose',
    'احتقان الأنف', 'حساسية الأنف',
  ],
  urti_complaints: [
    'cough', 'cold symptoms', 'uri', 'urti', 'upper respiratory', 'sore throat',
    'سعال', 'كحة', 'زكام', 'التهاب تنفسي علوي', 'ألم حلق',
  ],
  stridor_resp: ['stridor', 'صرير', 'سترايدر', 'استرايدر', 'سترايدور'],
  tinnitus: ['tinnitus', 'ringing in ear', 'ringing ears', 'طنين', 'طنين الأذن'],
  altered_loc: [
    'altered loc', 'altered consciousness', 'altered level of consciousness',
    'unresponsive', 'ams', 'not responding',
    'اضطراب الوعي', 'فاقد الوعي', 'لا يستجيب', 'تغير مستوى الوعي',
  ],
  headache: ['headache', 'head pain', 'migraine', 'صداع', 'وجع رأس'],
  abdominal_pain: [
    'abdominal pain', 'stomach pain', 'belly pain', 'flank pain', 'loin pain',
    'epigastric pain', 'epigastric', 'gastric pain', 'upper abdominal pain', 'stomach ache', 'stomachache', 'tummy pain',
    'ألم بطني', 'ألم في البطن', 'بطن', 'ألم خاصرة', 'خاصرة',
    'ألم في المعدة', 'ألم المعدة', 'وجع المعدة', 'وجع في المعدة', 'ألم فم المعدة', 'ألم في فم المعدة', 'فم المعدة',
    'ألم أعلى البطن', 'ألم في أعلى البطن', 'ألم شرسوفي', 'مغص',
  ],
  uti: [
    'uti', 'dysuria', 'urinary symptoms', 'burning urine', 'flank pain uti',
    'التهاب مسالك', 'بول مؤلم', 'حرقة بول',
  ],
  back_pain: ['back pain', 'lumbar pain', 'ألم الظهر', 'ظهر'],
  lower_extremity_injury: [
    'leg pain', 'knee pain', 'ankle pain', 'foot pain', 'neck pain',
    'ألم الساق', 'ألم الركبة', 'ألم القدم', 'ألم الرقبة', 'رقبة',
  ],
  upper_extremity_injury: [
    'arm pain', 'shoulder pain', 'wrist pain', 'hand injury',
    'ألم الذراع', 'ألم الكتف', 'إصابة اليد',
  ],
  traumatic_back_spine: [
    'neck injury', 'cervical injury', 'spine injury', 'neck trauma',
    'إصابة الرقبة', 'إصابة العمود الفقري',
  ],
  general_weakness: ['weakness', 'general weakness', 'fatigue', 'ضعف عام', 'إعياء'],
  earache: ['earache', 'ear pain', 'otalgia', 'ألم الأذن'],
  seizure: ['seizure', 'seizures', 'fit', 'تشنج', 'نوبة صرع'],
  palpitations: ['palpitation', 'palpitations', 'irregular heartbeat', 'خفقان', 'اضطراب النظم'],
  hypertension: ['hypertension', 'high blood pressure', 'ضغط مرتفع', 'ارتفاع ضغط'],
  vomiting_nausea: ['vomit', 'vomiting', 'nausea', 'قيء', 'غثيان'],
  diarrhea: ['diarrhea', 'diarrhoea', 'إسهال'],
  rash: ['rash', 'طفح', 'طفح جلدي'],
  allergic_reaction: ['allergic', 'allergy', 'anaphylaxis', 'حساسية', 'تفاعل تحسسي'],
  wheezing: ['wheeze', 'wheezing', 'صفير'],
  burn: ['burn', 'burns', 'حروق'],
  laceration: ['laceration', 'cut', 'wound', 'جرح', 'تمزق'],
  epistaxis: ['epistaxis', 'nosebleed', 'nose bleed', 'رعاف', 'نزيف أنف'],
  confusion: ['confusion', 'confused', 'disoriented', 'ارتباك', 'تشوش'],
  cardiac_arrest_non_traumatic: ['cardiac arrest', 'سكتة قلبية', 'توقف القلب'],
  respiratory_arrest: ['respiratory arrest', 'توقف التنفس'],
  multisystem_trauma_blunt: ['trauma', 'blunt trauma', 'mvc', 'rta', 'fall', 'حادث', 'إصابة', 'سقوط'],
  head_injury: ['head injury', 'head trauma', 'إصابة الرأس'],
  overdose_ingestion: ['overdose', 'ingestion', 'جرعة زائدة'],
  depression_suicidal: ['suicide', 'suicidal', 'self harm', 'انتحار'],
  anxiety_crisis: ['anxiety', 'panic', 'قلق', 'نوبة هلع'],
  vaginal_bleed: ['vaginal bleed', 'vaginal bleeding', 'نزيف مهبلي'],
  pregnancy_over_20: ['pregnancy', 'pregnant', 'labor', 'حمل', 'مخاض'],
  hyperglycemia: ['hyperglycemia', 'high sugar', 'ارتفاع السكر'],
  hypoglycemia: ['hypoglycemia', 'low sugar', 'انخفاض السكر'],
  urinary_retention: ['urinary retention', 'unable to void', 'احتباس بولي'],
  blood_in_stools: ['melena', 'blood in stool', 'rectal bleeding', 'دم في البراز', 'ميلينا'],
  chemical_exposure: ['chemical exposure', 'chemical burn', 'تعرض كيميائي'],
  substance_withdrawal: ['withdrawal', 'انسحاب'],
  substance_misuse_intoxication: ['intoxication', 'drunk', 'تسمم', 'سكران'],
};

/** Phrases that must beat competing short tokens (order matters for boost). */
const DISAMBIGUATION_BOOSTS = [
  { phrase: 'heat stroke', key: 'heat_related', boost: 0.45 },
  { phrase: 'heatstroke', key: 'heat_related', boost: 0.45 },
  { phrase: 'ضربة شمس', key: 'heat_related', boost: 0.45 },
  { phrase: 'hay fever', key: 'nasal_congestion', boost: 0.4 },
  { phrase: 'no cardiac', key: 'chest_pain_non_cardiac', boost: 0.35 },
  { phrase: 'non cardiac', key: 'chest_pain_non_cardiac', boost: 0.35 },
  { phrase: 'non-cardiac', key: 'chest_pain_non_cardiac', boost: 0.35 },
  { phrase: 'غير قلبي', key: 'chest_pain_non_cardiac', boost: 0.35 },
  { phrase: 'neck pain', key: 'traumatic_back_spine', boost: 0.25 },
  { phrase: 'ألم الرقبة', key: 'traumatic_back_spine', boost: 0.25 },
  { phrase: 'flank pain', key: 'uti', boost: 0.2 },
  { phrase: 'ألم خاصرة', key: 'uti', boost: 0.2 },
  { phrase: 'dizziness', key: 'syncope', boost: 0.28 },
  { phrase: 'dizzy', key: 'syncope', boost: 0.28 },
  { phrase: 'vertigo', key: 'syncope', boost: 0.28 },
  { phrase: 'دوخة', key: 'syncope', boost: 0.28 },
  { phrase: 'دوار', key: 'syncope', boost: 0.22 },
  { phrase: 'cough', key: 'urti_complaints', boost: 0.3 },
  { phrase: 'سعال', key: 'urti_complaints', boost: 0.3 },
  { phrase: 'كحة', key: 'urti_complaints', boost: 0.3 },
  { phrase: 'tinnitus', key: 'tinnitus', boost: 0.4 },
  { phrase: 'طنين', key: 'tinnitus', boost: 0.4 },
];

/** Short tokens that over-match — require longer context or reduced weight. */
const SHORT_WEAK = new Set(['صدر', 'بطن', 'ظهر', 'قدم', 'جلد', 'حرارة', 'chest', 'pain', 'fever']);

function normalizeText(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s%/.-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function termWeight(term) {
  const t = String(term || '').trim();
  if (!t) return 0;
  if (SHORT_WEAK.has(t)) return 0.35;
  if (t.length <= 2) return 0.25;
  if (t.length <= 4) return 0.55;
  if (t.includes(' ')) return Math.min(1, 0.72 + t.length * 0.01);
  return Math.min(0.95, 0.62 + t.length * 0.015);
}

function buildLexicon() {
  /** @type {Map<string, { categoryKey: string, complaintKey: string, label_en: string, label_ar: string, terms: string[] }>} */
  const map = new Map();
  for (const [categoryKey, cat] of Object.entries(CTAS_DB)) {
    for (const [complaintKey, complaint] of Object.entries(cat.complaints || {})) {
      const terms = new Set();
      if (complaint.label_en) terms.add(normalizeText(complaint.label_en));
      if (complaint.label_ar) terms.add(normalizeText(complaint.label_ar));
      terms.add(normalizeText(complaintKey.replace(/_/g, ' ')));
      for (const syn of EXTRA_SYNONYMS[complaintKey] || []) {
        terms.add(normalizeText(syn));
      }
      map.set(complaintKey, {
        categoryKey,
        complaintKey,
        label_en: complaint.label_en,
        label_ar: complaint.label_ar,
        default_ctas: complaint.default_ctas,
        complaint,
        category: cat,
        terms: [...terms].filter(Boolean),
      });
    }
  }
  return map;
}

const LEXICON = buildLexicon();

/**
 * Score one complaint entry against haystack text.
 */
function scoreEntry(entry, haystack) {
  let score = 0;
  const matched = [];
  for (const term of entry.terms) {
    if (!term || term.length < 2) continue;
    if (haystack.includes(term)) {
      const w = termWeight(term);
      if (w > score) score = w;
      matched.push(term);
      // Phrase exact-ish equality boost
      if (haystack === term || haystack.startsWith(`${term} `) || haystack.endsWith(` ${term}`)) {
        score = Math.max(score, Math.min(1, w + 0.12));
      }
    }
  }
  for (const b of DISAMBIGUATION_BOOSTS) {
    if (b.key === entry.complaintKey && haystack.includes(normalizeText(b.phrase))) {
      score = Math.min(1, Math.max(score, 0.5) + b.boost);
      matched.push(b.phrase);
    }
  }
  // Penalize stroke when heat stroke present
  if (entry.complaintKey === 'stroke_cva' && /heat\s*stroke|heatstroke|ضربة\s*شمس/.test(haystack)) {
    score = Math.min(score, 0.25);
  }
  // Penalize fever when hay fever / nasal
  if (entry.complaintKey === 'fever' && /hay\s*fever|nasal\s*congestion|احتقان/.test(haystack)) {
    score = Math.min(score, 0.2);
  }
  // Prefer non-cardiac when explicitly stated
  if (entry.complaintKey === 'chest_pain_cardiac' && /no\s*cardiac|non[-\s]?cardiac|غير\s*قلبي/.test(haystack)) {
    score = Math.min(score, 0.35);
  }
  return { score: Math.round(score * 1000) / 1000, matched_terms: [...new Set(matched)] };
}

/**
 * Resolve chief complaint from free text + conversation.
 * @param {{
 *   chiefComplaint?: string|null,
 *   transcript?: string|null,
 *   confirmedKey?: string|null,
 *   maxCandidates?: number,
 * }} opts
 */
export function resolveChiefComplaint({
  chiefComplaint = '',
  transcript = '',
  confirmedKey = null,
  maxCandidates = 3,
} = {}) {
  const complaintText = normalizeText(chiefComplaint);
  const tx = normalizeText(transcript);
  // Weight complaint field higher by duplicating it in haystack
  const haystack = [complaintText, complaintText, tx].filter(Boolean).join(' ').trim();

  if (confirmedKey && LEXICON.has(confirmedKey)) {
    const entry = LEXICON.get(confirmedKey);
    const selected = {
      complaintKey: entry.complaintKey,
      categoryKey: entry.categoryKey,
      label_en: entry.label_en,
      label_ar: entry.label_ar,
      default_ctas: entry.default_ctas,
      confidence: 1,
      matched_terms: ['provider_confirmed'],
      complaint: entry.complaint,
      category: entry.category,
    };
    return {
      status: 'confirmed',
      selected,
      candidates: [selected],
      needs_confirmation: false,
      version: COMPLAINT_RESOLVER_VERSION,
      haystack_preview: haystack.slice(0, 120),
    };
  }

  if (!haystack) {
    return {
      status: 'unmapped',
      selected: null,
      candidates: [],
      needs_confirmation: true,
      version: COMPLAINT_RESOLVER_VERSION,
      haystack_preview: '',
    };
  }

  const scored = [];
  for (const entry of LEXICON.values()) {
    const { score, matched_terms } = scoreEntry(entry, haystack);
    if (score <= 0) continue;
    scored.push({
      complaintKey: entry.complaintKey,
      categoryKey: entry.categoryKey,
      label_en: entry.label_en,
      label_ar: entry.label_ar,
      default_ctas: entry.default_ctas,
      confidence: score,
      matched_terms,
      complaint: entry.complaint,
      category: entry.category,
    });
  }

  scored.sort((a, b) => b.confidence - a.confidence || a.complaintKey.localeCompare(b.complaintKey));
  const candidates = scored.slice(0, Math.max(1, maxCandidates));
  const top = candidates[0] || null;
  const second = candidates[1] || null;
  const margin = top && second ? top.confidence - second.confidence : (top ? 1 : 0);

  // Uncommon wording mapped only via rare synonyms → ask provider (do not guess silently)
  const RARE_CONFIRM_TERMS = [
    'dizziness', 'dizzy', 'vertigo', 'دوخة', 'دوار',
    'cough', 'سعال', 'كحة',
    'neck pain', 'ألم الرقبة',
    'tinnitus', 'طنين',
    'flank pain', 'ألم خاصرة',
  ];
  const rareOnly = !!(top && top.matched_terms?.length
    && top.matched_terms.every((t) => RARE_CONFIRM_TERMS.some((r) => normalizeText(t).includes(normalizeText(r)) || normalizeText(r).includes(normalizeText(t)))));

  // Prefer clearer winner; also auto-select when top is confidently more urgent than #2
  // (safety: do not defer cardiac chest pain to confirmation when SOB is a close second).
  const topMoreUrgent = !!(top && second
    && Number(top.default_ctas) < Number(second.default_ctas)
    && top.confidence >= AUTO_MIN);
  const clearWinner = !!(top && top.confidence >= AUTO_MIN && margin >= AUTO_MARGIN);

  if (top && !rareOnly && (clearWinner || topMoreUrgent)) {
    return {
      status: 'auto',
      selected: top,
      candidates,
      needs_confirmation: false,
      version: COMPLAINT_RESOLVER_VERSION,
      haystack_preview: haystack.slice(0, 120),
      margin: Math.round(margin * 1000) / 1000,
      auto_reason: topMoreUrgent && !clearWinner ? 'higher_acuity_tiebreak' : 'clear_winner',
    };
  }

  if (top && top.confidence >= 0.45) {
    return {
      status: 'needs_confirmation',
      selected: null,
      candidates,
      needs_confirmation: true,
      // Provisional acuity floor = most urgent candidate default (primary safety)
      provisional_default_ctas: candidates.reduce(
        (min, c) => Math.min(min, Number(c.default_ctas) || 5),
        5,
      ),
      version: COMPLAINT_RESOLVER_VERSION,
      haystack_preview: haystack.slice(0, 120),
      margin: Math.round(margin * 1000) / 1000,
    };
  }

  return {
    status: 'unmapped',
    selected: null,
    candidates: candidates.filter((c) => c.confidence >= 0.3).slice(0, maxCandidates),
    needs_confirmation: true,
    version: COMPLAINT_RESOLVER_VERSION,
    haystack_preview: haystack.slice(0, 120),
  };
}

/**
 * Lookup CTAS_DB entry by complaintKey.
 */
export function getComplaintByKey(complaintKey) {
  if (!complaintKey || !LEXICON.has(complaintKey)) return null;
  const entry = LEXICON.get(complaintKey);
  return {
    categoryKey: entry.categoryKey,
    complaintKey: entry.complaintKey,
    category: entry.category,
    complaint: entry.complaint,
  };
}

/**
 * Backward-compatible match: only returns a hit when auto/confirmed (no silent low-confidence guess).
 * @param {string} chiefComplaint
 * @param {{ transcript?: string, confirmedKey?: string|null }} [opts]
 */
export function matchComplaint(chiefComplaint, opts = {}) {
  if (!chiefComplaint && !opts?.confirmedKey) return null;
  const resolution = resolveChiefComplaint({
    chiefComplaint: chiefComplaint || '',
    transcript: opts.transcript || '',
    confirmedKey: opts.confirmedKey || null,
  });
  if (resolution.selected) {
    const sel = resolution.selected;
    return {
      categoryKey: sel.categoryKey,
      complaintKey: sel.complaintKey,
      category: sel.category || CTAS_DB[sel.categoryKey],
      complaint: sel.complaint || CTAS_DB[sel.categoryKey]?.complaints?.[sel.complaintKey],
      confidence: sel.confidence,
      resolution,
    };
  }
  if (opts.confirmedKey) return getComplaintByKey(opts.confirmedKey);
  return null;
}

// Clause markers for findComplaintMentions.
const NEGATION_CUE = /(?:^|\s)(?:no|not|non|denies|denied|without|negative for|free of|لا|ليس|ليست|بدون|ينفي|تنفي|ما\s*في|ما\s*عنده|ما\s*عندها|مافي|ماعنده|ما\s*يشكو|غير\s*موجود)(?:\s|$)/;
const HISTORY_CUE = /(?:^|\s)(?:history of|past history|known case of|known case|known|previous|previously|prior|on treatment for|medications?|meds|takes|taking|allerg\w*|تاريخ(?:\s*مرضي)?|سابق(?:اً|ا)?|معروف|مريض\s+(?:سكري|ضغط|قلب|ربو)|يستخدم|يتناول|أدوية|حساسية)(?:\s|$)/;

/**
 * Every distinct complaint mentioned in a transcript, in order of first mention.
 * Negated mentions ("no fever") and history clauses ("history of stroke") are skipped,
 * so a chronic illness is never turned into a presenting complaint. Ambiguous phrases
 * are resolved against their own clause (e.g. "chest pain … non cardiac").
 * @param {string} text
 * @returns {Array<{ complaintKey: string, categoryKey: string, label_en: string, label_ar: string, default_ctas: number, term: string, clause: string }>}
 */
/** Index of `term` as a whole word (Arabic و/ب/ف/ل/ال prefixes and English plural allowed), or -1. */
function wordAt(clause, term) {
  const arabic = /[\u0600-\u06FF]/.test(term);
  let from = 0;
  while (from <= clause.length) {
    const at = clause.indexOf(term, from);
    if (at < 0) return -1;
    const end = at + term.length;
    let start = at;
    if (arabic) {
      if (clause.slice(Math.max(0, start - 2), start) === 'ال') start -= 2;
      if (start > 0 && 'وبفل'.includes(clause[start - 1]) && (start - 1 === 0 || clause[start - 2] === ' ')) start -= 1;
    }
    const okBefore = start === 0 || clause[start - 1] === ' ';
    const after = clause.slice(end);
    const okAfter = after === '' || after[0] === ' ' || (!arabic && /^(?:s|es)(?:\s|$)/.test(after));
    if (okBefore && okAfter) return at;
    from = at + 1;
  }
  return -1;
}

export function findComplaintMentions(text) {
  const clauses = String(text || '')
    .split(/[.!?؟،,;:\n]+|\s(?:and|also|plus|then|with|ومعه|ومعها|وأيضاً|وايضا|كذلك)\s/i)
    .map((c) => normalizeText(c))
    .filter(Boolean);
  const out = [];
  const seen = new Set();
  for (const clause of clauses) {
    if (HISTORY_CUE.test(` ${clause} `)) continue;
    // Terms present in this clause, longest first; a term inside a longer hit is skipped.
    const hits = [];
    for (const entry of LEXICON.values()) {
      for (const term of entry.terms) {
        if (!term || term.length < 3 || SHORT_WEAK.has(term) || termWeight(term) < 0.55) continue;
        const at = wordAt(clause, term);
        if (at >= 0) hits.push({ entry, term, at, end: at + term.length });
      }
    }
    hits.sort((a, b) => (b.end - b.at) - (a.end - a.at) || a.at - b.at);
    const taken = [];
    for (const h of hits) {
      if (taken.some((t) => h.at < t.end && h.end > t.at && (t.term !== h.term))) continue;
      // Words before the term in the same clause: a negation there rules it out.
      const before = clause.slice(Math.max(0, h.at - 30), h.at);
      if (NEGATION_CUE.test(` ${before} `)) continue;
      taken.push(h);
    }
    // Same phrase can belong to several complaints: score each against the clause.
    const byTerm = new Map();
    for (const h of taken) {
      const scored = scoreEntry(h.entry, clause).score;
      const cur = byTerm.get(`${h.at}:${h.term}`);
      if (!cur || scored > cur.scored) byTerm.set(`${h.at}:${h.term}`, { ...h, scored });
    }
    for (const h of [...byTerm.values()].sort((a, b) => a.at - b.at)) {
      if (seen.has(h.entry.complaintKey)) continue;
      seen.add(h.entry.complaintKey);
      out.push({
        complaintKey: h.entry.complaintKey,
        categoryKey: h.entry.categoryKey,
        label_en: h.entry.label_en,
        label_ar: h.entry.label_ar,
        default_ctas: h.entry.default_ctas,
        term: h.term,
        clause,
      });
    }
  }
  // An allergic reaction happening NOW is a complaint, not history: "allergic reaction",
  // hives / urticaria, anaphylaxis, or a rash / swelling soon after a food, medicine,
  // injection or sting (approved 2026-10-16). "Allergic to penicillin" stays history.
  if (!seen.has('allergic_reaction')) {
    const t = normalizeText(text);
    const statedNow = ACUTE_ALLERGY.test(t) && !/(?:no|not|denies|without|لا|بدون|ما\s*في)\s+(?:\S+\s+){0,2}?(?:allergic\s+reaction|hives|urticaria|تفاعل\s+تحسسي|شرى)/i.test(t);
    const afterExposure = RASH_OR_SWELLING.test(t) && EXPOSURE_TRIGGER.test(t);
    const entry = [...LEXICON.values()].find((e) => e.complaintKey === 'allergic_reaction');
    if (entry && (statedNow || afterExposure)) {
      out.push({
        complaintKey: entry.complaintKey,
        categoryKey: entry.categoryKey,
        label_en: entry.label_en,
        label_ar: entry.label_ar,
        default_ctas: entry.default_ctas,
        term: statedNow ? 'allergic reaction' : 'rash after exposure',
        clause: t.slice(0, 120),
      });
    }
  }
  return out;
}

const ACUTE_ALLERGY = /allergic\s+reaction|hives|urticaria|anaphyla\w*|تفاعل\s+تحسسي|شرى|ارتكاريا|صدمة\s+تحسسية|تأق/i;
const RASH_OR_SWELLING = /rash|eruption|hives|wheals?|swelling|itch\w*|طفح|حبوب|حكة|حكه|هرش|تورم|انتفاخ/i;
const EXPOSURE_TRIGGER = /after\s+(?:eating|taking|the\s+)?\s*(?:injection|vaccine|medicine|medication|antibiotic|food|nuts?|peanuts?|egg|milk|fish|shellfish|sting|bite|dose|\w+\s+injection)|after\s+(?:an?\s+)?injection|following\s+(?:an?\s+)?(?:injection|dose|vaccine)|بعد\s+(?:ما\s+)?(?:أكل|اكل|تناول|أخذ|اخذ|الإبرة|الابرة|إبرة|ابرة|حقنة|الحقنة|التطعيم|تطعيم|الدواء|دواء|المضاد|مضاد|لدغة|قرصة|المكسرات|الفول)/i;

/**
 * Flat list of all complaints for search UI.
 */
export function listAllComplaints() {
  return [...LEXICON.values()].map((e) => ({
    complaintKey: e.complaintKey,
    categoryKey: e.categoryKey,
    label_en: e.label_en,
    label_ar: e.label_ar,
    default_ctas: e.default_ctas,
  }));
}
