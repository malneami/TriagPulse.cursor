import { useState } from 'react';
import { Save, RotateCcw, Loader2, ShieldAlert, Activity, AlertCircle, ChevronDown, ChevronUp, MapPin, ShieldCheck } from 'lucide-react';

const CTAS = {
  1: { hex: '#E24B4A', ar: 'إنعاش',       en: 'Resuscitation', wait_ar: 'فوري',         wait_en: 'Immediate',   pulse: true },
  2: { hex: '#EF9F27', ar: 'طارئ',         en: 'Emergent',      wait_ar: '١٥ دقيقة',     wait_en: '15 minutes',  pulse: true },
  3: { hex: '#0F6E56', ar: 'عاجل',         en: 'Urgent',        wait_ar: '٣٠ دقيقة',     wait_en: '30 minutes',  pulse: false },
  4: { hex: '#378ADD', ar: 'أقل إلحاحاً',  en: 'Less Urgent',   wait_ar: '٦٠ دقيقة',     wait_en: '60 minutes',  pulse: false },
  5: { hex: '#888780', ar: 'غير عاجل',     en: 'Non-Urgent',    wait_ar: '١٢٠ دقيقة',    wait_en: '120 minutes', pulse: false },
};

export default function TriageResult({ result, patient, onSave, onReset, saving }) {
  const [detailsOpen, setDetailsOpen] = useState(false);

  // ── Robust level resolution: try every known field path ──
  const level = result?.ctas_level
    ?? result?.display?.ctas_level
    ?? result?.level
    ?? null;

  const cfg = CTAS[level] || null;

  // Error / empty state
  if (!level || !cfg) {
    const isIncomplete = result?.data_complete === false;
    // Try to show partial range for incomplete data
    const partialRange = result?.partial_ctas_range;
    if (!isIncomplete || !partialRange) {
      return (
        <div className="rounded-2xl bg-slate-100 border border-slate-200 p-8 text-center space-y-3">
          <AlertCircle className="w-10 h-10 text-slate-400 mx-auto" />
          <p className="text-base font-bold text-slate-700">فشل التحليل — يرجى المحاولة مجدداً</p>
          <p className="text-sm text-slate-500">Analysis failed — please try again</p>
          {result && (
            <details className="text-left mt-4">
              <summary className="text-xs text-slate-400 cursor-pointer">Raw response</summary>
              <pre className="text-xs text-slate-500 mt-2 overflow-auto max-h-40">{JSON.stringify(result, null, 2)}</pre>
            </details>
          )}
          <button onClick={onReset} className="mt-4 px-5 py-2 bg-teal-600 text-white rounded-xl text-sm font-bold">
            مريض جديد — New Patient
          </button>
        </div>
      );
    }
  }

  const colorHex = cfg?.hex || '#888780';
  const confidence = result?.confidence_pct ?? 100;

  // Clinical details
  const primaryDeterminant = result?.primary_determinant;
  const modifiers = result?.modifiers_applied || [];
  const redFlags = result?.red_flags;
  const summary = result?.clinical_summary_ar;
  const summaryEn = result?.clinical_summary_en;
  const disposition = result?.disposition;
  const safetyNote = result?.safety_note;

  return (
    <div id="ctas-result" className="rounded-2xl overflow-hidden shadow-2xl">

      {/* Compact CTAS header */}
      <div className="text-white p-4 flex items-center justify-between" style={{ backgroundColor: colorHex }}>
        <div className="flex items-center gap-3">
          <div className="w-14 h-14 bg-white/20 rounded-2xl flex items-center justify-center font-black text-3xl shrink-0">{level}</div>
          <div>
            <p className="font-black text-xl leading-tight">{cfg.ar}</p>
            <p className="text-sm text-white/80">{cfg.en} · {cfg.wait_ar} / {cfg.wait_en}</p>
          </div>
        </div>
        {result.nurse_overrode && (
          <div className="text-right bg-white/20 rounded-xl px-3 py-2 shrink-0 max-w-[140px]">
            <p className="text-xs text-white/70">AI: CTAS {result.ai_ctas_level}</p>
            <p className="text-xs font-black">✏️ Nurse: CTAS {level}</p>
            {result.override_reason && <p className="text-xs text-white/80 mt-0.5 leading-tight">{result.override_reason}</p>}
          </div>
        )}
      </div>

      <div className="bg-white">
        {(summary || summaryEn) && (
          <div className="px-4 py-3 border-b border-slate-100 bg-slate-50">
            <p className="text-xs font-black text-slate-500 mb-1">الملخص السريري — Clinical Summary</p>
            {summary && <p className="text-sm text-slate-800 leading-relaxed">{summary}</p>}
            {summaryEn && <p className="text-xs text-slate-600 mt-2 leading-relaxed">{summaryEn}</p>}
          </div>
        )}
        <div className="px-4 py-3 bg-blue-50 border-b border-blue-100 flex items-start gap-2">
          <ShieldCheck className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
          <div>
            <p className="text-xs font-black text-blue-800">Clinician-confirmed result</p>
            <p className="text-xs text-blue-700">{safetyNote || 'AI/rules decision support only. Final level saved after clinician confirmation/override.'}</p>
            <p className="text-xs text-blue-600 mt-0.5">Extraction confidence: {confidence}%</p>
          </div>
        </div>
        <button
          onClick={() => setDetailsOpen(v => !v)}
          className="w-full flex items-center justify-between px-4 py-3 text-slate-700 hover:bg-slate-50 transition-colors"
        >
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-teal-600" />
            <span className="text-sm font-bold">التفاصيل السريرية — Clinical Details</span>
          </div>
          {detailsOpen ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
        </button>

        {detailsOpen && (
          <div className="border-t border-slate-100 px-4 pb-4 space-y-4 pt-3">

            {/* Decision rationale */}
            {(primaryDeterminant || modifiers.length > 0) && (
              <div className="bg-amber-50 rounded-xl p-3 border border-amber-200">
                <p className="text-xs font-black text-amber-700 mb-2">مبرر القرار — Decision Rationale</p>
                {primaryDeterminant && (
                  <p className="text-xs text-amber-900 mb-1"><span className="font-bold">المحدد الرئيسي: </span>{primaryDeterminant}</p>
                )}
                {modifiers.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {modifiers.map((m, i) => (
                      <span key={i} className="bg-amber-100 text-amber-800 text-xs px-2 py-0.5 rounded-full border border-amber-200">{m}</span>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Vitals summary table */}
            {patient && (
              <div>
                <p className="text-xs font-black text-slate-500 uppercase tracking-wide mb-2">ملخص الحالة — Case Summary</p>
                <div className="grid grid-cols-2 gap-2">
                  {patient.chief_complaint && (
                    <div className="col-span-2 bg-slate-50 rounded-lg px-3 py-2 border border-slate-200">
                      <span className="text-xs text-slate-400">الشكوى الرئيسية</span>
                      <p className="text-sm font-semibold text-slate-800">{patient.chief_complaint}</p>
                    </div>
                  )}
                  {[
                    { label: 'HR', key: 'HR', value: patient.hr, unit: 'bpm' },
                    { label: 'SpO₂', key: 'SpO2', value: patient.spo2, unit: '%' },
                    { label: 'BP', key: 'BP', value: patient.bp_systolic && patient.bp_diastolic ? `${patient.bp_systolic}/${patient.bp_diastolic}` : null, unit: 'mmHg' },
                    { label: 'RR', key: 'RR', value: patient.rr, unit: '/min' },
                    { label: 'Temp', key: 'Temp', value: patient.temperature, unit: '°C' },
                    { label: 'GCS', key: 'GCS', value: patient.gcs, unit: '/15' },
                    { label: 'Pain', key: 'Pain', value: patient.pain_score != null ? patient.pain_score : null, unit: '/10' },
                    { label: 'Age', key: 'Age', value: patient.age, unit: 'yrs' },
                  ].filter(f => f.value != null && f.value !== '').map(({ label, value, unit }) => (
                      <div key={label} className="bg-slate-50 rounded-lg px-3 py-2 border border-slate-200">
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-slate-400 font-medium">{label}</span>
                          <span className="text-sm font-bold text-slate-800">{value}<span className="text-xs font-normal text-slate-400"> {unit}</span></span>
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            )}

            {/* Red flags */}
            {redFlags && (
              <div className="bg-red-50 rounded-xl p-3 border border-red-200 flex items-start gap-2">
                <ShieldAlert className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-black text-red-700 mb-1.5">تنبيهات حمراء — Red Flags</p>
                  <div className="flex flex-wrap gap-1">
                    {(Array.isArray(redFlags) ? redFlags : redFlags.split(',')).map((f, i) => (
                      <span key={i} className="bg-red-100 text-red-700 text-xs font-semibold px-2 py-0.5 rounded-full border border-red-200">{typeof f === 'string' ? f.trim() : f}</span>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Clinical summary */}
            {summary && (
              <div>
                <p className="text-xs font-black text-slate-500 uppercase tracking-wide mb-1.5">الملخص السريري — Clinical Summary</p>
                <p className="text-sm text-slate-800 leading-loose bg-slate-50 rounded-xl p-3 border border-slate-100">{summary}</p>
              </div>
            )}

            {/* Disposition */}
            {disposition && (
              <div className="bg-slate-50 rounded-xl p-3 border border-slate-200 flex items-start gap-2">
                <MapPin className="w-4 h-4 mt-0.5 shrink-0 text-slate-600" />
                <div>
                  <p className="text-xs font-black text-slate-500 uppercase tracking-wide mb-0.5">التصرف الموصى به — Disposition</p>
                  <p className="text-sm font-semibold text-slate-800">{disposition}</p>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ══════ ACTIONS ══════ */}
      <div className="px-4 py-4 bg-white border-t border-slate-100 flex gap-3">
        <button
          onClick={onSave}
          disabled={saving}
          className="flex-1 flex items-center justify-center gap-2 py-3 bg-teal-600 text-white rounded-xl font-bold text-sm hover:bg-teal-700 disabled:opacity-60 transition-colors"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          {saving ? 'جارٍ الحفظ...' : 'حفظ السجل'}
        </button>
        <button
          onClick={onReset}
          className="flex-1 flex items-center justify-center gap-2 py-3 bg-white border-2 border-slate-200 text-slate-700 rounded-xl font-bold text-sm hover:border-teal-400 transition-colors"
        >
          <RotateCcw className="w-4 h-4" />
          مريض جديد
        </button>
      </div>
    </div>
  );
}