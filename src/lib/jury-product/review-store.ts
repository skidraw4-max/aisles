/**
 * Stores a finished product review. It copies the comparator reading and does not score it again.
 */
import { Prisma } from '@prisma/client';
import {
  JURY_DECISIONS,
  JURY_PRODUCT_DATA_ROOT,
  type JuryReviewRequest,
  type JuryReviewResult,
} from './records';

export type ReviewPersistFailure = 'ROOT_MISMATCH' | 'TENANT_MISMATCH' | 'DECISION_NOT_IN_CONTRACT';

export type ReviewWriteTx = {
  insert(request: JuryReviewRequest, result: JuryReviewResult): Promise<void>;
};

export async function runProductReviewPersist(
  input: { request: JuryReviewRequest; result: JuryReviewResult },
  tx: ReviewWriteTx,
): Promise<{ ok: true } | { ok: false; reason: ReviewPersistFailure }> {
  const { request, result } = input;
  if (request.coreRootDir !== JURY_PRODUCT_DATA_ROOT) return { ok: false, reason: 'ROOT_MISMATCH' };
  if (request.tenantId !== result.tenantId || request.id !== result.reviewRequestId) {
    return { ok: false, reason: 'TENANT_MISMATCH' };
  }
  if (!(JURY_DECISIONS as readonly string[]).includes(result.expectedDecision)) {
    return { ok: false, reason: 'DECISION_NOT_IN_CONTRACT' };
  }
  await tx.insert(request, result);
  return { ok: true };
}

export async function persistProductReview(input: {
  request: JuryReviewRequest;
  result: JuryReviewResult;
}): Promise<{ ok: true } | { ok: false; reason: ReviewPersistFailure }> {
  const { prisma } = await import('@/lib/prisma');
  return prisma.$transaction((tx) =>
    runProductReviewPersist(input, {
      async insert(request, result) {
        await tx.juryReviewRequest.create({
          data: {
            id: request.id,
            tenantId: request.tenantId,
            connectionId: request.connectionId,
            evidenceId: request.evidenceId,
            reviewType: request.reviewType,
            claim: request.claim ?? null,
            mode: request.mode,
            status: request.status,
            coreRootDir: request.coreRootDir,
            requestedByUserId: request.requestedByUserId ?? null,
          },
        });
        await tx.juryReviewResult.create({
          data: {
            id: result.id,
            tenantId: result.tenantId,
            reviewRequestId: result.reviewRequestId,
            boardRunId: result.boardRunId,
            evidenceStrength: result.evidenceStrength,
            claimStrength: result.claimStrength,
            conflictDetected: result.conflictDetected,
            overclaimDetected: result.overclaimDetected,
            revisionRequired: result.revisionRequired,
            expectedDecision: result.expectedDecision,
            finalSurface: result.finalSurface as Prisma.InputJsonValue,
            contractVersion: result.contractVersion,
            completedAt: new Date(result.completedAt),
          },
        });
      },
    }),
  );
}
