import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { AlertTriangle, Clock, CheckCircle2 } from 'lucide-react';

function fmtTime(value) {
  if (!value) return '—';
  return new Date(value).toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' });
}

export default function CriticalAlertsTab() {
  const { data: records = [], isLoading } = useQuery({
    queryKey: ['critical-alerts-dashboard'],
    queryFn: () => base44.entities.TriageRecord.list('-created_date', 300),
  });

  const stats = useMemo(() => {
    const alerts = records.filter((r) => r.alert_triggered || r.alert_triggered_at || (r.red_flags && String(r.red_flags).trim()));
    const acknowledged = alerts.filter((r) => r.alert_acknowledged_at);
    const avgResponse = acknowledged.length
      ? Math.round(acknowledged.reduce((sum, r) => sum + (Number(r.alert_response_sec) || 0), 0) / acknowledged.length)
      : null;
    return { alerts, acknowledged, avgResponse };
  }, [records]);

  if (isLoading) return <div className="flex justify-center py-16"><div className="w-8 h-8 border-4 border-slate-200 border-t-red-600 rounded-full animate-spin" /></div>;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-white rounded-2xl border border-slate-200 p-4">
          <p className="text-xs text-slate-500">Critical alerts</p>
          <p className="text-2xl font-black text-red-600">{stats.alerts.length}</p>
        </div>
        <div className="bg-white rounded-2xl border border-slate-200 p-4">
          <p className="text-xs text-slate-500">Acknowledged</p>
          <p className="text-2xl font-black text-teal-700">{stats.acknowledged.length}</p>
        </div>
        <div className="bg-white rounded-2xl border border-slate-200 p-4">
          <p className="text-xs text-slate-500">Avg response</p>
          <p className="text-2xl font-black text-slate-800">{stats.avgResponse ?? '—'}<span className="text-xs text-slate-400"> sec</span></p>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100">
          <p className="text-xs font-black text-slate-600">سجل التنبيهات الحرجة — Critical Alert Log</p>
          <p className="text-xs text-slate-400">Shows red flags, acknowledgement, and response time.</p>
        </div>
        {stats.alerts.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">No critical alerts recorded yet.</div>
        ) : (
          <div className="divide-y divide-slate-100">
            {stats.alerts.slice(0, 50).map((r) => (
              <div key={r.id || `${r.created_date}-${r.patient_name_ar}`} className="px-4 py-3 flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-black text-slate-800">{r.patient_name_ar || r.patient_name_en || r.patient_id || 'Unknown patient'}</p>
                    <span className="text-xs bg-red-50 text-red-700 border border-red-200 rounded-full px-2 py-0.5">CTAS {r.ctas_level || r.clinician_final_ctas || '—'}</span>
                    {r.alert_acknowledged_at ? (
                      <span className="text-xs bg-teal-50 text-teal-700 border border-teal-200 rounded-full px-2 py-0.5 flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> acknowledged</span>
                    ) : (
                      <span className="text-xs bg-amber-50 text-amber-700 border border-amber-200 rounded-full px-2 py-0.5">pending ack</span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 mt-1">{r.red_flags || r.alert_summary || 'Critical alert'}</p>
                  <div className="flex items-center gap-3 text-xs text-slate-400 mt-1">
                    <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> Triggered: {fmtTime(r.alert_triggered_at)}</span>
                    <span>Ack: {fmtTime(r.alert_acknowledged_at)}</span>
                    <span>Response: {r.alert_response_sec ?? '—'} sec</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
