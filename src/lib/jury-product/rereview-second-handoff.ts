/**
 * Hands a Phase 60 approved second-iteration improvement task to one PENDING execution.
 * The stored re-review decision is not approval. This does not run the execution.
 */
import { resolveJuryActor } from './access';
import { HUMAN_IMPROVEMENT_KIND, humanImprovementTaskType } from './human-improvement-bridge';
import type { JuryDecision, JuryMembership } from './records';
import { JURY_DECISIONS } from './records';
import { persistReReviewAgentHandoff, type ReReviewHandoffFailure } from './rereview-agent-handoff';
import { REREVIEW_IMPROVEMENT_KIND } from './rereview-improvement-bridge';

export async function handoffSecondImprovement(input: {
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
  const ready = await loadSecondHandoff(actor.tenantId, input.improvementTaskId);
  if (!ready.ok) return ready;
  const handed = await persistReReviewAgentHandoff({
    userId: input.userId,
    memberships: input.memberships,
    improvementTaskId: input.improvementTaskId,
  });
  if (!handed.ok) return handed;
  return { ...handed, reviewId: ready.reviewId };
}

async function loadSecondHandoff(
  tenantId: string,
  improvementTaskId: string,
): Promise<{ ok: true; reviewId: string } | { ok: false; reason: ReReviewHandoffFailure }> {
  const { prisma } = await import('@/lib/prisma');
  const task = await prisma.juryImprovementTask.findFirst({
    where: { id: improvementTaskId, tenantId },
    select: { id: true, reviewResultId: true, parentTaskId: true, status: true, taskType: true, provenance: true },
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
      humanDecision: { select: { id: true, decision: true, reviewRequestId: true, tenantId: true } },
    },
  });
  const source = await prisma.juryImprovementTask.findFirst({
    where: { id: marked.sourceImprovementTaskId, tenantId },
    select: { id: true, reviewResultId: true, provenance: true },
  });
  const sourceMarked = source ? reReviewTask(source.provenance, source.id, source.reviewResultId) : null;
  if (
    !result?.parentReviewResultId
    || !source
    || !sourceMarked
    || source.id === task.id
    || source.reviewResultId !== result.parentReviewResultId
    || sourceMarked.agentExecutionId === marked.agentExecutionId
    || sourceMarked.changeGateResultId === marked.changeGateResultId
  ) {
    return { ok: false, reason: 'NOT_REREVIEW_IMPROVEMENT_TASK' };
  }
  const previous = await prisma.juryReviewResult.findFirst({
    where: { id: result.parentReviewResultId, tenantId },
    select: {
      id: true,
      parentReviewResultId: true,
      humanDecision: { select: { id: true, tenantId: true } },
    },
  });
  const root = previous?.parentReviewResultId
    ? await prisma.juryReviewResult.findFirst({
        where: { id: previous.parentReviewResultId, tenantId },
        select: { id: true, humanDecision: { select: { id: true, tenantId: true } } },
      })
    : null;
  const origin = await prisma.juryImprovementTask.findFirst({
    where: { id: sourceMarked.sourceImprovementTaskId, tenantId },
    select: { id: true, reviewResultId: true, provenance: true },
  });
  const phase55Id = previous?.humanDecision?.tenantId === tenantId ? previous.humanDecision.id : null;
  const rootHumanId = root?.humanDecision?.tenantId === tenantId ? root.humanDecision.id : null;
  const originKind = textField(origin?.provenance, 'kind');
  if (
    !previous
    || !root
    || root.id !== sourceMarked.originalReviewResultId
    || phase55Id !== marked.humanDecisionId
    || !rootHumanId
    || rootHumanId === phase55Id
    || rootHumanId !== sourceMarked.humanDecisionId
    || !origin
    || origin.id === source.id
    || origin.id === task.id
    || origin.reviewResultId !== root.id
    || originKind !== HUMAN_IMPROVEMENT_KIND
  ) {
    return { ok: false, reason: 'NOT_REREVIEW_IMPROVEMENT_TASK' };
  }
  if (task.status !== 'OPEN') return { ok: false, reason: 'IMPROVEMENT_TASK_NOT_OPEN' };
  const approval = result.humanDecision?.tenantId === tenantId ? result.humanDecision : null;
  const decision = approval ? oneOf(JURY_DECISIONS, approval.decision) : null;
  if (
    !approval
    || !decision
    || approval.reviewRequestId !== result.reviewRequestId
    || approval.id === phase55Id
    || approval.id === rootHumanId
    || decision === 'ACCEPT'
    || humanImprovementTaskType(decision) !== taskType
  ) {
    return { ok: false, reason: 'HUMAN_APPROVAL_REQUIRED' };
  }
  return { ok: true, reviewId: root.id };
}

function reReviewTask(value: unknown, taskId: string, reviewResultId: string): {
  humanDecisionId: string;
  sourceImprovementTaskId: string;
  agentExecutionId: string;
  changeGateResultId: string;
  originalReviewResultId: string;
} | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (row.kind !== REREVIEW_IMPROVEMENT_KIND || row.reReviewReviewResultId !== reviewResultId || row.improvementTaskId !== taskId) {
    return null;
  }
  const humanDecisionId = textField(row, 'humanDecisionId');
  const sourceImprovementTaskId = textField(row, 'sourceImprovementTaskId');
  const agentExecutionId = textField(row, 'agentExecutionId');
  const changeGateResultId = textField(row, 'changeGateResultId');
  const originalReviewResultId = textField(row, 'originalReviewResultId');
  if (!humanDecisionId || !sourceImprovementTaskId || !agentExecutionId || !changeGateResultId || !originalReviewResultId) {
    return null;
  }
  return { humanDecisionId, sourceImprovementTaskId, agentExecutionId, changeGateResultId, originalReviewResultId };
}

function textField(value: unknown, key: string): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = (value as Record<string, unknown>)[key];
  return typeof row === 'string' && row.length > 0 ? row : null;
}

function oneOf<T extends string>(values: readonly T[], value: string): T | null {
  return (values as readonly string[]).includes(value) ? (value as T) : null;
}
