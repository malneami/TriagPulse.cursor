import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { ChevronDown, X, Plus } from 'lucide-react';

function waitMins(iso) {
  if (!iso) return null;
  return Math.round((Date.now() - new Date(iso).getTime()) / 60000);
}

export default function PatientSelectorStrip({ currentPid, onSwitch }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [patients, setPatients] = useState([]);

  useEffect(() => {
    base44.entities.PatientJourney.list('-arrival_time', 100).then(all => {
      const cutoff = Date.now() - 12 * 60 * 60 * 1000;
      setPatients(all.filter(p =>
        new Date(p.arrival_time).getTime() > cutoff &&
        ['ctas_pending', 'ctas_in_progress', 'registration'].includes(p.current_status)
      ));
    });
  }, [currentPid]);

  const current = patients.find(p => p.patient_id === currentPid);
  const others = patients.filter(p => p.patient_id !== currentPid);

  const displayName = (p) => {
    if (!p) return 'مجهول / Unknown';
    const name = p.patient_name_ar || p.patient_name_en;
    return name || 'مجهول / Unknown';
  };

  return (
    <div className="relative mb-4">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full bg-slate-800 text-white rounded-xl px-4 py-2.5 flex items-center justify-between gap-2"
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-slate-400 text-xs shrink-0">المريض الحالي:</span>
          <span className="text-sm font-black truncate">
            {currentPid ? `${displayName(current)} — ${currentPid}` : 'لم يتم اختيار مريض'}
          </span>
          {current?.age && <span className="text-slate-300 text-xs shrink-0">{current.age} سنة</span>}
          {current?.vt_destination_ar && <span className="text-slate-400 text-xs shrink-0 hidden sm:block">— {current.vt_destination_ar}</span>}
        </div>
        <ChevronDown className={`w-4 h-4 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute top-full right-0 left-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-xl z-50 overflow-hidden">
          <div className="px-4 py-2 border-b border-slate-100 flex items-center justify-between">
            <span className="text-xs font-black text-slate-600">اختر مريضاً — Select Patient</span>
            <button onClick={() => setOpen(false)}><X className="w-4 h-4 text-slate-400" /></button>
          </div>

          {current && (
            <div className="px-4 py-2.5 bg-teal-50 border-b border-teal-100 flex items-center justify-between">
              <div>
                <span className="text-sm font-black text-teal-800">{displayName(current)}</span>
                <span className="text-xs text-teal-600 mr-2">{currentPid}</span>
                {current.age && <span className="text-xs text-teal-500">{current.age} سنة</span>}
              </div>
              <span className="text-xs bg-teal-600 text-white px-2 py-0.5 rounded-full font-bold">جارٍ / Current</span>
            </div>
          )}

          {others.map(p => {
            const wm = waitMins(p.arrival_time);
            return (
              <button
                key={p.id}
                onClick={() => { setOpen(false); onSwitch(p.patient_id); }}
                className="w-full px-4 py-2.5 flex items-center justify-between hover:bg-slate-50 border-b border-slate-100 last:border-0"
              >
                <div className="text-right">
                  <span className="text-sm font-bold text-slate-700">{displayName(p)}</span>
                  <span className="text-xs text-slate-400 mr-2">{p.patient_id}</span>
                  {p.age && <span className="text-xs text-slate-400">{p.age} سنة</span>}
                </div>
                <span className="text-xs text-slate-500">
                  {wm != null ? `${wm} د` : '—'}
                </span>
              </button>
            );
          })}

          {others.length === 0 && !current && (
            <div className="px-4 py-4 text-center text-xs text-slate-400">لا يوجد مرضى في انتظار الفرز</div>
          )}

          <button
            onClick={() => { setOpen(false); navigate('/visual-triage'); }}
            className="w-full px-4 py-2.5 flex items-center gap-2 text-xs font-black text-red-600 hover:bg-red-50 border-t border-slate-100"
          >
            <Plus className="w-3.5 h-3.5" /> مريض جديد / New Patient
          </button>
        </div>
      )}
    </div>
  );
}