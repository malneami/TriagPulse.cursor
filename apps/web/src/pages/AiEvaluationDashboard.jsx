import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '@/api/client';
import { toast } from 'sonner';
import {
  AlertTriangle,
  BarChart3,
  Download,
  ShieldAlert,
  ShieldCheck,
  Activity,
} from 'lucide-react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
} from 'recharts';

const DAY_OPTIONS = [7, 30, 90];

const DECISION_STYLE = {
  go: { bg: 'bg-emerald-700', border: 'border-emerald-800', label: 'GO', label_ar: 'انطلاق', Icon: ShieldCheck },
  cautious_go: { bg: 'bg-amber-600', border: 'border-amber-700', label: 'CAUTIOUS GO', label_ar: 'انطلاق بحذر', Icon: AlertTriangle },
  no_go: { bg: 'bg-red-700', border: 'border-red-800', label: 'NO-GO', label_ar: 'إيقاف', Icon: ShieldAlert },
  insufficient_data: { bg: 'bg-slate-600', border: 'border-slate-700', label: 'INSUFFICIENT DATA', label_ar: 'بيانات غير كافية', Icon: Activity },
};

const STATUS_PILL = {
  go: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  cautious: 'bg-amber-100 text-amber-900 border-amber-200',
  cautious_go: 'bg-amber-100 text-amber-900 border-amber-200',
  no_go: 'bg-red-100 text-red-800 border-red-200',
  insufficient_data: 'bg-slate-100 text-slate-600 border-slate-200',
  pending: 'bg-sky-50 text-sky-800 border-sky-200',
};

function fmt(v, unit = '') {
  if (v == null || Number.isNaN(v)) return '—';
  return `${v}${unit}`;
}

/** English primary + small non-bold Arabic translation */
function BiLabel({ en, ar, enClass = 'text-sm font-semibold text-slate-800', arClass = 'text-[11px] font-normal text-slate-400' }) {
  return (
    <div>
      <p className={enClass}>{en}</p>
      {ar ? <p className={arClass} dir="rtl">{ar}</p> : null}
    </div>
  );
}

function StatusPill({ status }) {
  const s = status || 'insufficient_data';
  return (
    <span className={`text-[10px] font-black uppercase tracking-wide px-2 py-0.5 rounded-full border ${STATUS_PILL[s] || STATUS_PILL.insufficient_data}`}>
      {s.replace('_', ' ')}
    </span>
  );
}

