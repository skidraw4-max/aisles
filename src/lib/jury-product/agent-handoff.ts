/**
 * Records a PENDING agent execution for an OPEN REWORD improvement task.
 * It does not start a process, call an agent, or change the task status.
 */
import { createHash } from 'node:crypto';
import { decideJuryMutation, resolveJuryActor } from './access';
import type { JuryMembership } from './records';

export const HANDOFF_AGENTS = ['CURSOR', 'CLAUDE_CODE', 'OTHER'] as const;
export type HandoffAgent = (typeof HANDOFF_AGENTS)[number];

export type WorkspaceRef = {
  type: 'PROJECT';
  ref: string;
};

export type HandoffProvenance = {
  reviewResultId: string;
  decisionTaskId: string;
  evidenceId: string;
  sourceDecision: 'REWORD';
  comparator: {
    evidenceStrength: string;
    claimStrength: string;
    conflictDetected: boolean;
    overclaimDetected: boolean;
    revisionRequired: boolean;
    expectedDecision: 'REWORD';
  };
};

export type HandoffTask = {
  id: string;
  tenantId: string;
  reviewResultId: string;
  decisionTaskId: string;
  evidenceId: string;
  taskType: string;
  title: string;
  description: string;
  reason: string;
  objective: string;
  constraints: string[];
  status: string;
  provenance: HandoffProvenance | null;
};

export type HandoffSnapshot = {
  improvementTaskId: string;
  taskType: 'REWORD';
  title: string;
  description: string;
  reason: string;
  objective: string;
  constraints: string[];
  evidenceId: string;
  reviewResultId: string;
  provenance: HandoffProvenance;
  workspaceRef: WorkspaceRef;
};

export type AgentExecutionDraft = {
  id: string;
  tenantId: string;
  taskId: string;
  agent: HandoffAgent;
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'BLOCKED';
  inputSnapshot: HandoffSnapshot;
  workspaceRef: WorkspaceRef;
  requestedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  resultRef: string | null;
  errorCode: string | null;
  provenance: HandoffProvenance;
  allowedPaths: string[];
  deniedPaths: string[];
  createdAt: string;
  updatedAt: string;
};

export type HandoffCommand = {
  userId: string | null;
  memberships: readonly JuryMembership[];
  clientTenantId?: string | null;
  now: string;
  task: HandoffTask | null;
  agentType: string;
  workspaceRef: unknown;
};

export type HandoffFailure =
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
  | 'INVALID_PROVENANCE'
  | 'TASK_CONTENT_REQUIRED';

export type HandoffWriteTx = {
  findByTaskAndAgent(taskId: string, agent: HandoffAgent): Promise<AgentExecutionDraft | null>;
  insert(execution: AgentExecutionDraft): Promise<void>;
  audit(execution: AgentExecutionDraft): Promise<void>;
};

function stableId(parts: readonly string[]): string {
  return createHash('sha256').update(parts.join('\n')).digest('hex');
}

function isHandoffAgent(value: string): value is HandoffAgent {
  return (HANDOFF_AGENTS as readonly string[]).includes(value);
}

export function parseWorkspaceRef(value: unknown): WorkspaceRef | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as { type?: unknown; ref?: unknown };
  if (row.type !== 'PROJECT' || typeof row.ref !== 'string') return null;
  const ref = row.ref.trim();
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(ref)) return null;
  return { type: 'PROJECT', ref };
}

function hasSecret(value: unknown): boolean {
  const text = JSON.stringify(value);
  if (!text) return false;
  const lower = text.toLowerCase();
  return (
    lower.includes('credentialref') ||
    lower.includes('private_key') ||
    lower.includes('begin private') ||
    lower.includes('postgres://') ||
    lower.includes('password') ||
    lower.includes('access_token') ||
    lower.includes('refresh_token') ||
    lower.includes('api_key') ||
    lower.includes('sessioncookie')
  );
}

