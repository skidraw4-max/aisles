import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { JuryActor } from '../../access';
import { packFromStoredEvidence } from './evidence';
import { evidencePackFingerprint, githubRefreshRequestId } from './pack-fingerprint';
import { refreshNewExecutionAllowed } from './refresh';
import { githubFirstReviewRequestId } from './review';
import {
  classifyGithubRefreshClaim,
  readGithubRefreshStatus,
  type GithubRefreshStatusPort,
  type GithubRefreshStatusClaim,
} from './refresh-status';

const TENANT = 'tenant-status';
const OTHER = 'tenant-other';
const CONNECTION = 'connection-status';
const EVIDENCE = 'evidence-status';
const PARENT = 'parent-result-status';

function actor(ok = true): JuryActor {
  if (!ok) return { ok: false, reason: 'UNAUTHENTICATED' };
  return { ok: true, userId: 'user-status', tenantId: TENANT, role: 'OWNER', membershipId: 'member-status' };
}

function connection() {
  return {
    id: CONNECTION,
    tenantId: TENANT,
    serviceKey: 'github-169469214',
    credentialRef: 'github-installation/169469214',
  };
}

function evidence(metricValue: number | null = 20) {
  return {
    id: EVIDENCE,
    tenantId: TENANT,
    connectionId: CONNECTION,
    purpose: 'github-repository-observation',
    periodStart: '2026-10-09',
    periodEnd: '2026-10-09',
    timezone: 'Asia/Seoul',
    documentEvidence: [{ fileName: 'commit:abc', source: 'github', section: 'note' }],
    collectedAt: '2026-10-09T08:00:12.697Z',
    piiExcluded: true,
    readOnly: true,
    metrics: [
      { metric: 'github.commitCount', value: metricValue, availability: 'AVAILABLE' as const, rawValueText: metricValue === null ? 'null' : String(metricValue) },
      { metric: 'github.readmeBytes', value: null, availability: 'NOT_AVAILABLE' as const, rawValueText: 'null' },
    ],
  };
}

function identity(metricValue: number | null = 20) {
  const row = evidence(metricValue);
  const pack = packFromStoredEvidence({
    evidence: row as never,
    repository: 'octo/example',
    metrics: row.metrics,
  });
  if (!pack) throw new Error('pack missing');
  const fingerprint = evidencePackFingerprint(pack);
  return { fingerprint, requestId: githubRefreshRequestId(TENANT, EVIDENCE, fingerprint), pack };
}

function port(overrides: Partial<GithubRefreshStatusPort> = {}): GithubRefreshStatusPort & { calls: string[] } {
  const calls: string[] = [];
  const current = identity();
  return {
    calls,
    actor: async () => {
      calls.push('actor');
      return actor();
    },
    loadConnection: async (query) => {
      calls.push(`connection:${query.tenantId}:${query.connectionId}`);
      return connection();
    },
    loadEvidence: async (query) => {
      calls.push(`evidence:${query.tenantId}:${query.connectionId}`);
      return evidence();
    },
    loadRepository: async (query) => {
      calls.push(`repository:${query.tenantId}:${query.connectionId}`);
      return 'octo/example';
    },
    loadParentResultId: async (query) => {
      calls.push(`parent:${query.tenantId}:${query.connectionId}:${query.evidenceId}:${query.requestId}`);
      return PARENT;
    },
    loadClaim: async (query) => {
      calls.push(`claim:${query.tenantId}:${query.connectionId}:${query.evidenceId}:${query.id}`);
      const claim: GithubRefreshStatusClaim = {
        status: 'COMPLETED',
        fingerprint: current.fingerprint,
        resultId: 'refresh-result',
        parentResultId: PARENT,
      };
      return claim;
    },
    ...overrides,
  };
}

test('an unauthenticated reader sees no refresh data and does not query', async () => {
  const deps = port({
    actor: async () => {
      deps.calls.push('actor');
      return actor(false);
    },
  });
  const status = await readGithubRefreshStatus(CONNECTION, deps);
  assert.deepEqual(status, { state: 'hidden' });
  assert.deepEqual(deps.calls, ['actor']);
});

test('a connection outside the actor tenant is hidden', async () => {
  const deps = port({
    loadConnection: async (query) => {
      deps.calls.push(`connection:${query.tenantId}:${query.connectionId}`);
      assert.equal(query.tenantId, TENANT);
      assert.notEqual(query.tenantId, OTHER);
      return null;
    },
  });
  const status = await readGithubRefreshStatus(CONNECTION, deps);
  assert.equal(status.state, 'hidden');
  assert.equal(deps.calls.some((call) => call.startsWith('evidence:')), false);
});

