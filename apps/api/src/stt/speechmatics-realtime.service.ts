import { Injectable, Logger } from '@nestjs/common';
import WebSocket from 'ws';
import { CLINICAL_STT_VOCABULARY } from '@triagepulse/clinical';
import { SttService } from './stt.service';
import type { RealtimeEmitFn } from './stt-realtime.service';

/**
 * Live Arabic + English speech through Speechmatics (language `ar_en`, one bilingual model,
 * medical domain when the account offers it). The API key stays on the server: the browser
 * streams PCM to our gateway exactly as it does for OpenAI, and this service relays it.
 *
 * Speechmatics sends short final fragments (never revised) plus a running partial. The client
 * expects one final per utterance, so fragments are gathered here and released as one final
 * at each pause (EndOfUtterance), keeping the client's transcript assembly unchanged.
 */

const SAMPLE_RATE = 24000; // what the web client streams (voiceCapture REALTIME_SAMPLE_RATE)
const STATUS_TTL_MS = 5 * 60 * 1000;
const MAX_UTTERANCE_CHARS = 600;

interface SmSession {
  sessionId: string;
  ws: WebSocket;
  emit: RealtimeEmitFn;
  closed: boolean;
  ready: boolean;
  seqNo: number;
  utterance: string;
  itemNo: number;
  ended: boolean;
  config: { language: string; domain: string | null; model: string };
  lastPartial: string;
  idleTimer: ReturnType<typeof setTimeout> | null;
}

interface Attempt { language: string; domain: string | null; model: string }

function env(name: string, fallback: string): string {
  const v = process.env[name]?.trim();
  return v ? v : fallback;
}

/** Join fragments: no space before punctuation, single spaces otherwise. */
export function joinFragments(a: string, b: string): string {
  const left = a.trim();
  const right = b.trim();
  if (!left) return right;
  if (!right) return left;
  if (/^[.,،؛;:!?؟)\]]/.test(right)) return left + right;
  return `${left} ${right}`;
}

@Injectable()
export class SpeechmaticsRealtimeService {
  private readonly logger = new Logger(SpeechmaticsRealtimeService.name);
  private sessions = new Map<string, SmSession>();
  private status: { at: number; ok: boolean; error?: string } | null = null;

  constructor(private sttService: SttService) {}

  isConfigured(): boolean {
    return !!process.env.SPEECHMATICS_API_KEY?.trim();
  }

  private url(): string {
    return env('SPEECHMATICS_RT_URL', 'wss://eu.rt.speechmatics.com/v2');
  }

  private attempts(): Attempt[] {
    const language = env('SPEECHMATICS_LANGUAGE', 'ar_en');
    const model = env('SPEECHMATICS_MODEL', 'enhanced');
    const domain = env('SPEECHMATICS_DOMAIN', 'medical');
    const list: Attempt[] = [];
    if (domain && domain !== 'none') list.push({ language, domain, model });
    list.push({ language, domain: null, model });
    return list;
  }

  resolveRealtimeModel(): string {
    const a = this.attempts()[0];
    return `speechmatics ${a.language} ${a.model}${a.domain ? ` ${a.domain}` : ''}`;
  }