function Section({ title_en, title_ar, children, hint }) {
  return (
    <section className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3 shadow-sm">
      <div>
        <BiLabel
          en={title_en}
          ar={title_ar}
          enClass="text-sm font-semibold text-slate-800"
          arClass="text-[11px] font-normal text-slate-400 mt-0.5"
        />
        {hint && <p className="text-xs text-slate-500 mt-1">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

export default function AiEvaluationDashboard() {
  const [days, setDays] = useState(30);
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const data = await api.analytics.evaluation(days);
        if (!cancelled) setReport(data);
      } catch (err) {
        toast.error(err?.message || 'Failed to load AI evaluation');
        if (!cancelled) setReport(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [days]);

  const decision = DECISION_STYLE[report?.overall_decision] || DECISION_STYLE.insufficient_data;
  const DecisionIcon = decision.Icon;

  const trendDelta = useMemo(() => {
    const trends = report?.trends || [];
    if (trends.length < 2) return null;
    const a = trends[trends.length - 2];
    const b = trends[trends.length - 1];
    if (a.ai_accuracy == null || b.ai_accuracy == null) return null;
    const d = Math.round((b.ai_accuracy - a.ai_accuracy) * 10) / 10;
    return d;
  }, [report]);

  const handleExport = () => {
    if (!report) return;
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `triagepulse-ai-evaluation-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Evaluation snapshot exported');
  };

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-teal-600 rounded-full animate-spin" />
      </div>
    );
  }

  if (!report) {
    return (
      <div className="bg-white border border-slate-200 rounded-2xl p-8 text-center text-sm text-slate-500">
        <p className="font-semibold text-slate-700">Failed to load evaluation report</p>
        <p className="text-[11px] font-normal text-slate-400 mt-1" dir="rtl">تعذر تحميل تقرير التقييم</p>
      </div>
    );
  }

  const sample = report.sample_sizes || {};

  return (
    <div dir="ltr" className="space-y-5 text-left">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-800 flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-teal-700 shrink-0" />
            <span>
              AI Evaluation &amp; Go/No-Go
              <span className="block text-[12px] font-normal text-slate-400 mt-0.5" dir="rtl">تقييم AI وقرار الانطلاق</span>
            </span>
          </h1>
          <p className="text-sm text-slate-500 mt-1 max-w-xl">
            CPMAI-aligned evaluation against expert reference CTAS. Safety vetoes outweigh speed/docs KPIs.
            {' '}
            <Link to="/admin/analytics" className="text-teal-700 font-semibold underline">
              Agreement export
            </Link>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-xl border border-slate-200 overflow-hidden bg-white">
            {DAY_OPTIONS.map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDays(d)}
                className={`px-3 py-1.5 text-xs font-semibold ${days === d ? 'bg-teal-700 text-white' : 'text-slate-600 hover:bg-slate-50'}`}
              >
                {d}d
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={handleExport}
            className="inline-flex items-center gap-2 bg-slate-800 hover:bg-slate-900 text-white text-xs font-semibold px-3 py-2 rounded-xl"
          >
            <Download className="w-3.5 h-3.5" />
            Export JSON
          </button>
        </div>
      </div>

      {/* Overall Decision */}
      <div className={`${decision.bg} ${decision.border} border-2 rounded-2xl text-white px-4 py-4 flex items-start gap-3 shadow-md`}>
        <DecisionIcon className="w-7 h-7 shrink-0 mt-0.5" />
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase opacity-80">
            Overall Decision
            <span className="ml-1.5 font-normal normal-case opacity-70">القرار الإجمالي</span>
          </p>
          <p className="text-2xl font-semibold tracking-wide">{decision.label}</p>
          <p className="text-xs font-normal opacity-80 mt-0.5" dir="rtl">{decision.label_ar}</p>
          <p className="text-xs opacity-90 mt-1">
            Expert-labeled {sample.expert_labeled ?? 0}/{sample.total_records ?? 0}
            {' · '}Critical cohort {sample.critical_with_ai ?? 0}
            {sample.insufficient_clinical_sample ? ' · Sample below governance minimum' : ''}
            {trendDelta != null && (
              <> · Accuracy trend {trendDelta > 0 ? '↑' : trendDelta < 0 ? '↓' : '→'} {Math.abs(trendDelta)} pts</>
            )}
          </p>
        </div>
      </div>

      {/* Hero cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {(report.hero_cards || []).map((card) => (
          <div key={card.id} className="bg-white border border-slate-200 rounded-xl p-3">
            <BiLabel
              en={card.label_en}
              ar={card.label_ar}
              enClass="text-[11px] font-semibold text-slate-600"
              arClass="text-[10px] font-normal text-slate-400"
            />
            <p className="text-2xl font-semibold text-slate-900 mt-1">{fmt(card.value, card.unit || '')}</p>
            <div className="mt-1"><StatusPill status={card.status} /></div>
            {card.note && <p className="text-[10px] font-normal text-slate-400 mt-1">{card.note}</p>}
          </div>
        ))}
      </div>

      {/* A — Human vs AI */}
      <Section
        title_en="A. Human vs AI Clinical Performance"
        title_ar="أ. الأداء السريري: بشري مقابل AI"
        hint="Reference = expert/clinician final CTAS. Sensitivity & false negatives outweigh overall accuracy."
      >
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-slate-500 border-b border-slate-100">
                <th className="text-left py-2 font-semibold">KPI</th>
                <th className="text-center py-2 font-semibold">Human</th>
                <th className="text-center py-2 font-semibold">AI</th>
                <th className="text-center py-2 font-semibold">Target</th>
                <th className="text-center py-2 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {(report.clinical_kpis || []).map((row) => (
                <tr key={row.id} className="border-b border-slate-50">
                  <td className="py-2 pr-1">
                    <BiLabel
                      en={row.label_en}
                      ar={row.label_ar}
                      enClass="font-semibold text-slate-800"
                      arClass="text-[11px] font-normal text-slate-400"
                    />
                    {row.importance && (
                      <span className="text-[9px] font-semibold uppercase text-slate-400">{row.importance}</span>
                    )}
                  </td>
                  <td className="text-center font-semibold text-slate-700">{fmt(row.human, row.unit === '%' ? '%' : '')}</td>
                  <td className="text-center font-semibold text-slate-900">{fmt(row.ai, row.unit === '%' ? '%' : '')}</td>
                  <td className="text-center text-slate-500">{row.target}</td>
                  <td className="text-center"><StatusPill status={row.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {report.confusion_critical && (
          <div className="rounded-xl bg-slate-50 border border-slate-100 px-3 py-2 text-[11px] text-slate-600 flex flex-wrap gap-3">
            <span>Critical class — TP {report.confusion_critical.tp} · FN {report.confusion_critical.fn} · FP {report.confusion_critical.fp} · TN {report.confusion_critical.tn}</span>
            <span>Precision {fmt(report.confusion_critical.precision, '%')}</span>
            <span>Recall {fmt(report.confusion_critical.recall, '%')}</span>
            <span>F1 {fmt(report.confusion_critical.f1, '%')}</span>
            <span>FNR {fmt(report.confusion_critical.fnr, '%')}</span>
          </div>
        )}
      </Section>

      {/* D — Safety Gate */}
      <Section
        title_en="D. Safety Gate"
        title_ar="د. بوابة السلامة"
        hint="Critical under-triage / FN is a veto — other KPIs cannot compensate."
      >
        <div className="space-y-2">
          {(report.safety_gates || []).map((g) => (
            <div key={g.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-100 px-3 py-2">
              <div className="min-w-0">
                <BiLabel
                  en={g.label_en}
                  ar={g.label_ar}
                  enClass="text-xs font-semibold text-slate-800"
                  arClass="text-[11px] font-normal text-slate-400"
                />
                {g.veto && <p className="text-[10px] font-normal text-slate-500 mt-0.5">Veto gate</p>}
                {g.note && <p className="text-[10px] font-normal text-amber-700 mt-0.5">{g.note}</p>}
              </div>
              <div className="flex items-center gap-3 text-[11px]">
                <span className="text-slate-500">GO {g.go}</span>
                <span className="font-semibold text-slate-900">{fmt(g.value, typeof g.value === 'number' && g.id !== 'missed_critical_as_low' ? '%' : '')}</span>
                <StatusPill status={g.status} />
              </div>
            </div>
          ))}
        </div>
      </Section>

      {/* E — Comparison */}
      <Section
        title_en="E. Human vs AI Domain Comparison"
        title_ar="هـ. مقارنة المجالات"
      >
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-slate-500 border-b border-slate-100">
                <th className="text-left py-2 font-semibold">Domain</th>
                <th className="text-center py-2 font-semibold">Human</th>
                <th className="text-center py-2 font-semibold">AI</th>
                <th className="text-center py-2 font-semibold">Δ (AI − Human)</th>
              </tr>
            </thead>
            <tbody>
              {(report.comparison || []).map((row) => (
                <tr key={row.domain} className="border-b border-slate-50">
                  <td className="py-2">
                    <BiLabel
                      en={row.domain}
                      ar={row.domain_ar}
                      enClass="font-semibold text-slate-800"
                      arClass="text-[11px] font-normal text-slate-400"
                    />
                  </td>
                  <td className="text-center font-semibold">{fmt(row.human, row.unit === 'min' ? ' min' : '%')}</td>
                  <td className="text-center font-semibold">{fmt(row.ai, row.unit === 'min' ? ' min' : '%')}</td>
                  <td className="text-center font-semibold text-slate-600">{fmt(row.diff)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      {/* B — Workflow */}
      <Section
        title_en="B. Workflow & Business Value"
        title_ar="ب. قيمة سير العمل"
      >
        <div className="grid sm:grid-cols-2 gap-2">
          {(report.workflow_kpis || []).map((k) => (
            <div key={k.id} className="rounded-xl border border-slate-100 px-3 py-2">
              <div className="flex justify-between gap-2 items-start">
                <BiLabel
                  en={k.label_en}
                  ar={k.label_ar}
                  enClass="text-xs font-semibold text-slate-800"
                  arClass="text-[10px] font-normal text-slate-400"
                />
                <StatusPill status={k.status} />
              </div>
              <p className="text-lg font-semibold text-slate-900 mt-1">{fmt(k.value, k.unit === '%' ? '%' : k.unit === 'min' ? ' min' : k.unit === 'count' ? '' : '')}</p>
              <p className="text-[10px] font-normal text-slate-500">Target: {k.target}</p>
              {k.note && <p className="text-[10px] font-normal text-amber-700 mt-0.5">{k.note}</p>}
            </div>
          ))}
        </div>
      </Section>

      {/* C — Technical */}
      <Section
        title_en="C. AI Technical Performance"
        title_ar="ج. الأداء التقني"
      >
        <div className="grid sm:grid-cols-2 gap-2">
          {(report.technical_kpis || []).map((k) => (
            <div key={k.id} className="rounded-xl border border-slate-100 px-3 py-2 flex justify-between gap-2">
              <div>
                <BiLabel
                  en={k.label_en}
                  ar={k.label_ar}
                  enClass="text-xs font-semibold text-slate-800"
                  arClass="text-[10px] font-normal text-slate-400"
                />
                <p className="text-[10px] font-normal text-slate-500 mt-0.5">Target: {k.target}</p>
                {k.note && <p className="text-[10px] font-normal text-sky-700">{k.note}</p>}
              </div>
              <div className="text-right shrink-0">
                <p className="text-lg font-semibold text-slate-900">{fmt(k.value, typeof k.value === 'number' ? '%' : '')}</p>
                <StatusPill status={k.status} />
              </div>
            </div>
          ))}
        </div>
      </Section>

      {/* F — Scorecard */}
      <Section
        title_en="F. Go / Cautious / No-Go Scorecard"
        title_ar="و. بطاقة Go/No-Go"
      >
        <div className="space-y-2">
          {(report.scorecard || []).map((row) => (
            <div key={row.domain} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-100 px-3 py-2">
              <div className="min-w-0">
                <BiLabel
                  en={row.domain}
                  ar={row.domain_ar}
                  enClass="text-xs font-semibold text-slate-800"
                  arClass="text-[11px] font-normal text-slate-400"
                />
                <p className="text-[11px] font-normal text-slate-500 mt-0.5">{row.question_en}</p>
              </div>
              <StatusPill status={row.status} />
            </div>
          ))}
        </div>
      </Section>

      {/* G — Trends */}
      <Section
        title_en="G. Continuous Monitoring"
        title_ar="ز. المراقبة المستمرة"
      >
        {(report.trends || []).length === 0 ? (
          <p className="text-sm text-slate-400">No monthly expert-labeled trend points yet.</p>
        ) : (
          <div className="h-56 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={report.trends}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="month" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} domain={[0, 100]} />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="ai_accuracy" name="AI accuracy %" stroke="#0F6E56" strokeWidth={2} dot />
                <Line type="monotone" dataKey="under_triage" name="Under-triage %" stroke="#E24B4A" strokeWidth={2} dot />
                <Line type="monotone" dataKey="critical_fn" name="Critical FN %" stroke="#EF9F27" strokeWidth={2} dot />
                <Line type="monotone" dataKey="override_rate" name="Override %" stroke="#378ADD" strokeWidth={2} dot />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </Section>

      {/* Case review */}
      <Section
        title_en="Case Review (de-identified)"
        title_ar="مراجعة الحالات"
        hint="Human CTAS → AI CTAS → Expert CTAS → difference → reason → destination"
      >
        {(report.case_reviews || []).length === 0 ? (
          <p className="text-sm text-slate-400">
            No expert-labeled cases in this window. Validate clinician final CTAS to unlock accuracy gates.
          </p>
        ) : (
          <div className="overflow-x-auto max-h-96 overflow-y-auto">
            <table className="w-full text-[11px]">
              <thead className="sticky top-0 bg-white">
                <tr className="text-slate-500 border-b border-slate-100">
                  <th className="text-left py-2 font-semibold">Case</th>
                  <th className="text-center py-2 font-semibold">Human</th>
                  <th className="text-center py-2 font-semibold">AI</th>
                  <th className="text-center py-2 font-semibold">Expert</th>
                  <th className="text-center py-2 font-semibold">Δ</th>
                  <th className="text-left py-2 font-semibold">Reason / Dest</th>
                </tr>
              </thead>
              <tbody>
                {report.case_reviews.map((c) => (
                  <tr
                    key={c.record_id}
                    className={`border-b border-slate-50 ${c.critical_missed_as_low ? 'bg-red-50' : c.under_triage_ai ? 'bg-amber-50/60' : ''}`}
                  >
                    <td className="py-1.5">
                      <p className="font-semibold text-slate-800 truncate max-w-[10rem]">{c.chief_complaint || '—'}</p>
                      <p className="text-slate-400 font-normal">{c.age_band || '—'} · {c.created_at?.slice(0, 10)}</p>
                    </td>
                    <td className="text-center font-semibold">{c.human_ctas ?? '—'}</td>
                    <td className="text-center font-semibold">
                      {c.ai_ctas ?? '—'}
                      {c.ai_source === 'rules' && <span className="block text-[9px] font-normal text-slate-400">rules</span>}
                    </td>
                    <td className="text-center font-semibold text-teal-800">{c.expert_ctas ?? '—'}</td>
                    <td className="text-center font-semibold">{c.delta_ai_expert ?? '—'}</td>
                    <td className="text-left text-slate-600">
                      <p className="truncate max-w-[12rem] font-normal">{c.override_reason || '—'}</p>
                      <p className="text-slate-400 truncate max-w-[12rem] font-normal">{c.destination || '—'}</p>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <p className="text-[10px] font-normal text-slate-400 text-center pb-4">
        Thresholds v{report.thresholds_version} · project-proposed CPMAI gates · generated {report.generated_at}
      </p>
    </div>
  );
}
