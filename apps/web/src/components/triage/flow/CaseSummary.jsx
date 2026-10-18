import { AlertTriangle, ArrowLeftRight, Clock, HeartPulse, MapPin, MessageSquareText, Pill, Stethoscope, UserRound } from 'lucide-react';
import { ctasFill } from '@/lib/ctasStyle';

/** Structured triage summary (after Confirm). Printable: the card is the print area. */

const t = (iso) => (iso ? new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '—');
const d = (iso) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '');

function Section({ icon: Icon, ar, en, children, className = '' }) {
  return (
    <section className={`flex flex-col gap-2 ${className}`}>
      <h3 className="m-0 flex items-center gap-2 text-sm font-semibold text-ink">
        <Icon className="w-4 h-4 text-graphite" aria-hidden="true" /> {ar} <span className="text-graphite font-normal">· {en}</span>
      </h3>
      {children}
    </section>
  );
}

function Chip({ children, strong = false }) {
  return <span className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 text-sm ${strong ? 'bg-ink text-white' : 'bg-paper text-ink'}`}>{children}</span>;
}

export default function CaseSummary({ summary: s, printable = false }) {
  if (!s) return null;
  const sex = s.patient.sex ? `${s.patient.sex.ar}` : '';
  return (
    <article className={`bg-white border border-mist rounded-2xl overflow-hidden ${printable ? 'print-area' : ''}`} aria-label="ملخص الحالة · Case summary">
      {/* Decision band */}
      <div className="flex flex-wrap items-stretch">
        <div className="px-5 py-4 flex flex-col justify-center min-w-[150px]" style={ctasFill(s.level)}>
          <span className="text-xs opacity-80">CTAS</span>
          <span className="text-4xl font-bold leading-none">{s.level ?? '—'}</span>
          <span className="text-sm font-semibold mt-1">{s.levelAr}{s.levelEn ? ` · ${s.levelEn}` : ''}</span>
        </div>
        <div className="flex-1 min-w-[220px] px-5 py-4 flex flex-col gap-1.5 justify-center">
          <span className="flex items-center gap-2 text-lg font-semibold">
            <MapPin className="w-5 h-5 text-graphite" aria-hidden="true" />
            {s.direction ? <>{s.direction.ar} <span className="text-graphite font-normal text-base">· {s.direction.en}</span></> : '—'}
          </span>
          <span className="text-sm text-graphite flex flex-wrap gap-x-3">
            {s.waitMin != null && <span>{s.waitMin === 0 ? 'فوري · Immediate' : `هدف الانتظار ${s.waitMin} د · target ${s.waitMin} min`}</span>}
            {s.overridden
              ? <span className="text-ink font-semibold">تعديل الممرض من CTAS {s.aiLevel ?? '—'} · Nurse override</span>
              : <span>موافق على توصية النظام · AI recommendation confirmed</span>}
            {s.initialLevel != null && s.aiLevel != null && s.initialLevel !== s.aiLevel && (
              <span>CTAS {s.initialLevel} ← {s.aiLevel} بعد الأسئلة · after questions</span>
            )}
          </span>
          {s.overridden && s.overrideReason && (
            <span className="text-sm"><span className="text-graphite">السبب · Reason: </span>{s.overrideReason}</span>
          )}
        </div>
      </div>

      {s.safety.length > 0 && (
        <div className="bg-[#D3242C] text-white px-5 py-2.5 flex flex-col gap-1">
          {s.safety.map((a) => (
            <span key={a} className="flex items-center gap-2 text-sm font-semibold"><AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />{a}</span>
          ))}
        </div>
      )}

      <div className="px-5 py-4 grid gap-5 md:grid-cols-2">
        <Section icon={UserRound} ar="المريض" en="Patient">
          <div className="flex flex-col gap-0.5">
            <span className="text-[17px] font-semibold">{s.patient.name || 'مريض بلا اسم'}{s.patient.nameEn && <span className="text-graphite font-normal text-sm"> · {s.patient.nameEn}</span>}</span>
            <span className="text-sm text-graphite flex flex-wrap gap-x-3">
              {s.patient.age != null && <span>{s.patient.age} سنة · y</span>}
              {sex && <span>{sex}</span>}
              {s.patient.ticket && <span dir="ltr">{s.patient.ticket}</span>}
              {s.patient.encounterNo && <span>رقم العملية · <span dir="ltr">{s.patient.encounterNo}</span></span>}
            </span>
          </div>
        </Section>

        <Section icon={Clock} ar="الأوقات" en="Times">
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="bg-paper rounded-xl py-2"><div className="text-xs text-graphite">الوصول · Arrival</div><div className="font-semibold tabular-nums" dir="ltr">{t(s.times.arrival)}</div></div>
            <div className="bg-paper rounded-xl py-2"><div className="text-xs text-graphite">مدة الفرز · Triage</div><div className="font-semibold tabular-nums">{s.times.triageMin != null ? `${s.times.triageMin} د` : '—'}</div></div>
            <div className="bg-paper rounded-xl py-2"><div className="text-xs text-graphite">من الوصول · Door→triage</div><div className="font-semibold tabular-nums">{s.times.doorToTriageMin != null ? `${s.times.doorToTriageMin} د` : '—'}</div></div>
          </div>
        </Section>

        <Section icon={MessageSquareText} ar="الشكوى" en="Complaint" className="md:col-span-2">
          {s.complaint.list.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {s.complaint.list.map((c) => (
                <Chip key={c.label} strong={c.primary}>
                  {c.label}{c.labelEn && c.labelEn !== c.label ? <span className="opacity-75 text-xs">· {c.labelEn}</span> : null}
                  {c.level && <span className="rounded px-1 text-xs font-bold" style={ctasFill(c.level)}>{c.level}</span>}
                </Chip>
              ))}
            </div>
          ) : <span className="text-[15px]">{s.complaint.main || '—'}</span>}
          {s.complaint.onset && <span className="text-sm text-graphite">البداية · Onset: {s.complaint.onset}</span>}
        </Section>

        <Section icon={HeartPulse} ar="العلامات الحيوية" en="Vital signs" className="md:col-span-2">
          <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-7 gap-2">
            {s.vitals.map((v) => (
              <div key={v.key} className={`rounded-xl px-2 py-2 text-center ${v.value == null ? 'border border-dashed border-mist' : 'bg-paper'}`}>
                <div className="text-xs text-graphite">{v.ar} · {v.en}</div>
                <div className="text-lg font-semibold tabular-nums" dir="ltr">{v.value ?? '—'}</div>
                <div className="text-[11px] text-graphite" dir="ltr">{v.value != null ? v.unit : 'not recorded'}</div>
              </div>
            ))}
          </div>
        </Section>

        <Section icon={Stethoscope} ar="سبب القرار" en="Why this level">
          {s.why.length === 0 ? <span className="text-sm text-graphite">—</span> : (
            <div className="flex flex-col gap-3">
              {s.why.filter((g) => g.key !== 'missing').map((g) => (
                <div key={g.key} className="flex flex-col gap-1">
                  <span className="text-xs font-semibold text-graphite">{g.ar} · {g.en}</span>
                  {g.items?.map((it) => <span key={it.ar} className="text-sm">{it.ar}{it.en ? <span className="text-graphite"> · {it.en}</span> : null}</span>)}
                  {g.chips?.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">{g.chips.map((c) => <Chip key={c.ar}>{c.ar}{c.level ? ` (${c.level})` : ''}</Chip>)}</div>
                  )}
                </div>
              ))}
            </div>
          )}
        </Section>

        <Section icon={Pill} ar="التاريخ المرضي والأدوية" en="History & medicines">
          <div className="flex flex-col gap-1.5 text-sm">
            <div>
              <span className="text-graphite">أمراض مزمنة · Chronic: </span>
              {s.history.conditions.length
                ? s.history.conditions.map((c) => `${c.label}${c.kind === 'probable' ? ' (محتمل من الدواء)' : ''}`).join('، ')
                : s.history.noneKnown ? 'لا يوجد · none known' : (s.history.historyText || 'لم يُسأل · not asked')}
            </div>
            {s.history.denied.length > 0 && <div><span className="text-graphite">نفى · Denied: </span>{s.history.denied.join('، ')}</div>}
            <div><span className="text-graphite">الأدوية · Medicines: </span>{s.history.medications.length ? s.history.medications.join('، ') : (s.history.medicationsText || '—')}</div>
            <div><span className="text-graphite">الحساسية · Allergies: </span>{s.history.allergies || '—'}</div>
          </div>
        </Section>

        {s.answers.length > 0 && (
          <Section icon={ArrowLeftRight} ar="أسئلة التوضيح" en="Clarifying questions" className="md:col-span-2">
            <dl className="m-0 grid sm:grid-cols-2 gap-x-6 gap-y-1.5">
              {s.answers.map((a) => (
                <div key={a.q} className="flex justify-between gap-3 border-b border-mist/70 py-1 text-sm">
                  <dt className="text-graphite">{a.q}</dt>
                  <dd className="m-0 font-semibold text-ink shrink-0">{a.a}</dd>
                </div>
              ))}
            </dl>
          </Section>
        )}

        {s.outstanding.length > 0 && (
          <Section icon={AlertTriangle} ar="لم يُسجَّل" en="Not obtained" className="md:col-span-2">
            <div className="flex flex-wrap gap-1.5">{s.outstanding.map((o) => <Chip key={o}>{o}</Chip>)}</div>
          </Section>
        )}
      </div>

      <footer className="px-5 py-3 border-t border-mist text-xs text-graphite flex flex-wrap gap-x-4 gap-y-1">
        <span>ممرض الفرز · Triage nurse: <span className="text-ink">{s.nurse || '—'}</span></span>
        <span dir="ltr">{d(s.times.completed)} {t(s.times.completed)}</span>
        <span>دعم قرار فقط؛ المستوى أكّده الممرض · Decision support only; level confirmed by the triage nurse</span>
      </footer>
    </article>
  );
}
