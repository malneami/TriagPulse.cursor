import { useMemo, useState } from 'react';
import { AlertTriangle, Search } from 'lucide-react';
import { listAllComplaints } from '@triagepulse/clinical';

/**
 * Provider confirmation when CEDIS mapping is ambiguous or unmapped.
 * Does not silently guess a pathway.
 */
export default function ChiefComplaintConfirm({
  resolution,
  onConfirm,
  confirmedKey = null,
}) {
  const [query, setQuery] = useState('');
  const needs = resolution?.needs_confirmation || resolution?.status === 'unmapped' || resolution?.status === 'needs_confirmation';
  const candidates = resolution?.candidates || [];

  const catalog = useMemo(() => {
    try {
      return listAllComplaints() || [];
    } catch {
      return [];
    }
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || q.length < 2) return [];
    return catalog
      .filter((c) =>
        c.label_en?.toLowerCase().includes(q)
        || c.label_ar?.includes(query.trim())
        || c.complaintKey?.includes(q.replace(/\s+/g, '_')),
      )
      .slice(0, 8);
  }, [catalog, query]);

  if (!needs || confirmedKey) return null;

  return (
    <div className="rounded-2xl border-2 border-amber-300 bg-amber-50/80 p-4 space-y-3" dir="rtl">
      <div className="flex items-start gap-2">
        <AlertTriangle className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-black text-amber-950">
            تأكيد الشكوى الرئيسية — Confirm chief complaint
          </p>
          <p className="text-xs text-amber-800 mt-0.5">
            Rare or ambiguous wording detected. Choose the closest CTAS/CEDIS complaint before pathway CTAS.
            Primary safety modifiers still apply.
          </p>
        </div>
      </div>

      {candidates.length > 0 && (
        <div className="space-y-2">
          <p className="text-[11px] font-bold text-slate-600 uppercase tracking-wide">Top matches</p>
          <div className="flex flex-col gap-2">
            {candidates.map((c) => (
              <button
                key={c.complaintKey}
                type="button"
                onClick={() => onConfirm(c)}
                className="text-right rounded-xl border border-amber-200 bg-white hover:border-teal-500 hover:bg-teal-50 px-3 py-2.5 transition-colors"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] font-black text-slate-500">
                    {Math.round((c.confidence || 0) * 100)}%
                  </span>
                  <div>
                    <p className="text-sm font-bold text-slate-900">{c.label_ar}</p>
                    <p className="text-xs text-slate-500">{c.label_en}</p>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-2 pt-1 border-t border-amber-200/80">
        <p className="text-[11px] font-bold text-slate-600 flex items-center gap-1">
          <Search className="w-3.5 h-3.5" />
          Other / search CTAS list
        </p>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search… بحث"
          className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm bg-white"
        />
        {filtered.length > 0 && (
          <div className="flex flex-col gap-1 max-h-40 overflow-y-auto">
            {filtered.map((c) => (
              <button
                key={c.complaintKey}
                type="button"
                onClick={() => onConfirm(c)}
                className="text-right rounded-lg border border-slate-100 bg-white hover:bg-slate-50 px-2.5 py-1.5 text-xs"
              >
                <span className="font-bold text-slate-800">{c.label_ar}</span>
                <span className="text-slate-400 mx-1">·</span>
                <span className="text-slate-500">{c.label_en}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
