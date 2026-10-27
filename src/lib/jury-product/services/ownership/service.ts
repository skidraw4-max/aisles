/**
 * I-072/I-073/I-074: ownership verification lifecycle. All I/O is injected (store, checks, clock).
 * - issue: new token per (connection, host); previous token for the same host is replaced. Plaintext is returned once.
 * - verify: user-triggered check. PENDING older than 14 days becomes FAILED and needs a new token.
 * - recheck (cron): VERIFIED rows due for a check; 3 consecutive failures => EXPIRED.
 */
import { randomUUID } from 'node:crypto';
import { decideJuryMutation, type JuryActor } from '../../access';
import { checkOwnership, isOwnershipMethod, normalizeOwnershipHost, ownershipInstructions, type OwnershipCheckDeps, type OwnershipMethod, type OwnershipInstructions } from './checks';
import { OWNERSHIP_CONSENT_VERSION } from './consent-text';
import { generateOwnershipToken, hashOwnershipToken, tokenHint } from './token';

export const OWNERSHIP_RECHECK_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
export const OWNERSHIP_PENDING_TTL_MS = 14 * 24 * 60 * 60 * 1000;
export const OWNERSHIP_MAX_RECHECK_FAILURES = 3;
export const OWNERSHIP_RECHECK_BATCH = 25;

export type OwnershipStatus = 'PENDING' | 'VERIFIED' | 'FAILED' | 'EXPIRED' | 'REVOKED';

export type OwnershipRecord = {
  id: string;
  tenantId: string;
  connectionId: string;
  host: string;
  method: OwnershipMethod;
  tokenHash: string;
  tokenHint: string;
  status: OwnershipStatus;
  verifiedAt: Date | null;
  lastCheckedAt: Date | null;
  nextCheckAt: Date | null;
  expiresAt: Date | null;
  failureCount: number;
  lastFailureCode: string | null;
  createdAt: Date;
};

export interface OwnershipStore {
  findConnection(tenantId: string, connectionId: string): Promise<{ id: string; tenantId: string; serviceKey: string; accessMethod: string; createdAt: Date } | null>;
  listForConnection(tenantId: string, connectionId: string): Promise<OwnershipRecord[]>;
  upsertIssued(row: {
    id: string;
    tenantId: string;
    connectionId: string;
    host: string;
    method: OwnershipMethod;
    tokenHash: string;
    tokenHint: string;
    expiresAt: Date;
    createdByUserId: string;
    consentVersion: string;
    consentAcceptedAt: Date;
  }): Promise<void>;
  update(id: string, data: Partial<Pick<OwnershipRecord, 'status' | 'verifiedAt' | 'lastCheckedAt' | 'nextCheckAt' | 'expiresAt' | 'failureCount' | 'lastFailureCode'>>): Promise<void>;
  listDue(now: Date, limit: number): Promise<OwnershipRecord[]>;
  audit(event: { tenantId: string; actor: string; action: string; serviceKey: string; timestamp: Date }): Promise<void>;
}

export type OwnershipFailure =
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'TENANT_MISMATCH'
  | 'NOT_FOUND'
  | 'NOT_ENABLED'
  | 'CONSENT_REQUIRED'
  | 'INVALID_HOST'
  | 'INVALID_METHOD'
  | 'ACCESS_METHOD_UNSUPPORTED'
  | 'TOKEN_EXPIRED';

async function authorize(actor: JuryActor, store: OwnershipStore, connectionId: string) {
  if (!actor.ok) return { ok: false as const, reason: (actor.reason === 'UNAUTHENTICATED' ? 'UNAUTHENTICATED' : 'FORBIDDEN') as OwnershipFailure };
  const connection = await store.findConnection(actor.tenantId, connectionId);
  if (!connection) return { ok: false as const, reason: 'NOT_FOUND' as OwnershipFailure };
  const allowed = decideJuryMutation({ actor, action: 'connection.write', resourceTenantId: connection.tenantId });
  if (!allowed.ok) return { ok: false as const, reason: (allowed.reason === 'TENANT_MISMATCH' ? 'TENANT_MISMATCH' : 'FORBIDDEN') as OwnershipFailure };
  if (connection.accessMethod === 'GA4_VIEWER') return { ok: false as const, reason: 'ACCESS_METHOD_UNSUPPORTED' as OwnershipFailure };
  return { ok: true as const, actor, connection };
}

