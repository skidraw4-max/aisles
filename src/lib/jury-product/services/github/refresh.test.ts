import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { formatEvidencePackForPrompt } from '@/lib/ai-review-board/format-evidence-prompt';
import { EVIDENCE_METRIC_DEFINITIONS, type EvidencePack } from '@/lib/ai-review-board/types';
import type { FrozenCoreReading } from '../../review-boundary';
import { type JuryFinalSurface, type JuryReviewStatus } from '../../records';
import { planPreviewDbAccess } from '../../preview-db-guard';
import { packFromStoredEvidence } from './evidence';
import { evidencePackFingerprint, githubRefreshRequestId } from './pack-fingerprint';
import { planGithubReviewStart } from './review-plan';
import {
  planGithubRefreshReview,
  readRefreshArtifact,
  refreshClaimDecision,
  refreshNewExecutionAllowed,
  startGithubRefreshReview,
  type GithubRefreshClaim,
  type GithubRefreshSnapshot,
  type GithubRefreshStore,
} from './refresh';
import { githubFirstReviewRequestId } from './review';

const TENANT = 'tenant-refresh';
const EVIDENCE = 'evidence-refresh';
const CONNECTION = 'connection-refresh';
const PARENT_RESULT = 'parent-result-refresh';
const PARENT_REQUEST = githubFirstReviewRequestId(TENANT, EVIDENCE);

function pack(patch?: { userCount?: number | null; hint?: string; site?: string }): EvidencePack {
  return {
    generatedAt: '2026-10-09T08:00:12.697Z',
    analysisPeriod: { start: '2026-10-09', end: '2026-10-09', timezone: 'Asia/Seoul' },
    site: { name: patch?.site ?? 'octo/example', corridors: [], stackNotes: [] },
    aggregates: {
      userCount: patch?.userCount === undefined ? null : patch.userCount,
      usersLast7d: null,
      newUsersLast7d: null,
      activeUsersLast7d: null,
      postCount: null,
      postsLast7d: null,
      commentsLast7d: null,
      viewsLast7d: null,
      totalViews: null,
      commentCount: null,
      postsByCategory: {},
    },
    metricDefinitions: EVIDENCE_METRIC_DEFINITIONS,
    docsHints: [patch?.hint ?? 'GitHub commit count is available: 20.'],
    piiExcluded: true,
    readOnly: true,
  };
}

function surface(): JuryFinalSurface {
  return {
    statusSummary: 'stored',
    topProblems: [],
    expectedUserEffect: 'stored',
    risk: 'High',
    dimensionEvidence: [],
    supportedClaims: [],
    partiallySupportedClaims: [],
    hypotheses: [],
  };
}

function snapshot(status: JuryReviewStatus = 'COMPLETED'): GithubRefreshSnapshot {
  return {
    evidence: {
      id: EVIDENCE,
      tenantId: TENANT,
      connectionId: CONNECTION,
      purpose: 'github-repository-observation',
      periodStart: '2026-10-09',
      periodEnd: '2026-10-09',
      timezone: 'Asia/Seoul',
      metricIds: [],
      documentEvidence: [{ fileName: 'commit:abc', source: 'github', section: 'note' }],
      adapterKey: 'github',
      collectedAt: '2026-10-09T08:00:12.697Z',
      piiExcluded: true,
      readOnly: true,
    },
    repository: 'octo/example',
    metrics: [
      { metric: 'github.commitCount', value: 20, availability: 'AVAILABLE', rawValueText: '20' },
      { metric: 'github.readmeBytes', value: null, availability: 'NOT_AVAILABLE', rawValueText: 'null' },
      { metric: 'github.structureEntryCount', value: null, availability: 'COLLECTION_FAILED', rawValueText: 'null' },
    ],
    firstRequest: { id: PARENT_REQUEST, status },
    firstResult: { id: PARENT_RESULT, decision: 'ACCEPT', boardRunId: 'run-original', finalSurface: surface() },
  };
}

