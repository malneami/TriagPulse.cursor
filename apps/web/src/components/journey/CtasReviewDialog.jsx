import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { api } from '@/api/client';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { CTAS_LEVELS, ctasFill, ctasMeta } from '@/lib/ctasStyle';
import { ticketCode } from '@/lib/ticket';
import { REVIEW_REASONS, reasonText } from '@triagepulse/clinical';

/**
 * Physician check of the triage level (Stage A reference for nurse feedback).
 * Agree with the level, or pick another with a reason. Role and time are recorded by the server.
 * "Condition changed after triage" keeps a deterioration from counting against the nurse.
 */

const REASONS = REVIEW_REASONS;

export default function CtasReviewDialog({ patient, open, onOpenChange, mode = 'seen', onDone }) {
  const current = patient?.ctas_level ?? null;
  const [level, setLevel] = useState(current);
  const [chips, setChips] = useState([]);
  const [note, setNote] = useState('');
  const [changed, setChanged] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) { setLevel(current); setChips([]); setNote(''); setChanged(false); setError(''); }
  }, [open, current]);

  if (!patient) return null;
  const agreed = level === current;
  const reason = reasonText(chips, note);
  const canSave = level != null && (agreed || reason.length > 0);

  const toggleChip = (en) => setChips((c) => (c.includes(en) ? c.filter((x) => x !== en) : [...c, en]));

  const save = async (markSeen) => {
    if (!canSave) { setError('اكتب سبباً مختصراً للمستوى الجديد / Give a short reason for the new level'); return; }
    setSaving(true);
    setError('');
    try {
      await api.journeys.reviewCtas(patient.id, { level, reason: agreed ? undefined : reason, markSeen, conditionChanged: !agreed && changed });
      const code = ticketCode(patient.ticket_no);
      toast.success(agreed
        ? `${code} — موافق على CTAS ${level}${markSeen ? ' · فحصه الطبيب' : ''} / Agreed`
        : `${code} — أُعيد الفرز إلى CTAS ${level}${markSeen ? ' · فحصه الطبيب' : ''} / Re-triaged`);
      onDone?.();
      onOpenChange(false);
    } catch (err) {
      setError(err?.message || 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  const primarySeen = mode === 'seen';
  const seenLabel = agreed ? `موافق CTAS ${level} + فحصه الطبيب` : `CTAS ${level} + فحصه الطبيب`;
  const onlyLabel = agreed ? `موافق CTAS ${level} فقط` : `إعادة الفرز إلى ${level} فقط`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-w-lg">
        <DialogTitle className="text-lg">
          مراجعة الطبيب لمستوى الفرز <span dir="ltr" className="text-graphite">{ticketCode(patient.ticket_no)}</span>
        </DialogTitle>
        <DialogDescription className="text-sm text-graphite">
          Physician check of the triage level. Agree, or choose another level with a reason. Your role and the time are recorded.
        </DialogDescription>

        <div className="flex items-center gap-2 text-[15px]">
          <span className="text-graphite">المستوى الحالي / Current:</span>
          <span className="rounded-md px-2 py-0.5 font-semibold" style={ctasFill(current)}>CTAS {current ?? '—'}</span>
          <span className="text-graphite text-sm">{ctasMeta(current).ar}</span>
        </div>

        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium mb-1">رأيك / Your level</legend>
          <div className="grid grid-cols-5 gap-2">
            {CTAS_LEVELS.map((l) => (
              <button
                key={l}
                type="button"
                aria-pressed={level === l}
                onClick={() => setLevel(l)}
                className={`h-14 rounded-xl text-xl font-bold ${level === l ? 'ring-4 ring-ink ring-offset-2' : 'opacity-70'}`}
                style={ctasFill(l)}
              >
                {l}
              </button>
            ))}
          </div>
        </fieldset>

        {!agreed && (
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium">السبب (مطلوب) / Reason (required)</span>
            <div className="flex flex-wrap gap-2">
              {REASONS.map((r) => (
                <button
                  key={r.en}
                  type="button"
                  aria-pressed={chips.includes(r.en)}
                  onClick={() => toggleChip(r.en)}
                  className={`h-9 px-3 rounded-lg text-sm ${chips.includes(r.en) ? 'bg-ink text-white' : 'border border-mist text-ink'}`}
                >
                  {r.ar} · {r.en}
                </button>
              ))}
            </div>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={200}
              placeholder="تفاصيل قصيرة… / Short detail…"
              className="h-11 border border-mist rounded-xl px-3 text-[15px] bg-white"
            />
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" checked={changed} onChange={(e) => setChanged(e.target.checked)} className="mt-1 w-4 h-4" />
              <span>
                تغيّرت حالة المريض بعد الفرز — لا تُحسب على الممرض
                <span className="block text-graphite">The patient changed after triage — not counted against the triage nurse.</span>
              </span>
            </label>
          </div>
        )}

        {error && <p role="alert" className="text-sm font-semibold border-2 border-ink rounded-lg px-3 py-2">{error}</p>}

        <div className={`flex gap-2 ${primarySeen ? '' : 'flex-row-reverse'}`}>
          <button
            type="button"
            disabled={saving}
            onClick={() => save(true)}
            className={`flex-1 h-12 rounded-xl font-medium disabled:opacity-40 ${primarySeen ? 'bg-ink text-white' : 'border border-mist text-ink'}`}
          >
            {seenLabel}
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => save(false)}
            className={`flex-1 h-12 rounded-xl font-medium disabled:opacity-40 ${primarySeen ? 'border border-mist text-ink' : 'bg-ink text-white'}`}
          >
            {onlyLabel}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
