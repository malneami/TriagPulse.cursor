import { useState } from 'react';
import { CheckCircle2, ChevronUp, Loader2, PenLine } from 'lucide-react';
import ResultBoxes from './ResultBoxes';

/**
 * Always-visible bottom bar: the CTAS and direction cards plus the only two actions,
 * Confirm (saves the triage) and Change (override with a reason, then saves).
 */
export default function DecisionBar({
  ctas, direction, critical, onConfirm, onChange, blocked = null, saving = false, done = false, why = [],
}) {
  const [showWhy, setShowWhy] = useState(false);
  return (
    <div className="sticky bottom-0 z-20 -mx-4 sm:mx-0 px-3 sm:px-0 pt-2 pb-[max(env(safe-area-inset-bottom),0.75rem)] bg-paper/95 backdrop-blur border-t border-mist sm:border-0 flex flex-col gap-2">
      <ResultBoxes ctas={ctas} direction={direction} critical={critical} />

      {showWhy && why.length > 0 && (
        <ul className="bg-white border border-mist rounded-xl px-4 py-2 list-disc ps-8 m-0 text-sm text-ink flex flex-col gap-1 max-h-40 overflow-y-auto">
          {why.map((w) => <li key={w}>{w}</li>)}
        </ul>
      )}

      {!done && (
        <div className="flex items-center gap-2">
          {why.length > 0 && (
            <button
              type="button"
              onClick={() => setShowWhy((v) => !v)}
              aria-expanded={showWhy}
              className="h-12 px-3 rounded-xl border border-mist bg-white text-ink text-sm font-medium flex items-center gap-1 shrink-0"
            >
              لماذا؟ <span className="hidden sm:inline">· Why</span>
              <ChevronUp className={`w-4 h-4 transition-transform ${showWhy ? '' : 'rotate-180'}`} aria-hidden="true" />
            </button>
          )}
          <button
            type="button"
            onClick={onChange}
            disabled={saving}
            className="h-12 px-4 rounded-xl border-2 border-ink bg-white text-ink font-semibold flex items-center gap-2 shrink-0"
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
      {!done && blocked && <p className="text-sm text-graphite -mt-1" role="status">{blocked}</p>}
    </div>
  );
}
