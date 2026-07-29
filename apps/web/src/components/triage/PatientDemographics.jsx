export default function PatientDemographics({ patient, onChange }) {
  const field = (label, labelEn, key, type = 'text', options = null) => (
    <div>
      <label className="block text-xs font-semibold text-slate-600 mb-1">
        {label} <span className="text-slate-400 font-normal">{labelEn}</span>
      </label>
      {options ? (
        <select
          value={patient[key] || ''}
          onChange={(e) => onChange({ [key]: e.target.value })}
          className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-teal-400"
        >
          <option value="">اختر...</option>
          {options.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      ) : (
        <input
          type={type}
          value={patient[key] || ''}
          onChange={(e) => onChange({ [key]: e.target.value })}
          className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400"
        />
      )}
    </div>
  );

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-4 space-y-4">
      <div>
        <h3 className="font-bold text-slate-800">بيانات المريض</h3>
        <p className="text-xs text-slate-400">Patient Demographics</p>
      </div>

      <div className="grid grid-cols-1 gap-3">
        {field('الاسم بالعربي', 'Name (Arabic)', 'patient_name_ar')}
        {field('الاسم بالإنجليزي', 'Name (English)', 'patient_name_en')}
        <div className="grid grid-cols-2 gap-3">
          {field('رقم الملف', 'MRN', 'mrn')}
          {field('الهاتف', 'Phone', 'phone', 'tel')}
        </div>
        <div className="grid grid-cols-3 gap-3">
          {field('العمر', 'Age', 'age', 'number')}
          {field('الجنس', 'Gender', 'gender', 'text', [
            { value: 'male', label: 'ذكر Male' },
            { value: 'female', label: 'أنثى Female' },
          ])}
          {field('الجنسية', 'Nationality', 'nationality')}
        </div>
        {field('التأمين / الجهة الدافعة', 'Insurance / Payer', 'insurance')}
      </div>
    </div>
  );
}