function safeProvenance(task: HandoffTask): HandoffProvenance | null {
  const source = task.provenance;
  if (!source || source.sourceDecision !== 'REWORD' || source.comparator?.expectedDecision !== 'REWORD') return null;
  if (source.reviewResultId !== task.reviewResultId || source.evidenceId !== task.evidenceId) return null;
  if (source.decisionTaskId !== task.decisionTaskId) return null;
  if (typeof source.comparator.evidenceStrength !== 'string' || typeof source.comparator.claimStrength !== 'string') {
    return null;
  }
  const provenance: HandoffProvenance = {
    reviewResultId: source.reviewResultId,
    decisionTaskId: source.decisionTaskId,
    evidenceId: source.evidenceId,
    sourceDecision: 'REWORD',
    comparator: {
      evidenceStrength: source.comparator.evidenceStrength,
      claimStrength: source.comparator.claimStrength,
      conflictDetected: source.comparator.conflictDetected === true,
      overclaimDetected: source.comparator.overclaimDetected === true,
      revisionRequired: source.comparator.revisionRequired === true,
      expectedDecision: 'REWORD',
    },
  };
  if (hasSecret(provenance)) return null;
  return provenance;
}

export async function handoffAgent(
  command: HandoffCommand,
  tx: HandoffWriteTx,
): Promise<
  | { ok: false; reason: HandoffFailure }
  | { ok: true; outcome: 'HANDOFF'; created: boolean; execution: AgentExecutionDraft }
> {
  void command.clientTenantId;
  const actor = resolveJuryActor({
    userId: command.userId,
    memberships: command.memberships,
    clientTenantId: command.clientTenantId,
  });
  if (!actor.ok) return actor;
  const allowed = decideJuryMutation({
    actor,
    action: 'agent.execute',
    resourceTenantId: actor.tenantId,
    clientTenantId: command.clientTenantId,
  });
  if (!allowed.ok) return allowed;
  if (!command.task) return { ok: false, reason: 'IMPROVEMENT_TASK_NOT_FOUND' };
  if (command.task.tenantId !== actor.tenantId) return { ok: false, reason: 'TENANT_MISMATCH' };
  if (command.task.status !== 'OPEN') return { ok: false, reason: 'IMPROVEMENT_TASK_NOT_OPEN' };
  if (command.task.taskType !== 'REWORD') return { ok: false, reason: 'TASK_TYPE_UNSUPPORTED' };
  const provenance = safeProvenance(command.task);
  if (!provenance) return { ok: false, reason: 'INVALID_PROVENANCE' };
  if (command.task.objective.trim().length === 0 || command.task.constraints.length === 0) {
    return { ok: false, reason: 'TASK_CONTENT_REQUIRED' };
  }
  if (command.task.constraints.some((item) => typeof item !== 'string') || hasSecret(command.task.constraints)) {
    return { ok: false, reason: 'TASK_CONTENT_REQUIRED' };
  }
  if (!isHandoffAgent(command.agentType)) return { ok: false, reason: 'AGENT_TYPE_UNSUPPORTED' };
  const workspaceRef = parseWorkspaceRef(command.workspaceRef);
  if (!workspaceRef) return { ok: false, reason: 'WORKSPACE_REF_REQUIRED' };

  const existing = await tx.findByTaskAndAgent(command.task.id, command.agentType);
  if (existing) {
    if (existing.tenantId !== actor.tenantId) return { ok: false, reason: 'TENANT_MISMATCH' };
    return { ok: true, outcome: 'HANDOFF', created: false, execution: existing };
  }

  const snapshot: HandoffSnapshot = {
    improvementTaskId: command.task.id,
    taskType: 'REWORD',
    title: command.task.title,
    description: command.task.description,
    reason: command.task.reason,
    objective: command.task.objective,
    constraints: [...command.task.constraints],
    evidenceId: command.task.evidenceId,
    reviewResultId: command.task.reviewResultId,
    provenance,
    workspaceRef,
  };
  if (hasSecret(snapshot)) return { ok: false, reason: 'INVALID_PROVENANCE' };

  const execution: AgentExecutionDraft = {
    id: stableId([actor.tenantId, command.task.id, command.agentType]),
    tenantId: actor.tenantId,
    taskId: command.task.id,
    agent: command.agentType,
    status: 'PENDING',
    inputSnapshot: snapshot,
    workspaceRef,
    requestedAt: command.now,
    startedAt: null,
    finishedAt: null,
    resultRef: null,
    errorCode: null,
    provenance,
    allowedPaths: [],
    deniedPaths: [],
    createdAt: command.now,
    updatedAt: command.now,
  };
  await tx.insert(execution);
  await tx.audit(execution);
  return { ok: true, outcome: 'HANDOFF', created: true, execution };
}
