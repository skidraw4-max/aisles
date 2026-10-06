/**
 * Turns a REWORD decision task into an improvement task.
 * It does not hand the task to an agent or start the auto loop.
 */
import { createHash } from 'node:crypto';
import { decideJuryMutation, resolveJuryActor } from './access';
import type { DecisionTaskDraft } from './decision-task';
import { JURY_DECISIONS, type JuryLoopGuardPolicy, type JuryMembership } from './records';

export const REWORD_CONSTRAINTS = [
  'Evidence 값을 변경하지 않는다.',
  'metric 값을 변경하지 않는다.',
  'Evidence provenance를 변경하지 않는다.',
  '데이터 수집 결과를 임의로 변경하지 않는다.',
  '측정되지 않은 값을 사실처럼 표현하지 않는다.',
  '기존 Jury decision contract를 변경하지 않는다.',
  'credential 정보를 접근하거나 출력하지 않는다.',
] as const;

export const REWORD_FIXTURE_REASON =
  '사용자 노출 문구가 현재 측정된 Evidence의 범위를 넘어설 가능성이 있어 표현을 측정 범위 안으로 조정해야 한다.';

export const REWORD_FIXTURE_OBJECTIVE = '사용자 노출 문구를 Evidence가 직접 지지하는 수준으로 조정한다.';

const CLOSED_LOOP_POLICY: JuryLoopGuardPolicy = {
  maxIterations: null,
  maxRuntimeMs: null,
  maxCostUsd: null,
};

export type ImprovementTaskDraft = {
  id: string;
  tenantId: string;
  reviewResultId: string;
  decisionTaskId: string;
  evidenceId: string;
  taskType: 'REWORD';
  title: string;
  description: string;
  reason: string;
  objective: string;
  constraints: string[];
  diagnosis: string;
  acceptanceCriteria: string[];
  status: 'OPEN';
  loopIndex: number;
  loopPolicy: JuryLoopGuardPolicy;
  provenance: {
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
  createdAt: string;
  updatedAt: string;
};

export type ImprovementCommand = {
  userId: string | null;
  memberships: readonly JuryMembership[];
  clientTenantId?: string | null;
  now: string;
  decisionTask: DecisionTaskDraft | null;
  reviewResult: {
    id: string;
    tenantId: string;
    evidenceId: string;
    expectedDecision: string;
    evidenceStrength: string;
    claimStrength: string;
    conflictDetected: boolean;
    overclaimDetected: boolean;
    revisionRequired: boolean;
  };
  evidence: { id: string; tenantId: string };
  reason: string;
  objective: string;
};

export type ImprovementFailure =
  | 'UNAUTHENTICATED'
  | 'NO_MEMBERSHIP'
  | 'AMBIGUOUS_MEMBERSHIP'
  | 'STORE_UNAVAILABLE'
  | 'FORBIDDEN'
  | 'TENANT_MISMATCH'
  | 'DECISION_NOT_IN_CONTRACT'
  | 'TASK_NOT_FOUND'
  | 'TASK_TYPE_INVALID'
  | 'TASK_NOT_OPEN';

export type ImprovementWriteTx = {
  findByDecisionTask(decisionTaskId: string, taskType: 'REWORD'): Promise<ImprovementTaskDraft | null>;
  insert(task: ImprovementTaskDraft): Promise<void>;
  audit(action: 'IMPROVEMENT_TASK_CREATED', task: ImprovementTaskDraft): Promise<void>;
};

function stableId(parts: readonly string[]): string {
  return createHash('sha256').update(parts.join('\n')).digest('hex');
}

function inContract(value: string): boolean {
  return (JURY_DECISIONS as readonly string[]).includes(value);
}

export async function bridgeImprovement(
  command: ImprovementCommand,
  tx: ImprovementWriteTx,
): Promise<
  | { ok: false; reason: ImprovementFailure }
  | { ok: true; outcome: 'NO_IMPROVEMENT' }
  | { ok: true; outcome: 'IMPROVEMENT'; created: boolean; task: ImprovementTaskDraft }
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
    action: 'review.start',
    resourceTenantId: actor.tenantId,
    clientTenantId: command.clientTenantId,
  });
  if (!allowed.ok) return allowed;
  if (!inContract(command.reviewResult.expectedDecision)) return { ok: false, reason: 'DECISION_NOT_IN_CONTRACT' };
  if (command.reviewResult.expectedDecision === 'ACCEPT' || command.reviewResult.expectedDecision === 'VERIFY') {
    return { ok: true, outcome: 'NO_IMPROVEMENT' };
  }
  if (
    command.reviewResult.tenantId !== actor.tenantId ||
    command.evidence.tenantId !== actor.tenantId ||
    command.decisionTask?.tenantId !== actor.tenantId
  ) {
    return { ok: false, reason: 'TENANT_MISMATCH' };
  }
  if (!command.decisionTask) return { ok: false, reason: 'TASK_NOT_FOUND' };
  if (command.decisionTask.decision !== 'REWORD' || command.decisionTask.taskType !== 'REWORD') {
    return { ok: false, reason: 'TASK_TYPE_INVALID' };
  }
  if (
    command.decisionTask.reviewResultId !== command.reviewResult.id ||
    command.decisionTask.evidenceId !== command.evidence.id ||
    command.reviewResult.evidenceId !== command.evidence.id
  ) {
    return { ok: false, reason: 'TENANT_MISMATCH' };
  }
  const existing = await tx.findByDecisionTask(command.decisionTask.id, 'REWORD');
  if (existing) {
    if (existing.tenantId !== actor.tenantId) return { ok: false, reason: 'TENANT_MISMATCH' };
    return { ok: true, outcome: 'IMPROVEMENT', created: false, task: existing };
  }
  if (command.decisionTask.status !== 'OPEN') return { ok: false, reason: 'TASK_NOT_OPEN' };

  const reason = command.reason.trim() || command.decisionTask.reason;
  const objective = command.objective.trim() || command.decisionTask.description;
  const task: ImprovementTaskDraft = {
    id: stableId([actor.tenantId, command.decisionTask.id, 'REWORD']),
    tenantId: actor.tenantId,
    reviewResultId: command.reviewResult.id,
    decisionTaskId: command.decisionTask.id,
    evidenceId: command.evidence.id,
    taskType: 'REWORD',
    title: command.decisionTask.title,
    description: command.decisionTask.description,
    reason,
    objective,
    constraints: [...REWORD_CONSTRAINTS],
    diagnosis: objective,
    acceptanceCriteria: [...REWORD_CONSTRAINTS],
    status: 'OPEN',
    loopIndex: 0,
    loopPolicy: CLOSED_LOOP_POLICY,
    provenance: {
      reviewResultId: command.reviewResult.id,
      decisionTaskId: command.decisionTask.id,
      evidenceId: command.evidence.id,
      sourceDecision: 'REWORD',
      comparator: {
        evidenceStrength: command.reviewResult.evidenceStrength,
        claimStrength: command.reviewResult.claimStrength,
        conflictDetected: command.reviewResult.conflictDetected,
        overclaimDetected: command.reviewResult.overclaimDetected,
        revisionRequired: command.reviewResult.revisionRequired,
        expectedDecision: 'REWORD',
      },
    },
    createdAt: command.now,
    updatedAt: command.now,
  };
  await tx.insert(task);
  await tx.audit('IMPROVEMENT_TASK_CREATED', task);
  return { ok: true, outcome: 'IMPROVEMENT', created: true, task };
}
