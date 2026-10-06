/**
 * Verification re-review execution. The frozen core is injected.
 * Run: node --import tsx --test src/lib/jury-product/verification-rereview.test.ts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { JURY_PRODUCT_DATA_ROOT, type JuryMembership, type JuryNormalizedMetric } from './records';
import { executeVerificationReReview, type ReReviewSnapshot } from './verification-rereview';
import type { FrozenCoreReading } from './review-boundary';

const membership: JuryMembership = {
  id: 'mem-1',
  tenantId: 'tenant-a',
  userId: 'user-1',
  role: 'OWNER',
  createdAt: '2026-10-01T00:00:00.000Z',
};

function metric(partial: Partial<JuryNormalizedMetric> & Pick<JuryNormalizedMetric, 'id' | 'metric' | 'value' | 'availability'>): JuryNormalizedMetric {
  return {
    tenantId: 'tenant-a',
    connectionId: 'conn-1',
    evidenceId: 'ev-1',
    unit: 'COUNT',
    periodStart: '2026-09-24',
    periodEnd: '2026-09-30',
    timezone: 'Asia/Seoul',
    sourceSystem: partial.metric.startsWith('ga4.') ? 'GA4' : 'DATABASE',
    sourceRef: partial.metric,
    collectedAt: '2026-10-01T00:00:00.000Z',
    rawPayloadRef: `evidence-pack:${partial.metric}`,
    adapterKey: 'aisle-self',
    adapterVersion: 'aisle-self-v1',
    ruleId: 'normalize.evidence-pack.aggregate.v1',
    ...partial,
  };
}

function snapshot(partial?: { status?: ReReviewSnapshot['review']['status']; tenantId?: string; taskStatus?: string }): ReReviewSnapshot {
  const tenantId = partial?.tenantId ?? 'tenant-a';
  const metrics = [
    metric({ id: 'm-new', metric: 'newUsersLast7d', value: 0, availability: 'AVAILABLE' }),
    metric({ id: 'm-missing', metric: 'activeUsersLast7d', value: null, availability: 'NOT_MEASURED' }),
    metric({ id: 'm-sales', metric: 'sales', value: 10, availability: 'AVAILABLE' }),
    metric({ id: 'm-alias', metric: 'usersLast7d', value: 9, availability: 'AVAILABLE' }),
    metric({ id: 'm-rate', metric: 'ga4.engagementRate', value: 0.46, availability: 'AVAILABLE', sourceSystem: 'GA4' }),
  ].map((row) => ({ ...row, tenantId }));
  return {
    review: {
      id: 'rereview-1',
      tenantId,
      evidenceId: 'ev-1',
      parentReviewResultId: 'parent-1',
      verificationResultId: 'verification-1',
      decisionTaskId: 'task-1',
      type: 'VERIFICATION_REREVIEW',
      status: partial?.status ?? 'READY',
    },
    parent: {
      id: 'parent-1',
      tenantId,
      expectedDecision: 'VERIFY',
      conflictDetected: true,
      completedAt: '2026-10-01T15:32:34.609Z',
    },
    verification: {
      id: 'verification-1',
      tenantId,
      status: 'INCONCLUSIVE',
      finding: 'UNIQUE_FINDING_TOKEN 어느 데이터 소스의 값이 정확한지 판단할 추가 근거가 없다.',
      fingerprint: 'fp-1',
      reviewResultId: 'parent-1',
      decisionTaskId: 'task-1',
      evidenceId: 'ev-1',
    },
    task: {
      id: 'task-1',
      tenantId,
      status: partial?.taskStatus ?? 'COMPLETED',
      taskType: 'VERIFICATION',
      reviewResultId: 'parent-1',
      evidenceId: 'ev-1',
    },
    evidence: {
      id: 'ev-1',
      tenantId,
      connectionId: 'conn-1',
      purpose: 'aisle-self-observation',
      periodStart: '2026-09-24',
      periodEnd: '2026-09-30',
      timezone: 'Asia/Seoul',
      metricIds: metrics.map((row) => row.id),
      adapterKey: 'aisle-self',
      collectedAt: '2026-10-01T00:00:00.000Z',
      contentHash: 'hash-1',
      piiExcluded: true,
      readOnly: true,
    },
    metrics,
    scopes: [{ tenantId, connectionId: 'conn-1', status: 'APPROVED' }],
  };
}

function reading(decision: string): FrozenCoreReading {
  return {
    boardRunId: 'run-new',
    evidenceStrength: 'strong',
    claimStrength: 'weak',
    conflictDetected: true,
    overclaimDetected: false,
    revisionRequired: false,
    expectedDecision: decision,
    finalSurface: {
      statusSummary: 'stub',
      topProblems: [],
      expectedUserEffect: '',
      risk: '',
      dimensionEvidence: [],
      supportedClaims: [],
      partiallySupportedClaims: [],
      hypotheses: [],
    },
    completedAt: '2026-10-02T01:00:00.000Z',
  };
}

function harness(initial?: ReReviewSnapshot) {
  const state = structuredClone(initial ?? snapshot());
  const originalParent = structuredClone(state.parent);
  const originalVerification = structuredClone(state.verification);
  const originalMetrics = structuredClone(state.metrics);
  const io = {
    coreCalls: 0,
    audits: [] as string[],
    results: [] as Array<{ id: string; parentReviewResultId: string; expectedDecision: string }>,
    tasks: [state.task],
    lastRoot: '',
    lastPack: '',
    async load() {
      return state;
    },
    async claimReady() {
      if (state.review.status === 'EXECUTED') return 'EXECUTED' as const;
      if (state.review.status === 'RUNNING') return 'RUNNING' as const;
      if (state.review.status !== 'READY') return 'NOT_READY' as const;
      state.review.status = 'RUNNING';
      return 'CLAIMED' as const;
    },
    async core(input: { rootDir: typeof JURY_PRODUCT_DATA_ROOT; evidence: unknown }) {
      io.coreCalls += 1;
      io.lastRoot = input.rootDir;
      io.lastPack = JSON.stringify(input.evidence);
      return reading('VERIFY');
    },
    async commit(input: { result: { id: string; parentReviewResultId: string; expectedDecision: string } }) {
      io.results.push(input.result);
      state.review.status = 'EXECUTED';
    },
    async fail() {
      state.review.status = 'FAILED';
    },
    async audit(action: string) {
      io.audits.push(action);
    },
  };
  return { state, originalParent, originalVerification, originalMetrics, io };
}

function command(clientTenantId?: string) {
  return {
    userId: 'user-1' as string | null,
    memberships: [membership],
    clientTenantId: clientTenantId ?? 'tenant-b',
    now: '2026-10-02T02:00:00.000Z',
    requestId: 'rereview-1',
    siteName: 'AIsle',
  };
}

describe('verification re-review execution', () => {
  it('runs a READY request once, stores a child result, and leaves the parent untouched', async () => {
    const { state, originalParent, originalVerification, originalMetrics, io } = harness();
    const outcome = await executeVerificationReReview(command(), io);
    assert.equal(outcome.ok, true);
    if (!outcome.ok) return;
    assert.equal(outcome.result.expectedDecision, 'VERIFY');
    assert.equal(outcome.result.parentReviewResultId, 'parent-1');
    assert.equal(outcome.result.verificationResultId, 'verification-1');
    assert.equal(outcome.result.decisionTaskId, 'task-1');
    assert.equal(outcome.result.reReviewRequestId, 'rereview-1');
    assert.equal(outcome.result.tenantId, 'tenant-a');
    assert.equal(outcome.request.reviewType, 'FULL_REVIEW');
    assert.equal(outcome.request.evidenceId, 'ev-1');
    assert.equal(outcome.request.coreRootDir, JURY_PRODUCT_DATA_ROOT);
    assert.equal(state.review.status, 'EXECUTED');
    assert.equal(io.coreCalls, 1);
    assert.equal(io.lastRoot, JURY_PRODUCT_DATA_ROOT);
    assert.equal(io.lastPack.includes('UNIQUE_FINDING_TOKEN'), false);
    assert.equal(io.lastPack.includes('0.46'), false);
    assert.equal(io.lastPack.includes('"usersLast7d":null'), true);
    assert.equal(originalMetrics[0].value, 0);
    assert.equal(originalMetrics[1].value, null);
    assert.deepEqual(state.parent, originalParent);
    assert.deepEqual(state.verification, originalVerification);
    assert.deepEqual(state.metrics, originalMetrics);
    assert.equal(io.tasks.length, 1);
    assert.deepEqual(io.audits, ['VERIFICATION_REVIEW_STARTED', 'VERIFICATION_REVIEW_COMPLETED']);
    const again = await executeVerificationReReview(command(), io);
    assert.equal(again.ok, false);
    if (!again.ok) assert.equal(again.reason, 'REVIEW_ALREADY_EXECUTED');
    assert.equal(io.coreCalls, 1);
    assert.equal(io.results.length, 1);
  });

  it('does not call the core for a foreign tenant, a running request, or a task that is not completed', async () => {
    const foreign = harness(snapshot({ tenantId: 'tenant-b' }));
    const blocked = await executeVerificationReReview(command(), foreign.io);
    assert.equal(blocked.ok, false);
    if (!blocked.ok) assert.equal(blocked.reason, 'TENANT_MISMATCH');
    assert.equal(foreign.io.coreCalls, 0);

    const running = harness(snapshot({ status: 'RUNNING' }));
    const inProgress = await executeVerificationReReview(command(), running.io);
    assert.equal(inProgress.ok, false);
    if (!inProgress.ok) assert.equal(inProgress.reason, 'REVIEW_IN_PROGRESS');
    assert.equal(running.io.coreCalls, 0);

    const open = harness(snapshot({ taskStatus: 'OPEN' }));
    const notDone = await executeVerificationReReview(command(), open.io);
    assert.equal(notDone.ok, false);
    if (!notDone.ok) assert.equal(notDone.reason, 'TASK_NOT_COMPLETED');
    assert.equal(open.io.coreCalls, 0);

    const mismatch = harness();
    mismatch.state.parent.id = 'other-parent';
    const parent = await executeVerificationReReview(command(), mismatch.io);
    assert.equal(parent.ok, false);
    if (!parent.ok) assert.equal(parent.reason, 'PARENT_MISMATCH');
    assert.equal(mismatch.io.coreCalls, 0);

    const verification = harness();
    verification.state.verification.evidenceId = 'ev-other';
    const brokenLink = await executeVerificationReReview(command(), verification.io);
    assert.equal(brokenLink.ok, false);
    if (!brokenLink.ok) assert.equal(brokenLink.reason, 'VERIFICATION_MISMATCH');
    assert.equal(verification.io.coreCalls, 0);

    const leak = harness();
    leak.state.metrics[0].rawPayloadRef = 'postgres://secret';
    const leaked = await executeVerificationReReview(command(), leak.io);
    assert.equal(leaked.ok, false);
    if (!leaked.ok) assert.equal(leaked.reason, 'CREDENTIAL_LEAK');
    assert.equal(leak.io.coreCalls, 0);
  });

  it('rejects a decision outside the contract without changing the parent or verification result', async () => {
    const { state, originalParent, originalVerification, io } = harness();
    io.core = async (input) => {
      io.coreCalls += 1;
      io.lastRoot = input.rootDir;
      io.lastPack = JSON.stringify(input.evidence);
      return reading('CAVEAT');
    };
    const outcome = await executeVerificationReReview(command(), io);
    assert.equal(outcome.ok, false);
    if (!outcome.ok) assert.equal(outcome.reason, 'DECISION_NOT_IN_CONTRACT');
    assert.equal(state.review.status, 'FAILED');
    assert.equal(io.results.length, 0);
    assert.deepEqual(state.parent, originalParent);
    assert.deepEqual(state.verification, originalVerification);
    assert.equal(io.audits.includes('VERIFICATION_REVIEW_FAILED'), true);
    const source = readFileSync(new URL('./verification-rereview.ts', import.meta.url), 'utf8');
    assert.equal(source.includes('runReviewBoardPipeline'), false);
    assert.equal(source.includes('extractActualFromRun'), false);
    assert.equal(source.includes('data/ai-review-board'), false);
    assert.equal(source.includes('.credentialRef'), false);
    assert.equal(source.includes('credentialRef:'), false);
  });
});
