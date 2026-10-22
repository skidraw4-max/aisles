import type { JuryActor } from './access';
import type { JuryMemberRole, JuryMembership } from './records';
import { JURY_SERVICE_PERMISSIONS, type JuryServicePermission } from './service-permission';

const RANK: Record<JuryServicePermission, number> = {
  VIEW: 1,
  REVIEW: 2,
  IMPROVE: 3,
  AGENT: 4,
};

export const SERVICE_PERMISSION_LABEL: Record<JuryServicePermission, string> = {
  VIEW: 'View',
  REVIEW: 'Review',
  IMPROVE: 'Improve',
  AGENT: 'Agent',
};

export type ServiceGrantRow = {
  id: string;
  tenantId: string;
  connectionId: string;
  userId: string;
  permission: JuryServicePermission;
};

export type ServiceConnectionRow = {
  id: string;
  tenantId: string;
  displayName: string;
};

export type ServiceMemberFailure =
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'SERVICE_NOT_FOUND'
  | 'TENANT_MISMATCH'
  | 'NOT_IN_ORGANIZATION'
  | 'ALREADY_EXISTS'
  | 'NOT_FOUND'
  | 'INVALID_PERMISSION';

export type ServiceMemberAudit = {
  id: string;
  tenantId: string;
  timestamp: string;
  actorUserId: string;
  action: 'SERVICE_MEMBER_ADDED' | 'SERVICE_MEMBER_PERMISSION_CHANGED' | 'SERVICE_MEMBER_REMOVED';
  provenance: {
    tenantId: string;
    serviceConnectionId: string;
    serviceMemberId: string;
    targetUserId: string;
    previousPermission: JuryServicePermission | null;
    permission: JuryServicePermission | null;
  };
};

export function servicePermissionSatisfies(actual: JuryServicePermission, required: JuryServicePermission): boolean {
  return RANK[actual] >= RANK[required];
}

export function highestServicePermission(grants: readonly { permission: JuryServicePermission }[]): JuryServicePermission | null {
  return grants.reduce<JuryServicePermission | null>((best, grant) => {
    if (!best || RANK[grant.permission] > RANK[best]) return grant.permission;
    return best;
  }, null);
}

/** Service access requires an organization membership and a grant on that tenant's connection. */
export function hasJuryServicePermission(input: {
  membership: { tenantId: string; userId: string } | null;
  connection: { id: string; tenantId: string } | null;
  grants: readonly ServiceGrantRow[];
  required: JuryServicePermission;
}): boolean {
  if (!input.membership || !input.connection) return false;
  if (input.connection.tenantId !== input.membership.tenantId) return false;
  const mine = input.grants.filter((grant) =>
    grant.tenantId === input.membership?.tenantId
    && grant.connectionId === input.connection?.id
    && grant.userId === input.membership.userId);
  const level = highestServicePermission(mine);
  if (!level) return false;
  return servicePermissionSatisfies(level, input.required);
}

export function canManageServiceAccess(actor: JuryActor): boolean {
  return actor.ok && (actor.role === 'OWNER' || actor.role === 'ADMIN');
}

export function serviceMemberMessage(reason: ServiceMemberFailure | 'FAILED', kind: 'add' | 'change' | 'remove' = 'change'): string {
  switch (reason) {
    case 'SERVICE_NOT_FOUND':
      return 'Service not found';
    case 'TENANT_MISMATCH':
      return 'Service belongs to another organization';
    case 'NOT_IN_ORGANIZATION':
      return 'Member does not belong to this organization';
    case 'NOT_FOUND':
      return kind === 'add' ? 'Member not found' : 'Service access not found';
    case 'ALREADY_EXISTS':
      return 'Service member already exists';
    case 'FORBIDDEN':
      return 'Not authorized';
    case 'INVALID_PERMISSION':
      return 'Invalid permission';
    case 'UNAUTHENTICATED':
      return 'Sign in to continue.';
    default:
      return 'Service access could not be changed';
  }
}

function authorize(actor: JuryActor): { ok: true; actor: Extract<JuryActor, { ok: true }> } | { ok: false; reason: ServiceMemberFailure } {
  if (!actor.ok) return { ok: false, reason: actor.reason === 'UNAUTHENTICATED' ? 'UNAUTHENTICATED' : 'FORBIDDEN' };
  if (!canManageServiceAccess(actor)) return { ok: false, reason: 'FORBIDDEN' };
  return { ok: true, actor };
}

