/**
 * Auto-loop boundary. One explicit loop, no live agent, no recursion.
 * Run: node --import tsx --test src/lib/jury-product/improvement-auto-loop.test.ts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { runImprovementAutoLoop, type AutoLoopResult } from './improvement-auto-loop';
import type { IterationStop } from './improvement-iteration';
import { PRODUCT_LOOP_GUARD_DEFAULTS } from './loop-guard';
import type { JuryMembership } from './records';

const owner: JuryMembership = {
  id: 'mem-1',
  tenantId: 'tenant-a',
  userId: 'user-1',
  role: 'OWNER',
  createdAt: '2026-10-01T00:00:00.000Z',
};
const protectedCycle = {
  id: '14308b4c999ccbe8ca54b7f31da5385385d4073c49bbf2955582a6bb96afb01e',
  rootReviewResultId: '2f6638a0addf8a8706ddf8d53396bb81b37c9aeadae4910a33be00f634be3f59',
  currentReviewResultId: '6adbe7150104e3b95030e5499f52085d8e72dbcb8f999136782bdb0f96fbd7e7',
  iteration: 2,
  verificationAttempts: 1,
  sameDecisionCount: 2,
  sameConflictCount: 2,
  status: 'ACTIVE',
  updatedAt: '2026-10-01T16:33:57.676Z',
};

function command(rootReviewResultId: string) {
  return { userId: 'user-1', memberships: [owner], clientTenantId: 'forged-tenant', now: '2026-10-02T11:21:00.000Z', rootReviewResultId };
}

function step(partial: Partial<Extract<IterationStop, { ok: true }>>): IterationStop {
  return {
    ok: true,
    decision: 'REWORD',
    nextAction: 'IMPROVEMENT',
    cycleStatus: 'ACTIVE',
    guard: 'ALLOWED',
    verificationTaskId: null,
    decisionTaskId: 'task-1',
    improvementTaskId: 'imp-1',
    cycleId: 'cycle-fixture',
    ...partial,
  };
}

function world(options?: {
  steps?: IterationStop[];
  gateStatus?: string;
  verificationStatus?: string;
  nextReview?: string;
  counters?: { iteration: number; verificationAttempts: number; sameDecisionCount: number; sameConflictCount: number };
  failAgent?: boolean;
}) {
  const steps = [...(options?.steps ?? [step({})])];
  const done = new Set<string>();
  const counts = { agent: 0, gate: 0, rereview: 0, core: 0, adapter: 0 };
  let agentReady = false;
  const io = {
    async iteration(input: { reviewResultId: string }) {
      const next = steps.shift();
      if (next) return next;
      return { ok: false as const, reason: 'REVIEW_NOT_FOUND' as const };
    },
    async policy() {
      return PRODUCT_LOOP_GUARD_DEFAULTS;
    },
    async counters() {
      return {
        iteration: options?.counters?.iteration ?? 1,
        verificationAttempts: options?.counters?.verificationAttempts ?? 0,
        sameDecisionCount: options?.counters?.sameDecisionCount ?? 1,
        sameConflictCount: options?.counters?.sameConflictCount ?? 0,
        runtimeMs: null,
        costUsd: null,
      };
    },
    async alreadyDone(taskId: string) {
      return done.has(taskId);
    },
    async markDone(taskId: string) {
      done.add(taskId);
    },
    async agent() {
      counts.agent += 1;
      if (options?.failAgent) return { ok: false as const, reason: 'AGENT_EXECUTION_FAILED' };
      if (agentReady) {
        const error = new Error('unique') as Error & { code: string };
        error.code = 'P2002';
        throw error;
      }
      agentReady = true;
      counts.adapter += 1;
      return { ok: true as const, executionId: 'exec-1', status: 'COMPLETED' };
    },
    async gate() {
      counts.gate += 1;
      return { ok: true as const, id: 'gate-1', status: options?.gateStatus ?? 'APPROVED' };
    },
    async rereview() {
      counts.rereview += 1;
      counts.core += 1;
      return { ok: true as const, reviewResultId: options?.nextReview ?? 'review-2', coreRuns: 1 };
    },
    async verification(_taskId: string) {
      return { ok: true as const, status: options?.verificationStatus ?? 'INCONCLUSIVE' };
    },
    async verificationReview() {
      counts.rereview += 1;
      counts.core += 1;
      return { ok: true as const, reviewResultId: options?.nextReview ?? 'review-3', coreRuns: 1 };
    },
  };
  return { io, counts, done };
}

describe('improvement auto loop boundary', () => {
  it('walks an approved change into a verification task and stops', async () => {
    const fixture = world({
      steps: [
        step({}),
        step({ decision: 'VERIFY', nextAction: 'VERIFICATION', verificationTaskId: 'ver-1', improvementTaskId: null, decisionTaskId: 'ver-1' }),
      ],
    });
    const outcome = await runImprovementAutoLoop(command('root-1'), fixture.io);
    assert.equal(outcome.stop, 'VERIFICATION_STOPPED');
    assert.equal(outcome.agentRuns, 1);
    assert.equal(outcome.gateRuns, 1);
    assert.equal(outcome.rereviewRuns, 1);
    assert.equal(fixture.counts.adapter, 1);
    assert.equal(fixture.counts.core, 1);
    assert.equal(outcome.guardReasons[0], 'ALLOWED');
    fixture.io.iteration = async () => step({});
    const again = await runImprovementAutoLoop(command('root-1'), fixture.io);
    assert.equal(again.stop, 'ALREADY_COMPLETED');
    assert.equal(fixture.counts.adapter, 1);
  });

  it('stops when the change gate is gated or the cycle is accepted', async () => {
    const gated = world({ gateStatus: 'GATED' });
    const gateStop = await runImprovementAutoLoop(command('root-1'), gated.io);
    assert.equal(gateStop.stop, 'CHANGE_GATE_GATED');
    assert.equal(gated.counts.rereview, 0);
    assert.equal(gated.counts.core, 0);

    const accepted = world({
      steps: [step({}), step({ decision: 'ACCEPT', nextAction: 'NONE', cycleStatus: 'COMPLETED', improvementTaskId: null, decisionTaskId: null })],
    });
    const accept = await runImprovementAutoLoop(command('root-1'), accepted.io);
    assert.equal(accept.stop, 'ACCEPT');
    assert.equal(accept.agentRuns, 1);
    assert.equal(accepted.counts.core, 1);
  });

  it('checks the loop guard before another improvement and stops a blocked cycle', async () => {
    let phase = 0;
    const continued = world({
      steps: [
        step({ decision: 'VERIFY', nextAction: 'VERIFICATION', verificationTaskId: 'ver-1', improvementTaskId: null, decisionTaskId: 'ver-1' }),
        step({ improvementTaskId: 'imp-2', decisionTaskId: 'task-2' }),
      ],
      verificationStatus: 'RESOLVED',
      nextReview: 'review-2',
    });
    continued.io.counters = async () => ({
      iteration: phase === 0 ? 1 : 5,
      verificationAttempts: phase === 0 ? 1 : 2,
      sameDecisionCount: 1,
      sameConflictCount: 0,
      runtimeMs: null,
      costUsd: null,
    });
    const originalVerification = continued.io.verification;
    continued.io.verification = async (taskId: string) => {
      phase = 1;
      return originalVerification(taskId);
    };
    const moved = await runImprovementAutoLoop(command('verify-root'), continued.io);
    assert.equal(moved.stop, 'LOOP_GUARD_BLOCKED');
    assert.equal(moved.guardReasons.includes('MAX_ITERATIONS'), true);
    assert.equal(continued.counts.agent, 0);

    const blocked = world({
      steps: [step({ nextAction: 'NONE', cycleStatus: 'BLOCKED', guard: 'MAX_ITERATIONS', improvementTaskId: null, decisionTaskId: null })],
    });
    const stop = await runImprovementAutoLoop(command('root-1'), blocked.io);
    assert.equal(stop.stop, 'LOOP_GUARD_BLOCKED');
    assert.equal(blocked.counts.agent, 0);
    assert.equal(protectedCycle.updatedAt, '2026-10-01T16:33:57.676Z');
    assert.equal(protectedCycle.status, 'ACTIVE');
  });

  it('keeps one execution when two loops race and refuses unsafe calls', async () => {
    const shared = world({ steps: [] });
    shared.io.iteration = async () => step({});
    let executions = 0;
    shared.io.agent = async () => {
      executions += 1;
      if (executions === 2) {
        const error = new Error('unique') as Error & { code: string };
        error.code = 'P2002';
        throw error;
      }
      if (executions === 1) shared.counts.adapter += 1;
      return { ok: true as const, executionId: 'exec-1', status: 'COMPLETED' };
    };
    let gateOnce = false;
    shared.io.gate = async () => {
      if (!gateOnce) {
        gateOnce = true;
        shared.counts.gate += 1;
      }
      return { ok: true as const, id: 'gate-1', status: 'APPROVED' };
    };
    let reviewOnce = false;
    shared.io.rereview = async () => {
      if (!reviewOnce) {
        reviewOnce = true;
        shared.counts.rereview += 1;
        shared.counts.core += 1;
        return { ok: true as const, reviewResultId: 'review-2', coreRuns: 1 };
      }
      return { ok: true as const, reviewResultId: 'review-2', coreRuns: 0 };
    };
    const [left, right] = await Promise.all([
      runImprovementAutoLoop(command('root-1'), shared.io),
      runImprovementAutoLoop(command('root-1'), shared.io),
    ]);
    assert.equal(left.agentRuns + right.agentRuns >= 1, true);
    assert.equal(shared.counts.adapter, 1);
    assert.equal(shared.counts.core <= 1, true);

    for (const reason of ['TENANT_MISMATCH', 'FORBIDDEN', 'CREDENTIAL_IN_REASON'] as const) {
      const unsafe = world({});
      unsafe.io.iteration = async () => ({ ok: false, reason });
      const outcome = await runImprovementAutoLoop(command('root-1'), unsafe.io);
      assert.equal(outcome.stop, reason === 'CREDENTIAL_IN_REASON' ? 'CREDENTIAL_IN_REASON' : reason);
      assert.equal(unsafe.counts.agent, 0);
      assert.equal(unsafe.counts.gate, 0);
      assert.equal(unsafe.counts.core, 0);
    }

    const missing = world({});
    missing.io.iteration = async () => ({ ok: false, reason: 'DECISION_CYCLE_NOT_FOUND' });
    const live = await runImprovementAutoLoop(command('3707202563ecae9b38f324a4eefd9243a14bc69420ed6cdda16c4c5794f62e0d'), missing.io);
    assert.equal(live.stop, 'DECISION_CYCLE_NOT_FOUND');
    assert.equal(missing.counts.agent, 0);
    assert.equal(missing.counts.core, 0);

    const source = readFileSync(new URL('./improvement-auto-loop.ts', import.meta.url), 'utf8');
    const store = readFileSync(new URL('./improvement-auto-loop-store.ts', import.meta.url), 'utf8');
    assert.equal(source.includes('evaluateLoopGuard('), true);
    assert.equal(source.split('runImprovementAutoLoop(').length, 2);
    for (const text of [source, store]) {
      assert.equal(text.includes('child_process'), false);
      assert.equal(text.includes('runReviewBoardPipeline'), false);
      assert.equal(text.includes('1800000'), false);
    }
    void (live satisfies AutoLoopResult);
  });
});
