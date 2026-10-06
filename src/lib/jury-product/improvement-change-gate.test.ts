/**
 * Completed agent execution to the existing change gate.
 * Run: node --import tsx --test src/lib/jury-product/improvement-change-gate.test.ts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import type { AgentExecutionDraft, HandoffTask, HandoffWriteTx } from './agent-handoff';
import type { ExecutionWriteTx } from './agent-execution';
import { fakeCursorAdapter } from './agents/fake-cursor-adapter';
import { inspectAllowlistedWorkspace } from './change-gate-workspace';
import type { ChangeGateDraft, ChangeGateWriteTx, ChangeInspection } from './change-gate';
import { executeImprovementTask } from './improvement-agent-run';
import { runChangeGateForExecution, type ChangeGateRunLoad } from './improvement-change-gate';
import { REWORD_CONSTRAINTS } from './improvement-bridge';
import type { JuryMembership } from './records';

const owner: JuryMembership = {
  id: 'mem-1',
  tenantId: 'tenant-a',
  userId: 'user-1',
  role: 'OWNER',
  createdAt: '2026-10-01T00:00:00.000Z',
};

const reportedMissing = 'workspace/mock-aisle/user-facing-copy.ts';

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

function task(): HandoffTask {
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
  };
}

function execution(partial?: Partial<AgentExecutionDraft>): AgentExecutionDraft {
  return {
    id: 'exec-1',
    tenantId: 'tenant-a',
    taskId: 'improvement-1',
    agent: 'CURSOR',
    status: 'COMPLETED',
    inputSnapshot: {
      improvementTaskId: 'improvement-1',
      taskType: 'REWORD',
      title: task().title,
      description: task().description,
      reason: task().reason,
      objective: task().objective,
      constraints: [...REWORD_CONSTRAINTS],
      evidenceId: 'ev-1',
      reviewResultId: 'review-1',
      provenance: provenance(),
      workspaceRef: { type: 'PROJECT', ref: 'mock-aisle' },
    },
    workspaceRef: { type: 'PROJECT', ref: 'mock-aisle' },
    requestedAt: '2026-10-02T10:40:00.000Z',
    startedAt: '2026-10-02T10:40:00.000Z',
    finishedAt: '2026-10-02T10:40:01.000Z',
    resultRef: 'memory:exec-1',
    errorCode: null,
    provenance: provenance(),
    allowedPaths: [],
    deniedPaths: [],
    createdAt: '2026-10-02T10:40:00.000Z',
    updatedAt: '2026-10-02T10:40:01.000Z',
    ...partial,
  };
}

function gateBox(load: ChangeGateRunLoad, inspection: ChangeInspection = { files: [], present: [] }) {
  const rows: ChangeGateDraft[] = [];
  const audits: string[] = [];
  let scans = 0;
  const cycle = {
    rootReviewResultId: '2f6638a0addf8a8706ddf8d53396bb81b37c9aeadae4910a33be00f634be3f59',
    currentReviewResultId: '6adbe7150104e3b95030e5499f52085d8e72dbcb8f999136782bdb0f96fbd7e7',
    iteration: 2,
    verificationAttempts: 1,
    sameDecisionCount: 2,
    sameConflictCount: 2,
    updatedAt: '2026-10-01T16:33:57.676Z',
  };
  const resolutions: string[] = [];
  const reviews: string[] = [];
  const gate: ChangeGateWriteTx = {
    async findByExecution(executionId) {
      return rows.find((row) => row.executionId === executionId) ?? null;
    },
    async insert(row) {
      if (rows.some((item) => item.executionId === row.executionId)) {
        const error = new Error('unique') as Error & { code: string };
        error.code = 'P2002';
        throw error;
      }
      rows.push(row);
    },
    async audit(action) {
      audits.push(action);
    },
  };
  return {
    rows,
    audits,
    cycle,
    resolutions,
    reviews,
    execution: load.execution,
    get scans() {
      return scans;
    },
    async load() {
      return load;
    },
    async inspect() {
      scans += 1;
      return inspection;
    },
    gate,
  };
}

const command = {
  userId: 'user-1',
  memberships: [owner],
  clientTenantId: 'forged-tenant',
  now: '2026-10-02T10:44:00.000Z',
  executionId: 'exec-1',
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

describe('improvement change gate', () => {
  it('gates a reported file that the workspace inspection does not contain', async () => {
    const live = await inspectAllowlistedWorkspace('data/jury-product/workspaces/mock-aisle');
    assert.equal(live.ok, true);
    if (!live.ok) return;
    const box = gateBox(
      {
        execution: execution(),
        task: { id: 'improvement-1', tenantId: 'tenant-a' },
        agentReportedFiles: [reportedMissing],
        testResults: { available: false, passed: null, commands: [] },
      },
      { files: live.files, present: live.present },
    );
    const first = await runChangeGateForExecution(command, box);
    const second = await runChangeGateForExecution(command, box);
    assert.equal(first.ok && second.ok, true);
    if (!first.ok || !second.ok) return;
    assert.equal(first.created, true);
    assert.equal(second.created, false);
    assert.equal(second.gate.id, first.gate.id);
    assert.equal(box.rows.length, 1);
    assert.equal(box.scans, 1);
    assert.equal(first.gate.status, 'GATED');
    assert.equal(first.gate.discrepancy, true);
    assert.equal(first.gate.discrepancyReasons.includes('AGENT_REPORTED_FILE_NOT_FOUND_IN_WORKSPACE'), true);
    assert.deepEqual(first.gate.changedFiles, []);
    assert.equal(first.gate.credentialDetected, false);
    assert.equal(first.gate.testResults.passed, null);
    assert.deepEqual(box.audits, ['CHANGE_GATE_STARTED', 'CHANGE_GATE_COMPLETED']);
    assert.equal(box.execution?.status, 'COMPLETED');
    assert.equal(box.cycle.updatedAt, '2026-10-01T16:33:57.676Z');
    assert.equal(box.resolutions.length, 0);
    assert.equal(box.reviews.length, 0);
  });

  it('uses the workspace change set when the reported file is actually present', async () => {
    const path = 'notes/phase26-note.md';
    const box = gateBox(
      {
        execution: execution({ id: 'exec-present' }),
        task: { id: 'improvement-1', tenantId: 'tenant-a' },
        agentReportedFiles: [path],
        testResults: { available: false, passed: null, commands: [] },
      },
      {
        present: [path],
        files: [{ path, kind: 'added', additions: 2, deletions: 0 }],
      },
    );
    const result = await runChangeGateForExecution({ ...command, executionId: 'exec-present' }, box);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.gate.status, 'APPROVED');
    assert.equal(result.gate.discrepancy, false);
    assert.deepEqual(result.gate.changedFiles, [path]);
    assert.deepEqual(result.gate.addedFiles, [path]);
    assert.deepEqual(result.gate.modifiedFiles, []);
    assert.deepEqual(result.gate.deletedFiles, []);
    assert.equal(result.gate.riskLevel, 'LOW');
    assert.equal(result.gate.diffStat.filesChanged, 1);
    assert.equal(result.gate.diffStat.additions, 2);
    assert.equal(result.gate.credentialDetected, false);
  });

  it('keeps one gate under a race and refuses the unsafe cases before a scan', async () => {
    const box = gateBox({
      execution: execution(),
      task: { id: 'improvement-1', tenantId: 'tenant-a' },
      agentReportedFiles: [reportedMissing],
      testResults: { available: false, passed: null, commands: [] },
    });
    const [left, right] = await Promise.all([
      withUniqueRetry(() => runChangeGateForExecution(command, box)),
      withUniqueRetry(() => runChangeGateForExecution(command, box)),
    ]);
    assert.equal(left.ok && right.ok, true);
    if (!left.ok || !right.ok) return;
    assert.equal(left.gate.id, right.gate.id);
    assert.equal(box.rows.length, 1);

    const member = gateBox({
      execution: execution(),
      task: { id: 'improvement-1', tenantId: 'tenant-a' },
      agentReportedFiles: [reportedMissing],
      testResults: { available: false, passed: null, commands: [] },
    });
    const denied = await runChangeGateForExecution(
      { ...command, memberships: [{ ...owner, id: 'mem-m', role: 'MEMBER' }] },
      member,
    );
    assert.equal(denied.ok, false);
    if (denied.ok) return;
    assert.equal(denied.reason, 'FORBIDDEN');
    assert.equal(member.rows.length, 0);
    assert.equal(member.scans, 0);

    const auditor = gateBox({
      execution: execution(),
      task: { id: 'improvement-1', tenantId: 'tenant-a' },
      agentReportedFiles: [reportedMissing],
      testResults: { available: false, passed: null, commands: [] },
    });
    const readOnly = await runChangeGateForExecution(
      { ...command, memberships: [{ ...owner, id: 'mem-a', role: 'AUDITOR' }] },
      auditor,
    );
    assert.equal(readOnly.ok, false);
    if (readOnly.ok) return;
    assert.equal(readOnly.reason, 'FORBIDDEN');
    assert.equal(auditor.scans, 0);

    const foreign = gateBox({
      execution: execution({ tenantId: 'tenant-b' }),
      task: { id: 'improvement-1', tenantId: 'tenant-b' },
      agentReportedFiles: [reportedMissing],
      testResults: { available: false, passed: null, commands: [] },
    });
    const mismatch = await runChangeGateForExecution(command, foreign);
    assert.equal(mismatch.ok, false);
    if (mismatch.ok) return;
    assert.equal(mismatch.reason, 'TENANT_MISMATCH');
    assert.equal(foreign.rows.length, 0);
    assert.equal(foreign.scans, 0);

    const missing = gateBox({
      execution: null,
      task: null,
      agentReportedFiles: [],
      testResults: { available: false, passed: null, commands: [] },
    });
    const absent = await runChangeGateForExecution(command, missing);
    assert.equal(absent.ok, false);
    if (absent.ok) return;
    assert.equal(absent.reason, 'EXECUTION_NOT_FOUND');
    assert.equal(missing.scans, 0);

    const escaped = gateBox({
      execution: execution({ workspaceRef: { type: 'PROJECT', ref: '../outside' } }),
      task: { id: 'improvement-1', tenantId: 'tenant-a' },
      agentReportedFiles: [reportedMissing],
      testResults: { available: false, passed: null, commands: [] },
    });
    const outside = await runChangeGateForExecution(command, escaped);
    assert.equal(outside.ok, true);
    if (!outside.ok) return;
    assert.equal(outside.gate.status, 'BLOCKED');
    assert.equal(outside.gate.errorCode, 'WORKSPACE_NOT_ALLOWED');
    assert.equal(escaped.scans, 0);

    const secret = gateBox(
      {
        execution: execution({ id: 'exec-secret' }),
        task: { id: 'improvement-1', tenantId: 'tenant-a' },
        agentReportedFiles: ['notes/a.md'],
        testResults: { available: false, passed: null, commands: [] },
      },
      {
        present: ['notes/a.md'],
        files: [{ path: 'notes/a.md', kind: 'modified', additions: 1, deletions: 0, patch: 'password = hunter2' }],
      },
    );
    const leaked = await runChangeGateForExecution({ ...command, executionId: 'exec-secret' }, secret);
    assert.equal(leaked.ok, true);
    if (!leaked.ok) return;
    assert.equal(leaked.gate.status, 'BLOCKED');
    assert.equal(leaked.gate.credentialDetected, true);
    assert.equal(JSON.stringify(leaked.gate).includes('hunter2'), false);

    const seeded = gateBox({
      execution: execution(),
      task: { id: 'improvement-1', tenantId: 'tenant-a' },
      agentReportedFiles: [reportedMissing],
      testResults: { available: false, passed: null, commands: [] },
    });
    const kept: ChangeGateDraft = {
      id: '4430473640e43978ef272c8b5b9f591b3ca2b4e959255801ce52fbf59b82c3e0',
      tenantId: 'tenant-a',
      executionId: 'exec-1',
      improvementTaskId: 'improvement-1',
      status: 'GATED',
      gate: 'NEEDS_APPROVAL',
      changedFiles: [],
      addedFiles: [],
      modifiedFiles: [],
      deletedFiles: [],
      blockedFiles: [],
      riskFlags: [],
      riskLevel: 'LOW',
      riskReasons: ['AGENT_REPORTED_FILE_NOT_FOUND_IN_WORKSPACE'],
      testsPassed: null,
      testResults: { available: false, passed: null, commands: [], required: false },
      agentReportedFiles: [reportedMissing],
      discrepancy: true,
      discrepancyReasons: ['AGENT_REPORTED_FILE_NOT_FOUND_IN_WORKSPACE'],
      diffStat: { filesChanged: 0, additions: 0, deletions: 0, totalChangedLines: 0, largestChangedFile: null, files: [] },
      credentialDetected: false,
      credentialType: null,
      errorCode: null,
      provenance: { agentExecutionId: 'exec-1', improvementTaskId: 'improvement-1', workspaceRef: { type: 'PROJECT', ref: 'mock-aisle' } },
      createdAt: '2026-10-01T17:10:00.000Z',
      updatedAt: '2026-10-01T17:10:00.000Z',
    };
    seeded.rows.push(kept);
    const reused = await runChangeGateForExecution(command, seeded);
    assert.equal(reused.ok, true);
    if (!reused.ok) return;
    assert.equal(reused.created, false);
    assert.equal(reused.gate.id, kept.id);
    assert.equal(reused.gate.updatedAt, kept.updatedAt);
    assert.equal(seeded.scans, 0);
    assert.equal(seeded.rows.length, 1);

    const source = readFileSync(new URL('./improvement-change-gate.ts', import.meta.url), 'utf8');
    assert.equal(source.includes('runReviewBoardPipeline'), false);
    assert.equal(source.includes('change-gate-resolution'), false);
    assert.equal(source.includes('change-gate-rereview'), false);
    assert.equal(source.includes('juryDecisionCycle'), false);
    assert.equal(source.includes('child_process'), false);
  });

  it('connects a fake execution to the gate without approving a missing file', async () => {
    const work = task();
    const rows: AgentExecutionDraft[] = [];
    const handoff: HandoffWriteTx = {
      async findByTaskAndAgent(taskId, agent) {
        return rows.find((row) => row.taskId === taskId && row.agent === agent) ?? null;
      },
      async insert(row) {
        rows.push(row);
      },
      async audit() {},
    };
    const executionTx: ExecutionWriteTx = {
      async claimRunning(id, at) {
        const row = rows.find((item) => item.id === id);
        if (!row || row.status !== 'PENDING') return false;
        row.status = 'RUNNING';
        row.startedAt = at;
        row.updatedAt = at;
        return true;
      },
      async blockPending() {
        return false;
      },
      async completeRunning(id, resultRef, at) {
        const row = rows.find((item) => item.id === id);
        if (!row || row.status !== 'RUNNING') return false;
        row.status = 'COMPLETED';
        row.resultRef = resultRef;
        row.finishedAt = at;
        row.updatedAt = at;
        return true;
      },
      async failRunning() {
        return false;
      },
      async audit() {},
      async saveResult(artifact) {
        return `memory:${artifact.executionId}`;
      },
    };
    const adapter = fakeCursorAdapter();
    const ran = await executeImprovementTask(
      {
        userId: 'user-1',
        memberships: [owner],
        clientTenantId: 'forged-tenant',
        now: '2026-10-02T10:44:00.000Z',
        clock: () => '2026-10-02T10:44:01.000Z',
        timeoutMs: 1000,
        improvementTaskId: work.id,
      },
      { load: async () => work, handoff, execution: executionTx },
      adapter,
    );
    assert.equal(ran.ok, true);
    if (!ran.ok) return;
    assert.equal(ran.execution.status, 'COMPLETED');
    const box = gateBox({
      execution: ran.execution,
      task: { id: work.id, tenantId: work.tenantId },
      agentReportedFiles: [reportedMissing],
      testResults: { available: false, passed: null, commands: [] },
    });
    const gate = await runChangeGateForExecution({ ...command, executionId: ran.execution.id }, box);
    assert.equal(gate.ok, true);
    if (!gate.ok) return;
    assert.equal(gate.gate.status, 'GATED');
    assert.equal(gate.gate.discrepancy, true);
    assert.equal(ran.execution.status, 'COMPLETED');
    assert.equal(work.status, 'OPEN');
    assert.equal(adapter.calls.length, 1);
    assert.equal(box.resolutions.length, 0);
    assert.equal(box.reviews.length, 0);
  });
});
