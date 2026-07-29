import { useState, useRef, useEffect } from 'react';
import { Loader2, RefreshCw, HelpCircle, ArrowUp, GitBranch } from 'lucide-react';

// Clinical cascade map: field + answer value → follow-up question(s)
// Updated to match CTAS 2025 Booklet primary & complaint-specific modifiers
const CLINICAL_CASCADES = {
  // --- PAIN ASSESSMENT (p.29) ---
  functional_impairment: {
    'نعم': [{
      field: 'trauma_mechanism',
      text_ar: 'هل سبق الألم إصابة أو سقوط؟',
      text_en: 'Was the pain preceded by an injury or fall?',
      answer_type: 'yes_no',
    }],
  },
  trauma_mechanism: {
    'نعم': [
      {
        field: 'moi_high_risk',
        text_ar: 'هل الإصابة نتيجة آلية عالية الخطورة (سقوط >18 قدم، حادث تدهور/قذف، دهس مشاة)؟',
        text_en: 'Was there a high-risk Mechanism of Injury (fall >18 ft, MVC rollover/ejection, pedestrian struck)?',
        answer_type: 'yes_no',
      },
      {
        field: 'weight_bearing',
        text_ar: 'هل يستطيع تحمل وزنه على الطرف المصاب؟',
        text_en: 'Can the patient bear weight on the injured limb?',
        answer_type: 'yes_no',
      },
    ],
  },
  weight_bearing: {
    'لا': [{
      field: 'swelling_deformity',
      text_ar: 'هل يوجد تورم أو تشوه ظاهر؟',
      text_en: 'Is there visible swelling or deformity?',
      answer_type: 'options',
      answer_options: ['تورم فقط / Swelling only', 'تشوه ظاهر / Deformity', 'لا شيء / None'],
    }],
  },
  // Pain location cascade → duration type
  pain_location: {
    'داخلي / Central': [{
      field: 'pain_duration_type',
      text_ar: 'هل الألم جديد (حاد < شهر) أم مزمن متكرر؟',
      text_en: 'Is the pain Acute (new, <1 month) or Chronic (recurring)?',
      answer_type: 'options',
      answer_options: ['حاد / Acute', 'مزمن / Chronic'],
    }],
    'خارجي / Peripheral': [{
      field: 'pain_duration_type',
      text_ar: 'هل الألم جديد (حاد) أم مزمن؟',
      text_en: 'Is the pain Acute or Chronic?',
      answer_type: 'options',
      answer_options: ['حاد / Acute', 'مزمن / Chronic'],
    }],
  },
  // --- CARDIOVASCULAR (p.20) ---
  radiation: {
    'نعم': [{
      field: 'radiation_site',
      text_ar: 'إلى أين يمتد الألم؟ (وفق CTAS)',
      text_en: 'Where does the pain radiate? (per CTAS)',
      answer_type: 'options',
      answer_options: ['الكتف الأيسر / Left shoulder', 'الفك / Jaw', 'الذراع / Arm', 'الظهر / Back', 'لا يمتد / No radiation'],
    }],
  },
  diaphoresis: {
    'نعم': [{
      field: 'nausea_vomiting',
      text_ar: 'هل يوجد غثيان أو قيء؟',
      text_en: 'Is there nausea or vomiting?',
      answer_type: 'yes_no',
    }],
  },
  // --- NEUROLOGY (p.16) ---
  thunderclap: {
    'نعم': [{
      field: 'fever_neck_stiffness',
      text_ar: 'هل يوجد حمى أو تيبس رقبة؟ (اشتباه التهاب سحايا)',
      text_en: 'Is there fever or neck stiffness? (suspected meningitis)',
      answer_type: 'yes_no',
    }],
  },
  // --- FEVER / SIRS (p.26) ---
  fever_duration: {
    '> 24 ساعة': [
      {
        field: 'immunocompromised',
        text_ar: 'هل يعاني المريض من ضعف المناعة أو يتناول أدوية مثبطة (كيمياء، ستيرويد)؟',
        text_en: 'Immunocompromised? (neutropenia, chemotherapy, steroids)',
        answer_type: 'yes_no',
      },
      {
        field: 'looks_unwell',
        text_ar: 'هل يبدو المريض معتلاً (شاحب، خامل، مضطرب، وجه متورم)؟',
        text_en: 'Does the patient look unwell (flushed, lethargic, anxious, agitated)?',
        answer_type: 'yes_no',
      },
    ],
  },
  looks_unwell: {
    'نعم': [{
      field: 'sirs_criteria_count',
      text_ar: 'هل يوجد تنفس سريع (>20) ونبض سريع (>90) معاً؟ (معايير SIRS)',
      text_en: 'Is there both tachypnea (>20) AND tachycardia (>90)? (SIRS criteria)',
      answer_type: 'yes_no',
    }],
  },
  // --- RESPIRATORY (p.27) ---
  cannot_speak_sentences: {
    'نعم': [{
      field: 'stridor',
      text_ar: 'هل يوجد صرير (stridor)؟',
      text_en: 'Is there stridor (high-pitched breathing noise)?',
      answer_type: 'yes_no',
    }],
  },
  // --- BLEEDING DISORDERS (p.28) ---
  uncontrolled_bleeding: {
    'نعم': [
      {
        field: 'bleeding_disorder_history',
        text_ar: 'هل للمريض تاريخ باضطراب نزيف أو يتناول مسيلات الدم أو مثبطات الصفائح؟',
        text_en: 'History of bleeding disorder or on anticoagulants/platelet inhibitors?',
        answer_type: 'yes_no',
      },
      {
        field: 'bleeding_location_risk',
        text_ar: 'هل النزيف في منطقة خطرة (الرأس، الرقبة، الصدر، البطن، العضلة الحرقفية)؟',
        text_en: 'Is bleeding in a life-threatening location (head/neck/chest/abdomen/iliopsoas)?',
        answer_type: 'yes_no',
      },
    ],
  },
  // --- FRAILTY (p.30) ---
  age_over_80: {
    'نعم': [{
      field: 'frailty',
      text_ar: 'هل المريض معتمد كلياً على الرعاية، أو على كرسي متحرك، أو في مرحلة نهائية من مرضه؟',
      text_en: 'Is the patient fully dependent for care, wheelchair-bound, or in late-stage terminal illness?',
      answer_type: 'yes_no',
    }],
  },
};

