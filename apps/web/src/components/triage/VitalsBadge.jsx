// Inline badge shown under each vital sign field
export default function VitalsBadge({ interp }) {
  if (!interp) return null;
  const { badge, label_ar, label_en, range, modifier } = interp;

  const modifierText = {
    upgrade_one: 'ترفيع مستوى — Upgrade one level',
    ctas2_min:   'CTAS 2 كحد أدنى — CTAS 2 minimum',
    ctas1:       'CTAS 1 — طارئ فوري',
    monitor:     'مراقبة — Monitor',
  }[modifier];

  const bg = badge === '🟢' ? 'bg-green-50 border-green-200 text-green-700'
           : badge === '🟡' ? 'bg-amber-50 border-amber-200 text-amber-700'
           : 'bg-red-50 border-red-200 text-red-700';

  return (
    <div className={`mt-1 rounded-lg border px-2 py-1 text-xs ${bg}`}>
      <div className="font-bold flex items-center gap-1">
        <span>{badge}</span>
        <span>{label_ar}</span>
        <span className="font-normal opacity-70">— {label_en}</span>
      </div>
      <div className="opacity-60 text-xs mt-0.5">{range}</div>
      {modifierText && <div className="font-semibold mt-0.5">⚡ {modifierText}</div>}
    </div>
  );
}