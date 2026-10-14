/**
 * Runs the existing re-review after an APPROVED following change gate.
 * It does not create an improvement task, approval, handoff, or execution.
 */
import { Prisma } from '@prisma/client';
import { decideJuryMutation, resolveJuryActor } from './access';
import type { HumanReReviewView } from './human-re-review';
import { HUMAN_IMPROVEMENT_KIND, humanImprovementTaskType } from './human-improvement-bridge';
import type { JuryDecision, JuryMembership } from './records';
import { JURY_DECISIONS } from './records';
import { REREVIEW_IMPROVEMENT_KIND } from './rereview-improvement-bridge';
import { evaluateSecondReReview, type SecondReReviewFailure } from './rereview-second-review';
import type { ProductReviewCore } from './review-boundary';

export async function evaluateFollowingReReview(input: {
  userId: string | null;
  memberships: readonly JuryMembership[];
  agentExecutionId: string;
  core?: ProductReviewCore;
}): Promise<
  | { ok: true; created: boolean; reviewId: string; agentExecutionId: string; reReview: HumanReReviewView }
  | { ok: false; reason: SecondReReviewFailure }
> {
  const actor = resolveJuryActor({ userId: input.userId, memberships: input.memberships, clientTenantId: null });
  if (!actor.ok) return { ok: false, reason: actor.reason };
  if (!input.agentExecutionId.trim()) return { ok: false, reason: 'NOT_FOUND' };
  const ready = await loadFollowingExecution(actor.tenantId, input.agentExecutionId);
  if (!ready.ok) return ready;
  const allowed = decideJuryMutation({
    actor,
    action: 'review.start',
    resourceTenantId: actor.tenantId,
  });
  if (!allowed.ok) return { ok: false, reason: 'FORBIDDEN' };
  if (ready.status !== 'COMPLETED') return { ok: false, reason: 'EXECUTION_NOT_COMPLETED' };
  const reviewed = await evaluateSecondReReview({
    userId: input.userId,
    memberships: input.memberships,
    agentExecutionId: input.agentExecutionId,
    core: input.core,
  });
  if (!reviewed.ok) return reviewed;
  await stampOriginalRoot(actor.tenantId, input.agentExecutionId, ready.rootId);
  return { ...reviewed, reviewId: ready.rootId };
}

async function stampOriginalRoot(tenantId: string, agentExecutionId: string, rootId: string): Promise<void> {
  const { prisma } = await import('@/lib/prisma');
  const gate = await prisma.juryChangeGateResult.findFirst({
    where: { executionId: agentExecutionId, tenantId },
    select: { id: true },
  });
  if (!gate) return;
  const review = await prisma.juryChangeGateReview.findFirst({
    where: { changeGateResultId: gate.id, tenantId },
    select: { id: true, provenance: true },
  });
  if (!review) return;
  const current = review.provenance && typeof review.provenance === 'object' && !Array.isArray(review.provenance)
    ? review.provenance
    : {};
  if (textField(current, 'originalReviewResultId') === rootId) return;
  await prisma.juryChangeGateReview.updateMany({
    where: { id: review.id, tenantId },
    data: { provenance: { ...current, originalReviewResultId: rootId } as Prisma.InputJsonValue },
  });
}

