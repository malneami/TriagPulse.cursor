import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip } from 'recharts';
import { AlertTriangle } from 'lucide-react';

const CTAS_CFG = {
  1: { hex: '#E24B4A', ar: 'إنعاش',      en: 'Resuscitation', target: 0 },
  2: { hex: '#EF9F27', ar: 'طارئ',        en: 'Emergent',      target: 15 },
  3: { hex: '#0F6E56', ar: 'عاجل',        en: 'Urgent',        target: 30 },
  4: { hex: '#378ADD', ar: 'أقل إلحاحاً', en: 'Less Urgent',   target: 60 },
  5: { hex: '#888780', ar: 'غير عاجل',    en: 'Non-Urgent',    target: 120 },
};

const FIELDS = [
  { key: 'patient_name_ar', label_ar: 'الاسم', label_en: 'Name',      check: r => !!(r.patient_name_ar || r.patient_name_en) },
  { key: 'age',             label_ar: 'العمر', label_en: 'Age',       check: r => r.age != null },
  { key: 'chief_complaint', label_ar: 'الشكوى', label_en: 'Complaint', check: r => !!r.chief_complaint },
  { key: 'pain_score',      label_ar: 'الألم', label_en: 'Pain Score', check: r => r.pain_score != null },
  { key: 'hr',              label_ar: 'النبض', label_en: 'HR',        check: r => r.hr != null },
  { key: 'bp_systolic',     label_ar: 'الضغط', label_en: 'BP',        check: r => r.bp_systolic != null },
  { key: 'spo2',            label_ar: 'الأكسجين', label_en: 'SpO₂',   check: r => r.spo2 != null },
  { key: 'rr',              label_ar: 'التنفس', label_en: 'RR',       check: r => r.rr != null },
  { key: 'temperature',     label_ar: 'الحرارة', label_en: 'Temp',    check: r => r.temperature != null },
  { key: 'gcs',             label_ar: 'GCS',    label_en: 'GCS',      check: r => r.gcs != null },
];

