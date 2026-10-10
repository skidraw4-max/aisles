'use server';

import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { ensurePrismaUser } from '@/lib/ensure-user';
import { activeOrganizationCookie } from '@/lib/jury-product/active-organization';
import { juryEmailVerification } from '@/lib/jury-product/jury-email-gate';
import { isJuryStoreUnavailable, createOwnedOrganization, listMembershipsForUser } from '@/lib/jury-product/jury-db';
import { normalizeOrganizationName, organizationCreationMessage } from '@/lib/jury-product/organization-creation';
import { planOrganizationSwitch } from '@/lib/jury-product/organization-switch';
import { juryHref } from '@/lib/jury-product/jury-url';
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';

export async function createJuryOrganization(formData: FormData): Promise<{ ok: true } | { ok: false; message: string }> {
  const name = normalizeOrganizationName(String(formData.get('organizationName') ?? formData.get('tenantName') ?? ''));
  if (!name.ok) return { ok: false, message: organizationCreationMessage(name.reason) };
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user?.id || juryEmailVerification(user) === 'unauthenticated') {
      return { ok: false, message: organizationCreationMessage('UNAUTHENTICATED') };
    }
    if (juryEmailVerification(user) !== 'verified') {
      return { ok: false, message: organizationCreationMessage('EMAIL_UNVERIFIED') };
    }
    await ensurePrismaUser(user);
    const decision = await createOwnedOrganization({ userId: user.id, tenantName: name.name });
    if (!decision.ok || decision.kind !== 'CREATE_TENANT') {
      return { ok: false, message: organizationCreationMessage('FAILED') };
    }
    const cookie = activeOrganizationCookie(decision.tenantId);
    const store = await cookies();
    store.set(cookie.name, cookie.value, cookie.options);
    return { ok: true };
  } catch {
    return { ok: false, message: organizationCreationMessage('FAILED') };
  }
}

export async function switchJuryOrganization(formData: FormData): Promise<void> {
  const requested = String(formData.get('tenantId') ?? '');
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.id || juryEmailVerification(user) !== 'verified') redirect(juryHref('/login'));
  try {
    const memberships = await listMembershipsForUser(user.id);
    const plan = planOrganizationSwitch({ userId: user.id, memberships, tenantId: requested });
    if (plan.ok) {
      const cookie = activeOrganizationCookie(plan.tenantId);
      const store = await cookies();
      store.set(cookie.name, cookie.value, cookie.options);
    }
  } catch (error) {
    if (!isJuryStoreUnavailable(error)) throw error;
  }
  revalidatePath('/jury', 'layout');
  redirect(juryHref('/'));
}
