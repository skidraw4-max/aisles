/**
 * Runs one Phase 55 PENDING execution through the Phase 51 lifecycle.
 * It does not create an execution, a gate, a re-review, or a loop.
 */
import { Prisma } from '@prisma/client';
import { decideJuryMutation, resolveJuryActor } from './access';
import { containsSecret } from './agent-execution';
import type { AgentAdapter } from './agents/agent-adapter';
import { fakeCursorAdapter } from './agents/fake-cursor-adapter';
import { HUMAN_HANDOFF_WORKSPACE } from './human-agent-handoff';
import { advanceLockedHumanExecution, type HumanExecutionFailure } from './human-agent-execution';
import { humanImprovementTaskType } from './human-improvement-bridge';
import { REREVIEW_IMPROVEMENT_KIND } from './rereview-improvement-bridge';
import type { JuryDecision, JuryMembership } from './records';
import { JURY_DECISIONS } from './records';

export type ReReviewExecutionFailure =
  | HumanExecutionFailure
  | 'NOT_REREVIEW_IMPROVEMENT_TASK'
  | 'SNAPSHOT_UNSAFE';

type AdvanceTx = Parameters<typeof advanceLockedHumanExecution>[0]['tx'];

export async function executeReReviewAgentExecution(input: {
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
  const adapter = input.adapter ?? fakeCursorAdapter('success');
  try {
    const { prisma } = await import('@/lib/prisma');
    return await prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>(
        Prisma.sql`SELECT id FROM "JuryAgentExecution" WHERE id = ${input.agentExecutionId} AND "tenantId" = ${actor.tenantId} FOR UPDATE`,
      );
      if (!locked[0]) return { ok: false as const, reason: 'NOT_FOUND' as const, adapterCalled: false as const };
      const execution = await tx.juryAgentExecution.findFirst({
        where: { id: input.agentExecutionId, tenantId: actor.tenantId },
        select: {
          id: true,
          tenantId: true,
          taskId: true,
          agent: true,
          status: true,
          provenance: true,
          inputSnapshot: true,
          workspaceRef: true,
          task: {
            select: {
              id: true,
              tenantId: true,
              reviewResultId: true,
              taskType: true,
              status: true,
              provenance: true,
              evidenceId: true,
            },
          },
        },
      });
      const executionKind = textField(execution?.provenance, 'kind');
      if (
        !execution
        || execution.agent !== 'CURSOR'
        || !sameWorkspace(execution.workspaceRef)
        || (execution.status !== 'COMPLETED' && executionKind !== 'human-agent-handoff')
      ) {
        return { ok: false as const, reason: 'NOT_FOUND' as const, adapterCalled: false as const };
      }
      const task = execution.task?.tenantId === actor.tenantId ? execution.task : null;
      const marked = task ? reReviewTask(task.provenance, task.id, task.reviewResultId) : null;
      if (!task || !marked) return { ok: false as const, reason: 'NOT_REREVIEW_IMPROVEMENT_TASK' as const, adapterCalled: false as const };
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
        return { ok: false as const, reason: 'NOT_REREVIEW_IMPROVEMENT_TASK' as const, adapterCalled: false as const };
      }
      const original = await tx.juryReviewResult.findFirst({
        where: { id: result.parentReviewResultId, tenantId: actor.tenantId },
        select: {
          id: true,
          reviewRequestId: true,
          humanDecision: { select: { id: true, tenantId: true, reviewResultId: true } },
        },
      });
      const gate = await tx.juryChangeGateResult.findFirst({
        where: { id: linked.changeGateResultId, tenantId: actor.tenantId },
        select: { executionId: true, improvementTaskId: true, status: true },
      });
      const sourceExecution = await tx.juryAgentExecution.findFirst({
        where: { id: linked.agentExecutionId, tenantId: actor.tenantId },
        select: { id: true, taskId: true, status: true },
      });
      const sourceTask = await tx.juryImprovementTask.findFirst({
        where: { id: linked.improvementTaskId, tenantId: actor.tenantId },
        select: { id: true, reviewResultId: true },
      });
      const evidence = await tx.juryEvidence.findFirst({
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
        || !gate
        || gate.status !== 'APPROVED'
        || gate.executionId !== sourceExecution?.id
        || gate.improvementTaskId !== sourceTask?.id
        || !sourceExecution
        || sourceExecution.status !== 'COMPLETED'
        || sourceExecution.id === execution.id
        || sourceExecution.taskId !== sourceTask?.id
        || !sourceTask
        || sourceTask.reviewResultId !== original.id
        || !evidence
        || result.request.evidenceId !== evidence.id
        || (task.evidenceId !== null && task.evidenceId !== evidence.id)
      ) {
        return { ok: false as const, reason: 'NOT_REREVIEW_IMPROVEMENT_TASK' as const, adapterCalled: false as const };
      }
      const approval = await tx.juryHumanDecision.findFirst({
        where: { tenantId: actor.tenantId, reviewResultId: result.id },
        select: { id: true, reviewResultId: true, reviewRequestId: true, decision: true },
      });
      const approvalDecision = approval ? oneOf(JURY_DECISIONS, approval.decision) : null;
      const stamped = textField(execution.provenance, 'humanDecisionId');
      const stampMatches = execution.status === 'COMPLETED' || stamped === approval?.id;
      if (
        !approval
        || !approvalDecision
        || approval.reviewResultId !== result.id
        || approval.reviewRequestId !== result.reviewRequestId
        || approval.id === sourceHuman.id
        || !stampMatches
        || approvalDecision === 'ACCEPT'
        || humanImprovementTaskType(approvalDecision) !== taskType
      ) {
        return { ok: false as const, reason: 'HUMAN_APPROVAL_REQUIRED' as const, adapterCalled: false as const };
      }
      const allowed = decideJuryMutation({
        actor,
        action: 'agent.execute',
        resourceTenantId: actor.tenantId,
      });
      if (!allowed.ok) return { ok: false as const, reason: 'FORBIDDEN' as const, adapterCalled: false as const };
      if (containsSecret(execution.inputSnapshot) || containsSecret(execution.provenance) || containsSecret(task.provenance)) {
        return { ok: false as const, reason: 'SNAPSHOT_UNSAFE' as const, adapterCalled: false as const };
      }
      const advanced = await advanceLockedHumanExecution({
        tx: tx as unknown as AdvanceTx,
        tenantId: actor.tenantId,
        userId: actor.userId,
        execution: { id: execution.id, agent: execution.agent, status: execution.status, provenance: execution.provenance },
        task: { id: task.id, provenance: task.provenance },
        review: { id: result.id, reviewRequestId: result.reviewRequestId },
        human: { id: approval.id, decision: approvalDecision },
        juryDecision: decision,
        taskType,
        adapter,
      });
      if (!advanced.ok) return advanced;
      return { ...advanced, reviewId: original.id };
    });
  } catch {
    return { ok: false, reason: 'PERSISTENCE_FAILED', adapterCalled: false };
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

function sameWorkspace(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as { type?: unknown; ref?: unknown };
  return row.type === HUMAN_HANDOFF_WORKSPACE.type && row.ref === HUMAN_HANDOFF_WORKSPACE.ref;
}

function oneOf<T extends string>(values: readonly T[], value: string): T | null {
  return (values as readonly string[]).includes(value) ? (value as T) : null;
}
