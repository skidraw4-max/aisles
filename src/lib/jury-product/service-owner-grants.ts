/**
 * RM-10 / I-008: when a service connection is created, the organization's OWNERs (and the creator,
 * at the level their role historically implied) receive service grants in the same transaction,
 * so the connection is usable right after creation. Strictly tenant-scoped: only memberships of
 * `tenantId` are read and every grant row carries that same tenantId.
 */
import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { JURY_MEMBER_ROLES, type JuryMemberRole } from './records';
import { migratedServicePermissions, type JuryServicePermission } from './service-permission';

export type OwnerGrantRow = { tenantId: string; connectionId: string; userId: string; permission: JuryServicePermission };

/** Pure planner. Memberships from other tenants are ignored. */
export function planOwnerGrants(input: {
  tenantId: string;
  connectionId: string;
  creatorUserId: string | null;
  memberships: readonly { tenantId: string; userId: string; role: string }[];
}): OwnerGrantRow[] {
  const byUser = new Map<string, Set<JuryServicePermission>>();
  const add = (userId: string, role: JuryMemberRole) => {
    const set = byUser.get(userId) ?? new Set<JuryServicePermission>();
    for (const p of migratedServicePermissions(role)) set.add(p);
    byUser.set(userId, set);
  };
  for (const m of input.memberships) {
    if (m.tenantId !== input.tenantId) continue;
    if (!(JURY_MEMBER_ROLES as readonly string[]).includes(m.role)) continue;
    const role = m.role as JuryMemberRole;
    if (role === 'OWNER' || m.userId === input.creatorUserId) add(m.userId, role);
  }
  return [...byUser.entries()].flatMap(([userId, perms]) =>
    [...perms].map((permission) => ({ tenantId: input.tenantId, connectionId: input.connectionId, userId, permission })));
}

export async function grantOwnersOnNewConnection(
  tx: Prisma.TransactionClient,
  input: { tenantId: string; connectionId: string; creatorUserId: string | null },
): Promise<number> {
  const memberships = await tx.juryMembership.findMany({
    where: { tenantId: input.tenantId },
    select: { tenantId: true, userId: true, role: true },
  });
  const rows = planOwnerGrants({ ...input, memberships });
  if (rows.length === 0) return 0;
  const result = await tx.juryServiceMember.createMany({
    data: rows.map((row) => ({ id: randomUUID(), ...row })),
    skipDuplicates: true,
  });
  return result.count;
}
