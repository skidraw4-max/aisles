'use server';
/** P1 (JD t568): save the service's site context (user-entered, non-secret) into providerConfig.siteContext. */
import { revalidatePath } from 'next/cache';
import { getJuryActor } from '@/lib/jury-product/session';

export type SiteContextActionResult = { ok: true } | { ok: false; reason: string } | null;

export async function saveSiteContextAction(_prev: SiteContextActionResult, formData: FormData): Promise<SiteContextActionResult> {
  const { saveSiteContext, createPrismaSiteContextStore } = await import('@/lib/jury-product/site-context');
  const connectionId = String(formData.get('connectionId') ?? '');
  const result = await saveSiteContext({
    actor: await getJuryActor(),
    connectionId,
    input: {
      siteType: String(formData.get('siteType') ?? ''),
      primaryUsers: String(formData.get('primaryUsers') ?? ''),
      coreTasks: String(formData.get('coreTasks') ?? ''),
      brandTraits: String(formData.get('brandTraits') ?? ''),
      referenceUrl: String(formData.get('referenceUrl') ?? ''),
    },
    store: await createPrismaSiteContextStore(),
  });
  if (!result.ok) return { ok: false, reason: result.reason };
  revalidatePath(`/jury/services/${connectionId}`);
  return { ok: true };
}
