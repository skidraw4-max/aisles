/** RM-11 (M-011, UI-06, CT-10): 이전 대비 비교. */
import assert from 'node:assert/strict';
import test from 'node:test';
import type { JuryActor } from './access';
import { buildReviewDisplayModel } from './review-display-model';
import { compareReviewResults, type ComparisonSide } from './review-comparison';
import { pickPrevious } from './review-comparison-db';
import { isIsolatedLocalTestDb } from './preview-db-guard';
import { JURY_CORE_CONTRACT_VERSION } from './records';

const surface = (problems: string[]) => ({
  statusSummary: 's', topProblems: problems, expectedUserEffect: '', risk: '', dimensionEvidence: [],
  supportedClaims: ['c'], partiallySupportedClaims: [], hypotheses: [],
});

function side(o: { id: string; decision?: string; problems?: string[]; source?: string; conn?: string | null; metrics?: string[]; surface?: unknown }): ComparisonSide {
  const metrics = o.metrics ?? ['newUsersLast7d'];
  return {
    display: buildReviewDisplayModel({
      result: { id: o.id, boardRunId: 'run', expectedDecision: o.decision ?? 'VERIFY', finalSurface: o.surface ?? surface(o.problems ?? []), evidenceStrength: 'moderate' },
      request: { status: 'COMPLETED', resultSource: o.source ?? 'REAL_MODEL' },
      evidence: { id: 'e', metricIds: metrics, metrics: metrics.map((m) => ({ metric: m, availability: 'AVAILABLE' })) },
    }),
    connectionId: o.conn === undefined ? 'conn' : o.conn,
    metricIds: metrics,
    completedAt: '2026-10-01T00:00:00.000Z',
  };
}

test('M-011: decision change + integer problem delta, no ratio', () => {
  const v = compareReviewResults(side({ id: 'b', decision: 'ACCEPT', problems: ['x'] }), side({ id: 'a', decision: 'REWORD', problems: ['x', 'y', 'z'] }));
  assert.equal(v.state, 'COMPARED');
  if (v.state !== 'COMPARED') return;
  assert.equal(v.decision.changed, true);
  assert.equal(v.problemDelta, -2);
  assert.equal(Number.isInteger(v.problemDelta), true);
  assert.equal(/%|배|비율|점수/.test(v.text), false);
  assert.match(v.text, /수정 필요 항목 -2건/);
});

test('no change is stated explicitly, never as "no problem"', () => {
  const v = compareReviewResults(side({ id: 'b', problems: ['x'] }), side({ id: 'a', problems: ['y'] }));
  assert.equal(v.state === 'COMPARED' && v.text.includes('결론 변화 없음') && v.text.includes('변화 없음'), true);
  assert.equal(v.text.includes('문제 없음'), false);
});

test('CT-10: MOCK/FIXTURE/LEGACY on either side → 비교 불가', () => {
  for (const source of ['MOCK', 'FIXTURE', 'UNKNOWN_LEGACY']) {
    assert.equal(compareReviewResults(side({ id: 'b' }), side({ id: 'a', source })).state, 'NOT_COMPARABLE', source);
    assert.equal(compareReviewResults(side({ id: 'b', source }), side({ id: 'a' })).state, 'NOT_COMPARABLE', source);
  }
  const fx = compareReviewResults(side({ id: 'b' }), side({ id: 'a', source: 'MOCK' }));
  assert.equal(fx.state === 'NOT_COMPARABLE' && fx.text.startsWith('비교 불가'), true);
});

test('different grade / service / metric set / no previous → 비교 불가 with reason', () => {
  const r = (v: ReturnType<typeof compareReviewResults>) => (v.state === 'NOT_COMPARABLE' ? v.reason : v.state);
  assert.equal(r(compareReviewResults(side({ id: 'b', source: 'VERIFIED_REAL' }), side({ id: 'a' }))), 'DIFFERENT_SOURCE_GRADE');
  assert.equal(r(compareReviewResults(side({ id: 'b' }), side({ id: 'a', conn: 'other' }))), 'DIFFERENT_SERVICE');
  assert.equal(r(compareReviewResults(side({ id: 'b' }), side({ id: 'a', metrics: ['userCount'] }))), 'DIFFERENT_METRICS');
  assert.equal(r(compareReviewResults(side({ id: 'b' }), null)), 'NO_PREVIOUS');
});

test('invalid previous surface → withheld → 비교 불가 (CT-06 consistent)', () => {
  const v = compareReviewResults(side({ id: 'b' }), side({ id: 'a', surface: { statusSummary: 's' } }));
  assert.equal(v.state === 'NOT_COMPARABLE' && v.reason, 'DECISION_WITHHELD');
});

