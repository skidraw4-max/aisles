/**
 * Jury product Standard Contract. Does not import Board test glob.
 * Run: node --import tsx --test src/lib/jury-product/jury-product.test.ts
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { FinalReport, ReviewBoardRun } from '../ai-review-board/types';
import { extractActualFromRun } from '../../../tests/ai-review-board/evaluation/runner/compare';
import {
  JURY_AGENT_PATH_FLOOR,
  JURY_CONSOLE_BASE_PATH,
  JURY_CORE_CONTRACT_VERSION,
  JURY_PRODUCT_DATA_ROOT,
  JURY_PROJECTABLE_DB_METRICS,
  JURY_PROJECTABLE_GA4_METRICS,
  agentDeniedPathsCoverFloor,
  canStartAutoLoop,
  isClaimRequired,
  projectEvidenceToPack,
  validateReviewRequestShape,
  type JuryLoopGuardPolicy,
  type JuryNormalizedMetric,
} from './index';

const unsetPolicy: JuryLoopGuardPolicy = {
  maxIterations: null,
  maxRuntimeMs: null,
  maxCostUsd: null,
};

function metric(partial: Partial<JuryNormalizedMetric> & Pick<JuryNormalizedMetric, 'metric' | 'availability' | 'value'>): JuryNormalizedMetric {
  return {
    id: partial.id ?? `m-${partial.metric}`,
    tenantId: partial.tenantId ?? 'tenant-a',
    connectionId: partial.connectionId ?? 'conn-1',
    evidenceId: partial.evidenceId ?? 'ev-1',
    metric: partial.metric,
    value: partial.value,
    unit: partial.unit ?? 'COUNT',
    periodStart: '2026-09-20',
    periodEnd: '2026-09-26',
    timezone: 'Asia/Seoul',
    sourceSystem: partial.sourceSystem ?? 'DATABASE',
    sourceRef: partial.sourceRef ?? 'aggregates',
    collectedAt: '2026-09-26T00:00:00.000Z',
    availability: partial.availability,
    rawPayloadRef: partial.rawPayloadRef ?? 'raw-1',
    adapterKey: 'aisle-self',
    adapterVersion: '0',
    ruleId: 'identity',
  };
}

function emptyFinal(): FinalReport {
  return {
    statusSummary: 'Observed counts in the analysis window.',
    overallTrendScore: null,
    dimensionScores: [],
    topProblems: [],
    improvements: [],
    expectedUserEffect: '',
    expectedDifficulty: '',
    risk: '',
    improvementEvidence: [],
    opinionDifferences: [],
    confidence: 0.5,
    needsFurtherVerification: [],
  };
}

describe('jury product contract constants', () => {
  it('separates product storage and console from the admin board', () => {
    assert.equal(JURY_PRODUCT_DATA_ROOT, 'data/jury-product');
    assert.equal(JURY_CONSOLE_BASE_PATH, '/jury');
    assert.equal(JURY_CORE_CONTRACT_VERSION, 'v9.x-ev020');
  });

  it('does not hardcode loop limits', () => {
    assert.equal(canStartAutoLoop(unsetPolicy), false);
    assert.equal(
      canStartAutoLoop({ maxIterations: 3, maxRuntimeMs: null, maxCostUsd: 1 }),
      false,
    );
    assert.equal(
      canStartAutoLoop({ maxIterations: 3, maxRuntimeMs: 1000, maxCostUsd: 1 }),
      true,
    );
  });

  it('requires claim only for CLAIM_VALIDATION', () => {
    assert.equal(isClaimRequired('CLAIM_VALIDATION'), true);
    assert.equal(isClaimRequired('FULL_REVIEW'), false);
    assert.equal(isClaimRequired('UI_UX_REVIEW'), false);
    assert.deepEqual(validateReviewRequestShape({ reviewType: 'CLAIM_VALIDATION', claim: '  ' }), {
      ok: false,
      reason: 'CLAIM_REQUIRED',
    });
    assert.equal(validateReviewRequestShape({ reviewType: 'CLAIM_VALIDATION', claim: '가입은 0명이다.' }).ok, true);
    assert.equal(validateReviewRequestShape({ reviewType: 'FULL_REVIEW' }).ok, true);
    assert.equal(validateReviewRequestShape({ reviewType: 'UI_UX_REVIEW', claim: null }).ok, true);
  });

  it('keeps the coding-agent floor off v9.x and secrets', () => {
    assert.equal(agentDeniedPathsCoverFloor(['src/app']), false);
    assert.equal(agentDeniedPathsCoverFloor([...JURY_AGENT_PATH_FLOOR, 'src/app']), true);
    assert.ok(JURY_AGENT_PATH_FLOOR.includes('src/lib/ai-review-board'));
    assert.ok(JURY_AGENT_PATH_FLOOR.includes('tests/ai-review-board/evaluation'));
  });
});

describe('EvidencePackProjection', () => {
  it('keeps a measured zero and does not turn null into zero', () => {
    const projected = projectEvidenceToPack({
      generatedAt: '2026-09-26T00:00:00.000Z',
      siteName: 'AIsle',
      evidence: {
        id: 'ev-1',
        tenantId: 'tenant-a',
        connectionId: 'conn-1',
        purpose: 'window check',
        periodStart: '2026-09-20',
        periodEnd: '2026-09-26',
        timezone: 'Asia/Seoul',
        metricIds: ['m-new', 'm-posts'],
        adapterKey: 'aisle-self',
        collectedAt: '2026-09-26T00:00:00.000Z',
      },
      metrics: [
        metric({ id: 'm-new', metric: 'newUsersLast7d', availability: 'AVAILABLE', value: 0 }),
        metric({
          id: 'm-posts',
          metric: 'postsLast7d',
          availability: 'NOT_MEASURED',
          value: null,
        }),
      ],
    });

    assert.equal(projected.pack.aggregates.newUsersLast7d, 0);
    assert.equal(projected.pack.aggregates.postsLast7d, null);
    assert.equal(projected.pack.piiExcluded, true);
    assert.equal(projected.pack.readOnly, true);
    assert.equal(projected.pack.analysisPeriod?.timezone, 'Asia/Seoul');
    assert.equal(projected.nullIsNotZero, true);
  });

  it('drops a non-available number instead of storing it as a measurement', () => {
    const projected = projectEvidenceToPack({
      generatedAt: '2026-09-26T00:00:00.000Z',
      siteName: 'AIsle',
      evidence: {
        id: 'ev-1',
        tenantId: 'tenant-a',
        connectionId: 'conn-1',
        purpose: 'bad null',
        periodStart: '2026-09-20',
        periodEnd: '2026-09-26',
        timezone: 'Asia/Seoul',
        metricIds: ['m-new'],
        adapterKey: 'aisle-self',
        collectedAt: '2026-09-26T00:00:00.000Z',
      },
      metrics: [
        metric({
          id: 'm-new',
          metric: 'newUsersLast7d',
          availability: 'NOT_MEASURED',
          value: 5,
        }),
      ],
    });

    assert.equal(projected.pack.aggregates.newUsersLast7d, null);
    assert.equal(JSON.stringify(projected.pack).includes('5'), false);
    assert.ok(projected.issues.some((issue) => issue.code === 'NON_AVAILABLE_WITH_VALUE'));
  });

  it('withholds metrics that EvidencePack does not score', () => {
    const projected = projectEvidenceToPack({
      generatedAt: '2026-09-26T00:00:00.000Z',
      siteName: 'Shop',
      evidence: {
        id: 'ev-1',
        tenantId: 'tenant-a',
        connectionId: 'conn-1',
        purpose: 'sales',
        periodStart: '2026-09-20',
        periodEnd: '2026-09-26',
        timezone: 'Asia/Seoul',
        metricIds: ['m-sales', 'm-alias', 'm-rate'],
        adapterKey: 'shop',
        collectedAt: '2026-09-26T00:00:00.000Z',
      },
      metrics: [
        metric({
          id: 'm-sales',
          metric: 'sales',
          availability: 'AVAILABLE',
          value: 12800000,
          unit: 'KRW',
          sourceSystem: 'API',
          sourceRef: 'total_sales',
        }),
        metric({
          id: 'm-alias',
          metric: 'usersLast7d',
          availability: 'AVAILABLE',
          value: 3,
        }),
        metric({
          id: 'm-rate',
          metric: 'ga4.engagementRate',
          availability: 'AVAILABLE',
          value: 0.46,
          sourceSystem: 'GA4',
          sourceRef: 'ga4.engagement.engagementRate',
        }),
      ],
    });

    const blob = JSON.stringify(projected.pack);
    assert.equal(blob.includes('12800000'), false);
    assert.equal(blob.includes('sales'), false);
    assert.equal(blob.includes('0.46'), false);
    assert.equal(projected.pack.aggregates.usersLast7d, null);
    assert.equal(projected.pack.ga4, undefined);
    assert.deepEqual(
      projected.withheld.map((row) => row.reason).sort(),
      ['DEPRECATED_ALIAS', 'NOT_IN_EVIDENCE_PACK', 'NOT_IN_EVIDENCE_PACK'].sort(),
    );
    assert.ok(!JURY_PROJECTABLE_DB_METRICS.includes('usersLast7d' as 'newUsersLast7d'));
    assert.ok(!JURY_PROJECTABLE_GA4_METRICS.includes('ga4.engagementRate' as 'ga4.newUsers'));
  });

  it('projects only comparator fields and leaves other timezones off analysisPeriod', () => {
    const projected = projectEvidenceToPack({
      generatedAt: '2026-09-26T00:00:00.000Z',
      siteName: 'Shop',
      evidence: {
        id: 'ev-1',
        tenantId: 'tenant-a',
        connectionId: 'conn-1',
        purpose: 'utc',
        periodStart: '2026-09-20',
        periodEnd: '2026-09-26',
        timezone: 'UTC',
        metricIds: ['m-comments'],
        adapterKey: 'shop',
        collectedAt: '2026-09-26T00:00:00.000Z',
      },
      metrics: [
        metric({
          id: 'm-comments',
          metric: 'commentsLast7d',
          availability: 'AVAILABLE',
          value: 0,
        }),
      ],
    });

    assert.equal(projected.pack.analysisPeriod, undefined);
    assert.equal(projected.periodWithheld, true);
    assert.equal(projected.pack.aggregates.commentsLast7d, 0);
  });

  it('feeds the existing comparator without adding unmapped metrics', () => {
    const projected = projectEvidenceToPack({
      generatedAt: '2026-09-26T00:00:00.000Z',
      siteName: 'AIsle',
      evidence: {
        id: 'ev-1',
        tenantId: 'tenant-a',
        connectionId: 'conn-1',
        purpose: 'conflict',
        periodStart: '2026-09-20',
        periodEnd: '2026-09-26',
        timezone: 'Asia/Seoul',
        metricIds: ['m-db', 'm-ga', 'm-sales'],
        adapterKey: 'aisle-self',
        collectedAt: '2026-09-26T00:00:00.000Z',
      },
      metrics: [
        metric({ id: 'm-db', metric: 'newUsersLast7d', availability: 'AVAILABLE', value: 0 }),
        metric({
          id: 'm-ga',
          metric: 'ga4.newUsers',
          availability: 'AVAILABLE',
          value: 47,
          sourceSystem: 'GA4',
          sourceRef: 'ga4.users.newUsers',
        }),
        metric({
          id: 'm-sales',
          metric: 'sales',
          availability: 'AVAILABLE',
          value: 12800000,
          unit: 'KRW',
          sourceSystem: 'API',
        }),
      ],
    });

    assert.equal(projected.pack.aggregates.newUsersLast7d, 0);
    assert.equal(projected.pack.ga4?.users?.newUsers, 47);
    assert.equal(projected.pack.evidenceItems?.find((item) => item.id === 'GA_NEW_USERS_7D')?.value, 47);
    assert.equal(projected.pack.evidenceItems?.find((item) => item.id === 'DB_NEW_USERS_7D')?.value, 0);

    const actual = extractActualFromRun({
      evidence: projected.pack,
      final: emptyFinal(),
    } as ReviewBoardRun);

    assert.equal(actual.evidenceStrength, 'strong');
    assert.equal(actual.conflictDetected, true);
    assert.equal(actual.overclaimDetected, false);
    assert.equal(actual.revisionRequired, false);
    assert.equal(actual.expectedDecision, 'VERIFY');
    assert.equal(JSON.stringify(projected.pack).includes('12800000'), false);
  });

  it('rejects a metric from another tenant', () => {
    assert.throws(() =>
      projectEvidenceToPack({
        generatedAt: '2026-09-26T00:00:00.000Z',
        siteName: 'AIsle',
        evidence: {
          id: 'ev-1',
          tenantId: 'tenant-a',
          connectionId: 'conn-1',
          purpose: 'isolation',
          periodStart: '2026-09-20',
          periodEnd: '2026-09-26',
          timezone: 'Asia/Seoul',
          metricIds: ['m-new'],
          adapterKey: 'aisle-self',
          collectedAt: '2026-09-26T00:00:00.000Z',
        },
        metrics: [
          metric({
            tenantId: 'tenant-b',
            metric: 'newUsersLast7d',
            availability: 'AVAILABLE',
            value: 1,
          }),
        ],
      }),
    );
  });
});
