import { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import {
  interpretHR, interpretSBP, interpretSpO2, interpretRR, interpretTemp, interpretGCS,
} from '@triagepulse/clinical';

/**
 * Expected weight for age (APLS: <1 y 0.5×months+4; 1–5 y 2×age+8; 6–12 y 3×age+7).
 * Flags a value far outside it (often a mis-heard number); display only.
 */
function weightCheck(weight, age) {
  const w = parseFloat(weight);
  const a = parseFloat(age);
  if (!Number.isFinite(w) || !Number.isFinite(a) || a < 0 || a > 12) return null;
  const expected = a < 1 ? 0.5 * Math.round(a * 12) + 4 : a <= 5 ? 2 * a + 8 : 3 * a + 7;
  if (w > expected * 1.75 || w < expected * 0.6) {
    return { status: 'abnormal', label: `تحقق ~${Math.round(expected)}kg` };
  }
  return null;
}

const TILES = [
  { key: 'age', ar: 'العمر', en: 'Age', mode: 'decimal' },
  { key: 'gender', ar: 'الجنس', en: 'Sex', type: 'sex' },
  { key: 'weight', ar: 'الوزن kg', en: 'Weight', mode: 'decimal', interp: (p) => weightCheck(p.weight, p.age) },
  { key: 'chief_complaint', ar: 'الشكوى', en: 'Complaint', wide: true, text: true },
  { key: 'pain_score', ar: 'الألم /10', en: 'Pain', mode: 'numeric' },
  { key: 'hr', ar: 'النبض', en: 'HR', mode: 'numeric', interp: (p) => interpretHR(p.hr, p.age) },
  { key: 'bp_systolic', ar: 'الضغط', en: 'BP', type: 'bp', interp: (p) => interpretSBP(p.bp_systolic) },
  { key: 'spo2', ar: 'الأكسجين %', en: 'SpO₂', mode: 'numeric', interp: (p) => interpretSpO2(p.spo2) },
  { key: 'rr', ar: 'التنفس', en: 'RR', mode: 'numeric', interp: (p) => interpretRR(p.rr, p.age) },
  { key: 'temperature', ar: 'الحرارة °C', en: 'Temp', mode: 'decimal', interp: (p) => interpretTemp(p.temperature) },
  { key: 'gcs', ar: 'الوعي', en: 'GCS', mode: 'numeric', interp: (p) => interpretGCS(p.gcs) },
];

const val = (v) => (v == null ? '' : String(v));

/**
 * The structured fields, filled live from the dictation and editable in place: a tap
 * on any tile corrects that one value. Missing mandatory fields are dashed; abnormal
 * vitals are flagged with age-adjusted ranges. Nothing is filled in by assumption.
 */
export default function FieldGrid({
  patient, onChange, missingKeys = [], total = 10, more = null, complaintSlot = null, historySlot = null,
  bedside = null, confirmKeys = [],
}) {
  const done = total - missingKeys.length;
  const [showMore, setShowMore] = useState(false);
  const prev = useRef({});
  const [flash, setFlash] = useState({});

  // Briefly mark values that the dictation has just filled or changed.
  useEffect(() => {
    const changed = {};
    for (const t of TILES) {
      const v = val(patient[t.key]);
      if (v && v !== prev.current[t.key] && document.activeElement?.id !== `fg-${t.key}`) changed[t.key] = true;
      prev.current[t.key] = v;
    }
    if (!Object.keys(changed).length) return undefined;
    setFlash(changed);
    const id = setTimeout(() => setFlash({}), 1400);
    return () => clearTimeout(id);
  }, [patient]);

  return (
    <section aria-labelledby="fg-title" className="tp-card p-3 md:p-4 flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <h2 id="fg-title" className="text-[15px] font-semibold text-ink whitespace-nowrap">
          بيانات المريض <span className="hidden sm:inline text-graphite font-normal">· Patient data</span>
        </h2>
        <div className="flex-1 h-2 rounded-full bg-paper overflow-hidden" aria-hidden="true">
          <div className="h-full rounded-full bg-ink transition-all duration-500" style={{ width: `${(done / total) * 100}%` }} />
        </div>
        <span className="text-sm font-semibold text-ink tabular-nums whitespace-nowrap" aria-live="polite">
          <span dir="ltr">{done}/{total}</span> <span className="hidden sm:inline font-normal text-graphite">مكتمل · captured</span>
        </span>
      </div>

      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 md:gap-2.5">
        {TILES.map((t) => {
          const v = val(patient[t.key]);
          const missing = missingKeys.includes(t.key === 'gender' ? '__none' : t.key);
          const interp = v && t.interp ? t.interp(patient) : null;
          const critical = interp?.status === 'critical';
          const abnormal = interp?.status === 'abnormal';
          const toConfirm = confirmKeys.includes(t.key);
          const tone = toConfirm ? 'border-2 border-dashed border-[#F2C230] bg-white'
            : critical ? 'border-2 border-[#D3242C] bg-white'
            : missing ? 'border-[1.5px] border-dashed border-[#D3242C]/50 bg-white'
              : `border border-transparent ${flash[t.key] ? 'bg-mist' : 'bg-paper'}`;
          return (
            <div key={t.key} className={`rounded-2xl px-2.5 py-1.5 md:px-3 md:py-2 transition-colors duration-700 focus-within:border-ink focus-within:bg-white ${tone} ${t.wide ? 'col-span-3 sm:col-span-6' : ''}`}>
              <label htmlFor={`fg-${t.key}`} className="flex items-center gap-1 text-xs text-graphite">
                <span className="truncate">{t.ar} · {t.en}</span>
                {toConfirm && <span className="ms-auto font-semibold text-ink">أكّد · confirm</span>}
                {!toConfirm && (critical || abnormal) && (
                  <span className={`ms-auto font-semibold truncate ${critical ? 'text-[#D3242C]' : 'text-ink'}`}>{interp.label}</span>
                )}
              </label>
              {t.key === 'chief_complaint' && complaintSlot ? (
                <div id={`fg-${t.key}`} className="pt-1 pb-0.5">{complaintSlot}</div>
              ) : t.type === 'sex' ? (
                <div id={`fg-${t.key}`} role="radiogroup" aria-label="الجنس / Sex" className="flex gap-1 mt-0.5">
                  {[['male', 'ذكر'], ['female', 'أنثى']].map(([k, ar]) => (
                    <button
                      key={k}
                      type="button"
                      role="radio"
                      aria-checked={patient.gender === k}
                      onClick={() => onChange({ gender: patient.gender === k ? '' : k })}
                      className={`flex-1 h-8 rounded-lg text-sm font-semibold ${patient.gender === k ? 'bg-ink text-white' : 'bg-white text-ink'}`}
                    >
                      {ar}
                    </button>
                  ))}
                </div>
              ) : t.type === 'bp' ? (
                <div dir="ltr" className="flex items-center gap-1">
                  <input
                    id={`fg-${t.key}`}
                    aria-label="Systolic"
                    inputMode="numeric"
                    value={v}
                    onChange={(e) => onChange({ bp_systolic: e.target.value })}
                    className={`w-full min-w-0 h-8 bg-transparent text-[17px] md:text-lg font-semibold tabular-nums focus:outline-none ${critical ? 'text-[#D3242C]' : 'text-ink'}`}
                    placeholder="—"
                  />
                  <span className="text-graphite">/</span>
                  <input
                    aria-label="Diastolic"
                    inputMode="numeric"
                    value={val(patient.bp_diastolic)}
                    onChange={(e) => onChange({ bp_diastolic: e.target.value })}
                    className="w-full min-w-0 h-8 bg-transparent text-[17px] md:text-lg font-semibold tabular-nums text-ink focus:outline-none"
                    placeholder="—"
                  />
                </div>
              ) : (
                <input
                  id={`fg-${t.key}`}
                  dir={t.text ? 'auto' : 'ltr'}
                  inputMode={t.text ? undefined : t.mode}
                  value={v}
                  onChange={(e) => onChange(t.key === 'chief_complaint'
                    ? { chief_complaint: e.target.value, confirmed_complaint_key: null }
                    : { [t.key]: e.target.value })}
                  placeholder="—"
                  className={`w-full h-8 bg-transparent text-[17px] md:text-lg font-semibold tabular-nums focus:outline-none ${t.text ? '' : 'text-start'} ${critical ? 'text-[#D3242C]' : 'text-ink'}`}
                />
              )}
            </div>
          );
        })}
      </div>

      {bedside && <BedsideTiles patient={patient} onChange={onChange} required={bedside.required} />}

      {historySlot && <div className="border-t border-mist pt-2.5">{historySlot}</div>}

      {more && (
        <div>
          <button
            type="button"
            onClick={() => setShowMore((s) => !s)}
            aria-expanded={showMore}
            className="text-sm text-ink underline min-h-[44px] flex items-center gap-1"
          >
            تفاصيل إضافية · More details
            <ChevronDown className={`w-4 h-4 transition-transform ${showMore ? 'rotate-180' : ''}`} aria-hidden="true" />
          </button>
          {showMore && <div className="mt-1 flex flex-col gap-3">{more}</div>}
        </div>
      )}
    </section>
  );
}

/**
 * Capillary glucose and ketones, shown when an illness rule needs them (e.g. a
 * diabetic child with vomiting) or once a value has been recorded.
 */
function BedsideTiles({ patient, onChange, required = [] }) {
  const g = parseFloat(patient.glucose);
  const high = Number.isFinite(g) && g > 14;
  const missing = (k) => required.includes(k) && (patient[k] === '' || patient[k] == null);
  const tone = (k, crit) => (crit ? 'border-2 border-[#D3242C] bg-white'
    : missing(k) ? 'border-[1.5px] border-dashed border-[#D3242C]/50 bg-white' : 'border border-transparent bg-paper');
  return (
    <div className="grid grid-cols-2 sm:grid-cols-6 gap-2 md:gap-2.5" aria-label="فحوص سريرية مطلوبة / Bedside checks">
      <div className={`rounded-2xl px-2.5 py-1.5 md:px-3 md:py-2 sm:col-span-2 focus-within:border-ink ${tone('glucose', high)}`}>
        <label htmlFor="fg-glucose" className="flex items-center gap-1 text-xs text-graphite">
          <span className="truncate">سكر الدم mmol/L · Glucose</span>
          {high && <span className="ms-auto font-semibold text-[#D3242C]">&gt; 14</span>}
        </label>
        <input
          id="fg-glucose"
          dir="ltr"
          inputMode="decimal"
          value={patient.glucose ?? ''}
          onChange={(e) => onChange({ glucose: e.target.value })}
          placeholder="—"
          className={`w-full h-8 bg-transparent text-[17px] md:text-lg font-semibold tabular-nums focus:outline-none text-start ${high ? 'text-[#D3242C]' : 'text-ink'}`}
        />
      </div>
      <div className={`rounded-2xl px-2.5 py-1.5 md:px-3 md:py-2 sm:col-span-2 ${tone('ketones', patient.ketones === 'positive')}`}>
        <p className="text-xs text-graphite">الكيتونات · Ketones</p>
        <div role="radiogroup" aria-label="الكيتونات / Ketones" className="flex gap-1 mt-0.5">
          {[['negative', 'سلبي · neg'], ['positive', 'إيجابي · pos']].map(([k, label]) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={patient.ketones === k}
              onClick={() => onChange({ ketones: patient.ketones === k ? '' : k })}
              className={`flex-1 h-8 rounded-lg text-sm font-semibold ${patient.ketones === k ? (k === 'positive' ? 'bg-[#D3242C] text-white' : 'bg-ink text-white') : 'bg-white text-ink'}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
