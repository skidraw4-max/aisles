/**
 * Global provider metadata. Connections, credential references, discovery, and evidence stay tenant-scoped.
 * The registry does not call an external API. GitHub network access stays in the GitHub client.
 */
import { createGithubServiceAdapter } from './github/adapter';
import { createMockServiceAdapter } from './mock-adapter';
import {
  providerError,
  type ProviderError,
  type ServiceProviderDefinition,
  type ServiceProviderId,
} from './provider-types';

const MOCK_PROVIDER: ServiceProviderDefinition = {
  provider: 'MOCK',
  displayName: 'Mock service',
  capabilities: {
    discovery: true,
    evidence: true,
    canRead: true,
    canWrite: false,
    oauth: false,
    apiKey: false,
  },
  connectionMethods: ['OAUTH', 'API_KEY', 'READ_ONLY_ACCOUNT', 'BROWSER_SESSION', 'FILE_IMPORT'],
  scopes: [{ resource: 'service', operation: 'read', readonly: true }],
  adapterFactory: createMockServiceAdapter,
};

const GITHUB_PROVIDER: ServiceProviderDefinition = {
  provider: 'GITHUB',
  displayName: 'GitHub',
  capabilities: {
    discovery: true,
    evidence: true,
    canRead: true,
    canWrite: false,
    oauth: false,
    apiKey: false,
  },
  connectionMethods: ['OAUTH'],
  scopes: [{ resource: 'repository', operation: 'read', readonly: true }],
  adapterFactory: () => createGithubServiceAdapter(),
};

const REGISTRY: Record<ServiceProviderId, ServiceProviderDefinition> = {
  MOCK: MOCK_PROVIDER,
  GITHUB: GITHUB_PROVIDER,
};

export function getServiceProviderDefinition(
  provider: string,
): { ok: true; definition: ServiceProviderDefinition } | ProviderError {
  if (provider === 'MOCK' || provider === 'GITHUB') return { ok: true, definition: REGISTRY[provider] };
  return providerError('UNSUPPORTED_PROVIDER');
}

export function supportedServiceProviders(): readonly ServiceProviderId[] {
  return ['MOCK', 'GITHUB'];
}

/**
 * Existing JuryServiceConnection rows have no provider column.
 * A missing adapter key stays MOCK. GitHub is the explicit adapter key `github`.
 */
export function resolveServiceProvider(adapterKey?: string | null): { ok: true; provider: ServiceProviderId } | ProviderError {
  if (adapterKey == null || adapterKey.trim() === '' || adapterKey === 'mock') {
    return { ok: true, provider: 'MOCK' };
  }
  if (adapterKey === 'github') return { ok: true, provider: 'GITHUB' };
  return providerError('UNSUPPORTED_PROVIDER');
}
