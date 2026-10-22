/**
 * Puts one change-gate re-review result back into the existing decision cycle.
 * VERIFY without a cycle stops. REWORD without a cycle uses the existing start.
 * It does not run an agent, the change gate, or the review core.
 */
import { decideJuryMutation, resolveJuryActor } from './access';
import { resolveDecisionCycleLineage, type LineageIo } from './decision-cycle-lineage';
import type { resolveReReviewDecision } from './decision-cycle-resolution';
import type { startNewImprovementCycle } from './improvement-cycle-start';
import type { JuryMembership } from './records';

type ResolveCommand = Parameters<typeof resolveReReviewDecision>[0];
type StartCommand = Parameters<typeof startNewImprovementCycle>[0];

export async function reenterReReviewDecision(
  command: {
    userId: string | null;
    memberships: readonly JuryMembership[];
    clientTenantId?: string | null;
    now: string;
    reviewResultId: string;
  },
  io: {
    loadReview(reviewResultId: string): Promise<{ id: string; tenantId: string; expectedDecision: string } | null>;
    lineage: LineageIo;
    resolve: (command: ResolveCommand) => ReturnType<typeof resolveReReviewDecision>;
    start: (command: StartCommand) => ReturnType<typeof startNewImprovementCycle>;
  },
): Promise<Awaited<ReturnType<typeof resolveReReviewDecision>> | Awaited<ReturnType<typeof startNewImprovementCycle>>> {
  void command.clientTenantId;
  const actor = resolveJuryActor({
    userId: command.userId,
    memberships: command.memberships,
    clientTenantId: command.clientTenantId,
  });
  if (!actor.ok) return actor;
  const allowed = decideJuryMutation({
    actor,
    action: 'review.start',
    resourceTenantId: actor.tenantId,
    clientTenantId: command.clientTenantId,
  });
  if (!allowed.ok) return allowed;
  if (actor.role !== 'OWNER') return { ok: false, reason: 'FORBIDDEN' };

  const review = await io.loadReview(command.reviewResultId);
  if (!review) return { ok: false, reason: 'REVIEW_NOT_FOUND' };
  if (review.tenantId !== actor.tenantId) return { ok: false, reason: 'TENANT_MISMATCH' };

  const lineage = await resolveDecisionCycleLineage({ reviewResultId: review.id, tenantId: actor.tenantId }, io.lineage);
  if (!lineage.ok) {
    if (lineage.reason === 'DECISION_CYCLE_NOT_FOUND' && review.expectedDecision === 'REWORD') {
      return io.start(command);
    }
    return { ok: false, reason: lineage.reason };
  }
  if (lineage.cycle.rootReviewResultId === review.id && lineage.cycle.currentReviewResultId === review.id) {
    return io.start(command);
  }
  return io.resolve(command);
}
