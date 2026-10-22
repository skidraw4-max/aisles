/**
 * One decision step for a completed review result.
 * It calls the existing re-entry once and does not start an agent, a gate, or another iteration.
 */
import { decideJuryMutation, resolveJuryActor } from './access';
import type { resolveReReviewDecision } from './decision-cycle-resolution';
import type { reenterReReviewDecision } from './improvement-decision-reentry';
import type { startNewImprovementCycle } from './improvement-cycle-start';
import type { JuryMembership } from './records';

type Step = Awaited<ReturnType<typeof reenterReReviewDecision>>;
type ResolveFailure = Extract<Awaited<ReturnType<typeof resolveReReviewDecision>>, { ok: false }>['reason'];
type StartFailure = Extract<Awaited<ReturnType<typeof startNewImprovementCycle>>, { ok: false }>['reason'];

export type IterationFailure = ResolveFailure | StartFailure | 'REVIEW_NOT_COMPLETED';

export type IterationStop =
  | { ok: false; reason: IterationFailure }
  | {
      ok: true;
      decision: 'ACCEPT' | 'VERIFY' | 'REWORD';
      nextAction: 'NONE' | 'VERIFICATION' | 'IMPROVEMENT';
      cycleStatus: string;
      guard: string;
      verificationTaskId: string | null;
      decisionTaskId: string | null;
      improvementTaskId: string | null;
      cycleId: string | null;
    };

export type IterationReview = {
  id: string;
  tenantId: string;
  expectedDecision: string;
  requestStatus: string;
  completedAt: string | null;
};

export async function runSingleImprovementIteration(
  command: {
    userId: string | null;
    memberships: readonly JuryMembership[];
    clientTenantId?: string | null;
    now: string;
    reviewResultId: string;
  },
  io: {
    loadReview(reviewResultId: string): Promise<IterationReview | null>;
    reenter: (command: Parameters<typeof reenterReReviewDecision>[0]) => ReturnType<typeof reenterReReviewDecision>;
  },
): Promise<IterationStop> {
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

  const review = await io.loadReview(command.reviewResultId);
  if (!review) return { ok: false, reason: 'REVIEW_NOT_FOUND' };
  if (review.tenantId !== actor.tenantId) return { ok: false, reason: 'TENANT_MISMATCH' };
  if (review.requestStatus !== 'COMPLETED' || !review.completedAt) return { ok: false, reason: 'REVIEW_NOT_COMPLETED' };
  if (review.expectedDecision !== 'ACCEPT' && review.expectedDecision !== 'VERIFY' && review.expectedDecision !== 'REWORD') {
    return { ok: false, reason: 'DECISION_NOT_IN_CONTRACT' };
  }
  return stopForIteration(await io.reenter(command));
}

export function stopForIteration(outcome: Step): IterationStop {
  if (!outcome.ok) return outcome;
  if ('kind' in outcome) {
    return {
      ok: true,
      decision: 'REWORD',
      nextAction: 'IMPROVEMENT',
      cycleStatus: outcome.cycle.status,
      guard: 'ALLOWED',
      verificationTaskId: null,
      decisionTaskId: outcome.decisionTask.id,
      improvementTaskId: outcome.improvementTask.id,
      cycleId: outcome.cycle.id,
    };
  }
  if (outcome.cycleStatus === 'BLOCKED' || outcome.guard !== 'ALLOWED') {
    return {
      ok: true,
      decision: outcome.decision,
      nextAction: 'NONE',
      cycleStatus: outcome.cycleStatus,
      guard: outcome.guard,
      verificationTaskId: null,
      decisionTaskId: null,
      improvementTaskId: null,
      cycleId: null,
    };
  }
  if (outcome.decision === 'VERIFY') {
    return {
      ok: true,
      decision: 'VERIFY',
      nextAction: 'VERIFICATION',
      cycleStatus: outcome.cycleStatus,
      guard: outcome.guard,
      verificationTaskId: outcome.verificationTask?.id ?? null,
      decisionTaskId: outcome.verificationTask?.id ?? null,
      improvementTaskId: null,
      cycleId: null,
    };
  }
  if (outcome.decision === 'REWORD') {
    return {
      ok: true,
      decision: 'REWORD',
      nextAction: 'IMPROVEMENT',
      cycleStatus: outcome.cycleStatus,
      guard: outcome.guard,
      verificationTaskId: null,
      decisionTaskId: outcome.rewordTask?.id ?? null,
      improvementTaskId: outcome.improvementTask?.id ?? null,
      cycleId: null,
    };
  }
  return {
    ok: true,
    decision: 'ACCEPT',
    nextAction: 'NONE',
    cycleStatus: outcome.cycleStatus,
    guard: outcome.guard,
    verificationTaskId: null,
    decisionTaskId: null,
    improvementTaskId: null,
    cycleId: null,
  };
}