function MetricCard({ title_ar, title_en, value, sub = null, color = 'text-slate-800', alert = false }) {
  return (
    <div className={`bg-white rounded-xl border p-3 text-center ${alert ? 'border-red-200 bg-red-50' : 'border-slate-200'}`}>
      <p className="text-xs font-black text-slate-500 mb-0.5">{title_ar}</p>
      <p className="text-xs text-slate-400 mb-1">{title_en}</p>
      <p className={`text-2xl font-black ${color}`}>{value}</p>
      {sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
    </div>
  );
}

export default function ShiftTab() {
  const shiftStart = useMemo(() => new Date(Date.now() - 8 * 60 * 60 * 1000).toISOString(), []);

  const { data: records = [], isLoading } = useQuery({
    queryKey: ['triage-shift', shiftStart],
    queryFn: () => base44.entities.TriageRecord.filter({ arrival_time: { $gte: shiftStart } }),
    refetchInterval: 30000,
  });

  const stats = useMemo(() => {
    if (!records.length) return null;
    const total = records.length;
    const resusCases = records.filter(r => r.ctas_level === 1).length;

    // Avg triage time (arrival_time → created_date)
    const durationsMin = records
      .filter(r => r.arrival_time && r.created_date)
      .map(r => (new Date(r.created_date).getTime() - new Date(r.arrival_time).getTime()) / 60000)
      .filter(d => d > 0 && d < 120);
    const avgTime = durationsMin.length ? (durationsMin.reduce((a, b) => a + b, 0) / durationsMin.length).toFixed(1) : '--';

    // Data completeness
    const completeness = Math.round(
      records.reduce((sum, r) => sum + FIELDS.filter(f => f.check(r)).length / FIELDS.length, 0) / total * 100
    );

    // CTAS distribution
    const ctasDist = [1, 2, 3, 4, 5].map(l => ({
      level: l, count: records.filter(r => r.ctas_level === l).length,
      cfg: CTAS_CFG[l],
    }));

    // Avg wait per level
    const ctasTimes = [1, 2, 3, 4, 5].map(l => {
      const recs = records.filter(r => r.ctas_level === l && r.arrival_time && r.created_date);
      const avg = recs.length
        ? recs.reduce((s, r) => s + (new Date(r.created_date).getTime() - new Date(r.arrival_time).getTime()) / 60000, 0) / recs.length
        : null;
      return { level: l, avg: avg ? avg.toFixed(1) : '--', target: CTAS_CFG[l].target, cfg: CTAS_CFG[l] };
    });

    // Field completion
    const fieldComp = FIELDS.map(f => ({
      ...f, pct: Math.round(records.filter(f.check).length / total * 100),
    }));

    // Hourly flow
    const hourCounts = {};
    records.forEach(r => {
      if (!r.arrival_time) return;
      const h = new Date(r.arrival_time).getHours();
      if (!hourCounts[h]) hourCounts[h] = { hour: `${h}:00`, counts: [0, 0, 0, 0, 0] };
      hourCounts[h].counts[(r.ctas_level || 3) - 1]++;
    });
    const hourlyFlow = Object.values(hourCounts).sort((a, b) => parseInt(a.hour) - parseInt(b.hour));

    // Quality alerts
    const alerts = [];
    if (completeness < 85) alerts.push({ level: 'warn', text_ar: `اكتمال البيانات ${completeness}% — أقل من الهدف 85%`, text_en: `Data completeness ${completeness}% — below 85% target` });
    const gcsComp = fieldComp.find(f => f.key === 'gcs');
    if (gcsComp && gcsComp.pct < 80) alerts.push({ level: 'warn', text_ar: `معدل اكتمال GCS ${gcsComp.pct}% — أقل من الهدف 80%`, text_en: `GCS completion ${gcsComp.pct}% — below 80% target` });
    if (resusCases >= 3) alerts.push({ level: 'crit', text_ar: `${resusCases} حالات إنعاش في هذه الوردية`, text_en: `${resusCases} resuscitation cases this shift` });

    return { total, resusCases, avgTime, completeness, ctasDist, ctasTimes, fieldComp, hourlyFlow, alerts };
  }, [records]);

  if (isLoading) return (
    <div className="flex items-center justify-center py-16">
      <div className="w-8 h-8 border-4 border-slate-200 border-t-teal-600 rounded-full animate-spin" />
    </div>
  );

  if (!records.length) return (
    <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center">
      <p className="text-slate-500 text-sm">لا توجد حالات في الوردية الحالية — No cases in current shift</p>
    </div>
  );

  return (
    <div className="space-y-4">
      {/* Quality Alerts */}
      {stats.alerts.length > 0 && (
        <div className="space-y-2">
          {stats.alerts.map((a, i) => (
            <div key={i} className={`flex items-start gap-3 px-4 py-3 rounded-xl border ${a.level === 'crit' ? 'bg-red-50 border-red-200' : 'bg-amber-50 border-amber-200'}`}>
              <AlertTriangle className={`w-4 h-4 shrink-0 mt-0.5 ${a.level === 'crit' ? 'text-red-600' : 'text-amber-600'}`} />
              <div>
                <p className={`text-xs font-black ${a.level === 'crit' ? 'text-red-800' : 'text-amber-800'}`}>{a.text_ar}</p>
                <p className="text-xs text-slate-500">{a.text_en}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-2 gap-3">
        <MetricCard title_ar="إجمالي المرضى" title_en="Total Patients" value={stats.total} />
        <MetricCard title_ar="متوسط وقت الفرز" title_en="Avg Triage Time" value={`${stats.avgTime} min`} />
        <MetricCard title_ar="حالات الإنعاش" title_en="Resus Cases" value={stats.resusCases} color={stats.resusCases > 0 ? 'text-red-600' : 'text-slate-800'} alert={stats.resusCases >= 3} />
        <MetricCard title_ar="اكتمال البيانات" title_en="Data Completeness" value={`${stats.completeness}%`} color={stats.completeness >= 90 ? 'text-green-700' : stats.completeness >= 80 ? 'text-amber-600' : 'text-red-600'} />
      </div>

      {/* CTAS Distribution */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4">
        <p className="text-xs font-black text-slate-600 uppercase tracking-wide mb-3">توزيع مستويات CTAS — CTAS Distribution</p>
        <div className="space-y-2">
          {stats.ctasDist.map(({ level, count, cfg }) => {
            const pct = stats.total ? Math.round(count / stats.total * 100) : 0;
            return (
              <div key={level} className="flex items-center gap-2">
                <span className="w-6 h-6 rounded-lg flex items-center justify-center font-black text-xs text-white shrink-0" style={{ backgroundColor: cfg.hex }}>{level}</span>
                <div className="flex-1">
                  <div className="h-5 bg-slate-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full transition-all duration-700" style={{ width: `${pct}%`, backgroundColor: cfg.hex }} />
                  </div>
                </div>
                <span className="text-xs font-bold text-slate-700 w-16 shrink-0">{count} ({pct}%)</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Triage Time Performance */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4">
        <p className="text-xs font-black text-slate-600 uppercase tracking-wide mb-3">أوقات الفرز — Triage Time Performance</p>
        <div className="space-y-2">
          {stats.ctasTimes.map(({ level, avg, target, cfg }) => {
            const numAvg = parseFloat(avg);
            const ok = isNaN(numAvg) || numAvg <= target;
            return (
              <div key={level} className="flex items-center gap-2 text-xs">
                <span className="w-5 h-5 rounded flex items-center justify-center font-black text-white shrink-0" style={{ backgroundColor: cfg.hex }}>{level}</span>
                <span className="flex-1 text-slate-700 font-medium">{cfg.ar}</span>
                <span className="text-slate-400 w-14 text-right">{target} min</span>
                <span className={`font-bold w-14 text-right ${ok ? 'text-green-700' : 'text-red-600'}`}>{avg} min</span>
                <span className={`w-5 shrink-0 text-center ${ok ? 'text-green-500' : 'text-red-500'}`}>{avg === '--' ? '—' : ok ? '✅' : '⚠'}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Field Completion */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4">
        <p className="text-xs font-black text-slate-600 uppercase tracking-wide mb-3">اكتمال الحقول — Field Completion Rate</p>
        <div className="space-y-2">
          {stats.fieldComp.map(f => (
            <div key={f.key} className="flex items-center gap-2">
              <span className="text-xs text-slate-600 w-28 shrink-0">{f.label_ar} / {f.label_en}</span>
              <div className="flex-1 h-3 bg-slate-100 rounded-full overflow-hidden">
                <div className="h-full rounded-full transition-all duration-700" style={{ width: `${f.pct}%`, backgroundColor: f.pct >= 90 ? '#0F6E56' : f.pct >= 80 ? '#EF9F27' : '#E24B4A' }} />
              </div>
              <span className={`text-xs font-bold w-10 text-right ${f.pct >= 80 ? 'text-green-700' : 'text-red-600'}`}>{f.pct}%</span>
              <span className="text-xs w-4 shrink-0">{f.pct >= 80 ? '✅' : '🔴'}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Hourly Flow */}
      {stats.hourlyFlow.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-200 p-4">
          <p className="text-xs font-black text-slate-600 uppercase tracking-wide mb-3">تدفق المرضى — Patient Flow Timeline</p>
          <ResponsiveContainer width="100%" height={120}>
            <BarChart data={stats.hourlyFlow.map(h => ({ hour: h.hour, total: h.counts.reduce((a, b) => a + b, 0) }))}>
              <XAxis dataKey="hour" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} width={20} />
              <Tooltip />
              <Bar dataKey="total" fill="#0F6E56" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}