function normalizePermission(permission: string | null | undefined, fallback: JuryServicePermission | null): JuryServicePermission | { ok: false; reason: 'INVALID_PERMISSION' } {
  if (!permission) return fallback ?? { ok: false, reason: 'INVALID_PERMISSION' };
  if (!(JURY_SERVICE_PERMISSIONS as readonly string[]).includes(permission)) return { ok: false, reason: 'INVALID_PERMISSION' };
  return permission as JuryServicePermission;
}

function connectionForActor(
  actor: Extract<JuryActor, { ok: true }>,
  connection: ServiceConnectionRow | null,
): { ok: true; connection: ServiceConnectionRow } | { ok: false; reason: ServiceMemberFailure } {
  if (!connection) return { ok: false, reason: 'SERVICE_NOT_FOUND' };
  if (connection.tenantId !== actor.tenantId) return { ok: false, reason: 'TENANT_MISMATCH' };
  return { ok: true, connection };
}

function memberInOrganization(members: readonly JuryMembership[], tenantId: string, userId: string): boolean {
  return members.some((row) => row.tenantId === tenantId && row.userId === userId);
}

export function projectServiceAccess(input: {
  tenantId: string;
  connections: readonly ServiceConnectionRow[];
  grants: readonly ServiceGrantRow[];
  members: readonly (JuryMembership & { email: string; displayName: string | null })[];
}): Array<{
  connectionId: string;
  displayName: string;
  members: Array<{
    userId: string;
    email: string;
    displayName: string | null;
    orgRole: JuryMemberRole | null;
    permission: JuryServicePermission;
  }>;
}> {
  return input.connections
    .filter((connection) => connection.tenantId === input.tenantId)
    .map((connection) => {
      const grouped = new Map<string, ServiceGrantRow[]>();
      for (const grant of input.grants) {
        if (grant.tenantId !== input.tenantId || grant.connectionId !== connection.id) continue;
        const rows = grouped.get(grant.userId) ?? [];
        rows.push(grant);
        grouped.set(grant.userId, rows);
      }
      const members = [...grouped.entries()].flatMap(([userId, rows]) => {
        const permission = highestServicePermission(rows);
        if (!permission) return [];
        const member = input.members.find((row) => row.tenantId === input.tenantId && row.userId === userId);
        return [{
          userId,
          email: member?.email ?? '',
          displayName: member?.displayName ?? null,
          orgRole: member?.role ?? null,
          permission,
        }];
      });
      return { connectionId: connection.id, displayName: connection.displayName, members };
    });
}

export function planAddServiceMember(input: {
  actor: JuryActor;
  connection: ServiceConnectionRow | null;
  members: readonly JuryMembership[];
  grants: readonly ServiceGrantRow[];
  targetUserId: string;
  permission?: string | null;
  requestedTenantId?: string | null;
  actingUserId?: string | null;
  actorRole?: string | null;
  allocateId?: () => string;
}):
  | { ok: true; grant: ServiceGrantRow; audit: Omit<ServiceMemberAudit, 'id' | 'timestamp'> }
  | { ok: false; reason: ServiceMemberFailure } {
  void input.requestedTenantId;
  void input.actingUserId;
  void input.actorRole;
  const allowed = authorize(input.actor);
  if (!allowed.ok) return allowed;
  const connection = connectionForActor(allowed.actor, input.connection);
  if (!connection.ok) return connection;
  if (!memberInOrganization(input.members, allowed.actor.tenantId, input.targetUserId)) {
    return { ok: false, reason: 'NOT_IN_ORGANIZATION' };
  }
  const existing = input.grants.filter((grant) =>
    grant.tenantId === allowed.actor.tenantId
    && grant.connectionId === connection.connection.id
    && grant.userId === input.targetUserId);
  if (existing.length > 0) return { ok: false, reason: 'ALREADY_EXISTS' };
  const permission = normalizePermission(input.permission, 'VIEW');
  if (typeof permission !== 'string') return permission;
  const grant: ServiceGrantRow = {
    id: input.allocateId?.() ?? `grant-${input.targetUserId}`,
    tenantId: allowed.actor.tenantId,
    connectionId: connection.connection.id,
    userId: input.targetUserId,
    permission,
  };
  return {
    ok: true,
    grant,
    audit: {
      tenantId: allowed.actor.tenantId,
      actorUserId: allowed.actor.userId,
      action: 'SERVICE_MEMBER_ADDED',
      provenance: {
        tenantId: allowed.actor.tenantId,
        serviceConnectionId: connection.connection.id,
        serviceMemberId: grant.id,
        targetUserId: input.targetUserId,
        previousPermission: null,
        permission,
      },
    },
  };
}

