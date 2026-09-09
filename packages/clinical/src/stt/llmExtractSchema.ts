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
}

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
    field_confidence: {
      type: 'object',
      additionalProperties: { type: 'number' },
    },
  },
  required: [
    'patient_name_ar', 'patient_name_en', 'age', 'chief_complaint', 'pain_score',
    'hr', 'bp_systolic', 'bp_diastolic', 'spo2', 'rr', 'temperature', 'gcs',
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

Return JSON with patient_name_ar, patient_name_en, age (string), chief_complaint, pain_score (0-10 or null),
hr, bp_systolic, bp_diastolic, spo2, rr, temperature, gcs, and field_confidence (0-1 per populated field).`;
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
  };
}
