'use server';

import { ensurePrismaUser } from '@/lib/ensure-user';
import { juryEmailVerification } from '@/lib/jury-product/jury-email-gate';
import { createOrganizationInvitationRecord, newJuryId } from '@/lib/jury-product/jury-db';
import { invitationMessage } from '@/lib/jury-product/organization-invitation';
import { juryInvitationHref } from '@/lib/jury-product/jury-url';
import type { JuryMemberRole } from '@/lib/jury-product/records';
import { getJuryActor } from '@/lib/jury-product/session';
import { createClient } from '@/lib/supabase/server';

export async function createJuryInvitation(formData: FormData): Promise<
  | { ok: true; invitationId: string; invitationUrl: string; expiresAt: string }
  | { ok: false; message: string }
> {
  const email = String(formData.get('email') ?? '');
  const role = String(formData.get('role') ?? 'VIEWER');
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user?.id || juryEmailVerification(user) === 'unauthenticated') {
      return { ok: false, message: invitationMessage('UNAUTHENTICATED', 'create') };
    }
    if (juryEmailVerification(user) !== 'verified') {
      return { ok: false, message: invitationMessage('EMAIL_UNVERIFIED', 'create') };
    }
    await ensurePrismaUser(user);
    const actor = await getJuryActor();
    const decision = await createOrganizationInvitationRecord({
      actor,
      email,
      role: role as JuryMemberRole,
      now: new Date().toISOString(),
      allocateId: newJuryId,
      allocateAuditId: newJuryId,
    });
    if (!decision.ok) return { ok: false, message: invitationMessage(decision.reason, 'create') };
    return {
      ok: true,
      invitationId: decision.invitation.id,
      expiresAt: decision.invitation.expiresAt,
      invitationUrl: juryInvitationHref(decision.token),
    };
  } catch {
    return { ok: false, message: invitationMessage('FAILED', 'create') };
  }
}
