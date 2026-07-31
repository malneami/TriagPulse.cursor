import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Mic, MicOff, Square, Loader2, AlertTriangle } from 'lucide-react';
import {
  detectTranscriptLanguage,
  conservativeTranscriptCleanup,
  mergeTranscriptLines,
  getLiveTranscript,
} from '@/lib/stt/ctasFieldMap';
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

export default function VoiceTriagePanel({ journeyId, patient, onSessionUpdate, onResync }) {
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
    onSessionUpdate?.(payload);
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
        setSttError(s.lastError || 'OpenAI key invalid');
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
            toast.error('Realtime STT failed — switching to browser fallback');
            startFallbackRef.current?.();
          }
        },
        onError: (err) => {
          const msg = err?.message || 'STT unavailable';
          if (err?.code === 'input_audio_buffer_commit_empty') return;
          // Ignore transient socket handshake aborts from React Strict Mode remounts
          if (/closed before the connection|websocket error|transport close/i.test(msg) && !recordingRef.current) {
            return;
          }
          if (err?.realtime && useRealtimeRef.current && recordingRef.current) {
            realtimeFailureCountRef.current += 1;
            if (realtimeFailureCountRef.current >= MAX_OPENAI_FAILURES) {
              toast.error('Realtime STT unavailable — using browser + batch');
              startFallbackRef.current?.();
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
      if (openAiFailureCountRef.current >= MAX_OPENAI_FAILURES) {
        openAiEnabledRef.current = false;
        setSttMode('browser');
      }
      const msg = err?.message || 'OpenAI transcription unavailable — using browser STT';
      setSttError(msg);
      if (!transcribeErrorShownRef.current) {
        transcribeErrorShownRef.current = true;
        toast.error(msg);
      }
    } finally {
      transcribeInFlightRef.current = false;
      if (rolling && streamRef.current && recorderRef.current?.state === 'inactive') {
        try { recorderRef.current.start(); } catch { /* ignore */ }
      }
      processPendingSegment();
    }
  }, [pushSession, usableAudioBlob, processPendingSegment]);

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
          restartRecognition('en-US');
        } else if (profile.detected_language === 'arabic' && lang !== 'ar-SA') {
          setRecognitionLang('ar-SA');
          restartRecognition('ar-SA');
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

  const startFallbackCapture = useCallback(async () => {
    useRealtimeRef.current = false;
    clearSilenceWatchdog();
    try { pcmStreamerRef.current?.stop?.(); } catch { /* ignore */ }
    pcmStreamerRef.current = null;
    pcmStartedRef.current = false;
    socketRef.current?.stopRealtime?.();

    if (!streamRef.current) {
      streamRef.current = await getMicrophoneStream();
    }
    const stream = streamRef.current;

    // With no server key there is nothing to POST audio to. Recording and uploading
    // anyway produced a stream of failed /stt/transcribe calls whose only visible
    // effect was an error toast.
    if (!serverSttRef.current) {
      browserCaptionActiveRef.current = true;
      restartRecognition(recognitionLang);
      setSttMode('browser');
      return;
    }

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

  const handleManualExtract = async () => {
    if (!sessionId || !manualText.trim()) return;
    const cleaned = conservativeTranscriptCleanup(manualText.trim());
    const output = await extractTranscript(sessionId, cleaned, true, true);
    pushSession(output);
    setFinalLines([{ text: cleaned, source: 'manual' }]);
    finalLinesRef.current = [{ text: cleaned, source: 'manual' }];
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

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-black text-slate-800">التقاط صوتي — Voice Triage STT</p>
          <p className="text-xs text-slate-500">Live auto-fill · {modeLabel} · decision support only</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-[10px] font-bold px-2 py-1 rounded-full ${sttMode === 'realtime' ? 'bg-teal-100 text-teal-800' : 'bg-slate-100 text-slate-600'}`}>
            {modeLabel}
          </span>
          <button
            type="button"
            onClick={handleToggleRecord}
            disabled={loading}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-black text-white ${recording ? 'bg-red-600 hover:bg-red-700' : 'bg-teal-600 hover:bg-teal-700'}`}
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : recording ? <Square className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
            {recording ? 'Stop / إيقاف' : 'Start / بدء'}
          </button>
        </div>
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

      {(sttError || manualFallback) && (
        <div className="mx-4 mt-3 bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-900">
          {sttError && <p className="font-bold mb-1">{sttError}</p>}
          {manualFallback && (
            <>
              <div className="flex items-center gap-2 font-bold mb-1"><MicOff className="w-4 h-4" /> Manual fallback</div>
              <textarea
                value={manualText}
                onChange={(e) => setManualText(e.target.value)}
                placeholder="Type triage dictation here (EN/AR)..."
                className="w-full mt-2 rounded-lg border border-amber-200 p-2 text-sm"
                rows={3}
              />
              <button type="button" onClick={handleManualExtract} className="mt-2 px-3 py-1.5 bg-amber-600 text-white rounded-lg font-bold">
                Extract / استخراج
              </button>
            </>
          )}
        </div>
      )}

      <div className="p-4 space-y-4">
        <div>
          <p className="text-xs font-black text-slate-500 uppercase tracking-wide mb-2">Live transcript</p>
          <div className="min-h-[100px] max-h-40 overflow-y-auto rounded-xl bg-slate-900 text-slate-100 p-3 text-sm leading-relaxed">
            {finalLines.map((line, i) => {
              const text = typeof line === 'string' ? line : line.text;
              const src = typeof line === 'string' ? 'browser' : line.source;
              return (
              <div key={i} className="mb-1">
                <span className="text-[10px] text-slate-400 mr-2">
                  {src === 'openai' ? 'AI' : detectTranscriptLanguage(text).detected_language === 'arabic' ? 'AR' : detectTranscriptLanguage(text).detected_language === 'english' ? 'EN' : 'MIX'}
                </span>
                <span className="text-white">{text}</span>
              </div>
            );})}
            {interimText && <span className="text-teal-300 opacity-80">{interimText}</span>}
            {!liveTranscript && <span className="text-slate-500">Tap Start and speak (EN/AR) — اضغط بدء وتحدث</span>}
          </div>
        </div>

        {sessionOutput && onResync && (
          <button
            type="button"
            onClick={async () => {
              const full = getLiveTranscript(finalLinesRef.current, interimTextRef.current);
              if (sessionId && full) {
                try {
                  const retry = await extractTranscript(sessionId, full, true, true);
                  pushSession(retry);
                } catch (e) {
                  setSttError(e.message);
                }
              }
              onResync(sessionOutput);
            }}
            className="w-full py-2 border border-slate-300 rounded-xl text-xs font-bold text-slate-700 hover:bg-slate-50"
          >
            Re-sync fields / إعادة مزامنة
          </button>
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
}
