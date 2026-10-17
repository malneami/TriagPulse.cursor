import { forwardRef } from 'react';
import { ArrowLeft, Clock, MapPin } from 'lucide-react';
import { CTAS_CONFIG } from '@triagepulse/clinical';
import { CTAS_LEVELS, ctasFill, ctasSwatch } from '@/lib/ctasStyle';
import { StatusChip } from './ResultBoxes';

/** The five standard CTAS colours, with the current level raised. */
function CtasScale({ level }) {
  return (
    <div className="flex items-end gap-1 px-4 pb-3" aria-hidden="true">
      {CTAS_LEVELS.map((l) => (
        <div key={l} className="flex-1 flex flex-col items-center gap-1">
          <span
            className={`w-full rounded-full transition-all duration-500 ${l === level ? 'h-2.5' : 'h-1.5 opacity-30'}`}
            style={ctasSwatch(l)}
          />
          <span className={`text-[11px] tabular-nums ${l === level ? 'font-bold text-ink' : 'text-graphite'}`}>{l}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * Large live CTAS and patient-direction cards for tablet and desktop. Phones show the
 * same information as a compact strip in the bottom bar instead.
 */
const HeroResult = forwardRef(function HeroResult({ ctas, direction, critical = false }, ref) {
  const level = ctas?.level ?? null;
  const cfg = level ? CTAS_CONFIG[level] : null;

  return (
    <div ref={ref} className="hidden md:flex flex-col gap-3 h-full" aria-live="polite">
      <section
        aria-label="تقييم CTAS / CTAS assessment"
        className={`tp-card overflow-hidden flex flex-col ${critical ? 'ring-2 ring-[#D3242C] ring-offset-2 ring-offset-paper' : ''}`}
      >
        <div className="flex items-stretch flex-1">
          {cfg ? (
            <div className="w-28 lg:w-36 shrink-0 flex flex-col items-center justify-center py-4" style={ctasFill(level)}>
              <span className="text-xs font-semibold tracking-wide opacity-90">CTAS</span>
              <span key={level} className="text-6xl lg:text-7xl font-bold leading-none tabular-nums motion-safe:animate-[pulse_0.6s_ease-out_1]">{level}</span>
            </div>
          ) : (
            <div className="w-28 lg:w-36 shrink-0 flex flex-col items-center justify-center py-4 bg-paper border-e-2 border-dashed border-mist">
              <span className="text-xs font-semibold text-graphite">CTAS</span>
              <span className="text-6xl font-bold leading-none text-graphite">?</span>
            </div>
          )}
          <div className="flex-1 min-w-0 px-4 py-3 flex flex-col gap-1.5 justify-center">
            <div className="flex flex-wrap items-center gap-2">
              {cfg && <StatusChip status={ctas?.status || 'preliminary'} />}
              {ctas?.changedFrom != null && ctas.changedFrom !== level && (
                <span className="text-xs font-semibold text-ink flex items-center gap-1">
                  CTAS {ctas.changedFrom} <ArrowLeft className="w-3 h-3" aria-hidden="true" /> {level ?? '?'}
                </span>
              )}
            </div>
            {cfg ? (
              <>
                <p className="text-2xl lg:text-[28px] font-bold text-ink leading-tight">
                  {cfg.ar}
                  {ctas?.atLeast && <span className="text-base font-semibold text-graphite"> · على الأقل</span>}
                </p>
                <p className="text-[15px] text-graphite leading-tight">
                  {cfg.en}{ctas?.atLeast && ' · at least'}
                </p>
                {ctas?.drivenBy && (
                  <p className="text-sm text-ink leading-tight">
                    حسب: <span className="font-semibold">{ctas.drivenBy.ar}</span>
                    <span className="text-graphite"> · set by {ctas.drivenBy.en}</span>
                  </p>
                )}
                <p className="mt-1 self-start text-sm font-semibold text-ink bg-paper rounded-full px-3 py-1 flex items-center gap-1.5 whitespace-nowrap">
                  <Clock className="w-4 h-4 shrink-0" aria-hidden="true" />
                  {level === 1 ? cfg.wait_ar : `خلال ${cfg.wait_ar}`}
                  <span className="hidden lg:inline font-normal text-graphite">· {level === 1 ? cfg.wait_en : `within ${cfg.wait_en}`}</span>
                </p>
              </>
            ) : (
              <>
                <p className="text-2xl font-bold text-ink leading-tight">CTAS معلّق</p>
                <p className="text-[15px] text-graphite leading-tight">CTAS pending</p>
                <p className="mt-1 text-sm text-ink">أكمل البيانات الناقصة · Complete the missing data</p>
              </>
            )}
          </div>
        </div>
        <CtasScale level={level} />
      </section>

      <section aria-label="توجيه المريض / Patient direction" className="tp-card p-4 flex items-start gap-3">
        <div className="w-12 h-12 shrink-0 rounded-2xl bg-paper flex items-center justify-center">
          <MapPin className="w-6 h-6 text-ink" aria-hidden="true" />
        </div>
        <div className="flex-1 min-w-0 flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-graphite">التوجيه · Direction</span>
            {direction?.destination_ar && <StatusChip status={direction.status || 'preliminary'} />}
          </div>
          {direction?.destination_ar ? (
            <>
              <p className="text-xl font-bold text-ink leading-tight">{direction.destination_ar}</p>
              <p className="text-sm text-graphite leading-tight">{direction.destination_en}</p>
            </>
          ) : (
            <p className="text-lg font-semibold text-graphite leading-tight">بانتظار اكتمال التقييم · Pending</p>
          )}
          {direction?.changedFrom && <p className="text-xs font-semibold text-ink">تغيّر من {direction.changedFrom}</p>}
          {direction?.reason && <p className="text-sm text-ink line-clamp-2">{direction.reason}</p>}
        </div>
      </section>
    </div>
  );
});

export default HeroResult;
