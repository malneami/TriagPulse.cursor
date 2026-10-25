import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Monitor, Plus, RefreshCw, Search } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { canAccess } from '@/lib/security/roles';
import CtasReviewDialog from '@/components/journey/CtasReviewDialog';
import EncounterLink from '@/components/journey/EncounterLink';
import { api } from '@/api/client';
import { CTAS_LEVELS, ctasBar, ctasFill, ctasMeta } from '@/lib/ctasStyle';
import { patientLabel, ticketCode } from '@/lib/ticket';
import { physicianMayAct } from '@triagepulse/clinical';

// PDPL: patients are shown by Transaction No. and ticket code, never by name.
const patientName = (p) => patientLabel(p);

function ageSex(p) {
  const age = p.age != null ? `${p.age} س` : null;
  const sex = p.gender === 'male' ? 'ذكر' : p.gender === 'female' ? 'أنثى' : null;
  return [age, sex].filter(Boolean).join('، ');
}

function formatTriageDuration(sec) {
  if (sec == null || sec < 0) return '—';
  if (sec < 60) return `${sec} ث`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s ? `${m} د ${s} ث` : `${m} د`;
}

function vitalsLine(p) {
  return [
    p.hr != null ? `HR ${p.hr}` : null,
    p.bp_systolic != null ? `SBP ${p.bp_systolic}` : null,
    p.spo2 != null ? `SpO₂ ${p.spo2}` : null,
    p.rr != null ? `RR ${p.rr}` : null,
    p.gcs != null ? `GCS ${p.gcs}` : null,
    p.pain_score != null ? `ألم ${p.pain_score}` : null,
  ].filter(Boolean).join(' · ');
}

function Lane({ title, sub, count, barStyle, children }) {
  return (
    <section aria-label={title} className="bg-white border border-mist rounded-2xl overflow-hidden flex flex-col min-h-[180px]">
      <div className="h-2" style={barStyle} />
      <div className="px-3 pt-3 pb-2 flex items-baseline justify-between gap-2">
        <span className="flex flex-col">
          <span className="text-lg font-semibold">{title}</span>
          {sub && <span className="text-xs text-graphite">{sub}</span>}
        </span>
        <span className="text-2xl font-semibold tabular-nums">{count}</span>
      </div>
      <ul className="px-2.5 pb-3 flex flex-col gap-2 list-none m-0">
        {children}
      </ul>
    </section>
  );
}

function ValidationCard({ patient, onAgree, onDisagree, user }) {
  const [saving, setSaving] = useState(false);
  const owner = patient.assigned_physician;
  const canAct = !user || physicianMayAct({ id: user.id, role: user.role || user.clinical_role }, patient.assigned_physician_id);
  const nurseLevel = patient.nurse_ctas ?? patient.ctas_level;
  const detail = patient.chief_complaint || '';
  const vitals = vitalsLine(patient);

  const agree = async () => {
    if (!canAct || nurseLevel == null) return;
    setSaving(true);
    try {
      await onAgree(patient, nurseLevel);
    } finally {
      setSaving(false);
    }
  };

  return (
    <li className="rounded-xl p-3 flex flex-col gap-1.5 bg-white border border-mist">
      <div className="flex items-baseline justify-between gap-2">
        <span dir="auto" className="text-base font-semibold truncate tabular-nums">{patientName(patient)}</span>
        <span dir="ltr" className="text-sm font-semibold text-graphite">{ticketCode(patient)}</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="rounded-md px-2 py-0.5 text-sm font-bold" style={ctasFill(nurseLevel)}>CTAS {nurseLevel ?? '—'}</span>
        <span className="text-sm text-graphite">{ctasMeta(nurseLevel).ar} · فرز الممرض</span>
      </div>
      {(ageSex(patient) || detail) && (
        <span className="text-sm truncate text-graphite">
          {[ageSex(patient), detail].filter(Boolean).join(' · ')}
        </span>
      )}
      {vitals && <span className="text-xs text-graphite tabular-nums" dir="ltr">{vitals}</span>}
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="text-graphite">مدة الفرز · Triage duration</span>
        <span className="text-lg font-semibold tabular-nums">{formatTriageDuration(patient.triage_duration_sec)}</span>
      </div>
      {patient.encounter_no && (
        <span dir="ltr" className="text-sm font-semibold tabular-nums">{patient.encounter_no}</span>
      )}
      {owner?.full_name && (
        <span className="text-xs text-graphite">قائد الفريق · {owner.full_name}</span>
      )}
      <div className="flex gap-2 pt-1">
        <button
          type="button"
          disabled={!canAct || saving || nurseLevel == null || !patient.encounter_no}
          title={!canAct ? `Assigned to ${owner?.full_name || 'another physician'}` : undefined}
          onClick={agree}
          className="flex-1 h-12 rounded-lg bg-ink text-white text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed"
        >
          موافق / Agree
        </button>
        <button
          type="button"
          disabled={!canAct || saving || !patient.encounter_no}
          title={!canAct ? `Assigned to ${owner?.full_name || 'another physician'}` : undefined}
          onClick={() => onDisagree(patient)}
          className="flex-1 h-12 rounded-lg border border-mist text-ink text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed hover:bg-paper"
        >
          غير موافق / Disagree
        </button>
      </div>
    </li>
  );
}

