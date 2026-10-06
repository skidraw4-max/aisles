/**
 * Service onboarding over the existing connection, mock discovery, and scope contract.
 * MockDiscoveryAdapter is runMockDiscovery. It does not open a network connection.
 */
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { decideJuryMutation, type JuryActor } from './access';
import { createAccessContext, type AccessFailure } from './access-layer';
import { containsSecret } from './agent-execution';
import type { JuryConsoleView } from './console-view';
import { planServiceTarget, runMockDiscovery, runScopeDecision, type DiscoveryFailure, type DiscoveryTx } from './discovery';
import {
  JURY_ACCESS_METHODS,
  type JuryAccessMethod,
  type JuryAccessScope,
  type JuryApproval,
  type JuryConnectionStatus,
  type JuryDiscoveryResult,
  type JuryScopeStatus,
  type JuryServiceConnection,
} from './records';

async function openTx<T>(
  run: (tx: Prisma.TransactionClient, bindDiscoveryTx: (tx: Prisma.TransactionClient) => DiscoveryTx) => Promise<T>,
): Promise<T> {
  const [{ prisma }, { bindDiscoveryTx }] = await Promise.all([import('@/lib/prisma'), import('./jury-db')]);
  return prisma.$transaction((tx) => run(tx, bindDiscoveryTx));
}

export const MOCK_ONBOARDING_ADAPTER = 'mock';

export const ONBOARDING_EMPTY_SCOPES = 'No access scopes proposed.';

export const MOCK_ONBOARDING_SERVICE = {
  adapterKey: MOCK_ONBOARDING_ADAPTER,
  label: 'Mock service',
  description: 'MockDiscoveryAdapter만 사용합니다. 외부 네트워크와 secret은 사용하지 않습니다.',
} as const;

export type OnboardingFailure = DiscoveryFailure | 'SNAPSHOT_UNSAFE' | AccessFailure;

export function screenCredentialRef(
  value: string,
): { ok: true; credentialRef: string } | { ok: false; reason: 'KEY_REQUIRED' | 'SNAPSHOT_UNSAFE' } {
  const credentialRef = value.trim();
  if (credentialRef.length === 0) return { ok: false, reason: 'KEY_REQUIRED' };
  if (containsSecret(credentialRef)) return { ok: false, reason: 'SNAPSHOT_UNSAFE' };
  return { ok: true, credentialRef };
}

export function displayCredentialRef(value: string | undefined): string {
  if (!value) return 'Not available';
  if (containsSecret(value)) return 'REDACTED';
  return value;
}

export type ServiceOnboardingRow = {
  id: string;
  displayName: string;
  accessMethod: JuryAccessMethod;
  status: JuryConnectionStatus;
  createdAt: string;
  updatedAt: string;
  discoveryStatus: string;
  scopeStatus: string;
};

export function projectServiceRows(view: JuryConsoleView): ServiceOnboardingRow[] {
  return view.connections
    .filter((row) => row.tenantId === view.tenantId)
    .map((connection) => {
      const discovery = view.discoveries.find(
        (row) => row.connectionId === connection.id && row.tenantId === view.tenantId,
      );
      const scopes = view.scopes.filter((row) => row.connectionId === connection.id && row.tenantId === view.tenantId);
      return {
        id: connection.id,
        displayName: connection.displayName,
        accessMethod: connection.accessMethod,
        status: connection.status,
        createdAt: connection.createdAt,
        updatedAt: connection.updatedAt,
        discoveryStatus: discovery?.approval ?? 'Not started',
        scopeStatus: scopes.length === 0 ? ONBOARDING_EMPTY_SCOPES : scopes.map((row) => row.status).join(', '),
      };
    });
}

export type ServiceOnboardingDetail = {
  connection: JuryServiceConnection;
  discovery: JuryDiscoveryResult | null;
  scopes: JuryAccessScope[];
  discoveryStatus: string;
  scopeStatus: string;
  credentialLabel: string;
  canOpenEvidence: boolean;
};

