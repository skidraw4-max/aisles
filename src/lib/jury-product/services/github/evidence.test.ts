import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { createMockReviewBoardLlm } from '@/lib/ai-review-board/mock-llm';
import { commitProductEvidence, type EvidenceWriteTx } from '../../evidence-store';
import { callFrozenReviewPipeline } from '../../review-core';
import { JURY_DECISIONS, JURY_PRODUCT_DATA_ROOT } from '../../records';
import { planGithubEvidenceCollection } from './access';
import { collectRepositoryEvidence } from './collector';
import type { GithubHttp, GithubHttpResponse } from './client';
import { githubPayloadHasSecret } from './document-secret';
import { githubObservationHints, normalizeGithubCollection, packFromStoredEvidence } from './evidence';
import { runGithubEvidenceReview } from './review';

const TOKEN = 'FAKE_GITHUB_TOKEN_80_16';
const PRIVATE_KEY = 'FAKE_GITHUB_PRIVATE_KEY_80_16';
const SECRET = 'FAKE_GITHUB_SECRET_80_16';
const EMAIL = 'octo@example.com';
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const PEM = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

function leaked(value: unknown): boolean {
  const text = JSON.stringify(value);
  return text.includes(TOKEN) || text.includes(PRIVATE_KEY) || text.includes(SECRET) || text.includes(EMAIL) || text.includes(PEM);
}

function repository(extra: Record<string, unknown> = {}) {
  return {
    id: 10,
    name: 'example',
    full_name: 'octo/example',
    private: true,
    visibility: 'private',
    default_branch: 'main',
    archived: false,
    disabled: false,
    html_url: 'https://github.com/octo/example',
    language: 'TypeScript',
    size: 12,
    open_issues_count: 9,
    owner: { login: 'octo', email: EMAIL },
    ...extra,
  };
}

function commit(index: number, message = 'init') {
  const sha = `${index.toString(16).padStart(40, 'a')}`;
  return {
    sha,
    html_url: `https://github.com/octo/example/commit/${sha}`,
    author: { login: 'octocat', email: EMAIL },
    commit: {
      message,
      author: { name: 'Octo', email: EMAIL, date: '2026-10-01T00:00:00Z' },
      committer: { name: 'Octo', email: EMAIL, date: '2026-10-01T00:00:00Z' },
    },
  };
}

function readme(text: string, size = Buffer.byteLength(text)) {
  return { name: 'README.md', size, encoding: 'base64', content: Buffer.from(text).toString('base64') };
}

function entry(path: string, type = 'file', size = 4) {
  const name = path.split('/').pop() ?? path;
  return { name, path, type, size };
}

function routes(map: Record<string, { status: number; body: unknown }>) {
  const seen: string[] = [];
  const bodies: unknown[] = [];
  const http: GithubHttp = async (request): Promise<GithubHttpResponse> => {
    seen.push(`${request.method} ${request.url}`);
    bodies.push(request.body);
    if (request.url.endsWith('/access_tokens')) return { status: 201, headers: {}, body: { token: TOKEN } };
    const url = new URL(request.url);
    const route = map[`${request.method} ${url.pathname}`];
    if (!route) throw new Error(`${request.method} ${url.pathname}`);
    return { status: route.status, headers: { 'x-ratelimit-remaining': '10', 'x-ratelimit-limit': '5000' }, body: route.body };
  };
  return { http, seen, bodies };
}

function collect(http: GithubHttp, requested = 'octo/example', allowed = 'octo/example') {
  return collectRepositoryEvidence({
    http,
    appId: '16',
    privateKey: PEM,
    installationId: '8016',
    connectionId: 'conn-1',
    allowedFullName: allowed,
    requestedFullName: requested,
    collectedAt: '2026-10-08T00:00:00.000Z',
    nowSeconds: 1_700_000_000,
  });
}

const root = [
  entry('README.md', 'file', 5),
  entry('src', 'dir', 0),
  entry('.git', 'dir', 0),
  entry('.env', 'file', 3),
  entry('.env.local', 'file', 3),
  entry('id_rsa', 'file', 8),
  entry('credentials.json', 'file', 8),
  entry('service-account-app.json', 'file', 8),
  entry('server.key', 'file', 8),
  entry('image.png', 'file', 20),
];
const nested = [entry('src/lib', 'dir', 0), entry('src/index.ts', 'file', 8)];

