import { useEffect, useState, useRef } from 'react';
import { ChevronDown, ChevronUp, CheckCircle2, ArrowUp, AlertTriangle } from 'lucide-react';
import { CTAS_CONFIG } from '@triagepulse/clinical';
import { CTAS_LEVELS, ctasFill, ctasSwatch } from '@/lib/ctasStyle';

const CTAS = {
  1: { hex: CTAS_CONFIG[1].hex, ar: 'إنعاش',       en: 'Resuscitation', wait_ar: 'فوري',        wait_en: 'Immediate' },
  2: { hex: CTAS_CONFIG[2].hex, ar: 'طارئ',         en: 'Emergent',      wait_ar: '١٥ دقيقة',    wait_en: '15 min' },
  3: { hex: CTAS_CONFIG[3].hex, ar: 'عاجل',         en: 'Urgent',        wait_ar: '٣٠ دقيقة',    wait_en: '30 min' },
  4: { hex: CTAS_CONFIG[4].hex, ar: 'أقل إلحاحاً',  en: 'Less Urgent',   wait_ar: '٦٠ دقيقة',    wait_en: '60 min' },
  5: { hex: CTAS_CONFIG[5].hex, ar: 'غير عاجل',     en: 'Non-Urgent',    wait_ar: '١٢٠ دقيقة',   wait_en: '120 min' },
};