function HisLinkCard({ patient, onLinked }) {
  const detail = patient.chief_complaint || '';
  return (
    <li className="rounded-xl p-3 flex flex-col gap-2 bg-white border-2 border-ink">
      <div className="flex items-baseline justify-between gap-2">
        <span dir="ltr" className="text-base font-semibold tabular-nums">{ticketCode(patient)}</span>
        <span className="rounded-md px-2 py-0.5 text-sm font-bold" style={ctasFill(patient.nurse_ctas ?? patient.ctas_level)}>
          CTAS {patient.nurse_ctas ?? patient.ctas_level ?? '—'}
        </span>
      </div>
      {(ageSex(patient) || detail) && (
        <span className="text-sm truncate text-graphite">
          {[ageSex(patient), detail].filter(Boolean).join(' · ')}
        </span>
      )}
      <p className="m-0 text-sm font-semibold">مطلوب ربط رقم الزيارة / HIS number required</p>
      <p className="m-0 text-xs text-graphite">
        CTAS completed. Link the visit number to send this case to the physician board.
      </p>
      <EncounterLink journey={patient} onLinked={onLinked} prominent />
    </li>
  );
}

function NurseQueueCard({ patient, onOpen }) {
  const detail = patient.chief_complaint || patient.vt_destination_ar || patient.vt_destination || '';
  return (
    <li className="rounded-xl p-3 flex flex-col gap-1.5 bg-white border border-mist">
      <div className="flex items-baseline justify-between gap-2">
        <span dir="auto" className="text-base font-semibold truncate tabular-nums">{patientName(patient)}</span>
        <span dir="ltr" className="text-sm font-semibold text-graphite">{ticketCode(patient)}</span>
      </div>
      {(ageSex(patient) || detail) && (
        <span className="text-sm truncate text-graphite">
          {[ageSex(patient), detail].filter(Boolean).join(' · ')}
        </span>
      )}
      <span className="text-sm text-graphite">
        {patient.current_status === 'ctas_in_progress' ? 'قيد الفرز الآن' : 'بانتظار فرز CTAS'}
      </span>
      <button
        type="button"
        onClick={() => onOpen(patient)}
        className="h-12 rounded-lg bg-ink text-white text-sm font-medium"
      >
        {patient.current_status === 'ctas_in_progress' ? 'متابعة الفرز' : 'بدء فرز CTAS'}
      </button>
    </li>
  );
}

