/**
 * Runs one review from stored tenant evidence.
 * The frozen core receives only the tenant projection.
 */
import { createHash } from 'node:crypto';
import { decideJuryMutation, resolveJuryActor } from './access';
import type { ProductReviewCore } from './review-boundary';
import { persistProductReview } from './review-store';
import {
  JURY_CORE_CONTRACT_VERSION,
  JURY_DECISIONS,
  JURY_PRODUCT_DATA_ROOT,
  JURY_REVIEW_TYPES,
  validateReviewRequestShape,
  type JuryClaimStrength,
  type JuryDecision,
  type JuryEvidenceStrength,
  type JuryFinalSurface,
  type JuryMembership,
  type JuryReviewRequest,
  type JuryReviewResult,
  type JuryReviewType,
} from './records';
import { TENANT_INTAKE_AUDIT } from './tenant-evidence-intake';
import { projectTenantEvidenceToPack } from './tenant-evidence-projection';

export type TenantReviewCommand = {
  userId: string | null;
  memberships: readonly JuryMembership[];
  clientTenantId?: string | null;
  evidenceId: string;
  connectionId?: string | null;
  scopeId?: string | null;
  reviewType: string;
  claim?: string | null;
  now: string;
};

export type TenantReviewFailure =
  | 'UNAUTHENTICATED'
  | 'NO_MEMBERSHIP'
  | 'AMBIGUOUS_MEMBERSHIP'
  | 'STORE_UNAVAILABLE'
  | 'FORBIDDEN'
  | 'TENANT_MISMATCH'
  | 'NOT_FOUND'
  | 'SCOPE_NOT_APPROVED'
  | 'EVIDENCE_CONNECTION_MISMATCH'
  | 'PROJECTION_FAILED'
  | 'CLAIM_REQUIRED'
  | 'REVIEW_NOT_EXECUTED'
  | 'REVIEW_ALREADY_EXISTS'
  | 'DECISION_NOT_IN_CONTRACT'
  | 'CORE_READING_REJECTED'
  | 'PERSISTENCE_FAILED';

export type TenantReviewOutcome =
  | { ok: false; reason: TenantReviewFailure }
  | { ok: true; reused: boolean; request: JuryReviewRequest; result: JuryReviewResult };

const PUBLIC_REASONS = new Set<string>([
  'UNAUTHENTICATED',
  'NO_MEMBERSHIP',
  'AMBIGUOUS_MEMBERSHIP',
  'STORE_UNAVAILABLE',
  'FORBIDDEN',
  'TENANT_MISMATCH',
  'NOT_FOUND',
  'SCOPE_NOT_APPROVED',
  'EVIDENCE_CONNECTION_MISMATCH',
  'PROJECTION_FAILED',
  'CLAIM_REQUIRED',
  'REVIEW_NOT_EXECUTED',
  'REVIEW_ALREADY_EXISTS',
  'DECISION_NOT_IN_CONTRACT',
  'CORE_READING_REJECTED',
  'PERSISTENCE_FAILED',
]);

export function tenantReviewCode(reason: string): string {
  return PUBLIC_REASONS.has(reason) ? reason : 'PERSISTENCE_FAILED';
}

