/**
 * Stage A smoke against the LOCAL schema-only production copy (after RM-01 migrate deploy).
 * Refuses to run unless the isolated loopback test DB guard passes. Never point this at production.
 * Run: JURY_LOCAL_TEST_DB=1 DATABASE_URL=postgresql://jury:jury@127.0.0.1:5432/jury_prodcopy npx tsx scripts/prod-rehearsal/smoke.ts
 */
import assert from 'node:assert/strict';
import { isIsolatedLocalTestDb } from '../../src/lib/jury-product/preview-db-guard';

async function main() {
  if (!isIsolatedLocalTestDb(process.env)) throw new Error('REFUSED: not an isolated loopback test DB');
  const { prisma } = await import('../../src/lib/prisma');
  const { loadJuryCatalog } = await import('../../src/lib/jury-product/jury-db');
  const { loadReviewComparison } = await import('../../src/lib/jury-product/review-comparison-db');
  const { loadReviewAttempts } = await import('../../src/lib/jury-product/review-request-status');
  const { persistProductReview } = await import('../../src/lib/jury-product/review-store');
  const { startReviewAttempt, finishReviewAttempt } = await import('../../src/lib/jury-product/review-tracking');
  const tenantId = '540a4714-syn-tenant-a';
  const actor = { ok: true as const, userId: 'syn-user-1', tenantId, role: 'OWNER' as const, membershipId: 'syn-mem-a' };

  const cat = await loadJuryCatalog(tenantId);
  assert.equal(cat.requests.length, 5, 'review list: 5 requests');
  assert.equal(cat.results.length, 5, 'review list: 5 results');
  console.log('OK list read: requests=%d results=%d', cat.requests.length, cat.results.length);

  const legacy = await prisma.juryReviewRequest.findMany({ select: { resultSource: true } });
  assert.ok(legacy.every((r) => r.resultSource === 'UNKNOWN_LEGACY'));
  console.log('OK legacy rows resultSource=UNKNOWN_LEGACY (%d)', legacy.length);

  const cmp = await loadReviewComparison(actor, '37072025-syn-res');
  console.log('OK detail/comparison read: %s', cmp ? JSON.stringify({ status: (cmp as any).status ?? (cmp as any).comparison?.status, reason: (cmp as any).reason ?? (cmp as any).comparison?.reason }) : 'null');
  assert.ok(cmp !== undefined);

  const id = 'smoke-' + Date.now();
  const req = { id: id + '-rr', tenantId, connectionId: 'ee93d8e6-syn-conn-self', evidenceId: 'syn-ev-1', reviewType: 'FULL_REVIEW' as const,
    mode: 'AISLE_SELF' as const, status: 'COMPLETED' as const, coreRootDir: 'data/jury-product', requestedByUserId: 'syn-user-1' };
  const fs = { statusSummary: 's', expectedUserEffect: 'e', risk: 'r', topProblems: [], dimensionEvidence: [], supportedClaims: [], partiallySupportedClaims: [], hypotheses: [] };
  const sample = cat.results[0] as any;
  const res = { ...sample, id: id + '-res', reviewRequestId: req.id, boardRunId: 'smoke-run', finalSurface: { ...sample.finalSurface, ...fs }, completedAt: new Date().toISOString() };
  const attemptId = await startReviewAttempt(prisma as any, { tenantId, reviewRequestKey: req.id, evidenceId: req.evidenceId, reviewType: req.reviewType, startedAt: new Date() });
  assert.ok(attemptId, 'attempt start');
  const saved = await persistProductReview({ request: req as any, result: res });
  assert.deepEqual(saved, { ok: true });
  const fin = await finishReviewAttempt(prisma as any, attemptId, { tenantId, reviewRequestKey: req.id, status: 'COMPLETED', resultSource: 'MOCK', boardRunId: 'smoke-run',
    calls: [{ seq: 1, provider: 'smoke', model: null, operation: 'noop', memberId: null, status: 'ok', errorCode: null, latencyMs: 1, startedAt: new Date().toISOString() }] as any, finishedAt: new Date() });
  assert.equal(fin, true, 'attempt finish');
  const row = await prisma.juryReviewRequest.findUnique({ where: { id: req.id }, select: { resultSource: true } });
  assert.equal(row?.resultSource, 'MOCK');
  const after = await loadReviewAttempts(tenantId);
  assert.ok(after.length >= 1);
  console.log('OK review save + attempt/LLM-log tracking (resultSource=%s, attempts=%d)', row?.resultSource, after.length);
  // clean up smoke rows so the copy stays a faithful rehearsal target
  await prisma.juryReviewResult.deleteMany({ where: { id: res.id } });
  await prisma.juryReviewRequest.deleteMany({ where: { id: req.id } });
  await prisma.juryReviewAttempt.deleteMany({ where: { reviewRequestKey: req.id } });
  await prisma.$disconnect();
  console.log('SMOKE PASS');
}
main().catch((e) => { console.error('SMOKE FAIL', e); process.exit(1); });