export async function issueOwnershipToken(input: {
  actor: JuryActor;
  connectionId: string;
  host: string;
  method: string;
  accepted: boolean;
  store: OwnershipStore;
  pepper: string | null;
  now?: Date;
}): Promise<{ ok: true; instructions: OwnershipInstructions; host: string } | { ok: false; reason: OwnershipFailure }> {
  if (!input.pepper) return { ok: false, reason: 'NOT_ENABLED' };
  const auth = await authorize(input.actor, input.store, input.connectionId);
  if (!auth.ok) return auth;
  if (!input.accepted) return { ok: false, reason: 'CONSENT_REQUIRED' };
  if (!isOwnershipMethod(input.method)) return { ok: false, reason: 'INVALID_METHOD' };
  const host = normalizeOwnershipHost(input.host);
  if (!host) return { ok: false, reason: 'INVALID_HOST' };
  const now = input.now ?? new Date();
  const token = generateOwnershipToken();
  await input.store.upsertIssued({
    id: randomUUID(),
    tenantId: auth.connection.tenantId,
    connectionId: auth.connection.id,
    host,
    method: input.method,
    tokenHash: hashOwnershipToken(token, input.pepper),
    tokenHint: tokenHint(token),
    expiresAt: new Date(now.getTime() + OWNERSHIP_PENDING_TTL_MS),
    createdByUserId: auth.actor.userId,
    consentVersion: OWNERSHIP_CONSENT_VERSION,
    consentAcceptedAt: now,
  });
  await input.store.audit({ tenantId: auth.connection.tenantId, actor: auth.actor.userId, action: 'OWNERSHIP_TOKEN_ISSUED', serviceKey: auth.connection.serviceKey, timestamp: now });
  return { ok: true, host, instructions: ownershipInstructions(input.method, host, token) };
}

export type OwnershipVerifyResult = { ok: true; status: OwnershipStatus; failureCode: string | null } | { ok: false; reason: OwnershipFailure };

export async function verifyOwnershipNow(input: {
  actor: JuryActor;
  connectionId: string;
  verificationId: string;
  store: OwnershipStore;
  pepper: string | null;
  deps?: OwnershipCheckDeps;
  now?: Date;
}): Promise<OwnershipVerifyResult> {
  if (!input.pepper) return { ok: false, reason: 'NOT_ENABLED' };
  const auth = await authorize(input.actor, input.store, input.connectionId);
  if (!auth.ok) return auth;
  const now = input.now ?? new Date();
  const rows = await input.store.listForConnection(auth.connection.tenantId, auth.connection.id);
  const row = rows.find((r) => r.id === input.verificationId);
  if (!row) return { ok: false, reason: 'NOT_FOUND' };
  if (row.status === 'PENDING' && row.expiresAt && row.expiresAt.getTime() <= now.getTime()) {
    await input.store.update(row.id, { status: 'FAILED', lastCheckedAt: now, lastFailureCode: 'TOKEN_EXPIRED' });
    return { ok: false, reason: 'TOKEN_EXPIRED' };
  }
  if (row.status === 'FAILED' || row.status === 'REVOKED') return { ok: false, reason: 'TOKEN_EXPIRED' };
  const result = await checkOwnership({ method: row.method, host: row.host, tokenHash: row.tokenHash, pepper: input.pepper }, input.deps);
  if (result.ok) {
    await input.store.update(row.id, {
      status: 'VERIFIED',
      verifiedAt: now,
      lastCheckedAt: now,
      nextCheckAt: new Date(now.getTime() + OWNERSHIP_RECHECK_INTERVAL_MS),
      expiresAt: null,
      failureCount: 0,
      lastFailureCode: null,
    });
    await input.store.audit({ tenantId: auth.connection.tenantId, actor: auth.actor.userId, action: 'OWNERSHIP_VERIFIED', serviceKey: auth.connection.serviceKey, timestamp: now });
    return { ok: true, status: 'VERIFIED', failureCode: null };
  }
  // A manual failure keeps PENDING (or keeps an EXPIRED row expired); it does not consume recheck budget.
  await input.store.update(row.id, { lastCheckedAt: now, lastFailureCode: result.code });
  return { ok: true, status: row.status, failureCode: result.code };
}

/** True when at least one VERIFIED row exists for the connection. */
export function hasVerifiedOwnership(rows: Pick<OwnershipRecord, 'status'>[]): boolean {
  return rows.some((r) => r.status === 'VERIFIED');
}

