import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  buildSttSessionOutput,
  createEmptySttFields,
  extractFieldsFromTranscript,
  mergeLlmExtractIntoFields,
  mapSttSessionToPatientUpdates,
  computeCtasCompleteness,
  analyzeTranscriptCompleteness,
  resolveSttPrompt,
  conservativeTranscriptCleanup,
  buildLlmExtractPrompt,
  normalizeLlmExtractResult,
  LLM_CTAS_JSON_SCHEMA,
  type SttFieldKey,
  type SttFieldSlot,
  type SttSessionOutput,
  type CtasFieldKey,
} from '@triagepulse/clinical';

interface SessionState {
  id: string;
  userId: string;
  transcript: string;
  fields: Record<SttFieldKey, SttFieldSlot>;
  createdAt: string;
  modelVersion: string;
  lastCtasCaptured: number;
  stagnantExtractCount: number;
}

function ctasFieldsFromPatientUpdates(updates: Record<string, unknown>) {
  return computeCtasCompleteness(updates);
}

function hasLowCtasConfidence(fields: Record<SttFieldKey, SttFieldSlot>): boolean {
  const { updates, fieldConfidence } = mapSttSessionToPatientUpdates(fields);
  const keys = ['patient_name_ar', 'patient_name_en', 'age', 'chief_complaint', 'pain_score', 'hr', 'bp_systolic', 'spo2', 'rr', 'temperature', 'gcs'];
  for (const k of keys) {
    if (updates[k] != null && updates[k] !== '' && (fieldConfidence[k] ?? 1) < 0.75) return true;
  }
  return Object.values(fields).some((f) => f.confidence > 0 && f.confidence < 0.75 && f.value != null);
}

@Injectable()
export class SttService {
  private sessions = new Map<string, SessionState>();
  private lastOpenAiError: string | null = null;

  createSession(userId: string): { sessionId: string } {
    const id = randomUUID();
    this.sessions.set(id, {
      id,
      userId,
      transcript: '',
      fields: createEmptySttFields(),
      createdAt: new Date().toISOString(),
      modelVersion: this.resolveModelVersion(),
      lastCtasCaptured: 0,
      stagnantExtractCount: 0,
    });
    return { sessionId: id };
  }

  getSession(sessionId: string): SessionState | undefined {
    return this.sessions.get(sessionId);
  }

  extractFieldsHybrid(
    sessionId: string,
    transcript: string,
    isFinal = false,
  ): SttSessionOutput {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error('Session not found');

    session.transcript = conservativeTranscriptCleanup(transcript);
    session.fields = extractFieldsFromTranscript(session.transcript, session.fields);

    const { updates } = mapSttSessionToPatientUpdates(session.fields);
    const ctas = ctasFieldsFromPatientUpdates(updates);
    session.lastCtasCaptured = ctas.captured;

    const patientUpdates = mapSttSessionToPatientUpdates(session.fields).updates;
    const transcript_analysis = analyzeTranscriptCompleteness(session.transcript, patientUpdates);

    return buildSttSessionOutput(session.id, session.transcript, session.fields, session.modelVersion, {
      extraction_method: 'rules',
      llm_used: false,
      transcript_analysis,
    });
  }

  async extractFieldsHybridAsync(
    sessionId: string,
    transcript: string,
    isFinal = false,
    forceLlm = false,
  ): Promise<SttSessionOutput> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error('Session not found');

    session.transcript = conservativeTranscriptCleanup(transcript);
    session.fields = extractFieldsFromTranscript(session.transcript, session.fields);

    const { updates } = mapSttSessionToPatientUpdates(session.fields);
    const ctas = ctasFieldsFromPatientUpdates(updates);

    if (session.transcript.length > 40 && ctas.captured === session.lastCtasCaptured) {
      session.stagnantExtractCount += 1;
    } else {
      session.stagnantExtractCount = 0;
    }
    session.lastCtasCaptured = ctas.captured;

    const shouldLlm = forceLlm
      || (isFinal && !ctas.isComplete)
      || hasLowCtasConfidence(session.fields)
      || session.stagnantExtractCount >= 2;

    let llmUsed = false;
    if (shouldLlm) {
      const llmResult = await this.callLlmExtract(session.transcript, ctas.missing as CtasFieldKey[]);
      if (llmResult) {
        session.fields = mergeLlmExtractIntoFields(session.fields, llmResult);
        llmUsed = true;
        session.stagnantExtractCount = 0;
      }
    }

    const patientUpdates = mapSttSessionToPatientUpdates(session.fields).updates;
    const transcript_analysis = analyzeTranscriptCompleteness(session.transcript, patientUpdates);

