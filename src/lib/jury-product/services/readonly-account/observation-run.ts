/**
 * I-044: runs one read-only observation with the stored credential of a READ_ONLY_ACCOUNT connection.
 * Checks: actor may write the connection (same tenant), consent exists for the exact scope, the env key provider is
 * configured and an active credential exists. Only counts are audited; credential material and page text are never
 * written anywhere. All I/O is injected so tests use fakes (no network, no database).
 */
import type { JuryActor } from '../../access';
import {
  authorizeReadonlyAccountConnection,
  normalizeObservationScope,
  observationScopeHash,
  type ReadonlyAccountFailure,
} from './consent';
import { READONLY_ACCOUNT_CONSENT_VERSION } from './consent-text';
import type { EncryptedAccountCredential } from './credential-crypto';
import type { LoginPlan, ObservationAction, ObservationDriver } from './executor';
import type { KeyProviderResolution } from './key-provider';
import { observeWithStoredCredential, type ObservationSummary } from './observation-evidence';

export const READONLY_ACCOUNT_OBSERVATION_AUDIT = 'READONLY_ACCOUNT_OBSERVATION_RUN';

export type StoredCredentialRecord = Omit<EncryptedAccountCredential, 'usernameHint'> & { expiresAt: Date; destroyedAt: Date | null };

export interface ObservationRunStore {
  findConnection(tenantId: string, connectionId: string): Promise<{ id: string; tenantId: string; serviceKey: string; accessMethod: string } | null>;
  findLatestConsent(tenantId: string, connectionId: string): Promise<{ connectionId: string; tenantId: string; version: string; scopeHash: string } | null>;
  findActiveCredential(tenantId: string, connectionId: string): Promise<StoredCredentialRecord | null>;
  audit(event: { tenantId: string; actor: string; action: string; serviceKey: string; timestamp: string }): Promise<void>;
}

export type ObservationRunFailure =
  | ReadonlyAccountFailure
  | 'KEY_NOT_CONFIGURED'
  | 'LOGIN_PLAN_INVALID'
  | 'CREDENTIAL_UNAVAILABLE'
  | 'CREDENTIAL_EXPIRED'
  | 'DECRYPT_FAILED';

const SELECTOR_MAX = 200;

export function normalizeLoginPlan(input: Record<keyof LoginPlan, unknown>): LoginPlan | null {
  const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  const plan: LoginPlan = {
    loginUrl: text(input.loginUrl),
    usernameSelector: text(input.usernameSelector),
    passwordSelector: text(input.passwordSelector),
    submitSelector: text(input.submitSelector),
    successPathPrefix: text(input.successPathPrefix) || '/',
  };
  try {
    if (new URL(plan.loginUrl).protocol !== 'https:') return null;
  } catch {
    return null;
  }
  for (const s of [plan.usernameSelector, plan.passwordSelector, plan.submitSelector]) {
    if (!s || s.length > SELECTOR_MAX) return null;
  }
  if (!plan.successPathPrefix.startsWith('/')) return null;
  return plan;
}

/** One goto + snapshot per consented path. */
export function actionsForPaths(paths: readonly string[]): ObservationAction[] {
  return paths.flatMap((path) => [{ type: 'goto', path } as const, { type: 'snapshot', label: path } as const]);
}

export async function runStoredCredentialObservation(input: {
  actor: JuryActor;
  connectionId: string;
  scope: { allowedOrigins: readonly string[]; paths: readonly string[] };
  login: Record<keyof LoginPlan, unknown>;
  store: ObservationRunStore;
  keys: KeyProviderResolution;
  createDriver: () => ObservationDriver;
  now?: Date;
  executorEnabled?: boolean;
}): Promise<{ ok: true; summary: ObservationSummary } | { ok: false; reason: ObservationRunFailure }> {
  const now = input.now ?? new Date();
  const tenantId = input.actor.ok ? input.actor.tenantId : null;
  const connection = tenantId ? await input.store.findConnection(tenantId, input.connectionId) : null;
  const auth = authorizeReadonlyAccountConnection(input.actor, connection);
  if (!auth.ok) return auth;
  const scope = normalizeObservationScope(input.scope);
  if (!scope.ok) return scope;
  const login = normalizeLoginPlan(input.login);
  if (!login) return { ok: false, reason: 'LOGIN_PLAN_INVALID' };
  const consent = await input.store.findLatestConsent(auth.connection.tenantId, auth.connection.id);
  if (!consent) return { ok: false, reason: 'CONSENT_REQUIRED' };
  if (consent.version !== READONLY_ACCOUNT_CONSENT_VERSION || consent.scopeHash !== observationScopeHash(scope.scope)) {
    return { ok: false, reason: 'CONSENT_STALE' };
  }
  if (!input.keys.ok) return { ok: false, reason: 'KEY_NOT_CONFIGURED' };
  const record = await input.store.findActiveCredential(auth.connection.tenantId, auth.connection.id);
  if (!record) return { ok: false, reason: 'CREDENTIAL_UNAVAILABLE' };
  const result = await observeWithStoredCredential({
    record,
    context: { tenantId: auth.connection.tenantId, connectionId: auth.connection.id },
    provider: input.keys.provider,
    driver: input.createDriver(),
    scope: scope.scope,
    login,
    actions: actionsForPaths(scope.scope.paths),
    now,
    executorEnabled: input.executorEnabled,
  });
  await input.store.audit({
    tenantId: auth.connection.tenantId,
    actor: auth.actor.userId,
    action: READONLY_ACCOUNT_OBSERVATION_AUDIT,
    serviceKey: auth.connection.serviceKey,
    timestamp: now.toISOString(),
  });
  return result;
}

export async function createPrismaObservationRunStore(): Promise<ObservationRunStore> {
  const [{ prisma }, { createPrismaReadonlyAccountStore }] = await Promise.all([import('@/lib/prisma'), import('./store')]);
  const base = await createPrismaReadonlyAccountStore();
  return {
    findConnection: base.findConnection,
    findLatestConsent: base.findLatestConsent,
    audit: base.audit,
    async findActiveCredential(tenantId, connectionId) {
      const row = await prisma.juryAccountCredential.findFirst({
        where: { tenantId, connectionId, destroyedAt: null },
        orderBy: { createdAt: 'desc' },
        select: { algorithm: true, ciphertext: true, iv: true, authTag: true, wrappedDek: true, kekId: true, expiresAt: true, destroyedAt: true },
      });
      if (!row || !row.ciphertext || !row.iv || !row.authTag || !row.wrappedDek) return null;
      return { ...row, algorithm: row.algorithm as StoredCredentialRecord['algorithm'], ciphertext: row.ciphertext, iv: row.iv, authTag: row.authTag, wrappedDek: row.wrappedDek };
    },
  };
}
