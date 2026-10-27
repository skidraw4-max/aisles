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
  type ObservationScopeInput,
  observationScopeHash,
  storedConsentScope,
  type ReadonlyAccountFailure,
} from './consent';
import { READONLY_ACCOUNT_CONSENT_VERSION } from './consent-text';
import type { EncryptedAccountCredential } from './credential-crypto';
import type { LoginPlan, ObservationAction, ObservationDriver } from './executor';
import type { KeyProviderResolution } from './key-provider';
import { DEFAULT_DISCOVERY, type DiscoveryOptions } from './discovery';
import { observeWithStoredCredential, type ObservationSummary } from './observation-evidence';

export const READONLY_ACCOUNT_OBSERVATION_AUDIT = 'READONLY_ACCOUNT_OBSERVATION_RUN';

export type StoredCredentialRecord = Omit<EncryptedAccountCredential, 'usernameHint'> & { expiresAt: Date; destroyedAt: Date | null };

export interface ObservationRunStore {
  findConnection(tenantId: string, connectionId: string): Promise<{ id: string; tenantId: string; serviceKey: string; accessMethod: string } | null>;
  findLatestConsent(
    tenantId: string,
    connectionId: string,
  ): Promise<{ id?: string; connectionId: string; tenantId: string; version: string; scopeHash: string; scope?: unknown; loginSettings?: unknown } | null>;
  /** I-056: remember typed login settings after a successful run. Optional. */
  saveLoginSettings?(tenantId: string, consentId: string, settings: LoginPlan): Promise<void>;
  findActiveCredential(tenantId: string, connectionId: string): Promise<StoredCredentialRecord | null>;
  audit(event: { tenantId: string; actor: string; action: string; serviceKey: string; timestamp: string }): Promise<void>;
  /**
   * I-069: paths seen by the most recent successful plain observations (kind OBSERVATION, not screen-audit runs) of
   * this connection, newest run first. Paths only. Optional.
   */
  findRecentObservationPaths?(tenantId: string, connectionId: string): Promise<string[]>;
  /** I-047: persists the PII-free summary. Optional so older fakes keep working. */
  recordRun?(run: ObservationRunRecord): Promise<void>;
}

export type ObservationRunRecord = {
  tenantId: string;
  connectionId: string;
  actorUserId: string;
  observedAt: string;
  summary: ObservationSummary;
  /** I-069: screen-audit runs are stored as SCREEN_AUDIT (linked to the audit) so they are not reused as candidates. */
  kind?: 'OBSERVATION' | 'SCREEN_AUDIT';
  auditId?: string | null;
};

export type ObservationRunFailure =
  | ReadonlyAccountFailure
  | 'KEY_NOT_CONFIGURED'
  | 'LOGIN_PLAN_INVALID'
  | 'CREDENTIAL_UNAVAILABLE'
  | 'CREDENTIAL_EXPIRED'
  | 'DECRYPT_FAILED'
  /** I-073: connection created after the ownership gate started and has no verified ownership. */
  | 'OWNERSHIP_REQUIRED';

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

/** I-054: login plan saved with the consent (null when absent or no longer valid). */
export function storedLoginPlan(settings: unknown): LoginPlan | null {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return null;
  const r = settings as Record<string, unknown>;
  return normalizeLoginPlan({
    loginUrl: r.loginUrl,
    usernameSelector: r.usernameSelector,
    passwordSelector: r.passwordSelector,
    submitSelector: r.submitSelector,
    successPathPrefix: r.successPathPrefix,
  });
}

const isBlank = (v: unknown) => typeof v !== 'string' || v.trim() === '';

/** I-054: the form left scope / login empty, so the stored (hash-verified) values are used. */
export function usesStoredScope(scope: ObservationScopeInput): boolean {
  return scope.allowedOrigins.every(isBlank) && scope.paths.every(isBlank) && (scope.authOrigins ?? []).every(isBlank);
}

/** One goto + snapshot per consented path. */
export function actionsForPaths(paths: readonly string[]): ObservationAction[] {
  return paths.flatMap((path) => [{ type: 'goto', path } as const, { type: 'snapshot', label: path } as const]);
}

