import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { projectServiceOperation, accessSummary, type OperationCapabilities } from '../service-operations-status';
import type { JuryConsoleView } from '../console-view';
import { createMockServiceAdapter, mockConnection } from './mock-adapter';
import {
  credentialReferenceFor,
  deriveCredentialStatus,
  planDeleteConnection,
  planDisconnect,
  planProviderAudit,
  projectProviderView,
  requireConnectionTenant,
} from './provider-boundary';
import { getServiceProviderDefinition, resolveServiceProvider, supportedServiceProviders } from './provider-registry';
import {
  containsRawCredential,
  isCredentialUsable,
  mapConnectionMethod,
  normalizeMeasuredValue,
  providerError,
} from './provider-types';

const SECRET = 'FAKE_SECRET_80_13';
const ALL: OperationCapabilities = {
  discovery: true,
  scope: true,
  collectEvidence: true,
  review: true,
  improve: true,
  agent: true,
};

test('provider registry exposes mock and rejects an unimplemented provider', () => {
  const mock = getServiceProviderDefinition('MOCK');
  assert.equal(mock.ok, true);
  if (!mock.ok) return;
  assert.equal(mock.definition.displayName, 'Mock service');
  assert.equal(mock.definition.capabilities.canRead, true);
  assert.equal(mock.definition.capabilities.canWrite, false);
  assert.equal(mock.definition.capabilities.oauth, false);
  assert.equal(mock.definition.capabilities.apiKey, false);
  assert.deepEqual(supportedServiceProviders(), ['MOCK', 'GITHUB']);
  const slack = getServiceProviderDefinition('SLACK');
  assert.equal(slack.ok, false);
  if (!slack.ok) assert.equal(slack.code, 'UNSUPPORTED_PROVIDER');
  const github = getServiceProviderDefinition('GITHUB');
  assert.equal(github.ok, true);
  if (github.ok) assert.equal(github.definition.capabilities.canWrite, false);
  assert.equal(resolveServiceProvider(undefined).ok, true);
  assert.equal(resolveServiceProvider('mock').ok, true);
  assert.equal(resolveServiceProvider('github').ok, true);
  assert.equal(resolveServiceProvider('GITHUB').ok, false);
  const ga4 = resolveServiceProvider('ga4');
  assert.equal(ga4.ok, false);
  if (!ga4.ok) assert.equal(ga4.code, 'UNSUPPORTED_PROVIDER');
  assert.equal(mapConnectionMethod('FILE_UPLOAD'), 'FILE_IMPORT');
  assert.equal(mapConnectionMethod('API_KEY'), 'API_KEY');
});

test('credential reference keeps a pointer and rejects a raw secret', () => {
  assert.equal(isCredentialUsable('ACTIVE'), true);
  assert.equal(isCredentialUsable('EXPIRED'), false);
  assert.equal(isCredentialUsable('REVOKED'), false);
  assert.equal(deriveCredentialStatus({ credentialRef: 'secret-store/mock', connectionStatus: 'CONNECTED' }), 'ACTIVE');
  assert.equal(deriveCredentialStatus({ credentialRef: null, connectionStatus: 'CONNECTED' }), 'UNCONFIGURED');
  assert.equal(deriveCredentialStatus({ credentialRef: SECRET, connectionStatus: 'CONNECTED' }), 'ERROR');
  const reference = credentialReferenceFor({
    actorTenantId: 'org-a',
    provider: 'MOCK',
    connection: {
      id: 'svc-a',
      tenantId: 'org-a',
      credentialRef: 'secret-store/mock',
      status: 'CONNECTED',
      createdAt: '2026-10-01T00:00:00.000Z',
    },
    clientTenantId: 'org-b',
  });
  assert.equal(reference.ok, true);
  if (!reference.ok) return;
  assert.equal(reference.reference.referenceId, 'secret-store/mock');
  assert.equal(JSON.stringify(reference).includes(SECRET), false);
  const hidden = credentialReferenceFor({
    actorTenantId: 'org-a',
    provider: 'MOCK',
    connection: {
      id: 'svc-b',
      tenantId: 'org-b',
      credentialRef: SECRET,
      status: 'CONNECTED',
      createdAt: '2026-10-01T00:00:00.000Z',
    },
  });
  assert.equal(hidden.ok, false);
  if (!hidden.ok) assert.equal(JSON.stringify(hidden).includes(SECRET), false);
});

