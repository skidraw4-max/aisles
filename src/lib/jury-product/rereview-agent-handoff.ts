/**
 * Hands a Phase 54 re-review improvement task to one PENDING agent execution.
 * The re-review decision is not approval. A separate human decision on that result is required.
 * This does not run an adapter, a gate, a re-review, or a loop.
 */
import { Prisma } from '@prisma/client';
import { decideJuryMutation, resolveJuryActor } from './access';
import {
  HUMAN_HANDOFF_AGENT,
  HUMAN_HANDOFF_AUDIT,
  HUMAN_HANDOFF_WORKSPACE,
  humanAgentExecutionId,
  humanAgentHandoffAuditId,
} from './human-agent-handoff';
import { humanImprovementTaskType } from './human-improvement-bridge';
import { noteHumanNextAction } from './review-console';
import { REREVIEW_IMPROVEMENT_KIND } from './rereview-improvement-bridge';
import type { JuryDecision, JuryMembership } from './records';
import { JURY_DECISIONS } from './records';

export type ReReviewHandoffFailure =
  | 'UNAUTHENTICATED'
  | 'NO_MEMBERSHIP'
  | 'AMBIGUOUS_MEMBERSHIP'
  | 'STORE_UNAVAILABLE'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'NOT_REREVIEW_IMPROVEMENT_TASK'
  | 'HUMAN_APPROVAL_REQUIRED'
  | 'IMPROVEMENT_TASK_NOT_OPEN'
  | 'SNAPSHOT_UNSAFE'
  | 'PERSISTENCE_FAILED';

type Ready = {
  reviewId: string;
  reReviewResultId: string;
  reReviewRequestId: string;
  originalReviewResultId: string;
  originalReviewRequestId: string;
  sourceHumanDecisionId: string;
  sourceTaskId: string;
  sourceExecutionId: string;
  gateId: string;
  taskId: string;
  taskType: 'VERIFICATION' | 'REWORD';
  decision: JuryDecision;
  status: string;
  diagnosis: string;
  acceptanceCriteria: string[];
  evidenceId: string | null;
  approval: { id: string; decision: JuryDecision } | null;
};

export async function approveReReviewAgent(input: {
  userId: string | null;
  memberships: readonly JuryMembership[];
  improvementTaskId: string;
}): Promise<
  | { ok: true; created: boolean; reviewId: string; reReviewResultId: string; decision: JuryDecision }
  | { ok: false; reason: ReReviewHandoffFailure }
