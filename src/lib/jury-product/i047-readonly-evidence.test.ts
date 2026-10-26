import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildStubEvidencePack } from '@/lib/ai-review-board/evidence-pack';
import { readonlyObservationPack } from './connected-service-review';
import { draftNormalizedMetrics, READONLY_OBSERVATION_RULE_ID } from './normalizer';
import type { LatestObservationRun } from './services/readonly-account/latest-observation';

const run: LatestObservationRun = {
  id: 'r1', ok: true, stop: null, challenge: null, loginAttempts: 1, pagesObserved: 3, pagesVisible: 2,
  pages: [{ label: 'Home', path: '/', visible: true, textLength: 10 }],
  blockedRequestCount: 6, blockedByReason: { ORIGIN: 6, METHOD: 0, FORM_SUBMIT: 0, LOGIN_ALREADY_USED: 0 },
  finalOrigin: 'https://app.example.com', finalPath: '/onboarding', observedAt: '2026-10-26T06:35:40.000Z',
};

function base() {
  return buildStubEvidencePack({
    generatedAt: '2026-10-26T07:00:00.000Z',
    analysisPeriod: { start: '2026-10-20', end: '2026-10-26', timezone: 'Asia/Seoul' },
    aggregates: { userCount: 0, usersLast7d: 0, newUsersLast7d: 0, activeUsersLast7d: 0, postCount: 0, postsLast7d: 0, commentsLast7d: 0, viewsLast7d: 0, totalViews: 0, commentCount: 0, postsByCategory: {} },
  } as never);
}

test('READ_ONLY_ACCOUNT pack drops placeholder DB zeros and records screen counts', () => {
  const pack = readonlyObservationPack(base(), run, true);
  assert.ok(Object.values(pack.aggregates).every((v) => v === null || (typeof v === 'object' && Object.keys(v).length === 0)));
  const metrics = draftNormalizedMetrics({ tenantId: 't1', connectionId: 'c1', pack });
  const db = metrics.filter((m) => m.sourceSystem === 'DATABASE');
  assert.ok(db.length > 0 && db.every((m) => m.availability === 'NOT_MEASURED' && m.value === null));
  const screen = metrics.filter((m) => m.sourceSystem === 'SCREEN');
  assert.deepEqual(screen.map((m) => [m.metric, m.value, m.availability]), [
    ['readonly.pagesObserved', 3, 'AVAILABLE'],
    ['readonly.pagesVisible', 2, 'AVAILABLE'],
    ['readonly.blockedRequests', 6, 'AVAILABLE'],
  ]);
  assert.ok(screen.every((m) => m.ruleId === READONLY_OBSERVATION_RULE_ID && m.collectedAt === run.observedAt));
  assert.ok(pack.docsHints.some((h) => h.includes('observed=3')));
});

test('packs without an observation produce no SCREEN metrics', () => {
  const metrics = draftNormalizedMetrics({ tenantId: 't1', connectionId: 'c1', pack: base() });
  assert.equal(metrics.filter((m) => m.sourceSystem === 'SCREEN').length, 0);
});
