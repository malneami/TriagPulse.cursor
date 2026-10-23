import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Download, Search } from 'lucide-react';
import { api } from '@/api/client';
import { ticketCode } from '@/lib/ticket';
import { ctasFill } from '@/lib/ctasStyle';
import { useAuth } from '@/lib/AuthContext';
import { canAccess } from '@/lib/security/roles';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';

const FILTERS = [
  { id: 'awaiting', ar: 'بانتظار المراجعة', en: 'Awaiting review' },
  { id: 'reviewed', ar: 'رُاجع', en: 'Reviewed' },
  { id: 'closed', ar: 'أُغلق', en: 'Closed' },
  { id: 'all', ar: 'الكل', en: 'All' },
];

const AGE_PRESETS = [
  { id: 'all', ar: 'كل الأعمار', en: 'All ages', min: '', max: '' },
  { id: 'child', ar: 'أطفال <١٤', en: 'Children <14', min: '0', max: '13' },
  { id: 'adult', ar: 'بالغون ١٤–٦٤', en: 'Adults 14–64', min: '14', max: '64' },
  { id: 'older', ar: '٦٥+', en: '65+', min: '65', max: '' },
];

const SKIP_REASON = {
  not_found: 'not found',
  not_eligible: 'not validated / no visit number',
  triaged_by_this_physician: 'this physician did the triage',
};

const DISPOSITIONS = [
  { id: 'discharged_ed', ar: 'خرج من الطوارئ', en: 'Discharged from ED' },
  { id: 'admitted', ar: 'أُدخل', en: 'Admitted' },
  { id: 'transferred', ar: 'حُوّل', en: 'Transferred' },
  { id: 'left_before_completion', ar: 'غادر قبل اكتمال الخدمة', en: 'Left before completion' },
  { id: 'other', ar: 'أخرى', en: 'Other' },
];

const ADMIT_LOCS = [
  { id: 'ward', ar: 'جناح', en: 'Ward' },
  { id: 'icu', ar: 'عناية مركزة', en: 'ICU' },
  { id: 'picu', ar: 'عناية أطفال', en: 'PICU' },
  { id: 'nicu', ar: 'عناية حديثي الولادة', en: 'NICU' },
  { id: 'or', ar: 'عمليات', en: 'OR' },
  { id: 'other', ar: 'أخرى', en: 'Other' },
];

const DISCHARGE = [
  { id: 'home', ar: 'إلى المنزل', en: 'Home' },
  { id: 'clinic_followup', ar: 'متابعة عيادة', en: 'Clinic follow-up' },
];

const DIRECTION = [
  { id: 'yes', ar: 'نعم', en: 'Yes' },
  { id: 'no', ar: 'لا', en: 'No' },
  { id: 'uncertain', ar: 'غير متأكد', en: 'Uncertain' },
];

// Reference measures for the accuracy study (same codes as the server).
const INTERVENTIONS = [
  { id: 'intubation', ar: 'تنبيب', en: 'Intubation' },
  { id: 'noninvasive_ventilation', ar: 'تهوية غير جراحية / قناع وكيس', en: 'NIV / bag-mask' },
  { id: 'cpr', ar: 'إنعاش قلبي رئوي', en: 'CPR' },
  { id: 'defibrillation_cardioversion_pacing', ar: 'صدمة / تنظيم / منظم', en: 'Defibrillation / cardioversion / pacing' },
  { id: 'vasopressors_inotropes', ar: 'رافعات ضغط', en: 'Vasopressors / inotropes' },
  { id: 'blood_transfusion', ar: 'نقل دم', en: 'Blood transfusion' },
  { id: 'emergency_surgery_procedure', ar: 'جراحة / إجراء طارئ', en: 'Emergency surgery / procedure' },
  { id: 'thrombolysis_pci', ar: 'مذيب جلطة / قسطرة', en: 'Thrombolysis / PCI' },
  { id: 'other_lifesaving', ar: 'إجراء منقذ آخر', en: 'Other life-saving' },
];

