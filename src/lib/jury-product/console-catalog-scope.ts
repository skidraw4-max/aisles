/**
 * Catalog metric scopes for the console.
 * Mock discovery placeholders are not renamed or approved here.
 */
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { decideJuryMutation, resolveJuryActor, type JuryActor } from './access';
import { containsSecret } from './agent-execution';
import type { JuryConsoleView } from './console-view';
import {
  JURY_PROJECTABLE_DB_METRICS,
  JURY_PROJECTABLE_GA4_METRICS,
} from './projection';
import { isCatalogMetric } from './tenant-evidence-intake';
import type { JuryAccessGrant, JuryAccessScope, JuryMembership } from './records';

export const CATALOG_SCOPE_PURPOSE = 'catalog-metric-scope';
export const CATALOG_SCOPE_TIMEZONE = 'Asia/Seoul';
export const CONSOLE_CATALOG_METRICS = [
  ...JURY_PROJECTABLE_DB_METRICS,
  ...JURY_PROJECTABLE_GA4_METRICS,
] as const;

export type CatalogScopeFailure =
  | 'UNAUTHENTICATED'
  | 'NO_MEMBERSHIP'
  | 'AMBIGUOUS_MEMBERSHIP'
  | 'STORE_UNAVAILABLE'
  | 'FORBIDDEN'
  | 'TENANT_MISMATCH'
  | 'NOT_FOUND'
  | 'METRIC_NOT_IN_CATALOG'
  | 'ALREADY_DECIDED'
  | 'CREDENTIAL_IN_REASON'
  | 'PERSISTENCE_FAILED';

export type CatalogScopeCommand = {
  userId: string | null;
  memberships: readonly JuryMembership[];
  clientTenantId?: string | null;
  connectionId: string;
  metric: string;
  now: string;
};

export type CatalogScopeDecisionCommand = {
  userId: string | null;
  memberships: readonly JuryMembership[];
  clientTenantId?: string | null;
  scopeId: string;
  decision: 'APPROVE' | 'REJECT';
  now: string;
};

export type CatalogScopeForm = {
  visible: boolean;
  metrics: string[];
  connections: Array<{ id: string; label: string }>;
  pending: Array<{ scopeId: string; connectionId: string; label: string; metrics: string[] }>;
};

type CatalogActor = Extract<JuryActor, { ok: true }>;

export function projectCatalogScopeForm(
  actor: JuryActor,
  view: Pick<JuryConsoleView, 'connections' | 'scopes'>,
): CatalogScopeForm {
  const empty: CatalogScopeForm = { visible: false, metrics: [], connections: [], pending: [] };
  if (!actor.ok) return empty;
  const allowed = decideJuryMutation({
    actor,
    action: 'scope.write',
    resourceTenantId: actor.tenantId,
  }).ok;
  if (!allowed) return empty;
  const connections = view.connections
    .filter((row) => row.tenantId === actor.tenantId)
    .map((row) => ({ id: row.id, label: row.displayName }));
  const pending = view.scopes.flatMap((scope) => {
    if (scope.status !== 'PROPOSED' || scope.tenantId !== actor.tenantId) return [];
    const names = catalogNames(scope.grants);
    if (!names) return [];
    const connection = connections.find((row) => row.id === scope.connectionId);
    if (!connection) return [];
    return [{
      scopeId: scope.id,
      connectionId: scope.connectionId,
      label: `${connection.label} / ${names.join(', ')}`,
      metrics: names,
    }];
  });
  return {
    visible: true,
    metrics: [...CONSOLE_CATALOG_METRICS],
    connections,
    pending,
  };
}

export function scopeForDiscovery(
  discovery: { tenantId: string; connectionId: string; proposedMetrics: readonly { metric: string }[] },
  scopes: readonly JuryAccessScope[],
): JuryAccessScope | null {
  const expected = discovery.proposedMetrics.map((item) => `metric:${item.metric}`).sort().join('\n');
  return scopes.find((scope) => {
    if (scope.tenantId !== discovery.tenantId || scope.connectionId !== discovery.connectionId) return false;
    const resources = scope.grants.map((grant) => grant.resource).sort().join('\n');
    return resources === expected;
  }) ?? null;
}

