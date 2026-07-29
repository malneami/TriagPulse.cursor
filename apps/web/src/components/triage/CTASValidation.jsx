import { useState } from 'react';
import { CheckCircle2, Edit2, ShieldCheck } from 'lucide-react';

const CTAS_CFG = {
  1: { hex: '#E24B4A', ar: 'إنعاش', en: 'Resuscitation', wait: 'Immediate' },
  2: { hex: '#EF9F27', ar: 'طارئ', en: 'Emergent', wait: '15 min' },
  3: { hex: '#0F6E56', ar: 'عاجل', en: 'Urgent', wait: '30 min' },
  4: { hex: '#378ADD', ar: 'أقل إلحاحاً', en: 'Less Urgent', wait: '60 min' },
  5: { hex: '#888780', ar: 'غير عاجل', en: 'Non-Urgent', wait: '120 min' },
};

const OVERRIDE_REASONS = [
  { key: 'vitals_improved',         ar: 'العلامات الحيوية تحسنت بعد التقييم',        en: 'Vitals improved after assessment' },
  { key: 'additional_clinical_info', ar: 'معلومة سريرية إضافية غير محددة في النظام', en: 'Additional clinical information not in system' },
  { key: 'patient_specific',        ar: 'اعتبار خاص بالمريض',                        en: 'Patient-specific consideration' },
  { key: 'protocol_error',          ar: 'خطأ في بروتوكول CTAS المطبق',               en: 'CTAS protocol applied incorrectly' },
  { key: 'other',                   ar: 'سبب آخر',                                   en: 'Other reason' },
];

function OverrideMode({ aiLevel, onOverrideConfirm, onBack }) {
  const [nurseLevel, setNurseLevel] = useState(null);
  const [reasonKey, setReasonKey] = useState(null);
  const [otherReason, setOtherReason] = useState('');

  const canConfirm = nurseLevel && reasonKey && (reasonKey !== 'other' || otherReason.trim());
  const resolvedReason = reasonKey === 'other' ? otherReason : OVERRIDE_REASONS.find(r => r.key === reasonKey)?.en || '';

  return (
    <div className="bg-white rounded-2xl border border-amber-200 shadow-sm overflow-hidden">
      <div className="bg-amber-50 px-4 py-3 border-b border-amber-200 flex items-center gap-2">
        <Edit2 className="w-4 h-4 text-amber-700" />
        <p className="font-bold text-amber-800 text-sm">تغيير مستوى CTAS — Override CTAS Level</p>
      </div>
      <div className="p-4 space-y-4">
        <div>
          <p className="text-xs font-black text-slate-600 mb-2">اختر المستوى الصحيح — Select correct level:</p>
          <div className="flex gap-2">
            {[1, 2, 3, 4, 5].map(l => {
              const c = CTAS_CFG[l];
              const sel = nurseLevel === l;
              return (
                <button key={l} onClick={() => setNurseLevel(l)}
                  className={`flex-1 rounded-xl py-3 flex flex-col items-center gap-0.5 font-black border-2 transition-all ${sel ? 'text-white border-transparent scale-105 shadow-md' : 'bg-white border-slate-200 text-slate-600 hover:opacity-80'}`}
                  style={sel ? { backgroundColor: c.hex } : {}}
                >
                  <span className="text-xl leading-none">{l}</span>
                  <span className="text-xs font-semibold">{c.ar}</span>
                </button>
              );
            })}
          </div>
        </div>
        <div>
          <p className="text-xs font-black text-slate-600 mb-2">سبب التغيير — Reason for override:</p>
          <div className="space-y-2">
            {OVERRIDE_REASONS.map(r => (
              <button key={r.key} onClick={() => setReasonKey(r.key)}
                className={`w-full text-right px-3 py-2.5 rounded-xl border-2 transition-all flex items-center gap-2 ${reasonKey === r.key ? 'border-teal-500 bg-teal-50' : 'border-slate-200 bg-white hover:border-slate-300'}`}
              >
                <div className={`w-4 h-4 rounded-full border-2 shrink-0 flex items-center justify-center ${reasonKey === r.key ? 'border-teal-500 bg-teal-500' : 'border-slate-300'}`}>
                  {reasonKey === r.key && <div className="w-2 h-2 bg-white rounded-full" />}
                </div>
                <div className="text-right flex-1">
                  <p className="text-sm font-medium text-slate-800">{r.ar}</p>
                  <p className="text-xs text-slate-400">{r.en}</p>
                </div>
              </button>
            ))}
            {reasonKey === 'other' && (
              <input value={otherReason} onChange={e => setOtherReason(e.target.value)}
                placeholder="اكتب السبب..."
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400"
                dir="rtl"
              />
            )}
          </div>
        </div>
        <div className="flex gap-2 pt-2">
          <button onClick={() => onOverrideConfirm(nurseLevel, resolvedReason)}
            disabled={!canConfirm}
            className="flex-1 py-3 bg-teal-700 text-white rounded-xl font-bold text-sm hover:bg-teal-800 disabled:opacity-40 transition-colors flex items-center justify-center gap-2"
          >
            <CheckCircle2 className="w-4 h-4" />
            تأكيد التغيير — Confirm Override
          </button>
          <button onClick={onBack} className="px-4 py-3 border-2 border-slate-200 rounded-xl text-slate-600 font-bold text-sm hover:border-slate-300">
            رجوع
          </button>
        </div>
      </div>
    </div>
  );
}

