import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Barcode, Camera, CameraOff, Check, Link2 } from 'lucide-react';
import { api } from '@/api/client';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';

/**
 * HIS encounter number for a journey (Stage A): scanned from the wristband or the
 * registration slip with the tablet camera, or typed. The scan only fills the box; the
 * nurse checks the number and taps Link, so a wrong barcode (MRN, ID card) is not saved.
 *
 * Native BarcodeDetector first (Chrome on Android/ChromeOS/macOS); @zxing/browser is loaded
 * only when that is missing (iPad Safari). Typing always works.
 */

const FORMATS = ['code_128', 'code_39', 'code_93', 'codabar', 'itf', 'ean_13', 'qr_code', 'pdf417', 'data_matrix'];
/**
 * The encounter is the HIS "Transaction No." on the outpatient visit ticket: 9–10 digits.
 * The 7-digit patient file number (MRN) is the barcode on that ticket and must not be taken
 * for it, nor the 8-digit appointment number. Override with VITE_ENCOUNTER_PATTERN.
 */
const LOOKS_RIGHT = (() => {
  try { return new RegExp(import.meta.env.VITE_ENCOUNTER_PATTERN || '^\\d{9,10}$'); } catch { return /^\d{9,10}$/; }
})();

/** Why a value is not accepted, in plain words (null when it is fine or empty). */
export function encounterProblem(raw) {
  const v = cleanEncounter(raw);
  if (!v || LOOKS_RIGHT.test(v)) return null;
  if (/^\d{6,7}$/.test(v)) return 'هذا رقم ملف المريض (MRN) وليس رقم العملية · This is the patient file number (MRN), not the Transaction No.';
  if (/^\d{8}$/.test(v)) return 'هذا يبدو رقم الموعد · This looks like the Appointment No. Use the Transaction No.';
  return 'رقم العملية ٩–١٠ أرقام من تذكرة الزيارة · Transaction No. is 9–10 digits on the visit ticket';
}

export function encounterLooksRight(raw) {
  return LOOKS_RIGHT.test(cleanEncounter(raw));
}

export function cleanEncounter(raw) {
  return String(raw || '').trim().replace(/\s+/g, '').toUpperCase();
}

async function nativeDetector() {
  if (typeof window === 'undefined' || !('BarcodeDetector' in window)) return null;
  try {
    const supported = await window.BarcodeDetector.getSupportedFormats();
    const formats = FORMATS.filter((f) => supported.includes(f));
    return formats.length ? new window.BarcodeDetector({ formats }) : null;
  } catch {
    return null;
  }
}

function Scanner({ onResult }) {
  const videoRef = useRef(null);
  const [state, setState] = useState('starting'); // starting | scanning | blocked | unsupported

  useEffect(() => {
    let stopped = false;
    let stream = null;
    let timer = null;
    let zxingControls = null;

    const done = (text) => {
      if (stopped || !text) return;
      stopped = true;
      if (navigator.vibrate) navigator.vibrate(80);
      onResult(text);
    };

    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) { setState('unsupported'); return; }
      const constraints = { video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } }, audio: false };
      const detector = await nativeDetector();
      try {
        if (detector) {
          stream = await navigator.mediaDevices.getUserMedia(constraints);
          if (stopped) return;
          const v = videoRef.current;
          v.srcObject = stream;
          await v.play().catch(() => {});
          setState('scanning');
          const tick = async () => {
            if (stopped) return;
            try {
              if (v.readyState >= 2) {
                const codes = await detector.detect(v);
                if (codes?.length) { done(codes[0].rawValue); return; }
              }
            } catch { /* frame not ready */ }
            timer = setTimeout(tick, 200);
          };
          tick();
        } else {
          const { BrowserMultiFormatReader } = await import('@zxing/browser');
          if (stopped) return;
          const reader = new BrowserMultiFormatReader();
          zxingControls = await reader.decodeFromConstraints(constraints, videoRef.current, (result) => {
            if (result) done(result.getText());
          });
          if (stopped) zxingControls.stop();
          else setState('scanning');
        }
      } catch (err) {
        setState(err?.name === 'NotAllowedError' || err?.name === 'SecurityError' ? 'blocked' : 'unsupported');
      }
    })();

    return () => {
      stopped = true;
      clearTimeout(timer);
      try { zxingControls?.stop(); } catch { /* ignore */ }
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [onResult]);

  return (
    <div className="relative rounded-xl overflow-hidden bg-ink aspect-[4/3]">
      <video ref={videoRef} muted playsInline className="w-full h-full object-cover" aria-label="الكاميرا / Camera" />
      {state === 'scanning' && (
        <span aria-hidden="true" className="absolute inset-x-8 top-1/2 h-0.5 bg-white/80 shadow-[0_0_12px_white]" />
      )}
      {state !== 'scanning' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-white text-center p-4">
          {state === 'starting' ? <Camera className="w-8 h-8" aria-hidden="true" /> : <CameraOff className="w-8 h-8" aria-hidden="true" />}
          <span className="text-[15px]">
            {state === 'starting' && 'تشغيل الكاميرا… / Starting camera…'}
            {state === 'blocked' && 'الكاميرا غير مسموح بها. اكتب الرقم أدناه. / Camera blocked — type the number below.'}
            {state === 'unsupported' && 'لا توجد كاميرا متاحة. اكتب الرقم أدناه. / No camera — type the number below.'}
          </span>
        </div>
      )}
    </div>
  );
}

