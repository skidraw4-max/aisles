'use server';

/**
 * I-040/I-044: server actions for READ_ONLY_ACCOUNT consent, credential storage and observation.
 * Credentials are encrypted with the env KEK provider (JURY_ACCOUNT_CREDENTIAL_KEK, referenced by name only).
 * When the KEK is missing the actions report KEY_NOT_CONFIGURED and nothing is stored.
 */
import { revalidatePath } from 'next/cache';
import { getJuryActor } from '@/lib/jury-product/session';
import {
  createPrismaReadonlyAccountStore,
  persistReadonlyAccountConsent,
  persistReadonlyAccountCredential,
  persistReadonlyAccountLoginSettings,
} from '@/lib/jury-product/services/readonly-account/store';
import { READONLY_ACCOUNT_PHASE1_ENABLED } from '@/lib/jury-product/services/readonly-account/flags';
import { normalizeObservationScope } from '@/lib/jury-product/services/readonly-account/consent';
import { resolveEnvKeyProvider } from '@/lib/jury-product/services/readonly-account/key-provider';
import type { ObservationSummary } from '@/lib/jury-product/services/readonly-account/observation-evidence';
import type { ObservationRunFailure } from '@/lib/jury-product/services/readonly-account/observation-run';

export type ReadonlyAccountActionResult =
  | { ok: true; summary?: ObservationSummary }
  | { ok: false; reason: ObservationRunFailure | 'CONNECTION_DELETED' };

function lines(value: FormDataEntryValue | null): string[] {
  return typeof value === 'string' ? value.split(/\r?\n/).map((v) => v.trim()).filter(Boolean) : [];
}

function scopeOf(formData: FormData) {
  return { allowedOrigins: lines(formData.get('allowedOrigins')), authOrigins: lines(formData.get('authOrigins')), paths: lines(formData.get('paths')) };
}

function loginOf(formData: FormData) {
  return {
    loginUrl: formData.get('loginUrl'),
    usernameSelector: formData.get('usernameSelector'),
    passwordSelector: formData.get('passwordSelector'),
    submitSelector: formData.get('submitSelector'),
    successPathPrefix: formData.get('successPathPrefix'),
  };
}

const blank = (v: FormDataEntryValue | null) => typeof v !== 'string' || v.trim() === '';

export async function acceptReadonlyAccountConsentAction(formData: FormData): Promise<ReadonlyAccountActionResult> {
  if (!READONLY_ACCOUNT_PHASE1_ENABLED) return { ok: false, reason: 'NOT_IMPLEMENTED' };
  if (await (await import('@/lib/jury-product/services/connection-delete/active-guard')).isDeletedConnection(await getJuryActor(), String(formData.get('connectionId') ?? ''))) return { ok: false, reason: 'CONNECTION_DELETED' };
  const result = await persistReadonlyAccountConsent({
    actor: await getJuryActor(),
    connectionId: String(formData.get('connectionId') ?? ''),
    scope: scopeOf(formData),
    accepted: formData.get('consent') === 'on',
    now: new Date().toISOString(),
    store: await createPrismaReadonlyAccountStore(),
  });
  if (result.ok) revalidatePath('/jury/services/[connectionId]', 'page');
  return result.ok ? { ok: true } : result;
}

export async function storeReadonlyAccountCredentialAction(formData: FormData): Promise<ReadonlyAccountActionResult> {
  if (!READONLY_ACCOUNT_PHASE1_ENABLED) return { ok: false, reason: 'NOT_IMPLEMENTED' };
  if (await (await import('@/lib/jury-product/services/connection-delete/active-guard')).isDeletedConnection(await getJuryActor(), String(formData.get('connectionId') ?? ''))) return { ok: false, reason: 'CONNECTION_DELETED' };
  const connectionId = String(formData.get('connectionId') ?? '');
  const login = blank(formData.get('loginUrl')) ? null : loginOf(formData);
  // I-054: 로그인 설정만 수정 (아이디·비밀번호 비움) → only the login plan is updated; the stored credential stays.
  if (login && blank(formData.get('username')) && blank(formData.get('password')) && formData.get('loginOnly') === '1') {
    const saved = await persistReadonlyAccountLoginSettings({ actor: await getJuryActor(), connectionId, login, store: await createPrismaReadonlyAccountStore() });
    if (saved.ok) revalidatePath('/jury/services/[connectionId]', 'page');
    return saved.ok ? { ok: true } : saved;
  }
  const keys = resolveEnvKeyProvider();
  if (!keys.ok) return { ok: false, reason: 'KEY_NOT_CONFIGURED' };
  // I-054: no scope typed → the scope stored with the consent is used (hash-verified server-side).
  const raw = scopeOf(formData);
  const typed = raw.allowedOrigins.length + raw.authOrigins.length + raw.paths.length > 0;
  const scope = typed ? normalizeObservationScope(raw) : null;
  if (scope && !scope.ok) return scope;
  const result = await persistReadonlyAccountCredential({
    actor: await getJuryActor(),
    connectionId,
    scope: scope ? scope.scope : null,
    username: formData.get('username'),
    password: formData.get('password'),
    login,
    now: new Date().toISOString(),
    keyProvider: keys.provider,
    store: await createPrismaReadonlyAccountStore(),
  });
  if (result.ok) revalidatePath('/jury/services/[connectionId]', 'page');
  return result.ok ? { ok: true } : result;
}

export async function runReadonlyAccountObservationAction(formData: FormData): Promise<ReadonlyAccountActionResult> {
  if (!READONLY_ACCOUNT_PHASE1_ENABLED) return { ok: false, reason: 'NOT_IMPLEMENTED' };
  if (await (await import('@/lib/jury-product/services/connection-delete/active-guard')).isDeletedConnection(await getJuryActor(), String(formData.get('connectionId') ?? ''))) return { ok: false, reason: 'CONNECTION_DELETED' };
  // I-073: ownership gate (only for connections created after JURY_OWNERSHIP_ENFORCE_FROM; off by default).
  const { enforceOwnershipGate } = await import('@/lib/jury-product/services/ownership/enforce');
  const gate = await enforceOwnershipGate({ actor: await getJuryActor(), connectionId: String(formData.get('connectionId') ?? '') });
  if (!gate.allowed) return { ok: false, reason: gate.reason };
  const [{ runStoredCredentialObservation, createPrismaObservationRunStore }, { createServerlessObservationDriver }] = await Promise.all([
    import('@/lib/jury-product/services/readonly-account/observation-run'),
    import('@/lib/jury-product/services/readonly-account/browser-runtime'),
  ]);
  const result = await runStoredCredentialObservation({
    actor: await getJuryActor(),
    connectionId: String(formData.get('connectionId') ?? ''),
    scope: scopeOf(formData),
    login: loginOf(formData),
    store: await createPrismaObservationRunStore(),
    keys: resolveEnvKeyProvider(),
    createDriver: createServerlessObservationDriver,
  });
  // I-047: the summary is persisted, so re-render the detail page ("최근 관찰 결과", activity log).
  revalidatePath('/jury/services/[connectionId]', 'page');
  return result.ok ? { ok: true, summary: result.summary } : result;
}
