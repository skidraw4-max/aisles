/**
 * Tenant-scoped connection plans. Disconnect stops credential use. Delete removes the Jury record.
 * Neither plan calls an external revoke API or writes to the database.
 */
import type { JuryConnectionStatus } from '../records';
import {
  containsRawCredential,
  isCredentialUsable,
  mapConnectionMethod,
  providerError,
  type ConnectionHealth,
  type ConnectionMethod,
  type CredentialReference,
  type CredentialStatus,
  type ProviderAuditAction,
  type ProviderError,
  type ServiceProviderId,
} from './provider-types';
import { projectConnectionConfiguration, type ConnectionConfiguration } from './connection-configuration';
import { getServiceProviderDefinition, resolveServiceProvider } from './provider-registry';

export function deriveCredentialStatus(input: {
  credentialRef?: string | null;
  connectionStatus: JuryConnectionStatus;
}): CredentialStatus {
  if (input.connectionStatus === 'DISCONNECTED') return 'REVOKED';
  if (input.connectionStatus === 'ERROR') return 'ERROR';
  if (!input.credentialRef || input.credentialRef.trim().length === 0) return 'UNCONFIGURED';
  if (containsRawCredential(input.credentialRef)) return 'ERROR';
  return 'ACTIVE';
}

export function credentialReferenceFor(input: {
  actorTenantId: string;
  provider: ServiceProviderId;
  connection: {
    id: string;
    tenantId: string;
    credentialRef?: string | null;
    status: JuryConnectionStatus;
    createdAt: string;
  } | null;
  clientTenantId?: string | null;
}): { ok: true; reference: CredentialReference } | ProviderError {
  void input.clientTenantId;
  if (!input.connection || input.connection.tenantId !== input.actorTenantId) {
    return providerError('CONNECTION_NOT_FOUND');
  }
  const status = deriveCredentialStatus({
    credentialRef: input.connection.credentialRef,
    connectionStatus: input.connection.status,
  });
  return {
    ok: true,
    reference: {
      provider: input.provider,
      tenantId: input.actorTenantId,
      connectionId: input.connection.id,
      referenceId: status === 'ACTIVE' ? input.connection.credentialRef ?? null : null,
      status,
      createdAt: input.connection.createdAt,
      expiresAt: null,
    },
  };
}

export function requireConnectionTenant(input: {
  actorTenantId: string;
  connection: { id: string; tenantId: string } | null;
  serviceRead: boolean;
  clientTenantId?: string | null;
  clientPermission?: string | null;
}): { ok: true; connectionId: string } | ProviderError {
  void input.clientTenantId;
  void input.clientPermission;
  if (!input.connection || input.connection.tenantId !== input.actorTenantId) {
    return providerError('CONNECTION_NOT_FOUND');
  }
  if (!input.serviceRead) return providerError('CONNECTION_UNAUTHORIZED');
  return { ok: true, connectionId: input.connection.id };
}

export function planDisconnect(input: {
  actorTenantId: string;
  connection: { id: string; tenantId: string } | null;
}): { ok: true; action: 'DISCONNECT'; tenantId: string; connectionId: string; credentialStatus: 'REVOKED' } | ProviderError {
  if (!input.connection || input.connection.tenantId !== input.actorTenantId) return providerError('CONNECTION_NOT_FOUND');
  return {
    ok: true,
    action: 'DISCONNECT',
    tenantId: input.actorTenantId,
    connectionId: input.connection.id,
    credentialStatus: 'REVOKED',
  };
}

export function planDeleteConnection(input: {
  actorTenantId: string;
  connection: { id: string; tenantId: string } | null;
}): { ok: true; action: 'DELETE'; tenantId: string; connectionId: string } | ProviderError {
  if (!input.connection || input.connection.tenantId !== input.actorTenantId) return providerError('CONNECTION_NOT_FOUND');
  return { ok: true, action: 'DELETE', tenantId: input.actorTenantId, connectionId: input.connection.id };
}

