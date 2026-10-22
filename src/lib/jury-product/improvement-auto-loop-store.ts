/**
 * Reads one stored review and stops before an agent when the decision cannot continue.
 * The live path does not spawn a process or run a gate.
 */
import { autoLoopEntry, type AutoLoopEntryResult } from './auto-loop-activation';
import { admitImprovementAutoLoop } from './auto-loop-activation-store';
import { runTaskOnlyAutoLoop } from './auto-loop-execution-mode';
import { inspectStoredImprovementTask } from './auto-loop-preflight-store';
import { inspectImprovementEffect } from './improvement-effect-validation-store';
import { inspectImprovementIntent } from './improvement-intent-check-store';
import { inspectImprovementChangeScope } from './improvement-scope-check-store';
import { decideJuryMutation, resolveJuryActor } from './access';
import { persistSingleImprovementIteration } from './improvement-iteration-store';
import { runImprovementAutoLoop } from './improvement-auto-loop';
import { PRODUCT_LOOP_GUARD_DEFAULTS, type ProductLoopGuardPolicy } from './loop-guard';
import type { JuryMembership } from './records';

export async function persistImprovementAutoLoop(input: {
  userId: string | null;
  memberships: readonly JuryMembership[];
  clientTenantId?: string | null;
  now: string;
  reviewResultId: string;
}): Promise<AutoLoopEntryResult> {
  void input.clientTenantId;
  const admission = await admitImprovementAutoLoop(input);
  if ('stop' in admission) return admission;
  if (admission.mode === 'TASK_ONLY') return runTaskOnlyAutoLoop(input);
  const actor = resolveJuryActor({
    userId: input.userId,
    memberships: input.memberships,
    clientTenantId: input.clientTenantId,
  });
  if (!actor.ok) return autoLoopEntry('FORBIDDEN', input.reviewResultId);
  const allowed = decideJuryMutation({
    actor,
    action: 'review.start',
    resourceTenantId: actor.tenantId,
    clientTenantId: input.clientTenantId,
  });
  if (!allowed.ok) return autoLoopEntry(allowed.reason === 'TENANT_MISMATCH' ? 'TENANT_MISMATCH' : 'FORBIDDEN', input.reviewResultId);

  return runImprovementAutoLoop(
    {
      userId: input.userId,
      memberships: input.memberships,
      clientTenantId: input.clientTenantId,
      now: input.now,
      rootReviewResultId: input.reviewResultId,
    },
    {
      iteration: (command) => persistSingleImprovementIteration(command),
      policy: () => policyFor(actor.tenantId),
      async counters() {
        return { iteration: 0, verificationAttempts: 0, sameDecisionCount: 0, sameConflictCount: 0, runtimeMs: null, costUsd: null };
      },
      async alreadyDone() {
        return false;
      },
      async markDone() {},
      preflight(taskId) {
        return inspectStoredImprovementTask(taskId, actor.tenantId);
      },
      async agent() {
        return { ok: false, reason: 'AGENT_FAILED' };
      },
      scope(executionId) {
        return inspectImprovementChangeScope(executionId, actor.tenantId);
      },
      intent(executionId) {
        return inspectImprovementIntent(executionId, actor.tenantId);
      },
      async gate() {
        return { ok: false, reason: 'CHANGE_GATE_GATED', status: 'GATED' };
      },
      async rereview() {
        return { ok: false, reason: 'RE-REVIEW_NOT_APPROVED' };
      },
      async verification() {
        return { ok: false, reason: 'VERIFICATION_STOPPED', status: 'INCONCLUSIVE' };
      },
      async verificationReview() {
        return { ok: false, reason: 'VERIFICATION_STOPPED' };
      },
      effect(step) {
        return inspectImprovementEffect({ ...step, actorTenantId: actor.tenantId });
      },
    },
  );
}

export async function loadProductLoopPolicy(tenantId: string): Promise<ProductLoopGuardPolicy> {
  return policyFor(tenantId);
}

async function policyFor(tenantId: string): Promise<ProductLoopGuardPolicy> {
  const { prisma } = await import('@/lib/prisma');
  const row = await prisma.juryProductLoopPolicy.findUnique({ where: { tenantId } });
  if (!row) return PRODUCT_LOOP_GUARD_DEFAULTS;
  return {
    maxIterations: row.maxIterations,
    maxVerificationAttempts: row.maxVerificationAttempts,
    maxSameDecision: row.maxSameDecision,
    maxSameConflict: row.maxSameConflict,
    maxRuntimeMs: row.maxRuntimeMs,
    maxCostUsd: row.maxCostUsd,
  };
}
