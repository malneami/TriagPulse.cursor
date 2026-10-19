import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.module';

/**
 * Retention (review H5, PDPL): stored triage transcripts are deleted after
 * TRANSCRIPT_RETENTION_DAYS (default 30). The structured triage record — vitals, levels,
 * reasons, the audit trail — is kept; only the free-text dictation goes.
 * Runs at start and then every 6 hours. Set TRANSCRIPT_RETENTION_DAYS=0 to keep none at all.
 */
export function retentionDays(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.TRANSCRIPT_RETENTION_DAYS;
  if (raw === undefined || raw.trim() === '') return 30;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 30;
}

@Injectable()
export class RetentionService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Retention');
  private timer?: NodeJS.Timeout;

  constructor(private prisma: PrismaService) {}

  onModuleInit() {
    // Not in tests that start and stop the app quickly; the first run is shortly after boot.
    setTimeout(() => void this.run(), 30_000).unref();
    this.timer = setInterval(() => void this.run(), 6 * 3600 * 1000);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /** Clears transcripts older than the retention period. Returns how many were cleared. */
  async run(now = new Date()): Promise<number> {
    const days = retentionDays();
    const cutoff = new Date(now.getTime() - days * 86400 * 1000);
    try {
      const { count } = await this.prisma.triageRecord.updateMany({
        where: { transcription: { not: null }, createdAt: { lt: cutoff } },
        data: { transcription: null },
      });
      if (count > 0) this.logger.log(`Cleared ${count} transcript(s) older than ${days} day(s)`);
      return count;
    } catch (err) {
      this.logger.warn(`Transcript retention run failed: ${(err as Error).message}`);
      return 0;
    }
  }
}
