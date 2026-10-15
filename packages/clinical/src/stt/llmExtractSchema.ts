/** JSON schema + prompt helpers for OpenAI structured CTAS field extraction. */

import type { CtasFieldKey } from './ctasFieldSchema';

export const LLM_CTAS_PATIENT_KEYS = [
  'patient_name_ar',
  'patient_name_en',
  'age',
  'chief_complaint',
  'pain_score',
  'hr',
  'bp_systolic',
  'bp_diastolic',
  'spo2',
  'rr',
  'temperature',
  'gcs',
] as const;

export type LlmCtasPatientKey = (typeof LLM_CTAS_PATIENT_KEYS)[number];

export interface LlmCtasExtractResult {
  patient_name_ar: string | null;
  patient_name_en: string | null;
  age: string | null;
  chief_complaint: string | null;
  pain_score: number | null;
  hr: string | null;
  bp_systolic: string | null;
  bp_diastolic: string | null;
  spo2: string | null;
  rr: string | null;
  temperature: string | null;
  gcs: string | null;
  field_confidence: Partial<Record<LlmCtasPatientKey, number>>;
  /** Case details, each with the exact transcript words it came from (checked later). */
  complaints: Array<{ text: string; evidence: string }>;
  conditions: Array<{ name: string; status: 'present' | 'absent'; evidence: string }>;
  medications: Array<{ name: string; evidence: string }>;
}

const CONFIDENCE_KEYS = [
  'patient_name_ar', 'patient_name_en', 'age', 'chief_complaint', 'pain_score',
  'hr', 'bp_systolic', 'bp_diastolic', 'spo2', 'rr', 'temperature', 'gcs',
] as const;

const EVIDENCE_ITEM = (props: Record<string, unknown>) => ({
  type: 'object',
  additionalProperties: false,
  properties: props,
  required: Object.keys(props),
});

export const LLM_CTAS_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    patient_name_ar: { type: ['string', 'null'] },
    patient_name_en: { type: ['string', 'null'] },
    age: { type: ['string', 'null'] },
    chief_complaint: { type: ['string', 'null'] },
    pain_score: { type: ['number', 'null'] },
    hr: { type: ['string', 'null'] },
    bp_systolic: { type: ['string', 'null'] },
    bp_diastolic: { type: ['string', 'null'] },
    spo2: { type: ['string', 'null'] },
    rr: { type: ['string', 'null'] },
    temperature: { type: ['string', 'null'] },
    gcs: { type: ['string', 'null'] },
    // Strict structured output needs every key listed and no open-ended objects.
    field_confidence: {
      type: 'object',
      additionalProperties: false,
      properties: Object.fromEntries(CONFIDENCE_KEYS.map((k) => [k, { type: ['number', 'null'] }])),
      required: [...CONFIDENCE_KEYS],
    },
    complaints: {
      type: 'array',
      items: EVIDENCE_ITEM({ text: { type: 'string' }, evidence: { type: 'string' } }),
    },
    conditions: {
      type: 'array',
      items: EVIDENCE_ITEM({
        name: { type: 'string' },
        status: { type: 'string', enum: ['present', 'absent'] },
        evidence: { type: 'string' },
      }),
    },
    medications: {
      type: 'array',
      items: EVIDENCE_ITEM({ name: { type: 'string' }, evidence: { type: 'string' } }),
    },
  },
  required: [
    'patient_name_ar', 'patient_name_en', 'age', 'chief_complaint', 'pain_score',
    'hr', 'bp_systolic', 'bp_diastolic', 'spo2', 'rr', 'temperature', 'gcs',
    'field_confidence', 'complaints', 'conditions', 'medications',
  ],
};

export function buildLlmExtractPrompt(transcript: string, missingFields: CtasFieldKey[]): string {
  const missingLabels = missingFields.join(', ') || 'none';
  return `You are a bilingual ED triage extraction assistant (Arabic + English code-switching).

Extract ONLY explicitly stated clinical facts from this triage dictation transcript.
Do NOT invent or guess vitals, age, or pain. Use null for any field not clearly spoken.
- pain_score: null unless the speaker explicitly states a pain score or "no pain" / "ألم". Never default to 0.
- age: if stated in months/weeks/days (e.g. "شهرين", "2 months"), return that phrase (e.g. "2 months") — do not convert incorrectly to years.

Missing CTAS fields to prioritize: ${missingLabels}

Transcript:
"""
${transcript.slice(0, 4000)}
"""

Also list the case details, each with "evidence": the exact words copied from the transcript (same language, no translation):
- complaints: EVERY presenting complaint or symptom the patient has now (e.g. chest pain, vomiting, fever), one item each. Not past illnesses, not negated symptoms.
- conditions: chronic illnesses / past medical history (diabetes, hypertension, asthma, sickle cell, heart disease, kidney disease, cancer, pregnancy…). status "absent" only when explicitly denied ("not diabetic", "no history of…"). Do not infer conditions from symptoms.
- medications: regular medicines the patient takes.
Use empty arrays when nothing was said. Never invent items.

Return JSON with patient_name_ar, patient_name_en, age (string), chief_complaint, pain_score (0-10 or null),
hr, bp_systolic, bp_diastolic, spo2, rr, temperature, gcs, complaints, conditions, medications, and field_confidence (0-1 per populated field).`;
}

function listOf<T>(v: unknown, map: (x: Record<string, unknown>) => T | null): T[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x) => x && typeof x === 'object')
    .map((x) => map(x as Record<string, unknown>))
    .filter((x): x is T => x != null)
    .slice(0, 20);
}

export function normalizeLlmExtractResult(raw: unknown): LlmCtasExtractResult {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const conf = (r.field_confidence && typeof r.field_confidence === 'object'
    ? r.field_confidence
    : {}) as Record<string, number>;
  const str = (v: unknown) => (v == null || v === '' ? null : String(v).trim());
  const num = (v: unknown) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  return {
    patient_name_ar: str(r.patient_name_ar),
    patient_name_en: str(r.patient_name_en),
    age: str(r.age),
    chief_complaint: str(r.chief_complaint),
    pain_score: num(r.pain_score),
    hr: str(r.hr),
    bp_systolic: str(r.bp_systolic),
    bp_diastolic: str(r.bp_diastolic),
    spo2: str(r.spo2),
    rr: str(r.rr),
    temperature: str(r.temperature),
    gcs: str(r.gcs),
    field_confidence: conf,
    complaints: listOf(r.complaints, (x) => (x.text ? { text: String(x.text), evidence: String(x.evidence || '') } : null)),
    conditions: listOf(r.conditions, (x) => (x.name ? {
      name: String(x.name),
      status: x.status === 'absent' ? 'absent' as const : 'present' as const,
      evidence: String(x.evidence || ''),
    } : null)),
    medications: listOf(r.medications, (x) => (x.name ? { name: String(x.name), evidence: String(x.evidence || '') } : null)),
  };
}
