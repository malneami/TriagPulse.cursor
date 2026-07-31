#!/usr/bin/env node
/**
 * Probe what the OpenAI Realtime transcription session actually accepts.
 *
 * Answers two questions the app has to guess at otherwise:
 *   1. Does the configured model accept turn_detection: server_vad?
 *   2. Does it echo back `languages: ['ar','en']` — i.e. is the code-switch config
 *      really in force, or is the session silently running on defaults?
 *
 * Usage:
 *   node scripts/stt-realtime-probe.mjs                # server_vad (default)
 *   node scripts/stt-realtime-probe.mjs --no-vad       # turn_detection: null
 *
 * Requires OPENAI_API_KEY in the environment. Sends no audio; opens, configures,
 * dumps every event for a few seconds, exits.
 */
import WebSocket from 'ws';

const apiKey = process.env.OPENAI_API_KEY?.trim();
if (!apiKey) {
  console.error('OPENAI_API_KEY not set');
  process.exit(2);
}

const useVad = !process.argv.includes('--no-vad');
const model = process.env.OPENAI_REALTIME_TRANSCRIBE_MODEL || 'gpt-live-transcribe';
const delay = process.env.OPENAI_REALTIME_DELAY || 'high';
const watchMs = 6000;

const ws = new WebSocket('wss://api.openai.com/v1/realtime?intent=transcription', {
  headers: { Authorization: `Bearer ${apiKey}` },
});

let sawUpdated = false;
let sawError = false;

ws.on('open', () => {
  console.log(`→ connected  model=${model} delay=${delay} turn_detection=${useVad ? 'server_vad' : 'null'}`);
  ws.send(JSON.stringify({
    type: 'session.update',
    session: {
      type: 'transcription',
      audio: {
        input: {
          format: { type: 'audio/pcm', rate: 24000 },
          noise_reduction: { type: 'near_field' },
          transcription: {
            model,
            delay,
            languages: ['ar', 'en'],
            prompt: 'Mixed Arabic and English ED triage dictation. Preserve code-switching.',
            keywords: ['CTAS', 'SpO2', 'GCS', 'chest pain', 'ألم صدر', 'ضغط', 'نبض'],
          },
          turn_detection: useVad
            ? { type: 'server_vad', threshold: 0.5, prefix_padding_ms: 300, silence_duration_ms: 700 }
            : null,
        },
      },
    },
  }));
});

ws.on('message', (raw) => {
  let event;
  try {
    event = JSON.parse(raw.toString());
  } catch {
    console.log('←', raw.toString().slice(0, 200));
    return;
  }
  const type = event.type || '(untyped)';
  if (type === 'session.updated' || type === 'transcription_session.updated') {
    sawUpdated = true;
    console.log(`← ${type}`);
    console.log('  echoed transcription config:',
      JSON.stringify(event.session?.audio?.input?.transcription, null, 2));
    console.log('  echoed turn_detection:',
      JSON.stringify(event.session?.audio?.input?.turn_detection));
  } else if (type === 'error') {
    sawError = true;
    console.log(`← error  code=${event.error?.code} param=${event.error?.param}`);
    console.log(`  ${event.error?.message}`);
  } else {
    console.log(`← ${type}`);
  }
});

ws.on('error', (err) => {
  console.error('socket error:', err.message);
});

setTimeout(() => {
  console.log('\n─── verdict ───');
  console.log(`turn_detection=${useVad ? 'server_vad' : 'null'} → ${sawUpdated ? 'ACCEPTED' : 'NOT ACKNOWLEDGED'}${sawError ? ' (error reported)' : ''}`);
  if (!useVad && !sawUpdated) console.log('Neither VAD mode was acknowledged — check the model id and API key.');
  try { ws.close(); } catch { /* ignore */ }
  process.exit(sawUpdated ? 0 : 1);
}, watchMs);
