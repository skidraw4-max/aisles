/**
 * Resolves a GATED change-gate result without re-running the gate.
 * Run: node --import tsx --test src/lib/jury-product/change-gate-resolution.test.ts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import {
  resolveChangeGate,
  type GateResolutionDraft,
  type ResolutionAction,
  type ResolutionCommand,
  type ResolutionWriteTx,
} from './change-gate-resolution';
import type { JuryMembership } from './records';

const owner: JuryMembership = {
  id: 'mem-1',
  tenantId: 'tenant-a',
  userId: 'user-1',
  role: 'OWNER',
  createdAt: '2026-10-01T00:00:00.000Z',
};

function gate(partial?: Partial<NonNullable<ResolutionCommand['gate']>>): NonNullable<ResolutionCommand['gate']> {
  return {
    id: 'gate-1',
    tenantId: 'tenant-a',
    executionId: 'exec-1',
    improvementTaskId: 'task-1',
    status: 'GATED',
    changedFiles: ['notes/a.md'],
    blockedFiles: [],
    credentialDetected: false,
    riskLevel: 'LOW',
    discrepancy: false,
    workspaceRef: { type: 'PROJECT', ref: 'mock-aisle' },
    ...partial,
  };
}

function command(partial?: Partial<ResolutionCommand>): ResolutionCommand {
  return {
    userId: 'user-1',
    memberships: [owner],
    clientTenantId: 'forged-tenant',
    now: '2026-10-02T02:15:00.000Z',
    action: 'MANUAL_APPROVE',
    reason: { code: 'OWNER_CONFIRMED', message: 'The workspace change matches the task.' },
    gate: gate(),
    executionTenantId: 'tenant-a',
    taskTenantId: 'tenant-a',
    ...partial,
  };
}

function memory(status: 'GATED' | 'APPROVED' | 'BLOCKED' = 'GATED'): ResolutionWriteTx & {
  rows: GateResolutionDraft[];
  audits: string[];
  status: 'GATED' | 'APPROVED' | 'BLOCKED';
  updates: number;
} {
  const rows: GateResolutionDraft[] = [];
  const audits: string[] = [];
  const state = { status, updates: 0 };
  return {
    rows,
    audits,
    get status() {
      return state.status;
    },
    get updates() {
      return state.updates;
    },
    async findResolution(changeGateResultId, action, fingerprint) {
      return rows.find((row) => row.changeGateResultId === changeGateResultId && row.action === action && row.reasonFingerprint === fingerprint) ?? null;
    },
    async updateStatus(_id, from, to) {
      state.updates += 1;
      if (state.status !== from) return false;
      state.status = to;
      return true;
    },
    async insert(row) {
      rows.push(row);
    },
    async audit(action) {
      audits.push(action);
    },
  };
}

describe('change gate resolution', () => {
  it('approves a clean gated result and refuses the unsafe cases', async () => {
    const approved = memory();
    const ok = await resolveChangeGate(command(), approved);
    assert.equal(ok.ok, true);
    if (!ok.ok) return;
    assert.equal(ok.resolution.previousStatus, 'GATED');
    assert.equal(ok.status, 'APPROVED');
    assert.equal(approved.status, 'APPROVED');
    assert.deepEqual(approved.audits, ['CHANGE_GATE_RESOLUTION_CREATED', 'CHANGE_GATE_APPROVED']);
    const again = await resolveChangeGate(command({ gate: gate({ status: 'APPROVED' }) }), approved);
    assert.equal(again.ok, true);
    if (!again.ok) return;
    assert.equal(again.created, false);
    assert.equal(approved.rows.length, 1);

    const live = await resolveChangeGate(
      command({ gate: gate({ changedFiles: [], discrepancy: true, status: 'GATED' }) }),
      memory(),
    );
    assert.equal(live.ok, false);
    if (live.ok) return;
    assert.equal(live.reason, 'APPROVAL_CONDITION_NOT_MET');

    const empty = await resolveChangeGate(command({ gate: gate({ changedFiles: [], discrepancy: false }) }), memory());
    assert.equal(empty.ok, false);
    if (empty.ok) return;
    assert.equal(empty.reason, 'NO_ACTUAL_CHANGES');

    const blockedFile = await resolveChangeGate(
      command({ gate: gate({ blockedFiles: ['.env'], discrepancy: false }) }),
      memory(),
    );
    assert.equal(blockedFile.ok, false);
    if (blockedFile.ok) return;
    assert.equal(blockedFile.reason, 'BLOCKED_FILE_PRESENT');

    const secret = await resolveChangeGate(
      command({ gate: gate({ credentialDetected: true, discrepancy: false }) }),
      memory(),
    );
    assert.equal(secret.ok, false);
    if (secret.ok) return;
    assert.equal(secret.reason, 'CREDENTIAL_DETECTED');

    const high = await resolveChangeGate(
      command({ gate: gate({ riskLevel: 'HIGH', discrepancy: false }) }),
      memory(),
    );
    assert.equal(high.ok, false);
    if (high.ok) return;
    assert.equal(high.reason, 'HIGH_RISK_REQUIRES_BLOCK');
  });

  it('blocks or records a recheck without leaving GATED for a recheck', async () => {
    const blocked = memory();
    const block = await resolveChangeGate(
      command({
        action: 'MANUAL_BLOCK',
        reason: { code: 'AGENT_REPORT_MISMATCH', message: 'Agent reported file was not found in workspace.' },
        gate: gate({ changedFiles: [], discrepancy: true }),
      }),
      blocked,
    );
    assert.equal(block.ok, true);
    if (!block.ok) return;
    assert.equal(block.status, 'BLOCKED');
    assert.equal(blocked.status, 'BLOCKED');
    const repeat = await resolveChangeGate(
      command({
        action: 'MANUAL_BLOCK',
        reason: { code: 'AGENT_REPORT_MISMATCH', message: 'another' },
        gate: gate({ status: 'BLOCKED', changedFiles: [], discrepancy: true }),
      }),
      blocked,
    );
    assert.equal(repeat.ok, true);
    if (!repeat.ok) return;
    assert.equal(repeat.created, false);
    assert.equal(blocked.rows.length, 1);

    const recheckTx = memory();
    const reason = { code: 'WORKSPACE_RECHECK', message: 'Workspace should be populated and inspected again.' };
    const recheck = await resolveChangeGate(command({ action: 'RECHECK_REQUIRED', reason, gate: gate({ changedFiles: [], discrepancy: true }) }), recheckTx);
    const same = await resolveChangeGate(command({ action: 'RECHECK_REQUIRED', reason, gate: gate({ changedFiles: [], discrepancy: true }) }), recheckTx);
    assert.equal(recheck.ok && same.ok, true);
    if (!recheck.ok || !same.ok) return;
    assert.equal(recheck.status, 'GATED');
    assert.equal(recheckTx.status, 'GATED');
    assert.equal(same.created, false);
    assert.equal(same.resolution.id, recheck.resolution.id);
    assert.deepEqual(recheckTx.audits, ['CHANGE_GATE_RESOLUTION_CREATED', 'CHANGE_GATE_RECHECK_REQUIRED']);
  });

  it('refuses members, auditors, other tenants, and terminal reversals', async () => {
    const member = await resolveChangeGate(
      command({ memberships: [{ ...owner, role: 'DEVELOPER' }] }),
      memory(),
    );
    const auditor = await resolveChangeGate(
      command({ memberships: [{ ...owner, role: 'VIEWER' }] }),
      memory(),
    );
    assert.equal(member.ok, false);
    assert.equal(auditor.ok, false);
    if (member.ok || auditor.ok) return;
    assert.equal(member.reason, 'FORBIDDEN');
    assert.equal(auditor.reason, 'FORBIDDEN');

    const foreign = await resolveChangeGate(command({ executionTenantId: 'tenant-b' }), memory());
    assert.equal(foreign.ok, false);
    if (foreign.ok) return;
    assert.equal(foreign.reason, 'TENANT_MISMATCH');

    const reverse = await resolveChangeGate(
      command({ action: 'MANUAL_APPROVE', gate: gate({ status: 'BLOCKED' }) }),
      memory('BLOCKED'),
    );
    assert.equal(reverse.ok, false);
    if (reverse.ok) return;
    assert.equal(reverse.reason, 'INVALID_TRANSITION');
  });

  it('does not keep a credential or call the gate, an agent, or a re-review', async () => {
    const tx = memory();
    const result = await resolveChangeGate(
      command({
        action: 'MANUAL_BLOCK',
        reason: { code: 'SECRET', message: 'postgres://user:password@host/db' },
        gate: gate({ changedFiles: [], discrepancy: true }),
      }),
      tx,
    );
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.reason, 'CREDENTIAL_IN_REASON');
    assert.equal(tx.rows.length, 0);
    assert.equal(tx.updates, 0);
    const source = readFileSync(new URL('./change-gate-resolution.ts', import.meta.url), 'utf8');
    const store = readFileSync(new URL('./change-gate-resolution-store.ts', import.meta.url), 'utf8');
    for (const text of [source, store]) {
      assert.equal(text.includes('writeFile'), false);
      assert.equal(text.includes('runReviewBoardPipeline'), false);
      assert.equal(text.includes('persistAgentExecution'), false);
      assert.equal(text.includes('evaluateChangeGate'), false);
      assert.equal(text.includes('child_process'), false);
    }
    const action: ResolutionAction = 'RECHECK_REQUIRED';
    assert.equal(action, 'RECHECK_REQUIRED');
  });
});