function normalMap(overrides: Partial<Record<string, { status: number; body: unknown }>> = {}) {
  return {
    'GET /repos/octo/example': { status: 200, body: repository() },
    'GET /repos/octo/example/readme': { status: 200, body: readme('hello') },
    'GET /repos/octo/example/commits': { status: 200, body: [commit(1, `note ${EMAIL}`)] },
    'GET /repos/octo/example/contents/': { status: 200, body: root },
    'GET /repos/octo/example/contents/src': { status: 200, body: nested },
    ...overrides,
  };
}

test('github repository evidence keeps measured values and drops secrets', async () => {
  const script = routes(normalMap());
  const collected = await collect(script.http);
  assert.equal(collected.ok, true);
  if (!collected.ok) return;
  assert.equal(collected.collection.status, 'COLLECTED');
  assert.equal(collected.collection.repository.private, true);
  assert.equal(collected.collection.repository.language, 'TypeScript');
  assert.equal(collected.collection.repository.sizeKb, 12);
  assert.equal(collected.collection.readme.value.text, 'hello');
  assert.equal(collected.collection.commits.value.length, 1);
  assert.equal(collected.collection.commits.value[0]?.author, 'octocat');
  assert.equal(collected.collection.commits.value[0]?.message.includes(EMAIL), false);
  assert.equal(collected.collection.commits.value[0]?.message.includes('[withheld]'), true);
  assert.equal(collected.collection.structure.value.some((item) => item.path === '.env'), false);
  assert.equal(collected.collection.structure.value.some((item) => item.path === '.git'), false);
  assert.equal(collected.collection.structure.value.some((item) => item.path === 'src/index.ts'), true);
  assert.equal(script.seen.some((url) => url.includes('/contents/src/lib')), false);
  assert.equal(script.seen.some((url) => url.includes('image.png')), false);
  assert.equal(script.bodies.some((body) => JSON.stringify(body) === JSON.stringify({ permissions: { contents: 'read' } })), true);
  const draft = normalizeGithubCollection({ tenantId: 'org-a', collection: collected.collection });
  assert.equal(draft.pack.aggregates.userCount, null);
  assert.equal(draft.pack.aggregates.newUsersLast7d, null);
  assert.equal(draft.pack.ga4, undefined);
  assert.equal(draft.metrics.find((metric) => metric.metric === 'github.openIssueCount')?.value, null);
  assert.equal(draft.metrics.find((metric) => metric.metric === 'github.openIssueCount')?.availability, 'NOT_AVAILABLE');
  assert.equal(draft.metrics.find((metric) => metric.metric === 'github.repositorySizeKb')?.value, 12);
  assert.equal(draft.view.readOnly, true);
  assert.equal(leaked(collected), false);
  assert.equal(leaked(draft), false);
});

test('github evidence distinguishes a missing readme from an empty readme', async () => {
  const missing = routes(normalMap({ 'GET /repos/octo/example/readme': { status: 404, body: { message: TOKEN } } }));
  const without = await collect(missing.http);
  assert.equal(without.ok, true);
  if (!without.ok) return;
  assert.equal(without.collection.readme.availability, 'NOT_AVAILABLE');
  assert.equal(without.collection.readme.value.bytes, null);
  const empty = routes(normalMap({ 'GET /repos/octo/example/readme': { status: 200, body: readme('', 0) } }));
  const blank = await collect(empty.http);
  assert.equal(blank.ok, true);
  if (!blank.ok) return;
  assert.equal(blank.collection.readme.availability, 'AVAILABLE');
  assert.equal(blank.collection.readme.value.bytes, 0);
  assert.equal(blank.collection.readme.value.text, '');
  const view = normalizeGithubCollection({ tenantId: 'org-a', collection: blank.collection }).view;
  assert.equal(view.readme, 'EMPTY');
  assert.equal(leaked(without), false);
  assert.equal(leaked(blank), false);
});

test('github evidence keeps at most 20 commits and limits messages', async () => {
  const many = Array.from({ length: 25 }, (_, index) => commit(index, 'm'.repeat(600)));
  const script = routes(normalMap({ 'GET /repos/octo/example/commits': { status: 200, body: many } }));
  const collected = await collect(script.http);
  assert.equal(collected.ok, true);
  if (!collected.ok) return;
  assert.equal(collected.collection.commits.value.length, 20);
  assert.equal(collected.collection.commits.value[0]?.message.length, 500);
  assert.equal(script.seen.filter((url) => url.includes('/commits')).length, 1);
  const exact = routes(normalMap({
    'GET /repos/octo/example/commits': { status: 200, body: Array.from({ length: 20 }, (_, index) => commit(index)) },
  }));
  const twenty = await collect(exact.http);
  assert.equal(twenty.ok, true);
  if (twenty.ok) assert.equal(twenty.collection.commits.value.length, 20);
});

