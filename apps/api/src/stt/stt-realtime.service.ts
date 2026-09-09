import { Injectable, Logger } from '@nestjs/common';
import WebSocket from 'ws';
import {
  CLINICAL_STT_VOCABULARY,
  buildMixedSttPrompt,
  createRealtimeConfigState,
  reduceRealtimeEvent,
  type RealtimeConfigState,
} from '@triagepulse/clinical';
import { SttService } from './stt.service';

export type RealtimeEmitFn = (event: string, payload: unknown) => void;

interface RealtimeSession {
  sessionId: string;
  ws: WebSocket;
  emit: RealtimeEmitFn;
  closed: boolean;
  partialByItem: Map<string, string>;
  commitTimer: ReturnType<typeof setInterval> | null;
  bytesSinceCommit: number;
  useServerVad: boolean;
  /** Config-acknowledgement state — see @triagepulse/clinical reduceRealtimeEvent. */
  config: RealtimeConfigState;
  /** Wall-clock of the last chunk whose RMS cleared the speech threshold. */
  lastVoiceAt: number;
  /** Wall-clock of the last commit, so a monologue still gets flushed. */
  lastCommitAt: number;
}

const SAMPLE_RATE = 24000;
const BYTES_PER_SAMPLE = 2;
const MIN_BYTES_BEFORE_COMMIT = 24000; // ~0.5s of 24kHz PCM16 mono
/** How often the manual-commit path re-evaluates; the decision itself is silence-driven. */
const COMMIT_TICK_MS = 250;
/** RMS (0..1) below which a chunk counts as silence for commit gating. */
const SILENCE_RMS = 0.012;

