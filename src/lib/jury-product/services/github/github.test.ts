import assert from 'node:assert/strict';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { projectConnectionConfiguration } from '../connection-configuration';
import { connectionAdapterKey, projectProviderView } from '../provider-boundary';
import { containsRawCredential } from '../provider-types';
import {
  planGithubDisconnect,
  planGithubInstallation,
  planRepositorySelection,
  resolveGithubConnection,
} from './access';
import { createGithubServiceAdapter } from './adapter';
import { confirmInstallationAccess, readRepositoryContents, type GithubHttp, type GithubHttpResponse } from './client';
import { githubInstallUrl, publicGithubConfiguration, readGithubAppConfig } from './config';
import { normalizeGithubEvidence, toServiceDiscovery, type GithubRepository } from './discovery';
import { acceptGithubStateUse, signGithubState, verifyGithubState } from './state';

const PRIVATE_KEY = 'FAKE_GITHUB_PRIVATE_KEY_80_15';
const TOKEN = 'FAKE_GITHUB_TOKEN_80_15';
const CLIENT_SECRET = 'FAKE_GITHUB_CLIENT_SECRET_80_15';
const STATE_SECRET = 'state-secret-80-15-value';

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const PEM = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

function leaked(value: unknown): boolean {
  const text = JSON.stringify(value);
  return text.includes(PRIVATE_KEY) || text.includes(TOKEN) || text.includes(CLIENT_SECRET) || text.includes(PEM);
}

function repo(name: string, extra: Record<string, unknown> = {}) {
  return {
    id: name.length,
    name,
    full_name: `octo/${name}`,
    private: false,
    default_branch: 'main',
    archived: false,
    disabled: false,
    html_url: `https://github.com/octo/${name}`,
    visibility: 'public',
    owner: { login: 'octo' },
    permissions: { admin: true, push: true, pull: true },
    ...extra,
  };
}

function scripted(steps: GithubHttpResponse[]) {
  const seen: Array<{ method: string; url: string; authorization: string; body?: unknown }> = [];
  const http: GithubHttp = async (request) => {
    seen.push(request);
    const next = steps.shift();
    if (!next) throw new Error('unexpected request');
    return next;
  };
  return { http, seen };
}

function installation(appId = 15) {
  return { status: 200, headers: {}, body: { app_id: appId, account: { login: 'octo-org', type: 'Organization' } } };
}

function tokenResponse(status = 201) {
  return { status, headers: {}, body: status === 201 ? { token: TOKEN, expires_at: '2099-01-01T00:00:00Z' } : { message: TOKEN } };
}

test('github provider is read-only and keeps secrets out of configuration', () => {
  const definition = projectConnectionConfiguration({
    provider: 'GITHUB',
    displayName: 'octo-org',
    accessMethod: 'OAUTH',
    connectionStatus: 'CONNECTED',
    credentialStatus: 'ACTIVE',
    health: 'HEALTHY',
    clientTenantId: 'other-org',
    clientRole: 'OWNER',
    clientPermission: 'AGENT',
  });
  assert.equal(definition.ok, true);
  if (!definition.ok) return;
  assert.equal(definition.configuration.accessMode, 'READ_ONLY');
  assert.equal(definition.configuration.capabilities.includes('WRITE'), false);
  assert.equal(definition.configuration.capabilities.includes('DISCOVERY'), true);
  assert.equal(definition.configuration.capabilities.includes('READ'), true);
  assert.equal(definition.configuration.capabilities.includes('EVIDENCE'), true);
  assert.equal(definition.configuration.capabilities.includes('HEALTH'), true);
  assert.equal(definition.configuration.capabilities.includes('DISCONNECT'), true);
  assert.equal(definition.configuration.capabilities.includes('REVOKE'), true);
  assert.equal(definition.configuration.method.implemented, true);
  assert.equal(definition.configuration.requestedScopes.every((scope) => scope.readonly && scope.operation === 'read'), true);
  const env = {
    GITHUB_APP_ID: '15',
    GITHUB_APP_NAME: 'aisles-jury',
    GITHUB_APP_CLIENT_ID: CLIENT_SECRET,
    GITHUB_APP_PRIVATE_KEY: PRIVATE_KEY,
    GITHUB_APP_STATE_SECRET: CLIENT_SECRET,
  };
  const error = readGithubAppConfig(env);
  assert.equal(error.ok, false);
  assert.equal(leaked(error), false);
  assert.equal(leaked(publicGithubConfiguration(env)), false);
  assert.equal(publicGithubConfiguration(env).configured, false);
  assert.equal(publicGithubConfiguration(env).readOnly, true);
  assert.equal(leaked(definition), false);
});