test('github evidence stops at file, byte, and secret boundaries', async () => {
  const files = Array.from({ length: 101 }, (_, index) => entry(`file-${index}.txt`, 'file', 10));
  const limited = routes({
    'GET /repos/octo/example': { status: 200, body: repository() },
    'GET /repos/octo/example/readme': { status: 200, body: readme('hello') },
    'GET /repos/octo/example/commits': { status: 200, body: [commit(1)] },
    'GET /repos/octo/example/contents/': { status: 200, body: files },
  });
  const overFiles = await collect(limited.http);
  assert.equal(overFiles.ok, true);
  if (!overFiles.ok) return;
  assert.equal(overFiles.collection.status, 'PARTIAL');
  assert.equal(overFiles.collection.structure.code, 'COLLECTION_LIMIT_EXCEEDED');
  assert.equal(overFiles.collection.structure.value.length, 0);
  assert.equal(limited.seen.filter((url) => url.includes('/contents/')).length, 1);

  const heavy = routes(normalMap({
    'GET /repos/octo/example/contents/': { status: 200, body: [entry('a.txt', 'file', 300_000), entry('b.txt', 'file', 300_000)] },
  }));
  const overBytes = await collect(heavy.http);
  assert.equal(overBytes.ok, true);
  if (overBytes.ok) assert.equal(overBytes.collection.structure.code, 'COLLECTION_LIMIT_EXCEEDED');

  const secretReadme = routes(normalMap({ 'GET /repos/octo/example/readme': { status: 200, body: readme(TOKEN) } }));
  const secret = await collect(secretReadme.http);
  assert.equal(secret.ok, true);
  if (!secret.ok) return;
  assert.equal(secret.collection.readme.value.text, null);
  assert.equal(secret.collection.readme.code, 'SECRET_REJECTED');
  assert.equal(leaked(secret), false);

  const prose = 'Use a token to authenticate the request.';
  const documented = await collect(routes(normalMap({ 'GET /repos/octo/example/readme': { status: 200, body: readme(prose) } })).http);
  assert.equal(documented.ok, true);
  if (!documented.ok) return;
  assert.equal(documented.collection.readme.availability, 'AVAILABLE');
  assert.equal(documented.collection.readme.value.text, prose);
  const pasted = 'FAKE_GITHUB_TOKEN_80_18';
  const blocked = await collect(routes(normalMap({ 'GET /repos/octo/example/readme': { status: 200, body: readme(pasted) } })).http);
  assert.equal(blocked.ok, true);
  if (!blocked.ok) return;
  assert.equal(blocked.collection.readme.code, 'SECRET_REJECTED');
  assert.equal(blocked.collection.readme.value.text, null);
  assert.equal(JSON.stringify(blocked).includes(pasted), false);
  const normalized = normalizeGithubCollection({ tenantId: 'org-a', collection: documented.collection });
  assert.equal(JSON.stringify(normalized).includes(prose), true);
  assert.equal(githubPayloadHasSecret(normalized), false);
  const withheld = normalizeGithubCollection({ tenantId: 'org-a', collection: blocked.collection });
  assert.equal(JSON.stringify(withheld).includes(pasted), false);
  assert.equal(githubPayloadHasSecret(withheld), false);
});