async function loadFollowingExecution(
  tenantId: string,
  agentExecutionId: string,
): Promise<{ ok: true; rootId: string; status: string } | { ok: false; reason: SecondReReviewFailure }> {
  const { prisma } = await import('@/lib/prisma');
  const current = await prisma.juryAgentExecution.findFirst({
    where: { id: agentExecutionId, tenantId },
    select: { id: true, taskId: true, agent: true, status: true, provenance: true },
  });
  if (!current || current.agent !== 'CURSOR') return { ok: false, reason: 'NOT_FOUND' };
  const task = await prisma.juryImprovementTask.findFirst({
    where: { id: current.taskId, tenantId },
    select: {
      id: true,
      reviewResultId: true,
      parentTaskId: true,
      status: true,
      taskType: true,
      evidenceId: true,
      provenance: true,
    },
  });
  if (!task) return { ok: false, reason: 'NOT_FOUND' };
  const marked = reReviewTask(task.provenance, task.id, task.reviewResultId);
  const taskType = task.taskType === 'VERIFICATION' || task.taskType === 'REWORD' ? task.taskType : null;
  if (!marked || !taskType || task.parentTaskId !== marked.sourceImprovementTaskId || current.id === marked.agentExecutionId) {
    return { ok: false, reason: 'NOT_REREVIEW_IMPROVEMENT_TASK' };
  }
  const result = await prisma.juryReviewResult.findFirst({
    where: { id: task.reviewResultId, tenantId },
    select: {
      id: true,
      reviewRequestId: true,
      parentReviewResultId: true,
      expectedDecision: true,
      request: { select: { id: true, tenantId: true, evidenceId: true } },
    },
  });
  const decision = result ? oneOf(JURY_DECISIONS, result.expectedDecision) : null;
  const reviews = result
    ? await prisma.juryChangeGateReview.findMany({
        where: { reviewResultId: result.id, tenantId },
        select: {
          status: true,
          source: true,
          parentReviewResultId: true,
          changeGateResultId: true,
          agentExecutionId: true,
          improvementTaskId: true,
          evidenceId: true,
          reviewRequestId: true,
        },
      })
    : [];
  const linked = reviews.length === 1 ? reviews[0] : null;
  if (
    !result
    || !decision
    || decision === 'ACCEPT'
    || humanImprovementTaskType(decision) !== taskType
    || !result.parentReviewResultId
    || result.request?.tenantId !== tenantId
    || result.request.id !== result.reviewRequestId
    || result.parentReviewResultId !== marked.originalReviewResultId
    || !linked
    || linked.status !== 'EXECUTED'
    || linked.source !== 'CHANGE_GATE'
    || linked.reviewRequestId !== result.reviewRequestId
    || linked.reviewRequestId !== marked.reReviewReviewRequestId
    || linked.parentReviewResultId !== result.parentReviewResultId
    || linked.changeGateResultId !== marked.changeGateResultId
    || linked.agentExecutionId !== marked.agentExecutionId
    || linked.improvementTaskId !== marked.sourceImprovementTaskId
    || linked.improvementTaskId === task.id
    || linked.agentExecutionId === current.id
    || result.request.evidenceId !== linked.evidenceId
    || (task.evidenceId !== null && task.evidenceId !== linked.evidenceId)
  ) {
    return { ok: false, reason: 'NOT_REREVIEW_IMPROVEMENT_TASK' };
  }
  const source = await prisma.juryImprovementTask.findFirst({
    where: { id: marked.sourceImprovementTaskId, tenantId },
    select: { id: true, reviewResultId: true, provenance: true },
  });
  const sourceMarked = source ? reReviewTask(source.provenance, source.id, source.reviewResultId) : null;
  if (!source || !sourceMarked || source.id === task.id || source.reviewResultId !== result.parentReviewResultId) {
    return { ok: false, reason: 'NOT_REREVIEW_IMPROVEMENT_TASK' };
  }
  const previous = await prisma.juryImprovementTask.findFirst({
    where: { id: sourceMarked.sourceImprovementTaskId, tenantId },
    select: { id: true, reviewResultId: true, provenance: true },
  });
  const previousMarked = previous ? reReviewTask(previous.provenance, previous.id, previous.reviewResultId) : null;
  if (
    !previous
    || !previousMarked
    || previous.id === source.id
    || previous.id === task.id
    || previous.reviewResultId === result.id
  ) {
    return { ok: false, reason: 'NOT_REREVIEW_IMPROVEMENT_TASK' };
  }
  const origin = await prisma.juryImprovementTask.findFirst({
    where: { id: previousMarked.sourceImprovementTaskId, tenantId },
    select: { id: true, provenance: true },
  });
  if (
    !origin
    || origin.id === previous.id
    || origin.id === source.id
    || origin.id === task.id
    || textField(origin.provenance, 'kind') !== HUMAN_IMPROVEMENT_KIND
  ) {
    return { ok: false, reason: 'NOT_REREVIEW_IMPROVEMENT_TASK' };
  }
  const parent = await prisma.juryReviewResult.findFirst({
    where: { id: result.parentReviewResultId, tenantId },
    select: { id: true, parentReviewResultId: true, reviewRequestId: true },
  });
  const first = parent?.parentReviewResultId
    ? await prisma.juryReviewResult.findFirst({
        where: { id: parent.parentReviewResultId, tenantId },
        select: { id: true, parentReviewResultId: true },
      })
    : null;
  if (
    !parent?.parentReviewResultId
    || parent.parentReviewResultId !== previous.reviewResultId
    || parent.reviewRequestId !== marked.originalReviewRequestId
    || !first
    || first.parentReviewResultId !== previousMarked.originalReviewResultId
    || first.id === result.id
  ) {
    return { ok: false, reason: 'NOT_REREVIEW_IMPROVEMENT_TASK' };
  }
  const sourceExecution = await prisma.juryAgentExecution.findFirst({
    where: { id: linked.agentExecutionId, tenantId },
    select: { id: true, status: true, taskId: true },
  });
  const gate = await prisma.juryChangeGateResult.findFirst({
    where: { id: linked.changeGateResultId, tenantId },
    select: { id: true, status: true, executionId: true, improvementTaskId: true },
  });
  if (
    !sourceExecution
    || sourceExecution.status !== 'COMPLETED'
    || sourceExecution.taskId !== source.id
    || sourceExecution.id === current.id
    || sourceExecution.id === sourceMarked.agentExecutionId
    || sourceExecution.id === previousMarked.agentExecutionId
    || !gate
    || gate.status !== 'APPROVED'
    || gate.executionId !== sourceExecution.id
    || gate.improvementTaskId !== source.id
    || gate.id === sourceMarked.changeGateResultId
    || gate.id === previousMarked.changeGateResultId
  ) {
    return { ok: false, reason: 'NOT_REREVIEW_IMPROVEMENT_TASK' };
  }
  if (task.status !== 'OPEN') return { ok: false, reason: 'NOT_REREVIEW_IMPROVEMENT_TASK' };
  const approval = await prisma.juryHumanDecision.findFirst({
    where: { tenantId, reviewResultId: result.id },
    select: { id: true, decision: true, reviewRequestId: true, reviewResultId: true },
  });
  const previousApproval = await prisma.juryHumanDecision.findFirst({
    where: { tenantId, reviewResultId: parent.id },
    select: { id: true },
  });
  const firstApproval = await prisma.juryHumanDecision.findFirst({
    where: { tenantId, reviewResultId: first.id },
    select: { id: true },
  });
  const rootApproval = await prisma.juryHumanDecision.findFirst({
    where: { tenantId, reviewResultId: previousMarked.originalReviewResultId },
    select: { id: true },
  });
  const approvalDecision = approval ? oneOf(JURY_DECISIONS, approval.decision) : null;
  const stamped = textField(current.provenance, 'humanDecisionId');
  const stampedTask = textField(current.provenance, 'improvementTaskId');
  if (
    !approval
    || !approvalDecision
    || !previousApproval
    || !firstApproval
    || !rootApproval
    || approval.reviewResultId !== result.id
    || approval.reviewRequestId !== result.reviewRequestId
    || approvalDecision === 'ACCEPT'
    || humanImprovementTaskType(approvalDecision) !== taskType
    || approval.id === marked.humanDecisionId
    || approval.id === previousApproval.id
    || approval.id === firstApproval.id
    || approval.id === rootApproval.id
    || stamped !== approval.id
  ) {
    return { ok: false, reason: 'HUMAN_APPROVAL_REQUIRED' };
  }
  if (stampedTask !== task.id) return { ok: false, reason: 'NOT_REREVIEW_IMPROVEMENT_TASK' };
  if (current.status !== 'COMPLETED') return { ok: true, rootId: previousMarked.originalReviewResultId, status: current.status };
  if (
    textField(current.provenance, 'kind') !== 'human-agent-execution'
    || textField(current.provenance, 'reviewResultId') !== result.id
    || !hasExecutionResult(current.provenance)
  ) {
    return { ok: false, reason: 'NOT_FOUND' };
  }
  return { ok: true, rootId: previousMarked.originalReviewResultId, status: current.status };
}

