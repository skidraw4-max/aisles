/**
 * Connects one OPEN improvement task to the existing handoff and execution path.
 * It does not run Change Gate, the review core, or a real agent process.
 */
import { handoffAgent, parseWorkspaceRef, type HandoffTask, type HandoffWriteTx, type WorkspaceRef } from './agent-handoff';
import { containsSecret, executeAgent, type ExecuteOutcome, type ExecutionWriteTx } from './agent-execution';
import type { AgentAdapter } from './agents/agent-adapter';
import { resolveAllowedWorkspace } from './agent-workspace';
import type { JuryMembership } from './records';

const PRODUCT_WORKSPACE: WorkspaceRef = { type: 'PROJECT', ref: 'mock-aisle' };

export type ImprovementAgentFailure =
  | 'UNAUTHENTICATED'
  | 'NO_MEMBERSHIP'
  | 'AMBIGUOUS_MEMBERSHIP'
  | 'STORE_UNAVAILABLE'
  | 'FORBIDDEN'
  | 'TENANT_MISMATCH'
  | 'IMPROVEMENT_TASK_NOT_FOUND'
  | 'IMPROVEMENT_TASK_NOT_OPEN'
  | 'TASK_TYPE_UNSUPPORTED'
  | 'AGENT_TYPE_UNSUPPORTED'
  | 'WORKSPACE_REF_REQUIRED'
  | 'WORKSPACE_REF_INVALID'
  | 'INVALID_PROVENANCE'
  | 'TASK_CONTENT_REQUIRED'
  | 'CREDENTIAL_DATA_DETECTED'
  | 'EXECUTION_NOT_FOUND'
  | 'EXECUTION_NOT_PENDING';

export function workspaceForImprovementTask(provenance: unknown): WorkspaceRef | null {
  const embedded =
    provenance && typeof provenance === 'object' && !Array.isArray(provenance) && 'workspaceRef' in provenance
      ? (provenance as { workspaceRef?: unknown }).workspaceRef
      : undefined;
  const parsed = parseWorkspaceRef(embedded === undefined ? PRODUCT_WORKSPACE : embedded);
  if (!parsed || !resolveAllowedWorkspace(parsed)) return null;
  return parsed;
}

export async function executeImprovementTask(
  command: {
    userId: string | null;
    memberships: readonly JuryMembership[];
    clientTenantId?: string | null;
    now: string;
    clock?: () => string;
    timeoutMs?: number;
    loopGuardBlocked?: boolean;
    improvementTaskId: string;
  },
  io: {
    load(improvementTaskId: string): Promise<HandoffTask | null>;
    handoff: HandoffWriteTx;
    execution: ExecutionWriteTx;
  },
  adapter: AgentAdapter,
): Promise<ExecuteOutcome | { ok: false; reason: ImprovementAgentFailure; execution: null; adapterCalled: false }> {
  const task = await io.load(command.improvementTaskId);
  if (!task) return { ok: false, reason: 'IMPROVEMENT_TASK_NOT_FOUND', execution: null, adapterCalled: false };
  if (containsSecret(task)) return { ok: false, reason: 'CREDENTIAL_DATA_DETECTED', execution: null, adapterCalled: false };
  const workspaceRef = workspaceForImprovementTask(task.provenance);
  if (!workspaceRef) return { ok: false, reason: 'WORKSPACE_REF_INVALID', execution: null, adapterCalled: false };
  const handoff = await handoffAgent(
    {
      userId: command.userId,
      memberships: command.memberships,
      clientTenantId: command.clientTenantId,
      now: command.now,
      task,
      agentType: 'CURSOR',
      workspaceRef,
    },
    io.handoff,
  );
  if (!handoff.ok) return { ok: false, reason: handoff.reason, execution: null, adapterCalled: false };
  return executeAgent(
    {
      userId: command.userId,
      memberships: command.memberships,
      clientTenantId: command.clientTenantId,
      now: command.now,
      clock: command.clock,
      timeoutMs: command.timeoutMs ?? 1000,
      loopGuardBlocked: command.loopGuardBlocked ?? false,
      execution: handoff.execution,
      task,
    },
    adapter,
    io.execution,
  );
}
