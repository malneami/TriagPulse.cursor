import { Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Socket } from 'socket.io';
import { Role, canAccess } from '@triagepulse/clinical';
import { PrismaService } from '../prisma/prisma.module';

export interface SocketUser {
  id: string;
  email: string;
  full_name: string;
  role: string;
}

/**
 * Authenticates Socket.IO connections with the same JWT used by the REST API.
 * Gateways call `authenticate` in handleConnection; on failure the socket is
 * disconnected before any patient data is sent.
 */
@Injectable()
export class WsAuthService {
  private readonly logger = new Logger(WsAuthService.name);

  constructor(
    private jwt: JwtService,
    private prisma: PrismaService,
  ) {}

  private extractToken(client: Socket): string | null {
    const fromAuth = client.handshake.auth?.token;
    if (typeof fromAuth === 'string' && fromAuth.trim()) return fromAuth.trim();
    const header = client.handshake.headers?.authorization;
    if (typeof header === 'string' && header.startsWith('Bearer ')) return header.slice(7).trim();
    return null;
  }

  /**
   * Verifies the token, loads the user and checks the permission.
   * Returns the user, or the reason it was refused.
   */
  async verify(client: Socket, permission: string): Promise<SocketUser | { refused: string }> {
    const token = this.extractToken(client);
    if (!token) return { refused: 'missing_token' };

    let payload: { sub?: string };
    try {
      payload = await this.jwt.verifyAsync(token, { algorithms: ['HS256'] });
    } catch {
      return { refused: 'invalid_token' };
    }
    if (!payload?.sub) return { refused: 'invalid_token' };

    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user) return { refused: 'unknown_user' };
    if (!canAccess(user.role as Role, permission)) return { refused: 'forbidden' };

    return { id: user.id, email: user.email, full_name: user.fullName, role: user.role };
  }

  /**
   * Socket.IO middleware for a gateway's namespace. It runs during the
   * handshake, so an unauthenticated client never completes `connect` and
   * receives no events at all. Register it in the gateway's afterInit.
   */
  middleware(permission: string) {
    return async (client: Socket, next: (err?: Error) => void) => {
      try {
        const result = await this.verify(client, permission);
        if ('refused' in result) {
          this.logger.warn(`WebSocket refused (${result.refused}) on ${client.nsp?.name ?? '?'}`);
          return next(new Error('Unauthorized'));
        }
        client.data.user = result;
        return next();
      } catch {
        return next(new Error('Unauthorized'));
      }
    };
  }

  userOf(client: Socket): SocketUser | null {
    return (client.data?.user as SocketUser | undefined) ?? null;
  }
}