test('github evidence maps auth, permission, missing, rate, failure, and malformed reads', async () => {
  const missing = await collect(routes({ 'GET /repos/octo/example': { status: 404, body: { message: TOKEN } } }).http);
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.equal(missing.code, 'GITHUB_NOT_FOUND');
  const unauthorized = await collect(routes({ 'GET /repos/octo/example': { status: 401, body: { message: PRIVATE_KEY } } }).http);
  assert.equal(unauthorized.ok, false);
  if (!unauthorized.ok) assert.equal(unauthorized.code, 'GITHUB_UNAUTHORIZED');
  const forbidden = await collect(routes({ 'GET /repos/octo/example': { status: 403, body: { message: SECRET } } }).http);
  assert.equal(forbidden.ok, false);
  if (!forbidden.ok) assert.equal(forbidden.code, 'GITHUB_FORBIDDEN');
  const failure = routes({ 'GET /repos/octo/example': { status: 500, body: { message: TOKEN } } });
  const unavailable = await collect(failure.http);
  assert.equal(unavailable.ok, false);
  if (!unavailable.ok) assert.equal(unavailable.code, 'GITHUB_UNAVAILABLE');
  assert.equal(failure.seen.filter((url) => url.includes('/repos/')).length, 3);
  const malformed = routes(normalMap({ 'GET /repos/octo/example/commits': { status: 200, body: { commits: TOKEN } } }));
  const partial = await collect(malformed.http);
  assert.equal(partial.ok, true);
  if (!partial.ok) return;
  assert.equal(partial.collection.status, 'PARTIAL');
  assert.equal(partial.collection.commits.code, 'GITHUB_INVALID_RESPONSE');
  assert.equal(partial.collection.commits.availability, 'COLLECTION_FAILED');
  const rated = routes(normalMap({ 'GET /repos/octo/example/readme': { status: 429, body: { message: TOKEN } } }));
  const rate = await collect(rated.http);
  assert.equal(rate.ok, true);
  if (!rate.ok) return;
  assert.equal(rate.collection.readme.code, 'GITHUB_RATE_LIMIT');
  assert.equal(rated.seen.some((url) => url.includes('/commits')), false);
  assert.equal(leaked(missing) || leaked(unauthorized) || leaked(forbidden) || leaked(unavailable) || leaked(partial) || leaked(rate), false);
});

test('github evidence does not turn an unmeasured field into zero', async () => {
  const script = routes(normalMap({
    'GET /repos/octo/example': { status: 200, body: repository({ language: null, size: null, default_branch: 'main', open_issues_count: 4 }) },
    'GET /repos/octo/example/commits': { status: 200, body: [] },
  }));
  const collected = await collect(script.http);
  assert.equal(collected.ok, true);
  if (!collected.ok) return;
  const draft = normalizeGithubCollection({ tenantId: 'org-a', collection: collected.collection });
  assert.equal(draft.metrics.find((metric) => metric.metric === 'github.repositorySizeKb')?.availability, 'NOT_MEASURED');
  assert.equal(draft.metrics.find((metric) => metric.metric === 'github.repositorySizeKb')?.value, null);
  assert.equal(draft.metrics.find((metric) => metric.metric === 'github.commitCount')?.value, 0);
  assert.equal(draft.metrics.find((metric) => metric.metric === 'github.commitCount')?.availability, 'AVAILABLE');
  assert.equal(draft.metrics.find((metric) => metric.metric === 'github.openPullRequestCount')?.value, null);
  assert.equal(draft.pack.docsHints.some((hint) => hint.includes('not collected')), true);
  const absent = routes(normalMap({
    'GET /repos/octo/example': { status: 200, body: repository({ default_branch: undefined }) },
  }));
  const noBranch = await collect(absent.http);
  assert.equal(noBranch.ok, true);
  if (!noBranch.ok) return;
  assert.equal(noBranch.collection.repository.defaultBranch, null);
  assert.equal(noBranch.collection.commits.availability, 'NOT_AVAILABLE');
  assert.equal(absent.seen.some((url) => url.includes('/commits')), false);
  const draftAbsent = normalizeGithubCollection({ tenantId: 'org-a', collection: noBranch.collection });
  assert.equal(draftAbsent.metrics.find((metric) => metric.metric === 'github.commitCount')?.value, null);
});

