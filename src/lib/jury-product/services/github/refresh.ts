/**
 * Explicit GitHub refresh review.
 * The first FULL_REVIEW gate stays in planGithubReviewStart. This path runs only after that review is COMPLETED.
 */
import path from 'node:path';
import type { EvidencePack } from '@/lib/ai-review-board/types';
import { readJson, runDir } from '@/lib/ai-review-board/store';
import type { FrozenCoreReading } from '../../review-boundary';
import {
  JURY_PRODUCT_DATA_ROOT,
  type JuryFinalSurface,
  type JuryReviewStatus,
} from '../../records';
import { githubPayloadHasSecret } from './document-secret';
import { packFromStoredEvidence, type GithubStoredMetric } from './evidence';
import { evidencePackFingerprint, githubRefreshRequestId } from './pack-fingerprint';
import { planGithubReviewStart } from './review-plan';
import { githubFirstReviewRequestId } from './review';

export type GithubRefreshStop =
  | 'evidence-failed'
  | 'in-progress'
  | 'review-failed'
  | 'refresh-failed'
  | 'secret-rejected'
  | 'not-ready'
  | 'provenance-mismatch'
  | 'execution-denied';

export type GithubRefreshSnapshot = {
  evidence: {
    id: string;
    tenantId: string;
    connectionId: string;
    purpose: string;
    periodStart: string;
    periodEnd: string;
    timezone: string;
    metricIds: string[];
    documentEvidence?: Array<{ fileName: string; source: string; section?: string }>;
    adapterKey: string;
    collectedAt: string;
    piiExcluded: boolean;
    readOnly: boolean;
  } | null;
  repository: string | null;
  metrics: readonly GithubStoredMetric[];
  firstRequest: { id: string; status: JuryReviewStatus } | null;
  firstResult: { id: string; decision: string; boardRunId: string; finalSurface: JuryFinalSurface } | null;
};

export type GithubRefreshClaim = {
  id: string;
  status: JuryReviewStatus;
  fingerprint: string;
  resultId: string | null;
  parentResultId: string | null;
};

export type GithubRefreshStore = {
  load(input: { tenantId: string; connectionId: string; evidenceId: string }): Promise<GithubRefreshSnapshot>;
  claim(row: {
    id: string;
    tenantId: string;
    connectionId: string;
    evidenceId: string;
    fingerprint: string;
    requestedByUserId: string;
    parentResultId: string;
  }): Promise<'claimed' | 'conflict'>;
  readClaim(id: string): Promise<GithubRefreshClaim | null>;
  complete(row: {
    requestId: string;
    resultId: string;
    tenantId: string;
    parentResultId: string;
    reading: FrozenCoreReading;
  }): Promise<'completed' | 'lost'>;
  fail(requestId: string): Promise<void>;
  readArtifact(boardRunId: string): Promise<EvidencePack | null>;
};

export function planGithubRefreshReview(input: {
  requestedEvidenceId: string;
  evidence: GithubRefreshSnapshot['evidence'];
  firstRequest: GithubRefreshSnapshot['firstRequest'];
  firstResult: GithubRefreshSnapshot['firstResult'];
}): { ok: true; parentResultId: string } | { ok: false; flow: GithubRefreshStop } {
  const evidence = input.evidence;
  if (
    !evidence
    || evidence.id !== input.requestedEvidenceId
    || evidence.purpose !== 'github-repository-observation'
    || evidence.adapterKey !== 'github'
    || evidence.piiExcluded !== true
    || evidence.readOnly !== true
  ) {
    return { ok: false, flow: 'evidence-failed' };
  }
  const firstId = githubFirstReviewRequestId(evidence.tenantId, evidence.id);
  const first = planGithubReviewStart({
    evidenceStatus: 'COLLECTED',
    reviewStatus: input.firstRequest?.id === firstId ? input.firstRequest.status : null,
  });
  if (!input.firstRequest || input.firstRequest.id !== firstId || !input.firstResult) {
    return { ok: false, flow: 'not-ready' };
  }
  if (!first.ok) {
    if (first.flow === 'review-exists') return { ok: true, parentResultId: input.firstResult.id };
    if (first.flow === 'in-progress' || first.flow === 'review-failed' || first.flow === 'evidence-failed') {
      return { ok: false, flow: first.flow };
    }
  }
  return { ok: false, flow: 'not-ready' };
}

