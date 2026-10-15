import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Maximize, X } from 'lucide-react';
import { api } from '@/api/client';
import { CTAS_LEVELS, ctasFill, ctasMeta } from '@/lib/ctasStyle';
import { ticketCode } from '@/lib/ticket';
import { PulseMark } from '@/components/Wordmark';
import { waitState } from '@/pages/PatientTracking';

/**
 * ED wall display: readable across a room, ticket codes only. Patient names
 * and complaints are never shown because the screen is public.
 */
export default function TrackingWall() {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(t);
  }, []);

  const { data: patients = [], isError } = useQuery({
    queryKey: ['tracking-board'],
    queryFn: () => api.tracking.board(),
    refetchInterval: 15000,
  });

  const lanes = useMemo(() => {
    const out = { 1: [], 2: [], 3: [], 4: [], 5: [] };
    for (const p of patients) if (p.ctas_level && out[p.ctas_level]) out[p.ctas_level].push(p);
    for (const k of Object.keys(out)) out[k].sort((a, b) => new Date(a.arrival_time) - new Date(b.arrival_time));
    return out;
  }, [patients]);

  const awaiting = patients.filter((p) => !p.ctas_level).length;
  const over = patients.filter((p) => p.ctas_level && waitState(p, now).over).length;
  const clock = new Date(now).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

  const goFullscreen = () => {
    document.documentElement.requestFullscreen?.().catch(() => {});
  };

  return (
    <div dir="rtl" className="min-h-screen bg-ink-deep text-white px-6 lg:px-12 py-8 flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-x-10 gap-y-3">
        <span dir="ltr" className="flex items-center gap-3">
          <PulseMark className="w-14 h-10" />
          <span className="text-4xl font-semibold tracking-tight">TriagePulse</span>
        </span>
        <span className="text-3xl font-medium">قسم الطوارئ</span>
        <div className="ms-auto flex flex-wrap items-baseline gap-x-12 gap-y-2">
          <span className="text-2xl">تجاوزوا الهدف <span className="text-5xl font-bold tabular-nums">{over}</span></span>
          <span className="text-2xl text-[#B9C3CE]">بانتظار CTAS <span className="text-5xl font-bold text-white tabular-nums">{awaiting}</span></span>
          <span dir="ltr" className="text-6xl font-semibold tabular-nums">{clock}</span>
        </div>
      </div>

      {isError && (
        <p role="alert" className="text-2xl bg-white text-ink rounded-2xl px-6 py-4">
          انقطع الاتصال، يُعاد المحاولة تلقائياً. Connection lost, retrying.
        </p>
      )}

      <div className="flex-1 grid gap-5 grid-cols-1 md:grid-cols-3 xl:grid-cols-5">
        {CTAS_LEVELS.map((level) => {
          const m = ctasMeta(level);
          return (
            <section key={level} aria-label={`CTAS ${level}`} className="bg-[#16232F] rounded-3xl overflow-hidden flex flex-col">
              <div className="px-6 py-5 flex items-baseline justify-between" style={ctasFill(level)}>
                <span className="text-4xl font-bold">{level} {m.ar}</span>
                <span className="text-2xl font-medium">{level === 1 ? 'فوري' : `${m.wait_min} د`}</span>
              </div>
              <ul className="p-4 flex flex-col gap-4 list-none m-0">
                {lanes[level].map((p) => {
                  const w = waitState(p, now);
                  return (
                    <li
                      key={p.id}
                      className={`rounded-2xl px-5 py-4 flex flex-col gap-1 ${w.over ? 'bg-white text-ink' : 'bg-[#1F2E3B]'}`}
                    >
                      <span className="flex items-baseline justify-between">
                        <span dir="ltr" className="text-5xl font-bold">{ticketCode(p.ticket_no)}</span>
                        <span className="text-5xl font-bold tabular-nums">{w.waited ?? '—'} د</span>
                      </span>
                      <span className={`text-2xl ${w.over ? 'font-semibold' : 'text-[#B9C3CE]'}`}>
                        {w.over ? `تجاوز الهدف ${w.overBy} د` : 'بانتظار الطبيب'}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>

      <div className="flex items-center gap-4 text-lg text-[#B9C3CE]">
        <span>تظهر أرقام التذاكر فقط، دون أسماء. Ticket codes only, no patient names.</span>
        <button type="button" onClick={goFullscreen} className="ms-auto h-12 px-4 rounded-xl border border-white/30 text-white flex items-center gap-2">
          <Maximize className="w-5 h-5" aria-hidden="true" /> ملء الشاشة
        </button>
        <Link to="/tracking" className="h-12 px-4 rounded-xl border border-white/30 text-white flex items-center gap-2 no-underline">
          <X className="w-5 h-5" aria-hidden="true" /> إغلاق
        </Link>
      </div>
    </div>
  );
}
