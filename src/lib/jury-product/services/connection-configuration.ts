/**
 * Product configuration for a service connection.
 * Lifecycle describes the stored connection projection. It does not mean an external provider authenticated.
 * Service Operations health stays a separate value.
 * Raw credentials are not fields of this model.
 */
import type { JuryConnectionStatus } from '../records';
import { getServiceProviderDefinition, resolveServiceProvider } from './provider-registry';
import {
  CONNECTION_METHODS,
  containsRawCredential,
  mapConnectionMethod,
  providerError,
  type ConnectionHealth,
  type ConnectionMethod,
  type CredentialStatus,
  type ProviderError,
  type ServiceAccessScope,
  type ServiceProviderId,
} from './provider-types';

export const CONNECTION_LIFECYCLES = [
  'UNCONFIGURED',
  'CONFIGURING',
  'READY',
  'CONNECTING',
  'CONNECTED',
  'DEGRADED',
  'EXPIRED',
  'REVOKED',
  'DISCONNECTED',
  'ERROR',
] as const;
export type ConnectionLifecycle = (typeof CONNECTION_LIFECYCLES)[number];

export const CONNECTION_READINESS = [
  'NOT_READY',
  'READY_TO_CONNECT',
  'CONNECTED',
  'ACTION_REQUIRED',
  'BLOCKED',
] as const;
export type ConnectionReadiness = (typeof CONNECTION_READINESS)[number];

export const PROVIDER_CAPABILITY_NAMES = [
  'DISCOVERY',
  'READ',
  'WRITE',
  'REVIEW',
  'EVIDENCE',
  'HEALTH',
  'DISCONNECT',
  'REVOKE',
] as const;
export type ProviderCapabilityName = (typeof PROVIDER_CAPABILITY_NAMES)[number];

export type ConnectionMethodMetadata = {
  method: ConnectionMethod;
  requiresCredential: boolean;
  supportsReadOnly: boolean;
  supportsWrite: boolean;
  supportsRefresh: boolean;
  requiresExternalRedirect: boolean;
  implemented: boolean;
};

export type ConnectionConfiguration = {
  provider: ServiceProviderId;
  providerLabel: string;
  connectionMethod: ConnectionMethod;
  method: ConnectionMethodMetadata;
  displayName: string;
  requestedScopes: ServiceAccessScope[];
  accessMode: 'READ_ONLY';
  credentialStatus: CredentialStatus;
  connectionStatus: JuryConnectionStatus;
  lifecycle: ConnectionLifecycle;
  readiness: ConnectionReadiness;
  health: ConnectionHealth;
  capabilities: ProviderCapabilityName[];
  notice: string;
};

const METHOD_METADATA: Record<ConnectionMethod, ConnectionMethodMetadata> = {
  OAUTH: { method: 'OAUTH', requiresCredential: true, supportsReadOnly: true, supportsWrite: false, supportsRefresh: true, requiresExternalRedirect: true, implemented: false },
  API_KEY: { method: 'API_KEY', requiresCredential: true, supportsReadOnly: true, supportsWrite: false, supportsRefresh: false, requiresExternalRedirect: false, implemented: false },
  TOKEN: { method: 'TOKEN', requiresCredential: true, supportsReadOnly: true, supportsWrite: false, supportsRefresh: true, requiresExternalRedirect: false, implemented: false },
  READ_ONLY_ACCOUNT: { method: 'READ_ONLY_ACCOUNT', requiresCredential: true, supportsReadOnly: true, supportsWrite: false, supportsRefresh: false, requiresExternalRedirect: false, implemented: false },
  BROWSER_SESSION: { method: 'BROWSER_SESSION', requiresCredential: true, supportsReadOnly: true, supportsWrite: false, supportsRefresh: false, requiresExternalRedirect: false, implemented: false },
  FILE_IMPORT: { method: 'FILE_IMPORT', requiresCredential: false, supportsReadOnly: true, supportsWrite: false, supportsRefresh: false, requiresExternalRedirect: false, implemented: false },
};

