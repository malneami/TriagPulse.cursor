import { Bell, CheckCircle2, ClipboardList } from 'lucide-react';

export default function DestinationScreen({
  destination, patientId, arrivalTime, directedTime,
  detectedSigns, respiratoryScore, onAlertTeam, onDone, onLogAndNew, elapsedSec,
}) {
  const mins = Math.floor(elapsedSec / 60);
  const secs = elapsedSec % 60;
  const timeStr = mins > 0 ? `${mins}:${String(secs).padStart(2, '0')} دقيقة` : `${secs} ثانية`;
  const isResus = destination.destination === 'RESUSCITATION' || destination.destination === 'PEDIATRIC_RESUS';

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center px-4 py-8 text-white"
      style={{ backgroundColor: destination.color }}
    >
      <div className="text-5xl mb-3">{destination.icon}</div>
      <h1 className="text-2xl font-black text-center mb-1">{destination.destination_ar}</h1>
      <p className="text-base font-bold text-white/80 text-center mb-1">{destination.destination_en}</p>

      {destination.bypass_registration && (
        <div className="bg-white/20 rounded-full px-3 py-1 text-xs font-black mb-4">
          ⚡ تجاوز التسجيل — Bypass Registration · الفرز على السرير
        </div>
      )}

      {/* Patient info bar */}
      <div className="w-full max-w-sm bg-white/20 rounded-xl px-4 py-2 mb-4 flex justify-between text-sm">
        <span><span className="opacity-60">ID: </span><span className="font-black">{patientId}</span></span>
        <span><span className="opacity-60">الوصول: </span><span className="font-bold">{arrivalTime}</span></span>
      </div>

      {/* Detected signs */}
      {detectedSigns.length > 0 && (
        <div className="w-full max-w-sm bg-white/15 rounded-xl px-4 py-3 mb-3">
          <p className="text-xs font-black opacity-80 mb-1">العلامات المكتشفة / Signs detected:</p>
          {detectedSigns.map((s, i) => <p key={i} className="text-sm">• {s}</p>)}
        </div>
      )}

      {respiratoryScore > 0 && (
        <div className="w-full max-w-sm bg-white/15 rounded-xl px-3 py-2 mb-3 flex items-center justify-between">
          <span className="text-xs font-black opacity-80">درجة التنفس / Respiratory Score</span>
          <span className="text-2xl font-black">{respiratoryScore} 🔴</span>
        </div>
      )}

      {/* Actions */}
      <div className="w-full max-w-sm bg-white/15 rounded-2xl px-4 py-4 mb-4 space-y-2">
        <p className="text-xs font-black opacity-80 mb-2">الإجراءات / Actions:</p>
        {destination.actions_ar?.map((a, i) => (
          <div key={i} className="flex items-start gap-2">
            <span className="font-black text-sm shrink-0">{'①②③④⑤'[i] || '•'}</span>
            <div>
              <p className="text-sm">{a}</p>
              <p className="text-white/60 text-xs">{destination.actions_en?.[i]}</p>
            </div>
          </div>
        ))}
      </div>

      <p className="text-xs opacity-60 mb-4">⏱ أُنجز في {timeStr} · توجيه: {directedTime}</p>

      {/* Buttons */}
      <div className="flex flex-col gap-2 w-full max-w-sm">
        {isResus && (
          <button
            onClick={onAlertTeam}
            className="w-full flex items-center justify-center gap-2 bg-white text-red-700 font-black py-3 rounded-2xl text-sm"
          >
            <Bell className="w-4 h-4" />
            🔔 تنبيه الفريق — Alert Team
          </button>
        )}
        <div className="flex gap-2">
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
            سجّل وجديد
          </button>
        </div>
      </div>
    </div>
  );
}