test('github api client maps repository reads and strips credentials', async () => {
  const listed = scripted([
    installation(),
    tokenResponse(),
    {
      status: 200,
      headers: { 'x-ratelimit-remaining': '12', 'x-ratelimit-limit': '5000' },
      body: { repositories: [repo('demo', { private: true, visibility: 'private' }), repo('old', { archived: true, disabled: true })] },
    },
  ]);
  const result = await confirmInstallationAccess({
    http: listed.http,
    appId: '15',
    privateKey: PEM,
    installationId: '99',
    nowSeconds: 1_700_000_000,
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.repositories.length, 2);
  assert.equal(result.repositories[0]?.private, true);
  assert.equal(result.repositories[1]?.archived, true);
  assert.equal(result.repositories[1]?.disabled, true);
  assert.equal(result.rateLimit.remaining, 12);
  assert.equal(listed.seen[1]?.body && JSON.stringify(listed.seen[1].body), JSON.stringify({ permissions: { contents: 'read' } }));
  assert.equal(leaked(result), false);
  assert.equal(JSON.stringify(result).includes(listed.seen[0]?.authorization ?? TOKEN), false);
  const discovery = toServiceDiscovery({
    tenantId: 'org-a',
    connectionId: 'conn-a',
    repositories: result.repositories,
  });
  assert.equal(discovery.provider, 'GITHUB');
  assert.equal(discovery.status, 'DISCOVERED');
  assert.deepEqual(discovery.discoveredResources, ['octo/demo', 'octo/old']);
  assert.equal(discovery.requestedScopes.every((scope) => scope.operation === 'read' && scope.readonly), true);
  assert.equal(leaked(discovery), false);
  assert.equal('permissions' in result.repositories[0]!, false);
});

test('github api client covers empty, auth, permission, missing, rate, failure, and malformed reads', async () => {
  const cases: Array<{ status: number; body: unknown; code: string }> = [
    { status: 200, body: { repositories: [] }, code: 'ok' },
    { status: 401, body: { message: TOKEN }, code: 'GITHUB_UNAUTHORIZED' },
    { status: 403, body: { message: PRIVATE_KEY }, code: 'GITHUB_FORBIDDEN' },
    { status: 404, body: { message: CLIENT_SECRET }, code: 'GITHUB_NOT_FOUND' },
    { status: 429, body: { message: TOKEN }, code: 'GITHUB_RATE_LIMIT' },
    { status: 500, body: { message: TOKEN }, code: 'GITHUB_UNAVAILABLE' },
    { status: 200, body: { repositories: { name: 'bad' } }, code: 'DISCOVERY_FAILED' },
    { status: 200, body: { repositories: [{ id: 1 }] }, code: 'DISCOVERY_FAILED' },
  ];
  for (const item of cases) {
    const failure = { status: item.status, headers: { 'x-ratelimit-remaining': '0' }, body: item.body };
    const calls = item.status === 401
      ? [tokenResponse(401)]
      : [installation(), tokenResponse(), ...(item.status >= 500 ? [failure, failure, failure] : [failure])];
    if (item.status === 401) {
      const auth = scripted([installation(), tokenResponse(401)]);
      const result = await confirmInstallationAccess({ http: auth.http, appId: '15', privateKey: PEM, installationId: '99', nowSeconds: 1_700_000_000 });
      assert.equal(result.ok, false);
      if (result.ok) return;
      assert.equal(result.code, 'GITHUB_UNAUTHORIZED');
      assert.equal(auth.seen.length, 2);
      assert.equal(leaked(result), false);
      continue;
    }
    const flow = scripted(calls);
    const result = await confirmInstallationAccess({ http: flow.http, appId: '15', privateKey: PEM, installationId: '99', nowSeconds: 1_700_000_000 });
    if (item.code === 'ok') {
      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.deepEqual(result.repositories, []);
      const discovery = toServiceDiscovery({ tenantId: 'org-a', connectionId: 'conn-a', repositories: result.repositories });
      assert.equal(discovery.status, 'DISCOVERED');
      assert.equal(discovery.discoveredResources.length, 0);
    } else {
      assert.equal(result.ok, false);
      if (result.ok) return;
      assert.equal(result.code, item.code);
    }
    assert.equal(leaked(result), false);
    if (item.status === 500) assert.equal(flow.seen.filter((call) => call.url.includes('/installation/repositories')).length, 3);
    if (item.status === 429) assert.equal(flow.seen.filter((call) => call.url.includes('/installation/repositories')).length, 1);
  }
});

test('github contents stay metadata-only and stop at the collection limit', async () => {
  const root = scripted([
    tokenResponse(),
    {
      status: 200,
      headers: { 'x-ratelimit-remaining': '4', 'x-ratelimit-limit': '5000' },
      body: [{ name: 'README.md', path: 'README.md', type: 'file', size: 12, content: TOKEN, download_url: `https://example.test/${TOKEN}` }],
    },
  ]);
  const contents = await readRepositoryContents({
    http: root.http,
    appId: '15',
    privateKey: PEM,
    installationId: '99',
    owner: 'octo',
    repo: 'demo',
    ref: 'main',
    nowSeconds: 1_700_000_000,
  });
  assert.equal(contents.ok, true);
  if (!contents.ok) return;
  assert.deepEqual(contents.entries, [{ name: 'README.md', path: 'README.md', type: 'file', size: 12 }]);
  assert.equal(leaked(contents), false);
  const oversized = scripted([
    tokenResponse(),
    { status: 200, headers: {}, body: [{ name: 'big.bin', path: 'big.bin', type: 'file', size: 100_001 }] },
  ]);
  const limited = await readRepositoryContents({
    http: oversized.http,
    appId: '15',
    privateKey: PEM,
    installationId: '99',
    owner: 'octo',
    repo: 'demo',
    nowSeconds: 1_700_000_000,
  });
  assert.equal(limited.ok, false);
  if (limited.ok) return;
  assert.equal(limited.code, 'COLLECTION_LIMIT_EXCEEDED');
  assert.equal(leaked(limited), false);
  let calls = 0;
  const deep = await readRepositoryContents({
    http: async () => {
      calls += 1;
      return { status: 500, headers: {}, body: { message: TOKEN } };
    },
    appId: '15',
    privateKey: PEM,
    installationId: '99',
    owner: 'octo',
    repo: 'demo',
    path: 'a/b/c',
    nowSeconds: 1_700_000_000,
  });
  assert.equal(deep.ok, false);
  if (deep.ok) return;
  assert.equal(deep.code, 'COLLECTION_LIMIT_EXCEEDED');
  assert.equal(calls, 0);
  const evidence = normalizeGithubEvidence({ connectionId: 'conn-a', repositoryCount: 0, rootEntryCount: null });
  assert.equal(evidence.metrics[0]?.value, 0);
  assert.equal(evidence.metrics[0]?.availability, 'AVAILABLE');
  assert.equal(evidence.metrics[1]?.value, null);
  assert.equal(evidence.metrics[1]?.availability, 'NOT_MEASURED');
  assert.equal(evidence.readOnly, true);
});

test('github discovery enforces tenant boundaries and read-only selection', () => {
  const repositories: GithubRepository[] = [{
    id: 7,
    owner: 'octo',
    name: 'demo',
    fullName: 'octo/demo',
    private: true,
    defaultBranch: 'main',
    archived: false,
    disabled: false,
    htmlUrl: 'https://github.com/octo/demo',
    visibility: 'private',
  }];
  const adapter = createGithubServiceAdapter(repositories);
  const discovered = adapter.discover({
    actorTenantId: 'org-a',
    connection: {
      id: 'conn-a',
      tenantId: 'org-a',
      serviceKey: 'github-99',
      displayName: 'octo',
      accessMethod: 'OAUTH',
      status: 'CONNECTED',
      createdAt: '2026-10-01T00:00:00.000Z',
      updatedAt: '2026-10-01T00:00:00.000Z',
    },
  });
  assert.equal('ok' in discovered, false);
  if ('ok' in discovered) return;
  assert.deepEqual(discovered.discoveredResources, ['octo/demo']);
  const foreign = adapter.discover({
    actorTenantId: 'org-b',
    connection: {
      id: 'conn-a',
      tenantId: 'org-a',
      serviceKey: 'github-99',
      displayName: 'octo',
      accessMethod: 'OAUTH',
      status: 'CONNECTED',
      createdAt: '2026-10-01T00:00:00.000Z',
      updatedAt: '2026-10-01T00:00:00.000Z',
    },
  });
  assert.equal('ok' in foreign && foreign.ok === false && foreign.code === 'CONNECTION_NOT_FOUND', true);
  const unavailable = createGithubServiceAdapter().discover({
    actorTenantId: 'org-a',
    connection: {
      id: 'conn-a',
      tenantId: 'org-a',
      serviceKey: 'github-99',
      displayName: 'octo',
      accessMethod: 'OAUTH',
      status: 'CONNECTED',
      createdAt: '2026-10-01T00:00:00.000Z',
      updatedAt: '2026-10-01T00:00:00.000Z',
    },
  });
  assert.equal('ok' in unavailable && unavailable.ok === false && unavailable.code === 'PROVIDER_UNAVAILABLE', true);
  const selected = planRepositorySelection({ fullName: 'octo/demo', repositories });
  assert.equal(selected.ok, true);
  if (!selected.ok) return;
  assert.equal(selected.scopes[0]?.operation, 'read');
  assert.equal(selected.scopes[0]?.readonly, true);
  const write = planRepositorySelection({ fullName: 'octo/demo', repositories, operation: 'write', readonly: false });
  assert.equal(write.ok, false);
  if (write.ok) return;
  assert.equal(write.code, 'READ_ACCESS_REQUIRED');
  const missing = planRepositorySelection({ fullName: 'octo/hidden', repositories });
  assert.equal(missing.ok, false);
  if (missing.ok) return;
  assert.equal(missing.code, 'GITHUB_NOT_FOUND');
  const connections = [
    { id: 'conn-a', tenantId: 'org-a', serviceKey: 'github-99', credentialRef: 'github-installation/99' },
    { id: 'conn-b', tenantId: 'org-b', serviceKey: 'github-77', credentialRef: 'github-installation/77' },
  ];
  assert.equal(resolveGithubConnection({ actorTenantId: 'org-a', connections, connectionId: 'conn-b', clientTenantId: 'org-b', clientRole: 'OWNER', clientPermission: 'AGENT' }).ok, false);
  assert.equal(resolveGithubConnection({ actorTenantId: 'org-a', connections, installationId: '77', clientOrganizationId: 'org-b', clientUserId: 'user-b' }).ok, false);
  const own = resolveGithubConnection({ actorTenantId: 'org-a', connections, connectionId: 'missing' });
  assert.equal(own.ok, false);
  if (own.ok) return;
  assert.equal(own.code, 'CONNECTION_NOT_FOUND');
  const disconnect = planGithubDisconnect({ actorTenantId: 'org-a', connection: connections[1]!, clientTenantId: 'org-a' });
  assert.equal(disconnect.ok, false);
  const local = planGithubDisconnect({ actorTenantId: 'org-a', connection: connections[0]! });
  assert.equal(local.ok, true);
  if (!local.ok) return;
  assert.equal(local.externalUninstall, false);
  assert.equal(containsRawCredential('github-installation/99'), false);
  const view = projectProviderView({
    actorTenantId: 'org-a',
    connection: {
      id: 'conn-a',
      tenantId: 'org-a',
      serviceKey: 'github-99',
      accessMethod: 'OAUTH',
      status: 'CONNECTED',
      displayName: 'octo-org',
      credentialRef: 'github-installation/99',
      createdAt: '2026-10-01T00:00:00.000Z',
    },
    hasDiscovery: false,
    hasEvidence: false,
    clientTenantId: 'org-b',
  });
  assert.equal(view.ok, true);
  if (!view.ok) return;
  assert.equal(view.view.provider, 'GITHUB');
  assert.equal(view.view.canWrite, false);
  assert.equal(view.view.health, 'HEALTHY');
  assert.equal(connectionAdapterKey({ serviceKey: 'github-99' }), 'github');
  assert.equal(connectionAdapterKey({ serviceKey: 'mock-service' }), undefined);
  assert.equal(leaked(view), false);
  assert.equal(JSON.stringify(view).includes('github-installation/99'), false);
});

test('github installation state rejects forgery, expiry, and reuse', () => {
  const nonce = randomUUID();
  const state = signGithubState({
    tenantId: 'org-a',
    userId: 'user-a',
    nonce,
    expiresAt: 1_700_000_600,
    secret: CLIENT_SECRET,
  });
  assert.ok(state);
  assert.equal(state?.includes(CLIENT_SECRET), false);
  assert.equal(state?.includes(PRIVATE_KEY), false);
  const url = githubInstallUrl('aisles-jury', state ?? '');
  assert.equal(url?.startsWith('https://github.com/apps/aisles-jury/installations/new?state='), true);
  assert.equal(url?.includes(TOKEN), false);
  const verified = verifyGithubState({ state: state ?? '', secret: CLIENT_SECRET, now: 1_700_000_000 });
  assert.equal(verified.ok, true);
  const forged = verifyGithubState({ state: `${state ?? ''}x`, secret: CLIENT_SECRET, now: 1_700_000_000 });
  assert.equal(forged.ok, false);
  const expired = verifyGithubState({ state: state ?? '', secret: CLIENT_SECRET, now: 1_700_000_600 });
  assert.equal(expired.ok, false);
  const reused = acceptGithubStateUse({ consumed: true, expiresAt: 1_700_000_600, now: 1_700_000_000 });
  assert.equal(reused.ok, false);
  const planned = planGithubInstallation({
    actorTenantId: 'org-a',
    actorUserId: 'user-a',
    stateTenantId: 'org-a',
    stateUserId: 'user-a',
    installationId: '99',
    accountLogin: 'octo-org',
    accountType: 'Organization',
    clientTenantId: 'org-b',
    clientOrganizationId: 'org-b',
    clientUserId: 'user-b',
    clientRole: 'OWNER',
    clientPermission: 'AGENT',
  });
  assert.equal(planned.ok, true);
  if (!planned.ok) return;
  assert.equal(planned.credentialRef, 'github-installation/99');
  assert.equal(planned.accessMethod, 'OAUTH');
  assert.equal(leaked(planned), false);
  const mismatched = planGithubInstallation({
    actorTenantId: 'org-a',
    actorUserId: 'user-a',
    stateTenantId: 'org-b',
    stateUserId: 'user-b',
    installationId: '99',
    accountLogin: 'octo-org',
    accountType: 'Organization',
  });
  assert.equal(mismatched.ok, false);
  const broken = readGithubAppConfig({ GITHUB_APP_PRIVATE_KEY: PRIVATE_KEY });
  assert.equal(leaked(broken), false);
  const badKey = confirmInstallationAccess({
    http: async () => {
      throw new Error(TOKEN);
    },
    appId: '15',
    privateKey: PRIVATE_KEY,
    installationId: '99',
    nowSeconds: 1_700_000_000,
  });
  return badKey.then((result) => {
    assert.equal(result.ok, false);
    assert.equal(leaked(result), false);
  });
});

test('github source does not expose credentials or write operations', () => {
  const files = [
    'permissions.ts',
    'config.ts',
    'state.ts',
    'client.ts',
    'discovery.ts',
    'access.ts',
    'adapter.ts',
    'store.ts',
    'collector.ts',
    'evidence.ts',
    'review.ts',
    'product.ts',
    'product-flow.ts',
    'document-secret.ts',
  ];
  const source = files.map((file) => readFileSync(new URL(`./${file}`, import.meta.url), 'utf8')).join('\n');
  const ui = [
    '../../../../app/(root)/jury/github-actions.ts',
    '../../../../app/(root)/jury/services/github/page.tsx',
    '../../../../app/(root)/jury/services/github/callback/route.ts',
    '../../../../app/(root)/jury/services/github/github-panel.tsx',
  ].map((file) => readFileSync(new URL(file, import.meta.url), 'utf8')).join('\n');
  assert.equal(source.includes('localStorage'), false);
  assert.equal(source.includes('document.cookie'), false);
  assert.equal(ui.includes('localStorage'), false);
  assert.equal(ui.includes('document.cookie'), false);
  assert.equal(ui.includes('readGithubAppConfig'), false);
  assert.equal(ui.includes(PRIVATE_KEY), false);
  assert.equal(ui.includes(TOKEN), false);
  assert.equal(ui.includes(CLIENT_SECRET), false);
  assert.equal(source.includes("method: 'DELETE'"), false);
  assert.equal(source.includes("method: 'PUT'"), false);
  assert.equal(source.includes("method: 'PATCH'"), false);
  assert.equal(source.includes('/issues'), false);
  assert.equal(source.includes('pulls'), false);
  assert.equal(source.includes(STATE_SECRET), false);
});
