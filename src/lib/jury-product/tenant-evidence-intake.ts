/**
 * Declared catalog metrics become tenant evidence.
 * It does not read the host database, GA4, or an external service.
 */
import { createHash } from 'node:crypto';
import { decideJuryMutation, resolveJuryActor, type JuryActor } from './access';
import { containsSecret } from './agent-execution';
import { applyAvailability } from './normalizer';
import {
  JURY_GA4_EVENT_PREFIX,
  JURY_PROJECTABLE_DB_METRICS,
  JURY_PROJECTABLE_GA4_METRICS,
} from './projection';
import type { JuryAvailability, JuryMembership, JuryMetricUnit } from './records';

export const TENANT_INTAKE_PURPOSE = 'tenant-declared-observation';
export const TENANT_INTAKE_RULE_ID = 'normalize.tenant-declared.v1';
export const TENANT_INTAKE_TIMEZONE = 'Asia/Seoul';
export const TENANT_INTAKE_AUDIT = 'EVIDENCE_INTAKE_COMPLETED';

const DECLARED_AVAILABILITY = [
  'AVAILABLE',
  'NOT_MEASURED',
  'NOT_AVAILABLE',
  'PERMISSION_DENIED',
  'COLLECTION_FAILED',
] as const;

export type DeclaredAvailability = (typeof DECLARED_AVAILABILITY)[number];

export type DeclaredMetricInput = {
  metric: string;
  availability: string;
  value: number | null;
};

export type TenantEvidenceIntakeInput = {
  userId: string | null;
  memberships: readonly JuryMembership[];
  clientTenantId?: string | null;
  connectionId: string;
  scopeId: string;
  periodStart: string;
  periodEnd: string;
  timezone: string;
  metrics: readonly DeclaredMetricInput[];
  sourceSystem: string;
  sourceRef: string;
  adapterKey: string;
  adapterVersion: string;
  now: string;
};

export type IntakeFailure =
  | 'TENANT_MISMATCH'
  | 'NOT_FOUND'
  | 'SCOPE_NOT_APPROVED'
  | 'SCOPE_CONNECTION_MISMATCH'
  | 'FORBIDDEN'
  | 'CONNECTION_WRITE_REQUIRED'
  | 'METRIC_NOT_IN_CATALOG'
  | 'METRIC_NOT_IN_SCOPE'
  | 'INVALID_TIMEZONE'
  | 'CREDENTIAL_IN_REASON'
  | 'INVALID_VALUE'
  | 'PERSISTENCE_FAILED';

export type NormalizedDeclaredMetric = {
  id: string;
  tenantId: string;
  connectionId: string;
  evidenceId: string;
  metric: string;
  value: number | null;
  unit: JuryMetricUnit;
  periodStart: string;
  periodEnd: string;
  timezone: string;
  sourceSystem: 'FILE' | 'OTHER';
  sourceRef: string;
  collectedAt: string;
  availability: JuryAvailability;
  rawValueText: string;
  rawPayloadRef: string;
  adapterKey: string;
  adapterVersion: string;
  ruleId: string;
};

export type DeclaredEvidenceDraft = {
  id: string;
  tenantId: string;
  connectionId: string;
  purpose: typeof TENANT_INTAKE_PURPOSE;
  periodStart: string;
  periodEnd: string;
  timezone: typeof TENANT_INTAKE_TIMEZONE;
  metricIds: string[];
  adapterKey: string;
  collectedAt: string;
  contentHash: string;
  piiExcluded: true;
  readOnly: true;
  payloadRef: string;
};

export function intakeDeniedReason(
  role: JuryMembership['role'],
  writeAllowed: boolean,
): null | 'FORBIDDEN' | 'CONNECTION_WRITE_REQUIRED' {
  if (role !== 'OWNER') return 'FORBIDDEN';
  if (!writeAllowed) return 'CONNECTION_WRITE_REQUIRED';
  return null;
}

export function authorizeTenantIntake(input: {
  userId: string | null;
  memberships: readonly JuryMembership[];
  clientTenantId?: string | null;
}): { ok: true; actor: Extract<JuryActor, { ok: true }> } | { ok: false; reason: IntakeFailure } {
  const actor = resolveJuryActor({
    userId: input.userId,
    memberships: input.memberships,
    clientTenantId: input.clientTenantId,
  });
  if (!actor.ok) return { ok: false, reason: 'FORBIDDEN' };
  if (input.clientTenantId && input.clientTenantId !== actor.tenantId) {
    return { ok: false, reason: 'TENANT_MISMATCH' };
  }
  const write = decideJuryMutation({
    actor,
    action: 'connection.write',
    resourceTenantId: actor.tenantId,
    clientTenantId: null,
  });
  const denial = intakeDeniedReason(actor.role, write.ok);
  if (denial) return { ok: false, reason: denial };
  return { ok: true, actor };
}

