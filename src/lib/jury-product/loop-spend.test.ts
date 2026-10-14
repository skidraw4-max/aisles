/**
 * Loop spend feeds the existing runtime and cost limits.
 * It does not change the guard comparison or write a cycle.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { evaluateLoopGuard, PRODUCT_LOOP_GUARD_DEFAULTS } from './loop-guard';
import { loadLoopSpend, measureLoopSpend } from './loop-spend';

const LIVE_REVIEW = '3707202563ecae9b38f324a4eefd9243a14bc69420ed6cdda16c4c5794f62e0d';
const LIVE_CYCLE = '14308b4c999ccbe8ca54b7f31da5385385d4073c49bbf2955582a6bb96afb01e';

test('measured spend stays inside the default limits', () => {
  const spend = measureLoopSpend({
    now: '2026-10-02T00:01:00.000Z',
    startedAt: '2026-10-02T00:00:00.000Z',
    tenantId: 'tenant-a',
    costs: [{ tenantId: 'tenant-a', estimatedCostUsd: 0.25 }],
  });
  assert.deepEqual(spend, { runtimeMs: 60_000, costUsd: 0.25 });
  const guard = evaluateLoopGuard({
    policy: PRODUCT_LOOP_GUARD_DEFAULTS,
    iteration: 1,
    verificationAttempts: 0,
    sameDecisionCount: 1,
    sameConflictCount: 0,
    ...spend,
  });
  assert.equal(guard.allowed, true);
  assert.equal(guard.reason, 'ALLOWED');
});

test('elapsed time and recorded cost block through the existing guard', () => {
  const runtime = measureLoopSpend({
    now: '2026-10-02T02:00:00.000Z',
    startedAt: '2026-10-02T00:00:00.000Z',
    tenantId: 'tenant-a',
    costs: [],
  });
  const runtimeGuard = evaluateLoopGuard({
    policy: { ...PRODUCT_LOOP_GUARD_DEFAULTS, maxRuntimeMs: 1_800_000 },
    iteration: 1,
    verificationAttempts: 0,
    sameDecisionCount: 1,
    sameConflictCount: 0,
    ...runtime,
  });
  assert.equal(runtimeGuard.allowed, false);
  assert.equal(runtimeGuard.reason, 'MAX_RUNTIME');

  const cost = measureLoopSpend({
    now: '2026-10-02T00:01:00.000Z',
    startedAt: '2026-10-02T00:00:00.000Z',
    tenantId: 'tenant-a',
    costs: [{ tenantId: 'tenant-a', estimatedCostUsd: 1.5 }],
  });
  const costGuard = evaluateLoopGuard({
    policy: { ...PRODUCT_LOOP_GUARD_DEFAULTS, maxCostUsd: 1 },
    iteration: 1,
    verificationAttempts: 0,
    sameDecisionCount: 1,
    sameConflictCount: 0,
    ...cost,
  });
  assert.equal(costGuard.allowed, false);
  assert.equal(costGuard.reason, 'MAX_COST');
});

test('missing or unusable measurements leave the limit inactive', () => {
  const spend = measureLoopSpend({
    now: 'not-a-time',
    startedAt: '2026-10-02T00:00:00.000Z',
    tenantId: 'tenant-a',
    costs: [{ tenantId: 'tenant-a', estimatedCostUsd: -1 }],
  });
  assert.deepEqual(spend, { runtimeMs: null, costUsd: null });
  const guard = evaluateLoopGuard({
    policy: PRODUCT_LOOP_GUARD_DEFAULTS,
    iteration: 1,
    verificationAttempts: 0,
    sameDecisionCount: 1,
    sameConflictCount: 0,
    ...spend,
  });
  assert.equal(guard.reason, 'ALLOWED');
});

test('another tenant cost is excluded', async () => {
  const spend = await loadLoopSpend(fakeDb([{ id: 'exec-1', tenantId: 'tenant-b', cost: 4 }]), {
    tenantId: 'tenant-a',
    rootReviewResultId: 'root-1',
    startedAt: '2026-10-02T00:00:00.000Z',
    now: '2026-10-02T00:01:00.000Z',
  });
  assert.equal(spend.costUsd, null);
  assert.equal(spend.runtimeMs, 60_000);
  const mixed = measureLoopSpend({
    now: '2026-10-02T00:01:00.000Z',
    startedAt: '2026-10-02T00:00:00.000Z',
    tenantId: 'tenant-a',
    costs: [
      { tenantId: 'tenant-b', estimatedCostUsd: 9 },
      { tenantId: 'tenant-a', estimatedCostUsd: 0.4 },
    ],
  });
  assert.equal(mixed.costUsd, 0.4);
});

test('the measurement does not authorize, store a secret, or trust a client tenant', () => {
  const source = readFileSync(path.resolve(process.cwd(), 'src/lib/jury-product/loop-spend.ts'), 'utf8');
  assert.equal(source.includes('clientTenantId'), false);
  assert.equal(source.includes('automation.write'), false);
  assert.equal(source.includes('juryAuditEvent'), false);
  assert.equal(source.includes('postgres://'), false);
  assert.equal(source.includes('.create('), false);
  assert.equal(source.includes('.update('), false);
  assert.equal(source.includes('.delete('), false);
  const resolution = readFileSync(path.resolve(process.cwd(), 'src/lib/jury-product/decision-cycle-resolution.ts'), 'utf8');
  assert.equal(resolution.includes('spend.runtimeMs'), true);
  assert.equal(resolution.includes('spend.costUsd'), true);
  const guard = readFileSync(path.resolve(process.cwd(), 'src/lib/jury-product/loop-guard.ts'), 'utf8');
  assert.equal(guard.includes('input.runtimeMs !== null'), true);
  assert.equal(guard.includes('input.costUsd !== null'), true);
  const result = measureLoopSpend({
    now: '2026-10-02T00:01:00.000Z',
    startedAt: '2026-10-02T00:00:00.000Z',
    tenantId: 'tenant-a',
    costs: [{ tenantId: 'tenant-a', estimatedCostUsd: 0.1 }],
  });
  assert.equal(JSON.stringify(result).includes('postgres://'), false);
  assert.deepEqual(Object.keys(result).sort(), ['costUsd', 'runtimeMs']);
});

test('the same measurement is stable and concurrent calls match', async () => {
  const input = {
    now: '2026-10-02T00:05:00.000Z',
    startedAt: '2026-10-02T00:00:00.000Z',
    tenantId: 'tenant-a',
    costs: [
      { tenantId: 'tenant-a', estimatedCostUsd: 0.2 },
      { tenantId: 'tenant-a', estimatedCostUsd: 0.3 },
    ],
  };
  assert.deepEqual(measureLoopSpend(input), measureLoopSpend(input));
  const loaded = {
    tenantId: 'tenant-a',
    rootReviewResultId: 'root-1',
    startedAt: '2026-10-02T00:00:00.000Z',
    now: '2026-10-02T00:05:00.000Z',
  };
  const db = fakeDb([
    { id: 'exec-1', tenantId: 'tenant-a', cost: { toNumber: () => 0.2 } },
    { id: 'exec-2', tenantId: 'tenant-a', cost: 0.3 },
  ]);
  const [first, second] = await Promise.all([loadLoopSpend(db, loaded), loadLoopSpend(db, loaded)]);
  assert.deepEqual(first, second);
  assert.deepEqual(first, { runtimeMs: 300_000, costUsd: 0.5 });
});

test('the live review and cycle are only read', async () => {
  loadEnv();
  const { prisma } = await import('@/lib/prisma');
  const before = await liveSnapshot(prisma);
  measureLoopSpend({
    now: '2026-10-02T00:01:00.000Z',
    startedAt: '2026-10-02T00:00:00.000Z',
    tenantId: 'tenant-phase43',
    costs: [],
  });
  const after = await liveSnapshot(prisma);
  assert.deepEqual(after, before);
  assert.equal(before.review?.expectedDecision, 'VERIFY');
  assert.equal(before.cycle?.status, 'ACTIVE');
  assert.equal(before.cycle?.iteration, 2);
  assert.equal(before.cycle?.verificationAttempts, 1);
  assert.equal(before.cycle?.sameDecisionCount, 2);
  assert.equal(before.cycle?.sameConflictCount, 2);
  assert.equal(before.activation, 0);
});

function fakeDb(rows: Array<{ id: string; tenantId: string; cost: unknown }>) {
  return {
    juryImprovementTask: {
      async findMany() {
        return rows.map((row) => ({ id: row.id }));
      },
    },
    juryAgentExecution: {
      async findMany() {
        return rows.map((row) => ({ tenantId: row.tenantId, estimatedCostUsd: row.cost }));
      },
    },
  };
}

async function liveSnapshot(prisma: {
  juryReviewResult: { findUnique(args: object): Promise<{ expectedDecision: string; tenantId: string } | null> };
  juryDecisionCycle: {
    findUnique(args: object): Promise<{
      status: string;
      iteration: number;
      verificationAttempts: number;
      sameDecisionCount: number;
      sameConflictCount: number;
      updatedAt: Date;
    } | null>;
  };
  juryAutoLoopActivation: { count(args: object): Promise<number> };
}) {
  const review = await prisma.juryReviewResult.findUnique({
    where: { id: LIVE_REVIEW },
    select: { expectedDecision: true, tenantId: true },
  });
  const cycle = await prisma.juryDecisionCycle.findUnique({
    where: { id: LIVE_CYCLE },
    select: {
      status: true,
      iteration: true,
      verificationAttempts: true,
      sameDecisionCount: true,
      sameConflictCount: true,
      updatedAt: true,
    },
  });
  const activation = await prisma.juryAutoLoopActivation.count({ where: { tenantId: review?.tenantId ?? 'missing' } });
  return { review, cycle, activation };
}

function loadEnv(): void {
  for (const [file, override] of [
    ['.env', false],
    ['.env.local', true],
  ] as const) {
    let text = '';
    try {
      text = readFileSync(path.resolve(process.cwd(), file), 'utf8');
    } catch {
      continue;
    }
    for (const line of text.split(/\r?\n/)) {
      const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (!match) continue;
      const [, key, raw] = match;
      if (!key || (process.env[key] && !override)) continue;
      process.env[key] = raw.replace(/^"|"$/g, '');
    }
  }
}
