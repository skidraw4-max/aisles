import { loadJuryCatalog, isJuryStoreUnavailable } from '@/lib/jury-product/jury-db';
import { readJuryConsole } from '@/lib/jury-product/console-view';
import { restrictJuryConsole } from '@/lib/jury-product/service-feature-authorization';
import { listUserServiceGrants } from '@/lib/jury-product/service-feature-guard';
import { getJuryEntry } from '@/lib/jury-product/session';
import { createClient } from '@/lib/supabase/server';
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

export async function readJurySessionEmail(): Promise<string | null> {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    return typeof user?.email === 'string' && user.email.trim() ? user.email.trim() : null;
  } catch {
    return null;
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
  const actor = await getJuryEntry();
  if (!actor.ok) {
    return {
      actor: { ok: false, reason: actor.reason === 'EMAIL_UNVERIFIED' ? 'UNAUTHENTICATED' : actor.reason },
      view: null,
      notice: actor.reason === 'EMAIL_UNVERIFIED' ? 'EMAIL_UNVERIFIED' : notice,
    };
  }
  try {
    const catalog = await loadJuryCatalog(actor.tenantId);
    const view = readJuryConsole(actor, catalog);
    const grants = view ? await listUserServiceGrants(actor.tenantId, actor.userId) : [];
    return { actor, view: view ? restrictJuryConsole(view, actor, grants) : null, notice };
  } catch (error) {
    if (isJuryStoreUnavailable(error)) {
      return { actor: { ok: false, reason: 'STORE_UNAVAILABLE' }, view: null, notice };
    }
    throw error;
  }
}
