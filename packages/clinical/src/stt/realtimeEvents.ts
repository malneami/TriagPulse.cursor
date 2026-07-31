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

  if (type === 'session.created' || type === 'transcription_session.created') {
    return { ...state, createdAck: true, ready: true };
  }

  if (type === 'session.updated' || type === 'transcription_session.updated') {
    return {
      ...state,
      ready: true,
      configEchoed: e.session?.audio?.input?.transcription ?? null,
    };
  }

  if (type === 'error') {
    const message = e.error?.message || 'Realtime transcription error';
    return { ...state, sessionError: message };
  }

  return state;
}
