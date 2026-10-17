import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { BadgeCheck, ChevronDown, Monitor, Plus, RefreshCw, Search } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { canAccess } from '@/lib/security/roles';
import CtasReviewDialog from '@/components/journey/CtasReviewDialog';
import EncounterLink from '@/components/journey/EncounterLink';
import { api } from '@/api/client';
import { CTAS_LEVELS, ctasBar, ctasMeta } from '@/lib/ctasStyle';
import { ticketCode } from '@/lib/ticket';

/** Minutes since arrival (the board's wait clock). */
export function minutesSince(iso, now = Date.now()) {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? null : Math.max(0, Math.floor((now - t) / 60000));
}

/** Wait state against the CTAS target: over target, its share of the target, minutes over. */
export function waitState(patient, now = Date.now()) {
  const waited = minutesSince(patient.arrival_time, now);
  const level = patient.ctas_level;
  const target = level ? ctasMeta(level).wait_min : null;
  if (waited == null || target == null) return { waited, target, over: false, overBy: 0, pct: 0 };
  // Level 1 is "immediate": it is shown in resuscitation, never as "over target".
  if (target === 0) return { waited, target, over: false, overBy: 0, pct: 100 };
  const over = waited > target;
  return { waited, target, over, overBy: over ? waited - target : 0, pct: Math.min(100, Math.round((waited / target) * 100)) };
}

const STATUS_TEXT = {
  registration: 'بانتظار الفرز',
  ctas_pending: 'بانتظار فرز CTAS',
  ctas_in_progress: 'قيد الفرز الآن',
  complete: 'بانتظار الطبيب',
};

function patientName(p) {
  return p.patient_name_ar || p.patient_name_en || 'مريض بلا اسم';
}

function ageSex(p) {
  const age = p.age != null ? `${p.age} س` : null;
  const sex = p.gender === 'male' ? 'ذكر' : p.gender === 'female' ? 'أنثى' : null;
  return [age, sex].filter(Boolean).join('، ');
}

