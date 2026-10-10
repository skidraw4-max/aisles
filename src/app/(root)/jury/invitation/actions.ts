'use server';

import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { ensurePrismaUser } from '@/lib/ensure-user';
import { activeOrganizationCookie } from '@/lib/jury-product/active-organization';
import { juryEmailVerification } from '@/lib/jury-product/jury-email-gate';
import { acceptOrganizationInvitationRecord, newJuryId } from '@/lib/jury-product/jury-db';
import { invitationMessage } from '@/lib/jury-product/organization-invitation';
import { createClient } from '@/lib/supabase/server';

export async function acceptJuryInvitation(formData: FormData): Promise<{ ok: true } | { ok: false; message: string }> {
  const presentedToken = String(formData.get('token') ?? '');
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user?.id || juryEmailVerification(user) === 'unauthenticated') {
      return { ok: false, message: invitationMessage('UNAUTHENTICATED') };
    }
    if (juryEmailVerification(user) !== 'verified') {
      return { ok: false, message: invitationMessage('EMAIL_UNVERIFIED') };
    }
    await ensurePrismaUser(user);
    const decision = await acceptOrganizationInvitationRecord({
      presentedToken,
      userId: user.id,
      authenticatedEmail: user.email ?? null,
      emailVerified: true,
      now: new Date().toISOString(),
      allocateId: newJuryId,
      allocateAuditId: newJuryId,
    });
    if (!decision.ok) return { ok: false, message: invitationMessage(decision.reason) };
    const cookie = activeOrganizationCookie(decision.membership.tenantId);
    const store = await cookies();
    store.set(cookie.name, cookie.value, cookie.options);
    revalidatePath('/jury', 'layout');
    return { ok: true };
  } catch {
    return { ok: false, message: invitationMessage('FAILED') };
  }
}
