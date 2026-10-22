/**
 * Advances one improvement cycle one step at a time.
 * It does not call itself, spawn an agent process, or invent a loop limit.
 */
import type { AutoLoopPreflightResult } from './auto-loop-preflight';
import type { ImprovementEffectResult } from './improvement-effect-validation';
import type { ImprovementIntentResult } from './improvement-intent-check';
import type { ImprovementScopeResult } from './improvement-scope-check';
import { evaluateLoopGuard, type ProductLoopGuardPolicy } from './loop-guard';
import type { IterationStop } from './improvement-iteration';
import type { JuryMembership } from './records';

export type AutoLoopStop =
  | 'ACCEPT'
  | 'COMPLETED'
  | 'LOOP_GUARD_BLOCKED'
  | 'CHANGE_GATE_GATED'
  | 'CHANGE_GATE_BLOCKED'
  | 'RE-REVIEW_NOT_APPROVED'
  | 'AGENT_FAILED'
  | 'VERIFICATION_STOPPED'
  | 'ALREADY_COMPLETED'
  | 'DECISION_CYCLE_NOT_FOUND'
  | 'TENANT_MISMATCH'
  | 'FORBIDDEN'
  | 'CREDENTIAL_IN_REASON'
  | 'REVIEW_NOT_FOUND'
  | 'REVIEW_NOT_COMPLETED'
  | 'PREFLIGHT_BLOCKED'
  | 'SCOPE_BLOCKED'
  | 'INTENT_BLOCKED';

export type AutoLoopResult = {
  ok: boolean;
  stop: AutoLoopStop;
  reviewResultId: string;
  decisionSteps: number;
  agentRuns: number;
  gateRuns: number;
  rereviewRuns: number;
  coreRuns: number;
  guardReasons: string[];
  effect?: ImprovementEffectResult | null;
};

type Command = {
  userId: string | null;
  memberships: readonly JuryMembership[];
  clientTenantId?: string | null;
  now: string;
  rootReviewResultId: string;
};

type GuardCounters = {
  iteration: number;
  verificationAttempts: number;
  sameDecisionCount: number;
  sameConflictCount: number;
  runtimeMs: number | null;
  costUsd: number | null;
};

