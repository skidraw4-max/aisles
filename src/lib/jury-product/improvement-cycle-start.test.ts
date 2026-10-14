/**
 * New improvement cycle start. No agent, change gate, re-review, or core.
 * Run: node --import tsx --test src/lib/jury-product/improvement-cycle-start.test.ts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import type { DecisionTaskDraft } from './decision-task';
import { REWORD_CONSTRAINTS, type ImprovementTaskDraft } from './improvement-bridge';
import {
  CycleStartAbort,
  improvementCycleAction,
  isUniqueViolation,
  startNewImprovementCycle,
  type StartIo,
  type StartLoaded,
  type StartReview,
} from './improvement-cycle-start';
import { PRODUCT_LOOP_GUARD_DEFAULTS, type DecisionCycleDraft, type ProductLoopGuardPolicy } from './loop-guard';
import type { JuryMembership } from './records';

const owner: JuryMembership = {
  id: 'mem-1',
  tenantId: 'tenant-a',
  userId: 'user-1',
  role: 'OWNER',
  createdAt: '2026-10-01T00:00:00.000Z',
};

const command = {
  userId: 'user-1',
  memberships: [owner],
  clientTenantId: 'forged-tenant',
  now: '2026-10-02T09:49:00.000Z',
  reviewResultId: 'reword-1',
};

function review(partial?: Partial<StartReview>): StartReview {
  return {
    id: 'reword-1',
    tenantId: 'tenant-a',
    evidenceId: 'ev-1',
    expectedDecision: 'REWORD',
    evidenceStrength: 'moderate',
    claimStrength: 'weak',
    conflictDetected: true,
    overclaimDetected: true,
    revisionRequired: true,
    completedAt: '2026-10-02T00:00:00.000Z',
    requestStatus: 'COMPLETED',
    verificationResultId: null,
    evidenceIdentity: 'evidence-hash',
    ...partial,
  };
}

function harness(partial?: Partial<StartLoaded> & { policy?: { id: string; policy: ProductLoopGuardPolicy } | null; fail?: 'cycle' | 'decision' | 'improvement' | 'audit' }) {
  const state = {
    cycles: [] as DecisionCycleDraft[],
    tasks: [] as DecisionTaskDraft[],
    improvements: [] as ImprovementTaskDraft[],
    audits: [] as string[],
    parentReviewResultId: 'parent-reword',
    protected: {
      id: '14308b4c999ccbe8ca54b7f31da5385385d4073c49bbf2955582a6bb96afb01e',
      rootReviewResultId: '2f6638a0addf8a8706ddf8d53396bb81b37c9aeadae4910a33be00f634be3f59',
      currentReviewResultId: '6adbe7150104e3b95030e5499f52085d8e72dbcb8f999136782bdb0f96fbd7e7',
      iteration: 2,
      verificationAttempts: 1,
      sameDecisionCount: 2,
      sameConflictCount: 2,
      updatedAt: '2026-10-01T16:33:57.676Z',
    },
    loaded: {
      review: review(),
      evidence: { id: 'ev-1', tenantId: 'tenant-a' },
      cycle: null,
      decisionTask: null,
      decisionLinked: false,
      improvementTask: null,
      improvementLinked: false,
      ...partial,
    } as StartLoaded,
    policy: partial && 'policy' in partial ? partial.policy ?? null : { id: 'policy-stored', policy: { ...PRODUCT_LOOP_GUARD_DEFAULTS, maxIterations: 4 } },
    fail: partial?.fail,
  };
  const io: StartIo = {
    async load() {
      await Promise.resolve();
      const cycle = state.cycles.find((row) => row.rootReviewResultId === state.loaded.review.id) ?? state.loaded.cycle;
      const decisionTask = state.tasks.find((row) => row.reviewResultId === state.loaded.review.id && row.taskType === 'REWORD') ?? state.loaded.decisionTask;
      const improvementTask = state.improvements.find((row) => row.reviewResultId === state.loaded.review.id) ?? state.loaded.improvementTask;
      return {
        ...state.loaded,
        cycle,
        decisionTask,
        decisionLinked: state.loaded.decisionLinked || Boolean(decisionTask),
        improvementTask,
        improvementLinked: state.loaded.improvementLinked || Boolean(improvementTask),
      };
    },
    async findPolicy() {
      return state.policy;
    },
    async insertCycle(cycle) {
      await Promise.resolve();
      if (state.fail === 'cycle') throw new Error('CYCLE_INSERT');
      if (state.cycles.some((row) => row.rootReviewResultId === cycle.rootReviewResultId)) {
        const error = new Error('unique') as Error & { code: string };
        error.code = 'P2002';
        throw error;
      }
      state.cycles.push(cycle);
    },
    async auditCycle(event) {
      if (state.fail === 'audit') throw new Error('AUDIT_INSERT');
      const fingerprint = [event.cycle.rootReviewResultId, 'DECISION_CYCLE_CREATED', event.decisionTaskId, event.improvementTaskId].join('\n');
      if (state.audits.includes(fingerprint)) return;
      assert.equal(JSON.stringify(event).includes('postgres://'), false);
      state.audits.push(fingerprint);
    },
    decisionTx: {
      async findByResultAndType(reviewResultId, taskType) {
        return state.tasks.find((row) => row.reviewResultId === reviewResultId && row.taskType === taskType) ?? null;
      },
      async insert(task) {
        if (state.fail === 'decision') throw new Error('DECISION_INSERT');
        if (state.tasks.some((row) => row.reviewResultId === task.reviewResultId && row.taskType === task.taskType)) {
          const error = new Error('unique') as Error & { code: string };
          error.code = 'P2002';
          throw error;
        }
        state.tasks.push(task);
      },
    },
    improvementTx: {
      async findByDecisionTask(decisionTaskId) {
        return state.improvements.find((row) => row.decisionTaskId === decisionTaskId) ?? null;
      },
      async insert(task) {
        if (state.fail === 'improvement') throw new Error('IMPROVEMENT_INSERT');
        if (state.improvements.some((row) => row.decisionTaskId === task.decisionTaskId)) {
          const error = new Error('unique') as Error & { code: string };
          error.code = 'P2002';
          throw error;
        }
        state.improvements.push(task);
      },
      async audit() {},
    },
  };
  return { state, io };
}

function snapshot(state: ReturnType<typeof harness>['state']) {
  return JSON.parse(JSON.stringify({ cycles: state.cycles, tasks: state.tasks, improvements: state.improvements, audits: state.audits, protected: state.protected, parent: state.parentReviewResultId })) as {
    cycles: DecisionCycleDraft[];
    tasks: DecisionTaskDraft[];
    improvements: ImprovementTaskDraft[];
    audits: string[];
    protected: typeof state.protected;
    parent: string;
  };
}

async function transaction(box: ReturnType<typeof harness>, run: () => Promise<Awaited<ReturnType<typeof startNewImprovementCycle>>>) {
  const before = snapshot(box.state);
  try {
    return await run();
  } catch (error) {
    box.state.cycles.splice(0, box.state.cycles.length, ...before.cycles);
    box.state.tasks.splice(0, box.state.tasks.length, ...before.tasks);
    box.state.improvements.splice(0, box.state.improvements.length, ...before.improvements);
    box.state.audits.splice(0, box.state.audits.length, ...before.audits);
    if (error instanceof CycleStartAbort) return { ok: false as const, reason: error.reason };
    return { ok: false as const, reason: 'ROLLED_BACK' as const };
  }
}

async function withUniqueRetry<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    return run();
  }
}

describe('improvement cycle start', () => {
  it('starts one cycle and both tasks for a completed reword review', async () => {
    const box = harness();
    const started = await transaction(box, () => startNewImprovementCycle(command, box.io));
    assert.equal(started.ok, true);
    if (!started.ok) return;
    assert.equal(started.created, true);
    assert.equal(box.state.cycles.length, 1);
    assert.equal(box.state.tasks.length, 1);
    assert.equal(box.state.improvements.length, 1);
    assert.equal(started.cycle.rootReviewResultId, 'reword-1');
    assert.equal(started.cycle.currentReviewResultId, 'reword-1');
    assert.equal(started.cycle.status, 'ACTIVE');
    assert.equal(started.cycle.iteration, 1);
    assert.equal(started.cycle.verificationAttempts, 0);
    assert.equal(started.cycle.sameDecisionCount, 1);
    assert.equal(started.cycle.sameConflictCount, 1);
    assert.equal(started.cycle.policyId, 'policy-stored');
    assert.equal(started.policy.maxIterations, 4);
    assert.equal(started.decisionTask.taskType, 'REWORD');
    assert.equal(started.decisionTask.status, 'OPEN');
    assert.equal(started.improvementTask.status, 'OPEN');
    assert.deepEqual(started.improvementTask.constraints, [...REWORD_CONSTRAINTS]);
    assert.equal(box.state.audits.length, 1);
    assert.equal(box.state.parentReviewResultId, 'parent-reword');
    assert.equal(box.state.protected.updatedAt, '2026-10-01T16:33:57.676Z');
    assert.equal(box.state.protected.iteration, 2);
  });

  it('keeps an existing cycle and refuses accept or verify', async () => {
    const existing = harness({
      cycle: {
        id: 'cycle-existing',
        tenantId: 'tenant-a',
        rootReviewResultId: 'reword-1',
        currentReviewResultId: 'reword-1',
        iteration: 1,
        verificationAttempts: 0,
        sameDecisionCount: 1,
        sameConflictCount: 0,
        decisionFingerprint: 'kept',
        conflictFingerprint: 'kept',
        status: 'ACTIVE',
        blockedReason: null,
        policyId: 'policy-stored',
        startedAt: '2026-10-02T00:00:00.000Z',
        updatedAt: '2026-10-02T01:00:00.000Z',
      },
    });
    const again = await startNewImprovementCycle(command, existing.io);
    assert.equal(again.ok, true);
    if (!again.ok) return;
    assert.equal(again.created, false);
    assert.equal(again.cycle.id, 'cycle-existing');
    assert.equal(again.cycle.updatedAt, '2026-10-02T01:00:00.000Z');
    assert.equal(existing.state.cycles.length, 0);

    const accepted = harness({ review: review({ expectedDecision: 'ACCEPT', conflictDetected: false }) });
    const accept = await startNewImprovementCycle(command, accepted.io);
    assert.equal(accept.ok, false);
    if (accept.ok) return;
    assert.equal(accept.reason, 'DECISION_NOT_REWORD');
    assert.equal(accepted.state.cycles.length, 0);
    assert.equal(accepted.state.tasks.length, 0);

    const verified = harness({ review: review({ expectedDecision: 'VERIFY' }) });
    const verify = await startNewImprovementCycle(command, verified.io);
    assert.equal(verify.ok, false);
    if (verify.ok) return;
    assert.equal(verify.reason, 'DECISION_NOT_REWORD');
    assert.equal(verified.state.cycles.length, 0);

    assert.equal(improvementCycleAction({ ok: true, cycle: { rootReviewResultId: 'root', currentReviewResultId: 'child' } }, 'child'), 'EXISTING_CYCLE');
    assert.equal(improvementCycleAction({ ok: false, reason: 'DECISION_CYCLE_NOT_FOUND' }, 'child'), 'START');
    assert.equal(improvementCycleAction({ ok: true, cycle: { rootReviewResultId: 'child', currentReviewResultId: 'child' } }, 'child'), 'REPLAY');
  });

  it('returns the same rows for a repeat and for a unique conflict', async () => {
    const box = harness();
    const first = await startNewImprovementCycle(command, box.io);
    const second = await startNewImprovementCycle(command, box.io);
    assert.equal(first.ok && second.ok, true);
    if (!first.ok || !second.ok) return;
    assert.equal(second.created, false);
    assert.equal(second.cycle.id, first.cycle.id);
    assert.equal(second.decisionTask.id, first.decisionTask.id);
    assert.equal(second.improvementTask.id, first.improvementTask.id);
    assert.equal(box.state.cycles.length, 1);
    assert.equal(box.state.tasks.length, 1);
    assert.equal(box.state.improvements.length, 1);

    const raced = harness();
    const [left, right] = await Promise.all([
      withUniqueRetry(() => startNewImprovementCycle(command, raced.io)),
      withUniqueRetry(() => startNewImprovementCycle(command, raced.io)),
    ]);
    assert.equal(left.ok && right.ok, true);
    assert.equal(raced.state.cycles.length, 1);
    assert.equal(raced.state.tasks.length, 1);
    assert.equal(raced.state.improvements.length, 1);
  });

  it('rejects another tenant, a secret, and rolls back a partial write', async () => {
    const foreign = harness({ review: review({ tenantId: 'tenant-b' }), evidence: { id: 'ev-1', tenantId: 'tenant-b' } });
    const mismatch = await startNewImprovementCycle(command, foreign.io);
    assert.equal(mismatch.ok, false);
    if (mismatch.ok) return;
    assert.equal(mismatch.reason, 'TENANT_MISMATCH');
    assert.equal(foreign.state.cycles.length, 0);

    const secret = harness({
      review: review({ evidenceId: 'postgres://user:password@host/db' }),
      evidence: { id: 'postgres://user:password@host/db', tenantId: 'tenant-a' },
    });
    const leaked = await startNewImprovementCycle(command, secret.io);
    assert.equal(leaked.ok, false);
    if (leaked.ok) return;
    assert.equal(leaked.reason, 'CREDENTIAL_IN_REASON');
    assert.equal(secret.state.cycles.length, 0);

    for (const fail of ['cycle', 'decision', 'improvement', 'audit'] as const) {
      const failed = harness({ fail });
      const outcome = await transaction(failed, () => startNewImprovementCycle(command, failed.io));
      assert.equal(outcome.ok, false);
      assert.equal(failed.state.cycles.length, 0);
      assert.equal(failed.state.tasks.length, 0);
      assert.equal(failed.state.improvements.length, 0);
      assert.equal(failed.state.audits.length, 0);
    }

    const defaults = harness({ policy: null });
    const started = await startNewImprovementCycle(command, defaults.io);
    assert.equal(started.ok, true);
    if (!started.ok) return;
    assert.equal(started.cycle.policyId, '');
    assert.deepEqual(started.policy, PRODUCT_LOOP_GUARD_DEFAULTS);

    const quiet = harness({ review: review({ conflictDetected: false }) });
    const noConflict = await startNewImprovementCycle(command, quiet.io);
    assert.equal(noConflict.ok, true);
    if (!noConflict.ok) return;
    assert.equal(noConflict.cycle.sameConflictCount, 0);

    const source = readFileSync(new URL('./improvement-cycle-start.ts', import.meta.url), 'utf8');
    const lineage = readFileSync(new URL('./decision-cycle-lineage.ts', import.meta.url), 'utf8');
    assert.equal(source.includes('runReviewBoardPipeline'), false);
    assert.equal(source.includes('recordDecisionCycle'), false);
    assert.equal(source.includes('persistAgentExecution'), false);
    assert.equal(source.includes('evaluateChangeGate'), false);
    assert.equal(source.includes('1800000'), false);
    assert.equal(lineage.includes('startNewImprovementCycle'), false);
    assert.equal(lineage.includes('insertCycle'), false);
  });
});
