/**
 * Known-facts engine — conversation + form → structured clinical fact statuses.
 * Used to suppress clarifying questions and surface detected information.
 */

/**
 * @typedef {'known_positive'|'known_negative'|'probable'|'unknown'|'uncertain'|'not_applicable'} FactStatus
 * @typedef {{
 *   field: string,
 *   status: FactStatus,
 *   value?: string|null,
 *   label_en?: string,
 *   label_ar?: string,
 *   source?: string,
 *   confidence?: number,
 * }} KnownFact
 */

const YES = 'نعم';
const NO = 'لا';

/** Extra cues beyond modifier detect_patterns (diabetes, stent, home O₂, chronic weakness). */
const EXTRA_FACT_RULES = [
  {
    field: 'diabetes',
    label_en: 'Diabetes',
    label_ar: 'سكري',
    positive: [/\bdiabet\w*\b/i, /سكري/],
    probable_meds: [/insulin|metformin|إنسولين|متفورمين/i],
  },
  {
    field: 'prior_coronary_intervention',
    label_en: 'Prior coronary intervention / stent',
    label_ar: 'قسطرة / دعامة سابقة',
    positive: [/\bstent\b|\bcabg\b|angioplasty|قسطرة|دعامة/i],
  },
  {
    field: 'home_oxygen',
    label_en: 'Home oxygen / chronic hypoxia baseline',
    label_ar: 'أكسجين منزلي / نقص أكسجين مزمن',
    positive: [/home\s+oxygen|on\s+o2\s+at\s+home|أكسجين\s*منزلي|دائماً?\s*(?:حوالي|حول)?\s*\d{2}\s*%/i],
  },
  {
    field: 'chronic_weakness_baseline',
    label_en: 'Chronic neurological weakness (baseline)',
    label_ar: 'ضعف عصبي مزمن (خط الأساس)',
    positive: [
      /(?:previous|prior|old)\s+stroke.*(?:weakness|deficit)/i,
      /normally\s+have\s+weakness|usual\s+(?:left|right)\s+(?:sided\s+)?weakness/i,
      /ضعف\s*(?:مزمن|دائم|معتاد)|سكتة\s*سابقة.*ضعف/i,
    ],
  },
  {
    field: 'return_visit_72h',
    label_en: 'Return visit within 72 hours',
    label_ar: 'مراجعة خلال 72 ساعة',
    positive: [
      /(?:was|were)\s+here\s+(?:yesterday|two\s+days?\s+ago)/i,
      /discharged\s+yesterday|came\s+back\s+because/i,
      /return(?:ed)?\s+(?:visit|within)/i,
      /كنت\s+هنا\s+(?:أمس|قبل\s+يومين)|خرجت\s+أمس/i,
    ],
  },
];

function buildContext(patient = {}, answers = {}, transcript = '', visualTriage = null) {
  const parts = [
    transcript,
    patient.chief_complaint,
    patient.transcription,
    patient.relevant_history,
    patient.allergies,
    patient.current_medications,
    answers._transcript,
    visualTriage?.destination,
    visualTriage?.section_a_summary,
    ...Object.entries(answers || {})
      .filter(([k]) => !k.startsWith('_'))
      .map(([k, v]) => `${k}: ${v}`),
  ];
  if (Array.isArray(patient.current_medications)) {
    parts.push(patient.current_medications.join(' '));
  }
  return parts.filter(Boolean).join(' \n ');
}

function statusFromDetection({ known, value, source }) {
  if (!known) return { status: 'unknown', value: null, source: null, confidence: 0 };
  if (source === 'medication') {
    return { status: 'probable', value: value || YES, source, confidence: 0.75 };
  }
  if (source === 'transcript_negated' || value === NO || /^no$/i.test(String(value))) {
    return { status: 'known_negative', value: NO, source, confidence: 0.9 };
  }
  return { status: 'known_positive', value: value || YES, source, confidence: source === 'answers' ? 1 : 0.88 };
}

