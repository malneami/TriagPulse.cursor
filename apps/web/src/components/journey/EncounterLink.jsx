import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Barcode, Camera, CameraOff, Check, Link2 } from 'lucide-react';
import { api } from '@/api/client';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { patientNoFromBarcode } from '@triagepulse/clinical';

/**
 * HIS visit number for a journey = Transaction No. on an outpatient ticket, or Voucher No.
 * on a follow-up slip (9–10 digits). Last 3 of Patient No. / a 6–7 digit MRN barcode fill
 * the tracking suffix. The camera stays on until both the visit/voucher number and the full
 * Patient No. are read (or the nurse stops it); it only fills the boxes; the nurse checks before save.
 *
 * Barcodes: native BarcodeDetector first, @zxing/browser when missing (iPad Safari).
 * Text: tesseract.js, served by the app, loaded on first use (lib/ticketOcr).
 */

const FORMATS = ['code_128', 'code_39', 'code_93', 'codabar', 'itf', 'ean_13', 'qr_code', 'pdf417', 'data_matrix'];
/**
 * Visit / voucher number: 9–10 digits. The 7-digit patient file number (MRN) is the barcode
 * on the outpatient ticket and must not be taken as the visit number, nor the 8-digit
 * appointment / Ref. Invoice number. Override with VITE_ENCOUNTER_PATTERN.
 */
const LOOKS_RIGHT = (() => {
  try { return new RegExp(import.meta.env.VITE_ENCOUNTER_PATTERN || '^\\d{9,10}$'); } catch { return /^\d{9,10}$/; }
})();

/** Why a value is not accepted, in plain words (null when it is fine or empty). */
export function encounterProblem(raw) {
  const v = cleanEncounter(raw);
  if (!v || LOOKS_RIGHT.test(v)) return null;
  if (/^\d{6,7}$/.test(v)) return 'هذا رقم المريض (Patient No.) — ضعه في خانة رقم المريض · This is the Patient No. (MRN). Put it in the Patient No. box.';
  if (/^\d{8}$/.test(v)) return 'هذا يبدو رقم الموعد / المرجع · This looks like the Appointment / Ref. Invoice No. Use the visit or voucher number.';
  return 'رقم الزيارة أو القسيمة ٩–١٠ أرقام · Visit / voucher number is 9–10 digits';
}

export function encounterLooksRight(raw) {
  return LOOKS_RIGHT.test(cleanEncounter(raw));
}

export function cleanEncounter(raw) {
  return String(raw || '').trim().replace(/\s+/g, '').toUpperCase();
}

/** Patient No. as printed (6–7 digits) or last 3. Digits only. */
export function cleanPatientNo(raw) {
  return String(raw || '').replace(/\D/g, '').slice(0, 7);
}

/** Last 3 of Patient No. for the tracking code. Empty until 3 digits, or a full 6–7 digit file number. */
export function suffixFromPatientNo(raw) {
  const d = String(raw || '').replace(/\D/g, '');
  if (d.length === 3 || d.length === 6 || d.length === 7) return d.slice(-3);
  return '';
}

/** @deprecated Use cleanPatientNo in the input; suffixFromPatientNo on save. */
export function cleanMrnSuffix(raw) {
  return suffixFromPatientNo(raw);
}

