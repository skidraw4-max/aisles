/**
 * Decides what to do with a GATED change-gate result.
 * It does not re-run the gate, start an agent, or change workspace files.
 */
import { createHash } from 'node:crypto';
import { parseWorkspaceRef } from './agent-handoff';
import { decideJuryMutation, resolveJuryActor } from './access';
import { resolveAllowedWorkspace } from './agent-workspace';
import type { JuryMembership } from './records';

export const RESOLUTION_ACTIONS = ['RECHECK_REQUIRED', 'MANUAL_APPROVE', 'MANUAL_BLOCK'] as const;
export type ResolutionAction = (typeof RESOLUTION_ACTIONS)[number];

const TERMINAL_FINGERPRINT = 'terminal';

export type ResolutionReason = {
  code: string;
  message: string;
};

export type GateResolutionDraft = {
  id: string;
  tenantId: string;
  changeGateResultId: string;
  agentExecutionId: string;
  improvementTaskId: string;
  action: ResolutionAction;
  previousStatus: 'GATED' | 'APPROVED' | 'BLOCKED';
  resultingStatus: 'GATED' | 'APPROVED' | 'BLOCKED';
  reason: ResolutionReason;
  reasonFingerprint: string;
  resolvedBy: string;
  resolvedAt: string;
  provenance: {
    changeGateResultId: string;
    agentExecutionId: string;
    improvementTaskId: string;
    action: ResolutionAction;
  };
  createdAt: string;
};

export type ResolutionCommand = {
  userId: string | null;
  memberships: readonly JuryMembership[];
  clientTenantId?: string | null;
  now: string;
  action: string;
  reason: { code?: unknown; message?: unknown } | null;
  gate: {
    id: string;
    tenantId: string;
    executionId: string;
    improvementTaskId: string;
    status: 'GATED' | 'APPROVED' | 'BLOCKED';
    changedFiles: string[];
    blockedFiles: string[];
    credentialDetected: boolean;
    riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    discrepancy: boolean;
    workspaceRef: unknown;
  } | null;
  executionTenantId: string | null;
  taskTenantId: string | null;
};

export type ResolutionFailure =
  | 'UNAUTHENTICATED'
  | 'NO_MEMBERSHIP'
  | 'AMBIGUOUS_MEMBERSHIP'
  | 'STORE_UNAVAILABLE'
  | 'FORBIDDEN'
  | 'TENANT_MISMATCH'
  | 'GATE_NOT_FOUND'
  | 'REASON_REQUIRED'
  | 'CREDENTIAL_IN_REASON'
  | 'INVALID_TRANSITION'
  | 'ALREADY_RESOLVED'
  | 'APPROVAL_CONDITION_NOT_MET'
  | 'NO_ACTUAL_CHANGES'
  | 'BLOCKED_FILE_PRESENT'
  | 'CREDENTIAL_DETECTED'
  | 'HIGH_RISK_REQUIRES_BLOCK';

export type ResolutionWriteTx = {
  findResolution(changeGateResultId: string, action: ResolutionAction, fingerprint: string): Promise<GateResolutionDraft | null>;
  updateStatus(changeGateResultId: string, from: 'GATED', to: 'APPROVED' | 'BLOCKED'): Promise<boolean>;
  insert(row: GateResolutionDraft): Promise<void>;
  audit(
    action: 'CHANGE_GATE_RESOLUTION_CREATED' | 'CHANGE_GATE_APPROVED' | 'CHANGE_GATE_BLOCKED' | 'CHANGE_GATE_RECHECK_REQUIRED',
    row: GateResolutionDraft,
  ): Promise<void>;
};

function hasSecret(value: unknown): boolean {
  const text = JSON.stringify(value) ?? '';
  const lower = text.toLowerCase();
  return (
    lower.includes('credentialref') ||
    lower.includes('private_key') ||
    lower.includes('begin private') ||
    lower.includes('postgres://') ||
    lower.includes('password') ||
    lower.includes('access_token') ||
    lower.includes('api_key') ||
    /\bsk-[a-z0-9]/i.test(text)
  );
}

function reasonFingerprint(action: ResolutionAction, reason: ResolutionReason): string {
  if (action !== 'RECHECK_REQUIRED') return TERMINAL_FINGERPRINT;
  return createHash('sha256').update([reason.code, reason.message].join('\n')).digest('hex');
}

function parseReason(value: ResolutionCommand['reason']): ResolutionReason | null {
  if (!value || typeof value.code !== 'string' || typeof value.message !== 'string') return null;
  const code = value.code.trim();
  const message = value.message.trim();
  if (!/^[A-Z0-9_]{1,64}$/.test(code) || message.length === 0 || message.length > 500) return null;
  return { code, message };
}

export async function resolveChangeGate(
  command: ResolutionCommand,
  tx: ResolutionWriteTx,
): Promise<
  | { ok: false; reason: ResolutionFailure }
  | { ok: true; created: boolean; resolution: GateResolutionDraft; status: GateResolutionDraft['resultingStatus'] }