export async function runTenantReview(
  command: TenantReviewCommand,
  core?: ProductReviewCore,
): Promise<TenantReviewOutcome> {
  const actor = resolveJuryActor({
    userId: command.userId,
    memberships: command.memberships,
    clientTenantId: command.clientTenantId,
  });
  if (!actor.ok) return { ok: false, reason: actor.reason === 'STORE_UNAVAILABLE' ? 'STORE_UNAVAILABLE' : actor.reason };
  if (command.clientTenantId && command.clientTenantId !== actor.tenantId) {
    return { ok: false, reason: 'TENANT_MISMATCH' };
  }
  const allowed = decideJuryMutation({
    actor,
    action: 'review.start',
    resourceTenantId: actor.tenantId,
    clientTenantId: null,
  });
  if (!allowed.ok) return { ok: false, reason: 'FORBIDDEN' };
  if (!(JURY_REVIEW_TYPES as readonly string[]).includes(command.reviewType)) {
    return { ok: false, reason: 'PROJECTION_FAILED' };
  }
  const reviewType = command.reviewType as JuryReviewType;
  const claimShape = validateReviewRequestShape({ reviewType, claim: command.claim });
  if (!claimShape.ok) return { ok: false, reason: 'CLAIM_REQUIRED' };
  const claim = typeof command.claim === 'string' ? command.claim.trim() : undefined;
  if (!command.evidenceId.trim()) return { ok: false, reason: 'NOT_FOUND' };

  const { prisma } = await import('@/lib/prisma');
  const evidence = await prisma.juryEvidence.findFirst({
    where: { id: command.evidenceId, tenantId: actor.tenantId },
  });
  if (!evidence) return { ok: false, reason: 'NOT_FOUND' };
  if (command.connectionId && command.connectionId !== evidence.connectionId) {
    return { ok: false, reason: 'EVIDENCE_CONNECTION_MISMATCH' };
  }
  const connection = await prisma.juryServiceConnection.findFirst({
    where: { id: evidence.connectionId, tenantId: actor.tenantId },
  });
  if (!connection) return { ok: false, reason: 'NOT_FOUND' };

  const audits = await prisma.juryAuditEvent.findMany({
    where: {
      tenantId: actor.tenantId,
      evidenceId: evidence.id,
      action: TENANT_INTAKE_AUDIT,
    },
  });
  const auditedScopeIds = audits.flatMap((row) => (row.scopeId ? [row.scopeId] : []));
  if (command.scopeId) {
    const scope = await prisma.juryAccessScope.findFirst({
      where: { id: command.scopeId, tenantId: actor.tenantId },
    });
    if (!scope) return { ok: false, reason: 'NOT_FOUND' };
    if (scope.connectionId !== evidence.connectionId) return { ok: false, reason: 'EVIDENCE_CONNECTION_MISMATCH' };
    if (scope.status !== 'APPROVED' || !auditedScopeIds.includes(scope.id)) {
      return { ok: false, reason: 'SCOPE_NOT_APPROVED' };
    }
  } else if (auditedScopeIds.length === 0) {
    return { ok: false, reason: 'SCOPE_NOT_APPROVED' };
  } else {
    const scopes = await prisma.juryAccessScope.findMany({
      where: { id: { in: auditedScopeIds }, tenantId: actor.tenantId },
    });
    const approved = scopes.some(
      (scope) => scope.status === 'APPROVED' && scope.connectionId === evidence.connectionId,
    );
    if (!approved) return { ok: false, reason: 'SCOPE_NOT_APPROVED' };
  }

  const metrics = await prisma.juryNormalizedMetric.findMany({
    where: { tenantId: actor.tenantId, evidenceId: evidence.id },
  });
  const projected = projectTenantEvidenceToPack({
    evidence: {
      id: evidence.id,
      tenantId: evidence.tenantId,
      connectionId: evidence.connectionId,
      purpose: evidence.purpose,
      periodStart: evidence.periodStart,
      periodEnd: evidence.periodEnd,
      timezone: evidence.timezone,
      metricIds: Array.isArray(evidence.metricIds) ? evidence.metricIds.filter((id): id is string => typeof id === 'string') : [],
      adapterKey: evidence.adapterKey,
      collectedAt: evidence.collectedAt.toISOString(),
      ...(evidence.contentHash ? { contentHash: evidence.contentHash } : {}),
      piiExcluded: evidence.piiExcluded,
      readOnly: evidence.readOnly,
    },
    metrics: metrics.map((metric) => ({
      id: metric.id,
      tenantId: metric.tenantId,
      connectionId: metric.connectionId,
      evidenceId: metric.evidenceId ?? undefined,
      metric: metric.metric,
      value: metric.value,
      unit: metric.unit,
      periodStart: metric.periodStart,
      periodEnd: metric.periodEnd,
      timezone: metric.timezone,
      sourceSystem: metric.sourceSystem,
      sourceRef: metric.sourceRef,
      collectedAt: metric.collectedAt.toISOString(),
      availability: metric.availability,
      rawPayloadRef: metric.rawPayloadRef,
      adapterKey: metric.adapterKey,
      adapterVersion: metric.adapterVersion,
      ruleId: metric.ruleId,
      ...(metric.rawValueText ? { rawValueText: metric.rawValueText } : {}),
    })),
    generatedAt: command.now,
    siteName: connection.displayName || connection.serviceKey,
  });
  if (!projected.ok) return projected;

  const requestId = sha([actor.tenantId, evidence.id, reviewType, claim ?? '']);
  const existing = await prisma.juryReviewRequest.findFirst({
    where: { id: requestId, tenantId: actor.tenantId },
    include: { result: true },
  });
  if (existing?.result) {
    const reused = toResult(existing.result);
    if (!reused) return { ok: false, reason: 'PERSISTENCE_FAILED' };
    return { ok: true, reused: true, request: toRequest(existing), result: reused };
  }
  if (existing) return { ok: false, reason: 'REVIEW_ALREADY_EXISTS' };
  if (!core) return { ok: false, reason: 'REVIEW_NOT_EXECUTED' };

  let reading: Awaited<ReturnType<ProductReviewCore>>;
  try {
    reading = await core({
      rootDir: JURY_PRODUCT_DATA_ROOT,
      evidence: projected.pack,
      ...(claim ? { claim } : {}),
    });
  } catch {
    return { ok: false, reason: 'REVIEW_NOT_EXECUTED' };
  }
  if (!(JURY_DECISIONS as readonly string[]).includes(reading.expectedDecision)) {
    return { ok: false, reason: 'DECISION_NOT_IN_CONTRACT' };
  }
  if (!isStrength(reading.evidenceStrength) || !isClaim(reading.claimStrength)) {
    return { ok: false, reason: 'CORE_READING_REJECTED' };
  }
  const request: JuryReviewRequest =
    reviewType === 'CLAIM_VALIDATION'
      ? {
          id: requestId,
          tenantId: actor.tenantId,
          connectionId: evidence.connectionId,
          evidenceId: evidence.id,
          mode: 'EXTERNAL_SERVICE',
          status: 'COMPLETED',
          coreRootDir: JURY_PRODUCT_DATA_ROOT,
          requestedByUserId: actor.userId,
          reviewType: 'CLAIM_VALIDATION',
          claim: claim ?? '',
        }
      : {
          id: requestId,
          tenantId: actor.tenantId,
          connectionId: evidence.connectionId,
          evidenceId: evidence.id,
          mode: 'EXTERNAL_SERVICE',
          status: 'COMPLETED',
          coreRootDir: JURY_PRODUCT_DATA_ROOT,
          requestedByUserId: actor.userId,
          reviewType,
          ...(claim ? { claim } : {}),
        };
  const result: JuryReviewResult = {
    id: sha([requestId, reading.boardRunId]),
    tenantId: actor.tenantId,
    reviewRequestId: requestId,
    boardRunId: reading.boardRunId,
    evidenceStrength: reading.evidenceStrength,
    claimStrength: reading.claimStrength,
    conflictDetected: reading.conflictDetected,
    overclaimDetected: reading.overclaimDetected,
    revisionRequired: reading.revisionRequired,
    expectedDecision: reading.expectedDecision as JuryDecision,
    finalSurface: reading.finalSurface,
    contractVersion: JURY_CORE_CONTRACT_VERSION,
    completedAt: reading.completedAt,
  };
  try {
    const stored = await persistProductReview({ request, result });
    if (!stored.ok) return { ok: false, reason: 'PERSISTENCE_FAILED' };
  } catch {
    const raced = await prisma.juryReviewRequest.findFirst({
      where: { id: requestId, tenantId: actor.tenantId },
      include: { result: true },
    });
    if (raced?.result) {
      const reused = toResult(raced.result);
      if (!reused) return { ok: false, reason: 'PERSISTENCE_FAILED' };
      return { ok: true, reused: true, request: toRequest(raced), result: reused };
    }
    return { ok: false, reason: 'PERSISTENCE_FAILED' };
  }
  return { ok: true, reused: false, request, result };
}

