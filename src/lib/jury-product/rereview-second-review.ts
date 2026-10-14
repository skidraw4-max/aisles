/**
 * Runs one Phase 53 re-review after an APPROVED second-iteration change gate.
 * GATED and BLOCKED gates stop here. No improvement task is created.
 */
import { Prisma } from '@prisma/client';
import { decideJuryMutation, resolveJuryActor } from './access';
import {
  persistChangeGateReReviewExecution,
  persistChangeGateReReviewRequest,
} from './change-gate-rereview-store';
import type { HumanReReviewFailure, HumanReReviewView } from './human-re-review';
import { humanImprovementTaskType } from './human-improvement-bridge';
import { REREVIEW_IMPROVEMENT_KIND } from './rereview-improvement-bridge';
import type { JuryMembership } from './records';
import { JURY_DECISIONS } from './records';
import type { ProductReviewCore } from './review-boundary';

export type SecondReReviewFailure = HumanReReviewFailure | 'NOT_REREVIEW_IMPROVEMENT_TASK';

const REASON = { code: 'CHANGE_GATE_APPROVED', message: 'Approved change gate is ready for re-review.' };
const SITE = 'AIsle';

export async function evaluateSecondReReview(input: {
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
  try {
    const { prisma } = await import('@/lib/prisma');
    const prepared = await prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>(
        Prisma.sql`SELECT id FROM "JuryAgentExecution" WHERE id = ${input.agentExecutionId} AND "tenantId" = ${actor.tenantId} FOR UPDATE`,
      );
      if (!locked[0]) return { ok: false as const, reason: 'NOT_FOUND' as const };
      const execution = await tx.juryAgentExecution.findFirst({
        where: { id: input.agentExecutionId, tenantId: actor.tenantId },
        select: {
          id: true,
          tenantId: true,
          taskId: true,
          agent: true,
          status: true,
          provenance: true,
          task: {
            select: {
              id: true,
              tenantId: true,
              reviewResultId: true,
              taskType: true,
              evidenceId: true,
              provenance: true,
            },
          },
        },
      });
      if (!execution || execution.agent !== 'CURSOR') return { ok: false as const, reason: 'NOT_FOUND' as const };
      const task = execution.task?.tenantId === actor.tenantId ? execution.task : null;
      const marked = task ? reReviewTask(task.provenance, task.id, task.reviewResultId) : null;
      if (!task || !marked || textField(execution.provenance, 'improvementTaskId') !== task.id) {
        return { ok: false as const, reason: 'NOT_REREVIEW_IMPROVEMENT_TASK' as const };
      }
      const taskType = task.taskType === 'VERIFICATION' || task.taskType === 'REWORD' ? task.taskType : null;
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
        || !taskType
        || !result.parentReviewResultId
        || result.request?.tenantId !== actor.tenantId
        || result.request.id !== result.reviewRequestId
        || humanImprovementTaskType(decision) !== taskType
        || !linked
        || linked.status !== 'EXECUTED'
        || linked.source !== 'CHANGE_GATE'
        || linked.reviewRequestId !== marked.reReviewReviewRequestId
        || linked.parentReviewResultId !== result.parentReviewResultId
        || linked.changeGateResultId !== marked.changeGateResultId
        || linked.agentExecutionId !== marked.agentExecutionId
        || linked.improvementTaskId !== marked.sourceImprovementTaskId
      ) {
        return { ok: false as const, reason: 'NOT_REREVIEW_IMPROVEMENT_TASK' as const };
      }
      const original = await tx.juryReviewResult.findFirst({
        where: { id: result.parentReviewResultId, tenantId: actor.tenantId },
        select: {
          id: true,
          reviewRequestId: true,
          humanDecision: { select: { id: true, tenantId: true, reviewResultId: true } },
        },
      });
      const sourceGate = await tx.juryChangeGateResult.findFirst({
        where: { id: linked.changeGateResultId, tenantId: actor.tenantId },
        select: { id: true, executionId: true, improvementTaskId: true, status: true },
      });
      const sourceExecution = await tx.juryAgentExecution.findFirst({
        where: { id: linked.agentExecutionId, tenantId: actor.tenantId },
        select: { id: true, taskId: true, status: true },
      });
      const sourceTask = await tx.juryImprovementTask.findFirst({
        where: { id: linked.improvementTaskId, tenantId: actor.tenantId },
        select: { id: true, reviewResultId: true },
      });
      const evidenceRow = await tx.juryEvidence.findFirst({
        where: { id: linked.evidenceId, tenantId: actor.tenantId },
        select: { id: true },
      });
      const sourceHuman = original?.humanDecision?.tenantId === actor.tenantId ? original.humanDecision : null;
      if (
        !original
        || original.id !== marked.originalReviewResultId
        || original.reviewRequestId !== marked.originalReviewRequestId
        || !sourceHuman
        || sourceHuman.id !== marked.humanDecisionId
        || sourceHuman.reviewResultId !== original.id
        || !sourceGate
        || sourceGate.status !== 'APPROVED'
        || sourceGate.executionId !== sourceExecution?.id
        || sourceGate.improvementTaskId !== sourceTask?.id
        || !sourceExecution
        || sourceExecution.status !== 'COMPLETED'
        || sourceExecution.id === execution.id
        || sourceExecution.taskId !== sourceTask?.id
        || !sourceTask
        || sourceTask.reviewResultId !== original.id
        || !evidenceRow
        || result.request.evidenceId !== evidenceRow.id
        || (task.evidenceId !== null && task.evidenceId !== evidenceRow.id)
      ) {
        return { ok: false as const, reason: 'NOT_REREVIEW_IMPROVEMENT_TASK' as const };
      }
      const approval = await tx.juryHumanDecision.findFirst({
        where: { tenantId: actor.tenantId, reviewResultId: result.id },
        select: { id: true, reviewResultId: true, reviewRequestId: true, decision: true },
      });
      const approvalDecision = approval ? oneOf(JURY_DECISIONS, approval.decision) : null;
      if (
        !approval
        || !approvalDecision
        || approval.reviewResultId !== result.id
        || approval.reviewRequestId !== result.reviewRequestId
        || approval.id === sourceHuman.id
        || textField(execution.provenance, 'humanDecisionId') !== approval.id
        || approvalDecision === 'ACCEPT'
        || humanImprovementTaskType(approvalDecision) !== taskType
      ) {
        return { ok: false as const, reason: 'HUMAN_APPROVAL_REQUIRED' as const };
      }
      const allowed = decideJuryMutation({
        actor,
        action: 'review.start',
        resourceTenantId: actor.tenantId,
      });
      if (!allowed.ok) return { ok: false as const, reason: 'FORBIDDEN' as const };
      if (execution.status !== 'COMPLETED') return { ok: false as const, reason: 'EXECUTION_NOT_COMPLETED' as const };
      if (
        textField(execution.provenance, 'kind') !== 'human-agent-execution'
        || textField(execution.provenance, 'reviewResultId') !== result.id
      ) {
        return { ok: false as const, reason: 'NOT_FOUND' as const };
      }
      const gate = await tx.juryChangeGateResult.findFirst({
        where: { executionId: execution.id, tenantId: actor.tenantId },
        select: {
          id: true,
          tenantId: true,
          executionId: true,
          improvementTaskId: true,
          status: true,
          changeGateReview: { select: { id: true, tenantId: true, status: true, reviewRequestId: true, reviewResultId: true } },
        },
      });
      if (
        !gate
        || gate.tenantId !== actor.tenantId
        || gate.executionId !== execution.id
        || gate.improvementTaskId !== task.id
        || gate.id === sourceGate.id
        || gate.status !== 'APPROVED'
      ) {
        return { ok: false as const, reason: 'RE-REVIEW_NOT_APPROVED' as const };
      }
      const evidenceId = task.evidenceId ?? evidenceRow.id;
      const existing = gate.changeGateReview?.tenantId === actor.tenantId ? gate.changeGateReview : null;
      if (existing?.status === 'EXECUTED' && existing.reviewResultId) {
        const stored = await tx.juryReviewResult.findFirst({
          where: { id: existing.reviewResultId, tenantId: actor.tenantId },
          select: { id: true, expectedDecision: true, completedAt: true, reviewRequestId: true, parentReviewResultId: true },
        });
        if (!stored || stored.parentReviewResultId !== result.id) return { ok: false as const, reason: 'PERSISTENCE_FAILED' as const };
        return {
          ok: true as const,
          kind: 'stored' as const,
          created: false as const,
          reviewId: original.id,
          agentExecutionId: execution.id,
          reReview: {
            status: existing.status,
            reviewRequestId: stored.reviewRequestId,
            reviewResultId: stored.id,
            decision: stored.expectedDecision,
            completedAt: stored.completedAt.toISOString(),
          },
        };
      }
      return {
        ok: true as const,
        kind: 'ready' as const,
        reviewId: original.id,
        previousReReviewResultId: result.id,
        humanDecisionId: approval.id,
        agentExecutionId: execution.id,
        taskId: task.id,
        gateId: gate.id,
        evidenceId,
        existingRequestId: existing?.id ?? null,
      };
    });
    if (!prepared.ok) return prepared;
    if (prepared.kind === 'stored') return prepared;
    const requested = prepared.existingRequestId
      ? { ok: true as const, created: false, review: { id: prepared.existingRequestId } }
      : await requestReview(input.memberships, actor, prepared);
    if (!requested.ok) return { ok: false, reason: publicReason(requested.reason) };
    await stampSecondLineage(prepared, requested.review.id);
    const executed = await persistChangeGateReReviewExecution(
      {
        userId: actor.userId,
        memberships: input.memberships,
        clientTenantId: null,
        now: new Date().toISOString(),
        requestId: requested.review.id,
        siteName: SITE,
      },
      input.core,
    );
    if (executed.ok) {
      return {
        ok: true,
        created: executed.created,
        reviewId: prepared.reviewId,
        agentExecutionId: prepared.agentExecutionId,
        reReview: {
          status: 'EXECUTED',
          reviewRequestId: executed.result.reviewRequestId,
          reviewResultId: executed.result.id,
          decision: executed.result.expectedDecision,
          completedAt: executed.result.completedAt,
        },
      };
    }
    if (executed.reason === 'REVIEW_IN_PROGRESS') {
      const waited = await waitExecuted(requested.review.id, actor.tenantId);
      if (waited) {
        return { ok: true, created: false, reviewId: prepared.reviewId, agentExecutionId: prepared.agentExecutionId, reReview: waited };
      }
    }
    return { ok: false, reason: publicReason(executed.reason) };
  } catch (error) {
    if (isUnique(error)) return { ok: false, reason: 'REVIEW_IN_PROGRESS' };
    return { ok: false, reason: 'PERSISTENCE_FAILED' };
  }
}

