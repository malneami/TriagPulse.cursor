import { AlertTriangle, ArrowRight, HelpCircle, MapPin, ShieldAlert, ShieldCheck, Stethoscope } from 'lucide-react';
import ClarifyingQuestions from './ClarifyingQuestions';

const CTAS_HEX = {
  1: '#E24B4A',
  2: '#EF9F27',
  3: '#0F6E56',
  4: '#378ADD',
  5: '#888780',
};

const CATEGORY_STYLE = {
  ctas_modifier: 'bg-amber-100 text-amber-900 border-amber-200',
  patient_direction: 'bg-sky-100 text-sky-900 border-sky-200',
  safety_escalation: 'bg-rose-100 text-rose-900 border-rose-200',
};

const CATEGORY_LABEL = {
  ctas_modifier: 'CTAS Modifier',
  patient_direction: 'Patient Direction',
  safety_escalation: 'Safety Escalation',
};

/**
 * Clarifying Question Engine panel:
 * detected facts → ≤3 categorized questions → CTAS / destination / safety strip.
 */
export default function ModifierEnginePanel({
  evaluation,
  questions = [],
  answers = {},
  onAnswer,
  liveLevel,
  loading = false,
}) {
  if (!evaluation && !questions.length && !loading) return null;

  const initial = evaluation?.initial_ctas;
  const updated = evaluation?.updated_ctas ?? liveLevel;
  const dest = evaluation?.suggested_destination;
  const explanation = evaluation?.explanation;
  const known = evaluation?.known_modifiers || [];
  const facts = evaluation?.known_facts || [];
  const impacts = evaluation?.answer_impacts || [];

  const enrichedQuestions = (questions || []).map((q) => {
    const cat = q.question_category || q.category || 'ctas_modifier';
    return {
      ...q,
      text_ar: q.text_ar,
      clinical_relevance: [
        CATEGORY_LABEL[cat] || cat,
        q.potential_impact || q.reason_en || q.clinical_relevance,
      ].filter(Boolean).join(' — '),
      clinical_relevance_ar: [
        CATEGORY_LABEL[cat] || cat,
        q.potential_impact_ar || q.reason_ar || q.clinical_relevance_ar,
      ].filter(Boolean).join(' — '),
      _category: cat,
    };
  });

  return (
    <div className="bg-white rounded-2xl border border-teal-200 shadow-sm overflow-hidden space-y-0">
      <div className="px-4 py-3 border-b border-teal-100 bg-teal-50/60 flex items-start gap-2">
        <ShieldCheck className="w-5 h-5 text-teal-700 shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-black text-teal-900">محرك الأسئلة التوضيحية — Clarifying Question Engine</p>
          <p className="text-xs text-teal-800/80">
            أسئلة ديناميكية من فجوات اللقاء فقط (حد أقصى ٣) — Gap-driven questions only (max 3)
          </p>
        </div>
      </div>

      <div className="p-4 space-y-4">
        {(initial != null || updated != null) && (
          <div className="flex flex-wrap items-center gap-3">
            {initial != null && (
              <div className="rounded-xl border border-slate-200 px-3 py-2 min-w-[7rem]">
                <p className="text-[10px] font-bold text-slate-500 uppercase">Initial CTAS</p>
                <p className="text-2xl font-black" style={{ color: CTAS_HEX[initial] }}>{initial}</p>
              </div>
            )}
            {initial != null && updated != null && initial !== updated && (
              <ArrowRight className="w-5 h-5 text-slate-400" />
            )}
            {updated != null && (
              <div className="rounded-xl border-2 px-3 py-2 min-w-[7rem]" style={{ borderColor: CTAS_HEX[updated] }}>
                <p className="text-[10px] font-bold text-slate-500 uppercase">
                  Updated CTAS{evaluation?.ctas_changed ? ' ●' : ''}
                </p>
                <p className="text-2xl font-black" style={{ color: CTAS_HEX[updated] }}>{updated}</p>
              </div>
            )}
            {dest && (
              <div className="flex-1 min-w-[10rem] rounded-xl border border-slate-200 px-3 py-2">
                <p className="text-[10px] font-bold text-slate-500 uppercase flex items-center gap-1">
                  <MapPin className="w-3 h-3" /> Destination
                  {evaluation?.destination_changed ? ' ●' : ''}
                </p>
                <p className="text-sm font-black text-slate-800">{dest.destination_ar}</p>
                <p className="text-xs text-slate-500">{dest.destination_en}</p>
              </div>
            )}
          </div>
        )}

        {(facts.length > 0 || known.length > 0) && (
          <div className="rounded-xl bg-slate-50 border border-slate-200 px-3 py-2.5 space-y-2">
            <p className="text-[11px] font-black text-slate-600 flex items-center gap-1">
              <Stethoscope className="w-3.5 h-3.5" />
              معلومات مكتشفة — Information already detected
            </p>
            <div className="flex flex-wrap gap-1.5">
              {(facts.length ? facts : known.map((k) => ({
                field: k.field,
                status: k.status || 'known_positive',
                value: k.value,
                label_en: k.name,
                label_ar: k.name_ar || k.name,
              }))).slice(0, 12).map((f) => (
                <span
                  key={`${f.field}-${f.value}`}
                  className="text-[10px] font-bold px-2 py-0.5 rounded-full border bg-white text-slate-700 border-slate-200"
                  title={`${f.status} · ${f.source || ''}`}
                >
                  {f.label_ar || f.label_en}
                  {f.value != null && f.value !== '' && f.field !== 'chief_complaint' ? `: ${f.value}` : ''}
                </span>
              ))}
            </div>
          </div>
        )}

        {enrichedQuestions.length > 0 && (
          <div className="space-y-2">
            <p className="text-[11px] font-black text-slate-600 flex items-center gap-1">
              <HelpCircle className="w-3.5 h-3.5" />
              معلومات ناقصة عالية الأثر — Missing high-impact information
            </p>
            <div className="flex flex-wrap gap-1.5 mb-1">
              {enrichedQuestions.map((q) => (
                <span
                  key={q.id || q.field}
                  className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${CATEGORY_STYLE[q._category] || CATEGORY_STYLE.ctas_modifier}`}
                >
                  {CATEGORY_LABEL[q._category] || q._category}
                </span>
              ))}
            </div>
          </div>
        )}

        {explanation && (explanation.changed || explanation.destination_changed) && (
          <div className="rounded-xl bg-amber-50 border border-amber-200 px-3 py-2.5 text-xs space-y-1">
            <p className="font-bold text-amber-900 flex items-center gap-1">
              <AlertTriangle className="w-3.5 h-3.5" />
              الأثر — Impact
            </p>
            <p className="text-amber-900 leading-relaxed" dir="rtl">{explanation.ar}</p>
            <p className="text-amber-800/90 leading-relaxed">{explanation.en}</p>
            {impacts.length > 0 && (
              <ul className="mt-1 space-y-0.5 text-amber-900/90">
                {impacts.slice(0, 5).map((a) => (
                  <li key={`${a.field}-${a.impact}`}>
                    <span className="font-bold">{a.impact}</span>: {a.label_en || a.field}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {(loading || enrichedQuestions.length > 0) && (
          <ClarifyingQuestions
            questions={enrichedQuestions}
            answers={answers}
            onAnswer={onAnswer}
            loading={loading}
            patient={{}}
            liveLevel={updated ?? liveLevel ?? null}
            source="modifier_engine"
            clarifyingLevel={updated ?? initial ?? null}
          />
        )}

        {!loading && enrichedQuestions.length === 0 && evaluation && (
          <p className="text-xs text-teal-800 font-medium bg-teal-50 border border-teal-100 rounded-xl px-3 py-2">
            لا توجد أسئلة توضيحية ناقصة عالية الأثر — No missing high-impact clarifying questions.
            أكمل التأكيد مع الممرض/الطبيب — Proceed to provider confirmation.
          </p>
        )}

        {evaluation?.critical_alert && (
          <p className="text-xs font-bold text-rose-800 bg-rose-50 border border-rose-300 rounded-xl px-3 py-2 flex items-center gap-1.5">
            <ShieldAlert className="w-3.5 h-3.5" />
            تنبيه سلامة حرج — Critical safety alert / immediate clinician review
          </p>
        )}

        {evaluation?.team_leader_review && (
          <p className="text-xs font-bold text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2">
            يُوصى بمراجعة قائد الفريق — Team leader review recommended
          </p>
        )}
      </div>
    </div>
  );
}
