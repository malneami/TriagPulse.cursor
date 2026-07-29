import {
  WebSocketGateway, WebSocketServer, OnGatewayConnection, OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { TrackingService } from './tracking.service';

@WebSocketGateway({ cors: { origin: process.env.CORS_ORIGIN || 'http://localhost:5173' }, namespace: '/tracking' })
export class TrackingGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private interval: NodeJS.Timeout | null = null;

  constructor(private trackingService: TrackingService) {}

  handleConnection(client: Socket) {
    if (!this.interval) {
      this.interval = setInterval(() => this.broadcast(), 15000);
    }
    this.sendToClient(client);
  }

  handleDisconnect() {
    if (this.server.sockets.sockets.size === 0 && this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  async broadcast() {
    const board = await this.trackingService.getBoard({ id: '', role: 'admin' });
    this.server.emit('board_update', board);
  }

  private async sendToClient(client: Socket) {
    const board = await this.trackingService.getBoard({ id: '', role: 'admin' });
    client.emit('board_update', board);
  }
}
