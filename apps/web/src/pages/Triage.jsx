// @ts-nocheck
import { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '@/api/client';
import { useAuth } from '@/lib/AuthContext';
import { toast } from 'sonner';
import { Plus, ShieldAlert } from 'lucide-react';
import PatientSelectorStrip from '@/components/triage/PatientSelectorStrip';
import NewPatientConfirm from '@/components/triage/NewPatientConfirm';
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
  resolveCtasDestination,
  CTAS_DESTINATIONS,
  getBankQuestionById,
  getActiveModifiers,
  clinicalSafetyDisclaimer as sttSafetyDisclaimer,
  clampConfidence as sttClampConfidence,
  CTAS_REQUIRED_FIELDS,
  CTAS_CONFIG,
  evaluateComorbidityRules,
  applyModifierLibraryEffects,
} from '@triagepulse/clinical';

import UrgentAlert from '@/components/triage/UrgentAlert';
import ComplaintModifierSelector from '@/components/triage/ComplaintModifierSelector';
import VoiceTriagePanel from '@/components/triage/VoiceTriagePanel';
import TriageTimer from '@/components/triage/flow/TriageTimer';
import CompletedScreen from '@/components/triage/flow/CompletedScreen';
import FieldGrid from '@/components/triage/flow/FieldGrid';
import LivePrompt from '@/components/triage/flow/LivePrompt';
import QuestionCard, { ANSWER_UNKNOWN, answerLabel } from '@/components/triage/flow/QuestionCard';
import DecisionBar from '@/components/triage/flow/DecisionBar';
import HeroResult from '@/components/triage/flow/HeroResult';
import VitalConfirmCard, { vitalLabel } from '@/components/triage/flow/VitalConfirmCard';
import ChangeSheet from '@/components/triage/flow/ChangeSheet';
import QuickComplaints from '@/components/triage/QuickComplaints';
import ChiefComplaintConfirm from '@/components/triage/ChiefComplaintConfirm';
import { deriveAssessment, nextPrompt } from '@/lib/triageAssessment';
import { buildTriageDocument } from '@/lib/triageDocument';
import { deriveCase, casePayload, caseSummaryLines } from '@/lib/caseModel';
import { ComplaintChips, HistoryChips } from '@/components/triage/flow/CaseChips';
import { useQuery } from '@tanstack/react-query';

const emptyPatient = () => ({
  patient_id: '',
  arrival_time: new Date().toISOString(),
  ctas_started_at: null,
  patient_name_ar: '', patient_name_en: '', mrn: '',
  age: '', gender: '', nationality: '', phone: '', insurance: '',
  chief_complaint: '', hr: '', bp_systolic: '', bp_diastolic: '',
  spo2: '', rr: '', temperature: '', gcs: '', weight: '',
  pain_score: null, transcription: '', receipt_image_url: '',
  onset_duration: '', relevant_history: '', current_medications: '', allergies: '',
  // Case details from the dictation, plus the nurse's corrections.
  case_details: null, primary_complaint: null, dismissed_complaints: [], dismissed_conditions: [],
  // Bedside checks some illness rules require (capillary glucose mmol/L; ketones positive/negative).
  glucose: '', ketones: '',
  // Vitals dictated with two different values, confirmed by the nurse: { spo2: '97' }.
  vital_confirmed: {},
});

/** Fields that can change CTAS; if any is missing a low level is never shown as a result. */
const CORE_KEYS = ['age', 'chief_complaint', 'pain_score', 'hr', 'bp_systolic', 'spo2', 'rr', 'temperature', 'gcs'];

const PEDIATRIC_DIRECTIONS = ['PEDIATRIC_RESUS', 'PEDIATRIC_OBSERVATION', 'PEDS_FAST_TRACK', 'PEDIATRIC_CLINIC', 'RESPIRATORY'];
const ADULT_DIRECTIONS = ['RESUSCITATION', 'ADULT_OBSERVATION', 'FM_IM', 'RESPIRATORY'];

/** Context filter on top of the engine: no pregnancy questions for male patients or young children. */
function questionFitsPatient(q, patient) {
  const text = `${q.field || ''} ${q.text_en || ''}`;
  const pregnancy = /pregnan/i.test(text) || /حامل|الحمل/.test(String(q.text_ar || ''));
  if (!pregnancy) return true;
  const age = parseFloat(patient.age);
  if (patient.gender === 'male') return false;
  if (Number.isFinite(age) && age < 10) return false;
  return true;
}

