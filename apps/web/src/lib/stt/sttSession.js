import { io } from 'socket.io-client';
import { api, getToken } from '@/api/client';
import { blobToBase64 } from './voiceCapture';

/**
 * In Vite DEV, prefer same-origin + proxy (/socket.io → API).
 * If VITE_API_URL is set, connect straight to the API host (avoids proxy WS drops).
 */
function resolveSttSocketUrl() {
  const explicit = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
  if (explicit) return `${explicit}/stt`;
  if (import.meta.env.DEV) {
    // Same origin so Vite proxies /socket.io; namespace is still /stt
    return '/stt';
  }
  return '/stt';
}

export async function fetchSttStatus() {
  return api.stt.status();
}

export async function createSttSession(journeyId) {
  return api.stt.createSession(journeyId);
}

export function connectSttSocket(sessionId, handlers = {}) {
  const url = resolveSttSocketUrl();
  const socket = io(url, {
    // Allow polling fallback if websocket upgrade is blocked mid-handshake
    transports: ['websocket', 'polling'],
    upgrade: true,
    path: '/socket.io',
    auth: { token: getToken() },
    reconnection: true,
    reconnectionAttempts: 5,
    reconnectionDelay: 500,
    timeout: 12000,
  });

  socket.on('connect', () => {
    socket.emit('join_session', { sessionId });
    handlers.onReady?.();
  });

  socket.on('connect_error', (err) => {
    handlers.onError?.({
      message: err?.message || 'STT socket connection failed',
      realtime: true,
    });
  });

  socket.on('extraction_update', (payload) => handlers.onExtraction?.(payload));
  socket.on('transcript_partial', (payload) => handlers.onTranscriptPartial?.(payload));
  socket.on('transcript_final', (payload) => handlers.onTranscriptFinal?.(payload));
  socket.on('realtime_ready', (payload) => handlers.onRealtimeReady?.(payload));
  socket.on('realtime_ack', (payload) => handlers.onRealtimeAck?.(payload));
  socket.on('stt_error', (payload) => handlers.onError?.(payload));
  socket.on('stt_ready', (payload) => handlers.onModel?.(payload));

  return {
    socket,
    sendTranscriptChunk(text, isFinal = false) {
      socket.emit('transcript_chunk', { sessionId, text, isFinal });
    },
    async sendAudioChunk(blob, mimeType, languageHint) {
      const audioBase64 = await blobToBase64(blob);
      socket.emit('audio_chunk', { sessionId, audioBase64, mimeType, languageHint });
    },
    startRealtime() {
      if (!socket.connected) {
        socket.once('connect', () => socket.emit('realtime_start', { sessionId }));
        socket.connect();
        return;
      }
      socket.emit('realtime_start', { sessionId });
    },
    sendPcmChunk(audioBase64) {
      if (!socket.connected) return;
      socket.emit('pcm_chunk', { sessionId, audioBase64 });
    },
    stopRealtime() {
      if (!socket.connected) return;
      socket.emit('realtime_stop', { sessionId });
    },
    disconnect() {
      socket.removeAllListeners();
      socket.disconnect();
    },
  };
}

export async function extractTranscript(sessionId, transcript, isFinal = false, forceLlm = false) {
  return api.stt.extract(sessionId, transcript, isFinal, forceLlm);
}

export async function updateSttField(sessionId, fieldKey, value) {
  return api.stt.updateField(sessionId, fieldKey, value);
}

export async function transcribeChunk(sessionId, blob, mimeType, languageHint) {
  const audioBase64 = await blobToBase64(blob);
  return api.stt.transcribe({ sessionId, audioBase64, mimeType, languageHint });
}
