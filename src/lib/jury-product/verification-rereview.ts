/**
 * Executes one READY verification re-review.
 * The frozen pipeline is injected. This module does not import it.
 */
import { createHash } from 'node:crypto';
import { decideJuryMutation, resolveJuryActor } from './access';
import { JuryTenantIsolationError, projectEvidenceToPack } from './projection';
import {
  JURY_CLAIM_STRENGTHS,
  JURY_CORE_CONTRACT_VERSION,
  JURY_DECISIONS,
  JURY_EVIDENCE_STRENGTHS,
  JURY_PRODUCT_DATA_ROOT,
  type JuryClaimStrength,
  type JuryDecision,
  type JuryEvidenceStrength,
  type JuryMembership,
  type JuryNormalizedMetric,
  type JuryReviewRequest,
  type JuryReviewResult,
  type JuryScopeStatus,
} from './records';
import type { FrozenCoreReading, ProductReviewCore } from './review-boundary';

const SECRET = /credentialRef|private_key|api[_-]?key|BEGIN [A-Z ]*PRIVATE|postgres:\/\//i;

export type ReReviewStatus = 'PENDING' | 'READY' | 'RUNNING' | 'EXECUTED' | 'BLOCKED' | 'FAILED';

export type ReReviewSnapshot = {
  review: {
    id: string;
    tenantId: string;
    evidenceId: string;
    parentReviewResultId: string;
    verificationResultId: string;
    decisionTaskId: string;
    type: 'VERIFICATION_REREVIEW';
    status: ReReviewStatus;
  };
  parent: {
    id: string;
    tenantId: string;
    expectedDecision: string;
    conflictDetected: boolean;
    completedAt: string;
  };
  verification: {
    id: string;
    tenantId: string;
    status: 'RESOLVED' | 'UNRESOLVED' | 'INCONCLUSIVE';
    finding: string;
    fingerprint: string;
    reviewResultId: string;
    decisionTaskId: string;
    evidenceId: string;
  };
  task: {
    id: string;
    tenantId: string;
    status: string;
    taskType: string;
    reviewResultId: string;
    evidenceId: string;
  };
  evidence: {
    id: string;
    tenantId: string;
    connectionId: string;
    purpose: string;
    periodStart: string;
    periodEnd: string;
    timezone: string;
    metricIds: string[];
    adapterKey: string;
    collectedAt: string;
    contentHash: string | null;
    piiExcluded: boolean;
    readOnly: boolean;
  } | null;
  metrics: JuryNormalizedMetric[];
  scopes: readonly { tenantId: string; connectionId: string; status: JuryScopeStatus }[];
};

export type ReReviewResult = JuryReviewResult & {
  parentReviewResultId: string;
  verificationResultId: string;
  decisionTaskId: string;
  reReviewRequestId: string;
};

export type ReReviewFailure =
  | 'UNAUTHENTICATED'
  | 'NO_MEMBERSHIP'
  | 'AMBIGUOUS_MEMBERSHIP'
  | 'STORE_UNAVAILABLE'
  | 'FORBIDDEN'
  | 'TENANT_MISMATCH'
  | 'REQUEST_NOT_FOUND'
  | 'NOT_READY'
  | 'REVIEW_ALREADY_EXECUTED'
  | 'REVIEW_IN_PROGRESS'
  | 'PARENT_MISMATCH'
  | 'VERIFICATION_MISMATCH'
  | 'TASK_NOT_COMPLETED'
  | 'EVIDENCE_MISSING'
  | 'EVIDENCE_IDENTITY_INVALID'
  | 'CREDENTIAL_LEAK'
  | 'SCOPE_NOT_APPROVED'
  | 'DECISION_NOT_IN_CONTRACT'
  | 'CORE_FAILED'
  | 'PERSIST_FAILED';

export type ReReviewIo = {
  load(requestId: string): Promise<ReReviewSnapshot | null>;
  claimReady(requestId: string): Promise<'CLAIMED' | 'EXECUTED' | 'RUNNING' | 'NOT_READY' | 'MISSING'>;
  core: ProductReviewCore;
  commit(input: { request: JuryReviewRequest; result: ReReviewResult }): Promise<void>;
  fail(requestId: string): Promise<void>;
  audit(action: 'VERIFICATION_REVIEW_STARTED' | 'VERIFICATION_REVIEW_COMPLETED' | 'VERIFICATION_REVIEW_FAILED'): Promise<void>;
};

