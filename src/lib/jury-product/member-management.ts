import type { JuryActor } from './access';
import type { JuryMemberRole, JuryMembership } from './records';

export const ASSIGNABLE_MEMBER_ROLES = ['ADMIN', 'REVIEWER', 'DEVELOPER', 'VIEWER'] as const;
export type AssignableMemberRole = (typeof ASSIGNABLE_MEMBER_ROLES)[number];

const ROLE_LABEL: Record<JuryMemberRole, string> = {
  OWNER: 'Organization Owner',
  ADMIN: 'Administrator',
  REVIEWER: 'Reviewer',
  DEVELOPER: 'Developer',
  VIEWER: 'Viewer',
};

export type MemberManagementFailure =
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'TENANT_MISMATCH'
  | 'OWNER_PROTECTED'
  | 'LAST_OWNER'
  | 'ADMIN_PROTECTED'
  | 'SELF_PROTECTED'
  | 'INVALID_ROLE';

export type MemberAuditEvent = {
  id: string;
  tenantId: string;
  timestamp: string;
  actorUserId: string;
  action: 'MEMBERSHIP_ROLE_CHANGED' | 'MEMBERSHIP_REMOVED';
  provenance: {
    tenantId: string;
    targetUserId: string;
    previousRole: JuryMemberRole;
    role?: JuryMemberRole;
  };
};

export function juryRoleLabel(role: JuryMemberRole): string {
  return ROLE_LABEL[role];
}

export function memberManagementMessage(reason: MemberManagementFailure | 'FAILED', kind: 'role' | 'remove'): string {
  switch (reason) {
    case 'NOT_FOUND':
      return 'Member not found';
    case 'TENANT_MISMATCH':
      return 'Member belongs to another organization';
    case 'FORBIDDEN':
      return 'Not authorized';
    case 'OWNER_PROTECTED':
      return kind === 'remove' ? 'Cannot remove owner' : 'Cannot modify owner';
    case 'LAST_OWNER':
      return 'Cannot remove last owner';
    case 'ADMIN_PROTECTED':
      return 'Cannot modify another administrator';
    case 'SELF_PROTECTED':
      return 'Cannot modify yourself';
    case 'INVALID_ROLE':
      return 'Invalid role';
    case 'UNAUTHENTICATED':
      return 'Sign in to continue.';
    default:
      return kind === 'remove' ? 'Member could not be removed' : 'Role could not be changed';
  }
}

function authorize(actor: JuryActor): { ok: true; actor: Extract<JuryActor, { ok: true }> } | { ok: false; reason: MemberManagementFailure } {
  if (!actor.ok) return { ok: false, reason: actor.reason === 'UNAUTHENTICATED' ? 'UNAUTHENTICATED' : 'FORBIDDEN' };
  if (actor.role !== 'OWNER' && actor.role !== 'ADMIN') return { ok: false, reason: 'FORBIDDEN' };
  return { ok: true, actor };
}

function findTarget(input: {
  actor: Extract<JuryActor, { ok: true }>;
  members: readonly JuryMembership[];
  targetUserId: string;
}): { ok: true; target: JuryMembership; owners: number } | { ok: false; reason: MemberManagementFailure } {
  const local = input.members.find((row) => row.userId === input.targetUserId && row.tenantId === input.actor.tenantId);
  const foreign = input.members.find((row) => row.userId === input.targetUserId && row.tenantId !== input.actor.tenantId);
  if (!local && foreign) return { ok: false, reason: 'TENANT_MISMATCH' };
  if (!local) return { ok: false, reason: 'NOT_FOUND' };
  const owners = input.members.filter((row) => row.tenantId === input.actor.tenantId && row.role === 'OWNER').length;
  return { ok: true, target: local, owners };
}

function protectTarget(
  actor: Extract<JuryActor, { ok: true }>,
  target: JuryMembership,
  owners: number,
  kind: 'role' | 'remove',
): MemberManagementFailure | null {
  if (target.userId === actor.userId) return 'SELF_PROTECTED';
  if (target.role === 'OWNER') return kind === 'remove' && owners <= 1 ? 'LAST_OWNER' : 'OWNER_PROTECTED';
  if (actor.role === 'ADMIN' && target.role === 'ADMIN') return 'ADMIN_PROTECTED';
  return null;
}

export function canManageMember(actor: JuryActor, target: Pick<JuryMembership, 'userId' | 'tenantId' | 'role'>): boolean {
  if (!actor.ok || target.tenantId !== actor.tenantId) return false;
  if (actor.role !== 'OWNER' && actor.role !== 'ADMIN') return false;
  if (target.userId === actor.userId || target.role === 'OWNER') return false;
  if (actor.role === 'ADMIN' && target.role === 'ADMIN') return false;
  return true;
}

