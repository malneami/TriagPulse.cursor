import { Check } from 'lucide-react';

export const FLOW_STEPS = [
  { key: 'capture', ar: 'التسجيل الصوتي', en: 'Voice' },
  { key: 'assessment', ar: 'التقييم', en: 'Assessment' },
  { key: 'clarify', ar: 'الأسئلة', en: 'Questions' },
  { key: 'review', ar: 'المراجعة', en: 'Review' },
  { key: 'done', ar: 'الحفظ', en: 'Saved' },
];

/**
 * Five-step progress indicator. Completed steps can be revisited (except after
 * saving); future steps are not clickable.
 */
export default function WorkflowProgress({ step, onStepClick, locked = false }) {
  const current = FLOW_STEPS.findIndex((s) => s.key === step);
  return (
    <ol aria-label="مراحل الفرز / Triage steps" className="flex items-center gap-1 sm:gap-2 list-none m-0 p-0 overflow-x-auto">
      {FLOW_STEPS.map((s, i) => {
        const done = i < current;
        const active = i === current;
        const clickable = done && !locked && onStepClick;
        const dot = (
          <span
            className={`w-7 h-7 shrink-0 rounded-full flex items-center justify-center text-xs font-semibold border-2 ${
              done ? 'bg-ink border-ink text-white' : active ? 'bg-white border-ink text-ink' : 'bg-white border-mist text-graphite'
            }`}
          >
            {done ? <Check className="w-4 h-4" aria-hidden="true" /> : i + 1}
          </span>
        );
        const label = (
          <span className={`hidden md:inline text-sm whitespace-nowrap ${active ? 'font-semibold text-ink' : 'text-graphite'}`}>
            {s.ar}
          </span>
        );
        return (
          <li key={s.key} className="flex items-center gap-1 sm:gap-2" aria-current={active ? 'step' : undefined}>
            {clickable ? (
              <button
                type="button"
                onClick={() => onStepClick(s.key)}
                className="flex items-center gap-2 rounded-full min-h-[44px]"
                aria-label={`${s.ar} / ${s.en}`}
              >
                {dot}{label}
              </button>
            ) : (
              <span className="flex items-center gap-2 min-h-[44px]" aria-label={`${s.ar} / ${s.en}`}>{dot}{label}</span>
            )}
            {i < FLOW_STEPS.length - 1 && (
              <span aria-hidden="true" className={`w-3 sm:w-6 h-0.5 shrink-0 ${done ? 'bg-ink' : 'bg-mist'}`} />
            )}
          </li>
        );
      })}
    </ol>
  );
}
