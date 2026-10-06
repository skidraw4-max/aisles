/**
 * Sends one APPROVED product Change Gate through the existing human re-review boundary.
 * The boundary creates the next ReviewResult and stops. No task, agent, or gate is added.
 */
import { Prisma } from '@prisma/client';
import { containsSecret } from './agent-execution';
import { decideJuryMutation, resolveJuryActor } from './access';
import { HUMAN_HANDOFF_AGENT } from './human-agent-handoff';
import { HUMAN_IMPROVEMENT_KIND, humanImprovementTaskType } from './human-improvement-bridge';
import { evaluateHumanReReview, type HumanReReviewFailure, type HumanReReviewView } from './human-re-review';
import type { JuryMembership } from './records';
import { JURY_DECISIONS } from './records';
import type { ProductReviewCore } from './review-boundary';

export type ProductReReviewFailure = HumanReReviewFailure | 'SNAPSHOT_UNSAFE';

export type ProductReReviewState = {
  status: 'READY' | 'RUNNING' | 'EXECUTED' | 'FAILED';
  decision: string | null;
  completedAt: string | null;
  reviewResultId: string | null;
  parentReviewResultId: string;
  evidenceId: string;
};

export async function runProductChangeGateReReview(input: {
  userId: string | null;
  memberships: readonly JuryMembership[];
  agentExecutionId: string;
  clientTenantId?: string | null;
  core?: ProductReviewCore;
}): Promise<
  | { ok: true; created: boolean; reviewId: string; agentExecutionId: string; reReview: HumanReReviewView }
  | { ok: false; reason: ProductReReviewFailure }
> {
  void input.clientTenantId;
  const actor = resolveJuryActor({ userId: input.userId, memberships: input.memberships, clientTenantId: null });
  if (!actor.ok) return { ok: false, reason: actor.reason };
  if (!input.agentExecutionId.trim()) return { ok: false, reason: 'NOT_FOUND' };
  const allowed = decideJuryMutation({
    actor,
    action: 'review.start',
    resourceTenantId: actor.tenantId,
    clientTenantId: null,
  });
  if (!allowed.ok) return { ok: false, reason: allowed.reason === 'FORBIDDEN' ? 'FORBIDDEN' : 'NOT_FOUND' };
  try {
    const { prisma } = await import('@/lib/prisma');
    const ready = await prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>(
        Prisma.sql`SELECT id FROM "JuryAgentExecution" WHERE id = ${input.agentExecutionId} AND "tenantId" = ${actor.tenantId} FOR UPDATE`,
      );
      if (!locked[0]) return { ok: false as const, reason: 'NOT_FOUND' as const };
      const execution = await tx.juryAgentExecution.findFirst({
        where: { id: input.agentExecutionId, tenantId: actor.tenantId },
        select: {
          id: true,
          taskId: true,
          agent: true,
          status: true,
          inputSnapshot: true,
          provenance: true,
          task: {
            select: {
              id: true,
              tenantId: true,
              reviewResultId: true,
              evidenceId: true,
              taskType: true,
              provenance: true,
              reviewResult: {
                select: {
                  id: true,
                  tenantId: true,
                  reviewRequestId: true,
                  expectedDecision: true,
                  request: {
                    select: {
                      id: true,
                      tenantId: true,
                      evidenceId: true,
                      connectionId: true,
                      evidence: { select: { id: true, tenantId: true, connectionId: true } },
                      connection: { select: { id: true, tenantId: true } },
                    },
                  },
                  humanDecision: {
                    select: { id: true, tenantId: true, reviewResultId: true, decision: true },
                  },
                },
              },
            },
          },
        },
      });
      const task = execution?.task?.tenantId === actor.tenantId ? execution.task : null;
      const review = task?.reviewResult?.tenantId === actor.tenantId ? task.reviewResult : null;
      const request = review?.request?.tenantId === actor.tenantId ? review.request : null;
      const evidence = request?.evidence;
      const connection = request?.connection;
      const human = review?.humanDecision?.tenantId === actor.tenantId ? review.humanDecision : null;
      if (
        !execution
        || execution.agent !== HUMAN_HANDOFF_AGENT
        || !task
        || task.id !== execution.taskId
        || !review
        || !request
        || request.id !== review.reviewRequestId
        || !productExecutionProvenance(execution.provenance, task.id)
        || !evidence
        || evidence.tenantId !== actor.tenantId
        || evidence.id !== request.evidenceId
        || task.evidenceId !== evidence.id
        || !connection
        || connection.tenantId !== actor.tenantId
        || connection.id !== request.connectionId
        || evidence.connectionId !== connection.id
      ) {
        return { ok: false as const, reason: 'NOT_FOUND' as const };
      }
      if (!productTaskProvenance(task.provenance, review.id)) {
        return { ok: false as const, reason: 'HUMAN_APPROVAL_REQUIRED' as const };
      }
      const juryDecision = oneOf(JURY_DECISIONS, review.expectedDecision);
      const humanDecision = human ? oneOf(JURY_DECISIONS, human.decision) : null;
      const taskType = humanDecision === 'VERIFY' || humanDecision === 'REWORD' ? humanImprovementTaskType(humanDecision) : null;
      if (!human || !juryDecision || !humanDecision || !taskType || task.taskType !== taskType || human.reviewResultId !== review.id) {
        return { ok: false as const, reason: 'HUMAN_APPROVAL_REQUIRED' as const };
      }
      if (execution.status !== 'COMPLETED') return { ok: false as const, reason: 'EXECUTION_NOT_COMPLETED' as const };
      if (containsSecret(execution.inputSnapshot) || containsSecret(execution.provenance)) {
        return { ok: false as const, reason: 'SNAPSHOT_UNSAFE' as const };
      }
      const gate = await tx.juryChangeGateResult.findFirst({
        where: { executionId: execution.id, tenantId: actor.tenantId },
        select: { status: true, improvementTaskId: true },
      });
      if (!gate || gate.status !== 'APPROVED' || gate.improvementTaskId !== task.id) {
        return { ok: false as const, reason: 'RE-REVIEW_NOT_APPROVED' as const };
      }
      return { ok: true as const };
    });
    if (!ready.ok) return ready;
  } catch {
    return { ok: false, reason: 'PERSISTENCE_FAILED' };
  }
  return evaluateHumanReReview({
    userId: input.userId,
    memberships: input.memberships,
    agentExecutionId: input.agentExecutionId,
    core: input.core,
  });
}

