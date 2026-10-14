/**
 * Maps a stored JuryReviewResult decision to a task.
 * It does not call an agent, the review core, or the comparator.
 */
import { createHash } from 'node:crypto';
import { decideJuryMutation, resolveJuryActor } from './access';
import { JURY_DECISIONS, type JuryDecision, type JuryMembership } from './records';

export const JURY_DECISION_TASK_TYPES = ['VERIFICATION', 'REWORD'] as const;
export type JuryDecisionTaskType = (typeof JURY_DECISION_TASK_TYPES)[number];

export const JURY_DECISION_TASK_STATUSES = ['OPEN', 'IN_PROGRESS', 'BLOCKED', 'COMPLETED', 'CANCELLED'] as const;
export type JuryDecisionTaskStatus = (typeof JURY_DECISION_TASK_STATUSES)[number];

const NEXT_STATUS: Record<JuryDecisionTaskStatus, readonly JuryDecisionTaskStatus[]> = {
  OPEN: ['IN_PROGRESS', 'BLOCKED', 'CANCELLED'],
  IN_PROGRESS: ['BLOCKED', 'COMPLETED', 'CANCELLED'],
  BLOCKED: ['IN_PROGRESS', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
};

export type DecisionTaskDraft = {
  id: string;
  tenantId: string;
  reviewResultId: string;
  evidenceId: string;
  taskType: JuryDecisionTaskType;
  decision: Extract<JuryDecision, 'VERIFY' | 'REWORD'>;
  title: string;
  description: string;
  reason: string;
  status: JuryDecisionTaskStatus;
  createdAt: string;
  updatedAt: string;
};

export type DecisionTaskAudit = {
  id: string;
  tenantId: string;
  actorUserId: string;
  action: 'VERIFICATION_TASK_CREATED' | 'IMPROVEMENT_TASK_CREATED';
  reviewResultId: string;
  evidenceId: string;
  taskId: string;
  decision: DecisionTaskDraft['decision'];
  timestamp: string;
};

export type DecisionTaskCommand = {
  userId: string | null;
  memberships: readonly JuryMembership[];
  clientTenantId?: string | null;
  now: string;
  reviewResult: {
    id: string;
    tenantId: string;
    expectedDecision: string;
    conflictDetected: boolean;
    overclaimDetected: boolean;
    revisionRequired: boolean;
    evidenceId: string;
  };
  evidence: { id: string; tenantId: string };
};

export type DecisionTaskFailure =
  | 'UNAUTHENTICATED'
  | 'NO_MEMBERSHIP'
  | 'AMBIGUOUS_MEMBERSHIP'
  | 'STORE_UNAVAILABLE'
  | 'FORBIDDEN'
  | 'TENANT_MISMATCH'
  | 'EVIDENCE_MISMATCH'
  | 'DECISION_NOT_IN_CONTRACT'
  | 'INVALID_TRANSITION';

export type DecisionTaskWriteTx = {
  findByResultAndType(reviewResultId: string, taskType: JuryDecisionTaskType): Promise<DecisionTaskDraft | null>;
  insert(task: DecisionTaskDraft, audit: DecisionTaskAudit): Promise<void>;
};

function stableId(parts: readonly string[]): string {
  return createHash('sha256').update(parts.join('\n')).digest('hex');
}

function isProductDecision(value: string): value is JuryDecision {
  return (JURY_DECISIONS as readonly string[]).includes(value);
}

function verifyCopy(conflictDetected: boolean): Pick<DecisionTaskDraft, 'title' | 'description' | 'reason'> {
  if (conflictDetected) {
    return {
      title: 'DB와 GA4 측정 차이 검증',
      reason: 'DB와 GA4의 동일 metric pair에 conflict가 존재함',
      description: '두 데이터 소스의 측정 기준 또는 수집 결과 차이를 확인한다.',
    };
  }
  return {
    title: 'Review 결과 추가 검증',
    reason: 'Comparator decision이 VERIFY이다.',
    description: '측정값과 출처를 다시 확인해 decision의 근거를 검증한다.',
  };
}

function rewordCopy(overclaimDetected: boolean): Pick<DecisionTaskDraft, 'title' | 'description' | 'reason'> {
  return {
    title: '결과 문구 정리',
    reason: overclaimDetected ? 'Comparator가 overclaim을 표시했다.' : 'Comparator decision이 REWORD이다.',
    description: '결과 문구를 측정된 범위 안에서 다시 다듬는다.',
  };
}

export function planDecisionTask(
  command: DecisionTaskCommand,
):
  | { ok: false; reason: DecisionTaskFailure }
  | { ok: true; outcome: 'NO_TASK' }
  | { ok: true; outcome: 'TASK'; task: DecisionTaskDraft; audit: DecisionTaskAudit } {
  void command.clientTenantId;
  const actor = resolveJuryActor({
    userId: command.userId,
    memberships: command.memberships,
    clientTenantId: command.clientTenantId,
  });
  if (!actor.ok) return { ok: false, reason: actor.reason };
  const allowed = decideJuryMutation({
    actor,
    action: 'review.start',
    resourceTenantId: command.reviewResult.tenantId,
    clientTenantId: command.clientTenantId,
  });
  if (!allowed.ok) return allowed;
  if (command.evidence.tenantId !== actor.tenantId || command.reviewResult.tenantId !== actor.tenantId) {
    return { ok: false, reason: 'TENANT_MISMATCH' };
  }
  if (command.evidence.id !== command.reviewResult.evidenceId) return { ok: false, reason: 'EVIDENCE_MISMATCH' };
  if (!isProductDecision(command.reviewResult.expectedDecision)) {
    return { ok: false, reason: 'DECISION_NOT_IN_CONTRACT' };
  }
  if (command.reviewResult.expectedDecision === 'ACCEPT') return { ok: true, outcome: 'NO_TASK' };

  const taskType: JuryDecisionTaskType = command.reviewResult.expectedDecision === 'VERIFY' ? 'VERIFICATION' : 'REWORD';
  const copy =
    command.reviewResult.expectedDecision === 'VERIFY'
      ? verifyCopy(command.reviewResult.conflictDetected)
      : rewordCopy(command.reviewResult.overclaimDetected);
  const task: DecisionTaskDraft = {
    id: stableId([actor.tenantId, command.reviewResult.id, taskType]),
    tenantId: actor.tenantId,
    reviewResultId: command.reviewResult.id,
    evidenceId: command.evidence.id,
    taskType,
    decision: command.reviewResult.expectedDecision,
    title: copy.title,
    description: copy.description,
    reason: copy.reason,
    status: 'OPEN',
    createdAt: command.now,
    updatedAt: command.now,
  };
  const action = taskType === 'VERIFICATION' ? 'VERIFICATION_TASK_CREATED' : 'IMPROVEMENT_TASK_CREATED';
  return {
    ok: true,
    outcome: 'TASK',
    task,
    audit: {
      id: stableId([task.id, action]),
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action,
      reviewResultId: task.reviewResultId,
      evidenceId: task.evidenceId,
      taskId: task.id,
      decision: task.decision,
      timestamp: command.now,
    },
  };
}

export async function runDecisionTaskPersist(
  command: DecisionTaskCommand,
  tx: DecisionTaskWriteTx,
): Promise<
  | { ok: false; reason: DecisionTaskFailure }
  | { ok: true; outcome: 'NO_TASK' }
  | { ok: true; outcome: 'TASK'; created: boolean; task: DecisionTaskDraft }
> {
  const planned = planDecisionTask(command);
  if (!planned.ok || planned.outcome === 'NO_TASK') return planned;
  const existing = await tx.findByResultAndType(planned.task.reviewResultId, planned.task.taskType);
  if (existing) {
    if (existing.tenantId !== planned.task.tenantId) return { ok: false, reason: 'TENANT_MISMATCH' };
    return { ok: true, outcome: 'TASK', created: false, task: existing };
  }
  await tx.insert(planned.task, planned.audit);
  return { ok: true, outcome: 'TASK', created: true, task: planned.task };
}

export function planTaskTransition(
  task: DecisionTaskDraft,
  next: JuryDecisionTaskStatus,
  updatedAt: string,
  options?: { verificationResultId?: string },
): { ok: true; task: DecisionTaskDraft } | { ok: false; reason: 'INVALID_TRANSITION' | 'RESULT_REQUIRED' } {
  if (!NEXT_STATUS[task.status].includes(next)) return { ok: false, reason: 'INVALID_TRANSITION' };
  if (task.taskType === 'VERIFICATION' && next === 'COMPLETED' && !options?.verificationResultId) {
    return { ok: false, reason: 'RESULT_REQUIRED' };
  }
  return { ok: true, task: { ...task, status: next, updatedAt } };
}