export function planProviderAudit(input: {
  action: ProviderAuditAction;
  tenantId: string;
  connectionId: string;
  detail?: unknown;
}): { ok: true; action: ProviderAuditAction; tenantId: string; connectionId: string } | ProviderError {
  if (containsRawCredential(input.detail) || containsRawCredential(input.connectionId)) {
    return providerError('SECRET_REJECTED');
  }
  return { ok: true, action: input.action, tenantId: input.tenantId, connectionId: input.connectionId };
}

export type SafeProviderView = {
  provider: ServiceProviderId;
  displayName: string;
  connectionMethod: ConnectionMethod;
  health: ConnectionHealth;
  credentialStatus: CredentialStatus;
  credentialUsable: boolean;
  readOnly: true;
  canRead: boolean;
  canWrite: false;
  configuration: ConnectionConfiguration;
};

export function connectionAdapterKey(connection: { serviceKey?: string | null }): string | undefined {
  if (connection.serviceKey?.startsWith('github-')) return 'github';
  return undefined;
}

export function providerViewsFor(input: {
  actorTenantId: string;
  connections: ReadonlyArray<{
    id: string;
    tenantId: string;
    serviceKey?: string;
    accessMethod: Parameters<typeof mapConnectionMethod>[0];
    status: JuryConnectionStatus;
    displayName?: string;
    credentialRef?: string | null;
    createdAt: string;
  }>;
  discoveryConnectionIds: readonly string[];
  evidenceConnectionIds: readonly string[];
}): Record<string, SafeProviderView> {
  const views: Record<string, SafeProviderView> = {};
  for (const connection of input.connections) {
    const projected = projectProviderView({
      actorTenantId: input.actorTenantId,
      connection,
      adapterKey: connectionAdapterKey(connection),
      hasDiscovery: input.discoveryConnectionIds.includes(connection.id),
      hasEvidence: input.evidenceConnectionIds.includes(connection.id),
    });
    if (projected.ok && projected.view) views[connection.id] = projected.view;
  }
  return views;
}

export function projectProviderView(input: {
  actorTenantId: string;
  connection: {
    id: string;
    tenantId: string;
    serviceKey?: string;
    accessMethod: Parameters<typeof mapConnectionMethod>[0];
    status: JuryConnectionStatus;
    displayName?: string;
    credentialRef?: string | null;
    createdAt: string;
  } | null;
  adapterKey?: string | null;
  hasDiscovery: boolean;
  hasEvidence: boolean;
  clientTenantId?: string | null;
}): { ok: true; view: SafeProviderView } | ProviderError {
  void input.clientTenantId;
  if (!input.connection || input.connection.tenantId !== input.actorTenantId) return providerError('CONNECTION_NOT_FOUND');
  const resolved = resolveServiceProvider(input.adapterKey ?? connectionAdapterKey(input.connection));
  if (!resolved.ok) return resolved;
  const definition = getServiceProviderDefinition(resolved.provider);
  if (!definition.ok) return definition;
  const credentialStatus = deriveCredentialStatus({
    credentialRef: input.connection.credentialRef,
    connectionStatus: input.connection.status,
  });
  const adapter = definition.definition.adapterFactory();
  const health = adapter.health({
    connectionStatus: input.connection.status,
    credentialStatus,
    hasDiscovery: input.hasDiscovery,
    hasEvidence: input.hasEvidence,
  });
  const configuration = projectConnectionConfiguration({
    provider: definition.definition.provider,
    displayName: input.connection.displayName ?? definition.definition.displayName,
    accessMethod: input.connection.accessMethod,
    connectionStatus: input.connection.status,
    credentialStatus,
    health,
    requestedScopes: definition.definition.scopes,
    clientTenantId: input.clientTenantId,
  });
  if (!configuration.ok) return configuration;
  return {
    ok: true,
    view: {
      provider: definition.definition.provider,
      displayName: definition.definition.displayName,
      connectionMethod: mapConnectionMethod(input.connection.accessMethod),
      health,
      credentialStatus,
      credentialUsable: isCredentialUsable(credentialStatus),
      readOnly: true,
      canRead: definition.definition.capabilities.canRead,
      canWrite: false,
      configuration: configuration.configuration,
    },
  };
}
