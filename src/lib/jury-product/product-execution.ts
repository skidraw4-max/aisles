/**
 * Runs one product execution in three committed steps.
 * Claim marks RUNNING and commits. The adapter runs after that commit.
 * Completion then stores COMPLETED or BLOCKED.
 */
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { decideJuryMutation, resolveJuryActor } from './access';
import { parseWorkspaceRef } from './agent-handoff';
import { AGENT_TASK_INSTRUCTION, containsSecret } from './agent-execution';
import { resolveAllowedWorkspace } from './agent-workspace';
import type { AgentAdapter, AgentAdapterInput, AgentAdapterResult } from './agents/agent-adapter';
import { agentAdapterFromConnector, cursorRunnerConnector, localAgentConnector, localRunnerConnector } from './agents/agent-connector';
import { HUMAN_HANDOFF_AGENT, HUMAN_HANDOFF_WORKSPACE } from './human-agent-handoff';
import { JURY_INTERACTIVE_TRANSACTION, notePersistenceFailure } from './persistence-diagnostic';
import {
  HUMAN_EXECUTION_COMPLETED,
  HUMAN_EXECUTION_STARTED,
  type HumanExecutionFailure,
  type HumanExecutionResult,
} from './human-agent-execution';
import { HUMAN_IMPROVEMENT_KIND, humanImprovementTaskType } from './human-improvement-bridge';
import { inspectionWorkspaceForProduct } from './product-inspection-workspace';
import { JURY_DECISIONS, type JuryDecision, type JuryMembership } from './records';
import type { JuryServicePermission } from './service-permission';

export type ProductExecutionFailure = HumanExecutionFailure | 'REVIEW_NOT_COMPLETED' | 'SNAPSHOT_UNSAFE';

type ProductExecutionView = {
  ok: true;
  adapterCalled: boolean;
  reviewId: string;
  agentExecutionId: string;
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'BLOCKED';
  agent: string;
  result: HumanExecutionResult | null;
};

type ProductClaim =
  | { ok: false; reason: ProductExecutionFailure; adapterCalled: false }
  | (ProductExecutionView & { claimed: false })
  | {
      ok: true;
      claimed: true;
      reviewId: string;
      agentExecutionId: string;
      agent: string;
      workspaceRoot: string;
      inputSnapshot: unknown;
      handoffSnapshot: unknown;
      audit: ProductAuditContext;
    };

type ProductAuditContext = {
  tenantId: string;
  userId: string;
  reviewResultId: string;
  reviewRequestId: string;
  humanDecisionId: string;
  humanDecision: JuryDecision;
  juryDecision: JuryDecision;
  taskId: string;
  taskType: 'VERIFICATION' | 'REWORD';
};

export async function executeProductAgentExecution(input: {
  userId: string | null;
  memberships: readonly JuryMembership[];
  agentExecutionId: string;
  clientTenantId?: string | null;
  adapter?: AgentAdapter;
  useCursorConnector?: boolean;
  /** Server-resolved grant. Omitted callers keep the existing role check. */
  servicePermissions?: readonly JuryServicePermission[];
}): Promise<ProductExecutionView | { ok: false; reason: ProductExecutionFailure; adapterCalled: false }> {
  const claimed = await claimProductAgentExecution(input);
  if (!claimed.ok) return claimed;
  if (!claimed.claimed) {
    return {
      ok: true,
      adapterCalled: false,
      reviewId: claimed.reviewId,
      agentExecutionId: claimed.agentExecutionId,
      status: claimed.status,
      agent: claimed.agent,
      result: claimed.result,
    };
  }
  const adapter = productAgentAdapter(input.adapter, input.useCursorConnector === true);
  const controller = new AbortController();
  let adapterResult: AgentAdapterResult;
  try {
    adapterResult = await adapter.run({
      executionId: claimed.agentExecutionId,
      workspaceRef: { type: 'PROJECT', ref: 'jury-product' },
      workspaceRoot: claimed.workspaceRoot,
      inputSnapshot: claimed.inputSnapshot as AgentAdapterInput['inputSnapshot'],
      instruction: input.useCursorConnector ? buildProductCursorInstruction(claimed.handoffSnapshot) : '',
      signal: controller.signal,
    });
  } catch {
    adapterResult = { ok: false, errorCode: 'AGENT_EXECUTION_FAILED', message: 'adapter failed' };
  } finally {
    controller.abort();
  }
  try {
    const finished = await completeProductAgentExecution({
      userId: input.userId,
      memberships: input.memberships,
      agentExecutionId: claimed.agentExecutionId,
      result: adapterResult,
      servicePermissions: input.servicePermissions,
    });
    if (finished.ok) return { ...finished, adapterCalled: true };
    return finished;
  } catch {
    return { ok: false, reason: 'PERSISTENCE_FAILED', adapterCalled: false };
  }
}

