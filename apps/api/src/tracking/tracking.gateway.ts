import {
  WebSocketGateway, WebSocketServer, OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit,
} from '@nestjs/websockets';
import { Namespace, Socket } from 'socket.io';
import { TrackingService } from './tracking.service';
import { WsAuthService } from '../auth/ws-auth.service';

/**
 * Live tracking board.
 *
 * Only authenticated users with `perform_triage` can connect (handshake
 * middleware). Each client receives the board as seen by its own user,
 * never an admin-scoped board, and nothing is broadcast to unauthenticated
 * sockets because they never connect.
 */
@WebSocketGateway({
  cors: { origin: process.env.CORS_ORIGIN || 'http://localhost:5174' },
  namespace: '/tracking',
})
export class TrackingGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Namespace;

  private interval: NodeJS.Timeout | null = null;

  constructor(
    private trackingService: TrackingService,
    private wsAuth: WsAuthService,
  ) {}

  afterInit(namespace: Namespace) {
    namespace.use(this.wsAuth.middleware('perform_triage'));
  }

  handleConnection(client: Socket) {
    if (!this.interval) {
      this.interval = setInterval(() => this.broadcast(), 15000);
    }
    void this.sendToClient(client);
  }

  handleDisconnect() {
    if (this.server.sockets.size === 0 && this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  async broadcast() {
    for (const client of this.server.sockets.values()) {
      await this.sendToClient(client);
    }
  }

  private async sendToClient(client: Socket) {
    const user = this.wsAuth.userOf(client);
    if (!user) {
      client.disconnect(true);
      return;
    }
    const board = await this.trackingService.getBoard({ id: user.id, role: user.role });
    client.emit('board_update', board);
  }
}