export function refreshClaimDecision(status: JuryReviewStatus | null): 'claim' | 'in-progress' | 'refresh-failed' | 'refresh-completed' {
  if (status === 'QUEUED' || status === 'RUNNING') return 'in-progress';
  if (status === 'FAILED') return 'refresh-failed';
  if (status === 'COMPLETED') return 'refresh-completed';
  return 'claim';
}

/** New Refresh execution stays closed. Callers cannot pass an approval flag. */
export function refreshNewExecutionAllowed(): false {
  return false;
}

export async function readRefreshArtifact(boardRunId: string): Promise<EvidencePack | null> {
  if (!boardRunId || /[\\/]|\.\./.test(boardRunId)) return null;
  return readJson<EvidencePack>(path.join(runDir(JURY_PRODUCT_DATA_ROOT, boardRunId), 'evidence.json'));
}

export async function startGithubRefreshReview(input: {
  tenantId: string;
  userId: string;
  connectionId: string;
  evidenceId: string;
  execute: (pack: EvidencePack) => Promise<FrozenCoreReading>;
  store: GithubRefreshStore;
}): Promise<
  | { ok: true; created: boolean; requestId: string; resultId: string; parentResultId: string; fingerprint: string }
  | { ok: false; flow: GithubRefreshStop }
> {
  const snapshot = await input.store.load({
    tenantId: input.tenantId,
    connectionId: input.connectionId,
    evidenceId: input.evidenceId,
  });
  const planned = planGithubRefreshReview({
    requestedEvidenceId: input.evidenceId,
    evidence: snapshot.evidence,
    firstRequest: snapshot.firstRequest,
    firstResult: snapshot.firstResult,
  });
  if (!planned.ok) return planned;
  const evidence = snapshot.evidence;
  const repository = snapshot.repository;
  if (!evidence || !repository) return { ok: false, flow: 'evidence-failed' };
  const pack = packFromStoredEvidence({ evidence, repository, metrics: snapshot.metrics });
  if (!pack || githubPayloadHasSecret(pack)) return { ok: false, flow: 'secret-rejected' };
  const fingerprint = evidencePackFingerprint(pack);
  const requestId = githubRefreshRequestId(input.tenantId, input.evidenceId, fingerprint);
  if (requestId === snapshot.firstRequest?.id) return { ok: false, flow: 'not-ready' };
  const existing = await input.store.readClaim(requestId);
  if (existing) return finishExisting(input.store, requestId, planned.parentResultId, fingerprint);
  if (refreshNewExecutionAllowed() === false) return { ok: false, flow: 'execution-denied' };
  return { ok: false, flow: 'execution-denied' };
}

async function finishExisting(
  store: GithubRefreshStore,
  requestId: string,
  parentResultId: string,
  fingerprint: string,
): Promise<
  | { ok: true; created: false; requestId: string; resultId: string; parentResultId: string; fingerprint: string }
  | { ok: false; flow: GithubRefreshStop }
> {
  const existing = await store.readClaim(requestId);
  const decision = refreshClaimDecision(existing?.status ?? null);
  if (decision === 'refresh-completed' && existing?.resultId && existing.fingerprint === fingerprint && existing.parentResultId === parentResultId) {
    return { ok: true, created: false, requestId, resultId: existing.resultId, parentResultId, fingerprint };
  }
  if (decision === 'in-progress') return { ok: false, flow: 'in-progress' };
  if (decision === 'refresh-failed') return { ok: false, flow: 'refresh-failed' };
  return { ok: false, flow: 'not-ready' };
}