function memoryStore(initial: GithubRefreshSnapshot): GithubRefreshStore & { parent: GithubRefreshSnapshot['firstResult']; claims: Map<string, GithubRefreshClaim> } {
  const claims = new Map<string, GithubRefreshClaim>();
  const parent = initial.firstResult ? { ...initial.firstResult, finalSurface: { ...initial.firstResult.finalSurface } } : null;
  return {
    parent,
    claims,
    async load() {
      return initial;
    },
    async claim(row) {
      if (row.id === PARENT_REQUEST) throw new Error('PARENT_WRITE');
      if (claims.has(row.id)) return 'conflict';
      claims.set(row.id, { id: row.id, status: 'QUEUED', fingerprint: row.fingerprint, resultId: null, parentResultId: null });
      return 'claimed';
    },
    async readClaim(id) {
      return claims.get(id) ?? null;
    },
    async complete(row) {
      if (row.requestId === PARENT_REQUEST) throw new Error('PARENT_WRITE');
      const current = claims.get(row.requestId);
      if (!current || current.status !== 'QUEUED') return 'lost';
      current.status = 'COMPLETED';
      current.resultId = row.resultId;
      current.parentResultId = row.parentResultId;
      return 'completed';
    },
    async fail(requestId) {
      const current = claims.get(requestId);
      if (current?.status === 'QUEUED') current.status = 'FAILED';
    },
    readArtifact: readRefreshArtifact,
  };
}

function identityOf(view: GithubRefreshSnapshot): { fingerprint: string; requestId: string } {
  const evidence = view.evidence;
  const repository = view.repository;
  assert.ok(evidence && repository);
  const built = packFromStoredEvidence({ evidence, repository, metrics: view.metrics });
  assert.ok(built);
  const fingerprint = evidencePackFingerprint(built);
  return { fingerprint, requestId: githubRefreshRequestId(TENANT, EVIDENCE, fingerprint) };
}

function pipelineBlocked(counter: { calls: number }): (evidence: EvidencePack) => Promise<FrozenCoreReading> {
  return async () => {
    counter.calls += 1;
    throw new Error('PIPELINE_BLOCKED');
  };
}

function reading(boardRunId: string): FrozenCoreReading {
  return {
    boardRunId,
    evidenceStrength: 'unknown',
    claimStrength: 'weak',
    conflictDetected: false,
    overclaimDetected: false,
    revisionRequired: false,
    expectedDecision: 'VERIFY',
    finalSurface: surface(),
    completedAt: '2026-10-09T09:00:00.000Z',
  };
}

test('completed first review still returns review-exists', () => {
  assert.equal(planGithubReviewStart({ evidenceStatus: 'COLLECTED', reviewStatus: 'COMPLETED' }).ok, false);
  const blocked = planGithubReviewStart({ evidenceStatus: 'COLLECTED', reviewStatus: 'COMPLETED' });
  assert.equal(blocked.ok, false);
  if (!blocked.ok) assert.equal(blocked.flow, 'review-exists');
  for (const status of ['QUEUED', 'RUNNING'] as const) {
    const gate = planGithubReviewStart({ evidenceStatus: 'COLLECTED', reviewStatus: status });
    assert.equal(gate.ok, false);
    if (!gate.ok) assert.equal(gate.flow, 'in-progress');
  }
  const failed = planGithubReviewStart({ evidenceStatus: 'COLLECTED', reviewStatus: 'FAILED' });
  assert.equal(failed.ok, false);
  if (!failed.ok) assert.equal(failed.flow, 'review-failed');
});

test('refresh request id differs from the first review id and is stable for one pack', () => {
  const fingerprint = evidencePackFingerprint(pack());
  const refreshId = githubRefreshRequestId(TENANT, EVIDENCE, fingerprint);
  assert.notEqual(refreshId, PARENT_REQUEST);
  assert.equal(githubRefreshRequestId(TENANT, EVIDENCE, fingerprint), refreshId);
  assert.notEqual(githubRefreshRequestId(TENANT, EVIDENCE, evidencePackFingerprint(pack({ site: 'other/repo' }))), refreshId);
});

