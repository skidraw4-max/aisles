import { createClient } from '@/lib/supabase/server';
import { resolveJuryActor, type JuryActor } from './access';
import { isJuryStoreUnavailable, listMembershipsForUser } from './jury-db';

/** Session user plus JuryMembership rows. clientTenantId cannot select a tenant. */
export async function getJuryActor(clientTenantId?: string | null): Promise<JuryActor> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.id) {
    return resolveJuryActor({ userId: null, memberships: [], clientTenantId });
  }
  try {
    const memberships = await listMembershipsForUser(user.id);
    return resolveJuryActor({ userId: user.id, memberships, clientTenantId });
  } catch (error) {
    if (isJuryStoreUnavailable(error)) return { ok: false, reason: 'STORE_UNAVAILABLE' };
    throw error;
  }
}
