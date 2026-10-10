/**
 * GitHub installation discovery for the service detail action.
 * The network read happens before the database transaction.
 * Repository scope stays PROPOSED until the GitHub page confirms one repository.
 */
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { decideJuryMutation, type JuryActor } from '../../access';
import { containsSecret } from '../../agent-execution';
import type { DiscoveryFailure } from '../../discovery';
import { JURY_INTERACTIVE_TRANSACTION } from '../../persistence-diagnostic';
import type { JuryAccessScope, JuryDiscoveryResult, JuryServiceConnection } from '../../records';
import type { ProviderError } from '../provider-types';
import { githubInstallationReference, githubServiceKey, installationIdFromConnection } from './access';
import { createGithubServiceAdapter } from './adapter';
import type { GithubRepository } from './discovery';
import { loadGithubDiscovery } from './store';

const REPOSITORY_NAME = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;

export type GithubOnboardingFailure = DiscoveryFailure | 'SNAPSHOT_UNSAFE';

export function isGithubInstallationConnection(connection: {
  serviceKey?: string | null;
  credentialRef?: string | null;
}): boolean {
  const installationId = installationIdFromConnection(connection);
  if (!installationId) return false;
  return connection.serviceKey === githubServiceKey(installationId)
    && connection.credentialRef === githubInstallationReference(installationId);
}

export function syntheticMockMetricNames(serviceKey: string): readonly [string, string] {
  return [`${serviceKey}.routes`, `${serviceKey}.api`];
}

export function isSyntheticMockDiscovery(serviceKey: string, metrics: readonly { metric: string }[]): boolean {
  const expected = syntheticMockMetricNames(serviceKey);
  return metrics.length === expected.length && expected.every((metric, index) => metrics[index]?.metric === metric);
}

export function planGithubOnboardingRecord(input: {
  tenantId: string;
  connection: JuryServiceConnection;
  repositories: readonly GithubRepository[];
  incomplete?: boolean;
  now: string;
  discoveryId: string;
  scopeId: string;
}):
  | { ok: true; discovery: JuryDiscoveryResult; scope: JuryAccessScope }
  | { ok: false; reason: 'NOT_IMPLEMENTED' | 'SNAPSHOT_UNSAFE' | 'TENANT_MISMATCH' } {
  if (input.connection.tenantId !== input.tenantId) return { ok: false, reason: 'TENANT_MISMATCH' };
  const accepted = input.repositories.filter((repository) => REPOSITORY_NAME.test(repository.fullName));
  const adapter = createGithubServiceAdapter(accepted);
  const discovered = adapter.discover({
    actorTenantId: input.tenantId,
    connection: input.connection,
  });
  if ('code' in discovered) return { ok: false, reason: 'NOT_IMPLEMENTED' };
  if (discovered.provider !== 'GITHUB') return { ok: false, reason: 'NOT_IMPLEMENTED' };
  const incomplete = input.incomplete === true || accepted.length !== input.repositories.length;
  const resources = discovered.discoveredResources.filter((name) => REPOSITORY_NAME.test(name));
  const grants = resources.map((name) => ({ resource: `repository:${name}`, mode: 'READ' as const }));
  if (containsSecret(grants) || containsSecret(resources)) return { ok: false, reason: 'SNAPSHOT_UNSAFE' };
  const discovery: JuryDiscoveryResult = {
    id: input.discoveryId,
    tenantId: input.tenantId,
    connectionId: input.connection.id,
    exploredAt: input.now,
    surfaces: ['API'],
    menus: resources,
    dataSources: ['API'],
    feasibility: resources.length === 0 ? 'NOT_AVAILABLE' : incomplete ? 'PARTIAL' : 'AVAILABLE',
    proposedMetrics: resources.map((name) => ({
      metric: `repository:${name}`,
      reason: 'GitHub installation repository. Not measured.',
    })),
    approval: 'PENDING',
    uiNotes: 'GitHub repository discovery. Read-only. Evidence stays closed until one repository scope is approved.',
  };
  const scope: JuryAccessScope = {
    id: input.scopeId,
    tenantId: input.tenantId,
    connectionId: input.connection.id,
    status: 'PROPOSED',
    grants,
  };
  return { ok: true, discovery, scope };
}

function mapReadFailure(error: ProviderError): GithubOnboardingFailure {
  if (error.code === 'CONNECTION_NOT_FOUND' || error.code === 'GITHUB_NOT_FOUND') return 'NOT_FOUND';
  if (error.code === 'CONNECTION_UNAUTHORIZED' || error.code === 'GITHUB_UNAUTHORIZED' || error.code === 'GITHUB_FORBIDDEN') {
    return 'FORBIDDEN';
  }
  return 'NOT_IMPLEMENTED';
}

type RepositoryRead = typeof loadGithubDiscovery;

export async function persistGithubOnboardingDiscovery(
  command: {
    actor: JuryActor;
    connectionId: string;
    now?: string;
    allocateId?: () => string;
  },
  deps?: { readRepositories?: RepositoryRead },
): Promise<
  | { ok: true; created: true; discoveryId: string; scopeId: string }
  | { ok: false; reason: GithubOnboardingFailure }
