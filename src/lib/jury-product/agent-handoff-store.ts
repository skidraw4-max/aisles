/**
 * Stores a PENDING agent execution. It does not start the agent.
 */
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import type { JuryMembership } from './records';
import {
  handoffAgent,
  type AgentExecutionDraft,
  type HandoffAgent,
  type HandoffProvenance,
  type HandoffSnapshot,
  type HandoffTask,
  type HandoffWriteTx,
  type WorkspaceRef,
} from './agent-handoff';

type HandoffOutcome = Awaited<ReturnType<typeof handoffAgent>>;

export async function persistAgentHandoff(input: {
  userId: string | null;
  memberships: readonly JuryMembership[];
  clientTenantId?: string | null;
  now: string;
  improvementTaskId: string;
  agentType: string;
  workspaceRef: unknown;
}): Promise<HandoffOutcome> {
  const { prisma } = await import('@/lib/prisma');
  const { resolveJuryActor } = await import('./access');
  const actor = resolveJuryActor({
    userId: input.userId,
    memberships: input.memberships,
    clientTenantId: input.clientTenantId,
  });
  if (!actor.ok) return actor;
  const row = await prisma.juryImprovementTask.findUnique({ where: { id: input.improvementTaskId } });
  if (!row) return { ok: false, reason: 'IMPROVEMENT_TASK_NOT_FOUND' };
  return prisma.$transaction(async (tx) =>
    handoffAgent(
      {
        userId: input.userId,
        memberships: input.memberships,
        clientTenantId: input.clientTenantId,
        now: input.now,
        task: mapTask(row),
        agentType: input.agentType,
        workspaceRef: input.workspaceRef,
      },
      prismaTx(tx, input.userId),
    ),
  );
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

function prismaTx(
  tx: {
    juryAgentExecution: {
      findUnique(args: {
        where: { taskId_agent: { taskId: string; agent: HandoffAgent } };
      }): Promise<ExecutionRow | null>;
      create(args: { data: Prisma.JuryAgentExecutionUncheckedCreateInput }): Promise<unknown>;
    };
    juryAuditEvent: {
      create(args: { data: Prisma.JuryAuditEventUncheckedCreateInput }): Promise<unknown>;
    };
  },
  userId: string | null,
): HandoffWriteTx {
  return {
    async findByTaskAndAgent(taskId, agent) {
      const row = await tx.juryAgentExecution.findUnique({ where: { taskId_agent: { taskId, agent } } });
      return row ? mapExecution(row) : null;
    },
    async insert(execution) {
      await tx.juryAgentExecution.create({ data: executionData(execution) });
    },
    async audit(execution) {
      await tx.juryAuditEvent.create({
        data: {
          id: createHash('sha256').update([execution.id, 'AGENT_HANDOFF_CREATED'].join('\n')).digest('hex'),
          tenantId: execution.tenantId,
          timestamp: new Date(execution.requestedAt),
          actor: userId ?? 'unknown',
          action: 'AGENT_HANDOFF_CREATED',
          evidenceId: execution.provenance.evidenceId,
          reviewId: execution.provenance.reviewResultId,
          decision: 'REWORD',
          improvementTaskId: execution.taskId,
          agent: execution.agent,
          agentExecutionId: execution.id,
          provenance: {
            ...execution.provenance,
            status: execution.status,
            agentType: execution.agent,
          } as Prisma.InputJsonValue,
        },
      });
    },
  };
}

type ExecutionRow = {
  id: string;
  tenantId: string;
  taskId: string;
  agent: string;
  allowedPaths: unknown;
  deniedPaths: unknown;
  status: string;
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
};

function mapExecution(row: ExecutionRow): AgentExecutionDraft {
  const agent = row.agent === 'CURSOR' || row.agent === 'CLAUDE_CODE' || row.agent === 'OTHER' ? row.agent : null;
  const status =
    row.status === 'PENDING' || row.status === 'RUNNING' || row.status === 'COMPLETED' || row.status === 'BLOCKED'
      ? row.status
      : null;
  const snapshot = asSnapshot(row.inputSnapshot);
  const workspaceRef = asWorkspace(row.workspaceRef);
  const provenance = asProvenance(row.provenance);
  if (!agent || !status || !snapshot || !workspaceRef || !provenance || !row.requestedAt) {
    throw new Error('EXECUTION_SHAPE');
  }
  return {
    id: row.id,
    tenantId: row.tenantId,
    taskId: row.taskId,
    agent,
    status,
    inputSnapshot: snapshot,
    workspaceRef,
    requestedAt: row.requestedAt.toISOString(),
    startedAt: row.startedAt ? row.startedAt.toISOString() : null,
    finishedAt: row.finishedAt ? row.finishedAt.toISOString() : null,
    resultRef: row.resultRef,
    errorCode: row.errorCode,
    provenance,
    allowedPaths: asStrings(row.allowedPaths),
    deniedPaths: asStrings(row.deniedPaths),
    createdAt: row.createdAt?.toISOString() ?? row.requestedAt.toISOString(),
    updatedAt: row.updatedAt?.toISOString() ?? row.requestedAt.toISOString(),
  };
}

function executionData(execution: AgentExecutionDraft): Prisma.JuryAgentExecutionUncheckedCreateInput {
  return {
    id: execution.id,
    tenantId: execution.tenantId,
    taskId: execution.taskId,
    agent: execution.agent,
    allowedPaths: execution.allowedPaths,
    deniedPaths: execution.deniedPaths,
    status: 'PENDING',
    startedAt: null,
    finishedAt: null,
    inputSnapshot: execution.inputSnapshot as Prisma.InputJsonValue,
    workspaceRef: execution.workspaceRef as Prisma.InputJsonValue,
    requestedAt: new Date(execution.requestedAt),
    resultRef: null,
    errorCode: null,
    provenance: execution.provenance as Prisma.InputJsonValue,
    createdAt: new Date(execution.createdAt),
    updatedAt: new Date(execution.updatedAt),
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
