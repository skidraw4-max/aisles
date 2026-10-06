/**
 * Runs one later PENDING execution through the existing agent lifecycle.
 * It does not create an execution, a gate, a re-review, or a loop.
 */
import { resolveJuryActor } from './access';
import type { AgentAdapter } from './agents/agent-adapter';
import { HUMAN_HANDOFF_WORKSPACE } from './human-agent-handoff';
import { HUMAN_IMPROVEMENT_KIND, humanImprovementTaskType } from './human-improvement-bridge';
import type { JuryDecision, JuryMembership } from './records';
import { JURY_DECISIONS } from './records';
import { executeReReviewAgentExecution, type ReReviewExecutionFailure } from './rereview-agent-execution';
import { REREVIEW_IMPROVEMENT_KIND } from './rereview-improvement-bridge';

export async function executeLaterAgentExecution(input: {
  userId: string | null;
  memberships: readonly JuryMembership[];
  agentExecutionId: string;
  adapter?: AgentAdapter;
}): Promise<
  | {
      ok: true;
      adapterCalled: boolean;
      reviewId: string;
      agentExecutionId: string;
      status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'BLOCKED';
      agent: string;
      result: { summary: string; changedFiles: string[]; testsRun: string[]; testsPassed: boolean | null } | null;
    }
  | { ok: false; reason: ReReviewExecutionFailure; adapterCalled: false }
> {
  const actor = resolveJuryActor({ userId: input.userId, memberships: input.memberships, clientTenantId: null });
  if (!actor.ok) return { ok: false, reason: actor.reason, adapterCalled: false };
  if (!input.agentExecutionId.trim()) return { ok: false, reason: 'NOT_FOUND', adapterCalled: false };
  const ready = await loadLaterExecution(actor.tenantId, input.agentExecutionId);
  if (!ready.ok) return { ok: false, reason: ready.reason, adapterCalled: false };
  const ran = await executeReReviewAgentExecution({
    userId: input.userId,
    memberships: input.memberships,
    agentExecutionId: input.agentExecutionId,
    adapter: input.adapter,
  });
  if (!ran.ok) return ran;
  return { ...ran, reviewId: ready.rootId };
}

async function loadLaterExecution(
  tenantId: string,
  agentExecutionId: string,
): Promise<{ ok: true; rootId: string } | { ok: false; reason: ReReviewExecutionFailure }> {
  const { prisma } = await import('@/lib/prisma');
  const current = await prisma.juryAgentExecution.findFirst({
    where: { id: agentExecutionId, tenantId },
    select: {
      id: true,
      taskId: true,
      agent: true,
      status: true,
      provenance: true,
      workspaceRef: true,
    },
  });
  if (!current) return { ok: false, reason: 'NOT_FOUND' };
  const task = await prisma.juryImprovementTask.findFirst({
    where: { id: current.taskId, tenantId },
    select: {
      id: true,
      reviewResultId: true,
      parentTaskId: true,
      status: true,
      taskType: true,
      evidenceId: true,
      provenance: true,
    },
  });
  if (!task) return { ok: false, reason: 'NOT_FOUND' };
  const marked = reReviewTask(task.provenance, task.id, task.reviewResultId);
  const taskType = task.taskType === 'VERIFICATION' || task.taskType === 'REWORD' ? task.taskType : null;
  if (!marked || !taskType || task.parentTaskId !== marked.sourceImprovementTaskId || current.id === marked.agentExecutionId) {
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
          id: true,
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
    || linked.agentExecutionId === current.id
    || result.request.evidenceId !== linked.evidenceId
    || (task.evidenceId !== null && task.evidenceId !== linked.evidenceId)
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
    select: { id: true, parentReviewResultId: true, reviewRequestId: true },
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
    || parent.reviewRequestId !== marked.originalReviewRequestId
    || !first
    || first.parentReviewResultId !== previousMarked.originalReviewResultId
    || first.id === result.id
  ) {
    return { ok: false, reason: 'NOT_REREVIEW_IMPROVEMENT_TASK' };
  }
  const sourceExecution = await prisma.juryAgentExecution.findFirst({
    where: { id: linked.agentExecutionId, tenantId },
    select: { id: true, status: true, taskId: true },
  });
  const gate = await prisma.juryChangeGateResult.findFirst({
    where: { id: linked.changeGateResultId, tenantId },
    select: { id: true, status: true, executionId: true, improvementTaskId: true },
  });
  if (
    !sourceExecution
    || sourceExecution.status !== 'COMPLETED'
    || sourceExecution.taskId !== source.id
    || sourceExecution.id === current.id
    || sourceExecution.id === sourceMarked.agentExecutionId
    || sourceExecution.id === previousMarked.agentExecutionId
    || !gate
    || gate.status !== 'APPROVED'
    || gate.executionId !== sourceExecution.id
    || gate.improvementTaskId !== source.id
    || gate.id === sourceMarked.changeGateResultId
    || gate.id === previousMarked.changeGateResultId
  ) {
    return { ok: false, reason: 'NOT_REREVIEW_IMPROVEMENT_TASK' };
  }
  if (task.status !== 'OPEN') return { ok: false, reason: 'NOT_REREVIEW_IMPROVEMENT_TASK' };
  const approval = await prisma.juryHumanDecision.findFirst({
    where: { tenantId, reviewResultId: result.id },
    select: { id: true, decision: true, reviewRequestId: true, reviewResultId: true },
  });
  const previousApproval = await prisma.juryHumanDecision.findFirst({
    where: { tenantId, reviewResultId: parent.id },
    select: { id: true },
  });
  const firstApproval = await prisma.juryHumanDecision.findFirst({
    where: { tenantId, reviewResultId: first.id },
    select: { id: true },
  });
  const rootApproval = await prisma.juryHumanDecision.findFirst({
    where: { tenantId, reviewResultId: previousMarked.originalReviewResultId },
    select: { id: true },
  });
  const approvalDecision = approval ? oneOf(JURY_DECISIONS, approval.decision) : null;
  const stamped = textField(current.provenance, 'humanDecisionId');
  const kind = textField(current.provenance, 'kind');
  const stampedTask = textField(current.provenance, 'improvementTaskId');
  if (
    !approval
    || !approvalDecision
    || !previousApproval
    || !firstApproval
    || !rootApproval
    || approval.reviewResultId !== result.id
    || approval.reviewRequestId !== result.reviewRequestId
    || approvalDecision === 'ACCEPT'
    || humanImprovementTaskType(approvalDecision) !== taskType
    || approval.id === marked.humanDecisionId
    || approval.id === previousApproval.id
    || approval.id === firstApproval.id
    || approval.id === rootApproval.id
    || stamped !== approval.id
  ) {
    return { ok: false, reason: 'HUMAN_APPROVAL_REQUIRED' };
  }
  if (
    current.agent !== 'CURSOR'
    || !sameWorkspace(current.workspaceRef)
    || stampedTask !== task.id
    || (current.status !== 'COMPLETED' && kind !== 'human-agent-handoff')
    || (current.status === 'COMPLETED' && kind !== 'human-agent-execution' && kind !== 'human-agent-handoff')
  ) {
    return { ok: false, reason: 'NOT_FOUND' };
  }
  return { ok: true, rootId: previousMarked.originalReviewResultId };
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

function sameWorkspace(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as { type?: unknown; ref?: unknown };
  return row.type === HUMAN_HANDOFF_WORKSPACE.type && row.ref === HUMAN_HANDOFF_WORKSPACE.ref;
}

function oneOf<T extends string>(values: readonly T[], value: string): T | null {
  return (values as readonly string[]).includes(value) ? (value as T) : null;
}
