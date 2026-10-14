import { cookies } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import { JURY_ACTIVE_ORG_COOKIE } from './active-organization';
import { resolveJuryActor, type JuryActor } from './access';
import { juryEmailVerification } from './jury-email-gate';
import { isJuryStoreUnavailable, listMembershipsForUser } from './jury-db';

export type JuryEntry = JuryActor | { ok: false; reason: 'EMAIL_UNVERIFIED' };

/** Session user plus JuryMembership rows. clientTenantId and the raw cookie cannot select a tenant alone. */
export async function getJuryEntry(clientTenantId?: string | null): Promise<JuryEntry> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.id || juryEmailVerification(user) === 'unauthenticated') {
    return resolveJuryActor({ userId: null, memberships: [], clientTenantId });
  }
  if (juryEmailVerification(user) === 'unverified') return { ok: false, reason: 'EMAIL_UNVERIFIED' };
  try {
    const cookieStore = await cookies();
    const activeTenantId = cookieStore.get(JURY_ACTIVE_ORG_COOKIE)?.value ?? null;
    const memberships = await listMembershipsForUser(user.id);
    return resolveJuryActor({ userId: user.id, memberships, clientTenantId, activeTenantId });
  } catch (error) {
    if (isJuryStoreUnavailable(error)) return { ok: false, reason: 'STORE_UNAVAILABLE' };
    throw error;
  }
}

export async function getJuryActor(clientTenantId?: string | null): Promise<JuryActor> {
  const entry = await getJuryEntry(clientTenantId);
  if (!entry.ok && entry.reason === 'EMAIL_UNVERIFIED') return { ok: false, reason: 'UNAUTHENTICATED' };
  return entry;
}
