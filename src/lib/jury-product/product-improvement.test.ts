/**
 * A completed product ReviewResult opens one improvement task through the existing human-decision boundary.
 * Run: node --import tsx --test src/lib/jury-product/product-improvement.test.ts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import type { JuryActor } from './access';
import {
  runConnectedServiceEvidenceCollection,
  runConnectedServiceReview,
  type CollectionCommand,
} from './connected-service-review';
import type { JuryConsoleView } from './console-view';
import { connectProductReviewImprovement, projectImprovementRows } from './product-improvement';
import type { ProductReviewCore } from './review-boundary';
import type { JuryMembership } from './records';
import {
  persistOnboardingDiscovery,
  persistOnboardingScopeDecision,
  persistServiceOnboarding,
} from './service-onboarding';

const TENANT = 'phase74-improve';
const FOREIGN = 'phase74-improve-foreign';
const NOW = '2026-10-05T04:00:00.000Z';
const LIVE_REVIEW = '3707202563ecae9b38f324a4eefd9243a14bc69420ed6cdda16c4c5794f62e0d';
const LIVE_CYCLE = '14308b4c999ccbe8ca54b7f31da5385385d4073c49bbf2955582a6bb96afb01e';
const REF = 'mock-connection-001';
const PERIOD = ['2026-09-01', '2026-09-07'] as const;

const owner = membership('phase74-owner-m', TENANT, 'phase74-owner', 'OWNER');
const member = membership('phase74-member-m', TENANT, 'phase74-member', 'DEVELOPER');
const auditor = membership('phase74-auditor-m', TENANT, 'phase74-auditor', 'VIEWER');
const foreign = membership('phase74-foreign-m', FOREIGN, 'phase74-foreign', 'OWNER');
const ownerActor = actor(owner);
const memberActor = actor(member);
const auditorActor = actor(auditor);
const foreignActor = actor(foreign);

test('improvement rows stay inside the tenant and name the source service', () => {
  const view = {
    tenantId: TENANT,
    connections: [
      { id: 'conn', tenantId: TENANT, displayName: 'Shop' },
      { id: 'other', tenantId: FOREIGN, displayName: 'Foreign' },
    ],
    evidence: [{ id: 'evidence', tenantId: TENANT, connectionId: 'conn' }],
    requests: [{ id: 'request', tenantId: TENANT, evidenceId: 'evidence', connectionId: 'conn' }],
    results: [{ id: 'review', tenantId: TENANT, reviewRequestId: 'request' }],
    tasks: [
      {
        id: 'task',
        tenantId: TENANT,
        reviewResultId: 'review',
        status: 'OPEN',
        taskType: 'VERIFICATION',
        diagnosis: 'summary',
        acceptanceCriteria: ['check the measurement'],
      },
      { id: 'foreign-task', tenantId: FOREIGN, reviewResultId: 'review', status: 'OPEN', diagnosis: 'no', acceptanceCriteria: [] },
    ],
  } as unknown as JuryConsoleView;
  const rows = projectImprovementRows(view);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.sourceService, 'Shop');
  assert.equal(rows[0]?.sourceReviewId, 'review');
  assert.equal(rows[0]?.evidenceId, 'evidence');
  assert.equal(rows[0]?.connectionId, 'conn');
});

test('product improvement reuses the human-decision boundary and does not start an agent', () => {
  const source = readFileSync(new URL('./product-improvement.ts', import.meta.url), 'utf8');
  assert.equal(source.includes('noteHumanNextAction'), true);
  assert.equal(source.includes('persistHumanImprovement'), true);
  assert.equal(source.includes("action: 'improvement.write'"), true);
  assert.equal(source.includes('fetch('), false);
  assert.equal(source.includes('runReviewBoardPipeline'), false);
  for (const token of ['evaluateChangeGate', 'fakeCursorAdapter', 'FULL_AUTO', 'runHumanAgentExecution']) {
    assert.equal(source.includes(token), false, token);
  }
  const bridge = readFileSync(new URL('./human-improvement-bridge.ts', import.meta.url), 'utf8');
  assert.equal(bridge.includes("juryDecision === 'ACCEPT'"), true);
  assert.equal(bridge.includes('REVIEW_NOT_COMPLETED'), true);
  assert.equal(bridge.includes('findUnique'), false);
  const ui = readFileSync(path.resolve(process.cwd(), 'src/app/(root)/jury/ui.tsx'), 'utf8');
  assert.equal(ui.includes('source service'), true);
  assert.equal(ui.includes('Create Improvement Task'), true);
  const body = ui.slice(ui.indexOf('export function ImprovementsBody'), ui.indexOf('export function ImprovementTraceBody')).replaceAll('Run Agent (Mock)', '').replaceAll('Run Change Gate', '').replaceAll('Run Re-review', '');
  for (const label of ['Run Agent', 'Run Change Gate', 'Run Re-review', 'Auto Fix', 'Run Loop']) {
    assert.equal(body.includes(label), false, label);
  }
});

test('completed product review results open one improvement task', { timeout: 540_000 }, async () => {
  loadEnv();
  const { prisma } = await import('@/lib/prisma');
  const liveBefore = await liveSnapshot(prisma);
  let pipelines = 0;
  const core: ProductReviewCore = async (args) => {
    pipelines += 1;
    const { callFrozenReviewPipeline } = await import('./review-core');
    const { createMockReviewBoardLlm } = await import('../ai-review-board/mock-llm');
    return callFrozenReviewPipeline({ ...args, llm: createMockReviewBoardLlm() });
  };
  try {
    await removeFixture(prisma);
    await seed(prisma);
    const denied = await connectProductReviewImprovement({
      userId: auditor.userId,
      memberships: [auditor],
      reviewId: 'missing',
      clientTenantId: FOREIGN,
    });
    assert.equal(denied.ok, false);
    if (!denied.ok) assert.equal(denied.reason, 'FORBIDDEN');

    const accepted = await reviewService(prisma, ownerActor, 'phase74-accept', 'phase74-accept', core);
    assert.equal(accepted.decision, 'ACCEPT');
    const acceptTask = await connectProductReviewImprovement({
      userId: owner.userId,
      memberships: [owner],
      reviewId: accepted.resultId,
      clientTenantId: FOREIGN,
    });
    assert.equal(acceptTask.ok, true);
    if (acceptTask.ok) {
      assert.equal(acceptTask.juryDecision, 'ACCEPT');
      assert.equal(acceptTask.taskId, null);
    }
    assert.equal(await prisma.juryImprovementTask.count({ where: { reviewResultId: accepted.resultId } }), 0);

    const verified = await collectedService(ownerActor, 'phase74-verify', 'phase74-verify');
    await diverge(prisma, verified.evidenceId);
    const rerun = await runConnectedServiceReview({
      actor: ownerActor,
      connectionId: verified.connectionId,
      evidenceId: verified.evidenceId,
      clientTenantId: FOREIGN,
      core,
    });
    assert.equal(rerun.ok, true);
    if (!rerun.ok) return;
    assert.equal(rerun.decision, 'VERIFY');
    const [left, right] = await Promise.all([
      connectProductReviewImprovement({ userId: owner.userId, memberships: [owner], reviewId: rerun.resultId, clientTenantId: FOREIGN }),
      connectProductReviewImprovement({ userId: member.userId, memberships: [member], reviewId: rerun.resultId, clientTenantId: FOREIGN }),
    ]);
    assert.equal([left, right].filter((row) => row.ok && row.created).length, 1);
    assert.equal(await prisma.juryImprovementTask.count({ where: { tenantId: TENANT, reviewResultId: rerun.resultId } }), 1);
    const replay = await connectProductReviewImprovement({
      userId: member.userId,
      memberships: [member],
      reviewId: rerun.resultId,
    });
    assert.equal(replay.ok, true);
    if (replay.ok) {
      assert.equal(replay.created, false);
      assert.equal(replay.taskType, 'VERIFICATION');
    }
    const auditorTask = await connectProductReviewImprovement({
      userId: auditor.userId,
      memberships: [auditor],
      reviewId: rerun.resultId,
    });
    assert.equal(auditorTask.ok, false);
    if (!auditorTask.ok) assert.equal(auditorTask.reason, 'FORBIDDEN');
    const foreignTask = await connectProductReviewImprovement({
      userId: foreign.userId,
      memberships: [foreign],
      reviewId: rerun.resultId,
      clientTenantId: TENANT,
    });
    assert.equal(foreignTask.ok, false);
    if (!foreignTask.ok) assert.equal(foreignTask.reason, 'NOT_FOUND');

    const reworded = await reviewService(prisma, ownerActor, 'phase74-reword', 'not finding value', core);
    assert.equal(reworded.decision, 'REWORD');
    const rewordTask = await connectProductReviewImprovement({
      userId: owner.userId,
      memberships: [owner],
      reviewId: reworded.resultId,
      clientTenantId: FOREIGN,
    });
    assert.equal(rewordTask.ok, true);
    if (rewordTask.ok) assert.equal(rewordTask.taskType, 'REWORD');
    assert.equal(await prisma.juryImprovementTask.count({ where: { reviewResultId: reworded.resultId } }), 1);

    const paused = await reviewService(prisma, ownerActor, 'phase74-paused', 'phase74-paused', core);
    await prisma.juryReviewRequest.update({ where: { id: paused.requestId }, data: { status: 'RUNNING' } });
    const running = await connectProductReviewImprovement({
      userId: owner.userId,
      memberships: [owner],
      reviewId: paused.resultId,
    });
    assert.equal(running.ok, false);
    if (!running.ok) assert.equal(running.reason, 'REVIEW_NOT_COMPLETED');
    await prisma.juryReviewRequest.update({ where: { id: paused.requestId }, data: { status: 'FAILED' } });
    const failed = await connectProductReviewImprovement({
      userId: owner.userId,
      memberships: [owner],
      reviewId: paused.resultId,
    });
    assert.equal(failed.ok, false);
    if (!failed.ok) assert.equal(failed.reason, 'REVIEW_NOT_COMPLETED');
    assert.equal(await prisma.juryImprovementTask.count({ where: { reviewResultId: paused.resultId } }), 0);

    const brokenCollected = await collectedService(ownerActor, 'phase74-broken', 'phase74-broken');
    await diverge(prisma, brokenCollected.evidenceId);
    const brokenReviewed = await runConnectedServiceReview({
      actor: ownerActor,
      connectionId: brokenCollected.connectionId,
      evidenceId: brokenCollected.evidenceId,
      clientTenantId: FOREIGN,
      core,
    });
    assert.equal(brokenReviewed.ok, true);
    if (!brokenReviewed.ok) return;
    assert.equal(brokenReviewed.decision, 'VERIFY');
    await prisma.juryReviewResult.update({ where: { id: brokenReviewed.resultId }, data: { finalSurface: {} } });
    const persistence = await connectProductReviewImprovement({
      userId: owner.userId,
      memberships: [owner],
      reviewId: brokenReviewed.resultId,
    });
    assert.equal(persistence.ok, false);
    assert.equal(await prisma.juryImprovementTask.count({ where: { reviewResultId: brokenReviewed.resultId } }), 0);

    const task = await prisma.juryImprovementTask.findFirst({ where: { tenantId: TENANT, reviewResultId: rerun.resultId } });
    const review = await prisma.juryReviewResult.findFirst({ where: { id: rerun.resultId, tenantId: TENANT } });
    const request = await prisma.juryReviewRequest.findFirst({ where: { id: review?.reviewRequestId, tenantId: TENANT } });
    const evidence = await prisma.juryEvidence.findFirst({ where: { id: request?.evidenceId, tenantId: TENANT } });
    const connection = await prisma.juryServiceConnection.findFirst({ where: { id: evidence?.connectionId, tenantId: TENANT } });
    assert.equal(task?.reviewResultId, review?.id);
    assert.equal(task?.evidenceId, evidence?.id);
    assert.equal(request?.connectionId, connection?.id);
    assert.equal(connection?.tenantId, TENANT);
    assert.equal(JSON.stringify(task?.provenance).includes('human-decision-improvement'), true);
    assert.equal(await prisma.juryAuditEvent.count({
      where: { tenantId: TENANT, reviewId: rerun.resultId, action: 'IMPROVEMENT_TASK_CREATED' },
    }), 1);
    assert.equal(await prisma.juryAuditEvent.count({
      where: { tenantId: TENANT, reviewId: accepted.resultId, action: 'IMPROVEMENT_TASK_CREATED' },
    }), 0);
    const secretText = JSON.stringify({
      tasks: await prisma.juryImprovementTask.findMany({ where: { tenantId: TENANT } }),
      audits: await prisma.juryAuditEvent.findMany({ where: { tenantId: TENANT, action: 'IMPROVEMENT_TASK_CREATED' } }),
    });
    assert.equal(secretText.includes(REF), false);
    assert.equal(secretText.includes('credentialRef'), false);
    assert.equal(secretText.toLowerCase().includes('password'), false);
    assert.ok(pipelines >= 4);

    const where = { tenantId: { in: [TENANT, FOREIGN] } };
    assert.equal(await prisma.juryAgentExecution.count({ where }), 0);
    assert.equal(await prisma.juryChangeGateResult.count({ where }), 0);
    assert.equal(await prisma.juryReReviewResult.count({ where }), 0);
    assert.equal(await prisma.juryAutoLoopActivation.count({ where }), 0);
    assert.equal(await prisma.juryDecisionCycle.count({ where }), 0);
    assert.deepEqual(await liveSnapshot(prisma), liveBefore);
  } finally {
    await removeFixture(prisma);
  }
});

async function reviewService(
  prisma: Awaited<typeof import('@/lib/prisma')>['prisma'],
  actor: Extract<JuryActor, { ok: true }>,
  serviceKey: string,
  displayName: string,
  core: ProductReviewCore,
) {
  const connectionId = await connect(actor, serviceKey, displayName);
  const collected = await runConnectedServiceEvidenceCollection(collectCommand(actor, connectionId));
  if (!collected.ok) throw new Error(collected.reason);
  const reviewed = await runConnectedServiceReview({
    actor,
    connectionId,
    evidenceId: collected.evidenceId,
    clientTenantId: FOREIGN,
    core,
  });
  if (!reviewed.ok) throw new Error(reviewed.reason);
  return { ...reviewed, connectionId, evidenceId: collected.evidenceId };
}

async function collectedService(
  actor: Extract<JuryActor, { ok: true }>,
  serviceKey: string,
  displayName: string,
) {
  const connectionId = await connect(actor, serviceKey, displayName);
  const collected = await runConnectedServiceEvidenceCollection(collectCommand(actor, connectionId));
  if (!collected.ok) throw new Error(collected.reason);
  return { connectionId, evidenceId: collected.evidenceId };
}

async function diverge(prisma: Awaited<typeof import('@/lib/prisma')>['prisma'], evidenceId: string) {
  const db = await prisma.juryNormalizedMetric.updateMany({
    where: { evidenceId, metric: 'newUsersLast7d' },
    data: { availability: 'AVAILABLE', value: 1 },
  });
  const ga4 = await prisma.juryNormalizedMetric.updateMany({
    where: { evidenceId, metric: 'ga4.newUsers' },
    data: { availability: 'AVAILABLE', value: 5 },
  });
  if (db.count !== 1 || ga4.count !== 1) throw new Error('conflict metrics were not stored');
}

function collectCommand(actor: Extract<JuryActor, { ok: true }>, connectionId: string): CollectionCommand {
  return {
    actor,
    connectionId,
    purpose: 'aisle-self-observation',
    periodStart: PERIOD[0],
    periodEnd: PERIOD[1],
    timezone: 'Asia/Seoul',
    clientTenantId: FOREIGN,
  };
}

async function connect(actor: Extract<JuryActor, { ok: true }>, serviceKey: string, displayName: string): Promise<string> {
  const created = await persistServiceOnboarding({
    actor,
    serviceKey,
    displayName,
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
  await prisma.juryImprovementTask.deleteMany({ where });
  await prisma.juryHumanDecision.deleteMany({ where });
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
    where: { username: { in: ['phase74-owner', 'phase74-member', 'phase74-auditor', 'phase74-foreign'] } },
  });
}
