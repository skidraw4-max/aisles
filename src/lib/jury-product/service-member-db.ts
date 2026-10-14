import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import type { JuryMembership } from './records';
import { JURY_MEMBER_ROLES } from './records';
import {
  commitAddServiceMember,
  commitChangeServicePermission,
  commitRemoveServiceMember,
  projectServiceAccess,
  type ServiceConnectionRow,
  type ServiceGrantRow,
  type ServiceMemberDb,
} from './service-member-management';
import { serviceAccessCounts } from './member-service-cleanup';
import { JURY_SERVICE_PERMISSIONS, type JuryServicePermission } from './service-permission';

function oneOf<T extends string>(values: readonly T[], value: string): T | null {
  return (values as readonly string[]).includes(value) ? (value as T) : null;
}

function memberDb(tx: Prisma.TransactionClient): ServiceMemberDb {
  return {
    async lockConnection(tenantId, connectionId) {
      const rows = await tx.$queryRaw<Array<{ id: string; tenantId: string; displayName: string }>>`
        SELECT id, "tenantId", "displayName"
        FROM "JuryServiceConnection"
        WHERE id = ${connectionId} AND "tenantId" = ${tenantId}
        FOR UPDATE
      `;
      const row = rows[0];
      if (!row || row.tenantId !== tenantId) return null;
      return { id: row.id, tenantId: row.tenantId, displayName: row.displayName };
    },
    async listMemberships(tenantId) {
      const rows = await tx.juryMembership.findMany({ where: { tenantId } });
      return rows.flatMap((row) => {
        const role = oneOf(JURY_MEMBER_ROLES, row.role);
        if (!role || row.tenantId !== tenantId) return [];
        const mapped: JuryMembership = {
          id: row.id,
          tenantId: row.tenantId,
          userId: row.userId,
          role,
          createdAt: row.createdAt.toISOString(),
        };
        return [mapped];
      });
    },
    async listGrants(tenantId, connectionId) {
      const rows = await tx.juryServiceMember.findMany({ where: { tenantId, connectionId } });
      return rows.flatMap((row) => {
        const permission = oneOf(JURY_SERVICE_PERMISSIONS, row.permission);
        if (!permission || row.tenantId !== tenantId || row.connectionId !== connectionId) return [];
        return [{
          id: row.id,
          tenantId: row.tenantId,
          connectionId: row.connectionId,
          userId: row.userId,
          permission,
        }];
      });
    },
    async insertGrant(row) {
      await tx.juryServiceMember.create({
        data: {
          id: row.id,
          tenantId: row.tenantId,
          connectionId: row.connectionId,
          userId: row.userId,
          permission: row.permission,
        },
      });
    },
    async setGrantPermission(id, permission) {
      await tx.juryServiceMember.update({ where: { id }, data: { permission } });
    },
    async deleteGrants(ids) {
      if (ids.length === 0) return;
      await tx.juryServiceMember.deleteMany({ where: { id: { in: [...ids] } } });
    },
    async appendAudit(event) {
      await tx.juryAuditEvent.create({
        data: {
          id: event.id,
          tenantId: event.tenantId,
          timestamp: new Date(event.timestamp),
          actor: event.actorUserId,
          action: event.action,
          provenance: event.provenance,
        },
      });
    },
  };
}

export async function addServiceMemberRecord(
  input: Parameters<typeof commitAddServiceMember>[0],
): Promise<Awaited<ReturnType<typeof commitAddServiceMember>>> {
  return prisma.$transaction((tx) => commitAddServiceMember(input, memberDb(tx)));
}

export async function changeServiceMemberRecord(
  input: Parameters<typeof commitChangeServicePermission>[0],
): Promise<Awaited<ReturnType<typeof commitChangeServicePermission>>> {
  return prisma.$transaction((tx) => commitChangeServicePermission(input, memberDb(tx)));
}

export async function removeServiceMemberRecord(
  input: Parameters<typeof commitRemoveServiceMember>[0],
): Promise<Awaited<ReturnType<typeof commitRemoveServiceMember>>> {
  return prisma.$transaction((tx) => commitRemoveServiceMember(input, memberDb(tx)));
}