/**
 * Build a map of field → KnownFact from conversation, form, answers, and visual triage.
 * @param {{
 *   patient?: object,
 *   transcript?: string,
 *   answers?: object,
 *   visualTriage?: object|null,
 *   modifiers?: Array<{ field: string, name?: string, name_ar?: string, detect_patterns?: RegExp[], related_medications?: RegExp[] }>,
 * }} opts
 */
export function buildKnownFacts({
  patient = {},
  transcript = '',
  answers = {},
  visualTriage = null,
  modifiers = [],
} = {}) {
  /** @type {Record<string, KnownFact>} */
  const facts = {};
  const ctx = buildContext(patient, answers, transcript, visualTriage);
  const ctxLower = ctx.toLowerCase();

  const upsert = (field, fact) => {
    const prev = facts[field];
    const rank = {
      known_positive: 5,
      known_negative: 5,
      not_applicable: 4,
      probable: 3,
      uncertain: 2,
      unknown: 1,
    };
    if (!prev || (rank[fact.status] || 0) >= (rank[prev.status] || 0)) {
      facts[field] = { field, ...fact };
    }
  };

  // Answers / patient fields first
  for (const mod of modifiers) {
    if (!mod?.field) continue;
    if (answers[mod.field] != null && answers[mod.field] !== '') {
      const v = String(answers[mod.field]);
      upsert(mod.field, {
        status: YES_RE_LOCAL.test(v) ? 'known_positive' : (NO_RE_LOCAL.test(v) ? 'known_negative' : 'known_positive'),
        value: v,
        label_en: mod.name,
        label_ar: mod.name_ar,
        source: 'answers',
        confidence: 1,
      });
      continue;
    }
    if (patient[mod.field] != null && patient[mod.field] !== '') {
      upsert(mod.field, {
        status: 'known_positive',
        value: String(patient[mod.field]),
        label_en: mod.name,
        label_ar: mod.name_ar,
        source: 'patient',
        confidence: 0.95,
      });
    }
  }

  // Modifier pattern detection
  for (const mod of modifiers) {
    if (!mod?.field || facts[mod.field]?.status === 'known_positive' || facts[mod.field]?.status === 'known_negative') {
      continue;
    }
    let hit = null;
    for (const re of mod.detect_patterns || []) {
      if (re.test(ctx)) {
        const negated = new RegExp(`(?:no|not|denies|بدون|لا\\s*(?:يوجد)?|ينفي).{0,24}(?:${re.source})`, 'i');
        if (negated.test(ctx)) {
          hit = { known: true, value: NO, source: 'transcript_negated' };
        } else {
          hit = { known: true, value: YES, source: 'transcript' };
        }
        break;
      }
    }
    if (!hit) {
      for (const re of mod.related_medications || []) {
        if (re.test(ctx)) {
          hit = { known: true, value: YES, source: 'medication' };
          break;
        }
      }
    }
    if (hit) {
      const st = statusFromDetection(hit);
      upsert(mod.field, {
        ...st,
        label_en: mod.name,
        label_ar: mod.name_ar,
      });
    }
  }

  // Extra clinical facts
  for (const rule of EXTRA_FACT_RULES) {
    if (facts[rule.field]?.status === 'known_positive' || facts[rule.field]?.status === 'known_negative') {
      continue;
    }
    if (rule.positive.some((re) => re.test(ctx))) {
      upsert(rule.field, {
        status: 'known_positive',
        value: YES,
        label_en: rule.label_en,
        label_ar: rule.label_ar,
        source: 'transcript',
        confidence: 0.9,
      });
      // Map stent/diabetes onto prior_cardiac_history for suppression
      if (rule.field === 'diabetes' || rule.field === 'prior_coronary_intervention') {
        upsert('prior_cardiac_history', {
          status: 'known_positive',
          value: YES,
          label_en: 'Prior cardiac disease or diabetes',
          label_ar: 'مرض قلبي سابق أو سكري',
          source: 'transcript',
          confidence: 0.9,
        });
      }
      continue;
    }
    if (rule.probable_meds?.some((re) => re.test(ctx))) {
      upsert(rule.field, {
        status: 'probable',
        value: YES,
        label_en: rule.label_en,
        label_ar: rule.label_ar,
        source: 'medication',
        confidence: 0.75,
      });
      if (rule.field === 'diabetes') {
        upsert('prior_cardiac_history', {
          status: 'probable',
          value: YES,
          label_en: 'Prior cardiac disease or diabetes',
          label_ar: 'مرض قلبي سابق أو سكري',
          source: 'medication',
          confidence: 0.75,
        });
      }
    }
  }

  // Baseline SpO₂ mention: "always around 89%"
  const baselineSpo2 = ctx.match(/(?:always|normally|baseline|دائماً?|عادة)\s*(?:around|about|حوالي|حول)?\s*(\d{2})\s*%/i);
  if (baselineSpo2) {
    upsert('baseline_spo2', {
      status: 'known_positive',
      value: baselineSpo2[1],
      label_en: `Reported baseline SpO₂ ~${baselineSpo2[1]}%`,
      label_ar: `تشبع أكسجين أساسي ≈ ${baselineSpo2[1]}%`,
      source: 'transcript',
      confidence: 0.85,
    });
  }

  // Chief complaint as fact
  if (patient.chief_complaint) {
    upsert('chief_complaint', {
      status: 'known_positive',
      value: String(patient.chief_complaint),
      label_en: 'Chief complaint',
      label_ar: 'الشكوى الرئيسية',
      source: 'patient',
      confidence: 1,
    });
  }

  // Symptom chronicity — suppress re-asking when already known
  const chronAnswer = answers.symptom_chronicity || patient.symptom_chronicity;
  if (chronAnswer && chronAnswer !== 'uncertain') {
    upsert('symptom_chronicity', {
      status: 'known_positive',
      value: String(chronAnswer),
      label_en: 'Symptom chronicity',
      label_ar: 'زمن/مزمنة الأعراض',
      source: patient.symptom_chronicity_source === 'provider' ? 'answers' : 'patient',
      confidence: 1,
    });
  } else {
    const chronCue = /acute\s*on\s*chronic|worse\s+than\s+(?:usual|baseline)|same\s+as\s+(?:usual|baseline)|chronic\s+unchanged|أسوأ\s+من\s+المعتاد|مزمن\s*(?:بدون|دون)\s*تغير|لأول\s*مرة/i.test(ctx);
    if (chronCue) {
      upsert('symptom_chronicity', {
        status: 'known_positive',
        value: YES,
        label_en: 'Symptom chronicity stated in conversation',
        label_ar: 'زمن الأعراض مذكور في المحادثة',
        source: 'transcript',
        confidence: 0.85,
      });
    }
  }

  return facts;
}

