// Full-screen outcome card after Visual Triage is complete
import { CheckCircle2, ClipboardList } from 'lucide-react';

export default function OutcomeScreen({ outcome, infectiousScore, checkedLabels, mpoxLabels, onDone, onLogAndNew, elapsedSec }) {
  const mins = Math.floor(elapsedSec / 60);
  const secs = elapsedSec % 60;
  const timeStr = mins > 0 ? `${mins}:${String(secs).padStart(2,'0')}` : `${secs} ثانية / sec`;

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center px-4 py-8 text-white"
      style={{ backgroundColor: outcome.color }}
    >
      <div className="text-6xl mb-4">{outcome.icon}</div>
      <h1 className="text-2xl font-black text-center mb-1">{outcome.destination_ar}</h1>
      <p className="text-base font-bold text-white/80 text-center mb-4">{outcome.destination_en}</p>

      {infectiousScore > 0 && (
        <div className="bg-white/20 rounded-xl px-4 py-2 mb-4 text-center">
          <span className="text-sm font-black">درجة التنفس / Respiratory Score: </span>
          <span className="text-2xl font-black">{infectiousScore}</span>
        </div>
      )}

      {/* Actions */}
      <div className="w-full max-w-sm bg-white/15 rounded-2xl px-4 py-4 mb-4 space-y-2">
        <p className="text-xs font-black opacity-80 mb-2">الإجراءات الفورية / Immediate Actions:</p>
        {outcome.actions.map((a, i) => (
          <div key={i} className="flex items-start gap-2 text-sm">
            <span className="font-black shrink-0">{'①②③④⑤'[i] || '•'}</span>
            <span>{a}</span>
          </div>
        ))}
      </div>

      {/* Recorded symptoms */}
      {(checkedLabels.length > 0 || mpoxLabels.length > 0) && (
        <div className="w-full max-w-sm bg-white/10 rounded-2xl px-4 py-3 mb-4">
          <p className="text-xs font-black opacity-80 mb-1">الأعراض المُسجَّلة / Recorded symptoms:</p>
          <p className="text-sm">• {[...checkedLabels, ...mpoxLabels].join(' • ')}</p>
        </div>
      )}

      {/* Time taken */}
      <p className="text-xs opacity-60 mb-6">
        ⏱ أُنجز في — Completed in: {timeStr}
      </p>

      {/* Buttons */}
      <div className="flex gap-3 w-full max-w-sm">
        <button
          onClick={onDone}
          className="flex-1 flex items-center justify-center gap-2 bg-white text-slate-800 font-black py-3 rounded-2xl text-sm"
        >
          <CheckCircle2 className="w-4 h-4" />
          تم — Done
        </button>
        <button
          onClick={onLogAndNew}
          className="flex-1 flex items-center justify-center gap-2 bg-white/20 border border-white/40 font-bold py-3 rounded-2xl text-sm"
        >
          <ClipboardList className="w-4 h-4" />
          سجّل وجديد — Log & New
        </button>
      </div>
    </div>
  );
}