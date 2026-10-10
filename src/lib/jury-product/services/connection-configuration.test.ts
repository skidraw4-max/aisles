import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { JURY_CORE_CONTRACT_VERSION, JURY_PRODUCT_DATA_ROOT } from '../records';
import { accessSummary, projectServiceOperation, type OperationCapabilities } from '../service-operations-status';
import type { JuryConsoleView } from '../console-view';
import {
  acceptReadOnlyScopes,
  connectionMethodMetadata,
  knownConnectionMethod,
  planDisconnectConnection,
  planRevokeCredential,
  projectConnectionConfiguration,
  projectConnectionLifecycle,
  projectConnectionReadiness,
  unsupportedProviderReadiness,
} from './connection-configuration';
import { deriveCredentialStatus } from './provider-boundary';
import { providerError } from './provider-types';

const SECRET = 'FAKE_SECRET_80_14';
const ALL: OperationCapabilities = {
  discovery: true,
  scope: true,
  collectEvidence: true,
  review: true,
  improve: true,
  agent: true,
};

test('mock read-only configuration projects the stored connection without an external connect', () => {
  const configured = projectConnectionConfiguration({
    provider: 'MOCK',
    displayName: 'Mock service',
    accessMethod: 'API_KEY',
    connectionStatus: 'CONNECTED',
    credentialStatus: 'ACTIVE',
    health: 'HEALTHY',
    clientTenantId: 'other-org',
    clientRole: 'OWNER',
    clientPermission: 'AGENT',
  });
  assert.equal(configured.ok, true);
  if (!configured.ok) return;
  assert.equal(configured.configuration.lifecycle, 'CONNECTED');
  assert.equal(configured.configuration.readiness, 'CONNECTED');
  assert.equal(configured.configuration.accessMode, 'READ_ONLY');
  assert.equal(configured.configuration.method.implemented, false);
  assert.equal(configured.configuration.capabilities.includes('WRITE'), false);
  assert.equal(configured.configuration.capabilities.includes('READ'), true);
  assert.equal(configured.configuration.notice.includes('외부 인증'), true);
  assert.equal(projectConnectionLifecycle({
    providerImplemented: true,
    connectionStatus: 'DISCOVERY_PENDING',
    credentialStatus: 'UNCONFIGURED',
  }), 'CONFIGURING');
  assert.equal(projectConnectionLifecycle({
    providerImplemented: true,
    connectionStatus: 'CONNECTED',
    credentialStatus: 'ACTIVE',
  }) === 'CONNECTING', false);
});

test('readiness follows provider, method, and credential status', () => {
  assert.equal(unsupportedProviderReadiness('SLACK'), 'NOT_READY');
  assert.equal(unsupportedProviderReadiness('github'), 'READY_TO_CONNECT');
  assert.equal(knownConnectionMethod('FILE_IMPORT'), true);
  assert.equal(knownConnectionMethod('FILE_UPLOAD'), false);
  assert.equal(connectionMethodMetadata('FILE_IMPORT').implemented, false);
  assert.equal(connectionMethodMetadata('OAUTH').requiresExternalRedirect, true);
  const token = projectConnectionConfiguration({
    provider: 'MOCK',
    displayName: 'Mock service',
    accessMethod: 'API_KEY',
    connectionStatus: 'CONNECTED',
    credentialStatus: 'ACTIVE',
    health: 'UNKNOWN',
    requestedScopes: [{ resource: 'token-bucket', operation: 'read', readonly: true }],
  });
  assert.equal(token.ok, true);
  assert.equal(projectConnectionReadiness({
    providerImplemented: true,
    methodSupported: false,
    credentialStatus: 'ACTIVE',
  }), 'ACTION_REQUIRED');
  assert.equal(projectConnectionReadiness({ providerImplemented: false, methodSupported: true, credentialStatus: 'ACTIVE' }), 'NOT_READY');
  assert.equal(projectConnectionReadiness({ providerImplemented: true, methodSupported: true, credentialStatus: 'UNCONFIGURED' }), 'READY_TO_CONNECT');
  assert.equal(projectConnectionReadiness({ providerImplemented: true, methodSupported: true, credentialStatus: 'ACTIVE' }), 'CONNECTED');
  assert.equal(projectConnectionReadiness({ providerImplemented: true, methodSupported: true, credentialStatus: 'EXPIRED' }), 'ACTION_REQUIRED');
  assert.equal(projectConnectionReadiness({ providerImplemented: true, methodSupported: true, credentialStatus: 'REVOKED' }), 'ACTION_REQUIRED');
  assert.equal(projectConnectionReadiness({ providerImplemented: true, methodSupported: true, credentialStatus: 'ERROR' }), 'BLOCKED');
  assert.equal(projectConnectionLifecycle({ providerImplemented: true, connectionStatus: 'CONNECTED', credentialStatus: 'EXPIRED' }), 'EXPIRED');
  assert.equal(projectConnectionLifecycle({ providerImplemented: true, connectionStatus: 'CONNECTED', credentialStatus: 'REVOKED' }), 'REVOKED');
  assert.equal(projectConnectionLifecycle({ providerImplemented: true, connectionStatus: 'ERROR', credentialStatus: 'ACTIVE' }), 'ERROR');
});

