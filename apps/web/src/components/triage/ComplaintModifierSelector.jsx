/**
 * Step 2 — Complaint Specific Modifier Selector
 * Displays the official CTAS 2025 complaint-specific modifiers as a tap list.
 */
import { CTAS_CONFIG } from '@triagepulse/clinical';

const LEVEL_COLORS = {
  1: 'border-red-500 bg-red-50 text-red-800',
  2: 'border-orange-400 bg-orange-50 text-orange-800',
  3: 'border-green-600 bg-green-50 text-green-800',
  4: 'border-blue-400 bg-blue-50 text-blue-800',
  5: 'border-slate-300 bg-slate-50 text-slate-700',
};

export default function ComplaintModifierSelector({ match, selectedModifier, onSelect }) {
  if (!match) return null;
  const { category, complaint, categoryKey } = match;

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 space-y-3">
      {/* Header */}
      <div className="border-b border-slate-100 pb-2">
        <div className="flex items-center gap-2 mb-1">
          <span
            className="w-3 h-3 rounded-full shrink-0"
            style={{ backgroundColor: category.color }}
          />
          <span className="text-xs font-bold text-slate-500 uppercase tracking-wide">
            {category.label_en} / {category.label_ar}
          </span>
        </div>
        <p className="text-sm font-black text-slate-800">
          {complaint.label_en} — {complaint.label_ar}
        </p>
        <p className="text-xs text-slate-400 mt-0.5">
          الخطوة ٢ — اختر المعدّل المحدد / Step 2 — Select Complaint Specific Modifier
        </p>
      </div>

      {/* Modifier list */}
      <div className="space-y-1.5">
        {complaint.specific_modifiers.map((m, i) => {
          const cfg = CTAS_CONFIG[m.ctas];
          const isSelected = selectedModifier?.modifier === m.modifier;
          return (
            <button
              key={i}
              onClick={() => onSelect(isSelected ? null : m)}
              className={`w-full text-right flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl border-2 transition-all font-medium text-sm ${
                isSelected
                  ? LEVEL_COLORS[m.ctas] + ' shadow-sm scale-[1.01]'
                  : 'bg-white border-slate-200 text-slate-700 hover:border-slate-300'
              }`}
            >
              <span className="flex-1 leading-snug">{m.modifier}</span>
              <span
                className="shrink-0 text-xs font-black px-2.5 py-1 rounded-full text-white"
                style={{ backgroundColor: cfg.hex }}
              >
                CTAS {m.ctas}
              </span>
            </button>
          );
        })}
      </div>

      {selectedModifier && (
        <div className="bg-teal-50 border border-teal-200 rounded-xl px-3 py-2 text-xs text-teal-800 font-bold">
          ✅ المستوى الأولي / Initial Level: CTAS {selectedModifier.ctas} — {CTAS_CONFIG[selectedModifier.ctas]?.en}
          <span className="text-teal-600 font-normal"> · انتقل للمعدّل الأساسي / Proceed to Primary Modifiers →</span>
        </div>
      )}
    </div>
  );
}