export function projectServiceOnboarding(view: JuryConsoleView, connectionId: string): ServiceOnboardingDetail | null {
  const connection = view.connections.find((row) => row.id === connectionId && row.tenantId === view.tenantId) ?? null;
  if (!connection) return null;
  const discovery = view.discoveries.find((row) => row.connectionId === connection.id && row.tenantId === view.tenantId) ?? null;
  const scopes = view.scopes.filter((row) => row.connectionId === connection.id && row.tenantId === view.tenantId);
  return {
    connection,
    discovery,
    scopes,
    discoveryStatus: discovery?.approval ?? 'Not started',
    scopeStatus: scopes.length === 0 ? ONBOARDING_EMPTY_SCOPES : scopes.map((row) => row.status).join(', '),
    credentialLabel: displayCredentialRef(connection.credentialRef),
    canOpenEvidence: connection.status === 'CONNECTED',
  };
}

export function scopePurpose(resource: string, discovery: JuryDiscoveryResult | null): string {
  const metric = resource.startsWith('metric:') ? resource.slice('metric:'.length) : resource;
  return discovery?.proposedMetrics.find((item) => item.metric === metric)?.reason ?? 'Not available';
}

type ConnectionCommand = {
  actor: JuryActor;
  serviceKey: string;
  displayName: string;
  accessMethod: JuryAccessMethod;
  credentialRef: string;
  adapterKey?: string;
  clientTenantId?: string | null;
  now?: string;
  allocateId?: () => string;
};

export async function persistServiceOnboarding(
  command: ConnectionCommand,
): Promise<
  | { ok: true; created: boolean; connectionId: string; status: JuryConnectionStatus }
  | { ok: false; reason: OnboardingFailure }