export function planChangeServicePermission(input: {
  actor: JuryActor;
  connection: ServiceConnectionRow | null;
  members: readonly JuryMembership[];
  grants: readonly ServiceGrantRow[];
  targetUserId: string;
  permission: string;
  requestedTenantId?: string | null;
  actingUserId?: string | null;
  actorRole?: string | null;
}):
  | { ok: true; keepId: string; deleteIds: string[]; permission: JuryServicePermission; unchanged: boolean; audit: Omit<ServiceMemberAudit, 'id' | 'timestamp'> }
  | { ok: false; reason: ServiceMemberFailure } {
  void input.requestedTenantId;
  void input.actingUserId;
  void input.actorRole;
  const allowed = authorize(input.actor);
  if (!allowed.ok) return allowed;
  const connection = connectionForActor(allowed.actor, input.connection);
  if (!connection.ok) return connection;
  if (!memberInOrganization(input.members, allowed.actor.tenantId, input.targetUserId)) {
    return { ok: false, reason: 'NOT_IN_ORGANIZATION' };
  }
  const existing = input.grants.filter((grant) =>
    grant.tenantId === allowed.actor.tenantId
    && grant.connectionId === connection.connection.id
    && grant.userId === input.targetUserId);
  const current = highestServicePermission(existing);
  if (!current || existing.length === 0) return { ok: false, reason: 'NOT_FOUND' };
  const permission = normalizePermission(input.permission, null);
  if (typeof permission !== 'string') return permission;
  const keep = existing.slice().sort((left, right) => RANK[right.permission] - RANK[left.permission])[0]!;
  return {
    ok: true,
    keepId: keep.id,
    deleteIds: existing.filter((grant) => grant.id !== keep.id).map((grant) => grant.id),
    permission,
    unchanged: current === permission && existing.length === 1,
    audit: {
      tenantId: allowed.actor.tenantId,
      actorUserId: allowed.actor.userId,
      action: 'SERVICE_MEMBER_PERMISSION_CHANGED',
      provenance: {
        tenantId: allowed.actor.tenantId,
        serviceConnectionId: connection.connection.id,
        serviceMemberId: keep.id,
        targetUserId: input.targetUserId,
        previousPermission: current,
        permission,
      },
    },
  };
}

export function planRemoveServiceMember(input: {
  actor: JuryActor;
  connection: ServiceConnectionRow | null;
  members: readonly JuryMembership[];
  grants: readonly ServiceGrantRow[];
  targetUserId: string;
  requestedTenantId?: string | null;
  actingUserId?: string | null;
  actorRole?: string | null;
}):
  | { ok: true; deleteIds: string[]; membershipKept: boolean; audit: Omit<ServiceMemberAudit, 'id' | 'timestamp'> }
  | { ok: false; reason: ServiceMemberFailure } {
  void input.requestedTenantId;
  void input.actingUserId;
  void input.actorRole;
  const allowed = authorize(input.actor);
  if (!allowed.ok) return allowed;
  const connection = connectionForActor(allowed.actor, input.connection);
  if (!connection.ok) return connection;
  const existing = input.grants.filter((grant) =>
    grant.tenantId === allowed.actor.tenantId
    && grant.connectionId === connection.connection.id
    && grant.userId === input.targetUserId);
  const current = highestServicePermission(existing);
  if (!current) return { ok: false, reason: 'NOT_FOUND' };
  const primary = existing.slice().sort((left, right) => RANK[right.permission] - RANK[left.permission])[0]!;
  return {
    ok: true,
    deleteIds: existing.map((grant) => grant.id),
    membershipKept: memberInOrganization(input.members, allowed.actor.tenantId, input.targetUserId),
    audit: {
      tenantId: allowed.actor.tenantId,
      actorUserId: allowed.actor.userId,
      action: 'SERVICE_MEMBER_REMOVED',
      provenance: {
        tenantId: allowed.actor.tenantId,
        serviceConnectionId: connection.connection.id,
        serviceMemberId: primary.id,
        targetUserId: input.targetUserId,
        previousPermission: current,
        permission: null,
      },
    },
  };
}

