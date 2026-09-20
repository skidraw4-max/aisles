import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  adjudicateEvidenceBoundary,
  isCrossSourceDivergenceObservation,
  isDeviceRatioToUxClaim,
  isDivergenceAsCausalityClaim,
  isEngagementWithoutBenchmarkClaim,
  isTechStackToCompetitiveClaim,
  suggestReasoningLevelForClaim,
  validateReasoningLevel,
} from './evidence-boundary';
import { buildStubEvidencePack } from './evidence-pack';
import {
  buildEvidenceItems,
  buildMockGa4Evidence,
  gaDbDivergenceHints,
} from './ga4-evidence';
import { adjudicateClaimDeterministic } from './semantic-judge';
import {
  evaluateReferenceCase,
  loadSemanticReferenceCases,
  runSemanticReferenceEvaluation,
} from './semantic-reference-eval';
import type { EvidencePack } from './types';

function packWithGaDb(opts: {
  dbActive?: number | null;
  dbNew?: number | null;
  dbViews?: number | null;
  gaActive?: number;
  gaNew?: number;
  gaViews?: number;
  gaEngagement?: number;
  mobile?: number;
  desktop?: number;
}): EvidencePack {
  const stub = buildStubEvidencePack({
    aggregates: {
      activeUsersLast7d: opts.dbActive ?? 1,
      newUsersLast7d: opts.dbNew ?? 0,
      viewsLast7d: opts.dbViews ?? 6981,
    },
  });
  const mock = buildMockGa4Evidence({
    metrics: {
      activeUsers: opts.gaActive ?? 47,
      sessions: 78,
      screenPageViews: opts.gaViews ?? 221,
      engagedSessions: 32,
      averageSessionDurationSec: 470,
      eventCountByName: {},
    },
    users: {
      totalUsers: null,
      activeUsers: opts.gaActive ?? 47,
      newUsers: opts.gaNew ?? 39,
      returningUsers: null,
    },
    engagement: {
      sessions: 78,
      engagedSessions: 32,
      engagementRate: opts.gaEngagement ?? 0.41,
      averageEngagementTime: null,
    },
    views: { screenPageViews: opts.gaViews ?? 221, topPages: [] },
    device: {
      mobile: opts.mobile ?? 8,
      desktop: opts.desktop ?? 39,
      tablet: null,
    },
  });
  const withGa4 = { ...stub, ga4: mock };
  const divergence = gaDbDivergenceHints(withGa4);
  return {
    ...withGa4,
    evidenceItems: buildEvidenceItems(withGa4),
    docsHints: [...stub.docsHints, ...divergence],
  };
}

describe('v10 evidence boundary helpers', () => {
  it('classifies divergence observation vs causality', () => {
    assert.equal(
      isCrossSourceDivergenceObservation('GA4와 DB의 active user 규모가 크게 다르다.'),
      true,
    );
    assert.equal(
      isDivergenceAsCausalityClaim('GA4 ≠ DB이므로 tracking system failure이다.'),
      true,
    );
    assert.equal(isDeviceRatioToUxClaim('모바일 8 vs 데스크톱 39 → mobile UX problem'), true);
    assert.equal(
      isEngagementWithoutBenchmarkClaim('engagementRate 41%로 engagement가 높다'),
      true,
    );
    assert.equal(
      isTechStackToCompetitiveClaim('Next.js 스택이므로 기술적 경쟁력이 높다'),
      true,
    );
  });

  it('suggests OBSERVATION for CROSS_SOURCE_DIVERGENCE claims', () => {
    assert.equal(
      suggestReasoningLevelForClaim('GA4와 DB 값이 다르다', 'CROSS_SOURCE_DIVERGENCE'),
      'OBSERVATION',
    );
  });

  it('rejects FACT reasoningLevel on causal divergence', () => {
    const v = validateReasoningLevel(
      'signup tracking failure 때문에 GA≠DB이다',
      'FACT',
      'HYPOTHESIS',
    );
    assert.equal(v.ok, false);
    assert.equal(v.leapType, 'HYPOTHESIS_PRESENTED_AS_FACT');
  });
});

