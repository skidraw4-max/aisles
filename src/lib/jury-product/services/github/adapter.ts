/**
 * GitHub adapter normalizes already-fetched reads.
 * An adapter created without repositories does not invent a discovery result and does not call GitHub.
 */
import {
  isCredentialUsable,
  normalizeMeasuredValue,
  providerError,
  type ConnectionHealth,
  type DiscoveryResult,
  type NormalizedEvidence,
  type ProviderError,
  type ServiceAdapter,
} from '../provider-types';
import { toServiceDiscovery, type GithubRepository } from './discovery';

function connectionHealth(input: Parameters<ServiceAdapter['health']>[0]): ConnectionHealth {
  if (!input.connectionStatus) return 'UNKNOWN';
  if (input.connectionStatus === 'ERROR' || input.credentialStatus === 'ERROR') return 'FAILED';
  if (input.connectionStatus === 'DISCONNECTED' || input.credentialStatus === 'REVOKED') return 'REVOKED';
  if (input.credentialStatus === 'EXPIRED') return 'EXPIRED';
  if (input.connectionStatus === 'LIMITED') return 'DEGRADED';
  if (input.connectionStatus === 'CONNECTED' && input.credentialStatus === 'ACTIVE') return 'HEALTHY';
  return 'UNKNOWN';
}

export function createGithubServiceAdapter(repositories?: readonly GithubRepository[]): ServiceAdapter {
  return {
    provider: 'GITHUB',
    discover(input): DiscoveryResult | ProviderError {
      if (input.connection.tenantId !== input.actorTenantId) return providerError('CONNECTION_NOT_FOUND');
      if (!repositories) return providerError('PROVIDER_UNAVAILABLE');
      return toServiceDiscovery({
        tenantId: input.actorTenantId,
        connectionId: input.connection.id,
        repositories,
      });
    },
    collectEvidence(input): { ok: true; evidence: NormalizedEvidence } | ProviderError {
      if (input.writeRequested) return providerError('READ_ACCESS_REQUIRED');
      if (!isCredentialUsable(input.credentialStatus)) {
        if (input.credentialStatus === 'EXPIRED') return providerError('CREDENTIAL_EXPIRED');
        if (input.credentialStatus === 'REVOKED') return providerError('CREDENTIAL_REVOKED');
        return providerError('CREDENTIAL_UNAVAILABLE');
      }
      return {
        ok: true,
        evidence: {
          provider: 'GITHUB',
          connectionId: input.connectionId,
          readOnly: true,
          metrics: input.metrics.map((metric) => {
            const normalized = normalizeMeasuredValue(metric.value, metric.availability);
            return { metric: metric.metric, value: normalized.value, availability: normalized.availability };
          }),
        },
      };
    },
    health(input): ConnectionHealth {
      return connectionHealth(input);
    },
  };
}
