import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import { useQuery } from '@tanstack/react-query';
import JourneyProgress from '@/components/journey/JourneyProgress';
import ReceiptScanner from '@/components/triage/ReceiptScanner';
import { toast } from 'sonner';
import { ArrowRight } from 'lucide-react';
import { validateRegistration } from '@/lib/triageValidation';

export default function Registration() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const urlParams = new URLSearchParams(window.location.search);
  const pid = urlParams.get('pid');

  const { data: journeyList, isLoading } = useQuery({
    queryKey: ['journey-reg', pid],
    queryFn: () => pid ? base44.entities.PatientJourney.filter({ patient_id: pid }) : Promise.resolve([]),
    enabled: !!pid,
  });
  const journey = journeyList?.[0];

  const [form, setForm] = useState({
    patient_name_ar: '', patient_name_en: '', id_number: '',
    mrn: '', dob: '', age: '', gender: '', nationality: '',
    phone: '', insurance: '', mode_of_arrival: '', receipt_image_url: '',
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!journey) return;
    setForm(prev => ({
      ...prev,
      patient_name_ar: journey.patient_name_ar || '',
      patient_name_en: journey.patient_name_en || '',
      mrn: journey.mrn || '',
      age: journey.age ? String(journey.age) : '',
      gender: journey.gender || '',
      nationality: journey.nationality || '',
      phone: journey.phone || '',
      insurance: journey.insurance || '',
    }));
  }, [journey?.id]);

  const up = (k, v) => setForm(prev => ({ ...prev, [k]: v }));
  const canProceed = !!(form.patient_name_ar && form.age && form.gender);

  const handleSubmit = async () => {
    if (!journey) { toast.error('لم يتم العثور على سجل الفرز البصري'); return; }
    const validation = validateRegistration(form);
    if (!validation.ok) {
      toast.error(validation.errors.join(' / '));
      return;
    }
    setSaving(true);
    const now = new Date().toISOString();
    const regDurationSec = journey.arrival_time
      ? Math.round((Date.now() - new Date(journey.arrival_time).getTime()) / 1000)
      : null;

    try {
      await base44.entities.PatientJourney.update(journey.id, {
        ...form,
        age: parseFloat(form.age) || null,
        reg_completed: true,
        reg_completed_at: now,
        reg_by: user?.full_name || user?.email,
        reg_duration_sec: regDurationSec,
        current_status: 'ctas_pending',
      });

      toast.success('تم التسجيل / Registration complete');
      navigate(`/triage?pid=${encodeURIComponent(pid)}`);
    } catch (err) {
      toast.error('فشل حفظ التسجيل — ' + (err?.message || 'Registration save failed'));
    } finally {
      setSaving(false);
    }
  };

  if (isLoading) return (
    <div className="flex justify-center py-16">
      <div className="w-8 h-8 border-4 border-slate-200 border-t-red-600 rounded-full animate-spin" />
    </div>
  );

  return (
    <div dir="rtl" className="space-y-4 pb-8">
      <JourneyProgress currentStep={2} />

      {/* Back to board */}
      <button
        onClick={() => navigate('/tracking')}
        className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-red-600 font-bold"
      >
        <ArrowRight className="w-3.5 h-3.5" /> العودة للوحة / Back to Board
      </button>

      {/* Header */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm px-4 py-3">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-base font-black text-slate-800">التسجيل — Registration</h1>
            {pid && <p className="text-xs font-black text-red-600">{pid}</p>}
            <p className="text-xs text-slate-400">الخطوة ٢ من ٣ — Step 2 of 3</p>
          </div>
          {journey?.vt_completed && (
            <div className="text-right">
              <span className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded-full font-bold">✅ فرز بصري مكتمل</span>
              {journey.vt_destination_ar && <p className="text-xs text-slate-400 mt-0.5">{journey.vt_destination_ar}</p>}
            </div>
          )}
        </div>
      </div>

      {/* Receipt Scanner */}
      <ReceiptScanner
        onExtracted={(data, imageUrl) => {
          setForm(prev => ({
            ...prev,
            ...(data.patient_name_ar ? { patient_name_ar: data.patient_name_ar } : {}),
            ...(data.patient_name_en ? { patient_name_en: data.patient_name_en } : {}),
            ...(data.mrn ? { mrn: data.mrn } : {}),
            ...(data.age != null ? { age: String(data.age) } : {}),
            ...(data.gender ? { gender: data.gender } : {}),
            ...(data.nationality ? { nationality: data.nationality } : {}),
            ...(data.phone ? { phone: data.phone } : {}),
            ...(data.insurance ? { insurance: data.insurance } : {}),
            ...(data.date_of_birth ? { dob: data.date_of_birth } : {}),
            ...(imageUrl ? { receipt_image_url: imageUrl } : {}),
          }));
        }}
        receiptUrl={form.receipt_image_url}
      />

      {/* Form */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm px-4 py-4 space-y-3">
        <p className="text-xs font-black text-slate-600 border-b border-slate-100 pb-2">بيانات المريض — Patient Demographics</p>

        {[
          { key: 'patient_name_ar', ar: 'الاسم الكامل', en: 'Full name', required: true },
          { key: 'patient_name_en', ar: 'الاسم بالإنجليزية', en: 'Name in English' },
          { key: 'id_number', ar: 'رقم الهوية', en: 'ID number' },
          { key: 'mrn', ar: 'رقم الملف', en: 'MRN' },
          { key: 'dob', ar: 'تاريخ الميلاد', en: 'Date of birth', placeholder: 'YYYY-MM-DD' },
          { key: 'nationality', ar: 'الجنسية', en: 'Nationality' },
          { key: 'phone', ar: 'الهاتف', en: 'Phone' },
        ].map(f => (
          <div key={f.key}>
            <label className="text-xs font-bold text-slate-600">{f.ar} / {f.en}{f.required ? ' *' : ''}</label>
            <input
              className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-300"
              value={form[f.key]} onChange={e => up(f.key, e.target.value)}
              placeholder={f.placeholder || ''} dir="rtl"
            />
          </div>
        ))}

        {/* Age */}
        <div>
          <label className="text-xs font-bold text-slate-600">العمر * / Age *</label>
          <input
            type="number" min="0" max="120"
            className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-300"
            value={form.age} onChange={e => up('age', e.target.value)}
          />
        </div>

        {/* Gender */}
        <div>
          <label className="text-xs font-bold text-slate-600 block mb-1">الجنس * / Gender *</label>
          <div className="flex gap-2">
            {[['male', 'ذكر / Male'], ['female', 'أنثى / Female']].map(([val, label]) => (
              <button key={val} onClick={() => up('gender', val)}
                className={`flex-1 py-2 rounded-xl border-2 text-xs font-bold transition-all ${
                  form.gender === val ? 'bg-red-600 border-red-600 text-white' : 'bg-white border-slate-200 text-slate-600'
                }`}>
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Insurance */}
        <div>
          <label className="text-xs font-bold text-slate-600 block mb-1">التأمين / Insurance</label>
          <div className="grid grid-cols-2 gap-2">
            {[['moh', 'وزارة الصحة'], ['private', 'تأمين خاص'], ['self', 'دفع ذاتي'], ['other', 'أخرى']].map(([val, label]) => (
              <button key={val} onClick={() => up('insurance', val)}
                className={`py-1.5 rounded-xl border text-xs font-medium transition-all ${
                  form.insurance === val ? 'bg-red-50 border-red-400 text-red-700' : 'bg-white border-slate-200 text-slate-600'
                }`}>
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Mode of arrival */}
        <div>
          <label className="text-xs font-bold text-slate-600 block mb-1">وسيلة الوصول / Mode of arrival</label>
          <div className="grid grid-cols-2 gap-2">
            {[['walk_in', 'بمفرده / Walk-in'], ['ambulance', 'إسعاف / Ambulance'], ['police', 'شرطة / Police'], ['other', 'أخرى / Other']].map(([val, label]) => (
              <button key={val} onClick={() => up('mode_of_arrival', val)}
                className={`py-1.5 rounded-xl border text-xs font-medium transition-all ${
                  form.mode_of_arrival === val ? 'bg-red-50 border-red-400 text-red-700' : 'bg-white border-slate-200 text-slate-600'
                }`}>
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Timestamps */}
      <div className="bg-white rounded-2xl border border-slate-200 px-4 py-3 text-xs text-slate-500 space-y-1">
        <div className="flex justify-between">
          <span>وقت الوصول / Arrival</span>
          <span className="font-bold">{journey?.arrival_time ? new Date(journey.arrival_time).toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' }) : '—'}</span>
        </div>
        <div className="flex justify-between">
          <span>المسجّل / Registered by</span>
          <span className="font-bold">{user?.full_name || user?.email || '—'}</span>
        </div>
      </div>

      <button
        onClick={handleSubmit}
        disabled={!canProceed || saving}
        className={`w-full py-4 rounded-2xl font-black text-base shadow-lg transition-all ${
          canProceed && !saving ? 'bg-red-600 hover:bg-red-700 text-white' : 'bg-slate-200 text-slate-400 cursor-not-allowed'
        }`}
      >
        {saving ? '⏳ جاري الحفظ...' : '▶ انتقل للفرز الكامل — Proceed to Full CTAS'}
      </button>
    </div>
  );
}