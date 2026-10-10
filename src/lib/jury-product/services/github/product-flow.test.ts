import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { planGithubProductAccess, planGithubReviewStart, projectGithubPermissionGuide, projectGithubProductScreen, projectGithubUiState, githubFixtureEvidence, githubSectionState } from './product-flow';

const TOKEN = 'FAKE_GITHUB_TOKEN_80_17';
const PRIVATE_KEY = 'FAKE_GITHUB_PRIVATE_KEY_80_17';
const SECRET = 'FAKE_GITHUB_SECRET_80_17';

const reviewAccess = { canCollect: true, canReview: true, canImprove: true };

test('github product access ignores client scope and stays read-only', () => {
  const view = planGithubProductAccess({
    actorTenantId: 'org-a',
    connectionTenantId: 'org-a',
    connectionId: 'conn-a',
    requestedConnectionId: 'conn-a',
    servicePermission: 'VIEW',
    clientTenantId: 'org-b',
    clientOrganizationId: 'org-b',
    clientUserId: 'user-b',
    clientRole: 'OWNER',
    clientPermission: 'AGENT',
    clientOperation: 'write',
    clientReadonly: false,
  });
  assert.equal(view.ok, true);
  if (!view.ok) return;
  assert.equal(view.canView, true);
  assert.equal(view.canCollect, false);
  assert.equal(view.canReview, false);
  assert.equal(view.operation, 'read');
  assert.equal(view.readonly, true);
  const review = planGithubProductAccess({
    actorTenantId: 'org-a',
    connectionTenantId: 'org-a',
    connectionId: 'conn-a',
    requestedConnectionId: 'conn-a',
    servicePermission: 'REVIEW',
  });
  assert.equal(review.ok, true);
  if (review.ok) {
    assert.equal(review.canCollect, true);
    assert.equal(review.canReview, true);
    assert.equal(review.canImprove, false);
  }
  const none = planGithubProductAccess({
    actorTenantId: 'org-a',
    connectionTenantId: 'org-a',
    connectionId: 'conn-a',
    requestedConnectionId: 'conn-a',
    servicePermission: null,
  });
  assert.equal(none.ok, true);
  if (none.ok) {
    assert.equal(none.canView, false);
    assert.equal(none.canCollect, false);
    assert.equal(none.canReview, false);
    assert.equal(none.canImprove, false);
  }
  const foreign = planGithubProductAccess({
    actorTenantId: 'org-a',
    connectionTenantId: 'org-b',
    connectionId: 'conn-b',
    requestedConnectionId: 'conn-b',
    servicePermission: 'AGENT',
    clientTenantId: 'org-a',
  });
  assert.equal(foreign.ok, false);
  if (!foreign.ok) assert.equal(foreign.code, 'CONNECTION_NOT_FOUND');
});

