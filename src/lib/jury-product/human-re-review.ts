/**
 * Runs one re-review after an APPROVED change gate on a human-approved execution.
 * Lineage is read from the database. Decision cycles and the auto loop are not started.
 */
import { Prisma } from '@prisma/client';
import { decideJuryMutation, resolveJuryActor } from './access';
import { HUMAN_IMPROVEMENT_KIND, humanImprovementTaskType } from './human-improvement-bridge';
import {
  persistChangeGateReReviewExecution,
  persistChangeGateReReviewRequest,
} from './change-gate-rereview-store';
import type { JuryDecision, JuryMembership } from './records';
import { JURY_DECISIONS } from './records';
import type { ProductReviewCore } from './review-boundary';

export type HumanReReviewFailure =
  | 'UNAUTHENTICATED'
  | 'NO_MEMBERSHIP'
  | 'AMBIGUOUS_MEMBERSHIP'
  | 'STORE_UNAVAILABLE'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'HUMAN_APPROVAL_REQUIRED'
  | 'EXECUTION_NOT_COMPLETED'
  | 'RE-REVIEW_NOT_APPROVED'
  | 'EVIDENCE_NOT_AVAILABLE'
  | 'SCOPE_NOT_APPROVED'
  | 'REVIEW_IN_PROGRESS'
  | 'REVIEW_CORE_FAILED'
  | 'CREDENTIAL_IN_REASON'
  | 'PERSISTENCE_FAILED';

export type HumanReReviewView = {
  status: string;
  reviewRequestId: string | null;
  reviewResultId: string | null;
  decision: string | null;
  completedAt: string | null;
};

const REASON = { code: 'CHANGE_GATE_APPROVED', message: 'Approved change gate is ready for re-review.' };
const SITE = 'AIsle';

