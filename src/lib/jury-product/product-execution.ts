/**
 * Runs one Phase 75 product execution through the existing human execution writer.
 * That writer claims PENDING, runs FakeCursorAdapter, and stores COMPLETED or BLOCKED.
 */
import { decideJuryMutation, resolveJuryActor } from './access';
import { containsSecret } from './agent-execution';
import type { AgentAdapter } from './agents/agent-adapter';
import { HUMAN_HANDOFF_AGENT, HUMAN_HANDOFF_WORKSPACE } from './human-agent-handoff';
import { executeHumanAgentExecution, type HumanExecutionFailure } from './human-agent-execution';
import { HUMAN_IMPROVEMENT_KIND, humanImprovementTaskType } from './human-improvement-bridge';
import type { JuryMembership } from './records';

export type ProductExecutionFailure = HumanExecutionFailure | 'REVIEW_NOT_COMPLETED' | 'SNAPSHOT_UNSAFE';

export async function executeProductAgentExecution(input: {
  userId: string | null;
  memberships: readonly JuryMembership[];
  agentExecutionId: string;
  clientTenantId?: string | null;
  adapter?: AgentAdapter;
}): Promise<
  | Exclude<Awaited<ReturnType<typeof executeHumanAgentExecution>>, { ok: false }>
  | { ok: false; reason: ProductExecutionFailure; adapterCalled: false }
> {
  void input.clientTenantId;
  const actor = resolveJuryActor({ userId: input.userId, memberships: input.memberships, clientTenantId: null });
  if (!actor.ok) return { ok: false, reason: actor.reason, adapterCalled: false };
  if (!input.agentExecutionId.trim()) return { ok: false, reason: 'NOT_FOUND', adapterCalled: false };
  const allowed = decideJuryMutation({
    actor,
    action: 'agent.execute',
    resourceTenantId: actor.tenantId,
    clientTenantId: null,
  });
  if (!allowed.ok) return { ok: false, reason: 'FORBIDDEN', adapterCalled: false };
  const { prisma } = await import('@/lib/prisma');
  const execution = await prisma.juryAgentExecution.findFirst({
    where: { id: input.agentExecutionId, tenantId: actor.tenantId },
    select: {
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
              humanDecision: { select: { decision: true } },
            },
          },
        },
      },
    },
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
  const taskType = decision === 'VERIFY' || decision === 'REWORD' ? humanImprovementTaskType(decision) : null;
  if (execution.status === 'PENDING' && (!taskType || task.taskType !== taskType)) {
    return { ok: false, reason: 'HUMAN_APPROVAL_REQUIRED', adapterCalled: false };
  }
  if (execution.status === 'PENDING' && (containsSecret(execution.inputSnapshot) || containsSecret(execution.provenance))) {
    return { ok: false, reason: 'SNAPSHOT_UNSAFE', adapterCalled: false };
  }
  return executeHumanAgentExecution({
    userId: input.userId,
    memberships: input.memberships,
    agentExecutionId: execution.id,
    adapter: input.adapter,
  });
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

function readSummary(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const result = (value as { result?: unknown }).result;
  if (!result || typeof result !== 'object' || Array.isArray(result)) return null;
  const summary = (result as { summary?: unknown }).summary;
  return typeof summary === 'string' && summary.trim().length > 0 ? summary : null;
}
