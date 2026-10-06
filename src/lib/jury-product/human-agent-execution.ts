/**
 * Moves one human-approved PENDING execution through RUNNING to COMPLETED.
 * The only runner is FakeCursorAdapter. It does not spawn a process or write a workspace.
 */
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { decideJuryMutation, resolveJuryActor } from './access';
import { containsSecret } from './agent-execution';
import type { AgentAdapter, AgentAdapterResult } from './agents/agent-adapter';
import { fakeCursorAdapter } from './agents/fake-cursor-adapter';
import { HUMAN_IMPROVEMENT_KIND, humanImprovementTaskType } from './human-improvement-bridge';
import type { JuryDecision, JuryMembership } from './records';
import { JURY_DECISIONS } from './records';

export const HUMAN_EXECUTION_STARTED = 'AGENT_EXECUTION_STARTED';
export const HUMAN_EXECUTION_COMPLETED = 'AGENT_EXECUTION_COMPLETED';

export type HumanExecutionFailure =
  | 'UNAUTHENTICATED'
  | 'NO_MEMBERSHIP'
  | 'AMBIGUOUS_MEMBERSHIP'
  | 'STORE_UNAVAILABLE'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'HUMAN_APPROVAL_REQUIRED'
  | 'ALREADY_RUNNING'
  | 'PERSISTENCE_FAILED';

export type HumanExecutionResult = {
  summary: string;
  changedFiles: string[];
  testsRun: string[];
  testsPassed: boolean | null;
};

export async function executeHumanAgentExecution(input: {
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
      result: HumanExecutionResult | null;
    }
  | { ok: false; reason: HumanExecutionFailure; adapterCalled: false }
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
          startedAt: true,
          finishedAt: true,
          provenance: true,
          task: {
            select: {
              id: true,
              tenantId: true,
              reviewResultId: true,
              taskType: true,
              provenance: true,
              reviewResult: {
                select: {
                  id: true,
                  tenantId: true,
                  reviewRequestId: true,
                  expectedDecision: true,
                  request: { select: { id: true, tenantId: true } },
                  humanDecision: {
                    select: { id: true, tenantId: true, reviewResultId: true, reviewRequestId: true, decision: true },
                  },
                },
              },
            },
          },
        },
      });
      if (!execution || execution.tenantId !== actor.tenantId || execution.agent !== 'CURSOR') {
        return { ok: false as const, reason: 'NOT_FOUND' as const, adapterCalled: false as const };
      }
      const task = execution.task?.tenantId === actor.tenantId ? execution.task : null;
      const review = task?.reviewResult?.tenantId === actor.tenantId ? task.reviewResult : null;
      const request = review?.request?.tenantId === actor.tenantId ? review.request : null;
      const human = review?.humanDecision?.tenantId === actor.tenantId ? review.humanDecision : null;
      const juryDecision = review ? oneOf(JURY_DECISIONS, review.expectedDecision) : null;
      const humanDecision = human ? oneOf(JURY_DECISIONS, human.decision) : null;
      const linked = task ? linkedHuman(task.provenance, task.reviewResultId) : null;
      if (
        !task
        || !review
        || !request
        || !juryDecision
        || task.id !== execution.taskId
        || request.id !== review.reviewRequestId
        || !linked
        || !human
        || !humanDecision
        || human.id !== linked.humanDecisionId
        || human.reviewResultId !== task.reviewResultId
        || human.reviewResultId !== review.id
        || human.reviewRequestId !== review.reviewRequestId
        || linked.reviewRequestId !== review.reviewRequestId
      ) {
        return { ok: false as const, reason: 'HUMAN_APPROVAL_REQUIRED' as const, adapterCalled: false as const };
      }
      const taskType = humanImprovementTaskType(humanDecision);
      if (humanDecision === 'ACCEPT' || !taskType || task.taskType !== taskType) {
        return { ok: false as const, reason: 'HUMAN_APPROVAL_REQUIRED' as const, adapterCalled: false as const };
      }
      const allowed = decideJuryMutation({
        actor,
        action: 'agent.execute',
        resourceTenantId: actor.tenantId,
      });
      if (!allowed.ok) return { ok: false as const, reason: 'FORBIDDEN' as const, adapterCalled: false as const };
      return advanceLockedHumanExecution({
        tx: tx as unknown as AdvanceTx,
        tenantId: actor.tenantId,
        userId: actor.userId,
        execution: { id: execution.id, agent: execution.agent, status: execution.status, provenance: execution.provenance },
        task: { id: task.id, provenance: task.provenance },
        review,
        human: { id: human.id, decision: humanDecision },
        juryDecision,
        taskType,
        adapter,
      });
    });
  } catch {
    return { ok: false, reason: 'PERSISTENCE_FAILED', adapterCalled: false };
  }
}

