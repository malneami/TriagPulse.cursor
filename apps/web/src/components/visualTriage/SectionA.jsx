// Section A — Rapid Clinical Visual Assessment (5 tap cards)
const CARDS = [
  {
    key: 'breathing', icon: '🫁',
    label_ar: 'التنفس', label_en: 'Breathing',
    green_ar: 'طبيعي', green_en: 'Normal',
    red_ar: 'غير طبيعي', red_en: 'Abnormal',
  },
  {
    key: 'consciousness', icon: '🧠',
    label_ar: 'الوعي', label_en: 'Consciousness',
    green_ar: 'واعٍ', green_en: 'Alert',
    red_ar: 'ضعف وعي', red_en: 'Impaired',
  },
  {
    key: 'bleeding', icon: '🩸',
    label_ar: 'النزيف', label_en: 'Bleeding',
    green_ar: 'لا يوجد', green_en: 'None',
    red_ar: 'يوجد نزيف', red_en: 'Present',
  },
  {
    key: 'skin', icon: '👁',
    label_ar: 'لون الجلد', label_en: 'Skin Color',
    green_ar: 'طبيعي', green_en: 'Normal',
    red_ar: 'شاحب / مزرق', red_en: 'Abnormal',
  },
  {
    key: 'mobility', icon: '🚶',
    label_ar: 'الحركة', label_en: 'Mobility',
    green_ar: 'يمشي', green_en: 'Walking',
    red_ar: 'لا يستطيع المشي', red_en: 'Cannot walk',
  },
];

export default function SectionA({ values, onChange }) {
  const hasCritical = Object.values(values).some(v => v === 'red');

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-xs font-black text-slate-500 uppercase tracking-wide">
          القسم أ — Section A
        </span>
        {hasCritical && (
          <span className="text-xs bg-red-600 text-white px-2 py-0.5 rounded-full font-bold animate-pulse">
            ⚠ حرج / Critical
          </span>
        )}
      </div>
      <p className="text-sm font-black text-slate-700">الفرز السريري البصري — Rapid Clinical Assessment</p>

      <div className="space-y-2">
        {CARDS.map(card => {
          const val = values[card.key];
          return (
            <div key={card.key} className="flex items-center gap-2">
              <span className="text-xl w-7 shrink-0">{card.icon}</span>
              <div className="flex-1">
                <p className="text-xs font-bold text-slate-700 mb-1">
                  {card.label_ar} / {card.label_en}
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => onChange(card.key, 'green')}
                    className={`flex-1 py-2 rounded-xl text-xs font-bold border-2 transition-all ${
                      val === 'green'
                        ? 'bg-green-600 border-green-600 text-white shadow'
                        : 'bg-white border-slate-200 text-slate-600 hover:border-green-400'
                    }`}
                  >
                    ✓ {card.green_ar} / {card.green_en}
                  </button>
                  <button
                    onClick={() => onChange(card.key, 'red')}
                    className={`flex-1 py-2 rounded-xl text-xs font-bold border-2 transition-all ${
                      val === 'red'
                        ? 'bg-red-600 border-red-600 text-white shadow animate-pulse'
                        : 'bg-white border-slate-200 text-slate-600 hover:border-red-400'
                    }`}
                  >
                    ✗ {card.red_ar} / {card.red_en}
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}