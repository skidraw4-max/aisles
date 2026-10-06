/**
 * Resolves a verification task from stored evidence.
 * It does not call the review core or collect new evidence.
 */
import { createHash } from 'node:crypto';
import { decideJuryMutation, resolveJuryActor } from './access';
import { planTaskTransition, type DecisionTaskDraft } from './decision-task';
import type { JuryAvailability, JuryMembership } from './records';

export type VerificationObservation = {
  source: 'DATABASE' | 'GA4';
  sourceRef: string;
  metric: string;
  observedValue: number | null;
  availability: JuryAvailability;
  observedAt: string;
  methodology: string;
  provenance: string;
};

export type VerificationPairNote = {
  dbMetric: string;
  ga4Metric: string;
  dbValue: number | null;
  ga4Value: number | null;
  dbAvailability: JuryAvailability | 'NOT_AVAILABLE';
  ga4Availability: JuryAvailability | 'NOT_AVAILABLE';
  comparable: boolean;
  valuesDiffer: boolean;
};

export type VerificationProvenance = {
  evidenceId: string;
  reviewResultId: string;
  contentHash: string | null;
  methodology: string;
  observations: VerificationObservation[];
  pairs: VerificationPairNote[];
};

export type VerificationResultDraft = {
  id: string;
  tenantId: string;
  decisionTaskId: string;
  reviewResultId: string;
  evidenceId: string;
  status: 'RESOLVED' | 'UNRESOLVED' | 'INCONCLUSIVE';
  finding: string;
  verificationGoal: string;
  provenance: VerificationProvenance;
  fingerprint: string;
  createdAt: string;
  updatedAt: string;
};

export type VerificationReviewDraft = {
  id: string;
  tenantId: string;
  evidenceId: string;
  parentReviewResultId: string;
  verificationResultId: string;
  decisionTaskId: string;
  type: 'VERIFICATION_REREVIEW';
  status: 'PENDING' | 'READY' | 'RUNNING' | 'EXECUTED' | 'BLOCKED' | 'FAILED';
  createdAt: string;
  updatedAt: string;
};

export type VerificationCommand = {
  userId: string | null;
  memberships: readonly JuryMembership[];
  clientTenantId?: string | null;
  now: string;
  task: DecisionTaskDraft | null;
  reviewResult: {
    id: string;
    tenantId: string;
    evidenceId: string;
    expectedDecision: string;
    conflictDetected: boolean;
    overclaimDetected: boolean;
    revisionRequired: boolean;
  };
  evidence: { id: string; tenantId: string; contentHash?: string | null };
  observations: VerificationObservation[];
};

export type VerificationFailure =
  | 'UNAUTHENTICATED'
  | 'NO_MEMBERSHIP'
  | 'AMBIGUOUS_MEMBERSHIP'
  | 'STORE_UNAVAILABLE'
  | 'FORBIDDEN'
  | 'TENANT_MISMATCH'
  | 'TASK_NOT_FOUND'
  | 'TASK_TYPE_INVALID'
  | 'TASK_ALREADY_COMPLETED'
  | 'VERIFICATION_ALREADY_RECORDED'
  | 'RESULT_REQUIRED'
  | 'INVALID_TRANSITION';

const PAIRS = [
  { db: 'newUsersLast7d', ga4: 'ga4.newUsers' },
  { db: 'activeUsersLast7d', ga4: 'ga4.activeUsers' },
  { db: 'viewsLast7d', ga4: 'ga4.screenPageViews' },
] as const;

const INCONCLUSIVE_DIFFERENCE =
  '현재 저장된 Evidence에서는 DB와 GA4 metric pair의 값 차이는 확인되지만, 어느 데이터 소스의 값이 정확한지 판단할 추가 근거가 없다.';

const INCONCLUSIVE_RECORDED =
  'ReviewResult에는 conflict가 기록되어 있지만, 저장된 metric pair만으로는 어느 데이터 소스의 값이 정확한지 판단할 추가 근거가 없다.';

export function observationsFromStoredMetrics(
  metrics: readonly {
    metric: string;
    value: number | null;
    availability: JuryAvailability;
    sourceSystem: string;
    sourceRef: string;
    collectedAt: string;
    ruleId: string;
    evidenceId: string | null;
    rawValueText?: string | null;
  }[],
): VerificationObservation[] {
  const allowed = new Set<string>(PAIRS.flatMap((pair) => [pair.db, pair.ga4]));
  return metrics
    .filter((metric): metric is (typeof metrics)[number] & { sourceSystem: 'DATABASE' | 'GA4' } =>
      allowed.has(metric.metric) && (metric.sourceSystem === 'DATABASE' || metric.sourceSystem === 'GA4'),
    )
    .map((metric) => ({
      source: metric.sourceSystem,
      sourceRef: metric.sourceRef,
      metric: metric.metric,
      observedValue: metric.availability === 'AVAILABLE' ? metric.value : null,
      availability: metric.availability,
      observedAt: metric.collectedAt,
      methodology: `저장된 metric을 읽었다. rule:${metric.ruleId}`,
      provenance: `evidence:${metric.evidenceId ?? 'none'};raw:${metric.rawValueText ?? 'none'}`,
    }));
}

