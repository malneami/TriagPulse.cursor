import { AlertTriangle } from 'lucide-react';

const LABEL = {
  hr: { ar: 'النبض', en: 'Heart rate' },
  spo2: { ar: 'الأكسجين', en: 'SpO₂' },
  rr: { ar: 'التنفس', en: 'Respiratory rate' },
  temperature: { ar: 'الحرارة', en: 'Temperature' },
  gcs: { ar: 'الوعي (GCS)', en: 'GCS' },
  bp: { ar: 'الضغط', en: 'Blood pressure' },
};
export const vitalLabel = (field) => LABEL[field] || { ar: field, en: field };

/**
 * Two different readings for the same vital were dictated. The nurse picks the right
 * one; until then CTAS uses the more urgent reading and Confirm is blocked.
 */
export default function VitalConfirmCard({ conflicts = [], onPick }) {
  if (!conflicts.length) return null;
  return (
    <section aria-labelledby="vc-title" className="tp-card p-3 md:p-4 flex flex-col gap-3 border-s-4 border-s-[#F2C230]">
      <h2 id="vc-title" className="text-[15px] font-semibold text-ink flex items-center gap-2">
        <AlertTriangle className="w-4 h-4 text-ink" aria-hidden="true" />
        أكّد القراءة الصحيحة · Confirm the correct reading
      </h2>
      {conflicts.map((c) => {
        const l = vitalLabel(c.field);
        return (
          <div key={c.field} className="flex flex-col gap-2">
            <p className="text-sm text-ink">
              <span className="font-semibold">{l.ar}</span> — ذُكرت قراءتان مختلفتان
              <span className="text-graphite"> · Two {l.en} readings were dictated</span>
              {c.evidence && <span dir="auto" className="block text-xs text-graphite mt-0.5">«{c.evidence}»</span>}
            </p>
            <div className="flex flex-wrap gap-2">
              {c.values.map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => onPick(c, v)}
                  className="min-h-[48px] min-w-[88px] px-4 rounded-2xl bg-paper text-ink text-lg font-semibold tabular-nums border-2 border-transparent hover:border-ink"
                  dir="ltr"
                >
                  {v}
                </button>
              ))}
            </div>
          </div>
        );
      })}
      <p className="text-xs text-graphite">
        حتى التأكيد يُحسب CTAS بالقراءة الأخطر · Until confirmed, CTAS uses the more urgent reading. يمكن أيضاً تعديل الحقل مباشرة · You can also edit the field.
      </p>
    </section>
  );
}