const DURATION_OPTIONS = ['< 1 ساعة', '1-6 ساعات', '6-24 ساعة', '> 24 ساعة'];
const YES_NO_OPTIONS = [
  { value: 'نعم', color: 'bg-green-500 text-white border-green-500', labelEn: 'Yes' },
  { value: 'لا',  color: 'bg-red-400 text-white border-red-400',    labelEn: 'No'  },
  { value: 'غير معروف', color: 'bg-slate-400 text-white border-slate-400', labelEn: 'Unknown' },
];

function AnswerControl({ question, answer, onAnswer }) {
  const type = question.answer_type || 'yes_no';

  if (type === 'yes_no') return (
    <div className="flex gap-2 pr-7">
      {YES_NO_OPTIONS.map(opt => (
        <button key={opt.value}
          onClick={() => onAnswer(answer === opt.value ? undefined : opt.value)}
          className={`flex-1 py-1.5 rounded-lg text-sm font-bold border-2 transition-all ${
            answer === opt.value ? opt.color + ' shadow-sm scale-105' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
          }`}
        >
          {opt.value}
          <span className="text-xs font-normal block opacity-70">{opt.labelEn}</span>
        </button>
      ))}
    </div>
  );

  if (type === 'severity') return (
    <div className="pr-7">
      <div className="flex gap-1 flex-wrap">
        {[1,2,3,4,5,6,7,8,9,10].map(n => {
          const sel = answer === String(n);
          const color = n <= 3 ? 'border-green-400 bg-green-50 text-green-700' : n <= 6 ? 'border-yellow-400 bg-yellow-50 text-yellow-700' : 'border-red-400 bg-red-50 text-red-700';
          return (
            <button key={n} onClick={() => onAnswer(sel ? undefined : String(n))}
              className={`w-9 h-9 rounded-lg border-2 font-bold text-sm transition-all ${sel ? color + ' scale-110 shadow' : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300'}`}
            >{n}</button>
          );
        })}
      </div>
      <p className="text-xs text-slate-400 mt-1">١ = خفيف · ١٠ = لا يُحتمل</p>
    </div>
  );

  if (type === 'duration') return (
    <div className="flex gap-2 flex-wrap pr-7">
      {DURATION_OPTIONS.map(opt => (
        <button key={opt} onClick={() => onAnswer(answer === opt ? undefined : opt)}
          className={`px-3 py-1.5 rounded-lg text-sm font-medium border-2 transition-all ${
            answer === opt ? 'bg-teal-600 text-white border-teal-600 scale-105 shadow-sm' : 'bg-white text-slate-600 border-slate-200 hover:border-teal-300'
          }`}
        >{opt}</button>
      ))}
    </div>
  );

  if (type === 'options') return (
    <div className="flex gap-2 flex-wrap pr-7">
      {(question.answer_options || []).map(opt => (
        <button key={opt} onClick={() => onAnswer(answer === opt ? undefined : opt)}
          className={`px-3 py-1.5 rounded-lg text-sm font-medium border-2 transition-all ${
            answer === opt ? 'bg-teal-600 text-white border-teal-600 scale-105 shadow-sm' : 'bg-white text-slate-600 border-slate-200 hover:border-teal-300'
          }`}
        >{opt}</button>
      ))}
    </div>
  );

  return null;
}