> {
  const actor = command.actor;
  if (!actor.ok) return { ok: false, reason: actor.reason };
  const allowed = decideJuryMutation({
    actor,
    action: 'connection.write',
    resourceTenantId: actor.tenantId,
    clientTenantId: command.clientTenantId,
  });
  if (!allowed.ok) return allowed;
  if ((command.adapterKey ?? MOCK_ONBOARDING_ADAPTER) !== MOCK_ONBOARDING_ADAPTER) {
    return { ok: false, reason: 'NOT_IMPLEMENTED' };
  }
  if (!(JURY_ACCESS_METHODS as readonly string[]).includes(command.accessMethod)) {
    return { ok: false, reason: 'NOT_IMPLEMENTED' };
  }
  const screened = screenCredentialRef(command.credentialRef);
  if (!screened.ok) return screened;
  const planned = planServiceTarget({
    actor,
    serviceKey: command.serviceKey,
    displayName: command.displayName,
    accessMethod: command.accessMethod,
    clientTenantId: command.clientTenantId,
    now: command.now,
  });
  if (!planned.ok) return planned;
  const now = planned.connection.createdAt;
  return openTx(async (tx) => {
    const locked = await tx.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT id FROM "JuryTenant" WHERE id = ${actor.tenantId} FOR UPDATE`,
    );
    if (locked.length === 0) return { ok: false as const, reason: 'NOT_FOUND' as const };
    const existing = await tx.juryServiceConnection.findFirst({
      where: { tenantId: actor.tenantId, serviceKey: planned.connection.serviceKey },
    });
    if (existing && existing.tenantId === actor.tenantId) {
      return {
        ok: true as const,
        created: false,
        connectionId: existing.id,
        status: existing.status,
      };
    }
    const id = command.allocateId?.() ?? randomUUID();
    await tx.juryServiceConnection.create({
      data: {
        id,
        tenantId: actor.tenantId,
        serviceKey: planned.connection.serviceKey,
        displayName: planned.connection.displayName,
        accessMethod: planned.connection.accessMethod,
        status: planned.connection.status,
        credentialRef: screened.credentialRef,
        createdByUserId: actor.userId,
        createdAt: new Date(now),
        updatedAt: new Date(now),
      },
    });
    await tx.juryAuditEvent.create({
      data: {
        id: randomUUID(),
        tenantId: actor.tenantId,
        timestamp: new Date(now),
        actor: actor.userId,
        action: 'SERVICE_CONNECTION_CREATED',
        serviceKey: planned.connection.serviceKey,
        accessMethod: planned.connection.accessMethod,
      },
    });
    return { ok: true as const, created: true, connectionId: id, status: planned.connection.status };
  });
}

export async function persistOnboardingDiscovery(command: {
  actor: JuryActor;
  connectionId: string;
  clientTenantId?: string | null;
  now?: string;
  allocateId?: () => string;
}): Promise<
  | { ok: true; created: true; discoveryId: string; scopeId: string }
  | { ok: false; reason: OnboardingFailure }
> {
  const actor = command.actor;
  if (!actor.ok) return { ok: false, reason: actor.reason };
  const allowed = decideJuryMutation({
    actor,
    action: 'discovery.approve',
    resourceTenantId: actor.tenantId,
    clientTenantId: command.clientTenantId,
  });
  if (!allowed.ok) return allowed;
  return openTx(async (tx, bindDiscoveryTx) => {
    const bound = bindDiscoveryTx(tx);
    const connection = await bound.findConnection(actor.tenantId, command.connectionId);
    if (!connection) return { ok: false as const, reason: 'NOT_FOUND' as const };
    const existing = await bound.findDiscovery(actor.tenantId, connection.id);
    if (existing) return { ok: false as const, reason: 'ALREADY_DECIDED' as const };
    const now = command.now ?? new Date().toISOString();
    const nextId = command.allocateId ?? randomUUID;
    await tx.juryAuditEvent.create({
      data: {
        id: nextId(),
        tenantId: actor.tenantId,
        timestamp: new Date(now),
        actor: actor.userId,
        action: 'SERVICE_DISCOVERY_STARTED',
        serviceKey: connection.serviceKey,
        accessMethod: connection.accessMethod,
      },
    });
    const outcome = await runMockDiscovery(
      {
        actor,
        connectionId: connection.id,
        clientTenantId: command.clientTenantId,
        allocateId: nextId,
        now,
      },
      bound,
    );
    if (!outcome.ok) return outcome;
    return { ok: true as const, created: true as const, discoveryId: outcome.discovery.id, scopeId: outcome.scope.id };
  });
}

export async function persistOnboardingScopeDecision(command: {
  actor: JuryActor;
  scopeId: string;
  decision: 'APPROVE' | 'REJECT';
  clientTenantId?: string | null;
  now?: string;
}): Promise<
  | {
      ok: true;
      connectionId: string;
      scopeStatus: JuryScopeStatus;
      discoveryApproval: JuryApproval;
      connectionStatus: JuryConnectionStatus;
      activated: boolean;
      auditAction: 'SCOPE_APPROVED' | 'SCOPE_REVOKED';
    }
  | { ok: false; reason: OnboardingFailure }
> {
  const actor = command.actor;
  if (!actor.ok) return { ok: false, reason: actor.reason };
  const allowed = decideJuryMutation({
    actor,
    action: 'scope.write',
    resourceTenantId: actor.tenantId,
    clientTenantId: command.clientTenantId,
  });
  if (!allowed.ok) return allowed;
  return openTx(async (tx, bindDiscoveryTx) => {
    const scopeRow = await tx.juryAccessScope.findFirst({
      where: { id: command.scopeId, tenantId: actor.tenantId },
      select: { id: true, connectionId: true },
    });
    if (!scopeRow) return { ok: false as const, reason: 'NOT_FOUND' as const };
    await tx.$queryRaw(
      Prisma.sql`SELECT id FROM "JuryServiceConnection" WHERE id = ${scopeRow.connectionId} AND "tenantId" = ${actor.tenantId} FOR UPDATE`,
    );
    await tx.$queryRaw(
      Prisma.sql`SELECT id FROM "JuryAccessScope" WHERE id = ${command.scopeId} AND "tenantId" = ${actor.tenantId} FOR UPDATE`,
    );
    const bound = bindDiscoveryTx(tx);
    const decision = await runScopeDecision(
      {
        actor,
        scopeId: command.scopeId,
        decision: command.decision,
        clientTenantId: command.clientTenantId,
        now: command.now,
      },
      bound,
    );
    if (!decision.ok) return decision;
    const auditAction = decision.audit.action;
    if (auditAction !== 'SCOPE_APPROVED' && auditAction !== 'SCOPE_REVOKED') {
      return { ok: false as const, reason: 'NOT_FOUND' as const };
    }
    const connection = await tx.juryServiceConnection.findFirst({
      where: { id: scopeRow.connectionId, tenantId: actor.tenantId },
    });
    if (!connection || connection.tenantId !== actor.tenantId) return { ok: false as const, reason: 'NOT_FOUND' as const };
    const scopes = await tx.juryAccessScope.findMany({
      where: { tenantId: actor.tenantId, connectionId: connection.id },
    });
    const activation = await activateIfReady(tx, actor, connection, scopes, decision.scope.status, command.now);
    return {
      ok: true as const,
      connectionId: connection.id,
      scopeStatus: decision.scope.status,
      discoveryApproval: decision.discovery.approval,
      connectionStatus: activation.status,
      activated: activation.activated,
      auditAction,
    };
  });
}

async function activateIfReady(
  tx: Prisma.TransactionClient,
  actor: Extract<JuryActor, { ok: true }>,
  connection: {
    id: string;
    tenantId: string;
    serviceKey: string;
    displayName: string;
    accessMethod: JuryAccessMethod;
    status: JuryConnectionStatus;
    credentialRef: string | null;
  },
  scopes: Array<{ id: string; tenantId: string; connectionId: string; status: JuryScopeStatus; grants: unknown }>,
  decidedStatus: JuryScopeStatus,
  now: string | undefined,
): Promise<{ status: JuryConnectionStatus; activated: boolean }> {
  if (decidedStatus !== 'APPROVED' || scopes.length === 0 || scopes.some((row) => row.status !== 'APPROVED')) {
    return { status: connection.status, activated: false };
  }
  const grants = scopes.flatMap((row) => readableGrants(row.grants) ?? []);
  if (grants.length === 0 || scopes.some((row) => readableGrants(row.grants) == null)) {
    return { status: connection.status, activated: false };
  }
  const credentialRef = connection.credentialRef?.trim() ?? '';
  if (containsSecret(credentialRef)) return { status: connection.status, activated: false };
  const issued = createAccessContext({
    actor,
    clientTenantId: null,
    connection: {
      id: connection.id,
      tenantId: connection.tenantId,
      serviceKey: connection.serviceKey,
      accessMethod: connection.accessMethod,
      status: 'CONNECTED',
      ...(credentialRef ? { credentialRef } : {}),
    },
    scope: {
      id: scopes[0]!.id,
      tenantId: actor.tenantId,
      connectionId: connection.id,
      status: 'APPROVED',
      grants: readableGrants(scopes[0]!.grants) ?? [],
    },
  });
  if (!issued.ok) return { status: connection.status, activated: false };
  if (connection.status === 'CONNECTED') return { status: 'CONNECTED', activated: true };
  const timestamp = now ?? new Date().toISOString();
  await tx.juryServiceConnection.update({
    where: { id: connection.id },
    data: { status: 'CONNECTED' },
  });
  await tx.juryAuditEvent.create({
    data: {
      id: randomUUID(),
      tenantId: actor.tenantId,
      timestamp: new Date(timestamp),
      actor: actor.userId,
      action: 'SERVICE_CONNECTION_ACTIVATED',
      serviceKey: connection.serviceKey,
      accessMethod: connection.accessMethod,
    },
  });
  return { status: 'CONNECTED', activated: true };
}

function readableGrants(value: unknown): Array<{ resource: string; mode: 'READ' }> | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const grants = value.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const record = item as Record<string, unknown>;
    if (typeof record.resource !== 'string' || record.resource.trim().length === 0 || record.mode !== 'READ') return [];
    return [{ resource: record.resource, mode: 'READ' as const }];
  });
  if (grants.length !== value.length) return null;
  return grants;
}
