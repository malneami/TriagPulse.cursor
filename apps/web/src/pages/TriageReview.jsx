import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ChevronLeft, ChevronRight, ShieldCheck } from 'lucide-react';
import { api } from '@/api/client';
import { REVIEW_REASONS, monthKey, monthLabel, shiftMonth, shiftWeek, weekLabel } from '@triagepulse/clinical';
import { ctasFill } from '@/lib/ctasStyle';

/**
 * Department triage review (physician / admin). Weekly or monthly totals against the physician check,
 * a nurse-level × physician-level table, disagreement reasons, high-risk under-triage and
 * disputed cases. No nurse or patient names: each nurse sees her own cases on "My triage".
 */

const REASON_AR = Object.fromEntries(REVIEW_REASONS.map((r) => [r.en, r.ar]));
REASON_AR.Other = 'أخرى (نص حر)';

function Stat({ label, value, sub, strong, icon }) {
  return (
    <div className={`rounded-2xl px-4 py-3 flex flex-col ${strong ? 'bg-ink text-white' : 'bg-white border border-mist'}`}>
      <span className={`text-sm flex items-center gap-1 ${strong ? '' : 'text-graphite'}`}>{icon}{label}</span>
      <span className="text-3xl font-semibold tabular-nums">{value}</span>
      {sub && <span dir="auto" className={`text-xs text-start ${strong ? 'text-white/80' : 'text-graphite'}`}>{sub}</span>}
    </div>
  );
}

const pct = (n, d) => (d ? `${Math.round((n / d) * 100)}%` : '—');