const RESOURCES = [
  { id: 'labs', ar: 'تحاليل', en: 'Labs' },
  { id: 'ecg_xray', ar: 'تخطيط قلب / أشعة عادية', en: 'ECG / X-ray' },
  { id: 'advanced_imaging', ar: 'أشعة مقطعية / رنين / موجات', en: 'CT / MRI / ultrasound' },
  { id: 'iv_fluids', ar: 'سوائل وريدية', en: 'IV fluids' },
  { id: 'iv_im_neb_meds', ar: 'أدوية وريد / عضل / بخار', en: 'IV / IM / nebulised meds' },
  { id: 'specialty_consult', ar: 'استشارة تخصص', en: 'Specialty consult' },
  { id: 'simple_procedure', ar: 'إجراء بسيط', en: 'Simple procedure' },
  { id: 'complex_procedure', ar: 'إجراء معقد (=٢)', en: 'Complex procedure (=2)' },
];

const YES_NO_UNKNOWN = [
  { id: 'yes', ar: 'نعم', en: 'Yes' },
  { id: 'no', ar: 'لا', en: 'No' },
  { id: 'unknown', ar: 'غير معروف', en: 'Unknown' },
];

const DEATH = [
  { id: 'none', ar: 'لا وفاة', en: 'No death' },
  { id: 'died_in_ed', ar: 'وفاة في الطوارئ', en: 'Died in ED' },
  { id: 'died_in_hospital', ar: 'وفاة في المستشفى', en: 'Died in hospital' },
  { id: 'unknown', ar: 'غير معروف', en: 'Unknown' },
];

const RETURN_72H = [
  { id: 'no', ar: 'لا', en: 'No' },
  { id: 'yes_discharged', ar: 'عاد وخرج', en: 'Returned, discharged' },
  { id: 'yes_admitted', ar: 'عاد وأُدخل', en: 'Returned, admitted' },
  { id: 'unknown', ar: 'غير معروف بعد', en: 'Not known yet' },
];

/** Multi-pick with an exclusive "None". */
function togglePick(list, id) {
  if (id === 'none') return list.includes('none') ? [] : ['none'];
  const rest = list.filter((x) => x !== 'none');
  return rest.includes(id) ? rest.filter((x) => x !== id) : [...rest, id];
}