function stableId(parts: readonly string[]): string {
  return createHash('sha256').update(parts.join('\n')).digest('hex');
}

function measured(observation: VerificationObservation | undefined): number | null {
  if (!observation || observation.availability !== 'AVAILABLE') return null;
  return typeof observation.observedValue === 'number' && Number.isFinite(observation.observedValue)
    ? observation.observedValue
    : null;
}

function cleanObservation(observation: VerificationObservation): VerificationObservation {
  const value = measured(observation);
  return { ...observation, observedValue: observation.availability === 'AVAILABLE' ? value : null };
}

export function pairNotes(observations: readonly VerificationObservation[]): VerificationPairNote[] {
  return PAIRS.map((pair) => {
    const db = observations.find((row) => row.source === 'DATABASE' && row.metric === pair.db);
    const ga4 = observations.find((row) => row.source === 'GA4' && row.metric === pair.ga4);
    const dbValue = measured(db);
    const ga4Value = measured(ga4);
    const comparable = dbValue !== null && ga4Value !== null;
    return {
      dbMetric: pair.db,
      ga4Metric: pair.ga4,
      dbValue: db ? (db.availability === 'AVAILABLE' ? dbValue : null) : null,
      ga4Value: ga4 ? (ga4.availability === 'AVAILABLE' ? ga4Value : null) : null,
      dbAvailability: db?.availability ?? 'NOT_AVAILABLE',
      ga4Availability: ga4?.availability ?? 'NOT_AVAILABLE',
      comparable,
      valuesDiffer: comparable && dbValue !== ga4Value,
    };
  });
}

function findingFor(conflictDetected: boolean, pairs: readonly VerificationPairNote[]): {
  status: VerificationResultDraft['status'];
  finding: string;
} {
  if (pairs.some((pair) => pair.valuesDiffer)) {
    return { status: 'INCONCLUSIVE', finding: INCONCLUSIVE_DIFFERENCE };
  }
  if (conflictDetected) {
    return { status: 'INCONCLUSIVE', finding: INCONCLUSIVE_RECORDED };
  }
  return {
    status: 'RESOLVED',
    finding: '저장된 metric pair에서 측정된 값의 충돌은 보이지 않는다. 어느 소스가 맞다는 판정은 아니다.',
  };
}

export type VerificationWriteTx = {
  tasks: DecisionTaskDraft[];
  results: VerificationResultDraft[];
  reviews: VerificationReviewDraft[];
  findTask(id: string): Promise<DecisionTaskDraft | null>;
  saveTask(task: DecisionTaskDraft): Promise<void>;
  findResult(decisionTaskId: string): Promise<VerificationResultDraft | null>;
  insertResult(result: VerificationResultDraft): Promise<void>;
  findReview(verificationResultId: string): Promise<VerificationReviewDraft | null>;
  insertReview(review: VerificationReviewDraft): Promise<void>;
  audit(action: string): Promise<void>;
};

function actorGate(input: {
  userId: string | null;
  memberships: readonly JuryMembership[];
  clientTenantId?: string | null;
  resourceTenantId: string;
}): { ok: true; tenantId: string; userId: string } | { ok: false; reason: VerificationFailure } {
  void input.clientTenantId;
  const actor = resolveJuryActor({
    userId: input.userId,
    memberships: input.memberships,
    clientTenantId: input.clientTenantId,
  });
  if (!actor.ok) return { ok: false, reason: actor.reason };
  const allowed = decideJuryMutation({
    actor,
    action: 'review.start',
    resourceTenantId: input.resourceTenantId,
    clientTenantId: input.clientTenantId,
  });
  if (!allowed.ok) return allowed;
  return { ok: true, tenantId: actor.tenantId, userId: actor.userId };
}

export async function resolveVerification(
  command: VerificationCommand,
  tx: VerificationWriteTx,
): Promise<
  | { ok: false; reason: VerificationFailure }
  | { ok: true; created: boolean; task: DecisionTaskDraft; result: VerificationResultDraft }
