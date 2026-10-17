import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Barcode, Camera, CameraOff, Check, Link2 } from 'lucide-react';
import { api } from '@/api/client';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';

/**
 * HIS encounter number for a journey = the "Transaction No." on the outpatient visit ticket.
 * The camera reads it (printed text, or a barcode if one carries it), or the nurse types it.
 * The camera only fills the box; the nurse checks the number before it is saved.
 *
 * Barcodes: native BarcodeDetector first, @zxing/browser when missing (iPad Safari).
 * Text: tesseract.js, served by the app, loaded on first use (lib/ticketOcr).
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

/**
 * Camera for the visit ticket. Two readers run on the same picture, on the tablet:
 * - the printed "Transaction No." is read as text (on-device OCR, loaded on first use);
 * - any barcode is decoded, but only a barcode that holds a valid Transaction No. is taken
 *   (the ticket's own barcode is the MRN and is ignored).
 * Frames never leave the device. The number found only fills the box; the nurse confirms.
 */
function Scanner({ onResult }) {
  const videoRef = useRef(null);
  const [state, setState] = useState('starting'); // starting | scanning | blocked | unsupported
  const [ocr, setOcr] = useState({ phase: 'loading', pct: 0 }); // loading | reading | failed
  const [note, setNote] = useState('');
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    let stopped = false;
    let stream = null;
    let timer = null;
    let slowTimer = null;
    let zxingControls = null;

    const done = (text) => {
      if (stopped || !text) return;
      stopped = true;
      if (navigator.vibrate) navigator.vibrate(80);
      onResult(text);
    };
    const fromBarcode = (raw) => {
      const v = cleanEncounter(raw);
      if (LOOKS_RIGHT.test(v)) done(v);
      else if (/^\d{6,7}$/.test(v)) setNote('الباركود هو رقم الملف (MRN) — تم تجاهله · The barcode is the MRN — ignored');
    };

    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) { setState('unsupported'); return; }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false,
        });
      } catch (err) {
        setState(err?.name === 'NotAllowedError' || err?.name === 'SecurityError' ? 'blocked' : 'unsupported');
        return;
      }
      if (stopped) { stream.getTracks().forEach((t) => t.stop()); return; }
      const v = videoRef.current;
      v.srcObject = stream;
      await v.play().catch(() => {});
      setState('scanning');
      slowTimer = setTimeout(() => setSlow(true), 25000);

      // Barcodes: native detector, else zxing on the same video.
      const detector = await nativeDetector();
      if (detector) {
        const tick = async () => {
          if (stopped) return;
          try {
            if (v.readyState >= 2) {
              const codes = await detector.detect(v);
              for (const c of codes || []) fromBarcode(c.rawValue);
            }
          } catch { /* frame not ready */ }
          timer = setTimeout(tick, 250);
        };
        tick();
      } else {
        import('@zxing/browser').then(({ BrowserMultiFormatReader }) => {
          if (stopped) return;
          const reader = new BrowserMultiFormatReader();
          reader.decodeFromVideoElement(v, (result) => { if (result) fromBarcode(result.getText()); })
            .then((c) => { zxingControls = c; if (stopped) c.stop(); })
            .catch(() => {});
        }).catch(() => {});
      }

      // Printed text: read frames one after another until the Transaction No. is found.
      try {
        const { getTicketReader, readTransactionNo } = await import('@/lib/ticketOcr');
        await getTicketReader((m) => {
          if (m?.status && /load|init/i.test(m.status) && typeof m.progress === 'number') {
            setOcr({ phase: 'loading', pct: Math.round(m.progress * 100) });
          }
        });
        if (stopped) return;
        setOcr({ phase: 'reading', pct: 100 });
        while (!stopped) {
          const found = await readTransactionNo(v, LOOKS_RIGHT).catch(() => null);
          if (found) { done(found.value); return; }
          await new Promise((r) => setTimeout(r, 300));
        }
      } catch {
        if (!stopped) setOcr({ phase: 'failed', pct: 0 });
      }
    })();

    return () => {
      stopped = true;
      clearTimeout(timer);
      clearTimeout(slowTimer);
      try { zxingControls?.stop(); } catch { /* ignore */ }
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [onResult]);

  return (
    <div className="flex flex-col gap-2">
      <div className="relative rounded-xl overflow-hidden bg-ink aspect-[4/3]">
        <video ref={videoRef} muted playsInline className="w-full h-full object-cover" aria-label="الكاميرا / Camera" />
        {state === 'scanning' && (
          <span aria-hidden="true" className="absolute inset-6 rounded-lg border-2 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.25)]" />
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
      {state === 'scanning' && (
        <p aria-live="polite" className="m-0 text-sm text-graphite">
          {ocr.phase === 'loading' && `تحميل قارئ النص (أول مرة فقط) ${ocr.pct}% · Loading the text reader (first time only)`}
          {ocr.phase === 'reading' && 'ضع «Transaction No.» داخل الإطار، والتذكرة مستوية · Fit “Transaction No.” in the frame, ticket flat'}
          {ocr.phase === 'failed' && 'تعذّر تشغيل قارئ النص — اكتب الرقم · Text reader unavailable — type the number'}
        </p>
      )}
      {note && <p className="m-0 text-sm text-ink">{note}</p>}
      {slow && ocr.phase === 'reading' && (
        <p className="m-0 text-sm font-semibold text-ink">
          لم يُقرأ بعد: قرّب التذكرة وأضف إضاءة، أو اكتب الرقم · Not read yet: closer, more light, or type it
        </p>
      )}
      <p className="m-0 text-xs text-graphite">
        تُقرأ الصورة على الجهاز فقط ولا تُحفظ · The picture is read on this device only and is not saved.
      </p>
    </div>
  );
}

/**
 * Read or type the Transaction No. With a journey, Link saves it on that patient.
 * Without one (CTAS page, no patient yet), onPick receives the checked number instead.
 */
export function EncounterDialog({ journey, open, onOpenChange, onLinked, onPick, initialValue = '' }) {
  const [value, setValue] = useState('');
  const [scanning, setScanning] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) { setValue(journey?.encounter_no || initialValue || ''); setScanning(!(journey?.encounter_no || initialValue)); setError(''); }
  }, [open, journey?.encounter_no, initialValue]);

  // Stable, so the camera is not restarted on every keystroke.
  const onResult = useCallback((text) => { setValue(cleanEncounter(text)); setScanning(false); setError(''); }, []);
  const clean = cleanEncounter(value);
  const ok = LOOKS_RIGHT.test(clean);

  const save = async () => {
    if (!ok) return;
    setSaving(true);
    setError('');
    try {
      if (!journey) {
        await onPick?.(clean);
        onOpenChange(false);
        return;
      }
      const updated = await api.journeys.linkEncounter(journey.id, clean);
      toast.success(`تم ربط رقم العملية ${clean} / Transaction No. linked`);
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
          وجّه الكاميرا إلى تذكرة الزيارة لقراءة «رقم العملية»، ثم تحقق منه. Point the camera at the visit ticket to read the Transaction No., then check it.
        </DialogDescription>
        {scanning ? (
          <Scanner onResult={onResult} />
        ) : (
          <button
            type="button"
            onClick={() => { setScanning(true); setValue(''); }}
            className="h-11 rounded-xl border border-mist flex items-center justify-center gap-2 text-[15px]"
          >
            <Camera className="w-4 h-4" aria-hidden="true" /> قراءة مرة أخرى / Read again
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
          <Camera className="w-5 h-5" aria-hidden="true" /> كاميرا · Camera
        </button>
      </div>
      {bad && <span role="alert" className="text-sm font-semibold text-ink">{encounterProblem(value)}</span>}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent dir="rtl" className="max-w-md">
          <DialogTitle className="text-lg">قراءة رقم العملية / Read the Transaction No.</DialogTitle>
          <DialogDescription className="text-sm text-graphite">
            وجّه الكاميرا إلى تذكرة الزيارة · Point the camera at the visit ticket.
          </DialogDescription>
          {open && <Scanner onResult={onResult} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}
