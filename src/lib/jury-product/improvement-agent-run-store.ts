/**
 * Runs the existing handoff store and execution store for one improvement task.
 * The caller supplies the adapter. This store does not spawn Cursor or open Change Gate.
 */
import { Prisma } from '@prisma/client';
import { persistAgentHandoff } from './agent-handoff-store';
import { persistAgentExecution } from './agent-execution-store';
import type { AgentAdapter } from './agents/agent-adapter';
import { containsSecret } from './agent-execution';
import { workspaceForImprovementTask } from './improvement-agent-run';
import type { JuryMembership } from './records';

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

export async function persistImprovementAgentRun(input: {
  userId: string | null;
  memberships: readonly JuryMembership[];
  clientTenantId?: string | null;
  now: string;
  clock?: () => string;
  timeoutMs?: number;
  improvementTaskId: string;
  adapter: AgentAdapter;
}) {
  const { prisma } = await import('@/lib/prisma');
  const row = await prisma.juryImprovementTask.findUnique({ where: { id: input.improvementTaskId } });
  if (!row) return { ok: false as const, reason: 'IMPROVEMENT_TASK_NOT_FOUND' as const, execution: null, adapterCalled: false };
  if (containsSecret({ objective: row.objective, description: row.description, constraints: row.constraints, provenance: row.provenance })) {
    return { ok: false as const, reason: 'CREDENTIAL_DATA_DETECTED' as const, execution: null, adapterCalled: false };
  }
  const workspaceRef = workspaceForImprovementTask(row.provenance);
  if (!workspaceRef) return { ok: false as const, reason: 'WORKSPACE_REF_INVALID' as const, execution: null, adapterCalled: false };
  const handoff = await handoffWithRetry(input, workspaceRef);
  if (!handoff.ok) return { ok: false as const, reason: handoff.reason, execution: null, adapterCalled: false };
  if (handoff.execution.status !== 'PENDING') {
    return { ok: false as const, reason: 'EXECUTION_NOT_PENDING' as const, execution: handoff.execution, adapterCalled: false };
  }
  return persistAgentExecution({
    userId: input.userId,
    memberships: input.memberships,
    clientTenantId: input.clientTenantId,
    now: input.now,
    clock: input.clock,
    timeoutMs: input.timeoutMs,
    executionId: handoff.execution.id,
    adapter: input.adapter,
  });
}

async function handoffWithRetry(
  input: {
    userId: string | null;
    memberships: readonly JuryMembership[];
    clientTenantId?: string | null;
    now: string;
    improvementTaskId: string;
  },
  workspaceRef: { type: 'PROJECT'; ref: string },
) {
  try {
    return await persistAgentHandoff({
      userId: input.userId,
      memberships: input.memberships,
      clientTenantId: input.clientTenantId,
      now: input.now,
      improvementTaskId: input.improvementTaskId,
      agentType: 'CURSOR',
      workspaceRef,
    });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    return persistAgentHandoff({
      userId: input.userId,
      memberships: input.memberships,
      clientTenantId: input.clientTenantId,
      now: input.now,
      improvementTaskId: input.improvementTaskId,
      agentType: 'CURSOR',
      workspaceRef,
    });
  }
}
