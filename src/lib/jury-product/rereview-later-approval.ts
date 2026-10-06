/**
 * Records one human approval for a later re-review improvement task.
 * The stored re-review decision is not approval. Agent handoff is not started.
 */
import { resolveJuryActor } from './access';
import { HUMAN_IMPROVEMENT_KIND, humanImprovementTaskType } from './human-improvement-bridge';
import type { JuryDecision, JuryMembership } from './records';
import { JURY_DECISIONS } from './records';
import { noteHumanNextAction } from './review-console';
import { REREVIEW_IMPROVEMENT_KIND } from './rereview-improvement-bridge';
import type { ReReviewHandoffFailure } from './rereview-agent-handoff';

export async function approveLaterImprovement(input: {
  userId: string | null;
  memberships: readonly JuryMembership[];
  improvementTaskId: string;
}): Promise<
  | { ok: true; created: boolean; reviewId: string; reReviewResultId: string; decision: JuryDecision }
  | { ok: false; reason: ReReviewHandoffFailure }
> {
  const actor = resolveJuryActor({ userId: input.userId, memberships: input.memberships, clientTenantId: null });
  if (!actor.ok) return { ok: false, reason: actor.reason };
  if (!input.improvementTaskId.trim()) return { ok: false, reason: 'NOT_FOUND' };
  const ready = await loadLaterApproval(actor.tenantId, input.improvementTaskId);
  if (!ready.ok) return ready;
  const noted = await noteHumanNextAction({
    userId: input.userId,
    memberships: input.memberships,
    reviewId: ready.reReviewResultId,
    action: ready.decision,
  });
  if (!noted.ok) {
    if (noted.reason === 'FORBIDDEN' || noted.reason === 'NOT_FOUND' || noted.reason === 'DECISION_LOCKED') {
      return { ok: false, reason: noted.reason === 'DECISION_LOCKED' ? 'HUMAN_APPROVAL_REQUIRED' : noted.reason };
    }
    return { ok: false, reason: 'PERSISTENCE_FAILED' };
  }
  return {
    ok: true,
    created: noted.created,
    reviewId: ready.rootId,
    reReviewResultId: ready.reReviewResultId,
    decision: noted.humanDecision,
  };
}

async function loadLaterApproval(
  tenantId: string,
  improvementTaskId: string,
): Promise<
  | { ok: true; rootId: string; reReviewResultId: string; decision: JuryDecision }
  | { ok: false; reason: ReReviewHandoffFailure }
> {
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
  return { ok: true, rootId: previousMarked.originalReviewResultId, reReviewResultId: result.id, decision };
}

function reReviewTask(value: unknown, taskId: string, reviewResultId: string): {
  reReviewReviewRequestId: string;
  originalReviewResultId: string;
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
  const sourceImprovementTaskId = textField(row, 'sourceImprovementTaskId');
  const agentExecutionId = textField(row, 'agentExecutionId');
  const changeGateResultId = textField(row, 'changeGateResultId');
  if (!reReviewReviewRequestId || !originalReviewResultId || !sourceImprovementTaskId || !agentExecutionId || !changeGateResultId) {
    return null;
  }
  return { reReviewReviewRequestId, originalReviewResultId, sourceImprovementTaskId, agentExecutionId, changeGateResultId };
}

function textField(value: unknown, key: string): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = (value as Record<string, unknown>)[key];
  return typeof row === 'string' && row.length > 0 ? row : null;
}

function oneOf<T extends string>(values: readonly T[], value: string): T | null {
  return (values as readonly string[]).includes(value) ? (value as T) : null;
}