function envInt(name: string, fallback: number): number {
  const raw = Number.parseInt(process.env[name] || '', 10);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

/** Peak-normalised RMS of a PCM16 LE buffer. */
function pcm16Rms(buffer: Buffer): number {
  const samples = Math.floor(buffer.length / BYTES_PER_SAMPLE);
  if (samples === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples; i += 1) {
    const s = buffer.readInt16LE(i * BYTES_PER_SAMPLE) / 32768;
    sum += s * s;
  }
  return Math.sqrt(sum / samples);
}

@Injectable()
export class SttRealtimeService {
  private readonly logger = new Logger(SttRealtimeService.name);
  private sessions = new Map<string, RealtimeSession>();

  constructor(private sttService: SttService) {}

  isConfigured(): boolean {
    return !!process.env.OPENAI_API_KEY?.trim();
  }

  /** Live caption model (ChatGPT-like). Override via OPENAI_REALTIME_TRANSCRIBE_MODEL. */
  resolveRealtimeModel(): string {
    return process.env.OPENAI_REALTIME_TRANSCRIBE_MODEL || 'gpt-live-transcribe';
  }

  /**
   * Higher delay gives the model more audio context before it emits, which is what
   * makes an Arabic→English switch mid-utterance transcribe correctly. Partial deltas
   * still stream, so the cost lands on finalisation only.
   */
  resolveDelay(): string {
    return process.env.OPENAI_REALTIME_DELAY || 'high';
  }

  /**
   * `auto` (default) asks for server_vad and falls back to manual commits if OpenAI
   * rejects it — negotiated at runtime rather than asserted from the model name.
   */
  resolveVadMode(): 'auto' | 'server_vad' | 'off' {
    const v = (process.env.OPENAI_REALTIME_VAD || 'auto').toLowerCase();
    if (v === 'off' || v === 'false' || v === '0') return 'off';
    if (v === 'server_vad' || v === 'on' || v === 'true' || v === '1') return 'server_vad';
    return 'auto';
  }

  async startSession(sessionId: string, emit: RealtimeEmitFn): Promise<void> {
    if (!this.sttService.getSession(sessionId)) {
      throw new Error('Session not found');
    }
    await this.stopSession(sessionId);

    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) throw new Error('OPENAI_API_KEY not set');

    const transcriptionModel = this.resolveRealtimeModel();
    const delay = this.resolveDelay();
    const vadMode = this.resolveVadMode();
    // Dedicated transcription intent (not a voice-agent realtime session)
    const url = 'wss://api.openai.com/v1/realtime?intent=transcription';

    const ws = new WebSocket(url, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });

    const session: RealtimeSession = {
      sessionId,
      ws,
      emit,
      closed: false,
      partialByItem: new Map(),
      commitTimer: null,
      bytesSinceCommit: 0,
      useServerVad: vadMode !== 'off',
      config: createRealtimeConfigState(),
      lastVoiceAt: 0,
      lastCommitAt: Date.now(),
    };
    this.sessions.set(sessionId, session);

    await new Promise<void>((resolve, reject) => {
      const onOpen = () => {
        cleanup();
        resolve();
      };
      const onError = (err: Error) => {
        cleanup();
        reject(err);
      };
      const cleanup = () => {
        ws.off('open', onOpen);
        ws.off('error', onError);
      };
      ws.on('open', onOpen);
      ws.on('error', onError);
      setTimeout(() => {
        cleanup();
        reject(new Error('Realtime WebSocket connect timeout'));
      }, 10000);
    });

    if (session.closed) return;

    ws.on('message', (raw) => {
      void this.handleMessage(sessionId, raw.toString());
    });

    ws.on('close', () => {
      this.cleanupLocal(sessionId, false);
    });

    ws.on('error', (err) => {
      this.logger.warn(`Realtime WS error [${sessionId}]: ${err.message}`);
      emit('stt_error', { message: err.message || 'Realtime STT failed', realtime: true });
    });

    // One bilingual prompt + the full AR/EN clinical vocabulary as keywords. Previously
    // this block hardcoded an English-only prompt and 11 keywords, bypassing the
    // shared vocabulary entirely.
    const prompt = buildMixedSttPrompt();
    const keywords = CLINICAL_STT_VOCABULARY;

    const sendUpdate = (turnDetection: unknown) => {
      ws.send(JSON.stringify({
        type: 'session.update',
        session: {
          type: 'transcription',
          audio: {
            input: {
              format: { type: 'audio/pcm', rate: SAMPLE_RATE },
              noise_reduction: { type: 'near_field' },
              transcription: {
                model: transcriptionModel,
                delay,
                // Plural `languages` is what gpt-live-transcribe uses; it is the
                // documented mechanism for audio containing more than one language.
                languages: ['ar', 'en'],
                prompt,
                keywords,
              },
              turn_detection: turnDetection,
            },
          },
        },
      }));
    };

    const serverVadConfig = {
      type: 'server_vad',
      threshold: 0.5,
      prefix_padding_ms: 300,
      silence_duration_ms: 700,
    };

    sendUpdate(session.useServerVad ? serverVadConfig : null);

    let ready = await this.waitForSessionReady(sessionId, 8000);

    // Negotiation: if OpenAI refuses turn_detection for this model, retry without it
    // rather than asserting support from the model name.
    if (!ready && session.config.vadRejected && !session.closed) {
      this.logger.log(`Realtime [${sessionId}] server_vad rejected — retrying with manual commits`);
      session.useServerVad = false;
      session.config = createRealtimeConfigState();
      sendUpdate(null);
      ready = await this.waitForSessionReady(sessionId, 8000);
    }

    if (!ready || session.closed) {
      const reason = session.config.sessionError || 'session.update was not acknowledged';
      throw new Error(`Realtime transcription session did not become ready — ${reason}`);
    }

    if (!session.useServerVad) {
      session.lastCommitAt = Date.now();
      session.commitTimer = setInterval(() => {
        this.maybeCommit(sessionId, false);
      }, COMMIT_TICK_MS);
    }

    const echoed = session.config.configEchoed;
    this.logger.log(
      `Realtime transcription ready [${sessionId}] model=${transcriptionModel} `
      + `vad=${session.useServerVad ? 'server_vad' : 'manual'} delay=${delay} `
      + `echo=${JSON.stringify(echoed)}`,
    );

    emit('realtime_ready', {
      sessionId,
      intent: 'transcription',
      model: transcriptionModel,
      delay,
      turn_detection: session.useServerVad ? 'server_vad' : null,
      // Proof the config is actually in force rather than silently defaulted.
      config_confirmed: !!echoed,
      languages: echoed?.languages ?? ['ar', 'en'],
      prompt_chars: prompt.length,
      keywords_count: keywords.length,
    });
  }

  appendPcm(sessionId: string, audioBase64: string): void {
    const session = this.sessions.get(sessionId);
    if (!session || session.closed || !session.config.ready) return;
    if (session.ws.readyState !== WebSocket.OPEN) {
      this.logger.warn(`PCM append skipped — WS not open (${session.ws.readyState})`);
      return;
    }
    if (!audioBase64) return;

    const audio = audioBase64.replace(/^data:[^;]+;base64,/, '');
    try {
      const buffer = Buffer.from(audio, 'base64');
      if (buffer.length < 100) return;
      session.bytesSinceCommit += buffer.length;
      // Same decode pass also tells us whether this chunk was speech, which is what
      // lets the manual-commit path cut at a pause instead of on a wall clock.
      if (pcm16Rms(buffer) >= SILENCE_RMS) session.lastVoiceAt = Date.now();
      session.ws.send(JSON.stringify({
        type: 'input_audio_buffer.append',
        audio,
      }));
    } catch (err) {
      this.logger.warn(`PCM append failed: ${(err as Error).message}`);
    }
  }

  async stopSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    if (session.bytesSinceCommit > 0) {
      this.maybeCommit(sessionId, true);
      // With delay=high the final transcript.text.done lands later; closing at 800ms
      // truncated the tail of the last utterance.
      await this.waitForFinalFlush(sessionId, envInt('OPENAI_REALTIME_FLUSH_MS', 2500));
    }
    this.cleanupLocal(sessionId, true);
  }

  /**
   * Give the final committed item time to come back as transcript.text.done before the
   * socket closes. Returns once no partial item is outstanding, or on timeout.
   */
  private async waitForFinalFlush(sessionId: string, timeoutMs: number): Promise<void> {
    const started = Date.now();
    const minGraceMs = 800;
    for (;;) {
      await new Promise((r) => setTimeout(r, 100));
      const session = this.sessions.get(sessionId);
      if (!session || session.closed) return;
      const elapsed = Date.now() - started;
      if (elapsed >= timeoutMs) return;
      if (elapsed >= minGraceMs && session.partialByItem.size === 0) return;
    }
  }

  private waitForSessionReady(sessionId: string, timeoutMs: number): Promise<boolean> {
    const started = Date.now();
    return new Promise((resolve) => {
      const tick = () => {
        const session = this.sessions.get(sessionId);
        if (!session || session.closed) {
          resolve(false);
          return;
        }
        if (session.config.sessionError || session.config.vadRejected) {
          resolve(false);
          return;
        }
        if (session.config.ready) {
          resolve(true);
          return;
        }
        if (Date.now() - started >= timeoutMs) {
          // Proceeding on a timeout means running on OpenAI defaults with no language
          // hints — which is exactly the bug. Fail loudly unless explicitly opted out.
          if (process.env.OPENAI_REALTIME_STRICT === 'false') {
            this.logger.warn(`Realtime session.updated timeout [${sessionId}] — proceeding unconfirmed`);
            session.config = { ...session.config, ready: true };
            resolve(true);
            return;
          }
          this.logger.error(`Realtime session.updated timeout [${sessionId}] — config unconfirmed`);
          resolve(false);
          return;
        }
        setTimeout(tick, 50);
      };
      tick();
    });
  }

  /**
   * Commit at a pause, not on a wall clock.
   *
   * The old 1.2s fixed interval closed an input item mid-sentence, and the model
   * re-decides language per item — so an Arabic→English switch inside one utterance
   * was split across two items and each half was language-detected independently.
   */
  private maybeCommit(sessionId: string, force: boolean): void {
    const session = this.sessions.get(sessionId);
    if (!session || session.closed) return;
    if (session.ws.readyState !== WebSocket.OPEN) return;
    if (session.bytesSinceCommit <= 0) return;

    if (!force) {
      if (session.bytesSinceCommit < MIN_BYTES_BEFORE_COMMIT) return;

      const now = Date.now();
      const silenceMs = envInt('OPENAI_REALTIME_SILENCE_MS', 600);
      const minSegmentMs = envInt('OPENAI_REALTIME_COMMIT_MS', 4000);
      const maxSegmentMs = envInt('OPENAI_REALTIME_MAX_SEGMENT_MS', 12000);
      const sinceCommit = now - session.lastCommitAt;

      const atPause = session.lastVoiceAt > 0 && now - session.lastVoiceAt >= silenceMs;
      const overrun = sinceCommit >= maxSegmentMs;

      // Hold the segment open until the speaker actually pauses, unless a monologue
      // has run past the hard cap.
      if (!overrun && !(atPause && sinceCommit >= minSegmentMs)) return;
    }

    try {
      session.ws.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
      session.bytesSinceCommit = 0;
      session.lastCommitAt = Date.now();
    } catch {
      /* ignore */
    }
  }

  private async handleMessage(sessionId: string, raw: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session || session.closed) return;

    let event: Record<string, unknown>;
    try {
      event = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return;
    }

    const type = String(event.type || '');

    // Lifecycle/config acknowledgement is a pure state machine — see runSttTests STT-12..17.
    const wasReady = session.config.ready;
    session.config = reduceRealtimeEvent(session.config, event);

    if (
      type === 'session.updated'
      || type === 'transcription_session.updated'
      || type === 'session.created'
      || type === 'transcription_session.created'
    ) {
      if (!wasReady && session.config.ready) {
        this.logger.log(
          `Realtime config confirmed [${sessionId}] ${JSON.stringify(session.config.configEchoed)}`,
        );
      }
      return;
    }

    if (type === 'error') {
      const errObj = event.error as { message?: string; code?: string } | undefined;
      let msg = errObj?.message || 'Realtime transcription error';
      // Benign empty-buffer commit race — noisy and non-fatal.
      if (errObj?.code === 'input_audio_buffer_commit_empty') return;
      if (/no credits|insufficient.?quota|billing|payment.?required/i.test(msg)) {
        msg = 'OpenAI account has no credits remaining — add billing credits to restore Realtime STT.';
      }
      this.logger.warn(`Realtime error [${sessionId}]: ${msg}`);
      // A turn_detection refusal is handled by the negotiation retry in startSession;
      // surfacing it to the clinician would be noise.
      if (session.config.vadRejected && !session.config.ready) return;
      session.emit('stt_error', { message: msg, code: errObj?.code, realtime: true, billing: /no credits|billing/i.test(msg) });
      return;
    }

    // Ignore buffer/VAD lifecycle noise; still useful to clear byte counters after auto-commit
    if (type === 'input_audio_buffer.committed' || type === 'input_audio_buffer.cleared') {
      session.bytesSinceCommit = 0;
      return;
    }

    if (
      type === 'conversation.item.input_audio_transcription.delta'
      || type === 'transcript.text.delta'
    ) {
      const itemId = String(event.item_id || event.itemId || 'current');
      const delta = String(event.delta || event.text || '');
      if (!delta) return;
      const prev = session.partialByItem.get(itemId) || '';
      const next = prev + delta;
      session.partialByItem.set(itemId, next);
      session.emit('transcript_partial', {
        sessionId,
        item_id: itemId,
        text: next,
        delta,
        isFinal: false,
      });
      return;
    }

    if (
      type === 'conversation.item.input_audio_transcription.completed'
      || type === 'transcript.text.done'
    ) {
      const itemId = String(event.item_id || event.itemId || 'current');
      const transcript = String(
        event.transcript || event.text || session.partialByItem.get(itemId) || '',
      ).trim();
      session.partialByItem.delete(itemId);
      if (!transcript) return;

      // Emit only. The client owns transcript assembly and posts the full text to
      // /stt/extract; having the server ALSO append here raced that replace and
      // duplicated the server-side transcript (plus an extra LLM call per item).
      session.emit('transcript_final', {
        sessionId,
        item_id: itemId,
        text: transcript,
        isFinal: true,
        confidence: 0.9,
      });
    }
  }

  private cleanupLocal(sessionId: string, closeSocket: boolean): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.closed = true;
    if (session.commitTimer) {
      clearInterval(session.commitTimer);
      session.commitTimer = null;
    }
    if (closeSocket && session.ws.readyState === WebSocket.OPEN) {
      try { session.ws.close(); } catch { /* ignore */ }
    }
    this.sessions.delete(sessionId);
  }
}
