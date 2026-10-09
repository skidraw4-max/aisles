import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { decideJuryMutation, type JuryActor } from '../../access';
import { JURY_MEMBER_ROLES, type JuryFinalSurface, type JuryMemberRole } from '../../records';
import { packFromStoredEvidence } from './evidence';
import { evidencePackFingerprint, githubRefreshRequestId } from './pack-fingerprint';
import { githubFirstReviewRequestId } from './review';
import { startGithubRefreshReview, type GithubRefreshClaim, type GithubRefreshSnapshot, type GithubRefreshStore } from './refresh';
import { runGithubRefreshEntry } from './refresh-entry';

const TENANT = 'org-a';
const OTHER = 'org-b';
const CONNECTION = 'connection-a';
const EVIDENCE = 'evidence-a';

function actor(role: JuryMemberRole, tenantId = TENANT): JuryActor {
  return { ok: true, userId: 'user-a', tenantId, role, membershipId: 'mem-a' };
}

function roleWhere(allowed: boolean): JuryMemberRole {
  const role = JURY_MEMBER_ROLES.find((item) => {
    const decision = decideJuryMutation({ actor: actor(item), action: 'review.start', resourceTenantId: TENANT });
    return decision.ok === allowed;
  });
  if (!role) throw new Error('review.start role missing');
  return role;
}

function resources(overrides?: {
  connection?: { id: string; tenantId: string } | null;
  approved?: boolean;
  evidence?: { id: string; tenantId: string; connectionId: string } | null;
}) {
  const seen = { connection: 0, scope: 0, evidence: 0, start: 0 };
  const startArgs: Array<{ tenantId: string; userId: string; connectionId: string; evidenceId: string }> = [];
  return {
    seen,
    startArgs,
    async loadConnection(query: { connectionId: string; tenantId: string }) {
      seen.connection += 1;
      assert.equal(query.tenantId, TENANT);
      if (overrides && 'connection' in overrides) return overrides.connection ?? null;
      if (query.connectionId !== CONNECTION) return null;
      return { id: CONNECTION, tenantId: TENANT };
    },
    async loadScopeApproved(query: { connectionId: string; tenantId: string }) {
      seen.scope += 1;
      assert.equal(query.tenantId, TENANT);
      assert.equal(query.connectionId, CONNECTION);
      return overrides?.approved ?? true;
    },
    async loadEvidence(query: { evidenceId: string; tenantId: string; connectionId: string }) {
      seen.evidence += 1;
      assert.equal(query.tenantId, TENANT);
      assert.equal(query.connectionId, CONNECTION);
      if (overrides && 'evidence' in overrides) return overrides.evidence ?? null;
      if (query.evidenceId !== EVIDENCE) return null;
      return { id: EVIDENCE, tenantId: TENANT, connectionId: CONNECTION };
    },
    async start(args: { tenantId: string; userId: string; connectionId: string; evidenceId: string }) {
      seen.start += 1;
      startArgs.push(args);
      return { ok: true as const, created: false, requestId: 'refresh-request', resultId: 'refresh-result', parentResultId: 'parent-result', fingerprint: 'fingerprint' };
    },
  };
}

test('an unauthenticated refresh entry is rejected before any lookup', async () => {
  const gate = resources();
  const result = await runGithubRefreshEntry({
    actor: { ok: false, reason: 'UNAUTHENTICATED' },
    connectionId: CONNECTION,
    evidenceId: EVIDENCE,
    ...gate,
  });
  assert.deepEqual(result, { ok: false, flow: 'unauthenticated' });
  assert.equal(gate.seen.connection, 0);
  assert.equal(gate.seen.scope, 0);
  assert.equal(gate.seen.evidence, 0);
  assert.equal(gate.seen.start, 0);
});

test('a connection from another tenant is rejected', async () => {
  const gate = resources({ connection: { id: CONNECTION, tenantId: OTHER } });
  const result = await runGithubRefreshEntry({
    actor: actor(roleWhere(true)),
    connectionId: CONNECTION,
    evidenceId: EVIDENCE,
    ...gate,
  });
  assert.deepEqual(result, { ok: false, flow: 'not-found' });
  assert.equal(gate.seen.scope, 0);
  assert.equal(gate.seen.start, 0);
});

test('a missing approved scope is rejected before evidence and refresh', async () => {
  const gate = resources({ approved: false });
  const result = await runGithubRefreshEntry({
    actor: actor(roleWhere(true)),
    connectionId: CONNECTION,
    evidenceId: EVIDENCE,
    ...gate,
  });
  assert.deepEqual(result, { ok: false, flow: 'scope-denied' });
  assert.equal(gate.seen.evidence, 0);
  assert.equal(gate.seen.start, 0);
});

test('evidence from another connection is rejected', async () => {
  const gate = resources({ evidence: { id: EVIDENCE, tenantId: TENANT, connectionId: 'connection-b' } });
  const result = await runGithubRefreshEntry({
    actor: actor(roleWhere(true)),
    connectionId: CONNECTION,
    evidenceId: EVIDENCE,
    ...gate,
  });
  assert.deepEqual(result, { ok: false, flow: 'not-found' });
  assert.equal(gate.seen.start, 0);
});

test('an actor without review.start is rejected before lookups', async () => {
  const gate = resources();
  const result = await runGithubRefreshEntry({
    actor: actor(roleWhere(false)),
    connectionId: CONNECTION,
    evidenceId: EVIDENCE,
    ...gate,
  });
  assert.deepEqual(result, { ok: false, flow: 'forbidden' });
  assert.equal(gate.seen.connection, 0);
  assert.equal(gate.seen.start, 0);
});

