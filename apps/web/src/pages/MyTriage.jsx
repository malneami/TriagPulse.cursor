import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ChevronLeft, ChevronRight, Lock, MessageSquareWarning, ThumbsUp } from 'lucide-react';
import { api } from '@/api/client';
import { ctasFill } from '@/lib/ctasStyle';
import { monthLabel, shiftMonth } from '@/lib/month';

/**
 * "My triage": the signed-in nurse's own accuracy, private to them.
 * Reference = the physician's check of the level (agree at Seen, or re-triage).
 * A case is measured once it is closed (7 days by default); accuracy shows from 20 reviewed cases.
 * The nurse answers each disagreement: understood, or disputed with a reason.
 */

const ROLE = { physician: 'الطبيب / physician', admin: 'المسؤول / admin', nurse: 'ممرض / nurse' };

function Stat({ label, sub, value, strong }) {
  return (
    <div className={`rounded-2xl px-4 py-3 flex flex-col ${strong ? 'bg-ink text-white' : 'bg-white border border-mist'}`}>
      <span className={`text-sm ${strong ? '' : 'text-graphite'}`}>{label}</span>
      <span className="text-3xl font-semibold tabular-nums">{value}</span>
      {sub && <span className={`text-xs ${strong ? 'text-white/80' : 'text-graphite'}`}>{sub}</span>}
    </div>
  );
}

function Level({ n }) {
  return <span className="rounded-md px-2 py-0.5 font-bold" style={ctasFill(n)}>{n ?? '—'}</span>;
}