export function connectionMethodMetadata(method: ConnectionMethod): ConnectionMethodMetadata {
  return METHOD_METADATA[method];
}

export function projectConnectionLifecycle(input: {
  providerImplemented: boolean;
  connectionStatus: JuryConnectionStatus | null;
  credentialStatus: CredentialStatus;
}): ConnectionLifecycle {
  if (!input.providerImplemented || !input.connectionStatus) return 'UNCONFIGURED';
  if (input.connectionStatus === 'DISCONNECTED') return 'DISCONNECTED';
  if (input.connectionStatus === 'ERROR' || input.credentialStatus === 'ERROR') return 'ERROR';
  if (input.credentialStatus === 'REVOKED') return 'REVOKED';
  if (input.credentialStatus === 'EXPIRED') return 'EXPIRED';
  if (input.connectionStatus === 'LIMITED' && input.credentialStatus === 'ACTIVE') return 'DEGRADED';
  if (input.connectionStatus === 'CONNECTED' && input.credentialStatus === 'ACTIVE') return 'CONNECTED';
  if (input.credentialStatus === 'ACTIVE') return 'READY';
  if (input.connectionStatus === 'DRAFT' || input.connectionStatus === 'DISCOVERY_PENDING') return 'CONFIGURING';
  return 'UNCONFIGURED';
}

export function projectConnectionReadiness(input: {
  providerImplemented: boolean;
  methodSupported: boolean;
  credentialStatus: CredentialStatus;
}): ConnectionReadiness {
  if (!input.providerImplemented) return 'NOT_READY';
  if (!input.methodSupported) return 'ACTION_REQUIRED';
  if (input.credentialStatus === 'ERROR') return 'BLOCKED';
  if (input.credentialStatus === 'EXPIRED' || input.credentialStatus === 'REVOKED') return 'ACTION_REQUIRED';
  if (input.credentialStatus !== 'ACTIVE') return 'READY_TO_CONNECT';
  return 'CONNECTED';
}

export function acceptReadOnlyScopes(
  scopes: readonly ServiceAccessScope[],
): { ok: true; scopes: ServiceAccessScope[] } | ProviderError {
  if (scopes.some((scope) => scope.operation === 'write' || scope.readonly === false)) {
    return providerError('READ_ACCESS_REQUIRED');
  }
  const requested = scopes.length > 0 ? scopes : [{ resource: 'service', operation: 'read' as const, readonly: true }];
  return {
    ok: true,
    scopes: requested.map((scope) => ({ resource: scope.resource, operation: 'read' as const, readonly: true })),
  };
}

