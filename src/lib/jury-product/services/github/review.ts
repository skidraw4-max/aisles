/**
 * Passes a GitHub EvidencePack through the existing product review entrance.
 * Jury Core is not modified here.
 */
import { createHash } from 'node:crypto';
import type { EvidencePack } from '@/lib/ai-review-board/types';
import type { FrozenCoreReading } from '../../review-boundary';
import {
  JURY_CLAIM_STRENGTHS,
  JURY_CORE_CONTRACT_VERSION,
  JURY_DECISIONS,
  JURY_EVIDENCE_STRENGTHS,
  JURY_PRODUCT_DATA_ROOT,
  validateReviewRequestShape,
  type JuryClaimStrength,
  type JuryDecision,
  type JuryEvidenceStrength,
  type JuryReviewRequest,
  type JuryReviewResult,
} from '../../records';

export type GithubReviewFailure =
  | 'PACK_NOT_READ_ONLY'
  | 'REVIEW_NOT_EXECUTED'
  | 'DECISION_NOT_IN_CONTRACT'
  | 'CORE_READING_REJECTED';

function hash(parts: readonly string[]): string {
  return createHash('sha256').update(parts.join('\n')).digest('hex');
}

export function githubFirstReviewRequestId(tenantId: string, evidenceId: string): string {
  return hash([tenantId, evidenceId, 'FULL_REVIEW']);
}

export function githubReviewResultId(requestId: string, boardRunId: string): string {
  return hash([requestId, boardRunId]);
}

export async function runGithubEvidenceReview(input: {
  tenantId: string;
  userId: string;
  connectionId: string;
  evidenceId: string;
  pack: EvidencePack;
  execute: (pack: EvidencePack) => Promise<FrozenCoreReading>;
}): Promise<{ ok: true; request: JuryReviewRequest; result: JuryReviewResult } | { ok: false; reason: GithubReviewFailure }> {
  if (input.pack.piiExcluded !== true || input.pack.readOnly !== true) return { ok: false, reason: 'PACK_NOT_READ_ONLY' };
  if (input.pack.aggregates.userCount !== null || input.pack.aggregates.newUsersLast7d !== null) {
    return { ok: false, reason: 'PACK_NOT_READ_ONLY' };
  }
  const shape = validateReviewRequestShape({ reviewType: 'FULL_REVIEW' });
  if (!shape.ok) return { ok: false, reason: 'REVIEW_NOT_EXECUTED' };
  const requestId = githubFirstReviewRequestId(input.tenantId, input.evidenceId);
  const request: JuryReviewRequest = {
    id: requestId,
    tenantId: input.tenantId,
    connectionId: input.connectionId,
    evidenceId: input.evidenceId,
    mode: 'EXTERNAL_SERVICE',
    status: 'QUEUED',
    coreRootDir: JURY_PRODUCT_DATA_ROOT,
    reviewType: 'FULL_REVIEW',
    requestedByUserId: input.userId,
  };
  const reading = await input.execute(input.pack);
  if (!(JURY_DECISIONS as readonly string[]).includes(reading.expectedDecision)) {
    return { ok: false, reason: 'DECISION_NOT_IN_CONTRACT' };
  }
  if (
    !(JURY_EVIDENCE_STRENGTHS as readonly string[]).includes(reading.evidenceStrength)
    || !(JURY_CLAIM_STRENGTHS as readonly string[]).includes(reading.claimStrength)
  ) {
    return { ok: false, reason: 'CORE_READING_REJECTED' };
  }
  const result: JuryReviewResult = {
    id: githubReviewResultId(requestId, reading.boardRunId),
    tenantId: input.tenantId,
    reviewRequestId: requestId,
    boardRunId: reading.boardRunId,
    evidenceStrength: reading.evidenceStrength as JuryEvidenceStrength,
    claimStrength: reading.claimStrength as JuryClaimStrength,
    conflictDetected: reading.conflictDetected,
    overclaimDetected: reading.overclaimDetected,
    revisionRequired: reading.revisionRequired,
    expectedDecision: reading.expectedDecision as JuryDecision,
    finalSurface: reading.finalSurface,
    contractVersion: JURY_CORE_CONTRACT_VERSION,
    completedAt: reading.completedAt,
  };
  return { ok: true, request: { ...request, status: 'COMPLETED' }, result };
}
