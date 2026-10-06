/**
 * Starts one re-review after an APPROVED change gate.
 * It does not re-run the gate, an agent, or the decision-cycle loop.
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

const SECRET = /credentialref|private_key|begin private|postgres:\/\/|password|access_token|api_key|\bsk-[a-z0-9]/i;

export type ChangeGateReviewStatus = 'READY' | 'RUNNING' | 'EXECUTED' | 'FAILED';

export type ChangeGateReviewReason = { code: string; message: string };

export type ChangeGateReviewDraft = {
  id: string;
  tenantId: string;
  parentReviewResultId: string;
  changeGateResultId: string;
  agentExecutionId: string;
  improvementTaskId: string;
  evidenceId: string;
  sourceEvidenceId: string;
  reason: ChangeGateReviewReason;
  status: ChangeGateReviewStatus;
  source: 'CHANGE_GATE';
  errorCode: string | null;
  reviewRequestId: string | null;
  reviewResultId: string | null;
  provenance: {
    source: 'CHANGE_GATE';
    parentReviewResultId: string;
    changeGateResultId: string;
    agentExecutionId: string;
    improvementTaskId: string;
    evidenceId: string;
    sourceEvidenceId: string;
  };
  createdAt: string;
  updatedAt: string;
};

export type ChangeGateReviewResult = JuryReviewResult & {
  parentReviewResultId: string;
  changeGateResultId: string;
  agentExecutionId: string;
};

export type ChangeGateReviewFailure =
  | 'UNAUTHENTICATED'
  | 'NO_MEMBERSHIP'
  | 'AMBIGUOUS_MEMBERSHIP'
  | 'STORE_UNAVAILABLE'
  | 'FORBIDDEN'
  | 'TENANT_MISMATCH'
  | 'GATE_NOT_FOUND'
  | 'RE-REVIEW_NOT_APPROVED'
  | 'REASON_REQUIRED'
  | 'CREDENTIAL_IN_REASON'
  | 'REQUEST_NOT_FOUND'
  | 'REVIEW_IN_PROGRESS'
  | 'NOT_READY'
  | 'EVIDENCE_NOT_AVAILABLE'
  | 'SCOPE_NOT_APPROVED'
  | 'REVIEW_CORE_FAILED'
  | 'ARTIFACT_WRITE_FAILED'
  | 'DECISION_NOT_IN_CONTRACT';

type LinkedIds = {
  gate: { id: string; tenantId: string; status: 'GATED' | 'APPROVED' | 'BLOCKED'; executionId: string; improvementTaskId: string } | null;
  executionTenantId: string | null;
  taskTenantId: string | null;
  parent: { id: string; tenantId: string } | null;
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
  sourceEvidenceId: string | null;
  metrics: JuryNormalizedMetric[];
  scopes: readonly { tenantId: string; connectionId: string; status: JuryScopeStatus }[];
};

export type ChangeGateReviewRequestCommand = LinkedIds & {
  userId: string | null;
  memberships: readonly JuryMembership[];
  clientTenantId?: string | null;
  now: string;
  reason: { code?: unknown; message?: unknown } | null;
};

export type ChangeGateReviewRequestTx = {
  findByGate(changeGateResultId: string): Promise<ChangeGateReviewDraft | null>;
  insert(row: ChangeGateReviewDraft): Promise<void>;
  auditRequested(row: ChangeGateReviewDraft): Promise<void>;
};

export type ChangeGateReviewSnapshot = LinkedIds & {
  review: ChangeGateReviewDraft;
  result: ChangeGateReviewResult | null;
};

export type ChangeGateReviewExecIo = {
  load(requestId: string): Promise<ChangeGateReviewSnapshot | null>;
  claimReady(requestId: string): Promise<'CLAIMED' | 'EXECUTED' | 'RUNNING' | 'NOT_READY' | 'MISSING'>;
  core: ProductReviewCore;
  commit(input: { request: JuryReviewRequest; result: ChangeGateReviewResult; review: ChangeGateReviewDraft }): Promise<void>;
  fail(requestId: string, errorCode: 'REVIEW_CORE_FAILED' | 'ARTIFACT_WRITE_FAILED'): Promise<void>;
  audit(
    action: 'REVIEW_REREVIEW_STARTED' | 'REVIEW_REREVIEW_COMPLETED' | 'REVIEW_REREVIEW_FAILED',
    review: ChangeGateReviewDraft,
    result: ChangeGateReviewResult | null,
  ): Promise<void>;
};

function stableId(parts: readonly string[]): string {
  return createHash('sha256').update(parts.join('\n')).digest('hex');
}

function parseReason(value: ChangeGateReviewRequestCommand['reason']): ChangeGateReviewReason | null {
  if (!value || typeof value.code !== 'string' || typeof value.message !== 'string') return null;
  const code = value.code.trim();
  const message = value.message.trim();
  if (!/^[A-Z0-9_]{1,64}$/.test(code) || message.length === 0 || message.length > 500) return null;
  return { code, message };
}

function sameTenant(command: LinkedIds, tenantId: string): boolean {
  return (
    command.gate?.tenantId === tenantId &&
    command.executionTenantId === tenantId &&
    command.taskTenantId === tenantId &&
    command.parent?.tenantId === tenantId &&
    command.evidence?.tenantId === tenantId &&
    command.gate.improvementTaskId.length > 0 &&
    command.gate.executionId.length > 0 &&
    command.parent.id.length > 0
  );
}

function evidenceReady(evidence: NonNullable<LinkedIds['evidence']>, metrics: JuryNormalizedMetric[]): boolean {
  return Boolean(
    evidence.contentHash &&
      evidence.purpose &&
      evidence.periodStart &&
      evidence.periodEnd &&
      evidence.timezone === 'Asia/Seoul' &&
      evidence.connectionId &&
      evidence.adapterKey &&
      evidence.piiExcluded === true &&
      evidence.readOnly === true &&
      metrics.length > 0 &&
      metrics.every((metric) => metric.tenantId === evidence.tenantId && evidence.metricIds.includes(metric.id)),
  );
}

export async function requestChangeGateReReview(
  command: ChangeGateReviewRequestCommand,
  tx: ChangeGateReviewRequestTx,
): Promise<{ ok: false; reason: ChangeGateReviewFailure } | { ok: true; created: boolean; review: ChangeGateReviewDraft }> {
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
  if (!command.gate) return { ok: false, reason: 'GATE_NOT_FOUND' };
  if (!sameTenant(command, actor.tenantId)) return { ok: false, reason: 'TENANT_MISMATCH' };
  if (command.gate.status !== 'APPROVED') return { ok: false, reason: 'RE-REVIEW_NOT_APPROVED' };
  const reason = parseReason(command.reason);
  if (!reason) return { ok: false, reason: 'REASON_REQUIRED' };
  if (SECRET.test(JSON.stringify(reason))) return { ok: false, reason: 'CREDENTIAL_IN_REASON' };
  const existing = await tx.findByGate(command.gate.id);
  if (existing) {
    if (existing.tenantId !== actor.tenantId) return { ok: false, reason: 'TENANT_MISMATCH' };
    return { ok: true, created: false, review: existing };
  }
  const evidence = command.evidence;
  const parent = command.parent;
  if (!evidence || !parent || !command.sourceEvidenceId) return { ok: false, reason: 'EVIDENCE_NOT_AVAILABLE' };
  const row: ChangeGateReviewDraft = {
    id: stableId([actor.tenantId, command.gate.id, 'change-gate-rereview']),
    tenantId: actor.tenantId,
    parentReviewResultId: parent.id,
    changeGateResultId: command.gate.id,
    agentExecutionId: command.gate.executionId,
    improvementTaskId: command.gate.improvementTaskId,
    evidenceId: evidence.id,
    sourceEvidenceId: command.sourceEvidenceId,
    reason,
    status: 'READY',
    source: 'CHANGE_GATE',
    errorCode: null,
    reviewRequestId: null,
    reviewResultId: null,
    provenance: {
      source: 'CHANGE_GATE',
      parentReviewResultId: parent.id,
      changeGateResultId: command.gate.id,
      agentExecutionId: command.gate.executionId,
      improvementTaskId: command.gate.improvementTaskId,
      evidenceId: evidence.id,
      sourceEvidenceId: command.sourceEvidenceId,
    },
    createdAt: command.now,
    updatedAt: command.now,
  };
  await tx.insert(row);
  await tx.auditRequested(row);
  return { ok: true, created: true, review: row };
}

export async function executeChangeGateReReview(
  command: {
    userId: string | null;
    memberships: readonly JuryMembership[];
    clientTenantId?: string | null;
    now: string;
    requestId: string;
    siteName: string;
  },
  io: ChangeGateReviewExecIo,
): Promise<
  | { ok: false; reason: ChangeGateReviewFailure; decision?: string }
  | { ok: true; created: boolean; request: JuryReviewRequest; result: ChangeGateReviewResult; review: ChangeGateReviewDraft }
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
  const snapshot = await io.load(command.requestId);
  if (!snapshot) return { ok: false, reason: 'REQUEST_NOT_FOUND' };
  if (!snapshot.gate) return { ok: false, reason: 'GATE_NOT_FOUND' };
  if (!sameTenant(snapshot, actor.tenantId) || snapshot.review.tenantId !== actor.tenantId) {
    return { ok: false, reason: 'TENANT_MISMATCH' };
  }
  if (snapshot.gate?.status !== 'APPROVED') return { ok: false, reason: 'RE-REVIEW_NOT_APPROVED' };
  if (snapshot.review.status === 'EXECUTED' && snapshot.result) {
    return finished(snapshot.review, snapshot.result, false);
  }
  if (snapshot.review.status === 'RUNNING') return { ok: false, reason: 'REVIEW_IN_PROGRESS' };
  if (snapshot.review.status !== 'READY') return { ok: false, reason: 'NOT_READY' };
  const evidence = snapshot.evidence;
  if (!evidence || !evidenceReady(evidence, snapshot.metrics)) return { ok: false, reason: 'EVIDENCE_NOT_AVAILABLE' };
  const scope = snapshot.scopes.find((row) => row.tenantId === actor.tenantId && row.connectionId === evidence.connectionId);
  if (!scope || scope.status !== 'APPROVED') return { ok: false, reason: 'SCOPE_NOT_APPROVED' };
  if (SECRET.test(JSON.stringify({ evidence, metrics: snapshot.metrics, reason: snapshot.review.reason }))) {
    return { ok: false, reason: 'CREDENTIAL_IN_REASON' };
  }

  const claim = await io.claimReady(command.requestId);
  if (claim === 'EXECUTED') {
    const again = await io.load(command.requestId);
    if (again?.result) return finished(again.review, again.result, false);
    return { ok: false, reason: 'REVIEW_IN_PROGRESS' };
  }
  if (claim === 'RUNNING') return { ok: false, reason: 'REVIEW_IN_PROGRESS' };
  if (claim !== 'CLAIMED') return { ok: false, reason: 'NOT_READY' };
  await io.audit('REVIEW_REREVIEW_STARTED', snapshot.review, null);

  let reading: FrozenCoreReading;
  try {
    const projection = projectEvidenceToPack({
      evidence: { ...evidence, contentHash: evidence.contentHash ?? undefined },
      metrics: snapshot.metrics,
      generatedAt: command.now,
      siteName: command.siteName,
    });
    if (SECRET.test(JSON.stringify(projection.pack))) {
      await io.fail(command.requestId, 'REVIEW_CORE_FAILED');
      await io.audit('REVIEW_REREVIEW_FAILED', snapshot.review, null);
      return { ok: false, reason: 'CREDENTIAL_IN_REASON' };
    }
    reading = await io.core({ rootDir: JURY_PRODUCT_DATA_ROOT, evidence: projection.pack });
  } catch (error) {
    const code = error instanceof Error && error.message === 'ARTIFACT_WRITE_FAILED' ? 'ARTIFACT_WRITE_FAILED' : 'REVIEW_CORE_FAILED';
    await io.fail(command.requestId, code);
    await io.audit('REVIEW_REREVIEW_FAILED', snapshot.review, null);
    if (error instanceof JuryTenantIsolationError) return { ok: false, reason: 'TENANT_MISMATCH' };
    return { ok: false, reason: code };
  }

  if (!(JURY_DECISIONS as readonly string[]).includes(reading.expectedDecision)) {
    await io.fail(command.requestId, 'REVIEW_CORE_FAILED');
    await io.audit('REVIEW_REREVIEW_FAILED', snapshot.review, null);
    return { ok: false, reason: 'DECISION_NOT_IN_CONTRACT', decision: reading.expectedDecision };
  }
  if (
    !(JURY_EVIDENCE_STRENGTHS as readonly string[]).includes(reading.evidenceStrength) ||
    !(JURY_CLAIM_STRENGTHS as readonly string[]).includes(reading.claimStrength)
  ) {
    await io.fail(command.requestId, 'REVIEW_CORE_FAILED');
    await io.audit('REVIEW_REREVIEW_FAILED', snapshot.review, null);
    return { ok: false, reason: 'REVIEW_CORE_FAILED' };
  }

  const requestId = stableId([actor.tenantId, 'change-gate-rereview', snapshot.review.id]);
  const request: JuryReviewRequest = {
    id: requestId,
    tenantId: actor.tenantId,
    connectionId: evidence.connectionId,
    evidenceId: evidence.id,
    reviewType: 'FULL_REVIEW',
    mode: 'AISLE_SELF',
    status: 'COMPLETED',
    coreRootDir: JURY_PRODUCT_DATA_ROOT,
    requestedByUserId: actor.userId,
  };
  const result: ChangeGateReviewResult = {
    id: stableId([requestId, reading.boardRunId]),
    tenantId: actor.tenantId,
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
    changeGateResultId: snapshot.review.changeGateResultId,
    agentExecutionId: snapshot.review.agentExecutionId,
  };
  const review: ChangeGateReviewDraft = {
    ...snapshot.review,
    status: 'EXECUTED',
    reviewRequestId: request.id,
    reviewResultId: result.id,
    updatedAt: command.now,
  };
  try {
    await io.commit({ request, result, review });
  } catch (error) {
    const code = error instanceof Error && error.message === 'ARTIFACT_WRITE_FAILED' ? 'ARTIFACT_WRITE_FAILED' : 'REVIEW_CORE_FAILED';
    await io.fail(command.requestId, code);
    await io.audit('REVIEW_REREVIEW_FAILED', snapshot.review, null);
    return { ok: false, reason: code };
  }
  await io.audit('REVIEW_REREVIEW_COMPLETED', review, result);
  return { ok: true, created: true, request, result, review };
}

function finished(
  review: ChangeGateReviewDraft,
  result: ChangeGateReviewResult,
  created: boolean,
): { ok: true; created: boolean; request: JuryReviewRequest; result: ChangeGateReviewResult; review: ChangeGateReviewDraft } {
  const request: JuryReviewRequest = {
    id: result.reviewRequestId,
    tenantId: result.tenantId,
    connectionId: '',
    evidenceId: review.evidenceId,
    reviewType: 'FULL_REVIEW',
    mode: 'AISLE_SELF',
    status: 'COMPLETED',
    coreRootDir: JURY_PRODUCT_DATA_ROOT,
    requestedByUserId: undefined,
  };
  return { ok: true, created, request, result, review };
}
