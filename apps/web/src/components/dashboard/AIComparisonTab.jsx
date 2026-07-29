import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';

const CTAS_CFG = {
  1: { hex: '#E24B4A', ar: 'إنعاش' },
  2: { hex: '#EF9F27', ar: 'طارئ' },
  3: { hex: '#0F6E56', ar: 'عاجل' },
  4: { hex: '#378ADD', ar: 'أقل إلحاح' },
  5: { hex: '#888780', ar: 'غير عاجل' },
};

function DisagreementCard({ record }) {
  const [open, setOpen] = useState(false);
  const diff = record.nurse_ctas - record.ai_ctas;
  const dir = diff > 0 ? '▲' : '▼';
  const color = Math.abs(diff) >= 2 ? 'text-red-600' : 'text-amber-600';
  const time = record.arrival_time ? new Date(record.arrival_time).toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' }) : '--';

  return (
    <div className="border border-slate-200 rounded-xl overflow-hidden">
      <button onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-2 px-3 py-2.5 hover:bg-slate-50 text-right"
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-slate-400">{time}</span>
            <span className="text-xs font-medium text-slate-700 truncate">{record.chief_complaint || 'غير محدد'}</span>
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-xs font-bold" style={{ color: CTAS_CFG[record.ai_ctas]?.hex }}>AI: C{record.ai_ctas}</span>
            <span className="text-xs text-slate-400">→</span>
            <span className="text-xs font-bold" style={{ color: CTAS_CFG[record.nurse_ctas]?.hex }}>Nurse: C{record.nurse_ctas}</span>
            <span className={`text-xs font-black ${color}`}>{dir}{Math.abs(diff)}</span>
          </div>
        </div>
        {open ? <ChevronUp className="w-4 h-4 text-slate-400 shrink-0" /> : <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />}
      </button>
      {open && (
        <div className="border-t border-slate-100 px-3 py-3 bg-slate-50 space-y-2">
          {record.override_reason && (
            <p className="text-xs text-slate-700"><span className="font-black">السبب / Reason: </span>{record.override_reason}</p>
          )}
          <div className="grid grid-cols-3 gap-2 text-xs">
            {record.hr && <span className="bg-white rounded-lg px-2 py-1 border border-slate-200">HR: {record.hr}</span>}
            {record.spo2 && <span className="bg-white rounded-lg px-2 py-1 border border-slate-200">SpO₂: {record.spo2}%</span>}
            {record.bp_systolic && <span className="bg-white rounded-lg px-2 py-1 border border-slate-200">BP: {record.bp_systolic}/{record.bp_diastolic}</span>}
            {record.gcs && <span className="bg-white rounded-lg px-2 py-1 border border-slate-200">GCS: {record.gcs}</span>}
            {record.temperature && <span className="bg-white rounded-lg px-2 py-1 border border-slate-200">Temp: {record.temperature}°C</span>}
            {record.age && <span className="bg-white rounded-lg px-2 py-1 border border-slate-200">Age: {record.age}y</span>}
          </div>
          {record.clinical_summary_ar && (
            <p className="text-xs text-slate-500 italic">{record.clinical_summary_ar.slice(0, 150)}...</p>
          )}
        </div>
      )}
    </div>
  );
}

