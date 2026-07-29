// @ts-nocheck
import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '@/api/client';
import { assignDestination } from '@/lib/destinationEngine';
import { Plus, Users } from 'lucide-react';
import SectionA from '@/components/visualTriage/SectionA';
import SectionB from '@/components/visualTriage/SectionB';
import DestinationScreen from '@/components/journey/DestinationScreen';
import JourneyProgress from '@/components/journey/JourneyProgress';
import { toast } from 'sonner';

const defaultSectionA = { breathing: null, consciousness: null, bleeding: null, skin: null, mobility: null };

const SECTION_A_LABELS = {
  breathing:    { red: 'تنفس غير طبيعي / Labored breathing' },
  consciousness:{ red: 'اضطراب الوعي / Impaired consciousness' },
  bleeding:     { red: 'يوجد نزيف / Bleeding present' },
  skin:         { red: 'لون جلد غير طبيعي / Abnormal skin color' },
  mobility:     { red: 'لا يستطيع المشي / Cannot walk' },
};

export default function VisualTriage() {
  const navigate = useNavigate();
  const startRef = useRef(Date.now());

  const [patientNameAr, setPatientNameAr] = useState('');
  const [patientNameEn, setPatientNameEn] = useState('');
  const [patientIdNumber, setPatientIdNumber] = useState('');
  const [patientAge, setPatientAge] = useState('');
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
        patientNameAr: patientNameAr || undefined,
        patientNameEn: patientNameEn || undefined,
        age: parseFloat(patientAge) || undefined,
      });

      const { journey, destination: serverDest } = await api.journeys.visualTriage(created.id, {
        sectionA,
        respiratorySymptoms: symptoms,
        monkeypoxRisk: mpoxRisk,
        patientNameAr: patientNameAr || undefined,
        patientNameEn: patientNameEn || undefined,
        age: parseFloat(patientAge) || undefined,
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

  return (
    <div dir="rtl" className="space-y-4 pb-8">
      <JourneyProgress currentStep={1} />

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm px-4 py-3">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-base font-black text-slate-800">الفرز البصري — Visual Triage</h1>
            <p className="text-xs text-slate-400">الخطوة ١ من ٣ — أكمل قبل نموذج CTAS</p>
          </div>
          <button
            onClick={resetAll}
            className="flex items-center gap-1.5 px-3 py-2 bg-red-600 text-white rounded-xl text-xs font-black hover:bg-red-700"
          >
            <Plus className="w-3.5 h-3.5" /> مريض جديد
          </button>
        </div>
      </div>

      {/* Patient identity strip */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm px-4 py-4 space-y-3">
        <p className="text-xs font-black text-slate-600 border-b border-slate-100 pb-2">بيانات أولية للتتبع — Pre-Registration Identity</p>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div>
            <label className="text-xs font-bold text-slate-600">اسم المريض (عربي) / Name (Arabic)</label>
            <input
              className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-300"
              value={patientNameAr} onChange={e => setPatientNameAr(e.target.value)}
              placeholder="الاسم الكامل" dir="rtl"
            />
          </div>
          <div>
            <label className="text-xs font-bold text-slate-600">Name (English) / الاسم بالإنجليزية</label>
            <input
              className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-300"
              value={patientNameEn} onChange={e => setPatientNameEn(e.target.value)}
              placeholder="Full name"
            />
          </div>
          <div>
            <label className="text-xs font-bold text-slate-600">رقم الهوية / ID Number</label>
            <input
              className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-300"
              value={patientIdNumber} onChange={e => setPatientIdNumber(e.target.value)}
              placeholder="ID / رقم الهوية"
            />
          </div>
          <div>
            <label className="text-xs font-bold text-slate-600">العمر / Age</label>
            <input
              type="number" min="0" max="120"
              className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-300"
              value={patientAge} onChange={e => setPatientAge(e.target.value)}
              placeholder="السنوات / Years"
            />
            {patientAge && parseFloat(patientAge) < 14 && (
              <p className="text-xs text-blue-600 font-bold mt-1">👶 طفل — بروتوكول الأطفال نشط / Pediatric pathway active</p>
            )}
          </div>
        </div>
      </div>

      {hasCritical && (
        <div className="bg-red-600 text-white rounded-2xl px-4 py-3 text-center animate-pulse">
          <p className="font-black text-sm">🚨 علامات حرجة مكتشفة — CRITICAL SIGNS DETECTED</p>
          <p className="text-xs opacity-80">أكمل جميع الحقول وأكد لتوجيه المريض فوراً</p>
        </div>
      )}

      <div className="flex flex-col md:flex-row gap-4">
        <div className="md:w-1/2 bg-white rounded-2xl border border-slate-200 shadow-sm px-4 py-4">
          <SectionA values={sectionA} onChange={(key, val) => setSectionA(prev => ({ ...prev, [key]: val }))} />
        </div>
        <div className="md:w-1/2 bg-white rounded-2xl border border-slate-200 shadow-sm px-4 py-4">
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

      {/* Waiting counter */}
      {waitingCount > 0 && (
        <button
          onClick={() => navigate('/tracking')}
          className="w-full flex items-center justify-between px-4 py-2.5 bg-amber-50 border border-amber-200 rounded-xl hover:bg-amber-100 transition-colors"
        >
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-amber-600" />
            <span className="text-sm font-bold text-amber-800">
              المرضى المنتظرون / Waiting: {waitingCount}
            </span>
          </div>
          <span className="text-xs text-amber-600 font-bold">عرض ▶</span>
        </button>
      )}

      <button
        onClick={handleConfirm}
        disabled={!sectionAComplete || saving}
        className={`w-full py-4 rounded-2xl font-black text-base shadow-lg transition-all ${
          sectionAComplete && !saving
            ? hasCritical
              ? 'bg-red-600 hover:bg-red-700 text-white animate-pulse'
              : 'bg-red-600 hover:bg-red-700 text-white'
            : 'bg-slate-200 text-slate-400 cursor-not-allowed'
        }`}
      >
        {saving ? '⏳ جاري...' :
          sectionAComplete
            ? hasCritical
              ? '🚨 تأكيد — توجيه فوري للإنعاش / Confirm — Send to Resus'
              : `✅ تأكيد الفرز البصري — Confirm Visual Triage`
            : `أكمل القسم أ (${Object.values(sectionA).filter(v => v !== null).length}/5 مكتمل)`
        }
      </button>
    </div>
  );
}