export function planMemberRoleChange(input: {
  actor: JuryActor;
  members: readonly JuryMembership[];
  targetUserId: string;
  role: JuryMemberRole;
  requestedTenantId?: string | null;
  actingUserId?: string | null;
  actorRole?: string | null;
}):
  | { ok: true; membershipId: string; role: AssignableMemberRole; unchanged: boolean; audit: Omit<MemberAuditEvent, 'id' | 'timestamp'> }
  | { ok: false; reason: MemberManagementFailure } {
  void input.requestedTenantId;
  void input.actingUserId;
  void input.actorRole;
  const allowed = authorize(input.actor);
  if (!allowed.ok) return allowed;
  const found = findTarget({ actor: allowed.actor, members: input.members, targetUserId: input.targetUserId });
  if (!found.ok) return found;
  const blocked = protectTarget(allowed.actor, found.target, found.owners, 'role');
  if (blocked) return { ok: false, reason: blocked };
  if (!(ASSIGNABLE_MEMBER_ROLES as readonly string[]).includes(input.role)) return { ok: false, reason: 'INVALID_ROLE' };
  const role = input.role as AssignableMemberRole;
  return {
    ok: true,
    membershipId: found.target.id,
    role,
    unchanged: found.target.role === role,
    audit: {
      tenantId: allowed.actor.tenantId,
      actorUserId: allowed.actor.userId,
      action: 'MEMBERSHIP_ROLE_CHANGED',
      provenance: {
        tenantId: allowed.actor.tenantId,
        targetUserId: found.target.userId,
        previousRole: found.target.role,
        role,
      },
    },
  };
}

export function planMemberRemoval(input: {
  actor: JuryActor;
  members: readonly JuryMembership[];
  targetUserId: string;
  requestedTenantId?: string | null;
  actingUserId?: string | null;
  actorRole?: string | null;
}):
  | { ok: true; membershipId: string; audit: Omit<MemberAuditEvent, 'id' | 'timestamp'> }
  | { ok: false; reason: MemberManagementFailure } {
  void input.requestedTenantId;
  void input.actingUserId;
  void input.actorRole;
  const allowed = authorize(input.actor);
  if (!allowed.ok) return allowed;
  const found = findTarget({ actor: allowed.actor, members: input.members, targetUserId: input.targetUserId });
  if (!found.ok) return found;
  const blocked = protectTarget(allowed.actor, found.target, found.owners, 'remove');
  if (blocked) return { ok: false, reason: blocked };
  return {
    ok: true,
    membershipId: found.target.id,
    audit: {
      tenantId: allowed.actor.tenantId,
      actorUserId: allowed.actor.userId,
      action: 'MEMBERSHIP_REMOVED',
      provenance: {
        tenantId: allowed.actor.tenantId,
        targetUserId: found.target.userId,
        previousRole: found.target.role,
      },
    },
  };
}

export type MemberManagementDb = {
  lockTenantMemberships(tenantId: string): Promise<JuryMembership[]>;
  updateRole(id: string, role: JuryMemberRole): Promise<void>;
  deleteMembership(id: string): Promise<void>;
  appendAudit(event: MemberAuditEvent): Promise<void>;
};

export async function commitMemberRoleChange(
  input: {
    actor: JuryActor;
    targetUserId: string;
    role: JuryMemberRole;
    now: string;
    allocateAuditId?: () => string;
    requestedTenantId?: string | null;
    actingUserId?: string | null;
    actorRole?: string | null;
  },
  db: MemberManagementDb,
): Promise<
  | { ok: true; audit: MemberAuditEvent | null }
  | { ok: false; reason: MemberManagementFailure }
> {
  const allowed = authorize(input.actor);
  if (!allowed.ok) return allowed;
  const members = await db.lockTenantMemberships(allowed.actor.tenantId);
  const planned = planMemberRoleChange({ ...input, members });
  if (!planned.ok) return planned;
  if (!planned.unchanged) await db.updateRole(planned.membershipId, planned.role);
  const audit: MemberAuditEvent = {
    ...planned.audit,
    id: input.allocateAuditId?.() ?? `audit-${planned.membershipId}`,
    timestamp: input.now,
  };
  if (!planned.unchanged) await db.appendAudit(audit);
  return { ok: true, audit: planned.unchanged ? null : audit };
}

export async function commitMemberRemoval(
  input: {
    actor: JuryActor;
    targetUserId: string;
    now: string;
    allocateAuditId?: () => string;
    requestedTenantId?: string | null;
    actingUserId?: string | null;
    actorRole?: string | null;
  },
  db: MemberManagementDb,
): Promise<
  | { ok: true; audit: MemberAuditEvent }
  | { ok: false; reason: MemberManagementFailure }
> {
  const allowed = authorize(input.actor);
  if (!allowed.ok) return allowed;
  const members = await db.lockTenantMemberships(allowed.actor.tenantId);
  const planned = planMemberRemoval({ ...input, members });
  if (!planned.ok) return planned;
  await db.deleteMembership(planned.membershipId);
  const audit: MemberAuditEvent = {
    ...planned.audit,
    id: input.allocateAuditId?.() ?? `audit-${planned.membershipId}`,
    timestamp: input.now,
  };
  await db.appendAudit(audit);
  return { ok: true, audit };
}