export async function runImprovementAutoLoop(
  command: Command,
  io: {
    iteration(command: Command & { reviewResultId: string }): Promise<IterationStop>;
    policy(): Promise<ProductLoopGuardPolicy>;
    counters(): Promise<GuardCounters>;
    alreadyDone(taskId: string): Promise<boolean>;
    markDone(taskId: string): Promise<void>;
    preflight?(improvementTaskId: string): Promise<AutoLoopPreflightResult>;
    agent(improvementTaskId: string): Promise<{ ok: true; executionId: string; status: string } | { ok: false; reason: string }>;
    scope?(executionId: string): Promise<ImprovementScopeResult>;
    intent?(executionId: string): Promise<ImprovementIntentResult>;
    gate(executionId: string): Promise<{ ok: true; id: string; status: string } | { ok: false; reason: string; status?: string }>;
    rereview(changeGateResultId: string): Promise<{ ok: true; reviewResultId: string; coreRuns: number } | { ok: false; reason: string }>;
    verification(verificationTaskId: string): Promise<{ ok: true; status: string } | { ok: false; reason: string; status?: string }>;
    verificationReview(verificationTaskId: string): Promise<{ ok: true; reviewResultId: string; coreRuns: number } | { ok: false; reason: string }>;
    effect?(input: {
      improvementTaskId: string;
      reviewResultId: string;
      decision: 'ACCEPT' | 'VERIFY' | 'REWORD';
    }): Promise<ImprovementEffectResult>;
  },
): Promise<AutoLoopResult> {
  const seen = new Set<string>();
  let current = command.rootReviewResultId;
  let decisionSteps = 0;
  let agentRuns = 0;
  let gateRuns = 0;
  let rereviewRuns = 0;
  let coreRuns = 0;
  const guardReasons: string[] = [];
  let lastEffect: ImprovementEffectResult | null = null;
  let pendingEffectTaskId: string | null = null;
  let cycleImprovementTaskId: string | null = null;

  while (true) {
    if (seen.has(current)) return finish('ALREADY_COMPLETED', false);
    seen.add(current);
    const step = await io.iteration({ ...command, reviewResultId: current });
    decisionSteps += 1;
    if (pendingEffectTaskId && io.effect && step.ok && (step.decision === 'ACCEPT' || step.decision === 'VERIFY' || step.decision === 'REWORD')) {
      lastEffect = await io.effect({ improvementTaskId: pendingEffectTaskId, reviewResultId: current, decision: step.decision });
      pendingEffectTaskId = null;
    }
    const early = terminal(step);
    if (early) return finish(early, step.ok);
    if (!step.ok) return finish('COMPLETED', false);
    const taskId = step.nextAction === 'IMPROVEMENT' ? step.improvementTaskId : step.verificationTaskId;
    if (!taskId) return finish('ALREADY_COMPLETED', true);
    if (await io.alreadyDone(taskId)) return finish('ALREADY_COMPLETED', true);
    const guard = evaluateLoopGuard({ policy: await io.policy(), ...(await io.counters()) });
    guardReasons.push(guard.reason);
    if (!guard.allowed) return finish('LOOP_GUARD_BLOCKED', true);

    if (step.nextAction === 'IMPROVEMENT') {
      if (io.preflight) {
        const check = await io.preflight(taskId);
        if (check.status !== 'SAFE') {
          guardReasons.push(check.code);
          if (check.code === 'TENANT_MISMATCH') return finish('TENANT_MISMATCH', false);
          return finish('PREFLIGHT_BLOCKED', false);
        }
      }
      const agent = await retry(() => io.agent(taskId));
      agentRuns += 1;
      if (!agent.ok || agent.status === 'FAILED' || agent.status === 'BLOCKED') return finish(stopReason(agent.ok ? 'AGENT_FAILED' : agent.reason), false);
      if (io.scope) {
        const scope = await io.scope(agent.executionId);
        if (scope.status !== 'SAFE') {
          guardReasons.push(scope.code);
          if (scope.code === 'TENANT_MISMATCH') return finish('TENANT_MISMATCH', false);
          return finish('SCOPE_BLOCKED', false);
        }
      }
      if (io.intent) {
        const intent = await io.intent(agent.executionId);
        if (intent.status !== 'SAFE') {
          guardReasons.push(intent.code);
          if (intent.code === 'TENANT_MISMATCH') return finish('TENANT_MISMATCH', false);
          return finish('INTENT_BLOCKED', false);
        }
      }
      const gate = await retry(() => io.gate(agent.executionId));
      gateRuns += 1;
      if (!gate.ok || gate.status === 'GATED') return finish('CHANGE_GATE_GATED', false);
      if (gate.status === 'BLOCKED') return finish('CHANGE_GATE_BLOCKED', false);
      if (gate.status !== 'APPROVED') return finish('CHANGE_GATE_GATED', false);
      const review = await retry(() => io.rereview(gate.id));
      rereviewRuns += 1;
      if (!review.ok) return finish(stopReason(review.reason), false);
      coreRuns += review.coreRuns;
      await io.markDone(taskId);
      cycleImprovementTaskId = taskId;
      pendingEffectTaskId = taskId;
      current = review.reviewResultId;
      continue;
    }

    const verification = await retry(() => io.verification(taskId));
    if (!verification.ok || verification.status === 'INCONCLUSIVE') return finish(stopReason(verification.ok ? 'VERIFICATION_STOPPED' : verification.reason), false);
    const review = await retry(() => io.verificationReview(taskId));
    rereviewRuns += 1;
    if (!review.ok) return finish(stopReason(review.reason), false);
    coreRuns += review.coreRuns;
    await io.markDone(taskId);
    pendingEffectTaskId = cycleImprovementTaskId;
    current = review.reviewResultId;
  }

  function finish(stop: AutoLoopStop, ok: boolean): AutoLoopResult {
    return { ok, stop, reviewResultId: current, decisionSteps, agentRuns, gateRuns, rereviewRuns, coreRuns, guardReasons, effect: lastEffect };
  }
}

function terminal(step: IterationStop): AutoLoopStop | null {
  if (!step.ok) return stopReason(step.reason);
  if (step.cycleStatus === 'BLOCKED' || (step.guard !== 'ALLOWED' && step.nextAction === 'NONE')) return 'LOOP_GUARD_BLOCKED';
  if (step.decision === 'ACCEPT' || step.cycleStatus === 'COMPLETED') return 'ACCEPT';
  if (step.nextAction === 'NONE') return 'COMPLETED';
  return null;
}

function stopReason(reason: string): AutoLoopStop {
  if (reason === 'TENANT_MISMATCH' || reason === 'FORBIDDEN' || reason === 'DECISION_CYCLE_NOT_FOUND') return reason;
  if (reason === 'REVIEW_NOT_FOUND' || reason === 'REVIEW_NOT_COMPLETED') return reason;
  if (reason.includes('CREDENTIAL') || reason === 'CREDENTIAL_IN_REASON' || reason === 'CREDENTIAL_DATA_DETECTED') return 'CREDENTIAL_IN_REASON';
  if (reason === 'RE-REVIEW_NOT_APPROVED') return 'RE-REVIEW_NOT_APPROVED';
  if (reason === 'AGENT_FAILED' || reason === 'AGENT_EXECUTION_FAILED') return 'AGENT_FAILED';
  if (reason === 'LOOP_GUARD_BLOCKED' || reason.startsWith('MAX_')) return 'LOOP_GUARD_BLOCKED';
  return 'VERIFICATION_STOPPED';
}

async function retry<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (!isUnique(error)) throw error;
    return run();
  }
}

function isUnique(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && (error as { code?: string }).code === 'P2002');
}