test('a permitted actor reaches refresh with server identity only', async () => {
  const gate = resources();
  const result = await runGithubRefreshEntry({
    actor: actor(roleWhere(true)),
    connectionId: CONNECTION,
    evidenceId: EVIDENCE,
    ...gate,
  });
  assert.equal(result.ok, true);
  assert.deepEqual(gate.startArgs[0], {
    tenantId: TENANT,
    userId: 'user-a',
    connectionId: CONNECTION,
    evidenceId: EVIDENCE,
  });
});

test('a completed refresh with the same fingerprint is reused and does not execute', async () => {
  const surface: JuryFinalSurface = {
    statusSummary: 'stored',
    topProblems: [],
    expectedUserEffect: 'stored',
    risk: 'High',
    dimensionEvidence: [],
    supportedClaims: [],
    partiallySupportedClaims: [],
    hypotheses: [],
  };
  const initial: GithubRefreshSnapshot = {
    evidence: {
      id: EVIDENCE,
      tenantId: TENANT,
      connectionId: CONNECTION,
      purpose: 'github-repository-observation',
      periodStart: '2026-10-09',
      periodEnd: '2026-10-09',
      timezone: 'Asia/Seoul',
      metricIds: [],
      documentEvidence: [],
      adapterKey: 'github',
      collectedAt: '2026-10-09T08:00:12.697Z',
      piiExcluded: true,
      readOnly: true,
    },
    repository: 'octo/example',
    metrics: [],
    firstRequest: { id: githubFirstReviewRequestId(TENANT, EVIDENCE), status: 'COMPLETED' },
    firstResult: { id: 'parent-result', decision: 'ACCEPT', boardRunId: 'run-original', finalSurface: surface },
  };
  const evidence = initial.evidence;
  const repository = initial.repository;
  assert.ok(evidence && repository);
  const built = packFromStoredEvidence({ evidence, repository, metrics: initial.metrics });
  assert.ok(built);
  const fingerprint = evidencePackFingerprint(built);
  const requestId = githubRefreshRequestId(TENANT, EVIDENCE, fingerprint);
  const existingClaim: GithubRefreshClaim = {
    id: requestId,
    status: 'COMPLETED',
    fingerprint,
    resultId: 'existing-result',
    parentResultId: 'parent-result',
  };
  let claims = 0;
  let executes = 0;
  const store: GithubRefreshStore = {
    async load() { return initial; },
    async claim() {
      claims += 1;
      throw new Error('claim');
    },
    async readClaim(id) { return id === requestId ? existingClaim : null; },
    async complete() { throw new Error('complete'); },
    async fail() { throw new Error('fail'); },
    async readArtifact() { return null; },
  };
  const gate = resources();
  const result = await runGithubRefreshEntry({
    actor: actor(roleWhere(true)),
    connectionId: CONNECTION,
    evidenceId: EVIDENCE,
    loadConnection: gate.loadConnection,
    loadScopeApproved: gate.loadScopeApproved,
    loadEvidence: gate.loadEvidence,
    start: (args) => startGithubRefreshReview({
      ...args,
      store,
      execute: async () => {
        executes += 1;
        throw new Error('execute');
      },
    }),
  });
  assert.equal(result.ok, true);
  if (result.ok && 'created' in result) {
    assert.equal(result.created, false);
    assert.equal(result.parentResultId, 'parent-result');
    assert.equal(result.resultId, 'existing-result');
  }
  assert.equal(executes, 0);
  assert.equal(claims, 0);
  assert.equal(initial.firstResult?.id, 'parent-result');
});

test('client approval fields do not bypass tenant scope or evidence checks', async () => {
  const cases = [
    resources({ connection: { id: CONNECTION, tenantId: OTHER } }),
    resources({ approved: false }),
    resources({ evidence: { id: EVIDENCE, tenantId: TENANT, connectionId: 'other-connection' } }),
  ];
  for (const gate of cases) {
    const result = await runGithubRefreshEntry(Object.assign({
      actor: actor(roleWhere(true)),
      connectionId: CONNECTION,
      evidenceId: EVIDENCE,
      loadConnection: gate.loadConnection,
      loadScopeApproved: gate.loadScopeApproved,
      loadEvidence: gate.loadEvidence,
      start: gate.start,
    }, { approved: true, allowExecution: true, role: 'OWNER', permission: 'REVIEW' }));
    assert.equal(result.ok, false);
    assert.equal(gate.seen.start, 0);
  }
});

test('refresh entry source keeps the deployed review.start rule', () => {
  const entry = readFileSync(new URL('./refresh-entry.ts', import.meta.url), 'utf8');
  const action = readFileSync(new URL('../../../../app/(root)/jury/refresh-github-action.ts', import.meta.url), 'utf8');
  const refresh = readFileSync(new URL('./refresh.ts', import.meta.url), 'utf8');
  assert.equal(entry.includes("action: 'review.start'"), true);
  for (const token of ['JuryServiceMember', 'service-feature-guard', 'createGeminiReviewBoardLlm', 'startGithubRepositoryReview']) {
    assert.equal(entry.includes(token), false);
  }
  assert.equal(action.includes('getJuryActor(null)'), true);
  assert.equal(action.includes('input.tenantId'), false);
  assert.equal(action.includes('input.userId'), false);
  assert.equal(action.includes('input.role'), false);
  assert.equal(action.includes('input.permission'), false);
  assert.equal(action.includes('JuryServiceMember'), false);
  assert.equal(action.includes('allowExecution'), false);
  assert.equal(action.includes('approved'), false);
  assert.equal(refresh.includes('planGithubReviewStart'), true);
  assert.equal(refresh.includes('execution-denied'), true);
  assert.equal(refresh.includes('input.execute'), false);
});
