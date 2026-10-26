'use server';

/**
 * I-040/I-044: server actions for READ_ONLY_ACCOUNT consent, credential storage and observation.
 * Credentials are encrypted with the env KEK provider (JURY_ACCOUNT_CREDENTIAL_KEK, referenced by name only).
 * When the KEK is missing the actions report KEY_NOT_CONFIGURED and nothing is stored.
 */
import { getJuryActor } from '@/lib/jury-product/session';
import { createPrismaReadonlyAccountStore, persistReadonlyAccountConsent, persistReadonlyAccountCredential } from '@/lib/jury-product/services/readonly-account/store';
import { READONLY_ACCOUNT_PHASE1_ENABLED } from '@/lib/jury-product/services/readonly-account/flags';
import { normalizeObservationScope } from '@/lib/jury-product/services/readonly-account/consent';
import { resolveEnvKeyProvider } from '@/lib/jury-product/services/readonly-account/key-provider';
import type { ObservationSummary } from '@/lib/jury-product/services/readonly-account/observation-evidence';
import type { ObservationRunFailure } from '@/lib/jury-product/services/readonly-account/observation-run';

export type ReadonlyAccountActionResult =
  | { ok: true; summary?: ObservationSummary }
  | { ok: false; reason: ObservationRunFailure };

function lines(value: FormDataEntryValue | null): string[] {
  return typeof value === 'string' ? value.split(/\r?\n/).map((v) => v.trim()).filter(Boolean) : [];
}

function scopeOf(formData: FormData) {
  return { allowedOrigins: lines(formData.get('allowedOrigins')), paths: lines(formData.get('paths')) };
}

export async function acceptReadonlyAccountConsentAction(formData: FormData): Promise<ReadonlyAccountActionResult> {
  if (!READONLY_ACCOUNT_PHASE1_ENABLED) return { ok: false, reason: 'NOT_IMPLEMENTED' };
  const result = await persistReadonlyAccountConsent({
    actor: await getJuryActor(),
    connectionId: String(formData.get('connectionId') ?? ''),
    scope: scopeOf(formData),
    accepted: formData.get('consent') === 'on',
    now: new Date().toISOString(),
    store: await createPrismaReadonlyAccountStore(),
  });
  return result.ok ? { ok: true } : result;
}

export async function storeReadonlyAccountCredentialAction(formData: FormData): Promise<ReadonlyAccountActionResult> {
  if (!READONLY_ACCOUNT_PHASE1_ENABLED) return { ok: false, reason: 'NOT_IMPLEMENTED' };
  const keys = resolveEnvKeyProvider();
  if (!keys.ok) return { ok: false, reason: 'KEY_NOT_CONFIGURED' };
  const scope = normalizeObservationScope(scopeOf(formData));
  if (!scope.ok) return scope;
  const result = await persistReadonlyAccountCredential({
    actor: await getJuryActor(),
    connectionId: String(formData.get('connectionId') ?? ''),
    scope: scope.scope,
    username: formData.get('username'),
    password: formData.get('password'),
    now: new Date().toISOString(),
    keyProvider: keys.provider,
    store: await createPrismaReadonlyAccountStore(),
  });
  return result.ok ? { ok: true } : result;
}

export async function runReadonlyAccountObservationAction(formData: FormData): Promise<ReadonlyAccountActionResult> {
  if (!READONLY_ACCOUNT_PHASE1_ENABLED) return { ok: false, reason: 'NOT_IMPLEMENTED' };
  const [{ runStoredCredentialObservation, createPrismaObservationRunStore }, { createServerlessObservationDriver }] = await Promise.all([
    import('@/lib/jury-product/services/readonly-account/observation-run'),
    import('@/lib/jury-product/services/readonly-account/browser-runtime'),
  ]);
  const result = await runStoredCredentialObservation({
    actor: await getJuryActor(),
    connectionId: String(formData.get('connectionId') ?? ''),
    scope: scopeOf(formData),
    login: {
      loginUrl: formData.get('loginUrl'),
      usernameSelector: formData.get('usernameSelector'),
      passwordSelector: formData.get('passwordSelector'),
      submitSelector: formData.get('submitSelector'),
      successPathPrefix: formData.get('successPathPrefix'),
    },
    store: await createPrismaObservationRunStore(),
    keys: resolveEnvKeyProvider(),
    createDriver: createServerlessObservationDriver,
  });
  return result.ok ? { ok: true, summary: result.summary } : result;
}
