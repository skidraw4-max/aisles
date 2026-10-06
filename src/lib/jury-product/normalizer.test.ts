/**
 * Product evidence is derived from an EvidencePack. The pack itself stays unchanged.
 * Run: node --import tsx --test src/lib/jury-product/normalizer.test.ts
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildStubEvidencePack } from '@/lib/ai-review-board/evidence-pack';
import type { EvidencePack } from '@/lib/ai-review-board/types';
import { JURY_AVAILABILITIES } from './records';
import { applyAvailability, buildProductEvidence } from './evidence-builder';

const period = { start: '2026-09-24', end: '2026-09-30', timezone: 'Asia/Seoul' as const };

function pack(overrides?: Parameters<typeof buildStubEvidencePack>[0]): EvidencePack {
  return buildStubEvidencePack({
    generatedAt: '2026-10-01T00:00:00.000Z',
    analysisPeriod: period,
    aggregates: {
      userCount: 0,
      usersLast7d: 7,
      newUsersLast7d: null,
      activeUsersLast7d: 2,
      postCount: 4,
      postsLast7d: 0,
      commentsLast7d: null,
      viewsLast7d: 3,
      totalViews: 0,
      commentCount: 1,
      postsByCategory: { LOUNGE: 9 },
    },
    docsHints: ['sales 1200 were recorded in the hint', 'usersLast7d alias is not a measurement'],
    ...overrides,
  });
}

const input = {
  actorTenantId: 'tenant-a',
  connection: { id: 'conn-a', tenantId: 'tenant-a' },
  clientTenantId: 'tenant-b',
  pack: pack(),
};

describe('availability', () => {
  it('keeps a measured zero and clears every non-available value', () => {
    assert.deepEqual(applyAvailability('AVAILABLE', 0), { availability: 'AVAILABLE', value: 0 });
    for (const availability of JURY_AVAILABILITIES) {
      if (availability === 'AVAILABLE') continue;
      assert.deepEqual(applyAvailability(availability, 0), { availability, value: null });
      assert.deepEqual(applyAvailability(availability, 5), { availability, value: null });
    }
    assert.deepEqual(applyAvailability('AVAILABLE', null), { availability: 'NOT_MEASURED', value: null });
  });
});

describe('product evidence', () => {
  it('maps catalog measurements without promoting hints, aliases, or unsupported shapes', () => {
    const before = JSON.stringify(input.pack);
    const built = buildProductEvidence(input);
    assert.equal(JSON.stringify(input.pack), before);
    assert.equal(built.ok, true);
    if (!built.ok) return;
    const byName = new Map(built.metrics.map((metric) => [metric.metric, metric]));
    assert.equal(byName.get('userCount')?.value, 0);
    assert.equal(byName.get('userCount')?.availability, 'AVAILABLE');
    assert.equal(byName.get('postsLast7d')?.value, 0);
    assert.equal(byName.get('newUsersLast7d')?.value, null);
    assert.equal(byName.get('newUsersLast7d')?.availability, 'NOT_MEASURED');
    assert.equal(byName.get('ga4.activeUsers')?.value, null);
    assert.equal(byName.get('ga4.activeUsers')?.availability, 'NOT_AVAILABLE');
    assert.equal(byName.get('commentsLast7d')?.value, null);
    assert.equal(byName.has('usersLast7d'), false);
    assert.equal(byName.has('sales'), false);
    assert.equal([...byName.keys()].some((name) => name.startsWith('postsByCategory')), false);
    assert.equal([...byName.keys()].includes('engagementRate'), false);
    assert.equal(built.metrics.some((metric) => metric.value === 1200 || metric.value === 7 || metric.value === 9), false);
    assert.equal(built.evidence.tenantId, 'tenant-a');
    assert.equal(built.evidence.timezone, 'Asia/Seoul');
    assert.equal(built.evidence.piiExcluded, true);
    assert.equal(built.evidence.readOnly, true);
    assert.equal(built.metrics.every((metric) => metric.tenantId === 'tenant-a'), true);
    assert.equal(built.metrics.every((metric) => metric.adapterKey === 'aisle-self'), true);
    assert.equal(built.metrics.every((metric) => metric.ruleId.length > 0 && metric.sourceRef.length > 0), true);
    const db = byName.get('newUsersLast7d');
    assert.equal(db?.sourceSystem, 'DATABASE');
    assert.equal(db?.rawValueText, 'null');
    assert.deepEqual(buildProductEvidence(input), built);
  });

  it('maps GA4 catalog values and availability without inventing events', () => {
    const source = pack({
      ga4: {
        available: true,
        propertyId: 'properties/1',
        range: { startDate: period.start, endDate: period.end },
        period,
        fetchedAt: '2026-10-01T00:00:00.000Z',
        error: null,
        metrics: {
          activeUsers: 0,
          sessions: null,
          screenPageViews: 4,
          engagedSessions: 1,
          averageSessionDurationSec: 12,
          eventCountByName: { comment_submit: 0 },
        },
        metricDefinitions: input.pack.metricDefinitions as never,
        users: { totalUsers: 3, activeUsers: 0, newUsers: null, returningUsers: 1 },
        engagement: { sessions: null, engagedSessions: 1, engagementRate: 0.5, averageEngagementTime: 8 },
      },
    });
    const built = buildProductEvidence({ ...input, pack: source });
    assert.equal(built.ok, true);
    if (!built.ok) return;
    const byName = new Map(built.metrics.map((metric) => [metric.metric, metric]));
    assert.equal(byName.get('ga4.activeUsers')?.value, 0);
    assert.equal(byName.get('ga4.activeUsers')?.availability, 'AVAILABLE');
    assert.equal(byName.get('ga4.activeUsers')?.sourceSystem, 'GA4');
    assert.equal(byName.get('ga4.newUsers')?.value, null);
    assert.equal(byName.get('ga4.newUsers')?.availability, 'NOT_MEASURED');
    assert.equal(byName.get('ga4.sessions')?.availability, 'NOT_MEASURED');
    assert.equal(byName.get('ga4.eventCount.comment_submit')?.value, 0);
    assert.equal(byName.has('ga4.eventCount.stance_vote'), false);
    assert.equal(byName.has('ga4.engagementRate'), false);
    assert.equal(built.metrics.some((metric) => metric.value === 0.5), false);

    const denied = buildProductEvidence({
      ...input,
      pack: pack({
        ga4: {
          available: false,
          propertyId: null,
          range: { startDate: period.start, endDate: period.end },
          period,
          fetchedAt: null,
          error: 'denied',
          errorCode: 'PROPERTY_ACCESS',
          metrics: {
            activeUsers: 8,
            sessions: 8,
            screenPageViews: 8,
            engagedSessions: 8,
            averageSessionDurationSec: 8,
            eventCountByName: { comment_submit: 8 },
          },
          metricDefinitions: input.pack.metricDefinitions as never,
        },
      }),
    });
    assert.equal(denied.ok, true);
    if (!denied.ok) return;
    const ga4 = denied.metrics.filter((metric) => metric.sourceSystem === 'GA4');
    assert.equal(ga4.length > 0, true);
    assert.equal(ga4.every((metric) => metric.availability === 'PERMISSION_DENIED' && metric.value === null), true);
    assert.equal(ga4.some((metric) => metric.metric === 'ga4.eventCount.comment_submit'), false);
  });

  it('does not build evidence for another tenant or a non-Seoul period', () => {
    const foreign = buildProductEvidence({
      ...input,
      connection: { id: 'conn-b', tenantId: 'tenant-b' },
      clientTenantId: 'tenant-b',
    });
    const otherZone = buildProductEvidence({
      ...input,
      pack: pack({
        analysisPeriod: { start: period.start, end: period.end, timezone: 'UTC' } as unknown as EvidencePack['analysisPeriod'],
      }),
    });
    assert.equal(foreign.ok, false);
    assert.equal(otherZone.ok, false);
    if (!foreign.ok) assert.equal(foreign.reason, 'TENANT_MISMATCH');
    if (!otherZone.ok) assert.equal(otherZone.reason, 'TIMEZONE_UNSUPPORTED');
  });
});