function sha(parts: readonly string[]): string {
  return createHash('sha256').update(parts.join('\n')).digest('hex');
}

function isStrength(value: string): value is JuryEvidenceStrength {
  return value === 'strong' || value === 'moderate' || value === 'unknown';
}

function isClaim(value: string): value is JuryClaimStrength {
  return value === 'weak' || value === 'strong' || value === 'extreme';
}

function toRequest(row: {
  id: string;
  tenantId: string;
  connectionId: string;
  evidenceId: string;
  reviewType: string;
  claim: string | null;
  mode: string;
  status: string;
  coreRootDir: string;
  requestedByUserId: string | null;
}): JuryReviewRequest {
  const base = {
    id: row.id,
    tenantId: row.tenantId,
    connectionId: row.connectionId,
    evidenceId: row.evidenceId,
    mode: 'EXTERNAL_SERVICE' as const,
    status: 'COMPLETED' as const,
    coreRootDir: JURY_PRODUCT_DATA_ROOT,
    ...(row.requestedByUserId ? { requestedByUserId: row.requestedByUserId } : {}),
  } as const;
  if (row.reviewType === 'CLAIM_VALIDATION') {
    return { ...base, reviewType: 'CLAIM_VALIDATION', claim: row.claim ?? '' };
  }
  if (row.reviewType === 'UI_UX_REVIEW') {
    return { ...base, reviewType: 'UI_UX_REVIEW', ...(row.claim ? { claim: row.claim } : {}) };
  }
  return { ...base, reviewType: 'FULL_REVIEW', ...(row.claim ? { claim: row.claim } : {}) };
}

function toResult(row: {
  id: string;
  tenantId: string;
  reviewRequestId: string;
  boardRunId: string;
  evidenceStrength: string;
  claimStrength: string;
  conflictDetected: boolean;
  overclaimDetected: boolean;
  revisionRequired: boolean;
  expectedDecision: string;
  finalSurface: unknown;
  contractVersion: string;
  completedAt: Date;
}): JuryReviewResult | null {
  if (!isStrength(row.evidenceStrength) || !isClaim(row.claimStrength)) return null;
  if (!(JURY_DECISIONS as readonly string[]).includes(row.expectedDecision)) return null;
  const surface = row.finalSurface;
  if (!surface || typeof surface !== 'object') return null;
  return {
    id: row.id,
    tenantId: row.tenantId,
    reviewRequestId: row.reviewRequestId,
    boardRunId: row.boardRunId,
    evidenceStrength: row.evidenceStrength,
    claimStrength: row.claimStrength,
    conflictDetected: row.conflictDetected,
    overclaimDetected: row.overclaimDetected,
    revisionRequired: row.revisionRequired,
    expectedDecision: row.expectedDecision as JuryDecision,
    finalSurface: surface as JuryFinalSurface,
    contractVersion: JURY_CORE_CONTRACT_VERSION,
    completedAt: row.completedAt.toISOString(),
  };
}
