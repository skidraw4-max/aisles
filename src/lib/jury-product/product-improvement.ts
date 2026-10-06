/**
 * Connects a completed product ReviewResult to the existing human-decision improvement boundary.
 * ACCEPT stops with no task. VERIFY and REWORD confirm the core decision, then create one task.
 */
import { decideJuryMutation, resolveJuryActor } from './access';
import type { JuryConsoleView } from './console-view';
import { persistHumanImprovement, type HumanImprovementFailure } from './human-improvement-bridge';
import { noteHumanNextAction, type ReviewConsoleFailure } from './review-console';
import { JURY_DECISIONS, type JuryDecision, type JuryMembership } from './records';

export type ProductImprovementFailure = HumanImprovementFailure | ReviewConsoleFailure | 'REVIEW_NOT_COMPLETED';

export function projectImprovementRows(
  view: JuryConsoleView,
  approvals: Readonly<Record<string, 'APPROVED' | 'PENDING' | 'ACCEPT'>> = {},
) {
  const executions = view.executions ?? [];
  return view.tasks
    .filter((task) => task.tenantId === view.tenantId)
    .map((task) => {
      const result = view.results.find((row) => row.id === task.reviewResultId && row.tenantId === view.tenantId) ?? null;
      const request = result
        ? (view.requests.find((row) => row.id === result.reviewRequestId && row.tenantId === view.tenantId) ?? null)
        : null;
      const evidence = request
        ? (view.evidence.find((row) => row.id === request.evidenceId && row.tenantId === view.tenantId) ?? null)
        : null;
      const connection = request
        ? (view.connections.find((row) => row.id === request.connectionId && row.tenantId === view.tenantId) ?? null)
        : null;
      const execution = executions.find((row) => row.taskId === task.id && row.tenantId === view.tenantId) ?? null;
      return {
        id: task.id,
        status: task.status,
        taskType: task.taskType ?? null,
        diagnosis: task.diagnosis,
        acceptanceCriteria: task.acceptanceCriteria,
        sourceReviewId: task.reviewResultId,
        sourceService: connection?.displayName ?? null,
        evidenceId: evidence?.id ?? null,
        connectionId: connection?.id ?? null,
        approval: approvals[task.id] ?? null,
        agentStatus: execution?.status ?? null,
        agentExecutionId: execution?.id ?? null,
        agentFinishedAt: execution?.finishedAt ?? null,
      };
    });
}

export async function connectProductReviewImprovement(input: {
  userId: string | null;
  memberships: readonly JuryMembership[];
  reviewId: string;
  clientTenantId?: string | null;
}): Promise<
  | {
      ok: true;
      created: boolean;
      reviewId: string;
      juryDecision: JuryDecision;
      taskId: string | null;
      taskType: 'VERIFICATION' | 'REWORD' | null;
    }
  | { ok: false; reason: ProductImprovementFailure }
> {
  void input.clientTenantId;
  const actor = resolveJuryActor({ userId: input.userId, memberships: input.memberships, clientTenantId: null });
  if (!actor.ok) return { ok: false, reason: actor.reason };
  if (!input.reviewId.trim()) return { ok: false, reason: 'NOT_FOUND' };
  const allowed = decideJuryMutation({
    actor,
    action: 'improvement.write',
    resourceTenantId: actor.tenantId,
    clientTenantId: null,
  });
  if (!allowed.ok) return { ok: false, reason: 'FORBIDDEN' };
  const { prisma } = await import('@/lib/prisma');
  const review = await prisma.juryReviewResult.findFirst({
    where: { id: input.reviewId, tenantId: actor.tenantId },
    select: {
      id: true,
      tenantId: true,
      expectedDecision: true,
      request: { select: { id: true, tenantId: true, status: true } },
    },
  });
  const request = review?.request;
  if (!review || !request || review.tenantId !== actor.tenantId || request.tenantId !== actor.tenantId) {
    return { ok: false, reason: 'NOT_FOUND' };
  }
  if (request.status !== 'COMPLETED') return { ok: false, reason: 'REVIEW_NOT_COMPLETED' };
  const decision = oneOf(JURY_DECISIONS, review.expectedDecision);
  if (!decision) return { ok: false, reason: 'NOT_FOUND' };
  const noted = await noteHumanNextAction({
    userId: input.userId,
    memberships: input.memberships,
    reviewId: review.id,
    action: decision,
  });
  if (!noted.ok) return noted;
  const stored = await persistHumanImprovement({
    userId: input.userId,
    memberships: input.memberships,
    reviewId: review.id,
  });
  if (!stored.ok) return stored;
  return {
    ok: true,
    created: stored.created,
    reviewId: stored.reviewId,
    juryDecision: stored.juryDecision,
    taskId: stored.taskId,
    taskType: stored.taskType,
  };
}

function oneOf<T extends string>(values: readonly T[], value: string): T | null {
  return (values as readonly string[]).includes(value) ? (value as T) : null;
}
