import { useState } from 'react';
import { Loader2, X } from 'lucide-react';
import { CTAS_CONFIG } from '@triagepulse/clinical';
import { ctasFill } from '@/lib/ctasStyle';

const REASONS = [
  { key: 'additional_clinical_info', ar: 'معلومة سريرية إضافية غير مسجّلة', en: 'Additional clinical information not captured' },
  { key: 'clinical_judgement', ar: 'تقدير سريري للممرض', en: 'Nurse clinical judgement' },
  { key: 'vitals_changed', ar: 'تغيّرت العلامات الحيوية عند إعادة القياس', en: 'Vital signs changed on re-measurement' },
  { key: 'protocol_error', ar: 'تطبيق غير صحيح للبروتوكول', en: 'Protocol applied incorrectly' },
  { key: 'routing_policy', ar: 'توجيه بديل حسب سياسة القسم', en: 'Alternative routing per department policy' },
  { key: 'other', ar: 'سبب آخر', en: 'Other reason' },
];

/**
 * Override sheet: change the CTAS level, the direction, or both. A reason is required
 * and saved with the original recommendation. Saving here completes the triage.
 */
export default function ChangeSheet({ aiLevel, aiDirection, directionOptions = [], onSave, onClose, saving = false }) {
  const [level, setLevel] = useState(aiLevel ?? null);
  const [dest, setDest] = useState(aiDirection?.destination ?? null);
  const [reasonKey, setReasonKey] = useState(null);
  const [other, setOther] = useState('');

  const changed = level !== aiLevel || dest !== aiDirection?.destination;
  const reason = reasonKey === 'other' ? other.trim() : REASONS.find((r) => r.key === reasonKey)?.en || '';
  const ready = level && dest && changed && reasonKey && reason;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40" dir="rtl" role="dialog" aria-modal="true" aria-labelledby="change-title">
      <div className="bg-white w-full sm:max-w-2xl rounded-t-2xl sm:rounded-2xl max-h-[92vh] overflow-y-auto p-4 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 id="change-title" className="text-lg font-semibold text-ink">تغيير التوصية · Change recommendation</h2>
          <button type="button" onClick={onClose} aria-label="إغلاق / Close" className="w-11 h-11 rounded-lg flex items-center justify-center text-graphite hover:bg-paper">
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>
        <p className="text-sm text-graphite">
          التوصية الحالية · Current: {aiLevel ? `CTAS ${aiLevel}` : 'CTAS pending'} · {aiDirection?.destination_ar || '—'}
        </p>

        <div>
          <p className="text-sm font-semibold text-ink mb-2">مستوى CTAS</p>
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
          <p className="text-sm font-semibold text-ink mb-2">التوجيه · Direction</p>
          <div role="radiogroup" aria-label="Direction" className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {directionOptions.map((d) => (
              <button
                key={d.destination}
                type="button"
                role="radio"
                aria-checked={dest === d.destination}
                onClick={() => setDest(d.destination)}
                className={`min-h-[52px] px-3 rounded-xl border-2 text-start ${dest === d.destination ? 'border-ink bg-ink text-white' : 'border-mist bg-white text-ink'}`}
              >
                <span className="block text-[15px] font-semibold">{d.destination_ar}</span>
                <span className="block text-xs opacity-80">{d.destination_en}</span>
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="text-sm font-semibold text-ink mb-2">السبب (مطلوب) · Reason (required)</p>
          <div role="radiogroup" aria-label="Reason" className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {REASONS.map((r) => (
              <button
                key={r.key}
                type="button"
                role="radio"
                aria-checked={reasonKey === r.key}
                onClick={() => setReasonKey(r.key)}
                className={`min-h-[52px] px-3 rounded-xl border-2 text-start bg-white ${reasonKey === r.key ? 'border-ink' : 'border-mist'}`}
              >
                <span className="block text-[15px] text-ink">{r.ar}</span>
                <span className="block text-xs text-graphite">{r.en}</span>
              </button>
            ))}
          </div>
          {reasonKey === 'other' && (
            <input
              value={other}
              onChange={(e) => setOther(e.target.value)}
              dir="auto"
              aria-label="السبب / Reason"
              placeholder="اكتب السبب · Type the reason"
              className="mt-2 w-full h-12 border border-mist rounded-xl px-3 text-base focus:outline-none focus:border-ink"
            />
          )}
        </div>

        <button
          type="button"
          onClick={() => onSave({
            agreed: false,
            nurseLevel: level,
            direction: directionOptions.find((d) => d.destination === dest) || aiDirection,
            overrideReason: reason,
          })}
          disabled={!ready || saving}
          className="sticky bottom-0 h-14 rounded-xl bg-ink text-white text-lg font-semibold flex items-center justify-center gap-2 disabled:bg-mist disabled:text-graphite"
        >
          {saving && <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" />}
          {changed ? 'حفظ بالتغيير · Save with change' : 'غيّر المستوى أو التوجيه · Change level or direction'}
        </button>
      </div>
    </div>
  );
}
