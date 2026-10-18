import { useState } from 'react';
import { CheckCircle2, ChevronUp, Loader2, PenLine, X } from 'lucide-react';
import { ctasFill } from '@/lib/ctasStyle';
import ResultBoxes from './ResultBoxes';

/**
 * Always-visible bottom bar with the only two actions, Confirm (saves the triage) and
 * Change (override with a reason, then saves). The compact CTAS + direction strip is
 * shown when the large cards are not on screen (always on phones), so the result is
 * never out of sight and never shown twice.
 */
export default function DecisionBar({
  ctas, direction, critical, onConfirm, onChange, blocked = null, saving = false, done = false, why = [], whyGroups = [],
  showResult = true,
}) {
  const [showWhy, setShowWhy] = useState(false);
  return (
    <div className="sticky bottom-0 z-20 -mx-4 sm:mx-0 sm:pt-2 sm:pb-3">
      <div className="px-3 pt-2.5 pb-[max(env(safe-area-inset-bottom),0.75rem)] sm:p-3 bg-white/95 backdrop-blur border-t border-mist sm:border sm:rounded-[20px] sm:shadow-[0_12px_32px_-12px_rgba(20,32,43,0.28)] flex flex-col gap-2">
        {showResult && <ResultBoxes ctas={ctas} direction={direction} critical={critical} />}

        {showWhy && (whyGroups.length > 0 || why.length > 0) && (
          <div id="why-panel" className="bg-paper rounded-xl px-4 py-3 max-h-[45vh] overflow-y-auto flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold">لماذا هذا المستوى؟ <span className="text-graphite font-normal">· Why this level</span></span>
              <button type="button" onClick={() => setShowWhy(false)} aria-label="إغلاق / Close" className="w-9 h-9 rounded-lg flex items-center justify-center hover:bg-mist">
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>
            {whyGroups.length > 0 ? (
              <div className="grid gap-3 sm:grid-cols-2">
                {whyGroups.map((g) => (
                  <section
                    key={g.key}
                    className={`rounded-xl bg-white px-3 py-2.5 flex flex-col gap-1.5 ${g.key === 'level' ? 'sm:col-span-2 border-2 border-ink' : g.tone === 'warn' ? 'border border-dashed border-ink' : 'border border-mist'}`}
                  >
                    <h4 className="m-0 text-xs font-semibold text-graphite">{g.ar} · {g.en}</h4>
                    {g.items?.map((it) => (
                      <p key={it.ar} className={`m-0 ${g.key === 'level' ? 'text-[15px] font-semibold' : 'text-sm'}`}>
                        {it.ar}{it.en ? <span className="block text-xs font-normal text-graphite" dir="ltr">{it.en}</span> : null}
                      </p>
                    ))}
                    {g.chips?.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {g.chips.map((c) => (
                          <span key={c.ar} className="inline-flex items-center gap-1 rounded-lg bg-paper px-2 py-1 text-sm">
                            {c.ar}
                            {c.level && <span className="rounded px-1 text-xs font-bold" style={ctasFill(c.level)}>{c.level}</span>}
                          </span>
                        ))}
                      </div>
                    )}
                  </section>
                ))}
              </div>
            ) : (
              <ul className="list-disc ps-6 m-0 text-sm flex flex-col gap-1">{why.map((w) => <li key={w}>{w}</li>)}</ul>
            )}
          </div>
        )}

        {!done && (
          <div className="flex items-center gap-2">
            {(whyGroups.length > 0 || why.length > 0) && (
              <button
                type="button"
                onClick={() => setShowWhy((v) => !v)}
                aria-expanded={showWhy}
                aria-controls="why-panel"
                className="h-12 px-3 rounded-xl bg-paper text-ink text-sm font-medium flex items-center gap-1 shrink-0 hover:bg-mist"
              >
                لماذا؟ <span className="hidden sm:inline">· Why</span>
                <ChevronUp className={`w-4 h-4 transition-transform ${showWhy ? '' : 'rotate-180'}`} aria-hidden="true" />
              </button>
            )}
            <button
              type="button"
              onClick={onChange}
              disabled={saving}
              className="h-12 px-4 rounded-xl border-2 border-ink bg-white text-ink font-semibold flex items-center gap-2 shrink-0 hover:bg-paper"
            >
              <PenLine className="w-5 h-5" aria-hidden="true" /> تغيير <span className="hidden sm:inline">· Change</span>
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={!!blocked || saving}
              className="flex-1 h-12 rounded-xl bg-ink text-white font-semibold flex items-center justify-center gap-2 hover:bg-ink-deep disabled:bg-mist disabled:text-graphite"
            >
              {saving ? <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" /> : <CheckCircle2 className="w-5 h-5" aria-hidden="true" />}
              {saving ? 'جارٍ الحفظ…' : <>تأكيد وحفظ<span className="hidden sm:inline">&nbsp;· Confirm & save</span></>}
            </button>
          </div>
        )}
        {!done && blocked && <p className="text-sm text-graphite pb-1" role="status">{blocked}</p>}
      </div>
    </div>
  );
}