> {
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
  if (!RESOLUTION_ACTIONS.includes(command.action as ResolutionAction)) return { ok: false, reason: 'INVALID_TRANSITION' };
  const action = command.action as ResolutionAction;
  const gate = command.gate;
  if (!gate) return { ok: false, reason: 'GATE_NOT_FOUND' };
  if (gate.tenantId !== actor.tenantId || command.executionTenantId !== actor.tenantId || command.taskTenantId !== actor.tenantId) {
    return { ok: false, reason: 'TENANT_MISMATCH' };
  }
  const reason = parseReason(command.reason);
  if (!reason) return { ok: false, reason: 'REASON_REQUIRED' };
  if (hasSecret(reason)) return { ok: false, reason: 'CREDENTIAL_IN_REASON' };

  const fingerprint = reasonFingerprint(action, reason);
  if (action === 'MANUAL_APPROVE' && gate.status === 'APPROVED') return existingOrResolved(gate.id, action, tx);
  if (action === 'MANUAL_BLOCK' && gate.status === 'BLOCKED') return existingOrResolved(gate.id, action, tx);
  if (gate.status !== 'GATED') return { ok: false, reason: 'INVALID_TRANSITION' };
  if (action === 'MANUAL_APPROVE') {
    const refused = approvalRefusal(gate);
    if (refused) return { ok: false, reason: refused };
  }
  if (action !== 'RECHECK_REQUIRED') {
    const next = action === 'MANUAL_APPROVE' ? 'APPROVED' : 'BLOCKED';
    const updated = await tx.updateStatus(gate.id, 'GATED', next);
    if (!updated) return { ok: false, reason: 'INVALID_TRANSITION' };
  } else {
    const existing = await tx.findResolution(gate.id, action, fingerprint);
    if (existing) {
      if (existing.tenantId !== actor.tenantId) return { ok: false, reason: 'TENANT_MISMATCH' };
      return { ok: true, created: false, resolution: existing, status: 'GATED' };
    }
  }

  const resultingStatus = action === 'MANUAL_APPROVE' ? 'APPROVED' : action === 'MANUAL_BLOCK' ? 'BLOCKED' : 'GATED';
  const row: GateResolutionDraft = {
    id: createHash('sha256').update([actor.tenantId, gate.id, action, fingerprint].join('\n')).digest('hex'),
    tenantId: actor.tenantId,
    changeGateResultId: gate.id,
    agentExecutionId: gate.executionId,
    improvementTaskId: gate.improvementTaskId,
    action,
    previousStatus: 'GATED',
    resultingStatus,
    reason,
    reasonFingerprint: fingerprint,
    resolvedBy: actor.userId,
    resolvedAt: command.now,
    provenance: {
      changeGateResultId: gate.id,
      agentExecutionId: gate.executionId,
      improvementTaskId: gate.improvementTaskId,
      action,
    },
    createdAt: command.now,
  };
  await tx.insert(row);
  await tx.audit('CHANGE_GATE_RESOLUTION_CREATED', row);
  if (action === 'MANUAL_APPROVE') await tx.audit('CHANGE_GATE_APPROVED', row);
  if (action === 'MANUAL_BLOCK') await tx.audit('CHANGE_GATE_BLOCKED', row);
  if (action === 'RECHECK_REQUIRED') await tx.audit('CHANGE_GATE_RECHECK_REQUIRED', row);
  return { ok: true, created: true, resolution: row, status: resultingStatus };
}

function approvalRefusal(gate: NonNullable<ResolutionCommand['gate']>): ResolutionFailure | null {
  if (gate.discrepancy) return 'APPROVAL_CONDITION_NOT_MET';
  if (gate.changedFiles.length === 0) return 'NO_ACTUAL_CHANGES';
  if (gate.blockedFiles.length > 0) return 'BLOCKED_FILE_PRESENT';
  if (gate.credentialDetected) return 'CREDENTIAL_DETECTED';
  if (gate.riskLevel === 'HIGH' || gate.riskLevel === 'CRITICAL') return 'HIGH_RISK_REQUIRES_BLOCK';
  const workspace = parseWorkspaceRef(gate.workspaceRef);
  if (!workspace || !resolveAllowedWorkspace(workspace)) return 'APPROVAL_CONDITION_NOT_MET';
  return null;
}

async function existingOrResolved(
  gateId: string,
  action: 'MANUAL_APPROVE' | 'MANUAL_BLOCK',
  tx: ResolutionWriteTx,
): Promise<
  | { ok: false; reason: 'ALREADY_RESOLVED' }
  | { ok: true; created: false; resolution: GateResolutionDraft; status: 'APPROVED' | 'BLOCKED' }
> {
  const existing = await tx.findResolution(gateId, action, TERMINAL_FINGERPRINT);
  if (!existing) return { ok: false, reason: 'ALREADY_RESOLVED' };
  return { ok: true, created: false, resolution: existing, status: action === 'MANUAL_APPROVE' ? 'APPROVED' : 'BLOCKED' };
}
