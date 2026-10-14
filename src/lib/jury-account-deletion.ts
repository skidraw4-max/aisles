import type { Prisma } from '@prisma/client';

/** Remove only the account's Jury links; preserve tenants, decisions, and audit history. */
export async function deleteUserJuryRecords(tx: Prisma.TransactionClient, userId: string): Promise<void> {
  await tx.organizationInvitation.deleteMany({ where: { invitedBy: userId } });
  await tx.juryServiceMember.deleteMany({ where: { userId } });
  await tx.juryMembership.deleteMany({ where: { userId } });
}
