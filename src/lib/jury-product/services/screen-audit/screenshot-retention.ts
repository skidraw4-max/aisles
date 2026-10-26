/**
 * I-060: deletes expired screenshots (storage object first, then the evidence row is stamped deletedAt and its
 * storageKey cleared). Runs inside the existing daily readonly-account-purge cron (no new schedule).
 */
import type { ScreenshotSink } from './screenshot-store';

export type ExpiredEvidence = { id: string; storageKey: string };
export interface ScreenshotRetentionStore {
  listExpired(now: Date, limit: number): Promise<ExpiredEvidence[]>;
  markDeleted(ids: string[], now: Date): Promise<void>;
}

export async function purgeExpiredScreenshots(store: ScreenshotRetentionStore, sink: ScreenshotSink, now = new Date(), limit = 500) {
  const rows = await store.listExpired(now, limit);
  if (rows.length === 0) return { scanned: 0, deleted: 0, failed: 0 };
  try {
    await sink.remove(rows.map((r) => r.storageKey));
  } catch {
    return { scanned: rows.length, deleted: 0, failed: rows.length };
  }
  await store.markDeleted(rows.map((r) => r.id), now);
  return { scanned: rows.length, deleted: rows.length, failed: 0 };
}

export async function createPrismaScreenshotRetentionStore(): Promise<ScreenshotRetentionStore> {
  const { prisma } = await import('@/lib/prisma');
  return {
    async listExpired(now, limit) {
      const rows = await prisma.juryAuditEvidence.findMany({
        where: { expiresAt: { lt: now }, deletedAt: null, storageKey: { not: null } },
        select: { id: true, storageKey: true },
        take: limit,
      });
      return rows.filter((r): r is ExpiredEvidence => typeof r.storageKey === 'string');
    },
    async markDeleted(ids, now) {
      await prisma.juryAuditEvidence.updateMany({ where: { id: { in: ids }, deletedAt: null }, data: { deletedAt: now, storageKey: null } });
    },
  };
}
