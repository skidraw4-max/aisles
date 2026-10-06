/**
 * Agent execution stops at COMPLETED or BLOCKED.
 * Run: node --import tsx --test src/lib/jury-product/agent-execution.test.ts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import type { AgentExecutionDraft, HandoffTask } from './agent-handoff';
import { executeAgent, type ExecuteCommand, type ExecutionWriteTx } from './agent-execution';
import { fakeCursorAdapter } from './agents/fake-cursor-adapter';
import { runCursorAdapter } from './agents/cursor-adapter';
import { REWORD_CONSTRAINTS, REWORD_FIXTURE_OBJECTIVE, REWORD_FIXTURE_REASON } from './improvement-bridge';
import type { JuryMembership } from './records';

const owner: JuryMembership = {
  id: 'mem-1',
  tenantId: 'tenant-a',
  userId: 'user-1',
  role: 'OWNER',
  createdAt: '2026-10-01T00:00:00.000Z',
};

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
    reason: REWORD_FIXTURE_REASON,
    objective: REWORD_FIXTURE_OBJECTIVE,
    constraints: [...REWORD_CONSTRAINTS],
    status: 'OPEN',
    provenance: provenance(),
    ...partial,
  };
}

function provenance() {
  return {
    reviewResultId: 'review-1',
    decisionTaskId: 'decision-1',
    evidenceId: 'ev-1',
    sourceDecision: 'REWORD' as const,
    comparator: {
      evidenceStrength: 'moderate',
      claimStrength: 'weak',
      conflictDetected: false,
      overclaimDetected: true,
      revisionRequired: true,
      expectedDecision: 'REWORD' as const,
    },
  };
}

function execution(partial?: Partial<AgentExecutionDraft>): AgentExecutionDraft {
  return {
    id: 'exec-1',
    tenantId: 'tenant-a',
    taskId: 'improvement-1',
    agent: 'CURSOR',
    status: 'PENDING',
    inputSnapshot: {
      improvementTaskId: 'improvement-1',
      taskType: 'REWORD',
      title: '결과 문구 정리',
      description: '결과 문구를 측정된 범위 안에서 다시 다듬는다.',
      reason: REWORD_FIXTURE_REASON,
      objective: REWORD_FIXTURE_OBJECTIVE,
      constraints: [...REWORD_CONSTRAINTS],
      evidenceId: 'ev-1',
      reviewResultId: 'review-1',
      provenance: provenance(),
      workspaceRef: { type: 'PROJECT', ref: 'mock-aisle' },
    },
    workspaceRef: { type: 'PROJECT', ref: 'mock-aisle' },
    requestedAt: '2026-10-02T01:00:00.000Z',
    startedAt: null,
    finishedAt: null,
    resultRef: null,
    errorCode: null,
    provenance: provenance(),
    allowedPaths: [],
    deniedPaths: [],
    createdAt: '2026-10-02T01:00:00.000Z',
    updatedAt: '2026-10-02T01:00:00.000Z',
    ...partial,
  };
}

function command(partial?: Partial<ExecuteCommand>): ExecuteCommand {
  return {
    userId: 'user-1',
    memberships: [owner],
    clientTenantId: 'forged-tenant',
    now: '2026-10-02T01:55:00.000Z',
    clock: () => '2026-10-02T01:56:00.000Z',
    timeoutMs: 1000,
    loopGuardBlocked: false,
    execution: execution(),
    task: task(),
    ...partial,
  };
}

function memory(seed = execution()): ExecutionWriteTx & { row: AgentExecutionDraft; audits: string[]; claims: number } {
  let row = seed;
  const audits: string[] = [];
  const state = { claims: 0 };
  const tx: ExecutionWriteTx & { row: AgentExecutionDraft; audits: string[]; claims: number } = {
    audits,
    get row() {
      return row;
    },
    get claims() {
      return state.claims;
    },
    async claimRunning(id, at) {
      state.claims += 1;
      if (row.id !== id || row.status !== 'PENDING') return false;
      row = { ...row, status: 'RUNNING', startedAt: at, updatedAt: at };
      return true;
    },
    async blockPending(id, errorCode, at) {
      if (row.id !== id || row.status !== 'PENDING') return false;
      row = { ...row, status: 'BLOCKED', errorCode, finishedAt: at, updatedAt: at };
      return true;
    },
    async completeRunning(id, resultRef, at) {
      if (row.id !== id || row.status !== 'RUNNING') return false;
      row = { ...row, status: 'COMPLETED', resultRef, errorCode: null, finishedAt: at, updatedAt: at };
      return true;
    },
    async failRunning(id, errorCode, at) {
      if (row.id !== id || row.status !== 'RUNNING') return false;
      row = { ...row, status: 'BLOCKED', errorCode, finishedAt: at, updatedAt: at };
      return true;
    },
    async audit(action) {
      audits.push(action);
    },
    async saveResult(artifact) {
      assert.equal(JSON.stringify(artifact).includes('credentialRef'), false);
      return `memory:${artifact.executionId}`;
    },
  };
  return tx;
}

describe('agent execution', () => {
  it('moves PENDING to COMPLETED once and stores the result ref', async () => {
    const tx = memory();
    const adapter = fakeCursorAdapter();
    const work = task();
    const first = await executeAgent(command({ task: work }), adapter, tx);
    const second = await executeAgent(command({ execution: tx.row, task: work }), adapter, tx);
    assert.equal(first.ok, true);
    if (!first.ok) return;
    assert.equal(first.execution.status, 'COMPLETED');
    assert.equal(first.execution.startedAt, '2026-10-02T01:55:00.000Z');
    assert.equal(first.execution.finishedAt, '2026-10-02T01:56:00.000Z');
    assert.equal(first.execution.resultRef, 'memory:exec-1');
    assert.equal(first.execution.errorCode, null);
    assert.equal(adapter.calls.length, 1);
    assert.equal(adapter.calls[0]?.workspaceRoot, 'data/jury-product/workspaces/mock-aisle');
    assert.equal(adapter.calls[0]?.instruction.includes(REWORD_FIXTURE_OBJECTIVE), true);
    assert.equal(adapter.calls[0]?.instruction.includes('credentialRef'), false);
    assert.deepEqual(tx.audits, ['AGENT_EXECUTION_STARTED', 'AGENT_EXECUTION_COMPLETED']);
    assert.equal(second.ok, false);
    if (second.ok) return;
    assert.equal(second.reason, 'EXECUTION_NOT_PENDING');
    assert.equal(adapter.calls.length, 1);
    assert.equal(work.status, 'OPEN');
  });

  it('blocks a closed task, a foreign tenant, a bad workspace, secrets, and a blocked loop', async () => {
    const closed = memory();
    const closedAdapter = fakeCursorAdapter();
    const closedResult = await executeAgent(command({ task: task({ status: 'HANDED_OFF' }) }), closedAdapter, closed);
    assert.equal(closedResult.ok, false);
    if (closedResult.ok) return;
    assert.equal(closedResult.reason, 'IMPROVEMENT_TASK_NOT_OPEN');
    assert.equal(closed.row.status, 'BLOCKED');
    assert.equal(closedAdapter.calls.length, 0);

    const foreign = memory();
    const foreignResult = await executeAgent(
      command({ execution: execution({ tenantId: 'tenant-b' }) }),
      fakeCursorAdapter(),
      foreign,
    );
    assert.equal(foreignResult.ok, false);
    if (foreignResult.ok) return;
    assert.equal(foreignResult.reason, 'TENANT_MISMATCH');
    assert.equal(foreign.row.status, 'PENDING');

    const workspace = memory();
    const workspaceResult = await executeAgent(
      command({ execution: execution({ workspaceRef: { type: 'PROJECT', ref: 'other-app' } }) }),
      fakeCursorAdapter(),
      workspace,
    );
    assert.equal(workspaceResult.ok, false);
    if (workspaceResult.ok) return;
    assert.equal(workspaceResult.reason, 'WORKSPACE_REF_INVALID');
    assert.equal(workspace.row.status, 'BLOCKED');

    const secretSnapshot = execution();
    secretSnapshot.inputSnapshot = { ...secretSnapshot.inputSnapshot, description: 'credentialRef=hidden' };
    const secret = memory(secretSnapshot);
    const secretResult = await executeAgent(command({ execution: secretSnapshot }), fakeCursorAdapter(), secret);
    assert.equal(secretResult.ok, false);
    if (secretResult.ok) return;
    assert.equal(secretResult.reason, 'CREDENTIAL_DATA_DETECTED');
    assert.equal(JSON.stringify(secret.audits).includes('credentialRef'), false);

    const loop = memory();
    const loopAdapter = fakeCursorAdapter();
    const loopResult = await executeAgent(command({ loopGuardBlocked: true }), loopAdapter, loop);
    assert.equal(loopResult.ok, false);
    if (loopResult.ok) return;
    assert.equal(loopResult.reason, 'LOOP_GUARD_BLOCKED');
    assert.equal(loopAdapter.calls.length, 0);
  });

  it('does not start for a member, a running execution, a completed execution, or a blocked execution', async () => {
    const member = memory();
    const memberResult = await executeAgent(
      command({
        memberships: [{ ...owner, role: 'MEMBER' }],
      }),
      fakeCursorAdapter(),
      member,
    );
    assert.equal(memberResult.ok, false);
    if (memberResult.ok) return;
    assert.equal(memberResult.reason, 'FORBIDDEN');
    assert.equal(member.row.status, 'PENDING');
    assert.equal(member.claims, 0);

    for (const status of ['RUNNING', 'COMPLETED', 'BLOCKED'] as const) {
      const tx = memory(execution({ status }));
      const adapter = fakeCursorAdapter();
      const result = await executeAgent(command({ execution: execution({ status }) }), adapter, tx);
      assert.equal(result.ok, false);
      if (result.ok) return;
      assert.equal(result.reason, 'EXECUTION_NOT_PENDING');
      assert.equal(adapter.calls.length, 0);
      assert.equal(tx.row.status, status);
    }
  });

  it('blocks an unsupported agent, a timeout, and an adapter failure', async () => {
    const claude = memory(execution({ agent: 'CLAUDE_CODE' }));
    const claudeAdapter = fakeCursorAdapter();
    const claudeResult = await executeAgent(command({ execution: execution({ agent: 'CLAUDE_CODE' }) }), claudeAdapter, claude);
    assert.equal(claudeResult.ok, false);
    if (claudeResult.ok) return;
    assert.equal(claudeResult.reason, 'AGENT_TYPE_UNSUPPORTED');
    assert.equal(claudeAdapter.calls.length, 0);

    const timeout = memory();
    const timeoutResult = await executeAgent(command({ timeoutMs: 20 }), fakeCursorAdapter('hang'), timeout);
    assert.equal(timeoutResult.ok, false);
    if (timeoutResult.ok) return;
    assert.equal(timeoutResult.reason, 'EXECUTION_TIMEOUT');
    assert.equal(timeout.row.status, 'BLOCKED');
    assert.equal(timeout.row.errorCode, 'EXECUTION_TIMEOUT');
    assert.equal(timeout.audits.includes('AGENT_EXECUTION_STARTED'), true);
    assert.equal(timeout.audits.includes('AGENT_EXECUTION_BLOCKED'), true);

    const failed = memory();
    const failedResult = await executeAgent(command(), fakeCursorAdapter('fail'), failed);
    assert.equal(failedResult.ok, false);
    if (failedResult.ok) return;
    assert.equal(failedResult.reason, 'AGENT_EXECUTION_FAILED');
    assert.equal(failed.row.status, 'BLOCKED');
  });

  it('lets one of two concurrent claims call the adapter', async () => {
    const tx = memory();
    const adapter = fakeCursorAdapter();
    const [first, second] = await Promise.all([executeAgent(command(), adapter, tx), executeAgent(command(), adapter, tx)]);
    const completed = [first, second].filter((result) => result.ok);
    assert.equal(completed.length, 1);
    assert.equal(adapter.calls.length, 1);
    assert.equal(tx.row.status, 'COMPLETED');
  });

  it('does not spawn Cursor on the default path', async () => {
    const service = readFileSync(new URL('./agent-execution.ts', import.meta.url), 'utf8');
    const store = readFileSync(new URL('./agent-execution-store.ts', import.meta.url), 'utf8');
    const adapterSource = readFileSync(new URL('./agents/cursor-adapter.ts', import.meta.url), 'utf8');
    assert.equal(service.includes('child_process'), false);
    assert.equal(service.includes('runReviewBoardPipeline'), false);
    assert.equal(store.includes('child_process'), false);
    assert.ok(adapterSource.indexOf('JURY_CURSOR_AGENT_ENABLED') < adapterSource.indexOf('child_process'));
    const previous = process.env.JURY_CURSOR_AGENT_ENABLED;
    delete process.env.JURY_CURSOR_AGENT_ENABLED;
    const result = await runCursorAdapter({
      executionId: 'exec-1',
      workspaceRef: { type: 'PROJECT', ref: 'mock-aisle' },
      workspaceRoot: 'data/jury-product/workspaces/mock-aisle',
      inputSnapshot: execution().inputSnapshot,
      instruction: 'do not run',
      signal: new AbortController().signal,
    });
    if (previous === undefined) delete process.env.JURY_CURSOR_AGENT_ENABLED;
    else process.env.JURY_CURSOR_AGENT_ENABLED = previous;
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.errorCode, 'AGENT_NOT_AVAILABLE');
  });
});
