import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

const DATE_RANGES = [
  { key: 'today',  ar: 'اليوم',       en: 'Today',      days: 0 },
  { key: 'week',   ar: 'هذا الأسبوع', en: 'This Week',  days: 7 },
  { key: 'month',  ar: 'هذا الشهر',   en: 'This Month', days: 30 },
];

function formatDate(d) {
  return d.toLocaleDateString('ar-SA', { month: 'short', day: 'numeric' });
}

export default function HistoricalTab() {
  const [range, setRange] = useState('week');

  const fromDate = useMemo(() => {
    const days = DATE_RANGES.find(r => r.key === range)?.days || 7;
    const d = new Date();
    if (days === 0) d.setHours(0, 0, 0, 0);
    else d.setDate(d.getDate() - days);
    return d.toISOString();
  }, [range]);

  const { data: records = [], isLoading } = useQuery({
    queryKey: ['triage-historical', fromDate],
    queryFn: () => base44.entities.TriageRecord.filter({ created_date: { $gte: fromDate } }),
  });

  const stats = useMemo(() => {
    if (!records.length) return null;
    const total = records.length;

    // Under/over triage rates (requires ai_ctas & nurse_ctas)
    const compared = records.filter(r => r.ai_ctas && r.nurse_ctas);
    const agreementPct = compared.length ? Math.round(compared.filter(r => r.agreement).length / compared.length * 100) : null;
    const underTriage = compared.filter(r => r.ai_ctas > r.nurse_ctas).length; // AI gave lower acuity
    const overTriage = compared.filter(r => r.ai_ctas < r.nurse_ctas).length;
    const underPct = compared.length ? (underTriage / compared.length * 100).toFixed(1) : null;
    const overPct = compared.length ? (overTriage / compared.length * 100).toFixed(1) : null;

    // Daily trend — avg triage time
    const byDay = {};
    records.forEach(r => {
      if (!r.arrival_time || !r.created_date) return;
      const day = formatDate(new Date(r.arrival_time));
      const dur = (new Date(r.created_date).getTime() - new Date(r.arrival_time).getTime()) / 60000;
      if (dur > 0 && dur < 120) {
        if (!byDay[day]) byDay[day] = { day, total: 0, dur: 0, count: 0 };
        byDay[day].dur += dur;
        byDay[day].count++;
        byDay[day].total++;
      }
    });
    const dailyTrend = Object.values(byDay).map(d => ({
      day: d.day,
      avg: d.count ? parseFloat((d.dur / d.count).toFixed(1)) : 0,
      count: d.total,
    }));

    // Top complaints
    const complaintCounts = {};
    records.forEach(r => {
      if (!r.chief_complaint) return;
      const key = r.chief_complaint.trim();
      complaintCounts[key] = (complaintCounts[key] || 0) + 1;
    });
    const topComplaints = Object.entries(complaintCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([c, n]) => ({ complaint: c, count: n, pct: Math.round(n / total * 100) }));

    return { total, compared: compared.length, agreementPct, underPct, overPct, dailyTrend, topComplaints };
  }, [records]);

  return (
    <div className="space-y-4">
      {/* Date Range Selector */}
      <div className="bg-white rounded-xl border border-slate-200 flex overflow-hidden">
        {DATE_RANGES.map(r => (
          <button key={r.key} onClick={() => setRange(r.key)}
            className={`flex-1 py-2 text-xs font-bold transition-colors ${range === r.key ? 'bg-teal-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`}
          >
            {r.ar} <span className="opacity-60">/ {r.en}</span>
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <div className="w-8 h-8 border-4 border-slate-200 border-t-teal-600 rounded-full animate-spin" />
        </div>
      ) : !records.length ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center">
          <p className="text-slate-500 text-sm">لا توجد بيانات في هذه الفترة — No data for this period</p>
        </div>
      ) : (
        <>
          {/* Triage Time Trend */}
          {stats.dailyTrend.length > 1 && (
            <div className="bg-white rounded-2xl border border-slate-200 p-4">
              <p className="text-xs font-black text-slate-600 uppercase tracking-wide mb-1">اتجاه أوقات الفرز — Triage Time Trend</p>
              <p className="text-xs text-slate-400 mb-3">متوسط وقت الفرز اليومي / Daily avg triage time (min)</p>
              <ResponsiveContainer width="100%" height={140}>
                <LineChart data={stats.dailyTrend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="day" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} width={25} />
                  <Tooltip formatter={(v) => [`${v} min`, 'Avg Time']} />
                  <Line type="monotone" dataKey="avg" stroke="#0F6E56" strokeWidth={2} dot={{ r: 3, fill: '#0F6E56' }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Classification Accuracy */}
          {stats.compared > 0 && (
            <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3">
              <p className="text-xs font-black text-slate-600 uppercase tracking-wide">دقة التصنيف — Classification Accuracy</p>
              <div className="grid grid-cols-1 gap-2">
                {[
                  { label_ar: 'الفرز الناقص / Under-triage rate', value: `${stats.underPct}%`, good: parseFloat(stats.underPct) < 5, target: '< 5%' },
                  { label_ar: 'الفرز الزائد / Over-triage rate',  value: `${stats.overPct}%`,  good: parseFloat(stats.overPct) < 15, target: '< 15%' },
                  { label_ar: 'معدل التطابق / Agreement rate',    value: `${stats.agreementPct}%`, good: stats.agreementPct >= 85, target: '≥ 85%' },
                ].map((m, i) => (
                  <div key={i} className={`flex items-center justify-between px-3 py-2.5 rounded-xl ${m.good ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}`}>
                    <div>
                      <p className="text-xs font-bold text-slate-700">{m.label_ar}</p>
                      <p className="text-xs text-slate-400">هدف / Target: {m.target}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`text-base font-black ${m.good ? 'text-green-700' : 'text-red-600'}`}>{m.value}</span>
                      <span>{m.good ? '✅' : '⚠'}</span>
                    </div>
                  </div>
                ))}
              </div>
              <p className="text-xs text-slate-400 text-center">بناءً على {stats.compared} حالة مقارنة / Based on {stats.compared} compared cases</p>
            </div>
          )}

          {/* Top Complaints */}
          {stats.topComplaints.length > 0 && (
            <div className="bg-white rounded-2xl border border-slate-200 p-4">
              <p className="text-xs font-black text-slate-600 uppercase tracking-wide mb-3">أكثر الشكاوى شيوعاً — Top Complaints</p>
              <div className="space-y-2">
                {stats.topComplaints.map((c, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="text-xs text-slate-400 w-4 shrink-0">{i + 1}.</span>
                    <span className="text-xs text-slate-700 flex-1 truncate">{c.complaint}</span>
                    <div className="w-24 h-3 bg-slate-100 rounded-full overflow-hidden">
                      <div className="h-full bg-teal-500 rounded-full" style={{ width: `${c.pct}%` }} />
                    </div>
                    <span className="text-xs font-bold text-slate-600 w-8 text-right">{c.pct}%</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Summary */}
          <div className="bg-slate-50 rounded-xl border border-slate-200 px-4 py-3">
            <p className="text-xs text-slate-500 text-center">إجمالي الحالات في الفترة / Total cases in period: <span className="font-black text-slate-800">{stats.total}</span></p>
          </div>
        </>
      )}
    </div>
  );
}