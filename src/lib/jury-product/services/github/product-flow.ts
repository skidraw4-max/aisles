/**
 * GitHub product screen.
 * It displays stored evidence and the stored review result. It does not score or re-decide them.
 */
import { servicePermissionSatisfies } from '../../service-member-management';
import { githubProseContainsSecret } from './document-secret';
import { planGithubReviewStart } from './review-plan';
import type { JuryServicePermission } from '../../service-permission';
import type { JuryClaimStrength, JuryDecision, JuryEvidenceStrength, JuryReviewStatus } from '../../records';
import { providerError, type ProviderError } from '../provider-types';

export type GithubFlowEvidence = {
  status: 'COLLECTED' | 'PARTIAL' | 'FAILED';
  collectedAt: string | null;
  repository: string;
  defaultBranch: string | null;
  readme: 'AVAILABLE' | 'EMPTY' | 'NOT_AVAILABLE' | 'FAILED';
  readmeBytes: number | null;
  commitCount: number | null;
  structureCount: number | null;
  structureState?: GithubObservedState;
  readmeState?: GithubObservedState;
  excerpt: string | null;
};

export type GithubObservedState = 'AVAILABLE' | 'NOT_AVAILABLE' | 'COLLECTION_FAILED' | 'COLLECTION_LIMIT_EXCEEDED';

export function githubSectionState(metric: { availability: string; rawValueText?: string | null } | null | undefined): GithubObservedState {
  if (metric?.availability === 'AVAILABLE') return 'AVAILABLE';
  if (metric?.availability === 'COLLECTION_FAILED' && metric.rawValueText === 'COLLECTION_LIMIT_EXCEEDED') return 'COLLECTION_LIMIT_EXCEEDED';
  if (metric?.availability === 'COLLECTION_FAILED') return 'COLLECTION_FAILED';
  if (metric?.availability === 'NOT_AVAILABLE' || metric?.availability === 'NOT_MEASURED') return 'NOT_AVAILABLE';
  return metric ? 'COLLECTION_FAILED' : 'NOT_AVAILABLE';
}

export type GithubFlowReview = {
  status: JuryReviewStatus;
  result: {
    id: string;
    decision: JuryDecision;
    evidenceStrength?: JuryEvidenceStrength | null;
    claimStrength?: JuryClaimStrength | null;
    statusSummary: string;
    topProblems: string[];
    expectedUserEffect: string;
    risk: string;
    dimensionEvidence: string[];
    supportedClaims: string[];
    partiallySupportedClaims: string[];
    hypotheses: string[];
  } | null;
};

export type GithubProductScreen = {
  source: 'github' | 'fixture';
  provider: 'GitHub';
  environment: 'github-app' | 'not-configured' | 'fixture';
  readOnly: true;
  repository: string | null;
  defaultBranch: string | null;
  scope: { resource: string; operation: 'read'; readonly: true } | null;
  evidenceStatus: GithubFlowEvidence['status'] | null;
  readme: 'AVAILABLE' | 'NOT_AVAILABLE' | 'FAILED';
  readmeBytes: number | null;
  readmeEmpty: boolean;
  readmeNote: string;
  commitCount: number | null;
  commitNote: string;
  structureCount: number | null;
  structureState: GithubObservedState;
  structureNote: string;
  unavailable: string[];
  excerpt: string | null;
  collectedAt: string | null;
  sensitiveFilesExcluded: true;
  canView: boolean;
  canCollect: boolean;
  canStartReview: boolean;
  reviewStatus: JuryReviewStatus | null;
  decision: JuryDecision | null;
  result: GithubFlowReview['result'] | null;
  reviewView: GithubReviewView | null;
  improvement: { offered: false } | { offered: true; reviewId: string };
};

export type GithubReviewView = {
  decision: JuryDecision;
  evidenceStrength: JuryEvidenceStrength | null;
  claimStrength: JuryClaimStrength | null;
  risk: string;
  statusSummary: string;
  topProblems: string[];
  expectedUserEffect: string;
  collapsed: {
    dimensionEvidence: string[];
    supportedClaims: string[];
    partiallySupportedClaims: string[];
    hypotheses: string[];
  };
};