test('fingerprint covers the whole pack and keeps null distinct from zero', () => {
  const original = pack();
  const reordered: EvidencePack = {
    readOnly: original.readOnly,
    piiExcluded: original.piiExcluded,
    docsHints: [...original.docsHints],
    metricDefinitions: original.metricDefinitions,
    aggregates: { ...original.aggregates, postsByCategory: { z: 1, a: 2 } },
    site: { stackNotes: [...original.site.stackNotes], corridors: [...original.site.corridors], name: original.site.name },
    analysisPeriod: { timezone: 'Asia/Seoul', end: original.analysisPeriod?.end ?? '', start: original.analysisPeriod?.start ?? '' },
    generatedAt: original.generatedAt,
  };
  const swappedCategory: EvidencePack = {
    ...original,
    aggregates: { ...original.aggregates, postsByCategory: { a: 2, z: 1 } },
  };
  assert.equal(evidencePackFingerprint(reordered), evidencePackFingerprint(swappedCategory));
  assert.notEqual(evidencePackFingerprint(original), evidencePackFingerprint(pack({ hint: 'GitHub commit count is available: 21.' })));
  assert.notEqual(evidencePackFingerprint(original), evidencePackFingerprint(pack({ site: 'other/repo' })));
  assert.notEqual(evidencePackFingerprint(original), evidencePackFingerprint(pack({ userCount: 0 })));
  assert.equal(original.aggregates.userCount, null);
});

test('the same stored evidence rebuilds one fingerprint', () => {
  const stored = snapshot();
  const left = packFromStoredEvidence({
    evidence: stored.evidence,
    repository: stored.repository,
    metrics: stored.metrics,
  });
  const right = packFromStoredEvidence({
    evidence: stored.evidence,
    repository: stored.repository,
    metrics: stored.metrics,
  });
  assert.ok(left && right);
  assert.equal(left.generatedAt, stored.evidence.collectedAt);
  assert.equal(evidencePackFingerprint(left), evidencePackFingerprint(right));
  assert.equal(formatEvidencePackForPrompt(left).includes(left.generatedAt), true);
  assert.equal(formatEvidencePackForPrompt(left).includes(left.analysisPeriod.start), true);
});

test('time fields and null stay in the fingerprint contract', () => {
  const base = pack();
  assert.notEqual(
    evidencePackFingerprint({ ...base, generatedAt: '2026-10-09T08:00:12.697Z' }),
    evidencePackFingerprint({ ...base, generatedAt: '2026-10-08T23:00:12.697Z' }),
  );
  assert.notEqual(
    evidencePackFingerprint(base),
    evidencePackFingerprint({
      ...base,
      analysisPeriod: { start: '2026-10-08', end: '2026-10-09', timezone: 'Asia/Seoul' },
    }),
  );
  const reorderedHints = pack();
  reorderedHints.docsHints = ['b', 'a'];
  const originalHints = pack();
  originalHints.docsHints = ['a', 'b'];
  assert.notEqual(evidencePackFingerprint(reorderedHints), evidencePackFingerprint(originalHints));
  assert.equal(evidencePackFingerprint(base), evidencePackFingerprint({ ...base, ga4: undefined }));
  const withoutUserCount = {
    ...base,
    aggregates: { ...base.aggregates },
  };
  delete withoutUserCount.aggregates.userCount;
  assert.notEqual(evidencePackFingerprint(base), evidencePackFingerprint(withoutUserCount));
});

