#!/usr/bin/env node
/**
 * WER harness for STT triage extraction (rule-based layer).
 * Usage: npm run build --workspace=@triagepulse/clinical && node scripts/stt-wer-harness.mjs
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import {
  createEmptySttFields,
  extractFieldsFromTranscript,
  buildSttSessionOutput,
  mapSttSessionToPatientUpdates,
  computeCtasCompleteness,
  analyzeTranscriptCompleteness,
  conservativeTranscriptCleanup,
} from '../packages/clinical/dist/index.js';
import {
  mergeTranscriptLines,
  getLiveTranscript,
} from '../apps/web/src/lib/stt/ctasFieldMap.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const samplesPath = join(__dirname, 'stt-sample-encounters.json');
const samples = JSON.parse(readFileSync(samplesPath, 'utf8'));

function wer(reference, hypothesis) {
  const ref = reference.toLowerCase().split(/\s+/).filter(Boolean);
  const hyp = hypothesis.toLowerCase().split(/\s+/).filter(Boolean);
  const d = Array.from({ length: ref.length + 1 }, (_, i) => [i]);
  for (let j = 0; j <= hyp.length; j += 1) d[0][j] = j;
  for (let i = 1; i <= ref.length; i += 1) {
    for (let j = 1; j <= hyp.length; j += 1) {
      d[i][j] = Math.min(
        d[i - 1][j] + 1,
        d[i][j - 1] + 1,
        d[i - 1][j - 1] + (ref[i - 1] === hyp[j - 1] ? 0 : 1),
      );
    }
  }
  return ref.length ? d[ref.length][hyp.length] / ref.length : 0;
}

let pass = 0;
let fail = 0;

for (const sample of samples.encounters) {
  const fields = extractFieldsFromTranscript(sample.transcript, createEmptySttFields());
  const output = buildSttSessionOutput(sample.id, sample.transcript, fields);
  const errors = [];

  for (const [key, expected] of Object.entries(sample.expected_fields || {})) {
    const slot = output.fields[key];
    const actual = slot?.value;
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      errors.push(`${key}: expected ${JSON.stringify(expected)} got ${JSON.stringify(actual)}`);
    }
  }

  const { updates } = mapSttSessionToPatientUpdates(output.fields);
  for (const [key, expected] of Object.entries(sample.expected_patient || {})) {
    const actual = updates[key];
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      errors.push(`patient.${key}: expected ${JSON.stringify(expected)} got ${JSON.stringify(actual)}`);
    }
  }

  if (sample.expected_ctas_complete) {
    const ctas = computeCtasCompleteness(updates);
    if (!ctas.isComplete) {
      errors.push(`CTAS incomplete: ${ctas.captured}/${ctas.total} missing ${ctas.missing.join(', ')}`);
    }
  }

  if (sample.expected_mentions?.length) {
    const cleaned = conservativeTranscriptCleanup(sample.transcript);
    const analysis = analyzeTranscriptCompleteness(cleaned, updates);
    for (const key of sample.expected_mentions) {
      if (!analysis.mentionCompleteness.mentioned.includes(key)) {
        errors.push(`mention.${key}: not detected in transcript`);
      }
    }
  }

  const transcriptWer = wer(sample.reference_transcript || sample.transcript, output.full_transcript);
  if (transcriptWer > 0.05) errors.push(`transcript cleanup WER ${transcriptWer.toFixed(3)}`);

  if (errors.length) {
    fail += 1;
    console.error(`FAIL ${sample.id}:`, errors.join('; '));
  } else {
    pass += 1;
    console.log(`PASS ${sample.id} — completeness ${output.completeness.captured}/${output.completeness.total}`);
  }
}

console.log(`\nResults: ${pass} passed, ${fail} failed, ${samples.encounters.length} total`);

// Transcript merge / live-transcript integrity (web client helpers)
let mergePass = 0;
let mergeFail = 0;

function assertMerge(label, condition, detail = '') {
  if (condition) {
    mergePass += 1;
    console.log(`PASS merge ${label}`);
  } else {
    mergeFail += 1;
    console.error(`FAIL merge ${label}${detail ? `: ${detail}` : ''}`);
  }
}

const browserLine = [{ text: 'Patient Ahmed chest pain', source: 'browser' }];
const openaiSuperset = mergeTranscriptLines(browserLine, 'Patient Ahmed chest pain heart rate 110', { source: 'openai' });
assertMerge(
  'openai superset replaces browser',
  openaiSuperset.length === 1 && openaiSuperset[0].source === 'openai',
);

const browserDistinct = [{ text: 'SpO2 96 RR 18', source: 'browser' }];
const openaiPartial = mergeTranscriptLines(browserDistinct, 'Patient Ahmed chest pain', { source: 'openai' });
assertMerge(
  'openai partial overlap keeps browser line',
  openaiPartial.length === 2,
  `got ${openaiPartial.length} lines`,
);

const lines = [
  { text: 'Patient Ahmed', source: 'browser' },
  { text: 'chest pain', source: 'browser' },
];
const live = getLiveTranscript(lines, 'heart rate 110');
assertMerge(
  'getLiveTranscript includes interim',
  live.includes('Patient Ahmed') && live.includes('heart rate 110'),
  live,
);

const deduped = mergeTranscriptLines(lines, 'chest pain', { source: 'browser' });
assertMerge('exact duplicate skipped', deduped.length === 2);

console.log(`\nMerge tests: ${mergePass} passed, ${mergeFail} failed`);

// Realtime gateway event contract (static source check)
import { readFileSync as readSrc } from 'fs';
const gatewaySrc = readSrc(join(__dirname, '../apps/api/src/stt/stt.gateway.ts'), 'utf8');
const realtimeSrc = readSrc(join(__dirname, '../apps/api/src/stt/stt-realtime.service.ts'), 'utf8');
let rtPass = 0;
let rtFail = 0;
function assertRt(label, condition) {
  if (condition) {
    rtPass += 1;
    console.log(`PASS realtime ${label}`);
  } else {
    rtFail += 1;
    console.error(`FAIL realtime ${label}`);
  }
}
assertRt('gateway realtime_start', gatewaySrc.includes("SubscribeMessage('realtime_start')"));
assertRt('gateway pcm_chunk', gatewaySrc.includes("SubscribeMessage('pcm_chunk')"));
assertRt('gateway realtime_stop', gatewaySrc.includes("SubscribeMessage('realtime_stop')"));
assertRt('proxy transcription session', realtimeSrc.includes("type: 'transcription'"));
assertRt('proxy intent=transcription URL', realtimeSrc.includes('intent=transcription'));
assertRt('proxy pcm append', realtimeSrc.includes('input_audio_buffer.append'));
assertRt('proxy commit', realtimeSrc.includes('input_audio_buffer.commit'));
console.log(`\nRealtime contract: ${rtPass} passed, ${rtFail} failed`);

process.exit(fail + mergeFail + rtFail > 0 ? 1 : 0);
