import { useEffect, useState } from 'react';
import { Timer } from 'lucide-react';

function fmt(ms) {
  if (!ms || ms < 0) return '00:00';
  const t = Math.floor(ms / 1000);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  const mm = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return h > 0 ? `${String(h).padStart(2, '0')}:${mm}` : mm;
}

/** Compact triage clock: starts with the first recording, stops at confirmation. */
export default function TriageTimer({ startedAt, status, stoppedAt }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!startedAt || status !== 'running') return undefined;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [startedAt, status]);

  const end = status === 'confirmed' && stoppedAt ? new Date(stoppedAt).getTime() : now;
  const elapsed = startedAt ? end - new Date(startedAt).getTime() : 0;
  const over = status === 'running' && elapsed >= 15 * 60 * 1000;

  return (
    <div
      className={`h-11 px-3 rounded-xl border flex items-center gap-2 shrink-0 ${
        over ? 'border-[#D3242C] text-[#D3242C]' : 'border-mist text-ink'
      } bg-white`}
      title="وقت الفرز / Triage time"
    >
      <Timer className="w-4 h-4" aria-hidden="true" />
      <span className="sr-only">وقت الفرز / Triage time</span>
      <span dir="ltr" className="font-semibold tabular-nums">{startedAt ? fmt(elapsed) : '--:--'}</span>
    </div>
  );
}