test('refresh keeps queued running and failed first reviews closed', () => {
  const base = snapshot();
  assert.equal(planGithubRefreshReview({
    requestedEvidenceId: EVIDENCE,
    evidence: base.evidence,
    firstRequest: base.firstRequest,
    firstResult: base.firstResult,
  }).ok, true);
  for (const status of ['QUEUED', 'RUNNING', 'FAILED'] as const) {
    const planned = planGithubRefreshReview({
      requestedEvidenceId: EVIDENCE,
      evidence: base.evidence,
      firstRequest: { id: PARENT_REQUEST, status },
      firstResult: base.firstResult,
    });
    assert.equal(planned.ok, false);
    if (!planned.ok) assert.equal(planned.flow, status === 'FAILED' ? 'review-failed' : 'in-progress');
  }
  assert.equal(refreshClaimDecision('FAILED'), 'refresh-failed');
  assert.equal(refreshClaimDecision('QUEUED'), 'in-progress');
});

test('an unapproved refresh does not write a child or change the parent', async () => {
  const store = memoryStore(snapshot());
  const parentBefore = JSON.stringify(store.parent);
  const counter = { calls: 0 };
  const started = await startGithubRefreshReview({
    tenantId: TENANT,
    userId: 'user-refresh',
    connectionId: CONNECTION,
    evidenceId: EVIDENCE,
    store,
    execute: pipelineBlocked(counter),
  });
  assert.equal(started.ok, false);
  if (!started.ok) assert.equal(started.flow, 'execution-denied');
  assert.equal(counter.calls, 0);
  assert.equal(store.claims.size, 0);
  assert.equal(JSON.stringify(store.parent), parentBefore);
});

test('concurrent unapproved refresh calls do not execute', async () => {
  const store = memoryStore(snapshot());
  const counter = { calls: 0 };
  const input = {
    tenantId: TENANT,
    userId: 'user-refresh',
    connectionId: CONNECTION,
    evidenceId: EVIDENCE,
    store,
    execute: pipelineBlocked(counter),
  };
  const [left, right] = await Promise.all([
    startGithubRefreshReview(input),
    startGithubRefreshReview(input),
  ]);
  assert.equal(counter.calls, 0);
  assert.equal(store.claims.size, 0);
  assert.equal(left.ok, false);
  assert.equal(right.ok, false);
  if (!left.ok) assert.equal(left.flow, 'execution-denied');
  if (!right.ok) assert.equal(right.flow, 'execution-denied');
});

test('a new refresh is denied before a claim exists to retry or mismatch', async () => {
  const failedStore = memoryStore(snapshot());
  const counter = { calls: 0 };
  const failed = await startGithubRefreshReview({
    tenantId: TENANT,
    userId: 'user-refresh',
    connectionId: CONNECTION,
    evidenceId: EVIDENCE,
    store: failedStore,
    execute: pipelineBlocked(counter),
  });
  assert.equal(failed.ok, false);
  if (!failed.ok) assert.equal(failed.flow, 'execution-denied');
  assert.equal(counter.calls, 0);
  assert.equal(failedStore.claims.size, 0);
  const again = await startGithubRefreshReview({
    tenantId: TENANT,
    userId: 'user-refresh',
    connectionId: CONNECTION,
    evidenceId: EVIDENCE,
    store: failedStore,
    execute: pipelineBlocked(counter),
  });
  assert.equal(again.ok, false);
  if (!again.ok) assert.equal(again.flow, 'execution-denied');
  assert.equal(counter.calls, 0);
});

test('production database urls are blocked before fixture work', async () => {
  const seen = { seed: 0, cleanup: 0 };
  const blocked = planPreviewDbAccess({
    JURY_PREVIEW_DB: '1',
    DATABASE_URL: 'postgres://user:secret@aws-1-ap-south-1.productiondummyrefbb.example/postgres',
    DIRECT_URL: 'postgres://user:secret@aws-1-ap-south-1.productiondummyrefbb.example/postgres',
  }, { previewRef: 'previewdummyrefaaaaa', productionRefs: ['productiondummyrefbb'] });
  assert.equal(blocked.ok, false);
  if (!blocked.ok) assert.equal(blocked.status, 'BLOCKED_PREVIEW_DB');
  assert.equal(seen.seed, 0);
  assert.equal(seen.cleanup, 0);
  assert.equal(JSON.stringify(blocked).includes('secret'), false);
  assert.equal(JSON.stringify(blocked).includes('postgres://'), false);
});

