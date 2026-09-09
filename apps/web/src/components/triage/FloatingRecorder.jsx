import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Minus, Square, X } from 'lucide-react';
import { formatTurnTime } from '@/lib/stt/ctasFieldMap';
import { computeLiveCTAS, normalizeSpokenNumbers } from '@triagepulse/clinical';
import CompletenessChips, { REQUIRED_FIELDS } from './CompletenessChips';

const BAR_COUNT = 21;

const CTAS_HEX = {
  1: '#E24B4A',
  2: '#EF9F27',
  3: '#0F6E56',
  4: '#378ADD',
  5: '#888780',
};

/** Deterministic idle heights so the bar row isn't empty before audio arrives. */
const IDLE_BARS = Array.from({ length: BAR_COUNT }, (_, i) => 0.25 + 0.2 * Math.sin(i * 0.9));

/**
 * Live mic level meter. Reads the same MediaStream the recorder uses rather than
 * animating on a timer, so the waveform reflects real audio.
 */
function useLevels(stream, active) {
  const [levels, setLevels] = useState(IDLE_BARS);
  const rafRef = useRef(null);

  useEffect(() => {
    if (!stream || !active) {
      setLevels(IDLE_BARS);
      return undefined;
    }
    let ctx;
    let cancelled = false;
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
    } catch {
      return undefined;
    }
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.75;
    source.connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);
    const perBar = Math.floor(data.length / BAR_COUNT) || 1;

    const tick = () => {
      if (cancelled) return;
      analyser.getByteFrequencyData(data);
      const next = [];
      for (let b = 0; b < BAR_COUNT; b += 1) {
        let sum = 0;
        for (let i = 0; i < perBar; i += 1) sum += data[b * perBar + i] || 0;
        next.push(Math.min(1, (sum / perBar / 255) * 2.2));
      }
      setLevels(next);
      rafRef.current = requestAnimationFrame(tick);
    };
    tick();

    return () => {
      cancelled = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      try { source.disconnect(); } catch { /* ignore */ }
      ctx.close().catch(() => {});
    };
  }, [stream, active]);

  return levels;
}