type AdvanceTx = {
  juryAgentExecution: {
    updateMany(args: Prisma.JuryAgentExecutionUpdateManyArgs): Promise<{ count: number }>;
  };
  juryAuditEvent: {
    create(args: { data: Prisma.JuryAuditEventUncheckedCreateInput }): Promise<unknown>;
  };
};

export async function advanceLockedHumanExecution(input: {
  tx: AdvanceTx;
  tenantId: string;
  userId: string;
  execution: { id: string; agent: string; status: string; provenance: unknown };
  task: { id: string; provenance: unknown };
  review: { id: string; reviewRequestId: string };
  human: { id: string; decision: JuryDecision };
  juryDecision: JuryDecision;
  taskType: 'VERIFICATION' | 'REWORD';
  adapter: AgentAdapter;
}): Promise<
  | {
      ok: true;
      adapterCalled: boolean;
      reviewId: string;
      agentExecutionId: string;
      status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'BLOCKED';
      agent: string;
      result: HumanExecutionResult | null;
    }
  | { ok: false; reason: 'ALREADY_RUNNING' | 'NOT_FOUND'; adapterCalled: false }
> {
  const { tx, execution, task, review, human, taskType, juryDecision, adapter } = input;
  const stored = readResult(execution.provenance);
  if (execution.status === 'COMPLETED') return done(review.id, execution.id, 'COMPLETED', execution.agent, false, stored);
  if (execution.status === 'RUNNING') return { ok: false, reason: 'ALREADY_RUNNING', adapterCalled: false };
  if (execution.status === 'BLOCKED') return done(review.id, execution.id, 'BLOCKED', execution.agent, false, null);
  if (execution.status !== 'PENDING') return { ok: false, reason: 'NOT_FOUND', adapterCalled: false };
  const started = new Date();
  const claimed = await tx.juryAgentExecution.updateMany({
    where: { id: execution.id, tenantId: input.tenantId, status: 'PENDING' },
    data: { status: 'RUNNING', startedAt: started, updatedAt: started },
  });
  if (claimed.count !== 1) return { ok: false, reason: 'ALREADY_RUNNING', adapterCalled: false };
  await tx.juryAuditEvent.create({
    data: auditData(input.tenantId, input.userId, execution.id, task.id, review, human.id, human.decision, taskType, 'RUNNING', started, HUMAN_EXECUTION_STARTED),
  });
  const controller = new AbortController();
  let adapterResult: AgentAdapterResult;
  try {
    adapterResult = await adapter.run({
      executionId: execution.id,
      workspaceRef: { type: 'PROJECT', ref: 'jury-product' },
      workspaceRoot: '',
      inputSnapshot: task.provenance as Parameters<AgentAdapter['run']>[0]['inputSnapshot'],
      instruction: '',
      signal: controller.signal,
    });
  } catch {
    adapterResult = { ok: false, errorCode: 'AGENT_EXECUTION_FAILED', message: 'adapter failed' };
  } finally {
    controller.abort();
  }
  if (!adapterResult.ok || containsSecret(adapterResult)) {
    const blockedAt = new Date();
    await tx.juryAgentExecution.updateMany({
      where: { id: execution.id, tenantId: input.tenantId, status: 'RUNNING' },
      data: {
        status: 'BLOCKED',
        errorCode: adapterResult.ok ? 'CREDENTIAL_DATA_DETECTED' : adapterResult.errorCode,
        finishedAt: blockedAt,
        updatedAt: blockedAt,
      },
    });
    return done(review.id, execution.id, 'BLOCKED', execution.agent, true, null);
  }
  if (!safeFiles(adapterResult.changedFiles)) {
    const blockedAt = new Date();
    await tx.juryAgentExecution.updateMany({
      where: { id: execution.id, tenantId: input.tenantId, status: 'RUNNING' },
      data: { status: 'BLOCKED', errorCode: 'WORKSPACE_EXECUTION_FAILED', finishedAt: blockedAt, updatedAt: blockedAt },
    });
    return done(review.id, execution.id, 'BLOCKED', execution.agent, true, null);
  }
  const result: HumanExecutionResult = {
    summary: adapterResult.summary,
    changedFiles: adapterResult.changedFiles,
    testsRun: adapterResult.testsRun,
    testsPassed: adapterResult.testsPassed,
  };
  if (containsSecret(result)) {
    const blockedAt = new Date();
    await tx.juryAgentExecution.updateMany({
      where: { id: execution.id, tenantId: input.tenantId, status: 'RUNNING' },
      data: { status: 'BLOCKED', errorCode: 'CREDENTIAL_DATA_DETECTED', finishedAt: blockedAt, updatedAt: blockedAt },
    });
    return done(review.id, execution.id, 'BLOCKED', execution.agent, true, null);
  }
  const finished = new Date();
  const completed = await tx.juryAgentExecution.updateMany({
    where: { id: execution.id, tenantId: input.tenantId, status: 'RUNNING' },
    data: {
      status: 'COMPLETED',
      finishedAt: finished,
      updatedAt: finished,
      errorCode: null,
      provenance: {
        kind: 'human-agent-execution',
        reviewRequestId: review.reviewRequestId,
        reviewResultId: review.id,
        humanDecisionId: human.id,
        improvementTaskId: task.id,
        humanDecision: human.decision,
        juryDecision,
        taskType,
        result,
      },
    },
  });
  if (completed.count !== 1) throw new Error('EXECUTION_NOT_COMPLETED');
  await tx.juryAuditEvent.create({
    data: auditData(input.tenantId, input.userId, execution.id, task.id, review, human.id, human.decision, taskType, 'COMPLETED', finished, HUMAN_EXECUTION_COMPLETED),
  });
  return done(review.id, execution.id, 'COMPLETED', execution.agent, true, result);
}