    return buildSttSessionOutput(session.id, session.transcript, session.fields, session.modelVersion, {
      extraction_method: llmUsed ? 'hybrid' : 'rules',
      llm_used: llmUsed,
      transcript_analysis,
    });
  }

  async callLlmExtract(transcript: string, missingFields: CtasFieldKey[]) {
    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) return null;

    const model = process.env.OPENAI_EXTRACTION_MODEL || 'gpt-4o';
    const prompt = buildLlmExtractPrompt(transcript, missingFields);

    try {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: 'Return only valid JSON matching the schema. Clinical decision support only.' },
            { role: 'user', content: prompt },
          ],
          response_format: {
            type: 'json_schema',
            json_schema: { name: 'ctas_extract', strict: true, schema: LLM_CTAS_JSON_SCHEMA },
          },
          temperature: 0.1,
        }),
      });

      if (!res.ok) {
        this.lastOpenAiError = `LLM extract ${res.status}: ${(await res.text()).slice(0, 120)}`;
        return null;
      }

      const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
      const content = data.choices?.[0]?.message?.content;
      if (!content) return null;
      return normalizeLlmExtractResult(JSON.parse(content));
    } catch (err) {
      this.lastOpenAiError = (err as Error).message;
      return null;
    }
  }

  appendTranscript(sessionId: string, chunk: string, isFinal = false): SttSessionOutput {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error('Session not found');

    const cleaned = conservativeTranscriptCleanup(chunk);
    if (cleaned) {
      session.transcript = session.transcript
        ? `${session.transcript} ${cleaned}`.trim()
        : cleaned;
    }
    return this.extractFieldsHybrid(sessionId, session.transcript, isFinal);
  }

  async appendTranscriptAsync(sessionId: string, chunk: string, isFinal = false): Promise<SttSessionOutput> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error('Session not found');
    const cleaned = conservativeTranscriptCleanup(chunk);
    if (cleaned) {
      session.transcript = session.transcript
        ? `${session.transcript} ${cleaned}`.trim()
        : cleaned;
    }
    return this.extractFieldsHybridAsync(sessionId, session.transcript, isFinal, false);
  }

  async extractFromTranscript(sessionId: string, transcript: string, isFinal = false, forceLlm = false): Promise<SttSessionOutput> {
    return this.extractFieldsHybridAsync(sessionId, transcript, isFinal, forceLlm);
  }

  updateField(
    sessionId: string,
    fieldKey: SttFieldKey,
    value: unknown,
  ): SttSessionOutput {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error('Session not found');
    session.fields[fieldKey] = {
      value: value as never,
      confidence: 1,
      source_span: 'manual edit',
      edited_by_user: true,
    };
    const patientUpdates = mapSttSessionToPatientUpdates(session.fields).updates;
    const transcript_analysis = analyzeTranscriptCompleteness(session.transcript, patientUpdates);
    return buildSttSessionOutput(session.id, session.transcript, session.fields, session.modelVersion, {
      transcript_analysis,
    });
  }

  async getStatus(): Promise<{
    configured: boolean;
    model: string;
    reachable: boolean;
    realtime: boolean;
    realtime_model: string;
    lastError?: string;
  }> {
    const apiKey = process.env.OPENAI_API_KEY?.trim();
    const model = process.env.OPENAI_STT_MODEL || 'gpt-4o-mini-transcribe';
    const realtime_model = process.env.OPENAI_REALTIME_TRANSCRIBE_MODEL || 'gpt-live-transcribe';
    if (!apiKey) {
      return {
        configured: false,
        model,
        reachable: false,
        realtime: false,
        realtime_model,
        lastError: 'OPENAI_API_KEY not set',
      };
    }
    try {
      const res = await fetch('https://api.openai.com/v1/models', {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!res.ok) {
        const err = await res.text();
        this.lastOpenAiError = `OpenAI ${res.status}: ${err.slice(0, 120)}`;
        return {
          configured: true,
          model,
          reachable: false,
          realtime: false,
          realtime_model,
          lastError: this.lastOpenAiError,
        };
      }
      this.lastOpenAiError = null;
      return {
        configured: true,
        model,
        reachable: true,
        realtime: true,
        realtime_model,
      };
    } catch (err) {
      this.lastOpenAiError = (err as Error).message;
      return {
        configured: true,
        model,
        reachable: false,
        realtime: false,
        realtime_model,
        lastError: this.lastOpenAiError,
      };
    }
  }

  async transcribeAudio(
    audioBase64: string,
    mimeType = 'audio/webm',
    languageHint?: 'en' | 'ar' | 'mixed',
  ): Promise<{ text: string; confidence: number; language: string }> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('STT service unavailable — configure OPENAI_API_KEY or use browser speech fallback');
    }

    const buffer = Buffer.from(audioBase64.replace(/^data:[^;]+;base64,/, ''), 'base64');
    const MIN_BYTES = 800;
    if (buffer.length < MIN_BYTES) {
      return { text: '', confidence: 0, language: languageHint || 'mixed' };
    }

    const prompt = resolveSttPrompt(languageHint || 'mixed');
    const ext = mimeType.includes('wav') ? 'wav' : mimeType.includes('mp4') ? 'mp4' : 'webm';
    const models = [
      process.env.OPENAI_STT_MODEL || 'gpt-4o-mini-transcribe',
      process.env.OPENAI_STT_MODEL_FAST || 'gpt-4o-mini-transcribe',
      process.env.OPENAI_WHISPER_MODEL || 'whisper-1',
    ].filter((m, i, arr) => m && arr.indexOf(m) === i);

    let lastError = 'Transcription failed';
    for (const model of models) {
      const blob = new Blob([buffer], { type: mimeType });
      const form = new FormData();
      form.append('file', blob, `chunk.${ext}`);
      form.append('model', model);
      form.append('response_format', 'json');
      if (prompt) form.append('prompt', prompt.slice(0, 500));

      const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
      });

      if (res.ok) {
        const data = (await res.json()) as { text?: string };
        const text = conservativeTranscriptCleanup(data.text || '');
        this.lastOpenAiError = null;
        return { text, confidence: text ? 0.88 : 0, language: languageHint || 'mixed' };
      }

      const err = await res.text();
      lastError = `STT provider error (${model}): ${res.status} ${err.slice(0, 200)}`;
      this.lastOpenAiError = lastError;
      if (res.status !== 400) break;
    }

    throw new Error(lastError);
  }

  resolveModelVersion(): string {
    const stt = process.env.OPENAI_STT_MODEL || 'browser-fallback';
    return `triagepulse-stt/${stt}`;
  }
}
