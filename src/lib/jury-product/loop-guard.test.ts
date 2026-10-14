/**
 * Product decision-cycle loop guard. It does not call the review core.
 * Run: node --import tsx --test src/lib/jury-product/loop-guard.test.ts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import type { JuryMembership } from './records';
import {
  PRODUCT_LOOP_GUARD_DEFAULTS,
  conflictFingerprint,
  decisionFingerprint,
  evaluateLoopGuard,
  foldDecisionCycle,
  recordDecisionCycle,
  type CycleReviewNode,
  type DecisionCycleDraft,
  type DecisionCycleWriteTx,
} from './loop-guard';

const membership: JuryMembership = {
  id: 'mem-1',
  tenantId: 'tenant-a',
  userId: 'user-1',
  role: 'OWNER',
  createdAt: '2026-10-01T00:00:00.000Z',
};

function review(partial: Partial<CycleReviewNode> & Pick<CycleReviewNode, 'id'>): CycleReviewNode {
  return {
    tenantId: 'tenant-a',
    evidenceIdentity: 'hash-1',
    decision: 'VERIFY',
    conflictDetected: true,
    overclaimDetected: false,
    revisionRequired: false,
    parentReviewResultId: null,
    verificationResultId: null,
    completedAt: '2026-10-01T15:32:34.609Z',
    ...partial,
  };
}

const liveChain = (): CycleReviewNode[] => [
  review({ id: 'review-1', completedAt: '2026-10-01T15:32:34.609Z' }),
  review({
    id: 'review-2',
    parentReviewResultId: 'review-1',
    verificationResultId: 'verification-1',
    completedAt: '2026-10-01T16:20:20.605Z',
  }),
];

function memory(chain: CycleReviewNode[]): DecisionCycleWriteTx & { audits: string[]; tasks: number; policyTenants: string[] } {
  const state = {
    audits: [] as string[],
    tasks: 0,
    policyTenants: [] as string[],
    policies: [] as Array<{ id: string; tenantId: string; policy: typeof PRODUCT_LOOP_GUARD_DEFAULTS }>,
    cycles: [] as DecisionCycleDraft[],
    chain,
  };
  const tx: DecisionCycleWriteTx & { audits: string[]; tasks: number; policyTenants: string[] } = {
    audits: state.audits,
    tasks: 0,
    get policyTenants() {
      return state.policyTenants;
    },
    async loadChain() {
      return state.chain;
    },
    async findPolicy(tenantId) {
      state.policyTenants.push(tenantId);
      const row = state.policies.find((item) => item.tenantId === tenantId);
      return row ? { id: row.id, policy: row.policy } : null;
    },
    async insertPolicy(tenantId, policy) {
      const id = `policy-${tenantId}`;
      state.policies.push({ id, tenantId, policy });
      return id;
    },
    async findCycle(rootReviewResultId) {
      return state.cycles.find((row) => row.rootReviewResultId === rootReviewResultId) ?? null;
    },
    async insertCycle(cycle) {
      state.cycles.push(cycle);
    },
    async audit(action) {
      state.audits.push(action);
    },
  };
  return tx;
}

describe('product loop guard', () => {
  it('allows the current verify cycle and blocks the first exceeded limit in order', () => {
    const folded = foldDecisionCycle(liveChain());
    assert.equal(folded.iteration, 2);
    assert.equal(folded.verificationAttempts, 1);
    assert.equal(folded.sameDecisionCount, 2);
    assert.equal(folded.sameConflictCount, 2);
    const current = evaluateLoopGuard({
      policy: PRODUCT_LOOP_GUARD_DEFAULTS,
      ...folded,
      runtimeMs: null,
      costUsd: null,
    });
    assert.equal(current.allowed, true);
    assert.equal(current.reason, 'ALLOWED');

    const below = evaluateLoopGuard({
      policy: PRODUCT_LOOP_GUARD_DEFAULTS,
      iteration: 4,
      verificationAttempts: 0,
      sameDecisionCount: 1,
      sameConflictCount: 0,
      runtimeMs: null,
      costUsd: null,
    });
    assert.equal(below.reason, 'ALLOWED');
    const iterations = evaluateLoopGuard({
      policy: PRODUCT_LOOP_GUARD_DEFAULTS,
      iteration: 5,
      verificationAttempts: 9,
      sameDecisionCount: 9,
      sameConflictCount: 9,
      runtimeMs: 9_999_999,
      costUsd: 99,
    });
    assert.equal(iterations.allowed, false);
    assert.equal(iterations.reason, 'MAX_ITERATIONS');

    assert.equal(
      evaluateLoopGuard({
        policy: PRODUCT_LOOP_GUARD_DEFAULTS,
        iteration: 1,
        verificationAttempts: 2,
        sameDecisionCount: 1,
        sameConflictCount: 0,
        runtimeMs: null,
        costUsd: null,
      }).reason,
      'MAX_VERIFICATION_ATTEMPTS',
    );
    assert.equal(
      evaluateLoopGuard({
        policy: PRODUCT_LOOP_GUARD_DEFAULTS,
        iteration: 1,
        verificationAttempts: 0,
        sameDecisionCount: 3,
        sameConflictCount: 0,
        runtimeMs: null,
        costUsd: null,
      }).reason,
      'MAX_SAME_DECISION',
    );
    assert.equal(
      evaluateLoopGuard({
        policy: PRODUCT_LOOP_GUARD_DEFAULTS,
        iteration: 1,
        verificationAttempts: 0,
        sameDecisionCount: 1,
        sameConflictCount: 2,
        runtimeMs: null,
        costUsd: null,
      }).reason,
      'ALLOWED',
    );
    assert.equal(
      evaluateLoopGuard({
        policy: PRODUCT_LOOP_GUARD_DEFAULTS,
        iteration: 1,
        verificationAttempts: 0,
        sameDecisionCount: 1,
        sameConflictCount: 3,
        runtimeMs: null,
        costUsd: null,
      }).reason,
      'MAX_SAME_CONFLICT',
    );
    assert.equal(
      evaluateLoopGuard({
        policy: PRODUCT_LOOP_GUARD_DEFAULTS,
        iteration: 1,
        verificationAttempts: 0,
        sameDecisionCount: 1,
        sameConflictCount: 0,
        runtimeMs: PRODUCT_LOOP_GUARD_DEFAULTS.maxRuntimeMs,
        costUsd: null,
      }).reason,
      'MAX_RUNTIME',
    );
    assert.equal(
      evaluateLoopGuard({
        policy: PRODUCT_LOOP_GUARD_DEFAULTS,
        iteration: 1,
        verificationAttempts: 0,
        sameDecisionCount: 1,
        sameConflictCount: 0,
        runtimeMs: null,
        costUsd: PRODUCT_LOOP_GUARD_DEFAULTS.maxCostUsd,
      }).reason,
      'MAX_COST',
    );
    assert.equal(
      evaluateLoopGuard({
        policy: {
          maxIterations: null,
          maxVerificationAttempts: null,
          maxSameDecision: null,
          maxSameConflict: null,
          maxRuntimeMs: null,
          maxCostUsd: null,
        },
        iteration: 100,
        verificationAttempts: 100,
        sameDecisionCount: 100,
        sameConflictCount: 100,
        runtimeMs: 100,
        costUsd: 100,
      }).reason,
      'ALLOWED',
    );
  });

  it('resets same-decision and same-conflict counts when the outcome changes', () => {
    const changedDecision = foldDecisionCycle([
      review({ id: 'review-1' }),
      review({ id: 'review-2', parentReviewResultId: 'review-1', decision: 'REWORD' }),
    ]);
    assert.equal(changedDecision.iteration, 2);
    assert.equal(changedDecision.sameDecisionCount, 1);
    const changedConflict = foldDecisionCycle([
      review({ id: 'review-1' }),
      review({
        id: 'review-2',
        parentReviewResultId: 'review-1',
        evidenceIdentity: 'hash-2',
      }),
    ]);
    assert.equal(changedConflict.sameConflictCount, 1);
    assert.notEqual(changedConflict.conflictFingerprint, conflictFingerprint({
      conflictDetected: true,
      overclaimDetected: false,
      revisionRequired: false,
      evidenceIdentity: 'hash-1',
    }));
    const cleared = foldDecisionCycle([
      review({ id: 'review-1' }),
      review({ id: 'review-2', parentReviewResultId: 'review-1', conflictDetected: false }),
    ]);
    assert.equal(cleared.sameConflictCount, 0);
    const again = decisionFingerprint({
      decision: 'VERIFY',
      conflictDetected: true,
      overclaimDetected: false,
      revisionRequired: false,
      evidenceIdentity: 'hash-1',
      verificationLineage: 'review-1>none',
    });
    assert.equal(
      again,
      decisionFingerprint({
        decision: 'VERIFY',
        conflictDetected: true,
        overclaimDetected: false,
        revisionRequired: false,
        evidenceIdentity: 'hash-1',
        verificationLineage: 'review-1>none',
      }),
    );
    assert.equal(again.includes('postgres://'), false);
  });

  it('records one active cycle for a root review and does not open a task', async () => {
    const tx = memory(liveChain());
    const command = {
      userId: 'user-1' as string | null,
      memberships: [membership],
      clientTenantId: 'tenant-b',
      now: '2026-10-02T00:00:00.000Z',
      rootReviewResultId: 'review-1',
    };
    const first = await recordDecisionCycle(command, tx);
    const second = await recordDecisionCycle(command, tx);
    assert.equal(first.ok && second.ok, true);
    if (!first.ok || !second.ok) return;
    assert.equal(first.created, true);
    assert.equal(second.created, false);
    assert.equal(second.cycle.id, first.cycle.id);
    assert.equal(first.cycle.status, 'ACTIVE');
    assert.equal(first.cycle.blockedReason, null);
    assert.equal(first.cycle.tenantId, 'tenant-a');
    assert.equal(first.cycle.iteration, 2);
    assert.equal(first.guard.reason, 'ALLOWED');
    assert.equal(tx.tasks, 0);
    assert.deepEqual(tx.audits, ['DECISION_CYCLE_CREATED']);
    assert.deepEqual(tx.policyTenants, ['tenant-a', 'tenant-a']);
    const source = readFileSync(new URL('./loop-guard.ts', import.meta.url), 'utf8');
    assert.equal(source.includes('runReviewBoardPipeline'), false);
    assert.equal(source.includes('extractActualFromRun'), false);
    assert.equal(source.includes('credentialRef'), false);
  });

  it('blocks another tenant and a cycle that already reached max iterations', async () => {
    const foreign = memory([review({ id: 'review-1', tenantId: 'tenant-b' })]);
    const blockedTenant = await recordDecisionCycle(
      {
        userId: 'user-1',
        memberships: [membership],
        clientTenantId: 'tenant-a',
        now: '2026-10-02T00:00:00.000Z',
        rootReviewResultId: 'review-1',
      },
      foreign,
    );
    assert.equal(blockedTenant.ok, false);
    if (!blockedTenant.ok) assert.equal(blockedTenant.reason, 'TENANT_MISMATCH');
    assert.equal(foreign.audits.length, 0);

    const longChain = [review({ id: 'review-1' })];
    for (let index = 2; index <= 5; index += 1) {
      longChain.push(
        review({
          id: `review-${index}`,
          parentReviewResultId: `review-${index - 1}`,
          completedAt: `2026-10-01T16:0${index}:00.000Z`,
        }),
      );
    }
    const tx = memory(longChain);
    const blocked = await recordDecisionCycle(
      {
        userId: 'user-1',
        memberships: [membership],
        now: '2026-10-02T00:00:00.000Z',
        rootReviewResultId: 'review-1',
      },
      tx,
    );
    assert.equal(blocked.ok, true);
    if (!blocked.ok) return;
    assert.equal(blocked.cycle.status, 'BLOCKED');
    assert.equal(blocked.cycle.blockedReason, 'MAX_ITERATIONS');
    assert.equal(blocked.guard.reason, 'MAX_ITERATIONS');
    assert.equal(tx.tasks, 0);
    assert.deepEqual(tx.audits, ['DECISION_CYCLE_CREATED', 'LOOP_GUARD_BLOCKED']);
  });
});