export async function claimProductAgentExecution(input: {
  userId: string | null;
  memberships: readonly JuryMembership[];
  agentExecutionId: string;
  clientTenantId?: string | null;
  servicePermissions?: readonly JuryServicePermission[];
}): Promise<ProductClaim> {
  void input.clientTenantId;
  const actor = resolveJuryActor({ userId: input.userId, memberships: input.memberships, clientTenantId: null });
  if (!actor.ok) return { ok: false, reason: actor.reason, adapterCalled: false };
  if (!input.agentExecutionId.trim()) return { ok: false, reason: 'NOT_FOUND', adapterCalled: false };
  const allowed = decideJuryMutation({
    actor,
    action: 'agent.execute',
    resourceTenantId: actor.tenantId,
    clientTenantId: null,
    servicePermissions: input.servicePermissions,
  });
  if (!allowed.ok) return { ok: false, reason: 'FORBIDDEN', adapterCalled: false };
  const { prisma } = await import('@/lib/prisma');
  const execution = await prisma.juryAgentExecution.findFirst({
    where: { id: input.agentExecutionId, tenantId: actor.tenantId },
    select: productExecutionSelect,
  });
  const task = execution?.task?.tenantId === actor.tenantId ? execution.task : null;
  const review = task?.reviewResult?.tenantId === actor.tenantId ? task.reviewResult : null;
  const request = review?.request?.tenantId === actor.tenantId ? review.request : null;
  const evidence = request?.evidence;
  const connection = request?.connection;
  if (
    !execution
    || execution.tenantId !== actor.tenantId
    || execution.agent !== HUMAN_HANDOFF_AGENT
    || !productWorkspace(execution.workspaceRef)
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
    return { ok: false, reason: 'NOT_FOUND', adapterCalled: false };
  }
  if (!productTaskProvenance(task.provenance, review.id)) {
    return { ok: false, reason: 'HUMAN_APPROVAL_REQUIRED', adapterCalled: false };
  }
  if (execution.status === 'PENDING' && request.status !== 'COMPLETED') {
    return { ok: false, reason: 'REVIEW_NOT_COMPLETED', adapterCalled: false };
  }
  const decision = review.humanDecision?.decision;
  const humanDecision = decision === 'VERIFY' || decision === 'REWORD' || decision === 'ACCEPT' ? decision : null;
  const taskType = humanDecision && humanDecision !== 'ACCEPT' ? humanImprovementTaskType(humanDecision) : null;
  const juryDecision = oneOf(JURY_DECISIONS, review.expectedDecision);
  if (execution.status === 'PENDING' && (!taskType || !humanDecision || !juryDecision || task.taskType !== taskType || !review.humanDecision)) {
    return { ok: false, reason: 'HUMAN_APPROVAL_REQUIRED', adapterCalled: false };
  }
  if (execution.status === 'PENDING' && (containsSecret(execution.inputSnapshot) || containsSecret(execution.provenance))) {
    return { ok: false, reason: 'SNAPSHOT_UNSAFE', adapterCalled: false };
  }
  try {
    return await prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>(
        Prisma.sql`SELECT id FROM "JuryAgentExecution" WHERE id = ${execution.id} AND "tenantId" = ${actor.tenantId} FOR UPDATE`,
      );
      if (!locked[0]) return { ok: false as const, reason: 'NOT_FOUND' as const, adapterCalled: false as const };
      const current = await tx.juryAgentExecution.findFirst({
        where: { id: execution.id, tenantId: actor.tenantId },
        select: { id: true, status: true, agent: true, provenance: true },
      });
      if (!current || current.agent !== HUMAN_HANDOFF_AGENT) {
        return { ok: false as const, reason: 'NOT_FOUND' as const, adapterCalled: false as const };
      }
      if (current.status === 'COMPLETED' || current.status === 'BLOCKED') {
        return {
          ok: true as const,
          claimed: false as const,
          adapterCalled: false as const,
          reviewId: review.id,
          agentExecutionId: current.id,
          status: current.status,
          agent: current.agent,
          result: current.status === 'COMPLETED' ? readStoredResult(current.provenance) : null,
        };
      }
      if (current.status === 'RUNNING') return { ok: false as const, reason: 'ALREADY_RUNNING' as const, adapterCalled: false as const };
      if (current.status !== 'PENDING' || !taskType || !humanDecision || !juryDecision || !review.humanDecision) {
        return { ok: false as const, reason: 'NOT_FOUND' as const, adapterCalled: false as const };
      }
      const started = new Date();
      const updated = await tx.juryAgentExecution.updateMany({
        where: { id: current.id, tenantId: actor.tenantId, status: 'PENDING' },
        data: { status: 'RUNNING', startedAt: started, updatedAt: started },
      });
      if (updated.count !== 1) return { ok: false as const, reason: 'ALREADY_RUNNING' as const, adapterCalled: false as const };
      await tx.juryAuditEvent.create({
        data: productAudit({
          tenantId: actor.tenantId,
          userId: actor.userId,
          reviewResultId: review.id,
          reviewRequestId: review.reviewRequestId,
          humanDecisionId: review.humanDecision.id,
          humanDecision,
          juryDecision,
          taskId: task.id,
          taskType,
        }, current.id, 'RUNNING', started, HUMAN_EXECUTION_STARTED),
      });
      return {
        ok: true as const,
        claimed: true as const,
        reviewId: review.id,
        agentExecutionId: current.id,
        agent: current.agent,
        workspaceRoot: productAgentWorkspaceRoot(execution.workspaceRef),
        inputSnapshot: task.provenance,
        handoffSnapshot: execution.inputSnapshot,
        audit: {
          tenantId: actor.tenantId,
          userId: actor.userId,
          reviewResultId: review.id,
          reviewRequestId: review.reviewRequestId,
          humanDecisionId: review.humanDecision.id,
          humanDecision,
          juryDecision,
          taskId: task.id,
          taskType,
        },
      };
    }, JURY_INTERACTIVE_TRANSACTION);
  } catch (error) {
    notePersistenceFailure('execution.claim', error);
    return { ok: false, reason: 'PERSISTENCE_FAILED', adapterCalled: false };
  }
}

