/**
 * Creates the next ImprovementTask from a stored second-iteration re-review.
 * ACCEPT stops. VERIFY and REWORD stop after the task.
 * Human approval, agent handoff, and later gates are not started.
 */
import { Prisma } from '@prisma/client';
import { decideJuryMutation, resolveJuryActor } from './access';
import { humanImprovementTaskType } from './human-improvement-bridge';
import type { JuryMembership } from './records';
import { JURY_DECISIONS } from './records';
import {
  REREVIEW_IMPROVEMENT_KIND,
  recordReReviewImprovement,
  reloadReReviewImprovement,
  type ReReviewImprovementFailure,
} from './rereview-improvement-bridge';

export async function persistSecondReReviewImprovement(input: {
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
  try {
    const { prisma } = await import('@/lib/prisma');
    const prepared = await prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>(
        Prisma.sql`SELECT id FROM "JuryReviewResult" WHERE id = ${input.reReviewResultId} AND "tenantId" = ${actor.tenantId} FOR UPDATE`,
      );
      if (!locked[0]) return { ok: false as const, reason: 'NOT_FOUND' as const };
      const result = await tx.juryReviewResult.findFirst({
        where: { id: input.reReviewResultId, tenantId: actor.tenantId },
        select: {
          id: true,
          reviewRequestId: true,
          parentReviewResultId: true,
          expectedDecision: true,
          finalSurface: true,
          request: { select: { id: true, tenantId: true, evidenceId: true } },
        },
      });
      const decision = result ? oneOf(JURY_DECISIONS, result.expectedDecision) : null;
      const reviews = result
        ? await tx.juryChangeGateReview.findMany({
            where: { reviewResultId: result.id, tenantId: actor.tenantId },
            select: {
              parentReviewResultId: true,
              changeGateResultId: true,
              agentExecutionId: true,
              improvementTaskId: true,
              evidenceId: true,
              reviewRequestId: true,
              status: true,
              source: true,
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
        || !linked
        || linked.status !== 'EXECUTED'
        || linked.source !== 'CHANGE_GATE'
        || linked.reviewRequestId !== result.reviewRequestId
        || linked.parentReviewResultId !== result.parentReviewResultId
      ) {
        return { ok: false as const, reason: 'NOT_REREVIEW_RESULT' as const };
      }
      const previous = await tx.juryReviewResult.findFirst({
        where: { id: result.parentReviewResultId, tenantId: actor.tenantId },
        select: {
          id: true,
          reviewRequestId: true,
          parentReviewResultId: true,
          request: { select: { id: true, tenantId: true } },
          humanDecision: { select: { id: true, tenantId: true, reviewResultId: true, reviewRequestId: true, decision: true } },
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
      const sourceTask = await tx.juryImprovementTask.findFirst({
        where: { id: linked.improvementTaskId, tenantId: actor.tenantId },
        select: { id: true, reviewResultId: true, taskType: true, provenance: true },
      });
      const marked = sourceTask ? reReviewTask(sourceTask.provenance, sourceTask.id, sourceTask.reviewResultId) : null;
      const evidence = await tx.juryEvidence.findFirst({
        where: { id: linked.evidenceId, tenantId: actor.tenantId },
        select: { id: true },
      });
      const approval = previous?.humanDecision?.tenantId === actor.tenantId ? previous.humanDecision : null;
      const approvalDecision = approval ? oneOf(JURY_DECISIONS, approval.decision) : null;
      if (
        !previous
        || !previous.parentReviewResultId
        || previous.request?.tenantId !== actor.tenantId
        || previous.request.id !== previous.reviewRequestId
        || !marked
        || marked.reReviewReviewResultId !== previous.id
        || sourceTask?.reviewResultId !== previous.id
        || !gate
        || gate.status !== 'APPROVED'
        || gate.executionId !== execution?.id
        || gate.improvementTaskId !== sourceTask?.id
        || gate.id === marked.changeGateResultId
        || !execution
        || execution.status !== 'COMPLETED'
        || execution.taskId !== sourceTask?.id
        || execution.id === marked.agentExecutionId
        || textField(execution.provenance, 'kind') !== 'human-agent-execution'
        || textField(execution.provenance, 'improvementTaskId') !== sourceTask?.id
        || textField(execution.provenance, 'reviewResultId') !== previous.id
        || textField(execution.provenance, 'humanDecisionId') !== approval?.id
        || !approval
        || !approvalDecision
        || approval.reviewResultId !== previous.id
        || approval.reviewRequestId !== previous.reviewRequestId
        || approval.id === marked.humanDecisionId
        || approvalDecision === 'ACCEPT'
        || !sourceTask
        || humanImprovementTaskType(approvalDecision) !== sourceTask.taskType
        || !evidence
        || result.request.evidenceId !== evidence.id
      ) {
        return { ok: false as const, reason: 'NOT_REREVIEW_RESULT' as const };
      }
      const earlier = await tx.juryChangeGateReview.findMany({
        where: { reviewResultId: previous.id, tenantId: actor.tenantId },
        select: {
          status: true,
          source: true,
          parentReviewResultId: true,
          changeGateResultId: true,
          agentExecutionId: true,
          improvementTaskId: true,
        },
      });
      const firstReview = earlier.length === 1 ? earlier[0] : null;
      const root = await tx.juryReviewResult.findFirst({
        where: { id: previous.parentReviewResultId, tenantId: actor.tenantId },
        select: {
          id: true,
          reviewRequestId: true,
          humanDecision: { select: { id: true, tenantId: true, reviewResultId: true } },
        },
      });
      const sourceGate = await tx.juryChangeGateResult.findFirst({
        where: { id: marked.changeGateResultId, tenantId: actor.tenantId },
        select: { id: true, executionId: true, status: true, improvementTaskId: true },
      });
      const sourceExecution = await tx.juryAgentExecution.findFirst({
        where: { id: marked.agentExecutionId, tenantId: actor.tenantId },
        select: { id: true, taskId: true, status: true },
      });
      const rootHuman = root?.humanDecision?.tenantId === actor.tenantId ? root.humanDecision : null;
      if (
        !firstReview
        || firstReview.status !== 'EXECUTED'
        || firstReview.source !== 'CHANGE_GATE'
        || firstReview.parentReviewResultId !== root?.id
        || firstReview.changeGateResultId !== marked.changeGateResultId
        || firstReview.agentExecutionId !== marked.agentExecutionId
        || firstReview.improvementTaskId !== marked.sourceImprovementTaskId
        || !root
        || root.reviewRequestId !== marked.originalReviewRequestId
        || root.id !== marked.originalReviewResultId
        || !rootHuman
        || rootHuman.id !== marked.humanDecisionId
        || rootHuman.reviewResultId !== root.id
        || !sourceGate
        || sourceGate.status !== 'APPROVED'
        || sourceGate.executionId !== sourceExecution?.id
        || sourceGate.improvementTaskId !== marked.sourceImprovementTaskId
        || !sourceExecution
        || sourceExecution.status !== 'COMPLETED'
        || sourceExecution.id === execution.id
      ) {
        return { ok: false as const, reason: 'NOT_REREVIEW_RESULT' as const };
      }
      const allowed = decideJuryMutation({
        actor,
        action: 'improvement.write',
        resourceTenantId: actor.tenantId,
      });
      if (!allowed.ok) return { ok: false as const, reason: 'FORBIDDEN' as const };
      const recorded = await recordReReviewImprovement(tx, {
        tenantId: actor.tenantId,
        userId: actor.userId,
        resultId: result.id,
        reviewRequestId: result.reviewRequestId,
        decision,
        finalSurface: result.finalSurface,
        originalReviewResultId: previous.id,
        originalReviewRequestId: previous.reviewRequestId,
        humanDecisionId: approval.id,
        sourceTaskId: sourceTask.id,
        executionId: execution.id,
        gateId: gate.id,
        evidenceId: evidence.id,
      });
      if (!recorded.ok) return recorded;
      return { ...recorded, reviewId: root.id };
    });
    return prepared;
  } catch (error) {
    if (!isUnique(error)) return { ok: false, reason: 'PERSISTENCE_FAILED' };
    const stored = await reloadReReviewImprovement(actor.tenantId, input.reReviewResultId);
    if (!stored.ok) return stored;
    const { prisma } = await import('@/lib/prisma');
    const current = await prisma.juryReviewResult.findFirst({
      where: { id: input.reReviewResultId, tenantId: actor.tenantId },
      select: { parentReviewResultId: true },
    });
    const parent = current?.parentReviewResultId
      ? await prisma.juryReviewResult.findFirst({
          where: { id: current.parentReviewResultId, tenantId: actor.tenantId },
          select: { parentReviewResultId: true },
        })
      : null;
    return { ...stored, reviewId: parent?.parentReviewResultId ?? stored.reviewId };
  }
}

function reReviewTask(value: unknown, taskId: string, reviewResultId: string): {
  reReviewReviewResultId: string;
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
  const originalReviewRequestId = textField(row, 'originalReviewRequestId');
  const originalReviewResultId = textField(row, 'originalReviewResultId');
  const humanDecisionId = textField(row, 'humanDecisionId');
  const sourceImprovementTaskId = textField(row, 'sourceImprovementTaskId');
  const agentExecutionId = textField(row, 'agentExecutionId');
  const changeGateResultId = textField(row, 'changeGateResultId');
  if (
    !originalReviewRequestId
    || !originalReviewResultId
    || !humanDecisionId
    || !sourceImprovementTaskId
    || !agentExecutionId
    || !changeGateResultId
  ) {
    return null;
  }
  return {
    reReviewReviewResultId: reviewResultId,
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

function isUnique(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: string }).code === 'P2002';
}
