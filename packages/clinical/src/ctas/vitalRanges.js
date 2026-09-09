/**
 * Official CTAS Protocol Engine — 2025 hierarchical assessment
 * Step 0 Critical visual → Step 1 Chief complaint → Step 2 Complaint-specific
 * → Step 3 Primary modifiers → Step 4 Min acuity.
 *
 * Scoring is delegated to the deterministic ctasRulesEngine.
 * Vital interpreters remain here for the UI form.
 */
import { getAgeGroup, AGE_NORMS } from './ageNorms.js';
import { evaluateCtasRules } from './ctasRulesEngine.js';

export { getAgeGroup, AGE_NORMS };

// ─── MAIN EXPORT: computeLiveCTAS ────────────────────────────────────────────
// answers may include `_selectedModifier` — the Step 2 modifier chosen by the nurse
export function computeLiveCTAS(patient, answers = {}) {
  return evaluateCtasRules({
    patient,
    answers,
    transcript: patient?.transcription || answers?._transcript || '',
  });
}

// Re-export for backward compat
export { computeLiveCTAS as default };

// ─── Vital sign interpreters (used by VitalsForm) ────────────────────────────
export function interpretHR(hr, age) {
  const g = getAgeGroup(age);
  const n = AGE_NORMS[g] || AGE_NORMS.adult;
  const v = parseFloat(hr);
  if (isNaN(v)) return null;
  if (v > n.HR.high * 1.3 || v < n.HR.low * 0.7) return { status: 'critical', color: 'text-red-600', bg: 'bg-red-50', label: v > n.HR.high ? 'تسرع شديد' : 'بطء شديد' };
  if (v > n.HR.high || v < n.HR.low) return { status: 'abnormal', color: 'text-amber-600', bg: 'bg-amber-50', label: v > n.HR.high ? 'تسرع' : 'بطء' };
  return { status: 'normal', color: 'text-green-600', bg: 'bg-green-50', label: 'طبيعي' };
}

export function interpretSBP(sbp) {
  const v = parseFloat(sbp);
  if (isNaN(v)) return null;
  if (v < 70)  return { status: 'critical', color: 'text-red-600',   bg: 'bg-red-50',   label: 'صدمة' };
  if (v < 90)  return { status: 'critical', color: 'text-red-600',   bg: 'bg-red-50',   label: 'انخفاض حرج' };
  if (v < 100) return { status: 'abnormal', color: 'text-amber-600', bg: 'bg-amber-50', label: 'انخفاض' };
  if (v > 180) return { status: 'critical', color: 'text-red-600',   bg: 'bg-red-50',   label: 'ارتفاع حرج' };
  if (v > 140) return { status: 'abnormal', color: 'text-amber-600', bg: 'bg-amber-50', label: 'ارتفاع' };
  return { status: 'normal', color: 'text-green-600', bg: 'bg-green-50', label: 'طبيعي' };
}

export function interpretSpO2(spo2) {
  const v = parseFloat(spo2);
  if (isNaN(v)) return null;
  if (v < 88) return { status: 'critical', color: 'text-red-600',   bg: 'bg-red-50',   label: 'نقص حرج' };
  if (v < 92) return { status: 'critical', color: 'text-red-600',   bg: 'bg-red-50',   label: 'نقص شديد' };
  if (v < 95) return { status: 'abnormal', color: 'text-amber-600', bg: 'bg-amber-50', label: 'نقص خفيف' };
  return { status: 'normal', color: 'text-green-600', bg: 'bg-green-50', label: 'طبيعي' };
}

export function interpretRR(rr, age) {
  const g = getAgeGroup(age);
  const n = AGE_NORMS[g] || AGE_NORMS.adult;
  const v = parseFloat(rr);
  if (isNaN(v)) return null;
  if (v > n.RR.high * 1.5 || v < 6) return { status: 'critical', color: 'text-red-600',   bg: 'bg-red-50',   label: v > n.RR.high ? 'تسرع شديد' : 'بطء شديد' };
  if (v > n.RR.high || v < n.RR.low) return { status: 'abnormal', color: 'text-amber-600', bg: 'bg-amber-50', label: v > n.RR.high ? 'تسرع' : 'بطء' };
  return { status: 'normal', color: 'text-green-600', bg: 'bg-green-50', label: 'طبيعي' };
}

export function interpretTemp(temp) {
  const v = parseFloat(temp);
  if (isNaN(v)) return null;
  if (v >= 41.0 || v < 34.0) return { status: 'critical', color: 'text-red-600',   bg: 'bg-red-50',   label: v >= 41 ? 'فرط حرارة' : 'انخفاض حرج' };
  if (v >= 38.5 || v < 35.0) return { status: 'abnormal', color: 'text-amber-600', bg: 'bg-amber-50', label: v >= 38.5 ? 'حمى' : 'انخفاض حرارة' };
  if (v >= 37.5) return { status: 'abnormal', color: 'text-amber-600', bg: 'bg-amber-50', label: 'حرارة مرتفعة قليلاً' };
  return { status: 'normal', color: 'text-green-600', bg: 'bg-green-50', label: 'طبيعي' };
}

export function interpretGCS(gcs) {
  const v = parseFloat(gcs);
  if (isNaN(v)) return null;
  if (v <= 8)  return { status: 'critical', color: 'text-red-600',   bg: 'bg-red-50',   label: 'فقدان وعي' };
  if (v <= 12) return { status: 'critical', color: 'text-red-600',   bg: 'bg-red-50',   label: 'ضعف وعي' };
  if (v <= 14) return { status: 'abnormal', color: 'text-amber-600', bg: 'bg-amber-50', label: 'وعي منخفض قليلاً' };
  return { status: 'normal', color: 'text-green-600', bg: 'bg-green-50', label: 'طبيعي' };
}