export async function completeProductAgentExecution(input: {
  userId: string | null;
  memberships: readonly JuryMembership[];
  agentExecutionId: string;
  result: AgentAdapterResult;
  servicePermissions?: readonly JuryServicePermission[];
}): Promise<ProductExecutionView | { ok: false; reason: ProductExecutionFailure; adapterCalled: false }> {
  const actor = resolveJuryActor({ userId: input.userId, memberships: input.memberships, clientTenantId: null });
  if (!actor.ok) return { ok: false, reason: actor.reason, adapterCalled: false };
  if (!input.agentExecutionId.trim()) return { ok: false, reason: 'NOT_FOUND', adapterCalled: false };
  const allowed = decideJuryMutation({
    actor,
    action: 'agent.execute',
    resourceTenantId: actor.tenantId,
    clientTenantId: null,
    servicePermissions: input.servicePermissions,
  });
  if (!allowed.ok) return { ok: false, reason: 'FORBIDDEN', adapterCalled: false };
  const { prisma } = await import('@/lib/prisma');
  try {
    return await prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>(
        Prisma.sql`SELECT id FROM "JuryAgentExecution" WHERE id = ${input.agentExecutionId} AND "tenantId" = ${actor.tenantId} FOR UPDATE`,
      );
      if (!locked[0]) return { ok: false as const, reason: 'NOT_FOUND' as const, adapterCalled: false as const };
      const execution = await tx.juryAgentExecution.findFirst({
        where: { id: input.agentExecutionId, tenantId: actor.tenantId },
        select: productExecutionSelect,
      });
      const task = execution?.task?.tenantId === actor.tenantId ? execution.task : null;
      const review = task?.reviewResult?.tenantId === actor.tenantId ? task.reviewResult : null;
      const human = review?.humanDecision;
      const humanDecision = human && (human.decision === 'VERIFY' || human.decision === 'REWORD' || human.decision === 'ACCEPT') ? human.decision : null;
      const juryDecision = review ? oneOf(JURY_DECISIONS, review.expectedDecision) : null;
      const taskType = task?.taskType === 'VERIFICATION' || task?.taskType === 'REWORD' ? task.taskType : null;
      if (
        !execution
        || execution.agent !== HUMAN_HANDOFF_AGENT
        || !task
        || !review
        || !human
        || !humanDecision
        || !juryDecision
        || !taskType
        || !productExecutionProvenance(execution.provenance, task.id)
      ) {
        return { ok: false as const, reason: 'NOT_FOUND' as const, adapterCalled: false as const };
      }
      if (execution.status === 'COMPLETED' || execution.status === 'BLOCKED') {
        return {
          ok: true as const,
          adapterCalled: false as const,
          reviewId: review.id,
          agentExecutionId: execution.id,
          status: execution.status,
          agent: execution.agent,
          result: execution.status === 'COMPLETED' ? readStoredResult(execution.provenance) : null,
        };
      }
      if (execution.status !== 'RUNNING') return { ok: false as const, reason: 'NOT_FOUND' as const, adapterCalled: false as const };
      const outcome = storedOutcome(input.result);
      const finished = new Date();
      if (!outcome.ok) {
        const blocked = await tx.juryAgentExecution.updateMany({
          where: { id: execution.id, tenantId: actor.tenantId, status: 'RUNNING' },
          data: { status: 'BLOCKED', errorCode: outcome.errorCode, finishedAt: finished, updatedAt: finished },
        });
        if (blocked.count !== 1) return terminalAfterRace(tx, execution.id, actor.tenantId, review.id);
        return {
          ok: true as const,
          adapterCalled: true as const,
          reviewId: review.id,
          agentExecutionId: execution.id,
          status: 'BLOCKED' as const,
          agent: execution.agent,
          result: null,
        };
      }
      const completed = await tx.juryAgentExecution.updateMany({
        where: { id: execution.id, tenantId: actor.tenantId, status: 'RUNNING' },
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
            humanDecision,
            juryDecision,
            taskType,
            result: outcome.result,
          },
        },
      });
      if (completed.count !== 1) return terminalAfterRace(tx, execution.id, actor.tenantId, review.id);
      await tx.juryAuditEvent.create({
        data: productAudit({
          tenantId: actor.tenantId,
          userId: actor.userId,
          reviewResultId: review.id,
          reviewRequestId: review.reviewRequestId,
          humanDecisionId: human.id,
          humanDecision,
          juryDecision,
          taskId: task.id,
          taskType,
        }, execution.id, 'COMPLETED', finished, HUMAN_EXECUTION_COMPLETED),
      });
      return {
        ok: true as const,
        adapterCalled: true as const,
        reviewId: review.id,
        agentExecutionId: execution.id,
        status: 'COMPLETED' as const,
        agent: execution.agent,
        result: outcome.result,
      };
    }, JURY_INTERACTIVE_TRANSACTION);
  } catch (error) {
    notePersistenceFailure('execution.complete', error);
    return { ok: false, reason: 'PERSISTENCE_FAILED', adapterCalled: false };
  }
}

