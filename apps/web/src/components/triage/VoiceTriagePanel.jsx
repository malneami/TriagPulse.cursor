import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Mic, Square, Loader2, AlertTriangle, Keyboard, ChevronDown } from 'lucide-react';
import {
  detectTranscriptLanguage,
  conservativeTranscriptCleanup,
  mergeTranscriptLines,
  getLiveTranscript,
} from '@/lib/stt/ctasFieldMap';
import FloatingRecorder from './FloatingRecorder';
import {
  createMediaRecorder,
  createPcmStreamer,
  getMicrophoneStream,
  getSpeechRecognition,
  supportsBrowserStt,
} from '@/lib/stt/voiceCapture';
import {
  connectSttSocket,
  createSttSession,
  extractTranscript,
  fetchSttStatus,
  transcribeChunk,
} from '@/lib/stt/sttSession';
import { toast } from 'sonner';

const MIN_AUDIO_BYTES = 2000;
const MAX_OPENAI_FAILURES = 3;
/** Each cycle is a full stop()/start(), so every blob is a self-contained container. */
const FALLBACK_ROLLING_MS = 5000;
/** How long to wait for the first Realtime text before warning the clinician. */
const REALTIME_SILENCE_WARN_MS = 8000;

function isOpenAiBillingError(msg = '') {
  return /no credits|insufficient.?quota|billing|payment.?required|credits remaining/i.test(String(msg || ''));
}

function humanizeSttError(msg = '') {
  const raw = String(msg || '').trim();
  if (isOpenAiBillingError(raw)) {
    return 'OpenAI has no credits — using browser speech until billing is restored.';
  }
  if (/fetch failed/i.test(raw)) {
    return 'Cannot reach OpenAI API (network). Check internet/firewall, then press Record again.';
  }
  return raw || 'STT unavailable';
}

/** Dictations that exercise each language path, including a mid-sentence switch. */
const DEMO_SENTENCES = [
  {
    id: 'ar',
    label: 'عربي فقط / Arabic only',
    dir: 'rtl',
    text: 'اسم المريض خالد العمر خمسة وعشرين ذكر عنده ألم صدر النبض مئة وعشرة الضغط مئة وأربعين على خمسة وستين الأكسجين تسعة وتسعين',
  },
  {
    id: 'en',
    label: 'إنجليزي فقط / English only',
    dir: 'ltr',
    text: 'patient name Sara age twenty five female complaint chest pain HR one ten BP one twenty over sixty five',
  },
  {
    id: 'mixed',
    label: 'مختلط / Mixed',
    dir: 'rtl',
    text: 'اسم المريض خالد age twenty five عنده chest pain HR one ten',
  },
];

