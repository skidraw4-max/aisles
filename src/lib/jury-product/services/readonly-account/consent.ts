/**
 * I-040: consent and credential-storage gating for READ_ONLY_ACCOUNT.
 * Account permission level is not restricted (decision 2026-10-26); a read-only account is only recommended.
 * Jury-side read-only enforcement (GET-only, origin allowlist, no form submit) is unchanged and lives in the executor (I-041).
 */
import { createHash, randomUUID } from 'node:crypto';
import { decideJuryMutation, type JuryActor } from '../../access';
import {
  accountCredentialRef,
  encryptAccountCredential,
  validateAccountCredential,
  type CredentialKeyProvider,
  type EncryptedAccountCredential,
} from './credential-crypto';

import { READONLY_ACCOUNT_CONSENT_VERSION } from './consent-text';
export { READONLY_ACCOUNT_CONSENT_TEXT, READONLY_ACCOUNT_CONSENT_VERSION } from './consent-text';

export const DEFAULT_RETENTION_DAYS = 14;
export const MAX_RETENTION_DAYS = 14;

export type ObservationScope = { allowedOrigins: string[]; paths: string[] };

export type ReadonlyAccountFailure =
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'TENANT_MISMATCH'
  | 'NOT_FOUND'
  | 'ACCESS_METHOD_UNSUPPORTED'
  | 'SCOPE_INVALID'
  | 'CONSENT_REQUIRED'
  | 'CONSENT_STALE'
  | 'CREDENTIAL_INVALID'
  | 'RETENTION_INVALID'
  | 'NOT_IMPLEMENTED';

export function normalizeObservationScope(
  input: { allowedOrigins: readonly string[]; paths: readonly string[] },
): { ok: true; scope: ObservationScope } | { ok: false; reason: 'SCOPE_INVALID' } {
  const origins = new Set<string>();
  for (const raw of input.allowedOrigins) {
    let url: URL;
    try {
      url = new URL(raw.trim());
    } catch {
      return { ok: false, reason: 'SCOPE_INVALID' };
    }
    if (url.protocol !== 'https:' || url.username || url.password) return { ok: false, reason: 'SCOPE_INVALID' };
    origins.add(url.origin);
  }
  const paths = new Set<string>();
  for (const raw of input.paths) {
    const path = raw.trim();
    if (!path.startsWith('/') || path.startsWith('//') || /\s/.test(path)) return { ok: false, reason: 'SCOPE_INVALID' };
    paths.add(path);
  }
  if (origins.size === 0 || paths.size === 0 || origins.size > 10 || paths.size > 20) return { ok: false, reason: 'SCOPE_INVALID' };
  return { ok: true, scope: { allowedOrigins: [...origins].sort(), paths: [...paths].sort() } };
}

export function observationScopeHash(scope: ObservationScope, version = READONLY_ACCOUNT_CONSENT_VERSION): string {
  return createHash('sha256').update(JSON.stringify({ version, ...scope })).digest('hex');
}

type ConnectionView = { id: string; tenantId: string; serviceKey: string; accessMethod: string };
type ConsentView = { connectionId: string; tenantId: string; version: string; scopeHash: string };

function authorize(actor: JuryActor, connection: ConnectionView | null):
  | { ok: true; actor: Extract<JuryActor, { ok: true }>; connection: ConnectionView }
  | { ok: false; reason: ReadonlyAccountFailure } {
  if (!actor.ok) return { ok: false, reason: actor.reason === 'UNAUTHENTICATED' ? 'UNAUTHENTICATED' : 'FORBIDDEN' };
  if (!connection) return { ok: false, reason: 'NOT_FOUND' };
  const allowed = decideJuryMutation({ actor, action: 'connection.write', resourceTenantId: connection.tenantId });
  if (!allowed.ok) return { ok: false, reason: allowed.reason === 'TENANT_MISMATCH' ? 'TENANT_MISMATCH' : 'FORBIDDEN' };
  if (connection.accessMethod !== 'READ_ONLY_ACCOUNT') return { ok: false, reason: 'ACCESS_METHOD_UNSUPPORTED' };
  return { ok: true, actor, connection };
}

export function planConsent(input: {
  actor: JuryActor;
  connection: ConnectionView | null;
  scope: { allowedOrigins: readonly string[]; paths: readonly string[] };
  accepted: boolean;
  now: string;
  allocateId?: () => string;
}):
  | { ok: true; consent: ConsentView & { id: string; userId: string; acceptedAt: string }; scope: ObservationScope }
  | { ok: false; reason: ReadonlyAccountFailure } {
  const auth = authorize(input.actor, input.connection);
  if (!auth.ok) return auth;
  if (!input.accepted) return { ok: false, reason: 'CONSENT_REQUIRED' };
  const scope = normalizeObservationScope(input.scope);
  if (!scope.ok) return scope;
  return {
    ok: true,
    scope: scope.scope,
    consent: {
      id: (input.allocateId ?? randomUUID)(),
      tenantId: auth.connection.tenantId,
      connectionId: auth.connection.id,
      userId: auth.actor.userId,
      version: READONLY_ACCOUNT_CONSENT_VERSION,
      scopeHash: observationScopeHash(scope.scope),
      acceptedAt: input.now,
    },
  };
}

export async function planCredentialStore(input: {
  actor: JuryActor;
  connection: ConnectionView | null;
  consent: ConsentView | null;
  scope: ObservationScope;
  username: unknown;
  password: unknown;
  retentionDays?: number;
  now: string;
  keyProvider: CredentialKeyProvider;
  allocateId?: () => string;
}): Promise<
  | {
      ok: true;
      credential: EncryptedAccountCredential & { id: string; tenantId: string; connectionId: string; expiresAt: string; createdByUserId: string };
      credentialRef: string;
    }
  | { ok: false; reason: ReadonlyAccountFailure }
> {
  const auth = authorize(input.actor, input.connection);
  if (!auth.ok) return auth;
  const consent = input.consent;
  if (!consent || consent.connectionId !== auth.connection.id || consent.tenantId !== auth.connection.tenantId) {
    return { ok: false, reason: 'CONSENT_REQUIRED' };
  }
  if (consent.version !== READONLY_ACCOUNT_CONSENT_VERSION || consent.scopeHash !== observationScopeHash(input.scope)) {
    return { ok: false, reason: 'CONSENT_STALE' };
  }
  const days = input.retentionDays ?? DEFAULT_RETENTION_DAYS;
  if (!Number.isInteger(days) || days < 1 || days > MAX_RETENTION_DAYS) return { ok: false, reason: 'RETENTION_INVALID' };
  const valid = validateAccountCredential({ username: input.username, password: input.password });
  if (!valid.ok) return valid;
  const encrypted = await encryptAccountCredential(
    valid.secret,
    { tenantId: auth.connection.tenantId, connectionId: auth.connection.id },
    input.keyProvider,
  );
  const id = (input.allocateId ?? randomUUID)();
  const expiresAt = new Date(Date.parse(input.now) + days * 86_400_000).toISOString();
  return {
    ok: true,
    credentialRef: accountCredentialRef(id),
    credential: {
      ...encrypted,
      id,
      tenantId: auth.connection.tenantId,
      connectionId: auth.connection.id,
      expiresAt,
      createdByUserId: auth.actor.userId,
    },
  };
}

/** Audit actions added by I-040. Values never include credential material. */
export const READONLY_ACCOUNT_AUDIT = {
  CONSENT_ACCEPTED: 'READONLY_ACCOUNT_CONSENT_ACCEPTED',
  CREDENTIAL_STORED: 'READONLY_ACCOUNT_CREDENTIAL_STORED',
} as const;