> {
  const actor = resolveJuryActor({ userId: input.userId, memberships: input.memberships, clientTenantId: null });
  if (!actor.ok) return { ok: false, reason: actor.reason };
  const ready = await readReady(actor.tenantId, input.improvementTaskId);
  if (!ready.ok) return ready;
  if (ready.task.status !== 'OPEN') return { ok: false, reason: 'IMPROVEMENT_TASK_NOT_OPEN' };
  if (ready.task.decision !== 'VERIFY' && ready.task.decision !== 'REWORD') {
    return { ok: false, reason: 'HUMAN_APPROVAL_REQUIRED' };
  }
  const noted = await noteHumanNextAction({
    userId: input.userId,
    memberships: input.memberships,
    reviewId: ready.task.reReviewResultId,
    action: ready.task.decision,
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
    reviewId: ready.task.reviewId,
    reReviewResultId: ready.task.reReviewResultId,
    decision: noted.humanDecision,
  };
}

export async function persistReReviewAgentHandoff(input: {
  userId: string | null;
  memberships: readonly JuryMembership[];
  improvementTaskId: string;
}): Promise<
  | {
      ok: true;
      created: boolean;
      reviewId: string;
      improvementTaskId: string;
      agentExecutionId: string;
      status: 'PENDING';
      agent: typeof HUMAN_HANDOFF_AGENT;
    }
  | { ok: false; reason: ReReviewHandoffFailure }
> {
  const actor = resolveJuryActor({ userId: input.userId, memberships: input.memberships, clientTenantId: null });
  if (!actor.ok) return { ok: false, reason: actor.reason };
  if (!input.improvementTaskId.trim()) return { ok: false, reason: 'NOT_FOUND' };
  try {
    const { prisma } = await import('@/lib/prisma');
    return await prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>(
        Prisma.sql`SELECT id FROM "JuryImprovementTask" WHERE id = ${input.improvementTaskId} AND "tenantId" = ${actor.tenantId} FOR UPDATE`,
      );
      if (!locked[0]) return { ok: false as const, reason: 'NOT_FOUND' as const };
      const ready = await readReady(actor.tenantId, input.improvementTaskId, tx as unknown as Tx);
      if (!ready.ok) return ready;
      const task = ready.task;
      if (task.decision !== 'VERIFY' && task.decision !== 'REWORD') {
        return { ok: false as const, reason: 'HUMAN_APPROVAL_REQUIRED' as const };
      }
      if (!task.approval || task.approval.decision === 'ACCEPT' || humanImprovementTaskType(task.approval.decision) !== task.taskType) {
        return { ok: false as const, reason: 'HUMAN_APPROVAL_REQUIRED' as const };
      }
      const write = decideJuryMutation({ actor, action: 'improvement.write', resourceTenantId: actor.tenantId });
      const execute = decideJuryMutation({ actor, action: 'agent.execute', resourceTenantId: actor.tenantId });
      if (!write.ok || !execute.ok) return { ok: false as const, reason: 'FORBIDDEN' as const };
      if (task.status !== 'OPEN') return { ok: false as const, reason: 'IMPROVEMENT_TASK_NOT_OPEN' as const };
      const executionId = humanAgentExecutionId(actor.tenantId, task.taskId);
      const existing = await tx.juryAgentExecution.findFirst({
        where: { tenantId: actor.tenantId, taskId: task.taskId, agent: HUMAN_HANDOFF_AGENT },
        select: { id: true, tenantId: true, status: true, taskId: true },
      });
      if (existing) {
        if (existing.tenantId !== actor.tenantId || existing.taskId !== task.taskId || existing.status !== 'PENDING') {
          return { ok: false as const, reason: 'NOT_FOUND' as const };
        }
        return {
          ok: true as const,
          created: false,
          reviewId: task.reviewId,
          improvementTaskId: task.taskId,
          agentExecutionId: existing.id,
          status: 'PENDING' as const,
          agent: HUMAN_HANDOFF_AGENT,
        };
      }
      const snapshot = {
        kind: 'human-agent-handoff',
        improvementTaskId: task.taskId,
        reReviewResultId: task.reReviewResultId,
        reReviewRequestId: task.reReviewRequestId,
        originalReviewResultId: task.originalReviewResultId,
        originalReviewRequestId: task.originalReviewRequestId,
        humanDecisionId: task.approval.id,
        sourceImprovementTaskId: task.sourceTaskId,
        sourceAgentExecutionId: task.sourceExecutionId,
        changeGateResultId: task.gateId,
        taskType: task.taskType,
        diagnosis: task.diagnosis,
        acceptanceCriteria: task.acceptanceCriteria,
        evidenceId: task.evidenceId,
      };
      if (containsSecret(snapshot) || containsSecret(HUMAN_HANDOFF_WORKSPACE)) {
        return { ok: false as const, reason: 'SNAPSHOT_UNSAFE' as const };
      }
      const now = new Date();
      await tx.juryAgentExecution.create({
        data: {
          id: executionId,
          tenantId: actor.tenantId,
          taskId: task.taskId,
          agent: HUMAN_HANDOFF_AGENT,
          allowedPaths: [],
          deniedPaths: [],
          status: 'PENDING',
          startedAt: null,
          finishedAt: null,
          inputSnapshot: snapshot,
          workspaceRef: HUMAN_HANDOFF_WORKSPACE,
          requestedAt: now,
          provenance: {
            kind: 'human-agent-handoff',
            reReviewReviewRequestId: task.reReviewRequestId,
            reReviewReviewResultId: task.reReviewResultId,
            originalReviewRequestId: task.originalReviewRequestId,
            originalReviewResultId: task.originalReviewResultId,
            humanDecisionId: task.approval.id,
            sourceHumanDecisionId: task.sourceHumanDecisionId,
            sourceImprovementTaskId: task.sourceTaskId,
            sourceAgentExecutionId: task.sourceExecutionId,
            changeGateResultId: task.gateId,
            improvementTaskId: task.taskId,
            agentExecutionId: executionId,
            taskType: task.taskType,
          },
          createdAt: now,
          updatedAt: now,
        },
      });
      await tx.juryAuditEvent.create({
        data: {
          id: humanAgentHandoffAuditId(actor.tenantId, executionId),
          tenantId: actor.tenantId,
          timestamp: now,
          actor: actor.userId,
          action: HUMAN_HANDOFF_AUDIT,
          reviewId: task.reReviewResultId,
          decision: task.approval.decision,
          improvementTaskId: task.taskId,
          agent: HUMAN_HANDOFF_AGENT,
          agentExecutionId: executionId,
          provenance: {
            kind: 'human-agent-handoff',
            reReviewReviewRequestId: task.reReviewRequestId,
            reReviewReviewResultId: task.reReviewResultId,
            originalReviewRequestId: task.originalReviewRequestId,
            originalReviewResultId: task.originalReviewResultId,
            humanDecisionId: task.approval.id,
            sourceAgentExecutionId: task.sourceExecutionId,
            changeGateResultId: task.gateId,
            improvementTaskId: task.taskId,
            agentExecutionId: executionId,
          },
        },
      });
      return {
        ok: true as const,
        created: true,
        reviewId: task.reviewId,
        improvementTaskId: task.taskId,
        agentExecutionId: executionId,
        status: 'PENDING' as const,
        agent: HUMAN_HANDOFF_AGENT,
      };
    });
  } catch (error) {
    if (!isUnique(error)) return { ok: false, reason: 'PERSISTENCE_FAILED' };
    return reload(actor.tenantId, input.improvementTaskId);
  }
}

