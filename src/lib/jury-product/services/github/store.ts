/**
 * Persists a GitHub App installation as a Jury connection.
 * The installation id is a reference. Access tokens are not written.
 */
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { decideJuryMutation, type JuryActor } from '../../access';
import { containsSecret } from '../../agent-execution';
import { containsRawCredential, providerError, type ProviderError } from '../provider-types';
import {
  planGithubDisconnect,
  planGithubInstallation,
  planRepositorySelection,
} from './access';
import { confirmInstallationAccess, readRepositoryContents } from './client';
import { readGithubAppConfig, githubInstallUrl } from './config';
import { toServiceDiscovery, type GithubContentEntry, type GithubRepository } from './discovery';
import { GITHUB_STATE_TTL_SECONDS, acceptGithubStateUse, hashGithubNonce, signGithubState, verifyGithubState } from './state';

async function openTx<T>(run: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  const { prisma } = await import('@/lib/prisma');
  return prisma.$transaction((tx) => run(tx));
}

function denied(actor: JuryActor): ProviderError | null {
  if (!actor.ok) return providerError('CONNECTION_UNAUTHORIZED');
  return null;
}

function mutationFailure(reason: string): ProviderError {
  if (reason === 'TENANT_MISMATCH') return providerError('CONNECTION_NOT_FOUND');
  return providerError('CONNECTION_UNAUTHORIZED');
}

function safeReference(value: string): ProviderError | { ok: true; credentialRef: string } {
  if (containsSecret(value) || containsRawCredential(value)) return providerError('SECRET_REJECTED');
  return { ok: true, credentialRef: value };
}

async function stateRows(tx: Prisma.TransactionClient, tenantId: string, now: Date) {
  return tx.juryAuditEvent.findMany({
    where: {
      tenantId,
      action: { in: ['GITHUB_CONNECT_STATE', 'GITHUB_CONNECT_CONSUMED'] },
      timestamp: { gte: new Date(now.getTime() - (GITHUB_STATE_TTL_SECONDS + 60) * 1000) },
    },
    orderBy: { timestamp: 'desc' },
    take: 100,
  });
}

function nonceOf(provenance: unknown): string | null {
  if (!provenance || typeof provenance !== 'object' || Array.isArray(provenance)) return null;
  const value = (provenance as { nonceHash?: unknown }).nonceHash;
  return typeof value === 'string' ? value : null;
}

