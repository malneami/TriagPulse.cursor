// Section B — Infectious Disease Screening
// Scoring follows the official MOH Acute Respiratory Illness Risk table

// A. Exposure Risks — score 3 if ANY one is present (all-or-nothing)
const EXPOSURES = [
  { id: 'travel',   ar: 'سفر خارج المملكة خلال 14 يوماً قبل ظهور الأعراض أو إقامة في منطقة عالية المخاطر', en: 'Travel abroad OR residing in high-risk area in the 14 days prior to symptom onset' },
  { id: 'contact',  ar: 'تواصل جسدي مباشر مع حالة مؤكدة COVID-19 أو MERS-CoV خلال 14 يوماً',                en: 'Close contact with a confirmed COVID-19 or MERS-CoV case in the past 14 days' },
  { id: 'camel',    ar: 'تعرض للإبل أو منتجاتها (مباشر أو غير مباشر) خلال 14 يوماً',                       en: 'Exposure to camel or camel\'s products (direct or indirect) in the past 14 days' },
  { id: 'hcw',      ar: 'يعمل في منشأة صحية',                                                               en: 'Working in a healthcare facility' },
];

// B. Clinical Signs — score depends on age (pediatric / adult)
const CLINICAL = [
  { id: 'fever',   ar: 'حمى أو تاريخ حديث للحمى',            en: 'Fever or recent history of fever',                           score_adult: 2, score_ped: 1 },
  { id: 'cough',   ar: 'سعال جديد أو متفاقم',                 en: 'Cough (new or worsening)',                                   score_adult: 2, score_ped: 1 },
  { id: 'dyspnea', ar: 'ضيق تنفس جديد أو متفاقم',             en: 'Shortness of breath (new or worsening)',                     score_adult: 2, score_ped: 1 },
  { id: 'gi',      ar: 'غثيان أو تقيؤ أو إسهال',              en: 'Nausea, vomiting, and/or diarrhea',                          score_adult: 1, score_ped: 0 },
  { id: 'comorbid',ar: 'فشل كلوي مزمن أو أمراض القلب (CAD/HF) أو نقص المناعة', en: 'Chronic renal failure, CAD/heart failure, Immunocompromised patient', score_adult: 1, score_ped: 0 },
];

const MPOX_SYMPTOMS = [
  { id: 'high_fever', ar: 'حمى عالية (> 38.2°C)', en: 'High grade fever (> 38.2°C)' },
  { id: 'lymph',      ar: 'تضخم الغدد الليمفاوية', en: 'Lymphadenopathy' },
  { id: 'intense_ha', ar: 'صداع شديد',              en: 'Intense Headache' },
  { id: 'myalgia',    ar: 'آلام الظهر أو الجسم',    en: 'Back pain / myalgia' },
];

function CheckRow({ id, ar, en, checked, onChange, badge = null }) {
  return (
    <button
      onClick={() => onChange(id)}
      className={`w-full text-right flex items-start gap-3 px-3 py-2.5 rounded-xl border transition-all ${
        checked ? 'bg-red-50 border-red-300 text-red-800' : 'bg-white border-slate-200 text-slate-700 hover:border-slate-300'
      }`}
    >
      <span className={`w-5 h-5 rounded border-2 shrink-0 mt-0.5 flex items-center justify-center text-xs font-bold ${
        checked ? 'bg-red-600 border-red-600 text-white' : 'border-slate-300'
      }`}>{checked ? '✓' : ''}</span>
      <span className="text-xs leading-relaxed flex-1">
        <span className="font-bold block">{ar}</span>
        <span className="text-slate-400">{en}</span>
      </span>
      {badge && <span className="shrink-0 text-xs font-black bg-slate-100 text-slate-600 rounded-full px-2 py-0.5 self-center">{badge}</span>}
    </button>
  );
}

