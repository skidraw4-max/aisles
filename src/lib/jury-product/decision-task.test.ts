/**
 * Decision-to-task orchestrator. Does not call an agent or the review core.
 * Run: node --import tsx --test src/lib/jury-product/decision-task.test.ts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import type { JuryMembership } from './records';
import {
  planDecisionTask,
  planTaskTransition,
  runDecisionTaskPersist,
  type DecisionTaskDraft,
  type DecisionTaskWriteTx,
} from './decision-task';

const membership: JuryMembership = {
  id: 'mem-1',
  tenantId: 'tenant-a',
  userId: 'user-1',
  role: 'OWNER',
  createdAt: '2026-10-01T00:00:00.000Z',
};

const NOW = '2026-10-02T00:00:00.000Z';

function command(partial?: {
  decision?: string;
  conflictDetected?: boolean;
  overclaimDetected?: boolean;
  revisionRequired?: boolean;
  resultTenantId?: string;
  evidenceTenantId?: string;
  evidenceId?: string;
  clientTenantId?: string | null;
  userId?: string | null;
}) {
  const resultTenantId = partial?.resultTenantId ?? 'tenant-a';
  return {
    userId: partial && 'userId' in partial ? partial.userId ?? null : 'user-1',
    memberships: [membership],
    clientTenantId: partial?.clientTenantId,
    now: NOW,
    reviewResult: {
      id: 'result-1',
      tenantId: resultTenantId,
      expectedDecision: partial?.decision ?? 'VERIFY',
      conflictDetected: partial?.conflictDetected ?? true,
      overclaimDetected: partial?.overclaimDetected ?? false,
      revisionRequired: partial?.revisionRequired ?? false,
      evidenceId: 'ev-1',
    },
    evidence: {
      id: partial?.evidenceId ?? 'ev-1',
      tenantId: partial?.evidenceTenantId ?? resultTenantId,
    },
  };
}

function memoryTx(seed: DecisionTaskDraft[] = []): DecisionTaskWriteTx & { tasks: DecisionTaskDraft[]; audits: string[] } {
  const tasks = [...seed];
  const audits: string[] = [];
  return {
    tasks,
    audits,
    async findByResultAndType(reviewResultId, taskType) {
      return tasks.find((task) => task.reviewResultId === reviewResultId && task.taskType === taskType) ?? null;
    },
    async insert(task, audit) {
      tasks.push(task);
      audits.push(audit.action);
    },
  };
}

describe('decision task mapping', () => {
  it('creates no task for ACCEPT and leaves the review result unchanged', async () => {
    const input = command({ decision: 'ACCEPT', conflictDetected: false });
    const before = JSON.stringify(input.reviewResult);
    const tx = memoryTx();
    const outcome = await runDecisionTaskPersist(input, tx);
    assert.equal(outcome.ok, true);
    if (!outcome.ok) return;
    assert.equal(outcome.outcome, 'NO_TASK');
    assert.equal(tx.tasks.length, 0);
    assert.equal(JSON.stringify(input.reviewResult), before);
  });

  it('creates one verification task for VERIFY without a code-change instruction', async () => {
    const tx = memoryTx();
    const outcome = await runDecisionTaskPersist(command(), tx);
    assert.equal(outcome.ok, true);
    if (!outcome.ok || outcome.outcome !== 'TASK') return;
    assert.equal(outcome.created, true);
    assert.equal(outcome.task.taskType, 'VERIFICATION');
    assert.equal(outcome.task.decision, 'VERIFY');
    assert.equal(outcome.task.status, 'OPEN');
    assert.equal(outcome.task.reason, 'DB와 GA4의 동일 metric pair에 conflict가 존재함');
    assert.equal(outcome.task.description, '두 데이터 소스의 측정 기준 또는 수집 결과 차이를 확인한다.');
    const text = `${outcome.task.title}\n${outcome.task.description}\n${outcome.task.reason}`;
    assert.equal(text.includes('코드를 수정'), false);
    assert.equal(text.includes('GA4에 맞춘다'), false);
    assert.equal(text.includes('수집 코드를 변경'), false);
    assert.deepEqual(tx.audits, ['VERIFICATION_TASK_CREATED']);
  });

  it('creates one reword task without starting an agent', async () => {
    const tx = memoryTx();
    const outcome = await runDecisionTaskPersist(
      command({ decision: 'REWORD', conflictDetected: false, overclaimDetected: true, revisionRequired: true }),
      tx,
    );
    assert.equal(outcome.ok, true);
    if (!outcome.ok || outcome.outcome !== 'TASK') return;
    assert.equal(outcome.task.taskType, 'REWORD');
    assert.equal(outcome.task.decision, 'REWORD');
    assert.deepEqual(tx.audits, ['IMPROVEMENT_TASK_CREATED']);
    assert.equal(JSON.stringify(outcome).includes('CURSOR'), false);
    assert.equal(JSON.stringify(outcome).includes('CLAUDE'), false);
  });

  it('returns the existing task for the same review result and type', async () => {
    const tx = memoryTx();
    const first = await runDecisionTaskPersist(command(), tx);
    const second = await runDecisionTaskPersist(command({ clientTenantId: 'tenant-b' }), tx);
    assert.equal(first.ok && second.ok, true);
    if (!first.ok || !second.ok || first.outcome !== 'TASK' || second.outcome !== 'TASK') return;
    assert.equal(second.created, false);
    assert.equal(second.task.id, first.task.id);
    assert.equal(tx.tasks.length, 1);
    assert.equal(tx.audits.length, 1);
  });

  it('blocks another tenant and ignores a client tenant id', async () => {
    const tx = memoryTx();
    const foreign = await runDecisionTaskPersist(command({ resultTenantId: 'tenant-b', clientTenantId: 'tenant-a' }), tx);
    const local = await runDecisionTaskPersist(command({ clientTenantId: 'tenant-b' }), tx);
    assert.equal(foreign.ok, false);
    if (!foreign.ok) assert.equal(foreign.reason, 'TENANT_MISMATCH');
    assert.equal(local.ok, true);
    if (local.ok && local.outcome === 'TASK') assert.equal(local.task.tenantId, 'tenant-a');
    assert.equal(tx.tasks.length, 1);
  });

  it('stops on decisions outside the product contract', async () => {
    const tx = memoryTx();
    for (const decision of ['CAVEAT', 'NARROW', 'REJECT']) {
      const outcome = await runDecisionTaskPersist(command({ decision }), tx);
      assert.equal(outcome.ok, false);
      if (!outcome.ok) assert.equal(outcome.reason, 'DECISION_NOT_IN_CONTRACT');
    }
    assert.equal(tx.tasks.length, 0);
  });

  it('keeps provenance and does not store a credential', async () => {
    const tx = memoryTx();
    const secret = { credentialRef: 'raw-token-value' };
    const outcome = await runDecisionTaskPersist({ ...command(), ...secret } as Parameters<typeof planDecisionTask>[0], tx);
    assert.equal(outcome.ok, true);
    if (!outcome.ok || outcome.outcome !== 'TASK') return;
    assert.equal(outcome.task.tenantId, 'tenant-a');
    assert.equal(outcome.task.reviewResultId, 'result-1');
    assert.equal(outcome.task.evidenceId, 'ev-1');
    assert.equal(outcome.task.createdAt, NOW);
    assert.equal(outcome.task.updatedAt, NOW);
    assert.equal(JSON.stringify(outcome).includes('raw-token-value'), false);
    const source = readFileSync(new URL('./decision-task.ts', import.meta.url), 'utf8');
    assert.equal(source.includes('credentialRef'), false);
    assert.equal(source.includes('runReviewBoardPipeline'), false);
  });

  it('moves a task only through the decision-task lifecycle', () => {
    const task = {
      id: 'task-1',
      tenantId: 'tenant-a',
      reviewResultId: 'result-1',
      evidenceId: 'ev-1',
      taskType: 'VERIFICATION' as const,
      decision: 'VERIFY' as const,
      title: '검증',
      description: '차이를 확인한다.',
      reason: 'conflict가 존재함',
      status: 'OPEN' as const,
      createdAt: NOW,
      updatedAt: NOW,
    };
    const started = planTaskTransition(task, 'IN_PROGRESS', '2026-10-02T01:00:00.000Z');
    assert.equal(started.ok, true);
    if (!started.ok) return;
    assert.equal(started.task.status, 'IN_PROGRESS');
    assert.equal(started.task.createdAt, NOW);
    assert.equal(started.task.reason, task.reason);
    const blocked = planTaskTransition(started.task, 'BLOCKED', '2026-10-02T02:00:00.000Z');
    assert.equal(blocked.ok, true);
    if (!blocked.ok) return;
    const resumed = planTaskTransition(blocked.task, 'IN_PROGRESS', '2026-10-02T03:00:00.000Z');
    assert.equal(resumed.ok, true);
    if (!resumed.ok) return;
    const blockedDone = planTaskTransition(resumed.task, 'COMPLETED', '2026-10-02T04:00:00.000Z');
    assert.equal(blockedDone.ok, false);
    if (!blockedDone.ok) assert.equal(blockedDone.reason, 'RESULT_REQUIRED');
    const done = planTaskTransition(resumed.task, 'COMPLETED', '2026-10-02T04:00:00.000Z', {
      verificationResultId: 'verification-1',
    });
    assert.equal(done.ok, true);
    if (!done.ok) return;
    const after = planTaskTransition(done.task, 'OPEN', '2026-10-02T05:00:00.000Z');
    assert.equal(after.ok, false);
    const cancelled = planTaskTransition(task, 'CANCELLED', '2026-10-02T06:00:00.000Z');
    assert.equal(cancelled.ok, true);
  });
});
