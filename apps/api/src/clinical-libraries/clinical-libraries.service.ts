import { Injectable, OnModuleInit, NotFoundException, BadRequestException } from '@nestjs/common';
import {
  applyClinicalLibraryBundle,
  buildBuiltinClinicalBundle,
  getCurrentClinicalBundle,
  getLibraryVersions,
  resetClinicalLibrariesToBuiltin,
  type RedFlagLibrary,
  type SerializableModifier,
} from '@triagepulse/clinical';
import { PrismaService } from '../prisma/prisma.module';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class ClinicalLibrariesService implements OnModuleInit {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  async onModuleInit() {
    await this.loadActiveIntoRuntime();
  }

  async loadActiveIntoRuntime() {
    const active = await this.prisma.clinicalLibraryPublish.findFirst({
      where: { isActive: true },
      orderBy: { publishedAt: 'desc' },
    });
    if (!active) {
      resetClinicalLibrariesToBuiltin();
      return { source: 'builtin' as const, versions: getLibraryVersions() };
    }
    applyClinicalLibraryBundle({
      version: active.version,
      modifiers: active.modifiers as unknown as SerializableModifier[],
      modifiers_version: active.modifiersVersion,
      red_flags: active.redFlags as unknown as RedFlagLibrary,
      published_at: active.publishedAt.toISOString(),
      published_by: active.publishedById,
    });
    return { source: 'published' as const, versions: getLibraryVersions(), id: active.id };
  }

  getCurrent() {
    return {
      bundle: getCurrentClinicalBundle(),
      versions: getLibraryVersions(),
      builtin: buildBuiltinClinicalBundle(),
    };
  }

  async listHistory(limit = 20) {
    return this.prisma.clinicalLibraryPublish.findMany({
      orderBy: { publishedAt: 'desc' },
      take: limit,
      select: {
        id: true,
        version: true,
        isActive: true,
        modifiersVersion: true,
        changelog: true,
        publishedAt: true,
        publishedById: true,
        createdAt: true,
      },
    });
  }

  async publish(
    body: {
      version?: string;
      modifiers: SerializableModifier[];
      modifiers_version?: string;
      red_flags: RedFlagLibrary;
      changelog?: string;
    },
    user: { id: string; full_name?: string; email?: string },
  ) {
    if (!Array.isArray(body.modifiers) || !body.red_flags?.thresholds) {
      throw new BadRequestException('modifiers array and red_flags.thresholds are required');
    }
    const version = body.version || `v${new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '')}`;
    const modifiersVersion = body.modifiers_version || version;

    const result = await this.prisma.$transaction(async (tx) => {
      await tx.clinicalLibraryPublish.updateMany({
        where: { isActive: true },
        data: { isActive: false },
      });
      return tx.clinicalLibraryPublish.create({
        data: {
          version,
          isActive: true,
          modifiers: body.modifiers as object,
          modifiersVersion,
          redFlags: body.red_flags as object,
          changelog: body.changelog || null,
          publishedById: user.id,
        },
      });
    });

    applyClinicalLibraryBundle({
      version: result.version,
      modifiers: body.modifiers,
      modifiers_version: modifiersVersion,
      red_flags: body.red_flags,
      published_at: result.publishedAt.toISOString(),
      published_by: user.full_name || user.email || user.id,
    });

    await this.audit.log('ClinicalLibraryPublish', result.id, 'clinical_library_published', user, {
      version: result.version,
      modifiersVersion,
      changelog: body.changelog || null,
    });

    return {
      id: result.id,
      version: result.version,
      versions: getLibraryVersions(),
    };
  }

  async activate(id: string, user: { id: string; full_name?: string; email?: string }) {
    const row = await this.prisma.clinicalLibraryPublish.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Library publish not found');

    await this.prisma.$transaction(async (tx) => {
      await tx.clinicalLibraryPublish.updateMany({
        where: { isActive: true },
        data: { isActive: false },
      });
      await tx.clinicalLibraryPublish.update({
        where: { id },
        data: { isActive: true },
      });
    });

    applyClinicalLibraryBundle({
      version: row.version,
      modifiers: row.modifiers as unknown as SerializableModifier[],
      modifiers_version: row.modifiersVersion,
      red_flags: row.redFlags as unknown as RedFlagLibrary,
      published_at: row.publishedAt.toISOString(),
      published_by: user.full_name || user.email || user.id,
    });

    await this.audit.log('ClinicalLibraryPublish', id, 'clinical_library_activated', user, {
      version: row.version,
    });

    return { id, versions: getLibraryVersions() };
  }

  async getPublish(id: string) {
    const row = await this.prisma.clinicalLibraryPublish.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Library publish not found');
    return row;
  }
}
