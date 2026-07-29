const PAIN_COLORS = [
  'bg-green-400', 'bg-green-500', 'bg-yellow-300', 'bg-yellow-400',
  'bg-orange-300', 'bg-orange-400', 'bg-orange-500', 'bg-red-400',
  'bg-red-500', 'bg-red-600', 'bg-red-700',
];

const PAIN_LABELS = [
  'لا ألم', '', '', '', 'خفيف', '', '', 'متوسط', '', '', 'شديد جداً',
];

export default function PainScale({ value, onChange }) {
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-4">
      <div className="mb-3">
        <h3 className="font-bold text-slate-800">
          شدة الألم
          {value !== null && value !== undefined && (
            <span className="mr-2 text-teal-600">— {value}/10</span>
          )}
        </h3>
        <p className="text-xs text-slate-400">Pain Scale (0–10)</p>
      </div>
      <div className="flex gap-1.5 justify-between">
        {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
          <button
            key={n}
            onClick={() => onChange(value === n ? null : n)}
            className={`flex-1 h-10 rounded-lg text-sm font-bold transition-all border-2 ${
              PAIN_COLORS[n]
            } ${
              value === n
                ? 'border-slate-800 scale-110 shadow-md text-white'
                : 'border-transparent text-white opacity-70 hover:opacity-100'
            }`}
          >
            {n}
          </button>
        ))}
      </div>
      <div className="flex justify-between mt-1 px-0.5">
        <span className="text-xs text-slate-400">0 — لا ألم</span>
        <span className="text-xs text-slate-400">10 — ألم شديد</span>
      </div>
    </div>
  );
}