test('a secret-shaped pack does not claim a refresh', async () => {
  const initial = snapshot();
  if (initial.evidence?.documentEvidence?.[0]) {
    initial.evidence.documentEvidence[0].section = 'FAKE_GITHUB_TOKEN_80_15';
  }
  const store = memoryStore(initial);
  const blocked = await startGithubRefreshReview({
    tenantId: TENANT,
    userId: 'user-refresh',
    connectionId: CONNECTION,
    evidenceId: EVIDENCE,
    store,
    execute: async () => reading('run-secret'),
  });
  assert.equal(blocked.ok, false);
  if (!blocked.ok) assert.equal(blocked.flow, 'secret-rejected');
  assert.equal(store.claims.size, 0);
  assert.equal(JSON.stringify(blocked).includes('FAKE_GITHUB'), false);
});

test('a completed claim with the same fingerprint is reused and does not execute', async () => {
  const view = snapshot();
  const store = memoryStore(view);
  const identity = identityOf(view);
  store.claims.set(identity.requestId, {
    id: identity.requestId,
    status: 'COMPLETED',
    fingerprint: identity.fingerprint,
    resultId: 'existing-refresh-result',
    parentResultId: PARENT_RESULT,
  });
  const counter = { calls: 0 };
  const replay = await startGithubRefreshReview({
    tenantId: TENANT,
    userId: 'user-refresh',
    connectionId: CONNECTION,
    evidenceId: EVIDENCE,
    store,
    execute: pipelineBlocked(counter),
  });
  assert.equal(replay.ok, true);
  if (!replay.ok) return;
  assert.equal(replay.created, false);
  assert.equal(replay.requestId, identity.requestId);
  assert.equal(replay.resultId, 'existing-refresh-result');
  assert.equal(replay.parentResultId, PARENT_RESULT);
  assert.equal(counter.calls, 0);
  assert.equal(store.claims.get(identity.requestId)?.status, 'COMPLETED');
});

test('queued running and failed claims with the same fingerprint do not execute', async () => {
  const view = snapshot();
  const identity = identityOf(view);
  const expected = {
    QUEUED: 'in-progress',
    RUNNING: 'in-progress',
    FAILED: 'refresh-failed',
  } as const;
  for (const status of ['QUEUED', 'RUNNING', 'FAILED'] as const) {
    const store = memoryStore(view);
    store.claims.set(identity.requestId, {
      id: identity.requestId,
      status,
      fingerprint: identity.fingerprint,
      resultId: null,
      parentResultId: PARENT_RESULT,
    });
    const counter = { calls: 0 };
    const stopped = await startGithubRefreshReview({
      tenantId: TENANT,
      userId: 'user-refresh',
      connectionId: CONNECTION,
      evidenceId: EVIDENCE,
      store,
      execute: pipelineBlocked(counter),
    });
    assert.equal(stopped.ok, false);
    if (!stopped.ok) assert.equal(stopped.flow, expected[status]);
    assert.equal(counter.calls, 0);
    assert.equal(store.claims.get(identity.requestId)?.status, status);
  }
});

test('a missing completed claim is denied before a new claim or execute', async () => {
  const view = snapshot();
  const store = memoryStore(view);
  const counter = { calls: 0 };
  let claims = 0;
  const originalClaim = store.claim.bind(store);
  store.claim = async (row) => {
    claims += 1;
    return originalClaim(row);
  };
  const started = await startGithubRefreshReview({
    tenantId: TENANT,
    userId: 'user-refresh',
    connectionId: CONNECTION,
    evidenceId: EVIDENCE,
    store,
    execute: pipelineBlocked(counter),
  });
  assert.equal(refreshNewExecutionAllowed(), false);
  assert.equal(claims, 0);
  assert.equal(store.claims.size, 0);
  assert.equal(counter.calls, 0);
  assert.equal(started.ok, false);
  if (!started.ok) assert.equal(started.flow, 'execution-denied');
});

