/**
 * Runs the existing auto loop against Product persistence.
 * The caller injects the adapter, the core, and the workspace inspect.
 * This module does not spawn a process or call the frozen pipeline.
 */
import { admitImprovementAutoLoop } from './auto-loop-activation-store';
import { inspectStoredImprovementTask } from './auto-loop-preflight-store';
import { inspectImprovementEffect } from './improvement-effect-validation-store';
import { loadLoopSpend } from './loop-spend';
import { inspectImprovementIntent } from './improvement-intent-check-store';
import { inspectImprovementChangeScope } from './improvement-scope-check-store';
import { runTaskOnlyAutoLoop } from './auto-loop-execution-mode';
import type { AutoLoopEntryResult } from './auto-loop-activation';
import type { AgentAdapter } from './agents/agent-adapter';
import type { ChangeInspection } from './change-gate';
import { persistChangeGateReReviewExecution, persistChangeGateReReviewRequest } from './change-gate-rereview-store';
import { persistImprovementAgentRun } from './improvement-agent-run-store';
import { runImprovementAutoLoop, type AutoLoopResult, type AutoLoopStop } from './improvement-auto-loop';
import { loadProductLoopPolicy } from './improvement-auto-loop-store';
import { persistImprovementChangeGate } from './improvement-change-gate-store';
import { persistSingleImprovementIteration } from './improvement-iteration-store';
import { resolveJuryActor } from './access';
import { evaluateLoopGuard } from './loop-guard';
import type { JuryMembership } from './records';
import type { ProductReviewCore } from './review-boundary';
import { persistVerificationReReview, persistVerificationResolution } from './verification-resolution-store';
import { persistVerificationReReviewExecution } from './verification-rereview-store';

const PROTECTED_REVIEW_IDS = new Set([
  '3707202563ecae9b38f324a4eefd9243a14bc69420ed6cdda16c4c5794f62e0d',
  '2f6638a0addf8a8706ddf8d53396bb81b37c9aeadae4910a33be00f634be3f59',
  '6adbe7150104e3b95030e5499f52085d8e72dbcb8f999136782bdb0f96fbd7e7',
]);

type Inspect = (relativeRoot: string) => Promise<
  | { ok: true; files: ChangeInspection['files']; present: string[] }
  | { ok: false; reason: 'WORKSPACE_NOT_ALLOWED' | 'WORKSPACE_ESCAPE' }
>;

export type IntegratedAutoLoopInput = {
  userId: string | null;
  memberships: readonly JuryMembership[];
  clientTenantId?: string | null;
  now: string;
  reviewResultId: string;
  adapter: AgentAdapter;
  core: ProductReviewCore;
  inspect: Inspect;
};

export async function persistIntegratedAutoLoop(input: IntegratedAutoLoopInput): Promise<AutoLoopEntryResult> {
  const admission = await admitImprovementAutoLoop(input);
  if ('stop' in admission) return admission;
  if (admission.mode === 'TASK_ONLY') return runTaskOnlyAutoLoop(input);
  if (PROTECTED_REVIEW_IDS.has(input.reviewResultId)) return stopped('REVIEW_NOT_FOUND', input.reviewResultId);
  const command = {
    userId: input.userId,
    memberships: input.memberships,
    clientTenantId: input.clientTenantId,
    now: input.now,
    rootReviewResultId: input.reviewResultId,
  };
  return runImprovementAutoLoop(command, {
    iteration: (step) => persistSingleImprovementIteration(step),
    async policy() {
      const { prisma } = await import('@/lib/prisma');
      const review = await prisma.juryReviewResult.findUnique({
        where: { id: input.reviewResultId },
        select: { tenantId: true },
      });
      if (!review) return loadProductLoopPolicy('missing-tenant');
      return loadProductLoopPolicy(review.tenantId);
    },
    counters: () => readCounters(input.reviewResultId, input.now),
    async alreadyDone() {
      return false;
    },
    async markDone() {},
    preflight(taskId) {
      const actor = resolveJuryActor({
        userId: input.userId,
        memberships: input.memberships,
        clientTenantId: input.clientTenantId,
      });
      if (!actor.ok) return Promise.resolve({ status: 'BLOCKED' as const, code: 'TASK_INCOMPLETE' as const });
      return inspectStoredImprovementTask(taskId, actor.tenantId);
    },
    agent: (taskId) => settleAgent(input, taskId),
    scope(executionId) {
      const actor = resolveJuryActor({
        userId: input.userId,
        memberships: input.memberships,
        clientTenantId: input.clientTenantId,
      });
      if (!actor.ok) return Promise.resolve({ status: 'BLOCKED' as const, code: 'TENANT_MISMATCH' as const, reason: 'OUTSIDE_TASK_SCOPE' as const });
      return inspectImprovementChangeScope(executionId, actor.tenantId);
    },
    intent(executionId) {
      const actor = resolveJuryActor({
        userId: input.userId,
        memberships: input.memberships,
        clientTenantId: input.clientTenantId,
      });
      if (!actor.ok) return Promise.resolve({ status: 'BLOCKED' as const, code: 'TENANT_MISMATCH' as const, reason: 'OUTSIDE_TASK_INTENT' as const });
      return inspectImprovementIntent(executionId, actor.tenantId);
    },
    gate: (executionId) => settleGate(input, executionId),
    rereview: (changeGateResultId) => settleChangeGateReview(input, changeGateResultId),
    verification: (taskId) => settleVerification(input, taskId),
    verificationReview: (taskId) => settleVerificationReview(input, taskId),
    effect(step) {
      const actor = resolveJuryActor({
        userId: input.userId,
        memberships: input.memberships,
        clientTenantId: input.clientTenantId,
      });
      if (!actor.ok) return Promise.resolve({ status: 'BLOCKED' as const, code: 'TENANT_MISMATCH' as const, reason: 'TENANT_MISMATCH' as const });
      return inspectImprovementEffect({ ...step, actorTenantId: actor.tenantId });
    },
  });
}