async function requestReview(
  memberships: readonly JuryMembership[],
  actor: { userId: string; tenantId: string },
  prepared: { gateId: string; evidenceId: string; previousReReviewResultId: string },
) {
  try {
    return await persistChangeGateReReviewRequest({
      userId: actor.userId,
      memberships,
      clientTenantId: null,
      now: new Date().toISOString(),
      changeGateResultId: prepared.gateId,
      evidenceId: prepared.evidenceId,
      sourceEvidenceId: prepared.evidenceId,
      parentReviewResultId: prepared.previousReReviewResultId,
      reason: REASON,
    });
  } catch (error) {
    if (!isUnique(error)) throw error;
    const { prisma } = await import('@/lib/prisma');
    const row = await prisma.juryChangeGateReview.findFirst({
      where: { changeGateResultId: prepared.gateId, tenantId: actor.tenantId },
      select: { id: true },
    });
    if (!row) return { ok: false as const, reason: 'PERSISTENCE_FAILED' as const };
    return { ok: true as const, created: false, review: { id: row.id } };
  }
}

async function stampSecondLineage(
  prepared: {
    humanDecisionId: string;
    reviewId: string;
    previousReReviewResultId: string;
    agentExecutionId: string;
    taskId: string;
    gateId: string;
  },
  reviewRequestRowId: string,
): Promise<void> {
  const { prisma } = await import('@/lib/prisma');
  const row = await prisma.juryChangeGateReview.findFirst({
    where: { id: reviewRequestRowId, changeGateResultId: prepared.gateId },
    select: { tenantId: true, provenance: true },
  });
  if (!row) return;
  const current = row.provenance && typeof row.provenance === 'object' && !Array.isArray(row.provenance) ? row.provenance : {};
  await prisma.juryChangeGateReview.updateMany({
    where: { id: reviewRequestRowId, tenantId: row.tenantId },
    data: {
      provenance: {
        ...current,
        originalReviewResultId: prepared.reviewId,
        previousReReviewResultId: prepared.previousReReviewResultId,
        secondImprovementTaskId: prepared.taskId,
        secondHumanDecisionId: prepared.humanDecisionId,
        secondAgentExecutionId: prepared.agentExecutionId,
        secondChangeGateResultId: prepared.gateId,
      } as Prisma.InputJsonValue,
    },
  });
}

