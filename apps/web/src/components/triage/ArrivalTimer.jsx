import { useState, useEffect } from 'react';
import { Timer, CheckCircle2, Clock } from 'lucide-react';

function formatElapsed(ms) {
  if (!ms || ms < 0) return '00:00';
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${String(hours).padStart(2,'0')}:${String(minutes).padStart(2,'0')}:${String(seconds).padStart(2,'0')}`;
  }
  return `${String(minutes).padStart(2,'0')}:${String(seconds).padStart(2,'0')}`;
}

function getStyle(ms, status) {
  if (!status || status === 'idle') return {
    bg: 'bg-slate-50', border: 'border-slate-200', text: 'text-slate-400',
    badge: 'bg-slate-200 text-slate-500', label: 'في انتظار بدء التسجيل / Waiting for recording',
    Icon: Clock,
  };
  if (status === 'confirmed') return {
    bg: 'bg-teal-50', border: 'border-teal-300', text: 'text-teal-700',
    badge: 'bg-teal-600 text-white', label: 'وقت الفرز المكتمل / Completed',
    Icon: CheckCircle2,
  };
  const minutes = Math.floor(ms / 60000);
  if (minutes >= 30) return {
    bg: 'bg-red-50', border: 'border-red-400', text: 'text-red-700',
    badge: 'bg-red-600 text-white', label: 'تجاوز الهدف / Over target ⚠',
    Icon: Timer,
  };
  if (minutes >= 15) return {
    bg: 'bg-orange-50', border: 'border-orange-300', text: 'text-orange-700',
    badge: 'bg-orange-500 text-white', label: 'قيد التقييم / Assessing',
    Icon: Timer,
  };
  return {
    bg: 'bg-teal-50', border: 'border-teal-200', text: 'text-teal-800',
    badge: 'bg-teal-600 text-white', label: 'قيد الفرز / Triaging',
    Icon: Timer,
  };
}

export default function ArrivalTimer({ timerStartTime, timerStatus, confirmedTime }) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!timerStartTime || timerStatus === 'idle') {
      setElapsed(0);
      return;
    }
    if (timerStatus === 'confirmed' || timerStatus === 'stopped') {
      if (confirmedTime && timerStartTime) {
        setElapsed(new Date(confirmedTime).getTime() - new Date(timerStartTime).getTime());
      }
      return;
    }
    const start = new Date(timerStartTime).getTime();
    const tick = () => setElapsed(Date.now() - start);
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [timerStartTime, timerStatus, confirmedTime]);

  const style = getStyle(elapsed, timerStatus);
  const { Icon } = style;

  return (
    <div className={`${style.bg} border ${style.border} rounded-xl px-4 py-3 flex items-center justify-between gap-3`}>
      <div className="flex items-center gap-2 min-w-0">
        <Icon className={`w-4 h-4 shrink-0 ${style.text}`} />
        <div className="min-w-0">
          <p className={`text-xs font-black ${style.text}`}>⏱ وقت الفرز — Triage Time</p>
          <p className={`text-xs ${style.text} opacity-70 truncate`}>{style.label}</p>
        </div>
      </div>
      <div className={`${style.badge} px-4 py-1.5 rounded-xl font-black text-lg tabular-nums shrink-0`}>
        {formatElapsed(elapsed)}
      </div>
    </div>
  );
}