/**
 * Improvement task to agent handoff and execution.
 * Run: node --import tsx --test src/lib/jury-product/improvement-agent-run.test.ts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import type { AgentExecutionDraft, HandoffTask, HandoffWriteTx } from './agent-handoff';
import type { ExecutionWriteTx } from './agent-execution';
import { fakeCursorAdapter } from './agents/fake-cursor-adapter';
import { executeImprovementTask, workspaceForImprovementTask } from './improvement-agent-run';
import { startNewImprovementCycle, type StartIo, type StartLoaded, type StartReview } from './improvement-cycle-start';
import { REWORD_CONSTRAINTS, type ImprovementTaskDraft } from './improvement-bridge';
import type { DecisionTaskDraft } from './decision-task';
import { PRODUCT_LOOP_GUARD_DEFAULTS, type DecisionCycleDraft } from './loop-guard';
import type { JuryMembership } from './records';

const owner: JuryMembership = {
  id: 'mem-1',
  tenantId: 'tenant-a',
  userId: 'user-1',
  role: 'OWNER',
  createdAt: '2026-10-01T00:00:00.000Z',
};

function provenance() {
  return {
    reviewResultId: 'review-1',
    decisionTaskId: 'decision-1',
    evidenceId: 'ev-1',
    sourceDecision: 'REWORD' as const,
    comparator: {
      evidenceStrength: 'moderate',
      claimStrength: 'weak',
      conflictDetected: true,
      overclaimDetected: true,
      revisionRequired: true,
      expectedDecision: 'REWORD' as const,
    },
  };
}

function task(partial?: Partial<HandoffTask>): HandoffTask {
  return {
    id: 'improvement-1',
    tenantId: 'tenant-a',
    reviewResultId: 'review-1',
    decisionTaskId: 'decision-1',
    evidenceId: 'ev-1',
    taskType: 'REWORD',
    title: '결과 문구 정리',
    description: '결과 문구를 측정된 범위 안에서 다시 다듬는다.',
    reason: 'Comparator가 overclaim을 표시했다.',
    objective: '결과 문구를 측정된 범위 안에서 다시 다듬는다.',
    constraints: [...REWORD_CONSTRAINTS],
    status: 'OPEN',
    provenance: provenance(),
    ...partial,
  };
}

function harness(seed?: HandoffTask, executions: AgentExecutionDraft[] = []) {
  const rows = [...executions];
  const work = seed ?? task();
  const cycle = {
    id: '14308b4c999ccbe8ca54b7f31da5385385d4073c49bbf2955582a6bb96afb01e',
    rootReviewResultId: '2f6638a0addf8a8706ddf8d53396bb81b37c9aeadae4910a33be00f634be3f59',
    currentReviewResultId: '6adbe7150104e3b95030e5499f52085d8e72dbcb8f999136782bdb0f96fbd7e7',
    iteration: 2,
    verificationAttempts: 1,
    sameDecisionCount: 2,
    sameConflictCount: 2,
    updatedAt: '2026-10-01T16:33:57.676Z',
  };
  const handoff: HandoffWriteTx = {
    async findByTaskAndAgent(taskId, agent) {
      await Promise.resolve();
      return rows.find((row) => row.taskId === taskId && row.agent === agent) ?? null;
    },
    async insert(execution) {
      await Promise.resolve();
      if (rows.some((row) => row.taskId === execution.taskId && row.agent === execution.agent)) {
        const error = new Error('unique') as Error & { code: string };
        error.code = 'P2002';
        throw error;
      }
      rows.push(execution);
    },
    async audit() {},
  };
  const execution: ExecutionWriteTx = {
    async claimRunning(id, at) {
      const row = rows.find((item) => item.id === id);
      if (!row || row.status !== 'PENDING') return false;
      row.status = 'RUNNING';
      row.startedAt = at;
      row.updatedAt = at;
      return true;
    },
    async blockPending(id, errorCode, at) {
      const row = rows.find((item) => item.id === id);
      if (!row || row.status !== 'PENDING') return false;
      row.status = 'BLOCKED';
      row.errorCode = errorCode;
      row.finishedAt = at;
      row.updatedAt = at;
      return true;
    },
    async completeRunning(id, resultRef, at) {
      const row = rows.find((item) => item.id === id);
      if (!row || row.status !== 'RUNNING') return false;
      row.status = 'COMPLETED';
      row.resultRef = resultRef;
      row.errorCode = null;
      row.finishedAt = at;
      row.updatedAt = at;
      return true;
    },
    async failRunning(id, errorCode, at) {
      const row = rows.find((item) => item.id === id);
      if (!row || row.status !== 'RUNNING') return false;
      row.status = 'BLOCKED';
      row.errorCode = errorCode;
      row.finishedAt = at;
      row.updatedAt = at;
      return true;
    },
    async audit() {},
    async saveResult(artifact) {
      return `memory:${artifact.executionId}`;
    },
  };
  return { rows, work, cycle, handoff, execution };
}

const command = {
  userId: 'user-1',
  memberships: [owner],
  clientTenantId: 'forged-tenant',
  now: '2026-10-02T10:34:00.000Z',
  clock: () => '2026-10-02T10:34:01.000Z',
  timeoutMs: 1000,
  improvementTaskId: 'improvement-1',
};

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: string }).code === 'P2002';
}

async function withUniqueRetry<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    return run();
  }
}

describe('improvement agent run', () => {
  it('hands off an open task and completes it with the fake adapter once', async () => {
    const box = harness();
    const adapter = fakeCursorAdapter();
    const first = await executeImprovementTask(command, { load: async () => box.work, handoff: box.handoff, execution: box.execution }, adapter);
    const second = await executeImprovementTask(command, { load: async () => box.work, handoff: box.handoff, execution: box.execution }, adapter);
    assert.equal(first.ok, true);
    if (!first.ok) return;
    assert.equal(first.adapterCalled, true);
    assert.equal(first.execution.status, 'COMPLETED');
    assert.equal(first.execution.agent, 'CURSOR');
    assert.deepEqual(first.execution.workspaceRef, { type: 'PROJECT', ref: 'mock-aisle' });
    assert.equal(box.rows.length, 1);
    assert.equal(box.work.status, 'OPEN');
    assert.equal(adapter.calls.length, 1);
    assert.equal(adapter.calls[0]?.workspaceRoot, 'data/jury-product/workspaces/mock-aisle');
    assert.equal(second.ok, false);
    if (second.ok) return;
    assert.equal(second.reason, 'EXECUTION_NOT_PENDING');
    assert.equal(adapter.calls.length, 1);
    assert.deepEqual(box.cycle, {
      id: '14308b4c999ccbe8ca54b7f31da5385385d4073c49bbf2955582a6bb96afb01e',
      rootReviewResultId: '2f6638a0addf8a8706ddf8d53396bb81b37c9aeadae4910a33be00f634be3f59',
      currentReviewResultId: '6adbe7150104e3b95030e5499f52085d8e72dbcb8f999136782bdb0f96fbd7e7',
      iteration: 2,
      verificationAttempts: 1,
      sameDecisionCount: 2,
      sameConflictCount: 2,
      updatedAt: '2026-10-01T16:33:57.676Z',
    });
  });

  it('keeps one execution when two calls race and refuses closed or foreign tasks', async () => {
    const box = harness();
    const adapter = fakeCursorAdapter();
    const io = { load: async () => box.work, handoff: box.handoff, execution: box.execution };
    const [left, right] = await Promise.all([
      withUniqueRetry(() => executeImprovementTask(command, io, adapter)),
      withUniqueRetry(() => executeImprovementTask(command, io, adapter)),
    ]);
    assert.equal(left.ok || right.ok, true);
    assert.equal(box.rows.length, 1);
    assert.equal(adapter.calls.length, 1);
    assert.equal(box.rows[0]?.status, 'COMPLETED');

    const member = harness();
    const memberAdapter = fakeCursorAdapter();
    const denied = await executeImprovementTask(
      { ...command, memberships: [{ ...owner, id: 'mem-m', role: 'DEVELOPER' }] },
      { load: async () => member.work, handoff: member.handoff, execution: member.execution },
      memberAdapter,
    );
    assert.equal(denied.ok, false);
    if (denied.ok) return;
    assert.equal(denied.reason, 'FORBIDDEN');
    assert.equal(member.rows.length, 0);
    assert.equal(memberAdapter.calls.length, 0);

    const auditor = harness();
    const auditorAdapter = fakeCursorAdapter();
    const readOnly = await executeImprovementTask(
      { ...command, memberships: [{ ...owner, id: 'mem-a', role: 'VIEWER' }] },
      { load: async () => auditor.work, handoff: auditor.handoff, execution: auditor.execution },
      auditorAdapter,
    );
    assert.equal(readOnly.ok, false);
    if (readOnly.ok) return;
    assert.equal(readOnly.reason, 'FORBIDDEN');
    assert.equal(auditor.rows.length, 0);

    const foreign = harness(task({ tenantId: 'tenant-b' }));
    const mismatch = await executeImprovementTask(command, { load: async () => foreign.work, handoff: foreign.handoff, execution: foreign.execution }, fakeCursorAdapter());
    assert.equal(mismatch.ok, false);
    if (mismatch.ok) return;
    assert.equal(mismatch.reason, 'TENANT_MISMATCH');
    assert.equal(foreign.rows.length, 0);
  });

  it('rejects secrets, a bad workspace, and an adapter failure without a second execution', async () => {
    const secret = harness(task({ objective: 'store the password in the copy' }));
    const leaked = await executeImprovementTask(command, { load: async () => secret.work, handoff: secret.handoff, execution: secret.execution }, fakeCursorAdapter());
    assert.equal(leaked.ok, false);
    if (leaked.ok) return;
    assert.equal(leaked.reason, 'CREDENTIAL_DATA_DETECTED');
    assert.equal(secret.rows.length, 0);

    const escaped = workspaceForImprovementTask({ ...provenance(), workspaceRef: { type: 'PROJECT', ref: '../outside' } });
    assert.equal(escaped, null);
    const unknown = workspaceForImprovementTask({ ...provenance(), workspaceRef: { type: 'PROJECT', ref: 'other-project' } });
    assert.equal(unknown, null);
    const bad = harness(task({ provenance: { ...provenance(), workspaceRef: { type: 'PROJECT', ref: 'other-project' } } as HandoffTask['provenance'] }));
    const blockedWorkspace = await executeImprovementTask(command, { load: async () => bad.work, handoff: bad.handoff, execution: bad.execution }, fakeCursorAdapter());
    assert.equal(blockedWorkspace.ok, false);
    if (blockedWorkspace.ok) return;
    assert.equal(blockedWorkspace.reason, 'WORKSPACE_REF_INVALID');
    assert.equal(bad.rows.length, 0);

    const failing = harness();
    const failedAdapter = fakeCursorAdapter('fail');
    const failed = await executeImprovementTask(
      command,
      { load: async () => failing.work, handoff: failing.handoff, execution: failing.execution },
      failedAdapter,
    );
    assert.equal(failed.ok, false);
    if (failed.ok) return;
    assert.equal(failed.reason, 'AGENT_EXECUTION_FAILED');
    assert.equal(failed.adapterCalled, true);
    assert.equal(failing.rows.length, 1);
    assert.equal(failing.rows[0]?.status, 'BLOCKED');
    assert.equal(failedAdapter.calls.length, 1);

    const done = harness();
    const first = await executeImprovementTask(command, { load: async () => done.work, handoff: done.handoff, execution: done.execution }, fakeCursorAdapter());
    assert.equal(first.ok, true);
    const again = await executeImprovementTask(command, { load: async () => done.work, handoff: done.handoff, execution: done.execution }, fakeCursorAdapter());
    assert.equal(again.ok, false);
    if (again.ok) return;
    assert.equal(again.reason, 'EXECUTION_NOT_PENDING');
    assert.equal(done.rows.length, 1);

    const source = readFileSync(new URL('./improvement-agent-run.ts', import.meta.url), 'utf8');
    assert.equal(source.includes('runReviewBoardPipeline'), false);
    assert.equal(source.includes('evaluateChangeGate'), false);
    assert.equal(source.includes('child_process'), false);
    assert.equal(source.includes('cursor-adapter'), false);
    assert.equal(source.includes('juryDecisionCycle'), false);
  });

  it('runs a phase 24 improvement task without moving the cycle', async () => {
    const started = await startNewImprovementCycle(
      {
        userId: 'user-1',
        memberships: [owner],
        clientTenantId: 'forged-tenant',
        now: '2026-10-02T10:34:00.000Z',
        reviewResultId: 'reword-1',
      },
      phase24Io(),
    );
    assert.equal(started.ok, true);
    if (!started.ok) return;
    const before = { ...started.cycle };
    const handed: HandoffTask = {
      id: started.improvementTask.id,
      tenantId: started.improvementTask.tenantId,
      reviewResultId: started.improvementTask.reviewResultId,
      decisionTaskId: started.improvementTask.decisionTaskId,
      evidenceId: started.improvementTask.evidenceId,
      taskType: started.improvementTask.taskType,
      title: started.improvementTask.title,
      description: started.improvementTask.description,
      reason: started.improvementTask.reason,
      objective: started.improvementTask.objective,
      constraints: started.improvementTask.constraints,
      status: started.improvementTask.status,
      provenance: started.improvementTask.provenance,
    };
    const box = harness(handed);
    const adapter = fakeCursorAdapter();
    const ran = await executeImprovementTask(
      { ...command, improvementTaskId: handed.id },
      { load: async () => box.work, handoff: box.handoff, execution: box.execution },
      adapter,
    );
    assert.equal(ran.ok, true);
    if (!ran.ok) return;
    assert.equal(ran.execution.status, 'COMPLETED');
    assert.equal(ran.execution.taskId, started.improvementTask.id);
    assert.equal(box.work.status, 'OPEN');
    assert.equal(adapter.calls.length, 1);
    assert.deepEqual(started.cycle, before);
    assert.equal(before.rootReviewResultId, 'reword-1');
    assert.equal(before.currentReviewResultId, 'reword-1');
    assert.equal(before.iteration, 1);
  });
});

function phase24Io(): StartIo {
  const state = {
    cycles: [] as DecisionCycleDraft[],
    tasks: [] as DecisionTaskDraft[],
    improvements: [] as ImprovementTaskDraft[],
  };
  const loaded: StartLoaded = {
    review: {
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
    } satisfies StartReview,
    evidence: { id: 'ev-1', tenantId: 'tenant-a' },
    cycle: null,
    decisionTask: null,
    decisionLinked: false,
    improvementTask: null,
    improvementLinked: false,
  };
  return {
    async load() {
      return loaded;
    },
    async findPolicy() {
      return { id: 'policy-stored', policy: PRODUCT_LOOP_GUARD_DEFAULTS };
    },
    async insertCycle(cycle) {
      state.cycles.push(cycle);
    },
    async auditCycle() {},
    decisionTx: {
      async findByResultAndType() {
        return null;
      },
      async insert(task) {
        state.tasks.push(task);
      },
    },
    improvementTx: {
      async findByDecisionTask() {
        return null;
      },
      async insert(task) {
        state.improvements.push(task);
      },
      async audit() {},
    },
  };
}
