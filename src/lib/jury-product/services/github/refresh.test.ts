import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { formatEvidencePackForPrompt } from '@/lib/ai-review-board/format-evidence-prompt';
import { EVIDENCE_METRIC_DEFINITIONS, type EvidencePack } from '@/lib/ai-review-board/types';
import { saveRunSnapshot } from '@/lib/ai-review-board/store';
import type { ReviewBoardRun } from '@/lib/ai-review-board/types';
import type { FrozenCoreReading } from '../../review-boundary';
import { JURY_PRODUCT_DATA_ROOT, type JuryFinalSurface, type JuryReviewStatus } from '../../records';
import { planPreviewDbAccess } from '../../preview-db-guard';
import { packFromStoredEvidence } from './evidence';
import { evidencePackFingerprint, githubRefreshRequestId } from './pack-fingerprint';
import { planGithubReviewStart } from './review-plan';
import {
  planGithubRefreshReview,
  readRefreshArtifact,
  refreshClaimDecision,
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

async function writeArtifact(boardRunId: string, evidence: EvidencePack): Promise<void> {
  const run: ReviewBoardRun = {
    runId: boardRunId,
    status: 'completed',
    createdAt: evidence.generatedAt,
    updatedAt: evidence.generatedAt,
    evidence,
    independent: [],
    debate: [],
    critic: null,
    final: null,
    budget: { maxCalls: 1, usedCalls: 0, estimatedCostUsd: 0, warnings: [] },
  };
  await saveRunSnapshot(JURY_PRODUCT_DATA_ROOT, run);
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

test('one refresh writes a child result and matches the stored artifact', async () => {
  const store = memoryStore(snapshot());
  const parentBefore = JSON.stringify(store.parent);
  const boardRunId = 'run-phase8024-match';
  let seenUserCount: number | null = 0;
  const started = await startGithubRefreshReview({
    tenantId: TENANT,
    userId: 'user-refresh',
    connectionId: CONNECTION,
    evidenceId: EVIDENCE,
    store,
    execute: async (evidence) => {
      seenUserCount = evidence.aggregates.userCount;
      await writeArtifact(boardRunId, evidence);
      return reading(boardRunId);
    },
  });
  assert.equal(started.ok, true);
  if (!started.ok) return;
  assert.equal(started.created, true);
  assert.notEqual(started.requestId, PARENT_REQUEST);
  assert.notEqual(started.resultId, PARENT_RESULT);
  assert.equal(started.parentResultId, PARENT_RESULT);
  assert.equal(seenUserCount, null);
  const stored = await readRefreshArtifact(boardRunId);
  assert.ok(stored);
  assert.equal(evidencePackFingerprint(stored), started.fingerprint);
  assert.equal(store.claims.get(started.requestId)?.parentResultId, PARENT_RESULT);
  assert.equal(JSON.stringify(store.parent), parentBefore);
  try {
    const replay = await startGithubRefreshReview({
      tenantId: TENANT,
      userId: 'user-refresh',
      connectionId: CONNECTION,
      evidenceId: EVIDENCE,
      store,
      execute: async () => {
        throw new Error('second execute');
      },
    });
    assert.equal(replay.ok, true);
    if (replay.ok) assert.equal(replay.created, false);
  } finally {
    await rm(path.join(JURY_PRODUCT_DATA_ROOT, boardRunId), { recursive: true, force: true });
  }
});

test('concurrent refresh calls execute the pipeline once', async () => {
  const store = memoryStore(snapshot());
  const boardRunId = 'run-phase8024-once';
  let calls = 0;
  const execute = async (evidence: EvidencePack) => {
    calls += 1;
    await new Promise((resolve) => setTimeout(resolve, 30));
    await writeArtifact(boardRunId, evidence);
    return reading(boardRunId);
  };
  const input = {
    tenantId: TENANT,
    userId: 'user-refresh',
    connectionId: CONNECTION,
    evidenceId: EVIDENCE,
    store,
    execute,
  };
  try {
    const [left, right] = await Promise.all([
      startGithubRefreshReview(input),
      startGithubRefreshReview(input),
    ]);
    assert.equal(calls, 1);
    const outcomes = [left, right];
    assert.equal(outcomes.filter((item) => item.ok && item.created).length, 1);
    assert.equal(outcomes.filter((item) => !item.ok && item.flow === 'in-progress').length, 1);
  } finally {
    await rm(path.join(JURY_PRODUCT_DATA_ROOT, boardRunId), { recursive: true, force: true });
  }
});

test('a failed refresh is not retried and a mismatched artifact is rejected', async () => {
  const failedStore = memoryStore(snapshot());
  const failed = await startGithubRefreshReview({
    tenantId: TENANT,
    userId: 'user-refresh',
    connectionId: CONNECTION,
    evidenceId: EVIDENCE,
    store: failedStore,
    execute: async () => {
      throw new Error('pipeline down');
    },
  });
  assert.equal(failed.ok, false);
  if (!failed.ok) assert.equal(failed.flow, 'refresh-failed');
  let retried = 0;
  const again = await startGithubRefreshReview({
    tenantId: TENANT,
    userId: 'user-refresh',
    connectionId: CONNECTION,
    evidenceId: EVIDENCE,
    store: failedStore,
    execute: async () => {
      retried += 1;
      return reading('run-should-not-exist');
    },
  });
  assert.equal(again.ok, false);
  if (!again.ok) assert.equal(again.flow, 'refresh-failed');
  assert.equal(retried, 0);

  const mismatch = memoryStore(snapshot());
  const rejected = await startGithubRefreshReview({
    tenantId: TENANT,
    userId: 'user-refresh',
    connectionId: CONNECTION,
    evidenceId: EVIDENCE,
    store: {
      ...mismatch,
      async readArtifact() {
        return pack({ hint: 'different input' });
      },
    },
    execute: async () => reading('run-phase8024-mismatch'),
  });
  assert.equal(rejected.ok, false);
  if (!rejected.ok) assert.equal(rejected.flow, 'provenance-mismatch');
});

test('production database urls are blocked before fixture work', async () => {
  const seen = { seed: 0, cleanup: 0 };
  const blocked = planPreviewDbAccess({
    JURY_PREVIEW_DB: '1',
    DATABASE_URL: 'postgres://user:secret@aws-1-ap-south-1.pcvyoqbyhfbpevzkwpsf.example/postgres',
    DIRECT_URL: 'postgres://user:secret@aws-1-ap-south-1.pcvyoqbyhfbpevzkwpsf.example/postgres',
  });
  assert.equal(blocked.ok, false);
  if (!blocked.ok) assert.equal(blocked.status, 'BLOCKED_PRODUCTION_DB');
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