export async function loadProductReReviewStates(tenantId: string): Promise<Record<string, ProductReReviewState>> {
  const { prisma } = await import('@/lib/prisma');
  const reviews = await prisma.juryChangeGateReview.findMany({
    where: { tenantId },
    select: {
      agentExecutionId: true,
      status: true,
      reviewResultId: true,
      parentReviewResultId: true,
      evidenceId: true,
      improvementTask: { select: { provenance: true, reviewResultId: true } },
    },
  });
  const product = reviews.filter((row) => productTaskProvenance(row.improvementTask.provenance, row.improvementTask.reviewResultId));
  const resultIds = product.flatMap((row) => (row.reviewResultId ? [row.reviewResultId] : []));
  const results = resultIds.length === 0
    ? []
    : await prisma.juryReviewResult.findMany({
      where: { tenantId, id: { in: resultIds } },
      select: { id: true, expectedDecision: true, completedAt: true },
    });
  const byId = new Map(results.map((row) => [row.id, row]));
  const states: Record<string, ProductReReviewState> = {};
  for (const row of product) {
    if (row.status !== 'READY' && row.status !== 'RUNNING' && row.status !== 'EXECUTED' && row.status !== 'FAILED') continue;
    const result = row.reviewResultId ? byId.get(row.reviewResultId) : undefined;
    states[row.agentExecutionId] = {
      status: row.status,
      decision: result?.expectedDecision ?? null,
      completedAt: result?.completedAt.toISOString() ?? null,
      reviewResultId: row.reviewResultId,
      parentReviewResultId: row.parentReviewResultId,
      evidenceId: row.evidenceId,
    };
  }
  return states;
}

function productTaskProvenance(value: unknown, reviewResultId: string): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return row.kind === HUMAN_IMPROVEMENT_KIND && row.reviewResultId === reviewResultId;
}

function productExecutionProvenance(value: unknown, taskId: string): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  if (row.reReviewResultId || row.changeGateResultId || row.sourceAgentExecutionId) return false;
  if (row.improvementTaskId !== taskId) return false;
  return row.kind === 'human-agent-handoff' || row.kind === 'human-agent-execution';
}

function oneOf<T extends string>(values: readonly T[], value: string): T | null {
  return (values as readonly string[]).includes(value) ? (value as T) : null;
}
