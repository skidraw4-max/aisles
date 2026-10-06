/**
 * Decides whether a tenant may enter the auto loop.
 * A loop-guard policy does not turn the loop on.
 */
import { decideJuryMutation, resolveJuryActor } from './access';
import { containsSecret } from './agent-execution';
import type { AutoLoopResult, AutoLoopStop } from './improvement-auto-loop';
import type { JuryMembership } from './records';

export const AUTO_LOOP_EXECUTION_MODES = ['OFF', 'TASK_ONLY', 'FULL_AUTO'] as const;
export type AutoLoopExecutionMode = (typeof AUTO_LOOP_EXECUTION_MODES)[number];

export function canonicalAutoLoopMode(value: unknown): AutoLoopExecutionMode {
  if (value === 'TASK_ONLY' || value === 'FULL_AUTO' || value === 'OFF') return value;
  return 'OFF';
}

export function autoLoopExecutionMode(
  activation: { enabled: boolean; mode?: string | null } | null,
): 'OFF' | 'TASK_ONLY' | 'FULL_AUTO' {
  if (!autoLoopIsEnabled(activation)) return 'OFF';
  return canonicalAutoLoopMode(activation?.mode);
}

export type AutoLoopEntryStop = AutoLoopStop | 'AUTO_LOOP_DISABLED' | 'TASK_ONLY';

export type AutoLoopEntryResult = Omit<AutoLoopResult, 'stop'> & { stop: AutoLoopEntryStop };

export function autoLoopIsEnabled(activation: { enabled: boolean } | null, policy?: unknown): boolean {
  void policy;
  return activation?.enabled === true;
}

export function planAutoLoopActivation(input: {
  userId: string | null;
  memberships: readonly JuryMembership[];
  clientTenantId?: string | null;
  note?: string | null;
}): { ok: true; tenantId: string; userId: string } | { ok: false; reason: 'FORBIDDEN' | 'TENANT_MISMATCH' | 'CREDENTIAL_IN_REASON' } {
  if (containsSecret({ note: input.note ?? null })) return { ok: false, reason: 'CREDENTIAL_IN_REASON' };
  const actor = resolveJuryActor({
    userId: input.userId,
    memberships: input.memberships,
    clientTenantId: input.clientTenantId,
  });
  if (!actor.ok) return { ok: false, reason: 'FORBIDDEN' };
  if (input.clientTenantId && input.clientTenantId !== actor.tenantId) {
    return { ok: false, reason: 'TENANT_MISMATCH' };
  }
  const allowed = decideJuryMutation({
    actor,
    action: 'automation.write',
    resourceTenantId: actor.tenantId,
    clientTenantId: input.clientTenantId,
  });
  if (!allowed.ok) return { ok: false, reason: allowed.reason === 'TENANT_MISMATCH' ? 'TENANT_MISMATCH' : 'FORBIDDEN' };
  return { ok: true, tenantId: actor.tenantId, userId: actor.userId };
}

export function autoLoopEntry(stop: AutoLoopEntryStop, reviewResultId: string): AutoLoopEntryResult {
  return {
    ok: false,
    stop,
    reviewResultId,
    decisionSteps: 0,
    agentRuns: 0,
    gateRuns: 0,
    rereviewRuns: 0,
    coreRuns: 0,
    guardReasons: [],
  };
}
