import { loadJuryCatalog, isJuryStoreUnavailable } from '@/lib/jury-product/jury-db';
import { readJuryConsole } from '@/lib/jury-product/console-view';
import { getJuryActor } from '@/lib/jury-product/session';
import type { JuryActor } from '@/lib/jury-product/access';
import type { JuryConsoleView } from '@/lib/jury-product/console-view';

export type ShellIdentity = { tenantName: string | null; userLabel: string | null };

export async function loadShellIdentity(actor: { userId: string; tenantId: string }): Promise<ShellIdentity> {
  try {
    const { prisma } = await import('@/lib/prisma');
    const [tenant, user] = await Promise.all([
      prisma.juryTenant.findFirst({ where: { id: actor.tenantId }, select: { id: true, name: true } }),
      prisma.user.findFirst({ where: { id: actor.userId }, select: { id: true, username: true } }),
    ]);
    if (!tenant || tenant.id !== actor.tenantId) return { tenantName: null, userLabel: null };
    return {
      tenantName: tenant.name.trim() ? tenant.name : null,
      userLabel: user?.id === actor.userId && user.username.trim() ? user.username : null,
    };
  } catch {
    return { tenantName: null, userLabel: null };
  }
}

export async function loadJuryShell(searchParams: Promise<{ result?: string | string[] }>): Promise<{
  actor: JuryActor;
  view: JuryConsoleView | null;
  notice?: string;
}> {
  const params = await searchParams;
  const raw = params.result;
  const notice = Array.isArray(raw) ? raw[0] : raw;
  const actor = await getJuryActor();
  if (!actor.ok) return { actor, view: null, notice };
  try {
    const catalog = await loadJuryCatalog(actor.tenantId);
    return { actor, view: readJuryConsole(actor, catalog), notice };
  } catch (error) {
    if (isJuryStoreUnavailable(error)) {
      return { actor: { ok: false, reason: 'STORE_UNAVAILABLE' }, view: null, notice };
    }
    throw error;
  }
}