function CaseCard({ c, onAnswered }) {
  const [disputing, setDisputing] = useState(false);
  const [comment, setComment] = useState('');
  const [saving, setSaving] = useState(false);
  const under = c.status === 'under_triage';

  const answer = async (action) => {
    if (action === 'disputed' && !comment.trim()) { toast.error('اكتب سبب الاعتراض / Say briefly why'); return; }
    setSaving(true);
    try {
      await api.feedback.respond(c.reviewId, action, action === 'disputed' ? comment.trim() : undefined);
      toast.success(action === 'understood' ? 'شكراً / Noted' : 'تم إرسال الاعتراض / Dispute sent');
      setDisputing(false);
      onAnswered();
    } catch (err) {
      toast.error(err?.message || 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <li className="bg-white border border-mist rounded-2xl p-4 flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2 text-[15px]">
        <span dir="ltr" className="font-semibold">{c.ticket || '—'}</span>
        <span className="text-graphite text-sm" dir="ltr">{c.date}</span>
        {c.ageBand && <span className="text-graphite text-sm" dir="ltr">{c.ageBand}</span>}
        {c.sex && <span className="text-graphite text-sm">{c.sex === 'male' ? 'ذكر' : c.sex === 'female' ? 'أنثى' : c.sex}</span>}
        <span className={`ms-auto text-sm font-semibold px-2 py-0.5 rounded-md ${under ? 'bg-ink text-white' : 'border border-mist'}`}>
          {under ? 'أقل من اللازم · Under-triage' : 'أعلى من اللازم · Over-triage'}
        </span>
      </div>
      {c.complaint && <p className="m-0 font-medium">{c.complaint}</p>}
      {c.vitals && <p className="m-0 text-sm text-graphite" dir="ltr">{c.vitals}</p>}
      <div className="flex flex-wrap items-center gap-2 text-[15px]">
        <span>مستواك</span><Level n={c.nurseLevel} />
        <span aria-hidden="true">←</span>
        <span>{ROLE[c.reviewerRole] || c.reviewerRole}</span><Level n={c.reviewedLevel} />
        {c.aiLevel != null && <span className="text-sm text-graphite">· AI {c.aiLevel}</span>}
      </div>
      {c.reason && <p className="m-0 text-sm"><span className="text-graphite">السبب / Reason: </span>{c.reason}</p>}

      {c.response ? (
        <p className="m-0 text-sm text-graphite">
          {c.response.action === 'understood' ? 'ردّك: فهمت · Understood' : `ردّك: اعتراض · Disputed — ${c.response.comment || ''}`}
        </p>
      ) : disputing ? (
        <div className="flex flex-col gap-2">
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            maxLength={500}
            rows={2}
            placeholder="لماذا كان مستواك صحيحاً؟ / Why was your level right?"
            className="border border-mist rounded-xl px-3 py-2 text-[15px] bg-white"
          />
          <div className="flex gap-2">
            <button type="button" disabled={saving} onClick={() => answer('disputed')} className="flex-1 h-11 rounded-xl bg-ink text-white font-medium disabled:opacity-40">
              إرسال الاعتراض / Send
            </button>
            <button type="button" onClick={() => setDisputing(false)} className="h-11 px-4 rounded-xl border border-mist">إلغاء</button>
          </div>
        </div>
      ) : (
        <div className="flex gap-2">
          <button type="button" disabled={saving} onClick={() => answer('understood')} className="flex-1 h-11 rounded-xl bg-ink text-white font-medium flex items-center justify-center gap-2 disabled:opacity-40">
            <ThumbsUp className="w-4 h-4" aria-hidden="true" /> فهمت / Understood
          </button>
          <button type="button" onClick={() => setDisputing(true)} className="flex-1 h-11 rounded-xl border border-mist font-medium flex items-center justify-center gap-2">
            <MessageSquareWarning className="w-4 h-4" aria-hidden="true" /> أعترض / Dispute
          </button>
        </div>
      )}
    </li>
  );
}

export default function MyTriage() {
  const queryClient = useQueryClient();
  const [month, setMonth] = useState(null); // null = this month (server decides, Riyadh time)
  const { data, isLoading, isError } = useQuery({
    queryKey: ['my-feedback', month],
    queryFn: () => api.feedback.mine(month || undefined),
  });
  const current = data?.month || month;
  const s = data?.summary;
  const prev = data?.previous;
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['my-feedback'] });

  const accuracy = s?.accuracyPct;
  const change = accuracy != null && prev?.accuracyPct != null ? accuracy - prev.accuracyPct : null;

  return (
    <div dir="rtl" className="space-y-5 pb-10">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col">
          <h1 className="m-0 text-[28px] font-semibold">فرزي</h1>
          <span className="text-sm text-graphite flex items-center gap-1">
            <Lock className="w-3.5 h-3.5" aria-hidden="true" /> My triage — private: only you see this page.
          </span>
        </div>
        {current && (
          <div className="ms-auto flex items-center gap-1 bg-white border border-mist rounded-xl p-1">
            <button type="button" aria-label="الشهر السابق / Previous month" onClick={() => setMonth(shiftMonth(current, -1))} className="w-10 h-10 rounded-lg flex items-center justify-center hover:bg-paper">
              <ChevronRight className="w-5 h-5" aria-hidden="true" />
            </button>
            <span className="px-2 text-[15px] font-medium">{monthLabel(current)}</span>
            <button type="button" aria-label="الشهر التالي / Next month" onClick={() => setMonth(shiftMonth(current, 1))} className="w-10 h-10 rounded-lg flex items-center justify-center hover:bg-paper">
              <ChevronLeft className="w-5 h-5" aria-hidden="true" />
            </button>
          </div>
        )}
      </div>

      {isError && <p role="alert" className="border-2 border-ink rounded-xl px-4 py-3">تعذّر التحميل / Could not load.</p>}
      {isLoading && <p className="text-graphite">…</p>}

      {s && (
        <>
          <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
            <Stat
              strong
              label="التطابق مع الطبيب · Agreement"
              value={accuracy != null ? `${accuracy}%` : '—'}
              sub={accuracy != null
                ? (change != null ? `${change >= 0 ? '+' : ''}${change} عن الشهر السابق · vs last month` : 'لا مقارنة بعد · no previous month')
                : `يظهر من ٢٠ حالة مراجَعة · shows from 20 reviewed (${s.reviewed})`}
            />
            <Stat label="حالات مراجَعة · Reviewed" value={s.reviewed} sub={`من ${s.cases} فرز · of ${s.cases} triaged`} />
            <Stat label="أقل من اللازم · Under-triage" value={s.underTriage} sub="الطبيب رآها أخطر · physician more urgent" />
            <Stat label="أعلى من اللازم · Over-triage" value={s.overTriage} sub="الطبيب رآها أخف · physician less urgent" />
          </div>
          <div className="text-sm text-graphite flex flex-col gap-0.5">
            <span>
              تُحسب الحالة بعد {data.closeDays} أيام من الفرز، فيمكن تصحيح المستوى قبل ذلك.
              {s.cases - s.closed > 0 && ` ${s.cases - s.closed} حالة ما زالت مفتوحة.`}
            </span>
            <span dir="ltr" className="text-start">
              A case is measured {data.closeDays} days after triage, so a level can still be corrected.
              {s.cases - s.closed > 0 && ` ${s.cases - s.closed} still open.`}
              {s.aiAgreePct != null && ` AI matched the physician in ${s.aiAgreePct}%.`}
            </span>
          </div>

          <section className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="m-0 text-xl font-semibold">
                حالات للمراجعة <span className="text-graphite text-base font-normal">· Cases to look at</span>
              </h2>
              {data.pendingResponses > 0 && (
                <span className="text-sm bg-ink text-white rounded-md px-2 py-0.5 whitespace-nowrap">
                  {data.pendingResponses} بانتظار ردّك · awaiting your reply
                </span>
              )}
            </div>
            {data.learning.length === 0 ? (
              <p className="bg-white border border-dashed border-graphite/40 rounded-2xl py-8 text-center text-graphite">
                لا توجد اختلافات هذا الشهر · No disagreements this month.
              </p>
            ) : (
              <ul className="list-none m-0 p-0 flex flex-col gap-3">
                {data.learning.map((c) => <CaseCard key={c.id} c={c} onAnswered={refresh} />)}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