test('write scope is rejected and plans do not persist or leak the fake secret', () => {
  const write = acceptReadOnlyScopes([{ resource: 'analytics', operation: 'write', readonly: false }]);
  assert.equal(write.ok, false);
  if (!write.ok) {
    assert.equal(write.code, 'READ_ACCESS_REQUIRED');
    assert.equal(JSON.stringify(write).includes(SECRET), false);
  }
  const connection = { id: 'svc-a', tenantId: 'org-a', credentialRef: 'secret-store/mock' };
  const before = JSON.stringify(connection);
  const disconnected = planDisconnectConnection({
    actorTenantId: 'org-a',
    provider: 'MOCK',
    connection,
    clientTenantId: 'org-b',
    clientPermission: 'AGENT',
  });
  const revoked = planRevokeCredential({
    actorTenantId: 'org-a',
    provider: 'MOCK',
    connection,
    clientTenantId: 'org-b',
    actingUserId: 'other-user',
  });
  assert.equal(disconnected.ok && disconnected.action, 'DISCONNECT');
  assert.equal(revoked.ok && revoked.action, 'REVOKE_CREDENTIAL');
  assert.equal(JSON.stringify(connection), before);
  const foreign = planRevokeCredential({
    actorTenantId: 'org-a',
    provider: 'MOCK',
    connection: { id: 'svc-b', tenantId: 'org-b', credentialRef: SECRET },
  });
  assert.equal(foreign.ok, false);
  if (!foreign.ok) assert.equal(foreign.code, 'CONNECTION_NOT_FOUND');
  assert.equal(JSON.stringify(foreign).includes(SECRET), false);
  const leaked = planDisconnectConnection({
    actorTenantId: 'org-a',
    provider: 'MOCK',
    connection: { id: 'svc-a', tenantId: 'org-a', credentialRef: SECRET },
  });
  assert.equal(leaked.ok, false);
  assert.equal(JSON.stringify(leaked).includes(SECRET), false);
  const error = providerError('CREDENTIAL_UNAVAILABLE', SECRET);
  assert.equal(JSON.stringify(error).includes(SECRET), false);
  assert.equal(deriveCredentialStatus({ credentialRef: SECRET, connectionStatus: 'CONNECTED' }), 'ERROR');
});

test('operations health stays independent when the connection lifecycle is connected', () => {
  const view = connectedView();
  const operation = projectServiceOperation(view, 'svc-a', ALL, accessSummary('OWNER', []), '2026-10-08T12:00:00.000Z');
  const configuration = projectConnectionConfiguration({
    provider: 'MOCK',
    displayName: 'Mock service',
    accessMethod: 'API_KEY',
    connectionStatus: 'CONNECTED',
    credentialStatus: 'ACTIVE',
    health: 'HEALTHY',
  });
  assert.equal(operation?.health, 'ATTENTION');
  assert.equal(configuration.ok && configuration.configuration.lifecycle, 'CONNECTED');
  assert.equal(configuration.ok && configuration.configuration.connectionStatus, 'CONNECTED');
});

test('configuration source does not store credentials or call a provider', () => {
  const source = readFileSync(new URL('./connection-configuration.ts', import.meta.url), 'utf8');
  assert.equal(source.includes("from '@/lib/prisma'"), false);
  assert.equal(source.includes('fetch('), false);
  assert.equal(source.includes('accessToken'), false);
  assert.equal(source.includes('refreshToken'), false);
  assert.equal(source.includes('clientSecret'), false);
  assert.equal(source.includes(SECRET), false);
});

function connectedView(): JuryConsoleView {
  return {
    tenantId: 'org-a',
    role: 'OWNER',
    connections: [{
      id: 'svc-a', tenantId: 'org-a', serviceKey: 'mock-service', displayName: 'Mock service',
      accessMethod: 'API_KEY', status: 'CONNECTED', createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z',
    }],
    scopes: [{
      id: 'scope', tenantId: 'org-a', connectionId: 'svc-a', status: 'APPROVED',
      grants: [{ resource: 'metrics.read', mode: 'READ' }], approvedAt: '2026-10-01T00:00:00.000Z',
    }],
    discoveries: [{
      id: 'discovery', tenantId: 'org-a', connectionId: 'svc-a', exploredAt: '2026-10-01T00:00:00.000Z',
      surfaces: ['API'], menus: ['ops'], dataSources: ['API'], feasibility: 'PARTIAL', proposedMetrics: [], approval: 'APPROVED',
    }],
    metrics: [],
    evidence: [{
      id: 'ev', tenantId: 'org-a', connectionId: 'svc-a', purpose: 'observe',
      periodStart: '2026-10-01', periodEnd: '2026-10-07', timezone: 'Asia/Seoul',
      metricIds: [], adapterKey: 'mock', collectedAt: '2026-10-08T10:00:00.000Z',
    }],
    requests: [{
      id: 'req', tenantId: 'org-a', connectionId: 'svc-a', evidenceId: 'ev', reviewType: 'FULL_REVIEW',
      mode: 'AISLE_SELF', status: 'COMPLETED', coreRootDir: JURY_PRODUCT_DATA_ROOT,
    }],
    results: [{
      id: 'rev', tenantId: 'org-a', reviewRequestId: 'req', boardRunId: 'run', evidenceStrength: 'strong',
      claimStrength: 'weak', conflictDetected: false, overclaimDetected: false, revisionRequired: true,
      expectedDecision: 'REWORD',
      finalSurface: {
        statusSummary: 'Final', topProblems: [], expectedUserEffect: '', risk: '',
        dimensionEvidence: [], supportedClaims: [], partiallySupportedClaims: [], hypotheses: [],
      },
      contractVersion: JURY_CORE_CONTRACT_VERSION, completedAt: '2026-10-08T11:00:00.000Z',
    }],
    tasks: [{
      id: 'task', tenantId: 'org-a', reviewResultId: 'rev', diagnosis: 'Reword',
      acceptanceCriteria: [], status: 'OPEN', loopIndex: 1,
      loopPolicy: { maxIterations: null, maxRuntimeMs: null, maxCostUsd: null },
    }],
    executions: [],
    gates: [],
    reReviews: [],
    audit: [],
    loopPolicy: { maxIterations: null, maxRuntimeMs: null, maxCostUsd: null },
  };
}
