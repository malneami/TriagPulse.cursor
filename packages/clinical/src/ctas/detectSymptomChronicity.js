/**
 * Conversation-first symptom chronicity detection.
 * States: new | acute_on_chronic | worse_than_baseline | chronic_unchanged | uncertain
 */

/** @typedef {'new'|'acute_on_chronic'|'worse_than_baseline'|'chronic_unchanged'|'uncertain'} SymptomChronicity */

export const SYMPTOM_CHRONICITY_VERSION = '1.0.0';

const OPTION_MAP = {
  new: 'new',
  acute: 'new',
  acute_new: 'new',
  'حاد': 'new',
  'جديد': 'new',
  acute_on_chronic: 'acute_on_chronic',
  exacerbation: 'acute_on_chronic',
  flare: 'acute_on_chronic',
  worse_than_baseline: 'worse_than_baseline',
  worse: 'worse_than_baseline',
  chronic_unchanged: 'chronic_unchanged',
  chronic_stable: 'chronic_unchanged',
  baseline_unchanged: 'chronic_unchanged',
  chronic: 'chronic_unchanged',
  uncertain: 'uncertain',
  unknown: 'uncertain',
};

function normalizeAnswer(v) {
  return String(v ?? '').toLowerCase().trim();
}

function mapAnswerToState(raw) {
  const t = normalizeAnswer(raw);
  if (!t) return null;
  if (OPTION_MAP[t]) return OPTION_MAP[t];
  if (/acute\s*on\s*chronic|exacerbat|flare|على\s*مزمن|تفاقم/.test(t)) return 'acute_on_chronic';
  if (/worse|أسوأ|different\s+from|تغير|increased|زاد/.test(t) && /baseline|usual|معتاد|مزمن|chronic/.test(t)) {
    return 'worse_than_baseline';
  }
  if (/worse|أسوأ|increased|زاد/.test(t)) return 'worse_than_baseline';
  if (/chronic\s*unchanged|same\s+as\s+(?:usual|baseline)|baseline\s*unchanged|مزمن\s*(?:بدون|دون)\s*تغير|نفس\s*(?:المعتاد|خط\s*الأساس)/.test(t)) {
    return 'chronic_unchanged';
  }
  if (/^chronic|مزمن/.test(t) && !/worse|أسوأ|exacerb|تفاقم/.test(t)) return 'chronic_unchanged';
  if (/^new|first\s+time|suddenly|جديد|لأول\s*مرة|حاد(?!\s*on)/.test(t)) return 'new';
  if (/uncertain|غير\s*واضح|غير\s*معلوم|unknown/.test(t)) return 'uncertain';
  // Pain duration type legacy
  if (/chronic|مزمن/.test(t)) return 'chronic_unchanged';
  if (/acute|حاد/.test(t)) return 'new';
  return null;
}

/**
 * Regex cues in conversation (ordered by specificity).
 * @returns {{ status: SymptomChronicity, confidence: number, matched?: string }|null}
 */