test('github fixture flow keeps zero distinct from unavailable and does not re-decide', () => {
  const evidence = githubFixtureEvidence();
  const screen = projectGithubProductScreen({
    source: 'fixture',
    configured: false,
    access: reviewAccess,
    repository: 'octo/example',
    evidence,
    review: null,
  });
  assert.equal(screen.source, 'fixture');
  assert.equal(screen.environment, 'fixture');
  assert.equal(screen.provider, 'GitHub');
  assert.equal(screen.readOnly, true);
  assert.equal(screen.scope?.operation, 'read');
  assert.equal(screen.scope?.readonly, true);
  assert.equal(screen.commitCount, 0);
  assert.equal(screen.structureCount, null);
  assert.equal(screen.unavailable.includes('README'), true);
  assert.equal(screen.unavailable.includes('Structure'), true);
  assert.equal(screen.canStartReview, true);
  assert.equal(screen.evidenceStatus, 'PARTIAL');

  const failed = projectGithubProductScreen({
    source: 'fixture',
    configured: true,
    access: reviewAccess,
    repository: 'octo/example',
    evidence: { ...evidence, status: 'FAILED', commitCount: null },
    review: null,
  });
  assert.equal(failed.canStartReview, false);
  assert.equal(failed.commitCount, null);
  assert.equal(planGithubReviewStart({ evidenceStatus: 'FAILED', reviewStatus: null }).ok, false);

  const stored = projectGithubProductScreen({
    source: 'github',
    configured: true,
    access: reviewAccess,
    repository: 'octo/example',
    evidence: { ...evidence, status: 'COLLECTED', readme: 'AVAILABLE', readmeBytes: 12, structureCount: 4, excerpt: `hello ${TOKEN}` },
    review: {
      status: 'COMPLETED',
      result: {
        id: 'review-1',
        decision: 'VERIFY',
        statusSummary: 'Stored summary',
        topProblems: [],
        expectedUserEffect: 'Stored effect',
        risk: 'Stored risk',
        dimensionEvidence: ['Stored dimension'],
        supportedClaims: [],
        partiallySupportedClaims: [],
        hypotheses: [],
      },
    },
  });
  assert.equal(stored.decision, 'VERIFY');
  assert.equal(stored.reviewStatus, 'COMPLETED');
  assert.equal(stored.canStartReview, false);
  assert.equal(stored.excerpt, null);
  assert.equal(stored.improvement.offered, true);
  if (stored.improvement.offered) assert.equal(stored.improvement.reviewId, 'review-1');
  const accepted = projectGithubProductScreen({
    source: 'github',
    configured: true,
    access: reviewAccess,
    repository: 'octo/example',
    evidence,
    review: {
      status: 'COMPLETED',
      result: {
        id: 'review-2',
        decision: 'ACCEPT',
        statusSummary: 'Accepted',
        topProblems: ['still listed'],
        expectedUserEffect: '',
        risk: '',
        dimensionEvidence: [],
        supportedClaims: [],
        partiallySupportedClaims: [],
        hypotheses: [],
      },
    },
  });
  assert.equal(accepted.decision, 'ACCEPT');
  assert.equal(accepted.improvement.offered, false);
  const running = projectGithubProductScreen({
    source: 'github',
    configured: true,
    access: reviewAccess,
    repository: 'octo/example',
    evidence,
    review: { status: 'RUNNING', result: null },
  });
  assert.equal(running.reviewStatus, 'RUNNING');
  assert.equal(running.canStartReview, false);
  assert.equal(running.canCollect, false);
  assert.equal(JSON.stringify(stored).includes(TOKEN), false);
  assert.equal(JSON.stringify(stored).includes(PRIVATE_KEY), false);
  assert.equal(JSON.stringify(stored).includes(SECRET), false);
  assert.equal(JSON.stringify(stored).includes('semanticJudgments'), false);
  assert.equal(JSON.stringify(stored).includes('%'), false);
});

test('github permission guide stays inside the current grant model', () => {
  const missing = projectGithubPermissionGuide({ connected: true, canView: false, canGrant: false });
  assert.equal(missing.needed, true);
  if (!missing.needed) return;
  assert.equal(missing.granted, false);
  assert.equal(missing.minimum, 'VIEW');
  assert.equal(missing.collection, 'REVIEW');
  assert.equal(missing.managePath, '/jury/organization/services');
  assert.equal(missing.canGrant, false);
  const text = JSON.stringify(missing);
  assert.equal(text.includes('installation'), false);
  assert.equal(text.includes('credential'), false);
  assert.equal(text.includes('@'), false);
  assert.equal(projectGithubPermissionGuide({ connected: false, canView: false, canGrant: true }).needed, false);
  assert.equal(projectGithubPermissionGuide({ connected: true, canView: true, canGrant: true }).needed, false);
  const hidden = projectGithubProductScreen({
    source: 'github',
    configured: false,
    access: { canView: false, canCollect: false, canReview: false, canImprove: false },
    repository: 'foreign/private',
    evidence: githubFixtureEvidence(),
    review: null,
  });
  assert.equal(hidden.repository, null);
  assert.equal(hidden.scope, null);
  assert.equal(JSON.stringify(hidden).includes('foreign/private'), false);
  assert.equal(JSON.stringify(hidden).includes('octo/example'), false);
});

