/**
 * Server-side Jury access.
 * clientTenantId is accepted only so callers can prove it is ignored.
 */
import type { JuryMemberRole, JuryMembership } from './records';

export const JURY_ACTIONS = [
  'console.read',
  'connection.write',
  'discovery.approve',
  'scope.write',
  'review.start',
  'improvement.write',
  'agent.execute',
  'automation.write',
  'settings.write',
  'membership.write',
] as const;
export type JuryAction = (typeof JURY_ACTIONS)[number];

/**
 * OWNER: access, settings, automation, and agent execution.
 * MEMBER: read, start a review, write an improvement task.
 * AUDITOR: read only.
 */
const ROLE_ACTIONS: Record<JuryMemberRole, readonly JuryAction[]> = {
  OWNER: JURY_ACTIONS,
  MEMBER: ['console.read', 'review.start', 'improvement.write'],
  AUDITOR: ['console.read'],
};

export type JuryActor =
  | { ok: false; reason: 'UNAUTHENTICATED' | 'NO_MEMBERSHIP' | 'AMBIGUOUS_MEMBERSHIP' | 'STORE_UNAVAILABLE' }
  | {
      ok: true;
      userId: string;
      tenantId: string;
      role: JuryMemberRole;
      membershipId: string;
    };

export function resolveJuryActor(input: {
  userId: string | null;
  memberships: readonly JuryMembership[];
  /** Never used to select a tenant. */
  clientTenantId?: string | null;
}): JuryActor {
  void input.clientTenantId;
  if (!input.userId) return { ok: false, reason: 'UNAUTHENTICATED' };
  const mine = input.memberships.filter((row) => row.userId === input.userId);
  if (mine.length === 0) return { ok: false, reason: 'NO_MEMBERSHIP' };
  if (mine.length > 1) return { ok: false, reason: 'AMBIGUOUS_MEMBERSHIP' };
  const membership = mine[0]!;
  return {
    ok: true,
    userId: input.userId,
    tenantId: membership.tenantId,
    role: membership.role,
    membershipId: membership.id,
  };
}

export type JuryMutationDecision =
  | { ok: true }
  | {
      ok: false;
      reason:
        | 'UNAUTHENTICATED'
        | 'NO_MEMBERSHIP'
        | 'AMBIGUOUS_MEMBERSHIP'
        | 'STORE_UNAVAILABLE'
        | 'FORBIDDEN'
        | 'TENANT_MISMATCH';
    };

export function decideJuryMutation(input: {
  actor: JuryActor;
  action: JuryAction;
  resourceTenantId: string;
  clientTenantId?: string | null;
}): JuryMutationDecision {
  void input.clientTenantId;
  if (!input.actor.ok) return { ok: false, reason: input.actor.reason };
  if (input.resourceTenantId !== input.actor.tenantId) {
    return { ok: false, reason: 'TENANT_MISMATCH' };
  }
  if (!ROLE_ACTIONS[input.actor.role].includes(input.action)) {
    return { ok: false, reason: 'FORBIDDEN' };
  }
  return { ok: true };
}

export function planJuryCommand(input: {
  actor: JuryActor;
  action: JuryAction;
  resourceTenantId: string;
  clientTenantId?: string | null;
}): JuryMutationDecision | { ok: false; reason: 'NOT_IMPLEMENTED' } {
  const decision = decideJuryMutation(input);
  if (!decision.ok) return decision;
  if (input.action === 'console.read') return { ok: true };
  return { ok: false, reason: 'NOT_IMPLEMENTED' };
}

export function isJuryAction(value: string): value is JuryAction {
  return (JURY_ACTIONS as readonly string[]).includes(value);
}
