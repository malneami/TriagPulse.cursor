import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Barcode, Camera, CameraOff, Check, Link2 } from 'lucide-react';
import { api } from '@/api/client';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { ageLabel, patientNoFromBarcode } from '@triagepulse/clinical';

/**
 * HIS visit number for a journey = Transaction No. on an outpatient ticket, or Voucher No.
 * on a follow-up slip (9–10 digits). Last 3 of Patient No. / a 6–7 digit MRN barcode fill
 * the tracking suffix. The camera stays on until the visit/voucher number, the full Patient No.
 * and the age are read (or the nurse finishes without age / stops it); it only fills the boxes;
 * the nurse checks before save. Age comes from the printed Age, or is worked out from the date of
 * birth on the device — the date of birth itself is never kept or sent.
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

/**
 * Camera dialogs: full screen on a phone (header, scrolling body, Link button always
 * visible at the bottom); a centred card on a tablet or desktop.
 */
const SHEET = 'flex flex-col gap-0 p-0 overflow-hidden w-full max-w-md h-[100dvh] max-h-[100dvh] rounded-none sm:h-auto sm:max-h-[92dvh] sm:rounded-2xl';

/** Slip age boxes → whole months (null when empty or out of range). */
export function slipAgeMonths(years, months) {
  if (String(years ?? '') === '' && String(months ?? '') === '') return null;
  const y = parseInt(years || '0', 10);
  const m = parseInt(months || '0', 10);
  if (!Number.isFinite(y) || !Number.isFinite(m) || m > 11 || y > 130) return null;
  return y * 12 + m;
}

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
  const [got, setGot] = useState({ visit: '', patientNo: '', age: null });
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

    // Keep reading until the visit/voucher number, the full Patient No. (6–7 digits) and the age are caught.
    const found = { visit: '', patientNo: '', age: null };
    const report = (fields) => {
      if (stopped || (!fields?.visit && !fields?.patientNo && !fields?.mrnSuffix && !fields?.age)) return;
      onResult(fields);
      const pn = fields.patientNo ? cleanPatientNo(fields.patientNo) : '';
      let changed = false;
      if (fields.visit && !found.visit) { found.visit = cleanEncounter(fields.visit); changed = true; }
      if (pn.length >= 6 && !found.patientNo) { found.patientNo = pn; changed = true; }
      if (fields.age && found.age == null) { found.age = fields.age; changed = true; }
      if (changed) {
        setGot({ ...found });
        if (navigator.vibrate) navigator.vibrate(60);
      }
      if (found.visit && found.patientNo && found.age) {
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
        // Printed text can be misread (a 6 read as 3): a value counts only when two frames agree.
        const seen = { visit: new Map(), patientNo: new Map(), age: new Map() };
        const confirmed = (kind, value) => {
          if (value == null || value === '') return false;
          const n = (seen[kind].get(value) || 0) + 1;
          seen[kind].set(value, n);
          return n >= 2;
        };
        while (!stopped) {
          const fields = await readTicketFields(v, LOOKS_RIGHT).catch(() => null);
          if (fields?.age && confirmed('age', fields.age.months)) report({ age: fields.age });
          if (fields?.patientNo && confirmed('patientNo', fields.patientNo)) report({ patientNo: fields.patientNo });
          if (fields?.visit && confirmed('visit', fields.visit.value)) report({ visit: fields.visit.value });
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

  const chips = [
    { key: 'visit', ok: !!got.visit, ar: 'الزيارة', en: 'Visit', val: got.visit },
    { key: 'pn', ok: !!got.patientNo, ar: 'رقم المريض', en: 'Patient No.', val: got.patientNo },
    { key: 'age', ok: !!got.age, ar: 'العمر', en: 'Age', val: got.age ? got.age.label : '' },
  ];
  const hint = state !== 'scanning' ? ''
    : ocr.phase === 'loading' ? `تحميل القارئ ${ocr.pct}% · Loading reader (first time only)`
    : ocr.phase === 'failed' ? 'القارئ غير متاح — اكتب الأرقام · Reader unavailable — type the numbers'
    : slow ? 'قرّب التذكرة وأضف إضاءة · Move closer, add light'
    : 'ضع التذكرة كاملة داخل الإطار · Fit the whole slip in the frame';

  return (
    <div className="flex flex-col gap-2">
      <div className="relative rounded-2xl overflow-hidden bg-ink w-full aspect-[4/3] max-h-[42dvh] mx-auto">
        <video ref={videoRef} muted playsInline className="absolute inset-0 w-full h-full object-cover" aria-label="الكاميرا / Camera" />
        {state === 'scanning' && (
          <>
            <span aria-hidden="true" className="absolute inset-x-[8%] inset-y-[10%] rounded-xl border-2 border-white/90 shadow-[0_0_0_9999px_rgba(0,0,0,0.3)]" />
            <span aria-live="polite" className="absolute top-2 inset-x-2 text-center text-[13px] font-medium text-white drop-shadow">
              {hint}
            </span>
          </>
        )}
        {state !== 'scanning' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-white text-center p-4">
            {state === 'starting' ? <Camera className="w-8 h-8" aria-hidden="true" /> : <CameraOff className="w-8 h-8" aria-hidden="true" />}
            <span className="text-[15px]">
              {state === 'starting' && 'تشغيل الكاميرا… / Starting camera…'}
              {state === 'blocked' && 'الكاميرا غير مسموح بها — اكتب الأرقام أدناه · Camera blocked — type below'}
              {state === 'unsupported' && 'لا توجد كاميرا — اكتب الأرقام أدناه · No camera — type below'}
            </span>
          </div>
        )}
      </div>
      {state === 'scanning' && (
        <ul aria-live="polite" aria-label="ما تمت قراءته · Read so far" className="m-0 p-0 list-none grid grid-cols-3 gap-1.5">
          {chips.map((c) => (
            <li
              key={c.key}
              className={`min-h-12 rounded-xl px-2 py-1 flex flex-col items-center justify-center text-center leading-tight ${c.ok ? 'bg-ink text-white' : 'border border-dashed border-graphite/50 text-graphite'}`}
            >
              <span className="text-[12px]">{c.ok ? '✓ ' : ''}{c.ar} · {c.en}</span>
              <span dir="ltr" className="text-[13px] font-semibold truncate max-w-full">{c.val || '…'}</span>
            </li>
          ))}
        </ul>
      )}
      {state === 'scanning' && got.visit && got.patientNo && !got.age && (
        <button
          type="button"
          onClick={() => onComplete?.({ ...got })}
          className="h-11 rounded-xl border-2 border-ink text-ink text-sm font-semibold"
        >
          إنهاء بدون العمر · Finish without age
        </button>
      )}
      {note && <p className="m-0 text-xs text-ink">{note}</p>}
      <p className="m-0 text-[11px] text-graphite text-center">
        تُقرأ الصورة على الجهاز فقط ولا تُحفظ · Read on this device only, never saved
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
  const [ageYears, setAgeYears] = useState('');
  const [ageMonthsPart, setAgeMonthsPart] = useState('');
  const [ageFromDob, setAgeFromDob] = useState(false);
  const [scanning, setScanning] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) {
      setValue(journey?.encounter_no || initialValue || '');
      setPatientNo(journey?.mrn_suffix || initialMrnSuffix || '');
      const hm = journey?.his_age_months;
      setAgeYears(hm != null ? String(Math.floor(hm / 12)) : '');
      setAgeMonthsPart(hm != null && hm % 12 ? String(hm % 12) : '');
      setAgeFromDob(false);
      setScanning(!(journey?.encounter_no || initialValue));
      setError('');
    }
  }, [open, journey?.encounter_no, journey?.mrn_suffix, initialValue, initialMrnSuffix]);

  // Stable, so the camera is not restarted on every keystroke.
  const onResult = useCallback((fields) => {
    if (fields.visit) setValue(cleanEncounter(fields.visit));
    if (fields.patientNo) setPatientNo(cleanPatientNo(fields.patientNo));
    else if (fields.mrnSuffix) setPatientNo(cleanPatientNo(fields.mrnSuffix));
    if (fields.age) {
      setAgeYears(String(fields.age.years));
      setAgeMonthsPart(fields.age.months % 12 ? String(fields.age.months % 12) : '');
      setAgeFromDob(fields.age.source === 'dob');
    }
    setError('');
  }, []);
  const onComplete = useCallback(() => setScanning(false), []);
  const clean = cleanEncounter(value);
  const visitOk = LOOKS_RIGHT.test(clean);
  const suffix = suffixFromPatientNo(patientNo);
  const suffixOk = suffix.length === 3;
  const canSave = visitOk || suffixOk;
  const ageMonths = slipAgeMonths(ageYears, ageMonthsPart);
  const triageAge = journey?.age;
  const ageMismatch = ageMonths != null && triageAge != null && triageAge !== '' && Math.floor(ageMonths / 12) !== Number(triageAge);

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    setError('');
    const payload = {
      encounterNo: visitOk ? clean : undefined,
      mrnSuffix: suffixOk ? suffix : undefined,
      ageMonths: ageMonths ?? undefined,
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

  const field = 'h-12 w-full border border-mist rounded-xl px-3 text-lg font-semibold tracking-wide bg-white';
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className={SHEET} onOpenAutoFocus={(e) => e.preventDefault()}>
        <div className="px-4 pt-4 pb-2 ps-12 border-b border-mist">
          <DialogTitle className="text-lg leading-snug">ربط الزيارة · Link visit</DialogTitle>
          <DialogDescription className="text-sm text-graphite m-0">
            رقم الزيارة، رقم المريض والعمر · Visit no., Patient No. and age
          </DialogDescription>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 flex flex-col gap-3">
          {scanning ? (
            <>
              <Scanner onResult={onResult} onComplete={onComplete} />
              <button
                type="button"
                onClick={() => setScanning(false)}
                className="h-11 rounded-xl border border-mist flex items-center justify-center gap-2 text-sm"
              >
                <CameraOff className="w-4 h-4" aria-hidden="true" /> إيقاف الكاميرا والكتابة يدوياً · Stop camera, type
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => { setScanning(true); setValue(''); }}
              className="h-11 rounded-xl border border-mist flex items-center justify-center gap-2 text-sm"
            >
              <Camera className="w-4 h-4" aria-hidden="true" /> قراءة مرة أخرى · Read again
            </button>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-sm font-medium">رقم الزيارة / القسيمة · Visit / voucher</span>
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
                className={field}
              />
              {value && !visitOk && <span className="text-xs font-semibold text-ink">{encounterProblem(value)}</span>}
            </label>
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
                placeholder="7 digits"
                className={field}
              />
              <span className="text-xs text-graphite">يُحفظ آخر ٣ فقط · Only last 3 kept</span>
            </label>
          </div>

          <fieldset className="flex flex-col gap-1 m-0 p-0 border-0">
            <legend className="text-sm font-medium mb-1">العمر في التذكرة · Age on the slip</legend>
            <div className="grid grid-cols-2 gap-3" dir="ltr">
              <label className="flex items-center gap-2">
                <input
                  value={ageYears}
                  onChange={(e) => { setAgeYears(e.target.value.replace(/\D/g, '').slice(0, 3)); setAgeFromDob(false); }}
                  inputMode="numeric"
                  aria-label="Age years · سنوات"
                  placeholder="0"
                  className={field}
                />
                <span className="text-sm shrink-0">y · سنة</span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  value={ageMonthsPart}
                  onChange={(e) => { setAgeMonthsPart(e.target.value.replace(/\D/g, '').slice(0, 2)); setAgeFromDob(false); }}
                  inputMode="numeric"
                  aria-label="Age months · أشهر"
                  placeholder="0"
                  className={field}
                />
                <span className="text-sm shrink-0">m · شهر</span>
              </label>
            </div>
            {ageFromDob && <span className="text-xs text-graphite">محسوب من تاريخ الميلاد (لا يُحفظ التاريخ) · From the date of birth (date not kept)</span>}
            {ageMismatch && (
              <span role="alert" className="text-sm font-semibold text-ink border-2 border-ink rounded-lg px-3 py-2">
                العمر في التذكرة ({ageLabel(ageMonths)}) يختلف عن عمر الفرز ({triageAge} y) — تأكد من المريض · Slip age differs from triage age — check the patient
              </span>
            )}
          </fieldset>
        </div>

        <div className="px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] border-t border-mist bg-white flex flex-col gap-2">
          {error && <p role="alert" className="m-0 text-sm font-semibold text-ink border-2 border-ink rounded-lg px-3 py-2">{error}</p>}
          <button
            type="button"
            disabled={!canSave || saving}
            onClick={save}
            className="h-12 w-full rounded-xl bg-ink text-white font-semibold flex items-center justify-center gap-2 disabled:opacity-40"
          >
            <Check className="w-5 h-5" aria-hidden="true" /> {saving ? '…' : 'ربط · Link'}
          </button>
        </div>
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
export function EncounterField({ value, onChange, onMrnSuffix, onAge, disabled = false, inputClassName = '' }) {
  const [open, setOpen] = useState(false);
  const onResult = useCallback((fields) => {
    if (fields.visit) onChange(cleanEncounter(fields.visit));
    if (fields.patientNo) onMrnSuffix?.(cleanPatientNo(fields.patientNo));
    else if (fields.mrnSuffix) onMrnSuffix?.(cleanPatientNo(fields.mrnSuffix));
    if (fields.age) onAge?.(fields.age);
  }, [onChange, onMrnSuffix, onAge]);
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
        <DialogContent dir="rtl" className={SHEET} onOpenAutoFocus={(e) => e.preventDefault()}>
          <div className="px-4 pt-4 pb-2 ps-12 border-b border-mist">
            <DialogTitle className="text-lg leading-snug">قراءة التذكرة · Read the slip</DialogTitle>
            <DialogDescription className="text-sm text-graphite m-0">
              تذكرة الزيارة أو قسيمة المتابعة · Visit ticket or follow-up voucher
            </DialogDescription>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3">
            {open && <Scanner onResult={onResult} onComplete={onComplete} />}
          </div>
          <div className="px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] border-t border-mist bg-white">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="h-12 w-full rounded-xl border border-mist flex items-center justify-center gap-2 text-[15px]"
            >
              <CameraOff className="w-4 h-4" aria-hidden="true" /> إيقاف الكاميرا · Stop camera
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
