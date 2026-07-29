import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '@/api/client';
import { useQuery } from '@tanstack/react-query';
import { RefreshCw, Plus, Search, ChevronDown, ChevronUp } from 'lucide-react';

const CTAS_TARGETS = { 1: 0, 2: 15, 3: 30, 4: 60, 5: 120 };

function waitMins(iso) {
  if (!iso) return null;
  return Math.round((Date.now() - new Date(iso).getTime()) / 60000);
}

function fmtTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' });
}

function getWaitColor(patient) {
  const wm = waitMins(patient.arrival_time);
  if (wm == null) return 'text-slate-400';
  if (!patient.ctas_level) {
    if (wm > 15) return 'text-red-600 font-black';
    if (wm > 8) return 'text-amber-600 font-bold';
    return 'text-green-600 font-bold';
  }
  const target = CTAS_TARGETS[patient.ctas_level] ?? 60;
  const ratio = target === 0 ? Infinity : wm / target;
  if (ratio > 1.0) return 'text-red-600 font-black';
  if (ratio > 0.7) return 'text-amber-600 font-bold';
  return 'text-green-600 font-bold';
}

function ActionButton({ patient, onAction }) {
  const status = patient.current_status;
  if (status === 'active_resus') {
    return (
      <button onClick={() => onAction(patient, 'ctas')}
        className="px-3 py-1.5 rounded-xl text-xs font-black bg-red-600 text-white animate-pulse">
        إنعاش 🔴
      </button>
    );
  }
  if (status === 'registration') {
    return (
      <button onClick={() => onAction(patient, 'register')}
        className="px-3 py-1.5 rounded-xl text-xs font-black bg-blue-600 text-white hover:bg-blue-700">
        تسجيل ▶
      </button>
    );
  }
  if (status === 'ctas_pending') {
    return (
      <button onClick={() => onAction(patient, 'ctas')}
        className="px-3 py-1.5 rounded-xl text-xs font-black bg-teal-600 text-white hover:bg-teal-700">
        فرز CTAS ▶
      </button>
    );
  }
  if (status === 'ctas_in_progress') {
    return (
      <button onClick={() => onAction(patient, 'ctas')}
        className="px-3 py-1.5 rounded-xl text-xs font-black bg-amber-500 text-white hover:bg-amber-600">
        متابعة ▶
      </button>
    );
  }
  if (status === 'complete') {
    return (
      <button onClick={() => onAction(patient, 'ctas')}
        className="px-3 py-1.5 rounded-xl text-xs font-black bg-green-600 text-white hover:bg-green-700">
        عرض
      </button>
    );
  }
  return (
    <button onClick={() => onAction(patient, 'register')}
      className="px-3 py-1.5 rounded-xl text-xs font-black bg-slate-400 text-white">
      ▶
    </button>
  );
}

const STATUS_LABEL = {
  arrived:          { text: '⏳ وصل',         cls: 'bg-slate-100 text-slate-600' },
  visual_triage:    { text: '🟡 فرز بصري',    cls: 'bg-yellow-100 text-yellow-700' },
  registration:     { text: '⏳ تسجيل',       cls: 'bg-blue-100 text-blue-700' },
  awaiting_ctas:    { text: '🔵 فرز CTAS',    cls: 'bg-teal-100 text-teal-700' },
  ctas_pending:     { text: '🔵 فرز CTAS',    cls: 'bg-teal-100 text-teal-700' },
  ctas_in_progress: { text: '🟠 جارٍ',        cls: 'bg-amber-100 text-amber-700' },
  complete:         { text: '✅ مكتمل',        cls: 'bg-green-100 text-green-700' },
  completed:        { text: '✅ مكتمل',        cls: 'bg-green-100 text-green-700' },
  active_resus:     { text: '🔴 إنعاش',        cls: 'bg-red-100 text-red-700' },
};

