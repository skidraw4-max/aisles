/**
 * Run: node --import tsx --test src/lib/ai-review-board/ga4-evidence.test.ts
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildStubEvidencePack } from './evidence-pack';
import { formatEvidencePackForPrompt } from './format-evidence-prompt';
import {
  GA4_EVIDENCE_METRIC_DEFINITIONS,
  TRACKED_GA4_EVENT_NAMES,
  attachGa4Evidence,
  emptyGa4EvidenceUnavailable,
  parseGa4ServiceAccountJson,
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
  it('maps totals and event counts', () => {
    const snap = summarizeGa4RowsToEvidence({
      propertyId: '123',
      range: { startDate: '7daysAgo', endDate: 'today' },
      totals: {
        activeUsers: 10,
        sessions: 20,
        screenPageViews: 100,
        engagedSessions: 8,
        averageSessionDuration: 45.5,
      },
      eventRows: [
        { eventName: 'comment_submit', eventCount: 3 },
        { eventName: 'page_view', eventCount: 99 },
        { eventName: 'stance_vote', eventCount: 2 },
      ],
    });
    assert.equal(snap.available, true);
    assert.equal(snap.metrics.activeUsers, 10);
    assert.equal(snap.metrics.averageSessionDurationSec, 45.5);
    assert.equal(snap.metrics.eventCountByName.comment_submit, 3);
    assert.equal(snap.metrics.eventCountByName.stance_vote, 2);
    assert.equal(snap.metrics.eventCountByName.page_view, undefined);
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
    assert.ok(out.ga4?.error);
    assert.equal(out.aggregates, pack.aggregates);
  });

  it('attaches snapshot from fetcher without mutating DB aggregates', async () => {
    const pack = buildStubEvidencePack({
      aggregates: { activeUsersLast7d: 2, viewsLast7d: 5 },
    });
    const out = await attachGa4Evidence(pack, {
      propertyId: '999',
      credentialsJson: '{"type":"service_account","client_email":"a@b.com","private_key":"k"}',
      fetchSnapshot: async () =>
        summarizeGa4RowsToEvidence({
          propertyId: '999',
          range: { startDate: '7daysAgo', endDate: 'today' },
          totals: {
            activeUsers: 50,
            sessions: 60,
            screenPageViews: 200,
            engagedSessions: 40,
            averageSessionDuration: 12,
          },
          eventRows: [{ eventName: 'feed_post_click', eventCount: 7 }],
        }),
    });
    assert.equal(out.ga4?.available, true);
    assert.equal(out.ga4?.metrics.activeUsers, 50);
    assert.equal(out.aggregates.activeUsersLast7d, 2);
    assert.equal(out.aggregates.viewsLast7d, 5);
  });

  it('fail-open on fetch error', async () => {
    const pack = buildStubEvidencePack();
    const out = await attachGa4Evidence(pack, {
      propertyId: '1',
      credentialsJson: '{"type":"service_account","client_email":"a@b.com","private_key":"k"}',
      fetchSnapshot: async () => {
        throw new Error('API down');
      },
    });
    assert.equal(out.ga4?.available, false);
    assert.match(out.ga4?.error ?? '', /API down/);
  });
});

describe('formatEvidencePackForPrompt includes ga4', () => {
  it('embeds ga4 block and confusion guard', () => {
    const pack = buildStubEvidencePack();
    pack.ga4 = emptyGa4EvidenceUnavailable('not configured');
    pack.ga4 = {
      ...summarizeGa4RowsToEvidence({
        propertyId: '1',
        range: { startDate: '7daysAgo', endDate: 'today' },
        totals: {
          activeUsers: 1,
          sessions: 2,
          screenPageViews: 3,
          engagedSessions: 1,
          averageSessionDuration: 9,
        },
        eventRows: [{ eventName: 'comment_submit', eventCount: 1 }],
      }),
    };
    const text = formatEvidencePackForPrompt(pack);
    assert.match(text, /"ga4"/);
    assert.match(text, /GA4/);
    assert.match(text, /activeUsersLast7d|DB/);
  });
});
