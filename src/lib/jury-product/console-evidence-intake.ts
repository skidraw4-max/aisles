/**
 * Console form for declared catalog metrics.
 * Tenant, grants, and persistence stay in persistTenantEvidenceIntake.
 */
import { resolveAnalysisPeriod } from '@/lib/ai-review-board/analysis-period';
import { decideJuryMutation, type JuryActor } from './access';
import { containsSecret } from './agent-execution';
import type { JuryConsoleView } from './console-view';
import type { JuryMembership } from './records';
import {
  isCatalogMetric,
  TENANT_INTAKE_TIMEZONE,
  type TenantEvidenceIntakeInput,
} from './tenant-evidence-intake';

export const CONSOLE_INTAKE_SOURCE = 'OTHER' as const;
export const CONSOLE_INTAKE_REF = 'console-declared';
export const CONSOLE_INTAKE_ADAPTER = 'console-declared';
export const CONSOLE_INTAKE_VERSION = 'v1';

const DECLARED_AVAILABILITY = [
  'AVAILABLE',
  'NOT_MEASURED',
  'NOT_AVAILABLE',
  'PERMISSION_DENIED',
  'COLLECTION_FAILED',
] as const;

const INTAKE_REASONS = new Set<string>([
  'TENANT_MISMATCH',
  'NOT_FOUND',
  'SCOPE_NOT_APPROVED',
  'SCOPE_CONNECTION_MISMATCH',
  'FORBIDDEN',
  'CONNECTION_WRITE_REQUIRED',
  'METRIC_NOT_IN_CATALOG',
  'METRIC_NOT_IN_SCOPE',
  'INVALID_TIMEZONE',
  'CREDENTIAL_IN_REASON',
  'INVALID_VALUE',
  'PERSISTENCE_FAILED',
]);

export type ConsoleIntakeCommand = {
  userId: string | null;
  memberships: readonly JuryMembership[];
  connectionId: string;
  scopeId: string;
  metric: string;
  availability: string;
  value: string;
  now: string;
};

export type ConsoleIntakeScope = {
  connectionId: string;
  scopeId: string;
  label: string;
  metrics: string[];
};

export type ConsoleEvidenceMetric = {
  id: string;
  metric: string;
  value: number | null;
  availability: string;
  sourceSystem: string;
};

export type ConsoleEvidenceRow = {
  id: string;
  purpose: string;
  periodStart: string;
  periodEnd: string;
  metricCount: number;
  metrics: ConsoleEvidenceMetric[];
};

export function catalogMetricsForGrants(grants: readonly { resource?: unknown; mode?: unknown }[]): string[] {
  const names = grants.flatMap((grant) => {
    if (grant.mode !== 'READ' || typeof grant.resource !== 'string' || !grant.resource.startsWith('metric:')) return [];
    const metric = grant.resource.slice('metric:'.length);
    return isCatalogMetric(metric) ? [metric] : [];
  });
  return [...new Set(names)].sort((left, right) => left.localeCompare(right));
}

export function projectConsoleIntakeForm(actor: JuryActor, view: JuryConsoleView): { visible: boolean; scopes: ConsoleIntakeScope[] } {
  if (!actor.ok) return { visible: false, scopes: [] };
  const allowed = decideJuryMutation({
    actor,
    action: 'connection.write',
    resourceTenantId: actor.tenantId,
  }).ok;
  if (!allowed) return { visible: false, scopes: [] };
  const scopes = view.scopes.flatMap((scope) => {
    if (scope.status !== 'APPROVED' || scope.tenantId !== actor.tenantId) return [];
    const connection = view.connections.find((row) => row.id === scope.connectionId && row.tenantId === actor.tenantId);
    if (!connection) return [];
    const metrics = catalogMetricsForGrants(scope.grants);
    if (metrics.length === 0) return [];
    return [{
      connectionId: connection.id,
      scopeId: scope.id,
      label: `${connection.displayName} / ${scope.id}`,
      metrics,
    }];
  });
  return { visible: true, scopes };
}

export function projectConsoleEvidence(view: Pick<JuryConsoleView, 'evidence' | 'metrics'>): ConsoleEvidenceRow[] {
  return view.evidence.map((evidence) => {
    const metrics = view.metrics.filter(
      (metric) => metric.evidenceId === evidence.id || evidence.metricIds.includes(metric.id),
    );
    return {
      id: evidence.id,
      purpose: evidence.purpose,
      periodStart: evidence.periodStart,
      periodEnd: evidence.periodEnd,
      metricCount: evidence.metricIds.length,
      metrics: metrics.map((metric) => ({
        id: metric.id,
        metric: metric.metric,
        value: metric.value,
        availability: metric.availability,
        sourceSystem: metric.sourceSystem,
      })),
    };
  });
}

export function buildConsoleIntakeInput(
  command: ConsoleIntakeCommand,
): { ok: true; intake: TenantEvidenceIntakeInput } | { ok: false; reason: 'INVALID_VALUE' | 'CREDENTIAL_IN_REASON' } {
  if (containsSecret({
    connectionId: command.connectionId,
    scopeId: command.scopeId,
    metric: command.metric,
    availability: command.availability,
    value: command.value,
  })) {
    return { ok: false, reason: 'CREDENTIAL_IN_REASON' };
  }
  if (!pointer(command.connectionId) || !pointer(command.scopeId) || !pointer(command.metric)) {
    return { ok: false, reason: 'INVALID_VALUE' };
  }
  if (!DECLARED_AVAILABILITY.includes(command.availability as (typeof DECLARED_AVAILABILITY)[number])) {
    return { ok: false, reason: 'INVALID_VALUE' };
  }
  const value = declaredValue(command.availability, command.value);
  if (value === 'INVALID') return { ok: false, reason: 'INVALID_VALUE' };
  const now = new Date(command.now);
  if (Number.isNaN(now.getTime())) return { ok: false, reason: 'INVALID_VALUE' };
  const period = resolveAnalysisPeriod(now);
  return {
    ok: true,
    intake: {
      userId: command.userId,
      memberships: command.memberships,
      clientTenantId: null,
      connectionId: command.connectionId,
      scopeId: command.scopeId,
      periodStart: period.start,
      periodEnd: period.end,
      timezone: TENANT_INTAKE_TIMEZONE,
      metrics: [{ metric: command.metric, availability: command.availability, value }],
      sourceSystem: CONSOLE_INTAKE_SOURCE,
      sourceRef: CONSOLE_INTAKE_REF,
      adapterKey: CONSOLE_INTAKE_ADAPTER,
      adapterVersion: CONSOLE_INTAKE_VERSION,
      now: command.now,
    },
  };
}

export function consoleIntakeCode(
  result: { ok: true; created: boolean } | { ok: false; reason: string },
): string {
  if (!result.ok) return INTAKE_REASONS.has(result.reason) ? result.reason : 'PERSISTENCE_FAILED';
  return result.created ? 'EVIDENCE_CREATED' : 'EVIDENCE_REUSED';
}

function declaredValue(availability: string, raw: string): number | null | 'INVALID' {
  if (availability !== 'AVAILABLE') return null;
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) return 'INVALID';
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : 'INVALID';
}

function pointer(value: string): boolean {
  return value.trim().length > 0 && value.length <= 200;
}
