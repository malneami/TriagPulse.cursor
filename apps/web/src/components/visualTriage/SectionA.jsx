// Section A — rapid visual assessment: five rows, two large answers each.
const CARDS = [
  { key: 'breathing',     label_ar: 'التنفس',    label_en: 'Breathing',     green_ar: 'طبيعي',   green_en: 'Normal',  red_ar: 'غير طبيعي',      red_en: 'Abnormal' },
  { key: 'consciousness', label_ar: 'الوعي',     label_en: 'Consciousness', green_ar: 'واعٍ',     green_en: 'Alert',   red_ar: 'ضعف وعي',        red_en: 'Impaired' },
  { key: 'bleeding',      label_ar: 'النزيف',    label_en: 'Bleeding',      green_ar: 'لا يوجد', green_en: 'None',    red_ar: 'يوجد نزيف',      red_en: 'Present' },
  { key: 'skin',          label_ar: 'لون الجلد', label_en: 'Skin colour',   green_ar: 'طبيعي',   green_en: 'Normal',  red_ar: 'شاحب / مزرق',    red_en: 'Abnormal' },
  { key: 'mobility',      label_ar: 'الحركة',    label_en: 'Mobility',      green_ar: 'يمشي',    green_en: 'Walking', red_ar: 'لا يستطيع المشي', red_en: 'Cannot walk' },
];

function Answer({ selected, danger, onClick, ar, en }) {
  const tone = selected
    ? danger
      ? 'bg-[#D3242C] border-[#D3242C] text-white'
      : 'bg-ink border-ink text-white'
    : 'bg-white border-mist text-ink hover:border-graphite';
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onClick}
      className={`flex-1 min-h-[56px] px-3 rounded-xl border-2 text-[15px] font-semibold leading-tight transition-colors ${tone}`}
    >
      <span className="block">{ar}</span>
      <span className={`block text-xs font-normal ${selected ? 'text-white/80' : 'text-graphite'}`}>{en}</span>
    </button>
  );
}

export default function SectionA({ values, onChange }) {
  const answered = Object.values(values).filter((v) => v !== null).length;
  const abnormal = Object.values(values).filter((v) => v === 'red').length;

  return (
    <section aria-labelledby="vt-section-a" className="flex flex-col gap-4">
      <header className="flex items-baseline justify-between gap-3">
        <div>
          <p className="text-xs font-semibold text-graphite tracking-wide">القسم أ · Section A</p>
          <h2 id="vt-section-a" className="text-lg font-semibold text-ink">التقييم البصري السريع</h2>
        </div>
        <span className="text-sm text-graphite tabular-nums" aria-live="polite">
          {answered}/5
          {abnormal > 0 && <span className="ms-2 font-semibold text-[#D3242C]">· {abnormal} غير طبيعي</span>}
        </span>
      </header>

      <div className="flex flex-col gap-3">
        {CARDS.map((card) => {
          const val = values[card.key];
          return (
            <div key={card.key} role="radiogroup" aria-label={`${card.label_ar} / ${card.label_en}`} className="flex flex-col gap-1.5">
              <p className="text-sm font-semibold text-ink">
                {card.label_ar} <span className="font-normal text-graphite">/ {card.label_en}</span>
              </p>
              <div className="flex gap-2">
                <Answer selected={val === 'green'} onClick={() => onChange(card.key, 'green')} ar={card.green_ar} en={card.green_en} />
                <Answer selected={val === 'red'} danger onClick={() => onChange(card.key, 'red')} ar={card.red_ar} en={card.red_en} />
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
