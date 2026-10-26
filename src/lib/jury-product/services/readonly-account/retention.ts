/**
 * I-043: retention and destruction of stored READ_ONLY_ACCOUNT credentials.
 * Destruction nulls every ciphertext field (crypto-shredding of the wrapped DEK), stamps destroyedAt/destroyReason,
 * clears the connection credentialRef and writes an audit event. Rows are kept for the audit trail.
 */
import { randomUUID } from 'node:crypto';
import { decideJuryMutation, type JuryActor } from '../../access';
import { accountCredentialRef } from './credential-crypto';

/** Purge job switch. On since I-044 (migration applied in Preview and Production). */
export const READONLY_ACCOUNT_RETENTION_JOB_ENABLED = true as boolean;
export const PURGE_BATCH_LIMIT = 200;

export const READONLY_ACCOUNT_RETENTION_AUDIT = {
  EXPIRED_DESTROYED: 'READONLY_ACCOUNT_CREDENTIAL_EXPIRED_DESTROYED',
  MANUAL_DESTROYED: 'READONLY_ACCOUNT_CREDENTIAL_DESTROYED',
} as const;

export type CredentialRow = { id: string; tenantId: string; connectionId: string; serviceKey: string };

export interface RetentionStore {
  listExpired(now: Date, limit: number): Promise<CredentialRow[]>;
  findActive(tenantId: string, connectionId: string): Promise<CredentialRow | null>;
  /** Must only touch rows with destroyedAt = null; returns true when this call destroyed the row. */
  destroy(row: CredentialRow, reason: 'EXPIRED' | 'MANUAL', now: Date): Promise<boolean>;
  audit(event: { tenantId: string; actor: string; action: string; serviceKey: string; timestamp: Date }): Promise<void>;
}

export type PurgeResult = { scanned: number; destroyed: number; failed: number };

export async function purgeExpiredCredentials(store: RetentionStore, now = new Date(), limit = PURGE_BATCH_LIMIT): Promise<PurgeResult> {
  const rows = await store.listExpired(now, limit);
  let destroyed = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      if (!(await store.destroy(row, 'EXPIRED', now))) continue;
      destroyed += 1;
      await store.audit({ tenantId: row.tenantId, actor: 'system:retention', action: READONLY_ACCOUNT_RETENTION_AUDIT.EXPIRED_DESTROYED, serviceKey: row.serviceKey, timestamp: now });
    } catch {
      failed += 1;
    }
  }
  return { scanned: rows.length, destroyed, failed };
}

export type ManualDestroyFailure = 'UNAUTHENTICATED' | 'FORBIDDEN' | 'TENANT_MISMATCH' | 'NOT_FOUND';

export async function destroyCredentialManually(input: { actor: JuryActor; connectionId: string; store: RetentionStore; now?: Date }): Promise<{ ok: true } | { ok: false; reason: ManualDestroyFailure }> {
  const { actor } = input;
  if (!actor.ok) return { ok: false, reason: actor.reason === 'UNAUTHENTICATED' ? 'UNAUTHENTICATED' : 'FORBIDDEN' };
  const row = await input.store.findActive(actor.tenantId, input.connectionId);
  if (!row) return { ok: false, reason: 'NOT_FOUND' };
  const allowed = decideJuryMutation({ actor, action: 'connection.write', resourceTenantId: row.tenantId });
  if (!allowed.ok) return { ok: false, reason: allowed.reason === 'TENANT_MISMATCH' ? 'TENANT_MISMATCH' : 'FORBIDDEN' };
  const now = input.now ?? new Date();
  if (!(await input.store.destroy(row, 'MANUAL', now))) return { ok: false, reason: 'NOT_FOUND' };
  await input.store.audit({ tenantId: row.tenantId, actor: actor.userId, action: READONLY_ACCOUNT_RETENTION_AUDIT.MANUAL_DESTROYED, serviceKey: row.serviceKey, timestamp: now });
  return { ok: true };
}

export async function createPrismaRetentionStore(): Promise<RetentionStore> {
  const { prisma } = await import('@/lib/prisma');
  const withServiceKey = async (rows: { id: string; tenantId: string; connectionId: string }[]): Promise<CredentialRow[]> => {
    if (rows.length === 0) return [];
    const connections = await prisma.juryServiceConnection.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.connectionId))] } }, select: { id: true, serviceKey: true } });
    const keys = new Map(connections.map((c) => [c.id, c.serviceKey]));
    return rows.map((r) => ({ ...r, serviceKey: keys.get(r.connectionId) ?? 'unknown' }));
  };
  return {
    async listExpired(now, limit) {
      const rows = await prisma.juryAccountCredential.findMany({ where: { destroyedAt: null, expiresAt: { lte: now } }, select: { id: true, tenantId: true, connectionId: true }, orderBy: { expiresAt: 'asc' }, take: limit });
      return withServiceKey(rows);
    },
    async findActive(tenantId, connectionId) {
      const row = await prisma.juryAccountCredential.findFirst({ where: { tenantId, connectionId, destroyedAt: null }, select: { id: true, tenantId: true, connectionId: true }, orderBy: { createdAt: 'desc' } });
      return row ? (await withServiceKey([row]))[0] : null;
    },
    async destroy(row, reason, now) {
      return prisma.$transaction(async (tx) => {
        const res = await tx.juryAccountCredential.updateMany({
          where: { id: row.id, tenantId: row.tenantId, destroyedAt: null },
          data: { destroyedAt: now, destroyReason: reason, ciphertext: null, iv: null, authTag: null, wrappedDek: null },
        });
        if (res.count === 0) return false;
        await tx.juryServiceConnection.updateMany({ where: { id: row.connectionId, tenantId: row.tenantId, credentialRef: accountCredentialRef(row.id) }, data: { credentialRef: null, updatedAt: now } });
        return true;
      });
    },
    async audit(event) {
      await prisma.juryAuditEvent.create({ data: { id: randomUUID(), tenantId: event.tenantId, actor: event.actor, action: event.action, serviceKey: event.serviceKey, accessMethod: 'READ_ONLY_ACCOUNT', timestamp: event.timestamp } });
    },
  };
}