test('github evidence hints separate readme absence, structure limits, and null user activity', async () => {
  const missing = routes(normalMap({
    'GET /repos/octo/example/readme': { status: 404, body: { message: 'missing' } },
    'GET /repos/octo/example/contents/': { status: 200, body: [entry('a.txt', 'file', 300_000), entry('b.txt', 'file', 300_000)] },
  }));
  const collected = await collect(missing.http);
  assert.equal(collected.ok, true);
  if (!collected.ok) return;
  const draft = normalizeGithubCollection({ tenantId: 'org-a', collection: collected.collection });
  const structure = draft.metrics.find((metric) => metric.metric === 'github.structureEntryCount');
  const readmeMetric = draft.metrics.find((metric) => metric.metric === 'github.readmeBytes');
  const commits = draft.metrics.find((metric) => metric.metric === 'github.commitCount');
  assert.equal(readmeMetric?.availability, 'NOT_AVAILABLE');
  assert.equal(readmeMetric?.value, null);
  assert.equal(structure?.availability, 'COLLECTION_FAILED');
  assert.equal(structure?.value, null);
  assert.equal(structure?.rawValueText, 'COLLECTION_LIMIT_EXCEEDED');
  assert.equal(commits?.availability, 'AVAILABLE');
  assert.equal(commits?.value, 1);
  assert.equal(draft.pack.aggregates.userCount, null);
  assert.equal(draft.pack.aggregates.newUsersLast7d, null);
  assert.equal(draft.pack.aggregates.activeUsersLast7d, null);
  assert.equal(draft.pack.docsHints.some((hint) => hint.includes('absence, not a collection failure')), true);
  assert.equal(draft.pack.docsHints.some((hint) => hint.includes('commit count is available: 1')), true);
  assert.equal(draft.pack.docsHints.some((hint) => hint.includes('commit metadata documents: 1')), true);
  assert.equal(draft.pack.docsHints.some((hint) => hint.includes('COLLECTION_LIMIT_EXCEEDED')), true);
  assert.equal(draft.pack.docsHints.some((hint) => hint.includes('not a substitute')), true);
  assert.equal(draft.pack.docsHints.some((hint) => hint.includes('a.txt') || hint.includes('b.txt')), false);
  assert.equal(JSON.stringify(draft.pack.aggregates).includes('"userCount":1'), false);
  const restored = packFromStoredEvidence({
    evidence: { ...draft.evidence, piiExcluded: true, readOnly: true },
    repository: 'octo/example',
    metrics: draft.metrics,
  });
  assert.equal(restored?.aggregates.userCount, null);
  assert.equal(restored?.aggregates.viewsLast7d, null);
  assert.equal(restored?.docsHints.some((hint) => hint.includes('COLLECTION_LIMIT_EXCEEDED')), true);
  assert.equal(restored?.docsHints.some((hint) => hint.includes('absence, not a collection failure')), true);
  assert.equal(restored?.docsHints.some((hint) => hint.includes('a.txt')), false);
});

test('github observation hints keep a zero commit count distinct from null activity', () => {
  const zero = githubObservationHints({
    metrics: [
      { metric: 'github.commitCount', value: 0, availability: 'AVAILABLE', rawValueText: '0' },
      { metric: 'github.readmeBytes', value: null, availability: 'COLLECTION_FAILED', rawValueText: 'null' },
      { metric: 'github.structureEntryCount', value: null, availability: 'COLLECTION_FAILED', rawValueText: 'null' },
    ],
    commitDocuments: 0,
  });
  assert.equal(zero.some((hint) => hint.includes('commit count is available: 0')), true);
  assert.equal(zero.some((hint) => hint.includes('README collection failed')), true);
  assert.equal(zero.some((hint) => hint.includes('absence, not a collection failure')), false);
  assert.equal(zero.some((hint) => hint.includes('COLLECTION_LIMIT_EXCEEDED')), false);
  assert.equal(zero.some((hint) => hint.includes('structure collection failed')), true);
  const unmeasured = githubObservationHints({
    metrics: [
      { metric: 'github.commitCount', value: null, availability: 'NOT_AVAILABLE', rawValueText: 'null' },
    ],
    commitDocuments: 3,
  });
  assert.equal(unmeasured.some((hint) => hint.includes('available: 0')), false);
  assert.equal(unmeasured.some((hint) => hint.includes('available: 3')), false);
  assert.equal(unmeasured.some((hint) => hint.includes('commit metadata documents: 3')), true);
  assert.equal(unmeasured.some((hint) => hint.includes('not a substitute')), true);
});

test('github evidence collection stays inside the tenant repository scope', async () => {
  const script = routes(normalMap());
  const rejected = await collect(script.http, 'octo/other', 'octo/example');
  assert.equal(rejected.ok, false);
  if (!rejected.ok) assert.equal(rejected.code, 'SCOPE_DENIED');
  assert.equal(script.seen.length, 0);
  const foreign = planGithubEvidenceCollection({
    actorTenantId: 'org-a',
    connectionTenantId: 'org-b',
    connectionId: 'conn-b',
    requestedConnectionId: 'conn-b',
    allowedFullName: 'octo/example',
    requestedFullName: 'octo/example',
    clientTenantId: 'org-a',
    clientUserId: 'user-a',
    clientRole: 'OWNER',
    clientPermission: 'AGENT',
  });
  assert.equal(foreign.ok, false);
  if (!foreign.ok) assert.equal(foreign.code, 'CONNECTION_NOT_FOUND');
  const otherRepo = planGithubEvidenceCollection({
    actorTenantId: 'org-a',
    connectionTenantId: 'org-a',
    connectionId: 'conn-a',
    requestedConnectionId: 'conn-a',
    allowedFullName: 'octo/example',
    requestedFullName: 'octo/other',
    clientOrganizationId: 'org-b',
  });
  assert.equal(otherRepo.ok, false);
  if (!otherRepo.ok) assert.equal(otherRepo.code, 'SCOPE_DENIED');
});

