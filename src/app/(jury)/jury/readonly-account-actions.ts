'use server';

/**
 * I-040: server actions for READ_ONLY_ACCOUNT consent and credential storage.
 * Disabled until the migration and KMS key provider receive separate approval; not wired into any page yet.
 */
import { getJuryActor } from '@/lib/jury-product/session';
import { createPrismaReadonlyAccountStore, persistReadonlyAccountConsent } from '@/lib/jury-product/services/readonly-account/store';
import type { ReadonlyAccountFailure } from '@/lib/jury-product/services/readonly-account/consent';

export type ReadonlyAccountActionResult = { ok: true } | { ok: false; reason: ReadonlyAccountFailure };

const READONLY_ACCOUNT_PHASE1_ENABLED = false as boolean;

function lines(value: FormDataEntryValue | null): string[] {
  return typeof value === 'string' ? value.split(/\r?\n/).map((v) => v.trim()).filter(Boolean) : [];
}

export async function acceptReadonlyAccountConsentAction(formData: FormData): Promise<ReadonlyAccountActionResult> {
  if (!READONLY_ACCOUNT_PHASE1_ENABLED) return { ok: false, reason: 'NOT_IMPLEMENTED' };
  const result = await persistReadonlyAccountConsent({
    actor: await getJuryActor(),
    connectionId: String(formData.get('connectionId') ?? ''),
    scope: { allowedOrigins: lines(formData.get('allowedOrigins')), paths: lines(formData.get('paths')) },
    accepted: formData.get('consent') === 'on',
    now: new Date().toISOString(),
    store: await createPrismaReadonlyAccountStore(),
  });
  return result.ok ? { ok: true } : result;
}

export async function storeReadonlyAccountCredentialAction(formData: FormData): Promise<ReadonlyAccountActionResult> {
  void formData;
  // Requires a production CredentialKeyProvider (KMS), which needs separate approval. The test provider must never be used here.
  if (!READONLY_ACCOUNT_PHASE1_ENABLED) return { ok: false, reason: 'NOT_IMPLEMENTED' };
  return { ok: false, reason: 'NOT_IMPLEMENTED' };
}
