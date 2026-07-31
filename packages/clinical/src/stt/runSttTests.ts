/**
 * STT code-switching (Arabic/English) regression tests.
 * Same hand-rolled style as ctas/runTests.ts — no test framework.
 * Run via the root `npm test`.
 */
import {
  buildCodeSwitchPrompt,
  conservativeTranscriptCleanup,
  segmentTranscriptByLanguage,
  detectTranscriptLanguage,
} from './vocabulary.js';
import {
  createRealtimeConfigState,
  reduceRealtimeEvent,
} from './realtimeEvents.js';
import { createEmptySttFields, extractFieldsFromTranscript, mapSttSessionToPatientUpdates } from './extractFields.js';

/** Mixed AR/EN dictation the ED actually produces. Mirrors scripts/stt-sample-encounters.json. */
export const CODE_SWITCH_SAMPLES = [
  'المريض عنده chest pain منذ ساعتين، pain score سبعة',
  'Patient has ألم صدر since two hours, الضغط one forty over ninety',
  'الضغط مئة وأربعين over ninety',
  'heart rate مئة وعشرة',
];

const ARABIC = /[؀-ۿ]/;
const LATIN = /[A-Za-z]/;

export function runSttTests(
  assert: (cond: boolean, id: string, name: string, detail?: string) => void,
): void {
  // ── R5: Arabic must not be shattered into single characters ────────────────
  {
    const segments = segmentTranscriptByLanguage('المريض عنده chest pain');
    const arabic = segments.filter((s) => s.lang === 'ar');
    assert(
      arabic.length > 0 && arabic.every((s) => s.text.length > 1),
      'STT-01',
      'segmentTranscriptByLanguage keeps Arabic words intact',
      `got ${segments.length} segments: ${JSON.stringify(segments.map((s) => s.text))}`,
    );
    assert(
      segments.length <= 4,
      'STT-02',
      'segmentTranscriptByLanguage emits script runs, not characters',
      `got ${segments.length} segments`,
    );
    // start/end must index back into the source, not drift on multi-space joins
    const source = conservativeTranscriptCleanup('المريض عنده chest pain');
    assert(
      segments.every((s) => source.slice(s.start, s.end) === s.text),
      'STT-03',
      'segment start/end offsets index the cleaned transcript',
      JSON.stringify(segments.map((s) => [s.start, s.end, source.slice(s.start, s.end)])),
    );
  }

  // ── R3: the bias prompt must actually contain Arabic ───────────────────────
  {
    const prompt = buildCodeSwitchPrompt();
    assert(
      ARABIC.test(prompt) && LATIN.test(prompt),
      'STT-04',
      'buildCodeSwitchPrompt biases both scripts',
      `len=${prompt.length} arabic=${ARABIC.test(prompt)}`,
    );
  }

  // ── S3: cleanup must not fabricate a red-flag chief complaint ──────────────
  {
    const input = 'the patient has just pain in the left arm';
    const out = conservativeTranscriptCleanup(input);
    assert(
      out.includes('just pain') && !out.includes('chest pain'),
      'STT-05',
      'cleanup does not invent "chest pain" from "just pain"',
      `got "${out}"`,
    );
    const caseInput = 'this is the case pain management protocol';
    assert(
      !conservativeTranscriptCleanup(caseInput).includes('chest pain'),
      'STT-06',
      'cleanup does not invent "chest pain" from "case pain"',
      `got "${conservativeTranscriptCleanup(caseInput)}"`,
    );
    assert(
      conservativeTranscriptCleanup('temperature is thirty seven').includes('temperature'),
      'STT-07',
      'cleanup preserves the word "temperature"',
      `got "${conservativeTranscriptCleanup('temperature is thirty seven')}"`,
    );
    // the genuine misrecognition repairs must still work
    assert(
      conservativeTranscriptCleanup('chase pain since morning').includes('chest pain'),
      'STT-08',
      'cleanup still repairs "chase pain" → "chest pain"',
    );
  }

  // ── Cleanup runs ~6x per update: must be idempotent and script-preserving ──
  {
    for (const [i, sample] of CODE_SWITCH_SAMPLES.entries()) {
      const once = conservativeTranscriptCleanup(sample);
      const twice = conservativeTranscriptCleanup(once);
      assert(
        once === twice,
        `STT-09.${i + 1}`,
        'cleanup is idempotent on code-switched input',
        `"${once}" !== "${twice}"`,
      );
      assert(
        ARABIC.test(once) && LATIN.test(once),
        `STT-10.${i + 1}`,
        'cleanup preserves both scripts',
        `got "${once}"`,
      );
    }
  }

  // ── detected_language contract (web copy is checked in the WER harness) ────
  {
    assert(
      detectTranscriptLanguage('الضغط one forty').detected_language === 'mixed_arabic_english',
      'STT-11',
      'detectTranscriptLanguage reports mixed_arabic_english',
    );
  }

  // ── R1: session.update rejection must NOT be masked by session.created ─────
  {
    let state = createRealtimeConfigState();
    state = reduceRealtimeEvent(state, { type: 'transcription_session.created' });
    assert(
      state.createdAck && !state.ready,
      'STT-12',
      'session.created acks the socket but does not mark config ready',
      `createdAck=${state.createdAck} ready=${state.ready}`,
    );

    state = reduceRealtimeEvent(state, {
      type: 'error',
      error: { message: 'Unknown parameter: session.audio.input.transcription.delay' },
    });
    assert(
      !state.ready && state.sessionError !== null,
      'STT-13',
      'a config rejection before ready is recorded, not swallowed',
      `ready=${state.ready} sessionError=${state.sessionError}`,
    );
  }

  // ── The reorder trap: a benign commit-empty race must not poison the session ─
  {
    let state = createRealtimeConfigState();
    state = reduceRealtimeEvent(state, { type: 'session.created' });
    state = reduceRealtimeEvent(state, {
      type: 'error',
      error: { code: 'input_audio_buffer_commit_empty', message: 'buffer too small' },
    });
    assert(
      state.sessionError === null,
      'STT-14',
      'input_audio_buffer_commit_empty does not set sessionError',
      `sessionError=${state.sessionError}`,
    );
  }

  // ── session.updated is what proves the config landed ───────────────────────
  {
    let state = createRealtimeConfigState();
    state = reduceRealtimeEvent(state, {
      type: 'session.updated',
      session: {
        audio: {
          input: {
            transcription: { model: 'gpt-live-transcribe', languages: ['ar', 'en'], delay: 'high' },
          },
        },
      },
    });
    assert(
      state.ready,
      'STT-15',
      'session.updated marks the config ready',
    );
    assert(
      Array.isArray(state.configEchoed?.languages)
        && (state.configEchoed?.languages as string[]).join(',') === 'ar,en',
      'STT-16',
      'session.updated echo captures the negotiated languages',
      JSON.stringify(state.configEchoed),
    );
  }

  // ── Spoken numbers must extract in both scripts, and across a switch ───────
  // Modern transcription models usually emit digits, but clinicians dictate the
  // phrases this app suggests ("BP one forty over ninety" / "الضغط مئة وأربعين").
  {
    const cases: Array<[string, string, unknown]> = [
      ['blood pressure one forty over ninety', 'bp_systolic', '140'],
      ['blood pressure one forty over ninety', 'bp_diastolic', '90'],
      ['الضغط مئة وأربعين على تسعين', 'bp_systolic', '140'],
      ['heart rate one ten', 'hr', '110'],
      ['النبض مئة وعشرة', 'hr', '110'],
      // the switch cases: label in one language, number in the other
      ['الضغط مئة وأربعين over ninety', 'bp_systolic', '140'],
      ['heart rate مئة وعشرة', 'hr', '110'],
      ['pain score سبعة', 'pain_score', 7],
      ['درجة الألم سبعة من عشرة', 'pain_score', 7],
      ['SpO2 ninety six', 'spo2', '96'],
      ['الأكسجين ستة وتسعين', 'spo2', '96'],
      ['respiratory rate eighteen', 'rr', '18'],
      ['temperature thirty seven', 'temperature', '37'],
      ['GCS fifteen', 'gcs', '15'],
      // patient updates are the form shape — string-typed for every field
      ['عمره خمسة وخمسين', 'age', '55'],
    ];
    for (const [transcript, key, expected] of cases) {
      const fields = extractFieldsFromTranscript(transcript, createEmptySttFields());
      const { updates } = mapSttSessionToPatientUpdates(fields);
      assert(
        JSON.stringify(updates[key]) === JSON.stringify(expected),
        `STT-18 [${key}]`,
        `spoken number extracts from "${transcript}"`,
        `expected ${JSON.stringify(expected)} got ${JSON.stringify(updates[key])}`,
      );
    }
  }

  // ── A digit-free number word must not be invented out of ordinary prose ────
  {
    const fields = extractFieldsFromTranscript(
      'patient waited for one hour in the waiting room',
      createEmptySttFields(),
    );
    const { updates } = mapSttSessionToPatientUpdates(fields);
    assert(
      updates.hr == null && updates.bp_systolic == null && updates.pain_score == null,
      'STT-19',
      'prose containing number words does not populate vitals',
      JSON.stringify({ hr: updates.hr, bp: updates.bp_systolic, pain: updates.pain_score }),
    );
  }

  // ── Phase 1: turn_detection rejection is recoverable, not fatal ────────────
  {
    let state = createRealtimeConfigState();
    state = reduceRealtimeEvent(state, { type: 'session.created' });
    state = reduceRealtimeEvent(state, {
      type: 'error',
      error: { code: 'invalid_value', param: 'session.audio.input.turn_detection', message: 'Invalid value' },
    });
    assert(
      state.vadRejected && state.sessionError === null,
      'STT-17',
      'turn_detection rejection flags a VAD retry instead of failing the session',
      `vadRejected=${state.vadRejected} sessionError=${state.sessionError}`,
    );
  }
}
