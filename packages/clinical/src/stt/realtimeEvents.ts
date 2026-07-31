/**
 * Pure reducer for OpenAI Realtime transcription session lifecycle events.
 *
 * Extracted from the WebSocket proxy so the config-acknowledgement contract can be
 * tested without a network or a Nest bootstrap. Transcript delta/final handling stays
 * in the proxy — it needs to emit and await.
 */

export interface RealtimeTranscriptionEcho {
  model?: string;
  languages?: unknown;
  delay?: string;
  prompt?: string;
  keywords?: unknown;
  [key: string]: unknown;
}

export interface RealtimeConfigState {
  /** The socket handshake completed (session.created). Says nothing about our config. */
  createdAck: boolean;
  /** OpenAI acknowledged our session.update. Only then is the config actually in force. */
  ready: boolean;
  /** A fatal config rejection. Benign races (empty commit) never set this. */
  sessionError: string | null;
  /** The transcription block OpenAI echoed back — proof of what is actually configured. */
  configEchoed: RealtimeTranscriptionEcho | null;
  /** OpenAI refused turn_detection; the caller should retry with it disabled. */
  vadRejected: boolean;
}

/** Errors that are races rather than misconfiguration; they must not kill the session. */
const BENIGN_ERROR_CODES = new Set(['input_audio_buffer_commit_empty']);

export function createRealtimeConfigState(): RealtimeConfigState {
  return {
    createdAck: false,
    ready: false,
    sessionError: null,
    configEchoed: null,
    vadRejected: false,
  };
}

interface RealtimeEvent {
  type?: unknown;
  session?: { audio?: { input?: { transcription?: RealtimeTranscriptionEcho } } };
  error?: { message?: string; code?: string; param?: string };
}

export function isTurnDetectionRejection(error: {
  message?: string;
  code?: string;
  param?: string;
} | undefined): boolean {
  if (!error) return false;
  const haystack = `${error.param || ''} ${error.message || ''}`.toLowerCase();
  return haystack.includes('turn_detection');
}

export function reduceRealtimeEvent(
  state: RealtimeConfigState,
  event: unknown,
): RealtimeConfigState {
  const e = (event || {}) as RealtimeEvent;
  const type = String(e.type || '');

  // The socket is up. This says nothing about whether OUR session.update was accepted —
  // treating it as ready is what let a rejected config fall through to OpenAI defaults.
  if (type === 'session.created' || type === 'transcription_session.created') {
    return { ...state, createdAck: true };
  }

  // Only session.updated proves the languages/prompt/keywords we sent are in force.
  if (type === 'session.updated' || type === 'transcription_session.updated') {
    return {
      ...state,
      ready: true,
      configEchoed: e.session?.audio?.input?.transcription ?? null,
    };
  }

  if (type === 'error') {
    // Order matters: benign races must be filtered out BEFORE anything can set
    // sessionError, or a startup empty-commit would kill every session.
    if (e.error?.code && BENIGN_ERROR_CODES.has(e.error.code)) return state;

    // A turn_detection refusal is recoverable — the caller retries with VAD disabled.
    if (isTurnDetectionRejection(e.error)) return { ...state, vadRejected: true };

    // After the config is confirmed, errors are runtime noise for the client to show,
    // not a reason to tear down a working session.
    if (state.ready) return state;

    return { ...state, sessionError: e.error?.message || 'Realtime transcription error' };
  }

  return state;
}
