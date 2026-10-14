/**
 * Runs the existing change gate for one completed agent execution.
 * It does not resolve the gate, re-review, or call the review core.
 */
import { parseWorkspaceRef } from './agent-handoff';
import { decideJuryMutation, resolveJuryActor } from './access';
import { resolveAllowedWorkspace } from './agent-workspace';
import {
  evaluateChangeGate,
  type ChangeGateCommand,
  type ChangeGateWriteTx,
  type ChangeInspection,
} from './change-gate';
import type { JuryMembership } from './records';

export type ChangeGateRunLoad = {
  execution: ChangeGateCommand['execution'];
  task: { id: string; tenantId: string } | null;
  agentReportedFiles: string[];
  testResults: { available: boolean; passed: boolean | null; commands: string[] };
};

export async function runChangeGateForExecution(
  command: {
    userId: string | null;
    memberships: readonly JuryMembership[];
    clientTenantId?: string | null;
    now: string;
    executionId: string;
  },
  io: {
    load(executionId: string): Promise<ChangeGateRunLoad | null>;
    inspect(workspaceRoot: string): Promise<ChangeInspection>;
    gate: ChangeGateWriteTx;
  },
): Promise<Awaited<ReturnType<typeof evaluateChangeGate>>> {
  void command.clientTenantId;
  const actor = resolveJuryActor({
    userId: command.userId,
    memberships: command.memberships,
    clientTenantId: command.clientTenantId,
  });
  if (!actor.ok) return actor;
  const allowed = decideJuryMutation({
    actor,
    action: 'agent.execute',
    resourceTenantId: actor.tenantId,
    clientTenantId: command.clientTenantId,
  });
  if (!allowed.ok) {
    if (allowed.reason === 'TENANT_MISMATCH') return { ok: false, reason: 'TENANT_MISMATCH' };
    return { ok: false, reason: allowed.reason };
  }

  const loaded = await io.load(command.executionId);
  if (!loaded?.execution) return { ok: false, reason: 'EXECUTION_NOT_FOUND' };
  if (loaded.execution.tenantId !== actor.tenantId || loaded.task?.tenantId !== actor.tenantId) {
    return { ok: false, reason: 'TENANT_MISMATCH' };
  }
  const existing = await io.gate.findByExecution(loaded.execution.id);
  if (existing) {
    if (existing.tenantId !== actor.tenantId) return { ok: false, reason: 'TENANT_MISMATCH' };
    return { ok: true, created: false, gate: existing };
  }
  if (loaded.execution.status !== 'COMPLETED') return { ok: false, reason: 'EXECUTION_NOT_COMPLETED' };

  const workspace = parseWorkspaceRef(loaded.execution.workspaceRef);
  const workspaceRoot = workspace ? resolveAllowedWorkspace(workspace) : null;
  const inspection = workspaceRoot ? await io.inspect(workspaceRoot) : null;
  return evaluateChangeGate(
    {
      userId: command.userId,
      memberships: command.memberships,
      clientTenantId: command.clientTenantId,
      now: command.now,
      execution: loaded.execution,
      task: loaded.task,
      agentReportedFiles: loaded.agentReportedFiles,
      testResults: loaded.testResults,
      inspection,
    },
    io.gate,
  );
}
