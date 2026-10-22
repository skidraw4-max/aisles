import type { JuryMemberRole } from './records';

export type JuryOrganizationOption = {
  tenantId: string;
  name: string;
  role: JuryMemberRole;
};

type MembershipRow = {
  tenantId: string;
  userId: string;
  role: JuryMemberRole;
  createdAt: string;
};

/** Organizations the authenticated user actually belongs to, oldest membership first. */
export function organizationsForUser(input: {
  userId: string;
  memberships: readonly MembershipRow[];
  tenants: readonly { id: string; name: string }[];
}): JuryOrganizationOption[] {
  return input.memberships
    .filter((row) => row.userId === input.userId)
    .slice()
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.tenantId.localeCompare(right.tenantId))
    .flatMap((row) => {
      const tenant = input.tenants.find((item) => item.id === row.tenantId);
      if (!tenant) return [];
      return [{ tenantId: row.tenantId, name: tenant.name, role: row.role }];
    });
}

/** Accepts a tenant only when this user has a membership there. Role does not gate switching. */
export function planOrganizationSwitch(input: {
  userId: string | null;
  memberships: readonly { tenantId: string; userId: string; role: JuryMemberRole }[];
  tenantId: string;
}): { ok: true; tenantId: string; role: JuryMemberRole } | { ok: false; reason: 'UNAUTHENTICATED' | 'FORBIDDEN' } {
  if (!input.userId) return { ok: false, reason: 'UNAUTHENTICATED' };
  const match = input.memberships.find((row) => row.userId === input.userId && row.tenantId === input.tenantId);
  if (!match) return { ok: false, reason: 'FORBIDDEN' };
  return { ok: true, tenantId: match.tenantId, role: match.role };
}