const REQUIRED_FIELDS = CTAS_REQUIRED_FIELDS;


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
  const [recording, setRecording] = useState(false);
  const [showChange, setShowChange] = useState(false);
  const [initialSnapshot, setInitialSnapshot] = useState(null);
  const [answeredLog, setAnsweredLog] = useState([]);
  const [unknownAnswers, setUnknownAnswers] = useState({});
  const [savedRecord, setSavedRecord] = useState(null);
  const unknownRef = useRef({});
  const savingRef = useRef(false);
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
    queryFn: () => api.journeys.findByPatientId(urlPid).then((j) => (j ? [j] : [])),
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
    // The server stamps ctas_started_at once (server time); use its value so
    // re-opening this patient never restarts the triage clock.
    api.journeys.startCtas(activeJourney.id)
      .then((j) => setPatient((prev) => ({ ...prev, ctas_started_at: j?.ctas_started_at || prev.ctas_started_at })))
      .catch((err) => {
        console.error('Failed to mark CTAS start', err);
        toast.error('تعذّر تسجيل بدء الفرز — Could not record triage start');
      });
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
    setAnsweredLog([]);
    unknownRef.current = {};
    setUnknownAnswers({});
    setInitialSnapshot(null);
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

  // Every complaint scored with the same vitals; the most urgent is the primary one.
  const cc = deriveCase(patient, { computeLiveCTAS, answers: clarifyingAnswers });
  // With several complaints the most urgent one is a floor: choosing a less urgent
  // primary never lowers CTAS by itself (only «Change» with a reason can).
  const complaintFloor = cc.complaints.length >= 2 ? (cc.mostUrgent?.level ?? null) : null;

  // Chronic illness + presenting problem (approved rule table): escalate-only floor,
  // plus bedside checks some rules need. Only stated (or nurse-confirmed) illnesses count.
  const comorb = evaluateComorbidityRules({
    patient,
    caseDetails: { complaints: cc.complaints, conditions: cc.conditions, medications: cc.medications, drug_classes: cc.medications.flatMap((m) => m.classes || []) },
    answers: clarifyingAnswers,
    transcript: sttSessionOutput?.full_transcript || patient.transcription || '',
  });

  // Two different readings dictated for one vital: until the nurse confirms, CTAS uses
  // the more urgent of them (never the more reassuring one).
  const vitalFields = (f) => (f === 'bp' ? ['bp_systolic', 'bp_diastolic'] : [f]);
  const withReading = (p, c, v) => (c.field === 'bp'
    ? { ...p, bp_systolic: v.split('/')[0], bp_diastolic: v.split('/')[1] }
    : { ...p, [c.field]: v });
  // A confirmation holds for the readings it was made on; a new, different reading asks again.
  const confirmedFor = (c) => patient.vital_confirmed?.[c.field]?.sig === c.values.join('|');
  const openConflicts = (patient.case_details?.vital_conflicts || []).filter((c) => !confirmedFor(c)
    && !vitalFields(c.field).some((k) => manualEditedFieldsRef.current.has(k)));
  const conflictLevels = openConflicts.flatMap((c) => c.values.map((v) => {
    try { return computeLiveCTAS(withReading(patient, c, v), answersWithModifier)?.level ?? null; } catch { return null; }
  })).filter((n) => n != null);
  const conflictFloor = conflictLevels.length ? Math.min(...conflictLevels) : null;

  // Most-urgent wins: live vitals/pain must move the badge even if clarifying evaluation is stale
  const levelInputs = [liveResult?.level, complaintFloor, comorb.floor, conflictFloor].filter((n) => n != null);
  const liveLevel = levelInputs.length ? Math.min(...levelInputs) : null;
  // The illness rule is what set the level when it is more urgent than everything else.
  const otherLevels = [liveResult?.level, complaintFloor, modifierEvaluation?.updated_ctas].filter((n) => n != null);
  const ruleSetsLevel = comorb.floor != null && (!otherLevels.length || comorb.floor < Math.min(...otherLevels));
  const leadRule = ruleSetsLevel ? comorb.applied.find((r) => r.floor === comorb.floor) : null;
  const evalLevel = modifierEvaluation?.updated_ctas ?? null;
  // The chief complaint follows the primary complaint while several are listed, and
  // always when the current one was removed by the nurse (even if one or none is left).
  const normC = (t) => String(t || '').trim().toLowerCase();
  const chiefWasRemoved = (patient.case_details?.complaints || [])
    .filter((c) => (patient.dismissed_complaints || []).includes(c.key || c.text))
    .some((c) => [c.text, c.label_en, c.label_ar].map(normC).includes(normC(patient.chief_complaint)));
  const ccPrimaryText = cc.complaints.length >= 2 || chiefWasRemoved ? (cc.primary?.text ?? '') : null;
  useEffect(() => {
    if (ccPrimaryText == null) return;
    // A complaint typed by the nurse is kept unless she picks one of the chips (or removed it).
    if (manualEditedFieldsRef.current.has('chief_complaint') && !patient.primary_complaint && !chiefWasRemoved) return;
    setPatient((prev) => (prev.chief_complaint === ccPrimaryText
      ? prev
      : { ...prev, chief_complaint: ccPrimaryText, confirmed_complaint_key: null }));
  }, [ccPrimaryText, patient.primary_complaint, chiefWasRemoved]);
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
    if (!modifierEvaluation && !selectedModifier) return;
    // Start from the current data, never from an earlier result: a corrected vital
    // (e.g. a mis-heard GCS) must be able to change the level again.
    const initial = selectedModifier?.ctas || liveResult?.level || 5;
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
    if (clarifyingSource === 'modifier_engine') setClarifyingLevel(evaluation.updated_ctas ?? evaluation.initial_ctas ?? initial);
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
    // A corrected complaint or age must re-score as well (same question set or not).
    patient.chief_complaint,
    patient.confirmed_complaint_key,
    patient.age,
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

  /**
   * Fallback clarifying questions when the modifier engine has none.
   * Uses the local, versioned question bank (deterministic, works offline, and
   * sends no patient text to an external AI service).
   */
  const generateClarifyingQuestions = (complaint) => {
    if (!complaint) return;
    setLoadingQuestions(true);
    setClarifyingAnswers({});
    try {
      const level = selectedModifier?.ctas
        || complaintMatch?.complaint?.default_ctas
        || liveResult?.level
        || 5;
      const pathway = pathwayKey
        || complaintMatch?.complaintKey
        || liveResult?.assessment_trail?.step2_complaint?.pathway
        || 'general';
      applyBankQuestions(level, pathway, {});
    } catch (err) {
      console.error(err);
      setClarifyingQuestions([]);
      setClarifyingSource('empty');
    } finally {
      setLoadingQuestions(false);
    }
  };

  const runModifierEngine = (level, pathway, answers = {}, modifierOverride = null) => {
    const mod = modifierOverride !== undefined ? modifierOverride : selectedModifier;
    // Questions answered "unknown" stay out of the engine; widen the window so they
    // do not take one of the three slots.
    const maxQuestions = 3 + Object.keys(unknownRef.current).length;
    const pipeline = runClarifyingQuestionPipeline({
      patient,
      answers: { ...answers, _selectedModifier: mod },
      transcript: patient.transcription || sttSessionOutput?.full_transcript || '',
      pathway,
      level,
      selectedModifier: mod,
      maxQuestions,
      visualTriage,
    });
    const evaluation = pipeline.modifier_evaluation || evaluateModifierEngine({
      patient,
      answers: { ...answers, _selectedModifier: mod },
      transcript: patient.transcription || sttSessionOutput?.full_transcript || '',
      pathway,
      initialLevel: level,
      maxQuestions,
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
      const initial = selectedModifier?.ctas || liveResult?.level || 5;
      // Full re-pipeline: rebuild facts, reselect ≤3 gaps, rescore by category
      const evaluation = runModifierEngine(initial, pathwayKey, next, selectedModifier);
      if (!evaluation.questions?.length && clarifyingSource === 'modifier_engine') {
        // Keep engine panel with updated CTAS/destination even when no further Qs
        setClarifyingSource('modifier_engine');
      }
      return;
    }
    if (clarifyingSource === 'bank') {
      const level = selectedModifier?.ctas || liveResult?.level || 5;
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

    // With several complaints the primary one is chosen below (most urgent, or the nurse's pick).
    const multiComplaint = (sessionOutput.case_details?.complaints?.length || 0) >= 2;
    update((prev) => {
      const next = { ...prev };
      if (sessionOutput.case_details) {
        next.case_details = sessionOutput.case_details;
        // Glucose / ketones said aloud fill empty tiles; a typed value is never overwritten.
        const bed = sessionOutput.case_details.bedside || {};
        if (bed.glucose && (prev.glucose === '' || prev.glucose == null)) next.glucose = String(bed.glucose.value);
        if (bed.ketones && !prev.ketones) next.ketones = bed.ketones.value;
        const cd = sessionOutput.case_details;
        const typed = manualEditedFieldsRef.current;
        if (!next.current_medications && !typed.has('current_medications') && cd.medications?.length) {
          next.current_medications = cd.medications.map((m) => m.name).join('، ');
        }
        const present = (cd.conditions || []).filter((c) => c.status === 'present');
        if (!next.relevant_history && !typed.has('relevant_history') && present.length) {
          next.relevant_history = present.map((c) => `${c.label_ar} · ${c.label_en}`).join('، ');
        }
      }
      for (const [key, value] of Object.entries(updates)) {
        if (key === 'chief_complaint' && multiComplaint) continue;
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
      // History fields are free text: fill only when empty and not typed by the nurse.
      const f = sessionOutput.fields || {};
      const textOf = (slot) => {
        const v = slot?.value;
        if (v == null || v === '') return '';
        return Array.isArray(v) ? v.filter(Boolean).join(', ') : String(v);
      };
      // The extractor can put the same phrase in several slots ("on metformin, no known
      // allergies" in history and medications). Keep each phrase in its own field only.
      const ALLERGY_RE = /no known allergies|\bnkda\b|لا\s*حساسية|بدون\s*حساسية|allerg|حساسية/i;
      const parts = (v) => v.split(/[,،;]/).map((x) => x.trim()).filter(Boolean);
      const allergies = textOf(f.allergies);
      const medsParts = parts(textOf(f.current_medications)).filter((x) => !ALLERGY_RE.test(x));
      const meds = [...new Set(medsParts)].join(', ');
      const medsLower = medsParts.map((x) => x.toLowerCase());
      const history = parts(textOf(f.relevant_history))
        .filter((x) => !ALLERGY_RE.test(x) && !medsLower.includes(x.toLowerCase()))
        .join(', ');
      const historyFields = {
        onset_duration: textOf(f.onset_duration),
        relevant_history: history,
        current_medications: meds,
        allergies,
      };
      for (const [key, v] of Object.entries(historyFields)) {
        if (v && !prev[key] && !manualEditedFieldsRef.current.has(key)) next[key] = v;
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
      return false;
    }
    const now = new Date().toISOString();
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
    const built = {
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
    };
    setCtasResult(built);
    setAuditLog((a) => [...a, { time: new Date().toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' }), msg: `CTAS recommendation generated: C${displayCtasLevel || liveResult?.ctas_level || liveResult?.level}` }]);
    return built;
  };

  const toNum = (v) => { const n = parseFloat(v); return isNaN(n) ? undefined : n; };

  const nurseValidationState = nurseValidation;
  const ctasResultState = ctasResult;
  const handleSave = async (decisionArg = null, resultArg = null) => {
    // Confirm passes the decision and the freshly built result directly, so saving does
    // not wait for React state to update.
    const nurseValidation = decisionArg || nurseValidationState;
    const ctasResult = resultArg || ctasResultState;
    const finalDirection = nurseValidation?.direction || directionAi;
    let savedOk = false;
    // The recommendation of record is what the nurse saw. When CTAS was pending, none was
    // made: store null (the engine's provisional value goes to validated_payload only).
    const aiShownLevel = shownLevel ?? null;
    // One record per triage: a synchronous lock stops double taps before React re-renders.
    if (savingRef.current || savedRecord) return;
    if (!nurseValidation) { toast.error('أكّد الفرز أو عدّله أولاً · Confirm or override first'); return; }
    savingRef.current = true;
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
        rules_recommended_ctas: aiShownLevel,
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
        gender: ['male', 'female'].includes(patient.gender) ? patient.gender : undefined,
        patient_id: urlPid || patient.patient_id || activeJourney?.patient_id,
        transcription: conversationLog || patient.transcription,
        age: toNum(patient.age), hr: toNum(patient.hr),
        bp_systolic: toNum(patient.bp_systolic), bp_diastolic: toNum(patient.bp_diastolic),
        spo2: toNum(patient.spo2), rr: toNum(patient.rr),
        temperature: toNum(patient.temperature), gcs: toNum(patient.gcs),
        weight: toNum(patient.weight),
        pain_score: toNum(patient.pain_score),
        ai_ctas: aiShownLevel,
        nurse_ctas: finalLevel,
        rules_recommended_ctas: aiShownLevel,
        ai_recommended_ctas: aiShownLevel,
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
          rules_recommended_ctas: aiShownLevel,
          ai_recommended_ctas: aiShownLevel,
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
          ai_assessment_status: ctasBox.status,
          engine_provisional_level: a.engineLevel,
          initial_assessment: initialSnapshot,
          patient_direction: {
            ai: directionAi ? { destination: directionAi.destination, destination_en: directionAi.destination_en, reason: directionReason } : null,
            final: finalDirection ? { destination: finalDirection.destination, destination_en: finalDirection.destination_en } : null,
            overridden: !!(finalDirection && directionAi && finalDirection.destination !== directionAi.destination),
            override_reason: nurseValidation?.overrideReason || null,
          },
          clarifications: answeredLog.map((a) => ({
            field: a.field, question_en: a.text_en, question_ar: a.text_ar, answer: a.value, unknown: a.value === ANSWER_UNKNOWN,
          })),
          history: {
            onset_duration: patient.onset_duration || null,
            relevant_history: patient.relevant_history || null,
            current_medications: patient.current_medications || null,
            allergies: patient.allergies || null,
          },
          outstanding_missing: outstanding,
          case_details: casePayload(cc),
          comorbidity_rules: {
            version: comorb.version,
            applied: comorb.applied,
            required_checks: comorb.required,
            pending_checks: comorb.pendingChecks,
            set_level: !!leadRule,
          },
          vital_confirmations: (patient.case_details?.vital_conflicts || []).map((c) => ({
            field: c.field, dictated: c.values, chosen: patient.vital_confirmed?.[c.field]?.v ?? null,
            resolved_by: patient.vital_confirmed?.[c.field] ? 'nurse_pick' : 'nurse_edit',
          })),
          bedside: { glucose_mmol: (patient.glucose ?? '') === '' ? null : Number(patient.glucose), ketones: patient.ketones || null },
        },
        disposition: finalDirection ? `${finalDirection.destination} | ${finalDirection.destination_en}` : null,
        audit_trail: serializeAuditTrail(auditTrail),
        clinical_summary_ar: resultToSave.clinical_summary_ar
          || (conversationLog ? conversationLog.slice(0, 500) : ''),
      };

      // A triage needs a journey. If CTAS was opened directly (not from Visual
      // Triage), create the journey now so the save cannot fail on a missing id.
      let journeyId = activeJourney?.id || null;
      if (!journeyId) {
        const ageNum = toNum(patient.age);
        const created = await api.journeys.create({
          patientNameAr: patient.patient_name_ar || undefined,
          patientNameEn: patient.patient_name_en || undefined,
          age: ageNum != null ? Math.round(ageNum) : undefined,
          gender: ['male', 'female'].includes(patient.gender) ? patient.gender : undefined,
          phone: patient.phone || undefined,
        });
        journeyId = created.id;
      }

      // The server derives every journey field (status, CTAS levels, timestamps)
      // from this record; the client no longer sends journey columns directly.
      await api.triage.save({
        journey_id: journeyId,
        triage_record: { ...triageRecord, alert_acknowledged_by: firstAck?.by || null },
      });
      setSavedRecord({
        at: now,
        document: buildTriageDocument({
          ...documentInput,
          finalLevel: nurseValidation?.nurseLevel,
          direction: finalDirection,
          overridden: !nurseValidation?.agreed,
          overrideReason: nurseValidation?.overrideReason,
          completedAt: now,
        }),
      });
      savedOk = true;
      toast.success('تم حفظ سجل الفرز · Triage saved');
      window.scrollTo({ top: 0, behavior: 'smooth' });

      // Offer the next waiting patient on the completion screen (no auto-navigation).
      try {
        const allJourneys = await api.journeys.listActive();
        const cutoff = Date.now() - 12 * 60 * 60 * 1000;
        const waiting = allJourneys.filter(p =>
          p.patient_id !== urlPid &&
          new Date(p.arrival_time).getTime() > cutoff &&
          ['ctas_pending', 'registration'].includes(p.current_status)
        );
        setNextPatient(waiting[0] || null);
      } catch { /* the list is optional */ }
    } catch (err) {
      console.error(err);
      toast.error('فشل حفظ الفرز — ' + (err?.message || 'Triage save failed'));
      savingRef.current = false;
    } finally {
      setSaving(false);
    }
    return savedOk;
  };

  // ── Derived assessment (display rules shared with the scenario validator) ──
  const a = deriveAssessment({
    patient,
    liveLevel,
    evalLevel,
    modifierEvaluation,
    answers: clarifyingAnswers,
    visualTriage,
  }, { CTAS_REQUIRED_FIELDS: REQUIRED_FIELDS, resolveCtasDestination });
  const shownLevel = a.level;
  const directionAi = a.direction;
  const directionReason = a.directionReason;
  const missingFields = a.missingFields;
  const critical = a.critical;
  const criticalText = shownLevel === 1
    ? { ar: 'إنعاش: تدخل فوري الآن', en: 'Resuscitation: immediate intervention' }
    : shownLevel === 2
      ? { ar: 'طارئ: تقييم الطبيب خلال ١٥ دقيقة', en: 'Emergent: physician assessment within 15 minutes' }
      : { ar: 'تنبيه سلامة حرج: مراجعة سريرية فورية', en: 'Critical safety alert: immediate clinical review' };

  const complaintInfo = liveResult?.assessment_trail?.step1_chief_complaint?.complaint;
  const pathwayLabel = complaintInfo ? `${complaintInfo.name_ar} · ${complaintInfo.name_en}` : null;
  const finalDirection = nurseValidation?.direction || directionAi;
  const decidedStatus = nurseValidation ? (nurseValidation.agreed ? 'confirmed' : 'overridden') : null;
  const answeredAny = answeredLog.length > 0;
  // Findings the engine took from the dictation (e.g. "has stridor" → Yes). Shown with
  // the answers so the nurse can see and correct them; an explicit answer always wins.
  const answeredFields = new Set(answeredLog.map((x) => x.field));
  const dictatedFindings = Object.entries(clarifyingAnswers)
    .filter(([f, v]) => !f.startsWith('_') && !answeredFields.has(f) && v != null && v !== '')
    .map(([f, v]) => {
      const m = (getActiveModifiers?.() || []).find((x) => x.field === f);
      if (!m || !m.question_ar) return null;
      const opt = (m.options || []).find((o) => o.value === v);
      return {
        field: f, value: v, auto: true,
        text_ar: m.question_ar, text_en: m.question_en,
        label: opt ? `${opt.label_ar} · ${opt.label_en}` : answerLabel(v),
        value_en: opt?.label_en || String(answerLabel(v)).split(' · ').pop(),
        category: m.question_category || 'ctas_modifier',
        yesNo: m.answer_type === 'yes_no',
      };
    })
    .filter(Boolean);
  /**
   * What actually holds the shown level, so the nurse can see why it does not change:
   * an unconfirmed reading, an illness rule, an answer, a vital sign or the complaint.
   */
  function levelReason() {
    const L = nurseValidation?.nurseLevel ?? shownLevel;
    if (L == null || nurseValidation) return null;
    if (conflictFloor === L) {
      const c = openConflicts.find((x) => x.values.some((v) => {
        try { return computeLiveCTAS(withReading(patient, x, v), answersWithModifier)?.level === L; } catch { return false; }
      }));
      if (c) return { ar: `قراءة غير مؤكدة: ${vitalLabel(c.field).ar} (${c.values.join(' / ')})`, en: `unconfirmed reading: ${vitalLabel(c.field).en} (${c.values.join(' / ')})` };
    }
    if (leadRule && leadRule.floor === L) {
      return { ar: `${leadRule.label_ar} + ${leadRule.trigger_ar} (تاريخ مرضي عالي الخطورة)`, en: `${leadRule.label_en} + ${leadRule.trigger_en} (high-risk history)` };
    }
    for (const ans of [...answeredLog, ...dictatedFindings]) {
      let lvl = null;
      try { lvl = applyModifierLibraryEffects({ [ans.field]: ans.value }, 5).level; } catch { lvl = null; }
      if (lvl === L && L < 5) {
        const short = (t) => String(t || '').replace(/\s*\(.*?\)\s*/g, ' ').replace(/[؟?]\s*$/, '').trim();
        const opt = (t) => String(t || '').split(' · ')[0].split(':')[0].trim();
        return { ar: `${short(ans.text_ar) || ans.field}: ${opt(ans.label)}`, en: `${short(ans.text_en) || ans.field}: ${opt(ans.value_en || ans.label)}` };
      }
    }
    const vital = (liveResult?.assessment_trail?.step4_final?.candidates || [])
      .find((x) => x.level === L && !/baseline|خط أساس/i.test(`${x.label_en} ${x.label_ar}`));
    if (vital) return { ar: vital.label_ar || vital.label_en, en: vital.label_en };
    if (cc.complaints.length >= 2 && cc.primary) return { ar: cc.primary.label_ar, en: cc.primary.label_en };
    return null;
  }

  const ctasBox = {
    level: nurseValidation?.nurseLevel ?? shownLevel,
    // "At least" also while a check an illness rule needs (glucose, ketones…) is missing.
    // (Rules raise to CTAS 2 at most, so this only matters above that.)
    atLeast: !nurseValidation && (a.atLeast || (comorb.applied.length > 0 && comorb.pendingChecks.length > 0 && (shownLevel ?? 5) > 2)),
    status: decidedStatus || (a.pending ? 'incomplete' : (answeredAny ? 'updated' : 'preliminary')),
    changedFrom: initialSnapshot?.level ?? null,
    note: null,
    drivenBy: levelReason(),
  };
  const directionBox = {
    status: decidedStatus || (directionAi ? (answeredAny ? 'updated' : 'preliminary') : 'pending'),
    destination_ar: finalDirection?.destination_ar,
    destination_en: finalDirection?.destination_en,
    pathway: pathwayLabel,
    reason: nurseValidation && !nurseValidation.agreed ? nurseValidation.overrideReason : directionReason,
    changedFrom: initialSnapshot?.direction && directionAi && initialSnapshot.direction !== directionAi.destination
      ? initialSnapshot.direction_label : null,
  };

  // ── Clarifying questions: highest impact first, one at a time ───────
  const optionLabels = (q) => {
    if (q.answer_type !== 'options') return null;
    const src = getBankQuestionById?.(q.id)?.options
      || getActiveModifiers?.().find((m) => m.id === q.id)?.options
      || null;
    if (!src) return null;
    return (q.answer_options || []).map((v) => {
      const o = src.find((x) => x.value === v);
      if (!o) return { value: v, label: v };
      const same = !o.label_en || o.label_en === o.label_ar;
      return { value: v, label: same ? (o.label_ar || v) : `${o.label_ar} · ${o.label_en}` };
    });
  };
  // A chronic illness known only from a medicine is confirmed first (one yes/no question).
  const openQuestions = [...comorb.confirmQuestions, ...clarifyingQuestions]
    .filter((q) => {
      if (!q.field) return true;
      if (unknownAnswers[q.field]) return false;
      const v = clarifyingAnswers[q.field];
      if (v != null && v !== '') return false;
      return questionFitsPatient(q, patient);
    })
    .map((q) => ({ ...q, _options: optionLabels(q) }));
  const openSafety = openQuestions.filter((q) => (q.question_category || q.category) === 'safety_escalation');

  const redFlagText = (liveResult?.red_flags || []).map((f) => (typeof f === 'string' ? f : (f.ar || f.en || ''))).filter(Boolean);
  const findings = [
    ...redFlagText,
    ...(modifierEvaluation?.known_facts || [])
      .filter((f) => f.status === 'known_positive' && f.field !== 'chief_complaint')
      .map((f) => f.label_ar || f.label_en || f.field),
  ].filter((v, i, arr) => v && arr.indexOf(v) === i);
  const justification = shownLevel == null ? [] : [
    liveResult?.primary_determinant_ar && `${liveResult.primary_determinant_ar} · ${liveResult.primary_determinant_en || ''}`,
    ...(liveResult?.modifiers || []).slice(0, 3).map((m) => m.label_ar || m.label_en),
    modifierEvaluation?.explanation?.changed && modifierEvaluation.explanation.ar,
    directionReason && `التوجيه: ${directionReason}`,
  ].filter(Boolean);
  const outstanding = [
    ...missingFields.map((f) => `${f.label_ar} · ${f.label_en}`),
    ...answeredLog.filter((x) => x.value === ANSWER_UNKNOWN).map((x) => `${x.text_ar || x.text_en} (غير معروف)`),
  ];
  const safetyAlerts = [
    critical && `${criticalText.ar} · ${criticalText.en}`,
    modifierEvaluation?.critical_alert && 'تنبيه سلامة حرج من محرك المعدّلات · Critical safety alert',
    modifierEvaluation?.team_leader_review && 'يُوصى بمراجعة قائد الفريق · Team leader review recommended',
    ...redFlagText.map((t) => `علامة خطر: ${t}`),
  ].filter(Boolean);
  const ruleWhy = comorb.applied.map((r) => `تاريخ مرضي عالي الخطورة · High-risk history: ${r.label_ar} + ${r.trigger_ar} → CTAS ≤ ${r.floor} · ${r.label_en} + ${r.trigger_en} [${r.id}]${r.note_en ? ` — ${r.note_en}` : ''}`);
  const complaintWhy = cc.complaints.length >= 2 && cc.primary ? [
    `الشكوى المحددة للمستوى · Set by: ${cc.primary.label_ar} · ${cc.primary.label_en}${cc.chosenByNurse ? ' (اختيار الممرض · nurse choice)' : ''}`,
    `الشكاوى · Complaints: ${cc.complaints.map((c) => `${c.label_en}${c.level ? ` (CTAS ${c.level})` : ''}`).join('، ')}`,
  ] : [];
  const why = [
    ...ruleWhy,
    ...complaintWhy,
    ...justification,
    ...findings.slice(0, 6).map((f) => `+ ${f}`),
    ...(outstanding.length ? [`ناقص · Missing: ${outstanding.join('، ')}`] : []),
  ];

  const directionOptions = (a.pediatric ? PEDIATRIC_DIRECTIONS : ADULT_DIRECTIONS).map((k) => CTAS_DESTINATIONS[k]);
  const documentInput = {
    patient,
    patientId: urlPid || patient.patient_id || activeJourney?.patient_id,
    finalLevel: nurseValidation?.nurseLevel,
    aiLevel: shownLevel,
    initialLevel: initialSnapshot?.level ?? null,
    direction: finalDirection,
    aiDirection: directionAi,
    overridden: nurseValidation ? !nurseValidation.agreed : false,
    overrideReason: nurseValidation?.overrideReason,
    justification,
    positives: findings,
    answers: answeredLog,
    outstanding: missingFields.map((f) => f.label_en),
    safetyAlerts,
    caseLines: [
      ...caseSummaryLines(cc),
      ...((patient.glucose ?? '') !== '' || patient.ketones ? [`Capillary glucose: ${(patient.glucose ?? '') !== '' ? `${patient.glucose} mmol/L` : '—'}    Ketones: ${patient.ketones || '—'}`] : []),
      ...comorb.applied.map((r) => `High-risk history rule ${r.id}: ${r.label_en} + ${r.trigger_en} → CTAS ≤ ${r.floor}`),
      ...(comorb.pendingChecks.length ? [`Outstanding check: ${comorb.pendingChecks.map((c) => c.en).join(', ')}`] : []),
    ],
    nurse: user?.full_name || user?.email,
  };

  const transcript = sttSessionOutput?.full_transcript || patient.transcription || '';
  const hasData = !!(transcript || CORE_KEYS.some((k) => patient[k] !== '' && patient[k] != null));
  const done = !!savedRecord;

  // ── Session effects ──────────────────────────────────────────────────
  const handleRecordingChange = useCallback((rec) => setRecording(rec), []);

  // The first time recording stops: remember the initial recommendation (to explain
  // later changes) and make sure the clarifying questions are ready.
  const wasRecordingRef = useRef(false);
  useEffect(() => {
    const stopped = wasRecordingRef.current && !recording;
    wasRecordingRef.current = recording;
    if (!stopped) return;
    setInitialSnapshot((snap) => snap || {
      level: shownLevel,
      direction: directionAi?.destination || null,
      direction_label: directionAi ? `${directionAi.destination_ar} · ${directionAi.destination_en}` : null,
      at: new Date().toISOString(),
    });
    if (!questionsGeneratedRef.current && patient.chief_complaint) {
      const level = selectedModifier?.ctas || complaintMatch?.complaint?.default_ctas || liveResult?.level || 5;
      runModifierEngine(level, pathwayKey, clarifyingAnswers, selectedModifier);
      questionsGeneratedRef.current = true;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recording]);

  // Things said later in the dictation answer questions already selected: re-run the
  // question pipeline (debounced) so they drop out instead of being asked.
  useEffect(() => {
    if (!questionsGeneratedRef.current || clarifyingSource === 'bank' || !patient.chief_complaint) return undefined;
    const id = setTimeout(() => {
      const level = selectedModifier?.ctas || liveResult?.level || 5;
      runModifierEngine(level, pathwayKey, clarifyingAnswers, selectedModifier);
    }, 1500);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patient.transcription]);

  // Manual entry also starts the triage clock.
  useEffect(() => {
    if (hasData && !timerStartTime) handleRecordingStart();
  }, [hasData, timerStartTime, handleRecordingStart]);

  // ── Answers (Yes / No / Unknown), advancing immediately ─────────────
  const handleFlowAnswer = (q, value, label) => {
    const entry = {
      field: q.field, text_ar: q.text_ar, text_en: q.text_en, value,
      label: label || answerLabel(value),
      value_en: String(label || answerLabel(value)).split(' · ').pop(),
      category: q.question_category || q.category || null,
    };
    setAnsweredLog((prev) => [...prev.filter((x) => x.field !== q.field), entry]);
    setAuditLog((log) => [...log, {
      time: new Date().toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' }),
      msg: `Clarifying answer: ${q.field} = ${value}`,
      action: 'clarifying_answer',
      details: { field: q.field, answer: value, unknown: value === ANSWER_UNKNOWN },
    }]);
    if (value === ANSWER_UNKNOWN) {
      // Not sent to the engine as yes or no; re-run so another question can take the slot.
      unknownRef.current = { ...unknownRef.current, [q.field]: true };
      setUnknownAnswers(unknownRef.current);
      const initial = selectedModifier?.ctas || liveResult?.level || 5;
      if (clarifyingSource === 'bank') applyBankQuestions(initial, pathwayKey, clarifyingAnswers);
      else runModifierEngine(initial, pathwayKey, clarifyingAnswers, selectedModifier);
      return;
    }
    if (unknownRef.current[q.field]) {
      const { [q.field]: _drop, ...rest } = unknownRef.current;
      unknownRef.current = rest;
      setUnknownAnswers(rest);
    }
    handleClarifyingAnswer(q.field, value);
  };

  const handleChangeAnswer = (field) => {
    setAnsweredLog((prev) => prev.filter((x) => x.field !== field));
    if (unknownRef.current[field]) {
      const { [field]: _drop, ...rest } = unknownRef.current;
      unknownRef.current = rest;
      setUnknownAnswers(rest);
    }
    handleClarifyingAnswer(field, undefined);
  };

  // ── Conflicting vital readings: the nurse picks the right one ───────
  const pickVitalReading = (c, v) => {
    // The picked value is the nurse's: later dictation does not overwrite it.
    vitalFields(c.field).forEach((k) => manualEditedFieldsRef.current.add(k));
    setPatient((prev) => ({
      ...withReading(prev, c, v),
      vital_confirmed: { ...(prev.vital_confirmed || {}), [c.field]: { v, sig: c.values.join('|') } },
    }));
    setAuditLog((log) => [...log, {
      time: new Date().toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' }),
      msg: `Vital reading confirmed: ${c.field} = ${v} (dictated: ${c.values.join(' / ')})`,
      action: 'vital_reading_confirmed',
      details: { field: c.field, chosen: v, values: c.values },
    }]);
  };

  // ── Complaints and history: the nurse's corrections ─────────────────
  const logCase = (msg, action, details) => setAuditLog((log) => [...log, {
    time: new Date().toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' }),
    msg, action, details,
  }]);
  const makePrimaryComplaint = (c) => {
    const auto = cc.mostUrgent?.id === c.id;
    manualEditedFieldsRef.current.delete('chief_complaint');
    setPatient((prev) => ({ ...prev, primary_complaint: auto ? null : c.id, chief_complaint: c.text, confirmed_complaint_key: null }));
    logCase(`Primary complaint: ${c.text}`, 'primary_complaint_changed', {
      to: { key: c.key, level: c.level }, most_urgent: cc.mostUrgent ? { key: cc.mostUrgent.key, level: cc.mostUrgent.level } : null, by: auto ? 'auto' : 'nurse',
    });
  };
  const removeComplaint = (c) => {
    setPatient((prev) => ({
      ...prev,
      dismissed_complaints: [...(prev.dismissed_complaints || []), c.id],
      primary_complaint: prev.primary_complaint === c.id ? null : prev.primary_complaint,
    }));
    logCase(`Complaint removed: ${c.text}`, 'complaint_removed', { key: c.key, text: c.text, level: c.level });
  };
  const removeCondition = (c) => {
    setPatient((prev) => ({ ...prev, dismissed_conditions: [...(prev.dismissed_conditions || []), c.id] }));
    logCase(`History item removed: ${c.label_en}`, 'condition_removed', { id: c.id, status: c.status, source: c.source });
  };

  // ── Confirm / Change = save ─────────────────────────────────────────
  const blocked = recording ? 'أوقف التسجيل أولاً · Stop recording first'
    : !patient.chief_complaint ? 'أدخل الشكوى الرئيسية · Enter the chief complaint'
      : a.pending ? 'CTAS معلّق: أكمل البيانات أو استخدم «تغيير» · Pending: complete data or Change'
        : urgentAlert ? 'أقرّ بالتنبيه الحرج أولاً · Acknowledge the critical alert first'
          : openSafety.length ? 'أجب عن سؤال السلامة أولاً · Answer the safety question first'
            : openConflicts.length ? `أكّد القراءة: ${openConflicts.map((c) => vitalLabel(c.field).ar).join('، ')} · Confirm the reading: ${openConflicts.map((c) => vitalLabel(c.field).en).join(', ')}`
              : null;

  const finalize = async (decision) => {
    if (savingRef.current || savedRecord) return;
    const validation = validateTriageReady(patient);
    if (!validation.ok) {
      toast.error(validation.errors[0] || 'أدخل الشكوى الرئيسية · Enter the chief complaint');
      return;
    }
    const result = handleAssess();
    if (!result) return;
    const reviewedAt = new Date().toISOString();
    const full = { ...decision, reviewedAt, reviewedBy: user?.full_name || user?.email };
    setNurseValidation(full);
    setConfirmedTime(reviewedAt);
    setTimerStatus('confirmed');
    const ok = await handleSave(full, result);
    if (ok) {
      setShowChange(false);
    } else {
      // Not saved: the decision is not final, so the cards go back to the recommendation.
      setNurseValidation(null);
      setTimerStatus('running');
      setConfirmedTime(null);
    }
  };

  const confirm = () => {
    if (blocked) return;
    finalize({ agreed: true, nurseLevel: shownLevel, direction: directionAi, overrideReason: null });
  };

  const startNewPatient = () => {
    const hasWork = !!(patient.chief_complaint || patient.transcription || urlPid);
    if (done || !hasWork) navigate('/visual-triage');
    else setShowNewPatientConfirm(true);
  };

  // During recording: ask for the most useful missing item, then the top question.
  // Missing CTAS data first, then chronic illness and medicines if not yet mentioned.
  const historyPrompt = recording && transcript.length > 60 && !cc.historyAsked
    ? { ar: 'اسأل عن الأمراض المزمنة والأدوية المنتظمة', en: 'Ask about chronic illnesses and regular medicines' }
    : null;
  // A check an illness rule needs is prompted until it is recorded (also after recording).
  const checkPrompt = comorb.pendingChecks.length && comorb.applied.length ? {
    ar: `افحص: ${comorb.pendingChecks.map((c) => c.ar).join(' و')}`,
    en: `Check: ${comorb.pendingChecks.map((c) => c.en).join(' and ')}`,
  } : null;
  const prompt = recording
    ? (nextPrompt(a.missingKeys, patient) || checkPrompt || historyPrompt)
    : checkPrompt;
  const promptQuestion = recording && !prompt ? openQuestions[0] : null;

  // The large CTAS/direction cards (tablet and desktop) and the compact strip in the
  // bottom bar are never shown together: the strip appears only when the cards are
  // off screen (always on phones, where the cards are hidden).
  const [heroEl, setHeroEl] = useState(null);
  const [heroVisible, setHeroVisible] = useState(false);
  useEffect(() => {
    if (!heroEl || typeof IntersectionObserver === 'undefined') { setHeroVisible(false); return undefined; }
    const io = new IntersectionObserver(([entry]) => setHeroVisible(entry.isIntersecting), { threshold: 0.35 });
    io.observe(heroEl);
    return () => io.disconnect();
  }, [heroEl]);

  const more = (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {[
          ['onset_duration', 'بداية الأعراض · Onset'],
          ['relevant_history', 'التاريخ المرضي · History'],
          ['current_medications', 'الأدوية · Medications'],
          ['allergies', 'الحساسية · Allergies'],
        ].map(([k, label]) => (
          <label key={k} className="text-sm text-graphite">
            {label}
            <input
              dir="auto"
              value={patient[k] ?? ''}
              onChange={(e) => update({ [k]: e.target.value })}
              className="mt-1 w-full h-11 bg-white border border-mist rounded-xl px-3 text-[15px] text-ink focus:outline-none focus:border-ink"
            />
          </label>
        ))}
      </div>
      <div>
        <p className="text-sm text-graphite mb-1">اختيار الشكوى · Pick a complaint</p>
        <QuickComplaints compact selected={patient.chief_complaint} onSelect={(v) => update({ chief_complaint: v, confirmed_complaint_key: null })} />
      </div>
      {complaintMatch && !complaintResolution.needs_confirmation && (
        <ComplaintModifierSelector match={complaintMatch} selectedModifier={selectedModifier} onSelect={handleModifierSelect} />
      )}
    </>
  );

  return (
    <div dir="rtl" className="flex flex-col gap-3">
      {showNewPatientConfirm && (
        <NewPatientConfirm
          currentPid={urlPid}
          currentName={patient.patient_name_ar || patient.patient_name_en}
          onCancel={() => setShowNewPatientConfirm(false)}
        />
      )}
      <UrgentAlert alert={urgentAlert} onDismiss={acknowledgeUrgentAlert} />
      {showChange && (
        <ChangeSheet
          aiLevel={shownLevel}
          aiDirection={directionAi}
          directionOptions={directionOptions}
          saving={saving}
          onClose={() => setShowChange(false)}
          onSave={finalize}
        />
      )}

      {/* Header: identification, triage clock, new patient */}
      <div className="flex items-center gap-2">
        <div className="flex-1 min-w-0">
          <PatientSelectorStrip currentPid={urlPid} onSwitch={handleSwitchPatient} />
        </div>
        <TriageTimer startedAt={timerStartTime} status={timerStatus} stoppedAt={confirmedTime} />
        <button
          type="button"
          onClick={startNewPatient}
          aria-label="مريض جديد / New patient"
          className="h-11 px-3 flex items-center gap-2 border border-mist bg-white text-ink rounded-2xl text-[15px] font-medium hover:border-ink shrink-0 shadow-sm"
        >
          <Plus className="w-4 h-4" aria-hidden="true" /> <span className="hidden sm:inline">مريض جديد</span>
        </button>
      </div>

      {critical && !done && (
        <div role="alert" className="rounded-[20px] bg-[#D3242C] text-white px-4 py-2.5 flex items-center gap-2 shadow-sm">
          <ShieldAlert className="w-5 h-5 shrink-0" aria-hidden="true" />
          <p className="text-[15px] font-semibold leading-snug">
            {criticalText.ar} <span className="font-normal text-white/90">· {criticalText.en}</span>
          </p>
        </div>
      )}

      {done ? (
        <CompletedScreen
          document={savedRecord.document}
          onNewPatient={startNewPatient}
          nextPatient={nextPatient}
          onOpenNext={() => nextPatient && handleSwitchPatient(nextPatient.patient_id)}
        />
      ) : (
        <>
          {/* Voice capture beside the live CTAS and direction (tablet/desktop); voice only on phones */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 items-stretch">
            <div className="min-w-0 flex flex-col [&>section]:flex-1">
              <VoiceTriagePanel
                journeyId={activeJourney?.id}
                patient={patient}
                onSessionUpdate={applySttSessionToPatient}
                onResync={(output) => applySttSessionToPatient(output, { force: true })}
                onRecordingStart={handleRecordingStart}
                onRecordingChange={handleRecordingChange}
              />
            </div>
            <HeroResult ref={setHeroEl} ctas={ctasBox} direction={directionBox} critical={critical} />
          </div>

          <LivePrompt prompt={prompt} question={promptQuestion} />

          {!recording && patient.chief_complaint && complaintResolution.needs_confirmation && (
            <ChiefComplaintConfirm
              resolution={complaintResolution}
              confirmedKey={patient.confirmed_complaint_key}
              onConfirm={handleComplaintConfirm}
            />
          )}

          {!recording && <VitalConfirmCard conflicts={openConflicts} onPick={pickVitalReading} />}

          {!recording && hasData && (openQuestions.length > 0 || answeredLog.length > 0 || dictatedFindings.length > 0) && (
            <QuestionCard
              question={openQuestions[0]}
              position={answeredLog.length + 1}
              total={answeredLog.length + openQuestions.length}
              onAnswer={handleFlowAnswer}
              answered={answeredLog}
              onChangeAnswer={handleChangeAnswer}
              detected={dictatedFindings}
              onCorrectDetected={(f, v) => handleFlowAnswer({ field: f.field, text_ar: f.text_ar, text_en: f.text_en, question_category: f.category }, v)}
            />
          )}

          <FieldGrid
            patient={patient}
            onChange={(fields) => update(fields)}
            missingKeys={a.missingKeys}
            total={REQUIRED_FIELDS.length}
            more={more}
            complaintSlot={cc.complaints.length >= 2
              ? <ComplaintChips cc={cc} onMakePrimary={makePrimaryComplaint} onRemove={removeComplaint} />
              : null}
            historySlot={hasData ? <HistoryChips cc={cc} onRemoveCondition={removeCondition} /> : null}
            confirmKeys={openConflicts.flatMap((c) => vitalFields(c.field))}
            bedside={comorb.required.some((r) => r.key === 'glucose' || r.key === 'ketones') || (patient.glucose ?? '') !== '' || !!patient.ketones
              ? { required: comorb.pendingChecks.map((c) => c.key) }
              : null}
          />
        </>
      )}

      {/* CTAS and direction stay in view for the whole session, with the only actions */}
      <DecisionBar
        ctas={ctasBox}
        direction={directionBox}
        critical={critical}
        onConfirm={confirm}
        onChange={() => setShowChange(true)}
        blocked={blocked}
        saving={saving}
        done={done}
        why={why}
        showResult={!heroVisible}
      />
    </div>
  );
}