test('github evidence persists and reaches the existing review pipeline', async () => {
  const collected = await collect(routes(normalMap()).http);
  assert.equal(collected.ok, true);
  if (!collected.ok) return;
  const draft = normalizeGithubCollection({ tenantId: 'org-a', collection: collected.collection });
  let storedEvidence: typeof draft.evidence | null = null;
  let storedMetrics = draft.metrics;
  const tx: EvidenceWriteTx = {
    async findConnection() {
      return { id: 'conn-1', tenantId: 'org-a' };
    },
    async findByIdentity() {
      return storedEvidence;
    },
    async listMetrics() {
      return storedMetrics;
    },
    async insertEvidence(row) {
      storedEvidence = row;
    },
    async insertMetrics(rows) {
      storedMetrics = rows;
    },
  };
  const persisted = await commitProductEvidence({
    actorTenantId: 'org-a',
    connectionId: 'conn-1',
    evidence: draft.evidence,
    metrics: draft.metrics,
  }, { transaction: (work) => work(tx) });
  assert.equal(persisted.ok, true);
  if (!persisted.ok) return;
  assert.equal(persisted.evidence.adapterKey, 'github');
  assert.equal(persisted.evidence.documentEvidence?.some((item) => item.source === 'github'), true);
  assert.equal(leaked(persisted), false);
  const restored = packFromStoredEvidence({ evidence: persisted.evidence, repository: 'octo/example' });
  assert.ok(restored);
  assert.equal(restored?.aggregates.userCount, null);
  let seenUserCount: number | null = 1;
  const reviewed = await runGithubEvidenceReview({
    tenantId: 'org-a',
    userId: 'user-a',
    connectionId: 'conn-1',
    evidenceId: draft.evidence.id,
    pack: draft.pack,
    execute: async (pack) => {
      seenUserCount = pack.aggregates.userCount;
      return callFrozenReviewPipeline({
        rootDir: JURY_PRODUCT_DATA_ROOT,
        evidence: pack,
        llm: createMockReviewBoardLlm(),
      });
    },
  });
  assert.equal(reviewed.ok, true, reviewed.ok ? '' : reviewed.reason);
  if (!reviewed.ok) return;
  assert.equal(seenUserCount, null);
  assert.equal(reviewed.request.mode, 'EXTERNAL_SERVICE');
  assert.equal(reviewed.request.reviewType, 'FULL_REVIEW');
  assert.equal((JURY_DECISIONS as readonly string[]).includes(reviewed.result.expectedDecision), true);
  assert.equal(typeof reviewed.result.boardRunId, 'string');
  const dir = join(process.cwd(), 'data', 'jury-product', reviewed.result.boardRunId);
  const saved = readFileSync(join(dir, 'evidence.json'), 'utf8');
  assert.equal(saved.includes(TOKEN), false);
  assert.equal(saved.includes(EMAIL), false);
  assert.equal(leaked(reviewed), false);
  rmSync(dir, { recursive: true, force: true });
});

test('github evidence source does not call the core or persist itself', () => {
  const collector = readFileSync(new URL('./collector.ts', import.meta.url), 'utf8');
  const evidence = readFileSync(new URL('./evidence.ts', import.meta.url), 'utf8');
  const review = readFileSync(new URL('./review.ts', import.meta.url), 'utf8');
  assert.equal(collector.includes('prisma'), false);
  assert.equal(collector.includes('runReviewBoardPipeline'), false);
  assert.equal(evidence.includes('prisma'), false);
  assert.equal(evidence.includes('runReviewBoardPipeline'), false);
  assert.equal(review.includes('runReviewBoardPipeline'), false);
  assert.equal(review.includes('callFrozenReviewPipeline'), false);
});