function stopped(stop: AutoLoopStop, reviewResultId: string): AutoLoopResult {
  return {
    ok: false,
    stop,
    reviewResultId,
    decisionSteps: 0,
    agentRuns: 0,
    gateRuns: 0,
    rereviewRuns: 0,
    coreRuns: 0,
    guardReasons: [],
  };
}

async function readCounters(rootReviewResultId: string, now: string) {
  const { prisma } = await import('@/lib/prisma');
  const cycle = await prisma.juryDecisionCycle.findUnique({ where: { rootReviewResultId } });
  if (!cycle) {
    return {
      iteration: 0,
      verificationAttempts: 0,
      sameDecisionCount: 0,
      sameConflictCount: 0,
      runtimeMs: null,
      costUsd: null,
    };
  }
  const spend = await loadLoopSpend(prisma, {
    tenantId: cycle.tenantId,
    rootReviewResultId,
    startedAt: cycle.startedAt,
    now,
  });
  return {
    iteration: cycle.iteration,
    verificationAttempts: cycle.verificationAttempts,
    sameDecisionCount: cycle.sameDecisionCount,
    sameConflictCount: cycle.sameConflictCount,
    runtimeMs: spend.runtimeMs,
    costUsd: spend.costUsd,
  };
}

async function settleAgent(input: IntegratedAutoLoopInput, improvementTaskId: string) {
  const outcome = await persistImprovementAgentRun({
    userId: input.userId,
    memberships: input.memberships,
    clientTenantId: input.clientTenantId,
    now: input.now,
    improvementTaskId,
    adapter: input.adapter,
  });
  const execution = executionOf(outcome);
  if (outcome.ok && execution?.status === 'COMPLETED') {
    return { ok: true as const, executionId: execution.id, status: 'COMPLETED' };
  }
  if (!outcome.ok && outcome.reason === 'EXECUTION_NOT_PENDING' && execution) {
    const status = await waitExecution(execution.id);
    if (status === 'COMPLETED') return { ok: true as const, executionId: execution.id, status: 'COMPLETED' };
    return { ok: false as const, reason: 'AGENT_FAILED' };
  }
  if (!outcome.ok) return { ok: false as const, reason: outcome.reason };
  if (execution) return { ok: true as const, executionId: execution.id, status: execution.status };
  return { ok: false as const, reason: 'AGENT_FAILED' };
}

async function settleGate(input: IntegratedAutoLoopInput, executionId: string) {
  const gate = await persistImprovementChangeGate({
    userId: input.userId,
    memberships: input.memberships,
    clientTenantId: input.clientTenantId,
    now: input.now,
    executionId,
    inspect: input.inspect,
  });
  if (!gate.ok) return { ok: false as const, reason: gate.reason, status: undefined };
  return { ok: true as const, id: gate.gate.id, status: gate.gate.status };
}

async function settleChangeGateReview(input: IntegratedAutoLoopInput, changeGateResultId: string) {
  const { prisma } = await import('@/lib/prisma');
  const gate = await prisma.juryChangeGateResult.findUnique({ where: { id: changeGateResultId } });
  const task = gate?.improvementTaskId
    ? await prisma.juryImprovementTask.findUnique({ where: { id: gate.improvementTaskId } })
    : null;
  if (!gate || !task?.evidenceId || !task.reviewResultId) {
    return { ok: false as const, reason: 'RE-REVIEW_NOT_APPROVED' };
  }
  const requested = await persistChangeGateReReviewRequest({
    userId: input.userId,
    memberships: input.memberships,
    clientTenantId: input.clientTenantId,
    now: input.now,
    changeGateResultId,
    evidenceId: task.evidenceId,
    sourceEvidenceId: task.evidenceId,
    parentReviewResultId: task.reviewResultId,
    reason: { code: 'CHANGE_GATE_APPROVED', message: 'approved workspace note' },
  });
  if (!requested.ok) return { ok: false as const, reason: requested.reason };
  const executed = await persistChangeGateReReviewExecution(
    {
      userId: input.userId,
      memberships: input.memberships,
      clientTenantId: input.clientTenantId,
      now: input.now,
      requestId: requested.review.id,
      siteName: 'phase34',
    },
    input.core,
  );
  if (executed.ok) {
    return { ok: true as const, reviewResultId: executed.result.id, coreRuns: executed.created ? 1 : 0 };
  }
  if (executed.reason === 'REVIEW_IN_PROGRESS') {
    const reviewResultId = await waitChangeGateResult(requested.review.id);
    if (reviewResultId) return { ok: true as const, reviewResultId, coreRuns: 0 };
  }
  return { ok: false as const, reason: executed.reason };
}

