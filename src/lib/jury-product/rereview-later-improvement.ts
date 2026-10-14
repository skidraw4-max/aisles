/**
 * Creates the next ImprovementTask from a stored later re-review.
 * ACCEPT stops. VERIFY and REWORD stop after the task.
 * Approval, handoff, execution, and later gates are not started.
 */
import { resolveJuryActor } from './access';
import { HUMAN_IMPROVEMENT_KIND } from './human-improvement-bridge';
import type { JuryMembership } from './records';
import {
  REREVIEW_IMPROVEMENT_KIND,
  type ReReviewImprovementFailure,
} from './rereview-improvement-bridge';
import { persistSecondReReviewImprovement } from './rereview-second-improvement';

export async function persistLaterReReviewImprovement(input: {
  userId: string | null;
  memberships: readonly JuryMembership[];
  reReviewResultId: string;
}): Promise<
  | {
      ok: true;
      created: boolean;
      outcome: 'NO_IMPROVEMENT' | 'IMPROVEMENT';
      reviewId: string;
      reReviewResultId: string;
      taskId: string | null;
      taskType: 'VERIFICATION' | 'REWORD' | null;
    }
  | { ok: false; reason: ReReviewImprovementFailure }
> {
  const actor = resolveJuryActor({ userId: input.userId, memberships: input.memberships, clientTenantId: null });
  if (!actor.ok) return { ok: false, reason: actor.reason };
  if (!input.reReviewResultId.trim()) return { ok: false, reason: 'NOT_FOUND' };
  const ready = await loadLaterImprovement(actor.tenantId, input.reReviewResultId);
  if (!ready.ok) return ready;
  const recorded = await persistSecondReReviewImprovement({
    userId: input.userId,
    memberships: input.memberships,
    reReviewResultId: input.reReviewResultId,
  });
  if (!recorded.ok) return recorded;
  return { ...recorded, reviewId: ready.rootId };
}

async function loadLaterImprovement(
  tenantId: string,
  reReviewResultId: string,
): Promise<{ ok: true; rootId: string } | { ok: false; reason: ReReviewImprovementFailure }> {
  const { prisma } = await import('@/lib/prisma');
  const result = await prisma.juryReviewResult.findFirst({
    where: { id: reReviewResultId, tenantId },
    select: { id: true, parentReviewResultId: true },
  });
  if (!result) return { ok: false, reason: 'NOT_FOUND' };
  if (!result.parentReviewResultId) return { ok: false, reason: 'NOT_REREVIEW_RESULT' };
  const reviews = await prisma.juryChangeGateReview.findMany({
    where: { reviewResultId: result.id, tenantId },
    select: {
      status: true,
      source: true,
      parentReviewResultId: true,
      changeGateResultId: true,
      agentExecutionId: true,
      improvementTaskId: true,
    },
  });
  const linked = reviews.length === 1 ? reviews[0] : null;
  if (
    !linked
    || linked.status !== 'EXECUTED'
    || linked.source !== 'CHANGE_GATE'
    || linked.parentReviewResultId !== result.parentReviewResultId
  ) {
    return { ok: false, reason: 'NOT_REREVIEW_RESULT' };
  }
  const task = await prisma.juryImprovementTask.findFirst({
    where: { id: linked.improvementTaskId, tenantId },
    select: { id: true, reviewResultId: true, provenance: true },
  });
  const marked = task ? reReviewTask(task.provenance, task.id, task.reviewResultId) : null;
  if (!task || !marked || task.reviewResultId !== result.parentReviewResultId || task.id === marked.sourceImprovementTaskId) {
    return { ok: false, reason: 'NOT_REREVIEW_RESULT' };
  }
  const source = await prisma.juryImprovementTask.findFirst({
    where: { id: marked.sourceImprovementTaskId, tenantId },
    select: { id: true, reviewResultId: true, provenance: true },
  });
  const sourceMarked = source ? reReviewTask(source.provenance, source.id, source.reviewResultId) : null;
  if (!source || !sourceMarked || source.id === task.id || source.reviewResultId === result.id) {
    return { ok: false, reason: 'NOT_REREVIEW_RESULT' };
  }
  const origin = await prisma.juryImprovementTask.findFirst({
    where: { id: sourceMarked.sourceImprovementTaskId, tenantId },
    select: { id: true, provenance: true },
  });
  if (
    !origin
    || origin.id === source.id
    || origin.id === task.id
    || textField(origin.provenance, 'kind') !== HUMAN_IMPROVEMENT_KIND
  ) {
    return { ok: false, reason: 'NOT_REREVIEW_RESULT' };
  }
  const previous = await prisma.juryReviewResult.findFirst({
    where: { id: result.parentReviewResultId, tenantId },
    select: { id: true, parentReviewResultId: true },
  });
  const first = source.reviewResultId
    ? await prisma.juryReviewResult.findFirst({
        where: { id: source.reviewResultId, tenantId },
        select: { id: true, parentReviewResultId: true },
      })
    : null;
  if (
    !previous?.parentReviewResultId
    || previous.parentReviewResultId !== source.reviewResultId
    || !first
    || first.parentReviewResultId !== sourceMarked.originalReviewResultId
    || first.id === result.id
  ) {
    return { ok: false, reason: 'NOT_REREVIEW_RESULT' };
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
    || execution.taskId !== task.id
    || execution.id === marked.agentExecutionId
    || execution.id === sourceMarked.agentExecutionId
    || !gate
    || gate.status !== 'APPROVED'
    || gate.executionId !== execution.id
    || gate.improvementTaskId !== task.id
    || gate.id === marked.changeGateResultId
    || gate.id === sourceMarked.changeGateResultId
  ) {
    return { ok: false, reason: 'NOT_REREVIEW_RESULT' };
  }
  return { ok: true, rootId: sourceMarked.originalReviewResultId };
}

function reReviewTask(value: unknown, taskId: string, reviewResultId: string): {
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
  const sourceImprovementTaskId = textField(row, 'sourceImprovementTaskId');
  const agentExecutionId = textField(row, 'agentExecutionId');
  const changeGateResultId = textField(row, 'changeGateResultId');
  const originalReviewResultId = textField(row, 'originalReviewResultId');
  if (!sourceImprovementTaskId || !agentExecutionId || !changeGateResultId || !originalReviewResultId) return null;
  return { sourceImprovementTaskId, agentExecutionId, changeGateResultId, originalReviewResultId };
}

function textField(value: unknown, key: string): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = (value as Record<string, unknown>)[key];
  return typeof row === 'string' && row.length > 0 ? row : null;
}