export default function CTASValidation({ result, patient, onComplete }) {
  const [mode, setMode] = useState('review');

  const aiLevel = result?.ctas_level ?? result?.level;
  const cfg = CTAS_CFG[aiLevel] || CTAS_CFG[3];

  // Use the modifiers from computeLiveCTAS (field is `modifiers`, not `modifiers_applied`)
  const mods = result?.modifiers || result?.modifiers_applied || [];
  const determinants = [];
  if (result?.primary_determinant_ar || result?.primary_determinant)
    determinants.push(result.primary_determinant_ar || result.primary_determinant);
  if (mods.length) determinants.push(...mods.slice(0, 3).map(m => m.label_ar || m));
  if (result?.red_flags?.length) determinants.push(...result.red_flags.slice(0, 2));

  const handleConfirm = () => onComplete({ agreed: true, nurseLevel: aiLevel, overrideReason: null });
  const handleOverrideConfirm = (nurseLevel, reason) =>
    onComplete({ agreed: nurseLevel === aiLevel, nurseLevel, overrideReason: reason });

  if (mode === 'override') return (
    <OverrideMode aiLevel={aiLevel} onOverrideConfirm={handleOverrideConfirm} onBack={() => setMode('review')} />
  );

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      {/* AI Result */}
      <div className="px-4 py-4" style={{ backgroundColor: cfg.hex + '18', borderBottom: `3px solid ${cfg.hex}` }}>
        <p className="text-xs font-black text-slate-500 uppercase tracking-wide mb-3">تقييم الفرز الحالي — Current Triage Assessment</p>
        <div className="flex items-center gap-3 mb-3">
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center font-black text-3xl text-white shadow-md shrink-0" style={{ backgroundColor: cfg.hex }}>
            {aiLevel}
          </div>
          <div>
            <p className="font-black text-slate-800 text-lg">{cfg.ar} / {cfg.en}</p>
            <p className="text-sm text-slate-500">{cfg.wait}</p>
          </div>
        </div>
        {determinants.length > 0 && (
          <div className="space-y-1">
            <p className="text-xs font-black text-slate-500 mb-1">المحددات الأساسية / Primary determinants:</p>
            {determinants.map((d, i) => (
              <div key={i} className="flex items-start gap-1.5">
                <span className="text-slate-400 shrink-0">•</span>
                <p className="text-xs text-slate-700">{d}</p>
              </div>
            ))}
          </div>
        )}
        {result?.clinical_summary_ar && (
          <p className="text-xs text-slate-600 mt-2 leading-relaxed border-t border-black/10 pt-2">{result.clinical_summary_ar}</p>
        )}
        <div className="mt-3 bg-blue-50 border border-blue-200 rounded-xl px-3 py-2 flex items-start gap-2">
          <ShieldCheck className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
          <div>
            <p className="text-xs font-black text-blue-800">مراجعة بشرية مطلوبة — Human review required</p>
            <p className="text-xs text-blue-700">{result?.safety_note || 'AI/rules output is clinical decision support only. Final CTAS must be confirmed or overridden by the clinician.'}</p>
            {result?.confidence_pct != null && <p className="text-xs text-blue-600 mt-0.5">Confidence: {result.confidence_pct}%</p>}
          </div>
        </div>
      </div>

      {/* Nurse Decision */}
      <div className="p-4 space-y-3">
        <p className="text-sm font-black text-slate-700">قرار الممرض — Nurse Decision</p>
        <p className="text-xs text-slate-500">هل توافق على هذا المستوى؟ / Do you agree with this triage level?</p>

        <button onClick={handleConfirm}
          className="w-full py-3.5 rounded-xl border-2 border-teal-500 bg-teal-50 hover:bg-teal-100 transition-colors flex items-center gap-3 px-4"
        >
          <CheckCircle2 className="w-5 h-5 text-teal-600 shrink-0" />
          <div className="text-right">
            <p className="text-sm font-black text-teal-800">✅ موافق — Confirm Triage Level</p>
            <p className="text-xs text-teal-600">CTAS {aiLevel} — {cfg.ar} / {cfg.en}</p>
          </div>
        </button>

        <button onClick={() => setMode('override')}
          className="w-full py-3.5 rounded-xl border-2 border-amber-300 bg-amber-50 hover:bg-amber-100 transition-colors flex items-center gap-3 px-4"
        >
          <Edit2 className="w-5 h-5 text-amber-700 shrink-0" />
          <div className="text-right">
            <p className="text-sm font-black text-amber-800">✏ تغيير المستوى — Override Triage Level</p>
            <p className="text-xs text-amber-600">أنا أختلف مع التقييم / I disagree with this assessment</p>
          </div>
        </button>
      </div>
    </div>
  );
}