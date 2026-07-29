import VitalsBadge from './VitalsBadge';
import { interpretHR, interpretSpO2, interpretRR, interpretTemp, interpretGCS } from '../../lib/vitalRanges';

export default function VitalsForm({ vitals, onChange, highlightedFields = new Set() }) {
  const INTERP_FN = {
    hr: () => interpretHR(vitals.hr, vitals.age),
    spo2: () => interpretSpO2(vitals.spo2),
    rr: () => interpretRR(vitals.rr, vitals.age),
    temperature: () => interpretTemp(vitals.temperature),
    gcs: () => interpretGCS(vitals.gcs),
  };

  const vital = (label, labelEn, key, unit, min, max) => {
    const val = vitals[key];
    const highlighted = highlightedFields.has(key);
    const interp = INTERP_FN[key] ? INTERP_FN[key]() : null;
    const isAbnormal = interp && interp.status !== 'normal';
    return (
      <div className="flex flex-col gap-1">
        <label className="text-xs font-semibold text-slate-600">
          {label} <span className="text-slate-400 font-normal text-xs">{labelEn}</span>
        </label>
        <div className="relative">
          <input
            type="number"
            value={val || ''}
            onChange={(e) => onChange({ [key]: e.target.value ? parseFloat(e.target.value) : '' })}
            min={min} max={max}
            className={`w-full border rounded-lg px-3 py-2 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-teal-400 transition-all ${
              highlighted ? 'border-green-400 bg-green-50 text-green-800 ring-2 ring-green-300' :
              isAbnormal  ? 'border-red-400 bg-red-50 text-red-700' : 'border-slate-200'
            }`}
          />
          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-slate-400">{unit}</span>
        </div>
        <VitalsBadge interp={interp} />
      </div>
    );
  };

  const bpHighlighted = highlightedFields.has('bp_systolic');

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-4">
      <div className="mb-3">
        <h3 className="font-bold text-slate-800">العلامات الحيوية</h3>
        <p className="text-xs text-slate-400">Vital Signs</p>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {vital('معدل النبض', 'HR', 'hr', 'bpm', 0, 300)}
        <div className="flex flex-col gap-1 col-span-2 sm:col-span-1">
          <label className="text-xs font-semibold text-slate-600">
            ضغط الدم <span className="text-slate-400 font-normal">BP mmHg</span>
          </label>
          <div className="flex gap-1 items-center">
            <input
              type="number"
              value={vitals.bp_systolic || ''}
              onChange={(e) => onChange({ bp_systolic: e.target.value ? parseFloat(e.target.value) : '' })}
              placeholder="انقباضي"
              className={`w-full border rounded-lg px-2 py-2 text-sm text-center focus:outline-none focus:ring-2 focus:ring-teal-400 transition-all ${
                bpHighlighted ? 'border-green-400 bg-green-50 text-green-800 ring-2 ring-green-300' :
                vitals.bp_systolic && (vitals.bp_systolic < 90 || vitals.bp_systolic > 160) ? 'border-red-400 bg-red-50 text-red-700' : 'border-slate-200'
              }`}
            />
            <span className="text-slate-400 font-bold">/</span>
            <input
              type="number"
              value={vitals.bp_diastolic || ''}
              onChange={(e) => onChange({ bp_diastolic: e.target.value ? parseFloat(e.target.value) : '' })}
              placeholder="انبساطي"
              className="w-full border border-slate-200 rounded-lg px-2 py-2 text-sm text-center focus:outline-none focus:ring-2 focus:ring-teal-400"
            />
          </div>
        </div>
        {vital('تشبع الأكسجين', 'SpO₂', 'spo2', '%', 0, 100)}
        {vital('معدل التنفس', 'RR', 'rr', '/min', 0, 60)}
        {vital('درجة الحرارة', 'Temp', 'temperature', '°C', 30, 45)}
        {vital('مقياس غلاسكو', 'GCS', 'gcs', '/15', 3, 15)}
      </div>
    </div>
  );
}