/**
 * Verification resolution. Does not call the review core.
 * Run: node --import tsx --test src/lib/jury-product/verification-resolution.test.ts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import type { DecisionTaskDraft } from './decision-task';
import type { JuryMembership } from './records';
import {
  requestVerificationReReview,
  resolveVerification,
  type VerificationObservation,
  type VerificationWriteTx,
} from './verification-resolution';

const membership: JuryMembership = {
  id: 'mem-1',
  tenantId: 'tenant-a',
  userId: 'user-1',
  role: 'OWNER',
  createdAt: '2026-10-01T00:00:00.000Z',
};

const task = (): DecisionTaskDraft => ({
  id: 'task-1',
  tenantId: 'tenant-a',
  reviewResultId: 'result-1',
  evidenceId: 'ev-1',
  taskType: 'VERIFICATION',
  decision: 'VERIFY',
  title: 'DB와 GA4 측정 차이 검증',
  description: '두 데이터 소스의 측정 기준 또는 수집 결과 차이를 확인한다.',
  reason: 'DB와 GA4의 동일 metric pair에 conflict가 존재함',
  status: 'OPEN',
  createdAt: '2026-10-02T00:00:00.000Z',
  updatedAt: '2026-10-02T00:00:00.000Z',
});

function observation(partial: Partial<VerificationObservation> & Pick<VerificationObservation, 'metric' | 'source' | 'observedValue' | 'availability'>): VerificationObservation {
  return {
    sourceRef: partial.source === 'GA4' ? `ga4.${partial.metric}` : `aggregates.${partial.metric}`,
    observedAt: '2026-10-01T00:00:00.000Z',
    methodology: '저장된 JuryNormalizedMetric만 읽었다.',
    provenance: 'evidence:ev-1',
    ...partial,
  };
}

function command(partial?: {
  task?: DecisionTaskDraft | null;
  resultTenantId?: string;
  evidenceTenantId?: string;
  evidenceId?: string;
  clientTenantId?: string | null;
  conflictDetected?: boolean;
  observations?: VerificationObservation[];
}) {
  const current = partial && 'task' in partial ? (partial.task ?? null) : task();
  return {
    userId: 'user-1' as string | null,
    memberships: [membership],
    clientTenantId: partial?.clientTenantId,
    now: '2026-10-02T01:00:00.000Z',
    task: current,
    reviewResult: {
      id: 'result-1',
      tenantId: partial?.resultTenantId ?? 'tenant-a',
      evidenceId: 'ev-1',
      expectedDecision: 'VERIFY',
      conflictDetected: partial?.conflictDetected ?? true,
      overclaimDetected: false,
      revisionRequired: false,
    },
    evidence: {
      id: partial?.evidenceId ?? 'ev-1',
      tenantId: partial?.evidenceTenantId ?? 'tenant-a',
      contentHash: 'hash-1',
    },
    observations:
      partial?.observations ??
      [
        observation({ source: 'DATABASE', metric: 'newUsersLast7d', observedValue: 0, availability: 'AVAILABLE' }),
        observation({ source: 'GA4', metric: 'ga4.newUsers', observedValue: 4, availability: 'AVAILABLE' }),
        observation({ source: 'DATABASE', metric: 'activeUsersLast7d', observedValue: null, availability: 'NOT_MEASURED' }),
      ],
  };
}

function memory(): VerificationWriteTx & { audits: string[]; coreCalls: number } {
  const state: VerificationWriteTx & { audits: string[]; coreCalls: number } = {
    audits: [],
    coreCalls: 0,
    tasks: [],
    results: [],
    reviews: [],
    async findTask(id) {
      return state.tasks.find((row) => row.id === id) ?? null;
    },
    async saveTask(row) {
      const index = state.tasks.findIndex((item) => item.id === row.id);
      if (index >= 0) state.tasks[index] = row;
      else state.tasks.push(row);
    },
    async findResult(decisionTaskId) {
      return state.results.find((row) => row.decisionTaskId === decisionTaskId) ?? null;
    },
    async insertResult(row) {
      state.results.push(row);
    },
    async findReview(verificationResultId) {
      return state.reviews.find((row) => row.verificationResultId === verificationResultId) ?? null;
    },
    async insertReview(row) {
      state.reviews.push(row);
    },
    async audit(action) {
      state.audits.push(action);
    },
  };
  return state;
}

describe('verification resolution', () => {
  it('records an inconclusive result and completes the task only after that result exists', async () => {
    const tx = memory();
    tx.tasks.push(task());
    const outcome = await resolveVerification(command(), tx);
    assert.equal(outcome.ok, true);
    if (!outcome.ok) return;
    assert.equal(outcome.result.status, 'INCONCLUSIVE');
    assert.equal(outcome.task.status, 'COMPLETED');
    assert.equal(outcome.result.finding.includes('어느 데이터 소스의 값이 정확한지'), true);
    assert.equal(outcome.result.finding.includes('DB가 맞다'), false);
    assert.equal(outcome.result.finding.includes('GA4가 틀'), false);
    assert.equal(outcome.result.finding.includes('코드가 잘못'), false);
    const zero = outcome.result.provenance.observations.find((row) => row.metric === 'newUsersLast7d');
    const missing = outcome.result.provenance.observations.find((row) => row.metric === 'activeUsersLast7d');
    assert.equal(zero?.observedValue, 0);
    assert.equal(missing?.observedValue, null);
    assert.equal(missing?.availability, 'NOT_MEASURED');
    assert.deepEqual(tx.audits, ['VERIFICATION_STARTED', 'VERIFICATION_RESULT_CREATED', 'VERIFICATION_TASK_COMPLETED']);
    assert.equal(tx.coreCalls, 0);
  });

  it('returns the same result for the same task and does not open a second one', async () => {
    const tx = memory();
    tx.tasks.push(task());
    const first = await resolveVerification(command(), tx);
    const second = await resolveVerification(command({ clientTenantId: 'tenant-b' }), tx);
    assert.equal(first.ok && second.ok, true);
    if (!first.ok || !second.ok) return;
    assert.equal(second.created, false);
    assert.equal(second.result.id, first.result.id);
    assert.equal(tx.results.length, 1);
    assert.equal(tx.audits.length, 3);
    const changed = await resolveVerification(
      command({
        observations: [
          observation({ source: 'DATABASE', metric: 'newUsersLast7d', observedValue: 9, availability: 'AVAILABLE' }),
          observation({ source: 'GA4', metric: 'ga4.newUsers', observedValue: 1, availability: 'AVAILABLE' }),
        ],
      }),
      tx,
    );
    assert.equal(changed.ok, false);
    if (!changed.ok) assert.equal(changed.reason, 'VERIFICATION_ALREADY_RECORDED');
    assert.equal(tx.results.length, 1);
  });

  it('blocks another tenant task, review, and evidence', async () => {
    const foreignTx = memory();
    const foreignTask = task();
    foreignTask.tenantId = 'tenant-b';
    foreignTx.tasks.push(foreignTask);
    const foreign = await resolveVerification(command({ task: foreignTask, clientTenantId: 'tenant-a' }), foreignTx);

    const reviewTx = memory();
    reviewTx.tasks.push(task());
    const foreignReview = await resolveVerification(command({ resultTenantId: 'tenant-b' }), reviewTx);

    const evidenceTx = memory();
    evidenceTx.tasks.push(task());
    const foreignEvidence = await resolveVerification(command({ evidenceTenantId: 'tenant-b' }), evidenceTx);

    assert.equal(foreign.ok, false);
    assert.equal(foreignReview.ok, false);
    assert.equal(foreignEvidence.ok, false);
    if (!foreign.ok) assert.equal(foreign.reason, 'TENANT_MISMATCH');
    if (!foreignReview.ok) assert.equal(foreignReview.reason, 'TENANT_MISMATCH');
    if (!foreignEvidence.ok) assert.equal(foreignEvidence.reason, 'TENANT_MISMATCH');
    assert.equal(foreignTx.results.length + reviewTx.results.length + evidenceTx.results.length, 0);
  });

  it('rejects a missing task, a reword task, and a completed task without a result', async () => {
    const tx = memory();
    const missing = await resolveVerification(command({ task: null }), tx);
    const reword = task();
    reword.taskType = 'REWORD';
    reword.decision = 'REWORD';
    tx.tasks.push(reword);
    const wrongType = await resolveVerification(command({ task: reword }), tx);
    const completedTx = memory();
    completedTx.tasks.push({ ...task(), status: 'COMPLETED' });
    const completed = await resolveVerification(command(), completedTx);
    assert.equal(missing.ok, false);
    assert.equal(wrongType.ok, false);
    assert.equal(completed.ok, false);
    if (!missing.ok) assert.equal(missing.reason, 'TASK_NOT_FOUND');
    if (!wrongType.ok) assert.equal(wrongType.reason, 'TASK_TYPE_INVALID');
    if (!completed.ok) assert.equal(completed.reason, 'TASK_ALREADY_COMPLETED');
  });

  it('prepares a READY re-review without calling the core', async () => {
    const tx = memory();
    tx.tasks.push(task());
    const resolved = await resolveVerification(command(), tx);
    assert.equal(resolved.ok, true);
    if (!resolved.ok) return;
    const review = await requestVerificationReReview(
      {
        userId: 'user-1',
        memberships: [membership],
        clientTenantId: 'tenant-b',
        now: '2026-10-02T02:00:00.000Z',
        task: resolved.task,
        result: resolved.result,
        evidence: { id: 'ev-1', tenantId: 'tenant-a' },
        parentReviewResultId: 'result-1',
      },
      tx,
    );
    assert.equal(review.ok, true);
    if (!review.ok) return;
    assert.equal(review.review.status, 'READY');
    assert.equal(review.review.parentReviewResultId, 'result-1');
    assert.equal(review.review.verificationResultId, resolved.result.id);
    assert.equal(review.review.tenantId, 'tenant-a');
    assert.equal(tx.coreCalls, 0);
    assert.equal(tx.audits.includes('VERIFICATION_REVIEW_READY'), true);
    const again = await requestVerificationReReview(
      {
        userId: 'user-1',
        memberships: [membership],
        now: '2026-10-02T03:00:00.000Z',
        task: resolved.task,
        result: resolved.result,
        evidence: { id: 'ev-1', tenantId: 'tenant-a' },
        parentReviewResultId: 'result-1',
      },
      tx,
    );
    assert.equal(again.ok, true);
    if (!again.ok) return;
    assert.equal(again.created, false);
    assert.equal(again.review.id, review.review.id);
    assert.equal(tx.reviews.length, 1);
    const source = readFileSync(new URL('./verification-resolution.ts', import.meta.url), 'utf8');
    assert.equal(source.includes('runReviewBoardPipeline'), false);
    assert.equal(source.includes('extractActualFromRun'), false);
    assert.equal(source.includes('credentialRef'), false);
    assert.equal(JSON.stringify(review).includes('raw-token-value'), false);
  });
});
