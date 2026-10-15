import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import {
  interpretHR, interpretSBP, interpretSpO2, interpretRR, interpretTemp, interpretGCS,
} from '@triagepulse/clinical';
import ChiefComplaintConfirm from '@/components/triage/ChiefComplaintConfirm';
import QuickComplaints from '@/components/triage/QuickComplaints';

/** Read an interpretation helper into one of three display states. */
function vitalState(interp) {
  if (!interp) return null;
  if (interp.status === 'critical') return { tone: 'critical', label: interp.label };
  if (interp.status === 'abnormal') return { tone: 'abnormal', label: interp.label };
  return null;
}

function Field({ id, label, en, missing, state, children, wide = false }) {
  return (
    <div className={`flex flex-col gap-1 ${wide ? 'sm:col-span-2' : ''}`}>
      <label htmlFor={id} className="text-sm text-graphite flex items-center gap-1.5 flex-wrap">
        <span className="text-ink font-medium">{label}</span>
        <span className="text-xs">{en}</span>
        {missing && <span className="text-xs font-semibold text-[#D3242C]">· مطلوب</span>}
        {state && (
          <span className={`text-xs font-semibold ${state.tone === 'critical' ? 'text-[#D3242C]' : 'text-ink'}`}>
            · {state.label}
          </span>
        )}
      </label>
      {children}
    </div>
  );
}

function inputCls(missing, state) {
  const border = state?.tone === 'critical'
    ? 'border-2 border-[#D3242C]'
    : missing
      ? 'border-2 border-dashed border-[#D3242C]/70'
      : 'border border-mist';
  return `w-full h-12 bg-white ${border} rounded-xl px-3 text-base text-ink tabular-nums focus:outline-none focus:border-ink`;
}

/**
 * The structured patient assessment, filled from the dictation and editable in place.
 * Missing mandatory items are marked, abnormal vitals flagged by age-specific norms.
 * Nothing is inferred here: empty stays empty until the nurse or the dictation fills it.
 */
