import { ArrowLeft, MapPin } from 'lucide-react';
import { CTAS_CONFIG } from '@triagepulse/clinical';
import { ctasFill } from '@/lib/ctasStyle';

const STATUS = {
  incomplete: { ar: 'التقييم غير مكتمل', en: 'Assessment incomplete' },
  preliminary: { ar: 'مبدئي', en: 'Preliminary' },
  updated: { ar: 'محدَّث بعد الأسئلة', en: 'Updated' },
  confirmed: { ar: 'مؤكَّد من الممرض', en: 'Confirmed' },
  overridden: { ar: 'معدَّل من الممرض', en: 'Nurse override' },
  pending: { ar: 'بانتظار التقييم', en: 'Pending' },
};

function StatusChip({ status }) {
  const s = STATUS[status] || STATUS.preliminary;
  const strong = status === 'confirmed' || status === 'overridden';
  return (
    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${strong ? 'bg-ink text-white border-ink' : 'border-mist text-graphite'}`}>
      {s.ar} · {s.en}
    </span>
  );
}

/**
 * The two persistent result boxes: CTAS and patient direction, calculated separately.
 * When data is insufficient the CTAS box says so instead of showing a default level.
 */
export default function ResultBoxes({ ctas, direction, critical = false }) {
  const level = ctas?.level ?? null;
  const cfg = level ? CTAS_CONFIG[level] : null;

  const statusAr = (STATUS[ctas?.status] || STATUS.incomplete).ar;
  return (
    <>
    {/* Phones: one compact strip so the form keeps most of the screen */}
    <div
      className={`sm:hidden bg-white rounded-2xl overflow-hidden flex items-stretch ${critical ? 'border-2 border-[#D3242C]' : 'border border-mist'}`}
      aria-live="polite"
    >
      <div
        className="w-16 shrink-0 flex flex-col items-center justify-center py-1"
        style={cfg ? ctasFill(level) : { backgroundColor: '#EEF2F5', color: '#4B5765' }}
      >
        <span className="text-[10px] font-semibold">CTAS</span>
        <span className="text-2xl font-bold leading-none">{level ?? '?'}</span>
      </div>
      <div className="flex-1 min-w-0 px-3 py-1.5">
        <p className="text-[15px] font-semibold text-ink truncate">
          {cfg ? `${cfg.ar} · ${cfg.en}` : 'غير مكتمل · Incomplete'}
          <span className="font-normal text-graphite"> · {statusAr}</span>
        </p>
        <p className="text-sm text-ink truncate flex items-center gap-1">
          <MapPin className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          {direction?.destination_ar ? `${direction.destination_ar} · ${direction.destination_en}` : 'التوجيه بانتظار التقييم · Direction pending'}
        </p>
      </div>
    </div>

    <div className="hidden sm:grid grid-cols-2 gap-3" aria-live="polite">
      {/* Box 1 — CTAS */}
      <section
        aria-label="تقييم CTAS / CTAS assessment"
        className={`bg-white rounded-2xl overflow-hidden flex ${critical ? 'border-2 border-[#D3242C]' : 'border border-mist'}`}
      >
        {cfg ? (
          <div className="w-20 sm:w-24 shrink-0 flex flex-col items-center justify-center" style={ctasFill(level)}>
            <span className="text-xs font-semibold opacity-90">CTAS</span>
            <span className="text-4xl sm:text-5xl font-bold leading-none tabular-nums">{level}</span>
          </div>
        ) : (
          <div className="w-20 sm:w-24 shrink-0 flex items-center justify-center bg-paper border-e border-dashed border-mist">
            <span className="text-3xl font-bold text-graphite">?</span>
          </div>
        )}
        <div className="flex-1 min-w-0 px-3 py-2.5 flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <StatusChip status={ctas?.status || 'incomplete'} />
            {ctas?.changedFrom != null && ctas.changedFrom !== level && (
              <span className="text-xs font-semibold text-ink flex items-center gap-1">
                CTAS {ctas.changedFrom} <ArrowLeft className="w-3 h-3" aria-hidden="true" /> {level ?? '?'}
              </span>
            )}
          </div>
          {cfg ? (
            <>
              <p className="text-lg font-semibold text-ink leading-tight">
                {cfg.ar} <span className="text-graphite font-normal">· {cfg.en}</span>
                {ctas?.atLeast && <span className="text-sm font-normal text-graphite"> · على الأقل / at least</span>}
              </p>
              <p className="text-sm text-graphite">
                {level === 1 ? cfg.wait_ar : `خلال ${cfg.wait_ar}`} · {level === 1 ? cfg.wait_en : `within ${cfg.wait_en}`}
              </p>
            </>
          ) : (
            <p className="text-lg font-semibold text-ink leading-tight">التقييم غير مكتمل · Assessment incomplete</p>
          )}
          {ctas?.note && <p className="text-sm text-ink line-clamp-2">{ctas.note}</p>}
        </div>
      </section>

      {/* Box 2 — Patient direction */}
      <section aria-label="توجيه المريض / Patient direction" className="bg-white rounded-2xl border border-mist flex">
        <div className="w-14 sm:w-16 shrink-0 flex items-center justify-center bg-paper rounded-s-2xl">
          <MapPin className="w-6 h-6 text-ink" aria-hidden="true" />
        </div>
        <div className="flex-1 min-w-0 px-3 py-2.5 flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <StatusChip status={direction?.status || 'pending'} />
            {direction?.changedFrom && (
              <span className="text-xs font-semibold text-ink">تغيّر من {direction.changedFrom}</span>
            )}
          </div>
          {direction?.destination_ar ? (
            <>
              <p className="text-lg font-semibold text-ink leading-tight">
                {direction.destination_ar} <span className="text-graphite font-normal">· {direction.destination_en}</span>
              </p>
              {direction.pathway && <p className="text-sm text-graphite truncate">{direction.pathway}</p>}
            </>
          ) : (
            <p className="text-lg font-semibold text-ink leading-tight">بانتظار اكتمال التقييم · Pending</p>
          )}
          {direction?.reason && <p className="text-sm text-ink line-clamp-2">{direction.reason}</p>}
        </div>
      </section>
    </div>
    </>
  );
}
