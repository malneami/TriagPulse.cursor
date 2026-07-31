import {
  Body, Controller, Get, Post, Request, UseGuards,
  BadRequestException, ServiceUnavailableException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { IsBoolean, IsObject, IsOptional, IsString, IsUUID } from 'class-validator';
import { SttService } from './stt.service';
import { RolesGuard, RequirePermission } from '../auth/roles.guard';
import { AuditService } from '../audit/audit.service';
import type { SttFieldKey } from '@triagepulse/clinical';

class CreateSessionDto {
  @IsOptional() @IsString() journeyId?: string;
}

class ExtractDto {
  @IsUUID() sessionId: string;
  @IsString() transcript: string;
  @IsOptional() @IsBoolean() isFinal?: boolean;
  @IsOptional() @IsBoolean() forceLlm?: boolean;
}

class TranscribeDto {
  @IsOptional() @IsUUID() sessionId?: string;
  @IsString() audioBase64: string;
  @IsOptional() @IsString() mimeType?: string;
  @IsOptional() @IsString() languageHint?: 'en' | 'ar' | 'mixed';
}

class UpdateFieldDto {
  @IsUUID() sessionId: string;
  @IsString() fieldKey: string;
  @IsObject() value: unknown;
}

@Controller('stt')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class SttController {
  constructor(
    private sttService: SttService,
    private auditService: AuditService,
  ) {}

  @Get('status')
  @RequirePermission('perform_triage')
  status() {
    return this.sttService.getStatus();
  }

  @Post('session')
  @RequirePermission('perform_triage')
  async createSession(
    @Body() dto: CreateSessionDto,
    @Request() req: { user: { id: string; full_name?: string; email?: string } },
  ) {
    const { sessionId } = this.sttService.createSession(req.user.id);
    await this.auditService.log('stt_session', sessionId, 'stt_session_started', req.user, {
      journey_id: dto.journeyId || null,
      model_version: this.sttService.resolveModelVersion(),
    });
    return { sessionId };
  }

  @Post('extract')
  @RequirePermission('perform_triage')
  async extract(@Body() dto: ExtractDto) {
    if (dto.isFinal) {
      return this.sttService.extractFromTranscript(dto.sessionId, dto.transcript, true, !!dto.forceLlm);
    }
    return this.sttService.extractFromTranscript(dto.sessionId, dto.transcript, false, !!dto.forceLlm);
  }

  @Post('transcribe')
  @RequirePermission('perform_triage')
  async transcribe(
    @Body() dto: TranscribeDto,
    @Request() req: { user: { id: string; full_name?: string; email?: string } },
  ) {
    // A missing server key is not a bad request. Returning 400 made a deployment
    // misconfiguration look like a client bug and hid it from the clinician.
    if (!this.sttService.isConfigured()) {
      throw new ServiceUnavailableException(
        'Server-side STT is not configured (OPENAI_API_KEY missing) — using browser speech + manual entry',
      );
    }
    try {
      const result = await this.sttService.transcribeAudio(
        dto.audioBase64,
        dto.mimeType || 'audio/webm',
        dto.languageHint,
      );
      if (dto.sessionId && result.text) {
        const sessionOutput = await this.sttService.appendTranscriptAsync(dto.sessionId, result.text, true);
        await this.auditService.log('stt_session', dto.sessionId, 'stt_transcribe_chunk', req.user, {
          chars: result.text.length,
          confidence: result.confidence,
        });
        return { ...result, session: sessionOutput };
      }
      return result;
    } catch (err) {
      throw new BadRequestException((err as Error).message || 'Transcription failed');
    }
  }

  @Post('field')
  @RequirePermission('perform_triage')
  updateField(@Body() dto: UpdateFieldDto) {
    return this.sttService.updateField(dto.sessionId, dto.fieldKey as SttFieldKey, dto.value);
  }
}
