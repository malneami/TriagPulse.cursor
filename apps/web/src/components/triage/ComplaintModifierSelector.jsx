/**
 * Step 2 — Complaint Specific Modifier Selector
 * Displays the official CTAS 2025 complaint-specific modifiers as a tap list.
 */
import { CTAS_CONFIG } from '@triagepulse/clinical';
import { ctasFill } from '@/lib/ctasStyle';

// Selected row: thick ink border; the level badge carries the CTAS colour.
const LEVEL_COLORS = {
  1: 'border-ink bg-white text-ink',
  2: 'border-ink bg-white text-ink',
  3: 'border-ink bg-white text-ink',
  4: 'border-ink bg-white text-ink',
  5: 'border-ink bg-white text-ink',
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
                className="shrink-0 text-xs font-semibold px-2.5 py-1 rounded-full"
                style={ctasFill(m.ctas)}
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