export function catalogScopeCode(
  result: { ok: true; created?: boolean; status?: string } | { ok: false; reason: string },
): string {
  if (!result.ok) {
    const known = new Set<string>([
      'UNAUTHENTICATED',
      'NO_MEMBERSHIP',
      'AMBIGUOUS_MEMBERSHIP',
      'STORE_UNAVAILABLE',
      'FORBIDDEN',
      'TENANT_MISMATCH',
      'NOT_FOUND',
      'METRIC_NOT_IN_CATALOG',
      'ALREADY_DECIDED',
      'CREDENTIAL_IN_REASON',
      'PERSISTENCE_FAILED',
    ]);
    return known.has(result.reason) ? result.reason : 'PERSISTENCE_FAILED';
  }
  if (result.created === false) return 'CATALOG_SCOPE_REUSED';
  if (result.status === 'REVOKED') return 'SCOPE_REVOKED';
  if (result.status === 'APPROVED') return 'SCOPE_APPROVED';
  return 'CATALOG_SCOPE_PROPOSED';
}

export async function persistCatalogScope(
  command: CatalogScopeCommand,
): Promise<{ ok: true; created: boolean; scopeId: string; status: 'PROPOSED' | 'APPROVED'; grants: JuryAccessGrant[] } | { ok: false; reason: CatalogScopeFailure }> {
  const auth = authorize(command);
  if (!auth.ok) return auth;
  if (containsSecret({ connectionId: command.connectionId, metric: command.metric })) {
    return { ok: false, reason: 'CREDENTIAL_IN_REASON' };
  }
  if (!isCatalogMetric(command.metric) || !(CONSOLE_CATALOG_METRICS as readonly string[]).includes(command.metric)) {
    return { ok: false, reason: 'METRIC_NOT_IN_CATALOG' };
  }
  if (!command.connectionId.trim() || Number.isNaN(new Date(command.now).getTime())) {
    return { ok: false, reason: 'NOT_FOUND' };
  }
  try {
    const { prisma } = await import('@/lib/prisma');
    return await prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>(
        Prisma.sql`SELECT id FROM "JuryServiceConnection" WHERE id = ${command.connectionId} AND "tenantId" = ${auth.actor.tenantId} FOR UPDATE`,
      );
      if (!locked[0]) return { ok: false as const, reason: 'NOT_FOUND' as const };
      const rows = await tx.juryAccessScope.findMany({
        where: { tenantId: auth.actor.tenantId, connectionId: command.connectionId },
      });
      const scopes = rows.flatMap((row) => {
        const grants = asGrants(row.grants);
        if (!grants) return [];
        return [{ id: row.id, status: row.status, grants }];
      });
      const resource = `metric:${command.metric}`;
      const held = scopes.find((scope) => (
        (scope.status === 'PROPOSED' || scope.status === 'APPROVED')
        && scope.grants.some((grant) => grant.resource === resource)
        && catalogNames(scope.grants)
      ));
      if (held && (held.status === 'PROPOSED' || held.status === 'APPROVED')) {
        return { ok: true as const, created: false, scopeId: held.id, status: held.status, grants: held.grants };
      }
      const open = scopes.find((scope) => scope.status === 'PROPOSED' && catalogNames(scope.grants));
      const grants = [...(open?.grants ?? []), { resource, mode: 'READ' as const }]
        .sort((left, right) => left.resource.localeCompare(right.resource));
      const scopeId = open?.id ?? sha([auth.actor.tenantId, command.connectionId, CATALOG_SCOPE_PURPOSE, command.metric, String(scopes.length)]);
      if (open) {
        await tx.juryAccessScope.update({ where: { id: scopeId }, data: { grants } });
      } else {
        await tx.juryAccessScope.create({
          data: {
            id: scopeId,
            tenantId: auth.actor.tenantId,
            connectionId: command.connectionId,
            status: 'PROPOSED',
            grants,
          },
        });
      }
      const auditId = sha([auth.actor.tenantId, 'SCOPE_PROPOSED', scopeId, command.metric]);
      const audit = await tx.juryAuditEvent.findUnique({ where: { id: auditId }, select: { id: true } });
      if (!audit) {
        await tx.juryAuditEvent.create({
          data: {
            id: auditId,
            tenantId: auth.actor.tenantId,
            timestamp: new Date(command.now),
            actor: auth.actor.userId,
            action: 'SCOPE_PROPOSED',
            scopeId,
            provenance: {
              purpose: CATALOG_SCOPE_PURPOSE,
              timezone: CATALOG_SCOPE_TIMEZONE,
              metric: command.metric,
              kind: 'catalog-metric-scope',
            },
          },
        });
      }
      return { ok: true as const, created: true, scopeId, status: 'PROPOSED' as const, grants };
    });
  } catch {
    return { ok: false, reason: 'PERSISTENCE_FAILED' };
  }
}

