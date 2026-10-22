/**
 * Access Layer decides whether an adapter may see a service.
 * It does not collect metrics and it does not resolve credentialRef into a secret.
 */
import type { JuryActor } from './access';
import { JURY_ACCESS_METHODS, type JuryAccessGrant, type JuryAccessMethod } from './records';

const issuedContexts = new WeakSet<JuryAccessContext>();

export type JuryAccessContext = {
  tenantId: string;
  connectionId: string;
  serviceKey: string;
  accessMethod: JuryAccessMethod;
  /** Pointer into a secret store. Not a token or password. */
  credentialRef: string;
  grants: JuryAccessGrant[];
  scopeId: string;
};

export type AccessFailure =
  | 'UNAUTHENTICATED'
  | 'NO_MEMBERSHIP'
  | 'AMBIGUOUS_MEMBERSHIP'
  | 'STORE_UNAVAILABLE'
  | 'TENANT_MISMATCH'
  | 'SCOPE_NOT_APPROVED'
  | 'CONNECTION_NOT_APPROVED'
  | 'CREDENTIAL_REF_REQUIRED'
  | 'ACCESS_METHOD_UNSUPPORTED'
  | 'LEAST_PRIVILEGE'
  | 'NOT_FOUND'
  | 'CONTEXT_NOT_ISSUED';

export type AccessConnectionInput = {
  id: string;
  tenantId: string;
  serviceKey: string;
  accessMethod: string;
  status: string;
  credentialRef?: string;
};

export type AccessScopeInput = {
  id: string;
  tenantId: string;
  connectionId: string;
  status: string;
  grants: Array<{ resource: string; mode: string }>;
};

export function isIssuedAccessContext(context: JuryAccessContext): boolean {
  return issuedContexts.has(context);
}

export function createAccessContext(input: {
  actor: JuryActor;
  connection: AccessConnectionInput;
  scope: AccessScopeInput | null;
  clientTenantId?: string | null;
}): { ok: true; context: JuryAccessContext } | { ok: false; reason: AccessFailure } {
  void input.clientTenantId;
  if (!input.actor.ok) return { ok: false, reason: input.actor.reason };
  if (input.connection.tenantId !== input.actor.tenantId) return { ok: false, reason: 'TENANT_MISMATCH' };
  if (!input.scope) return { ok: false, reason: 'SCOPE_NOT_APPROVED' };
  if (input.scope.tenantId !== input.actor.tenantId) return { ok: false, reason: 'TENANT_MISMATCH' };
  if (input.scope.connectionId !== input.connection.id) return { ok: false, reason: 'NOT_FOUND' };
  if (input.scope.status !== 'APPROVED') return { ok: false, reason: 'SCOPE_NOT_APPROVED' };
  if (input.connection.status !== 'CONNECTED') return { ok: false, reason: 'CONNECTION_NOT_APPROVED' };
  if (!(JURY_ACCESS_METHODS as readonly string[]).includes(input.connection.accessMethod)) {
    return { ok: false, reason: 'ACCESS_METHOD_UNSUPPORTED' };
  }
  const credentialRef = input.connection.credentialRef?.trim() ?? '';
  if (credentialRef.length === 0) return { ok: false, reason: 'CREDENTIAL_REF_REQUIRED' };
  const grants = input.scope.grants.flatMap((grant) =>
    grant.mode === 'READ' && grant.resource.trim().length > 0
      ? [{ resource: grant.resource, mode: 'READ' as const }]
      : [],
  );
  if (grants.length !== input.scope.grants.length || grants.length === 0) {
    return { ok: false, reason: 'LEAST_PRIVILEGE' };
  }
  const context: JuryAccessContext = {
    tenantId: input.actor.tenantId,
    connectionId: input.connection.id,
    serviceKey: input.connection.serviceKey,
    accessMethod: input.connection.accessMethod as JuryAccessMethod,
    credentialRef,
    grants,
    scopeId: input.scope.id,
  };
  issuedContexts.add(context);
  return { ok: true, context };
}
