// @ts-nocheck
import { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import { toast } from 'sonner';
import { Stethoscope, Lock, Plus } from 'lucide-react';
import PatientSelectorStrip from '@/components/triage/PatientSelectorStrip';
import NewPatientConfirm from '@/components/triage/NewPatientConfirm';
import TriageNextPrompt from '@/components/triage/TriageNextPrompt';
import LiveCTASPanel from '@/components/triage/LiveCTASPanel';
import {
  computeLiveCTAS,
  validateTriageReady,
  detectRedFlags,
  createAuditEvent,
  serializeAuditTrail,
  matchComplaint,
  resolveChiefComplaint,
  getClarifyingQuestions,
  evaluateModifierEngine,
  buildNarrativeClinicalSummary,
  runClarifyingQuestionPipeline,
  getLibraryVersions,
  resolveClinicalPathway,
  computeCtasCompleteness,
  mapSttSessionToPatientUpdates,
  clinicalSafetyDisclaimer as sttSafetyDisclaimer,
  clampConfidence as sttClampConfidence,
  CTAS_REQUIRED_FIELDS,
  CTAS_CONFIG,
} from '@triagepulse/clinical';

import QuickComplaints from '@/components/triage/QuickComplaints';
import ChiefComplaintConfirm from '@/components/triage/ChiefComplaintConfirm';
import PainScale from '@/components/triage/PainScale';
import VitalsForm from '@/components/triage/VitalsForm';
import CTASValidation from '@/components/triage/CTASValidation';
import UrgentAlert from '@/components/triage/UrgentAlert';
import ClarifyingQuestions from '@/components/triage/ClarifyingQuestions';
import TriageResult from '@/components/triage/TriageResult';
import ComplaintModifierSelector from '@/components/triage/ComplaintModifierSelector';
import ModifierEnginePanel from '@/components/triage/ModifierEnginePanel';
import VoiceTriagePanel from '@/components/triage/VoiceTriagePanel';
import CompletenessChips from '@/components/triage/CompletenessChips';
import ArrivalTimer from '@/components/triage/ArrivalTimer';
import PatientTimeline from '@/components/journey/PatientTimeline';
import { useQuery } from '@tanstack/react-query';

const CASCADE_RULES = {
  prior_cardiac: [
    { text_ar: 'هل تتناول أسبرين أو أدوية تخفيف الجلطة؟', text_en: 'Are you on aspirin or blood thinners?', answer_type: 'yes_no', field: 'on_blood_thinners' },
    { text_ar: 'هل سبق وأجريت قسطرة أو عملية قلب مفتوح؟', text_en: 'Have you had a catheterization or open heart surgery?', answer_type: 'yes_no', field: 'prior_cardiac_procedure' },
    { text_ar: 'هل عندك ألم مشابه من قبل؟', text_en: 'Have you had similar pain before?', answer_type: 'yes_no', field: 'similar_pain_before' },
  ],
  dyspnea_associated: [
    { text_ar: 'هل ضيق التنفس في الراحة أم عند المجهود فقط؟', text_en: 'Is dyspnea at rest or only on exertion?', answer_type: 'options', answer_options: ['في الراحة / At rest', 'عند المجهود / On exertion', 'كلاهما / Both'], field: 'dyspnea_type' },
  ],
  radiation: [
    { text_ar: 'إلى أين يمتد الألم؟', text_en: 'Where does the pain radiate to?', answer_type: 'options', answer_options: ['الكتف الأيسر / Left shoulder', 'الفك / Jaw', 'الذراع / Arm', 'الظهر / Back', 'لا يمتد / No radiation'], field: 'radiation_site' },
  ],
  fever: [
    { text_ar: 'هل يوجد قشعريرة أو رجفة؟', text_en: 'Are there chills or rigors?', answer_type: 'yes_no', field: 'chills' },
  ],
};

const emptyPatient = () => ({
  patient_id: '',
  arrival_time: new Date().toISOString(),
  ctas_started_at: null,
  patient_name_ar: '', patient_name_en: '', mrn: '',
  age: '', gender: '', nationality: '', phone: '', insurance: '',
  chief_complaint: '', hr: '', bp_systolic: '', bp_diastolic: '',
  spo2: '', rr: '', temperature: '', gcs: '', weight: '',
  pain_score: null, transcription: '', receipt_image_url: ''
});

const REQUIRED_FIELDS = CTAS_REQUIRED_FIELDS;

const scrollToSection = (id) => {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
};

function normalizeLLMResponse(result) {
  if (typeof result === 'string') {
    try { return JSON.parse(result); } catch { return { questions: [] }; }
  }
  return result || {};
}

export default function Triage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [patient, setPatient] = useState(emptyPatient());
  const [ctasResult, setCtasResult] = useState(null);
  const [showNewPatientConfirm, setShowNewPatientConfirm] = useState(false);
  const [nextPatient, setNextPatient] = useState(null);
  const [showNextPrompt, setShowNextPrompt] = useState(false);
  const [saving, setSaving] = useState(false);
  const [nurseValidation, setNurseValidation] = useState(null);
  const [clarifyingQuestions, setClarifyingQuestions] = useState([]);
  const [clarifyingAnswers, setClarifyingAnswers] = useState({});
  const [loadingQuestions, setLoadingQuestions] = useState(false);
  const [highlightedVitals, setHighlightedVitals] = useState(new Set());
  const [auditLog, setAuditLog] = useState([]);
  const [urgentAlert, setUrgentAlert] = useState(null);
  const [criticalAlertAudit, setCriticalAlertAudit] = useState([]);
  const [aiExtractionMeta, setAiExtractionMeta] = useState({
    confidence: 1,
    missing_fields: [],
    safety_note: sttSafetyDisclaimer(),
    field_confidence: {},
  });
  const [timerStartTime, setTimerStartTime] = useState(null);
  const [timerStatus, setTimerStatus] = useState('idle');
  const [confirmedTime, setConfirmedTime] = useState(null);
  const [selectedModifier, setSelectedModifier] = useState(null);
  const [sttSessionOutput, setSttSessionOutput] = useState(null);
  const [clarifyingSource, setClarifyingSource] = useState('empty'); // modifier_engine | bank | llm | empty
  const [clarifyingLevel, setClarifyingLevel] = useState(null);
  const [modifierEvaluation, setModifierEvaluation] = useState(null);
  const questionsGeneratedRef = useRef(false);
  const lastAlertKeyRef = useRef(null);
  const manualEditedFieldsRef = useRef(new Set());
  const sttFieldConfidenceRef = useRef({});
  const autoComplaintKeyRef = useRef(null);
  const prevComplaintTextRef = useRef('');

  // Load journey record if pid param present
  const urlPid = new URLSearchParams(window.location.search).get('pid');

  const handleSwitchPatient = (newPid) => {
    window.location.href = `/triage?pid=${encodeURIComponent(newPid)}`;
  };
  const { data: journeyList } = useQuery({
    queryKey: ['journey-ctas', urlPid],
    queryFn: () => urlPid ? base44.entities.PatientJourney.filter({ patient_id: urlPid }) : Promise.resolve([]),
    enabled: !!urlPid,
  });
  const activeJourney = journeyList?.[0] || null;
  const visualTriage = activeJourney?.vt_destination
    ? {
        destination: activeJourney.vt_destination,
        destination_ar: activeJourney.vt_destination_ar,
        destination_en: activeJourney.vt_destination_en,
      }
    : null;

  // Pre-populate patient demographics from the linked journey record
  useEffect(() => {
    if (!activeJourney) return;
    setPatient(prev => ({
      ...prev,
      patient_id:       activeJourney.patient_id       || prev.patient_id,
      arrival_time:     activeJourney.arrival_time     || prev.arrival_time,
      ctas_started_at:  activeJourney.ctas_started_at  || prev.ctas_started_at,
      receipt_image_url: activeJourney.receipt_image_url || prev.receipt_image_url,
      patient_name_ar: activeJourney.patient_name_ar || prev.patient_name_ar,
      patient_name_en: activeJourney.patient_name_en || prev.patient_name_en,
      mrn:             activeJourney.mrn             || prev.mrn,
      age:             activeJourney.age             ? String(activeJourney.age) : prev.age,
      gender:          activeJourney.gender          || prev.gender,
      nationality:     activeJourney.nationality     || prev.nationality,
      phone:           activeJourney.phone           || prev.phone,
      insurance:       activeJourney.insurance       || prev.insurance,
    }));
  }, [activeJourney?.id]);

  // Persist CTAS start on journey — UI Triage Time starts only when Record is pressed
  useEffect(() => {
    if (!activeJourney?.id || activeJourney.ctas_started_at) return;
    const startedAt = new Date().toISOString();
    base44.entities.PatientJourney.update(activeJourney.id, {
      ctas_started_at: startedAt,
      current_status: 'ctas_in_progress',
    }).catch((err) => console.error('Failed to mark CTAS start', err));
    setPatient((prev) => ({ ...prev, ctas_started_at: startedAt }));
  }, [activeJourney?.id, activeJourney?.ctas_started_at]);

  /** Start Triage Time when voice recording begins (once per patient). */
  const handleRecordingStart = useCallback(() => {
    setTimerStatus((status) => {
      if (status === 'confirmed') return status;
      return 'running';
    });
    setTimerStartTime((start) => start || new Date().toISOString());
  }, []);

  // Scored CEDIS resolution — never silently guess when confidence is low
  const complaintTranscript = patient.transcription || sttSessionOutput?.full_transcript || '';
  const complaintResolution = resolveChiefComplaint({
    chiefComplaint: patient.chief_complaint || '',
    transcript: complaintTranscript,
    confirmedKey: patient.confirmed_complaint_key || null,
  });
  const complaintMatch = matchComplaint(patient.chief_complaint, {
    transcript: complaintTranscript,
    confirmedKey: patient.confirmed_complaint_key || null,
  });

  // When chief complaint text changes, reset Step 2 + clear stale confirmation
  useEffect(() => {
    const text = String(patient.chief_complaint || '');
    if (prevComplaintTextRef.current && prevComplaintTextRef.current !== text) {
      autoComplaintKeyRef.current = null;
      setPatient((prev) => (
        prev.confirmed_complaint_key
          ? { ...prev, confirmed_complaint_key: null }
          : prev
      ));
    }
    prevComplaintTextRef.current = text;
    setSelectedModifier(null);
    setClarifyingQuestions([]);
    setClarifyingAnswers({});
    setClarifyingSource('empty');
    setClarifyingLevel(null);
    setModifierEvaluation(null);
    questionsGeneratedRef.current = false;
  }, [patient.chief_complaint]);

  const handleComplaintConfirm = useCallback((candidate) => {
    if (!candidate?.complaintKey) return;
    const label = candidate.label_en || candidate.label_ar || candidate.complaintKey;
    prevComplaintTextRef.current = label; // avoid clearing confirmation we just set
    setPatient((prev) => ({
      ...prev,
      chief_complaint: label,
      confirmed_complaint_key: candidate.complaintKey,
    }));
    setAuditLog((a) => [
      ...a,
      {
        time: new Date().toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' }),
        msg: `Complaint confirmed: ${candidate.complaintKey}`,
        action: 'complaint_resolution',
        details: {
          status: 'confirmed',
          selected_key: candidate.complaintKey,
          confidence: candidate.confidence ?? 1,
          candidates: (complaintResolution.candidates || []).map((c) => ({
            key: c.complaintKey,
            confidence: c.confidence,
          })),
        },
      },
    ]);
    toast.success(`Confirmed: ${candidate.label_en || candidate.complaintKey}`);
  }, [complaintResolution.candidates]);

  // Soft-bind + audit auto-resolution once per selected key
  useEffect(() => {
    if (complaintResolution.status !== 'auto' || !complaintResolution.selected) return;
    const key = complaintResolution.selected.complaintKey;
    if (autoComplaintKeyRef.current === key) return;
    autoComplaintKeyRef.current = key;
    setPatient((prev) => (
      prev.confirmed_complaint_key === key
        ? prev
        : { ...prev, confirmed_complaint_key: key }
    ));
    setAuditLog((a) => [
      ...a,
      {
        time: new Date().toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' }),
        msg: `Complaint auto-mapped: ${key}`,
        action: 'complaint_resolution',
        details: {
          status: 'auto',
          selected_key: key,
          confidence: complaintResolution.selected.confidence,
          candidates: (complaintResolution.candidates || []).map((c) => ({
            key: c.complaintKey,
            confidence: c.confidence,
          })),
        },
      },
    ]);
  }, [complaintResolution.status, complaintResolution.selected?.complaintKey]);

  // Single source of truth — recalculates on every render when patient or answers change
  // _selectedModifier is passed so the engine can use the official Step 2 CTAS level
  const answersWithModifier = { ...clarifyingAnswers, _selectedModifier: selectedModifier };
  const liveResult = computeLiveCTAS(patient, answersWithModifier);
  // Most-urgent wins: live vitals/pain must move the badge even if clarifying evaluation is stale
  const liveLevel = liveResult?.level ?? null;
  const evalLevel = modifierEvaluation?.updated_ctas ?? null;
  const displayCtasLevel = [liveLevel, evalLevel].every((n) => n == null)
    ? null
    : Math.min(...[liveLevel, evalLevel].filter((n) => n != null));
  const displayCtasMeta = displayCtasLevel != null ? CTAS_CONFIG[displayCtasLevel] : null;
  const displayLiveResult = liveResult && displayCtasLevel != null
    ? {
        ...liveResult,
        level: displayCtasLevel,
        ctas_level: displayCtasLevel,
        ctas_ar: displayCtasMeta?.ar ?? liveResult.ctas_ar,
        ctas_en: displayCtasMeta?.en ?? liveResult.ctas_en,
        hex: displayCtasMeta?.hex ?? liveResult.hex,
      }
    : liveResult;

  const pathwayResolved = resolveClinicalPathway({
    patient,
    transcript: patient.transcription || sttSessionOutput?.full_transcript || '',
    preferredPathway: complaintMatch?.complaintKey || null,
  });
  const pathwayKey = pathwayResolved.pathway
    || liveResult?.assessment_trail?.step2_complaint?.pathway
    || 'general';

  // Re-run clarifying when resolved pathway changes (e.g. fever inferred from temp)
  const pathwayKeyRef = useRef(pathwayKey);
  useEffect(() => {
    if (pathwayKeyRef.current === pathwayKey) return;
    pathwayKeyRef.current = pathwayKey;
    questionsGeneratedRef.current = false;
    setClarifyingQuestions([]);
    setClarifyingAnswers({});
    setClarifyingSource('empty');
    setModifierEvaluation(null);
  }, [pathwayKey]);

  // Re-score clarifying CTAS/destination when pain or vitals change (do not reshuffle questions)
  useEffect(() => {
    if (clarifyingSource !== 'modifier_engine') return;
    if (!modifierEvaluation && !selectedModifier) return;
    const initial = selectedModifier?.ctas || clarifyingLevel || liveLevel || 5;
    const evaluation = evaluateModifierEngine({
      patient,
      answers: { ...clarifyingAnswers, _selectedModifier: selectedModifier },
      transcript: patient.transcription || sttSessionOutput?.full_transcript || '',
      pathway: pathwayKey,
      initialLevel: initial,
      maxQuestions: 3,
      visualTriage,
    });
    setModifierEvaluation(evaluation);
    setClarifyingLevel(evaluation.updated_ctas ?? evaluation.initial_ctas ?? initial);
    // Vitals/pain rescore only — clarifying answers re-run the full pipeline elsewhere
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    patient.pain_score,
    patient.hr,
    patient.bp_systolic,
    patient.bp_diastolic,
    patient.spo2,
    patient.rr,
    patient.temperature,
    patient.gcs,
    visualTriage?.destination,
  ]);

  const update = (fieldsOrFn, { manual = true } = {}) => setPatient((prev) => {
    const next = typeof fieldsOrFn === 'function' ? fieldsOrFn(prev) : { ...prev, ...fieldsOrFn };
    if (manual && typeof fieldsOrFn === 'object') {
      Object.keys(fieldsOrFn).forEach((k) => {
        if (fieldsOrFn[k] !== prev[k]) manualEditedFieldsRef.current.add(k);
      });
    }
    const auditFields = ['hr', 'bp_systolic', 'bp_diastolic', 'spo2', 'rr', 'temperature', 'gcs', 'pain_score'];
    const changed = auditFields.filter((k) => next[k] !== prev[k] && prev[k] !== '' && prev[k] != null);
    if (changed.length > 0) {
      const entries = changed.map((k) => ({
        time: new Date().toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' }),
        msg: `${k} changed from ${prev[k]} to ${next[k]}`
      }));
      setAuditLog((a) => [...a, ...entries]);
    }
    return next;
  });

  const raiseUrgentAlert = (alert, source = 'local_red_flag_engine') => {
    if (!alert) return;
    const symptomsKey = (alert.symptoms || []).map((s) => s.en || s.ar || '').join('|');
    const key = `${alert.ctas_level || ''}-${symptomsKey}-${source}`;
    if (lastAlertKeyRef.current === key) return;
    lastAlertKeyRef.current = key;
    const enriched = {
      ...alert,
      source,
      triggered_at: alert.triggered_at || new Date().toISOString(),
    };
    setUrgentAlert(enriched);
    setCriticalAlertAudit((prev) => [...prev, createAuditEvent('critical_alert_triggered', user, enriched)]);
  };

  const acknowledgeUrgentAlert = (ack = {}) => {
    const acknowledgedAt = ack.acknowledged_at || new Date().toISOString();
    setCriticalAlertAudit((prev) => [...prev, createAuditEvent('critical_alert_acknowledged', user, { ...ack, acknowledged_at: acknowledgedAt })]);
    setUrgentAlert(null);
  };

  const generateClarifyingQuestions = async (complaint) => {
    if (!complaint) return;
    setLoadingQuestions(true);
    setClarifyingAnswers({});
    try {
      const confirmedFields = REQUIRED_FIELDS.filter((f) => f.check(patient)).map((f) => f.label_en);
      const result = await base44.integrations.Core.InvokeLLM({
        prompt: `You are a senior bilingual triage nurse assistant in a Saudi ED. Generate ONLY the minimum targeted follow-up questions needed for CTAS/CEDIS scoring. Use Arabic and English.

Chief Complaint: "${complaint}"
Patient Age: ${patient.age || 'unknown'}
Already confirmed data (DO NOT ask about these): ${confirmedFields.length ? confirmedFields.join(', ') : 'none yet'}
Selected complaint modifier: ${selectedModifier?.modifier || selectedModifier?.label_en || 'not selected'}

Rules:
- Ask only clinically required missing questions for the complaint, vital instability, pain, fever, bleeding, trauma, frailty, respiratory status, and altered consciousness.
- Maximum 4 questions.
- Handle pediatric patients (age <14) with pediatric phrasing.
- Do not invent CTAS rules; return questions to support clinician-confirmed scoring.

Return fields: field, question_ar, question_en, answer_type (yes_no|numeric|duration|multiple_choice), answer_options, why_needed_ar, why_needed_en`,
        response_json_schema: {
          type: 'object',
          properties: {
            questions: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  field: { type: 'string' }, question_ar: { type: 'string' }, question_en: { type: 'string' },
                  answer_type: { type: 'string' }, answer_options: { type: 'array', items: { type: 'string' } },
                  why_needed_ar: { type: 'string' }, why_needed_en: { type: 'string' }
                }
              }
            }
          }
        }
      });
      const normalized = normalizeLLMResponse(result);
      const mapped = (normalized.questions || []).slice(0, 4).map((q) => ({
        text_ar: q.question_ar,
        text_en: q.question_en,
        answer_type: q.answer_type === 'multiple_choice' ? 'options' : q.answer_type === 'numeric' ? 'numeric' : q.answer_type,
        answer_options: q.answer_options,
        clinical_relevance: q.why_needed_en,
        field: q.field,
        source: 'llm',
      }));
      setClarifyingQuestions(mapped);
      setClarifyingSource(mapped.length ? 'llm' : 'empty');
      setClarifyingLevel(selectedModifier?.ctas || liveResult?.level || null);
    } catch (err) {
      console.error(err);
      toast.error('فشل إنشاء أسئلة المتابعة — ' + (err?.message || 'Question generation failed'));
      setClarifyingQuestions([]);
      setClarifyingSource('empty');
    } finally {
      setLoadingQuestions(false);
    }
  };

  const runModifierEngine = (level, pathway, answers = {}, modifierOverride = null) => {
    const mod = modifierOverride !== undefined ? modifierOverride : selectedModifier;
    const pipeline = runClarifyingQuestionPipeline({
      patient,
      answers: { ...answers, _selectedModifier: mod },
      transcript: patient.transcription || sttSessionOutput?.full_transcript || '',
      pathway,
      level,
      selectedModifier: mod,
      maxQuestions: 3,
      visualTriage,
    });
    const evaluation = pipeline.modifier_evaluation || evaluateModifierEngine({
      patient,
      answers: { ...answers, _selectedModifier: mod },
      transcript: patient.transcription || sttSessionOutput?.full_transcript || '',
      pathway,
      initialLevel: level,
      maxQuestions: 3,
      visualTriage,
    });
    setModifierEvaluation(evaluation);
    setClarifyingQuestions(pipeline.questions);
    setClarifyingSource(pipeline.source === 'empty' ? 'empty' : (pipeline.source === 'bank' ? 'bank' : 'modifier_engine'));
    setClarifyingLevel(pipeline.level);
    // Seed known modifiers so scoring reflects conversation without re-asking
    if (pipeline.autoAnswers && Object.keys(pipeline.autoAnswers).length) {
      const seeded = { ...answers };
      for (const [k, v] of Object.entries(pipeline.autoAnswers)) {
        if (k.startsWith('_')) continue;
        if (seeded[k] == null || seeded[k] === '') seeded[k] = v;
      }
      setClarifyingAnswers(seeded);
    }
    return { ...evaluation, questions: pipeline.questions, pipelineSource: pipeline.source };
  };

  const applyBankQuestions = (level, pathway, answers = {}) => {
    const result = getClarifyingQuestions({ level, pathway, answers });
    setClarifyingQuestions(result.questions);
    setClarifyingSource(result.source);
    setClarifyingLevel(result.level);
    return result;
  };

  const handleClarifyingAnswer = (field, value) => {
    const next = { ...clarifyingAnswers };
    if (value === undefined) delete next[field];
    else next[field] = value;
    setClarifyingAnswers(next);
    if (field === 'symptom_chronicity' && value != null && value !== '') {
      setPatient((prev) => ({
        ...prev,
        symptom_chronicity: value,
        symptom_chronicity_source: 'provider',
      }));
      setAuditLog((a) => [
        ...a,
        {
          time: new Date().toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' }),
          msg: `Chronicity resolved: ${value}`,
          action: 'chronicity_resolved',
          details: { status: value, source: 'provider', question_asked: true },
        },
      ]);
    }
    if (clarifyingSource === 'modifier_engine' || clarifyingSource === 'empty') {
      const initial = clarifyingLevel || selectedModifier?.ctas || liveResult?.level || 5;
      // Full re-pipeline: rebuild facts, reselect ≤3 gaps, rescore by category
      const evaluation = runModifierEngine(initial, pathwayKey, next, selectedModifier);
      if (!evaluation.questions?.length && clarifyingSource === 'modifier_engine') {
        // Keep engine panel with updated CTAS/destination even when no further Qs
        setClarifyingSource('modifier_engine');
      }
      return;
    }
    if (clarifyingSource === 'bank') {
      const level = clarifyingLevel || selectedModifier?.ctas || liveResult?.level || 5;
      applyBankQuestions(level, pathwayKey, next);
    }
  };

  const handleModifierSelect = (modifier) => {
    setSelectedModifier(modifier);
    setClarifyingAnswers({});
    setModifierEvaluation(null);
    if (!modifier) {
      setClarifyingQuestions([]);
      setClarifyingSource('empty');
      setClarifyingLevel(null);
      questionsGeneratedRef.current = false;
      return;
    }
    const pathway = pathwayKey
      || complaintMatch?.complaintKey
      || liveResult?.assessment_trail?.step2_complaint?.pathway
      || 'general';
    // Unified pipeline: after Step 2, only safety + direction gaps (no CTAS re-verify / bank)
    const evaluation = runModifierEngine(modifier.ctas, pathway, {}, modifier);
    questionsGeneratedRef.current = true;
    if (evaluation.questions.length > 0) {
      requestAnimationFrame(() => {
        document.getElementById('clarifying-questions')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }
    // Do not fall back to bank/LLM CTAS-verification questions once Step 2 set acuity
  };

  const getConfirmedCount = () => REQUIRED_FIELDS.filter((f) => f.check(patient)).length;

  // Remove LLM questions whose fields are already filled manually (bank keeps fields for CTAS)
  useEffect(() => {
    if (clarifyingQuestions.length === 0 || clarifyingSource === 'bank') return;
    setClarifyingQuestions(prev =>
      prev.filter(q => {
        if (!q.field) return true;
        const val = patient[q.field];
        return val == null || val === '';
      })
    );
  }, [patient.hr, patient.spo2, patient.bp_systolic, patient.rr, patient.temperature, patient.gcs, patient.weight, patient.chief_complaint, patient.age, clarifyingSource]);

  // Auto-trigger modifier engine when complaint + (modifier OR basic vitals)
  const basicVitalsComplete = ['hr', 'bp_systolic', 'spo2', 'rr', 'chief_complaint'].every((k) => patient[k]);
  const readyForClarifying = Boolean(
    patient.chief_complaint && (selectedModifier || basicVitalsComplete),
  );
  useEffect(() => {
    if (!readyForClarifying || questionsGeneratedRef.current || ctasResult || loadingQuestions) return;
    const level = selectedModifier?.ctas
      || complaintMatch?.complaint?.default_ctas
      || liveResult?.level
      || 5;
    const pathway = pathwayKey
      || complaintMatch?.complaintKey
      || liveResult?.assessment_trail?.step2_complaint?.pathway
      || 'general';
    const evaluation = runModifierEngine(level, pathway, clarifyingAnswers, selectedModifier);
    questionsGeneratedRef.current = true;
    if (evaluation.questions.length > 0) return;
    if (!selectedModifier && basicVitalsComplete) {
      generateClarifyingQuestions(patient.chief_complaint);
    }
  }, [readyForClarifying, basicVitalsComplete, patient.chief_complaint, selectedModifier]);

  useEffect(() => {
    const localAlert = detectRedFlags(patient, answersWithModifier);
    const confirmed = REQUIRED_FIELDS.filter((f) => f.check(patient)).length;
    if (localAlert && confirmed >= 3 && ((liveResult?.level ?? 5) <= 2 || localAlert.ctas_level <= 2)) {
      raiseUrgentAlert(localAlert, 'local_red_flag_engine');
    }
  }, [patient.chief_complaint, patient.hr, patient.spo2, patient.bp_systolic, patient.rr, patient.gcs, patient.pain_score, clarifyingAnswers, selectedModifier, liveResult?.level]);

  const applySttSessionToPatient = useCallback((sessionOutput, { force = false } = {}) => {
    if (!sessionOutput?.fields) return;
    try {
    setSttSessionOutput(sessionOutput);
    const { updates, fieldConfidence } = mapSttSessionToPatientUpdates(sessionOutput.fields);
    const mentionedGap = sessionOutput.transcript_analysis?.mentionedNotExtracted || [];
    let mergedForMeta = null;
    const highlightKeys = new Set();

    update((prev) => {
      const next = { ...prev };
      for (const [key, value] of Object.entries(updates)) {
        const prevVal = prev[key];
        const hasPrev = prevVal != null && prevVal !== '';
        const valueChanged = hasPrev && String(prevVal) !== String(value);
        const prevConf = sttFieldConfidenceRef.current[key] ?? 0;
        const nextConf = fieldConfidence[key] ?? 0;
        const ctasKey = key === 'weight' ? 'weight' : key === 'bp_diastolic' ? 'bp_systolic' : key;
        const gapBoost = mentionedGap.includes(ctasKey) || mentionedGap.includes(key);
        // Voice correction: a new distinct value from re-dictation overwrites, even if
        // confidence is equal or the field was previously typed.
        if (!force && manualEditedFieldsRef.current.has(key) && !valueChanged) continue;
        if (!force && !gapBoost && !valueChanged && hasPrev && nextConf <= prevConf) continue;
        next[key] = value;
        if (valueChanged) manualEditedFieldsRef.current.delete(key);
        sttFieldConfidenceRef.current[key] = Math.max(nextConf, prevConf);
        if (['hr', 'bp_systolic', 'bp_diastolic', 'spo2', 'rr', 'temperature', 'gcs', 'pain_score', 'weight'].includes(key)) {
          highlightKeys.add(key);
        }
      }
      next.transcription = sessionOutput.full_transcript || prev.transcription;
      mergedForMeta = next;
      return next;
    }, { manual: false });

    if (highlightKeys.size) setHighlightedVitals(highlightKeys);
    if (mergedForMeta) {
      const ctasComp = computeCtasCompleteness(mergedForMeta);
      const confValues = Object.values(fieldConfidence);
      const avgConf = confValues.length
        ? confValues.reduce((a, b) => a + b, 0) / confValues.length
        : 0.7;
      setAiExtractionMeta({
        confidence: sttClampConfidence(avgConf || 0.7),
        missing_fields: ctasComp.missingLabels?.map((m) => m.label_en) || [],
        safety_note: sttSafetyDisclaimer(),
        field_confidence: { ...sttFieldConfidenceRef.current },
      });
    }
    } catch (err) {
    }
  }, [update]);

  const handleAssess = () => {
    const validation = validateTriageReady(patient);
    if (!validation.ok) {
      const missingText = validation.missing.map((f) => `${f.label_ar}/${f.label_en}`).join('، ');
      toast.error(validation.errors[0] || `يرجى إكمال الحقول: ${missingText}`);
      return;
    }
    const now = new Date().toISOString();
    setConfirmedTime(now);
    setTimerStatus('confirmed');
    const libraryVersions = getLibraryVersions();
    const narrative = buildNarrativeClinicalSummary({
      patient,
      transcript: sttSessionOutput?.full_transcript || patient.transcription || '',
      ctasLevel: displayCtasLevel || liveResult?.ctas_level || liveResult?.level,
      ctasNameAr: displayCtasMeta?.ar || liveResult?.ctas_name_ar || liveResult?.display?.name_ar,
      ctasNameEn: displayCtasMeta?.en || liveResult?.ctas_name_en || liveResult?.display?.name_en,
      waitAr: displayCtasMeta?.wait_ar || liveResult?.max_wait_time || liveResult?.display?.wait_ar,
      waitEn: displayCtasMeta?.wait_en || liveResult?.display?.wait_en,
      redFlags: liveResult?.red_flags_detail || liveResult?.red_flags,
      destinationAr: modifierEvaluation?.suggested_destination?.destination_ar,
      destinationEn: modifierEvaluation?.suggested_destination?.destination_en,
      modifierNotes: modifierEvaluation?.explanation?.en || null,
    });
    setCtasResult({
      ...displayLiveResult,
      clinical_summary_ar: narrative.clinical_summary_ar,
      clinical_summary_en: narrative.clinical_summary_en,
      step2_modifier: selectedModifier,
      assessment_trail: {
        ...(liveResult?.assessment_trail || {}),
        complaint_resolution: liveResult?.assessment_trail?.complaint_resolution || {
          status: complaintResolution.status,
          selected_key: complaintResolution.selected?.complaintKey || patient.confirmed_complaint_key || null,
          candidates: complaintResolution.candidates || [],
          needs_confirmation: !!complaintResolution.needs_confirmation,
        },
        chronicity: {
          ...(liveResult?.assessment_trail?.chronicity || {}),
          question_asked: clarifyingQuestions.some((q) => q.field === 'symptom_chronicity')
            || Object.prototype.hasOwnProperty.call(clarifyingAnswers, 'symptom_chronicity'),
          answer: clarifyingAnswers.symptom_chronicity || patient.symptom_chronicity || null,
        },
        clarifying: {
          source: clarifyingSource,
          level: clarifyingLevel,
          pathway: pathwayKey,
          answers: clarifyingAnswers,
          questions_shown: clarifyingQuestions.map((q) => q.id || q.field).filter(Boolean),
        },
        modifier_engine: modifierEvaluation
          ? {
              initial_ctas: modifierEvaluation.initial_ctas,
              updated_ctas: modifierEvaluation.updated_ctas,
              ctas_changed: modifierEvaluation.ctas_changed,
              explanation: modifierEvaluation.explanation,
              suggested_destination: modifierEvaluation.suggested_destination,
              destination_changed: modifierEvaluation.destination_changed,
              known_modifiers: modifierEvaluation.known_modifiers,
              known_facts: modifierEvaluation.known_facts,
              applied_modifiers: modifierEvaluation.applied_modifiers,
              direction_applied: modifierEvaluation.direction_applied,
              safety_applied: modifierEvaluation.safety_applied,
              answer_impacts: modifierEvaluation.answer_impacts,
              questions_shown: clarifyingQuestions.map((q) => ({
                id: q.id || q.field,
                category: q.question_category || q.category || null,
                reason_en: q.reason_en || q.clinical_relevance || null,
              })),
              team_leader_review: modifierEvaluation.team_leader_review,
              critical_alert: modifierEvaluation.critical_alert,
            }
          : null,
        library_versions: libraryVersions,
        triage_timer: {
          started_at: timerStartTime,
          confirmed_at: now,
        },
      },
      library_versions: libraryVersions,
      modifier_explanation: modifierEvaluation?.explanation || null,
      suggested_destination: modifierEvaluation?.suggested_destination || null,
      rules_recommended_ctas: displayCtasLevel || liveResult?.ctas_level || liveResult?.level,
      ai_recommended_ctas: displayCtasLevel || liveResult?.ctas_level || liveResult?.level,
      confidence_pct: Math.round((aiExtractionMeta?.confidence ?? 1) * 100),
      missing_fields: aiExtractionMeta?.missing_fields || [],
      safety_note: aiExtractionMeta?.safety_note || sttSafetyDisclaimer(),
      clinician_review_required: true,
      assessed_at: now,
    });
    setAuditLog((a) => [...a, { time: new Date().toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' }), msg: `CTAS recommendation generated: C${displayCtasLevel || liveResult?.ctas_level || liveResult?.level}` }]);
    setTimeout(() => document.getElementById('ctas-validation')?.scrollIntoView({ behavior: 'smooth' }), 150);
  };

  const toNum = (v) => { const n = parseFloat(v); return isNaN(n) ? undefined : n; };

  const handleSave = async () => {
    setSaving(true);
    const now = new Date().toISOString();
    const startedAt = activeJourney?.ctas_started_at || patient.ctas_started_at || timerStartTime || patient.arrival_time;
    const reviewedAt = nurseValidation?.reviewedAt || now;
    const finalLevel = nurseValidation?.nurseLevel ?? ctasResult?.ctas_level;
    const resultToSave = { ...ctasResult, ctas_level: finalLevel };
    if (Array.isArray(resultToSave.red_flags)) resultToSave.red_flags = resultToSave.red_flags.join(', ');
    if (Array.isArray(resultToSave.red_flags_ar)) resultToSave.red_flags_ar = undefined;

    const conversationLog = sttSessionOutput?.full_transcript || patient.transcription || '';
    const alertTriggered = criticalAlertAudit.some((e) => e.action === 'critical_alert_triggered');
    const firstAlert = criticalAlertAudit.find((e) => e.action === 'critical_alert_triggered');
    const firstAck = criticalAlertAudit.find((e) => e.action === 'critical_alert_acknowledged');
    const alertResponseSec = firstAlert?.at && firstAck?.at
      ? Math.max(0, Math.round((new Date(firstAck.at).getTime() - new Date(firstAlert.at).getTime()) / 1000))
      : null;
    const validation = validateTriageReady(patient);
    const auditTrail = [
      ...auditLog.map((e) => createAuditEvent(e.action || 'field_or_workflow_event', user, e.details || e)),
      ...criticalAlertAudit,
      createAuditEvent('complaint_resolution', user, {
        ...(ctasResult?.assessment_trail?.complaint_resolution || {}),
        confirmed_key: patient.confirmed_complaint_key || null,
      }),
      createAuditEvent('chronicity_resolved', user, {
        ...(ctasResult?.assessment_trail?.chronicity || {}),
        status: clarifyingAnswers.symptom_chronicity
          || patient.symptom_chronicity
          || ctasResult?.assessment_trail?.chronicity?.status
          || 'uncertain',
      }),
      createAuditEvent('clinician_review_saved', user, {
        rules_recommended_ctas: ctasResult?.rules_recommended_ctas || ctasResult?.ctas_level,
        clinician_final_ctas: finalLevel,
        agreement: nurseValidation?.agreed ?? true,
        override_reason: nurseValidation?.overrideReason || null,
      }),
    ];

    try {
      // Identity fields (nurse_name, reviewed_by, alert_acknowledged_by) are resolved
      // server-side by the saveTriageRecord function — they are NOT sent from the client.
      const triageRecord = {
        ...patient, ...resultToSave,
        patient_id: urlPid || patient.patient_id || activeJourney?.patient_id,
        transcription: conversationLog || patient.transcription,
        age: toNum(patient.age), hr: toNum(patient.hr),
        bp_systolic: toNum(patient.bp_systolic), bp_diastolic: toNum(patient.bp_diastolic),
        spo2: toNum(patient.spo2), rr: toNum(patient.rr),
        temperature: toNum(patient.temperature), gcs: toNum(patient.gcs),
        weight: toNum(patient.weight),
        pain_score: toNum(patient.pain_score),
        ai_ctas: ctasResult?.ai_recommended_ctas || ctasResult?.ctas_level,
        nurse_ctas: finalLevel,
        rules_recommended_ctas: ctasResult?.rules_recommended_ctas || ctasResult?.ctas_level,
        ai_recommended_ctas: ctasResult?.ai_recommended_ctas || ctasResult?.ctas_level,
        clinician_final_ctas: finalLevel,
        clinician_reviewed_at: reviewedAt,
        agreement: nurseValidation?.agreed ?? true,
        override_reason: nurseValidation?.overrideReason || null,
        flagged_for_review: !(nurseValidation?.agreed ?? true),
        ctas_started_at: startedAt,
        ctas_completed_at: now,
        triage_duration_min: startedAt ? Math.round((Date.now() - new Date(startedAt).getTime()) / 60000) : null,
        door_to_triage_min: patient.arrival_time && startedAt ? Math.round((new Date(startedAt).getTime() - new Date(patient.arrival_time).getTime()) / 60000) : null,
        alert_triggered: alertTriggered,
        alert_triggered_at: firstAlert?.at || null,
        alert_acknowledged_at: firstAck?.at || null,
        alert_response_sec: alertResponseSec,
        alert_summary: alertTriggered ? JSON.stringify(firstAlert?.details || {}) : null,
        ai_confidence: aiExtractionMeta?.confidence ?? null,
        safety_note: aiExtractionMeta?.safety_note || sttSafetyDisclaimer(),
        missing_fields: validation.missing.map((f) => f.label_en).join(', '),
        assessment_trail_json: ctasResult?.assessment_trail ? JSON.stringify(ctasResult.assessment_trail) : null,
        assessment_trail: ctasResult?.assessment_trail || null,
        library_versions: ctasResult?.library_versions || getLibraryVersions(),
        clinical_summary_en: resultToSave.clinical_summary_en || null,
        validated_payload: {
          rules_recommended_ctas: ctasResult?.rules_recommended_ctas || ctasResult?.ctas_level,
          ai_recommended_ctas: ctasResult?.ai_recommended_ctas || ctasResult?.ctas_level,
          clinician_final_ctas: finalLevel,
          agreement: nurseValidation?.agreed ?? true,
          override_reason: nurseValidation?.overrideReason || null,
          library_versions: ctasResult?.library_versions || getLibraryVersions(),
          triage_duration_min: startedAt ? Math.round((Date.now() - new Date(startedAt).getTime()) / 60000) : null,
          modifier_answers: clarifyingAnswers,
          known_facts: modifierEvaluation?.known_facts || null,
          answer_impacts: modifierEvaluation?.answer_impacts || null,
          direction_applied: modifierEvaluation?.direction_applied || null,
          safety_applied: modifierEvaluation?.safety_applied || null,
          weight_kg: toNum(patient.weight) ?? null,
          summary_ar: resultToSave.clinical_summary_ar || null,
          summary_en: resultToSave.clinical_summary_en || null,
        },
        audit_trail: serializeAuditTrail(auditTrail),
        clinical_summary_ar: resultToSave.clinical_summary_ar
          || (conversationLog ? conversationLog.slice(0, 500) : ''),
      };

      const journeyUpdate = activeJourney ? {
        ctas_level: finalLevel,
        rules_recommended_ctas: ctasResult?.rules_recommended_ctas || ctasResult?.ctas_level,
        ai_recommended_ctas: ctasResult?.ai_recommended_ctas || ctasResult?.ctas_level,
        clinician_final_ctas: finalLevel,
        ctas_reviewed_at: reviewedAt,
        chief_complaint: patient.chief_complaint,
        ctas_started_at: startedAt,
        ctas_completed_at: now,
        alert_triggered_at: firstAlert?.at || null,
        alert_acknowledged_at: firstAck?.at || null,
        alert_acknowledged_by: firstAck?.by || null,
        incomplete_data_flags: validation.missing.map((f) => f.label_en).join(', '),
        audit_trail: serializeAuditTrail(auditTrail),
        current_status: 'complete',
      } : null;

      await base44.functions.invoke('saveTriageRecord', {
        triage_record: triageRecord,
        journey_id: activeJourney?.id || null,
        journey_update: journeyUpdate,
      });
      toast.success('تم حفظ سجل الفرز');

      const allJourneys = await base44.entities.PatientJourney.list('-arrival_time', 50);
      const cutoff = Date.now() - 12 * 60 * 60 * 1000;
      const waiting = allJourneys.filter(p =>
        p.patient_id !== urlPid &&
        new Date(p.arrival_time).getTime() > cutoff &&
        ['ctas_pending', 'registration'].includes(p.current_status)
      );
      if (waiting.length > 0) {
        setNextPatient(waiting[0]);
        setShowNextPrompt(true);
      } else {
        navigate('/tracking');
      }
    } catch (err) {
      console.error(err);
      toast.error('فشل حفظ الفرز — ' + (err?.message || 'Triage save failed'));
    } finally {
      setSaving(false);
    }
  };

  const handleValidationComplete = ({ agreed, nurseLevel, overrideReason }) => {
    const reviewedAt = new Date().toISOString();
    setNurseValidation({ agreed, nurseLevel, overrideReason, reviewedAt, reviewedBy: user?.full_name || user?.email });
    setAuditLog((a) => [...a, {
      time: new Date().toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' }),
      msg: agreed ? `Clinician confirmed CTAS ${nurseLevel}` : `Clinician overrode to CTAS ${nurseLevel}: ${overrideReason}`
    }]);
    setTimeout(() => document.getElementById('ctas-result')?.scrollIntoView({ behavior: 'smooth' }), 150);
  };

  const handleReset = () => {
    setPatient(emptyPatient());
    setCtasResult(null);
    setClarifyingQuestions([]);
    setClarifyingAnswers({});
    setClarifyingSource('empty');
    setClarifyingLevel(null);
    setModifierEvaluation(null);
    setSelectedModifier(null);
    setUrgentAlert(null);
    setCriticalAlertAudit([]);
    lastAlertKeyRef.current = null;
    setNurseValidation(null);
    questionsGeneratedRef.current = false;
    setHighlightedVitals(new Set());
    setSttSessionOutput(null);
    manualEditedFieldsRef.current = new Set();
    sttFieldConfidenceRef.current = {};
    setAiExtractionMeta({ confidence: 1, missing_fields: [], safety_note: sttSafetyDisclaimer(), field_confidence: {} });
    setTimerStartTime(null);
    setTimerStatus('idle');
    setConfirmedTime(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    toast.success('جاهز للمريض التالي');
  };

  const assessValidation = validateTriageReady(patient);
  const isReady = assessValidation.ok;
  const confirmedCount = getConfirmedCount();

  return (
    <div dir="rtl" className="space-y-4">
      {/* New Patient Confirm Modal */}
      {showNewPatientConfirm && (
        <NewPatientConfirm
          currentPid={urlPid}
          currentName={patient.patient_name_ar || patient.patient_name_en}
          onCancel={() => setShowNewPatientConfirm(false)}
        />
      )}

      {/* Post-triage next patient prompt */}
      {showNextPrompt && (
        <TriageNextPrompt
          completedPatient={activeJourney}
          ctasLevel={nurseValidation?.nurseLevel ?? ctasResult?.ctas_level}
          nextPatient={nextPatient}
          onDismiss={() => { setShowNextPrompt(false); navigate('/tracking'); }}
        />
      )}

      {/* Patient selector strip */}
      <PatientSelectorStrip currentPid={urlPid} onSwitch={handleSwitchPatient} />

      {/* New Patient button — top right */}
      <div className="flex justify-end">
        <button
          onClick={() => setShowNewPatientConfirm(true)}
          className="flex items-center gap-1.5 px-3 py-2 bg-slate-700 text-white rounded-xl text-xs font-black hover:bg-slate-800"
        >
          <Plus className="w-3.5 h-3.5" /> مريض جديد / New Patient
        </button>
      </div>

      {activeJourney && <PatientTimeline journey={activeJourney} />}
      <UrgentAlert alert={urgentAlert} onDismiss={acknowledgeUrgentAlert} />

      {confirmedCount === 0 && (
        <div className="bg-green-50 border border-green-200 rounded-2xl px-4 py-3">
          <p className="text-sm font-black text-green-800">Speak or complete the fields below to assess CTAS / تحدث أو أكمل الحقول أدناه</p>
        </div>
      )}

      <VoiceTriagePanel
        journeyId={activeJourney?.id}
        patient={patient}
        onSessionUpdate={applySttSessionToPatient}
        onResync={(output) => applySttSessionToPatient(output, { force: true })}
        onRecordingStart={handleRecordingStart}
        ctasLevel={displayCtasLevel}
        ctasLabelAr={displayCtasMeta?.ar || displayLiveResult?.ctas_ar || null}
        ctasLabelEn={displayCtasMeta?.en || displayLiveResult?.ctas_en || null}
        ctasHex={displayCtasMeta?.hex || displayLiveResult?.hex || null}
      />

      <ArrivalTimer timerStartTime={timerStartTime} timerStatus={timerStatus} confirmedTime={confirmedTime} />

      <div id="chief-complaint"><QuickComplaints selected={patient.chief_complaint} onSelect={(v) => update({ chief_complaint: v, confirmed_complaint_key: null })} /></div>

      <ChiefComplaintConfirm
        resolution={complaintResolution}
        confirmedKey={patient.confirmed_complaint_key}
        onConfirm={handleComplaintConfirm}
      />

      {/* ═══ STEP 2 — Complaint Specific Modifier (shown when complaint is identified) ═══ */}
      {complaintMatch && !complaintResolution.needs_confirmation && (
        <ComplaintModifierSelector
          match={complaintMatch}
          selectedModifier={selectedModifier}
          onSelect={handleModifierSelect}
        />
      )}

      <div id="pain-scale"><PainScale value={patient.pain_score} onChange={(v) => update({ pain_score: v })} /></div>
      <div id="vitals-form"><VitalsForm vitals={patient} onChange={update} highlightedFields={highlightedVitals} /></div>

      <LiveCTASPanel liveResult={displayLiveResult} confirmed={isReady && !!ctasResult} selectedModifier={selectedModifier} />

      {/* ═══ CTAS MODIFIER ENGINE — after live CTAS; minimum relevant questions only ═══ */}
      {(loadingQuestions || clarifyingQuestions.length > 0 || !!selectedModifier || !!modifierEvaluation) && (
        <div id="clarifying-questions">
          {(clarifyingSource === 'modifier_engine' || !!modifierEvaluation) ? (
            <ModifierEnginePanel
              evaluation={modifierEvaluation}
              questions={clarifyingQuestions}
              answers={clarifyingAnswers}
              onAnswer={handleClarifyingAnswer}
              liveLevel={displayCtasLevel}
              loading={loadingQuestions}
            />
          ) : (
            <ClarifyingQuestions
              questions={clarifyingQuestions}
              answers={clarifyingAnswers}
              onAnswer={handleClarifyingAnswer}
              onRegenerate={() => {
                questionsGeneratedRef.current = false;
                generateClarifyingQuestions(patient.chief_complaint);
              }}
              loading={loadingQuestions}
              cascadeRules={clarifyingSource === 'bank' ? {} : CASCADE_RULES}
              patient={patient}
              liveLevel={displayCtasLevel}
              source={clarifyingSource}
              clarifyingLevel={clarifyingLevel}
            />
          )}
          {complaintMatch && !selectedModifier && clarifyingQuestions.length > 0 && (
            <div className="bg-amber-50 border border-amber-300 rounded-xl px-3 py-2 text-xs text-amber-800 font-bold mt-2">
              ⚠ لم يتم اختيار المعدّل المحدد (الخطوة ٢) بعد — Step 2 Complaint Modifier not yet selected
            </div>
          )}
        </div>
      )}

      {/* ═══ DATA COMPLETENESS BAR — shared with the floating recorder ═══ */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm px-4 py-3">
        <CompletenessChips
          patient={patient}
          onFieldClick={(f) => scrollToSection(f.scrollTo)}
        />
      </div>

      {/* ═══ CONFIRM TRIAGE BUTTON — hidden once nurse has validated ═══ */}
      {!nurseValidation && (
        <button
          onClick={handleAssess}
          disabled={!isReady}
          className={`w-full py-4 rounded-2xl font-bold text-lg flex items-center justify-center gap-3 shadow-lg transition-all ${
            isReady ? 'bg-teal-700 hover:bg-teal-800 text-white' : 'bg-slate-200 text-slate-400 cursor-not-allowed'
          } disabled:opacity-70`}
        >
          {isReady
            ? <><Stethoscope className="w-6 h-6" /> تأكيد الفرز — Confirm Triage · CTAS {displayCtasLevel || '?'}</>
            : <><Lock className="w-5 h-5" /> أدخل الشكوى الرئيسية للتفعيل — Enter chief complaint</>
          }
        </button>
      )}

      {/* ═══ VALIDATION — inline, same page ═══ */}
      {ctasResult && !nurseValidation && (
        <div id="ctas-validation">
          <CTASValidation result={ctasResult} patient={patient} onComplete={handleValidationComplete} />
        </div>
      )}

      {/* ═══ FINAL RESULT ═══ */}
      {ctasResult && nurseValidation && (
        <TriageResult
          id="ctas-result"
          result={{
            ...ctasResult,
            ctas_level: nurseValidation.nurseLevel,
            ai_ctas_level: ctasResult.ctas_level,
            nurse_overrode: !nurseValidation.agreed,
            override_reason: nurseValidation.overrideReason,
            reviewed_at: nurseValidation.reviewedAt,
            safety_note: ctasResult.safety_note || sttSafetyDisclaimer(),
            confidence_pct: ctasResult.confidence_pct,
          }}
          patient={patient}
          onSave={handleSave}
          onReset={handleReset}
          saving={saving}
        />
      )}

      {ctasResult && nurseValidation && (
        <button onClick={handleReset} className="w-full py-3 text-slate-500 text-sm underline">
          إعادة التقييم — Re-assess
        </button>
      )}
    </div>
  );
}