function Choices({ legend, name, options, value, onChange }) {
  return (
    <fieldset>
      <legend className="text-sm font-medium mb-1">{legend}</legend>
      <div className="flex flex-wrap gap-1">
        {options.map((d) => (
          <button
            key={d.id}
            type="button"
            name={name}
            aria-pressed={value === d.id}
            onClick={() => onChange(d.id)}
            className={`min-h-11 px-3 rounded-xl border text-sm ${value === d.id ? 'bg-ink text-white border-ink' : 'border-mist bg-white'}`}
          >
            {d.ar} · {d.en}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function Picks({ legend, options, value, onChange }) {
  const all = [...options, { id: 'none', ar: 'لا شيء', en: 'None' }];
  return (
    <fieldset>
      <legend className="text-sm font-medium mb-1">{legend}</legend>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
        {all.map((d) => (
          <label key={d.id} className="flex items-center gap-2 min-h-11 px-3 rounded-xl border border-mist">
            <input type="checkbox" checked={value.includes(d.id)} onChange={() => onChange(togglePick(value, d.id))} />
            <span className="text-sm">{d.ar} · {d.en}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function labelOf(list, id) {
  const hit = list.find((x) => x.id === id);
  return hit ? `${hit.ar} · ${hit.en}` : id || '—';
}

function ageSex(row) {
  const age = row.age != null ? `${row.age} س` : null;
  const sex = row.gender === 'male' ? 'ذكر' : row.gender === 'female' ? 'أنثى' : null;
  return [age, sex].filter(Boolean).join(' · ') || '—';
}

function fmtWhen(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-GB', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function fmtDuration(sec) {
  if (sec == null) return '—';
  if (sec < 60) return `${sec} ث`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s ? `${m} د ${s} ث` : `${m} د`;
}

function statusLabel(status) {
  if (status === 'closed') return 'أُغلق · Closed';
  if (status === 'outcome_reviewed') return 'رُاجع · Reviewed';
  return 'بانتظار المراجعة · Awaiting';
}

const emptyForm = {
  disposition: '',
  admissionSpecialty: '',
  admissionLocation: '',
  hospitalUnitName: '',
  dischargeDestination: '',
  finalDiagnosis: '',
  reviewerComment: '',
  directionAppropriate: '',
  directionComment: '',
  finalDiagnosisCode: '',
  interventions: [],
  icuWithin24h: '',
  death: '',
  resources: [],
  return72h: '',
};

function formFromOutcome(o) {
  if (!o) return { ...emptyForm };
  return {
    disposition: o.disposition || '',
    admissionSpecialty: o.admissionSpecialty || '',
    admissionLocation: o.admissionLocation || '',
    hospitalUnitName: o.hospitalUnitName || '',
    dischargeDestination: o.dischargeDestination || '',
    finalDiagnosis: o.finalDiagnosis || '',
    reviewerComment: o.reviewerComment || '',
    directionAppropriate: o.directionAppropriate || '',
    directionComment: o.directionComment || '',
    finalDiagnosisCode: o.finalDiagnosisCode || '',
    interventions: o.interventions || [],
    icuWithin24h: o.icuWithin24h || '',
    death: o.death || '',
    resources: o.resources || [],
    return72h: o.return72h || '',
  };
}

function OutcomeForm({ row, open, onOpenChange, onSaved }) {
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open && row) {
      setForm(formFromOutcome(row.outcome));
      setError('');
    }
  }, [open, row]);

  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  const payload = () => ({
    disposition: form.disposition || undefined,
    admissionSpecialty: form.admissionSpecialty || undefined,
    admissionLocation: form.admissionLocation || undefined,
    hospitalUnitName: form.hospitalUnitName || undefined,
    dischargeDestination: form.dischargeDestination || undefined,
    finalDiagnosis: form.finalDiagnosis || undefined,
    reviewerComment: form.reviewerComment || undefined,
    directionAppropriate: form.directionAppropriate || undefined,
    directionComment: form.directionComment || undefined,
    finalDiagnosisCode: form.finalDiagnosisCode || undefined,
    interventions: form.interventions,
    icuWithin24h: form.icuWithin24h || undefined,
    death: form.death || undefined,
    resources: form.resources,
    return72h: form.return72h || undefined,
  });

  const save = async (close) => {
    setSaving(true);
    setError('');
    try {
      await api.outcomes.save(row.id, { ...payload(), close });
      toast.success(close ? 'حُفظ وأُغلق · Saved and closed' : 'حُفظت المراجعة · Review saved');
      onSaved?.();
      onOpenChange(false);
    } catch (err) {
      setError(err?.message || 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  if (!row) return null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogTitle className="text-lg">مراجعة النتيجة / Outcome review <span dir="ltr" className="text-graphite">{ticketCode(row.ticketNo, row.mrnSuffix)}</span></DialogTitle>
        <DialogDescription className="text-sm text-graphite">
          From the HIS record. These answers are the outcome reference for triage accuracy; nurse and physician CTAS are not changed.
        </DialogDescription>
        <p className="m-0 text-sm text-graphite">
          CTAS ممرض {row.nurseCtas ?? '—'} · طبيب {row.physicianCtas ?? '—'} · {row.direction || '—'}
        </p>

        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium">التصرف النهائي / Final disposition</legend>
          <div className="grid grid-cols-1 gap-1">
            {DISPOSITIONS.map((d) => (
              <label key={d.id} className="flex items-center gap-2 min-h-11 px-3 rounded-xl border border-mist">
                <input type="radio" name="disposition" checked={form.disposition === d.id} onChange={() => set('disposition', d.id)} />
                <span className="text-[15px]">{d.ar} · {d.en}</span>
              </label>
            ))}
          </div>
        </fieldset>

        {form.disposition === 'admitted' && (
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-sm font-medium">تخصص الإدخال / Admission specialty</span>
              <input value={form.admissionSpecialty} onChange={(e) => set('admissionSpecialty', e.target.value)} className="h-12 border border-mist rounded-xl px-3" />
            </label>
            <fieldset>
              <legend className="text-sm font-medium mb-1">مكان الإدخال / Admission location</legend>
              <div className="grid grid-cols-2 gap-1">
                {ADMIT_LOCS.map((d) => (
                  <label key={d.id} className="flex items-center gap-2 min-h-11 px-3 rounded-xl border border-mist">
                    <input type="radio" name="admitLoc" checked={form.admissionLocation === d.id} onChange={() => set('admissionLocation', d.id)} />
                    <span className="text-sm">{d.ar} · {d.en}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <label className="flex flex-col gap-1">
              <span className="text-sm font-medium">اسم الوحدة (إن لزم) / Unit name if needed</span>
              <input value={form.hospitalUnitName} onChange={(e) => set('hospitalUnitName', e.target.value)} className="h-12 border border-mist rounded-xl px-3" />
            </label>
          </div>
        )}

        {form.disposition === 'discharged_ed' && (
          <fieldset>
            <legend className="text-sm font-medium mb-1">إلى أين خرج / Discharge</legend>
            <div className="grid grid-cols-1 gap-1">
              {DISCHARGE.map((d) => (
                <label key={d.id} className="flex items-center gap-2 min-h-11 px-3 rounded-xl border border-mist">
                  <input type="radio" name="discharge" checked={form.dischargeDestination === d.id} onChange={() => set('dischargeDestination', d.id)} />
                  <span className="text-[15px]">{d.ar} · {d.en}</span>
                </label>
              ))}
            </div>
          </fieldset>
        )}

        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium">رمز التشخيص ICD-10 / Final diagnosis ICD-10 code</span>
          <input
            dir="ltr"
            value={form.finalDiagnosisCode}
            onChange={(e) => set('finalDiagnosisCode', e.target.value.toUpperCase())}
            placeholder="R07.4"
            maxLength={10}
            className="h-12 border border-mist rounded-xl px-3 font-mono tracking-wide"
          />
        </label>

        <Picks legend="إجراءات منقذة للحياة / Life-saving interventions" options={INTERVENTIONS} value={form.interventions} onChange={(v) => set('interventions', v)} />
        <Choices legend="عناية مركزة خلال ٢٤ ساعة (ICU/PICU/NICU/CCU) / ICU within 24 h of arrival" name="icu24" options={YES_NO_UNKNOWN} value={form.icuWithin24h} onChange={(v) => set('icuWithin24h', v)} />
        <Choices legend="الوفاة / Death" name="death" options={DEATH} value={form.death} onChange={(v) => set('death', v)} />
        <Picks legend="موارد الطوارئ المستخدمة / ED resources used" options={RESOURCES} value={form.resources} onChange={(v) => set('resources', v)} />
        <Choices legend="عودة للطوارئ خلال ٧٢ ساعة / Return to ED within 72 h" name="ret72" options={RETURN_72H} value={form.return72h} onChange={(v) => set('return72h', v)} />

        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium">وصف التشخيص (اختياري) / Diagnosis description (optional)</span>
          <textarea value={form.finalDiagnosis} onChange={(e) => set('finalDiagnosis', e.target.value)} rows={2} maxLength={500} className="border border-mist rounded-xl px-3 py-2" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium">ملاحظة المراجع / Reviewer comment</span>
          <textarea value={form.reviewerComment} onChange={(e) => set('reviewerComment', e.target.value)} rows={2} maxLength={500} className="border border-mist rounded-xl px-3 py-2" />
        </label>

        <fieldset>
          <legend className="text-sm font-medium mb-1">هل كان توجيه ترياچ بالس مناسباً؟ / Was direction appropriate?</legend>
          <div className="flex flex-wrap gap-1">
            {DIRECTION.map((d) => (
              <button
                key={d.id}
                type="button"
                aria-pressed={form.directionAppropriate === d.id}
                onClick={() => set('directionAppropriate', d.id)}
                className={`h-11 px-3 rounded-xl border text-sm ${form.directionAppropriate === d.id ? 'bg-ink text-white border-ink' : 'border-mist bg-white'}`}
              >
                {d.ar} · {d.en}
              </button>
            ))}
          </div>
        </fieldset>
        {form.directionAppropriate === 'no' && (
          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium">لماذا لم يكن مناسباً / Why not</span>
            <textarea value={form.directionComment} onChange={(e) => set('directionComment', e.target.value)} rows={2} maxLength={500} className="border border-mist rounded-xl px-3 py-2" />
          </label>
        )}

        {error && <p role="alert" className="text-sm font-semibold border-2 border-ink rounded-lg px-3 py-2">{error}</p>}
        {row.canAct ? (
          <div className="flex gap-2">
            <button type="button" disabled={saving} onClick={() => save(false)} className="flex-1 h-12 rounded-xl bg-ink text-white font-medium disabled:opacity-40">
              حفظ المراجعة / Save review
            </button>
            <button type="button" disabled={saving} onClick={() => save(true)} className="flex-1 h-12 rounded-xl border border-mist font-medium disabled:opacity-40">
              حفظ وإغلاق / Save and close
            </button>
          </div>
        ) : (
          <p className="text-sm text-graphite m-0">Only the physician assigned by an admin can save this review (never the triage nurse).</p>
        )}
        <p className="text-xs text-graphite m-0">
          يُغلق بعد ٧٢ ساعة من الوصول بعد تسجيل العودة · Close 72 h after arrival, once the return visit is recorded.
        </p>
      </DialogContent>
    </Dialog>
  );
}

export default function OutcomeReview() {
  const { user } = useAuth();
  const canAssign = canAccess(user, 'assign_outcome_physician');
  const queryClient = useQueryClient();
  const [status, setStatus] = useState('awaiting');
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [active, setActive] = useState(null);
  const [pick, setPick] = useState({});
  const [assigning, setAssigning] = useState('');
  // Admin filters to pick a set of cases: arrival dates, age range, unassigned only.
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [ageMin, setAgeMin] = useState('');
  const [ageMax, setAgeMax] = useState('');
  const [unassignedOnly, setUnassignedOnly] = useState(false);
  const [selected, setSelected] = useState(() => new Set());
  const [bulkPhysician, setBulkPhysician] = useState('');
  const [bulkBusy, setBulkBusy] = useState(false);

  const filters = { status, q, from, to, ageMin, ageMax, assigned: unassignedOnly ? 'unassigned' : '' };
  const { data: rows = [], isFetching, isError, refetch } = useQuery({
    queryKey: ['outcomes', filters],
    queryFn: () => api.outcomes.list(filters),
  });

  // Keep only selections that are still in the filtered list.
  useEffect(() => {
    setSelected((prev) => {
      const ids = new Set(rows.map((r) => r.id));
      const next = new Set([...prev].filter((id) => ids.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [rows]);

  const toggle = (id) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)));
  const agePreset = AGE_PRESETS.find((p) => p.min === ageMin && p.max === ageMax)?.id;

  const assignSelected = async () => {
    if (!bulkPhysician) { toast.error('Select a physician'); return; }
    if (!selected.size) { toast.error('Select cases first'); return; }
    setBulkBusy(true);
    try {
      const res = await api.outcomes.assignBulk([...selected], bulkPhysician);
      const reasons = [...new Set(res.skipped.map((x) => SKIP_REASON[x.reason] || x.reason))].join(', ');
      toast.success(`عُيّن ${res.assigned} · Assigned ${res.assigned}${res.skipped.length ? ` · skipped ${res.skipped.length} (${reasons})` : ''}`);
      setSelected(new Set());
      refresh();
    } catch (err) {
      toast.error(err?.message || 'Could not assign');
    } finally {
      setBulkBusy(false);
    }
  };

  const { data: physicians = [] } = useQuery({
    queryKey: ['outcomes-physicians'],
    queryFn: () => api.outcomes.physicians(),
    enabled: canAssign,
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['outcomes'] });
    queryClient.invalidateQueries({ queryKey: ['outcomes-awaiting-count'] });
  };

  const exportFile = async () => {
    try {
      const blob = await api.outcomes.exportCsv(filters);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `triagepulse-outcomes-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(err?.message || 'Could not export');
    }
  };

  const closeCase = async (row) => {
    try {
      await api.outcomes.close(row.id);
      toast.success('أُغلق · Closed');
      refresh();
    } catch (err) {
      toast.error(err?.message || 'Could not close');
    }
  };

  const assignPhysician = async (row) => {
    const physicianId = pick[row.id] || row.outcomePhysicianId;
    if (!physicianId) {
      toast.error('Select a physician');
      return;
    }
    setAssigning(row.id);
    try {
      await api.outcomes.assignPhysician(row.id, physicianId);
      toast.success('عُيّن الطبيب · Physician assigned');
      refresh();
    } catch (err) {
      toast.error(err?.message || 'Could not assign');
    } finally {
      setAssigning('');
    }
  };

  const counts = useMemo(() => ({ n: rows.length }), [rows]);

  return (
    <div dir="rtl" className="space-y-4 pb-8">
      <div className="flex flex-wrap items-end gap-4">
        <div className="flex flex-col">
          <h1 className="m-0 text-[28px] font-semibold">مراجعة النتيجة النهائية</h1>
          <span className="text-sm text-graphite">Final outcome review from HIS after physician CTAS validation.</span>
        </div>
        <div className="bg-white border border-mist rounded-xl px-4 py-2 flex flex-col ms-auto">
          <span className="text-xs text-graphite">في هذه القائمة</span>
          <span className="text-2xl font-semibold tabular-nums">{counts.n}</span>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            aria-pressed={status === f.id}
            onClick={() => setStatus(f.id)}
            className={`h-11 px-3 rounded-xl border text-sm ${status === f.id ? 'bg-ink text-white border-ink' : 'bg-white border-mist'}`}
          >
            {f.ar} · {f.en}
          </button>
        ))}
        <label className="relative flex-1 min-w-[200px]">
          <span className="sr-only">بحث</span>
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-graphite" aria-hidden="true" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') setQ(search.trim()); }}
            placeholder="تذكرة أو رقم زيارة أو آخر ٣ · Ticket, visit, last 3…"
            className="w-full h-12 border border-mist rounded-xl pr-10 pl-3 text-[15px] bg-white"
          />
        </label>
        <button type="button" onClick={() => { setQ(search.trim()); refetch(); }} className="h-12 px-4 rounded-xl border border-mist bg-white">بحث</button>
        <button type="button" onClick={exportFile} className="h-12 px-4 rounded-xl border border-mist bg-white flex items-center gap-2">
          <Download className="w-4 h-4" aria-hidden="true" /> Excel / CSV
        </button>
      </div>

      <div className="bg-white border border-mist rounded-2xl p-3 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">من تاريخ · From</span>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-11 border border-mist rounded-xl px-2" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">إلى تاريخ · To</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-11 border border-mist rounded-xl px-2" />
        </label>
        <div className="flex flex-col gap-1 text-sm">
          <span className="font-medium">العمر · Age</span>
          <div className="flex flex-wrap items-center gap-1">
            {AGE_PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                aria-pressed={agePreset === p.id}
                onClick={() => { setAgeMin(p.min); setAgeMax(p.max); }}
                className={`h-11 px-3 rounded-xl border text-sm ${agePreset === p.id ? 'bg-ink text-white border-ink' : 'bg-white border-mist'}`}
              >
                {p.ar} · {p.en}
              </button>
            ))}
            <input aria-label="Age from" inputMode="numeric" value={ageMin} onChange={(e) => setAgeMin(e.target.value.replace(/\D/g, ''))} placeholder="من" className="h-11 w-16 border border-mist rounded-xl px-2 text-center" />
            <span aria-hidden="true">–</span>
            <input aria-label="Age to" inputMode="numeric" value={ageMax} onChange={(e) => setAgeMax(e.target.value.replace(/\D/g, ''))} placeholder="إلى" className="h-11 w-16 border border-mist rounded-xl px-2 text-center" />
          </div>
        </div>
        {canAssign && (
          <label className="flex items-center gap-2 h-11 px-3 rounded-xl border border-mist text-sm">
            <input type="checkbox" checked={unassignedOnly} onChange={(e) => setUnassignedOnly(e.target.checked)} />
            غير معيّن فقط · Unassigned only
          </label>
        )}
        {(from || to || ageMin || ageMax || unassignedOnly) && (
          <button
            type="button"
            onClick={() => { setFrom(''); setTo(''); setAgeMin(''); setAgeMax(''); setUnassignedOnly(false); }}
            className="h-11 px-3 rounded-xl border border-mist text-sm"
          >
            مسح · Clear
          </button>
        )}
      </div>

      {canAssign && selected.size > 0 && (
        <div className="sticky top-2 z-10 bg-ink text-white rounded-2xl p-3 flex flex-wrap items-center gap-2">
          <span className="font-semibold">{selected.size} محددة · selected</span>
          <select
            aria-label="Physician for selected cases"
            value={bulkPhysician}
            onChange={(e) => setBulkPhysician(e.target.value)}
            className="h-11 rounded-xl px-2 text-ink bg-white min-w-[200px]"
          >
            <option value="">اختر الطبيب · Choose physician</option>
            {physicians.map((p) => <option key={p.id} value={p.id}>{p.fullName}</option>)}
          </select>
          <button type="button" disabled={bulkBusy} onClick={assignSelected} className="h-11 px-4 rounded-xl bg-white text-ink font-semibold disabled:opacity-50">
            تعيين للمحدد · Assign to selected
          </button>
          <button type="button" onClick={() => setSelected(new Set())} className="h-11 px-3 rounded-xl border border-white/50">
            إلغاء · Clear
          </button>
          <span className="text-xs opacity-80">Cases this physician triaged are skipped.</span>
        </div>
      )}

      {isError && (
        <p role="alert" className="bg-white border-2 border-ink rounded-xl px-4 py-3">تعذّر التحميل · Could not load.</p>
      )}

      <div className="overflow-x-auto bg-white border border-mist rounded-2xl">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="text-start text-graphite border-b border-mist">
              {canAssign && (
                <th className="p-3">
                  <input type="checkbox" aria-label="Select all in this list" checked={allSelected} onChange={toggleAll} />
                </th>
              )}
              <th className="p-3 font-medium">التذكرة</th>
              <th className="p-3 font-medium">الزيارة</th>
              <th className="p-3 font-medium">آخر ٣</th>
              <th className="p-3 font-medium">الوقت</th>
              <th className="p-3 font-medium">العمر</th>
              <th className="p-3 font-medium">الشكوى</th>
              <th className="p-3 font-medium">ممرض</th>
              <th className="p-3 font-medium">طبيب</th>
              <th className="p-3 font-medium">الاتفاق</th>
              <th className="p-3 font-medium">المدة</th>
              <th className="p-3 font-medium">التوجيه</th>
              <th className="p-3 font-medium">الحالة</th>
              <th className="p-3 font-medium">ممرض CTAS</th>
              <th className="p-3 font-medium">طبيب النتيجة</th>
              <th className="p-3 font-medium" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className={`border-b border-mist last:border-0 ${selected.has(row.id) ? 'bg-paper' : ''}`}>
                {canAssign && (
                  <td className="p-3">
                    <input type="checkbox" aria-label={`Select ${ticketCode(row.ticketNo, row.mrnSuffix)}`} checked={selected.has(row.id)} onChange={() => toggle(row.id)} />
                  </td>
                )}
                <td dir="ltr" className="p-3 font-semibold whitespace-nowrap">{ticketCode(row.ticketNo, row.mrnSuffix)}</td>
                <td dir="ltr" className="p-3 tabular-nums whitespace-nowrap">{row.encounterNo || '—'}</td>
                <td dir="ltr" className="p-3">{row.mrnSuffix || '—'}</td>
                <td className="p-3 whitespace-nowrap">{fmtWhen(row.ctasCompletedAt)}</td>
                <td className="p-3 whitespace-nowrap">{ageSex(row)}</td>
                <td className="p-3 max-w-[180px] truncate">{row.chiefComplaint || '—'}</td>
                <td className="p-3"><span className="rounded-md px-2 py-0.5 font-bold" style={ctasFill(row.nurseCtas)}> {row.nurseCtas ?? '—'} </span></td>
                <td className="p-3"><span className="rounded-md px-2 py-0.5 font-bold" style={ctasFill(row.physicianCtas)}> {row.physicianCtas ?? '—'} </span></td>
                <td className="p-3">{row.agreed == null ? '—' : row.agreed ? 'موافق' : 'غير موافق'}</td>
                <td className="p-3 whitespace-nowrap">{fmtDuration(row.triageDurationSec)}</td>
                <td className="p-3 max-w-[160px] truncate">{row.direction || '—'}</td>
                <td className="p-3 whitespace-nowrap">{statusLabel(row.currentStatus)}</td>
                <td className="p-3 whitespace-nowrap">{row.ctasNurseName || '—'}</td>
                <td className="p-3 whitespace-nowrap">
                  {canAssign ? (
                    <div className="flex items-center gap-1">
                      <select
                        aria-label="Assign physician"
                        value={pick[row.id] ?? row.outcomePhysicianId ?? ''}
                        onChange={(e) => setPick((p) => ({ ...p, [row.id]: e.target.value }))}
                        className="h-10 border border-mist rounded-lg px-2 bg-white max-w-[160px]"
                      >
                        <option value="">—</option>
                        {physicians.map((p) => (
                          <option key={p.id} value={p.id}>{p.fullName}</option>
                        ))}
                      </select>
                      <button
                        type="button"
                        disabled={assigning === row.id}
                        onClick={() => assignPhysician(row)}
                        className="h-10 px-3 rounded-lg border border-mist disabled:opacity-40"
                      >
                        تعيين
                      </button>
                    </div>
                  ) : (row.outcomePhysicianName || '—')}
                </td>
                <td className="p-3 whitespace-nowrap">
                  {row.canAct && (
                    <button type="button" onClick={() => setActive(row)} className="h-10 px-3 rounded-lg bg-ink text-white font-medium">
                      مراجعة النتيجة
                    </button>
                  )}
                  {row.canAct && row.outcome && row.currentStatus !== 'closed' && (
                    <button
                      type="button"
                      onClick={() => closeCase(row)}
                      disabled={!!row.closeProblem}
                      title={row.closeProblem || 'Close'}
                      className="h-10 px-3 rounded-lg border border-mist ms-1 disabled:opacity-40"
                    >
                      إغلاق
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {!isFetching && rows.length === 0 && (
              <tr>
                <td colSpan={canAssign ? 16 : 15} className="p-8 text-center text-graphite">لا توجد حالات في هذا المرشح · No cases in this filter.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {active?.outcome && (
        <p className="text-sm text-graphite m-0">
          آخر مراجعة: {active.outcome.reviewerName} · {fmtWhen(active.outcome.reviewedAt)} · {labelOf(DISPOSITIONS, active.outcome.disposition)}
        </p>
      )}

      <OutcomeForm
        row={active}
        open={Boolean(active)}
        onOpenChange={(o) => { if (!o) setActive(null); }}
        onSaved={refresh}
      />
    </div>
  );
}
