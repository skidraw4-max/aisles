/**
 * Starts one improvement cycle when a completed REWORD review has no existing cycle.
 * The lineage resolver stays separate and does not create a cycle.
 */
import { createHash } from 'node:crypto';
import { decideJuryMutation, resolveJuryActor } from './access';
import { bridgeImprovement, type ImprovementTaskDraft, type ImprovementWriteTx } from './improvement-bridge';
import { runDecisionTaskPersist, type DecisionTaskDraft, type DecisionTaskWriteTx } from './decision-task';
import {
  foldDecisionCycle,
  PRODUCT_LOOP_GUARD_DEFAULTS,
  type DecisionCycleDraft,
  type ProductLoopGuardPolicy,
} from './loop-guard';
import type { JuryMembership } from './records';

const SECRET = /credentialref|private_key|begin private|postgres:\/\/|password|access_token|api_key|\bsk-[a-z0-9]/i;

export type StartFailure =
  | 'UNAUTHENTICATED'
  | 'NO_MEMBERSHIP'
  | 'AMBIGUOUS_MEMBERSHIP'
  | 'STORE_UNAVAILABLE'
  | 'FORBIDDEN'
  | 'TENANT_MISMATCH'
  | 'REVIEW_NOT_FOUND'
  | 'DECISION_NOT_REWORD'
  | 'REVIEW_NOT_COMPLETED'
  | 'IMPROVEMENT_CYCLE_PRECONDITION'
  | 'DECISION_NOT_IN_CONTRACT'
  | 'CREDENTIAL_IN_REASON'
  | 'EVIDENCE_MISMATCH';

export type StartReview = {
  id: string;
  tenantId: string;
  evidenceId: string;
  expectedDecision: string;
  evidenceStrength: string;
  claimStrength: string;
  conflictDetected: boolean;
  overclaimDetected: boolean;
  revisionRequired: boolean;
  completedAt: string | null;
  requestStatus: string;
  verificationResultId: string | null;
  evidenceIdentity: string;
};

export type StartLoaded = {
  review: StartReview;
  evidence: { id: string; tenantId: string };
  cycle: DecisionCycleDraft | null;
  decisionTask: DecisionTaskDraft | null;
  decisionLinked: boolean;
  improvementTask: ImprovementTaskDraft | null;
  improvementLinked: boolean;
};

export type StartIo = {
  load(reviewResultId: string): Promise<StartLoaded | null>;
  findPolicy(tenantId: string): Promise<{ id: string; policy: ProductLoopGuardPolicy } | null>;
  insertCycle(cycle: DecisionCycleDraft): Promise<void>;
  auditCycle(input: {
    review: StartReview;
    cycle: DecisionCycleDraft;
    decisionTaskId: string;
    improvementTaskId: string;
  }): Promise<void>;
  decisionTx: DecisionTaskWriteTx;
  improvementTx: ImprovementWriteTx;
};

export type StartSuccess = {
  ok: true;
  created: boolean;
  kind: 'IMPROVEMENT_CYCLE';
  decision: 'REWORD';
  cycle: DecisionCycleDraft;
  decisionTask: DecisionTaskDraft;
  improvementTask: ImprovementTaskDraft;
  policy: ProductLoopGuardPolicy;
};

export class CycleStartAbort extends Error {
  readonly reason: StartFailure;

  constructor(reason: StartFailure) {
    super(reason);
    this.name = 'CycleStartAbort';
    this.reason = reason;
  }
}

export function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: string }).code === 'P2002';
}

export function improvementCycleAction(
  lineage: { ok: true; cycle: { rootReviewResultId: string; currentReviewResultId: string } } | { ok: false; reason: string },
  reviewResultId: string,
): 'REPLAY' | 'EXISTING_CYCLE' | 'START' | { refuse: string } {
  if (lineage.ok) {
    if (lineage.cycle.rootReviewResultId === reviewResultId && lineage.cycle.currentReviewResultId === reviewResultId) {
      return 'REPLAY';
    }
    return 'EXISTING_CYCLE';
  }
  if (lineage.reason === 'DECISION_CYCLE_NOT_FOUND') return 'START';
  return { refuse: lineage.reason };
}