> {
  if (!command.task) return { ok: false, reason: 'TASK_NOT_FOUND' };
  const gate = actorGate({
    userId: command.userId,
    memberships: command.memberships,
    clientTenantId: command.clientTenantId,
    resourceTenantId: command.task.tenantId,
  });
  if (!gate.ok) return gate;
  if (
    command.task.tenantId !== gate.tenantId ||
    command.reviewResult.tenantId !== gate.tenantId ||
    command.evidence.tenantId !== gate.tenantId
  ) {
    return { ok: false, reason: 'TENANT_MISMATCH' };
  }
  if (command.reviewResult.evidenceId !== command.evidence.id || command.task.evidenceId !== command.evidence.id) {
    return { ok: false, reason: 'TENANT_MISMATCH' };
  }
  if (command.reviewResult.id !== command.task.reviewResultId) return { ok: false, reason: 'TENANT_MISMATCH' };
  const stored = await tx.findTask(command.task.id);
  if (!stored || stored.tenantId !== gate.tenantId) return { ok: false, reason: 'TASK_NOT_FOUND' };
  if (stored.taskType !== 'VERIFICATION') return { ok: false, reason: 'TASK_TYPE_INVALID' };
  const observations = command.observations.map(cleanObservation);
  const pairs = pairNotes(observations);
  const judged = findingFor(command.reviewResult.conflictDetected, pairs);
  const fingerprint = stableId([stored.id, judged.status, judged.finding, JSON.stringify(pairs)]);
  const existing = await tx.findResult(stored.id);
  if (existing) {
    if (existing.tenantId !== gate.tenantId) return { ok: false, reason: 'TENANT_MISMATCH' };
    if (existing.fingerprint !== fingerprint) return { ok: false, reason: 'VERIFICATION_ALREADY_RECORDED' };
    return { ok: true, created: false, task: stored, result: existing };
  }
  if (stored.status === 'COMPLETED' || stored.status === 'CANCELLED') {
    return { ok: false, reason: 'TASK_ALREADY_COMPLETED' };
  }

  let current = stored;
  if (current.status === 'OPEN') {
    const started = planTaskTransition(current, 'IN_PROGRESS', command.now);
    if (!started.ok) return started;
    current = started.task;
    await tx.saveTask(current);
    await tx.audit('VERIFICATION_STARTED');
  }
  if (current.status === 'BLOCKED') return { ok: false, reason: 'INVALID_TRANSITION' };

  const provenance: VerificationProvenance = {
    evidenceId: command.evidence.id,
    reviewResultId: command.reviewResult.id,
    contentHash: command.evidence.contentHash ?? null,
    methodology: '저장된 JuryNormalizedMetric만 읽었다. 새 수집은 하지 않았다.',
    observations,
    pairs,
  };
  const result: VerificationResultDraft = {
    id: stableId([gate.tenantId, stored.id, 'verification-result']),
    tenantId: gate.tenantId,
    decisionTaskId: stored.id,
    reviewResultId: command.reviewResult.id,
    evidenceId: command.evidence.id,
    status: judged.status,
    finding: judged.finding,
    verificationGoal: stored.description,
    provenance,
    fingerprint,
    createdAt: command.now,
    updatedAt: command.now,
  };
  const completed = planTaskTransition(current, 'COMPLETED', command.now, { verificationResultId: result.id });
  if (!completed.ok) return completed;
  await tx.insertResult(result);
  await tx.saveTask(completed.task);
  await tx.audit('VERIFICATION_RESULT_CREATED');
  await tx.audit('VERIFICATION_TASK_COMPLETED');
  return { ok: true, created: true, task: completed.task, result };
}

export async function requestVerificationReReview(
  command: {
    userId: string | null;
    memberships: readonly JuryMembership[];
    clientTenantId?: string | null;
    now: string;
    task: DecisionTaskDraft;
    result: VerificationResultDraft;
    evidence: { id: string; tenantId: string };
    parentReviewResultId: string;
  },
  tx: VerificationWriteTx,
): Promise<
  | { ok: false; reason: VerificationFailure }
  | { ok: true; created: boolean; review: VerificationReviewDraft }
> {
  const gate = actorGate({
    userId: command.userId,
    memberships: command.memberships,
    clientTenantId: command.clientTenantId,
    resourceTenantId: command.task.tenantId,
  });
  if (!gate.ok) return gate;
  if (
    command.task.tenantId !== gate.tenantId ||
    command.result.tenantId !== gate.tenantId ||
    command.evidence.tenantId !== gate.tenantId
  ) {
    return { ok: false, reason: 'TENANT_MISMATCH' };
  }
  if (command.task.status !== 'COMPLETED') return { ok: false, reason: 'RESULT_REQUIRED' };
  if (command.result.decisionTaskId !== command.task.id) return { ok: false, reason: 'RESULT_REQUIRED' };
  if (command.result.evidenceId !== command.evidence.id || command.task.evidenceId !== command.evidence.id) {
    return { ok: false, reason: 'TENANT_MISMATCH' };
  }
  if (command.result.reviewResultId !== command.parentReviewResultId || command.task.reviewResultId !== command.parentReviewResultId) {
    return { ok: false, reason: 'TENANT_MISMATCH' };
  }
  const existing = await tx.findReview(command.result.id);
  if (existing) {
    if (existing.tenantId !== gate.tenantId) return { ok: false, reason: 'TENANT_MISMATCH' };
    return { ok: true, created: false, review: existing };
  }
  const review: VerificationReviewDraft = {
    id: stableId([gate.tenantId, command.result.id, 'verification-review']),
    tenantId: gate.tenantId,
    evidenceId: command.evidence.id,
    parentReviewResultId: command.parentReviewResultId,
    verificationResultId: command.result.id,
    decisionTaskId: command.task.id,
    type: 'VERIFICATION_REREVIEW',
    status: 'READY',
    createdAt: command.now,
    updatedAt: command.now,
  };
  await tx.insertReview(review);
  await tx.audit('VERIFICATION_REVIEW_READY');
  return { ok: true, created: true, review };
}
