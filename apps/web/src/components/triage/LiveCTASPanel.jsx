import { useEffect, useState, useRef } from 'react';
import { ChevronDown, ChevronUp, CheckCircle2, ArrowUp, AlertTriangle, Shield } from 'lucide-react';

const CTAS = {
  1: { hex: '#E24B4A', ar: 'إنعاش',       en: 'Resuscitation', wait_ar: 'فوري',        wait_en: 'Immediate' },
  2: { hex: '#EF9F27', ar: 'طارئ',         en: 'Emergent',      wait_ar: '١٥ دقيقة',    wait_en: '15 min' },
  3: { hex: '#0F6E56', ar: 'عاجل',         en: 'Urgent',        wait_ar: '٣٠ دقيقة',    wait_en: '30 min' },
  4: { hex: '#378ADD', ar: 'أقل إلحاحاً',  en: 'Less Urgent',   wait_ar: '٦٠ دقيقة',    wait_en: '60 min' },
  5: { hex: '#888780', ar: 'غير عاجل',     en: 'Non-Urgent',    wait_ar: '١٢٠ دقيقة',   wait_en: '120 min' },
};

function StepRow({ number, titleAr, titleEn, items = [], icon: Icon, iconColor, levelAfter = null }) {
  const hasUpgrade = items.some(m => m.result && m.result !== 'no modifier' && m.result !== 'noted');
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <Icon className={`w-3.5 h-3.5 shrink-0 ${iconColor}`} />
        <span className="text-xs font-black text-white/90">
          الخطوة {number}: {titleAr} / {titleEn}
        </span>
        {levelAfter != null && (
          <span className="mr-auto text-xs bg-white/20 rounded-full px-2 py-0.5 font-bold">
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
              <div key={i} className={`text-xs flex items-start gap-1.5 ${isUpgrade ? 'text-white font-semibold' : 'text-white/60'}`}>
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
      <div className="rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-center">
        <p className="text-sm font-black text-slate-500">CTAS — في انتظار البيانات / Awaiting Data</p>
        <p className="text-xs text-slate-400 mt-1">أدخل الشكوى أو علامة حيوية واحدة على الأقل لبدء التقييم</p>
        <p className="text-xs text-slate-400">Enter a complaint or one vital sign to begin assessment</p>
      </div>
    );
  }
  const cfg = CTAS[liveResult.level];
  if (!cfg) return null;

  const trail = liveResult.assessment_trail;

  return (
    <div
      className={`relative rounded-2xl text-white transition-all duration-500 overflow-hidden shadow-md ${flash ? 'scale-105 shadow-2xl' : ''} ${greenFlash ? 'ring-4 ring-green-400 ring-offset-2' : ''}`}
      style={{ backgroundColor: confirmed ? cfg.hex : cfg.hex + '99', border: confirmed ? 'none' : `2px dashed ${cfg.hex}` }}
    >
      {/* Level change badge */}
      {badge && (
        <div className={`absolute top-2 right-2 left-2 z-10 flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-bold ${badge.dir === 'up' ? 'bg-red-600/90' : 'bg-blue-600/90'} animate-pulse`}>
          <span>{badge.dir === 'up' ? '⬆' : '⬇'} تحديث: {badge.from} → {badge.to}</span>
        </div>
      )}

      {/* Main level display */}
      <div className="text-center py-3 px-3">
        <p className="text-xs font-black opacity-80 mb-0.5">
          {confirmed ? '✅ مؤكد / Confirmed' : '⏳ تقديري / Estimated'}
        </p>
        <div className="font-black leading-none" style={{ fontSize: 48 }}>{liveResult.level}</div>
        <p className="font-bold text-sm mt-0.5">{cfg.ar} / {cfg.en}</p>
        <p className="text-xs opacity-70">{cfg.wait_ar} — {cfg.wait_en}</p>

        {liveResult.primary_determinant_ar && (
          <div className="mt-2 bg-black/15 rounded-xl px-3 py-2 text-xs text-right">
            <p className="opacity-60 text-xs mb-1">المحدد الرئيسي / Primary determinant</p>
            <p className="font-bold">✅ {liveResult.primary_determinant_ar}</p>
          </div>
        )}

        {liveResult.red_flags?.length > 0 && (
          <div className="mt-1.5 bg-red-900/30 rounded-xl px-2 py-1.5 text-xs space-y-0.5">
            {liveResult.red_flags.slice(0, 3).map((f, i) => (
              <div key={i} className="flex items-center gap-1.5"><span>⚠️</span><span className="font-bold">{f}</span></div>
            ))}
          </div>
        )}
      </div>

      {/* Assessment Trail toggle */}
      {trail && (
        <>
          <button
            onClick={() => setTrailOpen(v => !v)}
            className="w-full flex items-center justify-between px-3 py-2 bg-black/20 hover:bg-black/30 transition-colors text-xs font-bold"
          >
            <span>مسار التقييم — Assessment Trail (3 خطوات رسمية)</span>
            {trailOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>

          {trailOpen && (
            <div className="px-3 pb-3 pt-2 bg-black/10 space-y-3 text-right">

              {/* Step 1 */}
              <StepRow
                number="١"
                titleAr="النظرة الأولى"
                titleEn="First Look"
                icon={trail.step1_first_look.stable ? CheckCircle2 : AlertTriangle}
                iconColor={trail.step1_first_look.stable ? 'text-green-300' : 'text-red-300'}
                items={trail.step1_first_look.stable
                  ? [{ label_ar: trail.step1_first_look.note_ar, result: 'no modifier' }]
                  : trail.step1_first_look.flags.map(f => ({ label_ar: f.ar, result: 'CTAS 2 min' }))
                }
              />

              {/* Step 2 — official modifier if selected */}
              <StepRow
                number="٢"
                titleAr="المعدّل المحدد للشكوى"
                titleEn="Complaint Specific Modifier"
                icon={CheckCircle2}
                iconColor="text-blue-300"
                items={[
                  {
                    label_ar: `${trail.step2_complaint.name_ar}`,
                    result: 'noted'
                  },
                  selectedModifier
                    ? { label_ar: `✅ ${selectedModifier.modifier} → CTAS ${selectedModifier.ctas}`, result: 'CTAS 2 min' }
                    : { label_ar: `⚠ لم يُختر المعدّل بعد — ${trail.step2_complaint.reason_ar}`, result: 'no modifier' }
                ]}
              />

              {/* Step 3 */}
              <StepRow
                number="٣"
                titleAr="معدّلات درجة أولى"
                titleEn="First Order Modifiers"
                icon={ArrowUp}
                iconColor="text-yellow-300"
                items={trail.step3_first_order.applied}
                levelAfter={trail.step3_first_order.level_after}
              />

              {/* Step 4 */}
              {trail.step4_second_order.applied.length > 0 && (
                <StepRow
                  number="٤"
                  titleAr="معدّلات درجة ثانية"
                  titleEn="Second Order Modifiers"
                  icon={ArrowUp}
                  iconColor="text-orange-300"
                  items={trail.step4_second_order.applied}
                  levelAfter={trail.step4_second_order.level_after}
                />
              )}

              {/* Step 5 */}
              {trail.step5_population.applied.length > 0 && (
                <StepRow
                  number="٥"
                  titleAr="عوامل السكان الخاصة"
                  titleEn="Population Modifiers"
                  icon={AlertTriangle}
                  iconColor="text-amber-300"
                  items={trail.step5_population.applied}
                  levelAfter={trail.step5_population.level_after}
                />
              )}

              {/* Step 6 */}
              <StepRow
                number="٦"
                titleAr="التهديدات الحيوية الفورية"
                titleEn="Life Threat Check"
                icon={trail.step6_life_threats.override ? AlertTriangle : Shield}
                iconColor={trail.step6_life_threats.override ? 'text-red-300' : 'text-green-300'}
                items={trail.step6_life_threats.override
                  ? trail.step6_life_threats.threats.map(t => ({ label_ar: t.ar, result: 'CTAS 1 override' }))
                  : [{ label_ar: 'لا تهديدات فورية', result: 'no modifier' }]
                }
              />

              {/* Final */}
              <div className="border-t border-white/20 pt-2 flex items-center justify-between">
                <span className="text-xs font-black text-white/90">النتيجة النهائية / Final Result</span>
                <span className="text-sm font-black bg-white/20 px-3 py-1 rounded-full">CTAS {trail.final_level} — {CTAS[trail.final_level]?.ar}</span>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}