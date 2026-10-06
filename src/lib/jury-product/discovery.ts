/**
 * Discovery proposes what a service might expose.
 * It does not measure metrics and it does not open a network connection.
 */
import { randomUUID } from 'node:crypto';
import type { JuryActor } from './access';
import type {
  JuryAccessMethod,
  JuryAccessScope,
  JuryApproval,
  JuryDiscoveryResult,
  JuryScopeStatus,
  JuryServiceConnection,
} from './records';

export type DiscoveryFailure =
  | 'UNAUTHENTICATED'
  | 'NO_MEMBERSHIP'
  | 'AMBIGUOUS_MEMBERSHIP'
  | 'STORE_UNAVAILABLE'
  | 'FORBIDDEN'
  | 'TENANT_MISMATCH'
  | 'NOT_FOUND'
  | 'ALREADY_DECIDED'
  | 'KEY_REQUIRED'
  | 'SCOPE_NOT_APPROVED'
  | 'NOT_IMPLEMENTED';

export type DiscoveryAudit = {
  tenantId: string;
  actorUserId: string;
  action: 'DISCOVERY_RECORDED' | 'SCOPE_PROPOSED' | 'SCOPE_APPROVED' | 'SCOPE_REVOKED';
  connectionId: string;
  scopeId?: string;
  discoveryId?: string;
};

const SURFACES = ['FRONTEND', 'ADMIN', 'BO', 'API'] as const;
const DATA_SOURCES = ['API', 'SCREEN', 'FILE', 'STATS'] as const;

function ownerOnly(actor: JuryActor): { ok: false; reason: DiscoveryFailure } | null {
  if (!actor.ok) return { ok: false, reason: actor.reason };
  if (actor.role !== 'OWNER') return { ok: false, reason: 'FORBIDDEN' };
  return null;
}

export function buildMockDiscovery(input: {
  actorTenantId: string;
  connection: JuryServiceConnection;
  clientTenantId?: string | null;
  now?: string;
  allocateId?: () => string;
}):
  | { ok: true; discovery: JuryDiscoveryResult; scope: JuryAccessScope }
  | { ok: false; reason: 'TENANT_MISMATCH' } {
  void input.clientTenantId;
  if (input.connection.tenantId !== input.actorTenantId) return { ok: false, reason: 'TENANT_MISMATCH' };
  const now = input.now ?? '2026-10-01T00:00:00.000Z';
  const nextId = input.allocateId ?? randomUUID;
  const proposedMetrics = [
    { metric: `${input.connection.serviceKey}.routes`, reason: '화면 route 후보. 측정하지 않음.' },
    { metric: `${input.connection.serviceKey}.api`, reason: 'API 자원 후보. 측정하지 않음.' },
  ];
  const discovery: JuryDiscoveryResult = {
    id: nextId(),
    tenantId: input.actorTenantId,
    connectionId: input.connection.id,
    exploredAt: now,
    surfaces: [...SURFACES],
    menus: [`/${input.connection.serviceKey}`, '/admin', '/bo', '/api'],
    dataSources: [...DATA_SOURCES],
    feasibility: 'PARTIAL',
    proposedMetrics,
    approval: 'PENDING',
    uiNotes: 'UI/UX 후보 surface. 화면과 수치는 수집하지 않음.',
  };
  const scope: JuryAccessScope = {
    id: nextId(),
    tenantId: input.actorTenantId,
    connectionId: input.connection.id,
    status: 'PROPOSED',
    grants: proposedMetrics.map((item) => ({ resource: `metric:${item.metric}`, mode: 'READ' as const })),
  };
  return { ok: true, discovery, scope };
}