export type ServiceMemberDb = {
  lockConnection(tenantId: string, connectionId: string): Promise<ServiceConnectionRow | null>;
  listMemberships(tenantId: string): Promise<JuryMembership[]>;
  listGrants(tenantId: string, connectionId: string): Promise<ServiceGrantRow[]>;
  insertGrant(row: ServiceGrantRow): Promise<void>;
  setGrantPermission(id: string, permission: JuryServicePermission): Promise<void>;
  deleteGrants(ids: readonly string[]): Promise<void>;
  appendAudit(event: ServiceMemberAudit): Promise<void>;
};

export async function commitAddServiceMember(
  input: {
    actor: JuryActor;
    connectionId: string;
    targetUserId: string;
    permission?: string | null;
    now: string;
    allocateId?: () => string;
    allocateAuditId?: () => string;
    requestedTenantId?: string | null;
    actingUserId?: string | null;
    actorRole?: string | null;
  },
  db: ServiceMemberDb,
): Promise<{ ok: true; grant: ServiceGrantRow; audit: ServiceMemberAudit } | { ok: false; reason: ServiceMemberFailure }> {
  const allowed = authorize(input.actor);
  if (!allowed.ok) return allowed;
  const connection = await db.lockConnection(allowed.actor.tenantId, input.connectionId);
  const [members, grants] = await Promise.all([
    db.listMemberships(allowed.actor.tenantId),
    connection ? db.listGrants(allowed.actor.tenantId, connection.id) : Promise.resolve([]),
  ]);
  const planned = planAddServiceMember({ ...input, connection, members, grants });
  if (!planned.ok) return planned;
  await db.insertGrant(planned.grant);
  const audit: ServiceMemberAudit = { ...planned.audit, id: input.allocateAuditId?.() ?? `audit-${planned.grant.id}`, timestamp: input.now };
  await db.appendAudit(audit);
  return { ok: true, grant: planned.grant, audit };
}

export async function commitChangeServicePermission(
  input: {
    actor: JuryActor;
    connectionId: string;
    targetUserId: string;
    permission: string;
    now: string;
    allocateAuditId?: () => string;
    requestedTenantId?: string | null;
    actingUserId?: string | null;
    actorRole?: string | null;
  },
  db: ServiceMemberDb,
): Promise<{ ok: true; audit: ServiceMemberAudit | null } | { ok: false; reason: ServiceMemberFailure }> {
  const allowed = authorize(input.actor);
  if (!allowed.ok) return allowed;
  const connection = await db.lockConnection(allowed.actor.tenantId, input.connectionId);
  const [members, grants] = await Promise.all([
    db.listMemberships(allowed.actor.tenantId),
    connection ? db.listGrants(allowed.actor.tenantId, connection.id) : Promise.resolve([]),
  ]);
  const planned = planChangeServicePermission({ ...input, connection, members, grants });
  if (!planned.ok) return planned;
  if (!planned.unchanged) {
    await db.setGrantPermission(planned.keepId, planned.permission);
    if (planned.deleteIds.length > 0) await db.deleteGrants(planned.deleteIds);
  }
  const audit: ServiceMemberAudit = { ...planned.audit, id: input.allocateAuditId?.() ?? `audit-${planned.keepId}`, timestamp: input.now };
  if (!planned.unchanged) await db.appendAudit(audit);
  return { ok: true, audit: planned.unchanged ? null : audit };
}

export async function commitRemoveServiceMember(
  input: {
    actor: JuryActor;
    connectionId: string;
    targetUserId: string;
    now: string;
    allocateAuditId?: () => string;
    requestedTenantId?: string | null;
    actingUserId?: string | null;
    actorRole?: string | null;
  },
  db: ServiceMemberDb,
): Promise<{ ok: true; audit: ServiceMemberAudit } | { ok: false; reason: ServiceMemberFailure }> {
  const allowed = authorize(input.actor);
  if (!allowed.ok) return allowed;
  const connection = await db.lockConnection(allowed.actor.tenantId, input.connectionId);
  const [members, grants] = await Promise.all([
    db.listMemberships(allowed.actor.tenantId),
    connection ? db.listGrants(allowed.actor.tenantId, connection.id) : Promise.resolve([]),
  ]);
  const planned = planRemoveServiceMember({ ...input, connection, members, grants });
  if (!planned.ok) return planned;
  await db.deleteGrants(planned.deleteIds);
  const audit: ServiceMemberAudit = { ...planned.audit, id: input.allocateAuditId?.() ?? `audit-${input.targetUserId}`, timestamp: input.now };
  await db.appendAudit(audit);
  return { ok: true, audit };
}