function stableId(parts: readonly string[]): string {
  return createHash('sha256').update(parts.join('\n')).digest('hex');
}

function isDecision(value: string): value is JuryDecision {
  return (JURY_DECISIONS as readonly string[]).includes(value);
}

function isEvidenceStrength(value: string): value is JuryEvidenceStrength {
  return (JURY_EVIDENCE_STRENGTHS as readonly string[]).includes(value);
}

function isClaimStrength(value: string): value is JuryClaimStrength {
  return (JURY_CLAIM_STRENGTHS as readonly string[]).includes(value);
}

function identityOk(evidence: NonNullable<ReReviewSnapshot['evidence']>): boolean {
  return Boolean(
    evidence.contentHash &&
      evidence.purpose &&
      evidence.periodStart &&
      evidence.periodEnd &&
      evidence.timezone === 'Asia/Seoul' &&
      evidence.connectionId &&
      evidence.piiExcluded === true &&
      evidence.readOnly === true,
  );
}

function assess(snapshot: ReReviewSnapshot, tenantId: string): ReReviewFailure | null {
  const { review, parent, verification, task, evidence } = snapshot;
  if (
    review.tenantId !== tenantId ||
    parent.tenantId !== tenantId ||
    verification.tenantId !== tenantId ||
    task.tenantId !== tenantId ||
    evidence?.tenantId !== tenantId
  ) {
    return 'TENANT_MISMATCH';
  }
  if (
    parent.id !== review.parentReviewResultId ||
    verification.reviewResultId !== review.parentReviewResultId ||
    task.reviewResultId !== review.parentReviewResultId
  ) {
    return 'PARENT_MISMATCH';
  }
  if (
    verification.id !== review.verificationResultId ||
    verification.decisionTaskId !== review.decisionTaskId ||
    verification.evidenceId !== review.evidenceId ||
    !['RESOLVED', 'UNRESOLVED', 'INCONCLUSIVE'].includes(verification.status)
  ) {
    return 'VERIFICATION_MISMATCH';
  }
  if (task.id !== review.decisionTaskId || task.taskType !== 'VERIFICATION' || task.evidenceId !== review.evidenceId) {
    return 'VERIFICATION_MISMATCH';
  }
  if (task.status !== 'COMPLETED') return 'TASK_NOT_COMPLETED';
  if (!evidence || evidence.id !== review.evidenceId) return 'EVIDENCE_MISSING';
  if (!identityOk(evidence)) return 'EVIDENCE_IDENTITY_INVALID';
  const scope = snapshot.scopes.find((row) => row.tenantId === tenantId && row.connectionId === evidence.connectionId);
  if (!scope || scope.status !== 'APPROVED') return 'SCOPE_NOT_APPROVED';
  if (SECRET.test(JSON.stringify({ evidence, metrics: snapshot.metrics, finding: verification.finding }))) {
    return 'CREDENTIAL_LEAK';
  }
  if (review.status === 'EXECUTED') return 'REVIEW_ALREADY_EXECUTED';
  if (review.status === 'RUNNING') return 'REVIEW_IN_PROGRESS';
  if (review.status !== 'READY') return 'NOT_READY';
  return null;
}