export function planScopeDecision(input: {
  actor: JuryActor;
  scope: JuryAccessScope;
  discovery: JuryDiscoveryResult;
  decision: 'APPROVE' | 'REJECT';
  clientTenantId?: string | null;
}):
  | { ok: true; scope: JuryAccessScope; discovery: JuryDiscoveryResult; audit: DiscoveryAudit }
  | { ok: false; reason: DiscoveryFailure } {
  void input.clientTenantId;
  const denied = ownerOnly(input.actor);
  if (denied) return denied;
  if (!input.actor.ok) return { ok: false, reason: 'FORBIDDEN' };
  if (input.scope.tenantId !== input.actor.tenantId || input.discovery.tenantId !== input.actor.tenantId) {
    return { ok: false, reason: 'TENANT_MISMATCH' };
  }
  if (input.scope.status !== 'PROPOSED' || input.discovery.approval !== 'PENDING') {
    return { ok: false, reason: 'ALREADY_DECIDED' };
  }
  if (input.decision === 'APPROVE') {
    return {
      ok: true,
      scope: { ...input.scope, status: 'APPROVED', approvedByUserId: input.actor.userId, approvedAt: input.discovery.exploredAt },
      discovery: { ...input.discovery, approval: 'APPROVED' },
      audit: {
        tenantId: input.actor.tenantId,
        actorUserId: input.actor.userId,
        action: 'SCOPE_APPROVED',
        connectionId: input.scope.connectionId,
        scopeId: input.scope.id,
        discoveryId: input.discovery.id,
      },
    };
  }
  return {
    ok: true,
    scope: { ...input.scope, status: 'REVOKED' },
    discovery: { ...input.discovery, approval: 'REJECTED' },
    audit: {
      tenantId: input.actor.tenantId,
      actorUserId: input.actor.userId,
      action: 'SCOPE_REVOKED',
      connectionId: input.scope.connectionId,
      scopeId: input.scope.id,
      discoveryId: input.discovery.id,
    },
  };
}

export function planMetricCollection(input: {
  actor: JuryActor;
  scope: JuryAccessScope | null;
  clientTenantId?: string | null;
}): { ok: false; reason: DiscoveryFailure } {
  void input.clientTenantId;
  if (!input.actor.ok) return { ok: false, reason: input.actor.reason };
  if (!input.scope || input.scope.status !== 'APPROVED') return { ok: false, reason: 'SCOPE_NOT_APPROVED' };
  if (input.scope.tenantId !== input.actor.tenantId) return { ok: false, reason: 'TENANT_MISMATCH' };
  return { ok: false, reason: 'NOT_IMPLEMENTED' };
}

export function planServiceTarget(input: {
  actor: JuryActor;
  serviceKey: string;
  displayName: string;
  accessMethod: JuryAccessMethod;
  credentialRef?: string | null;
  clientTenantId?: string | null;
  allocateId?: () => string;
  now?: string;
}): { ok: true; connection: JuryServiceConnection } | { ok: false; reason: DiscoveryFailure } {
  void input.clientTenantId;
  void input.credentialRef;
  const denied = ownerOnly(input.actor);
  if (denied) return denied;
  if (!input.actor.ok) return { ok: false, reason: 'FORBIDDEN' };
  if (input.serviceKey.trim().length === 0 || input.displayName.trim().length === 0) {
    return { ok: false, reason: 'KEY_REQUIRED' };
  }
  const now = input.now ?? '2026-10-01T00:00:00.000Z';
  return {
    ok: true,
    connection: {
      id: input.allocateId?.() ?? 'conn-created',
      tenantId: input.actor.tenantId,
      serviceKey: input.serviceKey.trim(),
      displayName: input.displayName.trim(),
      accessMethod: input.accessMethod,
      status: 'DISCOVERY_PENDING',
      createdByUserId: input.actor.userId,
      createdAt: now,
      updatedAt: now,
    },
  };
}

