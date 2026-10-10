/**
 * Availability hints from stored GitHub metrics. Pure: no file I/O, no database, no network.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { JURY_CLAIM_STRENGTHS, JURY_DECISIONS, JURY_EVIDENCE_STRENGTHS } from '../../records';
import type { FrozenCoreReading } from '../../review-boundary';
import { githubObservationHints, packFromStoredEvidence, type GithubStoredMetric } from './evidence';
import { evidencePackFingerprint, githubRefreshRequestId } from './pack-fingerprint';
import { startGithubRefreshReview, type GithubRefreshStore } from './refresh';
import { githubFirstReviewRequestId, runGithubEvidenceReview } from './review';

const EVIDENCE = {
  id: 'evidence-hints',
  tenantId: 'org-a',
  connectionId: 'conn-a',
  purpose: 'github-repository-observation',
  periodStart: '2026-10-10',
  periodEnd: '2026-10-10',
  timezone: 'Asia/Seoul',
  metricIds: [],
  documentEvidence: [{ fileName: 'commit:abc', section: 'message', source: 'github' }],
  adapterKey: 'github',
  collectedAt: '2026-10-10T00:00:00.000Z',
  piiExcluded: true,
  readOnly: true,
};

function metric(name: string, value: number | null, availability: GithubStoredMetric['availability']): GithubStoredMetric {
  return { metric: name, value, availability, rawValueText: value === null ? 'null' : String(value) };
}

const FULL: GithubStoredMetric[] = [
  metric('github.commitCount', 5, 'AVAILABLE'),
  metric('github.readmeBytes', 100, 'AVAILABLE'),
  metric('github.structureEntryCount', 3, 'AVAILABLE'),
];

function hints(metrics: readonly GithubStoredMetric[]): string[] {
  return githubObservationHints({ metrics, commitDocuments: 1 });
}

function has(list: readonly string[], text: string): boolean {
  return list.some((hint) => hint.includes(text));
}

function reading(): FrozenCoreReading {
  return {
    boardRunId: 'run-hints',
    evidenceStrength: JURY_EVIDENCE_STRENGTHS[0],
    claimStrength: JURY_CLAIM_STRENGTHS[0],
    conflictDetected: false,
    overclaimDetected: false,
    revisionRequired: false,
    expectedDecision: JURY_DECISIONS[0],
    finalSurface: null,
    completedAt: '2026-10-10T00:00:00.000Z',
  } as unknown as FrozenCoreReading;
}

test('all three availability hints are present for measured values', () => {
  const list = hints(FULL);
  assert.equal(has(list, 'commit count is available: 5'), true);
  assert.equal(has(list, 'README is available. Bytes 100.'), true);
  assert.equal(has(list, 'structure entries collected: 3'), true);
});

test('omitted metrics do not invent values and keep README and structure hints absent', () => {
  const pack = packFromStoredEvidence({ evidence: EVIDENCE, repository: 'octo/example' });
  assert.ok(pack);
  assert.equal(has(pack.docsHints, 'commit count was not included'), true);
  assert.equal(has(pack.docsHints, 'available: 0'), false);
  assert.equal(has(pack.docsHints, 'README'), false);
  assert.equal(has(pack.docsHints, 'structure'), false);
});

test('an empty metrics array behaves like omitted metrics', () => {
  const pack = packFromStoredEvidence({ evidence: EVIDENCE, repository: 'octo/example', metrics: [] });
  assert.ok(pack);
  assert.equal(has(pack.docsHints, 'commit count was not included'), true);
  assert.equal(has(pack.docsHints, 'README'), false);
  assert.equal(has(pack.docsHints, 'structure'), false);
});

test('README AVAILABLE without a number is not shown as measured', () => {
  const nullValue = hints([metric('github.readmeBytes', null, 'AVAILABLE')]);
  const missingValue = hints([{ metric: 'github.readmeBytes', availability: 'AVAILABLE' } as unknown as GithubStoredMetric]);
  const nonNumber = hints([{ metric: 'github.readmeBytes', value: '12', availability: 'AVAILABLE' } as unknown as GithubStoredMetric]);
  const notFinite = hints([metric('github.readmeBytes', Number.NaN, 'AVAILABLE')]);
  for (const list of [nullValue, missingValue, nonNumber, notFinite]) {
    assert.equal(has(list, 'Bytes'), false);
    assert.equal(has(list, 'README is empty'), false);
    assert.equal(has(list, 'README is available'), false);
  }
});

test('README unavailable states keep their existing hints', () => {
  assert.equal(has(hints([metric('github.readmeBytes', null, 'NOT_AVAILABLE')]), 'absence, not a collection failure'), true);
  assert.equal(has(hints([metric('github.readmeBytes', null, 'COLLECTION_FAILED')]), 'README collection failed'), true);
});

test('README zero stays a measured empty README', () => {
  const list = hints([metric('github.readmeBytes', 0, 'AVAILABLE')]);
  assert.equal(has(list, 'GitHub README is empty.'), true);
  assert.equal(has(list, 'Bytes'), false);
});

test('README valid number keeps the byte count', () => {
  assert.equal(has(hints([metric('github.readmeBytes', 2048, 'AVAILABLE')]), 'GitHub README is available. Bytes 2048.'), true);
});

test('structure without a value is reported as not measured', () => {
  const list = hints([metric('github.structureEntryCount', null, 'AVAILABLE')]);
  assert.equal(has(list, 'GitHub structure was not measured.'), true);
  assert.equal(has(list, 'entries collected'), false);
});

test('stored metrics reach the execute input through the review entrance', async () => {
  const pack = packFromStoredEvidence({ evidence: EVIDENCE, repository: 'octo/example', metrics: FULL });
  assert.ok(pack);
  let seen: string[] | null = null;
  const reviewed = await runGithubEvidenceReview({
    tenantId: 'org-a',
    userId: 'user-a',
    connectionId: 'conn-a',
    evidenceId: EVIDENCE.id,
    pack,
    execute: async (input) => {
      seen = input.docsHints;
      return reading();
    },
  });
  assert.equal(reviewed.ok, true);
  assert.deepEqual(seen, pack.docsHints);
  assert.equal(has(seen ?? [], 'README is available. Bytes 100.'), true);
});

function refreshStore(metrics: GithubStoredMetric[], claimId: string, fingerprint: string): GithubRefreshStore {
  return {
    async load() {
      return {
        evidence: EVIDENCE,
        repository: 'octo/example',
        metrics,
        firstRequest: { id: githubFirstReviewRequestId('org-a', EVIDENCE.id), status: 'COMPLETED' },
        firstResult: { id: 'result-first', decision: JURY_DECISIONS[0], boardRunId: 'run-first', finalSurface: null },
      };
    },
    async claim() {
      throw new Error('claim must not run');
    },
    async readClaim(id: string) {
      return id === claimId
        ? { status: 'COMPLETED', fingerprint, resultId: 'result-refresh', parentResultId: 'result-first' }
        : null;
    },
  } as unknown as GithubRefreshStore;
}

test('a completed refresh with the same stored metrics is reused without execute', async () => {
  const pack = packFromStoredEvidence({ evidence: EVIDENCE, repository: 'octo/example', metrics: FULL });
  assert.ok(pack);
  const fingerprint = evidencePackFingerprint(pack);
  let executed = false;
  const result = await startGithubRefreshReview({
    tenantId: 'org-a',
    userId: 'user-a',
    connectionId: 'conn-a',
    evidenceId: EVIDENCE.id,
    execute: async () => {
      executed = true;
      return reading();
    },
    store: refreshStore(FULL, githubRefreshRequestId('org-a', EVIDENCE.id, fingerprint), fingerprint),
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.created, false);
    assert.equal(result.resultId, 'result-refresh');
  }
  assert.equal(executed, false);
});

test('fingerprint follows the presence of stored metrics', () => {
  const full = packFromStoredEvidence({ evidence: EVIDENCE, repository: 'octo/example', metrics: FULL });
  const omitted = packFromStoredEvidence({ evidence: EVIDENCE, repository: 'octo/example' });
  const empty = packFromStoredEvidence({ evidence: EVIDENCE, repository: 'octo/example', metrics: [] });
  assert.ok(full && omitted && empty);
  assert.notEqual(evidencePackFingerprint(full), evidencePackFingerprint(omitted));
  assert.equal(evidencePackFingerprint(omitted), evidencePackFingerprint(empty));
});