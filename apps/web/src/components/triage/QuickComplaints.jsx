const COMPLAINTS = [
  { ar: 'ألم صدر', en: 'Chest Pain' },
  { ar: 'ضيق تنفس', en: 'Dyspnea' },
  { ar: 'سكتة دماغية', en: 'Stroke' },
  { ar: 'إصابة رضية', en: 'Trauma' },
  { ar: 'ألم بطن', en: 'Abdominal Pain' },
  { ar: 'اضطراب وعي', en: 'Altered LOC' },
  { ar: 'حمى', en: 'Fever' },
  { ar: 'غثيان وقيء', en: 'N&V' },
  { ar: 'صداع شديد', en: 'Severe HA' },
  { ar: 'دوخة', en: 'Dizziness' },
  { ar: 'جرح / نزيف', en: 'Wound / Bleed' },
  { ar: 'ألم ظهر', en: 'Back Pain' },
];

export default function QuickComplaints({ selected, onSelect, compact = false }) {
  if (compact) {
    return (
      <div className="flex flex-wrap gap-2">
        {COMPLAINTS.map((c) => (
          <button
            key={c.ar}
            type="button"
            onClick={() => onSelect(c.ar)}
            aria-pressed={selected === c.ar}
            className={`min-h-[44px] px-3 rounded-full text-[15px] border ${
              selected === c.ar ? 'bg-ink text-white border-ink' : 'bg-white text-ink border-mist hover:border-ink'
            }`}
          >
            {c.ar} <span className="text-xs opacity-70">· {c.en}</span>
          </button>
        ))}
      </div>
    );
  }
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-mist p-4">
      <div className="mb-3">
        <h3 className="font-bold text-ink">الشكوى الرئيسية</h3>
        <p className="text-xs text-graphite">Chief Complaint — tap or type below</p>
      </div>
      <div className="flex flex-wrap gap-2 mb-3">
        {COMPLAINTS.map((c) => {
          const isSelected = selected === c.ar;
          return (
            <button
              key={c.ar}
              onClick={() => onSelect(isSelected ? '' : c.ar)}
              className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-all ${
                isSelected
                  ? 'bg-teal-600 text-white border-teal-600 shadow-sm'
                  : 'bg-paper text-ink border-mist hover:border-teal-300 hover:bg-teal-50'
              }`}
            >
              {c.ar}
              <span className="text-xs opacity-60 mr-1">· {c.en}</span>
            </button>
          );
        })}
      </div>
      <input
        type="text"
        value={selected || ''}
        onChange={(e) => onSelect(e.target.value)}
        placeholder="أو اكتب الشكوى هنا..."
        className="w-full border border-mist rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400"
      />
    </div>
  );
}