function detectFromText(text) {
  const tx = String(text || '');
  if (!tx.trim()) return null;

  const rules = [
    {
      status: 'acute_on_chronic',
      confidence: 0.88,
      re: /acute\s*on\s*chronic|acute-on-chronic|exacerbat(?:ion|ed)?|flare[-\s]?up|on\s+top\s+of\s+(?:usual|baseline)|تفاقم|حاد\s*على\s*مزمن/i,
    },
    {
      status: 'worse_than_baseline',
      confidence: 0.86,
      re: /worse\s+than\s+(?:usual|baseline|normal)|worse\s+than\s+the\s+patient'?s\s+usual|increased\s+from\s+baseline|أسوأ\s+من\s+(?:المعتاد|خط\s*الأساس)|زاد\s+عن\s*المعتاد/i,
    },
    {
      status: 'chronic_unchanged',
      confidence: 0.86,
      re: /chronic\s+unchanged|same\s+as\s+(?:usual|baseline|always)|usual\s+for\s+(?:me|him|her|the\s+patient)|baseline\s+unchanged|at\s+(?:his|her|their|my)\s+baseline|normally\s+(?:around|about)|مزمن\s*(?:بدون|دون)\s*تغير|نفس\s*المعتاد|خط\s*الأساس\s*(?:دون|بدون)\s*تغير|معتاد\s*(?:لديه|لديها|له)/i,
    },
    {
      status: 'new',
      confidence: 0.84,
      re: /\bnew\s+(?:symptom|onset|pain|complaint)\b|first\s+time|never\s+had|suddenly\s+started|acute\s+onset|جديد(?:ة)?|لأول\s*مرة|بدأ\s*فجأة|ظهور\s*حاد/i,
    },
    {
      status: 'worse_than_baseline',
      confidence: 0.72,
      re: /\bworse\b|worsening|getting\s+worse|أسوأ|يزداد|يتفاقم/i,
    },
    {
      status: 'chronic_unchanged',
      confidence: 0.7,
      re: /\bchronic\b(?!\s*on)|longstanding|long[- ]standing|مزمن(?!\s*على)/i,
    },
  ];

  for (const rule of rules) {
    const m = tx.match(rule.re);
    if (m) return { status: rule.status, confidence: rule.confidence, matched: m[0] };
  }
  return null;
}

/**
 * Whether chronicity could change CTAS for this encounter.
 */
export function chronicityCanChangeCtas({ patient = {}, answers = {}, pathway = '' } = {}) {
  const pain = parseFloat(patient.pain_score ?? answers.pain_score);
  const spo2 = parseFloat(patient.spo2 ?? answers.spo2);
  const hr = parseFloat(patient.hr ?? answers.hr);
  const rr = parseFloat(patient.rr ?? answers.rr);
  const temp = parseFloat(patient.temperature ?? answers.temperature);
  const p = String(pathway || patient.confirmed_complaint_key || '');

  if (Number.isFinite(pain) && pain >= 4) return true;
  if (Number.isFinite(spo2) && spo2 < 95) return true;
  if (Number.isFinite(hr) && (hr > 100 || hr < 50)) return true;
  if (Number.isFinite(rr) && (rr > 22 || rr < 10)) return true;
  if (Number.isFinite(temp) && temp >= 38) return true;
  if (/weakness|dyspnea|shortness|fever|chest_pain|syncope|stroke|general_weakness|headache|abdominal/i.test(p)) {
    return true;
  }
  if (/weakness|ضيق|حمى|صداع|ألم|dizziness|دوخة/i.test(String(patient.chief_complaint || ''))) {
    return true;
  }
  return false;
}

/**
 * @param {{
 *   patient?: Record<string, unknown>,
 *   answers?: Record<string, unknown>,
 *   transcript?: string,
 * }} opts
 * @returns {{
 *   status: SymptomChronicity,
 *   source: 'provider'|'answer'|'transcript'|'pain_duration'|'uncertain',
 *   confidence: number,
 *   question_needed: boolean,
 *   matched?: string|null,
 *   version: string,
 * }}
 */
