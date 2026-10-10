/**
 * Membership rules for one Jury tenant.
 * A user may belong to several organizations. One organization still has one membership per user.
 * The last OWNER cannot be removed or demoted.
 * clientTenantId is never the tenant that gets written.
 */
import { randomUUID } from 'node:crypto';
import type { JuryActor } from './access';
import type { JuryMemberRole, JuryMembership } from './records';

export type MembershipAudit = {
  tenantId: string;
  actorUserId: string;
  action: 'TENANT_CREATED' | 'MEMBERSHIP_ADDED' | 'MEMBERSHIP_ROLE_CHANGED' | 'MEMBERSHIP_REMOVED';
  targetUserId: string;
  role?: JuryMemberRole;
  previousRole?: JuryMemberRole;
};

export type MembershipFailure =
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'LAST_OWNER'
  | 'ALREADY_HAS_MEMBERSHIP'
  | 'TARGET_NOT_IN_TENANT'
  | 'NAME_REQUIRED'
  | 'USER_NOT_FOUND'
  | 'STORE_UNAVAILABLE';

export type MembershipDecision =
  | {
      ok: true;
      kind: 'CREATE_TENANT';
      tenantId: string;
      tenantName: string;
      membership: JuryMembership;
      audit: MembershipAudit;
      membershipAudit: MembershipAudit;
    }
  | {
      ok: true;
      kind: 'ADD_MEMBER';
      membership: JuryMembership;
      audit: MembershipAudit;
    }
  | {
      ok: true;
      kind: 'CHANGE_ROLE';
      membershipId: string;
      role: JuryMemberRole;
      audit: MembershipAudit;
    }
  | {
      ok: true;
      kind: 'REMOVE_MEMBER';
      membershipId: string;
      audit: MembershipAudit;
    }
  | { ok: false; reason: MembershipFailure };

type CreateCommand = {
  kind: 'CREATE_TENANT';
  userId: string | null;
  existingMemberships: readonly JuryMembership[];
  tenantName: string;
  clientTenantId?: string | null;
  allocateId?: () => string;
  now?: string;
};

type AddCommand = {
  kind: 'ADD_MEMBER';
  actor: JuryActor;
  tenantMembers: readonly JuryMembership[];
  targetExisting: readonly JuryMembership[];
  targetUserId: string;
  role: JuryMemberRole;
  clientTenantId?: string | null;
  allocateId?: () => string;
  now?: string;
};

type ChangeCommand = {
  kind: 'CHANGE_ROLE';
  actor: JuryActor;
  tenantMembers: readonly JuryMembership[];
  targetUserId: string;
  role: JuryMemberRole;
  clientTenantId?: string | null;
};

type RemoveCommand = {
  kind: 'REMOVE_MEMBER';
  actor: JuryActor;
  tenantMembers: readonly JuryMembership[];
  targetUserId: string;
  clientTenantId?: string | null;
};

export type MembershipCommand = CreateCommand | AddCommand | ChangeCommand | RemoveCommand;

function ownersIn(tenantId: string, members: readonly JuryMembership[]): JuryMembership[] {
  return members.filter((row) => row.tenantId === tenantId && row.role === 'OWNER');
}

function sameTenant(tenantId: string, members: readonly JuryMembership[]): JuryMembership[] {
  return members.filter((row) => row.tenantId === tenantId);
}

function requireManager(actor: JuryActor): MembershipDecision | null {
  if (!actor.ok) return { ok: false, reason: actor.reason === 'UNAUTHENTICATED' ? 'UNAUTHENTICATED' : 'FORBIDDEN' };
  if (actor.role !== 'OWNER' && actor.role !== 'ADMIN') return { ok: false, reason: 'FORBIDDEN' };
  return null;
}