export async function beginGithubConnect(input: {
  actor: JuryActor;
  now?: Date;
  clientTenantId?: string | null;
  clientOrganizationId?: string | null;
  clientUserId?: string | null;
  clientRole?: string | null;
  clientPermission?: string | null;
}): Promise<{ ok: true; redirectUrl: string } | ProviderError> {
  void input.clientTenantId;
  void input.clientOrganizationId;
  void input.clientUserId;
  void input.clientRole;
  void input.clientPermission;
  const blocked = denied(input.actor);
  if (blocked || !input.actor.ok) return blocked ?? providerError('CONNECTION_UNAUTHORIZED');
  const actor = input.actor;
  const allowed = decideJuryMutation({
    actor,
    action: 'connection.write',
    resourceTenantId: actor.tenantId,
  });
  if (!allowed.ok) return mutationFailure(allowed.reason);
  const config = readGithubAppConfig();
  if (!config.ok) return config;
  const now = input.now ?? new Date();
  const expiresAt = Math.floor(now.getTime() / 1000) + GITHUB_STATE_TTL_SECONDS;
  const nonce = randomUUID();
  const state = signGithubState({
    tenantId: actor.tenantId,
    userId: actor.userId,
    nonce,
    expiresAt,
    secret: config.config.stateSecret,
  });
  const redirectUrl = state ? githubInstallUrl(config.config.appName, state) : null;
  if (!state || !redirectUrl) return providerError('GITHUB_NOT_CONFIGURED');
  const provenance = { nonceHash: hashGithubNonce(nonce), expiresAt };
  if (containsRawCredential(provenance) || containsSecret(provenance)) return providerError('SECRET_REJECTED');
  try {
    await openTx(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM "JuryTenant" WHERE id = ${actor.tenantId} FOR UPDATE`);
      await tx.juryAuditEvent.create({
        data: {
          id: randomUUID(),
          tenantId: actor.tenantId,
          timestamp: now,
          actor: actor.userId,
          action: 'GITHUB_CONNECT_STATE',
          provenance,
        },
      });
    });
  } catch {
    return providerError('PROVIDER_UNAVAILABLE');
  }
  return { ok: true, redirectUrl };
}

export async function finishGithubCallback(input: {
  actor: JuryActor;
  state: string;
  installationId: string;
  setupAction: string;
  now?: Date;
  clientTenantId?: string | null;
  clientOrganizationId?: string | null;
  clientUserId?: string | null;
  clientRole?: string | null;
  clientPermission?: string | null;
}): Promise<{ ok: true; connectionId: string; repositories: GithubRepository[] } | ProviderError> {
  void input.clientTenantId;
  void input.clientOrganizationId;
  void input.clientUserId;
  void input.clientRole;
  void input.clientPermission;
  const blocked = denied(input.actor);
  if (blocked || !input.actor.ok) return blocked ?? providerError('CONNECTION_UNAUTHORIZED');
  const actor = input.actor;
  const allowed = decideJuryMutation({
    actor,
    action: 'connection.write',
    resourceTenantId: actor.tenantId,
  });
  if (!allowed.ok) return mutationFailure(allowed.reason);
  if (input.setupAction !== 'install' && input.setupAction !== 'update') return providerError('GITHUB_STATE_INVALID');
  const config = readGithubAppConfig();
  if (!config.ok) return config;
  const now = input.now ?? new Date();
  const verified = verifyGithubState({
    state: input.state,
    secret: config.config.stateSecret,
    now: Math.floor(now.getTime() / 1000),
  });
  if (!verified.ok) return verified;
  const planned = planGithubInstallation({
    actorTenantId: actor.tenantId,
    actorUserId: actor.userId,
    stateTenantId: verified.claims.tenantId,
    stateUserId: verified.claims.userId,
    installationId: input.installationId,
    accountLogin: '',
    accountType: 'unknown',
    clientTenantId: input.clientTenantId,
    clientOrganizationId: input.clientOrganizationId,
    clientUserId: input.clientUserId,
    clientRole: input.clientRole,
    clientPermission: input.clientPermission,
  });
  if (!planned.ok) return planned;
  const screened = safeReference(planned.credentialRef);
  if (!screened.ok) return screened;
  const nonceHash = hashGithubNonce(verified.claims.nonce);
  try {
    const reserved = await openTx(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM "JuryTenant" WHERE id = ${actor.tenantId} FOR UPDATE`);
      const rows = await stateRows(tx, actor.tenantId, now);
      const issued = rows.some((row) => row.action === 'GITHUB_CONNECT_STATE' && nonceOf(row.provenance) === nonceHash);
      const consumed = rows.some((row) => row.action === 'GITHUB_CONNECT_CONSUMED' && nonceOf(row.provenance) === nonceHash);
      const reusable = acceptGithubStateUse({
        consumed,
        expiresAt: verified.claims.expiresAt,
        now: Math.floor(now.getTime() / 1000),
      });
      if (!issued || !reusable.ok) return providerError('GITHUB_STATE_INVALID');
      return { ok: true as const };
    });
    if (!reserved.ok) return reserved;
  } catch {
    return providerError('PROVIDER_UNAVAILABLE');
  }
  const access = await confirmInstallationAccess({
    appId: config.config.appId,
    privateKey: config.config.privateKey,
    installationId: planned.installationId,
    nowSeconds: Math.floor(now.getTime() / 1000),
  });
  if (!access.ok) return access;
  const identified = planGithubInstallation({
    actorTenantId: actor.tenantId,
    actorUserId: actor.userId,
    stateTenantId: verified.claims.tenantId,
    stateUserId: verified.claims.userId,
    installationId: planned.installationId,
    accountLogin: access.accountLogin,
    accountType: access.accountType,
  });
  if (!identified.ok) return identified;
  const provenance = {
    nonceHash,
    installationId: identified.installationId,
    accountLogin: identified.displayName,
    accountType: identified.accountType,
  };
  if (containsRawCredential(provenance) || containsSecret(provenance)) return providerError('SECRET_REJECTED');
  try {
    const connectionId = await openTx(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM "JuryTenant" WHERE id = ${actor.tenantId} FOR UPDATE`);
      const rows = await stateRows(tx, actor.tenantId, now);
      if (rows.some((row) => row.action === 'GITHUB_CONNECT_CONSUMED' && nonceOf(row.provenance) === nonceHash)) {
        return null;
      }
      const existing = await tx.juryServiceConnection.findFirst({
        where: { tenantId: actor.tenantId, serviceKey: identified.serviceKey },
      });
      const id = existing?.id ?? randomUUID();
      if (!existing) {
        await tx.juryServiceConnection.create({
          data: {
            id,
            tenantId: actor.tenantId,
            serviceKey: identified.serviceKey,
            displayName: identified.displayName,
            accessMethod: 'OAUTH',
            status: 'CONNECTED',
            credentialRef: screened.credentialRef,
            createdByUserId: actor.userId,
            createdAt: now,
            updatedAt: now,
          },
        });
      } else if (existing.tenantId === actor.tenantId) {
        await tx.juryServiceConnection.update({
          where: { id: existing.id },
          data: { displayName: identified.displayName, status: 'CONNECTED' },
        });
      }
      await tx.juryAuditEvent.create({
        data: {
          id: randomUUID(),
          tenantId: actor.tenantId,
          timestamp: now,
          actor: actor.userId,
          action: 'GITHUB_CONNECT_CONSUMED',
          serviceKey: identified.serviceKey,
          accessMethod: 'OAUTH',
          provenance,
        },
      });
      return id;
    });
    if (!connectionId) return providerError('GITHUB_STATE_INVALID');
    return { ok: true, connectionId, repositories: access.repositories };
  } catch {
    return providerError('PROVIDER_UNAVAILABLE');
  }
}

async function ownedGithubConnection(actor: Extract<JuryActor, { ok: true }>, connectionId: string) {
  const { prisma } = await import('@/lib/prisma');
  const connection = await prisma.juryServiceConnection.findFirst({
    where: { id: connectionId, tenantId: actor.tenantId },
  });
  if (!connection || !connection.serviceKey.startsWith('github-')) return null;
  return connection;
}

export async function loadGithubDiscovery(input: {
  actor: JuryActor;
  connectionId: string;
  clientTenantId?: string | null;
  clientPermission?: string | null;
}): Promise<{
  ok: true;
  repositories: GithubRepository[];
  discovery: ReturnType<typeof toServiceDiscovery>;
} | ProviderError> {
  void input.clientTenantId;
  void input.clientPermission;
  const blocked = denied(input.actor);
  if (blocked || !input.actor.ok) return blocked ?? providerError('CONNECTION_UNAUTHORIZED');
  const actor = input.actor;
  const allowed = decideJuryMutation({
    actor,
    action: 'connection.write',
    resourceTenantId: actor.tenantId,
  });
  if (!allowed.ok) return mutationFailure(allowed.reason);
  const config = readGithubAppConfig();
  if (!config.ok) return config;
  try {
    const connection = await ownedGithubConnection(actor, input.connectionId);
    if (!connection) return providerError('CONNECTION_NOT_FOUND');
    const installationId = connection.serviceKey.slice('github-'.length);
    const access = await confirmInstallationAccess({
      appId: config.config.appId,
      privateKey: config.config.privateKey,
      installationId,
    });
    if (!access.ok) return access;
    return {
      ok: true,
      repositories: access.repositories,
      discovery: toServiceDiscovery({
        tenantId: actor.tenantId,
        connectionId: connection.id,
        repositories: access.repositories,
        incomplete: access.incomplete,
      }),
    };
  } catch {
    return providerError('PROVIDER_UNAVAILABLE');
  }
}

export async function selectGithubRepository(input: {
  actor: JuryActor;
  connectionId: string;
  fullName: string;
  clientTenantId?: string | null;
  clientPermission?: string | null;
}): Promise<{ ok: true; connectionId: string; fullName: string } | ProviderError> {
  void input.clientTenantId;
  void input.clientPermission;
  const blocked = denied(input.actor);
  if (blocked || !input.actor.ok) return blocked ?? providerError('CONNECTION_UNAUTHORIZED');
  const actor = input.actor;
  const allowed = decideJuryMutation({
    actor,
    action: 'scope.write',
    resourceTenantId: actor.tenantId,
  });
  if (!allowed.ok) return mutationFailure(allowed.reason);
  const loaded = await loadGithubDiscovery({ actor, connectionId: input.connectionId });
  if (!loaded.ok) return loaded;
  const selected = planRepositorySelection({ fullName: input.fullName, repositories: loaded.repositories });
  if (!selected.ok) return selected;
  const grants = selected.scopes.map((scope) => ({ resource: scope.resource, mode: 'READ' as const }));
  if (containsRawCredential(grants) || containsSecret(grants)) return providerError('SECRET_REJECTED');
  try {
    const saved = await openTx(async (tx) => {
      const connection = await tx.juryServiceConnection.findFirst({
        where: { id: input.connectionId, tenantId: actor.tenantId },
      });
      if (!connection || !connection.serviceKey.startsWith('github-')) return false;
      const existing = await tx.juryAccessScope.findFirst({
        where: { tenantId: actor.tenantId, connectionId: connection.id },
      });
      if (existing) {
        await tx.juryAccessScope.update({
          where: { id: existing.id },
          data: {
            status: 'APPROVED',
            grants,
            approvedByUserId: actor.userId,
            approvedAt: new Date(),
          },
        });
      } else {
        await tx.juryAccessScope.create({
          data: {
            id: randomUUID(),
            tenantId: actor.tenantId,
            connectionId: connection.id,
            status: 'APPROVED',
            grants,
            approvedByUserId: actor.userId,
            approvedAt: new Date(),
          },
        });
      }
      await tx.juryAuditEvent.create({
        data: {
          id: randomUUID(),
          tenantId: actor.tenantId,
          timestamp: new Date(),
          actor: actor.userId,
          action: 'GITHUB_REPOSITORY_SELECTED',
          serviceKey: connection.serviceKey,
          accessMethod: 'OAUTH',
          provenance: { resource: grants[0]?.resource ?? 'repository', operation: 'read', readonly: true },
        },
      });
      return true;
    });
    if (!saved) return providerError('CONNECTION_NOT_FOUND');
  } catch {
    return providerError('PROVIDER_UNAVAILABLE');
  }
  return { ok: true, connectionId: input.connectionId, fullName: selected.repository.fullName };
}

export async function readGithubRoot(input: {
  actor: JuryActor;
  connectionId: string;
  fullName: string;
}): Promise<{ ok: true; entries: GithubContentEntry[] } | ProviderError> {
  const blocked = denied(input.actor);
  if (blocked || !input.actor.ok) return blocked ?? providerError('CONNECTION_UNAUTHORIZED');
  const actor = input.actor;
  const allowed = decideJuryMutation({
    actor,
    action: 'connection.write',
    resourceTenantId: actor.tenantId,
  });
  if (!allowed.ok) return mutationFailure(allowed.reason);
  const loaded = await loadGithubDiscovery({ actor, connectionId: input.connectionId });
  if (!loaded.ok) return loaded;
  const selected = planRepositorySelection({ fullName: input.fullName, repositories: loaded.repositories });
  if (!selected.ok) return selected;
  const config = readGithubAppConfig();
  if (!config.ok) return config;
  try {
    const { prisma } = await import('@/lib/prisma');
    const connection = await prisma.juryServiceConnection.findFirst({
      where: { id: input.connectionId, tenantId: actor.tenantId },
    });
    if (!connection) return providerError('CONNECTION_NOT_FOUND');
    const id = connection.serviceKey.slice('github-'.length);
    return readRepositoryContents({
      appId: config.config.appId,
      privateKey: config.config.privateKey,
      installationId: id,
      owner: selected.repository.owner,
      repo: selected.repository.name,
      ref: selected.repository.defaultBranch,
      disabled: selected.repository.disabled,
    });
  } catch {
    return providerError('PROVIDER_UNAVAILABLE');
  }
}

export async function disconnectGithubConnection(input: {
  actor: JuryActor;
  connectionId: string;
  clientTenantId?: string | null;
}): Promise<{ ok: true; connectionId: string; externalUninstall: false } | ProviderError> {
  const blocked = denied(input.actor);
  if (blocked || !input.actor.ok) return blocked ?? providerError('CONNECTION_UNAUTHORIZED');
  const actor = input.actor;
  const allowed = decideJuryMutation({
    actor,
    action: 'connection.write',
    resourceTenantId: actor.tenantId,
  });
  if (!allowed.ok) return mutationFailure(allowed.reason);
  try {
    return await openTx(async (tx) => {
      const connection = await tx.juryServiceConnection.findFirst({
        where: { id: input.connectionId, tenantId: actor.tenantId },
      });
      const planned = planGithubDisconnect({
        actorTenantId: actor.tenantId,
        connection: connection
          ? {
              id: connection.id,
              tenantId: connection.tenantId,
              serviceKey: connection.serviceKey,
              credentialRef: connection.credentialRef,
            }
          : null,
        clientTenantId: input.clientTenantId,
      });
      if (!planned.ok) return planned;
      await tx.juryServiceConnection.update({
        where: { id: planned.connectionId },
        data: { status: 'DISCONNECTED' },
      });
      await tx.juryAuditEvent.create({
        data: {
          id: randomUUID(),
          tenantId: actor.tenantId,
          timestamp: new Date(),
          actor: actor.userId,
          action: 'GITHUB_DISCONNECTED',
          serviceKey: connection?.serviceKey,
          accessMethod: 'OAUTH',
          provenance: { connectionId: planned.connectionId, externalUninstall: false },
        },
      });
      return { ok: true as const, connectionId: planned.connectionId, externalUninstall: false as const };
    });
  } catch {
    return providerError('PROVIDER_UNAVAILABLE');
  }
}
