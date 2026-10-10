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
 * OWNER keeps settings and automation.
 * ADMIN manages members, services, reviews, improvements, agents, and the change gate.
 * DEVELOPER keeps the former MEMBER review and improvement actions.
 * Agent execution for DEVELOPER also requires the service AGENT grant.
 * VIEWER keeps the former AUDITOR read-only action.
 */
const ROLE_ACTIONS: Record<JuryMemberRole, readonly JuryAction[]> = {
  OWNER: JURY_ACTIONS,
  ADMIN: JURY_ACTIONS.filter((action) => action !== 'settings.write' && action !== 'automation.write'),
  REVIEWER: ['console.read', 'review.start'],
  DEVELOPER: ['console.read', 'review.start', 'improvement.write'],
  VIEWER: ['console.read'],
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
  /** Cookie value. Ignored unless it matches one of the user's memberships. */
  activeTenantId?: string | null;
}): JuryActor {
  void input.clientTenantId;
  if (!input.userId) return { ok: false, reason: 'UNAUTHENTICATED' };
  const mine = input.memberships.filter((row) => row.userId === input.userId);
  if (mine.length === 0) return { ok: false, reason: 'NO_MEMBERSHIP' };
  const selected = selectActiveOrganization(mine, input.activeTenantId);
  const membership = selected.membership;
  return {
    ok: true,
    userId: input.userId,
    tenantId: membership.tenantId,
    role: membership.role,
    membershipId: membership.id,
  };
}

export function selectActiveOrganization(
  memberships: readonly JuryMembership[],
  activeTenantId?: string | null,
): { status: 'accepted' | 'rejected' | 'fallback'; membership: JuryMembership } {
  const ordered = [...memberships].sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
  const fallback = ordered[0]!;
  if (!activeTenantId) return { status: 'fallback', membership: fallback };
  const matched = ordered.find((row) => row.tenantId === activeTenantId);
  if (!matched) return { status: 'rejected', membership: fallback };
  return { status: 'accepted', membership: matched };
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
  servicePermissions?: readonly ('VIEW' | 'REVIEW' | 'IMPROVE' | 'AGENT')[];
}): JuryMutationDecision {
  void input.clientTenantId;
  if (!input.actor.ok) return { ok: false, reason: input.actor.reason };
  if (input.resourceTenantId !== input.actor.tenantId) {
    return { ok: false, reason: 'TENANT_MISMATCH' };
  }
  if (input.actor.role === 'DEVELOPER' && input.action === 'agent.execute') {
    if (!input.servicePermissions?.includes('AGENT')) return { ok: false, reason: 'FORBIDDEN' };
    return { ok: true };
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
