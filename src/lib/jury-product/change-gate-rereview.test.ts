/**
 * Change-gate re-review. The frozen core is injected.
 * Run: node --import tsx --test src/lib/jury-product/change-gate-rereview.test.ts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import {
  executeChangeGateReReview,
  requestChangeGateReReview,
  type ChangeGateReviewDraft,
  type ChangeGateReviewExecIo,
  type ChangeGateReviewRequestCommand,
  type ChangeGateReviewRequestTx,
  type ChangeGateReviewResult,
  type ChangeGateReviewSnapshot,
} from './change-gate-rereview';
import { JURY_PRODUCT_DATA_ROOT, type JuryMembership, type JuryNormalizedMetric } from './records';
import type { FrozenCoreReading } from './review-boundary';

const owner: JuryMembership = {
  id: 'mem-1',
  tenantId: 'tenant-a',
  userId: 'user-1',
  role: 'OWNER',
  createdAt: '2026-10-01T00:00:00.000Z',
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

function command(partial?: Partial<ChangeGateReviewRequestCommand>): ChangeGateReviewRequestCommand {
  return {
    userId: 'user-1',
    memberships: [owner],
    clientTenantId: 'forged-tenant',
    now: '2026-10-02T02:23:00.000Z',
    reason: { code: 'APPROVED_CHANGE', message: 'The approved copy change is ready for another review.' },
    gate: {
      id: 'gate-1',
      tenantId: 'tenant-a',
      status: 'APPROVED',
      executionId: 'exec-1',
      improvementTaskId: 'task-1',
    },
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

function requestTx(): ChangeGateReviewRequestTx & { rows: ChangeGateReviewDraft[]; audits: string[] } {
  const rows: ChangeGateReviewDraft[] = [];
  const audits: string[] = [];
  return {
    rows,
    audits,
    async findByGate(id) {
      return rows.find((row) => row.changeGateResultId === id) ?? null;
    },
    async insert(row) {
      rows.push(row);
    },
    async auditRequested() {
      audits.push('REVIEW_REREVIEW_REQUESTED');
    },
  };
}

const reading: FrozenCoreReading = {
  boardRunId: 'run-fixture',
  evidenceStrength: 'moderate',
  claimStrength: 'weak',
  conflictDetected: false,
  overclaimDetected: true,
  revisionRequired: true,
  expectedDecision: 'REWORD',
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
  completedAt: '2026-10-02T02:23:00.000Z',
};

function execIo(review: ChangeGateReviewDraft, source = command()): ChangeGateReviewExecIo & {
  calls: number;
  results: ChangeGateReviewResult[];
  status: ChangeGateReviewDraft['status'];
  audits: string[];
  parent: { id: string; tenantId: string };
  evidenceId: string;
} {
  const state = {
    calls: 0,
    results: [] as ChangeGateReviewResult[],
    status: review.status,
    audits: [] as string[],
    parent: { ...source.parent! },
    evidenceId: source.evidence!.id,
    review,
    result: null as ChangeGateReviewResult | null,
  };
  const load = async (): Promise<ChangeGateReviewSnapshot | null> => ({
    ...source,
    gate: source.gate ? { ...source.gate } : null,
    parent: { ...state.parent },
    review: { ...state.review, status: state.status, reviewRequestId: state.result?.reviewRequestId ?? null, reviewResultId: state.result?.id ?? null },
    result: state.result,
  });
  return {
    get calls() {
      return state.calls;
    },
    results: state.results,
    get status() {
      return state.status;
    },
    audits: state.audits,
    get parent() {
      return state.parent;
    },
    get evidenceId() {
      return state.evidenceId;
    },
    load,
    async claimReady() {
      if (state.status === 'READY') {
        state.status = 'RUNNING';
        return 'CLAIMED';
      }
      if (state.status === 'EXECUTED') return 'EXECUTED';
      if (state.status === 'RUNNING') return 'RUNNING';
      return 'NOT_READY';
    },
    async core() {
      state.calls += 1;
      return reading;
    },
    async commit(input) {
      state.results.push(input.result);
      state.result = input.result;
      state.status = 'EXECUTED';
      state.review = input.review;
    },
    async fail(_id, errorCode) {
      state.status = 'FAILED';
      state.review = { ...state.review, status: 'FAILED', errorCode };
    },
    async audit(action) {
      state.audits.push(action);
    },
  };
}

describe('change gate re-review', () => {
  it('blocks a gated or blocked result and creates one request after approval', async () => {
    const gated = requestTx();
    const blocked = await requestChangeGateReReview(command({ gate: { ...command().gate!, status: 'BLOCKED' } }), gated);
    const waiting = await requestChangeGateReReview(command({ gate: { ...command().gate!, status: 'GATED' } }), gated);
    assert.equal(blocked.ok, false);
    assert.equal(waiting.ok, false);
    if (blocked.ok || waiting.ok) return;
    assert.equal(blocked.reason, 'RE-REVIEW_NOT_APPROVED');
    assert.equal(waiting.reason, 'RE-REVIEW_NOT_APPROVED');
    assert.equal(gated.rows.length, 0);

    const tx = requestTx();
    const created = await requestChangeGateReReview(command(), tx);
    const again = await requestChangeGateReReview(command(), tx);
    assert.equal(created.ok && again.ok, true);
    if (!created.ok || !again.ok) return;
    assert.equal(created.created, true);
    assert.equal(again.created, false);
    assert.equal(created.review.id, again.review.id);
    assert.equal(created.review.status, 'READY');
    assert.equal(created.review.source, 'CHANGE_GATE');
    assert.deepEqual(tx.audits, ['REVIEW_REREVIEW_REQUESTED']);
  });

  it('claims READY once, stores one child result, and returns it again', async () => {
    const requested = await requestChangeGateReReview(command(), requestTx());
    assert.equal(requested.ok, true);
    if (!requested.ok) return;
    const io = execIo(requested.review);
    const first = executeChangeGateReReview(
      { userId: 'user-1', memberships: [owner], clientTenantId: 'forged', now: '2026-10-02T02:23:00.000Z', requestId: requested.review.id, siteName: 'mock-aisle' },
      io,
    );
    const second = executeChangeGateReReview(
      { userId: 'user-1', memberships: [owner], clientTenantId: 'forged', now: '2026-10-02T02:23:00.000Z', requestId: requested.review.id, siteName: 'mock-aisle' },
      io,
    );
    const [ran, raced] = await Promise.all([first, second]);
    assert.equal(io.calls, 1);
    assert.equal(ran.ok || raced.ok, true);
    const done = ran.ok ? ran : raced;
    if (!done.ok) return;
    assert.equal(done.result.parentReviewResultId, 'parent-1');
    assert.equal(done.result.changeGateResultId, 'gate-1');
    assert.equal(done.result.agentExecutionId, 'exec-1');
    assert.equal(done.result.boardRunId, 'run-fixture');
    assert.equal(done.result.expectedDecision, 'REWORD');
    assert.equal(done.result.evidenceStrength, 'moderate');
    assert.equal(done.result.claimStrength, 'weak');
    assert.equal(done.request.reviewType, 'FULL_REVIEW');
    assert.equal(done.request.coreRootDir, JURY_PRODUCT_DATA_ROOT);
    assert.equal(io.parent.id, 'parent-1');
    assert.equal(io.evidenceId, 'ev-new');
    assert.equal(io.results.length, 1);
    const repeat = await executeChangeGateReReview(
      { userId: 'user-1', memberships: [owner], now: '2026-10-02T02:24:00.000Z', requestId: requested.review.id, siteName: 'mock-aisle' },
      io,
    );
    assert.equal(repeat.ok, true);
    if (!repeat.ok) return;
    assert.equal(repeat.created, false);
    assert.equal(repeat.result.id, done.result.id);
    assert.equal(io.calls, 1);
    assert.ok(io.audits.includes('REVIEW_REREVIEW_STARTED'));
    assert.ok(io.audits.includes('REVIEW_REREVIEW_COMPLETED'));
  });

  it('keeps other tenants, secrets, and core failures from writing a result', async () => {
    const foreign = await requestChangeGateReReview(command({ executionTenantId: 'tenant-b' }), requestTx());
    assert.equal(foreign.ok, false);
    if (foreign.ok) return;
    assert.equal(foreign.reason, 'TENANT_MISMATCH');
    const auditor = await requestChangeGateReReview(command({ memberships: [{ ...owner, role: 'VIEWER' }] }), requestTx());
    assert.equal(auditor.ok, false);
    if (auditor.ok) return;
    assert.equal(auditor.reason, 'FORBIDDEN');
    const secret = await requestChangeGateReReview(
      command({ reason: { code: 'SECRET', message: 'postgres://user:password@host/db' } }),
      requestTx(),
    );
    assert.equal(secret.ok, false);
    if (secret.ok) return;
    assert.equal(secret.reason, 'CREDENTIAL_IN_REASON');

    const requested = await requestChangeGateReReview(command(), requestTx());
    assert.equal(requested.ok, true);
    if (!requested.ok) return;
    const io = execIo(requested.review);
    io.core = async () => {
      throw new Error('CORE_DOWN');
    };
    const failed = await executeChangeGateReReview(
      { userId: 'user-1', memberships: [owner], now: '2026-10-02T02:23:00.000Z', requestId: requested.review.id, siteName: 'mock-aisle' },
      io,
    );
    assert.equal(failed.ok, false);
    if (failed.ok) return;
    assert.equal(failed.reason, 'REVIEW_CORE_FAILED');
    assert.equal(io.status, 'FAILED');
    assert.equal(io.results.length, 0);
    assert.ok(io.audits.includes('REVIEW_REREVIEW_FAILED'));

    const source = readFileSync(new URL('./change-gate-rereview.ts', import.meta.url), 'utf8');
    const store = readFileSync(new URL('./change-gate-rereview-store.ts', import.meta.url), 'utf8');
    for (const text of [source, store]) {
      assert.equal(text.includes('evaluateChangeGate'), false);
      assert.equal(text.includes('persistAgentExecution'), false);
      assert.equal(text.includes('recordDecisionCycle'), false);
      assert.equal(text.includes('writeFile'), false);
      assert.equal(text.includes('juryVerificationReview'), false);
    }
    assert.equal(source.includes('runReviewBoardPipeline'), false);
  });
});
