// @ts-nocheck
import { useEffect, useState } from 'react';
import { AlertTriangle, X, Siren, Volume2 } from 'lucide-react';

function playAlertTone() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = 880;
    gain.gain.setValueAtTime(0.001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.start();
    oscillator.stop(ctx.currentTime + 0.38);
  } catch {
    // Browser may block audio until user interaction; visual alert still works.
  }
}

export default function UrgentAlert({ alert, onDismiss }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (alert) {
      setVisible(true);
      playAlertTone();
      const secondTone = setTimeout(playAlertTone, 450);
      return () => clearTimeout(secondTone);
    }
  }, [alert]);

  if (!alert || !visible) return null;

  const isCritical = alert.ctas_level <= 2;
  const acknowledge = () => {
    setVisible(false);
    onDismiss?.({
      acknowledged_at: new Date().toISOString(),
      ctas_level: alert.ctas_level,
      source: alert.source,
      triggered_at: alert.triggered_at,
      symptoms: alert.symptoms || [],
    });
  };

  return (
    <div className="fixed inset-0 z-[999] flex items-start justify-center pt-6 px-4 pointer-events-none">
      {isCritical && (
        <div className="absolute inset-0 bg-red-900/20 animate-pulse pointer-events-auto" onClick={acknowledge} />
      )}

      <div
        className={`relative w-full max-w-md pointer-events-auto rounded-2xl shadow-2xl border-2 overflow-hidden
          ${isCritical ? 'bg-red-600 border-red-400' : 'bg-orange-500 border-orange-300'}`}
        style={{ animation: isCritical ? 'urgentPulse 0.8s ease-in-out infinite alternate' : 'slideDown 0.3s ease-out' }}
      >
        <div className={`flex items-center gap-3 px-4 py-3 ${isCritical ? 'bg-red-700' : 'bg-orange-600'}`}>
          <Siren className="w-5 h-5 text-white animate-pulse shrink-0" />
          <p className="text-white font-black text-sm flex-1 uppercase tracking-wider">
            {isCritical ? 'تنبيه حرج — CRITICAL ALERT' : 'خطر عالٍ — HIGH RISK ALERT'}
          </p>
          <button onClick={acknowledge} className="text-white/70 hover:text-white transition-colors" aria-label="Acknowledge alert">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-4 py-3 space-y-3">
          <div className="flex items-center gap-2 bg-white/15 rounded-xl px-3 py-2">
            <Volume2 className="w-4 h-4 text-white" />
            <p className="text-white/90 text-xs font-bold">Visual and audio critical alert fired. Clinician acknowledgement is required.</p>
          </div>

          {alert.symptoms?.length > 0 && (
            <div className="space-y-1.5">
              {alert.symptoms.map((s, i) => (
                <div key={i} className="flex items-start gap-2 bg-white/15 rounded-xl px-3 py-2">
                  <AlertTriangle className="w-4 h-4 text-white shrink-0 mt-0.5" />
                  <div>
                    <p className="text-white font-bold text-sm">{s.ar}</p>
                    <p className="text-white/80 text-xs">{s.en}</p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {alert.action && (
            <div className="bg-white/20 rounded-xl px-3 py-2">
              <p className="text-white/70 text-xs font-bold uppercase tracking-wide mb-0.5">الإجراء الموصى به / Recommended action</p>
              <p className="text-white font-semibold text-sm">{alert.action}</p>
            </div>
          )}

          <div className="flex items-center justify-between">
            <span className="text-white/70 text-xs">المستوى المتوقع / Expected Level</span>
            <span className="bg-white text-red-600 font-black text-lg w-10 h-10 rounded-xl flex items-center justify-center shadow-md">
              {alert.ctas_level}
            </span>
          </div>
        </div>

        <button
          onClick={acknowledge}
          className="w-full py-2.5 bg-white/10 hover:bg-white/20 text-white text-xs font-bold transition-colors border-t border-white/20"
        >
          تم الإقرار — استمرار في الفرز / Acknowledged — Continue Triage
        </button>
      </div>

      <style>{`
        @keyframes urgentPulse {
          from { transform: scale(1); box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.7); }
          to   { transform: scale(1.01); box-shadow: 0 0 0 12px rgba(239, 68, 68, 0); }
        }
        @keyframes slideDown {
          from { transform: translateY(-20px); opacity: 0; }
          to   { transform: translateY(0); opacity: 1; }
        }
      `}</style>
    </div>
  );
}
