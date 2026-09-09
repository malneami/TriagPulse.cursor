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
      // ASR hamza-drop + common triage age phrasings
      ['مريض عمره اربعين', 'age', '40'],
      ['عمر المريض 48', 'age', '48'],
      ['العمر تقريبا خمسين', 'age', '50'],
      ['حوالي 50 سنة', 'age', '50'],
      ['patient is fifty five years of age', 'age', '55'],
      ['how old is he, fifty five', 'age', '55'],
      // Infant ages → fractional years (2 months ≈ 0.167)
      ['عمره شهرين', 'age', String(Math.round((2 / 12) * 1000) / 1000)],
      ['اسم المريض علي عمره شهرين', 'age', String(Math.round((2 / 12) * 1000) / 1000)],
      ['عمرها ثلاثة أشهر', 'age', String(Math.round((3 / 12) * 1000) / 1000)],
      ['age 2 months', 'age', String(Math.round((2 / 12) * 1000) / 1000)],
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

  // ── A statement that something is NORMAL must not become a complaint ──────
  // Observed live: "His heart beat is good" produced 'Palpitations/Irregular
  // Heartbeat' and overwrote the real complaint (neck pain). A wrong chief
  // complaint is worse than a missing one — it drives the CTAS pathway.
  {
    const negated: Array<[string, string]> = [
      ['His heart beat is good', 'normal heart beat'],
      ['pulse is good', 'normal pulse'],
      ['heart rate is normal', 'explicitly normal HR'],
      ['no chest pain', 'negated chest pain'],
      ['denies chest pain', 'denied chest pain'],
      ['النبض طبيعي', 'normal pulse (ar)'],
      ['لا يوجد ألم صدر', 'negated chest pain (ar)'],
    ];
    for (const [transcript, label] of negated) {
      const fields = extractFieldsFromTranscript(transcript, createEmptySttFields());
      const { updates } = mapSttSessionToPatientUpdates(fields);
      assert(
        updates.chief_complaint == null || updates.chief_complaint === '',
        `STT-20 [${label}]`,
        `"${transcript}" does not invent a chief complaint`,
        `got ${JSON.stringify(updates.chief_complaint)}`,
      );
    }
  }

  // ── An explicit complaint cue outranks an incidental keyword elsewhere ─────
  {
    const t = 'The patient is complaining about neck pain. His heart beat is good.';
    const fields = extractFieldsFromTranscript(t, createEmptySttFields());
    const { updates } = mapSttSessionToPatientUpdates(fields);
    assert(
      typeof updates.chief_complaint === 'string' && /neck/i.test(updates.chief_complaint),
      'STT-21',
      'explicit complaint cue wins over an incidental cardiac keyword',
      `got ${JSON.stringify(updates.chief_complaint)}`,
    );
  }

  // ── Label synonyms: same field, many ways to say it ───────────────────────
  {
    const synonyms: Array<[string, string, unknown]> = [
      // complaint cues
      ['patient complaining about neck pain', 'chief_complaint', 'neck pain'],
      ['patient complains of neck pain', 'chief_complaint', 'neck pain'],
      ['يشتكي من ألم الرقبة', 'chief_complaint', 'ألم الرقبة'],
      // HR
      ['heart beat 74', 'hr', '74'],
      ['heartbeat 74', 'hr', '74'],
      ['bpm 74', 'hr', '74'],
      ['دقات القلب مئة وعشرة', 'hr', '110'],
      ['نبضات القلب مئة وعشرة', 'hr', '110'],
      // SpO2
      ['sats ninety six', 'spo2', '96'],
      ['saturation ninety six', 'spo2', '96'],
      ['تشبع الأكسجين ستة وتسعين', 'spo2', '96'],
      // RR
      ['breathing rate eighteen', 'rr', '18'],
      ['breaths per minute eighteen', 'rr', '18'],
      // Temp
      ['سخونة سبعة وثلاثين', 'temperature', '37'],
      // GCS
      ['level of consciousness fifteen', 'gcs', '15'],
      ['مستوى الوعي خمسة عشر', 'gcs', '15'],
      // BP
      ['systolic one forty over ninety', 'bp_systolic', '140'],
      ['ضغط الدم مئة وأربعين على تسعين', 'bp_systolic', '140'],
    ];
    for (const [transcript, key, expected] of synonyms) {
      const fields = extractFieldsFromTranscript(transcript, createEmptySttFields());
      const { updates } = mapSttSessionToPatientUpdates(fields);
      const actual = updates[key];
      const ok = key === 'chief_complaint'
        ? typeof actual === 'string' && actual.toLowerCase().includes(String(expected).toLowerCase())
        : JSON.stringify(actual) === JSON.stringify(expected);
      assert(ok, `STT-22 [${key}]`, `synonym "${transcript}"`, `expected ${JSON.stringify(expected)} got ${JSON.stringify(actual)}`);
    }
  }

  // ── A label with no number must stay empty, not borrow one from nearby ────
  {
    const t = 'pulse is good, age is 74, the patient is complaining about neck pain';
    const fields = extractFieldsFromTranscript(t, createEmptySttFields());
    const { updates } = mapSttSessionToPatientUpdates(fields);
    assert(
      updates.hr == null || updates.hr === '',
      'STT-23',
      'a vitals label with no spoken number does not borrow the age',
      `hr=${JSON.stringify(updates.hr)}`,
    );
    assert(
      updates.age === '74',
      'STT-24',
      'the age itself is still captured alongside a value-less vitals mention',
      `age=${JSON.stringify(updates.age)}`,
    );
  }

  // ── Vitals must ACCUMULATE across successive extractions ──────────────────
  // The panel re-extracts the full transcript on every turn, passing the previous
  // fields in. All six vitals share one array-valued slot, so merging it with
  // scalar "higher confidence wins" semantics froze it at whatever the first
  // extraction found — parseVitals always returns 0.88, so 0.88 > 0.88 is never
  // true. One-shot extraction passed; the real incremental path captured only
  // the first vital spoken and every later one stayed red in the UI.
  {
    const turns = [
      'النبض مئة وعشرة',
      'النبض مئة وعشرة الضغط مئة وأربعين على تسعين',
      'النبض مئة وعشرة الضغط مئة وأربعين على تسعين الأكسجين ستة وتسعين',
      'النبض مئة وعشرة الضغط مئة وأربعين على تسعين الأكسجين ستة وتسعين معدل التنفس ثمانية عشر',
      'النبض مئة وعشرة الضغط مئة وأربعين على تسعين الأكسجين ستة وتسعين معدل التنفس ثمانية عشر الحرارة سبعة وثلاثين مستوى الوعي خمسة عشر',
    ];
    let fields = createEmptySttFields();
    for (const t of turns) fields = extractFieldsFromTranscript(t, fields);
    const { updates } = mapSttSessionToPatientUpdates(fields);

    const expected: Array<[string, string]> = [
      ['hr', '110'], ['bp_systolic', '140'], ['bp_diastolic', '90'],
      ['spo2', '96'], ['rr', '18'], ['temperature', '37'], ['gcs', '15'],
    ];
    for (const [key, want] of expected) {
      assert(
        String(updates[key]) === want,
        `STT-25 [${key}]`,
        'vitals accumulate across successive extractions',
        `expected ${want} got ${JSON.stringify(updates[key])}`,
      );
    }
  }

  // Same accumulation, dictated in English across turns.
  {
    const turns = [
      'heart rate one ten',
      'heart rate one ten blood pressure one forty over ninety',
      'heart rate one ten blood pressure one forty over ninety SpO2 ninety six',
      'heart rate one ten blood pressure one forty over ninety SpO2 ninety six respiratory rate eighteen temperature thirty seven GCS fifteen',
    ];
    let fields = createEmptySttFields();
    for (const t of turns) fields = extractFieldsFromTranscript(t, fields);
    const { updates } = mapSttSessionToPatientUpdates(fields);
    for (const [key, want] of [['hr', '110'], ['bp_systolic', '140'], ['spo2', '96'], ['rr', '18'], ['temperature', '37'], ['gcs', '15']] as Array<[string, string]>) {
      assert(
        String(updates[key]) === want,
        `STT-26 [${key}]`,
        'vitals accumulate across turns (English)',
        `expected ${want} got ${JSON.stringify(updates[key])}`,
      );
    }
  }

  // A later, corrected value for the same vital must replace the earlier one.
  {
    let fields = createEmptySttFields();
    fields = extractFieldsFromTranscript('heart rate one ten', fields);
    fields = extractFieldsFromTranscript('heart rate ninety', fields);
    const { updates } = mapSttSessionToPatientUpdates(fields);
    assert(
      String(updates.hr) === '90',
      'STT-27',
      'a restated vital overwrites the earlier value',
      `expected 90 got ${JSON.stringify(updates.hr)}`,
    );
  }

  // Medications share the same array-slot problem.
  {
    let fields = createEmptySttFields();
    fields = extractFieldsFromTranscript('patient takes aspirin', fields);
    fields = extractFieldsFromTranscript('patient takes aspirin and metformin', fields);
    const meds = (fields.current_medications.value || []) as string[];
    assert(
      meds.some((m) => /aspirin/i.test(m)) && meds.some((m) => /metformin/i.test(m)),
      'STT-28',
      'medications accumulate across successive extractions',
      JSON.stringify(meds),
    );
  }

  // ── Spellings clinicians and the transcriber actually produce ─────────────
  {
    const spellings: Array<[string, string, string]> = [
      // bare 'oxygen' — only 'oxygen saturation' was a label before
      ['oxygen ninety six', 'spo2', '96'],
      ['oxygen ستة وتسعين', 'spo2', '96'],
      ['oxygen level ninety six', 'spo2', '96'],
      ['نسبة الأكسجين ستة وتسعين', 'spo2', '96'],
      // the transcriber writes SpO2 with a digit zero about as often as the letter O
      ['SP02 ninety six', 'spo2', '96'],
      ['sp 02 ninety six', 'spo2', '96'],
      // acronyms dictated letter by letter come through spaced
      ['R R eighteen', 'rr', '18'],
      ['H R one ten', 'hr', '110'],
      ['G C S fifteen', 'gcs', '15'],
      ['B P one forty over ninety', 'bp_systolic', '140'],
      // clipped Arabic — STT commonly drops the trailing ة
      ['درجة الحرار سبعة وثلاثين', 'temperature', '37'],
      ['مستوي الوعي خمسة عشر', 'gcs', '15'],
    ];
    for (const [transcript, key, expected] of spellings) {
      const { updates } = mapSttSessionToPatientUpdates(
        extractFieldsFromTranscript(transcript, createEmptySttFields()),
      );
      assert(
        String(updates[key]) === expected,
        `STT-29 [${key}]`,
        `spelling "${transcript}"`,
        `expected ${expected} got ${JSON.stringify(updates[key])}`,
      );
    }
  }

  // ── A label must not bind to the NEXT vital's number ──────────────────────
  // 'heart rate, BP 140 over 90' has no heart rate in it. The gap between label
  // and number was loose enough to jump over an intervening label.
  {
    const { updates } = mapSttSessionToPatientUpdates(
      extractFieldsFromTranscript('heart rate, BP 140 over 90', createEmptySttFields()),
    );
    assert(
      updates.hr == null || updates.hr === '',
      'STT-31',
      'a label does not borrow the next vital\'s number',
      `hr=${JSON.stringify(updates.hr)}`,
    );
    assert(
      String(updates.bp_systolic) === '140',
      'STT-32',
      'the BP itself is still captured',
      `bp=${JSON.stringify(updates.bp_systolic)}`,
    );
  }

  // Mixed dictation where the Arabic label carries the value and an English
  // label follows it — the per-segment pass must not overwrite the good value.
  {
    const t = 'Patient Ahmed, عمره 55, chest pain, النبض 110 heart rate, BP 140 على 90, SpO2 96';
    const { updates } = mapSttSessionToPatientUpdates(
      extractFieldsFromTranscript(t, createEmptySttFields()),
    );
    assert(
      String(updates.hr) === '110',
      'STT-33',
      'segment pass does not overwrite a vital resolved from the full text',
      `hr=${JSON.stringify(updates.hr)}`,
    );
  }

  // ── 'oxygen' is also how flow rate is dictated — don't read litres as SpO2 ─
  {
    for (const t of ['patient on oxygen 15 liters', 'on oxygen 2 litres', 'أكسجين ٥ لتر']) {
      const { updates } = mapSttSessionToPatientUpdates(
        extractFieldsFromTranscript(t, createEmptySttFields()),
      );
      assert(
        updates.spo2 == null || updates.spo2 === '',
        'STT-30',
        `"${t}" is an oxygen flow rate, not a saturation`,
        `spo2=${JSON.stringify(updates.spo2)}`,
      );
    }
  }


  // ── Voice correction: last labeled vital in one utterance wins ────────────
  {
    const fields = extractFieldsFromTranscript(
      'respiratory rate 40, heart rate 88, respiratory rate twenty five',
      createEmptySttFields(),
    );
    const { updates } = mapSttSessionToPatientUpdates(fields);
    assert(
      String(updates.rr) === '25' && String(updates.hr) === '88',
      'STT-34',
      're-dictated RR replaces earlier RR (last labeled match wins)',
      JSON.stringify({ rr: updates.rr, hr: updates.hr }),
    );
  }

  // ── Voice correction across incremental chunks (RR) ───────────────────────
  {
    let fields = extractFieldsFromTranscript('respiratory rate 100', createEmptySttFields());
    fields = extractFieldsFromTranscript('respiratory rate twenty five', fields);
    const { updates } = mapSttSessionToPatientUpdates(fields);
    assert(
      String(updates.rr) === '25',
      'STT-35',
      'later chunk overwrites earlier RR at equal confidence',
      `rr=${updates.rr}`,
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
