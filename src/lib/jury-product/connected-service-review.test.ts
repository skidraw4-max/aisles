/**
 * CONNECTED mock service collects product evidence and runs the existing Jury Core once.
 * Run: node --import tsx --test src/lib/jury-product/connected-service-review.test.ts
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import type { EvidenceDb } from '@/lib/ai-review-board/evidence-pack';
import type { JuryActor } from './access';
import {
  describeEvidenceCollection,
  projectConnectedServiceFlow,
  runConnectedServiceEvidenceCollection,
  runConnectedServiceReview,
  type CollectionCommand,
} from './connected-service-review';
import type { JuryConsoleView } from './console-view';
import type { ProductReviewCore } from './review-boundary';
import { JURY_CORE_CONTRACT_VERSION, JURY_PRODUCT_DATA_ROOT, type JuryFinalSurface, type JuryMembership } from './records';
import {
  persistOnboardingDiscovery,
  persistOnboardingScopeDecision,
  persistServiceOnboarding,
} from './service-onboarding';

const TENANT = 'phase73-review';
const FOREIGN = 'phase73-review-foreign';
const NOW = '2026-10-05T01:00:00.000Z';
const LIVE_REVIEW = '3707202563ecae9b38f324a4eefd9243a14bc69420ed6cdda16c4c5794f62e0d';
const LIVE_CYCLE = '14308b4c999ccbe8ca54b7f31da5385385d4073c49bbf2955582a6bb96afb01e';
const REF = 'mock-connection-001';
const PERIOD_A = ['2026-09-01', '2026-09-07'] as const;
const PERIOD_B = ['2026-09-08', '2026-09-14'] as const;
const PERIOD_C = ['2026-09-15', '2026-09-21'] as const;
const PERIOD_D = ['2026-09-22', '2026-09-28'] as const;

const owner = membership('phase73-owner-m', TENANT, 'phase73-owner', 'OWNER');
const member = membership('phase73-member-m', TENANT, 'phase73-member', 'DEVELOPER');
const auditor = membership('phase73-auditor-m', TENANT, 'phase73-auditor', 'VIEWER');
const foreign = membership('phase73-foreign-m', FOREIGN, 'phase73-foreign', 'OWNER');
const ownerActor = actor(owner);
const memberActor = actor(member);
const auditorActor = actor(auditor);
const foreignActor = actor(foreign);

test('connected service projection keeps measured zero distinct from absence', () => {
  assert.equal(describeEvidenceCollection([{ availability: 'AVAILABLE', value: 0 }]), 'AVAILABLE');
  assert.equal(describeEvidenceCollection([{ availability: 'NOT_MEASURED', value: null }]), 'NOT_MEASURED');
  assert.equal(describeEvidenceCollection([{ availability: 'NOT_AVAILABLE', value: null }]), 'NOT_AVAILABLE');
  assert.equal(describeEvidenceCollection([{ availability: 'COLLECTION_FAILED', value: null }]), 'COLLECTION_FAILED');
  const view = {
    tenantId: TENANT,
    evidence: [
      {
        id: 'evidence-home',
        tenantId: TENANT,
        connectionId: 'conn-home',
        purpose: 'aisle-self-observation',
        periodStart: PERIOD_A[0],
        periodEnd: PERIOD_A[1],
        timezone: 'Asia/Seoul',
        metricIds: ['zero', 'missing'],
        adapterKey: 'aisle-self',
        collectedAt: NOW,
        contentHash: 'hash-home',
        piiExcluded: true,
        readOnly: true,
      },
      {
        id: 'evidence-foreign',
        tenantId: FOREIGN,
        connectionId: 'conn-home',
        purpose: 'aisle-self-observation',
        periodStart: PERIOD_A[0],
        periodEnd: PERIOD_A[1],
        timezone: 'Asia/Seoul',
        metricIds: [],
        adapterKey: 'aisle-self',
        collectedAt: NOW,
        piiExcluded: true,
        readOnly: true,
      },
    ],
    metrics: [
      { id: 'zero', tenantId: TENANT, evidenceId: 'evidence-home', metric: 'userCount', value: 0, availability: 'AVAILABLE' },
      { id: 'missing', tenantId: TENANT, evidenceId: 'evidence-home', metric: 'viewsLast7d', value: null, availability: 'NOT_MEASURED' },
    ],
    requests: [],
    results: [],
  } as unknown as JuryConsoleView;
  const rows = projectConnectedServiceFlow(view, 'conn-home');
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.collectionStatus, 'AVAILABLE');
  assert.equal(rows[0]?.metrics.find((metric) => metric.metric === 'userCount')?.value, 0);
  assert.equal(rows[0]?.metrics.find((metric) => metric.metric === 'viewsLast7d')?.value, null);
  assert.equal(rows[0]?.reviewStatus, null);
});

test('connected service source reuses the access, evidence, and projection boundaries', () => {
  const source = readFileSync(new URL('./connected-service-review.ts', import.meta.url), 'utf8');
  assert.equal(source.includes('runAisleServiceAccess'), true);
  assert.equal(source.includes('buildProductEvidence'), true);
  assert.equal(source.includes('persistProductEvidence'), true);
  assert.equal(source.includes('projectEvidenceToPack'), true);
  assert.equal(source.includes('fetch('), false);
  assert.equal(source.includes('runReviewBoardPipeline'), false);
  assert.equal(source.includes("expectedDecision: 'ACCEPT'"), false);
  assert.equal(source.includes('GA4_PROPERTY_ID'), true);
  const ui = readFileSync(path.resolve(process.cwd(), 'src/app/(root)/jury/service-onboarding-ui.tsx'), 'utf8');
  assert.equal(ui.includes('Collect Evidence'), true);
  assert.equal(ui.includes('Run Review'), true);
  assert.equal(ui.includes('formatMeasuredValue'), true);
  assert.equal(ui.includes('Collecting evidence'), true);
  assert.equal(ui.includes('Review running'), true);
  for (const label of ['Run Agent', 'Run Change Gate', 'Run Re-review', 'Auto Fix', 'Run Loop']) {
    assert.equal(ui.includes(label), false, label);
  }
  const actions = readFileSync(path.resolve(process.cwd(), 'src/app/(root)/jury/actions.ts'), 'utf8');
  const fn = actions.slice(actions.indexOf('export async function collectConnectedServiceEvidence'));
  assert.equal(fn.includes('getJuryActor()'), true);
  assert.equal(fn.includes('clientTenantId: null'), true);
  assert.equal(fn.includes('tenantReviewCore'), true);
  for (const token of ['buildEvidencePackFromDb', 'attachGa4Evidence', 'runAisleAdapter', 'runProductReview', 'evidence-builder', 'aisle-adapter', 'GA4_PROPERTY_ID']) {
    assert.equal(actions.includes(token), false, token);
  }
  for (const key of ['tenantId', 'connectionId', 'scopeId', 'decision']) {
    assert.equal(fn.includes(`formData.get('${key}')`), false, key);
  }
  assert.equal(existsSync(path.resolve(process.cwd(), 'src/app/(root)/jury/services/[connectionId]/page.tsx')), true);
});

test('owner collects mock evidence and runs the existing Jury Core once', { timeout: 540_000 }, async () => {
  loadEnv();
  const { prisma } = await import('@/lib/prisma');
  const liveBefore = await liveSnapshot(prisma);
  let pipelines = 0;
  const core: ProductReviewCore = async (args) => {
    if (args.evidence.analysisPeriod?.start === PERIOD_D[0]) throw new Error('core failed');
    pipelines += 1;
    const { callFrozenReviewPipeline } = await import('./review-core');
    const { createMockReviewBoardLlm } = await import('../ai-review-board/mock-llm');
    return callFrozenReviewPipeline({ ...args, llm: createMockReviewBoardLlm() });
  };
  try {
    await removeFixture(prisma);
    await seed(prisma);

    const memberCollect = await runConnectedServiceEvidenceCollection(collectCommand(memberActor, 'missing', PERIOD_A));
    assert.equal(memberCollect.ok, false);
    if (!memberCollect.ok) assert.equal(memberCollect.reason, 'FORBIDDEN');
    const auditorCollect = await runConnectedServiceEvidenceCollection(collectCommand(auditorActor, 'missing', PERIOD_A));
    assert.equal(auditorCollect.ok, false);
    if (!auditorCollect.ok) assert.equal(auditorCollect.reason, 'FORBIDDEN');

    let reads = 0;
    const pending = await runConnectedServiceEvidenceCollection(collectCommand(ownerActor, 'phase73-pending', PERIOD_A), {
      evidenceDb: observationDb(() => {
        reads += 1;
      }),
    });
    assert.equal(pending.ok, false);
    if (!pending.ok) assert.equal(pending.reason, 'CONNECTION_NOT_APPROVED');
    assert.equal(reads, 0);
    const unapproved = await runConnectedServiceEvidenceCollection(collectCommand(ownerActor, 'phase73-unapproved', PERIOD_A));
    assert.equal(unapproved.ok, false);
    if (!unapproved.ok) assert.equal(unapproved.reason, 'SCOPE_NOT_APPROVED');
    assert.equal(await prisma.juryEvidence.count({ where: { connectionId: { in: ['phase73-pending', 'phase73-unapproved'] } } }), 0);

    const shop = await connect(ownerActor, 'phase73-shop');
    const foreignCollect = await runConnectedServiceEvidenceCollection(collectCommand(foreignActor, shop, PERIOD_A));
    assert.equal(foreignCollect.ok, false);
    if (!foreignCollect.ok) assert.equal(foreignCollect.reason, 'NOT_FOUND');
    const cross = await runConnectedServiceEvidenceCollection(collectCommand(ownerActor, 'phase73-foreign-conn', PERIOD_A));
    assert.equal(cross.ok, false);
    if (!cross.ok) assert.equal(cross.reason, 'NOT_FOUND');

    const closed = await runConnectedServiceEvidenceCollection(
      { ...collectCommand(ownerActor, shop, PERIOD_A), timezone: 'UTC' },
      {
        evidenceDb: observationDb(() => {
          reads += 1;
        }),
      },
    );
    assert.equal(closed.ok, false);
    if (!closed.ok) assert.equal(closed.reason, 'TIMEZONE_UNSUPPORTED');
    assert.equal(reads, 0);

    const [left, right] = await Promise.all([
      runConnectedServiceEvidenceCollection(collectCommand(ownerActor, shop, PERIOD_A)),
      runConnectedServiceEvidenceCollection(collectCommand(ownerActor, shop, PERIOD_A)),
    ]);
    const created = [left, right].filter((row) => row.ok && row.created);
    assert.equal(created.length, 1);
    assert.equal(await prisma.juryEvidence.count({ where: { tenantId: TENANT, connectionId: shop, periodStart: PERIOD_A[0] } }), 1);
    const collected = created[0];
    assert.ok(collected && collected.ok);
    if (!collected || !collected.ok) return;
    const replay = await runConnectedServiceEvidenceCollection(collectCommand(ownerActor, shop, PERIOD_A));
    assert.equal(replay.ok, true);
    if (replay.ok) {
      assert.equal(replay.created, false);
      assert.equal(replay.evidenceId, collected.evidenceId);
    }
    const metrics = await prisma.juryNormalizedMetric.findMany({ where: { tenantId: TENANT, evidenceId: collected.evidenceId } });
    const zero = metrics.find((metric) => metric.metric === 'userCount');
    const missing = metrics.find((metric) => metric.availability === 'NOT_MEASURED');
    assert.equal(zero?.availability, 'AVAILABLE');
    assert.equal(zero?.value, 0);
    assert.ok(missing);
    assert.equal(missing?.value, null);
    const evidence = await prisma.juryEvidence.findFirst({ where: { id: collected.evidenceId, tenantId: TENANT } });
    assert.equal(evidence?.readOnly, true);
    assert.equal(evidence?.piiExcluded, true);
    assert.equal(evidence?.adapterKey, 'aisle-self');
    assert.equal(evidence?.timezone, 'Asia/Seoul');
    assert.ok(evidence?.contentHash);

    const auditorReview = await runConnectedServiceReview({
      actor: auditorActor,
      connectionId: shop,
      evidenceId: collected.evidenceId,
      clientTenantId: FOREIGN,
      core,
    });
    assert.equal(auditorReview.ok, false);
    if (!auditorReview.ok) assert.equal(auditorReview.reason, 'FORBIDDEN');
    const reviewed = await runConnectedServiceReview({
      actor: memberActor,
      connectionId: shop,
      evidenceId: collected.evidenceId,
      clientTenantId: FOREIGN,
      core,
    });
    assert.equal(reviewed.ok, true);
    if (!reviewed.ok) return;
    assert.equal(reviewed.reused, false);
    assert.equal(pipelines, 1);
    assert.ok(['ACCEPT', 'VERIFY', 'REWORD'].includes(reviewed.decision));
    const storedResult = await prisma.juryReviewResult.findFirst({
      where: { id: reviewed.resultId, tenantId: TENANT },
    });
    assert.equal(storedResult?.expectedDecision, reviewed.decision);
    assert.equal(storedResult?.reviewRequestId, reviewed.requestId);
    const request = await prisma.juryReviewRequest.findFirst({ where: { id: reviewed.requestId, tenantId: TENANT } });
    assert.equal(request?.status, 'COMPLETED');
    assert.equal(request?.evidenceId, collected.evidenceId);
    assert.equal(request?.mode, 'AISLE_SELF');
    assert.equal(request?.reviewType, 'FULL_REVIEW');
    const again = await runConnectedServiceReview({
      actor: ownerActor,
      connectionId: shop,
      evidenceId: collected.evidenceId,
      core,
    });
    assert.equal(again.ok, true);
    if (again.ok) assert.equal(again.reused, true);
    assert.equal(pipelines, 1);
    assert.equal(await prisma.juryReviewResult.count({ where: { tenantId: TENANT, reviewRequestId: reviewed.requestId } }), 1);

    const second = await runConnectedServiceEvidenceCollection(collectCommand(ownerActor, shop, PERIOD_B));
    assert.equal(second.ok, true);
    if (!second.ok) return;
    const [firstReview, secondReview] = await Promise.all([
      runConnectedServiceReview({ actor: ownerActor, connectionId: shop, evidenceId: second.evidenceId, core }),
      runConnectedServiceReview({ actor: memberActor, connectionId: shop, evidenceId: second.evidenceId, core }),
    ]);
    assert.equal([firstReview, secondReview].some((row) => row.ok), true);
    assert.equal(pipelines, 2);
    assert.equal(await prisma.juryReviewRequest.count({ where: { tenantId: TENANT, evidenceId: second.evidenceId } }), 1);
    assert.equal(await prisma.juryReviewResult.count({ where: { tenantId: TENANT, request: { evidenceId: second.evidenceId } } }), 1);
    const replayReview = await runConnectedServiceReview({
      actor: ownerActor,
      connectionId: shop,
      evidenceId: second.evidenceId,
      core,
    });
    assert.equal(replayReview.ok, true);
    if (replayReview.ok) assert.equal(replayReview.reused, true);
    assert.equal(pipelines, 2);

    const projected = await runConnectedServiceEvidenceCollection(collectCommand(ownerActor, shop, PERIOD_C));
    assert.equal(projected.ok, true);
    if (!projected.ok) return;
    const tamper = await prisma.juryNormalizedMetric.findFirst({
      where: { evidenceId: projected.evidenceId, availability: 'AVAILABLE' },
    });
    assert.ok(tamper);
    await prisma.juryNormalizedMetric.update({ where: { id: tamper?.id ?? '' }, data: { value: null } });
    const projection = await runConnectedServiceReview({
      actor: ownerActor,
      connectionId: shop,
      evidenceId: projected.evidenceId,
      core,
    });
    assert.equal(projection.ok, false);
    if (!projection.ok) assert.equal(projection.reason, 'PROJECTION_FAILED');
    assert.equal(pipelines, 2);
    assert.equal(await prisma.juryReviewResult.count({ where: { request: { evidenceId: projected.evidenceId } } }), 0);

    const failingCore = await runConnectedServiceEvidenceCollection(collectCommand(ownerActor, shop, PERIOD_D));
    assert.equal(failingCore.ok, true);
    if (!failingCore.ok) return;
    const coreFailed = await runConnectedServiceReview({
      actor: ownerActor,
      connectionId: shop,
      evidenceId: failingCore.evidenceId,
      core,
    });
    assert.equal(coreFailed.ok, false);
    if (!coreFailed.ok) assert.equal(coreFailed.reason, 'REVIEW_NOT_EXECUTED');
    assert.equal(pipelines, 2);
    const failedRequest = await prisma.juryReviewRequest.findFirst({ where: { tenantId: TENANT, evidenceId: failingCore.evidenceId } });
    assert.equal(failedRequest?.status, 'FAILED');
    assert.equal(await prisma.juryReviewResult.count({ where: { reviewRequestId: failedRequest?.id ?? 'missing' } }), 0);

    const reader = await connect(ownerActor, 'phase73-reader');
    const readerFailed = await runConnectedServiceEvidenceCollection(collectCommand(ownerActor, reader, PERIOD_A), {
      evidenceDb: failingDb(),
    });
    assert.equal(readerFailed.ok, false);
    if (!readerFailed.ok) assert.equal(readerFailed.reason, 'COLLECTION_FAILED');
    assert.equal(await prisma.juryEvidence.count({ where: { connectionId: reader } }), 0);
    const readerReview = await runConnectedServiceReview({
      actor: ownerActor,
      connectionId: reader,
      evidenceId: collected.evidenceId,
      core,
    });
    assert.equal(readerReview.ok, false);
    if (!readerReview.ok) assert.equal(readerReview.reason, 'NOT_FOUND');
    assert.equal(pipelines, 2);

    const persistTarget = await connect(ownerActor, 'phase73-persist');
    const persistFailed = await runConnectedServiceEvidenceCollection(collectCommand(ownerActor, persistTarget, PERIOD_A), {
      persist: async () => ({ ok: false, reason: 'HASH_REQUIRED' }),
    });
    assert.equal(persistFailed.ok, false);
    if (!persistFailed.ok) assert.equal(persistFailed.reason, 'PERSISTENCE_FAILED');
    assert.equal(await prisma.juryEvidence.count({ where: { connectionId: persistTarget } }), 0);
    assert.equal(await prisma.juryReviewRequest.count({ where: { connectionId: persistTarget } }), 0);

    const audits = await prisma.juryAuditEvent.findMany({ where: { tenantId: TENANT } });
    const actions = audits.map((row) => row.action);
    assert.equal(actions.filter((action) => action === 'EVIDENCE_COLLECTION_STARTED').length, 4);
    assert.equal(actions.filter((action) => action === 'EVIDENCE_RECORDED').length, 4);
    assert.equal(actions.filter((action) => action === 'REVIEW_STARTED').length, 3);
    assert.equal(actions.filter((action) => action === 'REVIEW_COMPLETED').length, 2);
    const storedRows = await prisma.juryEvidence.findMany({ where: { tenantId: TENANT } });
    const storedMetrics = await prisma.juryNormalizedMetric.findMany({ where: { tenantId: TENANT } });
    const storedRequests = await prisma.juryReviewRequest.findMany({ where: { tenantId: TENANT } });
    const storedResults = await prisma.juryReviewResult.findMany({ where: { tenantId: TENANT } });
    const secretText = JSON.stringify({ audits, storedRows, storedMetrics, storedRequests, storedResults });
    assert.equal(secretText.includes(REF), false);
    assert.equal(secretText.includes('credentialRef'), false);
    assert.equal(secretText.toLowerCase().includes('password'), false);

    const where = { tenantId: { in: [TENANT, FOREIGN] } };
    assert.equal(await prisma.juryAgentExecution.count({ where }), 0);
    assert.equal(await prisma.juryChangeGateResult.count({ where }), 0);
    assert.equal(await prisma.juryReReviewResult.count({ where }), 0);
    assert.equal(await prisma.juryAutoLoopActivation.count({ where }), 0);
    assert.equal(await prisma.juryImprovementTask.count({ where }), 0);
    assert.equal(await prisma.juryDecisionCycle.count({ where }), 0);
    assert.deepEqual(await liveSnapshot(prisma), liveBefore);
  } finally {
    await removeFixture(prisma);
  }
});

test('failed review without a result retries once and preserves finished results', { timeout: 180_000 }, async () => {
  loadEnv();
  const { prisma } = await import('@/lib/prisma');
  const retryTenant = 'phase73-retry';
  const retryForeign = 'phase73-retry-foreign';
  const retryOwner = membership('phase73-retry-owner-m', retryTenant, 'phase73-retry-owner', 'OWNER');
  const retryMember = membership('phase73-retry-member-m', retryTenant, 'phase73-retry-member', 'DEVELOPER');
  const retryAuditor = membership('phase73-retry-auditor-m', retryTenant, 'phase73-retry-auditor', 'VIEWER');
  const retryForeignOwner = membership('phase73-retry-foreign-m', retryForeign, 'phase73-retry-foreign', 'OWNER');
  const retryOwnerActor = actor(retryOwner);
  const retryMemberActor = actor(retryMember);
  const retryAuditorActor = actor(retryAuditor);
  const retryForeignActor = actor(retryForeignOwner);
  const surface: JuryFinalSurface = {
    statusSummary: 'measured',
    topProblems: [],
    expectedUserEffect: '',
    risk: '',
    dimensionEvidence: [],
    supportedClaims: [],
    partiallySupportedClaims: [],
    hypotheses: [],
  };
  const reading = {
    boardRunId: 'run-phase73-retry',
    evidenceStrength: 'moderate',
    claimStrength: 'weak',
    conflictDetected: false,
    overclaimDetected: false,
    revisionRequired: false,
    expectedDecision: 'VERIFY',
    finalSurface: surface,
    completedAt: NOW,
  };
  let calls = 0;
  let failOnce = true;
  let pauseNext = false;
  let releaseCore: (() => void) | null = null;
  let markCoreEntered: (() => void) | null = null;
  const coreEntered = new Promise<void>((resolve) => {
    markCoreEntered = resolve;
  });
  const core: ProductReviewCore = async () => {
    calls += 1;
    if (failOnce) {
      failOnce = false;
      throw new Error('disk failed');
    }
    if (pauseNext) {
      pauseNext = false;
      markCoreEntered?.();
      await new Promise<void>((resolve) => {
        releaseCore = resolve;
      });
    }
    return reading;
  };
  try {
    await removeRetryFixture(prisma, retryTenant, retryForeign);
    for (const row of [retryOwner, retryMember, retryAuditor, retryForeignOwner]) {
      await prisma.user.create({ data: { id: row.userId, username: row.userId, email: `${row.userId}@example.invalid` } });
    }
    await prisma.juryTenant.create({ data: { id: retryTenant, name: retryTenant } });
    await prisma.juryTenant.create({ data: { id: retryForeign, name: retryForeign } });
    for (const row of [retryOwner, retryMember, retryAuditor, retryForeignOwner]) {
      await prisma.juryMembership.create({
        data: { id: row.id, tenantId: row.tenantId, userId: row.userId, role: row.role, createdAt: new Date(NOW) },
      });
    }
    const shop = await connect(retryOwnerActor, 'phase73-retry-shop');
    const collected = await runConnectedServiceEvidenceCollection(collectCommand(retryOwnerActor, shop, PERIOD_A));
    assert.equal(collected.ok, true);
    if (!collected.ok) return;
    const failed = await runConnectedServiceReview({
      actor: retryOwnerActor,
      connectionId: shop,
      evidenceId: collected.evidenceId,
      clientTenantId: retryForeign,
      core,
    });
    assert.equal(failed.ok, false);
    if (!failed.ok) assert.equal(failed.reason, 'REVIEW_NOT_EXECUTED');
    assert.equal(calls, 1);
    const failedRequest = await prisma.juryReviewRequest.findFirst({
      where: { tenantId: retryTenant, evidenceId: collected.evidenceId },
    });
    assert.equal(failedRequest?.status, 'FAILED');
    assert.equal(await prisma.juryReviewResult.count({ where: { reviewRequestId: failedRequest?.id ?? 'missing' } }), 0);
    const startedBefore = await prisma.juryAuditEvent.count({
      where: { tenantId: retryTenant, action: 'REVIEW_STARTED', reviewId: failedRequest?.id ?? 'missing' },
    });
    assert.equal(startedBefore, 1);

    const auditorRetry = await runConnectedServiceReview({
      actor: retryAuditorActor,
      connectionId: shop,
      evidenceId: collected.evidenceId,
      core,
    });
    assert.equal(auditorRetry.ok, false);
    if (!auditorRetry.ok) assert.equal(auditorRetry.reason, 'FORBIDDEN');
    const foreignRetry = await runConnectedServiceReview({
      actor: retryForeignActor,
      connectionId: shop,
      evidenceId: collected.evidenceId,
      core,
    });
    assert.equal(foreignRetry.ok, false);
    if (!foreignRetry.ok) assert.equal(foreignRetry.reason, 'NOT_FOUND');
    assert.equal(calls, 1);
    assert.equal(
      (await prisma.juryReviewRequest.findFirst({ where: { id: failedRequest?.id ?? 'missing' } }))?.status,
      'FAILED',
    );

    pauseNext = true;
    const firstRetry = runConnectedServiceReview({
      actor: retryMemberActor,
      connectionId: shop,
      evidenceId: collected.evidenceId,
      core,
    });
    const secondRetry = runConnectedServiceReview({
      actor: retryOwnerActor,
      connectionId: shop,
      evidenceId: collected.evidenceId,
      core,
    });
    await coreEntered;
    const blockedWhileRunning = await runConnectedServiceReview({
      actor: retryOwnerActor,
      connectionId: shop,
      evidenceId: collected.evidenceId,
      core,
    });
    releaseCore?.();
    const [left, right] = await Promise.all([firstRetry, secondRetry]);
    assert.equal(blockedWhileRunning.ok, false);
    if (!blockedWhileRunning.ok) assert.equal(blockedWhileRunning.reason, 'REVIEW_ALREADY_EXISTS');
    const succeeded = [left, right].filter((row) => row.ok);
    assert.equal(succeeded.length >= 1, true);
    assert.equal(calls, 2);
    assert.equal(await prisma.juryReviewRequest.count({ where: { tenantId: retryTenant, evidenceId: collected.evidenceId } }), 1);
    assert.equal(await prisma.juryReviewResult.count({ where: { tenantId: retryTenant, reviewRequestId: failedRequest?.id ?? 'missing' } }), 1);
    const completed = await prisma.juryReviewRequest.findFirst({ where: { id: failedRequest?.id ?? 'missing' } });
    assert.equal(completed?.status, 'COMPLETED');
    const replay = await runConnectedServiceReview({
      actor: retryOwnerActor,
      connectionId: shop,
      evidenceId: collected.evidenceId,
      core,
    });
    assert.equal(replay.ok, true);
    if (replay.ok) assert.equal(replay.reused, true);
    assert.equal(calls, 2);

    const preserved = await runConnectedServiceEvidenceCollection(collectCommand(retryOwnerActor, shop, PERIOD_B));
    assert.equal(preserved.ok, true);
    if (!preserved.ok) return;
    const preservedId = createHash('sha256')
      .update([retryTenant, preserved.evidenceId, 'FULL_REVIEW', ''].join('\n'))
      .digest('hex');
    await prisma.juryReviewRequest.create({
      data: {
        id: preservedId,
        tenantId: retryTenant,
        connectionId: shop,
        evidenceId: preserved.evidenceId,
        reviewType: 'FULL_REVIEW',
        mode: 'AISLE_SELF',
        status: 'FAILED',
        coreRootDir: JURY_PRODUCT_DATA_ROOT,
        requestedByUserId: retryOwner.userId,
      },
    });
    await prisma.juryReviewResult.create({
      data: {
        id: `${preservedId}-result`,
        tenantId: retryTenant,
        reviewRequestId: preservedId,
        boardRunId: 'run-preserved',
        evidenceStrength: 'moderate',
        claimStrength: 'weak',
        conflictDetected: false,
        overclaimDetected: false,
        revisionRequired: false,
        expectedDecision: 'REWORD',
        finalSurface: surface,
        contractVersion: JURY_CORE_CONTRACT_VERSION,
        completedAt: new Date(NOW),
      },
    });
    const kept = await runConnectedServiceReview({
      actor: retryOwnerActor,
      connectionId: shop,
      evidenceId: preserved.evidenceId,
      core,
    });
    assert.equal(kept.ok, true);
    if (kept.ok) {
      assert.equal(kept.reused, true);
      assert.equal(kept.decision, 'REWORD');
      assert.equal(kept.resultId, `${preservedId}-result`);
    }
    assert.equal(calls, 2);
    assert.equal(
      (await prisma.juryReviewRequest.findFirst({ where: { id: preservedId } }))?.status,
      'FAILED',
    );

    const audits = await prisma.juryAuditEvent.findMany({ where: { tenantId: retryTenant } });
    assert.equal(audits.some((row) => row.action === 'REVIEW_COMPLETED'), true);
    assert.equal(JSON.stringify(audits).includes('disk failed'), false);
    assert.equal(JSON.stringify(audits).toLowerCase().includes('password'), false);
  } finally {
    await removeRetryFixture(prisma, retryTenant, retryForeign);
  }
});

async function removeRetryFixture(
  prisma: Awaited<typeof import('@/lib/prisma')>['prisma'],
  tenantId: string,
  foreignTenantId: string,
): Promise<void> {
  const where = { tenantId: { in: [tenantId, foreignTenantId] } };
  await prisma.juryReviewResult.deleteMany({ where });
  await prisma.juryReviewRequest.deleteMany({ where });
  await prisma.juryNormalizedMetric.deleteMany({ where });
  await prisma.juryEvidence.deleteMany({ where });
  await prisma.juryAuditEvent.deleteMany({ where });
  await prisma.juryDiscoveryResult.deleteMany({ where });
  await prisma.juryAccessScope.deleteMany({ where });
  await prisma.juryServiceConnection.deleteMany({ where });
  await prisma.juryMembership.deleteMany({ where });
  await prisma.juryTenant.deleteMany({ where: { id: { in: [tenantId, foreignTenantId] } } });
  await prisma.user.deleteMany({
    where: {
      username: {
        in: ['phase73-retry-owner', 'phase73-retry-member', 'phase73-retry-auditor', 'phase73-retry-foreign'],
      },
    },
  });
}

function collectCommand(
  actor: Extract<JuryActor, { ok: true }>,
  connectionId: string,
  period: readonly [string, string],
): CollectionCommand {
  return {
    actor,
    connectionId,
    purpose: 'aisle-self-observation',
    periodStart: period[0],
    periodEnd: period[1],
    timezone: 'Asia/Seoul',
    clientTenantId: FOREIGN,
  };
}

async function connect(actor: Extract<JuryActor, { ok: true }>, serviceKey: string): Promise<string> {
  const created = await persistServiceOnboarding({
    actor,
    serviceKey,
    displayName: serviceKey,
    accessMethod: 'FILE_UPLOAD',
    credentialRef: REF,
    adapterKey: 'mock',
    clientTenantId: FOREIGN,
    now: NOW,
  });
  if (!created.ok) throw new Error(created.reason);
  const discovery = await persistOnboardingDiscovery({
    actor,
    connectionId: created.connectionId,
    clientTenantId: FOREIGN,
    now: NOW,
  });
  if (!discovery.ok) throw new Error(discovery.reason);
  const approved = await persistOnboardingScopeDecision({
    actor,
    scopeId: discovery.scopeId,
    decision: 'APPROVE',
    clientTenantId: FOREIGN,
    now: NOW,
  });
  if (!approved.ok || !approved.activated) throw new Error('connection did not reach CONNECTED');
  return created.connectionId;
}

function observationDb(onRead?: () => void): EvidenceDb {
  return {
    user: {
      count: async (args?: { where?: unknown }) => {
        onRead?.();
        return args?.where ? null : 0;
      },
    },
    post: {
      count: async () => 0,
      aggregate: async () => ({ _sum: { views: 0 } }),
      groupBy: async () => [],
      findMany: async () => [],
    },
    comment: { count: async () => 0, findMany: async () => [] },
    postLike: { findMany: async () => [] },
    bookmark: { findMany: async () => [] },
    gameScore: { findMany: async () => [] },
    postViewDaily: { aggregate: async () => ({ _sum: { count: null } }) },
  } as unknown as EvidenceDb;
}

function failingDb(): EvidenceDb {
  const db = observationDb();
  db.user.count = (async () => {
    throw new Error('reader failed');
  }) as unknown as EvidenceDb['user']['count'];
  return db;
}

function actor(row: JuryMembership): Extract<JuryActor, { ok: true }> {
  return { ok: true, userId: row.userId, tenantId: row.tenantId, role: row.role, membershipId: row.id };
}

function membership(id: string, tenantId: string, userId: string, role: JuryMembership['role']): JuryMembership {
  return { id, tenantId, userId, role, createdAt: NOW };
}

function loadEnv(): void {
  for (const [file, override] of [['.env', false], ['.env.local', true]] as const) {
    let text = '';
    try {
      text = readFileSync(path.resolve(process.cwd(), file), 'utf8');
    } catch {
      continue;
    }
    for (const line of text.split(/\r?\n/)) {
      const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (!match) continue;
      const [, key, raw] = match;
      if (!key || (process.env[key] && !override)) continue;
      process.env[key] = raw.replace(/^"|"$/g, '');
    }
  }
}

async function seed(prisma: Awaited<typeof import('@/lib/prisma')>['prisma']): Promise<void> {
  for (const row of [owner, member, auditor, foreign]) {
    await prisma.user.create({ data: { id: row.userId, username: row.userId, email: `${row.userId}@example.invalid` } });
  }
  await prisma.juryTenant.create({ data: { id: TENANT, name: TENANT } });
  await prisma.juryTenant.create({ data: { id: FOREIGN, name: FOREIGN } });
  for (const row of [owner, member, auditor, foreign]) {
    await prisma.juryMembership.create({
      data: { id: row.id, tenantId: row.tenantId, userId: row.userId, role: row.role, createdAt: new Date(NOW) },
    });
  }
  await prisma.juryServiceConnection.create({
    data: {
      id: 'phase73-pending',
      tenantId: TENANT,
      serviceKey: 'phase73-pending',
      displayName: 'Pending',
      accessMethod: 'FILE_UPLOAD',
      status: 'DISCOVERY_PENDING',
      credentialRef: REF,
      createdByUserId: owner.userId,
      createdAt: new Date(NOW),
      updatedAt: new Date(NOW),
    },
  });
  await prisma.juryAccessScope.create({
    data: {
      id: 'phase73-pending-scope',
      tenantId: TENANT,
      connectionId: 'phase73-pending',
      status: 'APPROVED',
      grants: [{ resource: 'metric:phase73-pending.routes', mode: 'READ' }],
    },
  });
  await prisma.juryServiceConnection.create({
    data: {
      id: 'phase73-unapproved',
      tenantId: TENANT,
      serviceKey: 'phase73-unapproved',
      displayName: 'Unapproved',
      accessMethod: 'FILE_UPLOAD',
      status: 'CONNECTED',
      credentialRef: REF,
      createdByUserId: owner.userId,
      createdAt: new Date(NOW),
      updatedAt: new Date(NOW),
    },
  });
  await prisma.juryAccessScope.create({
    data: {
      id: 'phase73-unapproved-scope',
      tenantId: TENANT,
      connectionId: 'phase73-unapproved',
      status: 'PROPOSED',
      grants: [{ resource: 'metric:phase73-unapproved.routes', mode: 'READ' }],
    },
  });
  await prisma.juryServiceConnection.create({
    data: {
      id: 'phase73-foreign-conn',
      tenantId: FOREIGN,
      serviceKey: 'phase73-foreign',
      displayName: 'Foreign',
      accessMethod: 'FILE_UPLOAD',
      status: 'CONNECTED',
      credentialRef: REF,
      createdByUserId: foreign.userId,
      createdAt: new Date(NOW),
      updatedAt: new Date(NOW),
    },
  });
  await prisma.juryAccessScope.create({
    data: {
      id: 'phase73-foreign-scope',
      tenantId: FOREIGN,
      connectionId: 'phase73-foreign-conn',
      status: 'APPROVED',
      grants: [{ resource: 'metric:phase73-foreign.routes', mode: 'READ' }],
    },
  });
}

async function liveSnapshot(prisma: Awaited<typeof import('@/lib/prisma')>['prisma']) {
  const review = await prisma.juryReviewResult.findUnique({
    where: { id: LIVE_REVIEW },
    select: { expectedDecision: true, tenantId: true, completedAt: true },
  });
  const cycle = await prisma.juryDecisionCycle.findUnique({
    where: { id: LIVE_CYCLE },
    select: { status: true, iteration: true, updatedAt: true },
  });
  const tenantId = review?.tenantId ?? 'missing';
  return {
    decision: review?.expectedDecision ?? null,
    reviewCompletedAt: review?.completedAt.toISOString() ?? null,
    status: cycle?.status ?? null,
    iteration: cycle?.iteration ?? null,
    cycleUpdatedAt: cycle?.updatedAt.toISOString() ?? null,
    activations: await prisma.juryAutoLoopActivation.count({ where: { tenantId } }),
    executions: await prisma.juryAgentExecution.count({ where: { tenantId } }),
    gates: await prisma.juryChangeGateResult.count({ where: { tenantId } }),
    reviews: await prisma.juryReviewResult.count({ where: { tenantId } }),
    tasks: await prisma.juryImprovementTask.count({ where: { tenantId } }),
  };
}

async function removeFixture(prisma: Awaited<typeof import('@/lib/prisma')>['prisma']): Promise<void> {
  const where = { tenantId: { in: [TENANT, FOREIGN] } };
  await prisma.juryReviewResult.deleteMany({ where });
  await prisma.juryReviewRequest.deleteMany({ where });
  await prisma.juryNormalizedMetric.deleteMany({ where });
  await prisma.juryEvidence.deleteMany({ where });
  await prisma.juryAuditEvent.deleteMany({ where });
  await prisma.juryDiscoveryResult.deleteMany({ where });
  await prisma.juryAccessScope.deleteMany({ where });
  await prisma.juryServiceConnection.deleteMany({ where });
  await prisma.juryMembership.deleteMany({ where });
  await prisma.juryTenant.deleteMany({ where: { id: { in: [TENANT, FOREIGN] } } });
  await prisma.user.deleteMany({
    where: { username: { in: ['phase73-owner', 'phase73-member', 'phase73-auditor', 'phase73-foreign'] } },
  });
}
