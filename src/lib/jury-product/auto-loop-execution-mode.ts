/**
 * Runs one existing decision step and stops before an agent.
 * It does not enter the auto-loop work section or the next iteration.
 */
import { autoLoopEntry, type AutoLoopEntryResult, type AutoLoopEntryStop } from './auto-loop-activation';
import { persistSingleImprovementIteration } from './improvement-iteration-store';
import type { JuryMembership } from './records';

export async function runTaskOnlyAutoLoop(input: {
  userId: string | null;
  memberships: readonly JuryMembership[];
  clientTenantId?: string | null;
  now: string;
  reviewResultId: string;
}): Promise<AutoLoopEntryResult> {
  const step = await persistSingleImprovementIteration({
    userId: input.userId,
    memberships: input.memberships,
    clientTenantId: input.clientTenantId,
    now: input.now,
    reviewResultId: input.reviewResultId,
  });
  if (!step.ok) return autoLoopEntry(taskOnlyFailure(step.reason), input.reviewResultId);
  return {
    ok: true,
    stop: 'TASK_ONLY',
    reviewResultId: input.reviewResultId,
    decisionSteps: 1,
    agentRuns: 0,
    gateRuns: 0,
    rereviewRuns: 0,
    coreRuns: 0,
    guardReasons: [],
  };
}

function taskOnlyFailure(reason: string): AutoLoopEntryStop {
  if (
    reason === 'TENANT_MISMATCH' ||
    reason === 'FORBIDDEN' ||
    reason === 'DECISION_CYCLE_NOT_FOUND' ||
    reason === 'REVIEW_NOT_FOUND' ||
    reason === 'REVIEW_NOT_COMPLETED'
  ) {
    return reason;
  }
  if (reason.includes('CREDENTIAL')) return 'CREDENTIAL_IN_REASON';
  return 'VERIFICATION_STOPPED';
}
