/**
 * Product decision-cycle loop guard.
 * null disables one limit. It does not start an agent or call the review core.
 */
import { createHash } from 'node:crypto';
import { decideJuryMutation, resolveJuryActor } from './access';
import type { JuryDecision, JuryMembership } from './records';

export type ProductLoopGuardPolicy = {
  maxIterations: number | null;
  maxVerificationAttempts: number | null;
  maxSameDecision: number | null;
  maxSameConflict: number | null;
  maxRuntimeMs: number | null;
  maxCostUsd: number | null;
};

/** Used only when a tenant has no stored product policy. Explicit nulls stay disabled. */
export const PRODUCT_LOOP_GUARD_DEFAULTS: ProductLoopGuardPolicy = {
  maxIterations: 5,
  maxVerificationAttempts: 2,
  maxSameDecision: 3,
  maxSameConflict: 2,
  maxRuntimeMs: 1_800_000,
  maxCostUsd: 1,
};

export type GuardReason =
  | 'ALLOWED'
  | 'MAX_ITERATIONS'
  | 'MAX_VERIFICATION_ATTEMPTS'
  | 'MAX_SAME_DECISION'
  | 'MAX_SAME_CONFLICT'
  | 'MAX_RUNTIME'
  | 'MAX_COST';

export type CycleReviewNode = {
  id: string;
  tenantId: string;
  evidenceIdentity: string;
  decision: JuryDecision;
  conflictDetected: boolean;
  overclaimDetected: boolean;
  revisionRequired: boolean;
  parentReviewResultId: string | null;
  verificationResultId: string | null;
  completedAt: string;
};

export type DecisionCycleDraft = {
  id: string;
  tenantId: string;
  rootReviewResultId: string;
  currentReviewResultId: string;
  iteration: number;
  verificationAttempts: number;
  sameDecisionCount: number;
  sameConflictCount: number;
  decisionFingerprint: string;
  conflictFingerprint: string;
  status: 'ACTIVE' | 'COMPLETED' | 'BLOCKED' | 'FAILED' | 'CANCELLED';
  blockedReason: Exclude<GuardReason, 'ALLOWED'> | null;
  policyId: string;
  startedAt: string;
  updatedAt: string;
};

export type DecisionCycleWriteTx = {
  loadChain(rootReviewResultId: string): Promise<CycleReviewNode[] | null>;
  findPolicy(tenantId: string): Promise<{ id: string; policy: ProductLoopGuardPolicy } | null>;
  insertPolicy(tenantId: string, policy: ProductLoopGuardPolicy): Promise<string>;
  findCycle(rootReviewResultId: string): Promise<DecisionCycleDraft | null>;
  insertCycle(cycle: DecisionCycleDraft): Promise<void>;
  audit(action: 'DECISION_CYCLE_CREATED' | 'LOOP_GUARD_BLOCKED', reason: GuardReason | null): Promise<void>;
};

function sha(parts: readonly string[]): string {
  return createHash('sha256').update(parts.join('\n')).digest('hex');
}

export function conflictFingerprint(input: {
  conflictDetected: boolean;
  overclaimDetected: boolean;
  revisionRequired: boolean;
  evidenceIdentity: string;
}): string {
  return sha([
    String(input.conflictDetected),
    String(input.overclaimDetected),
    String(input.revisionRequired),
    input.evidenceIdentity,
  ]);
}

export function decisionFingerprint(input: {
  decision: string;
  conflictDetected: boolean;
  overclaimDetected: boolean;
  revisionRequired: boolean;
  evidenceIdentity: string;
  verificationLineage: string;
}): string {
  return sha([
    input.decision,
    String(input.conflictDetected),
    String(input.overclaimDetected),
    String(input.revisionRequired),
    input.evidenceIdentity,
    input.verificationLineage,
  ]);
}

function ordered(reviews: readonly CycleReviewNode[]): CycleReviewNode[] {
  const root = reviews.find((review) => review.parentReviewResultId === null);
  if (!root) return [];
  const chain = [root];
  const seen = new Set([root.id]);
  let cursor = root;
  while (chain.length <= reviews.length) {
    const child = reviews.find((review) => review.parentReviewResultId === cursor.id && !seen.has(review.id));
    if (!child) break;
    seen.add(child.id);
    chain.push(child);
    cursor = child;
  }
  return chain;
}

