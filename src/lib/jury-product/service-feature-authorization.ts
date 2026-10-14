/**
 * Feature authorization is Organization Role plus Service Permission.
 * JuryAccessScope, client identity, and URL tenant ids are not inputs.
 */
import { decideJuryMutation, type JuryAction, type JuryActor } from './access';
import type { JuryConsoleView } from './console-view';
import { hasJuryServicePermission, highestServicePermission, type ServiceGrantRow } from './service-member-management';
import type { JuryServicePermission } from './service-permission';

export const SERVICE_FEATURES = [
  'service.read',
  'evidence.read',
  'review.read',
  'review.execute',
  'improvement.read',
  'improvement.write',
  'agent.execute',
] as const;
export type ServiceFeature = (typeof SERVICE_FEATURES)[number];

const FEATURE_POLICY: Record<ServiceFeature, { action: JuryAction; permission: JuryServicePermission }> = {
  'service.read': { action: 'console.read', permission: 'VIEW' },
  'evidence.read': { action: 'console.read', permission: 'VIEW' },
  'review.read': { action: 'review.start', permission: 'REVIEW' },
  'review.execute': { action: 'review.start', permission: 'REVIEW' },
  'improvement.read': { action: 'improvement.write', permission: 'IMPROVE' },
  'improvement.write': { action: 'improvement.write', permission: 'IMPROVE' },
  'agent.execute': { action: 'agent.execute', permission: 'AGENT' },
};

export type FeatureResourceKind = 'service' | 'evidence' | 'review' | 'improvement' | 'agent' | 'changeGate' | 'rereview';

export type FeatureAuthorizationFailure =
  | 'UNAUTHENTICATED'
  | 'NO_MEMBERSHIP'
  | 'FORBIDDEN'
  | 'TENANT_MISMATCH'
  | 'NOT_FOUND';

export function featurePolicy(feature: ServiceFeature): { action: JuryAction; permission: JuryServicePermission } {
  return FEATURE_POLICY[feature];
}

/** Agent permission never approves a change gate or skips re-review or Jury Core. */
export function agentPermissionBypassesPipeline(): false {
  return false;
}

export function authorizeJuryServiceFeature(input: {
  actor: JuryActor;
  membership: { tenantId: string; userId: string } | null;
  connection: { id: string; tenantId: string } | null;
  grants: readonly ServiceGrantRow[];
  feature: ServiceFeature;
  resource?: { kind: FeatureResourceKind; id: string; tenantId: string; connectionId: string } | null;
  clientTenantId?: string | null;
  actingUserId?: string | null;
  actorRole?: string | null;
  permission?: string | null;
  capability?: string | null;
  accessScope?: unknown;
}): { ok: true; servicePermissions: JuryServicePermission[] } | { ok: false; reason: FeatureAuthorizationFailure } {
  void input.clientTenantId;
  void input.actingUserId;
  void input.actorRole;
  void input.permission;
  void input.capability;
  void input.accessScope;
  if (!input.actor.ok) {
    return { ok: false, reason: input.actor.reason === 'UNAUTHENTICATED' ? 'UNAUTHENTICATED' : 'NO_MEMBERSHIP' };
  }
  const actor = input.actor;
  const membership = input.membership;
  const connection = input.connection;
  if (!membership || membership.tenantId !== actor.tenantId || membership.userId !== actor.userId) {
    return { ok: false, reason: 'NO_MEMBERSHIP' };
  }
  if (!connection) return { ok: false, reason: 'NOT_FOUND' };
  if (connection.tenantId !== actor.tenantId) return { ok: false, reason: 'TENANT_MISMATCH' };
  if (input.resource) {
    if (input.resource.tenantId !== actor.tenantId) return { ok: false, reason: 'TENANT_MISMATCH' };
    if (input.resource.connectionId !== connection.id) return { ok: false, reason: 'NOT_FOUND' };
  }
  const policy = FEATURE_POLICY[input.feature];
  const mine = input.grants.filter((grant) =>
    grant.tenantId === actor.tenantId
    && grant.connectionId === connection.id
    && grant.userId === membership.userId);
  const level = highestServicePermission(mine);
  const roleAllowed = decideJuryMutation({
    actor,
    action: policy.action,
    resourceTenantId: actor.tenantId,
    clientTenantId: null,
    servicePermissions: level ? [level] : [],
  });
  if (!roleAllowed.ok) return { ok: false, reason: 'FORBIDDEN' };
  const permitted = hasJuryServicePermission({
    membership,
    connection,
    grants: mine,
    required: policy.permission,
  });
  if (!permitted || !level) return { ok: false, reason: 'FORBIDDEN' };
  return { ok: true, servicePermissions: [level] };
}

export function restrictJuryConsole(
  view: JuryConsoleView,
  actor: Extract<JuryActor, { ok: true }>,
  grants: readonly ServiceGrantRow[],
): JuryConsoleView {
  const membership = { tenantId: actor.tenantId, userId: actor.userId };
  const connectionById = new Map(view.connections.filter((row) => row.tenantId === actor.tenantId).map((row) => [row.id, row]));
  const requestConnection = new Map(view.requests.map((row) => [row.id, row.connectionId]));
  const resultConnection = new Map(view.results.map((row) => [row.id, requestConnection.get(row.reviewRequestId) ?? '']));
  const taskConnection = new Map(view.tasks.map((row) => [row.id, resultConnection.get(row.reviewResultId) ?? '']));
  const executionConnection = new Map(view.executions.map((row) => [row.id, taskConnection.get(row.taskId) ?? '']));
  const allowed = (feature: ServiceFeature, connectionId: string) => {
    const connection = connectionById.get(connectionId);
    return authorizeJuryServiceFeature({
      actor,
      membership,
      connection: connection ? { id: connection.id, tenantId: connection.tenantId } : null,
      grants,
      feature,
    }).ok;
  };
  return {
    ...view,
    connections: view.connections,
    scopes: view.scopes,
    discoveries: view.discoveries,
    audit: view.audit,
    metrics: view.metrics.filter((row) => row.tenantId === actor.tenantId && allowed('service.read', row.connectionId)),
    evidence: view.evidence.filter((row) => row.tenantId === actor.tenantId && allowed('evidence.read', row.connectionId)),
    requests: view.requests.filter((row) => row.tenantId === actor.tenantId && allowed('review.read', row.connectionId)),
    results: view.results.filter((row) => row.tenantId === actor.tenantId && allowed('review.read', resultConnection.get(row.id) ?? '')),
    tasks: view.tasks.filter((row) => row.tenantId === actor.tenantId && allowed('improvement.read', taskConnection.get(row.id) ?? '')),
    executions: view.executions.filter((row) => row.tenantId === actor.tenantId && allowed('agent.execute', executionConnection.get(row.id) ?? '')),
    gates: view.gates.filter((row) => row.tenantId === actor.tenantId && allowed('agent.execute', executionConnection.get(row.executionId) ?? '')),
    reReviews: view.reReviews.filter((row) => row.tenantId === actor.tenantId && allowed('review.read', taskConnection.get(row.taskId) ?? '')),
  };
}
