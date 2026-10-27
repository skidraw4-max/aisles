/** I-079: deleted (DISCONNECTED) connections cannot get new consents, credentials, runs, GA4, or ownership checks. */
import type { JuryActor } from '../../access';

export type ConnectionStatusLookup = (tenantId: string, connectionId: string) => Promise<string | null>;

export async function isDeletedConnection(actor: JuryActor, connectionId: string, lookup?: ConnectionStatusLookup): Promise<boolean> {
  if (!actor.ok || !connectionId) return false; // downstream action returns its own auth / not-found result
  const read: ConnectionStatusLookup = lookup ?? (async (tenantId, id) => {
    const { prisma } = await import('@/lib/prisma');
    const row = await prisma.juryServiceConnection.findFirst({ where: { id, tenantId }, select: { status: true } });
    return row?.status ?? null;
  });
  return (await read(actor.tenantId, connectionId)) === 'DISCONNECTED';
}