export function planGithubProductAccess(input: {
  actorTenantId: string;
  connectionTenantId: string;
  connectionId: string;
  requestedConnectionId: string;
  servicePermission: JuryServicePermission | null;
  clientTenantId?: string | null;
  clientOrganizationId?: string | null;
  clientUserId?: string | null;
  clientRole?: string | null;
  clientPermission?: string | null;
  clientOperation?: string | null;
  clientReadonly?: boolean | null;
}): {
  ok: true;
  canView: boolean;
  canCollect: boolean;
  canReview: boolean;
  canImprove: boolean;
  operation: 'read';
  readonly: true;
} | ProviderError {
  void input.clientTenantId;
  void input.clientOrganizationId;
  void input.clientUserId;
  void input.clientRole;
  void input.clientPermission;
  void input.clientOperation;
  void input.clientReadonly;
  if (input.connectionTenantId !== input.actorTenantId || input.connectionId !== input.requestedConnectionId) {
    return providerError('CONNECTION_NOT_FOUND');
  }
  const level = input.servicePermission;
  const allowed = (required: JuryServicePermission) => Boolean(level && servicePermissionSatisfies(level, required));
  return {
    ok: true,
    canView: allowed('VIEW'),
    canCollect: allowed('REVIEW'),
    canReview: allowed('REVIEW'),
    canImprove: allowed('IMPROVE'),
    operation: 'read',
    readonly: true,
  };
}

export { planGithubReviewStart };

function cleanExcerpt(value: string | null): string | null {
  if (!value) return null;
  if (githubProseContainsSecret(value)) return null;
  return value.slice(0, 500);
}

export function projectGithubPermissionGuide(input: {
  connected: boolean;
  canView: boolean;
  canGrant: boolean;
}): {
  needed: false;
} | {
  needed: true;
  connected: true;
  granted: false;
  minimum: 'VIEW';
  collection: 'REVIEW';
  grantors: 'organization owner or admin';
  managePath: '/jury/organization/services';
  canGrant: boolean;
} {
  if (!input.connected || input.canView) return { needed: false };
  return {
    needed: true,
    connected: true,
    granted: false,
    minimum: 'VIEW',
    collection: 'REVIEW',
    grantors: 'organization owner or admin',
    managePath: '/jury/organization/services',
    canGrant: input.canGrant,
  };
}

export type GithubUiState =
  | 'no-connection'
  | 'no-permission'
  | 'not-configured'
  | 'no-repository'
  | 'no-scope'
  | 'evidence-failed'
  | 'evidence-partial'
  | 'evidence-collected'
  | 'review-running'
  | 'review-completed'
  | 'review-failed';

export function projectGithubUiState(input: {
  connected: boolean;
  configured: boolean;
  canView: boolean;
  repositorySelected: boolean;
  repositoryCount: number | null;
  evidenceStatus: GithubFlowEvidence['status'] | null;
  reviewStatus: JuryReviewStatus | null;
}): GithubUiState | null {
  if (!input.connected) return 'no-connection';
  if (!input.canView) return 'no-permission';
  if (!input.configured) return 'not-configured';
  if (input.repositoryCount === 0) return 'no-repository';
  if (!input.repositorySelected) return 'no-scope';
  if (input.reviewStatus === 'QUEUED' || input.reviewStatus === 'RUNNING') return 'review-running';
  if (input.reviewStatus === 'FAILED') return 'review-failed';
  if (input.reviewStatus === 'COMPLETED') return 'review-completed';
  if (input.evidenceStatus === 'FAILED') return 'evidence-failed';
  if (input.evidenceStatus === 'PARTIAL') return 'evidence-partial';
  if (input.evidenceStatus === 'COLLECTED') return 'evidence-collected';
  return null;
}

