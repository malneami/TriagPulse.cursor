import { useState } from 'react';
import { ChevronDown, Loader2, RotateCcw } from 'lucide-react';

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

function AnswerButtons({ question, onAnswer }) {
  const isOptions = question.answer_type === 'options' && question.answer_options?.length;
  const options = isOptions
    ? (question._options || question.answer_options.map((v) => ({ value: v, label: v })))
    : [{ value: ANSWER_YES, label: answerLabel(ANSWER_YES) }, { value: ANSWER_NO, label: answerLabel(ANSWER_NO) }];
  // Some questions already offer their own "uncertain" choice; do not add a second one.
  const hasOwnUnknown = options.some((o) => /uncertain|unknown|غير واضح|غير معروف/i.test(`${o.value} ${o.label}`));
  const all = hasOwnUnknown ? options : [...options, { value: ANSWER_UNKNOWN, label: answerLabel(ANSWER_UNKNOWN) }];
  const cols = all.length <= 3 ? 'grid-cols-3' : 'grid-cols-2 sm:grid-cols-3';
  return (
    <div className={`grid ${cols} gap-2`}>
      {all.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onAnswer(question, opt.value, opt.label)}
          className={`min-h-[56px] px-3 rounded-xl border-2 text-[15px] font-semibold leading-tight ${
            opt.value === ANSWER_UNKNOWN ? 'border-dashed border-mist text-graphite bg-white hover:border-graphite' : 'border-mist text-ink bg-white hover:border-ink'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Clarifying questions, one card per open question. Answered items move to a short
 * list below and can be changed; the result boxes update after every answer.
 */
export default function ClarifyStep({
  questions = [],
  answered = [],
  onAnswer,
  onChangeAnswer,
  change = null,
  modifierSelector = null,
  loading = false,
  onContinue,
}) {
  const [showModifiers, setShowModifiers] = useState(false);
  const open = questions.length;

  return (
    <section aria-labelledby="clarify-title" className="bg-white rounded-2xl border border-mist px-5 py-5 flex flex-col gap-5">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 id="clarify-title" className="text-lg font-semibold text-ink">الأسئلة التوضيحية</h2>
          <p className="text-sm text-graphite">Clarifying questions · فقط ما قد يغيّر المستوى أو التوجيه</p>
        </div>
        <p className="text-sm text-graphite" aria-live="polite">
          {open > 0 ? `${open} متبقية · remaining` : 'لا أسئلة متبقية · none remaining'}
        </p>
      </header>

      {change && (
        <div role="status" className="rounded-xl border-2 border-ink px-4 py-3 flex flex-col gap-1">
          <p className="text-[15px] font-semibold text-ink">
            {change.from != null && change.to != null && change.from !== change.to ? (
              <>تغيّر التقييم · Assessment changed: <span dir="ltr" className="tabular-nums">CTAS {change.from} → {change.to}</span></>
            ) : 'تغيّر التوجيه · Direction changed'}
          </p>
          {change.reason_ar && <p className="text-sm text-ink" dir="rtl">{change.reason_ar}</p>}
          {change.reason_en && <p className="text-sm text-graphite" dir="ltr">{change.reason_en}</p>}
        </div>
      )}

      {loading && (
        <p className="flex items-center gap-2 text-graphite"><Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" /> جارٍ تحديد الأسئلة · Selecting questions</p>
      )}

      {questions.map((q, i) => (
        <div key={q.id || q.field} className="flex flex-col gap-3">
          <div className="flex items-start gap-3">
            <span className="w-7 h-7 shrink-0 rounded-full bg-ink text-white text-sm font-semibold flex items-center justify-center">{i + 1}</span>
            <div className="min-w-0">
              <p className="text-[17px] font-semibold text-ink leading-snug">{q.text_ar}</p>
              {q.text_en && <p dir="ltr" className="text-[15px] text-graphite text-start">{q.text_en}</p>}
            </div>
          </div>
          <AnswerButtons question={q} onAnswer={onAnswer} />
        </div>
      ))}

      {!loading && open === 0 && (
        <p className="text-[15px] text-ink bg-paper rounded-xl px-4 py-3">
          لا توجد أسئلة إضافية لازمة لقرار آمن. · No further questions are needed for a safe decision.
        </p>
      )}

      {answered.length > 0 && (
        <div className="flex flex-col gap-1">
          <h3 className="text-sm font-semibold text-graphite">الإجابات · Answers</h3>
          <ul className="list-none m-0 p-0 divide-y divide-mist border-y border-mist">
            {answered.map((a) => (
              <li key={a.field} className="py-2 flex items-center gap-3">
                <span className="flex-1 min-w-0 text-sm text-ink">{a.text_ar || a.text_en || a.field}</span>
                <span className={`text-sm font-semibold shrink-0 ${a.value === ANSWER_UNKNOWN ? 'text-graphite' : 'text-ink'}`}>{a.label || answerLabel(a.value)}</span>
                <button
                  type="button"
                  onClick={() => onChangeAnswer(a.field)}
                  className="shrink-0 w-11 h-11 rounded-lg flex items-center justify-center text-graphite hover:bg-paper"
                  aria-label={`تغيير الإجابة / Change answer: ${a.text_en || a.field}`}
                >
                  <RotateCcw className="w-4 h-4" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {modifierSelector && (
        <div>
          <button
            type="button"
            onClick={() => setShowModifiers((v) => !v)}
            aria-expanded={showModifiers}
            className="text-sm text-ink underline min-h-[44px] flex items-center gap-1"
          >
            عرض محددة للشكوى (اختياري) · Complaint-specific presentation (optional)
            <ChevronDown className={`w-4 h-4 transition-transform ${showModifiers ? 'rotate-180' : ''}`} aria-hidden="true" />
          </button>
          {showModifiers && <div className="mt-2">{modifierSelector}</div>}
        </div>
      )}

      <button
        type="button"
        onClick={onContinue}
        className="w-full min-h-[56px] rounded-xl bg-ink text-white text-lg font-semibold hover:bg-ink-deep"
      >
        {open > 0 ? 'متابعة إلى المراجعة · Continue to review' : 'مراجعة وتأكيد الفرز · Review & confirm'}
      </button>
    </section>
  );
}