function done(
  reviewId: string,
  agentExecutionId: string,
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'BLOCKED',
  agent: string,
  adapterCalled: boolean,
  result: HumanExecutionResult | null,
) {
  return { ok: true as const, adapterCalled, reviewId, agentExecutionId, status, agent, result };
}

function auditData(
  tenantId: string,
  actorUserId: string,
  agentExecutionId: string,
  improvementTaskId: string,
  review: { id: string; reviewRequestId: string },
  humanDecisionId: string,
  humanDecision: JuryDecision,
  taskType: 'VERIFICATION' | 'REWORD',
  status: string,
  at: Date,
  action: string,
): Prisma.JuryAuditEventUncheckedCreateInput {
  return {
    id: sha([tenantId, action, agentExecutionId]),
    tenantId,
    timestamp: at,
    actor: actorUserId,
    action,
    reviewId: review.id,
    decision: humanDecision,
    improvementTaskId,
    agent: 'CURSOR',
    agentExecutionId,
    provenance: {
      kind: 'human-agent-execution',
      reviewRequestId: review.reviewRequestId,
      reviewResultId: review.id,
      humanDecisionId,
      improvementTaskId,
      agentExecutionId,
      humanDecision,
      taskType,
      status,
    },
  };
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

function readResult(value: unknown): HumanExecutionResult | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const result = (value as { result?: unknown }).result;
  if (!result || typeof result !== 'object' || Array.isArray(result)) return null;
  const row = result as { summary?: unknown; changedFiles?: unknown; testsRun?: unknown; testsPassed?: unknown };
  if (typeof row.summary !== 'string' || !Array.isArray(row.changedFiles) || !Array.isArray(row.testsRun)) return null;
  if (row.changedFiles.some((item) => typeof item !== 'string') || row.testsRun.some((item) => typeof item !== 'string')) return null;
  if (row.testsPassed != null && typeof row.testsPassed !== 'boolean') return null;
  const parsed: HumanExecutionResult = {
    summary: row.summary,
    changedFiles: row.changedFiles as string[],
    testsRun: row.testsRun as string[],
    testsPassed: typeof row.testsPassed === 'boolean' ? row.testsPassed : null,
  };
  if (containsSecret(parsed)) return null;
  return parsed;
}

function safeFiles(files: string[]): boolean {
  return files.every((file) =>
    file.length > 0
    && file.length <= 200
    && !file.includes('..')
    && !file.startsWith('/')
    && !file.startsWith('\\')
    && !/^[a-zA-Z]:/.test(file)
    && !file.includes('\\'),
  );
}

function oneOf<T extends string>(values: readonly T[], value: string): T | null {
  return (values as readonly string[]).includes(value) ? (value as T) : null;
}

function sha(parts: readonly string[]): string {
  return createHash('sha256').update(parts.join('\n')).digest('hex');
}
