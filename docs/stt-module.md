# Medical Voice-to-Text (STT) Triage Module

Production STT + live field extraction for TriagePulse CTAS intake (HMG / Riyadh ED context).

## Architecture

```mermaid
flowchart LR
  subgraph client [Browser — PHI in session]
    Mic[PCM 24kHz streamer]
    Panel[VoiceTriagePanel]
    Form[Triage.jsx manual form]
  end
  subgraph api [NestJS API — in-Kingdom deploy]
    SIO["/stt Socket.IO"]
    RT[SttRealtimeService proxy]
    REST["/stt/* REST"]
    Extract[Clinical extractFields]
    OAI[OpenAI Realtime transcription]
  end
  Mic --> Panel
  Panel -->|pcm_chunk| SIO
  SIO --> RT --> OAI
  OAI -->|partial/final| SIO --> Panel
  Panel -->|full transcript extract| REST --> Extract
  Extract --> Panel
  Panel -->|real-time auto-fill| Form
```

**Primary path:** OpenAI Realtime transcription (`gpt-live-transcribe`) proxied server-side. The session is configured with `languages: ['ar','en']`, a bilingual bias prompt, and the full AR/EN clinical keyword list — that combination is what makes code-switching work. `turn_detection` is **negotiated at runtime**: the proxy asks for `server_vad` and falls back to manual commits if OpenAI rejects it. The browser never holds `OPENAI_API_KEY`.

The proxy only treats a session as ready once OpenAI acknowledges `session.update`. If it never does, the session now fails loudly instead of transcribing on OpenAI defaults with no language hints — set `OPENAI_REALTIME_STRICT=false` to restore the old permissive behaviour.

Manual commits are cut at a **speech pause** (server-side RMS gate over the PCM already being decoded), not on a fixed clock. A fixed 1.2s chop closed the input item mid-sentence, and since the model re-decides language per item, an Arabic→English switch inside one utterance was split and each half detected independently.

**Fallback:** REST `/audio/transcriptions` with `gpt-transcribe` on 5s segments. Each segment is a complete media container produced by a full `stop()`/`start()` cycle — never a `timeslice` fragment, since only the first such fragment carries the container header.

**Browser Web Speech is a last resort only.** It accepts a single `lang`, so it cannot code-switch; running it alongside OpenAI produced a doubled, garbled transcript. It is now reachable only when `GET /stt/status` reports no API key.

**PHI residency:** Mic audio streams through your API to OpenAI for transcription. Configure `OPENAI_API_KEY` only on PDPL-approved endpoints with a signed DPA. Without a key, the module falls back to browser speech + manual text — triage is never blocked. Note that browser Web Speech sends audio to the *browser vendor*, not to OpenAI.

## Components

| Layer | Path | Role |
|-------|------|------|
| Clinical extraction | `packages/clinical/src/stt/` | Bilingual rule/NER hybrid, JSON contract, SNOMED/ICD hints |
| API | `apps/api/src/stt/` | Sessions, Realtime proxy, REST batch STT, hybrid extract |
| Web capture | `apps/web/src/lib/stt/` | PCM streamer, browser STT fallback, MediaRecorder batch |
| UI | `apps/web/src/components/triage/VoiceTriagePanel.jsx` | Live transcript + field cards + completeness |
| Vocabulary | `CLINICAL_STT_VOCABULARY` in `packages/clinical/src/stt/vocabulary.ts` | Biasing terms for ASR — the single source of truth for both the realtime and batch paths |
| WER harness | `scripts/stt-wer-harness.mjs` | Labeled sample validation, incl. code-switch cases |
| Realtime probe | `scripts/stt-realtime-probe.mjs` | Shows what OpenAI actually accepts/echoes for the session config |

## Setup

```bash
cp .env.example .env
# Optional — server-side STT (PDPL-approved endpoint only).
# Every value below is the built-in default; set them only to override.
# OPENAI_API_KEY=sk-...
# OPENAI_STT_MODEL=gpt-transcribe               # batch; supports languages[] + keywords[]
# OPENAI_STT_MODEL_FAST=gpt-4o-transcribe       # second rung of the batch ladder
# OPENAI_WHISPER_MODEL=                         # unset: whisper-1 is monolingual and
#                                               # transliterates the minority language
# OPENAI_REALTIME_TRANSCRIBE_MODEL=gpt-live-transcribe
# OPENAI_REALTIME_DELAY=high                    # higher delay = better language-switch accuracy
# OPENAI_REALTIME_VAD=auto                      # auto | server_vad | off
# OPENAI_REALTIME_COMMIT_MS=4000                # min segment length (manual commit path)
# OPENAI_REALTIME_SILENCE_MS=600                # pause required before committing
# OPENAI_REALTIME_MAX_SEGMENT_MS=12000          # hard cap for a monologue
# OPENAI_REALTIME_FLUSH_MS=2500                 # wait for the final transcript before close
# OPENAI_REALTIME_STRICT=true                   # fail if session.update is not acknowledged

npm run build --workspace=@triagepulse/clinical
npm run dev
```

Open `/triage`, tap **Start**, speak in English, Arabic, or mixed. Live transcript deltas appear within ~1s when Realtime is configured. Fields auto-fill as they are extracted (clinician review required before Confirm Triage).

On page load the panel calls `GET /api/stt/status`. If `realtime: true`, the badge shows **OpenAI Realtime (live)**. Otherwise browser + batch fallback is used.

## API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/stt/status` | `{ configured, model, reachable, realtime, realtime_model, lastError? }` |
| POST | `/api/stt/session` | Create session (JWT + `perform_triage`) |
| POST | `/api/stt/extract` | Extract fields from transcript text |
| POST | `/api/stt/transcribe` | Batch transcribe base64 audio (fallback) |
| POST | `/api/stt/field` | Manual field override |
| WS | `/stt` | `realtime_start`, `pcm_chunk`, `realtime_stop`, `transcript_partial`, `transcript_final`, `extraction_update` |

## Output contract

See `packages/clinical/src/stt/types.ts` — matches BUILD PROMPT JSON (`session_id`, `fields`, `completeness`, `coded`, `low_confidence_spans`, etc.).

## Overwrite rule

Auto-fill updates a patient field only when the new STT confidence exceeds the last auto-fill confidence, or the field is empty. Manual nurse edits are tracked per field and are never overwritten unless **Re-sync now** is used.

CTAS completeness uses **10 required fields** (name, age, complaint, pain, HR, BP, SpO₂, RR, temp, GCS). Confirm Triage unlocks at 10/10.

## Testing

```bash
npm run build --workspace=@triagepulse/clinical
node scripts/stt-wer-harness.mjs
curl http://localhost:3001/api/stt/status   # requires JWT in prod; check configured/reachable/realtime
```

Restart API after `.env` changes: `npm run dev:api` (or `npm run dev` for both web + API).

## Safety

- Acuity (`acuity_proposed`) is **suggested only** — CTAS level requires clinician confirmation via existing `CTASValidation`.
- Low-confidence spans are flagged in the UI.
- All sessions are audit-logged (`stt_session_started`, `stt_transcribe_chunk`).
- No spoken GPT assistant / TTS — transcription-only for clinical dictation.

## Stack choice

NestJS + shared clinical package (not Python FastAPI) to keep one deployable unit with existing auth, Prisma audit trail, and CTAS engine. OpenAI Realtime is the primary streaming path; REST batch STT remains the fallback.
