import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
} from '@nestjs/websockets';
import { Namespace, Server, Socket } from 'socket.io';
import { SttService } from './stt.service';
import { SttRealtimeService } from './stt-realtime.service';
import { WsAuthService } from '../auth/ws-auth.service';

/**
 * Live speech-to-text channel.
 *
 * Security model:
 * - Every connection must present a valid JWT (handshake `auth.token`) for a
 *   user with `perform_triage`. The check runs as handshake middleware, so a
 *   refused client never connects and never receives an event.
 * - A socket may only join, stream to, or stop a session it created
 *   (SttService.isOwner). Rooms are therefore private to the session owner.
 */
@WebSocketGateway({
  cors: { origin: process.env.CORS_ORIGIN || 'http://localhost:5174' },
  namespace: '/stt',
  maxHttpBufferSize: 5e6,
})
export class SttGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private clientSessions = new Map<string, string>();

  constructor(
    private sttService: SttService,
    private realtimeService: SttRealtimeService,
    private wsAuth: WsAuthService,
  ) {}

  afterInit(namespace: Namespace) {
    namespace.use(this.wsAuth.middleware('perform_triage'));
  }

  handleConnection(client: Socket) {
    client.emit('stt_ready', {
      model_version: this.sttService.resolveModelVersion(),
      realtime: this.realtimeService.isConfigured(),
      realtime_model: this.realtimeService.resolveRealtimeModel(),
      realtime_intent: 'transcription',
    });
  }

  async handleDisconnect(client: Socket) {
    const sessionId = this.clientSessions.get(client.id);
    if (sessionId) {
      await this.realtimeService.stopSession(sessionId);
      this.clientSessions.delete(client.id);
    }
  }

  /** Returns true when the socket's user owns the session; emits an error otherwise. */
  private ownsSession(client: Socket, sessionId: string | undefined): sessionId is string {
    const user = this.wsAuth.userOf(client);
    if (user && this.sttService.isOwner(sessionId, user.id)) return true;
    client.emit('stt_error', { message: 'Session not found' });
    return false;
  }

  private bind(client: Socket, sessionId: string) {
    client.join(sessionId);
    this.clientSessions.set(client.id, sessionId);
  }

  @SubscribeMessage('join_session')
  handleJoin(@ConnectedSocket() client: Socket, @MessageBody() data: { sessionId: string }) {
    if (!this.ownsSession(client, data?.sessionId)) return;
    this.bind(client, data.sessionId);
    client.emit('session_joined', { sessionId: data.sessionId });
  }

  @SubscribeMessage('realtime_start')
  async handleRealtimeStart(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { sessionId: string },
  ) {
    if (!this.ownsSession(client, data?.sessionId)) return;
    this.bind(client, data.sessionId);
    try {
      await this.realtimeService.startSession(data.sessionId, (event, payload) => {
        this.server.to(data.sessionId).emit(event, payload);
        if (event === 'stt_error') client.emit(event, payload);
      });
      client.emit('realtime_ack', { ok: true, sessionId: data.sessionId });
    } catch {
      const message = 'Failed to start live transcription';
      client.emit('stt_error', { message, realtime: true });
      client.emit('realtime_ack', { ok: false, sessionId: data.sessionId, message });
    }
  }

  @SubscribeMessage('pcm_chunk')
  handlePcmChunk(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { sessionId: string; audioBase64?: string; audio?: string },
  ) {
    const audio = data?.audioBase64 || data?.audio;
    if (!audio || !this.ownsSession(client, data?.sessionId)) return;
    this.realtimeService.appendPcm(data.sessionId, audio);
    client.emit('pcm_ack', { ok: true, bytes: audio.length });
  }

  @SubscribeMessage('realtime_stop')
  async handleRealtimeStop(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { sessionId: string },
  ) {
    if (!this.ownsSession(client, data?.sessionId)) return;
    await this.realtimeService.stopSession(data.sessionId);
    client.emit('realtime_stopped', { sessionId: data.sessionId });
  }

  @SubscribeMessage('transcript_chunk')
  async handleTranscript(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { sessionId: string; text: string; isFinal?: boolean },
  ) {
    if (!data?.text || !this.ownsSession(client, data?.sessionId)) return;
    const output = data.isFinal
      ? await this.sttService.appendTranscriptAsync(data.sessionId, data.text, true)
      : this.sttService.appendTranscript(data.sessionId, data.text, false);
    this.server.to(data.sessionId).emit('extraction_update', output);
    client.emit('transcript_ack', { isFinal: !!data.isFinal, length: output.full_transcript.length });
  }

  @SubscribeMessage('audio_chunk')
  async handleAudio(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: {
      sessionId: string;
      audioBase64: string;
      mimeType?: string;
      languageHint?: 'en' | 'ar' | 'mixed';
    },
  ) {
    if (!data?.audioBase64 || !this.ownsSession(client, data?.sessionId)) return;
    try {
      const result = await this.sttService.transcribeAudio(
        data.audioBase64,
        data.mimeType || 'audio/webm',
        data.languageHint,
      );
      if (result.text) {
        const output = await this.sttService.appendTranscriptAsync(data.sessionId, result.text, true);
        this.server.to(data.sessionId).emit('transcript_final', { text: result.text, confidence: result.confidence });
        this.server.to(data.sessionId).emit('extraction_update', output);
      }
      client.emit('audio_ack', { ok: true });
    } catch {
      client.emit('stt_error', { message: 'Transcription failed' });
    }
  }
}