function hasExecutionResult(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const result = (value as { result?: unknown }).result;
  return Boolean(result && typeof result === 'object' && !Array.isArray(result));
}

function reReviewTask(value: unknown, taskId: string, reviewResultId: string): {
  reReviewReviewRequestId: string;
  originalReviewRequestId: string;
  originalReviewResultId: string;
  humanDecisionId: string;
  sourceImprovementTaskId: string;
  agentExecutionId: string;
  changeGateResultId: string;
} | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (row.kind !== REREVIEW_IMPROVEMENT_KIND || row.reReviewReviewResultId !== reviewResultId || row.improvementTaskId !== taskId) {
    return null;
  }
  const reReviewReviewRequestId = textField(row, 'reReviewReviewRequestId');
  const originalReviewRequestId = textField(row, 'originalReviewRequestId');
  const originalReviewResultId = textField(row, 'originalReviewResultId');
  const humanDecisionId = textField(row, 'humanDecisionId');
  const sourceImprovementTaskId = textField(row, 'sourceImprovementTaskId');
  const agentExecutionId = textField(row, 'agentExecutionId');
  const changeGateResultId = textField(row, 'changeGateResultId');
  if (
    !reReviewReviewRequestId
    || !originalReviewRequestId
    || !originalReviewResultId
    || !humanDecisionId
    || !sourceImprovementTaskId
    || !agentExecutionId
    || !changeGateResultId
  ) {
    return null;
  }
  return {
    reReviewReviewRequestId,
    originalReviewRequestId,
    originalReviewResultId,
    humanDecisionId,
    sourceImprovementTaskId,
    agentExecutionId,
    changeGateResultId,
  };
}

function textField(value: unknown, key: string): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = (value as Record<string, unknown>)[key];
  return typeof row === 'string' && row.length > 0 ? row : null;
}

function oneOf<T extends string>(values: readonly T[], value: string): T | null {
  return (values as readonly string[]).includes(value) ? (value as T) : null;
}