export function foldDecisionCycle(reviews: readonly CycleReviewNode[]): {
  iteration: number;
  verificationAttempts: number;
  sameDecisionCount: number;
  sameConflictCount: number;
  decisionFingerprint: string;
  conflictFingerprint: string;
  currentReviewResultId: string;
  startedAt: string;
} {
  const chain = ordered(reviews);
  let sameDecisionCount = 0;
  let sameConflictCount = 0;
  let previousDecision: JuryDecision | null = null;
  let previousConflict: string | null = null;
  const verificationIds = new Set<string>();
  for (const [index, review] of chain.entries()) {
    if (review.verificationResultId) verificationIds.add(review.verificationResultId);
    sameDecisionCount = review.decision === previousDecision ? sameDecisionCount + 1 : 1;
    previousDecision = review.decision;
    if (!review.conflictDetected) {
      sameConflictCount = 0;
      previousConflict = null;
      continue;
    }
    const fingerprint = conflictFingerprint(review);
    sameConflictCount = fingerprint === previousConflict ? sameConflictCount + 1 : 1;
    previousConflict = fingerprint;
    void index;
  }
  const current = chain[chain.length - 1];
  const lineage = [chain[0]?.id ?? 'none', ...chain.map((review) => review.verificationResultId ?? 'none')].join('>');
  return {
    iteration: chain.length,
    verificationAttempts: verificationIds.size,
    sameDecisionCount,
    sameConflictCount,
    decisionFingerprint: current
      ? decisionFingerprint({ ...current, verificationLineage: lineage })
      : decisionFingerprint({
          decision: 'VERIFY',
          conflictDetected: false,
          overclaimDetected: false,
          revisionRequired: false,
          evidenceIdentity: 'none',
          verificationLineage: 'none',
        }),
    conflictFingerprint: current
      ? conflictFingerprint(current)
      : conflictFingerprint({
          conflictDetected: false,
          overclaimDetected: false,
          revisionRequired: false,
          evidenceIdentity: 'none',
        }),
    currentReviewResultId: current?.id ?? '',
    startedAt: chain[0]?.completedAt ?? '',
  };
}

export function evaluateLoopGuard(input: {
  policy: ProductLoopGuardPolicy;
  iteration: number;
  verificationAttempts: number;
  sameDecisionCount: number;
  sameConflictCount: number;
  runtimeMs: number | null;
  costUsd: number | null;
}): {
  allowed: boolean;
  reason: GuardReason;
  counters: {
    iteration: number;
    verificationAttempts: number;
    sameDecisionCount: number;
    sameConflictCount: number;
    runtimeMs: number | null;
    costUsd: number | null;
  };
  policy: ProductLoopGuardPolicy;
} {
  const counters = {
    iteration: input.iteration,
    verificationAttempts: input.verificationAttempts,
    sameDecisionCount: input.sameDecisionCount,
    sameConflictCount: input.sameConflictCount,
    runtimeMs: input.runtimeMs,
    costUsd: input.costUsd,
  };
  const { policy } = input;
  // Iterations block when the count reaches the limit. Same-conflict blocks only after the limit is exceeded,
  // so two VERIFY conflicts remain inside maxSameConflict 2.
  const checks: Array<[GuardReason, boolean]> = [
    ['MAX_ITERATIONS', policy.maxIterations !== null && input.iteration >= policy.maxIterations],
    ['MAX_VERIFICATION_ATTEMPTS', policy.maxVerificationAttempts !== null && input.verificationAttempts >= policy.maxVerificationAttempts],
    ['MAX_SAME_DECISION', policy.maxSameDecision !== null && input.sameDecisionCount >= policy.maxSameDecision],
    ['MAX_SAME_CONFLICT', policy.maxSameConflict !== null && input.sameConflictCount > policy.maxSameConflict],
    ['MAX_RUNTIME', policy.maxRuntimeMs !== null && input.runtimeMs !== null && input.runtimeMs >= policy.maxRuntimeMs],
    ['MAX_COST', policy.maxCostUsd !== null && input.costUsd !== null && input.costUsd >= policy.maxCostUsd],
  ];
  const hit = checks.find(([, failed]) => failed);
  const reason = hit?.[0] ?? 'ALLOWED';
  return { allowed: reason === 'ALLOWED', reason, counters, policy };
}

