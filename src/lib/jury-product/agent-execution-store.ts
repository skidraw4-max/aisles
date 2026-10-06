/**
 * Persists one agent execution. It does not start Cursor unless the caller passes that adapter.
 */
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { Prisma } from '@prisma/client';
import type { AgentExecutionDraft, HandoffProvenance, HandoffSnapshot, HandoffTask, WorkspaceRef } from './agent-handoff';
import {
  DEFAULT_AGENT_TIMEOUT_MS,
  containsSecret,
  executeAgent,
  type ExecuteCommand,
  type ExecutionWriteTx,
} from './agent-execution';
import type { AgentAdapter } from './agents/agent-adapter';
import type { JuryMembership } from './records';

type ExecuteOutcome = Awaited<ReturnType<typeof executeAgent>>;

export async function persistAgentExecution(input: {
  userId: string | null;
  memberships: readonly JuryMembership[];
  clientTenantId?: string | null;
  now: string;
  clock?: () => string;
  timeoutMs?: number;
  executionId: string;
  adapter: AgentAdapter;
}): Promise<ExecuteOutcome> {
  const { prisma } = await import('@/lib/prisma');
  const { resolveJuryActor } = await import('./access');
  const actor = resolveJuryActor({
    userId: input.userId,
    memberships: input.memberships,
    clientTenantId: input.clientTenantId,
  });
  if (!actor.ok) return actor;
  const row = await prisma.juryAgentExecution.findUnique({ where: { id: input.executionId } });
  const task = row ? await prisma.juryImprovementTask.findUnique({ where: { id: row.taskId } }) : null;
  const cycles = await prisma.juryDecisionCycle.findMany({
    where: { tenantId: actor.tenantId },
    select: { status: true },
  });
  const command: ExecuteCommand = {
    userId: input.userId,
    memberships: input.memberships,
    clientTenantId: input.clientTenantId,
    now: input.now,
    clock: input.clock,
    timeoutMs: resolveTimeout(input.timeoutMs),
    loopGuardBlocked: cycles.some((cycle) => cycle.status === 'BLOCKED'),
    execution: row ? mapExecution(row) : null,
    task: task ? mapTask(task) : null,
  };
  return executeAgent(command, input.adapter, prismaTx(prisma, row?.tenantId ?? actor.tenantId, input.userId));
}

function resolveTimeout(explicit: number | undefined): number {
  if (explicit != null && Number.isFinite(explicit) && explicit > 0) return Math.min(explicit, 30 * 60 * 1000);
  const parsed = Number(process.env.JURY_AGENT_EXECUTION_TIMEOUT_MS);
  if (Number.isFinite(parsed) && parsed > 0) return Math.min(parsed, 30 * 60 * 1000);
  return DEFAULT_AGENT_TIMEOUT_MS;
}

