/**
 * Connects an approved product ImprovementTask to the existing human agent handoff.
 * The existing writer stores one PENDING execution and does not call an adapter.
 */
import { decideJuryMutation, resolveJuryActor } from './access';
import { HUMAN_IMPROVEMENT_KIND, humanImprovementTaskType } from './human-improvement-bridge';
import {
  persistHumanAgentHandoff,
  type HumanHandoffFailure,
} from './human-agent-handoff';
import type { JuryMembership } from './records';

export type ProductHandoffFailure = HumanHandoffFailure | 'REVIEW_NOT_COMPLETED';

export async function handoffProductImprovement(input: {
  userId: string | null;
  memberships: readonly JuryMembership[];
  improvementTaskId: string;
  clientTenantId?: string | null;
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
  | { ok: false; reason: ProductHandoffFailure }
> {
  void input.clientTenantId;
  const actor = resolveJuryActor({ userId: input.userId, memberships: input.memberships, clientTenantId: null });
  if (!actor.ok) return { ok: false, reason: actor.reason };
  if (!input.improvementTaskId.trim()) return { ok: false, reason: 'NOT_FOUND' };
  const allowed = decideJuryMutation({
    actor,
    action: 'improvement.write',
    resourceTenantId: actor.tenantId,
    clientTenantId: null,
  });
  if (!allowed.ok) return { ok: false, reason: 'FORBIDDEN' };
  const { prisma } = await import('@/lib/prisma');
  const task = await prisma.juryImprovementTask.findFirst({
    where: { id: input.improvementTaskId, tenantId: actor.tenantId },
    select: {
      id: true,
      tenantId: true,
      reviewResultId: true,
      evidenceId: true,
      taskType: true,
      provenance: true,
    },
  });
  if (!task || task.tenantId !== actor.tenantId) return { ok: false, reason: 'NOT_FOUND' };
  if (!productProvenance(task.provenance, task.reviewResultId)) {
    return { ok: false, reason: 'HUMAN_APPROVAL_REQUIRED' };
  }
  const review = await prisma.juryReviewResult.findFirst({
    where: { id: task.reviewResultId, tenantId: actor.tenantId },
    select: {
      id: true,
      tenantId: true,
      reviewRequestId: true,
      request: {
        select: {
          id: true,
          tenantId: true,
          status: true,
          evidenceId: true,
          connectionId: true,
          evidence: { select: { id: true, tenantId: true, connectionId: true } },
          connection: { select: { id: true, tenantId: true } },
        },
      },
    },
  });
  const request = review?.request;
  const evidence = request?.evidence;
  const connection = request?.connection;
  if (
    !review
    || review.tenantId !== actor.tenantId
    || !request
    || request.tenantId !== actor.tenantId
    || request.id !== review.reviewRequestId
  ) {
    return { ok: false, reason: 'NOT_FOUND' };
  }
  if (request.status !== 'COMPLETED') return { ok: false, reason: 'REVIEW_NOT_COMPLETED' };
  if (
    !evidence
    || evidence.tenantId !== actor.tenantId
    || evidence.id !== request.evidenceId
    || task.evidenceId !== evidence.id
    || !connection
    || connection.tenantId !== actor.tenantId
    || connection.id !== request.connectionId
    || evidence.connectionId !== connection.id
  ) {
    return { ok: false, reason: 'NOT_FOUND' };
  }
  const human = await prisma.juryHumanDecision.findFirst({
    where: { tenantId: actor.tenantId, reviewResultId: review.id },
    select: { decision: true },
  });
  const taskType = human?.decision === 'VERIFY' || human?.decision === 'REWORD'
    ? humanImprovementTaskType(human.decision)
    : null;
  if (!taskType || task.taskType !== taskType) return { ok: false, reason: 'HUMAN_APPROVAL_REQUIRED' };
  return persistHumanAgentHandoff({
    userId: input.userId,
    memberships: input.memberships,
    improvementTaskId: task.id,
  });
}

export async function loadProductImprovementApprovals(
  tenantId: string,
): Promise<Record<string, 'APPROVED' | 'PENDING' | 'ACCEPT'>> {
  const { prisma } = await import('@/lib/prisma');
  const [tasks, humans] = await Promise.all([
    prisma.juryImprovementTask.findMany({
      where: { tenantId },
      select: { id: true, reviewResultId: true, taskType: true, provenance: true },
    }),
    prisma.juryHumanDecision.findMany({
      where: { tenantId },
      select: { reviewResultId: true, decision: true },
    }),
  ]);
  const byReview = new Map(humans.map((row) => [row.reviewResultId, row.decision]));
  const approvals: Record<string, 'APPROVED' | 'PENDING' | 'ACCEPT'> = {};
  for (const task of tasks) {
    if (!productProvenance(task.provenance, task.reviewResultId)) continue;
    const decision = byReview.get(task.reviewResultId);
    if (decision === 'VERIFY' && task.taskType === 'VERIFICATION') approvals[task.id] = 'APPROVED';
    else if (decision === 'REWORD' && task.taskType === 'REWORD') approvals[task.id] = 'APPROVED';
    else if (decision === 'ACCEPT') approvals[task.id] = 'ACCEPT';
    else approvals[task.id] = 'PENDING';
  }
  return approvals;
}

function productProvenance(value: unknown, reviewResultId: string): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return row.kind === HUMAN_IMPROVEMENT_KIND && row.reviewResultId === reviewResultId;
}
