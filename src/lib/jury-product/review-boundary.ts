/**
 * Product review orchestration.
 * Gates run here. The frozen pipeline is called only from review-core.ts.
 */
import { createHash } from 'node:crypto';
import type { EvidencePack } from '../ai-review-board/types';
import { decideJuryMutation, resolveJuryActor } from './access';
import { JuryTenantIsolationError, projectEvidenceToPack, type EvidencePackProjection } from './projection';
import {
  JURY_CLAIM_STRENGTHS,
  JURY_CORE_CONTRACT_VERSION,
  JURY_DECISIONS,
  JURY_EVIDENCE_STRENGTHS,
  JURY_PRODUCT_DATA_ROOT,
  validateReviewRequestShape,
  type JuryClaimStrength,
  type JuryDecision,
  type JuryEvidence,
  type JuryEvidenceStrength,
  type JuryFinalSurface,
  type JuryMembership,
  type JuryNormalizedMetric,
  type JuryReviewRequest,
  type JuryReviewResult,
  type JuryReviewType,
  type JuryScopeStatus,
} from './records';

export type FrozenCoreReading = {
  boardRunId: string;
  evidenceStrength: string;
  claimStrength: string;
  conflictDetected: boolean;
  overclaimDetected: boolean;
  revisionRequired: boolean;
  expectedDecision: string;
  finalSurface: JuryFinalSurface;
  completedAt: string;
};

export type ProductReviewCore = (input: {
  rootDir: typeof JURY_PRODUCT_DATA_ROOT;
  evidence: EvidencePack;
  claim?: string;
}) => Promise<FrozenCoreReading>;

export type ProductReviewCommand = {
  userId: string | null;
  memberships: readonly JuryMembership[];
  clientTenantId?: string | null;
  evidence: JuryEvidence & { piiExcluded?: boolean; readOnly?: boolean };
  metrics: JuryNormalizedMetric[];
  scopes: readonly { tenantId: string; connectionId: string; status: JuryScopeStatus }[];
  reviewType: JuryReviewType;
  claim?: string | null;
  generatedAt: string;
  siteName: string;
};

export type ProductReviewFailure =
  | 'UNAUTHENTICATED'
  | 'NO_MEMBERSHIP'
  | 'AMBIGUOUS_MEMBERSHIP'
  | 'STORE_UNAVAILABLE'
  | 'FORBIDDEN'
  | 'TENANT_MISMATCH'
  | 'SCOPE_NOT_APPROVED'
  | 'TIMEZONE_UNSUPPORTED'
  | 'PACK_NOT_READ_ONLY'
  | 'CLAIM_REQUIRED'
  | 'REVIEW_NOT_EXECUTED'
  | 'DECISION_NOT_IN_CONTRACT'
  | 'CORE_READING_REJECTED';

export type ProductReviewOutcome =
  | { ok: false; reason: ProductReviewFailure; decision?: string }
  | {
      ok: true;
      request: JuryReviewRequest;
      result: JuryReviewResult;
      projection: EvidencePackProjection;
    };

function stableId(parts: readonly string[]): string {
  return createHash('sha256').update(parts.join('\n')).digest('hex');
}

function isDecision(value: string): value is JuryDecision {
  return (JURY_DECISIONS as readonly string[]).includes(value);
}

function isEvidenceStrength(value: string): value is JuryEvidenceStrength {
  return (JURY_EVIDENCE_STRENGTHS as readonly string[]).includes(value);
}

function isClaimStrength(value: string): value is JuryClaimStrength {
  return (JURY_CLAIM_STRENGTHS as readonly string[]).includes(value);
}

