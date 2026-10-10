/**
 * GitHub installation connections do not use MockDiscoveryAdapter.
 * Run: node --import tsx --test src/lib/jury-product/services/github/onboarding-discovery.test.ts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import type { JuryConsoleView } from '../../console-view';
import type { JuryServiceConnection } from '../../records';
import { projectServiceOnboarding } from '../../service-onboarding';
import type { GithubRepository } from './discovery';
import {
  isGithubInstallationConnection,
  isSyntheticMockDiscovery,
  planGithubOnboardingRecord,
  syntheticMockMetricNames,
} from './onboarding-discovery';

const NOW = '2026-10-09T00:00:00.000Z';

function connection(extra: Partial<JuryServiceConnection> = {}): JuryServiceConnection {
  return {
    id: 'conn-github',
    tenantId: 'tenant-1',
    serviceKey: 'github-99',
    displayName: 'octo',
    accessMethod: 'OAUTH',
    status: 'CONNECTED',
    credentialRef: 'github-installation/99',
    createdAt: NOW,
    updatedAt: NOW,
    ...extra,
  };
}

function repository(name: string): GithubRepository {
  return {
    id: name.length,
    owner: 'octo',
    name,
    fullName: `octo/${name}`,
    private: false,
    defaultBranch: 'main',
    archived: false,
    disabled: false,
    htmlUrl: `https://github.com/octo/${name}`,
    visibility: 'public',
  };
}

test('github installation identity requires the callback service key and credential reference', () => {
  assert.equal(isGithubInstallationConnection(connection()), true);
  assert.equal(isGithubInstallationConnection(connection({ serviceKey: 'shop' })), false);
  assert.equal(isGithubInstallationConnection(connection({ credentialRef: 'mock-connection-001' })), false);
  assert.equal(isGithubInstallationConnection(connection({ credentialRef: 'github-installation/100' })), false);
  assert.equal(isGithubInstallationConnection({ serviceKey: 'github-99' }), false);
});

test('github onboarding discovery records repositories and does not invent mock metrics', () => {
  const row = connection();
  const planned = planGithubOnboardingRecord({
    tenantId: row.tenantId,
    connection: row,
    repositories: [repository('widget'), repository('api')],
    now: NOW,
    discoveryId: 'discovery-1',
    scopeId: 'scope-1',
  });
  assert.equal(planned.ok, true);
  if (!planned.ok) return;
  assert.equal(planned.discovery.feasibility, 'AVAILABLE');
  assert.equal(planned.discovery.approval, 'PENDING');
  assert.deepEqual(planned.discovery.proposedMetrics.map((item) => item.metric), ['repository:octo/widget', 'repository:octo/api']);
  assert.deepEqual(planned.scope.grants, [
    { resource: 'repository:octo/widget', mode: 'READ' },
    { resource: 'repository:octo/api', mode: 'READ' },
  ]);
  assert.equal(planned.scope.status, 'PROPOSED');
  const serialized = JSON.stringify(planned);
  assert.equal(serialized.includes('.routes'), false);
  assert.equal(serialized.includes('.api'), false);
  assert.equal(serialized.includes('metric:'), false);
  assert.equal(serialized.includes('MockDiscoveryAdapter'), false);
});

test('an incomplete or empty GitHub repository list is not reported as available', () => {
  const row = connection();
  const partial = planGithubOnboardingRecord({
    tenantId: row.tenantId,
    connection: row,
    repositories: [repository('widget')],
    incomplete: true,
    now: NOW,
    discoveryId: 'discovery-2',
    scopeId: 'scope-2',
  });
  assert.equal(partial.ok, true);
  if (!partial.ok) return;
  assert.equal(partial.discovery.feasibility, 'PARTIAL');
  const empty = planGithubOnboardingRecord({
    tenantId: row.tenantId,
    connection: row,
    repositories: [],
    now: NOW,
    discoveryId: 'discovery-3',
    scopeId: 'scope-3',
  });
  assert.equal(empty.ok, true);
  if (!empty.ok) return;
  assert.equal(empty.discovery.feasibility, 'NOT_AVAILABLE');
  assert.deepEqual(empty.scope.grants, []);
});

test('synthetic mock metrics stay distinguishable from repository discovery', () => {
  const names = syntheticMockMetricNames('github-99');
  assert.deepEqual(names, ['github-99.routes', 'github-99.api']);
  assert.equal(isSyntheticMockDiscovery('github-99', names.map((metric) => ({ metric }))), true);
  assert.equal(isSyntheticMockDiscovery('github-99', [{ metric: 'repository:octo/widget' }]), false);
});

test('a connected GitHub installation does not open the mock evidence form', () => {
  const row = connection();
  const view = {
    tenantId: row.tenantId,
    connections: [row],
    discoveries: [],
    scopes: [],
  } as unknown as JuryConsoleView;
  assert.equal(projectServiceOnboarding(view, row.id)?.canOpenEvidence, false);
});

test('onboarding routes a GitHub installation away from runMockDiscovery', () => {
  const source = readFileSync(path.resolve(process.cwd(), 'src/lib/jury-product/service-onboarding.ts'), 'utf8');
  const discovery = source.slice(
    source.indexOf('export async function persistOnboardingDiscovery'),
    source.indexOf('export async function persistOnboardingScopeDecision'),
  );
  assert.equal(source.includes('fetch('), false);
  assert.equal(discovery.includes('runMockDiscovery'), true);
  assert.ok(discovery.indexOf('isGithubInstallationConnection') < discovery.indexOf('runMockDiscovery'));
  assert.equal(discovery.includes('persistGithubOnboardingDiscovery'), true);
  const decision = source.slice(source.indexOf('export async function persistOnboardingScopeDecision'));
  assert.ok(decision.indexOf('isGithubInstallationConnection') < decision.indexOf('runScopeDecision'));
  const collection = readFileSync(path.resolve(process.cwd(), 'src/lib/jury-product/connected-service-review.ts'), 'utf8');
  const collect = collection.slice(collection.indexOf('export async function runConnectedServiceEvidenceCollection'));
  assert.ok(collect.indexOf('isGithubInstallationConnection') < collect.indexOf('runAisleServiceAccess'));
  const planner = readFileSync(new URL('./onboarding-discovery.ts', import.meta.url), 'utf8');
  assert.equal(planner.includes('runMockDiscovery'), false);
  assert.equal(planner.includes('createGithubServiceAdapter'), true);
  assert.ok(planner.indexOf('readRepositories') < planner.indexOf('prisma.$transaction'));
});
