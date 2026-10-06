/**
 * Change Gate trusts the workspace, not the agent report.
 * Run: node --import tsx --test src/lib/jury-product/change-gate.test.ts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { evaluateChangeGate, type ChangeGateCommand, type ChangeGateDraft, type ChangeGateWriteTx } from './change-gate';
import type { JuryMembership } from './records';

const owner: JuryMembership = {
  id: 'mem-1',
  tenantId: 'tenant-a',
  userId: 'user-1',
  role: 'OWNER',
  createdAt: '2026-10-01T00:00:00.000Z',
};

const reported = ['workspace/mock-aisle/user-facing-copy.ts'];

function command(partial?: Partial<ChangeGateCommand>): ChangeGateCommand {
  return {
    userId: 'user-1',
    memberships: [owner],
    clientTenantId: 'forged-tenant',
    now: '2026-10-02T02:04:00.000Z',
    execution: {
      id: 'exec-1',
      tenantId: 'tenant-a',
      taskId: 'task-1',
      status: 'COMPLETED',
      workspaceRef: { type: 'PROJECT', ref: 'mock-aisle' },
      provenance: { reviewResultId: 'review-1', decisionTaskId: 'decision-1', evidenceId: 'ev-1' },
    },
    task: { id: 'task-1', tenantId: 'tenant-a' },
    agentReportedFiles: reported,
    testResults: { available: false, passed: null, commands: [] },
    inspection: { files: [], present: [] },
    ...partial,
  };
}

function memory(): ChangeGateWriteTx & { rows: ChangeGateDraft[]; audits: string[] } {
  const rows: ChangeGateDraft[] = [];
  const audits: string[] = [];
  return {
    rows,
    audits,
    async findByExecution(executionId) {
      return rows.find((row) => row.executionId === executionId) ?? null;
    },
    async insert(row) {
      rows.push(row);
    },
    async audit(action) {
      audits.push(action);
    },
  };
}

describe('change gate', () => {
  it('keeps an agent-only file as GATED with an empty workspace', async () => {
    const tx = memory();
    const first = await evaluateChangeGate(command(), tx);
    const second = await evaluateChangeGate(command(), tx);
    assert.equal(first.ok && second.ok, true);
    if (!first.ok || !second.ok) return;
    assert.equal(first.created, true);
    assert.equal(second.created, false);
    assert.equal(second.gate.id, first.gate.id);
    assert.equal(first.gate.status, 'GATED');
    assert.equal(first.gate.gate, 'NEEDS_APPROVAL');
    assert.deepEqual(first.gate.changedFiles, []);
    assert.deepEqual(first.gate.addedFiles, []);
    assert.deepEqual(first.gate.modifiedFiles, []);
    assert.deepEqual(first.gate.deletedFiles, []);
    assert.deepEqual(first.gate.agentReportedFiles, reported);
    assert.equal(first.gate.discrepancy, true);
    assert.deepEqual(first.gate.discrepancyReasons, ['AGENT_REPORTED_FILE_NOT_FOUND_IN_WORKSPACE']);
    assert.equal(first.gate.riskLevel, 'LOW');
    assert.equal(first.gate.diffStat.filesChanged, 0);
    assert.equal(first.gate.diffStat.totalChangedLines, 0);
    assert.equal(first.gate.credentialDetected, false);
    assert.equal(first.gate.testResults.available, false);
    assert.equal(first.gate.testResults.passed, null);
    assert.notEqual(first.gate.testsPassed, true);
    assert.deepEqual(tx.audits, ['CHANGE_GATE_STARTED', 'CHANGE_GATE_COMPLETED']);
    assert.equal(tx.rows.length, 1);
  });

  it('uses added, modified, and deleted workspace files as the change set', async () => {
    const tx = memory();
    const result = await evaluateChangeGate(
      command({
        agentReportedFiles: ['notes/a.md', 'notes/b.md', 'notes/c.md'],
        inspection: {
          present: ['notes/a.md', 'notes/b.md'],
          files: [
            { path: 'notes/a.md', kind: 'added', additions: 2, deletions: 0 },
            { path: 'notes/b.md', kind: 'modified', additions: 1, deletions: 1 },
            { path: 'notes/c.md', kind: 'deleted', additions: 0, deletions: 3 },
          ],
        },
      }),
      tx,
    );
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.gate.status, 'APPROVED');
    assert.deepEqual(result.gate.addedFiles, ['notes/a.md']);
    assert.deepEqual(result.gate.modifiedFiles, ['notes/b.md']);
    assert.deepEqual(result.gate.deletedFiles, ['notes/c.md']);
    assert.deepEqual(result.gate.changedFiles, ['notes/a.md', 'notes/b.md', 'notes/c.md']);
    assert.equal(result.gate.discrepancy, false);
    assert.equal(result.gate.riskLevel, 'LOW');
    assert.equal(result.gate.diffStat.filesChanged, 3);
    assert.equal(result.gate.diffStat.additions, 3);
    assert.equal(result.gate.diffStat.deletions, 4);
    assert.equal(result.gate.diffStat.totalChangedLines, 7);
    assert.equal(result.gate.diffStat.largestChangedFile, 'notes/c.md');
    assert.equal(result.gate.testsPassed, null);
  });

  it('blocks a foreign tenant, a bad workspace, path escape, v9, env, and a secret', async () => {
    const foreign = await evaluateChangeGate(
      command({ execution: { ...command().execution!, tenantId: 'tenant-b' } }),
      memory(),
    );
    assert.equal(foreign.ok, false);
    if (foreign.ok) return;
    assert.equal(foreign.reason, 'TENANT_MISMATCH');

    const workspace = await evaluateChangeGate(
      command({ execution: { ...command().execution!, workspaceRef: { type: 'PROJECT', ref: 'other-app' } } }),
      memory(),
    );
    assert.equal(workspace.ok, true);
    if (!workspace.ok) return;
    assert.equal(workspace.gate.status, 'BLOCKED');
    assert.equal(workspace.gate.errorCode, 'WORKSPACE_NOT_ALLOWED');

    const escape = await evaluateChangeGate(command({ agentReportedFiles: ['../../.env'] }), memory());
    assert.equal(escape.ok, true);
    if (!escape.ok) return;
    assert.equal(escape.gate.status, 'BLOCKED');
    assert.equal(escape.gate.discrepancyReasons.includes('PATH_ESCAPE'), true);

    const core = await evaluateChangeGate(
      command({
        agentReportedFiles: ['src/lib/ai-review-board/compare.ts'],
        inspection: {
          present: ['src/lib/ai-review-board/compare.ts'],
          files: [{ path: 'src/lib/ai-review-board/compare.ts', kind: 'modified', additions: 1, deletions: 0 }],
        },
      }),
      memory(),
    );
    assert.equal(core.ok, true);
    if (!core.ok) return;
    assert.equal(core.gate.status, 'BLOCKED');
    assert.equal(core.gate.riskLevel, 'CRITICAL');

    const env = await evaluateChangeGate(
      command({
        agentReportedFiles: ['.env'],
        inspection: { present: ['.env'], files: [{ path: '.env', kind: 'modified', additions: 1, deletions: 0 }] },
      }),
      memory(),
    );
    assert.equal(env.ok, true);
    if (!env.ok) return;
    assert.equal(env.gate.status, 'BLOCKED');
    assert.equal(env.gate.riskFlags.includes('HIGH_RISK_FILE'), true);

    const secret = await evaluateChangeGate(
      command({
        agentReportedFiles: ['notes/a.md'],
        inspection: {
          present: ['notes/a.md'],
          files: [{ path: 'notes/a.md', kind: 'modified', additions: 1, deletions: 0, patch: 'key = sk-live-SHOULDNOTSTORE' }],
        },
      }),
      memory(),
    );
    assert.equal(secret.ok, true);
    if (!secret.ok) return;
    assert.equal(secret.gate.status, 'BLOCKED');
    assert.equal(secret.gate.credentialDetected, true);
    assert.equal(secret.gate.credentialType, 'API_KEY');
    assert.equal(JSON.stringify(secret.gate).includes('SHOULDNOTSTORE'), false);
    assert.equal(secret.gate.riskLevel, 'CRITICAL');
  });

  it('does not write, re-review, or loop from the gate', () => {
    const source = readFileSync(new URL('./change-gate.ts', import.meta.url), 'utf8');
    const workspace = readFileSync(new URL('./change-gate-workspace.ts', import.meta.url), 'utf8');
    assert.equal(source.includes('writeFile'), false);
    assert.equal(source.includes('runReviewBoardPipeline'), false);
    assert.equal(source.includes('persistAgentExecution'), false);
    assert.equal(source.includes('git commit'), false);
    assert.equal(source.includes('git push'), false);
    assert.equal(workspace.includes('git commit'), false);
    assert.equal(workspace.includes('git push'), false);
    assert.equal(workspace.includes('reset --hard'), false);
    assert.equal(workspace.includes('git clean'), false);
  });
});