test('github product states stay distinct without a new status enum', () => {
  assert.equal(projectGithubUiState({ connected: false, configured: false, canView: false, repositorySelected: false, repositoryCount: null, evidenceStatus: null, reviewStatus: null }), 'no-connection');
  assert.equal(projectGithubUiState({ connected: true, configured: true, canView: false, repositorySelected: false, repositoryCount: null, evidenceStatus: null, reviewStatus: null }), 'no-permission');
  assert.equal(projectGithubUiState({ connected: true, configured: false, canView: true, repositorySelected: false, repositoryCount: null, evidenceStatus: null, reviewStatus: null }), 'not-configured');
  assert.equal(projectGithubUiState({ connected: true, configured: true, canView: true, repositorySelected: false, repositoryCount: 0, evidenceStatus: null, reviewStatus: null }), 'no-repository');
  assert.equal(projectGithubUiState({ connected: true, configured: true, canView: true, repositorySelected: false, repositoryCount: 2, evidenceStatus: null, reviewStatus: null }), 'no-scope');
  assert.equal(projectGithubUiState({ connected: true, configured: true, canView: true, repositorySelected: true, repositoryCount: 2, evidenceStatus: 'FAILED', reviewStatus: null }), 'evidence-failed');
  assert.equal(projectGithubUiState({ connected: true, configured: true, canView: true, repositorySelected: true, repositoryCount: 2, evidenceStatus: 'PARTIAL', reviewStatus: null }), 'evidence-partial');
  assert.equal(projectGithubUiState({ connected: true, configured: true, canView: true, repositorySelected: true, repositoryCount: 2, evidenceStatus: 'COLLECTED', reviewStatus: 'RUNNING' }), 'review-running');
  assert.equal(projectGithubUiState({ connected: true, configured: true, canView: true, repositorySelected: true, repositoryCount: 2, evidenceStatus: 'COLLECTED', reviewStatus: 'COMPLETED' }), 'review-completed');
  assert.equal(projectGithubUiState({ connected: true, configured: true, canView: true, repositorySelected: true, repositoryCount: 2, evidenceStatus: 'COLLECTED', reviewStatus: 'FAILED' }), 'review-failed');
});