const YES_RE_LOCAL = /^(نعم|yes|true|1)$/i;
const NO_RE_LOCAL = /^(لا|no|false|0)$/i;

/** @param {Record<string, KnownFact>} facts @param {string} field */
export function getFact(facts, field) {
  return facts?.[field] || { field, status: 'unknown', value: null };
}

/**
 * Whether a clarifying question should be suppressed for this fact.
 * Probable facts are suppressed for patient_direction; CTAS/safety may still ask to confirm.
 */
export function shouldSuppressQuestion(fact, questionCategory = 'ctas_modifier') {
  if (!fact || fact.status === 'unknown' || fact.status === 'uncertain') return false;
  if (fact.status === 'not_applicable') return true;
  if (fact.status === 'known_positive' || fact.status === 'known_negative') return true;
  if (fact.status === 'probable') {
    // Confirm only for high-stakes CTAS/safety
    return questionCategory === 'patient_direction';
  }
  return false;
}

/** Compact list for UI / audit. */
export function summarizeKnownFacts(facts = {}) {
  return Object.values(facts)
    .filter((f) => f.status !== 'unknown')
    .map((f) => ({
      field: f.field,
      status: f.status,
      value: f.value,
      label_en: f.label_en || f.field,
      label_ar: f.label_ar || f.field,
      source: f.source,
    }));
}
