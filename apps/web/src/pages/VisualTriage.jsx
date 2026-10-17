// @ts-nocheck
import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '@/api/client';
import { assignDestination } from '@triagepulse/clinical';
import { Plus, Users } from 'lucide-react';
import SectionA from '@/components/visualTriage/SectionA';
import SectionB from '@/components/visualTriage/SectionB';
import DestinationScreen from '@/components/journey/DestinationScreen';
import JourneyProgress from '@/components/journey/JourneyProgress';
import { toast } from 'sonner';
import { ctasFill } from '@/lib/ctasStyle';
import { EncounterField, cleanEncounter, encounterLooksRight } from '@/components/journey/EncounterLink';

const defaultSectionA = { breathing: null, consciousness: null, bleeding: null, skin: null, mobility: null };

const SECTION_A_LABELS = {
  breathing:    { red: 'تنفس غير طبيعي / Labored breathing' },
  consciousness:{ red: 'اضطراب الوعي / Impaired consciousness' },
  bleeding:     { red: 'يوجد نزيف / Bleeding present' },
  skin:         { red: 'لون جلد غير طبيعي / Abnormal skin color' },
  mobility:     { red: 'لا يستطيع المشي / Cannot walk' },
};

/**
 * The API stores age as whole years. Send completed years (floor), keep 0 for
 * newborns (the old `|| undefined` dropped it), and omit blank or invalid input.
 */
function ageInCompletedYears(value) {
  const n = parseFloat(value);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return Math.floor(n);
}

