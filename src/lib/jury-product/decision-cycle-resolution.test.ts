/**
 * Re-review decision boundary. The cycle already exists. No agent or core call.
 * Run: node --import tsx --test src/lib/jury-product/decision-cycle-resolution.test.ts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { resolveReReviewDecision, type ResolutionIo, type ResolutionReview, type ResolutionSnapshot } from './decision-cycle-resolution';
import type { DecisionTaskDraft } from './decision-task';
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

function node(partial: Partial<CycleReviewNode> & Pick<CycleReviewNode, 'id' | 'decision'>): CycleReviewNode {
  return {
    tenantId: 'tenant-a',
    evidenceIdentity: 'evidence-hash',
    conflictDetected: false,
    overclaimDetected: false,
    revisionRequired: false,
    parentReviewResultId: null,
    verificationResultId: null,
    completedAt: '2026-10-02T00:00:00.000Z',
    ...partial,
  };
}

function cycle(current = 'root-1'): DecisionCycleDraft {
  return {
    id: 'cycle-1',
    tenantId: 'tenant-a',
    rootReviewResultId: 'root-1',
    currentReviewResultId: current,
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
  };
}

function review(decision: ResolutionReview['expectedDecision']): ResolutionReview {
  return {
    id: 'child-1',
    tenantId: 'tenant-a',
    evidenceId: 'ev-1',
    expectedDecision: decision,
    evidenceStrength: 'moderate',
    claimStrength: 'weak',
    conflictDetected: false,
    overclaimDetected: decision === 'REWORD',
    revisionRequired: decision === 'REWORD',
  };
}

function memory(decision: ResolutionReview['expectedDecision'], partial?: Partial<ResolutionSnapshot>): ResolutionIo & {
  tasks: DecisionTaskDraft[];
  improvements: ImprovementTaskDraft[];
  audits: string[];
  saves: number;
  cycleState: DecisionCycleDraft;
} {
  const state = {
    tasks: [] as DecisionTaskDraft[],
    improvements: [] as ImprovementTaskDraft[],
    audits: [] as string[],
    saves: 0,
    cycleState: (partial && 'cycle' in partial ? partial.cycle : cycle()) as DecisionCycleDraft,
    snapshot: {
      review: review(decision),
      evidence: { id: 'ev-1', tenantId: 'tenant-a' },
      chain: [
        node({ id: 'root-1', decision: 'VERIFY' }),
        node({ id: 'child-1', decision: decision as CycleReviewNode['decision'], parentReviewResultId: 'root-1' }),
      ],
      cycle: partial && 'cycle' in partial ? partial.cycle ?? null : cycle(),
      policy: partial?.policy ?? PRODUCT_LOOP_GUARD_DEFAULTS,
    },
  };
  if (partial?.chain) state.snapshot.chain = partial.chain;
  if (partial?.review) state.snapshot.review = partial.review;
  if (partial?.evidence) state.snapshot.evidence = partial.evidence;
  return {
    tasks: state.tasks,
    improvements: state.improvements,
    audits: state.audits,
    get saves() {
      return state.saves;
    },
    get cycleState() {
      return state.cycleState;
    },
    async load() {
      return { ...state.snapshot, cycle: state.cycleState };
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
        if (state.tasks.some((row) => row.reviewResultId === task.reviewResultId && row.taskType === task.taskType)) return;
        state.tasks.push(task);
      },
    },
    improvementTx: {
      async findByDecisionTask(decisionTaskId) {
        return state.improvements.find((task) => task.decisionTaskId === decisionTaskId) ?? null;
      },
      async insert(task) {
        if (state.improvements.some((row) => row.decisionTaskId === task.decisionTaskId)) return;
        state.improvements.push(task);
      },
      async audit() {},
    },
  };
}

const command = {
  userId: 'user-1',
  memberships: [owner],
  clientTenantId: 'forged-tenant',
  now: '2026-10-02T09:21:00.000Z',
  reviewResultId: 'child-1',
};

describe('re-review decision boundary', () => {
  it('closes an accepted result without a task and opens one verify or reword task', async () => {
    const accepted = memory('ACCEPT');
    const accept = await resolveReReviewDecision(command, accepted);
    assert.equal(accept.ok, true);
    if (!accept.ok) return;
    assert.equal(accept.decision, 'ACCEPT');
    assert.equal(accept.cycleStatus, 'COMPLETED');
    assert.equal(accept.verificationTask, null);
    assert.equal(accept.improvementTask, null);
    assert.equal(accepted.tasks.length, 0);
    assert.deepEqual(accepted.audits, ['REVIEW_DECISION_RESOLVED']);
    const acceptAgain = await resolveReReviewDecision(command, accepted);
    assert.equal(acceptAgain.ok && acceptAgain.created, false);
    assert.equal(accepted.saves, 1);

    const verified = memory('VERIFY');
    const verify = await resolveReReviewDecision(command, verified);
    const verifyAgain = await resolveReReviewDecision(command, verified);
    assert.equal(verify.ok && verifyAgain.ok, true);
    if (!verify.ok || !verifyAgain.ok) return;
    assert.equal(verify.guard, 'ALLOWED');
    assert.equal(verified.tasks.length, 1);
    assert.equal(verified.tasks[0]?.taskType, 'VERIFICATION');
    assert.equal(verifyAgain.created, false);
    assert.equal(verified.cycleState.iteration, 2);
    assert.equal(verified.cycleState.rootReviewResultId, 'root-1');

    const reworded = memory('REWORD');
    const [first, second] = await Promise.all([resolveReReviewDecision(command, reworded), resolveReReviewDecision(command, reworded)]);
    assert.equal(first.ok && second.ok, true);
    assert.equal(reworded.tasks.length, 1);
    assert.equal(reworded.tasks[0]?.taskType, 'REWORD');
    assert.equal(reworded.improvements.length, 1);
    assert.equal(JSON.stringify(reworded.improvements).includes('postgres://'), false);
  });

  it('does not create a task when the guard blocks, the cycle is missing, or the tenant differs', async () => {
    const blocked = memory('VERIFY', { policy: { ...PRODUCT_LOOP_GUARD_DEFAULTS, maxIterations: 1 } });
    const block = await resolveReReviewDecision(command, blocked);
    assert.equal(block.ok, true);
    if (!block.ok) return;
    assert.equal(block.guard, 'MAX_ITERATIONS');
    assert.equal(block.cycleStatus, 'BLOCKED');
    assert.equal(blocked.tasks.length, 0);
    assert.deepEqual(blocked.audits, ['LOOP_GUARD_BLOCKED']);

    const missing = memory('VERIFY', { cycle: null });
    const absent = await resolveReReviewDecision(command, missing);
    assert.equal(absent.ok, false);
    if (absent.ok) return;
    assert.equal(absent.reason, 'DECISION_CYCLE_NOT_FOUND');
    assert.equal(missing.saves, 0);

    const foreign = memory('VERIFY');
    foreign.cycleState.tenantId = 'tenant-b';
    const other = await resolveReReviewDecision(command, foreign);
    assert.equal(other.ok, false);
    if (other.ok) return;
    assert.equal(other.reason, 'TENANT_MISMATCH');
    assert.equal(foreign.tasks.length, 0);

    const secret = memory('VERIFY', {
      review: { ...review('VERIFY'), evidenceId: 'postgres://user:password@host/db' },
      evidence: { id: 'postgres://user:password@host/db', tenantId: 'tenant-a' },
    });
    const leaked = await resolveReReviewDecision(command, secret);
    assert.equal(leaked.ok, false);
    if (leaked.ok) return;
    assert.equal(leaked.reason, 'CREDENTIAL_IN_REASON');
    assert.equal(secret.tasks.length, 0);

    const source = readFileSync(new URL('./decision-cycle-resolution.ts', import.meta.url), 'utf8');
    assert.equal(source.includes('runReviewBoardPipeline'), false);
    assert.equal(source.includes('evaluateChangeGate'), false);
    assert.equal(source.includes('persistAgentExecution'), false);
    assert.equal(source.includes('recordDecisionCycle'), false);
    assert.equal(source.includes('insertCycle'), false);
  });
});