export async function persistCatalogScopeDecision(
  command: CatalogScopeDecisionCommand,
): Promise<{ ok: true; scopeId: string; status: 'APPROVED' | 'REVOKED' } | { ok: false; reason: CatalogScopeFailure }> {
  const auth = authorize(command);
  if (!auth.ok) return auth;
  if (containsSecret({ scopeId: command.scopeId })) return { ok: false, reason: 'CREDENTIAL_IN_REASON' };
  if (!command.scopeId.trim()) return { ok: false, reason: 'NOT_FOUND' };
  if (command.decision !== 'APPROVE' && command.decision !== 'REJECT') return { ok: false, reason: 'FORBIDDEN' };
  try {
    const { prisma } = await import('@/lib/prisma');
    return await prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>(
        Prisma.sql`SELECT id FROM "JuryAccessScope" WHERE id = ${command.scopeId} AND "tenantId" = ${auth.actor.tenantId} FOR UPDATE`,
      );
      if (!locked[0]) return { ok: false as const, reason: 'NOT_FOUND' as const };
      const row = await tx.juryAccessScope.findUnique({ where: { id: command.scopeId } });
      if (!row || row.tenantId !== auth.actor.tenantId) return { ok: false as const, reason: 'NOT_FOUND' as const };
      const grants = asGrants(row.grants);
      if (!grants || !catalogNames(grants)) return { ok: false as const, reason: 'METRIC_NOT_IN_CATALOG' as const };
      if (row.status !== 'PROPOSED') return { ok: false as const, reason: 'ALREADY_DECIDED' as const };
      const status = command.decision === 'APPROVE' ? 'APPROVED' : 'REVOKED';
      await tx.juryAccessScope.update({
        where: { id: row.id },
        data: {
          status,
          approvedByUserId: status === 'APPROVED' ? auth.actor.userId : null,
          approvedAt: status === 'APPROVED' ? new Date(command.now) : null,
        },
      });
      const action = status === 'APPROVED' ? 'SCOPE_APPROVED' : 'SCOPE_REVOKED';
      const auditId = sha([auth.actor.tenantId, action, row.id]);
      const audit = await tx.juryAuditEvent.findUnique({ where: { id: auditId }, select: { id: true } });
      if (!audit) {
        await tx.juryAuditEvent.create({
          data: {
            id: auditId,
            tenantId: auth.actor.tenantId,
            timestamp: new Date(command.now),
            actor: auth.actor.userId,
            action,
            scopeId: row.id,
            provenance: {
              purpose: CATALOG_SCOPE_PURPOSE,
              timezone: CATALOG_SCOPE_TIMEZONE,
              kind: 'catalog-metric-scope',
            },
          },
        });
      }
      return { ok: true as const, scopeId: row.id, status };
    });
  } catch {
    return { ok: false, reason: 'PERSISTENCE_FAILED' };
  }
}

function authorize(input: {
  userId: string | null;
  memberships: readonly JuryMembership[];
  clientTenantId?: string | null;
}): { ok: true; actor: CatalogActor } | { ok: false; reason: CatalogScopeFailure } {
  const actor = resolveJuryActor({
    userId: input.userId,
    memberships: input.memberships,
    clientTenantId: input.clientTenantId,
  });
  if (!actor.ok) return { ok: false, reason: actor.reason };
  if (input.clientTenantId && input.clientTenantId !== actor.tenantId) {
    return { ok: false, reason: 'TENANT_MISMATCH' };
  }
  const write = decideJuryMutation({
    actor,
    action: 'scope.write',
    resourceTenantId: actor.tenantId,
    clientTenantId: null,
  });
  if (!write.ok) return write;
  return { ok: true, actor };
}

function catalogNames(grants: readonly JuryAccessGrant[]): string[] | null {
  if (grants.length === 0) return null;
  const names: string[] = [];
  for (const grant of grants) {
    if (grant.mode !== 'READ' || !grant.resource.startsWith('metric:')) return null;
    const metric = grant.resource.slice('metric:'.length);
    if (!isCatalogMetric(metric) || !(CONSOLE_CATALOG_METRICS as readonly string[]).includes(metric)) return null;
    names.push(metric);
  }
  return [...new Set(names)].sort((left, right) => left.localeCompare(right));
}

function asGrants(value: unknown): JuryAccessGrant[] | null {
  if (!Array.isArray(value)) return null;
  const grants: JuryAccessGrant[] = [];
  for (const row of value) {
    if (!row || typeof row !== 'object') return null;
    const resource = (row as { resource?: unknown }).resource;
    const mode = (row as { mode?: unknown }).mode;
    if (typeof resource !== 'string' || mode !== 'READ') return null;
    grants.push({ resource, mode: 'READ' });
  }
  return grants;
}

function sha(parts: string[]): string {
  return createHash('sha256').update(parts.join('\n')).digest('hex');
}