test('pickPrevious skips newer MOCK rows for an older comparable real one', () => {
  const cur = side({ id: 'c' });
  const picked = pickPrevious(cur, [{ side: side({ id: 'mock', source: 'MOCK' }) }, { side: side({ id: 'real' }) }]);
  assert.equal(picked?.side.display.resultId, 'real');
  assert.equal(pickPrevious(cur, [{ side: side({ id: 'mock', source: 'MOCK' }) }])?.side.display.resultId, 'mock');
});

test('isolated DB: loader compares same-service previous result, never another tenant', { skip: !isIsolatedLocalTestDb(process.env), timeout: 120_000 }, async () => {
  const { prisma } = await import('@/lib/prisma');
  const { loadReviewComparison } = await import('./review-comparison-db');
  const T = 'rm11-t', F = 'rm11-f';
  const cleanup = async () => {
    await prisma.juryReviewResult.deleteMany({ where: { tenantId: { in: [T, F] } } });
    await prisma.juryReviewRequest.deleteMany({ where: { tenantId: { in: [T, F] } } });
    await prisma.juryEvidence.deleteMany({ where: { tenantId: { in: [T, F] } } });
    await prisma.juryServiceConnection.deleteMany({ where: { tenantId: { in: [T, F] } } });
    await prisma.juryTenant.deleteMany({ where: { id: { in: [T, F] } } });
  };
  await cleanup();
  try {
    for (const id of [T, F]) {
      await prisma.juryTenant.create({ data: { id, name: id } });
      await prisma.juryServiceConnection.create({ data: { id: `${id}-c`, tenantId: id, serviceKey: 'svc', displayName: 'S', accessMethod: 'FILE_UPLOAD', status: 'CONNECTED' } });
    }
    let i = 0;
    const add = async (tenantId: string, id: string, day: number, decision: 'ACCEPT' | 'REWORD', problems: string[], source: 'REAL_MODEL' | 'MOCK') => {
      i += 1;
      await prisma.juryEvidence.create({ data: { id: `${id}-e`, tenantId, connectionId: `${tenantId}-c`, purpose: 'p', periodStart: '2026-10-01', periodEnd: '2026-10-07', timezone: 'Asia/Seoul', metricIds: ['newUsersLast7d'], adapterKey: 'mock', collectedAt: new Date(), piiExcluded: true, readOnly: true } });
      await prisma.juryReviewRequest.create({ data: { id: `${id}-q`, tenantId, connectionId: `${tenantId}-c`, evidenceId: `${id}-e`, reviewType: 'FULL_REVIEW', mode: 'EXTERNAL_SERVICE', status: 'COMPLETED', coreRootDir: 'x', resultSource: source } });
      await prisma.juryReviewResult.create({ data: { id, tenantId, reviewRequestId: `${id}-q`, boardRunId: `run-${i}`, evidenceStrength: 'moderate', claimStrength: 'weak', conflictDetected: false, overclaimDetected: false, revisionRequired: false, expectedDecision: decision, finalSurface: surface(problems), contractVersion: JURY_CORE_CONTRACT_VERSION, completedAt: new Date(`2026-10-${10 + day}T00:00:00Z`) } });
    };
    await add(T, 'rm11-old', 1, 'REWORD', ['a', 'b', 'c'], 'REAL_MODEL');
    await add(T, 'rm11-mock', 2, 'ACCEPT', [], 'MOCK');
    await add(F, 'rm11-foreign', 3, 'ACCEPT', [], 'REAL_MODEL');
    await add(T, 'rm11-new', 4, 'ACCEPT', ['a'], 'REAL_MODEL');
    const actor: JuryActor = { ok: true, userId: 'u', tenantId: T, role: 'OWNER', membershipId: 'm' };
    const v = await loadReviewComparison(actor, 'rm11-new');
    assert.equal(v?.state, 'COMPARED', JSON.stringify(v));
    if (v?.state !== 'COMPARED') return;
    assert.equal(v.previousResultId, 'rm11-old');
    assert.equal(v.problemDelta, -2);
    assert.equal(v.decision.changed, true);
    const foreignActor: JuryActor = { ok: true, userId: 'u', tenantId: F, role: 'OWNER', membershipId: 'm' };
    assert.equal(await loadReviewComparison(foreignActor, 'rm11-new'), null, 'other tenant cannot load');
    const first = await loadReviewComparison(foreignActor, 'rm11-foreign');
    assert.equal(first?.state === 'NOT_COMPARABLE' && first.reason, 'NO_PREVIOUS');
  } finally {
    await cleanup();
  }
});
