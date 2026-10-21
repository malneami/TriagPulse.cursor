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
          Add the HIS discharge or admission. Nurse and physician CTAS are not changed.
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
          <span className="text-sm font-medium">التشخيص النهائي من النظام / Final diagnosis from HIS</span>
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
          <p className="text-sm text-graphite m-0">Only the CTAS nurse or the assigned physician can save this review.</p>
        )}
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

  const { data: rows = [], isFetching, isError, refetch } = useQuery({
    queryKey: ['outcomes', status, q],
    queryFn: () => api.outcomes.list({ status, q }),
  });

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
      const blob = await api.outcomes.exportCsv({ status, q });
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

      {isError && (
        <p role="alert" className="bg-white border-2 border-ink rounded-xl px-4 py-3">تعذّر التحميل · Could not load.</p>
      )}

      <div className="overflow-x-auto bg-white border border-mist rounded-2xl">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="text-start text-graphite border-b border-mist">
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
              <tr key={row.id} className="border-b border-mist last:border-0">
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
                    <button type="button" onClick={() => closeCase(row)} className="h-10 px-3 rounded-lg border border-mist ms-1">إغلاق</button>
                  )}
                </td>
              </tr>
            ))}
            {!isFetching && rows.length === 0 && (
              <tr>
                <td colSpan={15} className="p-8 text-center text-graphite">لا توجد حالات في هذا المرشح · No cases in this filter.</td>
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
