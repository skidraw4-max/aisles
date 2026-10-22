/**
 * GitHub installation access is checked after the Jury actor and the Jury connection.
 * Organization role, service permission, and GitHub installation access stay separate.
 * Client-supplied tenant, organization, user, role, and permission values are ignored.
 */
import { providerError, type ProviderError, type ServiceAccessScope } from '../provider-types';
import { acceptReadOnlyScopes } from '../connection-configuration';
import type { GithubRepository } from './discovery';

const INSTALLATION_ID = /^\d{1,12}$/;
const REPOSITORY_NAME = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;
const ACCOUNT_LOGIN = /^[A-Za-z0-9-]{1,39}$/;

export type GithubConnectionRecord = {
  id: string;
  tenantId: string;
  serviceKey: string;
  credentialRef?: string | null;
};

export function githubInstallationReference(installationId: string): string | null {
  if (!INSTALLATION_ID.test(installationId)) return null;
  return `github-installation/${installationId}`;
}

export function githubServiceKey(installationId: string): string | null {
  if (!INSTALLATION_ID.test(installationId)) return null;
  return `github-${installationId}`;
}

export function installationIdFromConnection(connection: { serviceKey?: string | null; credentialRef?: string | null }): string | null {
  const fromKey = connection.serviceKey?.startsWith('github-') ? connection.serviceKey.slice('github-'.length) : '';
  if (INSTALLATION_ID.test(fromKey)) return fromKey;
  const fromRef = connection.credentialRef?.startsWith('github-installation/')
    ? connection.credentialRef.slice('github-installation/'.length)
    : '';
  return INSTALLATION_ID.test(fromRef) ? fromRef : null;
}

export function planGithubInstallation(input: {
  actorTenantId: string;
  actorUserId: string;
  stateTenantId: string;
  stateUserId: string;
  installationId: string;
  accountLogin: string;
  accountType: string;
  clientTenantId?: string | null;
  clientOrganizationId?: string | null;
  clientUserId?: string | null;
  clientRole?: string | null;
  clientPermission?: string | null;
}): {
  ok: true;
  installationId: string;
  serviceKey: string;
  credentialRef: string;
  displayName: string;
  accountType: 'Organization' | 'User' | 'unknown';
  accessMethod: 'OAUTH';
} | ProviderError {
  void input.clientTenantId;
  void input.clientOrganizationId;
  void input.clientUserId;
  void input.clientRole;
  void input.clientPermission;
  if (input.stateTenantId !== input.actorTenantId || input.stateUserId !== input.actorUserId) {
    return providerError('GITHUB_STATE_INVALID');
  }
  const serviceKey = githubServiceKey(input.installationId);
  const credentialRef = githubInstallationReference(input.installationId);
  if (!serviceKey || !credentialRef) return providerError('GITHUB_STATE_INVALID');
  const accountType = input.accountType === 'Organization' || input.accountType === 'User' ? input.accountType : 'unknown';
  const displayName = ACCOUNT_LOGIN.test(input.accountLogin) ? input.accountLogin : `GitHub ${input.installationId}`;
  return {
    ok: true,
    installationId: input.installationId,
    serviceKey,
    credentialRef,
    displayName,
    accountType,
    accessMethod: 'OAUTH',
  };
}

export function resolveGithubConnection(input: {
  actorTenantId: string;
  connections: readonly GithubConnectionRecord[];
  connectionId?: string | null;
  installationId?: string | null;
  clientTenantId?: string | null;
  clientOrganizationId?: string | null;
  clientUserId?: string | null;
  clientRole?: string | null;
  clientPermission?: string | null;
}): { ok: true; connection: GithubConnectionRecord } | ProviderError {
  void input.clientTenantId;
  void input.clientOrganizationId;
  void input.clientUserId;
  void input.clientRole;
  void input.clientPermission;
  const mine = input.connections.filter((connection) => connection.tenantId === input.actorTenantId);
  const connection = input.connectionId
    ? mine.find((row) => row.id === input.connectionId) ?? null
    : input.installationId
      ? mine.find((row) => installationIdFromConnection(row) === input.installationId) ?? null
      : null;
  if (!connection) return providerError('CONNECTION_NOT_FOUND');
  return { ok: true, connection };
}

export function planRepositorySelection(input: {
  fullName: string;
  repositories: readonly GithubRepository[];
  operation?: 'read' | 'write';
  readonly?: boolean;
}): { ok: true; scopes: ServiceAccessScope[]; repository: GithubRepository } | ProviderError {
  if (!REPOSITORY_NAME.test(input.fullName)) return providerError('GITHUB_NOT_FOUND');
  const repository = input.repositories.find((row) => row.fullName === input.fullName);
  if (!repository) return providerError('GITHUB_NOT_FOUND');
  const scopes = acceptReadOnlyScopes([{
    resource: `repository:${repository.fullName}`,
    operation: input.operation ?? 'read',
    readonly: input.readonly ?? true,
  }]);
  if (!scopes.ok) return scopes;
  return { ok: true, scopes: scopes.scopes, repository };
}

export function repositoryFromGrants(grants: unknown): string | null {
  if (!Array.isArray(grants)) return null;
  for (const item of grants) {
    if (!item || typeof item !== 'object') continue;
    const resource = (item as { resource?: unknown }).resource;
    const mode = (item as { mode?: unknown }).mode;
    if (mode === 'READ' && typeof resource === 'string' && resource.startsWith('repository:')) {
      const fullName = resource.slice('repository:'.length);
      if (REPOSITORY_NAME.test(fullName)) return fullName;
    }
  }
  return null;
}

export function planGithubEvidenceCollection(input: {
  actorTenantId: string;
  connectionTenantId: string;
  connectionId: string;
  requestedConnectionId: string;
  allowedFullName: string | null;
  requestedFullName: string;
  clientTenantId?: string | null;
  clientOrganizationId?: string | null;
  clientUserId?: string | null;
  clientRole?: string | null;
  clientPermission?: string | null;
}): { ok: true; fullName: string } | ProviderError {
  void input.clientTenantId;
  void input.clientOrganizationId;
  void input.clientUserId;
  void input.clientRole;
  void input.clientPermission;
  if (input.connectionTenantId !== input.actorTenantId || input.connectionId !== input.requestedConnectionId) {
    return providerError('CONNECTION_NOT_FOUND');
  }
  if (!input.allowedFullName || input.requestedFullName !== input.allowedFullName) return providerError('SCOPE_DENIED');
  return { ok: true, fullName: input.allowedFullName };
}

export function planGithubDisconnect(input: {
  actorTenantId: string;
  connection: GithubConnectionRecord | null;
  clientTenantId?: string | null;
}): { ok: true; connectionId: string; externalUninstall: false } | ProviderError {
  void input.clientTenantId;
  if (!input.connection || input.connection.tenantId !== input.actorTenantId) return providerError('CONNECTION_NOT_FOUND');
  if (!input.connection.serviceKey.startsWith('github-')) return providerError('CONNECTION_NOT_FOUND');
  return { ok: true, connectionId: input.connection.id, externalUninstall: false };
}