export default function AssessmentCard({
  patient,
  onChange,
  missingKeys = [],
  complaintResolution,
  onComplaintConfirm,
  findings = [],
  transcript = '',
}) {
  const [showTranscript, setShowTranscript] = useState(false);
  const [showComplaintPicker, setShowComplaintPicker] = useState(false);
  const miss = (k) => missingKeys.includes(k);
  const set = (k) => (e) => onChange({ [k]: e.target.value });
  const age = patient.age;

  const vitals = [
    { key: 'hr', ar: 'النبض', en: 'HR /min', state: vitalState(interpretHR(patient.hr, age)) },
    { key: 'spo2', ar: 'الأكسجين', en: 'SpO₂ %', state: vitalState(interpretSpO2(patient.spo2)) },
    { key: 'rr', ar: 'التنفس', en: 'RR /min', state: vitalState(interpretRR(patient.rr, age)) },
    { key: 'temperature', ar: 'الحرارة', en: 'Temp °C', state: vitalState(interpretTemp(patient.temperature)) },
    { key: 'gcs', ar: 'الوعي', en: 'GCS 3–15', state: vitalState(interpretGCS(patient.gcs)) },
  ];
  const bpState = vitalState(interpretSBP(patient.bp_systolic));

  return (
    <section aria-labelledby="assessment-title" className="bg-white rounded-2xl border border-mist px-5 py-5 flex flex-col gap-5">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 id="assessment-title" className="text-lg font-semibold text-ink">تقييم المريض</h2>
          <p className="text-sm text-graphite">Patient assessment · راجع وصحّح · review and correct</p>
        </div>
        {missingKeys.length > 0 ? (
          <p className="text-sm font-semibold text-[#D3242C]">{missingKeys.length} بيانات مطلوبة ناقصة · missing</p>
        ) : (
          <p className="text-sm font-semibold text-ink">البيانات المطلوبة مكتملة · Complete</p>
        )}
      </header>

      {/* Patient */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Field id="f-age" label="العمر" en="Age (yrs)" missing={miss('age')}>
          <input id="f-age" dir="ltr" inputMode="decimal" className={inputCls(miss('age'))} value={patient.age ?? ''} onChange={set('age')} />
        </Field>
        <Field id="f-sex" label="الجنس" en="Sex">
          <div id="f-sex" role="radiogroup" aria-label="الجنس / Sex" className="flex h-12 rounded-xl border border-mist overflow-hidden">
            {[['male', 'ذكر', 'M'], ['female', 'أنثى', 'F']].map(([v, ar, en]) => (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={patient.gender === v}
                onClick={() => onChange({ gender: patient.gender === v ? '' : v })}
                className={`flex-1 text-[15px] font-medium ${patient.gender === v ? 'bg-ink text-white' : 'bg-white text-ink'}`}
              >
                {ar} <span className="text-xs opacity-75">{en}</span>
              </button>
            ))}
          </div>
        </Field>
        <Field id="f-weight" label="الوزن" en="Weight kg" missing={miss('weight')}>
          <input id="f-weight" dir="ltr" inputMode="decimal" className={inputCls(miss('weight'))} value={patient.weight ?? ''} onChange={set('weight')} />
        </Field>
        <Field id="f-onset" label="بداية الأعراض" en="Onset">
          <input id="f-onset" dir="auto" className={inputCls(false)} value={patient.onset_duration ?? ''} onChange={set('onset_duration')} />
        </Field>
      </div>

      {/* Presentation */}
      <div className="flex flex-col gap-3">
        <Field id="f-cc" label="الشكوى الرئيسية" en="Chief complaint" missing={miss('chief_complaint')} wide>
          <div className="flex gap-2">
            <input
              id="f-cc"
              dir="auto"
              className={inputCls(miss('chief_complaint'))}
              value={patient.chief_complaint ?? ''}
              onChange={(e) => onChange({ chief_complaint: e.target.value, confirmed_complaint_key: null })}
            />
            <button
              type="button"
              onClick={() => setShowComplaintPicker((v) => !v)}
              aria-expanded={showComplaintPicker}
              className="h-12 px-3 shrink-0 rounded-xl border border-mist text-ink text-sm font-medium flex items-center gap-1 hover:border-ink"
            >
              اختيار <ChevronDown className={`w-4 h-4 transition-transform ${showComplaintPicker ? 'rotate-180' : ''}`} aria-hidden="true" />
            </button>
          </div>
        </Field>
        {showComplaintPicker && (
          <QuickComplaints
            compact
            selected={patient.chief_complaint}
            onSelect={(v) => { onChange({ chief_complaint: v, confirmed_complaint_key: null }); setShowComplaintPicker(false); }}
          />
        )}
        {complaintResolution?.needs_confirmation && (
          <ChiefComplaintConfirm
            resolution={complaintResolution}
            confirmedKey={patient.confirmed_complaint_key}
            onConfirm={onComplaintConfirm}
          />
        )}

        <Field id="f-pain" label="درجة الألم" en="Pain 0–10" missing={miss('pain_score')} wide>
          <div id="f-pain" role="radiogroup" aria-label="درجة الألم / Pain score" dir="ltr" className="grid grid-cols-11 gap-1">
            {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => {
              const sel = patient.pain_score === n || String(patient.pain_score) === String(n);
              return (
                <button
                  key={n}
                  type="button"
                  role="radio"
                  aria-checked={sel}
                  onClick={() => onChange({ pain_score: sel ? null : n })}
                  className={`h-11 rounded-lg text-[15px] font-semibold tabular-nums border ${
                    sel ? 'bg-ink border-ink text-white' : `bg-white text-ink ${miss('pain_score') ? 'border-dashed border-[#D3242C]/70' : 'border-mist'}`
                  }`}
                >
                  {n}
                </button>
              );
            })}
          </div>
        </Field>
      </div>

      {/* Vital signs */}
      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-ink">العلامات الحيوية · Vital signs <span className="font-normal text-graphite">(حسب العمر · age-adjusted)</span></h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <Field id="f-bp" label="الضغط" en="BP mmHg" missing={miss('bp_systolic')} state={bpState}>
            <div id="f-bp" dir="ltr" className="flex items-center gap-1">
              <input aria-label="Systolic" inputMode="numeric" className={inputCls(miss('bp_systolic'), bpState)} value={patient.bp_systolic ?? ''} onChange={set('bp_systolic')} />
              <span className="text-graphite">/</span>
              <input aria-label="Diastolic" inputMode="numeric" className={inputCls(false)} value={patient.bp_diastolic ?? ''} onChange={set('bp_diastolic')} />
            </div>
          </Field>
          {vitals.map((v) => (
            <Field key={v.key} id={`f-${v.key}`} label={v.ar} en={v.en} missing={miss(v.key)} state={v.state}>
              <input
                id={`f-${v.key}`}
                dir="ltr"
                inputMode="decimal"
                className={inputCls(miss(v.key), v.state)}
                value={patient[v.key] ?? ''}
                onChange={set(v.key)}
              />
            </Field>
          ))}
        </div>
      </div>

      {/* History */}
      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-ink">التاريخ وعوامل الخطورة · History and risk factors</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field id="f-hx" label="التاريخ المرضي" en="History">
            <input id="f-hx" dir="auto" className={inputCls(false)} value={patient.relevant_history ?? ''} onChange={set('relevant_history')} />
          </Field>
          <Field id="f-meds" label="الأدوية" en="Medications">
            <input id="f-meds" dir="auto" className={inputCls(false)} value={patient.current_medications ?? ''} onChange={set('current_medications')} />
          </Field>
          <Field id="f-allergy" label="الحساسية" en="Allergies">
            <input id="f-allergy" dir="auto" className={inputCls(false)} value={patient.allergies ?? ''} onChange={set('allergies')} />
          </Field>
        </div>
      </div>

      {findings.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold text-ink">علامات مكتشفة · Detected findings</h3>
          <ul className="flex flex-wrap gap-2 list-none m-0 p-0">
            {findings.map((f) => (
              <li key={f.key} className={`text-sm px-3 py-1 rounded-full border ${f.critical ? 'border-[#D3242C] text-[#D3242C] font-semibold' : 'border-mist text-ink'}`}>
                {f.label}
              </li>
            ))}
          </ul>
        </div>
      )}

      {transcript && (
        <div>
          <button
            type="button"
            onClick={() => setShowTranscript((v) => !v)}
            aria-expanded={showTranscript}
            className="text-sm text-graphite underline min-h-[44px]"
          >
            {showTranscript ? 'إخفاء النص · Hide transcript' : 'عرض النص المسجّل · Show transcript'}
          </button>
          {showTranscript && (
            <p dir="auto" className="mt-1 bg-paper rounded-xl px-4 py-3 text-[15px] leading-relaxed text-ink whitespace-pre-wrap">{transcript}</p>
          )}
        </div>
      )}
    </section>
  );
}