export async function evaluateHumanReReview(input: {
  userId: string | null;
  memberships: readonly JuryMembership[];
  agentExecutionId: string;
  core?: ProductReviewCore;
}): Promise<
  | { ok: true; created: boolean; reviewId: string; agentExecutionId: string; reReview: HumanReReviewView }
  | { ok: false; reason: HumanReReviewFailure }
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
          status: true,
          task: {
            select: {
              id: true,
              tenantId: true,
              reviewResultId: true,
              taskType: true,
              evidenceId: true,
              provenance: true,
              reviewResult: {
                select: {
                  id: true,
                  tenantId: true,
                  reviewRequestId: true,
                  request: { select: { id: true, tenantId: true, evidenceId: true } },
                  humanDecision: { select: { id: true, tenantId: true, decision: true, reviewResultId: true, reviewRequestId: true } },
                },
              },
            },
          },
        },
      });
      if (!execution || execution.tenantId !== actor.tenantId) return { ok: false as const, reason: 'NOT_FOUND' as const };
      const task = execution.task?.tenantId === actor.tenantId ? execution.task : null;
      const review = task?.reviewResult?.tenantId === actor.tenantId ? task.reviewResult : null;
      const request = review?.request?.tenantId === actor.tenantId ? review.request : null;
      const human = review?.humanDecision?.tenantId === actor.tenantId ? review.humanDecision : null;
      const humanDecision = human ? oneOf(JURY_DECISIONS, human.decision) : null;
      const linked = task ? linkedHuman(task.provenance, task.reviewResultId) : null;
      if (
        !task
        || !review
        || !request
        || !human
        || !humanDecision
        || !linked
        || task.id !== execution.taskId
        || human.id !== linked.humanDecisionId
        || human.reviewResultId !== task.reviewResultId
        || human.reviewResultId !== review.id
        || human.reviewRequestId !== request.id
        || human.reviewRequestId !== review.reviewRequestId
        || linked.reviewRequestId !== request.id
      ) {
        return { ok: false as const, reason: 'HUMAN_APPROVAL_REQUIRED' as const };
      }
      const taskType = humanImprovementTaskType(humanDecision);
      if (humanDecision === 'ACCEPT' || !taskType || task.taskType !== taskType) {
        return { ok: false as const, reason: 'HUMAN_APPROVAL_REQUIRED' as const };
      }
      const allowed = decideJuryMutation({
        actor,
        action: 'review.start',
        resourceTenantId: actor.tenantId,
      });
      if (!allowed.ok) return { ok: false as const, reason: 'FORBIDDEN' as const };
      if (execution.status !== 'COMPLETED') return { ok: false as const, reason: 'EXECUTION_NOT_COMPLETED' as const };
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
        || gate.status !== 'APPROVED'
      ) {
        return { ok: false as const, reason: 'RE-REVIEW_NOT_APPROVED' as const };
      }
      const evidenceId = task.evidenceId ?? request.evidenceId;
      const evidence = await tx.juryEvidence.findFirst({
        where: { id: evidenceId, tenantId: actor.tenantId },
        select: { id: true },
      });
      if (!evidence) return { ok: false as const, reason: 'EVIDENCE_NOT_AVAILABLE' as const };
      const existing = gate.changeGateReview?.tenantId === actor.tenantId ? gate.changeGateReview : null;
      if (existing?.status === 'EXECUTED' && existing.reviewResultId) {
        const stored = await tx.juryReviewResult.findFirst({
          where: { id: existing.reviewResultId, tenantId: actor.tenantId },
          select: { id: true, expectedDecision: true, completedAt: true, reviewRequestId: true },
        });
        if (!stored) return { ok: false as const, reason: 'PERSISTENCE_FAILED' as const };
        return {
          ok: true as const,
          kind: 'stored' as const,
          created: false as const,
          reviewId: review.id,
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
        reviewId: review.id,
        requestId: request.id,
        humanDecisionId: human.id,
        agentExecutionId: execution.id,
        gateId: gate.id,
        evidenceId: evidence.id,
        existingRequestId: existing?.id ?? null,
      };
    });
    if (!prepared.ok) return prepared;
    if (prepared.kind === 'stored') return prepared;
    const requested = prepared.existingRequestId
      ? { ok: true as const, created: false, review: { id: prepared.existingRequestId } }
      : await requestReview(input.memberships, prepared);
    if (!requested.ok) return { ok: false, reason: publicReason(requested.reason) };
    await stampLineage(prepared, requested.review.id);
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
  prepared: {
    gateId: string;
    evidenceId: string;
    reviewId: string;
  },
) {
  const actor = memberships[0];
  if (!actor) return { ok: false as const, reason: 'PERSISTENCE_FAILED' as const };
  try {
    return await persistChangeGateReReviewRequest({
      userId: actor?.userId ?? null,
      memberships,
      clientTenantId: null,
      now: new Date().toISOString(),
      changeGateResultId: prepared.gateId,
      evidenceId: prepared.evidenceId,
      sourceEvidenceId: prepared.evidenceId,
      parentReviewResultId: prepared.reviewId,
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

async function stampLineage(
  prepared: { humanDecisionId: string; requestId: string; reviewId: string; agentExecutionId: string; gateId: string },
  reviewRequestRowId: string,
): Promise<void> {
  const { prisma } = await import('@/lib/prisma');
  const row = await prisma.juryChangeGateReview.findFirst({
    where: { id: reviewRequestRowId, changeGateResultId: prepared.gateId },
    select: { tenantId: true, provenance: true },
  });
  if (!row) return;
  const current = row.provenance && typeof row.provenance === 'object' && !Array.isArray(row.provenance)
    ? row.provenance
    : {};
  await prisma.juryChangeGateReview.updateMany({
    where: { id: reviewRequestRowId, tenantId: row.tenantId },
    data: {
      provenance: {
        ...current,
        originalReviewRequestId: prepared.requestId,
        originalReviewResultId: prepared.reviewId,
        humanDecisionId: prepared.humanDecisionId,
        agentExecutionId: prepared.agentExecutionId,
        changeGateResultId: prepared.gateId,
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

function publicReason(reason: string): HumanReReviewFailure {
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
  ) {
    return reason;
  }
  if (reason === 'TENANT_MISMATCH' || reason === 'GATE_NOT_FOUND' || reason === 'REQUEST_NOT_FOUND') return 'NOT_FOUND';
  return 'PERSISTENCE_FAILED';
}

function linkedHuman(value: unknown, reviewResultId: string): { humanDecisionId: string; reviewRequestId: string } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (row.kind !== HUMAN_IMPROVEMENT_KIND) return null;
  if (typeof row.humanDecisionId !== 'string' || row.humanDecisionId.length === 0) return null;
  if (typeof row.reviewRequestId !== 'string' || row.reviewRequestId.length === 0) return null;
  if (row.reviewResultId !== reviewResultId) return null;
  return { humanDecisionId: row.humanDecisionId, reviewRequestId: row.reviewRequestId };
}

function oneOf<T extends string>(values: readonly T[], value: string): T | null {
  return (values as readonly string[]).includes(value) ? (value as T) : null;
}

function isUnique(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: string }).code === 'P2002';
}