export default function SectionB({
  symptoms, setSymptoms,
  noSymptoms, setNoSymptoms,
  exposures, setExposures,
  mpoxRash, setMpoxRash,
  mpoxSymptoms, setMpoxSymptoms,
  isPediatric,
}) {
  // A. Exposure: score 3 if ANY exposure is checked
  const anyExposure = Object.values(exposures).some(Boolean);
  const exposureScore = anyExposure ? 3 : 0;

  // B. Clinical: sum individual scores based on age group
  const clinicalScore = noSymptoms ? 0 : CLINICAL.reduce((sum, item) => {
    if (!symptoms[item.id]) return sum;
    return sum + (isPediatric ? item.score_ped : item.score_adult);
  }, 0);

  const totalScore = exposureScore + clinicalScore;

  const toggleSymptom = (id) => {
    setNoSymptoms(false);
    setSymptoms(prev => ({ ...prev, [id]: !prev[id] }));
  };
  const toggleExposure = (id) => {
    setNoSymptoms(false);
    setExposures(prev => ({ ...prev, [id]: !prev[id] }));
  };
  const handleNoSymptoms = () => {
    setNoSymptoms(true);
    setSymptoms({});
    setExposures({});
  };

  // Monkeypox
  const mpoxAssociated = MPOX_SYMPTOMS.filter(s => mpoxSymptoms[s.id]);
  const mpoxRisk = mpoxRash === 'yes' && mpoxAssociated.length > 0 ? 'suspected'
    : mpoxRash === 'yes' ? 'monitor' : 'none';

  const scoreColor = totalScore >= 4 ? 'bg-red-600 text-white' : totalScore >= 2 ? 'bg-orange-500 text-white' : 'bg-green-600 text-white';
  const scoreBg    = totalScore >= 4 ? 'bg-red-50 border-red-300' : totalScore >= 2 ? 'bg-orange-50 border-orange-300' : 'bg-green-50 border-green-200';

  return (
    <div className="space-y-4">
      <div>
        <span className="text-xs font-black text-slate-500 uppercase tracking-wide">القسم ب — Section B</span>
        <p className="text-sm font-black text-slate-700 mt-0.5">فحص الأمراض التنفسية الحادة — Acute Respiratory Illness Screening</p>
        {isPediatric && <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-bold">👶 Pediatric scoring active</span>}
      </div>

      {/* A. Exposure Risks */}
      <div>
        <div className="flex items-center justify-between mb-2 border-b border-slate-200 pb-1">
          <p className="text-xs font-black text-slate-600">أ — خطر التعرض / A. Exposure Risks</p>
          <span className="text-xs font-black bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">
            {anyExposure ? <span className="text-red-600">+3 نقاط</span> : '3 نقاط إذا تحقق أي منها'}
          </span>
        </div>
        <div className="space-y-1.5">
          {EXPOSURES.map(e => (
            <CheckRow key={e.id} {...e} checked={!!exposures[e.id]} onChange={toggleExposure} badge="+3 pts (any)" />
          ))}
        </div>
        {anyExposure && (
          <div className="mt-2 bg-red-50 border border-red-200 rounded-xl px-3 py-2 text-xs text-red-700 font-bold">
            ✅ تحقق خطر التعرض — Score +3 added
          </div>
        )}
      </div>

      {/* B. Clinical Signs */}
      <div>
        <div className="flex items-center justify-between mb-2 border-b border-slate-200 pb-1">
          <p className="text-xs font-black text-slate-600">ب — الأعراض السريرية / B. Clinical Signs & Symptoms</p>
        </div>
        {/* Score table header */}
        <div className="grid grid-cols-3 text-xs font-black text-slate-500 mb-2 px-3">
          <span className="col-span-1">العرض / Symptom</span>
          <span className="text-center">Ped</span>
          <span className="text-center">Adult</span>
        </div>
        <div className="space-y-1.5">
          {CLINICAL.map(item => (
            <div key={item.id} className="flex items-center gap-1">
              <div className="flex-1">
                <CheckRow
                  id={item.id} ar={item.ar} en={item.en}
                  checked={!!symptoms[item.id]}
                  onChange={toggleSymptom}
                />
              </div>
              <div className="flex flex-col gap-0.5 shrink-0 text-center w-16">
                <span className={`text-xs font-black px-2 py-1 rounded ${isPediatric ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-400'}`}>
                  {item.score_ped === 0 ? '—' : item.score_ped}
                </span>
                <span className={`text-xs font-black px-2 py-1 rounded ${!isPediatric ? 'bg-orange-100 text-orange-700' : 'bg-slate-100 text-slate-400'}`}>
                  {item.score_adult}
                </span>
              </div>
            </div>
          ))}
        </div>

        {/* No symptoms button */}
        <div className="mt-2">
          <button
            onClick={handleNoSymptoms}
            className={`w-full text-right flex items-start gap-3 px-3 py-2.5 rounded-xl border transition-all ${
              noSymptoms ? 'bg-green-50 border-green-400 text-green-800' : 'bg-white border-slate-200 text-slate-700 hover:border-green-300'
            }`}
          >
            <span className={`w-5 h-5 rounded border-2 shrink-0 mt-0.5 flex items-center justify-center text-xs font-bold ${
              noSymptoms ? 'bg-green-600 border-green-600 text-white' : 'border-slate-300'
            }`}>{noSymptoms ? '✓' : ''}</span>
            <span className="text-xs"><span className="font-bold block">لا توجد أعراض تنفسية</span><span className="text-slate-400">No respiratory symptoms</span></span>
          </button>
        </div>
      </div>

      {/* Total Score Box */}
      <div className={`rounded-2xl border-2 px-4 py-3 ${scoreBg}`}>
        <div className="flex items-center justify-between mb-2">
          <div>
            <p className="text-xs font-black text-slate-700">الدرجة الإجمالية — Total Score</p>
            <div className="flex gap-3 text-xs mt-1">
              <span className="text-slate-500">A (تعرض): <span className="font-black text-red-600">{exposureScore}</span></span>
              <span className="text-slate-500">B (أعراض): <span className="font-black text-orange-600">{clinicalScore}</span></span>
            </div>
          </div>
          <div className={`w-14 h-14 rounded-full flex items-center justify-center font-black text-3xl shadow ${scoreColor}`}>
            {totalScore}
          </div>
        </div>
        {totalScore >= 4 && (
          <div className="text-xs space-y-1 text-red-800 bg-red-100 rounded-xl p-2.5 font-medium">
            <p className="font-black text-red-700">⚠ الدرجة ≥ 4 — إجراءات إلزامية / Score ≥ 4 — Required Actions:</p>
            <p>① اطلب غسل اليدين — Ask patient to perform hand hygiene</p>
            <p>② أعطِ كمامة جراحية — Give patient a surgical mask</p>
            <p>③ وجّه عبر المسار التنفسي — Direct through the respiratory pathway</p>
            <p>④ أبلغ الطبيب للتقييم — Inform MD for assessment</p>
            <p className="mt-1 text-red-600 font-black border-t border-red-200 pt-1">⚠ اختبار MERS-CoV / COVID-19 وفق تعريفات الحالات الرسمية فقط<br/><span className="font-normal">MERS-CoV OR COVID-19 testing per case definitions only</span></p>
          </div>
        )}
        {totalScore >= 2 && totalScore < 4 && (
          <p className="text-xs text-orange-700 font-bold">⚠ مخاطر معتدلة — ضع كمامة وراقب / Moderate risk — mask and monitor</p>
        )}
        {totalScore < 2 && (
          <p className="text-xs text-green-700 font-bold">✓ مخاطر منخفضة — Low risk</p>
        )}
      </div>

      {/* Part 3 — Monkeypox */}
      <div>
        <p className="text-xs font-black text-slate-600 mb-2 border-b border-slate-200 pb-1">
          ٣ — خطر الإصابة بجدري القرود / Risk for Monkeypox
        </p>
        <p className="text-xs font-bold text-slate-700 mb-2">
          هل يوجد طفح جلدي غير مفسر؟ <span className="text-slate-400 font-normal">Unexplained rash (macular, papular, vesicular, pustular)?</span>
        </p>
        <div className="flex gap-3 mb-3">
          {['yes', 'no'].map(opt => (
            <button key={opt} onClick={() => { setMpoxRash(opt); if (opt === 'no') setMpoxSymptoms({}); }}
              className={`flex-1 py-2.5 rounded-xl border-2 text-sm font-bold transition-all ${
                mpoxRash === opt
                  ? opt === 'yes' ? 'bg-orange-500 border-orange-500 text-white' : 'bg-green-600 border-green-600 text-white'
                  : 'bg-white border-slate-200 text-slate-600'
              }`}>
              {opt === 'yes' ? 'نعم / Yes' : 'لا / No'}
            </button>
          ))}
        </div>
        {mpoxRash === 'yes' && (
          <div className="space-y-1.5">
            <p className="text-xs font-bold text-slate-600">الأعراض المصاحبة / Associated symptoms:</p>
            {MPOX_SYMPTOMS.map(s => (
              <CheckRow key={s.id} {...s} checked={!!mpoxSymptoms[s.id]}
                onChange={(id) => setMpoxSymptoms(prev => ({ ...prev, [id]: !prev[id] }))} />
            ))}
          </div>
        )}
        {mpoxRash && (
          <div className={`mt-3 px-3 py-2 rounded-xl text-xs font-bold ${
            mpoxRisk === 'suspected' ? 'bg-orange-100 border border-orange-400 text-orange-800' :
            mpoxRisk === 'monitor'   ? 'bg-yellow-50 border border-yellow-300 text-yellow-800' :
                                       'bg-green-50 border border-green-200 text-green-800'
          }`}>
            {mpoxRisk === 'suspected' && '🔴 خطر مشتبه به — Suspected Monkeypox · عزل فوري'}
            {mpoxRisk === 'monitor'   && '🟡 راقب — Monitor · ضع كمامة وراقب'}
            {mpoxRisk === 'none'      && '🟢 لا خطر — No Monkeypox risk'}
          </div>
        )}
      </div>
    </div>
  );
}