describe('v10 adjudicateEvidenceBoundary / deterministic judge', () => {
  it('GA≠DB active → CROSS_SOURCE_DIVERGENCE observation', () => {
    const pack = packWithGaDb({});
    const adj = adjudicateClaimDeterministic(
      'GA4와 DB의 active user 규모가 크게 다르다.',
      pack,
      ['GA_ACTIVE_USERS_7D', 'DB_ACTIVE_USERS_7D'],
    );
    assert.equal(adj.classification.evidenceType, 'CROSS_SOURCE_DIVERGENCE');
    assert.equal(adj.classification.supportLevel, 'SUPPORTED');
    assert.equal(adj.semanticLeap.type, 'NONE');
  });

  it('does not auto-claim tracking failure from divergence', () => {
    const pack = packWithGaDb({});
    const adj = adjudicateClaimDeterministic(
      'GA4 47 vs DB 1 이므로 tracking system failure이다.',
      pack,
      ['GA_ACTIVE_USERS_7D', 'DB_ACTIVE_USERS_7D'],
    );
    assert.equal(adj.semanticLeap.type, 'DIVERGENCE_AS_CAUSALITY');
    assert.equal(adj.classification.evidenceType, 'HYPOTHESIS');
  });

  it('device ratio alone ≠ mobile UX', () => {
    const pack = packWithGaDb({ mobile: 8, desktop: 39 });
    const adj = adjudicateClaimDeterministic(
      '모바일 사용자가 데스크톱보다 적으므로 mobile UX에 문제가 있다.',
      pack,
      ['ga4.device.mobile'],
    );
    assert.equal(adj.semanticLeap.type, 'DEVICE_RATIO_TO_UX');
    assert.equal(adj.classification.supportLevel, 'NOT_SUPPORTED');
  });

  it('engagementRate without benchmark leap', () => {
    const pack = packWithGaDb({ gaEngagement: 0.41 });
    const adj = adjudicateClaimDeterministic(
      'engagementRate 41%이므로 engagement가 높다.',
      pack,
      ['GA_ENGAGEMENT_RATE_7D'],
    );
    assert.equal(adj.semanticLeap.type, 'ENGAGEMENT_WITHOUT_BENCHMARK');
  });

  it('modern stack ≠ competitive advantage', () => {
    const pack = packWithGaDb({});
    const adj = adjudicateClaimDeterministic(
      'Next.js와 Gemini modern stack이므로 기술적 경쟁력이 높다.',
      pack,
      [],
    );
    assert.equal(adj.semanticLeap.type, 'TECH_STACK_TO_COMPETITIVE_ADVANTAGE');
  });

  it('UNKNOWN null ≠ low activity', () => {
    const pack = buildStubEvidencePack({
      aggregates: { activeUsersLast7d: null, viewsLast7d: null },
    });
    const adj = adjudicateClaimDeterministic(
      'activeUsersLast7d가 null이므로 활성 사용자가 매우 적다.',
      pack,
      ['activeUsersLast7d'],
    );
    assert.equal(adj.semanticLeap.type, 'UNKNOWN_AS_NEGATIVE_EVIDENCE');
  });

  it('majority agreement is not evidence', () => {
    const pack = packWithGaDb({});
    const boundary = adjudicateEvidenceBoundary(
      '모든 AI가 같은 의견이므로 confidence를 올린다 (majority agreement as evidence)',
      pack,
    );
    assert.ok(boundary);
    assert.equal(boundary!.semanticLeap.type, 'MAJORITY_AS_EVIDENCE');
  });
});

describe('v10 DIV-001…005 fixtures', () => {
  it('loads DIV cases and all match expected support+leap', () => {
    const cases = loadSemanticReferenceCases().filter((c) => c.id.startsWith('DIV-'));
    assert.equal(cases.length, 5);
    for (const c of cases) {
      const r = evaluateReferenceCase(c);
      assert.equal(r.match.support, true, `${c.id} support`);
      assert.equal(r.match.semanticLeap, true, `${c.id} leap got ${r.actual.semanticLeap}`);
      assert.equal(r.match.classification, true, `${c.id} classification`);
    }
  });

  it('SEM and CASE suites remain green with DIV present', () => {
    const report = runSemanticReferenceEvaluation();
    const sem = report.results.filter((r) => r.id.startsWith('SEM-'));
    const cases = report.results.filter((r) => r.id.startsWith('CASE-'));
    const div = report.results.filter((r) => r.id.startsWith('DIV-'));
    assert.ok(sem.length >= 15);
    assert.equal(cases.length, 10);
    assert.equal(div.length, 5);
    for (const r of [...sem, ...cases, ...div]) {
      assert.equal(r.match.support, true, r.id);
      assert.equal(r.match.semanticLeap, true, r.id);
    }
  });
});
