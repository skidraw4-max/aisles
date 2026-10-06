/**
 * Agent handoff stops at PENDING. It does not start an agent.
 * Run: node --import tsx --test src/lib/jury-product/agent-handoff.test.ts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { REWORD_CONSTRAINTS, REWORD_FIXTURE_OBJECTIVE, REWORD_FIXTURE_REASON } from './improvement-bridge';
import type { JuryMembership } from './records';
import {
  handoffAgent,
  type AgentExecutionDraft,
  type HandoffCommand,
  type HandoffTask,
  type HandoffWriteTx,
} from './agent-handoff';

const membership: JuryMembership = {
  id: 'mem-1',
  tenantId: 'tenant-a',
  userId: 'user-1',
  role: 'OWNER',
  createdAt: '2026-10-01T00:00:00.000Z',
};

const workspace = { type: 'PROJECT', ref: 'mock-aisle' };

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
    provenance: {
      reviewResultId: 'review-1',
      decisionTaskId: 'decision-1',
      evidenceId: 'ev-1',
      sourceDecision: 'REWORD',
      comparator: {
        evidenceStrength: 'moderate',
        claimStrength: 'weak',
        conflictDetected: false,
        overclaimDetected: true,
        revisionRequired: true,
        expectedDecision: 'REWORD',
      },
    },
    ...partial,
  };
}

function command(partial?: Partial<HandoffCommand>): HandoffCommand {
  return {
    userId: 'user-1',
    memberships: [membership],
    clientTenantId: 'forged-tenant',
    now: '2026-10-02T01:46:00.000Z',
    task: task(),
    agentType: 'CURSOR',
    workspaceRef: workspace,
    ...partial,
  };
}

function memory(seed: AgentExecutionDraft[] = []): HandoffWriteTx & { rows: AgentExecutionDraft[]; audits: string[] } {
  const rows = [...seed];
  const audits: string[] = [];
  return {
    rows,
    audits,
    async findByTaskAndAgent(taskId, agent) {
      return rows.find((row) => row.taskId === taskId && row.agent === agent) ?? null;
    },
    async insert(execution) {
      rows.push(execution);
    },
    async audit(execution) {
      audits.push(execution.id);
    },
  };
}

describe('agent handoff', () => {
  it('creates one PENDING CURSOR execution and returns it again', async () => {
    const tx = memory();
    const first = await handoffAgent(command(), tx);
    const second = await handoffAgent(command(), tx);
    assert.equal(first.ok && second.ok, true);
    if (!first.ok || !second.ok) return;
    assert.equal(first.created, true);
    assert.equal(second.created, false);
    assert.equal(second.execution.id, first.execution.id);
    assert.equal(first.execution.status, 'PENDING');
    assert.equal(first.execution.agent, 'CURSOR');
    assert.equal(first.execution.taskId, 'improvement-1');
    assert.equal(first.execution.startedAt, null);
    assert.equal(first.execution.finishedAt, null);
    assert.equal(tx.rows.length, 1);
    assert.deepEqual(tx.audits, [first.execution.id]);
    assert.equal(first.execution.inputSnapshot.objective, REWORD_FIXTURE_OBJECTIVE);
    assert.equal(first.execution.inputSnapshot.reason, REWORD_FIXTURE_REASON);
    assert.equal(first.execution.provenance.evidenceId, 'ev-1');
    assert.deepEqual(first.execution.allowedPaths, []);
    assert.deepEqual(first.execution.deniedPaths, []);
  });

  it('returns an existing non-pending execution without a second row', async () => {
    const existing: AgentExecutionDraft = {
      id: 'already',
      tenantId: 'tenant-a',
      taskId: 'improvement-1',
      agent: 'CURSOR',
      status: 'RUNNING',
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
        provenance: task().provenance!,
        workspaceRef: { type: 'PROJECT', ref: 'mock-aisle' },
      },
      workspaceRef: { type: 'PROJECT', ref: 'mock-aisle' },
      requestedAt: '2026-10-02T01:00:00.000Z',
      startedAt: '2026-10-02T01:01:00.000Z',
      finishedAt: null,
      resultRef: null,
      errorCode: null,
      provenance: task().provenance!,
      allowedPaths: [],
      deniedPaths: [],
      createdAt: '2026-10-02T01:00:00.000Z',
      updatedAt: '2026-10-02T01:01:00.000Z',
    };
    const tx = memory([existing]);
    const result = await handoffAgent(command(), tx);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.created, false);
    assert.equal(result.execution.status, 'RUNNING');
    assert.equal(tx.rows.length, 1);
    assert.equal(tx.audits.length, 0);
  });

  it('blocks another tenant, a closed task, a non-reword task, and a bad agent or workspace', async () => {
    const foreign = await handoffAgent(command({ task: task({ tenantId: 'tenant-b' }) }), memory());
    const closed = await handoffAgent(command({ task: task({ status: 'HANDED_OFF' }) }), memory());
    const verify = await handoffAgent(command({ task: task({ taskType: 'VERIFICATION' }) }), memory());
    const manual = await handoffAgent(command({ agentType: 'MANUAL' }), memory());
    const missing = await handoffAgent(command({ workspaceRef: null }), memory());
    const path = await handoffAgent(command({ workspaceRef: { type: 'PROJECT', ref: '../../etc' } }), memory());
    const windows = await handoffAgent(command({ workspaceRef: { type: 'PROJECT', ref: 'C:\\Windows' } }), memory());
    const absent = await handoffAgent(command({ task: null }), memory());
    const broken = await handoffAgent(command({ task: task({ provenance: null }) }), memory());
    assert.equal(foreign.ok, false);
    assert.equal(closed.ok, false);
    assert.equal(verify.ok, false);
    assert.equal(manual.ok, false);
    assert.equal(missing.ok, false);
    assert.equal(path.ok, false);
    assert.equal(windows.ok, false);
    assert.equal(absent.ok, false);
    assert.equal(broken.ok, false);
    if (foreign.ok || closed.ok || verify.ok || manual.ok || missing.ok || path.ok || windows.ok || absent.ok || broken.ok) {
      return;
    }
    assert.equal(foreign.reason, 'TENANT_MISMATCH');
    assert.equal(closed.reason, 'IMPROVEMENT_TASK_NOT_OPEN');
    assert.equal(verify.reason, 'TASK_TYPE_UNSUPPORTED');
    assert.equal(manual.reason, 'AGENT_TYPE_UNSUPPORTED');
    assert.equal(missing.reason, 'WORKSPACE_REF_REQUIRED');
    assert.equal(path.reason, 'WORKSPACE_REF_REQUIRED');
    assert.equal(windows.reason, 'WORKSPACE_REF_REQUIRED');
    assert.equal(absent.reason, 'IMPROVEMENT_TASK_NOT_FOUND');
    assert.equal(broken.reason, 'INVALID_PROVENANCE');
  });

  it('keeps credentials out of the snapshot and does not call an agent', async () => {
    const tx = memory();
    const result = await handoffAgent(
      command({
        task: task({
          provenance: {
            ...task().provenance!,
            comparator: { ...task().provenance!.comparator },
          },
        }),
      }),
      tx,
    );
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const packed = JSON.stringify({ execution: result.execution, audits: tx.audits });
    assert.equal(packed.includes('credentialRef'), false);
    assert.equal(packed.toLowerCase().includes('password'), false);
    assert.equal(packed.toLowerCase().includes('access_token'), false);
    assert.equal(packed.includes('postgres://'), false);
    const source = readFileSync(new URL('./agent-handoff.ts', import.meta.url), 'utf8');
    assert.equal(source.includes('child_process'), false);
    assert.equal(source.includes('spawn('), false);
    assert.equal(source.includes('execFile'), false);
    assert.equal(source.includes('runReviewBoardPipeline'), false);
  });
});
