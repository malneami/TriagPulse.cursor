import { MapPin } from 'lucide-react';
import { CTAS_CONFIG } from '@triagepulse/clinical';
import { ctasFill } from '@/lib/ctasStyle';

export const STATUS = {
  incomplete: { ar: 'التقييم غير مكتمل', en: 'Assessment incomplete' },
  preliminary: { ar: 'مبدئي', en: 'Provisional' },
  updated: { ar: 'محدَّث بعد الأسئلة', en: 'Updated' },
  confirmed: { ar: 'مؤكَّد من الممرض', en: 'Confirmed' },
  overridden: { ar: 'معدَّل من الممرض', en: 'Nurse override' },
  pending: { ar: 'بانتظار التقييم', en: 'Pending' },
};

export function StatusChip({ status, onDark = false }) {
  const s = STATUS[status] || STATUS.preliminary;
  const strong = status === 'confirmed' || status === 'overridden';
  const tone = strong ? 'bg-ink text-white border-ink'
    : onDark ? 'border-white/40 text-current' : 'border-mist text-graphite bg-white';
  return (
    <span className={`text-xs font-semibold px-2.5 py-0.5 rounded-full border whitespace-nowrap ${tone}`}>
      {s.ar} · {s.en}
    </span>
  );
}

/**
 * Compact CTAS + direction strip. Used in the sticky bottom bar on phones, and on
 * larger screens whenever the large cards at the top have scrolled out of view.
 */
export default function ResultBoxes({ ctas, direction, critical = false }) {
  const level = ctas?.level ?? null;
  const cfg = level ? CTAS_CONFIG[level] : null;
  const statusAr = (STATUS[ctas?.status] || STATUS.incomplete).ar;

  return (
    <div
      className={`bg-white rounded-2xl overflow-hidden flex items-stretch ${critical ? 'border-2 border-[#D3242C]' : 'border border-mist'}`}
      aria-live="polite"
      aria-label="CTAS الحالي / Live CTAS"
    >
      <div
        className="w-16 shrink-0 flex flex-col items-center justify-center py-1"
        style={cfg ? ctasFill(level) : { backgroundColor: '#EEF2F5', color: '#4B5765' }}
      >
        <span className="text-[10px] font-semibold">CTAS</span>
        <span key={level ?? 'x'} className="text-2xl font-bold leading-none motion-safe:animate-[pulse_0.6s_ease-out_1]">{level ?? '?'}</span>
      </div>
      <div className="flex-1 min-w-0 px-3 py-1.5">
        <p className="text-[15px] font-semibold text-ink truncate">
          {cfg ? `${cfg.ar} · ${cfg.en}` : 'غير مكتمل · Incomplete'}
          {ctas?.atLeast && <span className="font-normal text-graphite"> · على الأقل</span>}
          {cfg && <span className="font-normal text-graphite"> · {statusAr}</span>}
        </p>
        <p className="text-sm text-ink truncate flex items-center gap-1">
          <MapPin className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          {direction?.destination_ar ? `${direction.destination_ar} · ${direction.destination_en}` : 'التوجيه بانتظار التقييم · Direction pending'}
        </p>
      </div>
    </div>
  );
}