export async function recheckDueOwnerships(input: {
  store: OwnershipStore;
  pepper: string | null;
  deps?: OwnershipCheckDeps;
  now?: Date;
  limit?: number;
}): Promise<{ checked: number; verified: number; expired: number; failedPending: number }> {
  const summary = { checked: 0, verified: 0, expired: 0, failedPending: 0 };
  if (!input.pepper) return summary;
  const now = input.now ?? new Date();
  const due = await input.store.listDue(now, input.limit ?? OWNERSHIP_RECHECK_BATCH);
  for (const row of due) {
    if (row.status === 'PENDING') {
      if (row.expiresAt && row.expiresAt.getTime() <= now.getTime()) {
        await input.store.update(row.id, { status: 'FAILED', lastCheckedAt: now, lastFailureCode: 'TOKEN_EXPIRED' });
        summary.failedPending += 1;
      }
      continue;
    }
    if (row.status !== 'VERIFIED') continue;
    summary.checked += 1;
    const result = await checkOwnership({ method: row.method, host: row.host, tokenHash: row.tokenHash, pepper: input.pepper }, input.deps);
    if (result.ok) {
      await input.store.update(row.id, { lastCheckedAt: now, nextCheckAt: new Date(now.getTime() + OWNERSHIP_RECHECK_INTERVAL_MS), failureCount: 0, lastFailureCode: null });
      summary.verified += 1;
      continue;
    }
    const failures = row.failureCount + 1;
    const expired = failures >= OWNERSHIP_MAX_RECHECK_FAILURES;
    await input.store.update(row.id, {
      status: expired ? 'EXPIRED' : 'VERIFIED',
      lastCheckedAt: now,
      failureCount: failures,
      lastFailureCode: result.code,
      // retry sooner (1 day) while still within the failure budget
      nextCheckAt: expired ? null : new Date(now.getTime() + 24 * 60 * 60 * 1000),
    });
    if (expired) summary.expired += 1;
  }
  return summary;
}

export async function createPrismaOwnershipStore(): Promise<OwnershipStore> {
  const { prisma } = await import('@/lib/prisma');
  const select = {
    id: true,
    tenantId: true,
    connectionId: true,
    host: true,
    method: true,
    tokenHash: true,
    tokenHint: true,
    status: true,
    verifiedAt: true,
    lastCheckedAt: true,
    nextCheckAt: true,
    expiresAt: true,
    failureCount: true,
    lastFailureCode: true,
    createdAt: true,
  } as const;
  return {
    async findConnection(tenantId, connectionId) {
      return prisma.juryServiceConnection.findFirst({
        where: { id: connectionId, tenantId },
        select: { id: true, tenantId: true, serviceKey: true, accessMethod: true, createdAt: true },
      });
    },
    async listForConnection(tenantId, connectionId) {
      return prisma.juryOwnershipVerification.findMany({ where: { tenantId, connectionId }, orderBy: { createdAt: 'desc' }, select });
    },
    async upsertIssued(row) {
      const { id, tenantId, connectionId, host, ...rest } = row;
      const reset = { ...rest, status: 'PENDING' as const, verifiedAt: null, lastCheckedAt: null, nextCheckAt: null, failureCount: 0, lastFailureCode: null };
      await prisma.juryOwnershipVerification.upsert({
        where: { tenantId_connectionId_host: { tenantId, connectionId, host } },
        create: { id, tenantId, connectionId, host, ...reset },
        update: reset,
      });
    },
    async update(id, data) {
      await prisma.juryOwnershipVerification.update({ where: { id }, data });
    },
    async listDue(now, limit) {
      return prisma.juryOwnershipVerification.findMany({
        where: {
          OR: [
            { status: 'VERIFIED', nextCheckAt: { lte: now } },
            { status: 'PENDING', expiresAt: { lte: now } },
          ],
        },
        orderBy: { nextCheckAt: 'asc' },
        take: limit,
        select,
      });
    },
    async audit(event) {
      await prisma.juryAuditEvent.create({
        data: { id: randomUUID(), tenantId: event.tenantId, actor: event.actor, action: event.action, serviceKey: event.serviceKey, timestamp: event.timestamp },
      });
    },
  };
}

/** Gate helper for actions: loads rows only when the gate applies. */
export async function connectionOwnershipVerified(store: OwnershipStore, tenantId: string, connectionId: string): Promise<boolean> {
  return hasVerifiedOwnership(await store.listForConnection(tenantId, connectionId));
}