test('github review presentation keeps the stored decision and folds repeated claims', () => {
  assert.equal(githubSectionState({ availability: 'NOT_AVAILABLE', rawValueText: 'null' }), 'NOT_AVAILABLE');
  assert.equal(githubSectionState({ availability: 'COLLECTION_FAILED', rawValueText: 'null' }), 'COLLECTION_FAILED');
  assert.equal(githubSectionState({ availability: 'COLLECTION_FAILED', rawValueText: 'COLLECTION_LIMIT_EXCEEDED' }), 'COLLECTION_LIMIT_EXCEEDED');
  assert.equal(githubSectionState({ availability: 'AVAILABLE', rawValueText: '4' }), 'AVAILABLE');
  const evidence = githubFixtureEvidence();
  const limited = projectGithubProductScreen({
    source: 'github',
    configured: true,
    access: reviewAccess,
    repository: 'octo/example',
    evidence: { ...evidence, readme: 'NOT_AVAILABLE', structureState: 'COLLECTION_LIMIT_EXCEEDED', commitCount: 20 },
    review: {
      status: 'COMPLETED',
      result: {
        id: 'review-3',
        decision: 'ACCEPT',
        evidenceStrength: 'unknown',
        claimStrength: 'weak',
        statusSummary: 'The platform is currently unmeasurable.',
        topProblems: ['Complete lack of measurable user activity.'],
        expectedUserEffect: 'No user effect can be determined (cause unverified).',
        risk: 'High',
        dimensionEvidence: ['newUsersLast7d is null.'],
        supportedClaims: ['모든 핵심 지표가 누락되어 측정 불가능합니다.'],
        partiallySupportedClaims: ['데이터 부족으로 인해 평가가 불가능합니다.'],
        hypotheses: ['Tracking is needed.'],
      },
    },
  });
  assert.equal(limited.decision, 'ACCEPT');
  assert.equal(limited.reviewView?.decision, 'ACCEPT');
  assert.equal(limited.reviewView?.evidenceStrength, 'unknown');
  assert.equal(limited.reviewView?.claimStrength, 'weak');
  assert.equal(limited.reviewView?.risk, 'High');
  assert.equal(limited.reviewView?.statusSummary, 'The platform is currently unmeasurable.');
  assert.deepEqual(limited.reviewView?.topProblems, ['Complete lack of measurable user activity.']);
  assert.deepEqual(limited.reviewView?.collapsed.supportedClaims, ['모든 핵심 지표가 누락되어 측정 불가능합니다.']);
  assert.deepEqual(limited.reviewView?.collapsed.partiallySupportedClaims, ['데이터 부족으로 인해 평가가 불가능합니다.']);
  assert.equal(limited.result?.decision, 'ACCEPT');
  assert.equal(limited.result?.supportedClaims[0]?.includes('모든'), true);
  assert.equal(limited.structureState, 'COLLECTION_LIMIT_EXCEEDED');
  assert.equal(limited.structureNote.includes('file size limit'), true);
  assert.equal(limited.readmeNote.includes('did not fail'), true);
  assert.equal(limited.unavailable.includes('Structure limit exceeded'), true);
  assert.equal(limited.unavailable.includes('Structure'), false);
  assert.equal(limited.commitCount, 20);
  assert.equal(limited.commitNote.includes('not a user activity metric'), true);
  assert.equal(JSON.stringify(limited).includes('a.txt'), false);
  const failed = projectGithubProductScreen({
    source: 'github',
    configured: true,
    access: reviewAccess,
    repository: 'octo/example',
    evidence: { ...evidence, readme: 'FAILED', structureState: 'COLLECTION_FAILED', commitCount: null },
    review: null,
  });
  assert.equal(failed.structureState, 'COLLECTION_FAILED');
  assert.equal(failed.structureNote.includes('COLLECTION_LIMIT_EXCEEDED'), false);
  assert.equal(failed.readmeNote.includes('collection failed'), true);
  assert.equal(failed.commitNote.includes('not zero'), true);
  assert.equal(failed.decision, null);
});

test('github product flow source does not invent progress or a review pipeline', () => {
  const source = readFileSync(new URL('./product-flow.ts', import.meta.url), 'utf8');
  const panel = readFileSync(new URL('../../../../app/(root)/jury/services/github/github-panel.tsx', import.meta.url), 'utf8');
  const page = readFileSync(new URL('../../../../app/(root)/jury/services/github/page.tsx', import.meta.url), 'utf8');
  for (const text of [source, panel, page]) {
    assert.equal(text.includes('semanticJudgments'), false);
    assert.equal(text.includes('73%'), false);
    assert.equal(text.includes('runReviewBoardPipeline'), false);
    assert.equal(text.includes('localStorage'), false);
    assert.equal(text.includes(TOKEN), false);
    assert.equal(text.includes('credentialRef'), false);
    assert.equal(text.includes('installationId'), false);
  }
  assert.equal(panel.includes("juryHref('/organization/services')"), true);
  assert.equal(panel.includes('Evidence strength'), true);
  assert.equal(panel.includes('Claim strength'), true);
  assert.equal(panel.includes('<details>'), true);
  assert.equal(panel.includes('reviewView'), true);
  assert.equal(panel.includes('addJuryServiceMember'), false);
  const listAt = page.indexOf('await listGithubRepositories');
  const viewAt = page.indexOf('screen?.canView && configuration.configured');
  assert.equal(viewAt !== -1 && listAt > viewAt, true);
});