test('a non-github connection does not show refresh status', async () => {
  const deps = port({
    loadConnection: async (query) => {
      deps.calls.push(`connection:${query.tenantId}`);
      return { id: CONNECTION, tenantId: TENANT, serviceKey: 'mock-service', credentialRef: null };
    },
  });
  const status = await readGithubRefreshStatus(CONNECTION, deps);
  assert.equal(status.state, 'hidden');
  assert.equal(deps.calls.some((call) => call.startsWith('evidence:')), false);
});

test('a github connection with no evidence is an empty record, not a failed lookup', async () => {
  const deps = port({
    loadEvidence: async () => null,
  });
  const status = await readGithubRefreshStatus(CONNECTION, deps);
  assert.deepEqual(status, { state: 'none' });
});

test('a lookup failure stays unavailable and is not reported as no record', async () => {
  const deps = port({
    loadEvidence: async () => {
      throw new Error('store down');
    },
  });
  const status = await readGithubRefreshStatus(CONNECTION, deps);
  assert.deepEqual(status, { state: 'unavailable' });
});

test('the same fingerprint completed claim is reusable only with the parent result', async () => {
  const deps = port();
  const status = await readGithubRefreshStatus(CONNECTION, deps);
  assert.deepEqual(status, { state: 'reusable' });
  const current = identity();
  assert.equal(deps.calls.includes(`claim:${TENANT}:${CONNECTION}:${EVIDENCE}:${current.requestId}`), true);
  assert.equal(deps.calls.includes(`parent:${TENANT}:${CONNECTION}:${EVIDENCE}:${githubFirstReviewRequestId(TENANT, EVIDENCE)}`), true);
});

test('a completed claim with a different fingerprint is not reusable', () => {
  const current = identity();
  assert.equal(classifyGithubRefreshClaim({
    claim: { status: 'COMPLETED', fingerprint: 'f'.repeat(64), resultId: 'refresh-result', parentResultId: PARENT },
    fingerprint: current.fingerprint,
    parentResultId: PARENT,
  }), 'unavailable');
});

test('a completed claim without a result or parent is not reusable', () => {
  const current = identity();
  assert.equal(classifyGithubRefreshClaim({
    claim: { status: 'COMPLETED', fingerprint: current.fingerprint, resultId: null, parentResultId: PARENT },
    fingerprint: current.fingerprint,
    parentResultId: PARENT,
  }), 'unavailable');
  assert.equal(classifyGithubRefreshClaim({
    claim: { status: 'COMPLETED', fingerprint: current.fingerprint, resultId: 'refresh-result', parentResultId: 'other-parent' },
    fingerprint: current.fingerprint,
    parentResultId: PARENT,
  }), 'unavailable');
});

test('queued and running claims stay in progress and failed claims do not invite a retry', () => {
  const current = identity();
  for (const status of ['QUEUED', 'RUNNING'] as const) {
    assert.equal(classifyGithubRefreshClaim({
      claim: { status, fingerprint: current.fingerprint, resultId: null, parentResultId: null },
      fingerprint: current.fingerprint,
      parentResultId: PARENT,
    }), 'in-progress');
  }
  assert.equal(classifyGithubRefreshClaim({
    claim: { status: 'FAILED', fingerprint: current.fingerprint, resultId: null, parentResultId: null },
    fingerprint: current.fingerprint,
    parentResultId: PARENT,
  }), 'failed');
});

test('a null activity metric stays null in the refresh identity', async () => {
  const missing = identity(null);
  const zero = identity(0);
  assert.notEqual(missing.fingerprint, zero.fingerprint);
  assert.equal(missing.pack.aggregates.userCount, null);
  const deps = port({
    loadEvidence: async () => evidence(null),
    loadClaim: async (query) => {
      deps.calls.push(`claim:${query.id}`);
      assert.equal(query.id, missing.requestId);
      assert.notEqual(query.id, zero.requestId);
      return { status: 'COMPLETED', fingerprint: missing.fingerprint, resultId: 'refresh-result', parentResultId: PARENT };
    },
  });
  const status = await readGithubRefreshStatus(CONNECTION, deps);
  assert.equal(status.state, 'reusable');
  assert.equal(JSON.stringify(status).includes('"userCount":0'), false);
});

test('refresh status does not call execution or change the deny policy', () => {
  const source = readFileSync(new URL('./refresh-status.ts', import.meta.url), 'utf8');
  const panel = readFileSync(new URL('../../../../app/(root)/jury/github-refresh-status.tsx', import.meta.url), 'utf8');
  for (const token of ['refreshGithubEvidence', 'startGithubRefreshReview', 'reviewGithubEvidence', 'insertRefreshClaim', ['createGemini', 'ReviewBoardLlm'].join('')]) {
    assert.equal(source.includes(token), false);
    assert.equal(panel.includes(token), false);
  }
  assert.equal(panel.includes('<form'), false);
  assert.equal(panel.includes('<button'), false);
  assert.equal(refreshNewExecutionAllowed(), false);
});
