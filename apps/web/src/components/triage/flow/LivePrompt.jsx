import { MessageCircle } from 'lucide-react';

/**
 * Proactive guidance while recording: what to mention next. It guides information
 * collection only; acuity still comes from the CTAS rules.
 */
export default function LivePrompt({ prompt, question }) {
  if (!prompt && !question) return null;
  return (
    <div role="status" aria-live="polite" className="rounded-2xl border-2 border-ink bg-white px-3 py-2 flex items-start gap-2">
      <MessageCircle className="w-5 h-5 shrink-0 mt-0.5 text-ink" aria-hidden="true" />
      {prompt ? (
        <p className="text-[15px] text-ink leading-snug">
          <span className="font-semibold">{prompt.ar}</span>
          <span className="block text-sm text-graphite" dir="ltr">{prompt.en}</span>
        </p>
      ) : (
        <p className="text-[15px] text-ink leading-snug">
          <span className="font-semibold">اسأل أيضاً: {question.text_ar}</span>
          {question.text_en && <span className="block text-sm text-graphite" dir="ltr">Also ask: {question.text_en}</span>}
        </p>
      )}
    </div>
  );
}
