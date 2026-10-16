import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  Signpost, Lock, Plus, Trash2, ArrowUp, ArrowDown, Save, History, RotateCcw,
  FlaskConical, AlertTriangle, CheckCircle2, Clock,
} from 'lucide-react';
import {
  DEFAULT_ROUTING_CONFIG, ZONE_KINDS, resolveDirection, validateRoutingConfig,
  overflowNote, setZoneStatus, listAllComplaints, getActiveModifiers,
} from '@triagepulse/clinical';
import { api } from '@/api/client';
import { syncRoutingConfigFromApi } from '@/lib/routingConfigSync';

/**
 * Admin: patient direction for this facility — zones and direction rules per
 * department. The CTAS core (resus for CTAS 1–2 and life threats, respiratory
 * isolation, a zone only takes the levels it accepts) is fixed and shown read-only.
 */

const LEVELS = [1, 2, 3, 4, 5];
const KIND_LABEL = {
  resus: 'إنعاش · Resuscitation',
  observation: 'ملاحظة · Observation',
  clinic: 'عيادة · Clinic',
  fast_track: 'مسار سريع · Fast Track',
  respiratory: 'عزل تنفسي · Respiratory',
  other: 'أخرى · Other',
};
const clone = (x) => JSON.parse(JSON.stringify(x));
const input = 'w-full min-h-[40px] border border-mist rounded-xl px-3 py-2 text-sm text-ink bg-white';
const btnGhost = 'inline-flex items-center gap-1.5 min-h-[40px] px-3 rounded-xl border border-mist text-sm text-ink hover:bg-paper';

function LevelChips({ value = [], onChange, allowed = LEVELS, label }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={label}>
      {allowed.map((l) => {
        const on = value.includes(l);
        return (
          <button
            key={l}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? value.filter((x) => x !== l) : [...value, l].sort())}
            className={`min-w-[40px] min-h-[36px] rounded-lg text-sm font-semibold border ${on ? 'bg-ink text-white border-ink' : 'bg-white text-graphite border-mist'}`}
          >
            {l}
          </button>
        );
      })}
    </div>
  );
}

function Field({ label, children, className = '' }) {
  return (
    <label className={`flex flex-col gap-1 text-xs text-graphite ${className}`}>
      <span className="font-medium">{label}</span>
      {children}
    </label>
  );
}