function PatientRow({ patient, onAction }) {
  const wm = waitMins(patient.arrival_time);
  const waitClr = getWaitColor(patient);
  const sl = STATUS_LABEL[patient.current_status] || STATUS_LABEL.arrived;
  const name = patient.patient_name_ar || patient.patient_name_en || 'مجهول';
  const dest = patient.vt_destination_ar || patient.vt_destination || '—';

  return (
    <div className="px-4 py-3 flex items-center gap-2 hover:bg-slate-50 transition-colors">
      <div className="w-20 shrink-0">
        <span className="text-xs font-black text-red-600">{patient.patient_id || '—'}</span>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold text-slate-800 truncate">{name}</p>
        <p className="text-xs text-slate-400 truncate">{dest}</p>
      </div>
      <div className="w-24 shrink-0">
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${sl.cls}`}>{sl.text}</span>
      </div>
      <div className={`w-16 shrink-0 text-xs ${waitClr}`}>
        {fmtTime(patient.arrival_time)}
        {wm != null && <div>{wm} د</div>}
      </div>
      <div className="w-14 text-xs font-black text-slate-500 shrink-0">
        {patient.ctas_level ? `CTAS ${patient.ctas_level}` : '—'}
      </div>
      <div className="shrink-0">
        <ActionButton patient={patient} onAction={onAction} />
      </div>
    </div>
  );
}

export default function PatientTracking() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [showCompleted, setShowCompleted] = useState(false);
  const [patients, setPatients] = useState([]);

  const { data: boardData, refetch, isFetching } = useQuery({
    queryKey: ['active-journeys'],
    queryFn: () => api.tracking.board(),
    refetchInterval: 15000,
  });

  useEffect(() => { if (boardData) setPatients(boardData); }, [boardData]);

  const handleAction = (patient, action) => {
    const pid = patient.patient_id;
    if (action === 'register') navigate(`/triage?pid=${encodeURIComponent(pid)}`);
    else if (action === 'ctas') navigate(`/triage?pid=${encodeURIComponent(pid)}`);
  };

  const filtered = patients.filter(p => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      (p.patient_id || '').toLowerCase().includes(q) ||
      (p.patient_name_ar || '').includes(search) ||
      (p.patient_name_en || '').toLowerCase().includes(q)
    );
  });

  const awaiting = filtered.filter(p => ['registration', 'awaiting_ctas', 'ctas_pending'].includes(p.current_status));
  const inTriage = filtered.filter(p => ['ctas_pending', 'ctas_in_progress', 'awaiting_ctas'].includes(p.current_status));
  const resus = filtered.filter(p => p.current_status === 'active_resus');
  const completed = filtered.filter(p => p.current_status === 'complete');
  const other = filtered.filter(p => !['registration', 'ctas_pending', 'ctas_in_progress', 'active_resus', 'complete'].includes(p.current_status));

  const active = filtered.filter(p => p.current_status !== 'complete');
  const avgWait = (() => {
    const times = active.filter(p => p.arrival_time).map(p => waitMins(p.arrival_time)).filter(v => v != null);
    if (!times.length) return 0;
    return Math.round(times.reduce((a, b) => a + b, 0) / times.length);
  })();
  const longestMins = active.filter(p => p.arrival_time).reduce((mx, p) => {
    const wm = waitMins(p.arrival_time) || 0; return Math.max(mx, wm);
  }, 0);

  const Section = ({ title, count, children, colorCls = 'bg-slate-50 border-slate-200' }) => {
    if (count === 0) return null;
    return (
      <div className={`rounded-2xl border overflow-hidden ${colorCls}`}>
        <div className="px-4 py-2.5 flex items-center justify-between">
          <span className="text-sm font-black text-slate-700">{title}</span>
          <span className="text-xs bg-white border border-slate-200 text-slate-600 px-2 py-0.5 rounded-full font-bold">{count} مريض</span>
        </div>
        <div className="bg-white divide-y divide-slate-100">
          {/* Column headers */}
          <div className="px-4 py-1.5 flex items-center gap-2 text-xs font-black text-slate-400">
            <span className="w-20">ID</span>
            <span className="flex-1">الاسم / الوجهة</span>
            <span className="w-24">الحالة</span>
            <span className="w-16">الوصول</span>
            <span className="w-14">CTAS</span>
            <span className="w-20">إجراء</span>
          </div>
          {children}
        </div>
      </div>
    );
  };

  return (
    <div dir="rtl" className="space-y-4 pb-8">
      {/* Header */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-base font-black text-slate-800">لوحة تتبع المرضى — Patient Board</h1>
            <p className="text-xs text-slate-400">تحديث تلقائي كل 15 ثانية</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => navigate('/visual-triage')}
              className="flex items-center gap-1.5 px-3 py-2 bg-red-600 text-white rounded-xl text-xs font-black hover:bg-red-700"
            >
              <Plus className="w-3.5 h-3.5" /> مريض جديد
            </button>
            <button onClick={() => refetch()} className={`text-slate-400 hover:text-red-600 ${isFetching ? 'animate-spin' : ''}`}>
              <RefreshCw className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-2">
        <div className="bg-white rounded-xl border border-slate-200 px-2 py-2 text-center">
          <div className="text-xl font-black text-slate-800">{active.length}</div>
          <div className="text-xs text-slate-500">نشط</div>
        </div>
        <div className="bg-red-50 rounded-xl border border-red-200 px-2 py-2 text-center">
          <div className="text-xl font-black text-red-700">{resus.length}</div>
          <div className="text-xs text-red-500">🚨 إنعاش</div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 px-2 py-2 text-center">
          <div className="text-xl font-black text-slate-800">{avgWait}د</div>
          <div className="text-xs text-slate-500">متوسط</div>
        </div>
        <div className={`rounded-xl border px-2 py-2 text-center ${longestMins > 30 ? 'bg-red-50 border-red-300' : 'bg-white border-slate-200'}`}>
          <div className={`text-xl font-black ${longestMins > 30 ? 'text-red-700' : 'text-slate-800'}`}>{longestMins}د</div>
          <div className="text-xs text-slate-500">أطول</div>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute right-3 top-2.5 w-4 h-4 text-slate-400" />
        <input
          value={search} onChange={e => setSearch(e.target.value)}
          placeholder="بحث بالاسم أو ID..."
          className="w-full border border-slate-200 rounded-xl pr-9 pl-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-300"
          dir="rtl"
        />
      </div>

      {/* Resus */}
      {resus.length > 0 && (
        <Section title="🚨 إنعاش فعّال — Active Resus" count={resus.length} colorCls="bg-red-50 border-red-300">
          {resus.map(p => <PatientRow key={p.id} patient={p} onAction={handleAction} />)}
        </Section>
      )}

      {/* Awaiting Registration */}
      <Section title="⏳ في انتظار التسجيل — Awaiting Registration" count={awaiting.length + other.length} colorCls="bg-blue-50 border-blue-200">
        {[...awaiting, ...other].map(p => <PatientRow key={p.id} patient={p} onAction={handleAction} />)}
      </Section>

      {/* In Triage */}
      <Section title="🔵 قيد الفرز — In Triage" count={inTriage.length} colorCls="bg-teal-50 border-teal-200">
        {inTriage.map(p => <PatientRow key={p.id} patient={p} onAction={handleAction} />)}
      </Section>

      {/* Completed */}
      {completed.length > 0 && (
        <div className="rounded-2xl border border-green-200 bg-green-50 overflow-hidden">
          <button
            onClick={() => setShowCompleted(v => !v)}
            className="w-full px-4 py-2.5 flex items-center justify-between"
          >
            <span className="text-sm font-black text-slate-700">✅ مكتمل اليوم — Completed Today</span>
            <div className="flex items-center gap-2">
              <span className="text-xs bg-white border border-slate-200 text-slate-600 px-2 py-0.5 rounded-full font-bold">{completed.length} مريض</span>
              {showCompleted ? <ChevronUp className="w-4 h-4 text-slate-500" /> : <ChevronDown className="w-4 h-4 text-slate-500" />}
            </div>
          </button>
          {showCompleted && (
            <div className="bg-white divide-y divide-slate-100 border-t border-green-200">
              {completed.map(p => <PatientRow key={p.id} patient={p} onAction={handleAction} />)}
            </div>
          )}
        </div>
      )}

      {active.length === 0 && !isFetching && (
        <div className="bg-white rounded-2xl border border-dashed border-slate-300 py-16 text-center">
          <p className="text-2xl mb-2">🏥</p>
          <p className="text-slate-400 font-bold">لا يوجد مرضى نشطون حالياً</p>
          <p className="text-slate-300 text-sm mb-4">No active patients</p>
          <button onClick={() => navigate('/visual-triage')}
            className="px-4 py-2 bg-red-600 text-white rounded-xl font-bold text-sm hover:bg-red-700">
            + ابدأ فرز مريض جديد
          </button>
        </div>
      )}
    </div>
  );
}