async function waitExecuted(requestId: string, tenantId: string): Promise<HumanReReviewView | null> {
  const { prisma } = await import('@/lib/prisma');
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const row = await prisma.juryChangeGateReview.findFirst({
      where: { id: requestId, tenantId },
      select: { status: true, reviewRequestId: true, reviewResultId: true },
    });
    if (row?.status === 'FAILED') return null;
    if (row?.status === 'EXECUTED' && row.reviewResultId) {
      const stored = await prisma.juryReviewResult.findFirst({
        where: { id: row.reviewResultId, tenantId },
        select: { expectedDecision: true, completedAt: true },
      });
      if (!stored) return null;
      return {
        status: row.status,
        reviewRequestId: row.reviewRequestId,
        reviewResultId: row.reviewResultId,
        decision: stored.expectedDecision,
        completedAt: stored.completedAt.toISOString(),
      };
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return null;
}

function publicReason(reason: string): SecondReReviewFailure {
  if (
    reason === 'RE-REVIEW_NOT_APPROVED'
    || reason === 'EVIDENCE_NOT_AVAILABLE'
    || reason === 'SCOPE_NOT_APPROVED'
    || reason === 'REVIEW_IN_PROGRESS'
    || reason === 'REVIEW_CORE_FAILED'
    || reason === 'CREDENTIAL_IN_REASON'
    || reason === 'FORBIDDEN'
    || reason === 'NOT_FOUND'
    || reason === 'HUMAN_APPROVAL_REQUIRED'
    || reason === 'EXECUTION_NOT_COMPLETED'
    || reason === 'NOT_REREVIEW_IMPROVEMENT_TASK'
  ) {
    return reason;
  }
  if (reason === 'TENANT_MISMATCH' || reason === 'GATE_NOT_FOUND' || reason === 'REQUEST_NOT_FOUND') return 'NOT_FOUND';
  return 'PERSISTENCE_FAILED';
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

function isUnique(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: string }).code === 'P2002';
}