export function detectSymptomChronicity({
  patient = {},
  answers = {},
  transcript = '',
} = {}) {
  // Provider-set on patient wins
  if (patient.symptom_chronicity && patient.symptom_chronicity !== 'uncertain') {
    const mapped = mapAnswerToState(patient.symptom_chronicity) || patient.symptom_chronicity;
    if (['new', 'acute_on_chronic', 'worse_than_baseline', 'chronic_unchanged'].includes(mapped)) {
      return {
        status: mapped,
        source: patient.symptom_chronicity_source === 'provider' ? 'provider' : 'provider',
        confidence: 1,
        question_needed: false,
        matched: null,
        version: SYMPTOM_CHRONICITY_VERSION,
      };
    }
  }

  // Explicit answers
  const answerKeys = [
    'symptom_chronicity',
    'vital_chronicity',
    'hr_chronicity',
    'worse_than_baseline',
    'chronic_stable',
    'baseline_unchanged',
    'acute_new',
    'pain_duration_type',
  ];
  for (const key of answerKeys) {
    const raw = answers[key];
    if (raw == null || raw === '') continue;
    // Boolean-ish flags
    if (key === 'worse_than_baseline' && /^(yes|true|نعم)/i.test(String(raw))) {
      return {
        status: 'worse_than_baseline',
        source: 'answer',
        confidence: 1,
        question_needed: false,
        matched: key,
        version: SYMPTOM_CHRONICITY_VERSION,
      };
    }
    if ((key === 'chronic_stable' || key === 'baseline_unchanged') && /^(yes|true|نعم)/i.test(String(raw))) {
      return {
        status: 'chronic_unchanged',
        source: 'answer',
        confidence: 1,
        question_needed: false,
        matched: key,
        version: SYMPTOM_CHRONICITY_VERSION,
      };
    }
    if (key === 'acute_new' && /^(yes|true|نعم)/i.test(String(raw))) {
      return {
        status: 'new',
        source: 'answer',
        confidence: 1,
        question_needed: false,
        matched: key,
        version: SYMPTOM_CHRONICITY_VERSION,
      };
    }
    const mapped = mapAnswerToState(raw);
    if (mapped && mapped !== 'uncertain') {
      return {
        status: mapped,
        source: key === 'pain_duration_type' ? 'pain_duration' : 'answer',
        confidence: 1,
        question_needed: false,
        matched: String(raw),
        version: SYMPTOM_CHRONICITY_VERSION,
      };
    }
  }

  const corpus = [
    transcript,
    patient.transcription,
    patient.onset_duration,
    patient.chief_complaint,
    patient.relevant_history,
  ].filter(Boolean).join(' \n ');

  const fromText = detectFromText(corpus);
  if (fromText && fromText.confidence >= 0.75) {
    return {
      status: fromText.status,
      source: 'transcript',
      confidence: fromText.confidence,
      question_needed: false,
      matched: fromText.matched,
      version: SYMPTOM_CHRONICITY_VERSION,
    };
  }

  const canChange = chronicityCanChangeCtas({ patient, answers, pathway: patient.confirmed_complaint_key });
  return {
    status: fromText?.status || 'uncertain',
    source: 'uncertain',
    confidence: fromText?.confidence || 0,
    question_needed: canChange,
    matched: fromText?.matched || null,
    version: SYMPTOM_CHRONICITY_VERSION,
  };
}

/** Clarifying question payload for the bank / pipeline. */
export function getChronicityClarifyingQuestion() {
  return {
    id: 'symptom_chronicity_baseline',
    field: 'symptom_chronicity',
    category: 'ctas_modifier',
    pathways: ['*'],
    text_en: 'Is this new or different from the patient’s usual baseline?',
    text_ar: 'هل هذا جديد أو مختلف عن خط الأساس المعتاد للمريض؟',
    options: [
      { value: 'new', label_en: 'New / first time', label_ar: 'جديد / لأول مرة' },
      { value: 'acute_on_chronic', label_en: 'Acute on chronic / flare', label_ar: 'حاد على مزمن / تفاقم' },
      { value: 'worse_than_baseline', label_en: 'Worse than usual baseline', label_ar: 'أسوأ من المعتاد' },
      { value: 'chronic_unchanged', label_en: 'Chronic unchanged / same as baseline', label_ar: 'مزمن بدون تغير' },
      { value: 'uncertain', label_en: 'Uncertain', label_ar: 'غير واضح' },
    ],
    why_ask_en: 'Chronic stable findings must not be scored as acute; new/worsening findings influence CTAS.',
    why_ask_ar: 'الموجودات المزمنة المستقرة لا تُعامل كحادّة؛ الجديد أو المتفاقم يؤثر على CTAS.',
    clinical_relevance: 'Symptom chronicity gate for pain, hypoxia, and hemodynamic upgrades',
  };
}

export function isChronicUnchanged(status) {
  return status === 'chronic_unchanged';
}

export function isAcuteAcuity(status) {
  return status === 'new' || status === 'acute_on_chronic' || status === 'worse_than_baseline';
}