function productAgentAdapter(adapter: AgentAdapter | undefined, useCursorConnector: boolean): AgentAdapter {
  if (adapter) return agentAdapterFromConnector(localAgentConnector(adapter));
  if (useCursorConnector) return agentAdapterFromConnector(cursorRunnerConnector());
  return agentAdapterFromConnector(localRunnerConnector());
}

export function buildProductCursorInstruction(snapshot: unknown): string {
  const row = snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot) ? snapshot as Record<string, unknown> : {};
  const diagnosis = typeof row.diagnosis === 'string' ? row.diagnosis : '';
  const criteria = Array.isArray(row.acceptanceCriteria)
    ? row.acceptanceCriteria.filter((item): item is string => typeof item === 'string')
    : [];
  return [
    AGENT_TASK_INSTRUCTION,
    '',
    `diagnosis: ${diagnosis}`,
    'acceptance criteria:',
    ...criteria.map((item) => `- ${item}`),
  ].join('\n');
}

const productExecutionSelect = {
  id: true,
  tenantId: true,
  taskId: true,
  agent: true,
  status: true,
  inputSnapshot: true,
  workspaceRef: true,
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
              status: true,
              evidenceId: true,
              connectionId: true,
              evidence: { select: { id: true, tenantId: true, connectionId: true } },
              connection: { select: { id: true, tenantId: true } },
            },
          },
          humanDecision: { select: { id: true, decision: true } },
        },
      },
    },
  },
} as const;