export type DiscoveryTx = {
  findConnection(tenantId: string, connectionId: string): Promise<JuryServiceConnection | null>;
  insertDiscovery(row: JuryDiscoveryResult): Promise<void>;
  insertScope(row: JuryAccessScope): Promise<void>;
  updateConnectionStatus(id: string, status: JuryServiceConnection['status']): Promise<void>;
  findScope(tenantId: string, scopeId: string): Promise<JuryAccessScope | null>;
  findDiscovery(tenantId: string, connectionId: string): Promise<JuryDiscoveryResult | null>;
  updateScope(id: string, status: JuryScopeStatus, approvedByUserId?: string, approvedAt?: string): Promise<void>;
  updateDiscoveryApproval(id: string, approval: JuryApproval): Promise<void>;
  appendAudit(event: DiscoveryAudit & { id: string; timestamp: string }): Promise<void>;
};

export async function runMockDiscovery(
  command: {
    actor: JuryActor;
    connectionId: string;
    clientTenantId?: string | null;
    allocateId?: () => string;
    now?: string;
  },
  tx: DiscoveryTx,
): Promise<{ ok: true; discovery: JuryDiscoveryResult; scope: JuryAccessScope } | { ok: false; reason: DiscoveryFailure }> {
  const denied = ownerOnly(command.actor);
  if (denied) return denied;
  if (!command.actor.ok) return { ok: false, reason: 'FORBIDDEN' };
  const connection = await tx.findConnection(command.actor.tenantId, command.connectionId);
  if (!connection) return { ok: false, reason: 'NOT_FOUND' };
  const existing = await tx.findDiscovery(command.actor.tenantId, connection.id);
  if (existing) return { ok: false, reason: 'ALREADY_DECIDED' };
  const draft = buildMockDiscovery({
    actorTenantId: command.actor.tenantId,
    connection,
    clientTenantId: command.clientTenantId,
    now: command.now,
    allocateId: command.allocateId,
  });
  if (!draft.ok) return draft;
  const nextId = command.allocateId ?? randomUUID;
  const timestamp = draft.discovery.exploredAt;
  await tx.insertDiscovery(draft.discovery);
  await tx.insertScope(draft.scope);
  await tx.updateConnectionStatus(connection.id, 'DISCOVERY_PENDING');
  await tx.appendAudit({
    id: nextId(),
    timestamp,
    tenantId: command.actor.tenantId,
    actorUserId: command.actor.userId,
    action: 'DISCOVERY_RECORDED',
    connectionId: connection.id,
    discoveryId: draft.discovery.id,
    scopeId: draft.scope.id,
  });
  await tx.appendAudit({
    id: nextId(),
    timestamp,
    tenantId: command.actor.tenantId,
    actorUserId: command.actor.userId,
    action: 'SCOPE_PROPOSED',
    connectionId: connection.id,
    discoveryId: draft.discovery.id,
    scopeId: draft.scope.id,
  });
  return draft;
}

export async function runScopeDecision(
  command: {
    actor: JuryActor;
    scopeId: string;
    decision: 'APPROVE' | 'REJECT';
    clientTenantId?: string | null;
    now?: string;
  },
  tx: DiscoveryTx,
): Promise<ReturnType<typeof planScopeDecision>> {
  const denied = ownerOnly(command.actor);
  if (denied) return denied;
  if (!command.actor.ok) return { ok: false, reason: 'FORBIDDEN' };
  const scope = await tx.findScope(command.actor.tenantId, command.scopeId);
  if (!scope) return { ok: false, reason: 'NOT_FOUND' };
  const discovery = await tx.findDiscovery(command.actor.tenantId, scope.connectionId);
  if (!discovery) return { ok: false, reason: 'NOT_FOUND' };
  const decision = planScopeDecision({
    actor: command.actor,
    scope,
    discovery,
    decision: command.decision,
    clientTenantId: command.clientTenantId,
  });
  if (!decision.ok) return decision;
  const timestamp = command.now ?? new Date().toISOString();
  await tx.updateScope(decision.scope.id, decision.scope.status, decision.scope.approvedByUserId, decision.scope.approvedAt);
  await tx.updateDiscoveryApproval(decision.discovery.id, decision.discovery.approval);
  await tx.appendAudit({ ...decision.audit, id: randomUUID(), timestamp });
  return decision;
}
