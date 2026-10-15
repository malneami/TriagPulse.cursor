import { useState } from 'react';
import { ChevronDown, RotateCcw, ShieldAlert } from 'lucide-react';

export const ANSWER_YES = 'نعم';
export const ANSWER_NO = 'لا';
/** Recorded for documentation only; never sent to the CTAS engine as a positive or negative. */
export const ANSWER_UNKNOWN = 'غير معروف';

export function answerLabel(value) {
  if (value === ANSWER_YES) return 'نعم · Yes';
  if (value === ANSWER_NO) return 'لا · No';
  if (value === ANSWER_UNKNOWN) return 'غير معروف · Unknown';
  return String(value ?? '');
}

function options(question) {
  const isOptions = question.answer_type === 'options' && question.answer_options?.length;
  const opts = isOptions
    ? (question._options || question.answer_options.map((v) => ({ value: v, label: v })))
    : [{ value: ANSWER_YES, label: answerLabel(ANSWER_YES) }, { value: ANSWER_NO, label: answerLabel(ANSWER_NO) }];
  // Some questions already offer their own "uncertain" choice; do not add a second one.
  const ownUnknown = opts.some((o) => /uncertain|unknown|غير واضح|غير معروف/i.test(`${o.value} ${o.label}`));
  return ownUnknown ? opts : [...opts, { value: ANSWER_UNKNOWN, label: answerLabel(ANSWER_UNKNOWN) }];
}

/**
 * One clarifying question at a time, highest impact first. Answering moves straight
 * to the next one; the CTAS and direction cards update after every answer.
 */
export default function QuestionCard({ question, position, total, onAnswer, answered = [], onChangeAnswer }) {
  const [showAnswered, setShowAnswered] = useState(false);
  if (!question && !answered.length) return null;
  const all = question ? options(question) : [];
  const safety = question && (question.question_category || question.category) === 'safety_escalation';

  return (
    <section aria-labelledby="q-title" className="bg-white rounded-2xl border-2 border-ink p-3 flex flex-col gap-3">
      {question && (
        <>
          <div className="flex items-start gap-2">
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-graphite flex items-center gap-1">
                {safety && <ShieldAlert className="w-3.5 h-3.5 text-[#D3242C]" aria-hidden="true" />}
                سؤال توضيحي <span dir="ltr">{position}/{total}</span> · Clarifying question
                {safety && <span className="text-[#D3242C]"> · سلامة / safety</span>}
              </p>
              <h2 id="q-title" className="text-[17px] font-semibold text-ink leading-snug mt-0.5">{question.text_ar}</h2>
              {question.text_en && <p dir="ltr" className="text-sm text-graphite text-start">{question.text_en}</p>}
            </div>
          </div>
          <div className={`grid gap-2 ${all.length <= 3 ? 'grid-cols-3' : 'grid-cols-2 sm:grid-cols-3'}`}>
            {all.map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={() => onAnswer(question, o.value, o.label)}
                className={`min-h-[52px] px-2 rounded-xl border-2 text-[15px] font-semibold leading-tight ${
                  o.value === ANSWER_UNKNOWN ? 'border-dashed border-mist text-graphite' : 'border-mist text-ink hover:border-ink'
                } bg-white`}
              >
                {o.label}
              </button>
            ))}
          </div>
        </>
      )}

      {answered.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setShowAnswered((v) => !v)}
            aria-expanded={showAnswered}
            className="text-sm text-graphite underline min-h-[44px] flex items-center gap-1"
          >
            الإجابات ({answered.length}) · Answers
            <ChevronDown className={`w-4 h-4 transition-transform ${showAnswered ? 'rotate-180' : ''}`} aria-hidden="true" />
          </button>
          {showAnswered && (
            <ul className="list-none m-0 p-0 divide-y divide-mist">
              {answered.map((a) => (
                <li key={a.field} className="py-1.5 flex items-center gap-2">
                  <span className="flex-1 min-w-0 text-sm text-ink truncate">{a.text_ar || a.text_en || a.field}</span>
                  <span className="text-sm font-semibold shrink-0">{a.label || answerLabel(a.value)}</span>
                  <button
                    type="button"
                    onClick={() => onChangeAnswer(a.field)}
                    className="w-11 h-11 shrink-0 rounded-lg flex items-center justify-center text-graphite hover:bg-paper"
                    aria-label={`تغيير الإجابة / Change answer: ${a.text_en || a.field}`}
                  >
                    <RotateCcw className="w-4 h-4" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