function ZoneCard({ zone, zones, dept, busy, onChange, onRemove, onBusy, canRemove }) {
  const set = (k, v) => onChange({ ...zone, [k]: v });
  return (
    <div className="border border-mist rounded-2xl p-3 flex flex-col gap-3 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-ink">
          {zone.name_ar || '—'} · {zone.name_en || '—'}
          <span className="text-xs font-normal text-graphite"> · {zone.code}</span>
        </p>
        <div className="flex items-center gap-2">
          <label className="inline-flex items-center gap-1.5 text-xs text-ink">
            <input type="checkbox" checked={!!busy} onChange={(e) => onBusy(e.target.checked)} />
            مزدحم الآن · Busy now
          </label>
          <label className="inline-flex items-center gap-1.5 text-xs text-ink">
            <input type="checkbox" checked={zone.active !== false} onChange={(e) => set('active', e.target.checked)} />
            فعّالة · Active
          </label>
          {canRemove && (
            <button type="button" onClick={onRemove} className="p-2 rounded-lg hover:bg-paper" aria-label={`Remove ${zone.name_en}`}>
              <Trash2 className="w-4 h-4 text-graphite" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <Field label="الاسم بالعربية"><input className={input} dir="rtl" value={zone.name_ar} onChange={(e) => set('name_ar', e.target.value)} /></Field>
        <Field label="Name (English)"><input className={input} dir="ltr" value={zone.name_en} onChange={(e) => set('name_en', e.target.value)} /></Field>
        <Field label="النوع · Kind">
          <select className={input} value={zone.kind} onChange={(e) => set('kind', e.target.value)}>
            {ZONE_KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
          </select>
        </Field>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="المستوى الافتراضي لهذه المنطقة · Default for CTAS">
          <LevelChips label="Default levels" value={zone.default_levels || []} onChange={(v) => set('default_levels', v)} />
        </Field>
        <Field label="المستويات المقبولة (عبر القواعد) · Can receive CTAS">
          <LevelChips label="Accepted levels" value={zone.accepts_levels || []} onChange={(v) => set('accepts_levels', v)} />
        </Field>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-graphite flex items-center gap-1"><Clock className="w-3.5 h-3.5" aria-hidden="true" /> مغلقة من – إلى · Closed hours</span>
          {(zone.closed_hours || []).map((w, i) => (
            <div key={i} className="flex items-center gap-2" dir="ltr">
              <input type="time" className={input} value={w.from} onChange={(e) => set('closed_hours', zone.closed_hours.map((x, j) => (j === i ? { ...x, from: e.target.value } : x)))} aria-label="Closed from" />
              <span className="text-graphite">–</span>
              <input type="time" className={input} value={w.to} onChange={(e) => set('closed_hours', zone.closed_hours.map((x, j) => (j === i ? { ...x, to: e.target.value } : x)))} aria-label="Closed to" />
              <button type="button" className="p-2 rounded-lg hover:bg-paper" onClick={() => set('closed_hours', zone.closed_hours.filter((_, j) => j !== i))} aria-label="Remove closed hours">
                <Trash2 className="w-4 h-4 text-graphite" aria-hidden="true" />
              </button>
            </div>
          ))}
          <button type="button" className={`${btnGhost} self-start`} onClick={() => set('closed_hours', [...(zone.closed_hours || []), { from: '06:00', to: '14:00' }])}>
            <Plus className="w-4 h-4" aria-hidden="true" /> إضافة وقت إغلاق · Add closed hours
          </button>
        </div>
        <Field label="عند الإغلاق أو الازدحام حوّل إلى · When closed or busy, send to">
          <select className={input} value={zone.overflow_to || ''} onChange={(e) => set('overflow_to', e.target.value || null)}>
            <option value="">— لا تحويل · No overflow —</option>
            {zones.filter((z) => z.code !== zone.code).map((z) => <option key={z.code} value={z.code}>{z.name_ar} · {z.name_en}</option>)}
          </select>
        </Field>
      </div>
      <p className="sr-only">{dept.code}</p>
    </div>
  );
}

function RuleCard({ rule, index, count, zones, complaintOptions, answerOptions, onChange, onMove, onRemove }) {
  const w = rule.when || {};
  const setWhen = (k, v) => onChange({ ...rule, when: { ...w, [k]: v } });
  const set = (k, v) => onChange({ ...rule, [k]: v });
  const [pick, setPick] = useState('');
  return (
    <div className={`border rounded-2xl p-3 flex flex-col gap-3 bg-white ${rule.active === false ? 'border-dashed border-mist opacity-70' : 'border-mist'}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-ink">
          <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-paper text-xs me-1.5">{index + 1}</span>
          {rule.name_ar || '—'} · {rule.name_en || '—'}
        </p>
        <div className="flex items-center gap-1">
          <label className="inline-flex items-center gap-1.5 text-xs text-ink me-2">
            <input type="checkbox" checked={rule.active !== false} onChange={(e) => set('active', e.target.checked)} />
            فعّالة · Active
          </label>
          <button type="button" disabled={index === 0} onClick={() => onMove(-1)} className="p-2 rounded-lg hover:bg-paper disabled:opacity-30" aria-label="Move up"><ArrowUp className="w-4 h-4" aria-hidden="true" /></button>
          <button type="button" disabled={index === count - 1} onClick={() => onMove(1)} className="p-2 rounded-lg hover:bg-paper disabled:opacity-30" aria-label="Move down"><ArrowDown className="w-4 h-4" aria-hidden="true" /></button>
          <button type="button" onClick={onRemove} className="p-2 rounded-lg hover:bg-paper" aria-label="Delete rule"><Trash2 className="w-4 h-4 text-graphite" aria-hidden="true" /></button>
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <Field label="اسم القاعدة بالعربية"><input className={input} dir="rtl" value={rule.name_ar || ''} onChange={(e) => set('name_ar', e.target.value)} /></Field>
        <Field label="Rule name (English)"><input className={input} dir="ltr" value={rule.name_en || ''} onChange={(e) => set('name_en', e.target.value)} /></Field>
      </div>

      <div className="bg-paper rounded-xl p-3 flex flex-col gap-3">
        <p className="text-xs font-semibold text-ink">إذا · IF (كل الشروط · all conditions)</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <Field label="العمر من · Age from"><input type="number" min="0" className={input} value={w.age_min ?? ''} onChange={(e) => setWhen('age_min', e.target.value === '' ? null : Number(e.target.value))} /></Field>
          <Field label="أقل من · Under"><input type="number" min="0" className={input} value={w.age_max ?? ''} onChange={(e) => setWhen('age_max', e.target.value === '' ? null : Number(e.target.value))} /></Field>
          <Field label="من الساعة · From" className="sm:col-span-1"><input type="time" className={input} value={w.time?.from || ''} onChange={(e) => setWhen('time', e.target.value || w.time?.to ? { ...(w.time || {}), from: e.target.value } : null)} /></Field>
          <Field label="إلى · To"><input type="time" className={input} value={w.time?.to || ''} onChange={(e) => setWhen('time', e.target.value || w.time?.from ? { ...(w.time || {}), to: e.target.value } : null)} /></Field>
        </div>
        <Field label="مستوى CTAS (أي منها) · CTAS level (any)">
          <LevelChips label="Rule levels" value={w.levels || []} onChange={(v) => setWhen('levels', v)} />
        </Field>
        <Field label="الشكوى (أي منها) · Complaint (any)">
          <div className="flex flex-wrap gap-1.5">
            {(w.complaints || []).map((k) => {
              const c = complaintOptions.find((o) => o.complaintKey === k);
              return (
                <span key={k} className="inline-flex items-center gap-1 bg-white border border-mist rounded-full ps-3 pe-1 py-0.5 text-xs text-ink">
                  {c ? `${c.label_ar} · ${c.label_en}` : k}
                  <button type="button" className="p-1" onClick={() => setWhen('complaints', w.complaints.filter((x) => x !== k))} aria-label={`Remove ${k}`}>×</button>
                </span>
              );
            })}
          </div>
          <select className={input} value={pick} onChange={(e) => { const v = e.target.value; setPick(''); if (v && !(w.complaints || []).includes(v)) setWhen('complaints', [...(w.complaints || []), v]); }}>
            <option value="">+ إضافة شكوى · Add complaint</option>
            {complaintOptions.map((c) => <option key={c.complaintKey} value={c.complaintKey}>{c.label_ar} · {c.label_en}</option>)}
          </select>
        </Field>
        <Field label="كلمات في الشكوى (افصل بفاصلة) · Words in the complaint (comma-separated)">
          <input className={input} value={(w.keywords || []).join('، ')} onChange={(e) => setWhen('keywords', e.target.value.split(/[,،]/).map((x) => x.trim()).filter(Boolean))} placeholder="جرح، wound، cut" />
        </Field>
        <Field label="أجاب «نعم» على (كلها مطلوبة) · Answered “Yes” to (all required)">
          <div className="flex flex-wrap gap-1.5">
            {(w.answers || []).map((a) => {
              const m = answerOptions.find((o) => o.field === a.field);
              return (
                <span key={a.field} className="inline-flex items-center gap-1 bg-white border border-mist rounded-full ps-3 pe-1 py-0.5 text-xs text-ink">
                  {m ? `${m.name_ar} · ${m.name}` : a.field}: نعم · Yes
                  <button type="button" className="p-1" onClick={() => setWhen('answers', w.answers.filter((x) => x.field !== a.field))} aria-label={`Remove ${a.field}`}>×</button>
                </span>
              );
            })}
          </div>
          <select className={input} value="" onChange={(e) => { const v = e.target.value; if (v && !(w.answers || []).some((a) => a.field === v)) setWhen('answers', [...(w.answers || []), { field: v, value: 'yes' }]); }}>
            <option value="">+ إضافة سؤال · Add question</option>
            {answerOptions.map((m) => <option key={m.field} value={m.field}>{m.name_ar} · {m.name}</option>)}
          </select>
        </Field>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <Field label="فوجّه إلى · THEN send to">
          <select className={input} value={rule.zone || ''} onChange={(e) => set('zone', e.target.value)}>
            <option value="">—</option>
            {zones.map((z) => <option key={z.code} value={z.code}>{z.name_ar} · {z.name_en}</option>)}
          </select>
        </Field>
        <Field label="السبب للممرض (عربي)"><input className={input} dir="rtl" value={rule.reason_ar || ''} onChange={(e) => set('reason_ar', e.target.value)} /></Field>
        <Field label="Reason shown to the nurse (English)"><input className={input} dir="ltr" value={rule.reason_en || ''} onChange={(e) => set('reason_en', e.target.value)} /></Field>
      </div>
    </div>
  );
}

function TestPanel({ config, dept, complaintOptions, answerOptions }) {
  const [age, setAge] = useState(dept.code === 'PED' ? 5 : 30);
  const [level, setLevel] = useState(4);
  const [complaint, setComplaint] = useState('');
  const [text, setText] = useState('');
  const [answers, setAnswers] = useState([]);
  const [time, setTime] = useState(() => new Date().toTimeString().slice(0, 5));
  useEffect(() => { setAge(dept.code === 'PED' ? 5 : 30); }, [dept.code]);
  const now = useMemo(() => {
    const [h, m] = time.split(':').map(Number);
    // Facility time zone is Riyadh (UTC+3).
    return new Date(Date.UTC(2026, 0, 1, (h - 3 + 24) % 24, m || 0));
  }, [time]);
  const result = useMemo(() => {
    try {
      return resolveDirection({
        level, age, config, now,
        complaints: [{ key: complaint || null, text }],
        answers: Object.fromEntries(answers.map((f) => [f, 'نعم'])),
      });
    } catch { return null; }
  }, [config, level, age, complaint, text, answers, now]);
  const note = result ? overflowNote(result) : null;
  return (
    <section className="tp-card p-4 flex flex-col gap-3" aria-labelledby="rt-test">
      <h2 id="rt-test" className="text-[15px] font-semibold text-ink flex items-center gap-2"><FlaskConical className="w-4 h-4" aria-hidden="true" /> جرّب قبل النشر · Try before publishing</h2>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Field label="العمر · Age"><input type="number" min="0" className={input} value={age} onChange={(e) => setAge(e.target.value)} /></Field>
        <Field label="الساعة · Time"><input type="time" className={input} value={time} onChange={(e) => setTime(e.target.value)} /></Field>
        <Field label="CTAS" className="col-span-2"><LevelChips label="Test level" value={[level]} onChange={(v) => setLevel(v.filter((x) => x !== level)[0] || level)} /></Field>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <Field label="الشكوى · Complaint">
          <select className={input} value={complaint} onChange={(e) => setComplaint(e.target.value)}>
            <option value="">—</option>
            {complaintOptions.map((c) => <option key={c.complaintKey} value={c.complaintKey}>{c.label_ar} · {c.label_en}</option>)}
          </select>
        </Field>
        <Field label="أو نص الشكوى · or complaint text"><input className={input} value={text} onChange={(e) => setText(e.target.value)} placeholder="جرح في القدم" /></Field>
      </div>
      <div className="flex flex-wrap gap-2">
        {answerOptions.map((m) => (
          <label key={m.field} className="inline-flex items-center gap-1.5 text-xs text-ink bg-paper rounded-full px-3 py-1">
            <input type="checkbox" checked={answers.includes(m.field)} onChange={(e) => setAnswers(e.target.checked ? [...answers, m.field] : answers.filter((x) => x !== m.field))} />
            {m.name_ar} · {m.name}
          </label>
        ))}
      </div>
      <div className="rounded-2xl border border-mist p-3 bg-paper" aria-live="polite">
        {result ? (
          <>
            <p className="text-base font-semibold text-ink">{result.destination_ar} · {result.destination_en}</p>
            <p className="text-sm text-graphite">
              {result.reason_ar ? `${result.reason_ar} · ${result.reason_en}` : result.from_isolation_hold ? 'عزل تنفسي · Respiratory isolation' : `CTAS ${level} — المنطقة الافتراضية · default zone`}
            </p>
            {note && <p className="text-sm text-ink mt-1">{note.ar} · {note.en}</p>}
          </>
        ) : <p className="text-sm text-graphite">لا توجد منطقة · No zone</p>}
      </div>
    </section>
  );
}

export default function RoutingAdmin() {
  const [loading, setLoading] = useState(true);
  const [current, setCurrent] = useState(null);
  const [draft, setDraft] = useState(null);
  const [deptCode, setDeptCode] = useState('PED');
  const [history, setHistory] = useState([]);
  const [changelog, setChangelog] = useState('');
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState({});

  const complaintOptions = useMemo(() => {
    try { return [...listAllComplaints()].sort((a, b) => a.label_en.localeCompare(b.label_en)); } catch { return []; }
  }, []);
  const answerOptions = useMemo(() => {
    try { return getActiveModifiers().filter((m) => m.answer_type === 'yes_no'); } catch { return []; }
  }, []);

  const load = async () => {
    setLoading(true);
    try {
      const cur = await api.routingConfig.current();
      setCurrent(cur);
      setDraft(clone(cur.config || DEFAULT_ROUTING_CONFIG));
      setStatus(cur.zone_status || {});
      setZoneStatus(cur.zone_status || {});
      setHistory(await api.routingConfig.history().catch(() => []));
    } catch (err) {
      toast.error(err?.message || 'Failed to load routing settings');
      setDraft(clone(DEFAULT_ROUTING_CONFIG));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const errors = useMemo(() => (draft ? validateRoutingConfig(draft) : []), [draft]);
  const dirty = useMemo(() => draft && current && JSON.stringify(draft) !== JSON.stringify(current.config), [draft, current]);

  if (loading || !draft) {
    return <div className="flex justify-center py-16"><div className="w-8 h-8 border-4 border-mist border-t-ink rounded-full animate-spin" /></div>;
  }

  const dept = draft.departments.find((d) => d.code === deptCode) || draft.departments[0];
  const updateDept = (fn) => setDraft((prev) => ({ ...prev, departments: prev.departments.map((d) => (d.code === dept.code ? fn(clone(d)) : d)) }));
  const zoneUsed = (code) => dept.rules.some((r) => r.zone === code) || dept.zones.some((z) => z.overflow_to === code);

  const setBusy = async (zoneCode, busy) => {
    try {
      const s = await api.routingConfig.setBusy(dept.code, zoneCode, busy);
      setStatus(s);
      setZoneStatus(s);
      toast.success(busy ? 'تم تحديد المنطقة كمزدحمة · Marked busy' : 'تم إلغاء الازدحام · No longer busy');
    } catch (err) {
      toast.error(err?.message || 'Could not update');
    }
  };

  const publish = async () => {
    setSaving(true);
    try {
      const res = await api.routingConfig.publish({ config: draft, changelog: changelog || 'Routing update' });
      toast.success(`نُشر · Published ${res.version}`);
      setChangelog('');
      await syncRoutingConfigFromApi();
      await load();
    } catch (err) {
      toast.error(err?.message || 'Publish failed');
    } finally {
      setSaving(false);
    }
  };

  const activate = async (id) => {
    try {
      await api.routingConfig.activate(id);
      await syncRoutingConfigFromApi();
      await load();
      toast.success('تم التفعيل · Activated');
    } catch (err) { toast.error(err?.message || 'Activate failed'); }
  };
  const useBuiltin = async () => {
    try {
      await api.routingConfig.useBuiltin();
      await syncRoutingConfigFromApi();
      await load();
      toast.success('عاد إلى الإعداد الأساسي · Built-in configuration active');
    } catch (err) { toast.error(err?.message || 'Failed'); }
  };

  return (
    <div dir="rtl" className="max-w-5xl mx-auto flex flex-col gap-4 pb-28">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink flex items-center gap-2">
            <Signpost className="w-5 h-5" aria-hidden="true" /> توجيه المرضى · Patient direction
          </h1>
          <p className="text-sm text-graphite mt-1">
            المناطق وقواعد التوجيه لهذه المنشأة · Zones and direction rules for this facility
          </p>
          <p className="text-xs text-graphite mt-1">
            {current?.source === 'published' ? `منشور · Published ${current.version}` : 'الإعداد الأساسي · Built-in configuration'}
            {dirty && <span className="text-ink font-semibold"> · تغييرات غير منشورة · Unpublished changes</span>}
          </p>
        </div>
        <div className="flex gap-2">
          {dirty && <button type="button" className={btnGhost} onClick={() => setDraft(clone(current.config))}>تجاهل التغييرات · Discard</button>}
          <button type="button" className={btnGhost} onClick={load}><RotateCcw className="w-4 h-4" aria-hidden="true" /> تحديث · Reload</button>
        </div>
      </header>

      <section className="tp-card p-4 flex gap-3 items-start" aria-label="CTAS core">
        <Lock className="w-5 h-5 text-graphite shrink-0 mt-0.5" aria-hidden="true" />
        <div className="text-sm text-ink">
          <p className="font-semibold">أساس CTAS (دولي — ثابت لكل المنشآت) · CTAS core (international, fixed)</p>
          <ul className="list-disc ps-5 text-graphite mt-1 flex flex-col gap-0.5">
            <li>CTAS 1–2 وعلامات الخطر → منطقة الإنعاش · CTAS 1–2 and life-threat findings → Resuscitation zone</li>
            <li>العزل التنفسي من الفرز البصري يبقى · Respiratory isolation from visual triage holds</li>
            <li>لا تُوجَّه حالة لمنطقة لا تستقبل مستواها · A patient never goes to a zone that does not take their CTAS level</li>
          </ul>
        </div>
      </section>

      <div className="flex gap-2" role="tablist" aria-label="Department">
        {draft.departments.map((d) => (
          <button
            key={d.code}
            type="button"
            role="tab"
            aria-selected={d.code === dept.code}
            onClick={() => setDeptCode(d.code)}
            className={`min-h-[44px] px-4 rounded-xl text-sm font-semibold border ${d.code === dept.code ? 'bg-ink text-white border-ink' : 'bg-white text-ink border-mist'}`}
          >
            {d.name_ar} · {d.name_en}
            <span className="font-normal opacity-75"> ({d.age_max != null ? `< ${d.age_max}` : `≥ ${d.age_min ?? 0}`} y)</span>
          </button>
        ))}
      </div>

      <section className="tp-card p-4 flex flex-col gap-3" aria-labelledby="rt-zones">
        <h2 id="rt-zones" className="text-[15px] font-semibold text-ink">١. المناطق · Zones</h2>
        {dept.zones.map((z, i) => (
          <ZoneCard
            key={z.code}
            zone={z}
            zones={dept.zones}
            dept={dept}
            busy={status?.[dept.code]?.[z.code]?.busy}
            canRemove={!zoneUsed(z.code) && z.kind !== 'resus'}
            onChange={(nz) => updateDept((d) => { d.zones[i] = nz; return d; })}
            onRemove={() => updateDept((d) => { d.zones.splice(i, 1); return d; })}
            onBusy={(b) => setBusy(z.code, b)}
          />
        ))}
        <button
          type="button"
          className={`${btnGhost} self-start`}
          onClick={() => updateDept((d) => {
            const code = `ZONE_${Date.now().toString(36).toUpperCase()}`;
            d.zones.push({ code, kind: 'other', name_ar: 'منطقة جديدة', name_en: 'New zone', color: '#888780', default_levels: [], accepts_levels: [4, 5], closed_hours: [], overflow_to: null, active: true });
            return d;
          })}
        >
          <Plus className="w-4 h-4" aria-hidden="true" /> إضافة منطقة · Add zone
        </button>
      </section>

      <section className="tp-card p-4 flex flex-col gap-3" aria-labelledby="rt-rules">
        <h2 id="rt-rules" className="text-[15px] font-semibold text-ink">٢. قواعد التوجيه · Direction rules</h2>
        <p className="text-xs text-graphite">تُطبَّق بالترتيب؛ أول قاعدة مطابقة تحدد المنطقة · Checked in order; the first matching rule sets the zone. Otherwise the default zone for the CTAS level is used.</p>
        {dept.rules.map((r, i) => (
          <RuleCard
            key={r.id}
            rule={r}
            index={i}
            count={dept.rules.length}
            zones={dept.zones}
            complaintOptions={complaintOptions}
            answerOptions={answerOptions}
            onChange={(nr) => updateDept((d) => { d.rules[i] = nr; return d; })}
            onMove={(dir) => updateDept((d) => { const [x] = d.rules.splice(i, 1); d.rules.splice(i + dir, 0, x); return d; })}
            onRemove={() => updateDept((d) => { d.rules.splice(i, 1); return d; })}
          />
        ))}
        <button
          type="button"
          className={`${btnGhost} self-start`}
          onClick={() => updateDept((d) => {
            const obs = d.zones.find((z) => z.kind === 'observation') || d.zones[0];
            d.rules.push({ id: `rule_${Date.now().toString(36)}`, active: true, name_ar: 'قاعدة جديدة', name_en: 'New rule', when: { levels: [4, 5] }, zone: obs?.code, reason_ar: '', reason_en: '' });
            return d;
          })}
        >
          <Plus className="w-4 h-4" aria-hidden="true" /> إضافة قاعدة · Add rule
        </button>
      </section>

      <TestPanel config={draft} dept={dept} complaintOptions={complaintOptions} answerOptions={answerOptions} />

      <section className="tp-card p-4 flex flex-col gap-3" aria-labelledby="rt-publish">
        <h2 id="rt-publish" className="text-[15px] font-semibold text-ink">النشر · Publish</h2>
        {errors.length > 0 ? (
          <div className="rounded-xl border border-[#F2C230] bg-[#FFF8E1] p-3" role="alert">
            <p className="text-sm font-semibold text-ink flex items-center gap-1.5"><AlertTriangle className="w-4 h-4" aria-hidden="true" /> يجب تصحيح ما يلي قبل النشر · Fix before publishing</p>
            <ul className="list-disc ps-5 text-sm text-ink mt-1">
              {errors.map((e, i) => <li key={i}>{e.ar} · {e.en} <span className="text-graphite">({e.where})</span></li>)}
            </ul>
          </div>
        ) : (
          <p className="text-sm text-ink flex items-center gap-1.5"><CheckCircle2 className="w-4 h-4" aria-hidden="true" /> الإعداد سليم · Configuration is valid</p>
        )}
        <Field label="ملاحظات النشر · Changelog">
          <textarea className={input} rows={2} value={changelog} onChange={(e) => setChangelog(e.target.value)} placeholder="ما الذي تغيّر ولماذا؟ · What changed and why?" />
        </Field>
        <button
          type="button"
          disabled={saving || errors.length > 0 || (!dirty && current?.source === 'published')}
          onClick={publish}
          className="inline-flex items-center justify-center gap-2 min-h-[48px] px-5 rounded-2xl bg-ink text-white font-semibold disabled:opacity-40 self-start"
        >
          <Save className="w-4 h-4" aria-hidden="true" /> {saving ? 'جارٍ النشر… · Publishing…' : 'نشر الإصدار · Publish version'}
        </button>
      </section>

      <section className="tp-card p-4 flex flex-col gap-2" aria-labelledby="rt-history">
        <h2 id="rt-history" className="text-[15px] font-semibold text-ink flex items-center gap-2"><History className="w-4 h-4" aria-hidden="true" /> الإصدارات · Versions</h2>
        {history.length === 0 && <p className="text-sm text-graphite">لا توجد إصدارات منشورة — الإعداد الأساسي فعّال · No published versions — built-in configuration active</p>}
        {history.map((h) => (
          <div key={h.id} className="flex items-center justify-between gap-3 border border-mist rounded-xl px-3 py-2">
            <div>
              <p className="text-sm font-semibold text-ink">{h.version} {h.isActive && <span className="text-xs font-normal">· فعّال · active</span>}</p>
              <p className="text-xs text-graphite">{new Date(h.publishedAt).toLocaleString('ar-SA')} — {h.publishedBy?.fullName || h.publishedBy?.email || ''} — {h.changelog || '—'}</p>
            </div>
            {!h.isActive && <button type="button" className={btnGhost} onClick={() => activate(h.id)}>تفعيل · Activate</button>}
          </div>
        ))}
        {current?.source === 'published' && (
          <button type="button" className={`${btnGhost} self-start`} onClick={useBuiltin}>العودة إلى الإعداد الأساسي · Use built-in configuration</button>
        )}
      </section>
    </div>
  );
}