function prismaTx(
  prisma: {
    juryAgentExecution: {
      updateMany(args: {
        where: { id: string; tenantId: string; status: 'PENDING' | 'RUNNING' };
        data: Prisma.JuryAgentExecutionUpdateManyMutationInput;
      }): Promise<{ count: number }>;
    };
    juryAuditEvent: {
      create(args: { data: Prisma.JuryAuditEventUncheckedCreateInput }): Promise<unknown>;
    };
  },
  tenantId: string,
  userId: string | null,
): ExecutionWriteTx {
  return {
    async claimRunning(id, at) {
      const result = await prisma.juryAgentExecution.updateMany({
        where: { id, tenantId, status: 'PENDING' },
        data: { status: 'RUNNING', startedAt: new Date(at), updatedAt: new Date(at) },
      });
      return result.count === 1;
    },
    async blockPending(id, errorCode, at) {
      const result = await prisma.juryAgentExecution.updateMany({
        where: { id, tenantId, status: 'PENDING' },
        data: { status: 'BLOCKED', errorCode, finishedAt: new Date(at), updatedAt: new Date(at) },
      });
      return result.count === 1;
    },
    async completeRunning(id, resultRef, at) {
      const result = await prisma.juryAgentExecution.updateMany({
        where: { id, tenantId, status: 'RUNNING' },
        data: { status: 'COMPLETED', resultRef, errorCode: null, finishedAt: new Date(at), updatedAt: new Date(at) },
      });
      return result.count === 1;
    },
    async failRunning(id, errorCode, at) {
      const result = await prisma.juryAgentExecution.updateMany({
        where: { id, tenantId, status: 'RUNNING' },
        data: { status: 'BLOCKED', errorCode, finishedAt: new Date(at), updatedAt: new Date(at) },
      });
      return result.count === 1;
    },
    async audit(action, execution) {
      const provenance = {
        reviewResultId: execution.provenance.reviewResultId,
        decisionTaskId: execution.provenance.decisionTaskId,
        evidenceId: execution.provenance.evidenceId,
        sourceDecision: execution.provenance.sourceDecision,
        status: execution.status,
        agentType: execution.agent,
        errorCode: execution.errorCode,
        resultRef: execution.resultRef,
      };
      if (containsSecret(provenance)) return;
      await prisma.juryAuditEvent.create({
        data: {
          id: createHash('sha256').update([execution.id, action, execution.errorCode ?? ''].join('\n')).digest('hex'),
          tenantId: execution.tenantId,
          timestamp: new Date(execution.updatedAt),
          actor: userId ?? 'unknown',
          action,
          evidenceId: execution.provenance.evidenceId,
          reviewId: execution.provenance.reviewResultId,
          decision: 'REWORD',
          improvementTaskId: execution.taskId,
          agent: execution.agent,
          agentExecutionId: execution.id,
          provenance: provenance as Prisma.InputJsonValue,
        },
      });
    },
    async saveResult(artifact) {
      if (!/^[a-f0-9]{64}$/.test(artifact.executionId) || containsSecret(artifact)) {
        throw new Error('RESULT_REF');
      }
      const dir = 'data/jury-product/agent-executions';
      const ref = `${dir}/${artifact.executionId}.json`;
      await mkdir(dir, { recursive: true });
      await writeFile(ref, JSON.stringify(artifact), 'utf8');
      return ref;
    },
  };
}

function mapTask(row: {
  id: string;
  tenantId: string;
  reviewResultId: string;
  decisionTaskId: string | null;
  evidenceId: string | null;
  taskType: string | null;
  title: string | null;
  description: string | null;
  reason: string | null;
  objective: string | null;
  constraints: unknown;
  status: string;
  provenance: unknown;
}): HandoffTask {
  return {
    id: row.id,
    tenantId: row.tenantId,
    reviewResultId: row.reviewResultId,
    decisionTaskId: row.decisionTaskId ?? '',
    evidenceId: row.evidenceId ?? '',
    taskType: row.taskType ?? '',
    title: row.title ?? '',
    description: row.description ?? '',
    reason: row.reason ?? '',
    objective: row.objective ?? '',
    constraints: asStrings(row.constraints),
    status: row.status,
    provenance: asProvenance(row.provenance),
  };
}

function mapExecution(row: {
  id: string;
  tenantId: string;
  taskId: string;
  agent: string;
  status: string;
  allowedPaths: unknown;
  deniedPaths: unknown;
  startedAt: Date | null;
  finishedAt: Date | null;
  inputSnapshot: unknown;
  workspaceRef: unknown;
  requestedAt: Date | null;
  resultRef: string | null;
  errorCode: string | null;
  provenance: unknown;
  createdAt: Date | null;
  updatedAt: Date | null;
}): AgentExecutionDraft {
  const agent = row.agent === 'CURSOR' || row.agent === 'CLAUDE_CODE' || row.agent === 'OTHER' ? row.agent : 'OTHER';
  const status =
    row.status === 'PENDING' || row.status === 'RUNNING' || row.status === 'COMPLETED' || row.status === 'BLOCKED'
      ? row.status
      : 'BLOCKED';
  const snapshot = asSnapshot(row.inputSnapshot);
  const workspace = asWorkspace(row.workspaceRef) ?? { type: 'PROJECT' as const, ref: 'missing' };
  const provenance = asProvenance(row.provenance) ?? emptyProvenance();
  const secret = containsSecret(row.inputSnapshot) || containsSecret(row.provenance);
  return {
    id: row.id,
    tenantId: row.tenantId,
    taskId: row.taskId,
    agent,
    status,
    inputSnapshot:
      snapshot && !secret
        ? snapshot
        : {
            ...emptySnapshot(workspace),
            description: secret ? 'credentialRef' : '',
            improvementTaskId: row.taskId,
          },
    workspaceRef: workspace,
    requestedAt: row.requestedAt?.toISOString() ?? '',
    startedAt: row.startedAt?.toISOString() ?? null,
    finishedAt: row.finishedAt?.toISOString() ?? null,
    resultRef: row.resultRef,
    errorCode: row.errorCode,
    provenance,
    allowedPaths: asStrings(row.allowedPaths),
    deniedPaths: asStrings(row.deniedPaths),
    createdAt: row.createdAt?.toISOString() ?? '',
    updatedAt: row.updatedAt?.toISOString() ?? '',
  };
}

