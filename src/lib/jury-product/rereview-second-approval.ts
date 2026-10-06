/**
 * Records one human approval for a Phase 59 second-iteration improvement task.
 * The stored re-review decision is not approval. Agent handoff is not started.
 */
import { Prisma } from '@prisma/client';
import { resolveJuryActor } from './access';
import { HUMAN_IMPROVEMENT_KIND, humanImprovementTaskType } from './human-improvement-bridge';
import type { JuryDecision, JuryMembership } from './records';
import { JURY_DECISIONS } from './records';
import { noteHumanNextAction } from './review-console';
import { REREVIEW_IMPROVEMENT_KIND } from './rereview-improvement-bridge';
import type { ReReviewHandoffFailure } from './rereview-agent-handoff';

export async function approveSecondImprovement(input: {
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
  try {
    const { prisma } = await import('@/lib/prisma');
    const ready = await (async () => {
      const tx = prisma;
      const task = await tx.juryImprovementTask.findFirst({
        where: { id: input.improvementTaskId, tenantId: actor.tenantId },
        select: {
          id: true,
          reviewResultId: true,
          parentTaskId: true,
          status: true,
          taskType: true,
          provenance: true,
        },
      });
      if (!task) return { ok: false as const, reason: 'NOT_FOUND' as const };
      const marked = reReviewTask(task.provenance, task.id, task.reviewResultId);
      const taskType = task?.taskType === 'VERIFICATION' || task?.taskType === 'REWORD' ? task.taskType : null;
      if (!task || !marked || !taskType || task.parentTaskId !== marked.sourceImprovementTaskId) {
        return { ok: false as const, reason: 'NOT_REREVIEW_IMPROVEMENT_TASK' as const };
      }
      const result = await tx.juryReviewResult.findFirst({
        where: { id: task.reviewResultId, tenantId: actor.tenantId },
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
        ? await tx.juryChangeGateReview.findMany({
            where: { reviewResultId: result.id, tenantId: actor.tenantId },
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
        || !result.parentReviewResultId
        || result.request?.tenantId !== actor.tenantId
        || result.request.id !== result.reviewRequestId
        || decision === 'ACCEPT'
        || humanImprovementTaskType(decision) !== taskType
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
      ) {
        return { ok: false as const, reason: 'NOT_REREVIEW_IMPROVEMENT_TASK' as const };
      }
      const previous = await tx.juryReviewResult.findFirst({
        where: { id: result.parentReviewResultId, tenantId: actor.tenantId },
        select: {
          id: true,
          reviewRequestId: true,
          parentReviewResultId: true,
          humanDecision: { select: { id: true, tenantId: true, reviewResultId: true, reviewRequestId: true } },
        },
      });
      const gate = await tx.juryChangeGateResult.findFirst({
        where: { id: linked.changeGateResultId, tenantId: actor.tenantId },
        select: { id: true, executionId: true, improvementTaskId: true, status: true },
      });
      const execution = await tx.juryAgentExecution.findFirst({
        where: { id: linked.agentExecutionId, tenantId: actor.tenantId },
        select: { id: true, taskId: true, status: true, provenance: true },
      });
      const source = await tx.juryImprovementTask.findFirst({
        where: { id: linked.improvementTaskId, tenantId: actor.tenantId },
        select: { id: true, reviewResultId: true, provenance: true },
      });
      const sourceMarked = source ? reReviewTask(source.provenance, source.id, source.reviewResultId) : null;
      const approval = previous?.humanDecision?.tenantId === actor.tenantId ? previous.humanDecision : null;
      if (
        !previous
        || !previous.parentReviewResultId
        || previous.id !== marked.originalReviewResultId
        || previous.reviewRequestId !== marked.originalReviewRequestId
        || !approval
        || approval.id !== marked.humanDecisionId
        || approval.reviewResultId !== previous.id
        || approval.reviewRequestId !== previous.reviewRequestId
        || !gate
        || gate.status !== 'APPROVED'
        || gate.executionId !== execution?.id
        || gate.improvementTaskId !== source?.id
        || !execution
        || execution.status !== 'COMPLETED'
        || execution.taskId !== source?.id
        || execution.id === sourceMarked?.agentExecutionId
        || textField(execution.provenance, 'kind') !== 'human-agent-execution'
        || textField(execution.provenance, 'reviewResultId') !== previous.id
        || textField(execution.provenance, 'improvementTaskId') !== source?.id
        || textField(execution.provenance, 'humanDecisionId') !== approval.id
        || !source
        || source.id === task.id
        || source.reviewResultId !== previous.id
        || !sourceMarked
        || sourceMarked.changeGateResultId === gate.id
        || result.request.evidenceId !== linked.evidenceId
      ) {
        return { ok: false as const, reason: 'NOT_REREVIEW_IMPROVEMENT_TASK' as const };
      }
      const root = await tx.juryReviewResult.findFirst({
        where: { id: previous.parentReviewResultId, tenantId: actor.tenantId },
        select: {
          id: true,
          reviewRequestId: true,
          humanDecision: { select: { id: true, tenantId: true, reviewResultId: true } },
        },
      });
      const origin = await tx.juryImprovementTask.findFirst({
        where: { id: sourceMarked.sourceImprovementTaskId, tenantId: actor.tenantId },
        select: { id: true, reviewResultId: true, provenance: true },
      });
      const sourceGate = await tx.juryChangeGateResult.findFirst({
        where: { id: sourceMarked.changeGateResultId, tenantId: actor.tenantId },
        select: { id: true, executionId: true, status: true, improvementTaskId: true },
      });
      const sourceExecution = await tx.juryAgentExecution.findFirst({
        where: { id: sourceMarked.agentExecutionId, tenantId: actor.tenantId },
        select: { id: true, taskId: true, status: true },
      });
      const evidence = await tx.juryEvidence.findFirst({
        where: { id: linked.evidenceId, tenantId: actor.tenantId },
        select: { id: true },
      });
      const rootHuman = root?.humanDecision?.tenantId === actor.tenantId ? root.humanDecision : null;
      const originKind = textField(origin?.provenance, 'kind');
      if (
        !root
        || root.id !== sourceMarked.originalReviewResultId
        || root.reviewRequestId !== sourceMarked.originalReviewRequestId
        || !rootHuman
        || rootHuman.id !== sourceMarked.humanDecisionId
        || rootHuman.id === approval.id
        || rootHuman.reviewResultId !== root.id
        || !origin
        || origin.id === source.id
        || origin.id === task.id
        || origin.reviewResultId !== root.id
        || originKind !== HUMAN_IMPROVEMENT_KIND
        || !sourceGate
        || sourceGate.status !== 'APPROVED'
        || sourceGate.executionId !== sourceExecution?.id
        || sourceGate.improvementTaskId !== origin.id
        || !sourceExecution
        || sourceExecution.status !== 'COMPLETED'
        || sourceExecution.taskId !== origin.id
        || sourceExecution.id === execution.id
        || !evidence
        || evidence.id !== result.request.evidenceId
      ) {
        return { ok: false as const, reason: 'NOT_REREVIEW_IMPROVEMENT_TASK' as const };
      }
      if (task.status !== 'OPEN') return { ok: false as const, reason: 'IMPROVEMENT_TASK_NOT_OPEN' as const };
      return {
        ok: true as const,
        reviewId: root.id,
        reReviewResultId: result.id,
        decision,
        taskType,
      };
    })();
    if (!ready.ok) return ready;
    const confirmed = await prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>(
        Prisma.sql`SELECT id FROM "JuryImprovementTask" WHERE id = ${input.improvementTaskId} AND "tenantId" = ${actor.tenantId} FOR UPDATE`,
      );
      if (!locked[0]) return { ok: false as const, reason: 'NOT_FOUND' as const };
      const task = await tx.juryImprovementTask.findFirst({
        where: { id: input.improvementTaskId, tenantId: actor.tenantId },
        select: { status: true, taskType: true, reviewResultId: true, provenance: true },
      });
      const marked = task ? reReviewTask(task.provenance, input.improvementTaskId, task.reviewResultId) : null;
      const result = await tx.juryReviewResult.findFirst({
        where: { id: ready.reReviewResultId, tenantId: actor.tenantId },
        select: { expectedDecision: true },
      });
      if (!task || !marked || task.reviewResultId !== ready.reReviewResultId || task.taskType !== ready.taskType || result?.expectedDecision !== ready.decision) {
        return { ok: false as const, reason: 'NOT_REREVIEW_IMPROVEMENT_TASK' as const };
      }
      if (task.status !== 'OPEN') return { ok: false as const, reason: 'IMPROVEMENT_TASK_NOT_OPEN' as const };
      return { ok: true as const };
    });
    if (!confirmed.ok) return confirmed;
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
      reviewId: ready.reviewId,
      reReviewResultId: ready.reReviewResultId,
      decision: noted.humanDecision,
    };
  } catch {
    return { ok: false, reason: 'PERSISTENCE_FAILED' };
  }
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