export function EncounterDialog({ journey, open, onOpenChange, onLinked }) {
  const [value, setValue] = useState('');
  const [scanning, setScanning] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) { setValue(journey?.encounter_no || ''); setScanning(true); setError(''); }
  }, [open, journey?.encounter_no]);

  // Stable, so the camera is not restarted on every keystroke.
  const onResult = useCallback((text) => { setValue(cleanEncounter(text)); setScanning(false); setError(''); }, []);
  const clean = cleanEncounter(value);
  const ok = LOOKS_RIGHT.test(clean);

  const save = async () => {
    if (!ok || !journey) return;
    setSaving(true);
    setError('');
    try {
      const updated = await api.journeys.linkEncounter(journey.id, clean);
      toast.success(`تم ربط رقم الزيارة ${clean} / Encounter linked`);
      onLinked?.(updated);
      onOpenChange(false);
    } catch (err) {
      setError(err?.message || 'Could not link');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-w-md">
        <DialogTitle className="text-lg">ربط رقم العملية / Link Transaction No.</DialogTitle>
        <DialogDescription className="text-sm text-graphite">
          اكتب «رقم العملية» من تذكرة الزيارة، أو امسح باركوداً يحمله. Type the Transaction No. from the visit ticket, or scan a barcode that carries it.
        </DialogDescription>
        {scanning ? (
          <Scanner onResult={onResult} />
        ) : (
          <button
            type="button"
            onClick={() => { setScanning(true); setValue(''); }}
            className="h-11 rounded-xl border border-mist flex items-center justify-center gap-2 text-[15px]"
          >
            <Camera className="w-4 h-4" aria-hidden="true" /> مسح مرة أخرى / Scan again
          </button>
        )}
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium">رقم العملية / Transaction No.</span>
          <input
            dir="ltr"
            value={value}
            onChange={(e) => { setValue(e.target.value); setError(''); }}
            onKeyDown={(e) => { if (e.key === 'Enter') save(); }}
            inputMode="numeric"
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            maxLength={40}
            placeholder="Transaction No. (9–10 digits)"
            className="h-12 border border-mist rounded-xl px-3 text-lg font-semibold tracking-wide bg-white"
          />
        </label>
        {value && !ok && (
          <p className="text-sm font-semibold text-ink">{encounterProblem(value)}</p>
        )}
        {error && <p role="alert" className="text-sm font-semibold text-ink border-2 border-ink rounded-lg px-3 py-2">{error}</p>}
        <button
          type="button"
          disabled={!ok || saving}
          onClick={save}
          className="h-12 rounded-xl bg-ink text-white font-medium flex items-center justify-center gap-2 disabled:opacity-40"
        >
          <Check className="w-5 h-5" aria-hidden="true" /> {saving ? '…' : 'ربط / Link'}
        </button>
      </DialogContent>
    </Dialog>
  );
}

/** Compact chip: shows the linked number, or a button to scan one. */
export default function EncounterLink({ journey, onLinked, tone = 'light' }) {
  const [open, setOpen] = useState(false);
  if (!journey?.id) return null;
  const linked = journey.encounter_no;
  const dark = tone === 'dark';
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={linked ? 'تغيير رقم الزيارة / Change encounter' : 'ربط رقم الزيارة / Link encounter'}
        className={`h-9 px-3 rounded-lg flex items-center gap-1.5 text-sm font-medium shrink-0 ${
          linked
            ? (dark ? 'border border-white/50 text-white' : 'border border-mist text-ink')
            : (dark ? 'bg-white text-ink' : 'bg-ink text-white')
        }`}
      >
        {linked ? <Link2 className="w-4 h-4" aria-hidden="true" /> : <Barcode className="w-4 h-4" aria-hidden="true" />}
        <span dir="ltr">{linked || 'Encounter'}</span>
        {!linked && <span className="sr-only">ربط رقم الزيارة</span>}
      </button>
      <EncounterDialog journey={journey} open={open} onOpenChange={setOpen} onLinked={onLinked} />
    </>
  );
}

/**
 * Encounter number box for a new patient (visual triage): type it, or tap Scan and the
 * camera fills the box. Nothing is saved here; the number goes with the new journey.
 */
export function EncounterField({ value, onChange, disabled = false, inputClassName = '' }) {
  const [open, setOpen] = useState(false);
  const onResult = useCallback((text) => { onChange(cleanEncounter(text)); setOpen(false); }, [onChange]);
  const bad = value && !encounterLooksRight(value);
  return (
    <div className="flex flex-col gap-1">
      <div className="flex gap-2">
        <input
          id="vt-encounter"
          dir="ltr"
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value.toUpperCase())}
          inputMode="numeric"
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
          maxLength={40}
          placeholder="Transaction No. (9–10 digits)"
          aria-invalid={bad || undefined}
          className={`${inputClassName} flex-1 font-semibold tracking-wide`}
        />
        <button
          type="button"
          disabled={disabled}
          onClick={() => setOpen(true)}
          className="mt-1 h-12 px-4 rounded-xl bg-ink text-white flex items-center gap-2 text-sm font-semibold shrink-0 disabled:opacity-40"
        >
          <Barcode className="w-5 h-5" aria-hidden="true" /> مسح · Scan
        </button>
      </div>
      {bad && <span role="alert" className="text-sm font-semibold text-ink">{encounterProblem(value)}</span>}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent dir="rtl" className="max-w-md">
          <DialogTitle className="text-lg">مسح الباركود / Scan barcode</DialogTitle>
          <DialogDescription className="text-sm text-graphite">
            الباركود الكبير في تذكرة الزيارة هو رقم الملف (MRN) وسيُرفض. · The large barcode on the visit ticket is the MRN and will be refused.
          </DialogDescription>
          {open && <Scanner onResult={onResult} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}