function CascadeQuestion({ question, answer, onAnswer }) {
  return (
    <div className="mt-2.5 mr-2 pl-3 border-r-2 border-teal-300 pr-3">
      <div className="flex items-start gap-1.5 mb-2">
        <span className="text-teal-500 font-bold text-sm shrink-0">↳</span>
        <div>
          <p className="text-sm text-slate-800 font-medium">{question.text_ar}</p>
          {question.text_en && <p className="text-xs text-slate-400 mt-0.5">{question.text_en}</p>}
        </div>
      </div>
      <AnswerControl question={question} answer={answer} onAnswer={onAnswer} />
    </div>
  );
}

export default function ClarifyingQuestions({
  questions, answers, onAnswer, onRegenerate, loading,
  cascadeRules = {}, patient = {}, liveLevel = null,
  source = 'llm', clarifyingLevel = null,
}) {
  const [cascades, setCascades] = useState({});
  // Dynamic clinical cascades: { [parentField]: Question[] }
  const [dynamicCascades, setDynamicCascades] = useState({});
  // Track CTAS level changes per QA answer
  const [ctasImpacts, setCtasImpacts] = useState({}); // { [field]: { from, to } }
  const prevLevelRef = useRef(liveLevel);
  const lastAnsweredFieldRef = useRef(null);

  useEffect(() => {
    if (source === 'bank') {
      setCascades({});
      setDynamicCascades({});
    }
  }, [source, questions]);

  useEffect(() => {
    const prev = prevLevelRef.current;
    if (liveLevel !== null && prev !== null && liveLevel !== prev && lastAnsweredFieldRef.current) {
      const field = lastAnsweredFieldRef.current;
      setCtasImpacts(p => ({ ...p, [field]: { from: prev, to: liveLevel } }));
      // Auto-clear after 6 seconds
      setTimeout(() => setCtasImpacts(p => { const n = { ...p }; delete n[field]; return n; }), 6000);
    }
    prevLevelRef.current = liveLevel;
  }, [liveLevel]);

  const handleAnswer = (field, value) => {
    lastAnsweredFieldRef.current = field;
    onAnswer(field, value);
    // Bank questions branch via parent re-resolve; skip embedded cascades
    if (source === 'bank') return;
    // Dynamic clinical cascades based on answer value (LLM path)
    const clinicalFollowUps = CLINICAL_CASCADES[field]?.[value];
    if (clinicalFollowUps?.length > 0) {
      setDynamicCascades(prev => ({
        ...prev,
        [field]: clinicalFollowUps.filter(q => !answers[q.field] && q.field !== field)
      }));
    } else if (dynamicCascades[field]) {
      // Clear cascades if answer changed away from trigger value
      setDynamicCascades(prev => { const n = { ...prev }; delete n[field]; return n; });
    }
    if (value === 'نعم' && cascadeRules[field]?.length > 0) {
      setCascades(prev => ({ ...prev, [field]: { revealed: 1 } }));
    } else if (cascades[field] && value !== 'نعم') {
      setCascades(prev => { const n = { ...prev }; delete n[field]; return n; });
    }
  };

  const handleCascadeAnswer = (parentField, cascadeField, value) => {
    onAnswer(cascadeField, value);
    if (value !== undefined) {
      const rules = cascadeRules[parentField] || [];
      const idx = rules.findIndex(q => q.field === cascadeField);
      if (idx >= 0 && idx + 1 < rules.length) {
        setCascades(prev => ({ ...prev, [parentField]: { revealed: (prev[parentField]?.revealed || 1) + 1 } }));
      }
    }
  };

  if (loading) return (
    <div className="bg-white rounded-2xl shadow-sm border border-teal-100 p-5 flex flex-col items-center gap-3">
      <Loader2 className="w-6 h-6 text-teal-600 animate-spin" />
      <p className="text-sm text-teal-700 font-medium">جارٍ توليد الأسئلة الاستيضاحية...</p>
      <p className="text-xs text-slate-400">Generating targeted follow-up questions</p>
    </div>
  );

  // Hide questions whose field is already confirmed in patient
  const visibleQuestions = (questions || []).filter(q => {
    if (!q.field) return true;
    const val = patient[q.field];
    return val == null || val === '';
  });

  if (visibleQuestions.length === 0) return null;

  const answeredCount = visibleQuestions.filter(q => answers[q.field] !== undefined).length;

  const levelBadge = clarifyingLevel ?? liveLevel;

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-teal-100 p-4 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <HelpCircle className="w-5 h-5 text-teal-600 shrink-0" />
          <div className="min-w-0">
            <h3 className="font-bold text-slate-800 text-sm">أسئلة استيضاحية</h3>
            <p className="text-xs text-slate-400">Clarifying Questions · {answeredCount}/{visibleQuestions.length} answered</p>
            {levelBadge != null && (
              <p className="text-[11px] font-bold text-teal-700 mt-0.5">
                أسئلة توضيحية لـ CTAS {levelBadge} — Clarifying for CTAS {levelBadge}
                {source === 'bank' ? ' · بنك / Bank' : source === 'llm' ? ' · ذكاء اصطناعي / LLM' : ''}
              </p>
            )}
          </div>
        </div>
        {source !== 'bank' && (
          <button onClick={onRegenerate} className="text-xs text-teal-600 flex items-center gap-1 hover:text-teal-800 shrink-0">
            <RefreshCw className="w-3.5 h-3.5" />
            إعادة التوليد
          </button>
        )}
      </div>

      <div className="space-y-3">
        {visibleQuestions.map((q, i) => {
          const currentAnswer = answers[q.field];
          const cascade = cascades[q.field];
          const cascadeQs = (cascadeRules[q.field] || []).slice(0, cascade?.revealed || 0);

          return (
            <div key={q.id || q.field || i}
              className={`rounded-xl border p-3 transition-all ${currentAnswer !== undefined ? 'border-teal-200 bg-teal-50' : 'border-slate-200 bg-slate-50'}`}
            >
              <div className="flex items-start gap-2 mb-2.5">
                <span className="shrink-0 w-5 h-5 rounded-full bg-teal-600 text-white text-xs flex items-center justify-center font-bold mt-0.5">
                  {i + 1}
                </span>
                <p className="text-sm text-slate-800 leading-relaxed font-medium">{q.text_ar}</p>
              </div>
              {/* CTAS impact notification */}
              {ctasImpacts[q.field] && (
                <div className="mb-2.5 pr-7 flex items-center gap-2 px-3 py-2 bg-amber-50 border border-amber-300 rounded-xl text-xs font-bold animate-pulse">
                  <ArrowUp className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                  <span className="text-amber-800">
                    تأثير على CTAS / CTAS Impact: {ctasImpacts[q.field].from} → {ctasImpacts[q.field].to}
                  </span>
                </div>
              )}
              {q.text_en && <p className="text-xs text-slate-400 mb-2.5 pr-7">{q.text_en}</p>}
              <AnswerControl question={q} answer={currentAnswer} onAnswer={v => handleAnswer(q.field, v)} />

              {/* Static cascade rules (prior_cardiac, fever, etc.) */}
              {cascadeQs.map(cq => (
                <CascadeQuestion
                  key={cq.field}
                  question={cq}
                  answer={answers[cq.field]}
                  onAnswer={v => handleCascadeAnswer(q.field, cq.field, v)}
                />
              ))}
              {/* Dynamic clinical cascades */}
              {(dynamicCascades[q.field] || []).map(cq => (
                <div key={cq.field} className="mt-2 mr-2 pl-3 border-r-2 border-amber-300 pr-3">
                  <div className="flex items-center gap-1.5 mb-2">
                    <GitBranch className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                    <div>
                      <p className="text-sm text-slate-800 font-medium">{cq.text_ar}</p>
                      {cq.text_en && <p className="text-xs text-slate-400">{cq.text_en}</p>}
                    </div>
                  </div>
                  <AnswerControl
                    question={cq}
                    answer={answers[cq.field]}
                    onAnswer={v => { lastAnsweredFieldRef.current = cq.field; onAnswer(cq.field, v); }}
                  />
                </div>
              ))}
            </div>
          );
        })}
      </div>

      {answeredCount === visibleQuestions.length && visibleQuestions.length > 0 && (
        <div className="bg-green-50 border border-green-200 rounded-xl px-3 py-2 text-xs text-green-700 font-medium text-center">
          ✓ جميع الأسئلة مكتملة — ستُضمَّن في تقييم الفرز
        </div>
      )}
    </div>
  );
}