export function planMembershipCommand(command: MembershipCommand): MembershipDecision {
  void command.clientTenantId;
  if (command.kind === 'CREATE_TENANT') {
    const now = command.now ?? '2026-10-01T00:00:00.000Z';
    if (!command.userId) return { ok: false, reason: 'UNAUTHENTICATED' };
    if (command.tenantName.trim().length === 0) return { ok: false, reason: 'NAME_REQUIRED' };
    const tenantId = command.allocateId?.() ?? 'tenant-created';
    const membership: JuryMembership = {
      id: `${tenantId}-owner`,
      tenantId,
      userId: command.userId,
      role: 'OWNER',
      createdAt: now,
    };
    return {
      ok: true,
      kind: 'CREATE_TENANT',
      tenantId,
      tenantName: command.tenantName.trim(),
      membership,
      audit: {
        tenantId,
        actorUserId: command.userId,
        action: 'TENANT_CREATED',
        targetUserId: command.userId,
        role: 'OWNER',
      },
      membershipAudit: {
        tenantId,
        actorUserId: command.userId,
        action: 'MEMBERSHIP_ADDED',
        targetUserId: command.userId,
        role: 'OWNER',
      },
    };
  }

  const denied = requireManager(command.actor);
  if (denied) return denied;
  if (!command.actor.ok) return { ok: false, reason: 'FORBIDDEN' };
  const actor = command.actor;
  const tenantId = actor.tenantId;
  const members = sameTenant(tenantId, command.tenantMembers);

  if (command.kind === 'ADD_MEMBER') {
    const now = command.now ?? '2026-10-01T00:00:00.000Z';
    if (command.targetExisting.some((row) => row.tenantId === tenantId && row.userId === command.targetUserId)) {
      return { ok: false, reason: 'ALREADY_HAS_MEMBERSHIP' };
    }
    const membership: JuryMembership = {
      id: command.allocateId?.() ?? `mem-${command.targetUserId}`,
      tenantId,
      userId: command.targetUserId,
      role: command.role,
      createdAt: now,
    };
    return {
      ok: true,
      kind: 'ADD_MEMBER',
      membership,
      audit: {
        tenantId,
        actorUserId: actor.userId,
        action: 'MEMBERSHIP_ADDED',
        targetUserId: command.targetUserId,
        role: command.role,
      },
    };
  }

  const target = members.find((row) => row.userId === command.targetUserId);
  if (!target) return { ok: false, reason: 'TARGET_NOT_IN_TENANT' };
  const owners = ownersIn(tenantId, members);

  if (command.kind === 'CHANGE_ROLE') {
    if (target.role === 'OWNER' && command.role !== 'OWNER' && owners.length <= 1) {
      return { ok: false, reason: 'LAST_OWNER' };
    }
    return {
      ok: true,
      kind: 'CHANGE_ROLE',
      membershipId: target.id,
      role: command.role,
      audit: {
        tenantId,
        actorUserId: actor.userId,
        action: 'MEMBERSHIP_ROLE_CHANGED',
        targetUserId: target.userId,
        role: command.role,
        previousRole: target.role,
      },
    };
  }

  if (target.role === 'OWNER' && owners.length <= 1) return { ok: false, reason: 'LAST_OWNER' };
  return {
    ok: true,
    kind: 'REMOVE_MEMBER',
    membershipId: target.id,
    audit: {
      tenantId,
      actorUserId: actor.userId,
      action: 'MEMBERSHIP_REMOVED',
      targetUserId: target.userId,
      previousRole: target.role,
    },
  };
}

export type MembershipTx = {
  userExists(userId: string): Promise<boolean>;
  listTenant(tenantId: string): Promise<JuryMembership[]>;
  listUser(userId: string): Promise<JuryMembership[]>;
  createTenant(input: { id: string; name: string }): Promise<void>;
  createMembership(row: JuryMembership): Promise<void>;
  updateRole(id: string, role: JuryMemberRole): Promise<void>;
  deleteMembership(id: string): Promise<void>;
  appendAudit(event: MembershipAudit & { id: string; timestamp: string }): Promise<void>;
};

export async function runMembershipCommand(
  command: Omit<CreateCommand, 'existingMemberships'> | Omit<AddCommand, 'tenantMembers' | 'targetExisting'> | Omit<ChangeCommand, 'tenantMembers'> | Omit<RemoveCommand, 'tenantMembers'>,
  tx: MembershipTx,
): Promise<MembershipDecision> {
  if (command.kind === 'CREATE_TENANT') {
    if (!command.userId) return { ok: false, reason: 'UNAUTHENTICATED' };
    if (!(await tx.userExists(command.userId))) return { ok: false, reason: 'USER_NOT_FOUND' };
    const existingMemberships = await tx.listUser(command.userId);
    const decision = planMembershipCommand({ ...command, existingMemberships });
    if (!decision.ok || decision.kind !== 'CREATE_TENANT') return decision;
    await tx.createTenant({ id: decision.tenantId, name: decision.tenantName });
    await tx.createMembership(decision.membership);
    const timestamp = decision.membership.createdAt;
    await tx.appendAudit({ ...decision.audit, id: randomUUID(), timestamp });
    await tx.appendAudit({ ...decision.membershipAudit, id: randomUUID(), timestamp });
    return decision;
  }

  if (!command.actor.ok) {
    return planMembershipCommand({ ...command, tenantMembers: [] } as MembershipCommand);
  }
  if (command.kind === 'ADD_MEMBER') {
    if (!(await tx.userExists(command.targetUserId))) return { ok: false, reason: 'USER_NOT_FOUND' };
    const [tenantMembers, targetExisting] = await Promise.all([
      tx.listTenant(command.actor.tenantId),
      tx.listUser(command.targetUserId),
    ]);
    const decision = planMembershipCommand({ ...command, tenantMembers, targetExisting });
    if (!decision.ok || decision.kind !== 'ADD_MEMBER') return decision;
    await tx.createMembership(decision.membership);
    await tx.appendAudit({
      ...decision.audit,
      id: randomUUID(),
      timestamp: decision.membership.createdAt,
    });
    return decision;
  }

  const tenantMembers = await tx.listTenant(command.actor.tenantId);
  const decision = planMembershipCommand({ ...command, tenantMembers });
  if (!decision.ok) return decision;
  if (decision.kind === 'CHANGE_ROLE') await tx.updateRole(decision.membershipId, decision.role);
  if (decision.kind === 'REMOVE_MEMBER') await tx.deleteMembership(decision.membershipId);
  await tx.appendAudit({ ...decision.audit, id: randomUUID(), timestamp: new Date().toISOString() });
  return decision;
}