export function precheckDeclaredIntake(input: TenantEvidenceIntakeInput): { ok: true } | { ok: false; reason: IntakeFailure } {
  if (input.timezone !== TENANT_INTAKE_TIMEZONE) return { ok: false, reason: 'INVALID_TIMEZONE' };
  if (containsSecret({
    sourceRef: input.sourceRef,
    adapterKey: input.adapterKey,
    adapterVersion: input.adapterVersion,
    metrics: input.metrics.map((row) => row.metric),
  })) {
    return { ok: false, reason: 'CREDENTIAL_IN_REASON' };
  }
  if (input.sourceSystem !== 'FILE' && input.sourceSystem !== 'OTHER') return { ok: false, reason: 'INVALID_VALUE' };
  if (!present(input.sourceRef) || !present(input.adapterKey) || !present(input.adapterVersion)) {
    return { ok: false, reason: 'INVALID_VALUE' };
  }
  if (!present(input.periodStart) || !present(input.periodEnd) || !present(input.connectionId) || !present(input.scopeId)) {
    return { ok: false, reason: 'INVALID_VALUE' };
  }
  if (input.metrics.length === 0) return { ok: false, reason: 'INVALID_VALUE' };
  const seen = new Set<string>();
  for (const row of input.metrics) {
    if (!isCatalogMetric(row.metric)) return { ok: false, reason: 'METRIC_NOT_IN_CATALOG' };
    if (seen.has(row.metric)) return { ok: false, reason: 'INVALID_VALUE' };
    seen.add(row.metric);
    if (!DECLARED_AVAILABILITY.includes(row.availability as DeclaredAvailability)) return { ok: false, reason: 'INVALID_VALUE' };
  }
  return { ok: true };
}

export function isCatalogMetric(metric: string): boolean {
  if ((JURY_PROJECTABLE_DB_METRICS as readonly string[]).includes(metric)) return true;
  if ((JURY_PROJECTABLE_GA4_METRICS as readonly string[]).includes(metric)) return true;
  if (!metric.startsWith(JURY_GA4_EVENT_PREFIX)) return false;
  const name = metric.slice(JURY_GA4_EVENT_PREFIX.length);
  return /^[A-Za-z0-9_]+$/.test(name);
}

export function metricGranted(grants: readonly { resource?: unknown; mode?: unknown }[], metric: string): boolean {
  const resource = `metric:${metric}`;
  return grants.some((grant) => grant.mode === 'READ' && grant.resource === resource);
}

export function buildDeclaredEvidence(input: {
  tenantId: string;
  connectionId: string;
  periodStart: string;
  periodEnd: string;
  metrics: readonly DeclaredMetricInput[];
  sourceSystem: 'FILE' | 'OTHER';
  sourceRef: string;
  adapterKey: string;
  adapterVersion: string;
  now: string;
  grants: readonly { resource?: unknown; mode?: unknown }[];
}): { ok: true; evidence: DeclaredEvidenceDraft; metrics: NormalizedDeclaredMetric[] } | { ok: false; reason: IntakeFailure } {
  for (const row of input.metrics) {
    if (!metricGranted(input.grants, row.metric)) return { ok: false, reason: 'METRIC_NOT_IN_SCOPE' };
  }
  const drafts = [...input.metrics]
    .sort((left, right) => left.metric.localeCompare(right.metric))
    .map((row) => normalizeOne(input, row));
  const canonical = drafts.map((row) => ({
    metric: row.metric,
    value: row.value,
    availability: row.availability,
    sourceSystem: row.sourceSystem,
    sourceRef: row.sourceRef,
    ruleId: row.ruleId,
  }));
  const contentHash = sha([JSON.stringify(canonical)]);
  const metrics = drafts.map((row) => ({
    ...row,
    id: sha([row.id, contentHash]),
  }));
  const evidenceId = sha([
    input.tenantId,
    input.connectionId,
    TENANT_INTAKE_PURPOSE,
    input.periodStart,
    input.periodEnd,
    TENANT_INTAKE_TIMEZONE,
    contentHash,
    ...metrics.map((row) => row.id),
  ]);
  const stored = metrics.map((row) => ({ ...row, evidenceId }));
  return {
    ok: true,
    metrics: stored,
    evidence: {
      id: evidenceId,
      tenantId: input.tenantId,
      connectionId: input.connectionId,
      purpose: TENANT_INTAKE_PURPOSE,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      timezone: TENANT_INTAKE_TIMEZONE,
      metricIds: stored.map((row) => row.id),
      adapterKey: input.adapterKey,
      collectedAt: input.now,
      contentHash,
      piiExcluded: true,
      readOnly: true,
      payloadRef: `tenant-declared:${input.sourceRef}`,
    },
  };
}

export function intakeAuditId(tenantId: string, evidenceId: string, scopeId: string): string {
  return sha([tenantId, TENANT_INTAKE_AUDIT, evidenceId, scopeId]);
}

function normalizeOne(
  input: {
    tenantId: string;
    connectionId: string;
    periodStart: string;
    periodEnd: string;
    sourceSystem: 'FILE' | 'OTHER';
    sourceRef: string;
    adapterKey: string;
    adapterVersion: string;
    now: string;
  },
  row: DeclaredMetricInput,
): Omit<NormalizedDeclaredMetric, 'evidenceId'> {
  const measured = applyAvailability(row.availability as JuryAvailability, row.value);
  const valueText = measured.value === null ? 'null' : String(measured.value);
  return {
    id: sha([
      input.tenantId,
      input.connectionId,
      row.metric,
      input.sourceSystem,
      input.periodStart,
      input.periodEnd,
      measured.availability,
      valueText,
    ]),
    tenantId: input.tenantId,
    connectionId: input.connectionId,
    metric: row.metric,
    value: measured.value,
    unit: row.metric === 'ga4.averageSessionDurationSec' ? 'DURATION_SEC' : 'COUNT',
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    timezone: TENANT_INTAKE_TIMEZONE,
    sourceSystem: input.sourceSystem,
    sourceRef: input.sourceRef,
    collectedAt: input.now,
    availability: measured.availability,
    rawValueText: valueText,
    rawPayloadRef: `tenant-declared:${input.sourceRef}`,
    adapterKey: input.adapterKey,
    adapterVersion: input.adapterVersion,
    ruleId: TENANT_INTAKE_RULE_ID,
  };
}

function present(value: string): boolean {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 200;
}

function sha(parts: readonly string[]): string {
  return createHash('sha256').update(parts.join('\n')).digest('hex');
}
