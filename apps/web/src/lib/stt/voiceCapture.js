const TARGET_SAMPLE_RATE = 16000;
const REALTIME_SAMPLE_RATE = 24000;

export function getSpeechRecognition() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  return SR ? new SR() : null;
}

export function supportsBrowserStt() {
  return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
}

export async function getMicrophoneStream() {
  return navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
    video: false,
  });
}

export function createMediaRecorder(stream, { onChunk, onStop } = {}) {
  const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
    ? 'audio/webm;codecs=opus'
    : MediaRecorder.isTypeSupported('audio/mp4')
      ? 'audio/mp4'
      : 'audio/webm';
  const chunks = [];
  const recorder = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 64000 });
  recorder.addEventListener('dataavailable', (e) => {
    if (!e.data?.size) return;
    // WARNING: in timeslice mode only the FIRST blob carries the container header
    // (EBML for WebM, ftyp/moov for MP4). Later blobs are NOT standalone-decodable, so
    // onChunk must never be used to POST individual segments to a transcription API.
    if (onChunk) {
      onChunk(e.data, mimeType);
      return;
    }
    chunks.push(e.data);
  });
  recorder.addEventListener('stop', () => {
    if (onChunk) {
      // Final flush already delivered via dataavailable; nothing to combine
      onStop?.(new Blob([], { type: mimeType }), mimeType);
      return;
    }
    if (chunks.length === 0) return;
    const blob = new Blob(chunks, { type: mimeType });
    chunks.length = 0;
    onStop?.(blob, mimeType);
  });
  return { recorder, mimeType };
}

export async function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function floatTo16BitPCM(float32) {
  const out = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i += 1) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

function downsampleToRate(input, inputRate, outputRate) {
  if (inputRate === outputRate) return input;
  const ratio = inputRate / outputRate;
  const newLen = Math.floor(input.length / ratio);
  const result = new Float32Array(newLen);
  for (let i = 0; i < newLen; i += 1) {
    const idx = Math.floor(i * ratio);
    result[i] = input[idx];
  }
  return result;
}

function int16ToBase64(int16) {
  const bytes = new Uint8Array(int16.buffer, int16.byteOffset, int16.byteLength);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/**
 * Stream mic audio as base64 PCM16 mono @ 24kHz (~100ms chunks).
 * Uses ScriptProcessor for broad browser support (AudioWorklet when available later).
 */
export async function createPcmStreamer(stream, { onPcmBase64, sampleRate = REALTIME_SAMPLE_RATE } = {}) {
  const ctx = new AudioContext({ sampleRate });
  // Some browsers ignore requested sampleRate — always resample from ctx.sampleRate
  const source = ctx.createMediaStreamSource(stream);
  const bufferSize = 4096;
  const processor = ctx.createScriptProcessor(bufferSize, 1, 1);
  let pending = new Float32Array(0);
  const targetChunkSamples = Math.floor(sampleRate * 0.1); // ~100ms
  let stopped = false;

  processor.onaudioprocess = (event) => {
    if (stopped) return;
    const input = event.inputBuffer.getChannelData(0);
    const resampled = downsampleToRate(input, ctx.sampleRate, sampleRate);
    const merged = new Float32Array(pending.length + resampled.length);
    merged.set(pending, 0);
    merged.set(resampled, pending.length);
    pending = merged;

    while (pending.length >= targetChunkSamples) {
      const slice = pending.subarray(0, targetChunkSamples);
      pending = pending.subarray(targetChunkSamples);
      const pcm = floatTo16BitPCM(slice);
      onPcmBase64?.(int16ToBase64(pcm));
    }
  };

  // Mute monitor path so ScriptProcessor keeps firing without speaker feedback
  const mute = ctx.createGain();
  mute.gain.value = 0;
  source.connect(processor);
  processor.connect(mute);
  mute.connect(ctx.destination);

  if (ctx.state === 'suspended') {
    await ctx.resume().catch(() => {});
  }
  // User-gesture resume retry (some browsers suspend again after create)
  if (ctx.state !== 'running') {
    await ctx.resume().catch(() => {});
  }

  return {
    sampleRate,
    contextSampleRate: ctx.sampleRate,
    stop() {
      stopped = true;
      try { processor.disconnect(); } catch { /* ignore */ }
      try { source.disconnect(); } catch { /* ignore */ }
      ctx.close().catch(() => {});
    },
  };
}

// Speech/silence gating now lives server-side in SttRealtimeService.appendPcm, which
// already decodes the exact bytes it is about to commit. A browser-side gate would need
// an extra socket event and a second race.

export { TARGET_SAMPLE_RATE, REALTIME_SAMPLE_RATE };