export async function startNewImprovementCycle(
  command: {
    userId: string | null;
    memberships: readonly JuryMembership[];
    clientTenantId?: string | null;
    now: string;
    reviewResultId: string;
  },
  io: StartIo,
): Promise<StartSuccess | { ok: false; reason: StartFailure }> {
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

  let loaded = await io.load(command.reviewResultId);
  if (!loaded) return { ok: false, reason: 'REVIEW_NOT_FOUND' };
  if (loaded.review.tenantId !== actor.tenantId || loaded.evidence.tenantId !== actor.tenantId) {
    return { ok: false, reason: 'TENANT_MISMATCH' };
  }
  if (loaded.evidence.id !== loaded.review.evidenceId) return { ok: false, reason: 'EVIDENCE_MISMATCH' };
  if (SECRET.test(JSON.stringify({ review: loaded.review, evidence: loaded.evidence }))) {
    return { ok: false, reason: 'CREDENTIAL_IN_REASON' };
  }
  if (loaded.review.expectedDecision !== 'REWORD') return { ok: false, reason: 'DECISION_NOT_REWORD' };
  if (loaded.review.requestStatus !== 'COMPLETED' || !loaded.review.completedAt) {
    return { ok: false, reason: 'REVIEW_NOT_COMPLETED' };
  }
  if (loaded.cycle && loaded.cycle.tenantId !== actor.tenantId) return { ok: false, reason: 'TENANT_MISMATCH' };
  if (!loaded.cycle && (loaded.decisionLinked || loaded.improvementLinked)) {
    const again = await io.load(command.reviewResultId);
    if (again?.cycle) loaded = again;
  }
  if (!loaded.cycle && (loaded.decisionLinked || loaded.improvementLinked)) {
    return { ok: false, reason: 'IMPROVEMENT_CYCLE_PRECONDITION' };
  }
  if (loaded.review.requestStatus !== 'COMPLETED' || !loaded.review.completedAt) {
    return { ok: false, reason: 'REVIEW_NOT_COMPLETED' };
  }

  const storedPolicy = await io.findPolicy(actor.tenantId);
  const policy = storedPolicy?.policy ?? PRODUCT_LOOP_GUARD_DEFAULTS;
  if (loaded.cycle) {
    const tasks = await ensureTasks(command, loaded, io);
    return { ok: true, created: false, kind: 'IMPROVEMENT_CYCLE', decision: 'REWORD', cycle: loaded.cycle, decisionTask: tasks.decisionTask, improvementTask: tasks.improvementTask, policy };
  }

  const folded = foldDecisionCycle([
    {
      id: loaded.review.id,
      tenantId: loaded.review.tenantId,
      evidenceIdentity: loaded.review.evidenceIdentity,
      decision: 'REWORD',
      conflictDetected: loaded.review.conflictDetected,
      overclaimDetected: loaded.review.overclaimDetected,
      revisionRequired: loaded.review.revisionRequired,
      parentReviewResultId: null,
      verificationResultId: loaded.review.verificationResultId,
      completedAt: loaded.review.completedAt,
    },
  ]);
  const cycle: DecisionCycleDraft = {
    id: createHash('sha256').update([actor.tenantId, loaded.review.id, 'decision-cycle'].join('\n')).digest('hex'),
    tenantId: actor.tenantId,
    rootReviewResultId: loaded.review.id,
    currentReviewResultId: folded.currentReviewResultId,
    iteration: folded.iteration,
    verificationAttempts: folded.verificationAttempts,
    sameDecisionCount: folded.sameDecisionCount,
    sameConflictCount: folded.sameConflictCount,
    decisionFingerprint: folded.decisionFingerprint,
    conflictFingerprint: folded.conflictFingerprint,
    status: 'ACTIVE',
    blockedReason: null,
    policyId: storedPolicy?.id ?? '',
    startedAt: folded.startedAt,
    updatedAt: command.now,
  };
  await io.insertCycle(cycle);
  const tasks = await ensureTasks(command, loaded, io);
  await io.auditCycle({
    review: loaded.review,
    cycle,
    decisionTaskId: tasks.decisionTask.id,
    improvementTaskId: tasks.improvementTask.id,
  });
  return { ok: true, created: true, kind: 'IMPROVEMENT_CYCLE', decision: 'REWORD', cycle, decisionTask: tasks.decisionTask, improvementTask: tasks.improvementTask, policy };
}

async function ensureTasks(
  command: {
    userId: string | null;
    memberships: readonly JuryMembership[];
    clientTenantId?: string | null;
    now: string;
  },
  loaded: StartLoaded,
  io: StartIo,
): Promise<{ decisionTask: DecisionTaskDraft; improvementTask: ImprovementTaskDraft }> {
  const task = await runDecisionTaskPersist(
    {
      userId: command.userId,
      memberships: command.memberships,
      clientTenantId: command.clientTenantId,
      now: command.now,
      reviewResult: loaded.review,
      evidence: loaded.evidence,
    },
    io.decisionTx,
  );
  if (!task.ok) throw new CycleStartAbort(task.reason === 'INVALID_TRANSITION' ? 'DECISION_NOT_IN_CONTRACT' : task.reason);
  if (task.outcome !== 'TASK' || task.task.taskType !== 'REWORD') throw new CycleStartAbort('DECISION_NOT_IN_CONTRACT');
  const improvement = await bridgeImprovement(
    {
      userId: command.userId,
      memberships: command.memberships,
      clientTenantId: command.clientTenantId,
      now: command.now,
      decisionTask: task.task,
      reviewResult: loaded.review,
      evidence: loaded.evidence,
      reason: task.task.reason,
      objective: task.task.description,
    },
    io.improvementTx,
  );
  if (!improvement.ok) {
    throw new CycleStartAbort(
      improvement.reason === 'TASK_NOT_FOUND' || improvement.reason === 'TASK_TYPE_INVALID' || improvement.reason === 'TASK_NOT_OPEN'
        ? 'DECISION_NOT_IN_CONTRACT'
        : improvement.reason,
    );
  }
  if (improvement.outcome !== 'IMPROVEMENT') throw new CycleStartAbort('DECISION_NOT_IN_CONTRACT');
  return { decisionTask: task.task, improvementTask: improvement.task };
}