export type ServiceAccessScreen = {
  connectionId: string;
  displayName: string;
  status: string;
  createdAt: string;
  memberCount: number;
  members: Array<{
    userId: string;
    email: string;
    displayName: string | null;
    orgRole: JuryMembership['role'] | null;
    permission: JuryServicePermission;
    grantedAt: string;
  }>;
  candidates: Array<{
    userId: string;
    email: string;
    displayName: string | null;
    orgRole: JuryMembership['role'];
  }>;
};

export async function countOrganizationServiceAccess(tenantId: string): Promise<Record<string, number>> {
  const rows = await prisma.juryServiceMember.findMany({
    where: { tenantId },
    select: { tenantId: true, userId: true, connectionId: true },
  });
  return serviceAccessCounts(rows, tenantId);
}

export async function listServiceAccess(tenantId: string): Promise<ServiceAccessScreen[]> {
  const [connections, grants, memberships] = await Promise.all([
    prisma.juryServiceConnection.findMany({
      where: { tenantId },
      orderBy: [{ displayName: 'asc' }, { id: 'asc' }],
      select: { id: true, tenantId: true, displayName: true, status: true, createdAt: true },
    }),
    prisma.juryServiceMember.findMany({
      where: { tenantId },
      select: {
        id: true,
        tenantId: true,
        connectionId: true,
        userId: true,
        permission: true,
        createdAt: true,
        user: { select: { email: true, username: true } },
      },
    }),
    prisma.juryMembership.findMany({
      where: { tenantId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        tenantId: true,
        userId: true,
        role: true,
        createdAt: true,
        user: { select: { email: true, username: true } },
      },
    }),
  ]);
  const connectionRows: ServiceConnectionRow[] = connections
    .filter((row) => row.tenantId === tenantId)
    .map((row) => ({ id: row.id, tenantId: row.tenantId, displayName: row.displayName }));
  const grantRows: ServiceGrantRow[] = grants.flatMap((row) => {
    const permission = oneOf(JURY_SERVICE_PERMISSIONS, row.permission);
    if (!permission || row.tenantId !== tenantId) return [];
    return [{ id: row.id, tenantId: row.tenantId, connectionId: row.connectionId, userId: row.userId, permission }];
  });
  const memberRows = memberships.flatMap((row) => {
    const role = oneOf(JURY_MEMBER_ROLES, row.role);
    if (!role || row.tenantId !== tenantId) return [];
    const displayName = row.user.username.trim();
    return [{
      id: row.id,
      tenantId: row.tenantId,
      userId: row.userId,
      role,
      createdAt: row.createdAt.toISOString(),
      email: row.user.email,
      displayName: displayName ? displayName : null,
    }];
  });
  const projected = projectServiceAccess({ tenantId, connections: connectionRows, grants: grantRows, members: memberRows });
  return projected.map((service) => {
    const connection = connections.find((row) => row.id === service.connectionId && row.tenantId === tenantId);
    return {
    ...service,
    status: connection?.status ?? '',
    createdAt: connection ? connection.createdAt.toISOString() : '',
    memberCount: service.members.length,
    members: service.members.map((member) => {
      const matched = grants.filter((row) => row.userId === member.userId && row.connectionId === service.connectionId && row.tenantId === tenantId);
      const user = matched[0]?.user;
      const email = member.email || user?.email || '';
      const displayName = member.displayName ?? (user?.username.trim() ? user.username.trim() : null);
      const grantedAt = matched
        .map((row) => row.createdAt.toISOString())
        .sort()
        .at(-1) ?? '';
      return { ...member, email, displayName, grantedAt };
    }),
    candidates: memberRows
      .filter((member) => !service.members.some((row) => row.userId === member.userId))
      .map((member) => ({
        userId: member.userId,
        email: member.email,
        displayName: member.displayName,
        orgRole: member.role,
      })),
    };
  });
}
