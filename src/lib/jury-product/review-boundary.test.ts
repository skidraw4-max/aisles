/**
 * Phase 10 review boundary. The frozen core is not executed.
 * Run: node --import tsx --test src/lib/jury-product/review-boundary.test.ts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { JURY_PRODUCT_DATA_ROOT, type JuryMembership, type JuryNormalizedMetric, type JuryReviewType } from './records';
import { runProductReview, type FrozenCoreReading, type ProductReviewCore } from './review-boundary';

const membership: JuryMembership = {
  id: 'mem-1',
  tenantId: 'tenant-a',
  userId: 'user-1',
  role: 'MEMBER',
  createdAt: '2026-10-01T00:00:00.000Z',
};

function metric(id: string, name: string, value: number | null, availability: JuryNormalizedMetric['availability']): JuryNormalizedMetric {
  return {
    id,
    tenantId: 'tenant-a',
    connectionId: 'conn-1',
    evidenceId: 'ev-1',
    metric: name,
    value,
    unit: 'COUNT',
    periodStart: '2026-09-24',
    periodEnd: '2026-09-30',
    timezone: 'Asia/Seoul',
    sourceSystem: 'DATABASE',
    sourceRef: `aggregates.${name}`,
    collectedAt: '2026-10-01T00:00:00.000Z',
    availability,
    rawPayloadRef: `evidence-pack:aggregates.${name}`,
    adapterKey: 'aisle-self',
    adapterVersion: 'aisle-self-v1',
    ruleId: 'normalize.evidence-pack.aggregate.v1',
  };
}

function command(partial?: {
  reviewType?: JuryReviewType;
  claim?: string | null;
  role?: JuryMembership['role'];
  evidenceTenantId?: string;
  scopeStatus?: 'PROPOSED' | 'APPROVED' | 'REVOKED';
  timezone?: string;
  piiExcluded?: boolean;
  readOnly?: boolean;
  clientTenantId?: string | null;
  userId?: string | null;
  memberships?: JuryMembership[];
}) {
  const evidenceTenantId = partial?.evidenceTenantId ?? 'tenant-a';
  return {
    userId: partial && 'userId' in partial ? partial.userId ?? null : 'user-1',
    memberships: partial?.memberships ?? [{ ...membership, role: partial?.role ?? 'MEMBER' }],
    clientTenantId: partial?.clientTenantId,
    evidence: {
      id: 'ev-1',
      tenantId: evidenceTenantId,
      connectionId: 'conn-1',
      purpose: 'aisle-self-observation',
      periodStart: '2026-09-24',
      periodEnd: '2026-09-30',
      timezone: partial?.timezone ?? 'Asia/Seoul',
      metricIds: ['m-users', 'm-new'],
      adapterKey: 'aisle-self',
      collectedAt: '2026-10-01T00:00:00.000Z',
      piiExcluded: partial?.piiExcluded ?? true,
      readOnly: partial?.readOnly ?? true,
    },
    metrics: [
      metric('m-users', 'userCount', 14, 'AVAILABLE'),
      metric('m-new', 'newUsersLast7d', 0, 'AVAILABLE'),
    ].map((row) => ({ ...row, tenantId: evidenceTenantId })),
    scopes: [
      {
        tenantId: evidenceTenantId,
        connectionId: 'conn-1',
        status: partial?.scopeStatus ?? 'APPROVED',
      },
    ],
    reviewType: partial?.reviewType ?? 'FULL_REVIEW',
    claim: partial?.claim,
    generatedAt: '2026-10-01T00:00:00.000Z',
    siteName: 'AIsle',
  };
}

function reading(decision: string): FrozenCoreReading {
  return {
    boardRunId: 'run-stub',
    evidenceStrength: 'strong',
    claimStrength: 'weak',
    conflictDetected: decision === 'VERIFY',
    overclaimDetected: decision === 'REWORD',
    revisionRequired: decision === 'REWORD',
    expectedDecision: decision,
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
    completedAt: '2026-10-01T01:00:00.000Z',
  };
}

describe('product review boundary', () => {
  it('does not call a core when the scope is still proposed', async () => {
    let calls = 0;
    const core: ProductReviewCore = async () => {
      calls += 1;
      return reading('ACCEPT');
    };
    const outcome = await runProductReview(command({ scopeStatus: 'PROPOSED', clientTenantId: 'tenant-b' }), core);
    assert.equal(outcome.ok, false);
    if (outcome.ok) return;
    assert.equal(outcome.reason, 'SCOPE_NOT_APPROVED');
    assert.equal(calls, 0);
  });

  it('does not review another tenant or an auditor', async () => {
    let calls = 0;
    const core: ProductReviewCore = async () => {
      calls += 1;
      return reading('ACCEPT');
    };
    const foreign = await runProductReview(command({ evidenceTenantId: 'tenant-b' }), core);
    const auditor = await runProductReview(command({ role: 'AUDITOR' }), core);
    assert.equal(foreign.ok, false);
    assert.equal(auditor.ok, false);
    if (!foreign.ok) assert.equal(foreign.reason, 'TENANT_MISMATCH');
    if (!auditor.ok) assert.equal(auditor.reason, 'FORBIDDEN');
    assert.equal(calls, 0);
  });

  it('ignores a client tenant id and refuses a non-Seoul period before the core', async () => {
    let calls = 0;
    const core: ProductReviewCore = async () => {
      calls += 1;
      return reading('ACCEPT');
    };
    const utc = await runProductReview(command({ timezone: 'UTC', clientTenantId: 'tenant-b' }), core);
    assert.equal(utc.ok, false);
    if (!utc.ok) assert.equal(utc.reason, 'TIMEZONE_UNSUPPORTED');
    assert.equal(calls, 0);
  });

  it('requires a claim only for claim validation', async () => {
    let calls = 0;
    const core: ProductReviewCore = async () => {
      calls += 1;
      return reading('ACCEPT');
    };
    const missing = await runProductReview(command({ reviewType: 'CLAIM_VALIDATION', claim: '  ' }), core);
    const full = await runProductReview(command({ reviewType: 'FULL_REVIEW' }));
    const ui = await runProductReview(command({ reviewType: 'UI_UX_REVIEW', claim: null }));
    assert.equal(missing.ok, false);
    if (!missing.ok) assert.equal(missing.reason, 'CLAIM_REQUIRED');
    assert.equal(full.ok, false);
    if (!full.ok) assert.equal(full.reason, 'REVIEW_NOT_EXECUTED');
    assert.equal(ui.ok, false);
    if (!ui.ok) assert.equal(ui.reason, 'REVIEW_NOT_EXECUTED');
    assert.equal(calls, 0);
  });

  it('stores only ACCEPT, VERIFY, and REWORD from an injected reading', async () => {
    const roots: string[] = [];
    const core: ProductReviewCore = async (input) => {
      roots.push(input.rootDir);
      assert.equal(input.evidence.aggregates.newUsersLast7d, 0);
      assert.equal(input.evidence.aggregates.userCount, 14);
      assert.equal(input.evidence.analysisPeriod?.timezone, 'Asia/Seoul');
      return reading('VERIFY');
    };
    const outcome = await runProductReview(
      command({ claim: '가입은 0명이다.', reviewType: 'CLAIM_VALIDATION', clientTenantId: 'tenant-b' }),
      core,
    );
    assert.equal(outcome.ok, true);
    if (!outcome.ok) return;
    assert.equal(outcome.result.expectedDecision, 'VERIFY');
    assert.equal(outcome.result.conflictDetected, true);
    assert.equal(outcome.result.tenantId, 'tenant-a');
    assert.equal(outcome.request.coreRootDir, JURY_PRODUCT_DATA_ROOT);
    assert.equal(outcome.request.claim, '가입은 0명이다.');
    assert.deepEqual(roots, [JURY_PRODUCT_DATA_ROOT]);

    const caveat = await runProductReview(command(), async () => reading('CAVEAT'));
    assert.equal(caveat.ok, false);
    if (!caveat.ok) {
      assert.equal(caveat.reason, 'DECISION_NOT_IN_CONTRACT');
      assert.equal(caveat.decision, 'CAVEAT');
    }
  });

  it('blocks another tenant scope and keeps the pipeline call on the product root', async () => {
    let calls = 0;
    const core: ProductReviewCore = async () => {
      calls += 1;
      return reading('ACCEPT');
    };
    const foreignScope = await runProductReview(
      {
        ...command(),
        scopes: [{ tenantId: 'tenant-b', connectionId: 'conn-1', status: 'APPROVED' }],
        clientTenantId: 'tenant-b',
      },
      core,
    );
    assert.equal(foreignScope.ok, false);
    if (!foreignScope.ok) assert.equal(foreignScope.reason, 'SCOPE_NOT_APPROVED');
    assert.equal(calls, 0);

    const boundary = readFileSync(new URL('./review-boundary.ts', import.meta.url), 'utf8');
    const coreSource = readFileSync(new URL('./review-core.ts', import.meta.url), 'utf8');
    const storeSource = readFileSync(new URL('./review-store.ts', import.meta.url), 'utf8');
    assert.equal(boundary.includes('runReviewBoardPipeline'), false);
    assert.equal(boundary.includes('data/ai-review-board'), false);
    assert.equal(boundary.includes('prisma'), false);
    assert.equal(boundary.includes('credentialRef'), false);
    assert.equal(coreSource.includes('REVIEW_CORE_NOT_IN_PHASE'), false);
    assert.match(coreSource, /runReviewBoardPipeline/);
    assert.match(coreSource, /extractActualFromRun/);
    assert.match(coreSource, /JURY_PRODUCT_DATA_ROOT/);
    assert.equal(coreSource.includes('data/ai-review-board'), false);
    assert.equal(coreSource.includes('credentialRef'), false);
    assert.equal(storeSource.includes('credentialRef'), false);
    assert.equal(storeSource.includes('data/ai-review-board'), false);
  });
});