/** Rows = triage (nurse) level, columns = physician level. Shade = number of cases. */
function LevelTable({ matrix }) {
  const max = Math.max(1, ...matrix.flat());
  const kind = (n, r) => (n === r ? 'agree' : r < n ? 'under' : 'over');
  const KIND = { agree: 'تطابق · agree', under: 'أقل من اللازم · under-triage', over: 'أعلى من اللازم · over-triage' };
  return (
    <div className="overflow-x-auto">
      <table dir="ltr" className="border-separate border-spacing-1 mx-auto">
        <caption className="caption-bottom text-xs text-graphite pt-2 text-center" dir="rtl">
          الصفوف: مستوى الفرز · الأعمدة: مستوى الطبيب. تحت القطر = الطبيب رآها أخطر (أقل من اللازم).
          <span className="block" dir="ltr">Rows: triage level · Columns: physician level. Below the diagonal = physician more urgent (under-triage).</span>
        </caption>
        <thead>
          <tr>
            <th className="text-xs text-graphite font-normal p-1 text-left">Triage ↓ / MD →</th>
            {[1, 2, 3, 4, 5].map((r) => (
              <th key={r} scope="col" className="p-0">
                <span className="block w-12 sm:w-16 rounded-md py-1 text-sm font-bold" style={ctasFill(r)}>{r}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {matrix.map((row, i) => (
            <tr key={i}>
              <th scope="row" className="p-0">
                <span className="block w-10 rounded-md py-2 text-sm font-bold" style={ctasFill(i + 1)}>{i + 1}</span>
              </th>
              {row.map((v, j) => {
                const k = kind(i + 1, j + 1);
                const a = v ? 0.12 + 0.88 * (v / max) : 0;
                return (
                  <td
                    key={j}
                    title={`Triage ${i + 1} → physician ${j + 1}: ${v} case${v === 1 ? '' : 's'} (${k === 'agree' ? 'agree' : k === 'under' ? 'under-triage' : 'over-triage'})`}
                    aria-label={`فرز ${i + 1}، طبيب ${j + 1}: ${v} — ${KIND[k]}`}
                    className={`w-12 sm:w-16 h-11 rounded-md text-center tabular-nums text-[15px] ${k === 'agree' ? 'ring-2 ring-ink ring-inset font-semibold' : ''}`}
                    style={{ backgroundColor: v ? `rgba(20,32,43,${a.toFixed(2)})` : '#F5F7F9', color: a > 0.5 ? '#FFFFFF' : '#14202B' }}
                  >
                    {v || '·'}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Reasons({ reasons }) {
  if (!reasons.length) return <p className="text-graphite text-sm m-0">لا توجد اختلافات في هذه الفترة · No disagreements this period.</p>;
  const max = Math.max(...reasons.map((r) => r.count));
  return (
    <ul className="list-none m-0 p-0 flex flex-col gap-2">
      {reasons.map((r) => (
        <li key={r.reason} className="grid grid-cols-[minmax(0,10rem)_1fr_2.5rem] items-center gap-2 text-sm" title={`${r.reason}: ${r.count}`}>
          <span className="flex flex-col leading-tight">
            <span>{REASON_AR[r.reason] || r.reason}</span>
            <span dir="ltr" className="text-xs text-graphite text-start">{r.reason}</span>
          </span>
          <span className="h-3 bg-paper rounded-full overflow-hidden" aria-hidden="true">
            <span className="block h-full bg-ink rounded-full" style={{ width: `${(r.count / max) * 100}%` }} />
          </span>
          <span className="tabular-nums font-semibold text-start">{r.count}</span>
        </li>
      ))}
    </ul>
  );
}

function CaseRow({ c, extra }) {
  return (
    <li className="bg-white border border-mist rounded-2xl p-4 flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-2 text-[15px]">
        <span dir="ltr" className="font-semibold">{c.ticket || '—'}</span>
        <span dir="ltr" className="text-sm text-graphite">{c.date}</span>
        {c.ageBand && <span dir="ltr" className="text-sm text-graphite">{c.ageBand}</span>}
        {c.sex && <span className="text-sm text-graphite">{c.sex === 'male' ? 'ذكر' : c.sex === 'female' ? 'أنثى' : c.sex}</span>}
        <span className="ms-auto flex items-center gap-1.5 text-sm">
          فرز <span className="rounded-md px-2 py-0.5 font-bold" style={ctasFill(c.nurseLevel)}>{c.nurseLevel}</span>
          <span aria-hidden="true">←</span>
          طبيب <span className="rounded-md px-2 py-0.5 font-bold" style={ctasFill(c.reviewedLevel)}>{c.reviewedLevel}</span>
          {c.aiLevel != null && <span className="text-graphite">· AI {c.aiLevel}</span>}
        </span>
      </div>
      {c.complaint && <p className="m-0 font-medium">{c.complaint}</p>}
      {c.vitals && <p dir="ltr" className="m-0 text-sm text-graphite text-start">{c.vitals}</p>}
      {c.reason && <p className="m-0 text-sm"><span className="text-graphite">سبب الطبيب / Physician: </span>{c.reason}</p>}
      {extra}
    </li>
  );
}

function formatDur(sec) {
  if (sec == null) return '—';
  if (sec < 60) return `${sec} ث`;
  const m = Math.round(sec / 60);
  return `${m} د`;
}

export default function TriageReview() {
  const [periodType, setPeriodType] = useState('week');
  const [week, setWeek] = useState(null);
  const [month, setMonth] = useState(null);
  const { data, isLoading, isError } = useQuery({
    queryKey: ['dept-feedback', periodType, week, month],
    queryFn: () => api.feedback.department(periodType === 'month' ? { month: month || undefined } : { week: week || undefined }),
  });
  const current = periodType === 'month' ? (data?.month || month) : (data?.week || week);
  const s = data?.summary;
  const prev = data?.previous;
  const b = data?.breakdown;
  const change = s?.accuracyPct != null && prev?.accuracyPct != null ? s.accuracyPct - prev.accuracyPct : null;
  const vsPrev = periodType === 'month' ? 'vs last month' : 'vs last week';
  const noPrev = periodType === 'month' ? 'no previous month' : 'no previous week';

  return (
    <div dir="rtl" className="space-y-5 pb-10">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col">
          <h1 className="m-0 text-[28px] font-semibold">مراجعة الفرز</h1>
          <span className="text-sm text-graphite">Triage review — department, against the physician check. No names. Timing is triage duration, not door-to-physician wait.</span>
        </div>
        <div className="ms-auto flex flex-wrap items-center gap-2">
          <div className="flex bg-white border border-mist rounded-xl p-1">
            <button type="button" aria-pressed={periodType === 'week'} onClick={() => setPeriodType('week')} className={`h-10 px-3 rounded-lg text-sm font-medium ${periodType === 'week' ? 'bg-ink text-white' : ''}`}>أسبوع · Week</button>
            <button type="button" aria-pressed={periodType === 'month'} onClick={() => { setPeriodType('month'); if (!month) setMonth(data?.month || monthKey(new Date())); }} className={`h-10 px-3 rounded-lg text-sm font-medium ${periodType === 'month' ? 'bg-ink text-white' : ''}`}>شهر · Month</button>
          </div>
          {current && (
            <div className="flex items-center gap-1 bg-white border border-mist rounded-xl p-1">
              <button
                type="button"
                aria-label={periodType === 'month' ? 'الشهر السابق / Previous month' : 'الأسبوع السابق / Previous week'}
                onClick={() => (periodType === 'month' ? setMonth(shiftMonth(current, -1)) : setWeek(shiftWeek(current, -1)))}
                className="w-10 h-10 rounded-lg flex items-center justify-center hover:bg-paper"
              >
                <ChevronRight className="w-5 h-5" aria-hidden="true" />
              </button>
              <span className="px-2 text-[15px] font-medium">{periodType === 'month' ? monthLabel(current) : weekLabel(current)}</span>
              <button
                type="button"
                aria-label={periodType === 'month' ? 'الشهر التالي / Next month' : 'الأسبوع التالي / Next week'}
                onClick={() => (periodType === 'month' ? setMonth(shiftMonth(current, 1)) : setWeek(shiftWeek(current, 1)))}
                className="w-10 h-10 rounded-lg flex items-center justify-center hover:bg-paper"
              >
                <ChevronLeft className="w-5 h-5" aria-hidden="true" />
              </button>
            </div>
          )}
        </div>
      </div>

      {isError && <p role="alert" className="border-2 border-ink rounded-xl px-4 py-3">تعذّر التحميل / Could not load.</p>}
      {isLoading && <p className="text-graphite">…</p>}

      {s && b && (
        <>
          <div className="grid gap-3 grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            <Stat
              strong
              label="التطابق · Exact-match / agreement"
              value={s.accuracyPct != null ? `${s.accuracyPct}%` : '—'}
              sub={s.accuracyPct != null
                ? (change != null ? `${change >= 0 ? '+' : ''}${change} ${vsPrev}` : noPrev)
                : `from 20 reviewed (${s.reviewed})`}
            />
            <Stat label="مدة الفرز · Triage duration" value={formatDur(s.meanTriageDurationSec)} sub="mean, start → complete" />
            <Stat label="نسبة المراجعة · Checked" value={b.coveragePct != null ? `${b.coveragePct}%` : '—'} sub={`${s.reviewed + b.conditionChanged} of ${s.closed} closed cases`} />
            <Stat label="أقل من اللازم · Under" value={s.underTriage} sub={s.underPct != null ? `${s.underPct}% of reviewed` : `${pct(s.underTriage, s.reviewed)} of reviewed`} />
            <Stat
              strong={b.highRiskUnder > 0}
              icon={b.highRiskUnder > 0 ? <AlertTriangle className="w-3.5 h-3.5" aria-hidden="true" /> : null}
              label="عالية الخطورة · High-risk under"
              value={b.highRiskUnder}
              sub="MD CTAS 1–2, triage 3–5"
            />
            <Stat label="أعلى من اللازم · Over" value={s.overTriage} sub={s.overPct != null ? `${s.overPct}% of reviewed` : `${pct(s.overTriage, s.reviewed)} of reviewed`} />
            <Stat
              label="تطابق AI · AI agreement"
              icon={<ShieldCheck className="w-3.5 h-3.5" aria-hidden="true" />}
              value={s.aiAgreePct != null ? `${s.aiAgreePct}%` : '—'}
              sub={s.aiAgreePct != null ? 'AI level = physician level' : 'from 20 compared'}
            />
          </div>
          <p className="text-sm text-graphite m-0">
            {s.cases} فرز هذه الفترة · {s.cases - s.closed} ما زالت مفتوحة (تُحسب بعد {data.closeDays} أيام) · {b.conditionChanged} تغيّرت حالتها بعد الفرز ولم تُحسب.
            <span className="block" dir="ltr">
              {s.cases} triaged · {s.cases - s.closed} still open (measured after {data.closeDays} days) · {b.conditionChanged} changed after triage, not counted.
            </span>
          </p>

          <div className="grid gap-4 lg:grid-cols-2">
            <section className="bg-white border border-mist rounded-2xl p-4 space-y-3">
              <h2 className="m-0 text-lg font-semibold">مستوى الفرز مقابل الطبيب <span className="text-graphite text-sm font-normal">· Triage vs physician</span></h2>
              <LevelTable matrix={b.matrix} />
            </section>
            <section className="bg-white border border-mist rounded-2xl p-4 space-y-4">
              <h2 className="m-0 text-lg font-semibold">أسباب الاختلاف <span className="text-graphite text-sm font-normal">· Disagreement reasons</span></h2>
              <Reasons reasons={b.reasons} />
              <h3 className="m-0 text-base font-semibold pt-2">ردود الممرضين <span className="text-graphite text-sm font-normal">· Nurse responses</span></h3>
              <div className="grid grid-cols-3 gap-2 text-center">
                {[['فهمت', 'Understood', b.responses.understood], ['اعتراض', 'Disputed', b.responses.disputed], ['بانتظار الرد', 'Awaiting', b.responses.pending]].map(([ar, en, n]) => (
                  <div key={en} className="border border-mist rounded-xl py-2">
                    <div className="text-2xl font-semibold tabular-nums">{n}</div>
                    <div className="text-xs text-graphite">{ar} · {en}</div>
                  </div>
                ))}
              </div>
            </section>
          </div>

          <section className="space-y-3">
            <h2 className="m-0 text-xl font-semibold flex items-center gap-2">
              <AlertTriangle className="w-5 h-5" aria-hidden="true" />
              أقل من اللازم بخطورة عالية <span className="text-graphite text-base font-normal">· High-risk under-triage</span>
            </h2>
            {data.highRisk.length === 0 ? (
              <p className="bg-white border border-dashed border-graphite/40 rounded-2xl py-6 text-center text-graphite m-0">لا توجد حالات · None this period.</p>
            ) : (
              <ul className="list-none m-0 p-0 flex flex-col gap-3">
                {data.highRisk.map((c) => (
                  <CaseRow key={c.id} c={c} extra={<p className="m-0 text-sm text-graphite">ردّ الممرض / Nurse: {c.nurseResponse === 'understood' ? 'فهمت · understood' : c.nurseResponse === 'disputed' ? 'اعتراض · disputed' : 'لم يرد بعد · not yet'}</p>} />
                ))}
              </ul>
            )}
          </section>

          <section className="space-y-3">
            <h2 className="m-0 text-xl font-semibold">حالات معترض عليها <span className="text-graphite text-base font-normal">· Disputed cases</span></h2>
            {data.disputes.length === 0 ? (
              <p className="bg-white border border-dashed border-graphite/40 rounded-2xl py-6 text-center text-graphite m-0">لا توجد اعتراضات · No disputes this period.</p>
            ) : (
              <ul className="list-none m-0 p-0 flex flex-col gap-3">
                {data.disputes.map((c) => (
                  <CaseRow key={c.id} c={c} extra={<p className="m-0 text-sm"><span className="text-graphite">ردّ الممرض / Nurse: </span>{c.nurseComment}</p>} />
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
