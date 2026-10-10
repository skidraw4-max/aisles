import { planMembershipCommand, type MembershipDecision } from './membership-policy';
import type { JuryMembership } from './records';

export const ORGANIZATION_NAME_MAX = 80;
export const ORGANIZATION_CREATE_RETRY_MS = 15_000;

export type OrganizationCreationFailure =
  | 'UNAUTHENTICATED'
  | 'EMAIL_UNVERIFIED'
  | 'NAME_REQUIRED'
  | 'NAME_TOO_LONG'
  | 'FAILED';

export type OwnedOrganizationPlan =
  | {
      ok: true;
      tenantId: string;
      tenantName: string;
      membership: JuryMembership;
      keptMemberships: readonly JuryMembership[];
    }
  | { ok: false; reason: OrganizationCreationFailure };

const MESSAGE: Record<OrganizationCreationFailure, string> = {
  UNAUTHENTICATED: 'Sign in to create an organization.',
  EMAIL_UNVERIFIED: 'Verify your email before creating an organization.',
  NAME_REQUIRED: 'Organization name is required.',
  NAME_TOO_LONG: 'Organization name is too long.',
  FAILED: 'Organization could not be created.',
};

export function organizationCreationMessage(reason: OrganizationCreationFailure): string {
  return MESSAGE[reason];
}

export function normalizeOrganizationName(raw: string): { ok: true; name: string } | { ok: false; reason: 'NAME_REQUIRED' | 'NAME_TOO_LONG' } {
  const name = raw.replace(/\0/g, '').trim();
  if (!name) return { ok: false, reason: 'NAME_REQUIRED' };
  if (name.length > ORGANIZATION_NAME_MAX) return { ok: false, reason: 'NAME_TOO_LONG' };
  return { ok: true, name };
}

/**
 * Plans a new JuryTenant whose creator is the authenticated user and OWNER.
 * Requested user id, tenant id, and role are ignored.
 */
export function planOwnedOrganization(input: {
  sessionUserId: string | null;
  emailVerified: boolean;
  tenantName: string;
  existingMemberships?: readonly JuryMembership[];
  requestedUserId?: string | null;
  requestedTenantId?: string | null;
  requestedRole?: string | null;
  allocateId?: () => string;
  now?: string;
}): OwnedOrganizationPlan {
  void input.requestedUserId;
  void input.requestedTenantId;
  void input.requestedRole;
  if (!input.sessionUserId) return { ok: false, reason: 'UNAUTHENTICATED' };
  if (!input.emailVerified) return { ok: false, reason: 'EMAIL_UNVERIFIED' };
  const name = normalizeOrganizationName(input.tenantName);
  if (!name.ok) return name;
  const existing = input.existingMemberships ?? [];
  const decision: MembershipDecision = planMembershipCommand({
    kind: 'CREATE_TENANT',
    userId: input.sessionUserId,
    existingMemberships: existing,
    tenantName: name.name,
    clientTenantId: input.requestedTenantId,
    allocateId: input.allocateId,
    now: input.now,
  });
  if (!decision.ok || decision.kind !== 'CREATE_TENANT') return { ok: false, reason: 'FAILED' };
  if (decision.membership.role !== 'OWNER' || decision.membership.userId !== input.sessionUserId) {
    return { ok: false, reason: 'FAILED' };
  }
  if (input.requestedTenantId && decision.tenantId === input.requestedTenantId) {
    return { ok: false, reason: 'FAILED' };
  }
  return {
    ok: true,
    tenantId: decision.tenantId,
    tenantName: decision.tenantName,
    membership: decision.membership,
    keptMemberships: [...existing, decision.membership],
  };
}

export function matchRecentOwnedOrganization(input: {
  userId: string;
  name: string;
  now: string;
  withinMs?: number;
  rows: readonly { tenantId: string; userId: string; role: string; tenantName: string; createdAt: string }[];
}): string | null {
  const within = input.withinMs ?? ORGANIZATION_CREATE_RETRY_MS;
  const now = Date.parse(input.now);
  const match = input.rows.find((row) =>
    row.userId === input.userId
    && row.role === 'OWNER'
    && row.tenantName === input.name
    && Number.isFinite(now)
    && now - Date.parse(row.createdAt) >= 0
    && now - Date.parse(row.createdAt) <= within);
  return match?.tenantId ?? null;
}
