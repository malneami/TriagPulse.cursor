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

/** Checkbox tile: whole row is the target, selection shown by an ink border and tick. */
function CheckTile({ id, ar, en, checked, onChange, points = null }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      onClick={() => onChange(id)}
      className={`w-full text-start flex items-start gap-3 px-3 py-3 min-h-[52px] rounded-xl border-2 transition-colors ${
        checked ? 'bg-white border-ink' : 'bg-white border-mist hover:border-graphite'
      }`}
    >
      <span
        aria-hidden="true"
        className={`w-6 h-6 rounded-md border-2 shrink-0 flex items-center justify-center text-sm font-bold ${
          checked ? 'bg-ink border-ink text-white' : 'border-graphite/50'
        }`}
      >
        {checked ? '✓' : ''}
      </span>
      <span className="text-sm leading-snug flex-1">
        <span className="font-semibold text-ink block">{ar}</span>
        <span className="text-graphite text-xs">{en}</span>
      </span>
      {points != null && (
        <span dir="ltr" className="shrink-0 self-center text-xs font-semibold text-graphite tabular-nums border border-mist rounded-full px-2 py-0.5">
          {points === 0 ? '0' : `+${points}`}
        </span>
      )}
    </button>
  );
}

function SubHeading({ children, aside }) {
  return (
    <div className="flex items-baseline justify-between gap-2 border-b border-mist pb-1.5">
      <h3 className="text-sm font-semibold text-ink">{children}</h3>
      {aside && <span className="text-xs text-graphite">{aside}</span>}
    </div>
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

  const high = totalScore >= 4;
  const moderate = totalScore >= 2 && totalScore < 4;

  return (
    <section aria-labelledby="vt-section-b" className="flex flex-col gap-5">
      <header>
        <p className="text-xs font-semibold text-graphite tracking-wide">القسم ب · Section B</p>
        <h2 id="vt-section-b" className="text-lg font-semibold text-ink">فحص الأمراض التنفسية الحادة</h2>
        <p className="text-xs text-graphite">Acute respiratory illness screening (MOH)</p>
        {isPediatric && (
          <p className="mt-1 text-xs font-semibold text-ink">نقاط الأطفال مفعّلة · Paediatric scoring</p>
        )}
      </header>

      <div className="flex flex-col gap-2">
        <SubHeading aside={anyExposure ? '3 نقاط' : '3 نقاط إذا تحقق أي منها'}>أ · خطر التعرض / Exposure</SubHeading>
        {EXPOSURES.map(e => (
          <CheckTile key={e.id} {...e} checked={!!exposures[e.id]} onChange={toggleExposure} />
        ))}
      </div>

      <div className="flex flex-col gap-2">
        <SubHeading aside={isPediatric ? 'نقاط الأطفال · Paed' : 'نقاط البالغين · Adult'}>ب · الأعراض / Clinical signs</SubHeading>
        {CLINICAL.map(item => (
          <CheckTile
            key={item.id}
            id={item.id} ar={item.ar} en={item.en}
            checked={!!symptoms[item.id]}
            onChange={toggleSymptom}
            points={isPediatric ? item.score_ped : item.score_adult}
          />
        ))}
        <CheckTile
          id="none"
          ar="لا توجد أعراض تنفسية"
          en="No respiratory symptoms"
          checked={noSymptoms}
          onChange={handleNoSymptoms}
        />
      </div>

      {/* Total score */}
      <div
        className={`rounded-2xl px-4 py-3 flex flex-col gap-2 ${
          high ? 'bg-[#D3242C] text-white' : moderate ? 'bg-white border-2 border-dashed border-ink' : 'bg-white border border-mist'
        }`}
        aria-live="polite"
      >
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold">الدرجة الإجمالية · Total score</p>
            <p className={`text-xs ${high ? 'text-white/85' : 'text-graphite'}`}>
              تعرض {exposureScore} + أعراض {clinicalScore}
            </p>
          </div>
          <span className="text-4xl font-bold tabular-nums">{totalScore}</span>
        </div>
        {high && (
          <div className="text-sm flex flex-col gap-1 border-t border-white/30 pt-2">
            <p className="font-semibold">الدرجة ≥ 4: إجراءات إلزامية · Required actions</p>
            <p>١. غسل اليدين · Hand hygiene</p>
            <p>٢. كمامة جراحية · Surgical mask</p>
            <p>٣. المسار التنفسي · Respiratory pathway</p>
            <p>٤. أبلغ الطبيب · Inform the physician</p>
            <p className="text-xs text-white/85 pt-1">اختبار MERS-CoV / COVID-19 وفق تعريفات الحالات فقط · Test per case definitions only</p>
          </div>
        )}
        {moderate && <p className="text-sm font-semibold">مخاطر معتدلة: ضع كمامة وراقب · Moderate risk: mask and monitor</p>}
        {totalScore < 2 && <p className="text-sm text-graphite">مخاطر منخفضة · Low risk</p>}
      </div>

      {/* Monkeypox */}
      <div className="flex flex-col gap-2">
        <SubHeading>ج · جدري القرود / Mpox</SubHeading>
        <p className="text-sm text-ink">
          هل يوجد طفح جلدي غير مفسر؟ <span className="text-graphite text-xs">Unexplained rash (macular, papular, vesicular, pustular)?</span>
        </p>
        <div role="radiogroup" aria-label="طفح جلدي / Rash" className="flex gap-2">
          {['yes', 'no'].map(opt => {
            const selected = mpoxRash === opt;
            return (
              <button
                key={opt}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => { setMpoxRash(opt); if (opt === 'no') setMpoxSymptoms({}); }}
                className={`flex-1 min-h-[52px] rounded-xl border-2 text-[15px] font-semibold transition-colors ${
                  selected ? 'bg-ink border-ink text-white' : 'bg-white border-mist text-ink hover:border-graphite'
                }`}
              >
                {opt === 'yes' ? 'نعم / Yes' : 'لا / No'}
              </button>
            );
          })}
        </div>
        {mpoxRash === 'yes' && (
          <div className="flex flex-col gap-2">
            <p className="text-xs font-semibold text-graphite">الأعراض المصاحبة / Associated symptoms</p>
            {MPOX_SYMPTOMS.map(s => (
              <CheckTile key={s.id} {...s} checked={!!mpoxSymptoms[s.id]}
                onChange={(id) => setMpoxSymptoms(prev => ({ ...prev, [id]: !prev[id] }))} />
            ))}
          </div>
        )}
        {mpoxRash && (
          <p
            className={`px-3 py-2 rounded-xl text-sm font-semibold ${
              mpoxRisk === 'suspected' ? 'bg-[#D3242C] text-white' :
              mpoxRisk === 'monitor'   ? 'bg-white border-2 border-dashed border-ink text-ink' :
                                         'bg-white border border-mist text-graphite'
            }`}
          >
            {mpoxRisk === 'suspected' && 'اشتباه جدري القرود: عزل فوري · Suspected mpox: isolate'}
            {mpoxRisk === 'monitor'   && 'راقب: ضع كمامة وراقب · Monitor: mask and observe'}
            {mpoxRisk === 'none'      && 'لا خطر · No mpox risk'}
          </p>
        )}
      </div>
    </section>
  );
}