async function settleVerification(input: IntegratedAutoLoopInput, verificationTaskId: string) {
  const resolved = await persistVerificationResolution({
    userId: input.userId,
    memberships: input.memberships,
    clientTenantId: input.clientTenantId,
    now: input.now,
    decisionTaskId: verificationTaskId,
  });
  if (!resolved.ok) return { ok: false as const, reason: resolved.reason, status: undefined };
  return { ok: true as const, status: resolved.result.status };
}

async function settleVerificationReview(input: IntegratedAutoLoopInput, verificationTaskId: string) {
  const policy = await loadProductLoopPolicy(await tenantOfTask(verificationTaskId));
  const guard = evaluateLoopGuard({ policy, ...(await readCounters(input.reviewResultId, input.now)) });
  if (!guard.allowed) return { ok: false as const, reason: guard.reason };
  const requested = await persistVerificationReReview({
    userId: input.userId,
    memberships: input.memberships,
    clientTenantId: input.clientTenantId,
    now: input.now,
    decisionTaskId: verificationTaskId,
  });
  if (!requested.ok) return { ok: false as const, reason: requested.reason };
  const executed = await persistVerificationReReviewExecution(
    {
      userId: input.userId,
      memberships: input.memberships,
      clientTenantId: input.clientTenantId,
      now: input.now,
      requestId: requested.review.id,
      siteName: 'phase34',
    },
    input.core,
  );
  if (executed.ok) return { ok: true as const, reviewResultId: executed.result.id, coreRuns: 1 };
  if (executed.reason === 'REVIEW_IN_PROGRESS' || executed.reason === 'REVIEW_ALREADY_EXECUTED') {
    const reviewResultId = await waitVerificationResult(requested.review.id);
    if (reviewResultId) return { ok: true as const, reviewResultId, coreRuns: 0 };
  }
  return { ok: false as const, reason: executed.reason };
}

async function tenantOfTask(taskId: string): Promise<string> {
  const { prisma } = await import('@/lib/prisma');
  const task = await prisma.juryDecisionTask.findUnique({ where: { id: taskId }, select: { tenantId: true } });
  return task?.tenantId ?? 'missing-tenant';
}

function executionOf(value: unknown): { id: string; status: string } | null {
  if (!value || typeof value !== 'object' || !('execution' in value)) return null;
  const execution = (value as { execution?: { id?: unknown; status?: unknown } | null }).execution;
  if (!execution || typeof execution.id !== 'string' || typeof execution.status !== 'string') return null;
  return { id: execution.id, status: execution.status };
}

async function waitExecution(id: string): Promise<string | null> {
  const { prisma } = await import('@/lib/prisma');
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const row = await prisma.juryAgentExecution.findUnique({ where: { id }, select: { status: true } });
    if (row && row.status !== 'PENDING' && row.status !== 'RUNNING') return row.status;
    await delay(50);
  }
  const row = await prisma.juryAgentExecution.findUnique({ where: { id }, select: { status: true } });
  return row?.status ?? null;
}

async function waitChangeGateResult(requestId: string): Promise<string | null> {
  const { prisma } = await import('@/lib/prisma');
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const row = await prisma.juryChangeGateReview.findUnique({
      where: { id: requestId },
      select: { status: true, reviewResultId: true },
    });
    if (row?.status === 'EXECUTED' && row.reviewResultId) return row.reviewResultId;
    if (row?.status === 'FAILED') return null;
    await delay(50);
  }
  return null;
}

async function waitVerificationResult(requestId: string): Promise<string | null> {
  const { prisma } = await import('@/lib/prisma');
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const review = await prisma.juryVerificationReview.findUnique({ where: { id: requestId }, select: { status: true } });
    if (review?.status === 'FAILED' || review?.status === 'BLOCKED') return null;
    const result = await prisma.juryReviewResult.findUnique({ where: { reReviewRequestId: requestId }, select: { id: true } });
    if (result) return result.id;
    await delay(50);
  }
  return null;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
