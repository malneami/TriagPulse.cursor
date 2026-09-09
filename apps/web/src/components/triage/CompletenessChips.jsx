import { CheckCircle2, X } from 'lucide-react';
import { CTAS_REQUIRED_FIELDS } from '@/lib/stt/ctasFieldMap';

export const REQUIRED_FIELDS = CTAS_REQUIRED_FIELDS;

export function completenessColor(count) {
  if (count <= 4) return '#EF4444';
  if (count <= 9) return '#EF9F27';
  return '#0F6E56';
}

/**
 * The ten CTAS field chips plus the progress bar.
 *
 * Shared by the Triage page and the floating recorder so the two can never disagree
 * about what is captured. `compact` is the floating-window variant: smaller chips,
 * X icons on missing fields, no scroll-to behaviour.
 */
export default function CompletenessChips({
  patient,
  onFieldClick,
  compact = false,
  showHeader = true,
}) {
  const captured = REQUIRED_FIELDS.filter((f) => f.check(patient)).length;
  const total = REQUIRED_FIELDS.length;
  const color = completenessColor(captured);
  const pulse = captured === total - 1;

  return (
    <div>
      {showHeader && (
        <div className="flex items-center justify-between mb-2 gap-2">
          <p className={`font-black text-slate-600 ${compact ? 'text-xs' : 'text-xs'}`}>
            {compact ? 'اكتمال / Completeness' : 'اكتمال البيانات — Data Completeness'}
          </p>
          <p
            className="text-xs font-black shrink-0"
            style={{ color: captured === total ? '#0F6E56' : '#EF4444' }}
          >
            {compact ? `${captured}/${total}` : `${captured} / ١٠ مكتمل — ${captured} / ${total} Complete`}
          </p>
        </div>
      )}

      <div className={`bg-slate-100 rounded-full overflow-hidden ${compact ? 'h-1.5 mb-2' : 'h-2.5 mb-3'}`}>
        <div
          className={`h-full rounded-full transition-all duration-500 ${pulse ? 'animate-pulse' : ''}`}
          style={{ width: `${(captured / total) * 100}%`, backgroundColor: color }}
        />
      </div>

      <div className={`flex flex-wrap ${compact ? 'gap-1 justify-center' : 'gap-1.5'}`}>
        {REQUIRED_FIELDS.map((f) => {
          const done = f.check(patient);
          const displayValue = done && typeof f.value === 'function' ? f.value(patient) : null;
          const Tag = onFieldClick ? 'button' : 'span';
          return (
            <Tag
              key={f.key}
              {...(onFieldClick ? { onClick: () => onFieldClick(f), type: 'button' } : {})}
              title={displayValue != null && displayValue !== '' ? String(displayValue) : undefined}
              className={`flex items-center gap-1 rounded-full font-bold border transition-all ${
                compact ? 'text-[10px] px-2 py-0.5' : 'text-xs px-2 py-1 font-medium'
              } ${
                done
                  ? 'bg-teal-50 text-teal-700 border-teal-200'
                  : `bg-red-50 text-red-600 border-red-200 ${onFieldClick ? 'hover:bg-red-100' : ''}`
              }`}
            >
              {done
                ? <CheckCircle2 className={compact ? 'w-2.5 h-2.5 shrink-0' : 'w-3 h-3 shrink-0'} />
                : <X className={compact ? 'w-2.5 h-2.5 shrink-0' : 'w-3 h-3 shrink-0'} strokeWidth={3} />}
              {compact ? f.label_ar : `${f.label_ar} / ${f.label_en}`}
              {done && displayValue != null && displayValue !== '' && (
                <span className={`font-black tabular-nums ${compact ? 'text-teal-800' : 'text-teal-800 ms-0.5'}`}>
                  {String(displayValue)}
                </span>
              )}
            </Tag>
          );
        })}
      </div>
    </div>
  );
}
