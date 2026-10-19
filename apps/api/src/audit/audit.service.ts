import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.module';
import { createAuditEvent, stripIdentifiers } from '@triagepulse/clinical';

@Injectable()
export class AuditService {
  constructor(private prisma: PrismaService) {}

  async log(
    entityType: string,
    entityId: string,
    action: string,
    actor: { id: string; full_name?: string; email?: string },
    payload?: Record<string, unknown>,
  ) {
    // The audit log never holds patient identifiers (PDPL); staff identity is kept.
    const event = createAuditEvent(action, actor, payload ? stripIdentifiers(payload) : payload);
    return this.prisma.auditEvent.create({
      data: {
        entityType,
        entityId,
        action,
        actorId: actor.id,
        payload: event as object,
      },
    });
  }
}
