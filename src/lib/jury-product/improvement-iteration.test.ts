/**
 * One improvement iteration. It stops after the existing decision step.
 * Run: node --import tsx --test src/lib/jury-product/improvement-iteration.test.ts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { resolveReReviewDecision, type ResolutionIo, type ResolutionSnapshot } from './decision-cycle-resolution';
import type { LineageCycleRef, LineageIo, LineageStep } from './decision-cycle-lineage';
import type { DecisionTaskDraft } from './decision-task';
import { reenterReReviewDecision } from './improvement-decision-reentry';
import { startNewImprovementCycle, type StartIo, type StartReview } from './improvement-cycle-start';
import { runSingleImprovementIteration, type IterationReview } from './improvement-iteration';
import type { ImprovementTaskDraft } from './improvement-bridge';
import { PRODUCT_LOOP_GUARD_DEFAULTS, type CycleReviewNode, type DecisionCycleDraft } from './loop-guard';
import type { JuryMembership } from './records';

const owner: JuryMembership = {
  id: 'mem-1',
  tenantId: 'tenant-a',
  userId: 'user-1',
  role: 'OWNER',
  createdAt: '2026-10-01T00:00:00.000Z',
};
const member: JuryMembership = { ...owner, id: 'mem-2', userId: 'user-2', role: 'DEVELOPER' };
const auditor: JuryMembership = { ...owner, id: 'mem-3', userId: 'user-3', role: 'VIEWER' };
const protectedCycle = {
  id: '14308b4c999ccbe8ca54b7f31da5385385d4073c49bbf2955582a6bb96afb01e',
  iteration: 2,
  verificationAttempts: 1,
  sameDecisionCount: 2,
  sameConflictCount: 2,
  status: 'ACTIVE',
  updatedAt: '2026-10-01T16:33:57.676Z',
};

function command(reviewResultId: string, memberships: readonly JuryMembership[] = [owner], userId = 'user-1') {
  return { userId, memberships, clientTenantId: 'forged-tenant', now: '2026-10-02T11:14:00.000Z', reviewResultId };
}

function review(id: string, decision: string, tenantId = 'tenant-a'): IterationReview {
  return { id, tenantId, expectedDecision: decision, requestStatus: 'COMPLETED', completedAt: '2026-10-02T00:00:00.000Z' };
}

function lineage(steps: Record<string, LineageStep>, cycles: Record<string, LineageCycleRef>): LineageIo {
  return {
    async load(id) {
      return steps[id] ?? null;
    },
    async cyclesFor(id) {
      return cycles[id] ? [cycles[id]] : [];
    },
  };
}

function cycleRef(): LineageCycleRef {
  return { id: 'cycle-fixture', tenantId: 'tenant-a', rootReviewResultId: 'root-1', currentReviewResultId: 'root-1' };
}

function resolution(decision: 'ACCEPT' | 'VERIFY', policy = PRODUCT_LOOP_GUARD_DEFAULTS) {
  const reviewId = decision === 'ACCEPT' ? 'accept-1' : 'verify-1';
  const state: { tasks: DecisionTaskDraft[]; cycleState: DecisionCycleDraft; audits: string[] } = {
    tasks: [],
    audits: [],
    cycleState: {
      id: 'cycle-fixture',
      tenantId: 'tenant-a',
      rootReviewResultId: 'root-1',
      currentReviewResultId: 'root-1',
      iteration: 1,
      verificationAttempts: 0,
      sameDecisionCount: 1,
      sameConflictCount: 0,
      decisionFingerprint: 'before',
      conflictFingerprint: 'before',
      status: 'ACTIVE',
      blockedReason: null,
      policyId: 'policy-1',
      startedAt: '2026-10-02T00:00:00.000Z',
      updatedAt: '2026-10-02T00:00:00.000Z',
    },
  };
  const node = (id: string, parent: string | null, chosen: CycleReviewNode['decision']): CycleReviewNode => ({
    id,
    tenantId: 'tenant-a',
    evidenceIdentity: 'evidence-hash',
    decision: chosen,
    conflictDetected: false,
    overclaimDetected: false,
    revisionRequired: false,
    parentReviewResultId: parent,
    verificationResultId: null,
    completedAt: '2026-10-02T00:00:00.000Z',
  });
  const snapshot: ResolutionSnapshot = {
    review: {
      id: reviewId,
      tenantId: 'tenant-a',
      evidenceId: 'ev-1',
      expectedDecision: decision,
      evidenceStrength: 'strong',
      claimStrength: 'weak',
      conflictDetected: false,
      overclaimDetected: false,
      revisionRequired: false,
    },
    evidence: { id: 'ev-1', tenantId: 'tenant-a' },
    chain: [node('root-1', null, 'VERIFY'), node(reviewId, 'root-1', decision)],
    cycle: state.cycleState,
    policy,
  };
  const io: ResolutionIo = {
    async load() {
      return { ...snapshot, cycle: state.cycleState };
    },
    async saveCycle(next) {
      state.cycleState = next;
    },
    async audit(action) {
      if (!state.audits.includes(action)) state.audits.push(action);
    },
    decisionTx: {
      async findByResultAndType(reviewResultId, taskType) {
        return state.tasks.find((task) => task.reviewResultId === reviewResultId && task.taskType === taskType) ?? null;
      },
      async insert(task) {
        if (state.tasks.some((row) => row.reviewResultId === task.reviewResultId && row.taskType === task.taskType)) {
          const error = new Error('unique') as Error & { code: string };
          error.code = 'P2002';
          throw error;
        }
        state.tasks.push(task);
      },
    },
    improvementTx: { async findByDecisionTask() { return null; }, async insert() {}, async audit() {} },
  };
  return { state, io };
}

function reword() {
  const row: StartReview = {
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
  };
  const state = { cycles: [] as DecisionCycleDraft[], tasks: [] as DecisionTaskDraft[], improvements: [] as ImprovementTaskDraft[] };
  const io: StartIo = {
    async load() {
      return {
        review: row,
        evidence: { id: 'ev-1', tenantId: 'tenant-a' },
        cycle: state.cycles[0] ?? null,
        decisionTask: state.tasks[0] ?? null,
        decisionLinked: state.tasks.length > 0,
        improvementTask: state.improvements[0] ?? null,
        improvementLinked: state.improvements.length > 0,
      };
    },
    async findPolicy() {
      return { id: 'policy-stored', policy: PRODUCT_LOOP_GUARD_DEFAULTS };
    },
    async insertCycle(cycle) {
      if (state.cycles.length > 0) {
        const error = new Error('unique') as Error & { code: string };
        error.code = 'P2002';
        throw error;
      }
      state.cycles.push(cycle);
    },
    async auditCycle() {},
    decisionTx: {
      async findByResultAndType(reviewResultId, taskType) {
        return state.tasks.find((task) => task.reviewResultId === reviewResultId && task.taskType === taskType) ?? null;
      },
      async insert(task) {
        if (state.tasks.some((item) => item.reviewResultId === task.reviewResultId && item.taskType === task.taskType)) {
          const error = new Error('unique') as Error & { code: string };
          error.code = 'P2002';
          throw error;
        }
        state.tasks.push(task);
      },
    },
    improvementTx: {
      async findByDecisionTask(decisionTaskId) {
        return state.improvements.find((task) => task.decisionTaskId === decisionTaskId) ?? null;
      },
      async insert(task) {
        if (state.improvements.some((item) => item.decisionTaskId === task.decisionTaskId)) {
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

function isUnique(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && (error as { code?: string }).code === 'P2002');
}

describe('single improvement iteration', () => {
  it('stops after accept, verify, reword, or a missing cycle', async () => {
    const accepted = resolution('ACCEPT');
    const accept = await runSingleImprovementIteration(command('accept-1'), {
      async loadReview() {
        return review('accept-1', 'ACCEPT');
      },
      reenter: (input) =>
        reenterReReviewDecision(input, {
          async loadReview() {
            return { id: 'accept-1', tenantId: 'tenant-a', expectedDecision: 'ACCEPT' };
          },
          lineage: lineage(
            {
              'accept-1': { id: 'accept-1', tenantId: 'tenant-a', ancestorIds: ['root-1'] },
              'root-1': { id: 'root-1', tenantId: 'tenant-a', ancestorIds: [] },
            },
            { 'root-1': cycleRef() },
          ),
          resolve: (value) => resolveReReviewDecision(value, accepted.io),
          async start() {
            throw new Error('START');
          },
        }),
    });
    assert.equal(accept.ok, true);
    if (!accept.ok) return;
    assert.equal(accept.decision, 'ACCEPT');
    assert.equal(accept.nextAction, 'NONE');
    assert.equal(accept.cycleStatus, 'COMPLETED');
    assert.equal(accepted.state.tasks.length, 0);

    const verified = resolution('VERIFY');
    const runVerify = () =>
      runSingleImprovementIteration(command('verify-1'), {
        async loadReview() {
          return review('verify-1', 'VERIFY');
        },
        reenter: (input) =>
          reenterReReviewDecision(input, {
            async loadReview() {
              return { id: 'verify-1', tenantId: 'tenant-a', expectedDecision: 'VERIFY' };
            },
            lineage: lineage(
              {
                'verify-1': { id: 'verify-1', tenantId: 'tenant-a', ancestorIds: ['root-1'] },
                'root-1': { id: 'root-1', tenantId: 'tenant-a', ancestorIds: [] },
              },
              { 'root-1': cycleRef() },
            ),
            resolve: (value) => resolveReReviewDecision(value, verified.io),
            async start() {
              throw new Error('START');
            },
          }),
      });
    const verify = await runVerify();
    const verifyAgain = await runVerify();
    assert.equal(verify.ok && verifyAgain.ok, true);
    if (!verify.ok || !verifyAgain.ok) return;
    assert.equal(verify.nextAction, 'VERIFICATION');
    assert.equal(verified.state.tasks.length, 1);
    assert.equal(verified.state.tasks[0]?.taskType, 'VERIFICATION');
    assert.equal(verifyAgain.verificationTaskId, verify.verificationTaskId);
    assert.equal(verified.state.cycleState.iteration, 2);

    const started = reword();
    const runReword = () =>
      runSingleImprovementIteration(command('reword-1'), {
        async loadReview() {
          return review('reword-1', 'REWORD');
        },
        reenter: (input) =>
          reenterReReviewDecision(input, {
            async loadReview() {
              return { id: 'reword-1', tenantId: 'tenant-a', expectedDecision: 'REWORD' };
            },
            lineage: lineage({ 'reword-1': { id: 'reword-1', tenantId: 'tenant-a', ancestorIds: [] } }, {}),
            async resolve() {
              throw new Error('RESOLVE');
            },
            start: (value) => startNewImprovementCycle(value, started.io),
          }).catch((error: unknown) => {
            if (!isUnique(error)) throw error;
            return reenterReReviewDecision(input, {
              async loadReview() {
                return { id: 'reword-1', tenantId: 'tenant-a', expectedDecision: 'REWORD' };
              },
              lineage: lineage({ 'reword-1': { id: 'reword-1', tenantId: 'tenant-a', ancestorIds: [] } }, {}),
              async resolve() {
                throw new Error('RESOLVE');
              },
              start: (value) => startNewImprovementCycle(value, started.io),
            });
          }),
      });
    const first = await runReword();
    const [left, right] = await Promise.all([runReword(), runReword()]);
    assert.equal(first.ok && left.ok && right.ok, true);
    if (!first.ok) return;
    assert.equal(first.nextAction, 'IMPROVEMENT');
    assert.equal(started.state.cycles.length, 1);
    assert.equal(started.state.tasks.length, 1);
    assert.equal(started.state.improvements.length, 1);
    assert.equal(left.ok && left.improvementTaskId, first.improvementTaskId);

    let calls = 0;
    const missing = await runSingleImprovementIteration(command('3707202563ecae9b38f324a4eefd9243a14bc69420ed6cdda16c4c5794f62e0d'), {
      async loadReview() {
        return review('3707202563ecae9b38f324a4eefd9243a14bc69420ed6cdda16c4c5794f62e0d', 'VERIFY');
      },
      reenter: (input) => {
        calls += 1;
        return reenterReReviewDecision(input, {
          async loadReview() {
            return { id: input.reviewResultId, tenantId: 'tenant-a', expectedDecision: 'VERIFY' };
          },
          lineage: lineage(
            {
              [input.reviewResultId]: { id: input.reviewResultId, tenantId: 'tenant-a', ancestorIds: ['aa734100752dfe92bcfbd8742c6a0049094807ab21e0265fff04a04f6b16ff1e'] },
              aa734100752dfe92bcfbd8742c6a0049094807ab21e0265fff04a04f6b16ff1e: {
                id: 'aa734100752dfe92bcfbd8742c6a0049094807ab21e0265fff04a04f6b16ff1e',
                tenantId: 'tenant-a',
                ancestorIds: [],
              },
            },
            {},
          ),
          async resolve() {
            throw new Error('RESOLVE');
          },
          async start() {
            throw new Error('START');
          },
        });
      },
    });
    assert.equal(missing.ok, false);
    if (!missing.ok) assert.equal(missing.reason, 'DECISION_CYCLE_NOT_FOUND');
    assert.equal(calls, 1);
    assert.equal(protectedCycle.updatedAt, '2026-10-01T16:33:57.676Z');
    assert.equal(protectedCycle.iteration, 2);
  });

  it('stops a blocked guard and refuses unsafe callers before another step', async () => {
    const blocked = resolution('VERIFY', { ...PRODUCT_LOOP_GUARD_DEFAULTS, maxIterations: 1 });
    const block = await runSingleImprovementIteration(command('verify-1'), {
      async loadReview() {
        return review('verify-1', 'VERIFY');
      },
      reenter: (input) =>
        reenterReReviewDecision(input, {
          async loadReview() {
            return { id: 'verify-1', tenantId: 'tenant-a', expectedDecision: 'VERIFY' };
          },
          lineage: lineage(
            {
              'verify-1': { id: 'verify-1', tenantId: 'tenant-a', ancestorIds: ['root-1'] },
              'root-1': { id: 'root-1', tenantId: 'tenant-a', ancestorIds: [] },
            },
            { 'root-1': cycleRef() },
          ),
          resolve: (value) => resolveReReviewDecision(value, blocked.io),
          async start() {
            throw new Error('START');
          },
        }),
    });
    assert.equal(block.ok, true);
    if (!block.ok) return;
    assert.equal(block.nextAction, 'NONE');
    assert.equal(block.cycleStatus, 'BLOCKED');
    assert.equal(block.guard, 'MAX_ITERATIONS');
    assert.equal(blocked.state.tasks.length, 0);

    const foreign = await runSingleImprovementIteration(command('other'), {
      async loadReview() {
        return review('other', 'VERIFY', 'tenant-b');
      },
      async reenter() {
        throw new Error('REENTER');
      },
    });
    assert.equal(foreign.ok, false);
    if (!foreign.ok) assert.equal(foreign.reason, 'TENANT_MISMATCH');

    const denied = await runSingleImprovementIteration(command('verify-1', [auditor], auditor.userId), {
      async loadReview() {
        throw new Error('LOAD');
      },
      async reenter() {
        throw new Error('REENTER');
      },
    });
    assert.equal(denied.ok, false);
    if (!denied.ok) assert.equal(denied.reason, 'FORBIDDEN');

    const memberStop = await runSingleImprovementIteration(command('verify-1', [member], member.userId), {
      async loadReview() {
        return review('verify-1', 'VERIFY');
      },
      reenter: (input) =>
        reenterReReviewDecision(input, {
          async loadReview() {
            throw new Error('LOAD');
          },
          lineage: lineage({}, {}),
          async resolve() {
            throw new Error('RESOLVE');
          },
          async start() {
            throw new Error('START');
          },
        }),
    });
    assert.equal(memberStop.ok, false);
    if (!memberStop.ok) assert.equal(memberStop.reason, 'FORBIDDEN');

    const secret = resolution('VERIFY');
    secret.io.load = async () => ({
      review: {
        id: 'verify-1',
        tenantId: 'tenant-a',
        evidenceId: 'postgres://user:password@host/db',
        expectedDecision: 'VERIFY',
        evidenceStrength: 'strong',
        claimStrength: 'weak',
        conflictDetected: false,
        overclaimDetected: false,
        revisionRequired: false,
      },
      evidence: { id: 'postgres://user:password@host/db', tenantId: 'tenant-a' },
      chain: [
        {
          id: 'root-1',
          tenantId: 'tenant-a',
          evidenceIdentity: 'evidence-hash',
          decision: 'VERIFY',
          conflictDetected: false,
          overclaimDetected: false,
          revisionRequired: false,
          parentReviewResultId: null,
          verificationResultId: null,
          completedAt: '2026-10-02T00:00:00.000Z',
        },
        {
          id: 'verify-1',
          tenantId: 'tenant-a',
          evidenceIdentity: 'evidence-hash',
          decision: 'VERIFY',
          conflictDetected: false,
          overclaimDetected: false,
          revisionRequired: false,
          parentReviewResultId: 'root-1',
          verificationResultId: null,
          completedAt: '2026-10-02T00:00:00.000Z',
        },
      ],
      cycle: secret.state.cycleState,
      policy: PRODUCT_LOOP_GUARD_DEFAULTS,
    });
    const leaked = await runSingleImprovementIteration(command('verify-1'), {
      async loadReview() {
        return review('verify-1', 'VERIFY');
      },
      reenter: (input) =>
        reenterReReviewDecision(input, {
          async loadReview() {
            return { id: 'verify-1', tenantId: 'tenant-a', expectedDecision: 'VERIFY' };
          },
          lineage: lineage(
            {
              'verify-1': { id: 'verify-1', tenantId: 'tenant-a', ancestorIds: ['root-1'] },
              'root-1': { id: 'root-1', tenantId: 'tenant-a', ancestorIds: [] },
            },
            { 'root-1': cycleRef() },
          ),
          resolve: (value) => resolveReReviewDecision(value, secret.io),
          async start() {
            throw new Error('START');
          },
        }),
    });
    assert.equal(leaked.ok, false);
    if (!leaked.ok) assert.equal(leaked.reason, 'CREDENTIAL_IN_REASON');
    assert.equal(secret.state.tasks.length, 0);

    const absent = await runSingleImprovementIteration(command('gone'), {
      async loadReview() {
        return null;
      },
      async reenter() {
        throw new Error('REENTER');
      },
    });
    assert.equal(absent.ok, false);
    if (!absent.ok) assert.equal(absent.reason, 'REVIEW_NOT_FOUND');

    const source = readFileSync(new URL('./improvement-iteration.ts', import.meta.url), 'utf8');
    const store = readFileSync(new URL('./improvement-iteration-store.ts', import.meta.url), 'utf8');
    for (const text of [source, store]) {
      assert.equal(text.includes('persistAgentExecution'), false);
      assert.equal(text.includes('evaluateChangeGate'), false);
      assert.equal(text.includes('executeChangeGateReReview'), false);
      assert.equal(text.includes('runReviewBoardPipeline'), false);
      assert.equal(text.includes('child_process'), false);
      assert.equal(text.includes('1800000'), false);
      assert.equal(text.split('runSingleImprovementIteration(').length, text === source ? 2 : 1);
    }
  });
});
