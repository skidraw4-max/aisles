import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import {
  commitMemberRemovalWithServiceCleanup,
  type MemberCleanupDb,
} from './member-service-cleanup';
import { JURY_MEMBER_ROLES, type JuryMembership } from './records';
import { JURY_SERVICE_PERMISSIONS } from './service-permission';

function oneOf<T extends string>(values: readonly T[], value: string): T | null {
  return (values as readonly string[]).includes(value) ? (value as T) : null;
}

function toMembership(row: { id: string; tenantId: string; userId: string; role: string; createdAt: Date }): JuryMembership | null {
  const role = oneOf(JURY_MEMBER_ROLES, row.role);
  if (!role) return null;
  return { id: row.id, tenantId: row.tenantId, userId: row.userId, role, createdAt: row.createdAt.toISOString() };
}

export function cleanupDb(tx: Prisma.TransactionClient): MemberCleanupDb {
  return {
    async lockTenantMemberships(tenantId) {
      const rows = await tx.$queryRaw<Array<{ id: string; tenantId: string; userId: string; role: string; createdAt: Date }>>`
        SELECT id, "tenantId", "userId", role::text AS role, "createdAt"
        FROM "JuryMembership"
        WHERE "tenantId" = ${tenantId}
        FOR UPDATE
      `;
      return rows.flatMap((row) => {
        const mapped = toMembership(row);
        return mapped && mapped.tenantId === tenantId ? [mapped] : [];
      });
    },
    async updateRole(id, role) {
      await tx.juryMembership.update({ where: { id }, data: { role } });
    },
    async deleteMembership(id) {
      await tx.juryMembership.delete({ where: { id } });
    },
    async listUserGrants(tenantId, userId) {
      const rows = await tx.juryServiceMember.findMany({
        where: { tenantId, userId },
        select: { id: true, tenantId: true, connectionId: true, userId: true, permission: true },
      });
      return rows.flatMap((row) => {
        const permission = oneOf(JURY_SERVICE_PERMISSIONS, row.permission);
        if (!permission || row.tenantId !== tenantId || row.userId !== userId) return [];
        return [{ id: row.id, tenantId: row.tenantId, connectionId: row.connectionId, userId: row.userId, permission }];
      });
    },
    async deleteUserGrants(tenantId, userId) {
      await tx.juryServiceMember.deleteMany({ where: { tenantId, userId } });
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
    async appendServiceAudit(event) {
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

export async function removeOrganizationMemberWithServiceCleanup(
  input: Parameters<typeof commitMemberRemovalWithServiceCleanup>[0],
): Promise<Awaited<ReturnType<typeof commitMemberRemovalWithServiceCleanup>>> {
  return prisma.$transaction((tx) => commitMemberRemovalWithServiceCleanup(input, cleanupDb(tx)));
}