> {
  const actor = command.actor;
  if (!actor.ok) return { ok: false, reason: actor.reason };
  const allowed = decideJuryMutation({
    actor,
    action: 'discovery.approve',
    resourceTenantId: actor.tenantId,
    clientTenantId: null,
  });
  if (!allowed.ok) return allowed;
  const readRepositories = deps?.readRepositories ?? loadGithubDiscovery;
  const listed = await readRepositories({
    actor,
    connectionId: command.connectionId,
    clientTenantId: null,
    clientPermission: null,
  });
  if (!listed.ok) return { ok: false, reason: mapReadFailure(listed) };
  const now = command.now ?? new Date().toISOString();
  const nextId = command.allocateId ?? randomUUID;
  const { prisma } = await import('@/lib/prisma');
  try {
    return await prisma.$transaction(async (tx) => {
      const connection = await tx.juryServiceConnection.findFirst({
        where: { id: command.connectionId, tenantId: actor.tenantId },
      });
      if (!connection || !isGithubInstallationConnection(connection)) {
        return { ok: false as const, reason: 'NOT_FOUND' as const };
      }
      const mappedConnection: JuryServiceConnection = {
        id: connection.id,
        tenantId: connection.tenantId,
        serviceKey: connection.serviceKey,
        displayName: connection.displayName,
        accessMethod: connection.accessMethod,
        status: connection.status,
        createdAt: connection.createdAt.toISOString(),
        updatedAt: connection.updatedAt.toISOString(),
        ...(connection.credentialRef ? { credentialRef: connection.credentialRef } : {}),
        ...(connection.createdByUserId ? { createdByUserId: connection.createdByUserId } : {}),
      };
      const existing = await tx.juryDiscoveryResult.findFirst({
        where: { tenantId: actor.tenantId, connectionId: connection.id },
        orderBy: { exploredAt: 'desc' },
      });
      const scopes = await tx.juryAccessScope.findMany({
        where: { tenantId: actor.tenantId, connectionId: connection.id },
      });
      const evidenceCount = await tx.juryEvidence.count({
        where: { tenantId: actor.tenantId, connectionId: connection.id },
      });
      const synthetic = existing
        ? isSyntheticMockDiscovery(connection.serviceKey, metricNames(existing.proposedMetrics))
        : false;
      if (evidenceCount > 0 || scopes.length > 1 || scopes.some((scope) => scope.status !== 'PROPOSED')) {
        return { ok: false as const, reason: 'ALREADY_DECIDED' as const };
      }
      if (existing && !synthetic) return { ok: false as const, reason: 'ALREADY_DECIDED' as const };
      const planned = planGithubOnboardingRecord({
        tenantId: actor.tenantId,
        connection: mappedConnection,
        repositories: listed.repositories,
        incomplete: listed.discovery.status === 'PARTIAL',
        now,
        discoveryId: existing?.id ?? nextId(),
        scopeId: scopes[0]?.id ?? nextId(),
      });
      if (!planned.ok) return planned;
      if (existing) {
        await tx.juryDiscoveryResult.update({
          where: { id: existing.id },
          data: discoveryData(planned.discovery),
        });
      } else {
        await tx.juryDiscoveryResult.create({
          data: {
            id: planned.discovery.id,
            tenantId: planned.discovery.tenantId,
            connectionId: planned.discovery.connectionId,
            ...discoveryData(planned.discovery),
          },
        });
      }
      if (scopes[0]) {
        await tx.juryAccessScope.update({
          where: { id: scopes[0].id },
          data: {
            status: 'PROPOSED',
            grants: planned.scope.grants,
            approvedByUserId: null,
            approvedAt: null,
          },
        });
      } else {
        await tx.juryAccessScope.create({
          data: {
            id: planned.scope.id,
            tenantId: planned.scope.tenantId,
            connectionId: planned.scope.connectionId,
            status: 'PROPOSED',
            grants: planned.scope.grants,
          },
        });
      }
      if (synthetic && connection.status === 'DISCOVERY_PENDING') {
        await tx.juryServiceConnection.update({
          where: { id: connection.id },
          data: { status: 'CONNECTED', updatedAt: new Date(now) },
        });
      }
      await tx.juryAuditEvent.create({
        data: {
          id: nextId(),
          tenantId: actor.tenantId,
          timestamp: new Date(now),
          actor: actor.userId,
          action: 'GITHUB_REPOSITORY_DISCOVERED',
          serviceKey: connection.serviceKey,
          accessMethod: 'OAUTH',
          provenance: {
            repositoryCount: planned.discovery.menus.length,
            incomplete: listed.discovery.status === 'PARTIAL',
            readOnly: true,
            replacedSyntheticMock: synthetic,
          },
        },
      });
      return {
        ok: true as const,
        created: true as const,
        discoveryId: planned.discovery.id,
        scopeId: planned.scope.id,
      };
    }, JURY_INTERACTIVE_TRANSACTION);
  } catch {
    return { ok: false, reason: 'STORE_UNAVAILABLE' };
  }
}

function discoveryData(discovery: JuryDiscoveryResult) {
  return {
    exploredAt: new Date(discovery.exploredAt),
    surfaces: discovery.surfaces,
    menus: discovery.menus,
    dataSources: discovery.dataSources,
    feasibility: discovery.feasibility,
    proposedMetrics: discovery.proposedMetrics as Prisma.InputJsonValue,
    approval: discovery.approval,
    uiNotes: discovery.uiNotes ?? null,
  };
}

function metricNames(value: unknown): Array<{ metric: string }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const metric = (item as { metric?: unknown }).metric;
    return typeof metric === 'string' ? [{ metric }] : [];
  });
}
