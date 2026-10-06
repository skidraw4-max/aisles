/**
 * Connects one change-gate re-review result to an existing decision cycle.
 * It does not create a cycle, start an agent, or re-run the change gate.
 */
import { decideJuryMutation, resolveJuryActor } from './access';
import { bridgeImprovement, type ImprovementTaskDraft } from './improvement-bridge';
import { runDecisionTaskPersist, type DecisionTaskCommand, type DecisionTaskDraft, type DecisionTaskWriteTx } from './decision-task';
import {
  evaluateLoopGuard,
  foldDecisionCycle,
  type CycleReviewNode,
  type DecisionCycleDraft,
  type GuardReason,
  type ProductLoopGuardPolicy,
} from './loop-guard';
import type { JuryMembership } from './records';

const SECRET = /credentialref|private_key|begin private|postgres:\/\/|password|access_token|api_key|\bsk-[a-z0-9]/i;

export type ResolutionReview = {
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

export type ResolutionSnapshot = {
  review: ResolutionReview;
  evidence: { id: string; tenantId: string };
  chain: CycleReviewNode[];
  cycle: DecisionCycleDraft | null;
  policy: ProductLoopGuardPolicy;
  spend?: { runtimeMs: number | null; costUsd: number | null };
};

export type ResolutionFailure =
  | 'UNAUTHENTICATED'
  | 'NO_MEMBERSHIP'
  | 'AMBIGUOUS_MEMBERSHIP'
  | 'STORE_UNAVAILABLE'
  | 'FORBIDDEN'
  | 'TENANT_MISMATCH'
  | 'REVIEW_NOT_FOUND'
  | 'DECISION_CYCLE_NOT_FOUND'
  | 'DECISION_CYCLE_LINEAGE_AMBIGUOUS'
  | 'REVIEW_LINEAGE_CYCLE'
  | 'DECISION_NOT_IN_CONTRACT'
  | 'CREDENTIAL_IN_REASON'
  | 'EVIDENCE_MISMATCH';

export type ResolutionSuccess = {
  ok: true;
  created: boolean;
  decision: 'ACCEPT' | 'VERIFY' | 'REWORD';
  guard: GuardReason;
  cycleStatus: DecisionCycleDraft['status'];
  iteration: number;
  verificationTask: DecisionTaskDraft | null;
  rewordTask: DecisionTaskDraft | null;
  improvementTask: ImprovementTaskDraft | null;
};

export type ResolutionIo = {
  load(reviewResultId: string): Promise<ResolutionSnapshot | null>;
  saveCycle(cycle: DecisionCycleDraft): Promise<void>;
  audit(action: 'REVIEW_DECISION_RESOLVED' | 'LOOP_GUARD_BLOCKED', review: ResolutionReview, reason: GuardReason): Promise<void>;
  decisionTx: DecisionTaskWriteTx;
  improvementTx: {
    findByDecisionTask(decisionTaskId: string, taskType: 'REWORD'): Promise<ImprovementTaskDraft | null>;
    insert(task: ImprovementTaskDraft): Promise<void>;
    audit(action: 'IMPROVEMENT_TASK_CREATED', task: ImprovementTaskDraft): Promise<void>;
  };
};

export async function resolveReReviewDecision(
  command: {
    userId: string | null;
    memberships: readonly JuryMembership[];
    clientTenantId?: string | null;
    now: string;
    reviewResultId: string;
  },
  io: ResolutionIo,
): Promise<{ ok: false; reason: ResolutionFailure } | ResolutionSuccess> {
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

  const snapshot = await io.load(command.reviewResultId);
  if (!snapshot) return { ok: false, reason: 'REVIEW_NOT_FOUND' };
  if (snapshot.review.tenantId !== actor.tenantId || snapshot.evidence.tenantId !== actor.tenantId) {
    return { ok: false, reason: 'TENANT_MISMATCH' };
  }
  if (snapshot.evidence.id !== snapshot.review.evidenceId) return { ok: false, reason: 'EVIDENCE_MISMATCH' };
  if (SECRET.test(JSON.stringify({ review: snapshot.review, evidence: snapshot.evidence }))) {
    return { ok: false, reason: 'CREDENTIAL_IN_REASON' };
  }
  const decision = snapshot.review.expectedDecision;
  if (decision !== 'ACCEPT' && decision !== 'VERIFY' && decision !== 'REWORD') {
    return { ok: false, reason: 'DECISION_NOT_IN_CONTRACT' };
  }
  const root = snapshot.chain.find((review) => review.parentReviewResultId === null);
  if (!snapshot.cycle || !root || snapshot.cycle.rootReviewResultId !== root.id || !snapshot.chain.some((review) => review.id === snapshot.review.id)) {
    return { ok: false, reason: 'DECISION_CYCLE_NOT_FOUND' };
  }
  if (snapshot.cycle.tenantId !== actor.tenantId || snapshot.chain.some((review) => review.tenantId !== actor.tenantId)) {
    return { ok: false, reason: 'TENANT_MISMATCH' };
  }

  if (snapshot.cycle.status === 'BLOCKED' || snapshot.cycle.status === 'COMPLETED') {
    return {
      ok: true,
      created: false,
      decision,
      guard: snapshot.cycle.blockedReason ?? 'ALLOWED',
      cycleStatus: snapshot.cycle.status,
      iteration: snapshot.cycle.iteration,
      verificationTask: null,
      rewordTask: null,
      improvementTask: null,
    };
  }

  const folded = foldDecisionCycle(snapshot.chain);
  const spend = snapshot.spend ?? { runtimeMs: null, costUsd: null };
  const guard = evaluateLoopGuard({
    policy: snapshot.policy,
    iteration: folded.iteration,
    verificationAttempts: folded.verificationAttempts,
    sameDecisionCount: folded.sameDecisionCount,
    sameConflictCount: folded.sameConflictCount,
    runtimeMs: spend.runtimeMs,
    costUsd: spend.costUsd,
  });
  const nextCycle: DecisionCycleDraft = {
    ...snapshot.cycle,
    currentReviewResultId: folded.currentReviewResultId,
    iteration: folded.iteration,
    verificationAttempts: folded.verificationAttempts,
    sameDecisionCount: folded.sameDecisionCount,
    sameConflictCount: folded.sameConflictCount,
    decisionFingerprint: folded.decisionFingerprint,
    conflictFingerprint: folded.conflictFingerprint,
    status: guard.allowed ? (decision === 'ACCEPT' ? 'COMPLETED' : 'ACTIVE') : 'BLOCKED',
    blockedReason: guard.reason === 'ALLOWED' ? null : guard.reason,
    updatedAt: command.now,
  };

  if (!guard.allowed) {
    await io.saveCycle(nextCycle);
    await io.audit('LOOP_GUARD_BLOCKED', snapshot.review, guard.reason);
    return { ok: true, created: false, decision, guard: guard.reason, cycleStatus: 'BLOCKED', iteration: folded.iteration, verificationTask: null, rewordTask: null, improvementTask: null };
  }

  if (decision === 'ACCEPT') {
    await io.saveCycle(nextCycle);
    await io.audit('REVIEW_DECISION_RESOLVED', snapshot.review, 'ALLOWED');
    return { ok: true, created: false, decision, guard: 'ALLOWED', cycleStatus: 'COMPLETED', iteration: folded.iteration, verificationTask: null, rewordTask: null, improvementTask: null };
  }

  const taskCommand: DecisionTaskCommand = {
    userId: command.userId,
    memberships: command.memberships,
    clientTenantId: command.clientTenantId,
    now: command.now,
    reviewResult: snapshot.review,
    evidence: snapshot.evidence,
  };
  const task = await runDecisionTaskPersist(taskCommand, io.decisionTx);
  if (!task.ok) {
    if (task.reason === 'INVALID_TRANSITION') return { ok: false, reason: 'DECISION_NOT_IN_CONTRACT' };
    return { ok: false, reason: task.reason };
  }
  if (task.outcome !== 'TASK') return { ok: false, reason: 'DECISION_NOT_IN_CONTRACT' };

  if (decision === 'VERIFY') {
    await io.saveCycle(nextCycle);
    return {
      ok: true,
      created: task.created,
      decision,
      guard: 'ALLOWED',
      cycleStatus: 'ACTIVE',
      iteration: folded.iteration,
      verificationTask: task.task,
      rewordTask: null,
      improvementTask: null,
    };
  }

  const improvement = await bridgeImprovement(
    {
      userId: command.userId,
      memberships: command.memberships,
      clientTenantId: command.clientTenantId,
      now: command.now,
      decisionTask: task.task,
      reviewResult: snapshot.review,
      evidence: snapshot.evidence,
      reason: task.task.reason,
      objective: task.task.description,
    },
    io.improvementTx,
  );
  if (!improvement.ok) {
    if (
      improvement.reason === 'UNAUTHENTICATED' ||
      improvement.reason === 'NO_MEMBERSHIP' ||
      improvement.reason === 'AMBIGUOUS_MEMBERSHIP' ||
      improvement.reason === 'STORE_UNAVAILABLE' ||
      improvement.reason === 'FORBIDDEN' ||
      improvement.reason === 'TENANT_MISMATCH' ||
      improvement.reason === 'DECISION_NOT_IN_CONTRACT'
    ) {
      return { ok: false, reason: improvement.reason };
    }
    return { ok: false, reason: 'DECISION_NOT_IN_CONTRACT' };
  }
  if (improvement.outcome !== 'IMPROVEMENT') return { ok: false, reason: 'DECISION_NOT_IN_CONTRACT' };
  await io.saveCycle(nextCycle);
  return {
    ok: true,
    created: task.created || improvement.created,
    decision,
    guard: 'ALLOWED',
    cycleStatus: 'ACTIVE',
    iteration: folded.iteration,
    verificationTask: null,
    rewordTask: task.task,
    improvementTask: improvement.task,
  };
}
