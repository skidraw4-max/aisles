/**
 * Hands a later re-review improvement task to one PENDING execution.
 * The stored re-review decision is not approval. This does not run the execution.
 */
import { resolveJuryActor } from './access';
import { HUMAN_IMPROVEMENT_KIND, humanImprovementTaskType } from './human-improvement-bridge';
import type { JuryDecision, JuryMembership } from './records';
import { JURY_DECISIONS } from './records';
import { persistReReviewAgentHandoff, type ReReviewHandoffFailure } from './rereview-agent-handoff';
import { REREVIEW_IMPROVEMENT_KIND } from './rereview-improvement-bridge';

export async function handoffLaterImprovement(input: {
  userId: string | null;
  memberships: readonly JuryMembership[];
  improvementTaskId: string;
}): Promise<
  | {
      ok: true;
      created: boolean;
      reviewId: string;
      improvementTaskId: string;
      agentExecutionId: string;
      status: 'PENDING';
      agent: 'CURSOR';
    }
  | { ok: false; reason: ReReviewHandoffFailure }
> {
  const actor = resolveJuryActor({ userId: input.userId, memberships: input.memberships, clientTenantId: null });
  if (!actor.ok) return { ok: false, reason: actor.reason };
  if (!input.improvementTaskId.trim()) return { ok: false, reason: 'NOT_FOUND' };
  const ready = await loadLaterHandoff(actor.tenantId, input.improvementTaskId);
  if (!ready.ok) return ready;
  const handed = await persistReReviewAgentHandoff({
    userId: input.userId,
    memberships: input.memberships,
    improvementTaskId: input.improvementTaskId,
  });
  if (!handed.ok) return handed;
  return { ...handed, reviewId: ready.rootId };
}

async function loadLaterHandoff(
  tenantId: string,
  improvementTaskId: string,
): Promise<{ ok: true; rootId: string } | { ok: false; reason: ReReviewHandoffFailure }> {
  const { prisma } = await import('@/lib/prisma');
  const task = await prisma.juryImprovementTask.findFirst({
    where: { id: improvementTaskId, tenantId },
    select: {
      id: true,
      reviewResultId: true,
      parentTaskId: true,
      status: true,
      taskType: true,
      provenance: true,
    },
  });
  if (!task) return { ok: false, reason: 'NOT_FOUND' };
  const marked = reReviewTask(task.provenance, task.id, task.reviewResultId);
  const taskType = task.taskType === 'VERIFICATION' || task.taskType === 'REWORD' ? task.taskType : null;
  if (!marked || !taskType || task.parentTaskId !== marked.sourceImprovementTaskId) {
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
          id: true,
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
    || result.request.evidenceId !== linked.evidenceId
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
    select: { id: true, reviewResultId: true, provenance: true },
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
    select: { id: true, parentReviewResultId: true },
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
    || !first
    || first.parentReviewResultId !== previousMarked.originalReviewResultId
    || first.id === result.id
  ) {
    return { ok: false, reason: 'NOT_REREVIEW_IMPROVEMENT_TASK' };
  }
  const execution = await prisma.juryAgentExecution.findFirst({
    where: { id: linked.agentExecutionId, tenantId },
    select: { id: true, status: true, taskId: true },
  });
  const gate = await prisma.juryChangeGateResult.findFirst({
    where: { id: linked.changeGateResultId, tenantId },
    select: { id: true, status: true, executionId: true, improvementTaskId: true },
  });
  if (
    !execution
    || execution.status !== 'COMPLETED'
    || execution.taskId !== source.id
    || execution.id === sourceMarked.agentExecutionId
    || execution.id === previousMarked.agentExecutionId
    || !gate
    || gate.status !== 'APPROVED'
    || gate.executionId !== execution.id
    || gate.improvementTaskId !== source.id
    || gate.id === sourceMarked.changeGateResultId
    || gate.id === previousMarked.changeGateResultId
  ) {
    return { ok: false, reason: 'NOT_REREVIEW_IMPROVEMENT_TASK' };
  }
  if (task.status !== 'OPEN') return { ok: false, reason: 'IMPROVEMENT_TASK_NOT_OPEN' };
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
  ) {
    return { ok: false, reason: 'HUMAN_APPROVAL_REQUIRED' };
  }
  return { ok: true, rootId: previousMarked.originalReviewResultId };
}

function reReviewTask(value: unknown, taskId: string, reviewResultId: string): {
  reReviewReviewRequestId: string;
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
  const originalReviewResultId = textField(row, 'originalReviewResultId');
  const humanDecisionId = textField(row, 'humanDecisionId');
  const sourceImprovementTaskId = textField(row, 'sourceImprovementTaskId');
  const agentExecutionId = textField(row, 'agentExecutionId');
  const changeGateResultId = textField(row, 'changeGateResultId');
  if (
    !reReviewReviewRequestId
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
