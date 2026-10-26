/**
 * I-040: persistence for READ_ONLY_ACCOUNT consent and credentials.
 * Writes go through an injected store so tests never touch a database.
 * The Prisma-backed store requires migration 20261026110000 (applied to Preview and Production on 2026-10-26).
 */
import { randomUUID } from 'node:crypto';
import type { JuryActor } from '../../access';
import type { CredentialKeyProvider } from './credential-crypto';
import type { ObservationScopeInput } from './consent';
import {
  planConsent,
  planCredentialStore,
  READONLY_ACCOUNT_AUDIT,
  type ObservationScope,
  type ReadonlyAccountFailure,
} from './consent';

type ConnectionRow = { id: string; tenantId: string; serviceKey: string; accessMethod: string };
type ConsentRow = { connectionId: string; tenantId: string; version: string; scopeHash: string };

export interface ReadonlyAccountStore {
  findConnection(tenantId: string, connectionId: string): Promise<ConnectionRow | null>;
  findLatestConsent(tenantId: string, connectionId: string): Promise<ConsentRow | null>;
  createConsent(row: ConsentRow & { id: string; userId: string; acceptedAt: string }): Promise<void>;
  /** Marks every active credential of the connection destroyed, then inserts the new one and repoints credentialRef. */
  replaceCredential(row: Record<string, unknown> & { id: string; tenantId: string; connectionId: string }, credentialRef: string, now: string): Promise<void>;
  audit(event: { tenantId: string; actor: string; action: string; serviceKey: string; timestamp: string }): Promise<void>;
}

function tenantOf(actor: JuryActor): string | null {
  return actor.ok ? actor.tenantId : null;
}

export async function persistReadonlyAccountConsent(input: {
  actor: JuryActor;
  connectionId: string;
  scope: ObservationScopeInput;
  accepted: boolean;
  now: string;
  store: ReadonlyAccountStore;
}): Promise<{ ok: true; scope: ObservationScope } | { ok: false; reason: ReadonlyAccountFailure }> {
  const tenantId = tenantOf(input.actor);
  const connection = tenantId ? await input.store.findConnection(tenantId, input.connectionId) : null;
  const planned = planConsent({ actor: input.actor, connection, scope: input.scope, accepted: input.accepted, now: input.now });
  if (!planned.ok || !input.actor.ok || !connection) return planned.ok ? { ok: false, reason: 'NOT_FOUND' } : planned;
  await input.store.createConsent(planned.consent);
  await input.store.audit({
    tenantId: connection.tenantId,
    actor: input.actor.userId,
    action: READONLY_ACCOUNT_AUDIT.CONSENT_ACCEPTED,
    serviceKey: connection.serviceKey,
    timestamp: input.now,
  });
  return { ok: true, scope: planned.scope };
}

export async function persistReadonlyAccountCredential(input: {
  actor: JuryActor;
  connectionId: string;
  scope: ObservationScope;
  username: unknown;
  password: unknown;
  retentionDays?: number;
  now: string;
  keyProvider: CredentialKeyProvider;
  store: ReadonlyAccountStore;
}): Promise<{ ok: true; usernameHint: string; expiresAt: string } | { ok: false; reason: ReadonlyAccountFailure }> {
  const tenantId = tenantOf(input.actor);
  const connection = tenantId ? await input.store.findConnection(tenantId, input.connectionId) : null;
  const consent = connection ? await input.store.findLatestConsent(connection.tenantId, connection.id) : null;
  const planned = await planCredentialStore({
    actor: input.actor,
    connection,
    consent,
    scope: input.scope,
    username: input.username,
    password: input.password,
    retentionDays: input.retentionDays,
    now: input.now,
    keyProvider: input.keyProvider,
  });
  if (!planned.ok || !input.actor.ok || !connection) return planned.ok ? { ok: false, reason: 'NOT_FOUND' } : planned;
  await input.store.replaceCredential(planned.credential, planned.credentialRef, input.now);
  await input.store.audit({
    tenantId: connection.tenantId,
    actor: input.actor.userId,
    action: READONLY_ACCOUNT_AUDIT.CREDENTIAL_STORED,
    serviceKey: connection.serviceKey,
    timestamp: input.now,
  });
  return { ok: true, usernameHint: planned.credential.usernameHint, expiresAt: planned.credential.expiresAt };
}

export async function createPrismaReadonlyAccountStore(): Promise<ReadonlyAccountStore> {
  const { prisma } = await import('@/lib/prisma');
  return {
    async findConnection(tenantId, connectionId) {
      return prisma.juryServiceConnection.findFirst({
        where: { id: connectionId, tenantId },
        select: { id: true, tenantId: true, serviceKey: true, accessMethod: true },
      });
    },
    async findLatestConsent(tenantId, connectionId) {
      return prisma.juryConnectionConsent.findFirst({
        where: { tenantId, connectionId },
        orderBy: { acceptedAt: 'desc' },
        select: { connectionId: true, tenantId: true, version: true, scopeHash: true },
      });
    },
    async createConsent(row) {
      await prisma.juryConnectionConsent.create({ data: { ...row, acceptedAt: new Date(row.acceptedAt) } });
    },
    async replaceCredential(row, credentialRef, now) {
      const r = row as Record<string, unknown>;
      await prisma.$transaction(async (tx) => {
        await tx.juryAccountCredential.updateMany({
          where: { tenantId: row.tenantId, connectionId: row.connectionId, destroyedAt: null },
          data: { destroyedAt: new Date(now), destroyReason: 'REPLACED', ciphertext: null, iv: null, authTag: null, wrappedDek: null },
        });
        await tx.juryAccountCredential.create({
          data: {
            id: row.id,
            tenantId: row.tenantId,
            connectionId: row.connectionId,
            algorithm: String(r.algorithm),
            ciphertext: String(r.ciphertext),
            iv: String(r.iv),
            authTag: String(r.authTag),
            wrappedDek: String(r.wrappedDek),
            kekId: String(r.kekId),
            usernameHint: String(r.usernameHint),
            expiresAt: new Date(String(r.expiresAt)),
            createdByUserId: String(r.createdByUserId),
          },
        });
        await tx.juryServiceConnection.updateMany({
          where: { id: row.connectionId, tenantId: row.tenantId },
          data: { credentialRef, updatedAt: new Date(now) },
        });
      });
    },
    async audit(event) {
      await prisma.juryAuditEvent.create({
        data: {
          id: randomUUID(),
          tenantId: event.tenantId,
          actor: event.actor,
          action: event.action,
          serviceKey: event.serviceKey,
          accessMethod: 'READ_ONLY_ACCOUNT',
          timestamp: new Date(event.timestamp),
        },
      });
    },
  };
}
