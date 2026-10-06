/**
 * Console view of the existing auto-loop switch and loop-guard policy.
 * The only command is STOP. It does not enable the loop or start an agent.
 */
import { decideJuryMutation, type JuryActor } from './access';
import { containsSecret } from './agent-execution';
import { autoLoopExecutionMode, planAutoLoopActivation, type AutoLoopExecutionMode } from './auto-loop-activation';
import type { JuryMembership } from './records';

export type ConsoleLoopCycle = {
  id: string;
  status: string;
  iteration: number;
  verificationAttempts: number;
  sameDecisionCount: number;
  sameConflictCount: number;
  blockedReason: string | null;
};

export type ConsoleLoopPolicy = {
  maxIterations: number | null;
  maxVerificationAttempts: number | null;
  maxSameDecision: number | null;
  maxSameConflict: number | null;
  maxRuntimeMs: number | null;
  maxCostUsd: number | null;
};

export type ConsoleLoopScreen = {
  enabled: boolean;
  mode: AutoLoopExecutionMode;
  stopReason: string | null;
  policy: ConsoleLoopPolicy | null;
  cycles: ConsoleLoopCycle[];
};

export function projectConsoleLoop(input: {
  activation: { enabled: boolean; mode?: string | null } | null;
  policy: ConsoleLoopPolicy | null;
  cycles: readonly ConsoleLoopCycle[];
}): ConsoleLoopScreen {
  const mode = autoLoopExecutionMode(input.activation);
  const blocked = input.cycles.find((cycle) => cycle.status === 'BLOCKED' && cycle.blockedReason);
  const blockedReason = blocked?.blockedReason ? clean(blocked.blockedReason) : null;
  return {
    enabled: input.activation?.enabled === true,
    mode,
    stopReason: blockedReason ?? (mode === 'FULL_AUTO' ? null : mode === 'TASK_ONLY' ? 'TASK_ONLY' : 'AUTO_LOOP_DISABLED'),
    policy: input.policy,
    cycles: input.cycles.map((cycle) => ({
      ...cycle,
      id: clean(cycle.id) ?? 'REDACTED',
      blockedReason: clean(cycle.blockedReason),
    })),
  };
}

export function planConsoleLoopRead(
  actor: JuryActor,
): { ok: true; tenantId: string } | { ok: false; reason: 'FORBIDDEN' | 'STORE_UNAVAILABLE' } {
  if (!actor.ok) return { ok: false, reason: actor.reason === 'STORE_UNAVAILABLE' ? 'STORE_UNAVAILABLE' : 'FORBIDDEN' };
  const decision = decideJuryMutation({
    actor,
    action: 'console.read',
    resourceTenantId: actor.tenantId,
  });
  if (!decision.ok) return { ok: false, reason: 'FORBIDDEN' };
  return { ok: true, tenantId: actor.tenantId };
}

export function planConsoleLoopStop(input: {
  userId: string | null;
  memberships: readonly JuryMembership[];
  clientTenantId?: string | null;
  command: string;
  note?: string | null;
}):
  | { ok: true; tenantId: string; userId: string }
  | { ok: false; reason: 'FORBIDDEN' | 'TENANT_MISMATCH' | 'CREDENTIAL_IN_REASON' | 'INVALID_TRANSITION' } {
  const plan = planAutoLoopActivation(input);
  if (!plan.ok) return plan;
  if (input.command !== 'STOP') return { ok: false, reason: 'INVALID_TRANSITION' };
  return plan;
}

function clean(value: string | null): string | null {
  if (!value) return null;
  if (containsSecret(value)) return null;
  return value;
}