function childRecords(
  snapshot: ReReviewSnapshot,
  tenantId: string,
  userId: string,
  reading: FrozenCoreReading,
): { request: JuryReviewRequest; result: ReReviewResult } {
  const requestId = stableId([tenantId, 'verification-rereview', snapshot.review.id]);
  const request: JuryReviewRequest = {
    id: requestId,
    tenantId,
    connectionId: snapshot.evidence?.connectionId ?? '',
    evidenceId: snapshot.review.evidenceId,
    reviewType: 'FULL_REVIEW',
    mode: 'AISLE_SELF',
    status: 'COMPLETED',
    coreRootDir: JURY_PRODUCT_DATA_ROOT,
    requestedByUserId: userId,
  };
  const result: ReReviewResult = {
    id: stableId([requestId, reading.boardRunId]),
    tenantId,
    reviewRequestId: requestId,
    boardRunId: reading.boardRunId,
    evidenceStrength: reading.evidenceStrength as JuryEvidenceStrength,
    claimStrength: reading.claimStrength as JuryClaimStrength,
    conflictDetected: reading.conflictDetected,
    overclaimDetected: reading.overclaimDetected,
    revisionRequired: reading.revisionRequired,
    expectedDecision: reading.expectedDecision as JuryDecision,
    finalSurface: reading.finalSurface,
    contractVersion: JURY_CORE_CONTRACT_VERSION,
    completedAt: reading.completedAt,
    parentReviewResultId: snapshot.review.parentReviewResultId,
    verificationResultId: snapshot.review.verificationResultId,
    decisionTaskId: snapshot.review.decisionTaskId,
    reReviewRequestId: snapshot.review.id,
  };
  return { request, result };
}

export async function executeVerificationReReview(
  command: {
    userId: string | null;
    memberships: readonly JuryMembership[];
    clientTenantId?: string | null;
    now: string;
    requestId: string;
    siteName: string;
  },
  io: ReReviewIo,
): Promise<
  | { ok: false; reason: ReReviewFailure; decision?: string }
  | { ok: true; request: JuryReviewRequest; result: ReReviewResult }
> {
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
    resourceTenantId: actor.tenantId,
    clientTenantId: command.clientTenantId,
  });
  if (!allowed.ok) return allowed;

  const snapshot = await io.load(command.requestId);
  if (!snapshot) return { ok: false, reason: 'REQUEST_NOT_FOUND' };
  const gate = assess(snapshot, actor.tenantId);
  if (gate) return { ok: false, reason: gate };

  const claim = await io.claimReady(command.requestId);
  if (claim === 'EXECUTED') return { ok: false, reason: 'REVIEW_ALREADY_EXECUTED' };
  if (claim === 'RUNNING') return { ok: false, reason: 'REVIEW_IN_PROGRESS' };
  if (claim !== 'CLAIMED') return { ok: false, reason: 'NOT_READY' };
  await io.audit('VERIFICATION_REVIEW_STARTED');

  const evidence = snapshot.evidence;
  if (!evidence) return { ok: false, reason: 'EVIDENCE_MISSING' };
  let reading: FrozenCoreReading;
  try {
    const projection = projectEvidenceToPack({
      evidence: { ...evidence, contentHash: evidence.contentHash ?? undefined },
      metrics: snapshot.metrics,
      generatedAt: command.now,
      siteName: command.siteName,
    });
    if (SECRET.test(JSON.stringify(projection.pack))) {
      await io.fail(command.requestId);
      await io.audit('VERIFICATION_REVIEW_FAILED');
      return { ok: false, reason: 'CREDENTIAL_LEAK' };
    }
    reading = await io.core({
      rootDir: JURY_PRODUCT_DATA_ROOT,
      evidence: projection.pack,
    });
  } catch (error) {
    await io.fail(command.requestId);
    await io.audit('VERIFICATION_REVIEW_FAILED');
    if (error instanceof JuryTenantIsolationError) return { ok: false, reason: 'TENANT_MISMATCH' };
    return { ok: false, reason: 'CORE_FAILED' };
  }

  if (!isDecision(reading.expectedDecision)) {
    await io.fail(command.requestId);
    await io.audit('VERIFICATION_REVIEW_FAILED');
    return { ok: false, reason: 'DECISION_NOT_IN_CONTRACT', decision: reading.expectedDecision };
  }
  if (!isEvidenceStrength(reading.evidenceStrength) || !isClaimStrength(reading.claimStrength)) {
    await io.fail(command.requestId);
    await io.audit('VERIFICATION_REVIEW_FAILED');
    return { ok: false, reason: 'CORE_FAILED' };
  }

  const records = childRecords(snapshot, actor.tenantId, actor.userId, reading);
  try {
    await io.commit(records);
  } catch {
    await io.fail(command.requestId);
    await io.audit('VERIFICATION_REVIEW_FAILED');
    return { ok: false, reason: 'PERSIST_FAILED' };
  }
  await io.audit('VERIFICATION_REVIEW_COMPLETED');
  return { ok: true, request: records.request, result: records.result };
}