export default function PatientTracking() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const physician = canAccess(user, 'review_ctas');
  const [review, setReview] = useState(null);
  const [search, setSearch] = useState('');
  // Filters: age (years), date range and time of day of CTAS completion (else arrival).
  const [ageMin, setAgeMin] = useState('');
  const [ageMax, setAgeMax] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [timeFrom, setTimeFrom] = useState('');
  const [timeTo, setTimeTo] = useState('');
  const filtersOn = !!(ageMin || ageMax || dateFrom || dateTo || timeFrom || timeTo);
  const clearFilters = () => { setAgeMin(''); setAgeMax(''); setDateFrom(''); setDateTo(''); setTimeFrom(''); setTimeTo(''); };

  const { data: patients = [], refetch, isFetching, isError } = useQuery({
    queryKey: ['tracking-board'],
    queryFn: () => api.tracking.board(),
    refetchInterval: 15000,
  });

  const matchFilters = (p) => {
    const age = p.age == null || p.age === '' ? null : Number(p.age);
    if (ageMin !== '' && (age == null || age < Number(ageMin))) return false;
    if (ageMax !== '' && (age == null || age > Number(ageMax))) return false;
    if (!dateFrom && !dateTo && !timeFrom && !timeTo) return true;
    const t = new Date(p.ctas_completed_at || p.arrival_time || p.created_at || '');
    if (Number.isNaN(t.getTime())) return false;
    const pad = (n) => String(n).padStart(2, '0');
    const day = `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`;
    if (dateFrom && day < dateFrom) return false;
    if (dateTo && day > dateTo) return false;
    const hm = `${pad(t.getHours())}:${pad(t.getMinutes())}`;
    if (timeFrom && timeTo) {
      // A window that crosses midnight (e.g. 22:00–06:00) wraps.
      const inside = timeFrom <= timeTo ? hm >= timeFrom && hm <= timeTo : hm >= timeFrom || hm <= timeTo;
      if (!inside) return false;
    } else if (timeFrom && hm < timeFrom) return false;
    else if (timeTo && hm > timeTo) return false;
    return true;
  };

  const matchSearch = (p) => {
    if (!matchFilters(p)) return false;
    if (!search.trim()) return true;
    const q = search.trim().toLowerCase();
    const compact = q.replace(/\s+/g, '');
    const code = ticketCode(p).toLowerCase();
    return code.includes(q)
      || String(p.mrn_suffix || '').includes(q)
      || String(p.encounter_no || '').includes(compact);
  };

  const hisRequired = useMemo(
    () => patients.filter((p) => p.current_status === 'awaiting_his_link' && matchSearch(p)),
    [patients, search, ageMin, ageMax, dateFrom, dateTo, timeFrom, timeTo],
  );

  const filtered = useMemo(() => {
    const pool = physician
      ? patients.filter((p) => p.current_status === 'pending_physician_validation')
      : patients.filter((p) => !p.ctas_level);
    return pool.filter(matchSearch);
  }, [patients, search, physician, ageMin, ageMax, dateFrom, dateTo, timeFrom, timeTo]);

  const byLevel = useMemo(() => {
    const lanes = { 1: [], 2: [], 3: [], 4: [], 5: [] };
    for (const p of filtered) {
      const level = p.nurse_ctas ?? p.ctas_level;
      if (level && lanes[level]) lanes[level].push(p);
    }
    for (const key of Object.keys(lanes)) {
      lanes[key].sort((a, b) => new Date(a.ctas_completed_at || a.arrival_time) - new Date(b.ctas_completed_at || b.arrival_time));
    }
    return lanes;
  }, [filtered]);

  const afterChange = () => {
    queryClient.invalidateQueries({ queryKey: ['tracking-board'] });
    queryClient.invalidateQueries({ queryKey: ['unlinked-journeys'] });
    queryClient.invalidateQueries({ queryKey: ['dept-feedback'] });
  };

  const agree = async (p, level) => {
    try {
      await api.journeys.reviewCtas(p.id, { level });
      toast.success(`${ticketCode(p)} — موافق على CTAS ${level} / Agreed`);
      afterChange();
    } catch (err) {
      toast.error(`تعذّر الاعتماد — ${err?.message || 'Could not save'}`);
    }
  };

  const openTriage = (p) => navigate(`/triage?pid=${encodeURIComponent(p.patient_id)}`);

  return (
    <div dir="rtl" className="space-y-4 pb-8">
      <div className="flex flex-wrap items-end gap-4">
        <div className="flex flex-col">
          <h1 className="m-0 text-[28px] font-semibold">
            {physician ? 'بانتظار اعتماد الطبيب' : 'لوحة الممرض'}
          </h1>
          <span className="text-sm text-graphite">
            {physician
              ? 'HIS-linked nurse CTAS awaiting Agree or Disagree. The nurse record is not changed.'
              : 'Complete CTAS, then link the HIS visit number. Physician validation starts only after linking.'}
          </span>
        </div>
        <div className="flex gap-2 ms-auto">
          {!physician && (
            <div className="bg-white border border-mist rounded-xl px-4 py-2 flex flex-col">
              <span className="text-xs text-graphite">مطلوب رقم الزيارة</span>
              <span className="text-2xl font-semibold tabular-nums">{hisRequired.length}</span>
            </div>
          )}
          <div className="bg-white border border-mist rounded-xl px-4 py-2 flex flex-col">
            <span className="text-xs text-graphite">{physician ? 'بانتظار الاعتماد' : 'بانتظار CTAS'}</span>
            <span className="text-2xl font-semibold tabular-nums">{filtered.length}</span>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <label className="relative flex-1 min-w-[220px]">
          <span className="sr-only">بحث برقم الزيارة أو التذكرة أو آخر ٣ من الملف</span>
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-graphite" aria-hidden="true" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="بحث برقم الزيارة أو التذكرة أو آخر ٣ · Visit no., ticket, or last 3 of MRN…"
            className="w-full h-12 border border-mist rounded-xl pr-10 pl-3 text-[15px] bg-white"
          />
        </label>
        <button
          type="button"
          onClick={() => refetch()}
          aria-label="تحديث الآن / Refresh"
          className="h-12 w-12 rounded-xl border border-mist bg-white flex items-center justify-center"
        >
          <RefreshCw className={`w-5 h-5 ${isFetching ? 'animate-spin' : ''}`} aria-hidden="true" />
        </button>
        <Link
          to="/tracking/wall"
          className="h-12 px-4 rounded-xl border border-mist bg-white flex items-center gap-2 text-[15px] no-underline text-ink"
        >
          <Monitor className="w-5 h-5" aria-hidden="true" /> شاشة الحائط
        </Link>
        {!physician && (
          <button
            type="button"
            onClick={() => navigate('/visual-triage')}
            className="h-12 px-4 rounded-xl bg-ink text-white flex items-center gap-2 text-[15px] font-medium"
          >
            <Plus className="w-5 h-5" aria-hidden="true" /> مريض جديد
          </button>
        )}
      </div>

      <fieldset className="border border-mist rounded-xl bg-white p-3 flex flex-wrap gap-3 items-end">
        <legend className="px-1 text-sm font-medium">تصفية · Filter</legend>
        <div className="flex flex-col gap-1">
          <span className="text-xs text-graphite">العمر (سنوات) · Age (years)</span>
          <div className="flex items-center gap-1">
            <input type="number" min="0" max="120" inputMode="numeric" value={ageMin} onChange={(e) => setAgeMin(e.target.value)} placeholder="من / from" aria-label="Age from" className="h-11 w-24 border border-mist rounded-xl px-2" />
            <span aria-hidden="true">–</span>
            <input type="number" min="0" max="120" inputMode="numeric" value={ageMax} onChange={(e) => setAgeMax(e.target.value)} placeholder="إلى / to" aria-label="Age to" className="h-11 w-24 border border-mist rounded-xl px-2" />
          </div>
          <div className="flex gap-1">
            <button type="button" onClick={() => { setAgeMin(''); setAgeMax('17'); }} className="h-8 px-2 rounded-lg border border-mist text-xs">أطفال · &lt;18</button>
            <button type="button" onClick={() => { setAgeMin('18'); setAgeMax(''); }} className="h-8 px-2 rounded-lg border border-mist text-xs">بالغون · 18+</button>
          </div>
        </div>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-graphite">من تاريخ · From date</span>
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="h-11 border border-mist rounded-xl px-2" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-graphite">إلى تاريخ · To date</span>
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="h-11 border border-mist rounded-xl px-2" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-graphite">من الساعة · From time</span>
          <input type="time" value={timeFrom} onChange={(e) => setTimeFrom(e.target.value)} className="h-11 border border-mist rounded-xl px-2" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-graphite">إلى الساعة · To time</span>
          <input type="time" value={timeTo} onChange={(e) => setTimeTo(e.target.value)} className="h-11 border border-mist rounded-xl px-2" />
        </label>
        {filtersOn && (
          <button type="button" onClick={clearFilters} className="h-11 px-4 rounded-xl border border-mist text-sm">
            مسح التصفية · Clear
          </button>
        )}
        <span className="text-xs text-graphite basis-full">
          الوقت = وقت إكمال CTAS (أو الوصول) · Time = CTAS completed (or arrival). A time window like 22:00–06:00 crosses midnight.
        </span>
      </fieldset>

      {isError && (
        <p role="alert" className="bg-white border-2 border-ink rounded-xl px-4 py-3 text-[15px]">
          تعذّر تحميل اللوحة. تحقق من الاتصال ثم اضغط تحديث. <span className="text-graphite">Could not load the board.</span>
        </p>
      )}

      {physician ? (
        <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
          {CTAS_LEVELS.map((level) => {
            const m = ctasMeta(level);
            return (
              <Lane key={level} title={`${level} ${m.ar}`} sub="فرز الممرض / Nurse CTAS" count={byLevel[level].length} barStyle={ctasBar(level)}>
                {byLevel[level].map((p) => (
                  <ValidationCard
                    key={p.id}
                    patient={p}
                    user={user}
                    onAgree={agree}
                    onDisagree={(patient) => setReview(patient)}
                  />
                ))}
              </Lane>
            );
          })}
        </div>
      ) : (
        <>
          {hisRequired.length > 0 && (
            <section aria-label="مطلوب ربط رقم الزيارة" className="space-y-2">
              <h2 className="m-0 text-lg font-semibold">مطلوب ربط رقم الزيارة / HIS number required</h2>
              <p className="m-0 text-sm text-graphite">CTAS is complete. Link the visit number to move the case to the physician board.</p>
              <ul className="list-none m-0 p-0 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {hisRequired.map((p) => (
                  <HisLinkCard key={p.id} patient={p} onLinked={afterChange} />
                ))}
              </ul>
            </section>
          )}
          <ul className="list-none m-0 p-0 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((p) => (
              <NurseQueueCard key={p.id} patient={p} onOpen={openTriage} />
            ))}
          </ul>
        </>
      )}

      <CtasReviewDialog
        patient={review}
        open={Boolean(review)}
        onOpenChange={(o) => { if (!o) setReview(null); }}
        onDone={afterChange}
      />

      {!isFetching && filtered.length === 0 && (physician || hisRequired.length === 0) && !isError && (
        <div className="bg-white border border-dashed border-graphite/40 rounded-2xl py-12 text-center space-y-3">
          <p className="text-lg font-semibold">
            {physician ? 'لا توجد حالات بانتظار الاعتماد' : 'لا يوجد مرضى بانتظار CTAS'}
          </p>
          <p className="text-graphite text-sm">
            {physician
              ? 'No completed assessments waiting for physician validation.'
              : 'No patients waiting for CTAS. Start with a visual triage.'}
          </p>
          {!physician && (
            <button type="button" onClick={() => navigate('/visual-triage')} className="h-12 px-5 rounded-xl bg-ink text-white font-medium">
              بدء الفرز البصري
            </button>
          )}
        </div>
      )}
    </div>
  );
}
