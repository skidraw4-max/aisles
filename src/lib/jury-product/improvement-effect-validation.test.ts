/**
 * Effect validation reads a finished re-review and does not replace the Jury decision.
 * It does not write, audit, or call a live review.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import path from 'node:path';
import { runImprovementAutoLoop } from './improvement-auto-loop';
import { REWORD_FIXTURE_OBJECTIVE } from './improvement-bridge';
import {
  effectFromStoredRows,
  evaluateImprovementEffect,
  type ImprovementEffectInput,
  type ImprovementEffectResult,
  type StoredEffectRows,
} from './improvement-effect-validation';
import { PRODUCT_LOOP_GUARD_DEFAULTS } from './loop-guard';
import type { JuryMembership } from './records';

const LIVE_REVIEW = '3707202563ecae9b38f324a4eefd9243a14bc69420ed6cdda16c4c5794f62e0d';
const LIVE_CYCLE = '14308b4c999ccbe8ca54b7f31da5385385d4073c49bbf2955582a6bb96afb01e';
const owner: JuryMembership = {
  id: 'mem-1',
  tenantId: 'tenant-a',
  userId: 'user-1',
  role: 'OWNER',
  createdAt: '2026-10-02T00:00:00.000Z',
};

function base(patch: Partial<ImprovementEffectInput> = {}): ImprovementEffectInput {
  return {
    actorTenantId: 'tenant-a',
    taskTenantId: 'tenant-a',
    reviewTenantId: 'tenant-a',
    objective: REWORD_FIXTURE_OBJECTIVE,
    decision: 'ACCEPT',
    linked: true,
    overclaimPersists: false,
    verificationStatus: null,
    ...patch,
  };
}

function rows(patch: Partial<StoredEffectRows> = {}): StoredEffectRows {
  return {
    actorTenantId: 'tenant-a',
    decision: 'ACCEPT',
    task: { tenantId: 'tenant-a', reviewResultId: 'root-1', objective: REWORD_FIXTURE_OBJECTIVE },
    review: {
      tenantId: 'tenant-a',
      parentReviewResultId: 'root-1',
      overclaimDetected: false,
      verificationResultId: null,
    },
    verification: null,
    verifiedReview: null,
    ...patch,
  };
}

test('accept is effective only when the same problem is linked and gone', () => {
  const input = base();
  const effective = evaluateImprovementEffect(input);
  assert.equal(input.decision, 'ACCEPT');
  assert.deepEqual(effective, { status: 'EFFECTIVE', code: 'EFFECTIVE', reason: 'OBJECTIVE_SUPPORTED' });
  assert.deepEqual(evaluateImprovementEffect(base({ linked: false })), {
    status: 'INCONCLUSIVE',
    code: 'INCONCLUSIVE',
    reason: 'INSUFFICIENT_EVIDENCE',
  });
  assert.equal(evaluateImprovementEffect(base({ overclaimPersists: null })).code, 'INCONCLUSIVE');
  assert.equal(
    evaluateImprovementEffect(base({ objective: '사용자가 서비스를 더 편하게 느끼도록 한다.' })).code,
    'INCONCLUSIVE',
  );
});

test('the same overclaim stays not effective and a thin verify stays inconclusive', () => {
  assert.deepEqual(
    evaluateImprovementEffect(base({ decision: 'REWORD', overclaimPersists: true })),
    { status: 'NOT_EFFECTIVE', code: 'NOT_EFFECTIVE', reason: 'OBJECTIVE_NOT_SUPPORTED' },
  );
  assert.equal(evaluateImprovementEffect(base({ decision: 'VERIFY' })).code, 'INCONCLUSIVE');
  assert.equal(evaluateImprovementEffect(base({ decision: 'VERIFY', verificationStatus: 'INCONCLUSIVE' })).code, 'INCONCLUSIVE');
  assert.deepEqual(
    evaluateImprovementEffect(base({ decision: 'ACCEPT', verificationStatus: 'RESOLVED' })),
    { status: 'EFFECTIVE', code: 'EFFECTIVE', reason: 'OBJECTIVE_SUPPORTED' },
  );
  const resolved = effectFromStoredRows(
    rows({
      review: {
        tenantId: 'tenant-a',
        parentReviewResultId: 'verify-1',
        overclaimDetected: false,
        verificationResultId: 'verification-1',
      },
      verification: { tenantId: 'tenant-a', status: 'RESOLVED', reviewResultId: 'verify-1' },
      verifiedReview: { tenantId: 'tenant-a', parentReviewResultId: 'root-1' },
    }),
  );
  assert.equal(resolved.code, 'EFFECTIVE');
  assert.equal(JSON.stringify(resolved).includes('postgres://'), false);
});

test('a different tenant and a repeated call stay closed', async () => {
  assert.equal(evaluateImprovementEffect(base({ reviewTenantId: 'tenant-b' })).code, 'TENANT_MISMATCH');
  assert.equal(effectFromStoredRows(rows({ actorTenantId: 'tenant-b' })).code, 'TENANT_MISMATCH');
  assert.equal(
    effectFromStoredRows(
      rows({
        verification: { tenantId: 'tenant-b', status: 'RESOLVED', reviewResultId: 'verify-1' },
      }),
    ).code,
    'TENANT_MISMATCH',
  );
  const first = evaluateImprovementEffect(base());
  const second = evaluateImprovementEffect(base());
  assert.deepEqual(first, second);
  const [left, right] = await Promise.all([Promise.resolve(evaluateImprovementEffect(base())), Promise.resolve(evaluateImprovementEffect(base()))]);
  assert.deepEqual(left, right);

  const accepted = await once('accept');
  assert.equal(accepted.outcome.stop, 'ACCEPT');
  assert.equal(accepted.outcome.effect?.code, 'EFFECTIVE');
  assert.equal(accepted.agents, 1);
  assert.equal(accepted.gates, 1);
  assert.equal(accepted.rereviews, 1);
  assert.equal(accepted.cores, 1);
  const again = await runImprovementAutoLoop(command(), accepted.io);
  assert.equal(again.stop, 'ALREADY_COMPLETED');
  assert.equal(accepted.agents, 1);
  assert.equal(accepted.gates, 1);
  assert.equal(accepted.rereviews, 1);
  assert.equal(accepted.cores, 1);

  const shared = harness('accept');
  const [one, two] = await Promise.all([runImprovementAutoLoop(command(), shared.io), runImprovementAutoLoop(command(), shared.io)]);
  assert.equal(one.stop, 'ACCEPT');
  assert.equal(two.stop, 'ACCEPT');
  assert.deepEqual(one.effect, two.effect);
  assert.equal(shared.agents, 1);
  assert.equal(shared.gates, 1);
});

test('not effective does not start another agent and verify does not repeat review', async () => {
  const stalled = await once('reword');
  assert.equal(stalled.outcome.effect?.code, 'NOT_EFFECTIVE');
  assert.equal(stalled.outcome.stop, 'LOOP_GUARD_BLOCKED');
  assert.equal(stalled.agents, 1);
  assert.equal(stalled.rereviews, 1);
  assert.equal(stalled.cores, 1);

  const open = await once('verify');
  assert.equal(open.outcome.effect?.code, 'INCONCLUSIVE');
  assert.equal(open.outcome.stop, 'VERIFICATION_STOPPED');
  assert.equal(open.agents, 1);
  assert.equal(open.rereviews, 1);
  assert.equal(open.cores, 1);

  const resolved = await once('resolved');
  assert.equal(resolved.outcome.stop, 'ACCEPT');
  assert.equal(resolved.outcome.effect?.code, 'EFFECTIVE');
  assert.equal(resolved.agents, 1);
  assert.equal(resolved.rereviews, 2);
  assert.equal(resolved.cores, 2);
});

test('effect validation adds no permission, secret, or decision rewrite', () => {
  const files = [
    'src/lib/jury-product/improvement-effect-validation.ts',
    'src/lib/jury-product/improvement-effect-validation-store.ts',
  ];
  for (const file of files) {
    const source = readFileSync(path.resolve(process.cwd(), file), 'utf8');
    assert.equal(source.includes('automation.write'), false, file);
    assert.equal(source.includes('juryAuditEvent'), false, file);
    assert.equal(source.includes('postgres://'), false, file);
    assert.equal(source.includes('extractActualFromRun'), false, file);
    assert.equal(source.includes(LIVE_REVIEW.slice(0, 16)), false, file);
    assert.equal(source.includes(LIVE_CYCLE.slice(0, 16)), false, file);
    assert.equal(source.includes('.create('), false, file);
    assert.equal(source.includes('.update('), false, file);
    assert.equal(source.includes('clientTenantId'), false, file);
  }
});

test('the live review and cycle are only read', async () => {
  loadEnv();
  const { prisma } = await import('@/lib/prisma');
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
    },
  });
  assert.equal(review?.expectedDecision, 'VERIFY');
  assert.equal(cycle?.status, 'ACTIVE');
  assert.equal(cycle?.iteration, 2);
  assert.equal(cycle?.verificationAttempts, 1);
  assert.equal(cycle?.sameDecisionCount, 2);
  assert.equal(cycle?.sameConflictCount, 2);
  assert.equal(await prisma.juryAutoLoopActivation.count({ where: { tenantId: review?.tenantId ?? 'missing' } }), 0);
});

function command() {
  return {
    userId: owner.userId,
    memberships: [owner],
    clientTenantId: 'forged-tenant',
    now: '2026-10-02T07:40:00.000Z',
    rootReviewResultId: 'root-1',
  };
}

async function once(mode: 'accept' | 'reword' | 'verify' | 'resolved') {
  const box = harness(mode);
  const outcome = await runImprovementAutoLoop(command(), box.io);
  return { outcome, io: box.io, agents: box.agents, gates: box.gates, rereviews: box.rereviews, cores: box.cores };
}

function harness(mode: 'accept' | 'reword' | 'verify' | 'resolved') {
  const box = { agents: 0, gates: 0, rereviews: 0, cores: 0, done: new Set<string>(), passes: 0 };
  let execution: string | null = null;
  let gate: string | null = null;
  const io = {
    async iteration(step: { reviewResultId: string }) {
      if (step.reviewResultId === 'review-3') return decision('ACCEPT', 'NONE', null, null);
      if (step.reviewResultId === 'review-2') {
        if (mode === 'reword') return decision('REWORD', 'IMPROVEMENT', null, 'improvement-2');
        if (mode === 'accept') return decision('ACCEPT', 'NONE', null, null);
        return decision('VERIFY', 'VERIFICATION', 'verification-1', null);
      }
      return decision('REWORD', 'IMPROVEMENT', null, 'improvement-1');
    },
    async policy() {
      return PRODUCT_LOOP_GUARD_DEFAULTS;
    },
    async counters() {
      box.passes += 1;
      const iteration = mode === 'reword' && box.passes > 1 ? 5 : 1;
      return { iteration, verificationAttempts: 0, sameDecisionCount: 1, sameConflictCount: 0, runtimeMs: null, costUsd: null };
    },
    async alreadyDone(taskId: string) {
      return box.done.has(taskId);
    },
    async markDone(taskId: string) {
      box.done.add(taskId);
    },
    async agent() {
      if (execution) return { ok: true as const, executionId: execution, status: 'COMPLETED' };
      execution = 'exec-1';
      box.agents += 1;
      return { ok: true as const, executionId: execution, status: 'COMPLETED' };
    },
    async gate() {
      if (!gate) {
        gate = 'gate-1';
        box.gates += 1;
      }
      return { ok: true as const, id: gate, status: 'APPROVED' };
    },
    async rereview() {
      box.rereviews += 1;
      box.cores += 1;
      return { ok: true as const, reviewResultId: 'review-2', coreRuns: 1 };
    },
    async verification() {
      if (mode === 'resolved') return { ok: true as const, status: 'RESOLVED' };
      return { ok: true as const, status: 'INCONCLUSIVE' };
    },
    async verificationReview() {
      box.rereviews += 1;
      box.cores += 1;
      return { ok: true as const, reviewResultId: 'review-3', coreRuns: 1 };
    },
    async effect(step: { decision: 'ACCEPT' | 'VERIFY' | 'REWORD' }): Promise<ImprovementEffectResult> {
      return evaluateImprovementEffect(
        base({
          decision: step.decision,
          overclaimPersists: mode === 'reword',
          verificationStatus: mode === 'resolved' && step.decision === 'ACCEPT' ? 'RESOLVED' : null,
        }),
      );
    },
  };
  return {
    get agents() {
      return box.agents;
    },
    get gates() {
      return box.gates;
    },
    get rereviews() {
      return box.rereviews;
    },
    get cores() {
      return box.cores;
    },
    io,
  };
}

function decision(
  decisionName: 'ACCEPT' | 'VERIFY' | 'REWORD',
  nextAction: 'NONE' | 'VERIFICATION' | 'IMPROVEMENT',
  verificationTaskId: string | null,
  improvementTaskId: string | null,
) {
  return {
    ok: true as const,
    decision: decisionName,
    nextAction,
    cycleStatus: decisionName === 'ACCEPT' ? 'COMPLETED' : 'ACTIVE',
    guard: 'ALLOWED',
    verificationTaskId,
    decisionTaskId: 'decision-1',
    improvementTaskId,
    cycleId: 'cycle-1',
  };
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
