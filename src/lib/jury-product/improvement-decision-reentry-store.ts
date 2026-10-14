/**
 * Reads one stored re-review result and routes it to the existing decision boundary.
 * A VERIFY result with no cycle does not start an improvement cycle.
 */
import { decideJuryMutation, resolveJuryActor } from './access';
import { resolveDecisionCycleLineage, type LineageCycleRef } from './decision-cycle-lineage';
import { persistReReviewDecision } from './decision-cycle-resolution-store';
import type { JuryMembership } from './records';

export async function persistChangeGateDecisionReentry(input: {
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
  if (actor.role !== 'OWNER') return { ok: false, reason: 'FORBIDDEN' as const };

  const { prisma } = await import('@/lib/prisma');
  const review = await prisma.juryReviewResult.findUnique({ where: { id: input.reviewResultId } });
  if (!review) return { ok: false as const, reason: 'REVIEW_NOT_FOUND' as const };
  if (review.tenantId !== actor.tenantId) return { ok: false as const, reason: 'TENANT_MISMATCH' as const };

  const lineage = await resolveDecisionCycleLineage(
    { reviewResultId: review.id, tenantId: actor.tenantId },
    {
      async load(id) {
        const row = await prisma.juryReviewResult.findUnique({ where: { id } });
        if (!row) return null;
        return { id: row.id, tenantId: row.tenantId, ancestorIds: await ancestorIds(row) };
      },
      async cyclesFor(id) {
        return cyclesFor(id);
      },
    },
  );
  if (!lineage.ok) {
    if (lineage.reason === 'DECISION_CYCLE_NOT_FOUND' && review.expectedDecision === 'REWORD') {
      return persistReReviewDecision(input);
    }
    return { ok: false as const, reason: lineage.reason };
  }
  return persistReReviewDecision(input);
}

async function ancestorIds(review: {
  id: string;
  parentReviewResultId: string | null;
  verificationResultId: string | null;
  decisionTaskId: string | null;
  reReviewRequestId: string | null;
}): Promise<string[]> {
  const { prisma } = await import('@/lib/prisma');
  const ids = new Set<string>();
  if (review.parentReviewResultId) ids.add(review.parentReviewResultId);
  if (review.verificationResultId) {
    const verification = await prisma.juryVerificationResult.findUnique({ where: { id: review.verificationResultId } });
    if (verification) ids.add(verification.reviewResultId);
  }
  if (review.decisionTaskId) {
    const task = await prisma.juryDecisionTask.findUnique({ where: { id: review.decisionTaskId } });
    if (task) ids.add(task.reviewResultId);
  }
  if (review.reReviewRequestId) {
    const request = await prisma.juryVerificationReview.findUnique({ where: { id: review.reReviewRequestId } });
    if (request) ids.add(request.parentReviewResultId);
  }
  const changeGates = await prisma.juryChangeGateReview.findMany({
    where: { reviewResultId: review.id },
    select: { parentReviewResultId: true },
  });
  for (const gate of changeGates) ids.add(gate.parentReviewResultId);
  ids.delete(review.id);
  return [...ids];
}

async function cyclesFor(reviewResultId: string): Promise<LineageCycleRef[]> {
  const { prisma } = await import('@/lib/prisma');
  const [root, currents] = await Promise.all([
    prisma.juryDecisionCycle.findUnique({ where: { rootReviewResultId: reviewResultId } }),
    prisma.juryDecisionCycle.findMany({ where: { currentReviewResultId: reviewResultId } }),
  ]);
  const found = new Map<string, LineageCycleRef>();
  for (const row of [root, ...currents]) {
    if (!row) continue;
    found.set(row.id, {
      id: row.id,
      tenantId: row.tenantId,
      rootReviewResultId: row.rootReviewResultId,
      currentReviewResultId: row.currentReviewResultId,
    });
  }
  return [...found.values()];
}
