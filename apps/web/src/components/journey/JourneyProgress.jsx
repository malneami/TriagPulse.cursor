const STEPS = [
  { num: 1, ar: 'الفرز البصري', en: 'Visual' },
  { num: 2, ar: 'التسجيل', en: 'Registration' },
  { num: 3, ar: 'CTAS', en: 'CTAS' },
];

/** Compact three-step indicator: done steps are filled ink, the current one outlined. */
export default function JourneyProgress({ currentStep }) {
  return (
    <ol aria-label="مراحل الرحلة / Journey steps" className="flex items-center gap-2 list-none m-0 p-0">
      {STEPS.map((step, i) => {
        const done = step.num < currentStep;
        const current = step.num === currentStep;
        return (
          <li key={step.num} className="flex items-center gap-2" aria-current={current ? 'step' : undefined}>
            <span
              className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold border-2 ${
                done ? 'bg-ink border-ink text-white' : current ? 'bg-white border-ink text-ink' : 'bg-white border-mist text-graphite'
              }`}
            >
              {done ? '✓' : step.num}
            </span>
            <span className={`text-sm whitespace-nowrap ${current ? 'font-semibold text-ink' : 'text-graphite'}`}>{step.ar}</span>
            {i < STEPS.length - 1 && <span aria-hidden="true" className={`w-6 h-0.5 ${done ? 'bg-ink' : 'bg-mist'}`} />}
          </li>
        );
      })}
    </ol>
  );
}
