/**
 * REWORD improvement bridge. It does not start an agent.
 * Run: node --import tsx --test src/lib/jury-product/improvement-bridge.test.ts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import type { DecisionTaskDraft } from './decision-task';
import { canStartAutoLoop, type JuryMembership } from './records';
import {
  REWORD_CONSTRAINTS,
  REWORD_FIXTURE_OBJECTIVE,
  REWORD_FIXTURE_REASON,
  bridgeImprovement,
  type ImprovementTaskDraft,
  type ImprovementWriteTx,
} from './improvement-bridge';

const membership: JuryMembership = {
  id: 'mem-1',
  tenantId: 'tenant-a',
  userId: 'user-1',
  role: 'OWNER',
  createdAt: '2026-10-01T00:00:00.000Z',
};

const REASON = REWORD_FIXTURE_REASON;
const OBJECTIVE = REWORD_FIXTURE_OBJECTIVE;

function task(partial?: Partial<DecisionTaskDraft>): DecisionTaskDraft {
  return {
    id: 'decision-1',
    tenantId: 'tenant-a',
    reviewResultId: 'review-1',
    evidenceId: 'ev-1',
    taskType: 'REWORD',
    decision: 'REWORD',
    title: '결과 문구 정리',
    description: '결과 문구를 측정된 범위 안에서 다시 다듬는다.',
    reason: 'Comparator가 overclaim을 표시했다.',
    status: 'OPEN',
    createdAt: '2026-10-02T00:00:00.000Z',
    updatedAt: '2026-10-02T00:00:00.000Z',
    ...partial,
  };
}

function command(partial?: {
  decision?: string;
  decisionTask?: DecisionTaskDraft | null;
  reviewTenantId?: string;
  evidenceTenantId?: string;
  clientTenantId?: string | null;
}) {
  const decision = partial?.decision ?? 'REWORD';
  return {
    userId: 'user-1' as string | null,
    memberships: [membership],
    clientTenantId: partial?.clientTenantId ?? 'tenant-b',
    now: '2026-10-02T01:00:00.000Z',
    decisionTask: partial && 'decisionTask' in partial ? partial.decisionTask ?? null : task(),
    reviewResult: {
      id: 'review-1',
      tenantId: partial?.reviewTenantId ?? 'tenant-a',
      evidenceId: 'ev-1',
      expectedDecision: decision,
      evidenceStrength: 'moderate',
      claimStrength: 'weak',
      conflictDetected: false,
      overclaimDetected: decision === 'REWORD',
      revisionRequired: decision === 'REWORD',
    },
    evidence: { id: 'ev-1', tenantId: partial?.evidenceTenantId ?? 'tenant-a' },
    reason: REASON,
    objective: OBJECTIVE,
  };
}

function memory(): ImprovementWriteTx & { audits: string[]; agentCalls: number } {
  const state = {
    audits: [] as string[],
    agentCalls: 0,
    tasks: [] as ImprovementTaskDraft[],
  };
  return {
    audits: state.audits,
    get agentCalls() {
      return state.agentCalls;
    },
    async findByDecisionTask(decisionTaskId, taskType) {
      return state.tasks.find((row) => row.decisionTaskId === decisionTaskId && row.taskType === taskType) ?? null;
    },
    async insert(row) {
      state.tasks.push(row);
    },
    async audit(action) {
      state.audits.push(action);
    },
  };
}

describe('improvement bridge', () => {
  it('creates one OPEN reword task and returns it again without an agent', async () => {
    const tx = memory();
    const first = await bridgeImprovement(command(), tx);
    const second = await bridgeImprovement(command(), tx);
    assert.equal(first.ok && second.ok, true);
    if (!first.ok || !second.ok || first.outcome !== 'IMPROVEMENT' || second.outcome !== 'IMPROVEMENT') return;
    assert.equal(first.created, true);
    assert.equal(second.created, false);
    assert.equal(second.task.id, first.task.id);
    assert.equal(first.task.status, 'OPEN');
    assert.equal(first.task.taskType, 'REWORD');
    assert.equal(first.task.reason, REASON);
    assert.equal(first.task.objective, OBJECTIVE);
    assert.notEqual(first.task.reason, first.task.objective);
    assert.deepEqual(first.task.constraints, [...REWORD_CONSTRAINTS]);
    assert.equal(first.task.provenance.reviewResultId, 'review-1');
    assert.equal(first.task.provenance.decisionTaskId, 'decision-1');
    assert.equal(first.task.provenance.evidenceId, 'ev-1');
    assert.equal(first.task.provenance.sourceDecision, 'REWORD');
    assert.equal(first.task.provenance.comparator.expectedDecision, 'REWORD');
    assert.equal(first.task.provenance.comparator.overclaimDetected, true);
    assert.equal(canStartAutoLoop(first.task.loopPolicy), false);
    assert.equal(JSON.stringify(first.task).includes('credentialRef'), false);
    assert.deepEqual(tx.audits, ['IMPROVEMENT_TASK_CREATED']);
    assert.equal(tx.agentCalls, 0);
    const source = readFileSync(new URL('./improvement-bridge.ts', import.meta.url), 'utf8');
    assert.equal(source.includes('runReviewBoardPipeline'), false);
    assert.equal(source.includes('HANDED_OFF'), false);
    assert.equal(source.includes('credentialRef'), false);
  });

  it('does not create an improvement for ACCEPT, VERIFY, or a decision outside the contract', async () => {
    const accept = await bridgeImprovement(command({ decision: 'ACCEPT', decisionTask: null }), memory());
    const verify = await bridgeImprovement(
      command({
        decision: 'VERIFY',
        decisionTask: task({ taskType: 'VERIFICATION', decision: 'VERIFY' }),
      }),
      memory(),
    );
    const caveat = await bridgeImprovement(command({ decision: 'CAVEAT', decisionTask: null }), memory());
    assert.equal(accept.ok && verify.ok, true);
    if (!accept.ok || !verify.ok) return;
    assert.equal(accept.outcome, 'NO_IMPROVEMENT');
    assert.equal(verify.outcome, 'NO_IMPROVEMENT');
    assert.equal(caveat.ok, false);
    if (!caveat.ok) assert.equal(caveat.reason, 'DECISION_NOT_IN_CONTRACT');
  });

  it('blocks another tenant task, review, and evidence', async () => {
    const foreignTask = await bridgeImprovement(command({ decisionTask: task({ tenantId: 'tenant-b' }) }), memory());
    const foreignReview = await bridgeImprovement(command({ reviewTenantId: 'tenant-b' }), memory());
    const foreignEvidence = await bridgeImprovement(command({ evidenceTenantId: 'tenant-b' }), memory());
    assert.equal(foreignTask.ok, false);
    assert.equal(foreignReview.ok, false);
    assert.equal(foreignEvidence.ok, false);
    if (!foreignTask.ok) assert.equal(foreignTask.reason, 'TENANT_MISMATCH');
    if (!foreignReview.ok) assert.equal(foreignReview.reason, 'TENANT_MISMATCH');
    if (!foreignEvidence.ok) assert.equal(foreignEvidence.reason, 'TENANT_MISMATCH');
  });
});