export async function recordDecisionCycle(
  command: {
    userId: string | null;
    memberships: readonly JuryMembership[];
    clientTenantId?: string | null;
    now: string;
    rootReviewResultId: string;
  },
  tx: DecisionCycleWriteTx,
): Promise<
  | {
      ok: false;
      reason:
        | 'UNAUTHENTICATED'
        | 'NO_MEMBERSHIP'
        | 'AMBIGUOUS_MEMBERSHIP'
        | 'STORE_UNAVAILABLE'
        | 'FORBIDDEN'
        | 'TENANT_MISMATCH'
        | 'CYCLE_NOT_FOUND';
    }
  | { ok: true; created: boolean; cycle: DecisionCycleDraft; guard: ReturnType<typeof evaluateLoopGuard> }
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
    action: 'review.start',
    resourceTenantId: actor.tenantId,
    clientTenantId: command.clientTenantId,
  });
  if (!allowed.ok) return allowed;

  const existing = await tx.findCycle(command.rootReviewResultId);
  if (existing) {
    if (existing.tenantId !== actor.tenantId) return { ok: false, reason: 'TENANT_MISMATCH' };
    const guard = evaluateLoopGuard({
      policy: (await tx.findPolicy(actor.tenantId))?.policy ?? PRODUCT_LOOP_GUARD_DEFAULTS,
      iteration: existing.iteration,
      verificationAttempts: existing.verificationAttempts,
      sameDecisionCount: existing.sameDecisionCount,
      sameConflictCount: existing.sameConflictCount,
      runtimeMs: null,
      costUsd: null,
    });
    return { ok: true, created: false, cycle: existing, guard };
  }

  const chain = await tx.loadChain(command.rootReviewResultId);
  if (!chain || chain.length === 0) return { ok: false, reason: 'CYCLE_NOT_FOUND' };
  if (chain.some((review) => review.tenantId !== actor.tenantId)) return { ok: false, reason: 'TENANT_MISMATCH' };
  const folded = foldDecisionCycle(chain);
  const storedPolicy = await tx.findPolicy(actor.tenantId);
  const policy = storedPolicy?.policy ?? PRODUCT_LOOP_GUARD_DEFAULTS;
  const policyId = storedPolicy?.id ?? (await tx.insertPolicy(actor.tenantId, policy));
  const guard = evaluateLoopGuard({
    policy,
    iteration: folded.iteration,
    verificationAttempts: folded.verificationAttempts,
    sameDecisionCount: folded.sameDecisionCount,
    sameConflictCount: folded.sameConflictCount,
    runtimeMs: null,
    costUsd: null,
  });
  const cycle: DecisionCycleDraft = {
    id: sha([actor.tenantId, command.rootReviewResultId, 'decision-cycle']),
    tenantId: actor.tenantId,
    rootReviewResultId: command.rootReviewResultId,
    currentReviewResultId: folded.currentReviewResultId,
    iteration: folded.iteration,
    verificationAttempts: folded.verificationAttempts,
    sameDecisionCount: folded.sameDecisionCount,
    sameConflictCount: folded.sameConflictCount,
    decisionFingerprint: folded.decisionFingerprint,
    conflictFingerprint: folded.conflictFingerprint,
    status: guard.allowed ? 'ACTIVE' : 'BLOCKED',
    blockedReason: guard.reason === 'ALLOWED' ? null : guard.reason,
    policyId,
    startedAt: folded.startedAt,
    updatedAt: command.now,
  };
  await tx.insertCycle(cycle);
  await tx.audit('DECISION_CYCLE_CREATED', null);
  if (!guard.allowed) await tx.audit('LOOP_GUARD_BLOCKED', guard.reason);
  return { ok: true, created: true, cycle, guard };
}
