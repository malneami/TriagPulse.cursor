import { useEffect, useRef, useState } from 'react';
import {
  interpretHR, interpretSBP, interpretSpO2, interpretRR, interpretTemp, interpretGCS,
} from '@triagepulse/clinical';

const FIELDS = [
  { key: 'age', ar: 'العمر', en: 'Age', fmt: (p) => p.age && `${p.age}` },
  { key: 'gender', ar: 'الجنس', en: 'Sex', fmt: (p) => (p.gender === 'male' ? 'ذكر' : p.gender === 'female' ? 'أنثى' : '') },
  { key: 'weight', ar: 'الوزن', en: 'Weight', fmt: (p) => p.weight && `${p.weight} kg` },
  { key: 'chief_complaint', ar: 'الشكوى', en: 'Complaint', fmt: (p) => p.chief_complaint, wide: true },
  { key: 'pain_score', ar: 'الألم', en: 'Pain', fmt: (p) => (p.pain_score != null && p.pain_score !== '' ? `${p.pain_score}/10` : '') },
  { key: 'hr', ar: 'النبض', en: 'HR', fmt: (p) => p.hr, interp: (p) => interpretHR(p.hr, p.age) },
  { key: 'bp_systolic', ar: 'الضغط', en: 'BP', fmt: (p) => p.bp_systolic && `${p.bp_systolic}/${p.bp_diastolic || '–'}`, interp: (p) => interpretSBP(p.bp_systolic) },
  { key: 'spo2', ar: 'الأكسجين', en: 'SpO₂', fmt: (p) => p.spo2 && `${p.spo2}%`, interp: (p) => interpretSpO2(p.spo2) },
  { key: 'rr', ar: 'التنفس', en: 'RR', fmt: (p) => p.rr, interp: (p) => interpretRR(p.rr, p.age) },
  { key: 'temperature', ar: 'الحرارة', en: 'Temp', fmt: (p) => p.temperature && `${p.temperature}°`, interp: (p) => interpretTemp(p.temperature) },
  { key: 'gcs', ar: 'الوعي', en: 'GCS', fmt: (p) => p.gcs, interp: (p) => interpretGCS(p.gcs) },
];

/**
 * Live view of the structured fields while the nurse dictates. Each field fills as the
 * dictation is understood; empty mandatory fields are listed as "still needed" so the
 * nurse knows what to say next. Read-only here; corrections happen in the next step.
 */
export default function LiveFields({ patient, missing = [], total = 10, live = false, summary = null }) {
  const done = total - missing.length;
  const prev = useRef({});
  const [flash, setFlash] = useState({});

  // Briefly mark a field that has just been filled or changed by the dictation.
  useEffect(() => {
    const changed = {};
    for (const f of FIELDS) {
      const v = f.fmt(patient) || '';
      if (v && v !== prev.current[f.key]) changed[f.key] = true;
      prev.current[f.key] = v;
    }
    if (Object.keys(changed).length) {
      setFlash(changed);
      const t = setTimeout(() => setFlash({}), 1600);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [patient]);

  return (
    <section aria-label="الحقول المستخرجة / Extracted fields" className="flex flex-col gap-3">
      {summary}
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-[15px] font-semibold text-ink">
          {live ? 'تُعبّأ أثناء الإملاء · Filling as you dictate' : 'البيانات المستخرجة · Extracted data'}
        </h3>
        <span className="text-sm font-semibold text-ink tabular-nums" aria-live="polite">
          <span dir="ltr">{done}/{total}</span> مكتمل
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-mist overflow-hidden" aria-hidden="true">
        <div className="h-full bg-ink transition-all duration-500" style={{ width: `${(done / total) * 100}%` }} />
      </div>

      <dl className="grid grid-cols-3 sm:grid-cols-4 gap-2 m-0">
        {FIELDS.map((f) => {
          const value = f.fmt(patient);
          const interp = value && f.interp ? f.interp(patient) : null;
          const critical = interp?.status === 'critical';
          const abnormal = interp?.status === 'abnormal';
          return (
            <div
              key={f.key}
              className={`rounded-xl px-3 py-2 min-h-[60px] transition-colors duration-700 ${f.wide ? 'col-span-3 sm:col-span-4' : ''} ${
                critical ? 'border-2 border-[#D3242C] bg-white'
                  : value ? `border border-mist ${flash[f.key] ? 'bg-mist' : 'bg-white'}`
                    : 'border border-dashed border-mist bg-paper'
              }`}
            >
              <dt className="text-xs text-graphite">{f.ar} · {f.en}</dt>
              <dd className={`m-0 text-[17px] font-semibold truncate ${critical ? 'text-[#D3242C]' : value ? 'text-ink' : 'text-graphite/60'}`} dir="auto">
                {value || '—'}
                {(critical || abnormal) && <span className="text-xs font-semibold ms-1">· {interp.label}</span>}
              </dd>
            </div>
          );
        })}
      </dl>

      {missing.length > 0 && (
        <p className="text-sm text-ink">
          <span className="font-semibold">ما زال مطلوباً · Still needed: </span>
          {missing.map((m) => m.label_ar).join('، ')}
        </p>
      )}
    </section>
  );
}