function emptyProvenance(): HandoffProvenance {
  return {
    reviewResultId: '',
    decisionTaskId: '',
    evidenceId: '',
    sourceDecision: 'REWORD',
    comparator: {
      evidenceStrength: '',
      claimStrength: '',
      conflictDetected: false,
      overclaimDetected: false,
      revisionRequired: false,
      expectedDecision: 'REWORD',
    },
  };
}

function emptySnapshot(workspaceRef: WorkspaceRef): HandoffSnapshot {
  return {
    improvementTaskId: '',
    taskType: 'REWORD',
    title: '',
    description: '',
    reason: '',
    objective: '',
    constraints: [],
    evidenceId: '',
    reviewResultId: '',
    provenance: emptyProvenance(),
    workspaceRef,
  };
}

function asStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

function asWorkspace(value: unknown): WorkspaceRef | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as { type?: unknown; ref?: unknown };
  if (row.type !== 'PROJECT' || typeof row.ref !== 'string') return null;
  return { type: 'PROJECT', ref: row.ref };
}

function asProvenance(value: unknown): HandoffProvenance | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as {
    reviewResultId?: unknown;
    decisionTaskId?: unknown;
    evidenceId?: unknown;
    sourceDecision?: unknown;
    comparator?: {
      evidenceStrength?: unknown;
      claimStrength?: unknown;
      conflictDetected?: unknown;
      overclaimDetected?: unknown;
      revisionRequired?: unknown;
      expectedDecision?: unknown;
    };
  };
  if (
    typeof row.reviewResultId !== 'string' ||
    typeof row.decisionTaskId !== 'string' ||
    typeof row.evidenceId !== 'string' ||
    row.sourceDecision !== 'REWORD' ||
    !row.comparator ||
    typeof row.comparator.evidenceStrength !== 'string' ||
    typeof row.comparator.claimStrength !== 'string' ||
    row.comparator.expectedDecision !== 'REWORD'
  ) {
    return null;
  }
  return {
    reviewResultId: row.reviewResultId,
    decisionTaskId: row.decisionTaskId,
    evidenceId: row.evidenceId,
    sourceDecision: 'REWORD',
    comparator: {
      evidenceStrength: row.comparator.evidenceStrength,
      claimStrength: row.comparator.claimStrength,
      conflictDetected: row.comparator.conflictDetected === true,
      overclaimDetected: row.comparator.overclaimDetected === true,
      revisionRequired: row.comparator.revisionRequired === true,
      expectedDecision: 'REWORD',
    },
  };
}

function asSnapshot(value: unknown): HandoffSnapshot | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Partial<HandoffSnapshot>;
  const provenance = asProvenance(row.provenance);
  const workspaceRef = asWorkspace(row.workspaceRef);
  if (!provenance || !workspaceRef || row.taskType !== 'REWORD' || typeof row.improvementTaskId !== 'string') return null;
  if (typeof row.title !== 'string' || typeof row.description !== 'string' || typeof row.reason !== 'string') return null;
  if (typeof row.objective !== 'string' || typeof row.evidenceId !== 'string' || typeof row.reviewResultId !== 'string') {
    return null;
  }
  return {
    improvementTaskId: row.improvementTaskId,
    taskType: 'REWORD',
    title: row.title,
    description: row.description,
    reason: row.reason,
    objective: row.objective,
    constraints: asStrings(row.constraints),
    evidenceId: row.evidenceId,
    reviewResultId: row.reviewResultId,
    provenance,
    workspaceRef,
  };
}
