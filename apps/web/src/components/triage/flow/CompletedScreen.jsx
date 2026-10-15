import { useState } from 'react';
import { CheckCircle2, ClipboardCopy, FileText, Plus, Printer, Users } from 'lucide-react';
import { toast } from 'sonner';
import { ctasFill } from '@/lib/ctasStyle';

/** After saving: one confirmation, then the next actions. The record is shown on request. */
export default function CompletedScreen({ level, direction, document, onNewPatient, nextPatient, onOpenNext }) {
  const [showRecord, setShowRecord] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(document);
      toast.success('تم النسخ · Copied');
    } catch {
      setShowRecord(true);
      toast.error('تعذّر النسخ، حدّد النص يدوياً · Copy blocked, select the text');
    }
  };
  const print = () => {
    setShowRecord(true);
    setTimeout(() => window.print(), 50);
  };

  return (
    <section aria-labelledby="done-title" className="flex flex-col gap-4">
      <div className="tp-card px-5 py-8 flex flex-col items-center text-center gap-3">
        <CheckCircle2 className="w-14 h-14 text-ink" aria-hidden="true" />
        <h2 id="done-title" className="text-2xl font-semibold text-ink">تم إكمال الفرز بنجاح</h2>
        <p className="text-lg text-graphite">Triage Successfully Completed</p>
        <div className="flex flex-wrap justify-center items-center gap-3 mt-1">
          {level && (
            <span className="px-3 py-1 rounded-lg text-lg font-bold" style={ctasFill(level)}>CTAS {level}</span>
          )}
          {direction && <span className="text-lg font-semibold text-ink">{direction.destination_ar} · {direction.destination_en}</span>}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <button
          type="button"
          onClick={onNewPatient}
          className="min-h-[60px] rounded-xl bg-ink text-white text-lg font-semibold flex items-center justify-center gap-2 hover:bg-ink-deep"
        >
          <Plus className="w-5 h-5" aria-hidden="true" /> مريض جديد · New patient
        </button>
        <button
          type="button"
          onClick={() => setShowRecord((v) => !v)}
          aria-expanded={showRecord}
          className="min-h-[60px] rounded-xl border-2 border-ink text-ink text-lg font-semibold flex items-center justify-center gap-2"
        >
          <FileText className="w-5 h-5" aria-hidden="true" /> عرض السجل · View record
        </button>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={print} className="min-h-[60px] rounded-xl border border-mist text-ink font-semibold flex items-center justify-center gap-2">
            <Printer className="w-5 h-5" aria-hidden="true" /> طباعة · Print
          </button>
          <button type="button" onClick={copy} className="min-h-[60px] rounded-xl border border-mist text-ink font-semibold flex items-center justify-center gap-2">
            <ClipboardCopy className="w-5 h-5" aria-hidden="true" /> نسخ · Copy
          </button>
        </div>
      </div>

      {nextPatient && (
        <button
          type="button"
          onClick={onOpenNext}
          className="min-h-[52px] rounded-xl border border-mist bg-white text-ink flex items-center justify-center gap-2"
        >
          <Users className="w-5 h-5" aria-hidden="true" />
          المريض التالي بالانتظار · Next waiting: {nextPatient.patient_name_ar || nextPatient.patient_name_en || nextPatient.patient_id}
        </button>
      )}

      {showRecord && (
        <pre dir="ltr" className="print-area bg-white rounded-2xl border border-mist px-5 py-4 text-sm leading-relaxed text-ink whitespace-pre-wrap font-sans text-start">
          {document}
        </pre>
      )}
    </section>
  );
}