  /**
   * Is the key accepted? Minting a short-lived real-time key is the cheapest call that checks
   * the key and the account without opening a transcription session. Cached for 5 minutes.
   */
  async checkStatus(): Promise<{ ok: boolean; error?: string }> {
    const apiKey = process.env.SPEECHMATICS_API_KEY?.trim();
    if (!apiKey) return { ok: false, error: 'SPEECHMATICS_API_KEY not set' };
    if (this.status && Date.now() - this.status.at < STATUS_TTL_MS) return this.status;
    let result: { ok: boolean; error?: string };
    try {
      const res = await fetch('https://mp.speechmatics.com/v1/api_keys?type=rt', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ttl: 60 }),
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) result = { ok: true };
      else if (res.status === 401 || res.status === 403) result = { ok: false, error: 'Speechmatics key was refused — check SPEECHMATICS_API_KEY' };
      else if (res.status === 402 || res.status === 429) result = { ok: false, error: 'Speechmatics account limit reached (quota or concurrency)' };
      else result = { ok: false, error: `Speechmatics status check failed (${res.status})` };
    } catch {
      result = { ok: false, error: 'Speechmatics could not be reached from the server' };
    }
    this.status = { at: Date.now(), ...result };
    return result;
  }

  async startSession(sessionId: string, emit: RealtimeEmitFn): Promise<void> {
    if (!this.sttService.getSession(sessionId)) throw new Error('Session not found');
    await this.stopSession(sessionId);
    const apiKey = process.env.SPEECHMATICS_API_KEY?.trim();
    if (!apiKey) throw new Error('SPEECHMATICS_API_KEY not set');

    let lastError = 'Speechmatics session did not start';
    for (const attempt of this.attempts()) {
      try {
        await this.open(sessionId, emit, apiKey, attempt);
        const s = this.sessions.get(sessionId);
        this.logger.log(`Speechmatics ready [${sessionId}] ${JSON.stringify(attempt)}`);
        emit('realtime_ready', {
          sessionId,
          provider: 'speechmatics',
          model: this.label(attempt),
          languages: ['ar', 'en'],
          config_confirmed: true,
          keywords_count: this.vocab().length,
          medical: !!s?.config.domain,
        });
        return;
      } catch (err) {
        lastError = (err as Error).message;
        this.logger.warn(`Speechmatics start [${sessionId}] ${JSON.stringify(attempt)} failed: ${lastError}`);
        this.cleanupLocal(sessionId, true);
        // A refused key or exhausted quota will not improve with a different config.
        if (/not_authorised|quota|4001|4005/i.test(lastError)) break;
      }
    }
    this.status = { at: Date.now(), ok: false, error: lastError };
    throw new Error(lastError);
  }

  private label(a: Attempt) {
    return `speechmatics ${a.language} ${a.model}${a.domain ? ` ${a.domain}` : ''}`;
  }

  private vocab() {
    // Multi-word clinical phrases are fine as `content`; keep the list small so start-up stays fast.
    return Array.from(new Set(CLINICAL_STT_VOCABULARY.map((v) => String(v).trim()).filter(Boolean)))
      .slice(0, 1000)
      .map((content) => ({ content }));
  }

  private open(sessionId: string, emit: RealtimeEmitFn, apiKey: string, attempt: Attempt): Promise<void> {
    const ws = new WebSocket(this.url(), { headers: { Authorization: `Bearer ${apiKey}` } });
    const session: SmSession = {
      sessionId, ws, emit, closed: false, ready: false, seqNo: 0,
      utterance: '', itemNo: 0, ended: false, config: attempt, lastPartial: '', idleTimer: null,
    };
    this.sessions.set(sessionId, session);

    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const done = (err?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (err) reject(err); else resolve();
      };
      const timer = setTimeout(() => done(new Error('Speechmatics did not confirm the session in time')), 15_000);

      ws.on('open', () => {
        const transcription_config: Record<string, unknown> = {
          language: attempt.language,
          model: attempt.model,
          enable_partials: true,
          max_delay: Number(env('SPEECHMATICS_MAX_DELAY', '1.5')),
          additional_vocab: this.vocab(),
          conversation_config: { end_of_utterance_silence_trigger: Number(env('SPEECHMATICS_PAUSE_S', '0.8')) },
        };
        if (attempt.domain) transcription_config.domain = attempt.domain;
        ws.send(JSON.stringify({
          message: 'StartRecognition',
          audio_format: { type: 'raw', encoding: 'pcm_s16le', sample_rate: SAMPLE_RATE },
          transcription_config,
        }));
      });

      ws.on('message', (raw, isBinary) => {
        if (isBinary) return;
        let msg: Record<string, any>;
        try { msg = JSON.parse(raw.toString()); } catch { return; }
        const type = String(msg.message || '');
        if (type === 'RecognitionStarted') {
          session.ready = true;
          done();
          return;
        }
        if (type === 'Error') {
          const reason = `${msg.type || 'error'}: ${msg.reason || 'Speechmatics error'}`;
          if (!session.ready) { done(new Error(reason)); return; }
          this.logger.warn(`Speechmatics error [${sessionId}] ${reason}`);
          this.flush(session);
          emit('stt_error', { message: `Speechmatics — ${msg.reason || msg.type}`, realtime: true, provider: 'speechmatics' });
          return;
        }
        this.handle(session, type, msg);
      });

      ws.on('unexpected-response', (_req, res) => {
        done(new Error(`Speechmatics refused the connection (${res.statusCode}${res.statusCode === 401 ? ' not_authorised' : ''})`));
      });
      ws.on('error', (err) => {
        if (!session.ready) { done(err); return; }
        this.logger.warn(`Speechmatics WS error [${sessionId}]: ${err.message}`);
      });
      ws.on('close', (code) => {
        if (!session.ready) done(new Error(`Speechmatics closed the connection (${code})`));
        this.flush(session);
        session.ended = true;
        if (this.sessions.get(sessionId) === session) this.cleanupLocal(sessionId, false);
      });
    });
  }

  /**
   * Partials carry `stable_text` = the words Speechmatics has finalised (never revised). The
   * client fills the boxes from that, so a half-heard number ("heart rate 18…") never lands in a
   * box or raises an alert, while the boxes still fill as the nurse speaks.
   */
  private emitPartial(s: SmSession, text: string) {
    if (!text || text === s.lastPartial) return; // repeats would only reset the client's timer
    s.lastPartial = text;
    s.emit('transcript_partial', {
      sessionId: s.sessionId, item_id: `sm-${s.itemNo}`, text, stable_text: s.utterance, isFinal: false,
    });
  }

  private handle(s: SmSession, type: string, msg: Record<string, any>) {
    if (type === 'AddPartialTranscript') {
      this.emitPartial(s, joinFragments(s.utterance, String(msg.metadata?.transcript || '')));
      return;
    }
    if (type === 'AddTranscript') {
      const fragment = String(msg.metadata?.transcript || '');
      if (!fragment.trim()) return;
      s.utterance = joinFragments(s.utterance, fragment);
      this.emitPartial(s, s.utterance);
      if (s.utterance.length >= MAX_UTTERANCE_CHARS) { this.flush(s); return; }
      // Release the line after a short quiet spell even if no EndOfUtterance arrives.
      if (s.idleTimer) clearTimeout(s.idleTimer);
      s.idleTimer = setTimeout(() => this.flush(s), Number(env('SPEECHMATICS_LINE_IDLE_MS', '1800')));
      return;
    }
    if (type === 'EndOfUtterance') { this.flush(s); return; }
    if (type === 'EndOfTranscript') { this.flush(s); s.ended = true; return; }
    if (type === 'Warning') this.logger.warn(`Speechmatics warning [${s.sessionId}] ${msg.type}: ${msg.reason || ''}`);
  }

  /** Release the gathered utterance as one final. */
  private flush(s: SmSession) {
    if (s.idleTimer) { clearTimeout(s.idleTimer); s.idleTimer = null; }
    const text = s.utterance.trim();
    s.utterance = '';
    s.lastPartial = '';
    if (!text || s.closed) return;
    s.emit('transcript_final', { sessionId: s.sessionId, item_id: `sm-${s.itemNo}`, text, isFinal: true, confidence: 0.9 });
    s.itemNo += 1;
  }

  appendPcm(sessionId: string, audioBase64: string): void {
    const s = this.sessions.get(sessionId);
    if (!s || s.closed || !s.ready || s.ws.readyState !== WebSocket.OPEN || !audioBase64) return;
    try {
      const buffer = Buffer.from(audioBase64.replace(/^data:[^;]+;base64,/, ''), 'base64');
      if (buffer.length < 100) return;
      s.ws.send(buffer);
      s.seqNo += 1;
    } catch (err) {
      this.logger.warn(`Speechmatics audio send failed: ${(err as Error).message}`);
    }
  }

  async stopSession(sessionId: string): Promise<void> {
    const s = this.sessions.get(sessionId);
    if (!s) return;
    if (s.ready && s.ws.readyState === WebSocket.OPEN) {
      try { s.ws.send(JSON.stringify({ message: 'EndOfStream', last_seq_no: s.seqNo })); } catch { /* ignore */ }
      // Let the last words come back (EndOfTranscript) before closing.
      const started = Date.now();
      const wait = Number(env('SPEECHMATICS_FLUSH_MS', '3000'));
      while (!s.ended && Date.now() - started < wait) await new Promise((r) => setTimeout(r, 100));
    }
    this.flush(s);
    this.cleanupLocal(sessionId, true);
  }

  private cleanupLocal(sessionId: string, closeSocket: boolean) {
    const s = this.sessions.get(sessionId);
    if (!s) return;
    if (s.idleTimer) { clearTimeout(s.idleTimer); s.idleTimer = null; }
    s.closed = true;
    if (closeSocket && (s.ws.readyState === WebSocket.OPEN || s.ws.readyState === WebSocket.CONNECTING)) {
      try { s.ws.close(); } catch { /* ignore */ }
    }
    this.sessions.delete(sessionId);
  }
}