function productAudit(
  context: ProductAuditContext,
  agentExecutionId: string,
  status: string,
  at: Date,
  action: string,
): Prisma.JuryAuditEventUncheckedCreateInput {
  return {
    id: sha([context.tenantId, action, agentExecutionId]),
    tenantId: context.tenantId,
    timestamp: at,
    actor: context.userId,
    action,
    reviewId: context.reviewResultId,
    decision: context.humanDecision,
    improvementTaskId: context.taskId,
    agent: HUMAN_HANDOFF_AGENT,
    agentExecutionId,
    provenance: {
      kind: 'human-agent-execution',
      reviewRequestId: context.reviewRequestId,
      reviewResultId: context.reviewResultId,
      humanDecisionId: context.humanDecisionId,
      improvementTaskId: context.taskId,
      agentExecutionId,
      humanDecision: context.humanDecision,
      taskType: context.taskType,
      status,
    },
  };
}

async function terminalAfterRace(
  tx: Prisma.TransactionClient,
  executionId: string,
  tenantId: string,
  reviewId: string,
): Promise<ProductExecutionView | { ok: false; reason: 'ALREADY_RUNNING'; adapterCalled: false }> {
  const current = await tx.juryAgentExecution.findFirst({
    where: { id: executionId, tenantId },
    select: { id: true, status: true, agent: true, provenance: true },
  });
  if (current?.status === 'COMPLETED' || current?.status === 'BLOCKED') {
    return {
      ok: true,
      adapterCalled: false,
      reviewId,
      agentExecutionId: current.id,
      status: current.status,
      agent: current.agent,
      result: current.status === 'COMPLETED' ? readStoredResult(current.provenance) : null,
    };
  }
  return { ok: false, reason: 'ALREADY_RUNNING', adapterCalled: false };
}

function storedOutcome(result: AgentAdapterResult): { ok: true; result: HumanExecutionResult } | { ok: false; errorCode: string } {
  if (!result.ok || containsSecret(result)) {
    return { ok: false, errorCode: result.ok ? 'CREDENTIAL_DATA_DETECTED' : result.errorCode };
  }
  if (!safeFiles(result.changedFiles) || containsSecret(result.changedFiles) || containsSecret(result.summary)) {
    return { ok: false, errorCode: 'WORKSPACE_EXECUTION_FAILED' };
  }
  const stored: HumanExecutionResult = {
    summary: result.summary,
    changedFiles: result.changedFiles,
    testsRun: result.testsRun,
    testsPassed: result.testsPassed,
  };
  if (containsSecret(stored)) return { ok: false, errorCode: 'CREDENTIAL_DATA_DETECTED' };
  return { ok: true, result: stored };
}

function productAgentWorkspaceRoot(workspaceRef: unknown): string {
  const lineage = parseWorkspaceRef(workspaceRef);
  const inspection = lineage ? inspectionWorkspaceForProduct(lineage) : null;
  return inspection ? resolveAllowedWorkspace(inspection) ?? '' : '';
}

export async function loadProductExecutionSummaries(tenantId: string): Promise<Record<string, string>> {
  const { prisma } = await import('@/lib/prisma');
  const rows = await prisma.juryAgentExecution.findMany({
    where: { tenantId, status: 'COMPLETED' },
    select: { taskId: true, provenance: true },
  });
  const summaries: Record<string, string> = {};
  for (const row of rows) {
    const summary = readSummary(row.provenance);
    if (summary && !containsSecret(summary)) summaries[row.taskId] = summary;
  }
  return summaries;
}

function productWorkspace(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as { type?: unknown; ref?: unknown };
  return row.type === HUMAN_HANDOFF_WORKSPACE.type && row.ref === HUMAN_HANDOFF_WORKSPACE.ref;
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

function readStoredResult(value: unknown): HumanExecutionResult | null {
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

function readSummary(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const result = (value as { result?: unknown }).result;
  if (!result || typeof result !== 'object' || Array.isArray(result)) return null;
  const summary = (result as { summary?: unknown }).summary;
  return typeof summary === 'string' && summary.trim().length > 0 ? summary : null;
}