function PatientCard({ patient, now, onOpen, onSeen, onReview, physician }) {
  const [confirming, setConfirming] = useState(false);
  useEffect(() => {
    if (!confirming) return undefined;
    const t = setTimeout(() => setConfirming(false), 4000);
    return () => clearTimeout(t);
  }, [confirming]);

  const w = waitState(patient, now);
  const triaged = Boolean(patient.ctas_level);
  const late = triaged && w.over;
  const status = late ? `تجاوز الهدف ${w.overBy} د` : (STATUS_TEXT[patient.current_status] || 'في القسم');
  const detail = patient.chief_complaint || patient.vt_destination_ar || patient.vt_destination || '';

  return (
    <li
      className={`rounded-xl p-3 flex flex-col gap-1.5 ${late ? 'bg-ink text-white' : 'bg-white border border-mist'}`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-base font-semibold truncate">{patientName(patient)}</span>
        <span dir="ltr" className={`text-sm font-semibold ${late ? 'text-white' : 'text-graphite'}`}>{ticketCode(patient.ticket_no)}</span>
      </div>
      {(ageSex(patient) || detail) && (
        <span className={`text-sm truncate ${late ? 'text-white/90' : 'text-graphite'}`}>
          {[ageSex(patient), detail].filter(Boolean).join(' · ')}
        </span>
      )}
      {patient.ctas_reviewed_at && (
        <span className={`text-xs flex items-center gap-1 ${late ? 'text-white' : 'text-ink'}`}>
          <BadgeCheck className="w-3.5 h-3.5" aria-hidden="true" /> راجع الطبيب المستوى · Physician checked
        </span>
      )}
      <div className="flex items-baseline justify-between gap-2">
        <span className={`text-sm ${late ? 'font-semibold' : 'text-graphite'}`}>{status}</span>
        <span className="text-xl font-semibold tabular-nums">{w.waited ?? '—'} د</span>
      </div>
      {triaged && w.target > 0 && (
        <span className={`h-1.5 rounded-full overflow-hidden ${late ? 'bg-white/30' : 'bg-paper'}`} aria-hidden="true">
          <span className={`block h-full rounded-full ${late ? 'bg-white' : 'bg-graphite'}`} style={{ width: `${w.pct}%` }} />
        </span>
      )}
      <div className="flex gap-2 pt-1">
        {!triaged && (
          <button
            type="button"
            onClick={() => onOpen(patient)}
            className="flex-1 h-12 rounded-lg bg-ink text-white text-sm font-medium"
          >
            {patient.current_status === 'ctas_in_progress' ? 'متابعة الفرز' : 'بدء فرز CTAS'}
          </button>
        )}
        {triaged && physician && (
          <>
            <button
              type="button"
              onClick={() => onReview(patient, 'seen')}
              aria-label={`مراجعة المستوى وتسجيل فحص ${patientName(patient)}`}
              className={`flex-1 h-12 rounded-lg text-sm font-medium ${late ? 'bg-white text-ink' : 'bg-ink text-white'}`}
            >
              فحصه الطبيب / Seen
            </button>
            <button
              type="button"
              onClick={() => onReview(patient, 'retriage')}
              aria-label={`إعادة فرز ${patientName(patient)}`}
              className={`h-12 px-3 rounded-lg text-sm font-medium ${late ? 'border border-white/60 text-white' : 'border border-mist text-ink hover:bg-paper'}`}
            >
              إعادة الفرز
            </button>
          </>
        )}
        {triaged && !physician && (
          <button
            type="button"
            onClick={() => (confirming ? (setConfirming(false), onSeen(patient)) : setConfirming(true))}
            aria-label={confirming ? `تأكيد أن الطبيب فحص ${patientName(patient)}` : `تم فحص ${patientName(patient)} من الطبيب`}
            className={`flex-1 h-12 rounded-lg text-sm font-medium ${
              confirming
                ? (late ? 'bg-white text-ink' : 'bg-ink text-white')
                : (late ? 'border border-white/60 text-white' : 'border border-mist text-ink hover:bg-paper')
            }`}
          >
            {confirming ? 'اضغط مرة أخرى للتأكيد' : 'فحصه الطبيب / Seen'}
          </button>
        )}
      </div>
    </li>
  );
}

function Lane({ title, sub, count, barStyle, children }) {
  return (
    <section aria-label={title} className="bg-white border border-mist rounded-2xl overflow-hidden flex flex-col min-h-[180px]">
      <div className="h-2" style={barStyle} />
      <div className="px-3 pt-3 pb-2 flex items-baseline justify-between gap-2">
        <span className="flex flex-col">
          <span className="text-lg font-semibold">{title}</span>
          <span className="text-xs text-graphite">{sub}</span>
        </span>
        <span className="text-2xl font-semibold tabular-nums">{count}</span>
      </div>
      <ul className="px-2.5 pb-3 flex flex-col gap-2 list-none m-0">
        {children}
      </ul>
    </section>
  );
}

/** Triaged patients of the last 24 h with no HIS encounter number yet. */
function NotLinked() {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const { data: list = [], isError } = useQuery({
    queryKey: ['unlinked-journeys'],
    queryFn: () => api.journeys.unlinked(24),
    refetchInterval: 60000,
  });
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['unlinked-journeys'] });
    queryClient.invalidateQueries({ queryKey: ['tracking-board'] });
  };
  if (isError) return null;
  return (
    <section aria-label="غير مربوط برقم زيارة" className="bg-white border border-mist rounded-2xl">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="w-full px-4 h-12 flex items-center gap-2 text-[15px]"
      >
        <span className="font-semibold">غير مربوط برقم زيارة</span>
        <span className="text-graphite text-sm">Not linked to an encounter · last 24 h</span>
        <span className={`ms-auto min-w-8 h-8 px-2 rounded-lg flex items-center justify-center font-semibold tabular-nums ${list.length ? 'bg-ink text-white' : 'bg-paper'}`}>
          {list.length}
        </span>
        <ChevronDown className={`w-5 h-5 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>
      {open && (
        <ul className="list-none m-0 px-3 pb-3 flex flex-col gap-2">
          {list.length === 0 && <li className="text-sm text-graphite px-1 py-2">كل المرضى مربوطون / Everyone is linked.</li>}
          {list.map((p) => (
            <li key={p.id} className="flex items-center gap-3 border border-mist rounded-xl px-3 py-2">
              <span dir="ltr" className="font-semibold">{ticketCode(p.ticket_no)}</span>
              <span className="truncate">{patientName(p)}</span>
              <span className="text-sm text-graphite">{ageSex(p)}</span>
              <span className="text-sm text-graphite">CTAS {p.ctas_level}</span>
              <span className="text-sm text-graphite tabular-nums" dir="ltr">
                {p.arrival_time ? new Date(p.arrival_time).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : ''}
              </span>
              <span className="ms-auto"><EncounterLink journey={p} onLinked={refresh} /></span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default function PatientTracking() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const physician = canAccess(user, 'review_ctas');
  const [review, setReview] = useState(null); // { patient, mode }
  const [search, setSearch] = useState('');
  const [now, setNow] = useState(Date.now());

  // Keep wait times moving between refreshes.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);

  const { data: patients = [], refetch, isFetching, isError } = useQuery({
    queryKey: ['tracking-board'],
    queryFn: () => api.tracking.board(),
    refetchInterval: 15000,
  });

  const filtered = useMemo(() => {
    if (!search.trim()) return patients;
    const q = search.trim().toLowerCase();
    return patients.filter((p) =>
      ticketCode(p.ticket_no).toLowerCase().includes(q)
      || (p.patient_name_ar || '').includes(search.trim())
      || (p.patient_name_en || '').toLowerCase().includes(q)
      || (p.mrn || '').toLowerCase().includes(q));
  }, [patients, search]);

  const byLevel = useMemo(() => {
    const lanes = { 1: [], 2: [], 3: [], 4: [], 5: [], awaiting: [] };
    for (const p of filtered) {
      if (p.ctas_level && lanes[p.ctas_level]) lanes[p.ctas_level].push(p);
      else lanes.awaiting.push(p);
    }
    for (const key of Object.keys(lanes)) {
      lanes[key].sort((a, b) => new Date(a.arrival_time) - new Date(b.arrival_time));
    }
    return lanes;
  }, [filtered]);

  const overTarget = filtered.filter((p) => p.ctas_level && waitState(p, now).over).length;

  const openTriage = (p) => navigate(`/triage?pid=${encodeURIComponent(p.patient_id)}`);
  const markSeen = async (p) => {
    try {
      await api.journeys.markSeen(p.id);
      toast.success(`${ticketCode(p.ticket_no)} — تم تسجيل فحص الطبيب / Marked as seen`);
      queryClient.invalidateQueries({ queryKey: ['tracking-board'] });
    } catch (err) {
      toast.error(`تعذّر التحديث — ${err?.message || 'Could not update'}`);
    }
  };

  const afterReview = () => {
    queryClient.invalidateQueries({ queryKey: ['tracking-board'] });
    queryClient.invalidateQueries({ queryKey: ['unlinked-journeys'] });
  };
  const openReview = (patient, mode) => setReview({ patient, mode });

  return (
    <div dir="rtl" className="space-y-4 pb-8">
      <div className="flex flex-wrap items-end gap-4">
        <div className="flex flex-col">
          <h1 className="m-0 text-[28px] font-semibold">المرضى النشطون</h1>
          <span className="text-sm text-graphite">Active patients, last 12 hours. Updates every 15 seconds.</span>
        </div>
        <div className="flex gap-2 ms-auto">
          <div className="bg-white border border-mist rounded-xl px-4 py-2 flex flex-col">
            <span className="text-xs text-graphite">في القسم</span>
            <span className="text-2xl font-semibold tabular-nums">{filtered.length}</span>
          </div>
          <div className={`rounded-xl px-4 py-2 flex flex-col ${overTarget ? 'bg-ink text-white' : 'bg-white border border-mist'}`}>
            <span className={`text-xs ${overTarget ? '' : 'text-graphite'}`}>تجاوزوا الهدف</span>
            <span className="text-2xl font-semibold tabular-nums">{overTarget}</span>
          </div>
          <div className="bg-white border border-mist rounded-xl px-4 py-2 flex flex-col">
            <span className="text-xs text-graphite">بانتظار CTAS</span>
            <span className="text-2xl font-semibold tabular-nums">{byLevel.awaiting.length}</span>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <label className="relative flex-1 min-w-[220px]">
          <span className="sr-only">بحث بالاسم أو رقم التذكرة أو الملف</span>
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-graphite" aria-hidden="true" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="بحث بالاسم أو رقم التذكرة أو الملف…"
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
        <button
          type="button"
          onClick={() => navigate('/visual-triage')}
          className="h-12 px-4 rounded-xl bg-ink text-white flex items-center gap-2 text-[15px] font-medium"
        >
          <Plus className="w-5 h-5" aria-hidden="true" /> مريض جديد
        </button>
      </div>

      {isError && (
        <p role="alert" className="bg-white border-2 border-ink rounded-xl px-4 py-3 text-[15px]">
          تعذّر تحميل اللوحة. تحقق من الاتصال ثم اضغط تحديث. <span className="text-graphite">Could not load the board.</span>
        </p>
      )}

      <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
        {CTAS_LEVELS.map((level) => {
          const m = ctasMeta(level);
          return (
            <Lane key={level} title={`${level} ${m.ar}`} sub={level === 1 ? 'فوري / Immediate' : `خلال ${m.wait_min} دقيقة`} count={byLevel[level].length} barStyle={ctasBar(level)}>
              {byLevel[level].map((p) => (
                <PatientCard key={p.id} patient={p} now={now} onOpen={openTriage} onSeen={markSeen} onReview={openReview} physician={physician} />
              ))}
            </Lane>
          );
        })}
        <Lane title="بانتظار CTAS" sub="بعد الفرز البصري" count={byLevel.awaiting.length} barStyle={{ backgroundColor: '#4B5765' }}>
          {byLevel.awaiting.map((p) => (
            <PatientCard key={p.id} patient={p} now={now} onOpen={openTriage} onSeen={markSeen} onReview={openReview} physician={physician} />
          ))}
        </Lane>
      </div>

      <NotLinked />

      <CtasReviewDialog
        patient={review?.patient}
        mode={review?.mode}
        open={Boolean(review)}
        onOpenChange={(o) => { if (!o) setReview(null); }}
        onDone={afterReview}
      />

      {!isFetching && filtered.length === 0 && !isError && (
        <div className="bg-white border border-dashed border-graphite/40 rounded-2xl py-12 text-center space-y-3">
          <p className="text-lg font-semibold">لا يوجد مرضى نشطون</p>
          <p className="text-graphite text-sm">No active patients. Start with a visual triage.</p>
          <button type="button" onClick={() => navigate('/visual-triage')} className="h-12 px-5 rounded-xl bg-ink text-white font-medium">
            بدء الفرز البصري
          </button>
        </div>
      )}
    </div>
  );
}
