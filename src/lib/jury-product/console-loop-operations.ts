/**
 * Console view of the existing auto-loop switch and loop-guard policy.
 * The only command is STOP. It does not enable the loop or start an agent.
 */
import { decideJuryMutation, type JuryActor } from './access';
import { containsSecret } from './agent-execution';
import { autoLoopExecutionMode, planAutoLoopActivation, type AutoLoopExecutionMode } from './auto-loop-activation';
import type { JuryMembership } from './records';
import { authorizeJuryServiceFeature } from './service-feature-authorization';
import type { ServiceGrantRow } from './service-member-management';

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

/**
 * Track B: cycle state comes from reviews. Roles without review.start do not read cycles.
 * Tenant enabled, mode, and policy stay on planConsoleLoopRead.
 */
export function canReadConsoleLoopCycles(actor: JuryActor): boolean {
  if (!actor.ok) return false;
  return decideJuryMutation({
    actor,
    action: 'review.start',
    resourceTenantId: actor.tenantId,
    clientTenantId: null,
  }).ok;
}

type ConsoleLoopCycleReview = {
  tenantId: string;
  request: { tenantId: string; connection: { id: string; tenantId: string } | null } | null;
} | null;

export type ConsoleLoopCycleSource = ConsoleLoopCycle & {
  tenantId: string;
  rootReviewResult: ConsoleLoopCycleReview;
  currentReviewResult: ConsoleLoopCycleReview;
};

/** Root and current review must reach one connection of this tenant. Anything else has no service. */
export function consoleLoopCycleConnection(
  cycle: ConsoleLoopCycleSource,
  tenantId: string,
): { id: string; tenantId: string } | null {
  if (cycle.tenantId !== tenantId) return null;
  const [root, current] = [cycle.rootReviewResult, cycle.currentReviewResult].map((review) => {
    const connection = review?.request?.connection;
    if (
      !review
      || review.tenantId !== tenantId
      || review.request?.tenantId !== tenantId
      || !connection
      || connection.tenantId !== tenantId
    ) return null;
    return connection;
  });
  if (!root || !current || root.id !== current.id) return null;
  return { id: root.id, tenantId: root.tenantId };
}

/** Keeps cycles whose service grants review.read to this actor. Relation fields are dropped. */
export function restrictConsoleLoopCycles(input: {
  actor: JuryActor;
  cycles: readonly ConsoleLoopCycleSource[];
  grants: readonly ServiceGrantRow[];
}): ConsoleLoopCycle[] {
  const actor = input.actor;
  if (!actor.ok || !canReadConsoleLoopCycles(actor)) return [];
  const membership = { tenantId: actor.tenantId, userId: actor.userId };
  return input.cycles.flatMap((cycle) => {
    const connection = consoleLoopCycleConnection(cycle, actor.tenantId);
    if (!connection) return [];
    const allowed = authorizeJuryServiceFeature({
      actor,
      membership,
      connection,
      grants: input.grants,
      feature: 'review.read',
    });
    if (!allowed.ok) return [];
    return [{
      id: cycle.id,
      status: cycle.status,
      iteration: cycle.iteration,
      verificationAttempts: cycle.verificationAttempts,
      sameDecisionCount: cycle.sameDecisionCount,
      sameConflictCount: cycle.sameConflictCount,
      blockedReason: cycle.blockedReason,
    }];
  });
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
