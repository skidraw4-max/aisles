/**
 * Run: node --import tsx --test src/lib/ai-review-board/ga4-evidence.test.ts
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildStubEvidencePack } from './evidence-pack';
import { formatEvidencePackForPrompt } from './format-evidence-prompt';
import {
  isKnownEvidenceRef,
  usesUnknownAsNegativeEvidence,
} from './claim-calibration';
import {
  GA4_EVIDENCE_METRIC_DEFINITIONS,
  TRACKED_GA4_EVENT_NAMES,
  attachGa4Evidence,
  buildEvidenceItems,
  buildMockGa4Evidence,
  emptyGa4EvidenceUnavailable,
  gaDbDivergenceHints,
  parseGa4ServiceAccountJson,
  resolveReviewBoardPeriod,
  summarizeGa4RowsToEvidence,
} from './ga4-evidence';

describe('GA4 evidence definitions', () => {
  it('forbids conflating GA activeUsers with DB activeUsersLast7d', () => {
    const d = GA4_EVIDENCE_METRIC_DEFINITIONS.activeUsers.toLowerCase();
    assert.match(d, /ga4/);
    assert.match(d, /activeuserslast7d|db/);
    assert.match(d, /not|≠|다름|혼동|동일시 금지/);
  });

  it('tracks comment_submit and stance_vote among known events', () => {
    assert.ok(TRACKED_GA4_EVENT_NAMES.includes('comment_submit'));
    assert.ok(TRACKED_GA4_EVENT_NAMES.includes('stance_vote'));
  });
});

describe('resolveReviewBoardPeriod', () => {
  it('returns Asia/Seoul 7-day window ending yesterday', () => {
    const period = resolveReviewBoardPeriod(new Date('2026-09-17T15:00:00Z'));
    assert.equal(period.timezone, 'Asia/Seoul');
    assert.match(period.start, /^\d{4}-\d{2}-\d{2}$/);
    assert.match(period.end, /^\d{4}-\d{2}-\d{2}$/);
    assert.notEqual(period.start, period.end);
    // end should be before "today" in Seoul for that instant
    assert.ok(period.end < '2026-09-18');
  });
});

describe('parseGa4ServiceAccountJson', () => {
  it('parses raw JSON', () => {
    const raw = JSON.stringify({
      type: 'service_account',
      client_email: 'a@b.iam.gserviceaccount.com',
      private_key: 'x',
    });
    const parsed = parseGa4ServiceAccountJson(raw);
    assert.equal(parsed?.client_email, 'a@b.iam.gserviceaccount.com');
  });

  it('parses base64 JSON', () => {
    const raw = JSON.stringify({
      type: 'service_account',
      client_email: 'b@c.iam.gserviceaccount.com',
      private_key: 'y',
    });
    const b64 = Buffer.from(raw, 'utf8').toString('base64');
    const parsed = parseGa4ServiceAccountJson(b64);
    assert.equal(parsed?.client_email, 'b@c.iam.gserviceaccount.com');
  });

  it('returns null for empty', () => {
    assert.equal(parseGa4ServiceAccountJson(undefined), null);
    assert.equal(parseGa4ServiceAccountJson(''), null);
  });
});

describe('summarizeGa4RowsToEvidence', () => {
  it('maps totals and event counts; preserves null; keeps real zero', () => {
    const snap = summarizeGa4RowsToEvidence({
      propertyId: '123',
      range: { startDate: '2026-09-10', endDate: '2026-09-16' },
      period: { start: '2026-09-10', end: '2026-09-16', timezone: 'Asia/Seoul' },
      totals: {
        activeUsers: 10,
        newUsers: 0,
        totalUsers: null,
        sessions: 20,
        screenPageViews: 100,
        engagedSessions: 8,
        engagementRate: 0.4,
        averageSessionDuration: 45.5,
        averageEngagementTime: null,
      },
      eventRows: [
        { eventName: 'comment_submit', eventCount: 3 },
        { eventName: 'page_view', eventCount: 99 },
        { eventName: 'stance_vote', eventCount: 2 },
      ],
      topPages: [{ path: '/', views: 50 }],
      channels: [{ channel: 'Organic Search', sessions: 12 }],
      sourceMedium: [{ sourceMedium: 'google / organic', sessions: 10 }],
      device: { mobile: 8, desktop: 2, tablet: 0 },
      geography: [{ country: 'South Korea', activeUsers: 9 }],
    });
    assert.equal(snap.available, true);
    assert.equal(snap.metrics.activeUsers, 10);
    assert.equal(snap.metrics.averageSessionDurationSec, 45.5);
    assert.equal(snap.users?.newUsers, 0);
    assert.equal(snap.users?.totalUsers, null);
    assert.equal(snap.engagement?.engagementRate, 0.4);
    assert.equal(snap.engagement?.averageEngagementTime, null);
    assert.equal(snap.views?.topPages?.[0]?.path, '/');
    assert.equal(snap.device?.tablet, 0);
    assert.equal(snap.metrics.eventCountByName.comment_submit, 3);
    assert.equal(snap.metrics.eventCountByName.page_view, undefined);
    assert.equal(snap.period?.timezone, 'Asia/Seoul');
    assert.equal(snap.errorCode, null);
  });
});

describe('attachGa4Evidence', () => {
  it('sets unavailable when property/credentials missing (fail-open)', async () => {
    const pack = buildStubEvidencePack();
    const out = await attachGa4Evidence(pack, {
      propertyId: null,
      credentialsJson: null,
      fetchSnapshot: async () => {
        throw new Error('should not fetch');
      },
    });
    assert.equal(out.ga4?.available, false);
    assert.equal(out.ga4?.errorCode, 'NOT_CONFIGURED');
    assert.ok(out.ga4?.error);
    assert.equal(out.aggregates, pack.aggregates);
  });

  it('attaches snapshot from fetcher without mutating DB aggregates', async () => {
    const period = { start: '2026-09-10', end: '2026-09-16', timezone: 'Asia/Seoul' as const };
    const pack = buildStubEvidencePack({
      aggregates: { activeUsersLast7d: 2, viewsLast7d: 5, newUsersLast7d: 0 },
    });
    const out = await attachGa4Evidence(pack, {
      propertyId: '999',
      credentialsJson: '{"type":"service_account","client_email":"a@b.com","private_key":"k"}',
      period,
      fetchSnapshot: async () =>
        buildMockGa4Evidence({
          propertyId: '999',
          period,
          metrics: {
            activeUsers: 50,
            sessions: 60,
            screenPageViews: 200,
            engagedSessions: 40,
            averageSessionDurationSec: 12,
            eventCountByName: { feed_post_click: 7 },
          },
          users: { totalUsers: 80, activeUsers: 50, newUsers: 35, returningUsers: 15 },
        }),
    });
    assert.equal(out.ga4?.available, true);
    assert.equal(out.ga4?.metrics.activeUsers, 50);
    assert.equal(out.ga4?.users?.newUsers, 35);
    assert.equal(out.aggregates.activeUsersLast7d, 2);
    assert.equal(out.aggregates.viewsLast7d, 5);
    assert.equal(out.aggregates.newUsersLast7d, 0);
    assert.ok(out.evidenceItems?.some((i) => i.id === 'GA_ACTIVE_USERS_7D' && i.source === 'GA4'));
    assert.ok(out.evidenceItems?.some((i) => i.id === 'DB_NEW_USERS_7D' && i.source === 'DATABASE'));
  });

  it('fail-open on fetch error with API_ERROR', async () => {
    const pack = buildStubEvidencePack();
    const out = await attachGa4Evidence(pack, {
      propertyId: '1',
      credentialsJson: '{"type":"service_account","client_email":"a@b.com","private_key":"k"}',
      fetchSnapshot: async () => {
        throw new Error('API down');
      },
    });
    assert.equal(out.ga4?.available, false);
    assert.equal(out.ga4?.errorCode, 'API_ERROR');
    assert.match(out.ga4?.error ?? '', /API down/);
  });

  it('accepts mock snapshot via options.mockGa4', async () => {
    const pack = buildStubEvidencePack();
    const mock = buildMockGa4Evidence({
      metrics: {
        activeUsers: 1,
        sessions: 2,
        screenPageViews: 3,
        engagedSessions: 1,
        averageSessionDurationSec: 9,
        eventCountByName: {},
      },
    });
    const out = await attachGa4Evidence(pack, { mockGa4: mock });
    assert.equal(out.ga4?.available, true);
    assert.equal(out.ga4?.metrics.activeUsers, 1);
  });
});

describe('evidenceItems + divergence + semantics', () => {
  it('marks GA and DB sources distinctly', () => {
    const pack = buildStubEvidencePack({ aggregates: { newUsersLast7d: 0 } });
    pack.ga4 = buildMockGa4Evidence({
      users: { totalUsers: null, activeUsers: 120, newUsers: 35, returningUsers: null },
      metrics: {
        activeUsers: 120,
        sessions: 10,
        screenPageViews: 20,
        engagedSessions: 5,
        averageSessionDurationSec: 1,
        eventCountByName: {},
      },
    });
    const items = buildEvidenceItems(pack);
    const ga = items.find((i) => i.id === 'GA_ACTIVE_USERS_7D');
    const db = items.find((i) => i.id === 'DB_NEW_USERS_7D');
    assert.equal(ga?.source, 'GA4');
    assert.equal(ga?.value, 120);
    assert.equal(db?.source, 'DATABASE');
    assert.equal(db?.value, 0);
  });

  it('divergence hint does not assert a cause', () => {
    const pack = buildStubEvidencePack({ aggregates: { newUsersLast7d: 0 } });
    pack.ga4 = buildMockGa4Evidence({
      users: { totalUsers: null, activeUsers: 10, newUsers: 35, returningUsers: null },
    });
    const hints = gaDbDivergenceHints(pack);
    assert.ok(hints.some((h) => /35/.test(h) && /0/.test(h)));
    assert.ok(hints.every((h) => !/because|caused|원인이다/i.test(h)));
  });

  it('UNKNOWN ≠ 0: unavailable GA is not treated as zero activity proof', () => {
    const flagged = usesUnknownAsNegativeEvidence(
      '사용자 활동이 낮다 because GA4 unavailable',
      'UNKNOWN',
      ['GA_ACTIVE_USERS_7D'],
      'ga4.available=false means no users',
    );
    assert.equal(flagged, true);
  });

  it('GA evidence refs are known', () => {
    assert.equal(isKnownEvidenceRef('GA_ACTIVE_USERS_7D'), true);
    assert.equal(isKnownEvidenceRef('DB_NEW_USERS_7D'), true);
    assert.equal(isKnownEvidenceRef('newUsersLast7d'), true);
  });

  it('PII fields are not present on GA block', () => {
    const snap = buildMockGa4Evidence();
    const json = JSON.stringify(snap);
    assert.doesNotMatch(json, /clientId|userId|email|phone|ipAddress/i);
  });
});

describe('formatEvidencePackForPrompt includes ga4', () => {
  it('embeds ga4 block and confusion guard', () => {
    const pack = buildStubEvidencePack();
    pack.ga4 = buildMockGa4Evidence({
      metrics: {
        activeUsers: 1,
        sessions: 2,
        screenPageViews: 3,
        engagedSessions: 1,
        averageSessionDurationSec: 9,
        eventCountByName: { comment_submit: 1 },
      },
    });
    const text = formatEvidencePackForPrompt(pack);
    assert.match(text, /"ga4"/);
    assert.match(text, /GA4/);
    assert.match(text, /activeUsersLast7d|DB/);
    assert.match(text, /UNKNOWN|unknown/i);
  });
});