export function projectGithubProductScreen(input: {
  source: 'github' | 'fixture';
  configured: boolean;
  access: { canView?: boolean; canCollect: boolean; canReview: boolean; canImprove: boolean };
  repository: string | null;
  evidence: GithubFlowEvidence | null;
  review: GithubFlowReview | null;
}): GithubProductScreen {
  const visible = input.access.canView !== false;
  const evidence = visible ? input.evidence : null;
  const repository = visible ? input.repository : null;
  const review = visible ? input.review : null;
  const structureState: GithubObservedState = !evidence
    ? 'NOT_AVAILABLE'
    : evidence.structureState ?? (evidence.structureCount === null ? 'NOT_AVAILABLE' : 'AVAILABLE');
  const readmeState: GithubObservedState = !evidence
    ? 'NOT_AVAILABLE'
    : evidence.readmeState ?? (evidence.readme === 'FAILED' ? 'COLLECTION_FAILED' : evidence.readme === 'NOT_AVAILABLE' ? 'NOT_AVAILABLE' : 'AVAILABLE');
  const unavailable = evidence
    ? [
      evidence.readme === 'NOT_AVAILABLE' || evidence.readme === 'FAILED' ? 'README' : '',
      evidence.commitCount === null ? 'Commits' : '',
      structureState === 'COLLECTION_LIMIT_EXCEEDED'
        ? 'Structure limit exceeded'
        : structureState === 'COLLECTION_FAILED'
          ? 'Structure collection failed'
          : structureState === 'NOT_AVAILABLE'
            ? 'Structure'
            : '',
    ].filter((item) => item.length > 0)
    : [];
  const start = planGithubReviewStart({
    evidenceStatus: evidence?.status ?? null,
    reviewStatus: review?.status ?? null,
  });
  const result = review?.status === 'COMPLETED' ? review.result : null;
  const improvement = !result || !input.access.canImprove || result.decision === 'ACCEPT'
    ? { offered: false as const }
    : { offered: true as const, reviewId: result.id };
  return {
    source: input.source,
    provider: 'GitHub',
    environment: input.source === 'fixture' ? 'fixture' : input.configured ? 'github-app' : 'not-configured',
    readOnly: true,
    repository: evidence?.repository ?? repository,
    defaultBranch: evidence?.defaultBranch ?? null,
    scope: repository ? { resource: `repository:${repository}`, operation: 'read', readonly: true } : null,
    evidenceStatus: evidence?.status ?? null,
    readme: evidence?.readme === 'EMPTY' || evidence?.readme === 'AVAILABLE' ? 'AVAILABLE' : evidence?.readme === 'FAILED' ? 'FAILED' : 'NOT_AVAILABLE',
    readmeBytes: evidence?.readme === 'AVAILABLE' || evidence?.readme === 'EMPTY' ? evidence.readmeBytes : null,
    readmeEmpty: evidence?.readme === 'EMPTY',
    readmeNote: readmeNote(evidence?.readme ?? 'NOT_AVAILABLE', readmeState),
    commitCount: evidence?.commitCount ?? null,
    commitNote: (evidence?.commitCount ?? null) === null
      ? 'Commit count was not measured. It is not zero.'
      : 'Commit count is repository metadata. It is not a user activity metric.',
    structureCount: evidence?.structureCount ?? null,
    structureState,
    structureNote: structureNote(structureState),
    unavailable,
    excerpt: cleanExcerpt(evidence?.excerpt ?? null),
    collectedAt: evidence?.collectedAt ?? null,
    sensitiveFilesExcluded: true,
    canView: input.access.canView !== false,
    canCollect: visible && input.access.canCollect && Boolean(repository) && review?.status !== 'QUEUED' && review?.status !== 'RUNNING',
    canStartReview: visible && input.access.canReview && start.ok,
    reviewStatus: review?.status ?? null,
    decision: result?.decision ?? null,
    result,
    reviewView: result ? reviewView(result) : null,
    improvement,
  };
}

function readmeNote(readme: GithubFlowEvidence['readme'], state: GithubObservedState): string {
  if (state === 'COLLECTION_LIMIT_EXCEEDED') return 'README collection stopped because the read limit was exceeded.';
  if (readme === 'FAILED' || state === 'COLLECTION_FAILED') return 'README collection failed.';
  if (readme === 'EMPTY') return 'README is empty.';
  if (readme === 'NOT_AVAILABLE' || state === 'NOT_AVAILABLE') return 'README is absent. The read did not fail.';
  return '';
}

function structureNote(state: GithubObservedState): string {
  if (state === 'COLLECTION_LIMIT_EXCEEDED') return 'Structure collection stopped because the file size limit was exceeded.';
  if (state === 'COLLECTION_FAILED') return 'Structure collection failed.';
  if (state === 'NOT_AVAILABLE') return 'Structure was not available.';
  return '';
}

function reviewView(result: NonNullable<GithubFlowReview['result']>): GithubReviewView {
  return {
    decision: result.decision,
    evidenceStrength: result.evidenceStrength ?? null,
    claimStrength: result.claimStrength ?? null,
    risk: result.risk,
    statusSummary: result.statusSummary,
    topProblems: result.topProblems,
    expectedUserEffect: result.expectedUserEffect,
    collapsed: {
      dimensionEvidence: result.dimensionEvidence,
      supportedClaims: result.supportedClaims,
      partiallySupportedClaims: result.partiallySupportedClaims,
      hypotheses: result.hypotheses,
    },
  };
}

export function githubFixtureEvidence(): GithubFlowEvidence {
  return {
    status: 'PARTIAL',
    collectedAt: '2026-10-08T00:00:00.000Z',
    repository: 'octo/example',
    defaultBranch: 'main',
    readme: 'NOT_AVAILABLE',
    readmeBytes: null,
    commitCount: 0,
    structureCount: null,
    excerpt: null,
  };
}