export default function VoiceTriagePanel({
  journeyId,
  patient,
  onSessionUpdate,
  onResync,
  onRecordingStart,
  ctasLevel = null,
  ctasLabelAr = null,
  ctasLabelEn = null,
  ctasHex = null,
}) {
  const [sessionId, setSessionId] = useState(null);
  const [sessionOutput, setSessionOutput] = useState(null);
  const [interimText, setInterimText] = useState('');
  const [finalLines, setFinalLines] = useState([]);
  const [recording, setRecording] = useState(false);
  const [loading, setLoading] = useState(false);
  const [sttMode, setSttMode] = useState('checking');
  const [sttError, setSttError] = useState('');
  const [manualFallback, setManualFallback] = useState(false);
  const [manualText, setManualText] = useState('');
  const [recognitionLang, setRecognitionLang] = useState('ar-SA');
  const [extracting, setExtracting] = useState(false);
  const [showTranscript, setShowTranscript] = useState(true);
  const [showGuide, setShowGuide] = useState(false);

  const streamRef = useRef(null);
  const recorderRef = useRef(null);
  const pcmStreamerRef = useRef(null);
  const recognitionRef = useRef(null);
  const socketRef = useRef(null);
  const sessionIdRef = useRef(null);
  const openAiEnabledRef = useRef(true);
  const openAiFailureCountRef = useRef(0);
  const transcribeErrorShownRef = useRef(false);
  const segmentStopRef = useRef(false);
  const rollingIntervalRef = useRef(null);
  const extractDebounceRef = useRef(null);
  const transcribeInFlightRef = useRef(false);
  const pendingSegmentRef = useRef(false);
  const llmRetryRef = useRef(false);
  const mimeTypeRef = useRef('audio/webm');
  const audioBufferRef = useRef([]);
  const finalLinesRef = useRef([]);
  const interimTextRef = useRef('');
  const recordingRef = useRef(false);
  const runExtractRef = useRef(null);
  const useRealtimeRef = useRef(false);
  const realtimeFailureCountRef = useRef(0);
  const startFallbackRef = useRef(null);
  const restartRecognitionRef = useRef(null);
  const silenceWatchdogRef = useRef(null);
  const browserCaptionActiveRef = useRef(false);
  const pcmStartedRef = useRef(false);

  finalLinesRef.current = finalLines;
  interimTextRef.current = interimText;
  sessionIdRef.current = sessionId;
  recordingRef.current = recording;

  // Re-cleans the whole transcript; must not run on every render — it shares the main
  // thread with the ScriptProcessor audio callback.
  const liveTranscript = useMemo(
    () => getLiveTranscript(finalLines, interimText),
    [finalLines, interimText],
  );

  /**
   * Whether the server can transcribe at all. Kept in a ref, not derived from sttMode:
   * capture starts in the same tick as the status refresh, before React re-renders, so
   * a state-derived flag would still hold the previous value.
   */
  const serverSttRef = useRef(false);
  /** Browser Web Speech is monolingual — only reachable when there is no OpenAI key. */
  const browserOnly = sttMode === 'browser' || sttMode === 'manual';

  const flushInterimSync = useCallback(() => {
    const interim = interimTextRef.current?.trim();
    let lines = finalLinesRef.current;
    if (interim) {
      const line = conservativeTranscriptCleanup(interim);
      lines = mergeTranscriptLines(lines, line, { source: useRealtimeRef.current ? 'openai' : 'browser' });
      finalLinesRef.current = lines;
      setFinalLines(lines);
      setInterimText('');
      interimTextRef.current = '';
    }
    return getLiveTranscript(lines, '');
  }, []);

  const pushSession = useCallback((payload) => {
    if (!payload) return;
    setSessionOutput(payload);
    try {
      onSessionUpdate?.(payload);
    } catch (err) {
      throw err;
    }
    const analysis = payload.transcript_analysis;
    if (analysis?.mentionedNotExtracted?.length > 0 && !llmRetryRef.current && sessionIdRef.current) {
      llmRetryRef.current = true;
      const full = getLiveTranscript(finalLinesRef.current, interimTextRef.current);
      extractTranscript(sessionIdRef.current, full, true, true)
        .then((retry) => {
          setSessionOutput(retry);
          onSessionUpdate?.(retry);
        })
        .catch(() => {})
        .finally(() => { llmRetryRef.current = false; });
    }
  }, [onSessionUpdate]);

  /**
   * Resolve server capability. Re-run before each recording, not just at mount:
   * adding OPENAI_API_KEY and restarting the API would otherwise leave an already-open
   * tab stuck in browser-only mode until a manual reload.
   */
  const refreshSttStatus = useCallback(async () => {
    try {
      const s = await fetchSttStatus();
      const realtime = !!(s.reachable && s.realtime !== false);
      serverSttRef.current = !!s.reachable;
      if (realtime) {
        setSttMode('realtime');
        setSttError('');
      } else if (s.reachable) {
        setSttMode('openai');
        setSttError('');
      } else if (s.configured) {
        setSttMode('openai_error');
        const raw = s.lastError || 'OpenAI unreachable';
        const friendly = humanizeSttError(raw);
        setSttError(friendly);
      } else {
        setSttMode(supportsBrowserStt() ? 'browser' : 'manual');
        if (!supportsBrowserStt()) setManualFallback(true);
      }
      return realtime;
    } catch {
      serverSttRef.current = false;
      setSttMode(supportsBrowserStt() ? 'browser' : 'manual');
      return false;
    }
  }, []);

  useEffect(() => {
    void refreshSttStatus();
  }, [refreshSttStatus]);

  const clearSilenceWatchdog = useCallback(() => {
    if (silenceWatchdogRef.current) {
      clearTimeout(silenceWatchdogRef.current);
      silenceWatchdogRef.current = null;
    }
  }, []);

  const stopBrowserCaptions = useCallback(() => {
    if (!browserCaptionActiveRef.current) return;
    browserCaptionActiveRef.current = false;
    try { recognitionRef.current?.stop?.(); } catch { /* ignore */ }
    recognitionRef.current = null;
  }, []);

  const handleRealtimePartial = useCallback((payload) => {
    const text = conservativeTranscriptCleanup(payload?.text || '');
    setInterimText(text);
    interimTextRef.current = text;
    if (text) {
      clearSilenceWatchdog();
      stopBrowserCaptions();
      realtimeFailureCountRef.current = 0;
      runExtractRef.current?.(getLiveTranscript(finalLinesRef.current, text), false);
    }
  }, [clearSilenceWatchdog, stopBrowserCaptions]);

  const handleRealtimeFinal = useCallback((payload) => {
    const text = conservativeTranscriptCleanup(payload?.text || '');
    if (!text) return;
    clearSilenceWatchdog();
    stopBrowserCaptions();
    setInterimText('');
    interimTextRef.current = '';
    setFinalLines((prev) => {
      const next = mergeTranscriptLines(prev, text, { source: 'openai' });
      finalLinesRef.current = next;
      runExtractRef.current?.(getLiveTranscript(next, ''), true);
      return next;
    });
    realtimeFailureCountRef.current = 0;
    setSttMode('realtime');
    setSttError('');
  }, [clearSilenceWatchdog, stopBrowserCaptions]);

  const pushSessionRef = useRef(pushSession);
  pushSessionRef.current = pushSession;
  const handleRealtimePartialRef = useRef(handleRealtimePartial);
  handleRealtimePartialRef.current = handleRealtimePartial;
  const handleRealtimeFinalRef = useRef(handleRealtimeFinal);
  handleRealtimeFinalRef.current = handleRealtimeFinal;
  const stopCaptureRef = useRef(null);

  const initSession = useCallback(async () => {
    // Tear down previous socket before opening a new one (avoid "closed before established")
    try { socketRef.current?.disconnect?.(); } catch { /* ignore */ }
    socketRef.current = null;

    setLoading(true);
    try {
      const { sessionId: id } = await createSttSession(journeyId);
      setSessionId(id);
      sessionIdRef.current = id;
      socketRef.current = connectSttSocket(id, {
        onExtraction: (payload) => pushSessionRef.current?.(payload),
        onTranscriptPartial: (payload) => handleRealtimePartialRef.current?.(payload),
        onTranscriptFinal: (payload) => handleRealtimeFinalRef.current?.(payload),
        onRealtimeAck: (ack) => {
          if (ack?.ok === false && recordingRef.current) {
            realtimeFailureCountRef.current += 1;
            const msg = humanizeSttError(ack?.message || 'Realtime STT failed');
            if (isOpenAiBillingError(ack?.message || msg)) {
              openAiEnabledRef.current = false;
              serverSttRef.current = false;
            }
            setSttError(msg);
            toast.error(msg);
            startFallbackRef.current?.({ forceBrowserOnly: isOpenAiBillingError(ack?.message || msg) });
          }
        },
        onError: (err) => {
          const msg = humanizeSttError(err?.message || 'STT unavailable');
          if (err?.code === 'input_audio_buffer_commit_empty') return;
          // Ignore transient socket handshake aborts from React Strict Mode remounts
          if (/closed before the connection|websocket error|transport close/i.test(String(err?.message || '')) && !recordingRef.current) {
            return;
          }
          const billing = !!(err?.billing || isOpenAiBillingError(err?.message || msg));
          if (billing) {
            openAiEnabledRef.current = false;
            serverSttRef.current = false;
          }
          if (err?.realtime && useRealtimeRef.current && recordingRef.current) {
            realtimeFailureCountRef.current += 1;
            if (billing || realtimeFailureCountRef.current >= MAX_OPENAI_FAILURES) {
              setSttError(msg);
              toast.error(msg);
              startFallbackRef.current?.({ forceBrowserOnly: billing || !serverSttRef.current });
              return;
            }
          }
          setSttError(msg);
          if (!err?.realtime) {
            toast.error(msg);
            setManualFallback(true);
          }
        },
      });
    } catch (err) {
      setSttError(err?.message || 'Failed to start STT session');
      setManualFallback(true);
    } finally {
      setLoading(false);
    }
  }, [journeyId]);

  const runExtract = useCallback((transcript, isFinal, forceLlm = false) => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    const cleaned = conservativeTranscriptCleanup(transcript);
    if (!cleaned) return;
    clearTimeout(extractDebounceRef.current);
    const doExtract = () => {
      extractTranscript(sid, cleaned, isFinal, forceLlm)
        .then((payload) => pushSessionRef.current?.(payload))
        .catch((e) => { if (isFinal) setSttError(e.message); });
    };
    if (isFinal || forceLlm) doExtract();
    else extractDebounceRef.current = setTimeout(doExtract, 1500);
  }, []);

  runExtractRef.current = runExtract;

  const processPendingSegment = useCallback(() => {
    if (!pendingSegmentRef.current || !recordingRef.current) return;
    pendingSegmentRef.current = false;
    if (recorderRef.current?.state === 'recording' && !transcribeInFlightRef.current) {
      segmentStopRef.current = true;
      try { recorderRef.current.stop(); } catch { /* ignore */ }
    } else if (recorderRef.current?.state === 'inactive' && streamRef.current) {
      try { recorderRef.current.start(); } catch { /* ignore */ }
    }
  }, []);

  /**
   * Each blob is now a complete media container, so concatenating two of them would
   * produce an undecodable file. An undersized blob is silence — drop it.
   */
  const usableAudioBlob = useCallback((blob) => {
    if (!blob || blob.size < MIN_AUDIO_BYTES) return null;
    return blob;
  }, []);

  const transcribeBlob = useCallback(async (blob, mimeType, { rolling = false } = {}) => {
    const sid = sessionIdRef.current;
    const combined = usableAudioBlob(blob);
    if (!sid || !openAiEnabledRef.current || !combined) {
      if (!rolling) recorderRef.current = null;
      processPendingSegment();
      return;
    }
    if (transcribeInFlightRef.current) {
      pendingSegmentRef.current = true;
      if (!rolling) recorderRef.current = null;
      return;
    }
    transcribeInFlightRef.current = true;
    try {
      const result = await transcribeChunk(sid, combined, mimeType, 'mixed');
      if (!rolling) recorderRef.current = null;
      if (result?.text) {
        openAiFailureCountRef.current = 0;
        setFinalLines((prev) => {
          const next = mergeTranscriptLines(prev, result.text, { source: 'openai' });
          finalLinesRef.current = next;
          runExtractRef.current?.(getLiveTranscript(next, interimTextRef.current), true);
          return next;
        });
        if (result.session) pushSession(result.session);
        setSttMode('browser_batch');
        setSttError('');
        transcribeErrorShownRef.current = false;
      }
    } catch (err) {
      if (!rolling) recorderRef.current = null;
      openAiFailureCountRef.current += 1;
      const billing = isOpenAiBillingError(err?.message);
      if (billing || openAiFailureCountRef.current >= MAX_OPENAI_FAILURES) {
        openAiEnabledRef.current = false;
        serverSttRef.current = false;
        setSttMode('browser');
        // Batch path never started Web Speech — start it now so capture continues.
        if (recordingRef.current && supportsBrowserStt()) {
          browserCaptionActiveRef.current = true;
          restartRecognitionRef.current?.(recognitionLang);
        }
      }
      const msg = humanizeSttError(err?.message || 'OpenAI transcription unavailable — using browser STT');
      setSttError(msg);
      if (!transcribeErrorShownRef.current) {
        transcribeErrorShownRef.current = true;
        toast.error(msg);
      }
    } finally {
      transcribeInFlightRef.current = false;
      if (rolling && streamRef.current && recorderRef.current?.state === 'inactive' && openAiEnabledRef.current) {
        try { recorderRef.current.start(); } catch { /* ignore */ }
      }
      processPendingSegment();
    }
  }, [pushSession, usableAudioBlob, processPendingSegment, recognitionLang]);

  const restartRecognition = useCallback((lang) => {
    // Detach before stopping: otherwise the outgoing recognizer's onend fires with the
    // ref still pointing at it and auto-restarts it in the OLD language.
    const previous = recognitionRef.current;
    recognitionRef.current = null;
    if (previous) {
      previous.onend = null;
      previous.onresult = null;
      previous.onerror = null;
      try { previous.stop?.(); } catch { /* ignore */ }
    }
    const recognition = getSpeechRecognition();
    if (!recognition) {
      setManualFallback(true);
      return;
    }
    recognition.lang = lang;
    recognition.interimResults = true;
    recognition.continuous = true;
    recognition.onresult = (event) => {
      let interim = '';
      let finalChunk = '';
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const txt = event.results[i][0].transcript;
        if (event.results[i].isFinal) finalChunk += `${txt} `;
        else interim += txt;
      }
      setInterimText(interim.trim());
      interimTextRef.current = interim.trim();
      if (finalChunk.trim()) {
        const line = conservativeTranscriptCleanup(finalChunk.trim());
        setFinalLines((prev) => {
          const next = mergeTranscriptLines(prev, line, { source: 'browser' });
          finalLinesRef.current = next;
          runExtractRef.current?.(getLiveTranscript(next, ''), true);
          return next;
        });
        // Web Speech takes exactly one language, so the best it can do is follow the
        // dominant one. It cannot code-switch — that is why it only runs without a key.
        const profile = detectTranscriptLanguage(line);
        if (profile.detected_language === 'english' && lang !== 'en-US') {
          setRecognitionLang('en-US');
          restartRecognitionRef.current?.('en-US');
        } else if (profile.detected_language === 'arabic' && lang !== 'ar-SA') {
          setRecognitionLang('ar-SA');
          restartRecognitionRef.current?.('ar-SA');
        }
      } else if (interim.trim() && sessionIdRef.current) {
        const live = getLiveTranscript(finalLinesRef.current, conservativeTranscriptCleanup(interim));
        runExtractRef.current?.(live, false);
      }
    };
    recognition.onerror = (e) => {
      if (e.error !== 'no-speech') setSttError(e.error || 'Speech recognition error');
    };
    recognition.onend = () => {
      if (recordingRef.current && recognitionRef.current === recognition) {
        try { recognition.start(); } catch { /* ignore */ }
      }
    };
    // Chrome throws InvalidStateError if the previous recognizer has not fully ended.
    try {
      recognition.start();
      recognitionRef.current = recognition;
    } catch {
      setTimeout(() => {
        if (!recordingRef.current) return;
        try {
          recognition.start();
          recognitionRef.current = recognition;
        } catch { /* give up; batch path still runs */ }
      }, 250);
    }
  }, []);

  restartRecognitionRef.current = restartRecognition;

  const startFallbackCapture = useCallback(async (opts = {}) => {
    const forceBrowserOnly = !!opts.forceBrowserOnly
      || !openAiEnabledRef.current
      || !serverSttRef.current;
    useRealtimeRef.current = false;
    clearSilenceWatchdog();
    try { pcmStreamerRef.current?.stop?.(); } catch { /* ignore */ }
    pcmStreamerRef.current = null;
    pcmStartedRef.current = false;
    socketRef.current?.stopRealtime?.();

    if (forceBrowserOnly) {
      if (rollingIntervalRef.current) {
        clearInterval(rollingIntervalRef.current);
        rollingIntervalRef.current = null;
      }
      try {
        if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
      } catch { /* ignore */ }
      recorderRef.current = null;
    }

    if (!streamRef.current) {
      streamRef.current = await getMicrophoneStream();
    }
    const stream = streamRef.current;

    // Billing / no-key / forced browser: Web Speech only (do not POST failing OpenAI batch).
    if (forceBrowserOnly || !serverSttRef.current || !openAiEnabledRef.current) {
      if (!supportsBrowserStt()) {
        setManualFallback(true);
        setSttMode('manual');
        setSttError((prev) => prev || 'Browser speech not available — type the transcript manually.');
        return;
      }
      browserCaptionActiveRef.current = true;
      restartRecognition(recognitionLang);
      setSttMode('browser');
      return;
    }

    // Live captions via Web Speech + periodic OpenAI batch for AR/EN quality
    browserCaptionActiveRef.current = true;
    restartRecognition(recognitionLang);

    // No onChunk: with MediaRecorder timeslice only the FIRST blob carries the container
    // header (EBML for WebM, ftyp/moov for MP4). Blobs 2..N were headerless fragments,
    // so every one of them was rejected by /v1/audio/transcriptions. Taking the
    // accumulator path means each stop() yields a complete, decodable file.
    const { recorder, mimeType } = createMediaRecorder(stream, {
      onStop: (blob) => {
        const rolling = segmentStopRef.current;
        segmentStopRef.current = false;
        if (blob?.size) transcribeBlob(blob, mimeType, { rolling });
      },
    });
    mimeTypeRef.current = mimeType;
    recorderRef.current = recorder;
    recorder.start();
    if (rollingIntervalRef.current) clearInterval(rollingIntervalRef.current);
    rollingIntervalRef.current = setInterval(() => {
      if (recorderRef.current?.state === 'recording') {
        segmentStopRef.current = true;
        // stop() flushes a full container; the finally-block in transcribeBlob restarts it.
        try { recorderRef.current.stop(); } catch { /* ignore */ }
      }
    }, FALLBACK_ROLLING_MS);
    setSttMode('browser_batch');
  }, [recognitionLang, restartRecognition, transcribeBlob, clearSilenceWatchdog]);

  startFallbackRef.current = startFallbackCapture;

  const startRealtimeCapture = useCallback(async () => {
    useRealtimeRef.current = true;
    pcmStartedRef.current = false;
    browserCaptionActiveRef.current = false;
    clearSilenceWatchdog();

    const stream = await getMicrophoneStream();
    streamRef.current = stream;
    recordingRef.current = true;
    setSttMode('realtime');
    setRecording(true);
    setSttError('');

    // Ensure STT socket exists and is connected before realtime_start
    if (!socketRef.current?.socket) {
      await initSession();
    }
    const sock = socketRef.current;
    if (sock?.socket && !sock.socket.connected) {
      await new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('STT socket connect timeout')), 10000);
        sock.socket.once('connect', () => { clearTimeout(t); resolve(); });
        sock.socket.once('connect_error', (e) => { clearTimeout(t); reject(e); });
        sock.socket.connect();
      }).catch((err) => {
        setSttError(err?.message || 'STT socket failed');
        startFallbackRef.current?.();
      });
    }

    const startPcm = async () => {
      if (pcmStartedRef.current || !recordingRef.current || !useRealtimeRef.current) return;
      pcmStartedRef.current = true;
      try {
        const streamer = await createPcmStreamer(stream, {
          onPcmBase64: (b64) => {
            if (useRealtimeRef.current && recordingRef.current) {
              socketRef.current?.sendPcmChunk?.(b64);
            }
          },
        });
        pcmStreamerRef.current = streamer;
      } catch (err) {
        setSttError(err?.message || 'Microphone stream failed');
        startFallbackRef.current?.();
      }
    };

    if (sock?.socket) {
      sock.socket.once('realtime_ready', (payload) => {
        // config_confirmed=false means OpenAI never acknowledged our session.update, so
        // the languages/prompt/keywords are NOT in force — say so instead of pretending.
        if (payload && payload.config_confirmed === false) {
          setSttError('Realtime config unconfirmed — mixed AR/EN accuracy may be degraded');
        }
        void startPcm();
      });
      sock.socket.once('realtime_ack', (ack) => {
        if (ack?.ok === false) return;
        setTimeout(() => { void startPcm(); }, 300);
      });
    } else {
      setTimeout(() => { void startPcm(); }, 400);
    }

    // Diagnostic only. Starting browser captions here put a monolingual recognizer in
    // parallel with OpenAI: two producers writing competing lines that the cross-script
    // dedupe cannot reconcile, which is what garbled mixed dictation.
    silenceWatchdogRef.current = setTimeout(() => {
      if (!recordingRef.current || !useRealtimeRef.current) return;
      const hasText = finalLinesRef.current.length > 0 || !!interimTextRef.current?.trim();
      if (hasText) return;
      const msg = 'No live transcript yet — check microphone permission and OpenAI Realtime status';
      setSttError(msg);
      toast.error(msg);
    }, REALTIME_SILENCE_WARN_MS);

    sock?.startRealtime?.();
  }, [clearSilenceWatchdog, initSession]);

  const stopCapture = useCallback(() => {
    const flushed = flushInterimSync();
    if (flushed) runExtractRef.current?.(flushed, true, false);

    clearSilenceWatchdog();
    browserCaptionActiveRef.current = false;
    pcmStartedRef.current = false;

    if (rollingIntervalRef.current) clearInterval(rollingIntervalRef.current);
    rollingIntervalRef.current = null;
    clearTimeout(extractDebounceRef.current);
    segmentStopRef.current = false;
    pendingSegmentRef.current = false;
    recordingRef.current = false;

    if (useRealtimeRef.current) {
      socketRef.current?.stopRealtime?.();
    }
    try { pcmStreamerRef.current?.stop?.(); } catch { /* ignore */ }
    pcmStreamerRef.current = null;

    if (recorderRef.current?.state === 'recording') {
      try { recorderRef.current.stop(); } catch { /* ignore */ }
    } else {
      recorderRef.current = null;
    }
    try { recognitionRef.current?.stop?.(); } catch { /* ignore */ }
    recognitionRef.current = null;
    streamRef.current?.getTracks()?.forEach((t) => t.stop());
    streamRef.current = null;
    audioBufferRef.current = [];
    useRealtimeRef.current = false;
    setRecording(false);
  }, [flushInterimSync, clearSilenceWatchdog]);

  stopCaptureRef.current = stopCapture;

  // Mount once per journey — do NOT depend on callback identities (avoids WS abort)
  useEffect(() => {
    let alive = true;
    (async () => {
      if (!alive) return;
      await initSession();
    })();
    return () => {
      alive = false;
      try { socketRef.current?.disconnect?.(); } catch { /* ignore */ }
      socketRef.current = null;
      stopCaptureRef.current?.();
    };
  }, [journeyId, initSession]);

  const startRecording = async () => {
    try {
      openAiEnabledRef.current = true;
      openAiFailureCountRef.current = 0;
      realtimeFailureCountRef.current = 0;
      transcribeErrorShownRef.current = false;
      audioBufferRef.current = [];
      pendingSegmentRef.current = false;

      // Re-check capability at press time so a server that just gained a key is
      // picked up without reloading the page.
      const realtimeNow = await refreshSttStatus();
      if (realtimeNow) {
        await startRealtimeCapture();
      } else {
        recordingRef.current = true;
        setRecording(true);
        await startFallbackCapture();
        setSttError('');
      }
      // Triage Time starts with the first successful Record press
      onRecordingStart?.();
    } catch {
      toast.error('Microphone access denied');
      setManualFallback(true);
    }
  };

  const handleToggleRecord = async () => {
    if (recording) {
      stopCapture();
      return;
    }
    if (!sessionId) await initSession();
    await startRecording();
  };

  /** Run extraction over whatever is currently in the editable transcript box. */
  const handleManualExtract = async () => {
    const raw = (manualText || liveTranscript || '').trim();
    if (!raw) return;
    let sid = sessionIdRef.current;
    if (!sid) {
      await initSession();
      sid = sessionIdRef.current;
    }
    if (!sid) return;
    const cleaned = conservativeTranscriptCleanup(raw);
    setExtracting(true);
    try {
      const output = await extractTranscript(sid, cleaned, true, true);
      pushSession(output);
      if (manualText.trim()) {
        const line = [{ text: cleaned, source: 'manual', at: Date.now() }];
        setFinalLines(line);
        finalLinesRef.current = line;
      }
    } catch (e) {
      setSttError(e?.message || 'Extraction failed');
    } finally {
      setExtracting(false);
    }
  };

  const pasteDemoSentence = (text) => {
    setManualText(text);
    setManualFallback(true);
  };

  const modeLabel = ({
    checking: 'Checking…',
    realtime: recording ? 'OpenAI Realtime (live)' : 'OpenAI Realtime',
    openai: 'OpenAI STT',
    openai_error: 'OpenAI error',
    browser_batch: 'OpenAI batch (AR+EN)',
    browser: 'Browser STT — single language only',
    manual: 'Manual only',
  }[sttMode] || sttMode);

  const busy = loading || extracting;
  const lastLine = finalLines[finalLines.length - 1];
  const lastTurnAt = lastLine && typeof lastLine !== 'string' ? lastLine.at : null;

  const panel = (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-100 flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-black text-slate-800">التقاط صوتي — Voice Triage STT</p>
          <p className="text-xs text-slate-500 truncate">Live auto-fill · decision support only</p>
        </div>
        <span className={`text-[10px] font-bold px-2 py-1 rounded-full shrink-0 ${sttMode === 'realtime' ? 'bg-teal-100 text-teal-800' : 'bg-slate-100 text-slate-600'}`}>
          {modeLabel}
        </span>
      </div>

      {/* Guide — how the AI STT mode behaves + phrases that exercise it */}
      <div className="mx-4 mt-3 bg-emerald-50 border border-emerald-200 rounded-xl">
        <button
          type="button"
          onClick={() => setShowGuide((v) => !v)}
          className="w-full flex items-center justify-between gap-2 px-3 py-2.5 text-right"
        >
          <span className="text-xs font-black text-emerald-900">
            كيف يعمل الالتقاط الصوتي — How AI voice capture works
          </span>
          <ChevronDown className={`w-4 h-4 text-emerald-700 shrink-0 transition-transform ${showGuide ? 'rotate-180' : ''}`} />
        </button>
        {showGuide && (
          <div className="px-3 pb-3 text-xs text-emerald-900 leading-relaxed space-y-2">
            <p>
              Backend AI STT records microphone audio only — it does <strong>not</strong> use browser
              speech detection. On Stop the audio goes to <code className="font-mono">transcribeAudio</code>,
              and OpenAI detects Arabic / English / mixed speech and returns the transcript.
            </p>
            <div className="space-y-1.5">
              {DEMO_SENTENCES.map((d) => (
                <div key={d.id} className="bg-white/70 border border-emerald-200 rounded-lg p-2">
                  <p className="font-black mb-1">{d.label}</p>
                  <p dir={d.dir} className="text-[11px] text-emerald-800 mb-1.5">{d.text}</p>
                  <button
                    type="button"
                    onClick={() => pasteDemoSentence(d.text)}
                    className="text-[10px] font-bold text-emerald-700 hover:text-emerald-900 underline"
                  >
                    لصق / Paste
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {browserOnly && (
        <div className="mx-4 mt-3 bg-rose-50 border border-rose-200 rounded-xl p-3 text-xs text-rose-900">
          <div className="flex items-center gap-2 font-black mb-1">
            <AlertTriangle className="w-4 h-4" />
            Mixed Arabic/English is unavailable — لا يمكن خلط العربية والإنجليزية
          </div>
          <p>
            The server has no <code className="font-mono">OPENAI_API_KEY</code>, so capture is using the
            browser recogniser. It transcribes <strong>one language at a time</strong> and will render
            English speech as Arabic letters (and vice versa). Set the key on the API and press Start
            again — no page reload needed.
          </p>
        </div>
      )}

      {sttError && (
        <div className="mx-4 mt-3 bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-900 flex items-start justify-between gap-2">
          <p className="font-bold flex-1">{sttError}</p>
          <button
            type="button"
            onClick={() => { void refreshSttStatus(); }}
            className="shrink-0 text-[11px] font-black underline text-amber-800 hover:text-amber-950"
          >
            Retry
          </button>
        </div>
      )}

      <div className="p-4 space-y-3">
        {/* Primary action row — stacks on narrow screens */}
        <div className="grid grid-cols-1 sm:grid-cols-[auto,1fr] gap-2">
          <button
            type="button"
            onClick={() => setShowTranscript((v) => !v)}
            className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl border border-slate-200 text-sm font-black text-slate-700 hover:bg-slate-50"
          >
            <Keyboard className="w-4 h-4" /> Transcript
          </button>
          <button
            type="button"
            onClick={handleToggleRecord}
            disabled={busy}
            className={`flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-black text-white transition-colors disabled:opacity-70 ${
              recording ? 'bg-red-600 hover:bg-red-700' : 'bg-teal-700 hover:bg-teal-800'
            }`}
          >
            {busy
              ? <Loader2 className="w-4 h-4 animate-spin" />
              : recording ? <Square className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
            {busy
              ? 'جاري النسخ / Transcribing…'
              : recording ? 'إيقاف التسجيل / Stop' : 'تسجيل صوت / Record AI Audio'}
          </button>
        </div>

        {showTranscript && (
          <>
            <textarea
              value={manualText || liveTranscript}
              onChange={(e) => setManualText(e.target.value)}
              placeholder="تحدث أو اكتب الإملاء هنا (عربي/إنجليزي) — Speak or type dictation here"
              rows={4}
              className="w-full rounded-xl border border-slate-200 p-3 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-teal-500/40"
            />
            {interimText && (
              <p className="text-xs text-teal-600 -mt-1 px-1 truncate">{interimText}</p>
            )}

            <button
              type="button"
              onClick={handleManualExtract}
              disabled={busy || !(manualText || liveTranscript).trim()}
              className="w-full py-3 rounded-xl bg-teal-700 hover:bg-teal-800 disabled:bg-slate-200 disabled:text-slate-400 text-white text-sm font-black"
            >
              استخراج وتعبئة حقول CTAS / Extract + auto-fill CTAS fields
            </button>

            {sessionOutput && onResync && (
              <button
                type="button"
                onClick={async () => {
                  const full = getLiveTranscript(finalLinesRef.current, interimTextRef.current);
                  if (sessionIdRef.current && full) {
                    try {
                      const retry = await extractTranscript(sessionIdRef.current, full, true, true);
                      pushSession(retry);
                    } catch (e) {
                      setSttError(e.message);
                    }
                  }
                  onResync(sessionOutput);
                }}
                className="w-full py-2.5 border border-teal-200 bg-teal-50/50 rounded-xl text-xs font-black text-teal-700 hover:bg-teal-50"
              >
                إعادة مزامنة الحقول / Re-sync fields
              </button>
            )}
          </>
        )}
      </div>

      {sessionOutput?.extraction_method === 'hybrid' && (
        <p className="px-4 pb-2 text-[10px] text-teal-700 font-bold">Hybrid extraction (rules + AI) applied</p>
      )}

      {sessionOutput?.low_confidence_spans?.length > 0 && (
        <div className="px-4 pb-4">
          <p className="text-xs font-black text-amber-700 mb-1 flex items-center gap-1">
            <AlertTriangle className="w-3 h-3" /> Low confidence — review
          </p>
          <div className="flex flex-wrap gap-1">
            {sessionOutput.low_confidence_spans.map((s, i) => (
              <span key={i} className="text-[10px] bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full">
                {s.text} ({Math.round(s.confidence * 100)}%)
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div className="space-y-4">
      {panel}

      <FloatingRecorder
        open={recording || extracting}
        recording={recording}
        transcribing={extracting}
        stream={streamRef.current}
        patient={patient}
        transcript={interimText || liveTranscript}
        lastTurnAt={lastTurnAt}
        ctasLevel={ctasLevel ?? sessionOutput?.ctas_level ?? null}
        ctasLabelAr={ctasLabelAr}
        ctasLabelEn={ctasLabelEn}
        ctasHex={ctasHex}
        onClose={stopCapture}
        onStop={stopCapture}
      />
    </div>
  );
}
