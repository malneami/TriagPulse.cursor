import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import { Search, ChevronDown, ChevronUp } from 'lucide-react';

const CTAS_STYLES = {
  1: { bg: 'bg-red-600', text: 'text-white' },
  2: { bg: 'bg-orange-500', text: 'text-white' },
  3: { bg: 'bg-green-500', text: 'text-white' },
  4: { bg: 'bg-blue-500', text: 'text-white' },
  5: { bg: 'bg-slate-400', text: 'text-white' },
};

function RecordCard({ record }) {
  const [expanded, setExpanded] = useState(false);
  const style = CTAS_STYLES[record.ctas_level] || CTAS_STYLES[3];

  const isCritical = record.ctas_level === 1 || record.ctas_level === 2;

  return (
    <div className={`rounded-xl border overflow-hidden shadow-sm ${
      isCritical
        ? 'border-red-400 ring-2 ring-red-300 bg-red-50'
        : 'bg-white border-slate-200'
    }`}>
      <button
        onClick={() => setExpanded(!expanded)}
        className={`w-full flex items-center gap-3 p-3 text-right ${isCritical ? 'hover:bg-red-100' : 'hover:bg-slate-50'}`}
      >
        {/* CTAS Badge */}
        <div className={`${style.bg} ${style.text} w-12 h-12 rounded-xl flex flex-col items-center justify-center shrink-0`}>
          <span className="text-xl font-black leading-none">{record.ctas_level}</span>
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-bold text-slate-800 text-sm truncate">
              {record.patient_name_ar || record.patient_name_en || 'مريض غير محدد'}
            </span>
            {record.mrn && <span className="text-xs text-slate-400 shrink-0">#{record.mrn}</span>}
          </div>
          <div className="text-xs text-slate-500 mt-0.5">
            {record.chief_complaint && <span className="ml-2">{record.chief_complaint}</span>}
            {record.age && <span>· {record.age}ع</span>}
            {record.gender && <span> · {record.gender === 'male' ? 'ذكر' : 'أنثى'}</span>}
          </div>
          <div className="text-xs text-slate-400 mt-0.5">
            {record.nurse_name && <span>{record.nurse_name} · </span>}
            {record.arrival_time && new Date(record.arrival_time).toLocaleString('ar-SA', { dateStyle: 'short', timeStyle: 'short' })}
          </div>
        </div>

        <div className="shrink-0 text-slate-400">
          {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </div>
      </button>

      {expanded && (
        <div className="border-t border-slate-100 p-4 space-y-3 bg-slate-50">
          {/* Vitals */}
          <div className="grid grid-cols-3 gap-2 text-xs">
            {[
              ['HR', record.hr, 'bpm'],
              ['BP', record.bp_systolic && record.bp_diastolic ? `${record.bp_systolic}/${record.bp_diastolic}` : null, 'mmHg'],
              ['SpO₂', record.spo2, '%'],
              ['RR', record.rr, '/min'],
              ['Temp', record.temperature, '°C'],
              ['GCS', record.gcs, '/15'],
            ].map(([label, val, unit]) => (
              <div key={label} className="bg-white rounded-lg p-2 border border-slate-200 text-center">
                <div className="text-slate-500 text-xs">{label}</div>
                <div className={`font-bold text-sm ${val ? 'text-slate-800' : 'text-slate-300'}`}>
                  {val != null ? `${val} ${unit}` : '—'}
                </div>
              </div>
            ))}
          </div>

          {record.pain_score != null && (
            <div className="text-sm">
              <span className="text-slate-500">الألم: </span>
              <span className="font-bold text-slate-800">{record.pain_score}/10</span>
            </div>
          )}

          {record.clinical_summary_ar && (
            <div className="bg-white rounded-xl p-3 border border-slate-200">
              <p className="text-xs font-bold text-slate-500 mb-1">الملخص السريري</p>
              <p className="text-sm text-slate-700 leading-loose">{record.clinical_summary_ar}</p>
            </div>
          )}

          {record.red_flags && (
            <div className="bg-red-50 rounded-xl p-3 border border-red-200">
              <p className="text-xs font-bold text-red-600 mb-1">⚠️ تنبيهات حمراء</p>
              <p className="text-sm text-red-700">{record.red_flags}</p>
            </div>
          )}

          {record.disposition && (
            <div className="text-sm">
              <span className="text-slate-500">التصرف: </span>
              <span className="font-medium text-slate-800">{record.disposition}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function TriageLog() {
  const { user } = useAuth();
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterLevel, setFilterLevel] = useState('');

  useEffect(() => {
    loadRecords();
  }, []);

  const loadRecords = async () => {
    setLoading(true);
    const isAdmin = user?.role === 'admin';
    let data;
    if (isAdmin) {
      data = await base44.entities.TriageRecord.list('-arrival_time', 100);
    } else {
      data = await base44.entities.TriageRecord.filter({ created_by_id: user?.id }, '-arrival_time', 100);
    }
    setRecords(data);
    setLoading(false);
  };

  const filtered = records.filter(r => {
    const matchSearch = !search ||
      (r.patient_name_ar || '').includes(search) ||
      (r.patient_name_en || '').toLowerCase().includes(search.toLowerCase()) ||
      (r.mrn || '').includes(search) ||
      (r.chief_complaint || '').includes(search);
    const matchLevel = !filterLevel || r.ctas_level === parseInt(filterLevel);
    return matchSearch && matchLevel;
  });

  const counts = [1, 2, 3, 4, 5].map(l => ({
    level: l,
    count: records.filter(r => r.ctas_level === l).length,
    style: CTAS_STYLES[l],
  }));

  return (
    <div dir="rtl" className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-800">سجل الفرز</h2>
          <p className="text-sm text-slate-500">Triage Log · {records.length} حالة</p>
        </div>
      </div>

      {/* Level Summary */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {counts.map(({ level, count, style }) => (
          <button
            key={level}
            onClick={() => setFilterLevel(filterLevel === String(level) ? '' : String(level))}
            className={`shrink-0 flex flex-col items-center px-4 py-2 rounded-xl border-2 transition-all ${
              filterLevel === String(level)
                ? `${style.bg} ${style.text} border-transparent shadow`
                : 'bg-white border-slate-200 text-slate-700'
            }`}
          >
            <span className="font-black text-lg">{level}</span>
            <span className="text-xs">{count}</span>
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="بحث بالاسم أو رقم الملف أو الشكوى..."
          className="w-full border border-slate-200 rounded-xl pr-9 pl-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400"
        />
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16 text-slate-400">
          <div className="w-8 h-8 border-4 border-slate-200 border-t-teal-600 rounded-full animate-spin"></div>
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-slate-400">
          <p className="text-lg">لا توجد سجلات</p>
          <p className="text-sm">No records found</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(r => <RecordCard key={r.id} record={r} />)}
        </div>
      )}
    </div>
  );
}