export async function runProductReview(
  command: ProductReviewCommand,
  core?: ProductReviewCore,
): Promise<ProductReviewOutcome> {
  void command.clientTenantId;
  const actor = resolveJuryActor({
    userId: command.userId,
    memberships: command.memberships,
    clientTenantId: command.clientTenantId,
  });
  if (!actor.ok) return { ok: false, reason: actor.reason };
  const allowed = decideJuryMutation({
    actor,
    action: 'review.start',
    resourceTenantId: command.evidence.tenantId,
    clientTenantId: command.clientTenantId,
  });
  if (!allowed.ok) return allowed;

  const scope = command.scopes.find(
    (row) => row.tenantId === actor.tenantId && row.connectionId === command.evidence.connectionId,
  );
  if (!scope || scope.status !== 'APPROVED') return { ok: false, reason: 'SCOPE_NOT_APPROVED' };
  if (command.evidence.timezone !== 'Asia/Seoul') return { ok: false, reason: 'TIMEZONE_UNSUPPORTED' };
  if (command.evidence.piiExcluded !== true || command.evidence.readOnly !== true) {
    return { ok: false, reason: 'PACK_NOT_READ_ONLY' };
  }

  const claimShape = validateReviewRequestShape({
    reviewType: command.reviewType,
    claim: command.claim,
  });
  if (!claimShape.ok) return { ok: false, reason: 'CLAIM_REQUIRED' };
  const claim = typeof command.claim === 'string' ? command.claim.trim() : undefined;

  let projection: EvidencePackProjection;
  try {
    projection = projectEvidenceToPack({
      evidence: command.evidence,
      metrics: command.metrics,
      generatedAt: command.generatedAt,
      siteName: command.siteName,
    });
  } catch (error) {
    if (error instanceof JuryTenantIsolationError) return { ok: false, reason: 'TENANT_MISMATCH' };
    throw error;
  }
  if (projection.periodWithheld || projection.pack.analysisPeriod?.timezone !== 'Asia/Seoul') {
    return { ok: false, reason: 'TIMEZONE_UNSUPPORTED' };
  }

  const requestId = stableId([
    actor.tenantId,
    command.evidence.id,
    command.reviewType,
    claim ?? '',
  ]);
  const requestBase = {
    id: requestId,
    tenantId: actor.tenantId,
    connectionId: command.evidence.connectionId,
    evidenceId: command.evidence.id,
    mode: 'AISLE_SELF' as const,
    status: 'QUEUED' as const,
    coreRootDir: JURY_PRODUCT_DATA_ROOT,
    requestedByUserId: actor.userId,
  } as const;
  const request: JuryReviewRequest =
    command.reviewType === 'CLAIM_VALIDATION'
      ? { ...requestBase, reviewType: 'CLAIM_VALIDATION', claim: claim ?? '' }
      : { ...requestBase, reviewType: command.reviewType, ...(claim ? { claim } : {}) };

  if (!core) return { ok: false, reason: 'REVIEW_NOT_EXECUTED' };

  const reading = await core({
    rootDir: JURY_PRODUCT_DATA_ROOT,
    evidence: projection.pack,
    ...(claim ? { claim } : {}),
  });
  if (!isDecision(reading.expectedDecision)) {
    return { ok: false, reason: 'DECISION_NOT_IN_CONTRACT', decision: reading.expectedDecision };
  }
  if (!isEvidenceStrength(reading.evidenceStrength) || !isClaimStrength(reading.claimStrength)) {
    return { ok: false, reason: 'CORE_READING_REJECTED' };
  }

  const result: JuryReviewResult = {
    id: stableId([requestId, reading.boardRunId]),
    tenantId: actor.tenantId,
    reviewRequestId: requestId,
    boardRunId: reading.boardRunId,
    evidenceStrength: reading.evidenceStrength,
    claimStrength: reading.claimStrength,
    conflictDetected: reading.conflictDetected,
    overclaimDetected: reading.overclaimDetected,
    revisionRequired: reading.revisionRequired,
    expectedDecision: reading.expectedDecision,
    finalSurface: reading.finalSurface,
    contractVersion: JURY_CORE_CONTRACT_VERSION,
    completedAt: reading.completedAt,
  };
  return {
    ok: true,
    request: { ...request, status: 'COMPLETED' },
    result,
    projection,
  };
}
