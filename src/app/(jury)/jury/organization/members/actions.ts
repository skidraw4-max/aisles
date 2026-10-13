'use server';

import { revalidatePath } from 'next/cache';
import { ensurePrismaUser } from '@/lib/ensure-user';
import { juryEmailVerification } from '@/lib/jury-product/jury-email-gate';
import { changeOrganizationMemberRole, newJuryId, removeOrganizationMember } from '@/lib/jury-product/jury-db';
import { memberManagementMessage } from '@/lib/jury-product/member-management';
import type { JuryMemberRole } from '@/lib/jury-product/records';
import { getJuryActor } from '@/lib/jury-product/session';
import { createClient } from '@/lib/supabase/server';

async function actorForMemberChange(): Promise<Awaited<ReturnType<typeof getJuryActor>> | { ok: false; reason: 'UNAUTHENTICATED' }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.id || juryEmailVerification(user) !== 'verified') return { ok: false, reason: 'UNAUTHENTICATED' };
  await ensurePrismaUser(user);
  return getJuryActor();
}

export async function changeJuryMemberRole(formData: FormData): Promise<{ ok: true } | { ok: false; message: string }> {
  const targetUserId = String(formData.get('memberUserId') ?? '');
  const role = String(formData.get('role') ?? '') as JuryMemberRole;
  try {
    const actor = await actorForMemberChange();
    const decision = await changeOrganizationMemberRole({
      actor,
      targetUserId,
      role,
      now: new Date().toISOString(),
      allocateAuditId: newJuryId,
    });
    if (!decision.ok) return { ok: false, message: memberManagementMessage(decision.reason, 'role') };
    revalidatePath('/jury', 'layout');
    return { ok: true };
  } catch {
    return { ok: false, message: memberManagementMessage('FAILED', 'role') };
  }
}

export async function removeJuryMember(formData: FormData): Promise<{ ok: true } | { ok: false; message: string }> {
  const targetUserId = String(formData.get('memberUserId') ?? '');
  try {
    const actor = await actorForMemberChange();
    const decision = await removeOrganizationMember({
      actor,
      targetUserId,
      now: new Date().toISOString(),
      allocateAuditId: newJuryId,
    });
    if (!decision.ok) return { ok: false, message: memberManagementMessage(decision.reason, 'remove') };
    revalidatePath('/jury', 'layout');
    return { ok: true };
  } catch {
    return { ok: false, message: memberManagementMessage('FAILED', 'remove') };
  }
}
