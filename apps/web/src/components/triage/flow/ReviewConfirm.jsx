import { useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, PenLine } from 'lucide-react';
import { CTAS_CONFIG } from '@triagepulse/clinical';
import { ctasFill } from '@/lib/ctasStyle';

const OVERRIDE_REASONS = [
  { key: 'additional_clinical_info', ar: 'معلومة سريرية إضافية غير مسجّلة', en: 'Additional clinical information not captured' },
  { key: 'clinical_judgement', ar: 'تقدير سريري للممرض', en: 'Nurse clinical judgement' },
  { key: 'vitals_changed', ar: 'تغيّرت العلامات الحيوية عند إعادة القياس', en: 'Vital signs changed on re-measurement' },
  { key: 'protocol_error', ar: 'تطبيق غير صحيح للبروتوكول', en: 'Protocol applied incorrectly' },
  { key: 'routing_capacity', ar: 'توجيه بديل حسب سياسة القسم', en: 'Alternative routing per department policy' },
  { key: 'other', ar: 'سبب آخر', en: 'Other reason' },
];

function Section({ title, children }) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold text-graphite">{title}</h3>
      {children}
    </div>
  );
}

/**
 * Review & Confirm: the nurse sees the full picture and either confirms or overrides
 * (CTAS and/or direction, with a required reason). The AI recommendation is kept as-is
 * for the record; the nurse's decision is stored next to it.
 */