/** Coerce spoken number words (تسعين / ninety) into digits for CTAS scoring. */
function coerceVital(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const raw = String(value).trim();
  const direct = parseFloat(raw.replace(/%/g, ''));
  if (Number.isFinite(direct)) return direct;
  try {
    const spaced = raw.replace(/ninetynine/gi, 'ninety nine').replace(/ninetyeight/gi, 'ninety eight');
    const normalized = normalizeSpokenNumbers(spaced);
    const n = parseFloat(String(normalized).replace(/%/g, ''));
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

function patientForCtas(patient = {}) {
  return {
    ...patient,
    age: coerceVital(patient.age) ?? patient.age,
    hr: coerceVital(patient.hr) ?? patient.hr,
    bp_systolic: coerceVital(patient.bp_systolic) ?? patient.bp_systolic,
    bp_diastolic: coerceVital(patient.bp_diastolic) ?? patient.bp_diastolic,
    spo2: coerceVital(patient.spo2) ?? patient.spo2,
    rr: coerceVital(patient.rr) ?? patient.rr,
    temperature: coerceVital(patient.temperature) ?? patient.temperature,
    gcs: coerceVital(patient.gcs) ?? patient.gcs,
    pain_score: coerceVital(patient.pain_score) ?? patient.pain_score,
  };
}

/**
 * Floating recording window: drag by the title bar, minimise to a pill, close to stop.
 * Fixed-position so it stays put while the clinician scrolls the triage form.
 */
export default function FloatingRecorder({
  open,
  recording,
  transcribing,
  stream,
  patient,
  transcript,
  lastTurnAt,
  ctasLevel,
  ctasLabelAr,
  ctasLabelEn,
  ctasHex,
  onClose,
  onStop,
}) {
  const [minimised, setMinimised] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [pos, setPos] = useState(null); // null = default centred placement
  const dragRef = useRef(null);
  const levels = useLevels(stream, recording);

  const captured = REQUIRED_FIELDS.filter((f) => f.check(patient || {})).length;
  const total = REQUIRED_FIELDS.length;
  const dataComplete = captured >= total;

  const derived = useMemo(() => {
    if (ctasLevel != null && ctasLevel !== '') {
      const level = Number(ctasLevel);
      if (Number.isFinite(level)) {
        return {
          level,
          ar: ctasLabelAr || null,
          en: ctasLabelEn || null,
          hex: ctasHex || CTAS_HEX[level] || '#0F6E56',
        };
      }
    }
    try {
      const result = computeLiveCTAS(patientForCtas(patient || {}), {});
      if (result?.level != null) {
        return {
          level: result.level,
          ar: result.ctas_ar || null,
          en: result.ctas_en || null,
          hex: result.hex || CTAS_HEX[result.level] || '#0F6E56',
        };
      }
    } catch {
      /* ignore scoring errors in floater */
    }
    return null;
  }, [ctasLevel, ctasLabelAr, ctasLabelEn, ctasHex, patient]);

  const onPointerDown = useCallback((e) => {
    // Ignore drags that start on the window buttons.
    if (e.target.closest('[data-window-control]')) return;
    const node = e.currentTarget.parentElement;
    const rect = node.getBoundingClientRect();
    dragRef.current = { dx: e.clientX - rect.left, dy: e.clientY - rect.top, w: rect.width, h: rect.height };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }, []);

  const onPointerMove = useCallback((e) => {
    const d = dragRef.current;
    if (!d) return;
    const maxX = window.innerWidth - d.w;
    const maxY = window.innerHeight - d.h;
    setPos({
      left: Math.max(8, Math.min(maxX - 8, e.clientX - d.dx)),
      top: Math.max(8, Math.min(maxY - 8, e.clientY - d.dy)),
    });
  }, []);

  const endDrag = useCallback((e) => {
    dragRef.current = null;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
  }, []);

  useEffect(() => {
    if (!open) {
      setMinimised(false);
      setExpanded(false);
      setPos(null);
    }
  }, [open]);

  if (!open) return null;

  const placement = pos
    ? { left: pos.left, top: pos.top }
    : { left: '50%', top: '50%', transform: 'translate(-50%, -50%)' };

  if (minimised) {
    return (
      <button
        type="button"
        onClick={() => setMinimised(false)}
        dir="rtl"
        className="fixed bottom-4 inset-x-4 sm:inset-x-auto sm:right-4 sm:w-72 z-50 flex items-center justify-between gap-2 px-4 py-3 rounded-2xl bg-slate-900 text-white shadow-2xl"
      >
        <span className="flex items-center gap-2 text-xs font-black">
          <span className={`w-2.5 h-2.5 rounded-full ${recording ? 'bg-red-500 animate-pulse' : 'bg-slate-500'}`} />
          {recording ? 'يسجّل صوت / Recording' : 'التسجيل متوقف / Paused'}
          {derived?.level != null && (
            <span
              className="ms-1 px-1.5 py-0.5 rounded-md text-[10px] font-black"
              style={{ backgroundColor: derived.hex, color: '#fff' }}
            >
              CTAS {derived.level}
            </span>
          )}
        </span>
        <span className="text-[10px] text-slate-300">اضغط للتوسيع</span>
      </button>
    );
  }

  return (
    <div
      dir="rtl"
      style={placement}
      className={`fixed z-50 w-[min(92vw,26rem)] ${expanded ? 'sm:w-[min(94vw,44rem)]' : ''} rounded-2xl overflow-hidden shadow-2xl border border-slate-700 bg-white`}
    >
      {/* Title bar — drag handle */}
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        className="flex items-center justify-between gap-2 px-3 py-2.5 bg-slate-900 text-white cursor-grab active:cursor-grabbing touch-none select-none"
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className={`w-3 h-3 rounded-full shrink-0 ${recording ? 'bg-red-500 animate-pulse' : 'bg-amber-500'}`} />
          <p className="text-sm font-black truncate">
            {transcribing ? 'جاري النسخ / Transcribing…' : 'يسجّل صوت / Recording Audio'}
          </p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            data-window-control type="button" onClick={() => setMinimised(true)}
            aria-label="تصغير / Minimise"
            className="p-1.5 rounded-lg hover:bg-white/15"
          >
            <Minus className="w-3.5 h-3.5" />
          </button>
          <button
            data-window-control type="button" onClick={() => setExpanded((v) => !v)}
            aria-label="تكبير / Maximise"
            className="p-1.5 rounded-lg hover:bg-white/15 hidden sm:block"
          >
            <Square className="w-3 h-3" />
          </button>
          <button
            data-window-control type="button" onClick={onClose}
            aria-label="إغلاق / Close"
            className="p-1.5 rounded-lg hover:bg-red-500"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Waveform */}
      <div className="flex items-center justify-center gap-[3px] h-14 px-4 bg-white border-b border-slate-100">
        {levels.map((v, i) => (
          <span
            key={i}
            className="w-1.5 rounded-full bg-teal-600 transition-[height] duration-75"
            style={{ height: `${Math.max(8, v * 100)}%`, opacity: recording ? 1 : 0.35 }}
          />
        ))}
      </div>

      {/* Latest turn */}
      <div className="px-4 py-3 border-b border-slate-100">
        <div className="flex items-center justify-between gap-2 mb-1">
          <span className="flex items-center gap-1.5 text-xs font-black text-slate-800">
            <span className="w-2 h-2 rounded-full bg-blue-500" /> مريض
          </span>
          {lastTurnAt && <span className="text-[10px] text-slate-400">{formatTurnTime(lastTurnAt)}</span>}
        </div>
        <p className="text-sm text-slate-700 leading-relaxed max-h-24 overflow-y-auto">
          {transcript || <span className="text-slate-400">تحدث الآن… / Speak now…</span>}
        </p>
      </div>

      {/* Completeness — same component the page uses */}
      <div className="px-4 py-3">
        <CompletenessChips patient={patient} compact />
      </div>

      <div className="flex items-center justify-between gap-2 px-4 py-2.5 bg-slate-50 border-t border-slate-100">
        {derived?.level != null ? (
          <div className="flex items-center gap-2 min-w-0">
            <span
              className="shrink-0 inline-flex items-center justify-center w-9 h-9 rounded-xl text-white text-lg font-black shadow-sm"
              style={{ backgroundColor: derived.hex }}
              title={dataComplete ? 'Estimated CTAS (data complete)' : 'Estimated CTAS (partial data)'}
            >
              {derived.level}
            </span>
            <div className="min-w-0">
              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">
                {dataComplete ? 'CTAS تقديري · Estimated' : 'CTAS أولي · Preliminary'}
              </p>
              <p className="text-xs font-black text-slate-800 truncate">
                {derived.ar || derived.en || `CTAS ${derived.level}`}
                {derived.ar && derived.en ? ` / ${derived.en}` : ''}
              </p>
            </div>
          </div>
        ) : (
          <p className="text-xs font-bold text-slate-500">
            CTAS تقديري — <span className="text-slate-400">بانتظار بيانات كافية</span>
          </p>
        )}
        {recording && (
          <button
            type="button" onClick={onStop}
            className="px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-black shrink-0"
          >
            إيقاف / Stop
          </button>
        )}
      </div>
    </div>
  );
}