export function mrnSuffixLooksRight(raw) {
  return suffixFromPatientNo(raw).length === 3;
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
 * Camera for the visit slip. Two readers run on the same picture, on the tablet:
 * - printed Transaction No. or Voucher No. (and Patient No. last 3) via on-device OCR;
 * - a 9–10 digit barcode is the visit number; a 6–7 digit barcode is MRN (last 3 only).
 * Frames never leave the device. Numbers found only fill the boxes; the nurse confirms.
 */
function Scanner({ onResult, onComplete }) {
  const videoRef = useRef(null);
  const [got, setGot] = useState({ visit: '', patientNo: '' });
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

    // Keep reading until BOTH the visit/voucher number and the full Patient No. (6–7 digits) are caught.
    const found = { visit: '', patientNo: '' };
    const report = (fields) => {
      if (stopped || (!fields?.visit && !fields?.patientNo && !fields?.mrnSuffix)) return;
      onResult(fields);
      const pn = fields.patientNo ? cleanPatientNo(fields.patientNo) : '';
      let changed = false;
      if (fields.visit && !found.visit) { found.visit = cleanEncounter(fields.visit); changed = true; }
      if (pn.length >= 6 && !found.patientNo) { found.patientNo = pn; changed = true; }
      if (changed) {
        setGot({ ...found });
        if (navigator.vibrate) navigator.vibrate(60);
      }
      if (found.visit && found.patientNo) {
        stopped = true;
        if (navigator.vibrate) navigator.vibrate([80, 60, 80]);
        onComplete?.({ ...found });
      }
    };
    const fromBarcode = (raw) => {
      const v = cleanEncounter(raw);
      if (LOOKS_RIGHT.test(v)) {
        report({ visit: v });
        return;
      }
      const patientNo = patientNoFromBarcode(raw);
      if (patientNo) {
        report({ patientNo });
        setNote('رقم المريض من الباركود · Patient No. (MRN) from barcode');
      }
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

      // Printed text: read frames until the visit/voucher number is found (suffix may come too).
      try {
        const { getTicketReader, readTicketFields } = await import('@/lib/ticketOcr');
        await getTicketReader((m) => {
          if (m?.status && /load|init/i.test(m.status) && typeof m.progress === 'number') {
            setOcr({ phase: 'loading', pct: Math.round(m.progress * 100) });
          }
        });
        if (stopped) return;
        setOcr({ phase: 'reading', pct: 100 });
        while (!stopped) {
          const fields = await readTicketFields(v, LOOKS_RIGHT).catch(() => null);
          if (fields?.patientNo) report({ patientNo: fields.patientNo });
          else if (fields?.mrnSuffix) report({ mrnSuffix: fields.mrnSuffix });
          if (fields?.visit) {
            report({ visit: fields.visit.value, patientNo: fields.patientNo || undefined, mrnSuffix: fields.mrnSuffix || undefined });
          }
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
  }, [onResult, onComplete]);

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
          {ocr.phase === 'reading' && 'ضع رقم العملية أو القسيمة داخل الإطار · Fit Transaction / Voucher No. in the frame'}
          {ocr.phase === 'failed' && 'تعذّر تشغيل قارئ النص — اكتب الرقم · Text reader unavailable — type the number'}
        </p>
      )}
      {state === 'scanning' && (
        <ul aria-live="polite" className="m-0 p-0 list-none flex flex-col gap-1 text-sm">
          <li className={got.visit ? 'font-semibold text-ink' : 'text-graphite'}>
            {got.visit ? '✓' : '…'} رقم الزيارة / القسيمة · Visit / voucher {got.visit && <span dir="ltr">{got.visit}</span>}
          </li>
          <li className={got.patientNo ? 'font-semibold text-ink' : 'text-graphite'}>
            {got.patientNo ? '✓' : '…'} رقم المريض · Patient No. (MRN) {got.patientNo && <span dir="ltr">{got.patientNo}</span>}
          </li>
          {(got.visit || got.patientNo) && !(got.visit && got.patientNo) && (
            <li className="font-semibold text-ink">
              الكاميرا تبقى مفتوحة حتى يُقرأ الرقمان · Camera stays on until both are read
            </li>
          )}
        </ul>
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
 * Read or type the visit/voucher number and Patient No. (MRN). With a journey, Link saves
 * them on that patient. Without one (CTAS page, no patient yet), onPick receives the values.
 */
export function EncounterDialog({ journey, open, onOpenChange, onLinked, onPick, initialValue = '', initialMrnSuffix = '' }) {
  const [value, setValue] = useState('');
  const [patientNo, setPatientNo] = useState('');
  const [scanning, setScanning] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) {
      setValue(journey?.encounter_no || initialValue || '');
      setPatientNo(journey?.mrn_suffix || initialMrnSuffix || '');
      setScanning(!(journey?.encounter_no || initialValue));
      setError('');
    }
  }, [open, journey?.encounter_no, journey?.mrn_suffix, initialValue, initialMrnSuffix]);

  // Stable, so the camera is not restarted on every keystroke.
  const onResult = useCallback((fields) => {
    if (fields.visit) setValue(cleanEncounter(fields.visit));
    if (fields.patientNo) setPatientNo(cleanPatientNo(fields.patientNo));
    else if (fields.mrnSuffix) setPatientNo(cleanPatientNo(fields.mrnSuffix));
    setError('');
  }, []);
  const onComplete = useCallback(() => setScanning(false), []);
  const clean = cleanEncounter(value);
  const visitOk = LOOKS_RIGHT.test(clean);
  const suffix = suffixFromPatientNo(patientNo);
  const suffixOk = suffix.length === 3;
  const canSave = visitOk || suffixOk;

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    setError('');
    const payload = {
      encounterNo: visitOk ? clean : undefined,
      mrnSuffix: suffixOk ? suffix : undefined,
    };
    try {
      if (!journey) {
        await onPick?.(payload);
        onOpenChange(false);
        return;
      }
      const updated = await api.journeys.linkEncounter(journey.id, payload);
      toast.success(visitOk
        ? `تم ربط رقم الزيارة ${clean} / Visit number linked`
        : `تم حفظ رقم المريض / Patient No. saved`);
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
        <DialogTitle className="text-lg">ربط رقم الزيارة ورقم المريض / Link visit no. and Patient No.</DialogTitle>
        <DialogDescription className="text-sm text-graphite">
          وجّه الكاميرا إلى التذكرة لقراءة رقم العملية أو القسيمة ورقم المريض (Patient No.)، ثم تحقق منهما.
          Point the camera at the slip to read the visit/voucher number and Patient No. (MRN), then check them.
        </DialogDescription>
        {scanning ? (
          <>
            <Scanner onResult={onResult} onComplete={onComplete} />
            <button
              type="button"
              onClick={() => setScanning(false)}
              className="h-10 rounded-xl border border-mist flex items-center justify-center gap-2 text-sm"
            >
              <CameraOff className="w-4 h-4" aria-hidden="true" /> إيقاف الكاميرا والكتابة يدوياً / Stop camera and type
            </button>
          </>
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
          <span className="text-sm font-medium">رقم الزيارة / القسيمة · Visit / voucher number</span>
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
            placeholder="9–10 digits"
            className="h-12 border border-mist rounded-xl px-3 text-lg font-semibold tracking-wide bg-white"
          />
        </label>
        {value && !visitOk && (
          <p className="text-sm font-semibold text-ink">{encounterProblem(value)}</p>
        )}
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium">رقم المريض · Patient No. (MRN)</span>
          <input
            dir="ltr"
            value={patientNo}
            onChange={(e) => { setPatientNo(cleanPatientNo(e.target.value)); setError(''); }}
            onKeyDown={(e) => { if (e.key === 'Enter') save(); }}
            inputMode="numeric"
            autoComplete="off"
            spellCheck={false}
            maxLength={7}
            placeholder="1793255"
            className="h-12 border border-mist rounded-xl px-3 text-lg font-semibold tracking-wide bg-white"
          />
          <span className="text-xs text-graphite">يُحفظ آخر ٣ فقط للتتبع · Only last 3 are kept for tracking</span>
        </label>
        {error && <p role="alert" className="text-sm font-semibold text-ink border-2 border-ink rounded-lg px-3 py-2">{error}</p>}
        <button
          type="button"
          disabled={!canSave || saving}
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
export default function EncounterLink({ journey, onLinked, tone = 'light', prominent = false }) {
  const [open, setOpen] = useState(false);
  if (!journey?.id) return null;
  const linked = journey.encounter_no;
  const dark = tone === 'dark';
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={linked ? 'تغيير رقم الزيارة / Change visit number' : 'ربط رقم الزيارة ورقم المريض / Link visit number and Patient No.'}
        className={prominent
          ? 'h-12 w-full px-4 rounded-xl bg-ink text-white flex items-center justify-center gap-2 text-[15px] font-semibold'
          : `h-9 px-3 rounded-lg flex items-center gap-1.5 text-sm font-medium shrink-0 ${
            linked
              ? (dark ? 'border border-white/50 text-white' : 'border border-mist text-ink')
              : (dark ? 'bg-white text-ink' : 'bg-ink text-white')
          }`}
      >
        {linked ? <Link2 className="w-4 h-4" aria-hidden="true" /> : <Barcode className="w-4 h-4" aria-hidden="true" />}
        <span dir="ltr">{linked || (prominent ? 'ربط الزيارة / Link Encounter' : 'Encounter')}</span>
        {!linked && !prominent && <span className="sr-only">ربط رقم الزيارة</span>}
      </button>
      <EncounterDialog journey={journey} open={open} onOpenChange={setOpen} onLinked={onLinked} />
    </>
  );
}

/**
 * Visit/voucher box for a new patient (visual triage): type it, or tap Scan and the
 * camera fills this box and Patient No. when printed. Nothing is saved here; values go
 * with the new journey.
 */
export function EncounterField({ value, onChange, onMrnSuffix, disabled = false, inputClassName = '' }) {
  const [open, setOpen] = useState(false);
  const onResult = useCallback((fields) => {
    if (fields.visit) onChange(cleanEncounter(fields.visit));
    if (fields.patientNo) onMrnSuffix?.(cleanPatientNo(fields.patientNo));
    else if (fields.mrnSuffix) onMrnSuffix?.(cleanPatientNo(fields.mrnSuffix));
  }, [onChange, onMrnSuffix]);
  const onComplete = useCallback(() => setOpen(false), []);
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
          placeholder="Visit / voucher no. (9–10 digits)"
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
          <DialogTitle className="text-lg">قراءة التذكرة / Read the slip</DialogTitle>
          <DialogDescription className="text-sm text-graphite">
            وجّه الكاميرا إلى تذكرة الزيارة أو قسيمة المتابعة · Point the camera at the visit ticket or follow-up voucher.
          </DialogDescription>
          {open && <Scanner onResult={onResult} onComplete={onComplete} />}
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="h-10 rounded-xl border border-mist flex items-center justify-center gap-2 text-sm"
          >
            <CameraOff className="w-4 h-4" aria-hidden="true" /> إيقاف الكاميرا / Stop camera
          </button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
