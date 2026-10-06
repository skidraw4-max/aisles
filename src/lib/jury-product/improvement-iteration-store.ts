/**
 * Runs one stored review result through the existing decision re-entry.
 * It does not start an agent, a change gate, a re-review, or another iteration.
 */
import { decideJuryMutation, resolveJuryActor } from './access';
import { persistChangeGateDecisionReentry } from './improvement-decision-reentry-store';
import { stopForIteration, type IterationStop } from './improvement-iteration';
import type { reenterReReviewDecision } from './improvement-decision-reentry';
import type { JuryMembership } from './records';

export async function persistSingleImprovementIteration(input: {
  userId: string | null;
  memberships: readonly JuryMembership[];
  clientTenantId?: string | null;
  now: string;
  reviewResultId: string;
}) {
  void input.clientTenantId;
  const actor = resolveJuryActor({
    userId: input.userId,
    memberships: input.memberships,
    clientTenantId: input.clientTenantId,
  });
  if (!actor.ok) return actor;
  const allowed = decideJuryMutation({
    actor,
    action: 'review.start',
    resourceTenantId: actor.tenantId,
    clientTenantId: input.clientTenantId,
  });
  if (!allowed.ok) return allowed;

  const { prisma } = await import('@/lib/prisma');
  const review = await prisma.juryReviewResult.findUnique({ where: { id: input.reviewResultId } });
  if (!review) return { ok: false as const, reason: 'REVIEW_NOT_FOUND' as const };
  if (review.tenantId !== actor.tenantId) return { ok: false as const, reason: 'TENANT_MISMATCH' as const };
  const request = await prisma.juryReviewRequest.findUnique({ where: { id: review.reviewRequestId } });
  if (!request || request.status !== 'COMPLETED' || !review.completedAt) {
    return { ok: false as const, reason: 'REVIEW_NOT_COMPLETED' as const };
  }
  if (review.expectedDecision !== 'ACCEPT' && review.expectedDecision !== 'VERIFY' && review.expectedDecision !== 'REWORD') {
    return { ok: false as const, reason: 'DECISION_NOT_IN_CONTRACT' as const };
  }
  const outcome = await persistChangeGateDecisionReentry(input);
  if (outcome.ok !== true) return { ok: false, reason: outcome.reason } as IterationStop;
  return stopForIteration(outcome as Awaited<ReturnType<typeof reenterReReviewDecision>>);
}
