/**
 * Re-review result back into the existing decision cycle.
 * Run: node --import tsx --test src/lib/jury-product/improvement-decision-reentry.test.ts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { resolveReReviewDecision, type ResolutionIo, type ResolutionSnapshot } from './decision-cycle-resolution';
import type { DecisionTaskDraft } from './decision-task';
import { startNewImprovementCycle, type StartIo, type StartLoaded, type StartReview } from './improvement-cycle-start';
import { reenterReReviewDecision } from './improvement-decision-reentry';
import type { ImprovementTaskDraft } from './improvement-bridge';
import { PRODUCT_LOOP_GUARD_DEFAULTS, type CycleReviewNode, type DecisionCycleDraft } from './loop-guard';
import type { LineageCycleRef, LineageIo, LineageStep } from './decision-cycle-lineage';
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
const liveResult = '3707202563ecae9b38f324a4eefd9243a14bc69420ed6cdda16c4c5794f62e0d';
const liveParent = 'aa734100752dfe92bcfbd8742c6a0049094807ab21e0265fff04a04f6b16ff1e';

const protectedCycle = {
  id: '14308b4c999ccbe8ca54b7f31da5385385d4073c49bbf2955582a6bb96afb01e',
  rootReviewResultId: '2f6638a0addf8a8706ddf8d53396bb81b37c9aeadae4910a33be00f634be3f59',
  currentReviewResultId: '6adbe7150104e3b95030e5499f52085d8e72dbcb8f999136782bdb0f96fbd7e7',
  iteration: 2,
  verificationAttempts: 1,
  sameDecisionCount: 2,
  sameConflictCount: 2,
  updatedAt: '2026-10-01T16:33:57.676Z',
};

function command(reviewResultId: string, memberships: readonly JuryMembership[] = [owner], userId = 'user-1') {
  return {
    userId,
    memberships,
    clientTenantId: 'forged-tenant',
    now: '2026-10-02T10:58:00.000Z',
    reviewResultId,
  };
}

function lineage(steps: Record<string, LineageStep>, cycles: Record<string, LineageCycleRef>): LineageIo {
  return {
    async load(id) {
      return steps[id] ?? null;
    },
    async cyclesFor(id) {
      const cycle = cycles[id];
      return cycle ? [cycle] : [];
    },
  };
}

function resolution(decision: 'ACCEPT' | 'VERIFY', partial?: Partial<ResolutionSnapshot>) {
  const reviewId = decision === 'ACCEPT' ? 'accept-1' : 'verify-1';
  const rootId = 'root-1';
  const state: {
    tasks: DecisionTaskDraft[];
    improvements: ImprovementTaskDraft[];
    audits: string[];
    saves: number;
    cycleState: DecisionCycleDraft;
  } = {
    tasks: [] as DecisionTaskDraft[],
    improvements: [] as ImprovementTaskDraft[],
    audits: [] as string[],
    saves: 0,
    cycleState: {
      id: 'cycle-fixture',
      tenantId: 'tenant-a',
      rootReviewResultId: rootId,
      currentReviewResultId: rootId,
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
      conflictDetected: true,
      overclaimDetected: false,
      revisionRequired: false,
    },
    evidence: { id: 'ev-1', tenantId: 'tenant-a' },
    chain: [node(rootId, null, 'VERIFY'), node(reviewId, rootId, decision)],
    cycle: state.cycleState,
    policy: partial?.policy ?? PRODUCT_LOOP_GUARD_DEFAULTS,
  };
  if (partial?.review) snapshot.review = partial.review;
  if (partial?.evidence) snapshot.evidence = partial.evidence;
  const io: ResolutionIo = {
    async load() {
      return { ...snapshot, cycle: state.cycleState };
    },
    async saveCycle(next) {
      state.saves += 1;
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
    improvementTx: {
      async findByDecisionTask() {
        return null;
      },
      async insert() {},
      async audit() {},
    },
  };
  return { state, io };
}

function rewordStart() {
  const review: StartReview = {
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
  const state = {
    cycles: [] as DecisionCycleDraft[],
    tasks: [] as DecisionTaskDraft[],
    improvements: [] as ImprovementTaskDraft[],
    loaded: { review, evidence: { id: 'ev-1', tenantId: 'tenant-a' }, cycle: null, decisionTask: null, decisionLinked: false, improvementTask: null, improvementLinked: false } as StartLoaded,
  };
  const io: StartIo = {
    async load() {
      const cycle = state.cycles.find((row) => row.rootReviewResultId === review.id) ?? null;
      const decisionTask = state.tasks.find((row) => row.reviewResultId === review.id) ?? null;
      const improvementTask = state.improvements.find((row) => row.reviewResultId === review.id) ?? null;
      return { ...state.loaded, cycle, decisionTask, decisionLinked: Boolean(decisionTask), improvementTask, improvementLinked: Boolean(improvementTask) };
    },
    async findPolicy() {
      return { id: 'policy-stored', policy: PRODUCT_LOOP_GUARD_DEFAULTS };
    },
    async insertCycle(cycle) {
      if (state.cycles.some((row) => row.id === cycle.id)) {
        const error = new Error('unique') as Error & { code: string };
        error.code = 'P2002';
        throw error;
      }
      state.cycles.push(cycle);
    },
    async auditCycle() {},
    decisionTx: {
      async findByResultAndType(reviewResultId, taskType) {
        return state.tasks.find((row) => row.reviewResultId === reviewResultId && row.taskType === taskType) ?? null;
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
    improvementTx: {
      async findByDecisionTask(decisionTaskId) {
        return state.improvements.find((row) => row.decisionTaskId === decisionTaskId) ?? null;
      },
      async insert(task) {
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

function isUnique(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && (error as { code?: string }).code === 'P2002');
}

describe('change gate decision re-entry', () => {
  it('keeps the live VERIFY result without a cycle or a task', async () => {
    let started = 0;
    let resolved = 0;
    const outcome = await reenterReReviewDecision(command(liveResult), {
      async loadReview() {
        return { id: liveResult, tenantId: 'tenant-a', expectedDecision: 'VERIFY' };
      },
      lineage: lineage(
        {
          [liveResult]: { id: liveResult, tenantId: 'tenant-a', ancestorIds: [liveParent] },
          [liveParent]: { id: liveParent, tenantId: 'tenant-a', ancestorIds: [] },
        },
        {},
      ),
      async resolve() {
        resolved += 1;
        throw new Error('RESOLVE');
      },
      async start() {
        started += 1;
        throw new Error('START');
      },
    });
    assert.equal(outcome.ok, false);
    if (outcome.ok) return;
    assert.equal(outcome.reason, 'DECISION_CYCLE_NOT_FOUND');
    assert.equal(started, 0);
    assert.equal(resolved, 0);
    assert.equal(protectedCycle.updatedAt, '2026-10-01T16:33:57.676Z');
    assert.equal(protectedCycle.iteration, 2);
  });

  it('opens one verification task when VERIFY already has a cycle', async () => {
    const gate = resolution('VERIFY');
    const cycleRef: LineageCycleRef = {
      id: 'cycle-fixture',
      tenantId: 'tenant-a',
      rootReviewResultId: 'root-1',
      currentReviewResultId: 'root-1',
    };
    const run = () =>
      reenterReReviewDecision(command('verify-1'), {
        async loadReview() {
          return { id: 'verify-1', tenantId: 'tenant-a', expectedDecision: 'VERIFY' };
        },
        lineage: lineage(
          {
            'verify-1': { id: 'verify-1', tenantId: 'tenant-a', ancestorIds: ['root-1'] },
            'root-1': { id: 'root-1', tenantId: 'tenant-a', ancestorIds: [] },
          },
          { 'root-1': cycleRef },
        ),
        resolve: (input) => resolveReReviewDecision(input, gate.io),
        async start() {
          throw new Error('START');
        },
      });
    const first = await run();
    const second = await run();
    assert.equal(first.ok && second.ok, true);
    if (!first.ok || !second.ok || !('verificationTask' in first) || !('verificationTask' in second)) return;
    assert.equal(first.decision, 'VERIFY');
    assert.equal(first.verificationTask?.taskType, 'VERIFICATION');
    assert.equal(first.verificationTask?.status, 'OPEN');
    assert.equal(second.created, false);
    assert.equal(gate.state.tasks.length, 1);
    assert.equal(gate.state.improvements.length, 0);
    assert.equal(gate.state.cycleState.iteration, 2);
    assert.equal(gate.state.cycleState.rootReviewResultId, 'root-1');
    assert.equal(protectedCycle.iteration, 2);
  });

  it('starts one improvement cycle for REWORD when lineage has no cycle', async () => {
    const started = rewordStart();
    const run = () =>
      reenterReReviewDecision(command('reword-1'), {
        async loadReview() {
          return { id: 'reword-1', tenantId: 'tenant-a', expectedDecision: 'REWORD' };
        },
        lineage: lineage({ 'reword-1': { id: 'reword-1', tenantId: 'tenant-a', ancestorIds: [] } }, {}),
        async resolve() {
          throw new Error('RESOLVE');
        },
        start: (input) => startNewImprovementCycle(input, started.io),
      }).catch((error: unknown) => {
        if (!isUnique(error)) throw error;
        return reenterReReviewDecision(command('reword-1'), {
          async loadReview() {
            return { id: 'reword-1', tenantId: 'tenant-a', expectedDecision: 'REWORD' };
          },
          lineage: lineage({ 'reword-1': { id: 'reword-1', tenantId: 'tenant-a', ancestorIds: [] } }, {}),
          async resolve() {
            throw new Error('RESOLVE');
          },
          start: (input) => startNewImprovementCycle(input, started.io),
        });
      });
    const first = await run();
    const [left, right] = await Promise.all([run(), run()]);
    assert.equal(first.ok && left.ok && right.ok, true);
    if (!first.ok || !('cycle' in first)) return;
    assert.equal(first.decision, 'REWORD');
    assert.equal(first.cycle.rootReviewResultId, 'reword-1');
    assert.equal(first.cycle.currentReviewResultId, 'reword-1');
    assert.equal(started.state.cycles.length, 1);
    assert.equal(started.state.tasks.length, 1);
    assert.equal(started.state.tasks[0]?.taskType, 'REWORD');
    assert.equal(started.state.improvements.length, 1);
    assert.equal(started.state.improvements[0]?.status, 'OPEN');
  });

  it('completes an existing cycle for ACCEPT and blocks a guard without tasks', async () => {
    const accepted = resolution('ACCEPT');
    const accept = await reenterReReviewDecision(command('accept-1'), {
      async loadReview() {
        return { id: 'accept-1', tenantId: 'tenant-a', expectedDecision: 'ACCEPT' };
      },
      lineage: lineage(
        {
          'accept-1': { id: 'accept-1', tenantId: 'tenant-a', ancestorIds: ['root-1'] },
          'root-1': { id: 'root-1', tenantId: 'tenant-a', ancestorIds: [] },
        },
        { 'root-1': { id: 'cycle-fixture', tenantId: 'tenant-a', rootReviewResultId: 'root-1', currentReviewResultId: 'root-1' } },
      ),
      resolve: (input) => resolveReReviewDecision(input, accepted.io),
      async start() {
        throw new Error('START');
      },
    });
    assert.equal(accept.ok, true);
    if (!accept.ok || !('cycleStatus' in accept)) return;
    assert.equal(accept.decision, 'ACCEPT');
    assert.equal(accept.cycleStatus, 'COMPLETED');
    assert.equal(accepted.state.tasks.length, 0);
    assert.equal(accepted.state.improvements.length, 0);

    const blocked = resolution('VERIFY', { policy: { ...PRODUCT_LOOP_GUARD_DEFAULTS, maxIterations: 1 } });
    const block = await reenterReReviewDecision(command('verify-1'), {
      async loadReview() {
        return { id: 'verify-1', tenantId: 'tenant-a', expectedDecision: 'VERIFY' };
      },
      lineage: lineage(
        {
          'verify-1': { id: 'verify-1', tenantId: 'tenant-a', ancestorIds: ['root-1'] },
          'root-1': { id: 'root-1', tenantId: 'tenant-a', ancestorIds: [] },
        },
        { 'root-1': { id: 'cycle-fixture', tenantId: 'tenant-a', rootReviewResultId: 'root-1', currentReviewResultId: 'root-1' } },
      ),
      resolve: (input) => resolveReReviewDecision(input, blocked.io),
      async start() {
        throw new Error('START');
      },
    });
    assert.equal(block.ok, true);
    if (!block.ok || !('guard' in block)) return;
    assert.equal(block.guard, 'MAX_ITERATIONS');
    assert.equal(block.cycleStatus, 'BLOCKED');
    assert.equal(blocked.state.tasks.length, 0);
    assert.deepEqual(blocked.state.audits, ['LOOP_GUARD_BLOCKED']);
  });

  it('refuses another tenant, another role, a secret, and a missing review', async () => {
    const foreign = await reenterReReviewDecision(command('other'), {
      async loadReview() {
        return { id: 'other', tenantId: 'tenant-b', expectedDecision: 'VERIFY' };
      },
      lineage: lineage({}, {}),
      async resolve() {
        throw new Error('RESOLVE');
      },
      async start() {
        throw new Error('START');
      },
    });
    assert.equal(foreign.ok, false);
    if (!foreign.ok) assert.equal(foreign.reason, 'TENANT_MISMATCH');

    for (const actor of [member, auditor]) {
      const denied = await reenterReReviewDecision(command('verify-1', [actor], actor.userId), {
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
      });
      assert.equal(denied.ok, false);
      if (!denied.ok) assert.equal(denied.reason, 'FORBIDDEN');
    }

    const secretGate = resolution('VERIFY', {
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
    });
    const secret = await reenterReReviewDecision(command('verify-1'), {
      async loadReview() {
        return { id: 'verify-1', tenantId: 'tenant-a', expectedDecision: 'VERIFY' };
      },
      lineage: lineage(
        {
          'verify-1': { id: 'verify-1', tenantId: 'tenant-a', ancestorIds: ['root-1'] },
          'root-1': { id: 'root-1', tenantId: 'tenant-a', ancestorIds: [] },
        },
        { 'root-1': { id: 'cycle-fixture', tenantId: 'tenant-a', rootReviewResultId: 'root-1', currentReviewResultId: 'root-1' } },
      ),
      resolve: (input) => resolveReReviewDecision(input, secretGate.io),
      async start() {
        throw new Error('START');
      },
    });
    assert.equal(secret.ok, false);
    if (!secret.ok) assert.equal(secret.reason, 'CREDENTIAL_IN_REASON');
    assert.equal(secretGate.state.tasks.length, 0);

    const missing = await reenterReReviewDecision(command('gone'), {
      async loadReview() {
        return null;
      },
      lineage: lineage({}, {}),
      async resolve() {
        throw new Error('RESOLVE');
      },
      async start() {
        throw new Error('START');
      },
    });
    assert.equal(missing.ok, false);
    if (!missing.ok) assert.equal(missing.reason, 'REVIEW_NOT_FOUND');

    const source = readFileSync(new URL('./improvement-decision-reentry.ts', import.meta.url), 'utf8');
    const store = readFileSync(new URL('./improvement-decision-reentry-store.ts', import.meta.url), 'utf8');
    for (const text of [source, store]) {
      assert.equal(text.includes('runReviewBoardPipeline'), false);
      assert.equal(text.includes('evaluateChangeGate'), false);
      assert.equal(text.includes('persistAgentExecution'), false);
      assert.equal(text.includes('handoffAgent'), false);
      assert.equal(text.includes('child_process'), false);
      assert.equal(text.includes('executeChangeGateReReview'), false);
    }
  });
});