export function projectConnectionConfiguration(input: {
  provider: ServiceProviderId;
  displayName: string;
  accessMethod: Parameters<typeof mapConnectionMethod>[0];
  connectionStatus: JuryConnectionStatus;
  credentialStatus: CredentialStatus;
  health: ConnectionHealth;
  requestedScopes?: readonly ServiceAccessScope[];
  clientTenantId?: string | null;
  clientRole?: string | null;
  clientPermission?: string | null;
}): { ok: true; configuration: ConnectionConfiguration } | ProviderError {
  void input.clientTenantId;
  void input.clientRole;
  void input.clientPermission;
  if (containsRawCredential(input.displayName)) return providerError('SECRET_REJECTED');
  const definition = getServiceProviderDefinition(input.provider);
  if (!definition.ok) return definition;
  const scopes = acceptReadOnlyScopes(input.requestedScopes ?? definition.definition.scopes);
  if (!scopes.ok) return scopes;
  const connectionMethod = mapConnectionMethod(input.accessMethod);
  const methodSupported = definition.definition.connectionMethods.includes(connectionMethod);
  const method = connectionMethodMetadata(connectionMethod);
  const githubInstall = input.provider === 'GITHUB' && connectionMethod === 'OAUTH';
  const capabilities: ProviderCapabilityName[] = [];
  if (definition.definition.capabilities.discovery) capabilities.push('DISCOVERY');
  if (definition.definition.capabilities.canRead) capabilities.push('READ');
  if (definition.definition.capabilities.evidence) capabilities.push('EVIDENCE');
  capabilities.push('HEALTH', 'DISCONNECT', 'REVOKE');
  return {
    ok: true,
    configuration: {
      provider: input.provider,
      providerLabel: definition.definition.displayName,
      connectionMethod,
      method: githubInstall ? { ...method, implemented: true } : method,
      displayName: input.displayName,
      requestedScopes: scopes.scopes,
      accessMode: 'READ_ONLY',
      credentialStatus: input.credentialStatus,
      connectionStatus: input.connectionStatus,
      lifecycle: projectConnectionLifecycle({
        providerImplemented: true,
        connectionStatus: input.connectionStatus,
        credentialStatus: input.credentialStatus,
      }),
      readiness: projectConnectionReadiness({
        providerImplemented: true,
        methodSupported,
        credentialStatus: input.credentialStatus,
      }),
      health: input.health,
      capabilities,
      notice: githubInstall
        ? 'GitHub App 설치로 저장소 메타데이터와 내용을 읽기 전용으로 확인합니다. 저장소는 수정하지 않습니다.'
        : '연결 준비 단계입니다. 외부 인증은 실행하지 않습니다.',
    },
  };
}

export function unsupportedProviderReadiness(provider: string): ConnectionReadiness {
  const resolved = resolveServiceProvider(provider === 'MOCK' ? 'mock' : provider);
  if (!resolved.ok || !getServiceProviderDefinition(resolved.provider).ok) return 'NOT_READY';
  return 'READY_TO_CONNECT';
}

export function planDisconnectConnection(input: {
  actorTenantId: string;
  provider: ServiceProviderId;
  connection: { id: string; tenantId: string; credentialRef?: string | null } | null;
  clientTenantId?: string | null;
  clientPermission?: string | null;
}): {
  ok: true;
  action: 'DISCONNECT';
  connectionId: string;
  provider: ServiceProviderId;
  reason: 'DISCONNECT_REQUESTED';
  requiresExternalRevoke: false;
} | ProviderError {
  void input.clientTenantId;
  void input.clientPermission;
  if (!input.connection || input.connection.tenantId !== input.actorTenantId) return providerError('CONNECTION_NOT_FOUND');
  if (containsRawCredential(input.connection.credentialRef)) return providerError('SECRET_REJECTED');
  return {
    ok: true,
    action: 'DISCONNECT',
    connectionId: input.connection.id,
    provider: input.provider,
    reason: 'DISCONNECT_REQUESTED',
    requiresExternalRevoke: false,
  };
}

export function planRevokeCredential(input: {
  actorTenantId: string;
  provider: ServiceProviderId;
  connection: { id: string; tenantId: string; credentialRef?: string | null } | null;
  clientTenantId?: string | null;
  actingUserId?: string | null;
}): {
  ok: true;
  action: 'REVOKE_CREDENTIAL';
  connectionId: string;
  provider: ServiceProviderId;
  reason: 'REVOKE_REQUESTED';
  requiresExternalRevoke: false;
} | ProviderError {
  void input.clientTenantId;
  void input.actingUserId;
  if (!input.connection || input.connection.tenantId !== input.actorTenantId) return providerError('CONNECTION_NOT_FOUND');
  if (containsRawCredential(input.connection.credentialRef)) return providerError('SECRET_REJECTED');
  return {
    ok: true,
    action: 'REVOKE_CREDENTIAL',
    connectionId: input.connection.id,
    provider: input.provider,
    reason: 'REVOKE_REQUESTED',
    requiresExternalRevoke: false,
  };
}

export function knownConnectionMethod(method: string): method is ConnectionMethod {
  return (CONNECTION_METHODS as readonly string[]).includes(method);
}
