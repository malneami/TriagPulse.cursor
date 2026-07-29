import { Injectable, Logger } from '@nestjs/common';
import WebSocket from 'ws';
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
  ready: boolean;
  useServerVad: boolean;
  sessionError: string | null;
}

/** Manual commit fallback only when VAD is disabled. */
const COMMIT_INTERVAL_MS = 1200;
const MIN_BYTES_BEFORE_COMMIT = 24000; // ~0.5s of 24kHz PCM16 mono

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

  resolveDelay(): string {
    return process.env.OPENAI_REALTIME_DELAY || 'low';
  }

  /**
   * gpt-live-transcribe does NOT support turn_detection (OpenAI returns invalid_value).
   * Use manual commit + low delay for live deltas. Other models may allow server_vad via env.
   */
  resolveUseServerVad(): boolean {
    const model = this.resolveRealtimeModel().toLowerCase();
    if (model.includes('live-transcribe') || model.includes('realtime-whisper')) {
      return false;
    }
    const v = (process.env.OPENAI_REALTIME_VAD || 'off').toLowerCase();
    return v === 'server_vad' || v === 'on' || v === 'true' || v === '1';
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
    const useServerVad = this.resolveUseServerVad();
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
      ready: false,
      useServerVad,
      sessionError: null,
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

    const turnDetection = useServerVad
      ? {
          type: 'server_vad',
          threshold: 0.5,
          prefix_padding_ms: 300,
          silence_duration_ms: 500,
        }
      : null;

    ws.send(JSON.stringify({
      type: 'session.update',
      session: {
        type: 'transcription',
        audio: {
          input: {
            format: { type: 'audio/pcm', rate: 24000 },
            noise_reduction: { type: 'near_field' },
            transcription: {
              model: transcriptionModel,
              delay,
              languages: ['ar', 'en'],
              prompt:
                'Saudi emergency department triage dictation. Capture patient name, age, chief complaint, pain score, heart rate, blood pressure, SpO2, respiratory rate, temperature, and GCS. Mix of Arabic and English medical terms is expected.',
              keywords: [
                'CTAS',
                'SpO2',
                'GCS',
                'BP',
                'HR',
                'RR',
                'chest pain',
                'ألم صدر',
                'ضيق تنفس',
                'ضغط',
                'نبض',
              ],
            },
            turn_detection: turnDetection,
          },
        },
      },
    }));

    // Wait for OpenAI to confirm session config before telling the client to stream PCM
    const ready = await this.waitForSessionReady(sessionId, 8000);
    if (!ready || session.closed) {
      throw new Error('Realtime transcription session did not become ready');
    }

    if (!useServerVad) {
      session.commitTimer = setInterval(() => {
        this.maybeCommit(sessionId, false);
      }, COMMIT_INTERVAL_MS);
    }

    this.logger.log(
      `Realtime transcription ready [${sessionId}] model=${transcriptionModel} vad=${useServerVad ? 'server_vad' : 'manual'} delay=${delay}`,
    );

    emit('realtime_ready', {
      sessionId,
      intent: 'transcription',
      model: transcriptionModel,
      delay,
      turn_detection: useServerVad ? 'server_vad' : null,
    });
  }

  appendPcm(sessionId: string, audioBase64: string): void {
    const session = this.sessions.get(sessionId);
    if (!session || session.closed || !session.ready) return;
    if (session.ws.readyState !== WebSocket.OPEN) {
      this.logger.warn(`PCM append skipped — WS not open (${session.ws.readyState})`);
      return;
    }
    if (!audioBase64) return;

    const audio = audioBase64.replace(/^data:[^;]+;base64,/, '');
    try {
      const bytes = Buffer.from(audio, 'base64').length;
      if (bytes < 100) return;
      session.bytesSinceCommit += bytes;
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
      await new Promise((r) => setTimeout(r, 800));
    }
    this.cleanupLocal(sessionId, true);
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
        if (session.sessionError) {
          resolve(false);
          return;
        }
        if (session.ready) {
          resolve(true);
          return;
        }
        if (Date.now() - started >= timeoutMs) {
          // Soft-ready only if no config error was reported
          if (session.sessionError) {
            resolve(false);
            return;
          }
          this.logger.warn(`Realtime session.updated timeout [${sessionId}] — proceeding`);
          session.ready = true;
          resolve(true);
          return;
        }
        setTimeout(tick, 50);
      };
      tick();
    });
  }

  private maybeCommit(sessionId: string, force: boolean): void {
    const session = this.sessions.get(sessionId);
    if (!session || session.closed) return;
    if (session.ws.readyState !== WebSocket.OPEN) return;
    if (session.bytesSinceCommit <= 0) return;
    if (!force && session.bytesSinceCommit < MIN_BYTES_BEFORE_COMMIT) return;
    try {
      session.ws.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
      session.bytesSinceCommit = 0;
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

    if (
      type === 'session.updated'
      || type === 'transcription_session.updated'
      || type === 'session.created'
      || type === 'transcription_session.created'
    ) {
      session.ready = true;
      return;
    }

    if (type === 'error') {
      const errObj = event.error as { message?: string; code?: string } | undefined;
      const msg = errObj?.message || 'Realtime transcription error';
      this.logger.warn(`Realtime error [${sessionId}]: ${msg}`);
      // Session config errors before ready — block soft-ready proceed
      if (!session.ready) {
        session.sessionError = msg;
      }
      // Ignore empty-buffer commits (race); they are noisy and non-fatal
      if (errObj?.code === 'input_audio_buffer_commit_empty') {
        return;
      }
      session.emit('stt_error', { message: msg, code: errObj?.code, realtime: true });
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

      session.emit('transcript_final', {
        sessionId,
        item_id: itemId,
        text: transcript,
        isFinal: true,
        confidence: 0.9,
      });

      try {
        const output = await this.sttService.appendTranscriptAsync(sessionId, transcript, true);
        session.emit('extraction_update', output);
      } catch (err) {
        session.emit('stt_error', {
          message: (err as Error).message || 'Extraction failed',
          realtime: true,
        });
      }
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
