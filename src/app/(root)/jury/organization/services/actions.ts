'use server';

import { revalidatePath } from 'next/cache';
import { ensurePrismaUser } from '@/lib/ensure-user';
import { juryEmailVerification } from '@/lib/jury-product/jury-email-gate';
import { newJuryId } from '@/lib/jury-product/jury-db';
import { serviceMemberMessage } from '@/lib/jury-product/service-member-management';
import {
  addServiceMemberRecord,
  changeServiceMemberRecord,
  removeServiceMemberRecord,
} from '@/lib/jury-product/service-member-db';
import { getJuryActor } from '@/lib/jury-product/session';
import { createClient } from '@/lib/supabase/server';

async function currentActor() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.id || juryEmailVerification(user) !== 'verified') return { ok: false as const, reason: 'UNAUTHENTICATED' as const };
  await ensurePrismaUser(user);
  return getJuryActor();
}

export async function addJuryServiceMember(formData: FormData): Promise<{ ok: true } | { ok: false; message: string }> {
  const connectionId = String(formData.get('serviceConnectionId') ?? '');
  const targetUserId = String(formData.get('memberUserId') ?? '');
  const permission = String(formData.get('permission') ?? 'VIEW');
  try {
    const actor = await currentActor();
    const decision = await addServiceMemberRecord({
      actor,
      connectionId,
      targetUserId,
      permission,
      now: new Date().toISOString(),
      allocateId: newJuryId,
      allocateAuditId: newJuryId,
    });
    if (!decision.ok) return { ok: false, message: serviceMemberMessage(decision.reason, 'add') };
    revalidatePath('/jury', 'layout');
    return { ok: true };
  } catch {
    return { ok: false, message: serviceMemberMessage('FAILED', 'add') };
  }
}

export async function changeJuryServiceMemberPermission(formData: FormData): Promise<{ ok: true } | { ok: false; message: string }> {
  const connectionId = String(formData.get('serviceConnectionId') ?? '');
  const targetUserId = String(formData.get('memberUserId') ?? '');
  const permission = String(formData.get('permission') ?? '');
  try {
    const actor = await currentActor();
    const decision = await changeServiceMemberRecord({
      actor,
      connectionId,
      targetUserId,
      permission,
      now: new Date().toISOString(),
      allocateAuditId: newJuryId,
    });
    if (!decision.ok) return { ok: false, message: serviceMemberMessage(decision.reason, 'change') };
    revalidatePath('/jury', 'layout');
    return { ok: true };
  } catch {
    return { ok: false, message: serviceMemberMessage('FAILED', 'change') };
  }
}

export async function removeJuryServiceMember(formData: FormData): Promise<{ ok: true } | { ok: false; message: string }> {
  const connectionId = String(formData.get('serviceConnectionId') ?? '');
  const targetUserId = String(formData.get('memberUserId') ?? '');
  try {
    const actor = await currentActor();
    const decision = await removeServiceMemberRecord({
      actor,
      connectionId,
      targetUserId,
      now: new Date().toISOString(),
      allocateAuditId: newJuryId,
    });
    if (!decision.ok) return { ok: false, message: serviceMemberMessage(decision.reason, 'remove') };
    revalidatePath('/jury', 'layout');
    return { ok: true };
  } catch {
    return { ok: false, message: serviceMemberMessage('FAILED', 'remove') };
  }
}
