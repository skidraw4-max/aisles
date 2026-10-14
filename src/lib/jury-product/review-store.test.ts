/**
 * Review result persistence. Does not call the core.
 * Run: node --import tsx --test src/lib/jury-product/review-store.test.ts
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { JURY_PRODUCT_DATA_ROOT, type JuryReviewRequest, type JuryReviewResult } from './records';
import { runProductReviewPersist, type ReviewWriteTx } from './review-store';

function request(): JuryReviewRequest {
  return {
    id: 'req-1',
    tenantId: 'tenant-a',
    connectionId: 'conn-1',
    evidenceId: 'ev-1',
    reviewType: 'FULL_REVIEW',
    mode: 'AISLE_SELF',
    status: 'COMPLETED',
    coreRootDir: JURY_PRODUCT_DATA_ROOT,
    requestedByUserId: 'user-1',
  };
}

function result(decision: JuryReviewResult['expectedDecision'] | 'CAVEAT' = 'VERIFY'): JuryReviewResult {
  return {
    id: 'result-1',
    tenantId: 'tenant-a',
    reviewRequestId: 'req-1',
    boardRunId: 'run-stub',
    evidenceStrength: 'strong',
    claimStrength: 'weak',
    conflictDetected: true,
    overclaimDetected: false,
    revisionRequired: false,
    expectedDecision: decision as JuryReviewResult['expectedDecision'],
    finalSurface: {
      statusSummary: 'window observed',
      topProblems: [],
      expectedUserEffect: '',
      risk: '',
      dimensionEvidence: [],
      supportedClaims: [],
      partiallySupportedClaims: [],
      hypotheses: [],
    },
    contractVersion: 'v9.x-ev020',
    completedAt: '2026-10-01T01:00:00.000Z',
  };
}

describe('product review store', () => {
  it('stores the comparator reading and the product artifact reference', async () => {
    const rows: Array<{ request: JuryReviewRequest; result: JuryReviewResult }> = [];
    const tx: ReviewWriteTx = {
      async insert(storedRequest, storedResult) {
        rows.push({ request: storedRequest, result: storedResult });
      },
    };
    const outcome = await runProductReviewPersist({ request: request(), result: result() }, tx);
    assert.equal(outcome.ok, true);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.request.coreRootDir, 'data/jury-product');
    assert.equal(rows[0]?.result.boardRunId, 'run-stub');
    assert.equal(rows[0]?.result.expectedDecision, 'VERIFY');
    assert.equal(JSON.stringify(rows).includes('credentialRef'), false);
  });

  it('does not store a decision outside the contract or another tenant result', async () => {
    let writes = 0;
    const tx: ReviewWriteTx = {
      async insert() {
        writes += 1;
      },
    };
    const foreign = await runProductReviewPersist(
      { request: request(), result: { ...result(), tenantId: 'tenant-b' } },
      tx,
    );
    const caveat = await runProductReviewPersist({ request: request(), result: result('CAVEAT') }, tx);
    assert.equal(foreign.ok, false);
    if (!foreign.ok) assert.equal(foreign.reason, 'TENANT_MISMATCH');
    assert.equal(caveat.ok, false);
    if (!caveat.ok) assert.equal(caveat.reason, 'DECISION_NOT_IN_CONTRACT');
    assert.equal(writes, 0);
  });
});
