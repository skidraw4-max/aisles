/** RM-14 (I-012): O-001~O-004, O-008, O-009. */
import assert from 'node:assert/strict';
import test from 'node:test';
import type { JuryActor } from './access';
import { buildOperatorMetrics, canViewOperatorConsole } from './operator-metrics';
import { isIsolatedLocalTestDb } from './preview-db-guard';

const d = (s: number) => new Date(Date.UTC(2026, 9, 22, 0, 0, s));
const row = (status: string, o: Partial<{ src: string; reason: string | null; dur: number | null }> = {}) => ({
  status, resultSource: o.src ?? 'REAL_MODEL', failureReason: o.reason ?? null, createdAt: d(0), completedAt: o.dur == null ? null : d(o.dur),
});

test('O-001..O-004/O-008: counts, integer completion rate, reasons, duration excludes legacy', () => {
  const m = buildOperatorMetrics([
    row('COMPLETED', { dur: 10 }), row('COMPLETED', { dur: 30 }), row('COMPLETED', { dur: 20, src: 'UNKNOWN_LEGACY' }),
    row('FAILED', { reason: 'LLM_TIMEOUT' }), row('FAILED', { reason: null }), row('RUNNING'),
  ], [{ provider: 'gemini', model: 'm1', status: 'OK' }, { provider: 'gemini', model: 'm1', status: 'ERROR' }]);
  assert.equal(m.total, 6);
  assert.deepEqual(m.byStatus, [{ status: 'COMPLETED', count: 3 }, { status: 'FAILED', count: 2 }, { status: 'RUNNING', count: 1 }]);
  assert.equal(m.completionRate.value, 60);
  assert.equal(Number.isInteger(m.completionRate.value), true);
  assert.deepEqual(m.failureReasons.map((r) => r.reason).sort(), ['LLM_TIMEOUT', '사유 미기록']);
  assert.deepEqual(m.duration, { measured: 2, excludedLegacy: 1, medianSec: 20, maxSec: 30 });
  assert.deepEqual(m.models, [{ model: 'gemini/m1', ok: 1, failed: 1 }]);
});

test('no finished requests → 집계 불가, never 0% or 100%', () => {
  const m = buildOperatorMetrics([row('RUNNING')], []);
  assert.equal(m.completionRate.value, null);
  assert.match(m.completionRate.note, /집계 불가/);
});

test('only OWNER/ADMIN may view', () => {
  const a = (role: string) => ({ ok: true, userId: 'u', tenantId: 't', role, membershipId: 'm' }) as JuryActor;
  assert.equal(canViewOperatorConsole(a('OWNER')), true);
  assert.equal(canViewOperatorConsole(a('ADMIN')), true);
  for (const r of ['REVIEWER', 'DEVELOPER', 'VIEWER']) assert.equal(canViewOperatorConsole(a(r)), false, r);
});

test('isolated DB: loader is tenant-scoped and role-gated', { skip: !isIsolatedLocalTestDb(process.env), timeout: 120_000 }, async () => {
  const { prisma } = await import('@/lib/prisma');
  const { loadOperatorMetrics } = await import('./operator-metrics');
  const T = 'rm14-t', F = 'rm14-f';
  const cleanup = async () => {
    await prisma.juryReviewRequest.deleteMany({ where: { tenantId: { in: [T, F] } } });
    await prisma.juryEvidence.deleteMany({ where: { tenantId: { in: [T, F] } } });
    await prisma.juryServiceConnection.deleteMany({ where: { tenantId: { in: [T, F] } } });
    await prisma.juryTenant.deleteMany({ where: { id: { in: [T, F] } } });
  };
  await cleanup();
  try {
    for (const id of [T, F]) {
      await prisma.juryTenant.create({ data: { id, name: id } });
      await prisma.juryServiceConnection.create({ data: { id: `${id}-c`, tenantId: id, serviceKey: 's', displayName: 'S', accessMethod: 'FILE_UPLOAD', status: 'CONNECTED' } });
      await prisma.juryEvidence.create({ data: { id: `${id}-e`, tenantId: id, connectionId: `${id}-c`, purpose: 'p', periodStart: '2026-10-01', periodEnd: '2026-10-07', timezone: 'Asia/Seoul', metricIds: [], adapterKey: 'mock', collectedAt: new Date(), piiExcluded: true, readOnly: true } });
    }
    const req = (tenantId: string, id: string, status: 'FAILED' | 'RUNNING', reason: string | null) => prisma.juryReviewRequest.create({ data: { id, tenantId, connectionId: `${tenantId}-c`, evidenceId: `${tenantId}-e`, reviewType: 'FULL_REVIEW', mode: 'EXTERNAL_SERVICE', status, coreRootDir: 'x', resultSource: 'REAL_MODEL', failureReason: reason } });
    await req(T, 'rm14-1', 'FAILED', 'LLM_TIMEOUT');
    await req(T, 'rm14-2', 'RUNNING', null);
    await req(F, 'rm14-3', 'FAILED', 'OTHER_TENANT');
    const owner: JuryActor = { ok: true, userId: 'u', tenantId: T, role: 'OWNER', membershipId: 'm' };
    const r = await loadOperatorMetrics(owner);
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.metrics.total, 2);
    assert.deepEqual(r.metrics.failureReasons, [{ reason: 'LLM_TIMEOUT', count: 1 }]);
    const viewer: JuryActor = { ...owner, role: 'VIEWER' } as JuryActor;
    assert.deepEqual(await loadOperatorMetrics(viewer), { ok: false, reason: 'FORBIDDEN' });
  } finally {
    await cleanup();
  }
});
