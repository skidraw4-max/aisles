/**
 * Removes an organization member and that tenant's service grants in one transaction.
 * Role changes do not use this path. Other organizations stay untouched.
 */
import {
  commitMemberRoleChange,
  planMemberRemoval,
  type MemberAuditEvent,
  type MemberManagementDb,
  type MemberManagementFailure,
} from './member-management';
import type { JuryMemberRole } from './records';
import type { JuryServicePermission } from './service-permission';
import type { ServiceMemberAudit } from './service-member-management';

export type CleanupGrant = {
  id: string;
  tenantId: string;
  connectionId: string;
  userId: string;
  permission: JuryServicePermission;
};

export type MemberCleanupDb = MemberManagementDb & {
  listUserGrants(tenantId: string, userId: string): Promise<CleanupGrant[]>;
  deleteUserGrants(tenantId: string, userId: string): Promise<void>;
  appendServiceAudit(event: ServiceMemberAudit): Promise<void>;
};

export function serviceAccessCounts(
  grants: readonly { tenantId: string; userId: string; connectionId: string }[],
  tenantId: string,
): Record<string, number> {
  const sets = new Map<string, Set<string>>();
  for (const grant of grants) {
    if (grant.tenantId !== tenantId) continue;
    const ids = sets.get(grant.userId) ?? new Set<string>();
    ids.add(grant.connectionId);
    sets.set(grant.userId, ids);
  }
  return Object.fromEntries([...sets].map(([userId, ids]) => [userId, ids.size]));
}

export async function commitMemberRemovalWithServiceCleanup(
  input: {
    actor: Parameters<typeof planMemberRemoval>[0]['actor'];
    targetUserId: string;
    now: string;
    allocateAuditId?: () => string;
    requestedTenantId?: string | null;
    actingUserId?: string | null;
    actorRole?: string | null;
  },
  db: MemberCleanupDb,
): Promise<
  | { ok: true; audit: MemberAuditEvent; removedGrants: CleanupGrant[]; serviceAudits: ServiceMemberAudit[] }
  | { ok: false; reason: MemberManagementFailure }
> {
  if (!input.actor.ok) {
    return { ok: false, reason: input.actor.reason === 'UNAUTHENTICATED' ? 'UNAUTHENTICATED' : 'FORBIDDEN' };
  }
  const actor = input.actor;
  const members = await db.lockTenantMemberships(actor.tenantId);
  const planned = planMemberRemoval({ ...input, members });
  if (!planned.ok) return planned;
  const grants = (await db.listUserGrants(actor.tenantId, input.targetUserId))
    .filter((grant) => grant.tenantId === actor.tenantId && grant.userId === input.targetUserId);
  await db.deleteMembership(planned.membershipId);
  await db.deleteUserGrants(actor.tenantId, input.targetUserId);
  const audit: MemberAuditEvent = {
    ...planned.audit,
    id: input.allocateAuditId?.() ?? `audit-${planned.membershipId}`,
    timestamp: input.now,
  };
  await db.appendAudit(audit);
  const serviceAudits: ServiceMemberAudit[] = [];
  for (const grant of grants) {
    const serviceAudit: ServiceMemberAudit = {
      id: input.allocateAuditId?.() ?? `audit-${grant.id}`,
      tenantId: actor.tenantId,
      timestamp: input.now,
      actorUserId: actor.userId,
      action: 'SERVICE_MEMBER_REMOVED',
      provenance: {
        tenantId: actor.tenantId,
        serviceConnectionId: grant.connectionId,
        serviceMemberId: grant.id,
        targetUserId: grant.userId,
        previousPermission: grant.permission,
        permission: null,
      },
    };
    await db.appendServiceAudit(serviceAudit);
    serviceAudits.push(serviceAudit);
  }
  return { ok: true, audit, removedGrants: grants, serviceAudits };
}

/** Role changes stay on the existing command and do not receive a grant writer. */
export async function commitMemberRoleWithoutServiceChange(
  input: {
    actor: Parameters<typeof commitMemberRoleChange>[0]['actor'];
    targetUserId: string;
    role: JuryMemberRole;
    now: string;
    allocateAuditId?: () => string;
  },
  db: MemberManagementDb,
): Promise<Awaited<ReturnType<typeof commitMemberRoleChange>>> {
  return commitMemberRoleChange(input, db);
}