async function reload(tenantId: string, taskId: string): Promise<
  | {
      ok: true;
      created: false;
      reviewId: string;
      improvementTaskId: string;
      agentExecutionId: string;
      status: 'PENDING';
      agent: typeof HUMAN_HANDOFF_AGENT;
    }
  | { ok: false; reason: 'PERSISTENCE_FAILED' | 'NOT_FOUND' }
> {
  const { prisma } = await import('@/lib/prisma');
  const task = await prisma.juryImprovementTask.findFirst({
    where: { id: taskId, tenantId },
    select: { reviewResultId: true },
  });
  const execution = await prisma.juryAgentExecution.findFirst({
    where: { tenantId, taskId, agent: HUMAN_HANDOFF_AGENT },
    select: { id: true, status: true },
  });
  const result = task
    ? await prisma.juryReviewResult.findFirst({
        where: { id: task.reviewResultId, tenantId },
        select: { parentReviewResultId: true },
      })
    : null;
  if (!execution || execution.status !== 'PENDING' || !result?.parentReviewResultId) {
    return { ok: false, reason: 'PERSISTENCE_FAILED' };
  }
  return {
    ok: true,
    created: false,
    reviewId: result.parentReviewResultId,
    improvementTaskId: taskId,
    agentExecutionId: execution.id,
    status: 'PENDING',
    agent: HUMAN_HANDOFF_AGENT,
  };
}

type Tx = {
  juryImprovementTask: { findFirst: (args: unknown) => Promise<TaskRow | null> };
  juryReviewResult: { findFirst: (args: unknown) => Promise<ResultRow | null> };
  juryChangeGateReview: { findMany: (args: unknown) => Promise<GateReviewRow[]> };
  juryChangeGateResult: { findFirst: (args: unknown) => Promise<GateRow | null> };
  juryAgentExecution: { findFirst: (args: unknown) => Promise<ExecutionRow | null> };
  juryHumanDecision: { findFirst: (args: unknown) => Promise<HumanRow | null> };
  juryEvidence: { findFirst: (args: unknown) => Promise<{ id: string; tenantId: string } | null> };
};

