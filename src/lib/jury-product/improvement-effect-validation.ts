/**
 * Judges whether a finished re-review shows that the task objective was met.
 * It does not recalculate a Jury decision or write a row.
 */
export const IMPROVEMENT_EFFECT_CODES = ['EFFECTIVE', 'NOT_EFFECTIVE', 'INCONCLUSIVE', 'TENANT_MISMATCH'] as const;

export type ImprovementEffectCode = (typeof IMPROVEMENT_EFFECT_CODES)[number];

export type ImprovementEffectResult =
  | { status: 'EFFECTIVE'; code: 'EFFECTIVE'; reason: 'OBJECTIVE_SUPPORTED' }
  | { status: 'NOT_EFFECTIVE'; code: 'NOT_EFFECTIVE'; reason: 'OBJECTIVE_NOT_SUPPORTED' }
  | { status: 'INCONCLUSIVE'; code: 'INCONCLUSIVE'; reason: 'INSUFFICIENT_EVIDENCE' }
  | { status: 'BLOCKED'; code: 'TENANT_MISMATCH'; reason: 'TENANT_MISMATCH' };

export type ImprovementEffectInput = {
  actorTenantId: string;
  taskTenantId: string;
  reviewTenantId: string;
  objective: string | null;
  decision: 'ACCEPT' | 'VERIFY' | 'REWORD' | null;
  linked: boolean;
  overclaimPersists: boolean | null;
  verificationStatus: 'RESOLVED' | 'INCONCLUSIVE' | 'MISSING' | null;
};

const STRUCTURAL_OBJECTIVE = 'Evidence가 직접 지지하는';

export function evaluateImprovementEffect(input: ImprovementEffectInput): ImprovementEffectResult {
  if (!input.actorTenantId || input.actorTenantId !== input.taskTenantId || input.taskTenantId !== input.reviewTenantId) {
    return { status: 'BLOCKED', code: 'TENANT_MISMATCH', reason: 'TENANT_MISMATCH' };
  }
  const structural = (input.objective ?? '').includes(STRUCTURAL_OBJECTIVE);
  if (!structural || !input.linked || !input.decision) return inconclusive();
  if (input.overclaimPersists === true && (input.decision === 'REWORD' || input.decision === 'ACCEPT')) return notEffective();
  if (input.decision === 'VERIFY') {
    if (input.verificationStatus === 'RESOLVED' && input.overclaimPersists === false) return effective();
    return inconclusive();
  }
  if (input.decision === 'ACCEPT' && input.overclaimPersists === false) return effective();
  return inconclusive();
}

export type StoredEffectRows = {
  actorTenantId: string;
  decision: 'ACCEPT' | 'VERIFY' | 'REWORD';
  task: { tenantId: string; reviewResultId: string; objective: string | null } | null;
  review: {
    tenantId: string;
    parentReviewResultId: string | null;
    overclaimDetected: boolean;
    verificationResultId: string | null;
  } | null;
  verification: { tenantId: string; status: string; reviewResultId: string } | null;
  verifiedReview: { tenantId: string; parentReviewResultId: string | null } | null;
};

export function effectFromStoredRows(rows: StoredEffectRows): ImprovementEffectResult {
  if (!rows.task || !rows.review) return inconclusive();
  if (
    (rows.verification && rows.verification.tenantId !== rows.task.tenantId) ||
    (rows.verifiedReview && rows.verifiedReview.tenantId !== rows.task.tenantId)
  ) {
    return { status: 'BLOCKED', code: 'TENANT_MISMATCH', reason: 'TENANT_MISMATCH' };
  }
  const linked =
    rows.review.parentReviewResultId === rows.task.reviewResultId ||
    (rows.verification?.reviewResultId === rows.review.parentReviewResultId &&
      rows.verifiedReview?.parentReviewResultId === rows.task.reviewResultId);
  return evaluateImprovementEffect({
    actorTenantId: rows.actorTenantId,
    taskTenantId: rows.task.tenantId,
    reviewTenantId: rows.review.tenantId,
    objective: rows.task.objective,
    decision: rows.decision,
    linked: Boolean(linked),
    overclaimPersists: rows.review.overclaimDetected,
    verificationStatus: verificationStatus(rows),
  });
}

function verificationStatus(rows: StoredEffectRows): ImprovementEffectInput['verificationStatus'] {
  if (!rows.review?.verificationResultId) return null;
  if (!rows.verification) return 'MISSING';
  return rows.verification.status === 'RESOLVED' ? 'RESOLVED' : 'INCONCLUSIVE';
}

function effective(): ImprovementEffectResult {
  return { status: 'EFFECTIVE', code: 'EFFECTIVE', reason: 'OBJECTIVE_SUPPORTED' };
}

function notEffective(): ImprovementEffectResult {
  return { status: 'NOT_EFFECTIVE', code: 'NOT_EFFECTIVE', reason: 'OBJECTIVE_NOT_SUPPORTED' };
}

function inconclusive(): ImprovementEffectResult {
  return { status: 'INCONCLUSIVE', code: 'INCONCLUSIVE', reason: 'INSUFFICIENT_EVIDENCE' };
}