export default function VisualTriage() {
  const navigate = useNavigate();
  const startRef = useRef(Date.now());

  const [patientNameAr, setPatientNameAr] = useState('');
  const [patientNameEn, setPatientNameEn] = useState('');
  const [patientIdNumber, setPatientIdNumber] = useState('');
  const [patientAge, setPatientAge] = useState('');
  const [encounterNo, setEncounterNo] = useState('');
  const [notRegistered, setNotRegistered] = useState(false);
  const [sectionA, setSectionA] = useState(defaultSectionA);
  const [symptoms, setSymptoms] = useState({});
  const [noSymptoms, setNoSymptoms] = useState(false);
  const [exposures, setExposures] = useState({});
  const [mpoxRash, setMpoxRash] = useState(null);
  const [mpoxSymptoms, setMpoxSymptoms] = useState({});

  const [destination, setDestination] = useState(null);
  const [currentPatientId, setCurrentPatientId] = useState(null);
  const [journeyId, setJourneyId] = useState(null);
  const [directedTime, setDirectedTime] = useState('');
  const [saving, setSaving] = useState(false);
  const [waitingCount, setWaitingCount] = useState(0);

  const isPediatric = !!patientAge && parseFloat(patientAge) < 14;

  useEffect(() => {
    api.journeys.listActive().then((all) => {
      const waiting = all.filter((p) =>
        ['registration', 'ctas_pending', 'ctas_in_progress', 'awaiting_ctas'].includes(p.current_status)
      );
      setWaitingCount(waiting.length);
    }).catch(() => setWaitingCount(0));
  }, [destination]);

  // Weighted score: exposure = 3 if any; clinical = sum based on age group
  const CLINICAL_WEIGHTS = { fever: { adult: 2, ped: 1 }, cough: { adult: 2, ped: 1 }, dyspnea: { adult: 2, ped: 1 }, gi: { adult: 1, ped: 0 }, comorbid: { adult: 1, ped: 0 } };
  const anyExposure = Object.values(exposures).some(Boolean);
  const exposureScore = noSymptoms ? 0 : anyExposure ? 3 : 0;
  const clinicalScore = noSymptoms ? 0 : Object.entries(symptoms).reduce((sum, [id, checked]) => {
    if (!checked || !CLINICAL_WEIGHTS[id]) return sum;
    return sum + (isPediatric ? CLINICAL_WEIGHTS[id].ped : CLINICAL_WEIGHTS[id].adult);
  }, 0);
  const infectiousScore = exposureScore + clinicalScore;

  const mpoxRisk = mpoxRash === 'yes' && Object.values(mpoxSymptoms).some(Boolean)
    ? 'suspected' : mpoxRash === 'yes' ? 'monitor' : 'none';

  const sectionAComplete = Object.values(sectionA).every(v => v !== null);
  const hasCritical = Object.values(sectionA).some(v => v === 'red');
  // The encounter number is taken at the start. Only "not registered yet" skips it, and a
  // patient with critical signs is never held back for it (it is linked later from the board).
  const encounterOk = encounterLooksRight(encounterNo);
  const encounterReady = encounterOk || notRegistered || hasCritical;

  const detectedSigns = Object.entries(sectionA)
    .filter(([, v]) => v === 'red')
    .map(([k]) => SECTION_A_LABELS[k]?.red || k);

  const buildSymptomLabels = () => {
    const SM = { fever: 'حمى', cough: 'سعال', dyspnea: 'ضيق تنفس', gi: 'غثيان/إسهال', headache: 'صداع', comorbid: 'أمراض مزمنة' };
    const EM = { contact: 'تواصل مع حالة مؤكدة', camel: 'تعرض للإبل', travel: 'سفر خارجي', hcw: 'عمل صحي' };
    return [
      ...Object.entries(symptoms).filter(([, v]) => v).map(([k]) => SM[k] || k),
      ...Object.entries(exposures).filter(([, v]) => v).map(([k]) => EM[k] || k),
    ].join(', ');
  };

  const handleConfirm = async () => {
    setSaving(true);
    try {
      const elapsedSec = Math.round((Date.now() - startRef.current) / 1000);
      const dest = assignDestination({ sectionA, respiratoryScore: infectiousScore, monkeypoxRisk: mpoxRisk, patientAge });
      const directed = new Date().toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

      const created = await api.journeys.create({
        encounterNo: encounterOk ? cleanEncounter(encounterNo) : undefined,
        patientNameAr: patientNameAr || undefined,
        patientNameEn: patientNameEn || undefined,
        age: ageInCompletedYears(patientAge),
      });

      const { journey, destination: serverDest } = await api.journeys.visualTriage(created.id, {
        sectionA,
        respiratorySymptoms: symptoms,
        monkeypoxRisk: mpoxRisk,
        patientNameAr: patientNameAr || undefined,
        patientNameEn: patientNameEn || undefined,
        age: ageInCompletedYears(patientAge),
        vtDurationSec: elapsedSec,
        maskGiven: dest.infectious_protocol || infectiousScore >= 2,
        handHygieneDone: infectiousScore >= 2,
      });

      setJourneyId(journey.id);
      setCurrentPatientId(journey.patient_id);
      setDestination(serverDest || dest);
      setDirectedTime(directed);
    } catch (err) {
      console.error(err);
      toast.error('فشل حفظ الفرز البصري — ' + (err?.message || 'Visual triage save failed'));
    } finally {
      setSaving(false);
    }
  };

  const handleAlertTeam = async () => {
    toast.success('تم إبلاغ الفريق الطبي / Team alerted');
  };

  const handleDone = () => {
    if (!destination) return;
    if (destination.bypass_registration) {
      navigate(`/triage?pid=${encodeURIComponent(currentPatientId)}`);
    } else {
      // Go to tracking board — the board's Register button takes them to Registration
      navigate('/tracking');
    }
  };

  const handleLogAndNew = async () => {
    toast.success('جاهز للمريض التالي / Ready for next patient');
    resetAll();
  };

  const resetAll = () => {
    setPatientNameAr('');
    setPatientNameEn('');
    setPatientIdNumber('');
    setPatientAge('');
    setEncounterNo('');
    setNotRegistered(false);
    setSectionA(defaultSectionA);
    setSymptoms({});
    setNoSymptoms(false);
    setExposures({});
    setMpoxRash(null);
    setMpoxSymptoms({});
    setDestination(null);
    setCurrentPatientId(null);
    setJourneyId(null);
    startRef.current = Date.now();
  };

  const elapsedSec = Math.round((Date.now() - startRef.current) / 1000);
  const arrivalTime = new Date(startRef.current).toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' });

  if (destination) {
    return (
      <DestinationScreen
        destination={destination}
        patientId={currentPatientId}
        arrivalTime={arrivalTime}
        directedTime={directedTime}
        detectedSigns={detectedSigns}
        respiratoryScore={infectiousScore}
        onAlertTeam={handleAlertTeam}
        onDone={handleDone}
        onLogAndNew={handleLogAndNew}
        elapsedSec={elapsedSec}
      />
    );
  }

  const answered = Object.values(sectionA).filter((v) => v !== null).length;
  const preview = sectionAComplete
    ? assignDestination({ sectionA, respiratoryScore: infectiousScore, monkeypoxRisk: mpoxRisk, patientAge })
    : null;
  const inputCls =
    'mt-1 w-full h-12 bg-white border border-mist rounded-xl px-3 text-[15px] text-ink placeholder:text-graphite/60 focus:outline-none focus:border-ink';

  return (
    <div dir="rtl" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-ink">الفرز البصري</h1>
          <p className="text-sm text-graphite">Visual triage · الخطوة ١ من ٣</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="hidden sm:block"><JourneyProgress currentStep={1} /></div>
          <button
            type="button"
            onClick={resetAll}
            className="flex items-center gap-2 h-11 px-4 bg-white border border-mist text-ink rounded-xl text-sm font-semibold hover:border-ink"
          >
            <Plus className="w-4 h-4" aria-hidden="true" /> مريض جديد
          </button>
        </div>
      </div>

      {waitingCount > 0 && (
        <button
          type="button"
          onClick={() => navigate('/tracking')}
          className="w-full flex items-center justify-between px-4 h-12 bg-white border border-mist rounded-xl hover:border-ink"
        >
          <span className="flex items-center gap-2 text-sm font-semibold text-ink">
            <Users className="w-4 h-4" aria-hidden="true" />
            بانتظار CTAS: <span className="tabular-nums">{waitingCount}</span>
          </span>
          <span className="text-sm text-graphite">لوحة التتبع ←</span>
        </button>
      )}

      {/* Patient identity */}
      <section aria-labelledby="vt-identity" className="bg-white rounded-2xl border border-mist px-5 py-4">
        <h2 id="vt-identity" className="text-sm font-semibold text-ink">بيانات أولية للتتبع · Pre-registration identity</h2>
        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="text-sm text-graphite">
            <label htmlFor="vt-encounter" className="font-semibold text-ink">
              رقم العملية · Transaction No. {!notRegistered && <span aria-hidden="true">*</span>}
            </label>
            <EncounterField
              value={encounterNo}
              onChange={setEncounterNo}
              disabled={notRegistered}
              inputClassName={inputCls}
            />
          </div>
          <label className="flex items-start gap-2 text-sm text-ink md:pt-7">
            <input
              type="checkbox"
              checked={notRegistered}
              onChange={(e) => { setNotRegistered(e.target.checked); if (e.target.checked) setEncounterNo(''); }}
              className="mt-1 w-4 h-4"
            />
            <span>
              لم يُسجَّل بعد — يُربط لاحقاً من لوحة التتبع
              <span className="block text-graphite">Not registered yet — link it later from the tracking board</span>
            </span>
          </label>
        </div>
        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-4">
          <label className="text-sm text-graphite md:col-span-1">
            الاسم (عربي)
            <input className={inputCls} value={patientNameAr} onChange={e => setPatientNameAr(e.target.value)} placeholder="الاسم الكامل" dir="rtl" />
          </label>
          <label className="text-sm text-graphite md:col-span-1">
            Name (English)
            <input className={inputCls} value={patientNameEn} onChange={e => setPatientNameEn(e.target.value)} placeholder="Full name" dir="ltr" />
          </label>
          <label className="text-sm text-graphite">
            رقم الهوية · ID
            <input className={inputCls} value={patientIdNumber} onChange={e => setPatientIdNumber(e.target.value)} dir="ltr" inputMode="numeric" />
          </label>
          <label className="text-sm text-graphite">
            العمر بالسنوات · Age
            <input type="number" min="0" max="120" className={inputCls} value={patientAge} onChange={e => setPatientAge(e.target.value)} dir="ltr" />
          </label>
        </div>
        {isPediatric && (
          <p className="mt-2 text-sm font-semibold text-ink">طفل: مسار الأطفال مفعّل · Paediatric pathway active</p>
        )}
      </section>

      {hasCritical && (
        <p role="alert" className="bg-[#D3242C] text-white rounded-2xl px-5 py-3 text-[15px] font-semibold">
          علامات حرجة: أكمل القسم أ ووجّه المريض فوراً · Critical signs, complete Section A and direct now
        </p>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
        <div className="bg-white rounded-2xl border border-mist px-5 py-5">
          <SectionA values={sectionA} onChange={(key, val) => setSectionA(prev => ({ ...prev, [key]: val }))} />
        </div>
        <div className="bg-white rounded-2xl border border-mist px-5 py-5">
          <SectionB
            symptoms={symptoms} setSymptoms={setSymptoms}
            noSymptoms={noSymptoms} setNoSymptoms={setNoSymptoms}
            exposures={exposures} setExposures={setExposures}
            mpoxRash={mpoxRash} setMpoxRash={setMpoxRash}
            mpoxSymptoms={mpoxSymptoms} setMpoxSymptoms={setMpoxSymptoms}
            isPediatric={isPediatric}
          />
        </div>
      </div>

      {/* Sticky footer: suggested destination and the one primary action */}
      <div className="sticky bottom-3 z-10 bg-white border border-mist rounded-2xl shadow-lg px-4 py-3 flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[200px]" aria-live="polite">
          {preview ? (
            <>
              <p className="text-xs text-graphite">الوجهة المقترحة · Suggested destination</p>
              <p className="text-base font-semibold text-ink flex items-center gap-2">
                {preview.estimated_ctas && (
                  <span aria-hidden="true" className="w-3 h-3 rounded-full shrink-0" style={ctasFill(preview.estimated_ctas)} />
                )}
                {preview.destination_ar} <span className="font-normal text-graphite">· {preview.destination_en}</span>
              </p>
            </>
          ) : (
            <p className="text-sm text-graphite">أكمل القسم أ لعرض الوجهة · Complete Section A ({answered}/5)</p>
          )}
          {sectionAComplete && !encounterReady && (
            <p className="text-sm font-semibold text-ink mt-1">
              أدخل رقم العملية أو اختر «لم يُسجَّل بعد» · Enter the Transaction No., or tick “Not registered yet”
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={handleConfirm}
          disabled={!sectionAComplete || !encounterReady || saving}
          className={`min-h-[56px] px-6 rounded-xl text-base font-semibold transition-colors ${
            sectionAComplete && encounterReady && !saving
              ? hasCritical
                ? 'bg-[#D3242C] text-white hover:bg-[#B81E25]'
                : 'bg-ink text-white hover:bg-ink-deep'
              : 'bg-mist text-graphite cursor-not-allowed'
          }`}
        >
          {saving
            ? 'جاري الحفظ…'
            : hasCritical
              ? 'تأكيد وتوجيه للإنعاش · Confirm'
              : 'تأكيد الفرز البصري · Confirm'}
        </button>
      </div>
    </div>
  );
}
