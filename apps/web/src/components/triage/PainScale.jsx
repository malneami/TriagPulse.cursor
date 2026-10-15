const PAIN_LABELS = [
  'لا ألم', '', '', '', 'خفيف', '', '', 'متوسط', '', '', 'شديد جداً',
];

export default function PainScale({ value, onChange }) {
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-mist p-4">
      <div className="mb-3">
        <h3 className="font-bold text-ink">
          شدة الألم
          {value !== null && value !== undefined && (
            <span className="mr-2 text-teal-600">— {value}/10</span>
          )}
        </h3>
        <p className="text-xs text-graphite">Pain Scale (0–10)</p>
      </div>
      <div dir="ltr" className="flex gap-1.5 justify-between">
        {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
          <button
            key={n}
            onClick={() => onChange(value === n ? null : n)}
            type="button"
            aria-pressed={value === n}
            aria-label={`${n}/10`}
            className={`flex-1 min-w-0 h-12 rounded-lg text-base font-semibold tabular-nums transition-colors border-2 ${
              value === n
                ? 'bg-ink border-ink text-white'
                : 'bg-white border-mist text-ink hover:border-graphite'
            }`}
          >
            {n}
          </button>
        ))}
      </div>
      <div dir="ltr" className="flex justify-between mt-1 px-0.5">
        <span className="text-xs text-graphite">0 لا ألم</span>
        <span className="text-xs text-graphite">10 ألم شديد</span>
      </div>
    </div>
  );
}