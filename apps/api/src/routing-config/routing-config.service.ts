import { BadRequestException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import {
  DEFAULT_ROUTING_CONFIG,
  ROUTING_ENGINE_VERSION,
  resetRoutingConfigToBuiltin,
  setActiveRoutingConfig,
  setZoneStatus,
  validateRoutingConfig,
} from '@triagepulse/clinical';
import { PrismaService } from '../prisma/prisma.module';
import { AuditService } from '../audit/audit.service';

type Actor = { id: string; full_name?: string; email?: string };
type ZoneStatusMap = Record<string, Record<string, { busy: boolean; updated_at?: string }>>;

const FACILITY = 'default';

/**
 * Patient direction configuration: zones + direction rules per department, versioned
 * (publish / activate / roll back), plus the live "busy" switch per zone.
 * The CTAS core (resus for CTAS 1–2 and life threats, isolation, levels a zone accepts)
 * lives in the clinical package and cannot be changed here.
 */
@Injectable()
export class RoutingConfigService implements OnModuleInit {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  async onModuleInit() {
    try {
      await this.loadActiveIntoRuntime();
    } catch {
      // Tables not migrated yet: keep the built-in configuration.
      resetRoutingConfigToBuiltin();
    }
  }

  private async active() {
    return this.prisma.routingConfigPublish.findFirst({
      where: { facilityCode: FACILITY, isActive: true },
      orderBy: { publishedAt: 'desc' },
    });
  }

  async zoneStatus(): Promise<ZoneStatusMap> {
    const rows = await this.prisma.zoneStatus.findMany({ where: { facilityCode: FACILITY } });
    const map: ZoneStatusMap = {};
    for (const r of rows) {
      map[r.departmentCode] = map[r.departmentCode] || {};
      map[r.departmentCode][r.zoneCode] = { busy: r.busy, updated_at: r.updatedAt.toISOString() };
    }
    return map;
  }

  async loadActiveIntoRuntime() {
    const active = await this.active();
    if (active) setActiveRoutingConfig(active.config as object);
    else resetRoutingConfigToBuiltin();
    setZoneStatus(await this.zoneStatus());
  }

  async getCurrent() {
    const active = await this.active();
    return {
      source: active ? 'published' : 'builtin',
      id: active?.id ?? null,
      version: active?.version ?? DEFAULT_ROUTING_CONFIG.version,
      published_at: active?.publishedAt?.toISOString() ?? null,
      engine_version: ROUTING_ENGINE_VERSION,
      config: active ? active.config : DEFAULT_ROUTING_CONFIG,
      builtin: DEFAULT_ROUTING_CONFIG,
      zone_status: await this.zoneStatus(),
    };
  }

  async listHistory(limit = 30) {
    return this.prisma.routingConfigPublish.findMany({
      where: { facilityCode: FACILITY },
      orderBy: { publishedAt: 'desc' },
      take: limit,
      select: {
        id: true, version: true, isActive: true, changelog: true, publishedAt: true,
        publishedBy: { select: { fullName: true, email: true } },
      },
    });
  }

  async publish(body: { config: Record<string, unknown>; changelog?: string }, user: Actor) {
    const errors = validateRoutingConfig(body?.config);
    if (errors.length) {
      throw new BadRequestException({ message: 'Routing configuration is not valid', errors });
    }
    const version = `r${new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '')}`;
    const config = { ...body.config, version };
    const created = await this.prisma.$transaction(async (tx) => {
      await tx.routingConfigPublish.updateMany({ where: { facilityCode: FACILITY, isActive: true }, data: { isActive: false } });
      return tx.routingConfigPublish.create({
        data: {
          facilityCode: FACILITY,
          version,
          isActive: true,
          config: config as object,
          changelog: body.changelog || null,
          publishedById: user.id,
        },
      });
    });
    setActiveRoutingConfig(config);
    await this.audit.log('RoutingConfigPublish', created.id, 'routing_config_published', user, {
      version, changelog: body.changelog || null,
    });
    return { id: created.id, version };
  }

  async activate(id: string, user: Actor) {
    const row = await this.prisma.routingConfigPublish.findUnique({ where: { id } });
    if (!row || row.facilityCode !== FACILITY) throw new NotFoundException('Routing version not found');
    await this.prisma.$transaction(async (tx) => {
      await tx.routingConfigPublish.updateMany({ where: { facilityCode: FACILITY, isActive: true }, data: { isActive: false } });
      await tx.routingConfigPublish.update({ where: { id }, data: { isActive: true } });
    });
    setActiveRoutingConfig(row.config as object);
    await this.audit.log('RoutingConfigPublish', id, 'routing_config_activated', user, { version: row.version });
    return { id, version: row.version };
  }

  async useBuiltin(user: Actor) {
    await this.prisma.routingConfigPublish.updateMany({ where: { facilityCode: FACILITY, isActive: true }, data: { isActive: false } });
    resetRoutingConfigToBuiltin();
    await this.audit.log('RoutingConfigPublish', 'builtin', 'routing_config_builtin', user, {});
    return { version: DEFAULT_ROUTING_CONFIG.version };
  }

  async setBusy(body: { department: string; zone: string; busy: boolean }, user: Actor) {
    if (!body?.department || !body?.zone) throw new BadRequestException('department and zone are required');
    await this.prisma.zoneStatus.upsert({
      where: { facilityCode_departmentCode_zoneCode: { facilityCode: FACILITY, departmentCode: body.department, zoneCode: body.zone } },
      update: { busy: !!body.busy, updatedById: user.id },
      create: { facilityCode: FACILITY, departmentCode: body.department, zoneCode: body.zone, busy: !!body.busy, updatedById: user.id },
    });
    const status = await this.zoneStatus();
    setZoneStatus(status);
    await this.audit.log('ZoneStatus', `${body.department}/${body.zone}`, 'zone_busy_changed', user, { busy: !!body.busy });
    return status;
  }
}
