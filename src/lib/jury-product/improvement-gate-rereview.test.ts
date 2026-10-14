/**
 * Approved change gate to the existing re-review.
 * Run: node --import tsx --test src/lib/jury-product/improvement-gate-rereview.test.ts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import type { ChangeGateReviewDraft, ChangeGateReviewExecIo, ChangeGateReviewRequestCommand, ChangeGateReviewRequestTx, ChangeGateReviewResult, ChangeGateReviewSnapshot } from './change-gate-rereview';
import { runApprovedGateReReview } from './improvement-gate-rereview';
import type { FrozenCoreReading } from './review-boundary';
import { type JuryMembership, type JuryNormalizedMetric } from './records';

const owner: JuryMembership = {
  id: 'mem-1',
  tenantId: 'tenant-a',
  userId: 'user-1',
  role: 'OWNER',
  createdAt: '2026-10-01T00:00:00.000Z',
};
const member: JuryMembership = { ...owner, id: 'mem-2', userId: 'user-2', role: 'DEVELOPER' };
const auditor: JuryMembership = { ...owner, id: 'mem-3', userId: 'user-3', role: 'VIEWER' };

const reading: FrozenCoreReading = {
  boardRunId: 'run-phase27',
  evidenceStrength: 'strong',
  claimStrength: 'weak',
  conflictDetected: true,
  overclaimDetected: false,
  revisionRequired: false,
  expectedDecision: 'VERIFY',
  finalSurface: {
    statusSummary: 'measured',
    topProblems: [],
    expectedUserEffect: '',
    risk: '',
    dimensionEvidence: [],
    supportedClaims: [],
    partiallySupportedClaims: [],
    hypotheses: [],
  },
  completedAt: '2026-10-02T02:30:00.000Z',
};

function metric(): JuryNormalizedMetric {
  return {
    id: 'm-new',
    tenantId: 'tenant-a',
    connectionId: 'conn-1',
    evidenceId: 'ev-new',
    metric: 'newUsersLast7d',
    value: 0,
    unit: 'COUNT',
    periodStart: '2026-09-24',
    periodEnd: '2026-09-30',
    timezone: 'Asia/Seoul',
    sourceSystem: 'DATABASE',
    sourceRef: 'newUsersLast7d',
    collectedAt: '2026-10-01T00:00:00.000Z',
    availability: 'AVAILABLE',
    rawPayloadRef: 'evidence-pack:newUsersLast7d',
    adapterKey: 'aisle-self',
    adapterVersion: 'aisle-self-v1',
    ruleId: 'normalize.evidence-pack.aggregate.v1',
  };
}

function command(partial?: Partial<ChangeGateReviewRequestCommand>): ChangeGateReviewRequestCommand & { siteName: string } {
  return {
    userId: 'user-1',
    memberships: [owner],
    clientTenantId: 'forged-tenant',
    now: '2026-10-02T02:30:00.000Z',
    siteName: 'mock-aisle',
    reason: { code: 'APPROVED_CHANGE', message: 'The approved copy change is ready for another review.' },
    gate: { id: 'gate-new', tenantId: 'tenant-a', status: 'APPROVED', executionId: 'exec-new', improvementTaskId: 'task-new' },
    executionTenantId: 'tenant-a',
    taskTenantId: 'tenant-a',
    parent: { id: 'parent-1', tenantId: 'tenant-a' },
    evidence: {
      id: 'ev-new',
      tenantId: 'tenant-a',
      connectionId: 'conn-1',
      purpose: 'change-gate-rereview-fixture',
      periodStart: '2026-09-24',
      periodEnd: '2026-09-30',
      timezone: 'Asia/Seoul',
      metricIds: ['m-new'],
      adapterKey: 'aisle-self',
      collectedAt: '2026-10-01T00:00:00.000Z',
      contentHash: 'hash-new',
      piiExcluded: true,
      readOnly: true,
    },
    sourceEvidenceId: 'ev-old',
    metrics: [metric()],
    scopes: [{ tenantId: 'tenant-a', connectionId: 'conn-1', status: 'APPROVED' }],
    ...partial,
  };
}

function harness(seed?: { review: ChangeGateReviewDraft; result: ChangeGateReviewResult }) {
  const reviews: ChangeGateReviewDraft[] = seed ? [seed.review] : [];
  const requests: string[] = seed ? [seed.result.reviewRequestId] : [];
  const results: ChangeGateReviewResult[] = seed ? [seed.result] : [];
  const audits: string[] = [];
  let calls = 0;
  let status: ChangeGateReviewDraft['status'] = seed?.review.status ?? 'READY';
  let result = seed?.result ?? null;
  const parentDecision = 'REWORD';
  const cycle = { id: '14308b4c999ccbe8ca54b7f31da5385385d4073c49bbf2955582a6bb96afb01e', updatedAt: '2026-10-01T16:33:57.676Z', iteration: 2 };
  const execution = { id: 'exec-new', status: 'COMPLETED' as const };
  const gateStatus = { status: 'APPROVED' as const };
  const request: ChangeGateReviewRequestTx = {
    async findByGate(id) {
      return reviews.find((row) => row.changeGateResultId === id) ?? null;
    },
    async insert(row) {
      if (reviews.some((item) => item.changeGateResultId === row.changeGateResultId)) {
        const error = new Error('unique') as Error & { code: string };
        error.code = 'P2002';
        throw error;
      }
      reviews.push(row);
    },
    async auditRequested() {
      audits.push('REVIEW_REREVIEW_REQUESTED');
    },
  };
  const executionIo: ChangeGateReviewExecIo = {
    async load(requestId) {
      const review = reviews.find((row) => row.id === requestId);
      if (!review) return null;
      const source = command();
      const snapshot: ChangeGateReviewSnapshot = {
        ...source,
        review: { ...review, status, reviewResultId: result?.id ?? null, reviewRequestId: result?.reviewRequestId ?? null },
        result,
      };
      return snapshot;
    },
    async claimReady() {
      if (status === 'READY') {
        status = 'RUNNING';
        return 'CLAIMED';
      }
      if (status === 'EXECUTED') return 'EXECUTED';
      if (status === 'RUNNING') return 'RUNNING';
      return 'NOT_READY';
    },
    async core() {
      calls += 1;
      return reading;
    },
    async commit(input) {
      requests.push(input.request.id);
      results.push(input.result);
      result = input.result;
      status = 'EXECUTED';
      const index = reviews.findIndex((row) => row.id === input.review.id);
      if (index >= 0) reviews[index] = input.review;
    },
    async fail(requestId, errorCode) {
      status = 'FAILED';
      const index = reviews.findIndex((row) => row.id === requestId);
      if (index >= 0) reviews[index] = { ...reviews[index], status: 'FAILED', errorCode };
      requests.splice(0, requests.length);
      results.splice(0, results.length);
    },
    async audit(action) {
      audits.push(action);
    },
  };
  return {
    request,
    execution: executionIo,
    reviews,
    requests,
    results,
    audits,
    cycle,
    executionRow: execution,
    gateStatus,
    parentDecision,
    calls: () => calls,
  };
}

function isUnique(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'P2002');
}

describe('approved gate re-review boundary', () => {
  it('runs the existing re-review once for a new approved gate', async () => {
    const io = harness();
    const first = await runApprovedGateReReview(command(), io);
    const second = await runApprovedGateReReview(command(), io);
    assert.equal(first.ok && second.ok, true);
    if (!first.ok || !second.ok) return;
    assert.equal(first.created, true);
    assert.equal(second.created, false);
    assert.equal(first.result.id, second.result.id);
    assert.equal(first.result.expectedDecision, 'VERIFY');
    assert.equal(first.result.parentReviewResultId, 'parent-1');
    assert.equal(io.calls(), 1);
    assert.equal(io.reviews.length, 1);
    assert.equal(io.requests.length, 1);
    assert.equal(io.results.length, 1);
    assert.equal(io.reviews[0]?.source, 'CHANGE_GATE');
    assert.equal(io.reviews[0]?.provenance.source, 'CHANGE_GATE');
    assert.equal(command().evidence?.timezone, 'Asia/Seoul');
    assert.equal(command().evidence?.piiExcluded, true);
    assert.equal(command().evidence?.readOnly, true);
    assert.equal(io.parentDecision, 'REWORD');
    assert.equal(io.cycle.updatedAt, '2026-10-01T16:33:57.676Z');
    assert.equal(io.executionRow.status, 'COMPLETED');
    assert.equal(io.gateStatus.status, 'APPROVED');
    assert.deepEqual(io.audits, ['REVIEW_REREVIEW_REQUESTED', 'REVIEW_REREVIEW_STARTED', 'REVIEW_REREVIEW_COMPLETED']);
  });

  it('refuses gated and blocked results before any review or core call', async () => {
    for (const status of ['GATED', 'BLOCKED'] as const) {
      const io = harness();
      const outcome = await runApprovedGateReReview(
        command({ gate: { ...command().gate!, status } }),
        io,
      );
      assert.equal(outcome.ok, false);
      if (outcome.ok) return;
      assert.equal(outcome.reason, 'RE-REVIEW_NOT_APPROVED');
      assert.equal(io.reviews.length, 0);
      assert.equal(io.requests.length, 0);
      assert.equal(io.results.length, 0);
      assert.equal(io.calls(), 0);
    }
  });

  it('keeps one core call when two approved runs overlap', async () => {
    const io = harness();
    const run = () =>
      runApprovedGateReReview(command(), io).catch((error: unknown) => {
        if (!isUnique(error)) throw error;
        return runApprovedGateReReview(command(), io);
      });
    const [left, right] = await Promise.all([run(), run()]);
    assert.equal(left.ok || right.ok, true);
    assert.equal(io.calls(), 1);
    assert.equal(io.reviews.length, 1);
    assert.equal(io.requests.length, 1);
    assert.equal(io.results.length, 1);
  });

  it('stops other tenants and other roles before a review exists', async () => {
    const foreign = harness();
    const mismatch = await runApprovedGateReReview(command({ executionTenantId: 'tenant-b', gate: { ...command().gate!, tenantId: 'tenant-b' } }), foreign);
    assert.equal(mismatch.ok, false);
    if (!mismatch.ok) assert.equal(mismatch.reason, 'TENANT_MISMATCH');
    assert.equal(foreign.reviews.length, 0);
    assert.equal(foreign.calls(), 0);
    for (const memberships of [[member], [auditor]] as const) {
      const io = harness();
      const denied = await runApprovedGateReReview(command({ userId: memberships[0].userId, memberships }), io);
      assert.equal(denied.ok, false);
      if (!denied.ok) assert.equal(denied.reason, 'FORBIDDEN');
      assert.equal(io.reviews.length, 0);
      assert.equal(io.calls(), 0);
    }
  });

  it('returns an existing review result without calling the core again', async () => {
    const review: ChangeGateReviewDraft = {
      id: '14c4ab107e8d19765a0e9cfdf062cbe399719f0d74f8ccb512c0be24a1d3d61e',
      tenantId: 'tenant-a',
      parentReviewResultId: 'aa734100752dfe92bcfbd8742c6a0049094807ab21e0265fff04a04f6b16ff1e',
      changeGateResultId: '5415b083560819ba7a033c398e8f3ddc9ca27e4187bc00551b9610a3d2d85b6c',
      agentExecutionId: '156e558a16d8c10403246e302295e9a28b41a60e6490f1aadd447b416c0965e2',
      improvementTaskId: '07b86ab1b15030eb2b9bc0cad29dfe5a734af04359524cc4cff036193313535a',
      evidenceId: '71e2b5353c0dc78ab78c09571c8dd6e21877415f8a5ff6f8b5bba63dffbd17c1',
      sourceEvidenceId: 'e59e5b1c8be378d71c90d93cd3eafd5335f4fa874d977a0e7068c93f5c8abd7d',
      reason: { code: 'APPROVED_CHANGE', message: 'existing' },
      status: 'EXECUTED',
      source: 'CHANGE_GATE',
      errorCode: null,
      reviewRequestId: '28760112b188c063ad5df6a60ce6f2767e67e39c897c239428152b27c191d7fc',
      reviewResultId: '3707202563ecae9b38f324a4eefd9243a14bc69420ed6cdda16c4c5794f62e0d',
      provenance: {
        source: 'CHANGE_GATE',
        parentReviewResultId: 'aa734100752dfe92bcfbd8742c6a0049094807ab21e0265fff04a04f6b16ff1e',
        changeGateResultId: '5415b083560819ba7a033c398e8f3ddc9ca27e4187bc00551b9610a3d2d85b6c',
        agentExecutionId: '156e558a16d8c10403246e302295e9a28b41a60e6490f1aadd447b416c0965e2',
        improvementTaskId: '07b86ab1b15030eb2b9bc0cad29dfe5a734af04359524cc4cff036193313535a',
        evidenceId: '71e2b5353c0dc78ab78c09571c8dd6e21877415f8a5ff6f8b5bba63dffbd17c1',
        sourceEvidenceId: 'e59e5b1c8be378d71c90d93cd3eafd5335f4fa874d977a0e7068c93f5c8abd7d',
      },
      createdAt: '2026-10-01T17:30:42.732Z',
      updatedAt: '2026-10-01T17:30:42.732Z',
    };
    const stored: ChangeGateReviewResult = {
      id: review.reviewResultId!,
      tenantId: 'tenant-a',
      reviewRequestId: review.reviewRequestId!,
      boardRunId: 'run-2026-10-01T17-30-42-732Z',
      evidenceStrength: 'strong',
      claimStrength: 'weak',
      conflictDetected: true,
      overclaimDetected: false,
      revisionRequired: false,
      expectedDecision: 'VERIFY',
      finalSurface: reading.finalSurface,
      contractVersion: 'v9.x-ev020',
      completedAt: '2026-10-01T17:30:42.732Z',
      parentReviewResultId: review.parentReviewResultId,
      changeGateResultId: review.changeGateResultId,
      agentExecutionId: review.agentExecutionId,
    };
    const io = harness({ review, result: stored });
    const outcome = await runApprovedGateReReview(
      command({
        gate: { id: review.changeGateResultId, tenantId: 'tenant-a', status: 'APPROVED', executionId: review.agentExecutionId, improvementTaskId: review.improvementTaskId },
      }),
      io,
    );
    assert.equal(outcome.ok, true);
    if (!outcome.ok) return;
    assert.equal(outcome.created, false);
    assert.equal(outcome.result.id, stored.id);
    assert.equal(outcome.result.expectedDecision, 'VERIFY');
    assert.equal(io.calls(), 0);
    assert.equal(io.reviews.length, 1);
    assert.equal(io.results.length, 1);
  });

  it('does not keep a result when the core or the commit fails', async () => {
    const missing = harness();
    const noEvidence = await runApprovedGateReReview(command({ sourceEvidenceId: null }), missing);
    assert.equal(noEvidence.ok, false);
    if (!noEvidence.ok) assert.equal(noEvidence.reason, 'EVIDENCE_NOT_AVAILABLE');
    assert.equal(missing.results.length, 0);
    assert.equal(missing.calls(), 0);

    const failed = harness();
    failed.execution.core = async () => {
      throw new Error('CORE_DOWN');
    };
    const coreDown = await runApprovedGateReReview(command(), failed);
    assert.equal(coreDown.ok, false);
    if (!coreDown.ok) assert.equal(coreDown.reason, 'REVIEW_CORE_FAILED');
    assert.equal(failed.results.length, 0);
    assert.equal(failed.requests.length, 0);

    const source = readFileSync(new URL('./improvement-gate-rereview.ts', import.meta.url), 'utf8');
    const store = readFileSync(new URL('./improvement-gate-rereview-store.ts', import.meta.url), 'utf8');
    for (const text of [source, store]) {
      assert.equal(text.includes('runReviewBoardPipeline'), false);
      assert.equal(text.includes('persistReReviewDecision'), false);
      assert.equal(text.includes('evaluateChangeGate'), false);
      assert.equal(text.includes('persistAgentExecution'), false);
      assert.equal(text.includes('child_process'), false);
    }
  });
});
