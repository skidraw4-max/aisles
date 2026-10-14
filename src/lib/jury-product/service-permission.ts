import type { JuryMemberRole } from './records';

export const JURY_SERVICE_PERMISSIONS = ['VIEW', 'REVIEW', 'IMPROVE', 'AGENT'] as const;
export type JuryServicePermission = (typeof JURY_SERVICE_PERMISSIONS)[number];

export type ServiceGrant = {
  connectionId: string;
  userId: string;
  permission: JuryServicePermission;
};

/** Historical rows: OWNER and former MEMBER keep full service access. Former AUDITOR keeps VIEW. */
export function migratedServicePermissions(role: JuryMemberRole): readonly JuryServicePermission[] {
  if (role === 'OWNER' || role === 'ADMIN' || role === 'DEVELOPER') return JURY_SERVICE_PERMISSIONS;
  if (role === 'REVIEWER') return ['VIEW', 'REVIEW'];
  return ['VIEW'];
}

export function decideServicePermission(input: {
  tenantId: string;
  connectionTenantId: string;
  userId: string;
  connectionId: string;
  permission: JuryServicePermission;
  grants: readonly ServiceGrant[];
}): { ok: true } | { ok: false; reason: 'TENANT_MISMATCH' | 'SERVICE_FORBIDDEN' } {
  if (input.tenantId !== input.connectionTenantId) return { ok: false, reason: 'TENANT_MISMATCH' };
  const allowed = input.grants.some((grant) =>
    grant.connectionId === input.connectionId
    && grant.userId === input.userId
    && grant.permission === input.permission);
  if (!allowed) return { ok: false, reason: 'SERVICE_FORBIDDEN' };
  return { ok: true };
}