test('mock discovery and evidence stay read-only and keep null distinct from zero', () => {
  const adapter = createMockServiceAdapter();
  const discovered = adapter.discover({
    actorTenantId: 'org-a',
    connection: mockConnection({ id: 'svc-a', tenantId: 'org-a' }),
  });
  assert.equal('status' in discovered && discovered.status, 'PARTIAL');
  if ('status' in discovered) {
    assert.equal(discovered.requestedScopes.every((scope) => scope.readonly && scope.operation === 'read'), true);
  }
  const foreign = adapter.discover({
    actorTenantId: 'org-a',
    connection: mockConnection({ id: 'svc-b', tenantId: 'org-b' }),
  });
  assert.equal('code' in foreign && foreign.code, 'CONNECTION_NOT_FOUND');
  const collected = adapter.collectEvidence({
    connectionId: 'svc-a',
    credentialStatus: 'ACTIVE',
    metrics: [
      { metric: 'newUsersLast7d', value: 0 },
      { metric: 'activeUsersLast7d', value: null, availability: 'NOT_MEASURED' },
    ],
  });
  assert.equal(collected.ok, true);
  if (!collected.ok) return;
  assert.equal(collected.evidence.readOnly, true);
  assert.deepEqual(collected.evidence.metrics[0], { metric: 'newUsersLast7d', value: 0, availability: 'AVAILABLE' });
  assert.deepEqual(collected.evidence.metrics[1], { metric: 'activeUsersLast7d', value: null, availability: 'NOT_MEASURED' });
  assert.equal(adapter.collectEvidence({ connectionId: 'svc-a', credentialStatus: 'ACTIVE', writeRequested: true, metrics: [] }).ok, false);
  assert.deepEqual(normalizeMeasuredValue(0), { value: 0, availability: 'AVAILABLE' });
  assert.deepEqual(normalizeMeasuredValue(null), { value: null, availability: 'NOT_MEASURED' });
});

test('disconnect is not delete, and another organization cannot resolve the connection', () => {
  const connection = { id: 'svc-a', tenantId: 'org-a' };
  const disconnected = planDisconnect({ actorTenantId: 'org-a', connection });
  const deleted = planDeleteConnection({ actorTenantId: 'org-a', connection });
  assert.equal(disconnected.ok && deleted.ok && disconnected.action !== deleted.action, true);
  assert.equal(planDisconnect({ actorTenantId: 'org-b', connection }).ok, false);
  const denied = requireConnectionTenant({
    actorTenantId: 'org-a',
    connection,
    serviceRead: false,
    clientTenantId: 'org-a',
    clientPermission: 'AGENT',
  });
  assert.equal(denied.ok, false);
  if (!denied.ok) assert.equal(denied.code, 'CONNECTION_UNAUTHORIZED');
  const missing = requireConnectionTenant({
    actorTenantId: 'org-a',
    connection: { id: 'svc-b', tenantId: 'org-b' },
    serviceRead: true,
  });
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.equal(missing.code, 'CONNECTION_NOT_FOUND');
});

test('provider errors, audits, and UI projections omit the fake secret', () => {
  const error = providerError('EVIDENCE_COLLECTION_FAILED', SECRET);
  assert.equal(JSON.stringify(error).includes(SECRET), false);
  const audit = planProviderAudit({
    action: 'CREDENTIAL_CONNECTED',
    tenantId: 'org-a',
    connectionId: 'svc-a',
    detail: { token: SECRET, note: 'stored' },
  });
  assert.equal(audit.ok, false);
  assert.equal(JSON.stringify(audit).includes(SECRET), false);
  const leaked = {
    evidence: { note: SECRET },
    review: { summary: `see ${SECRET}` },
    improvement: { diagnosis: SECRET },
    agent: { provenance: { apiKey: SECRET } },
    log: `failed ${SECRET}`,
  };
  assert.equal(containsRawCredential(leaked), true);
  const view = projectProviderView({
    actorTenantId: 'org-a',
    connection: {
      id: 'svc-a',
      tenantId: 'org-a',
      accessMethod: 'API_KEY',
      status: 'CONNECTED',
      credentialRef: SECRET,
      createdAt: '2026-10-01T00:00:00.000Z',
    },
    hasDiscovery: true,
    hasEvidence: true,
  });
  assert.equal(view.ok, true);
  if (!view.ok) return;
  assert.equal(view.view.credentialStatus, 'ERROR');
  assert.equal(view.view.health, 'FAILED');
  assert.equal(JSON.stringify(view).includes(SECRET), false);
  assert.equal('credentialRef' in view.view, false);
});

