import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { api } from '@/api/client';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { CTAS_LEVELS, ctasFill, ctasMeta } from '@/lib/ctasStyle';
import { ticketCode } from '@/lib/ticket';
import { REVIEW_REASONS, reasonText } from '@triagepulse/clinical';

/**
 * Physician disagrees with the nurse CTAS: pick 1–5 (must differ) and a brief reason.
 * Agree is a one-step action on the validation board, not this dialog.
 */

const REASONS = REVIEW_REASONS;

export default function CtasReviewDialog({ patient, open, onOpenChange, onDone }) {
  const nurseLevel = patient?.nurse_ctas ?? patient?.ctas_level ?? null;
  const [level, setLevel] = useState(null);
  const [chips, setChips] = useState([]);
  const [note, setNote] = useState('');
  const [changed, setChanged] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) { setLevel(null); setChips([]); setNote(''); setChanged(false); setError(''); }
  }, [open]);

  if (!patient) return null;
  const reason = reasonText(chips, note);
  const differs = level != null && level !== nurseLevel;
  const canSave = differs && reason.length > 0;

  const toggleChip = (en) => setChips((c) => (c.includes(en) ? c.filter((x) => x !== en) : [...c, en]));

  const save = async () => {
    if (!canSave) {
      setError(level === nurseLevel
        ? 'المستوى نفسه = موافقة. اختر مستوى مختلفاً / Same level is Agree — pick a different CTAS'
        : 'اكتب سبباً مختصراً للمستوى الجديد / Give a short reason for the new level');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await api.journeys.reviewCtas(patient.id, { level, reason, conditionChanged: changed });
      toast.success(`${ticketCode(patient)} — غير موافق · CTAS ${nurseLevel} → ${level} / Disagreed`);
      onDone?.();
      onOpenChange(false);
    } catch (err) {
      setError(err?.message || 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-w-lg">
        <DialogTitle className="text-lg">
          غير موافق على مستوى الفرز <span dir="ltr" className="text-graphite">{ticketCode(patient)}</span>
        </DialogTitle>
        <DialogDescription className="text-sm text-graphite">
          Select the correct CTAS (1–5) and a brief reason. The nurse level is kept; your assessment is stored separately.
        </DialogDescription>

        <div className="flex items-center gap-2 text-[15px]">
          <span className="text-graphite">فرز الممرض / Nurse CTAS:</span>
          <span className="rounded-md px-2 py-0.5 font-semibold" style={ctasFill(nurseLevel)}>CTAS {nurseLevel ?? '—'}</span>
          <span className="text-graphite text-sm">{ctasMeta(nurseLevel).ar}</span>
        </div>

        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium mb-1">المستوى الصحيح / Correct level</legend>
          <div className="grid grid-cols-5 gap-2">
            {CTAS_LEVELS.map((l) => (
              <button
                key={l}
                type="button"
                aria-pressed={level === l}
                disabled={l === nurseLevel}
                title={l === nurseLevel ? 'Same as nurse — use Agree' : undefined}
                onClick={() => setLevel(l)}
                className={`h-14 rounded-xl text-xl font-bold disabled:opacity-30 ${level === l ? 'ring-4 ring-ink ring-offset-2' : 'opacity-70'}`}
                style={ctasFill(l)}
              >
                {l}
              </button>
            ))}
          </div>
        </fieldset>

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

        {error && <p role="alert" className="text-sm font-semibold border-2 border-ink rounded-lg px-3 py-2">{error}</p>}

        <button
          type="button"
          disabled={saving}
          onClick={save}
          className="h-12 rounded-xl font-medium bg-ink text-white disabled:opacity-40"
        >
          حفظ غير الموافق / Save disagreement
        </button>
      </DialogContent>
    </Dialog>
  );
}