test('a changed fingerprint is a new request and stays execution denied', async () => {
  const view = snapshot();
  const store = memoryStore(view);
  const first = identityOf(view);
  const counter = { calls: 0 };
  const opened = await startGithubRefreshReview({
    tenantId: TENANT,
    userId: 'user-refresh',
    connectionId: CONNECTION,
    evidenceId: EVIDENCE,
    store,
    execute: pipelineBlocked(counter),
  });
  assert.equal(opened.ok, false);
  if (!opened.ok) assert.equal(opened.flow, 'execution-denied');
  const commit = view.metrics[0];
  assert.ok(commit);
  commit.value = 21;
  commit.rawValueText = '21';
  const second = identityOf(view);
  assert.notEqual(second.fingerprint, first.fingerprint);
  assert.notEqual(second.requestId, first.requestId);
  const changed = await startGithubRefreshReview({
    tenantId: TENANT,
    userId: 'user-refresh',
    connectionId: CONNECTION,
    evidenceId: EVIDENCE,
    store,
    execute: pipelineBlocked(counter),
  });
  assert.equal(changed.ok, false);
  if (!changed.ok) assert.equal(changed.flow, 'execution-denied');
  assert.equal(counter.calls, 0);
  assert.equal(store.claims.size, 0);
});

test('client approval fields do not allow a new refresh execution', async () => {
  const store = memoryStore(snapshot());
  const counter = { calls: 0 };
  const denied = await startGithubRefreshReview(Object.assign({
    tenantId: TENANT,
    userId: 'user-refresh',
    connectionId: CONNECTION,
    evidenceId: EVIDENCE,
    store,
    execute: pipelineBlocked(counter),
  }, {
    approved: true,
    allowExecution: true,
    role: 'OWNER',
    permission: 'REVIEW',
  }));
  assert.equal(denied.ok, false);
  if (!denied.ok) assert.equal(denied.flow, 'execution-denied');
  assert.equal(counter.calls, 0);
  assert.equal(store.claims.size, 0);
});

test('a queued claim stays queued and is not recovered', async () => {
  const view = snapshot();
  const store = memoryStore(view);
  const identity = identityOf(view);
  store.claims.set(identity.requestId, {
    id: identity.requestId,
    status: 'QUEUED',
    fingerprint: identity.fingerprint,
    resultId: null,
    parentResultId: null,
  });
  const counter = { calls: 0 };
  const first = await startGithubRefreshReview({
    tenantId: TENANT,
    userId: 'user-refresh',
    connectionId: CONNECTION,
    evidenceId: EVIDENCE,
    store,
    execute: pipelineBlocked(counter),
  });
  const second = await startGithubRefreshReview({
    tenantId: TENANT,
    userId: 'user-refresh',
    connectionId: CONNECTION,
    evidenceId: EVIDENCE,
    store,
    execute: pipelineBlocked(counter),
  });
  assert.equal(first.ok, false);
  assert.equal(second.ok, false);
  if (!first.ok) assert.equal(first.flow, 'in-progress');
  if (!second.ok) assert.equal(second.flow, 'in-progress');
  assert.equal(counter.calls, 0);
  assert.equal(store.claims.get(identity.requestId)?.status, 'QUEUED');
});

test('refresh execution guard tests do not import the gemini client', () => {
  const source = readFileSync(new URL('./refresh.test.ts', import.meta.url), 'utf8');
  const implementation = readFileSync(new URL('./refresh.ts', import.meta.url), 'utf8');
  const llm = ['createGemini', 'ReviewBoardLlm'].join('');
  const keyReader = ['readGemini', 'ApiKeyFromEnv'].join('');
  const geminiModule = ['gemini-prompt', 'analysis-engine'].join('-');
  assert.equal(source.includes(llm), false);
  assert.equal(source.includes(keyReader), false);
  assert.equal(source.includes(geminiModule), false);
  assert.equal(implementation.includes('input.execute'), false);
  assert.equal(implementation.includes('process.env'), false);
});