test('connection health stays beside service operations and does not replace them', () => {
  const view = emptyView();
  view.evidence = [{
    id: 'ev', tenantId: 'org-a', connectionId: 'svc-a', purpose: 'observe',
    periodStart: '2026-10-01', periodEnd: '2026-10-07', timezone: 'Asia/Seoul',
    metricIds: [], adapterKey: 'mock', collectedAt: '2026-10-08T10:00:00.000Z',
  }];
  const operation = projectServiceOperation(view, 'svc-a', ALL, accessSummary('OWNER', []), '2026-10-08T12:00:00.000Z');
  assert.equal(operation?.phase, 'EVIDENCE_READY');
  assert.equal(operation?.health, 'NOT_READY');
  const boundary = projectProviderView({
    actorTenantId: 'org-a',
    connection: { ...view.connections[0]!, credentialRef: null },
    hasDiscovery: true,
    hasEvidence: true,
  });
  assert.equal(boundary.ok, true);
  if (!boundary.ok) return;
  assert.equal(boundary.view.health, 'UNKNOWN');
  assert.equal(operation?.phase, 'EVIDENCE_READY');
});

test('provider boundary source does not persist credentials or call a provider', () => {
  const files = ['provider-types.ts', 'provider-registry.ts', 'provider-boundary.ts', 'mock-adapter.ts'];
  const source = files.map((file) => readFileSync(new URL(`./${file}`, import.meta.url), 'utf8')).join('\n');
  assert.equal(source.includes('Raw credentials are not stored in Prisma.'), true);
  assert.equal(source.includes("from '@/lib/prisma'"), false);
  assert.equal(source.includes('prisma.'), false);
  assert.equal(source.includes('fetch('), false);
  assert.equal(source.includes('evaluateChangeGate'), false);
  assert.equal(source.includes('evaluateHumanReReview'), false);
  assert.equal(source.includes('runReviewBoardPipeline'), false);
  assert.equal(source.includes(SECRET), false);
});

function emptyView(): JuryConsoleView {
  return {
    tenantId: 'org-a',
    role: 'OWNER',
    connections: [{
      id: 'svc-a',
      tenantId: 'org-a',
      serviceKey: 'mock-service',
      displayName: 'Mock service',
      accessMethod: 'API_KEY',
      status: 'CONNECTED',
      createdAt: '2026-10-01T00:00:00.000Z',
      updatedAt: '2026-10-01T00:00:00.000Z',
    }],
    scopes: [{
      id: 'scope', tenantId: 'org-a', connectionId: 'svc-a', status: 'APPROVED',
      grants: [{ resource: 'metrics.read', mode: 'READ' }], approvedAt: '2026-10-01T00:00:00.000Z',
    }],
    discoveries: [{
      id: 'discovery', tenantId: 'org-a', connectionId: 'svc-a', exploredAt: '2026-10-01T00:00:00.000Z',
      surfaces: ['API'], menus: ['ops'], dataSources: ['API'], feasibility: 'PARTIAL',
      proposedMetrics: [], approval: 'APPROVED',
    }],
    metrics: [],
    evidence: [],
    requests: [],
    results: [],
    tasks: [],
    executions: [],
    gates: [],
    reReviews: [],
    audit: [],
    loopPolicy: { maxIterations: null, maxRuntimeMs: null, maxCostUsd: null },
  };
}
