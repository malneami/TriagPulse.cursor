import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '@/api/client';
import { toast } from 'sonner';
import { BarChart3, Download, ShieldCheck } from 'lucide-react';

export default function ClinicalAnalytics() {
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        setSummary(await api.analytics.agreement(30));
      } catch (err) {
        toast.error(err?.message || 'Failed to load analytics');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleExport = async () => {
    setExporting(true);
    try {
      const data = await api.analytics.exportValidated(500);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `triagepulse-validated-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`Exported ${data.count} de-identified encounters`);
    } catch (err) {
      toast.error(err?.message || 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-teal-600 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div dir="rtl" className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-black text-slate-800 flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-teal-700" />
            تحليل الاتفاق — Agreement Analytics
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            AI/rules vs clinician final CTAS (last {summary?.days || 30} days). Supports governed improvement — no auto-training.
          </p>
        </div>
        <div className="flex flex-col sm:flex-row gap-2 shrink-0">
          <Link
            to="/admin/ai-evaluation"
            className="inline-flex items-center gap-2 bg-teal-700 hover:bg-teal-800 text-white text-sm font-bold px-3 py-2 rounded-xl"
          >
            <ShieldCheck className="w-4 h-4" />
            AI Eval / Go-No-Go
          </Link>
          <button
            type="button"
            disabled={exporting}
            onClick={handleExport}
            className="inline-flex items-center gap-2 bg-slate-800 hover:bg-slate-900 text-white text-sm font-bold px-3 py-2 rounded-xl"
          >
            <Download className="w-4 h-4" />
            {exporting ? 'Exporting…' : 'Export de-ID JSON'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Total', value: summary?.total ?? 0 },
          { label: 'Agreed', value: summary?.agreed ?? 0 },
          { label: 'Overridden', value: summary?.overridden ?? 0 },
          { label: 'Agreement %', value: summary?.agreement_rate != null ? `${summary.agreement_rate}%` : '—' },
        ].map((card) => (
          <div key={card.label} className="bg-white border border-slate-200 rounded-xl p-4">
            <p className="text-xs text-slate-500">{card.label}</p>
            <p className="text-2xl font-black text-slate-800 mt-1">{card.value}</p>
          </div>
        ))}
      </div>

      <section className="bg-white border border-slate-200 rounded-xl p-4">
        <h2 className="text-sm font-black text-slate-700 mb-3">Override themes</h2>
        {(summary?.override_themes || []).length === 0 ? (
          <p className="text-sm text-slate-400">No overrides in this window.</p>
        ) : (
          <ul className="space-y-2">
            {summary.override_themes.map((t) => (
              <li key={t.reason} className="flex justify-between gap-3 text-sm border-b border-slate-50 pb-2">
                <span className="text-slate-700">{t.reason}</span>
                <span className="font-bold text-slate-900">{t.count}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-slate-400 mt-4">
          Flagged for review: {summary?.flagged ?? 0}
        </p>
      </section>
    </div>
  );
}
