/**
 * Reads one task and its re-review, then passes them to the effect check.
 * It does not write a row or an audit.
 */
import { effectFromStoredRows, type ImprovementEffectResult } from './improvement-effect-validation';

export async function inspectImprovementEffect(input: {
  actorTenantId: string;
  improvementTaskId: string;
  reviewResultId: string;
  decision: 'ACCEPT' | 'VERIFY' | 'REWORD';
}): Promise<ImprovementEffectResult> {
  const { prisma } = await import('@/lib/prisma');
  const task = await prisma.juryImprovementTask.findUnique({
    where: { id: input.improvementTaskId },
    select: { tenantId: true, reviewResultId: true, objective: true },
  });
  const review = await prisma.juryReviewResult.findUnique({
    where: { id: input.reviewResultId },
    select: { tenantId: true, parentReviewResultId: true, overclaimDetected: true, verificationResultId: true },
  });
  const verification = review?.verificationResultId
    ? await prisma.juryVerificationResult.findUnique({
        where: { id: review.verificationResultId },
        select: { tenantId: true, status: true, reviewResultId: true },
      })
    : null;
  const verifiedReview = verification
    ? await prisma.juryReviewResult.findUnique({
        where: { id: verification.reviewResultId },
        select: { tenantId: true, parentReviewResultId: true },
      })
    : null;
  return effectFromStoredRows({
    actorTenantId: input.actorTenantId,
    decision: input.decision,
    task,
    review,
    verification,
    verifiedReview,
  });
}