export async function runStoredCredentialObservation(input: {
  actor: JuryActor;
  connectionId: string;
  scope: ObservationScopeInput;
  login: Record<keyof LoginPlan, unknown>;
  store: ObservationRunStore;
  keys: KeyProviderResolution;
  createDriver: () => ObservationDriver;
  now?: Date;
  executorEnabled?: boolean;
  discover?: Partial<DiscoveryOptions> | false;
  /** I-059: screen audit hook (see screen-audit/audit-hook.ts). */
  onPage?: (page: { label: string; url: string }) => Promise<void>;
  /** I-069: earlier-observation paths visited first; recorded run is tagged as a screen-audit run. */
  seedPaths?: readonly string[];
  runKind?: { kind: 'SCREEN_AUDIT'; auditId: string };
}): Promise<{ ok: true; summary: ObservationSummary } | { ok: false; reason: ObservationRunFailure }> {
  const now = input.now ?? new Date();
  const tenantId = input.actor.ok ? input.actor.tenantId : null;
  const connection = tenantId ? await input.store.findConnection(tenantId, input.connectionId) : null;
  const auth = authorizeReadonlyAccountConnection(input.actor, connection);
  if (!auth.ok) return auth;
  // I-054: an empty scope / login URL means "use what was saved with the consent". The stored scope must still
  // hash-match the consent; typed values keep the original re-entry path unchanged.
  const fromStore = usesStoredScope(input.scope);
  const consentFirst = fromStore ? await input.store.findLatestConsent(auth.connection.tenantId, auth.connection.id) : undefined;
  if (fromStore && !consentFirst) return { ok: false, reason: 'CONSENT_REQUIRED' };
  const stored = fromStore ? storedConsentScope(consentFirst) : null;
  if (fromStore && !stored) return { ok: false, reason: 'CONSENT_STALE' };
  const scope = stored ? ({ ok: true, scope: stored } as const) : normalizeObservationScope(input.scope);
  if (!scope.ok) return scope;
  const login = isBlank(input.login.loginUrl) && consentFirst ? storedLoginPlan(consentFirst.loginSettings) : normalizeLoginPlan(input.login);
  if (!login) return { ok: false, reason: 'LOGIN_PLAN_INVALID' };
  const consent = consentFirst ?? (await input.store.findLatestConsent(auth.connection.tenantId, auth.connection.id));
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
    // I-049: consent v3 allows visiting every menu reachable within the allowed origins (GET navigation only).
    discover: input.discover ?? DEFAULT_DISCOVERY,
    now,
    executorEnabled: input.executorEnabled,
    onPage: input.onPage,
    seedPaths: input.seedPaths,
  });
  // I-056: a run that logged in with typed settings remembers them on the consent, so the next run can leave them blank.
  if (result.ok && result.summary.ok && !isBlank(input.login.loginUrl) && consent.id && input.store.saveLoginSettings) {
    try {
      await input.store.saveLoginSettings(auth.connection.tenantId, consent.id, login);
    } catch (error) {
      console.warn(JSON.stringify({ event: 'readonly_account_login_settings_save_failed', connectionId: auth.connection.id, error: error instanceof Error ? error.name : 'unknown' }));
    }
  }
  if (result.ok && input.store.recordRun) {
    try {
      await input.store.recordRun({
        tenantId: auth.connection.tenantId,
        connectionId: auth.connection.id,
        actorUserId: auth.actor.userId,
        observedAt: now.toISOString(),
        summary: result.summary,
        ...(input.runKind ? { kind: input.runKind.kind, auditId: input.runKind.auditId } : {}),
      });
    } catch (error) {
      console.warn(JSON.stringify({ event: 'readonly_account_observation_persist_failed', connectionId: auth.connection.id, error: error instanceof Error ? error.name : 'unknown' }));
    }
  }
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
    saveLoginSettings: base.saveLoginSettings,
    audit: base.audit,
    async recordRun(run) {
      const { randomUUID } = await import('node:crypto');
      const s = run.summary;
      await prisma.juryReadonlyObservationRun.create({
        data: {
          id: randomUUID(),
          tenantId: run.tenantId,
          connectionId: run.connectionId,
          actorUserId: run.actorUserId,
          ok: s.ok,
          stop: s.stop,
          challenge: s.challenge,
          loginAttempts: s.loginAttempts,
          pagesObserved: s.pagesObserved,
          pagesVisible: s.pages.filter((p) => p.visible).length,
          pages: s.pages,
          blockedRequestCount: s.blockedRequestCount,
          // I-055: hostnames are stored inside the existing JSON column (no schema change).
          // I-056: stop diagnosis (step names only) shares the same JSON column.
          blockedByReason: { ...s.blockedByReason, hosts: s.blockedHosts ?? {}, ...(s.failedStep || s.missingField ? { diag: { failedStep: s.failedStep ?? null, missingField: s.missingField ?? null } } : {}) },
          finalOrigin: s.finalOrigin,
          finalPath: s.finalPath,
          observedAt: new Date(run.observedAt),
          ...(run.kind ? { kind: run.kind } : {}),
          ...(run.auditId ? { auditId: run.auditId } : {}),
        },
      });
    },
    async findRecentObservationPaths(tenantId, connectionId) {
      const rows = await prisma.juryReadonlyObservationRun.findMany({
        where: { tenantId, connectionId, ok: true, kind: 'OBSERVATION', auditId: null },
        orderBy: { observedAt: 'desc' },
        take: 5,
        select: { pages: true },
      });
      return rows.flatMap((r) => (Array.isArray(r.pages) ? r.pages : []).flatMap((p) => (p && typeof p === 'object' && typeof (p as { path?: unknown }).path === 'string' ? [(p as { path: string }).path] : [])));
    },
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