export default function AIComparisonTab() {
  const { data: records = [], isLoading } = useQuery({
    queryKey: ['triage-ai-comparison'],
    queryFn: () => base44.entities.TriageRecord.list('-created_date', 500),
  });

  const stats = useMemo(() => {
    const compared = records.filter(r => r.ai_ctas && r.nurse_ctas);
    if (!compared.length) return null;

    const total = compared.length;
    const exact = compared.filter(r => r.ai_ctas === r.nurse_ctas).length;
    const oneDiff = compared.filter(r => Math.abs(r.ai_ctas - r.nurse_ctas) === 1).length;
    const twoDiff = compared.filter(r => Math.abs(r.ai_ctas - r.nurse_ctas) === 2).length;
    const threePlus = compared.filter(r => Math.abs(r.ai_ctas - r.nurse_ctas) >= 3).length;
    const underTriage = compared.filter(r => r.ai_ctas > r.nurse_ctas).length;
    const overTriage = compared.filter(r => r.ai_ctas < r.nurse_ctas).length;

    // Confusion matrix 5x5
    const matrix = Array.from({ length: 5 }, () => Array(5).fill(0));
    compared.forEach(r => {
      const ai = r.ai_ctas - 1;
      const nurse = r.nurse_ctas - 1;
      if (ai >= 0 && ai < 5 && nurse >= 0 && nurse < 5) matrix[ai][nurse]++;
    });

    // Recent disagreements
    const disagreements = compared
      .filter(r => r.ai_ctas !== r.nurse_ctas)
      .sort((a, b) => new Date(b.created_date).getTime() - new Date(a.created_date).getTime())
      .slice(0, 10);

    // Override reason patterns
    const reasonCounts = {};
    compared.filter(r => r.override_reason).forEach(r => {
      reasonCounts[r.override_reason] = (reasonCounts[r.override_reason] || 0) + 1;
    });
    const topReasons = Object.entries(reasonCounts).sort((a, b) => b[1] - a[1]).slice(0, 5);

    return { total, exact, oneDiff, twoDiff, threePlus, underTriage, overTriage, matrix, disagreements, topReasons };
  }, [records]);

  if (isLoading) return (
    <div className="flex items-center justify-center py-16">
      <div className="w-8 h-8 border-4 border-slate-200 border-t-teal-600 rounded-full animate-spin" />
    </div>
  );

  if (!stats) return (
    <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center space-y-2">
      <p className="text-slate-500 text-sm font-medium">لا توجد بيانات مقارنة بعد</p>
      <p className="text-slate-400 text-xs">Comparison data appears after nurses validate AI assessments</p>
      <p className="text-xs text-slate-400 mt-2">تظهر البيانات بعد تأكيد الممرضين لتقييمات الذكاء الاصطناعي</p>
    </div>
  );

  const pct = (n) => `${(n / stats.total * 100).toFixed(1)}%`;

  return (
    <div className="space-y-4">
      {/* Summary Metrics */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3">
        <p className="text-xs font-black text-slate-600 uppercase tracking-wide">مقارنة AI مقابل الممرض — AI vs Nurse CTAS Comparison</p>
        <p className="text-xs text-slate-400 mb-2">إجمالي الحالات المقارنة / Total cases compared: <span className="font-black text-slate-800">{stats.total}</span></p>
        <div className="space-y-2">
          {[
            { label: 'تطابق تام / Exact match',         value: stats.exact,    pctVal: pct(stats.exact),    good: true },
            { label: 'فارق مستوى واحد / One level diff', value: stats.oneDiff,  pctVal: pct(stats.oneDiff),  good: stats.oneDiff / stats.total < 0.15 },
            { label: 'فارق مستويين / Two level diff',    value: stats.twoDiff,  pctVal: pct(stats.twoDiff),  good: stats.twoDiff / stats.total < 0.05 },
            { label: 'فارق ثلاثة+ / Three+ level diff',  value: stats.threePlus, pctVal: pct(stats.threePlus), good: stats.threePlus === 0 },
          ].map((m, i) => (
            <div key={i} className="flex items-center justify-between py-1 border-b border-slate-100 last:border-0">
              <span className="text-xs text-slate-700">{m.label}</span>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-slate-800">{m.value}</span>
                <span className={`text-xs font-bold ${m.good ? 'text-green-700' : 'text-red-600'}`}>({m.pctVal})</span>
                <span className="text-xs">{m.good ? '✅' : '🔴'}</span>
              </div>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2 pt-1">
          <div className="bg-red-50 rounded-xl px-3 py-2 border border-red-100">
            <p className="text-xs text-red-600 font-black">فرز ناقص AI / AI under-triage</p>
            <p className="text-lg font-black text-red-700">{stats.underTriage} <span className="text-xs font-normal">({pct(stats.underTriage)})</span></p>
          </div>
          <div className="bg-amber-50 rounded-xl px-3 py-2 border border-amber-100">
            <p className="text-xs text-amber-600 font-black">فرز زائد AI / AI over-triage</p>
            <p className="text-lg font-black text-amber-700">{stats.overTriage} <span className="text-xs font-normal">({pct(stats.overTriage)})</span></p>
          </div>
        </div>
      </div>

      {/* Confusion Matrix */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4">
        <p className="text-xs font-black text-slate-600 uppercase tracking-wide mb-1">مصفوفة الاتفاق — Agreement Matrix</p>
        <p className="text-xs text-slate-400 mb-3">AI (↓) vs Nurse (→)</p>
        <div className="overflow-x-auto">
          <table className="w-full text-center text-xs">
            <thead>
              <tr>
                <th className="w-8 py-1"></th>
                {[1, 2, 3, 4, 5].map(l => (
                  <th key={l} className="py-1 font-black" style={{ color: CTAS_CFG[l].hex }}>C{l}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {stats.matrix.map((row, ai) => (
                <tr key={ai}>
                  <td className="font-black py-1.5 pr-1" style={{ color: CTAS_CFG[ai + 1].hex }}>C{ai + 1}</td>
                  {row.map((val, nurse) => {
                    const isDiag = ai === nurse;
                    const isDanger = !isDiag && val > 0 && ai > nurse; // AI under-triaged
                    return (
                      <td key={nurse}
                        className={`py-1.5 rounded font-bold ${val === 0 ? 'text-slate-200' : isDiag ? 'text-green-700 bg-green-50' : isDanger ? 'text-red-700 bg-red-50' : 'text-amber-700 bg-amber-50'}`}
                      >
                        {val || '·'}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-slate-400 mt-2">🟢 diagonal = match · 🔴 = AI under-triage · 🟡 = AI over-triage</p>
      </div>

      {/* Recent Disagreements */}
      {stats.disagreements.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3">
          <p className="text-xs font-black text-slate-600 uppercase tracking-wide">حالات الاختلاف الأخيرة — Recent Disagreements</p>
          <div className="space-y-2">
            {stats.disagreements.map(r => (
              <DisagreementCard key={r.id} record={r} />
            ))}
          </div>
        </div>
      )}

      {/* Override Reason Patterns */}
      {stats.topReasons.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3">
          <p className="text-xs font-black text-slate-600 uppercase tracking-wide">أنماط أسباب التغيير — Override Reason Patterns</p>
          <div className="space-y-2">
            {stats.topReasons.map(([reason, count], i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="text-xs text-slate-400 w-4 shrink-0">{i + 1}.</span>
                <span className="text-xs text-slate-700 flex-1 truncate">{reason}</span>
                <span className="text-xs font-black text-teal-700">{count}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}