async function readReady(
  tenantId: string,
  improvementTaskId: string,
  tx?: Tx,
): Promise<{ ok: true; task: Ready } | { ok: false; reason: ReReviewHandoffFailure }> {
  if (!improvementTaskId.trim()) return { ok: false, reason: 'NOT_FOUND' };
  const db = tx ?? await client();
  const task = await db.juryImprovementTask.findFirst({
    where: { id: improvementTaskId, tenantId },
    select: {
      id: true,
      tenantId: true,
      reviewResultId: true,
      status: true,
      taskType: true,
      diagnosis: true,
      acceptanceCriteria: true,
      evidenceId: true,
      provenance: true,
    },
  });
  if (!task || task.tenantId !== tenantId) return { ok: false, reason: 'NOT_FOUND' };
  const marked = reReviewTask(task.provenance, task.id, task.reviewResultId);
  if (!marked) return { ok: false, reason: 'NOT_REREVIEW_IMPROVEMENT_TASK' };
  const result = await db.juryReviewResult.findFirst({
    where: { id: task.reviewResultId, tenantId },
    select: {
      id: true,
      tenantId: true,
      reviewRequestId: true,
      parentReviewResultId: true,
      expectedDecision: true,
      request: { select: { id: true, tenantId: true, evidenceId: true } },
    },
  });
  const decision = result ? oneOf(JURY_DECISIONS, result.expectedDecision) : null;
  const taskType = task.taskType === 'VERIFICATION' || task.taskType === 'REWORD' ? task.taskType : null;
  const reviews = result
    ? await db.juryChangeGateReview.findMany({
        where: { reviewResultId: result.id, tenantId },
        select: {
          tenantId: true,
          parentReviewResultId: true,
          changeGateResultId: true,
          agentExecutionId: true,
          improvementTaskId: true,
          evidenceId: true,
          reviewRequestId: true,
          reviewResultId: true,
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
    || result.request?.tenantId !== tenantId
    || result.request.id !== result.reviewRequestId
    || !result.parentReviewResultId
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
  ) {
    return { ok: false, reason: decision === 'ACCEPT' ? 'HUMAN_APPROVAL_REQUIRED' : 'NOT_REREVIEW_IMPROVEMENT_TASK' };
  }
  const original = await db.juryReviewResult.findFirst({
    where: { id: result.parentReviewResultId, tenantId },
    select: {
      id: true,
      tenantId: true,
      reviewRequestId: true,
      request: { select: { id: true, tenantId: true } },
      humanDecision: { select: { id: true, tenantId: true, reviewResultId: true, reviewRequestId: true } },
    },
  });
  const gate = await db.juryChangeGateResult.findFirst({
    where: { id: linked.changeGateResultId, tenantId },
    select: { id: true, tenantId: true, executionId: true, improvementTaskId: true, status: true },
  });
  const execution = await db.juryAgentExecution.findFirst({
    where: { id: linked.agentExecutionId, tenantId },
    select: { id: true, tenantId: true, taskId: true, status: true },
  });
  const source = await db.juryImprovementTask.findFirst({
    where: { id: linked.improvementTaskId, tenantId },
    select: { id: true, tenantId: true, reviewResultId: true },
  });
  const evidence = await db.juryEvidence.findFirst({
    where: { id: linked.evidenceId, tenantId },
    select: { id: true, tenantId: true },
  });
  const sourceHuman = original?.humanDecision?.tenantId === tenantId ? original.humanDecision : null;
  if (
    !original
    || original.request?.id !== original.reviewRequestId
    || original.id !== marked.originalReviewResultId
    || original.reviewRequestId !== marked.originalReviewRequestId
    || !sourceHuman
    || sourceHuman.id !== marked.humanDecisionId
    || sourceHuman.reviewResultId !== original.id
    || sourceHuman.reviewRequestId !== original.reviewRequestId
    || !gate
    || gate.status !== 'APPROVED'
    || gate.executionId !== execution?.id
    || gate.improvementTaskId !== source?.id
    || !execution
    || execution.status !== 'COMPLETED'
    || execution.taskId !== source?.id
    || !source
    || source.reviewResultId !== original.id
    || !evidence
    || result.request.evidenceId !== evidence.id
    || (task.evidenceId !== null && task.evidenceId !== evidence.id)
  ) {
    return { ok: false, reason: 'NOT_REREVIEW_IMPROVEMENT_TASK' };
  }
  const approvalRow = await db.juryHumanDecision.findFirst({
    where: { tenantId, reviewResultId: result.id },
    select: { id: true, tenantId: true, reviewResultId: true, reviewRequestId: true, decision: true },
  });
  const approvalDecision = approvalRow ? oneOf(JURY_DECISIONS, approvalRow.decision) : null;
  const approval = approvalRow && approvalDecision && approvalRow.reviewResultId === result.id && approvalRow.reviewRequestId === result.reviewRequestId
    ? { id: approvalRow.id, decision: approvalDecision }
    : null;
  return {
    ok: true,
    task: {
      reviewId: original.id,
      reReviewResultId: result.id,
      reReviewRequestId: result.reviewRequestId,
      originalReviewResultId: original.id,
      originalReviewRequestId: original.reviewRequestId,
      sourceHumanDecisionId: sourceHuman.id,
      sourceTaskId: source.id,
      sourceExecutionId: execution.id,
      gateId: gate.id,
      taskId: task.id,
      taskType,
      decision,
      diagnosis: task.diagnosis,
      acceptanceCriteria: stringList(task.acceptanceCriteria),
      evidenceId: evidence.id,
      status: task.status,
      approval,
    },
  };
}

type TaskRow = {
  id: string;
  tenantId: string;
  reviewResultId: string;
  status: string;
  taskType: string | null;
  diagnosis: string;
  acceptanceCriteria: unknown;
  evidenceId: string | null;
  provenance: unknown;
};
type ResultRow = {
  id: string;
  tenantId: string;
  reviewRequestId: string;
  parentReviewResultId: string | null;
  expectedDecision: string;
  request: { id: string; tenantId: string; evidenceId: string } | null;
  humanDecision?: { id: string; tenantId: string; reviewResultId: string; reviewRequestId: string } | null;
};
type GateReviewRow = {
  tenantId: string;
  parentReviewResultId: string;
  changeGateResultId: string;
  agentExecutionId: string;
  improvementTaskId: string;
  evidenceId: string;
  reviewRequestId: string | null;
  reviewResultId: string | null;
  status: string;
  source: string;
};
type GateRow = { id: string; tenantId: string; executionId: string; improvementTaskId: string | null; status: string | null };
type ExecutionRow = { id: string; tenantId: string; taskId: string; status: string };
type HumanRow = { id: string; tenantId: string; reviewResultId: string; reviewRequestId: string; decision: string };

async function client(): Promise<Tx> {
  const { prisma } = await import('@/lib/prisma');
  return prisma as unknown as Tx;
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
  if (row.kind !== REREVIEW_IMPROVEMENT_KIND) return null;
  if (row.reReviewReviewResultId !== reviewResultId || row.improvementTaskId !== taskId) return null;
  const text = (key: string) => (typeof row[key] === 'string' && (row[key] as string).length > 0 ? row[key] as string : null);
  const reReviewReviewRequestId = text('reReviewReviewRequestId');
  const originalReviewRequestId = text('originalReviewRequestId');
  const originalReviewResultId = text('originalReviewResultId');
  const humanDecisionId = text('humanDecisionId');
  const sourceImprovementTaskId = text('sourceImprovementTaskId');
  const agentExecutionId = text('agentExecutionId');
  const changeGateResultId = text('changeGateResultId');
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

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

function oneOf<T extends string>(values: readonly T[], value: string): T | null {
  return (values as readonly string[]).includes(value) ? (value as T) : null;
}

function containsSecret(value: unknown): boolean {
  const text = JSON.stringify(value);
  if (!text) return false;
  const lower = text.toLowerCase();
  return (
    lower.includes('credentialref')
    || lower.includes('private_key')
    || lower.includes('begin private')
    || lower.includes('postgres://')
    || lower.includes('password')
    || lower.includes('access_token')
    || lower.includes('refresh_token')
    || lower.includes('api_key')
    || lower.includes('sessioncookie')
  );
}

function isUnique(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: string }).code === 'P2002';
}