function StepRow({ number, titleAr, titleEn, items = [], icon: Icon, iconColor, levelAfter = null }) {
  const hasUpgrade = items.some(m => m.result && m.result !== 'no modifier' && m.result !== 'noted');
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <Icon className={`w-3.5 h-3.5 shrink-0 ${iconColor}`} />
        <span className="text-xs font-semibold">
          الخطوة {number}: {titleAr} / {titleEn}
        </span>
        {levelAfter != null && (
          <span className="mr-auto text-xs bg-paper rounded-full px-2 py-0.5 font-semibold">
            CTAS {levelAfter}
          </span>
        )}
      </div>
      {items.length > 0 && (
        <div className="mr-5 space-y-0.5">
          {items.map((item, i) => {
            const isUpgrade = item.result && item.result !== 'no modifier' && item.result !== 'noted';
            const isNote    = item.result === 'noted';
            return (
              <div key={i} className={`text-xs flex items-start gap-1.5 ${isUpgrade ? 'font-semibold' : 'text-graphite'}`}>
                <span className="shrink-0 mt-0.5">{isUpgrade ? '⬆' : isNote ? '📌' : '✓'}</span>
                <span>{item.label_ar || item.ar || item}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function LiveCTASPanel({ liveResult, confirmed, selectedModifier }) {
  const [flash, setFlash] = useState(false);
  const [greenFlash, setGreenFlash] = useState(false);
  const [badge, setBadge] = useState(null);
  const [trailOpen, setTrailOpen] = useState(false);
  const prevLevelRef = useRef(null);
  const prevConfirmedRef = useRef(false);

  useEffect(() => {
    const curr = liveResult?.level;
    const prev = prevLevelRef.current;
    if (curr && prev && curr !== prev) {
      setFlash(true);
      setTimeout(() => setFlash(false), 600);
      const dir = curr < prev ? 'up' : 'down';
      setBadge({ dir, from: prev, to: curr });
      const t = setTimeout(() => setBadge(null), 3000);
      prevLevelRef.current = curr;
      return () => clearTimeout(t);
    }
    prevLevelRef.current = curr;
  }, [liveResult?.level]);

  useEffect(() => {
    if (confirmed && !prevConfirmedRef.current) {
      setGreenFlash(true);
      const t = setTimeout(() => setGreenFlash(false), 900);
      return () => clearTimeout(t);
    }
    prevConfirmedRef.current = confirmed;
  }, [confirmed]);

  if (!liveResult?.level) {
    return (
      <section aria-label="مستوى CTAS المقترح" className="rounded-2xl border border-mist bg-white px-4 py-4 space-y-3">
        <p className="text-sm font-medium text-graphite">المستوى المقترح / Suggested level</p>
        <div className="flex flex-col gap-1.5" aria-hidden="true">
          {CTAS_LEVELS.map((l) => (
            <div key={l} className="h-9 rounded-lg bg-paper flex items-center gap-2.5 px-3 text-sm">
              <span className="w-3.5 h-3.5 rounded" style={ctasSwatch(l)} />
              <span>{l} {CTAS_CONFIG[l].ar}</span>
            </div>
          ))}
        </div>
        <p className="text-sm text-graphite leading-relaxed">
          أدخل الشكوى أو علامة حيوية واحدة لبدء التقييم.
          <span className="block text-xs">Enter a complaint or one vital sign to begin.</span>
        </p>
      </section>
    );
  }
  const cfg = CTAS[liveResult.level];
  if (!cfg) return null;

  const trail = liveResult.assessment_trail;
  const level = liveResult.level;

  return (
    <section
      aria-label={`CTAS ${level} ${cfg.ar}`}
      aria-live="polite"
      className={`relative rounded-2xl border border-mist bg-white text-ink overflow-hidden transition-shadow duration-500 ${greenFlash ? 'ring-4 ring-ink ring-offset-2' : ''}`}
    >
      <div className="px-4 pt-4 pb-3 space-y-2">
        <p className="text-sm font-medium text-graphite">
          {confirmed ? 'المستوى المؤكد / Confirmed level' : 'المستوى المقترح الآن / Suggested level'}
        </p>

        {/* Level change notice (ink, never a CTAS colour) */}
        {badge && (
          <p role="status" className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-semibold bg-ink text-white">
            {badge.dir === 'up' ? '⬆ ارتفع' : '⬇ انخفض'} المستوى: {badge.from} ← {badge.to}
          </p>
        )}

        <div className="flex flex-col gap-1.5">
          {CTAS_LEVELS.map((l) => {
            if (l !== level) {
              return (
                <div key={l} className="h-9 rounded-lg bg-paper flex items-center gap-2.5 px-3 text-sm" aria-hidden="true">
                  <span className="w-3.5 h-3.5 rounded" style={ctasSwatch(l)} />
                  <span>{l} {CTAS_CONFIG[l].ar}</span>
                </div>
              );
            }
            return (
              <div
                key={l}
                className={`rounded-2xl px-4 py-3 transition-transform duration-500 ${flash ? 'scale-[1.03]' : ''}`}
                style={{
                  ...ctasFill(l),
                  // Estimated: dashed ink outline until the nurse confirms.
                  outline: confirmed ? undefined : '3px dashed #14202B',
                  outlineOffset: confirmed ? undefined : '2px',
                }}
              >
                <div className="flex items-baseline gap-3">
                  <span className="font-bold leading-none" style={{ fontSize: 56 }}>{l}</span>
                  <span className="flex flex-col">
                    <span className="text-2xl font-semibold">{cfg.ar}</span>
                    <span className="text-sm opacity-90">{cfg.en}</span>
                  </span>
                </div>
                <p className="mt-1.5 text-[15px] font-medium">{cfg.wait_ar} / {cfg.wait_en}</p>
                <p className="text-sm opacity-90">{confirmed ? 'مؤكد / Confirmed' : 'تقديري، بانتظار التأكيد / Estimated'}</p>
              </div>
            );
          })}
        </div>

        {(liveResult.primary_determinant_ar || liveResult.red_flags?.length > 0) && (
          <div className="pt-1 space-y-1.5">
            <p className="text-[15px] font-semibold">لماذا؟ / Why</p>
            <ul className="m-0 ps-5 space-y-1 text-sm leading-snug list-disc">
              {liveResult.primary_determinant_ar && <li>{liveResult.primary_determinant_ar}</li>}
              {(liveResult.red_flags || []).slice(0, 3).map((f, i) => (
                <li key={i} className="font-semibold">{f}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Assessment Trail toggle */}
      {trail && (
        <>
          <button
            onClick={() => setTrailOpen(v => !v)}
            className="w-full flex items-center justify-between px-3 py-2 bg-paper hover:bg-mist border-t border-mist transition-colors text-xs font-bold"
          >
            <span>مسار التقييم — CTAS Steps 0–4 (deterministic)</span>
            {trailOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>

          {trailOpen && (
            <div className="px-3 pb-3 pt-2 bg-white space-y-3 text-right">

              <StepRow
                number="٠"
                titleAr="التقييم البصري الحرج"
                titleEn="Critical Visual (ABCDE)"
                icon={(trail.step0_critical_visual || trail.step1_first_look)?.stable ? CheckCircle2 : AlertTriangle}
                iconColor={(trail.step0_critical_visual || trail.step1_first_look)?.stable ? 'text-green-300' : 'text-red-300'}
                items={(trail.step0_critical_visual || trail.step1_first_look)?.stable
                  ? [{ label_ar: (trail.step0_critical_visual || trail.step1_first_look).note_ar, result: 'no modifier' }]
                  : ((trail.step0_critical_visual || trail.step1_first_look).flags || []).map(f => ({ label_ar: f.ar, result: 'CTAS 2 min' }))
                }
              />

              <StepRow
                number="١"
                titleAr="الشكوى الرئيسية"
                titleEn="Chief Complaint"
                icon={CheckCircle2}
                iconColor="text-blue-300"
                items={[
                  {
                    label_ar: trail.step2_complaint?.needs_confirmation
                      ? 'بانتظار تأكيد الشكوى / Pending confirmation'
                      : (trail.step2_complaint?.name_ar || '—'),
                    result: trail.step2_complaint?.needs_confirmation ? 'pending' : 'noted',
                  },
                  {
                    label_ar: trail.step2_complaint?.why_selected_ar
                      || trail.step1_chief_complaint?.note_ar
                      || trail.step2_complaint?.reason_ar
                      || '—',
                    result: 'noted',
                  },
                  ...(trail.chronicity?.status
                    ? [{
                        label_ar: `Chronicity: ${trail.chronicity.status}${trail.chronicity.spo2_floor_suppressed ? ' (SpO₂ gate)' : ''}`,
                        result: trail.chronicity.status === 'uncertain' ? 'pending' : 'noted',
                      }]
                    : []),
                ]}
              />

              <StepRow
                number="٢"
                titleAr="معدّلات الشكوى المحددة"
                titleEn="Complaint-Specific Modifiers"
                icon={CheckCircle2}
                iconColor="text-blue-300"
                items={
                  (trail.step2_complaint?.modifiers?.length
                    ? trail.step2_complaint.modifiers
                    : [
                      selectedModifier
                        ? { label_ar: `✅ ${selectedModifier.modifier} → CTAS ${selectedModifier.ctas}`, result: 'CTAS 2 min' }
                        : { label_ar: `⚠ لم يُختر المعدّل بعد — ${trail.step2_complaint?.reason_ar || ''}`, result: 'no modifier' },
                    ])
                }
              />

              <StepRow
                number="٣"
                titleAr="المعدّلات الأولية"
                titleEn="Primary Modifiers"
                icon={ArrowUp}
                iconColor="text-yellow-300"
                items={trail.step3_first_order?.applied || []}
                levelAfter={trail.step3_first_order?.level_after}
              />

              {trail.step3_primary_modifiers?.sirs && !trail.step3_primary_modifiers.sirs.not_applicable && (
                <div className="mr-5 text-xs text-graphite space-y-0.5">
                  <p className="font-bold ">SIRS (each criterion once)</p>
                  <p>
                    Known+: {trail.step3_primary_modifiers.sirs.known_positive_count}
                    {' · '}Unknown: {trail.step3_primary_modifiers.sirs.unknown_count}
                    {' · '}T/HR/RR/WBC — pulse≡HR
                  </p>
                </div>
              )}

              {trail.step3_primary_modifiers?.hemodynamic?.tachycardia_class && (
                <div className="mr-5 text-xs text-graphite">
                  <p className="font-bold ">Tachycardia class</p>
                  <p>{trail.step3_primary_modifiers.hemodynamic.tachycardia_class.explanation_en}</p>
                </div>
              )}

              {(liveResult.justification_en || trail.step4_final?.justification_en) && (
                <div className="rounded-xl bg-paper px-3 py-2 text-xs space-y-1 text-left" dir="ltr">
                  <p className="font-bold ">Final calculation</p>
                  <p className=" leading-relaxed">
                    {liveResult.justification_en || trail.step4_final?.justification_en}
                  </p>
                  {trail.step4_final?.candidates?.length > 0 && (
                    <p className="text-graphite">
                      Candidates: {trail.step4_final.candidates.map((c) => `CTAS ${c.level}`).join(', ')}
                      {' → '}min acuity = CTAS {trail.final_level}
                    </p>
                  )}
                </div>
              )}

              {(liveResult.missing_ctas_changing || trail.missing_ctas_changing)?.length > 0 && (
                <div className="rounded-xl bg-paper border border-mist px-3 py-2 text-xs space-y-1">
                  <p className="font-bold">Missing (CTAS-changing only)</p>
                  {(liveResult.missing_ctas_changing || trail.missing_ctas_changing).slice(0, 5).map((g) => (
                    <p key={g.field}>• {g.reason_en || g.field}</p>
                  ))}
                </div>
              )}

              <div className="border-t border-mist pt-2 flex items-center justify-between">
                <span className="text-xs font-semibold">النتيجة النهائية / Final Result</span>
                <span className="text-sm font-black bg-paper px-3 py-1 rounded-full">CTAS {trail.final_level} — {CTAS[trail.final_level]?.ar}</span>
              </div>
              <p className="text-[10px] text-graphite text-left" dir="ltr">
                Destination and return-visit direction are separate from CTAS acuity.
              </p>
            </div>
          )}
        </>
      )}
    </section>
  );
}