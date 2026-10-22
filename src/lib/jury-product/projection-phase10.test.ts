/**
 * Phase 10 projection contract. Uses the Phase 2 projector unchanged.
 * Run: node --import tsx --test src/lib/jury-product/projection-phase10.test.ts
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildStubEvidencePack } from '../ai-review-board/evidence-pack';
import { GA4_EVIDENCE_METRIC_DEFINITIONS } from '../ai-review-board/ga4-evidence';
import type { EvidencePack } from '../ai-review-board/types';
import { buildProductEvidence } from './evidence-builder';
import {
  JURY_AVAILABILITIES,
  JURY_PROJECTABLE_DB_METRICS,
  JURY_PROJECTABLE_GA4_METRICS,
  projectEvidenceToPack,
  type JuryAvailability,
  type JuryEvidence,
  type JuryNormalizedMetric,
} from './index';

const PERIOD = { start: '2026-09-24', end: '2026-09-30', timezone: 'Asia/Seoul' as const };

function evidence(metricIds: string[], timezone = 'Asia/Seoul'): JuryEvidence {
  return {
    id: 'ev-1',
    tenantId: 'tenant-a',
    connectionId: 'conn-1',
    purpose: 'phase10',
    periodStart: PERIOD.start,
    periodEnd: PERIOD.end,
    timezone,
    metricIds,
    adapterKey: 'aisle-self',
    collectedAt: '2026-10-01T00:00:00.000Z',
  };
}

function metric(
  partial: Partial<JuryNormalizedMetric> & Pick<JuryNormalizedMetric, 'id' | 'metric' | 'availability' | 'value'>,
): JuryNormalizedMetric {
  return {
    tenantId: 'tenant-a',
    connectionId: 'conn-1',
    evidenceId: 'ev-1',
    unit: 'COUNT',
    periodStart: PERIOD.start,
    periodEnd: PERIOD.end,
    timezone: 'Asia/Seoul',
    sourceSystem: partial.sourceSystem ?? (partial.metric.startsWith('ga4.') ? 'GA4' : 'DATABASE'),
    sourceRef: partial.sourceRef ?? partial.metric,
    collectedAt: '2026-10-01T00:00:00.000Z',
    rawPayloadRef: 'evidence-pack:test',
    adapterKey: 'aisle-self',
    adapterVersion: 'aisle-self-v1',
    ruleId: partial.metric.startsWith('ga4.') ? 'normalize.evidence-pack.ga4.v1' : 'normalize.evidence-pack.aggregate.v1',
    ...partial,
  };
}

describe('projection measurements', () => {
  it('keeps a finite measurement, a zero, and a null on separate fields', () => {
    const projected = projectEvidenceToPack({
      generatedAt: '2026-10-01T00:00:00.000Z',
      siteName: 'AIsle',
      evidence: evidence(['m-users', 'm-new', 'm-active']),
      metrics: [
        metric({ id: 'm-users', metric: 'userCount', availability: 'AVAILABLE', value: 14 }),
        metric({ id: 'm-new', metric: 'newUsersLast7d', availability: 'AVAILABLE', value: 0 }),
        metric({ id: 'm-active', metric: 'activeUsersLast7d', availability: 'NOT_MEASURED', value: null }),
      ],
    });
    assert.equal(projected.pack.aggregates.userCount, 14);
    assert.equal(projected.pack.aggregates.newUsersLast7d, 0);
    assert.equal(projected.pack.aggregates.activeUsersLast7d, null);
    assert.equal(projected.pack.analysisPeriod?.timezone, 'Asia/Seoul');
  });

  it('maps every availability to a number only when it is AVAILABLE', () => {
    for (const availability of JURY_AVAILABILITIES) {
      const value = availability === 'AVAILABLE' ? 0 : null;
      const projected = projectEvidenceToPack({
        generatedAt: '2026-10-01T00:00:00.000Z',
        siteName: 'AIsle',
        evidence: evidence(['m-new']),
        metrics: [metric({ id: 'm-new', metric: 'newUsersLast7d', availability, value })],
      });
      assert.equal(projected.pack.aggregates.newUsersLast7d, availability === 'AVAILABLE' ? 0 : null, availability);
      assert.equal(projected.projected[0]?.availability, availability);
    }
  });

  it('drops a number that arrived with a non-available state', () => {
    const blocked: JuryAvailability[] = ['NOT_MEASURED', 'NOT_AVAILABLE', 'PERMISSION_DENIED', 'COLLECTION_FAILED', 'UNSUPPORTED'];
    for (const availability of blocked) {
      const projected = projectEvidenceToPack({
        generatedAt: '2026-10-01T00:00:00.000Z',
        siteName: 'AIsle',
        evidence: evidence(['m-new']),
        metrics: [metric({ id: 'm-new', metric: 'newUsersLast7d', availability, value: 6 })],
      });
      assert.equal(projected.pack.aggregates.newUsersLast7d, null, availability);
      assert.equal(JSON.stringify(projected.pack).includes('"6"') || JSON.stringify(projected.pack).includes(':6'), false);
    }
  });
});

describe('projection catalog', () => {
  it('maps the comparator DB and GA4 fields and withholds everything else', () => {
    const db = JURY_PROJECTABLE_DB_METRICS.map((name, index) =>
      metric({ id: `db-${name}`, metric: name, availability: 'AVAILABLE', value: index }),
    );
    const ga4 = JURY_PROJECTABLE_GA4_METRICS.map((name, index) =>
      metric({
        id: `ga-${name}`,
        metric: name,
        availability: index === 0 ? 'AVAILABLE' : 'NOT_MEASURED',
        value: index === 0 ? 4 : null,
        sourceSystem: 'GA4',
      }),
    );
    const event = metric({
      id: 'ga-event',
      metric: 'ga4.eventCount.comment_submit',
      availability: 'AVAILABLE',
      value: 0,
      sourceSystem: 'GA4',
      sourceRef: 'ga4.metrics.eventCountByName.comment_submit',
    });
    const withheld = [
      metric({ id: 'sales', metric: 'sales', availability: 'AVAILABLE', value: 12800000, unit: 'KRW', sourceSystem: 'API' }),
      metric({ id: 'alias', metric: 'usersLast7d', availability: 'AVAILABLE', value: 9 }),
      metric({ id: 'rate', metric: 'ga4.engagementRate', availability: 'AVAILABLE', value: 0.46, sourceSystem: 'GA4' }),
      metric({ id: 'cats', metric: 'postsByCategory', availability: 'AVAILABLE', value: 3, sourceSystem: 'DATABASE' }),
    ];
    const metrics = [...db, ...ga4, event, ...withheld];
    const projected = projectEvidenceToPack({
      generatedAt: '2026-10-01T00:00:00.000Z',
      siteName: 'AIsle',
      evidence: evidence(metrics.map((row) => row.id)),
      metrics,
    });

    assert.equal(projected.pack.aggregates.userCount, 0);
    assert.equal(projected.pack.aggregates.commentCount, JURY_PROJECTABLE_DB_METRICS.indexOf('commentCount'));
    assert.equal(projected.pack.ga4?.users?.newUsers, 4);
    assert.equal(projected.pack.ga4?.metrics.activeUsers, null);
    assert.equal(projected.pack.ga4?.metrics.eventCountByName.comment_submit, 0);
    assert.equal(projected.pack.ga4?.metrics.eventCountByName.stance_vote, undefined);
    assert.equal(projected.pack.aggregates.usersLast7d, null);
    assert.deepEqual(projected.pack.aggregates.postsByCategory, {});
    const blob = JSON.stringify(projected.pack);
    assert.equal(blob.includes('12800000'), false);
    assert.equal(blob.includes('0.46'), false);
    assert.equal(blob.includes('sales'), false);
    assert.equal(projected.pack.evidenceItems?.find((item) => item.metric === 'engagementRate')?.value ?? null, null);
    assert.deepEqual(
      projected.withheld.map((row) => row.metric).sort(),
      ['ga4.engagementRate', 'postsByCategory', 'sales', 'usersLast7d'].sort(),
    );
    const stub = buildStubEvidencePack();
    assert.deepEqual(Object.keys(projected.pack.aggregates).sort(), Object.keys(stub.aggregates).sort());
  });

  it('rejects another tenant before writing a pack', () => {
    assert.throws(() =>
      projectEvidenceToPack({
        generatedAt: '2026-10-01T00:00:00.000Z',
        siteName: 'AIsle',
        evidence: evidence(['m-new']),
        metrics: [metric({ id: 'm-new', metric: 'newUsersLast7d', availability: 'AVAILABLE', value: 1, tenantId: 'tenant-b' })],
      }),
    );
  });

  it('withholds analysisPeriod unless the evidence timezone is Asia/Seoul', () => {
    const projected = projectEvidenceToPack({
      generatedAt: '2026-10-01T00:00:00.000Z',
      siteName: 'AIsle',
      evidence: evidence(['m-new'], 'UTC'),
      metrics: [metric({ id: 'm-new', metric: 'newUsersLast7d', availability: 'AVAILABLE', value: 0 })],
    });
    assert.equal(projected.periodWithheld, true);
    assert.equal(projected.pack.analysisPeriod, undefined);
    assert.equal(projected.pack.aggregates.newUsersLast7d, 0);
  });
});

describe('projection matches the stored catalog meaning', () => {
  it('round-trips comparator fields from a v9 stub pack and leaves excluded fields out', () => {
    const source: EvidencePack = buildStubEvidencePack({
      generatedAt: '2026-10-01T00:00:00.000Z',
      analysisPeriod: PERIOD,
      site: { name: 'AIsle', corridors: [], stackNotes: [] },
      docsHints: ['매출 12800000'],
      aggregates: {
        userCount: 14,
        usersLast7d: 0,
        newUsersLast7d: 0,
        activeUsersLast7d: null,
        postCount: 3,
        postsLast7d: 1,
        commentsLast7d: 0,
        viewsLast7d: 2,
        totalViews: 9,
        commentCount: 4,
        postsByCategory: { news: 3 },
      },
      ga4: {
        available: true,
        propertyId: null,
        range: { startDate: PERIOD.start, endDate: PERIOD.end },
        period: PERIOD,
        fetchedAt: '2026-10-01T00:00:00.000Z',
        error: null,
        errorCode: null,
        metrics: {
          activeUsers: 5,
          sessions: 0,
          screenPageViews: null,
          engagedSessions: 1,
          averageSessionDurationSec: 12,
          eventCountByName: { comment_submit: 0 },
        },
        metricDefinitions: GA4_EVIDENCE_METRIC_DEFINITIONS,
        users: { totalUsers: null, activeUsers: 5, newUsers: 0, returningUsers: null },
        engagement: { sessions: 0, engagedSessions: 1, engagementRate: 0.46, averageEngagementTime: null },
        views: { screenPageViews: null, topPages: [] },
      },
    });
    const built = buildProductEvidence({
      actorTenantId: 'tenant-a',
      connection: { id: 'conn-1', tenantId: 'tenant-a' },
      clientTenantId: 'tenant-b',
      pack: source,
    });
    assert.equal(built.ok, true);
    if (!built.ok) return;
    const projected = projectEvidenceToPack({
      generatedAt: source.generatedAt,
      siteName: 'AIsle',
      evidence: built.evidence,
      metrics: built.metrics,
    });

    for (const name of JURY_PROJECTABLE_DB_METRICS) {
      assert.equal(projected.pack.aggregates[name], source.aggregates[name], name);
    }
    assert.equal(projected.pack.ga4?.users?.newUsers, 0);
    assert.equal(projected.pack.ga4?.metrics.activeUsers, 5);
    assert.equal(projected.pack.ga4?.metrics.sessions, 0);
    assert.equal(projected.pack.ga4?.metrics.screenPageViews, null);
    assert.equal(projected.pack.ga4?.metrics.engagedSessions, 1);
    assert.equal(projected.pack.ga4?.metrics.averageSessionDurationSec, 12);
    assert.equal(projected.pack.ga4?.metrics.eventCountByName.comment_submit, 0);
    assert.equal(projected.pack.analysisPeriod?.timezone, 'Asia/Seoul');
    assert.equal(projected.pack.aggregates.usersLast7d, null);
    assert.deepEqual(projected.pack.aggregates.postsByCategory, {});
    const blob = JSON.stringify(projected.pack);
    assert.equal(blob.includes('12800000'), false);
    assert.equal(blob.includes('0.46'), false);
    assert.equal(JSON.stringify(source), JSON.stringify(source));
  });
});