export default function ReviewConfirm({
  aiLevel,
  aiDirection,
  directionOptions = [],
  summary = [],
  positives = [],
  justification = [],
  outstanding = [],
  safetyAlerts = [],
  decision = null,
  onDecide,
  onClearDecision,
  onSave,
  saving = false,
}) {
  const [mode, setMode] = useState('review');
  const [level, setLevel] = useState(aiLevel ?? null);
  const [destCode, setDestCode] = useState(aiDirection?.destination ?? null);
  const [reasonKey, setReasonKey] = useState(null);
  const [otherReason, setOtherReason] = useState('');

  const aiCfg = aiLevel ? CTAS_CONFIG[aiLevel] : null;
  const changed = level !== aiLevel || destCode !== aiDirection?.destination;
  const reasonText = reasonKey === 'other'
    ? otherReason.trim()
    : OVERRIDE_REASONS.find((r) => r.key === reasonKey)?.en || '';
  const canApply = level && destCode && changed && reasonKey && (reasonKey !== 'other' || otherReason.trim());

  const confirm = () => onDecide({
    agreed: true,
    nurseLevel: aiLevel,
    direction: aiDirection,
    overrideReason: null,
  });
  const applyOverride = () => onDecide({
    agreed: false,
    nurseLevel: level,
    direction: directionOptions.find((d) => d.destination === destCode) || aiDirection,
    overrideReason: reasonText,
  });

  return (
    <section aria-labelledby="review-title" className="bg-white rounded-2xl border border-mist px-5 py-5 flex flex-col gap-5">
      <header>
        <h2 id="review-title" className="text-lg font-semibold text-ink">مراجعة وتأكيد الفرز</h2>
        <p className="text-sm text-graphite">Review & Confirm Triage · القرار النهائي مسؤولية الممرض · the nurse makes the final decision</p>
      </header>

      {safetyAlerts.length > 0 && (
        <div role="alert" className="rounded-xl bg-[#D3242C] text-white px-4 py-3 flex flex-col gap-1">
          <p className="font-semibold flex items-center gap-2"><AlertTriangle className="w-5 h-5" aria-hidden="true" /> تنبيهات السلامة · Safety alerts</p>
          {safetyAlerts.map((a) => <p key={a} className="text-sm">{a}</p>)}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <Section title="التقييم المكتمل · Completed assessment">
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 m-0 text-sm">
            {summary.map((r) => (
              <div key={r.label} className="contents">
                <dt className="text-graphite">{r.label}</dt>
                <dd className="m-0 text-ink font-medium" dir="auto">{r.value}</dd>
              </div>
            ))}
          </dl>
        </Section>
        <div className="flex flex-col gap-5">
          {positives.length > 0 && (
            <Section title="نتائج إيجابية مهمة · Important positive findings">
              <ul className="list-disc ps-5 m-0 text-sm text-ink flex flex-col gap-1">
                {positives.map((p) => <li key={p}>{p}</li>)}
              </ul>
            </Section>
          )}
          {justification.length > 0 && (
            <Section title="المبرر السريري · Clinical justification">
              <ul className="list-disc ps-5 m-0 text-sm text-ink flex flex-col gap-1">
                {justification.map((j) => <li key={j}>{j}</li>)}
              </ul>
            </Section>
          )}
          {outstanding.length > 0 && (
            <Section title="معلومات ناقصة · Outstanding missing information">
              <ul className="flex flex-wrap gap-2 list-none m-0 p-0">
                {outstanding.map((o) => (
                  <li key={o} className="text-sm px-3 py-1 rounded-full border border-dashed border-[#D3242C]/70 text-ink">{o}</li>
                ))}
              </ul>
            </Section>
          )}
        </div>
      </div>

      {/* Decision */}
      {decision ? (
        <div className="flex flex-col gap-3 border-t border-mist pt-4">
          <div className="flex flex-wrap items-center gap-3">
            <CheckCircle2 className="w-6 h-6 text-ink" aria-hidden="true" />
            <p className="text-[15px] font-semibold text-ink flex-1">
              {decision.agreed ? 'تم التأكيد · Confirmed' : 'تم التعديل · Overridden'}: CTAS {decision.nurseLevel} · {decision.direction?.destination_ar}
            </p>
            <button type="button" onClick={() => { onClearDecision(); setMode('review'); }} className="text-sm underline text-graphite min-h-[44px]">
              تغيير القرار · Change decision
            </button>
          </div>
          {!decision.agreed && <p className="text-sm text-graphite">السبب · Reason: {decision.overrideReason}</p>}
          <button
            type="button"
            onClick={onSave}
            disabled={saving}
            className="w-full min-h-[60px] rounded-xl bg-ink text-white text-lg font-semibold flex items-center justify-center gap-2 hover:bg-ink-deep disabled:opacity-70"
          >
            {saving && <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" />}
            {saving ? 'جارٍ الحفظ… · Saving' : 'تأكيد وحفظ · Confirm & Save'}
          </button>
        </div>
      ) : mode === 'override' ? (
        <div className="flex flex-col gap-4 border-t border-mist pt-4">
          <p className="text-[15px] font-semibold text-ink">تعديل التوصية · Override</p>
          <div>
            <p className="text-sm text-graphite mb-2">مستوى CTAS · CTAS level</p>
            <div role="radiogroup" aria-label="CTAS" className="grid grid-cols-5 gap-2">
              {[1, 2, 3, 4, 5].map((l) => (
                <button
                  key={l}
                  type="button"
                  role="radio"
                  aria-checked={level === l}
                  onClick={() => setLevel(l)}
                  className={`min-h-[56px] rounded-xl border-2 flex flex-col items-center justify-center ${level === l ? 'border-transparent' : 'border-mist bg-white text-ink'}`}
                  style={level === l ? ctasFill(l) : undefined}
                >
                  <span className="text-xl font-bold leading-none">{l}</span>
                  <span className="text-xs">{CTAS_CONFIG[l].ar}</span>
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="text-sm text-graphite mb-2">التوجيه · Patient direction</p>
            <div role="radiogroup" aria-label="Direction" className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {directionOptions.map((d) => (
                <button
                  key={d.destination}
                  type="button"
                  role="radio"
                  aria-checked={destCode === d.destination}
                  onClick={() => setDestCode(d.destination)}
                  className={`min-h-[52px] px-3 rounded-xl border-2 text-start ${destCode === d.destination ? 'border-ink bg-ink text-white' : 'border-mist bg-white text-ink'}`}
                >
                  <span className="block text-[15px] font-semibold">{d.destination_ar}</span>
                  <span className="block text-xs opacity-80">{d.destination_en}</span>
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="text-sm text-graphite mb-2">سبب التعديل (مطلوب) · Reason (required)</p>
            <div role="radiogroup" aria-label="Reason" className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {OVERRIDE_REASONS.map((r) => (
                <button
                  key={r.key}
                  type="button"
                  role="radio"
                  aria-checked={reasonKey === r.key}
                  onClick={() => setReasonKey(r.key)}
                  className={`min-h-[52px] px-3 rounded-xl border-2 text-start ${reasonKey === r.key ? 'border-ink' : 'border-mist'} bg-white`}
                >
                  <span className="block text-[15px] text-ink">{r.ar}</span>
                  <span className="block text-xs text-graphite">{r.en}</span>
                </button>
              ))}
            </div>
            {reasonKey === 'other' && (
              <input
                value={otherReason}
                onChange={(e) => setOtherReason(e.target.value)}
                dir="auto"
                aria-label="السبب / Reason"
                placeholder="اكتب السبب · Type the reason"
                className="mt-2 w-full h-12 border border-mist rounded-xl px-3 text-base focus:outline-none focus:border-ink"
              />
            )}
          </div>
          {!changed && <p className="text-sm text-graphite">غيّر المستوى أو التوجيه للتعديل · Change the level or direction to override.</p>}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <button type="button" onClick={() => setMode('review')} className="min-h-[56px] rounded-xl border border-mist text-ink font-semibold">
              رجوع · Back
            </button>
            <button
              type="button"
              onClick={applyOverride}
              disabled={!canApply}
              className="min-h-[56px] rounded-xl bg-ink text-white font-semibold disabled:bg-mist disabled:text-graphite"
            >
              اعتماد التعديل · Apply override
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3 border-t border-mist pt-4">
          {aiLevel ? (
            <p className="text-[15px] text-ink">
              التوصية · Recommendation: <span className="font-semibold">CTAS {aiLevel} {aiCfg?.ar}</span> · {aiDirection?.destination_ar}
            </p>
          ) : null}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <button
              type="button"
              onClick={confirm}
              disabled={!aiLevel || !aiDirection}
              className="min-h-[60px] rounded-xl bg-ink text-white text-lg font-semibold flex items-center justify-center gap-2 hover:bg-ink-deep disabled:bg-mist disabled:text-graphite"
            >
              <CheckCircle2 className="w-5 h-5" aria-hidden="true" /> تأكيد · Confirm
            </button>
            <button
              type="button"
              onClick={() => { setLevel(aiLevel ?? null); setDestCode(aiDirection?.destination ?? null); setMode('override'); }}
              className="min-h-[60px] rounded-xl border-2 border-ink text-ink text-lg font-semibold flex items-center justify-center gap-2"
            >
              <PenLine className="w-5 h-5" aria-hidden="true" /> تعديل · Override
            </button>
          </div>
          {!aiLevel && (
            <p className="text-sm text-[#D3242C]">التقييم غير مكتمل: أكمل البيانات المطلوبة، أو حدّد المستوى والتوجيه عبر التعديل. · Assessment incomplete: complete the required data, or set level and direction with Override.</p>
          )}
        </div>
      )}
    </section>
  );
}
