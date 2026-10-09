/**
 * Mock is the only provider implementation.
 * Discovery delegates to the existing mock discovery plan and does not open a network connection.
 * Evidence collection normalizes caller-supplied measurements. It does not persist evidence.
 */
import { buildMockDiscovery } from '../discovery';
import type { JuryAccessMethod, JuryConnectionStatus } from '../records';
import {
  isCredentialUsable,
  normalizeMeasuredValue,
  providerError,
  type ConnectionHealth,
  type CredentialStatus,
  type DiscoveryResult,
  type NormalizedEvidence,
  type ProviderError,
  type ServiceAdapter,
} from './provider-types';

function connectionHealth(input: {
  connectionStatus: JuryConnectionStatus | null;
  credentialStatus: CredentialStatus;
  hasDiscovery: boolean;
  hasEvidence: boolean;
}): ConnectionHealth {
  if (!input.connectionStatus) return 'UNKNOWN';
  if (input.connectionStatus === 'ERROR' || input.credentialStatus === 'ERROR') return 'FAILED';
  if (input.connectionStatus === 'DISCONNECTED' || input.credentialStatus === 'REVOKED') return 'REVOKED';
  if (input.credentialStatus === 'EXPIRED') return 'EXPIRED';
  if (input.credentialStatus === 'UNCONFIGURED' || input.credentialStatus === 'PENDING') return 'UNKNOWN';
  if (input.connectionStatus === 'CONNECTED' && input.hasEvidence) return 'HEALTHY';
  if (input.connectionStatus === 'CONNECTED' && input.hasDiscovery) return 'DEGRADED';
  return 'UNKNOWN';
}

export function createMockServiceAdapter(): ServiceAdapter {
  return {
    provider: 'MOCK',
    discover(input): DiscoveryResult | ProviderError {
      if (input.connection.tenantId !== input.actorTenantId) return providerError('CONNECTION_NOT_FOUND');
      const drafted = buildMockDiscovery({
        actorTenantId: input.actorTenantId,
        connection: {
          ...input.connection,
          credentialRef: undefined,
        },
        now: input.now,
        allocateId: () => 'boundary-id',
      });
      if (!drafted.ok) return providerError('DISCOVERY_FAILED');
      return {
        provider: 'MOCK',
        tenantId: drafted.discovery.tenantId,
        connectionId: drafted.discovery.connectionId,
        discoveredResources: [...drafted.discovery.surfaces],
        requestedScopes: drafted.scope.grants.map((grant) => ({
          resource: grant.resource,
          operation: 'read' as const,
          readonly: grant.mode === 'READ',
        })),
        warnings: [drafted.discovery.uiNotes ?? 'Measurement is not part of discovery.'],
        status: drafted.discovery.feasibility === 'AVAILABLE'
          ? 'DISCOVERED'
          : drafted.discovery.feasibility === 'PARTIAL'
            ? 'PARTIAL'
            : 'FAILED',
      };
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
          provider: 'MOCK',
          connectionId: input.connectionId,
          readOnly: true,
          metrics: input.metrics.map((metric) => ({
            metric: metric.metric,
            ...normalizeMeasuredValue(metric.value, metric.availability),
          })),
        },
      };
    },
    health: connectionHealth,
  };
}

export function mockConnection(input: {
  id: string;
  tenantId: string;
  serviceKey?: string;
  accessMethod?: JuryAccessMethod;
  status?: JuryConnectionStatus;
}): {
  id: string;
  tenantId: string;
  serviceKey: string;
  displayName: string;
  accessMethod: JuryAccessMethod;
  status: JuryConnectionStatus;
  createdAt: string;
  updatedAt: string;
} {
  return {
    id: input.id,
    tenantId: input.tenantId,
    serviceKey: input.serviceKey ?? 'mock-service',
    displayName: 'Mock service',
    accessMethod: input.accessMethod ?? 'API_KEY',
    status: input.status ?? 'DISCOVERY_PENDING',
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
  };
}
