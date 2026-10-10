/**
 * An approved product ImprovementTask opens one PENDING agent execution through the existing handoff writer.
 * Run: node --import tsx --test src/lib/jury-product/product-handoff.test.ts
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
import { handoffProductImprovement } from './product-handoff';
import type { ProductReviewCore } from './review-boundary';
import type { JuryMembership } from './records';
import {
  persistOnboardingDiscovery,
  persistOnboardingScopeDecision,
  persistServiceOnboarding,
} from './service-onboarding';

const TENANT = 'phase75-handoff';
const FOREIGN = 'phase75-handoff-foreign';
const NOW = '2026-10-05T06:00:00.000Z';
const LIVE_REVIEW = '3707202563ecae9b38f324a4eefd9243a14bc69420ed6cdda16c4c5794f62e0d';
const LIVE_CYCLE = '14308b4c999ccbe8ca54b7f31da5385385d4073c49bbf2955582a6bb96afb01e';
const REF = 'mock-connection-001';
const PERIOD = ['2026-09-01', '2026-09-07'] as const;

const owner = membership('phase75-owner-m', TENANT, 'phase75-owner', 'OWNER');
const member = membership('phase75-member-m', TENANT, 'phase75-member', 'DEVELOPER');
const auditor = membership('phase75-auditor-m', TENANT, 'phase75-auditor', 'VIEWER');
const foreign = membership('phase75-foreign-m', FOREIGN, 'phase75-foreign', 'OWNER');
const ownerActor = actor(owner);

test('improvement rows show approval and a pending agent without offering a second handoff', () => {
  const view = {
    tenantId: TENANT,
    connections: [{ id: 'conn', tenantId: TENANT, displayName: 'Shop' }],
    evidence: [{ id: 'evidence', tenantId: TENANT, connectionId: 'conn' }],
    requests: [{ id: 'request', tenantId: TENANT, evidenceId: 'evidence', connectionId: 'conn' }],
    results: [{ id: 'review', tenantId: TENANT, reviewRequestId: 'request' }],
    tasks: [{
      id: 'task',
      tenantId: TENANT,
      reviewResultId: 'review',
      status: 'OPEN',
      taskType: 'VERIFICATION',
      diagnosis: 'summary',
      acceptanceCriteria: ['check the measurement'],
    }],
    executions: [{ id: 'exec', tenantId: TENANT, taskId: 'task', status: 'PENDING' }],
  } as unknown as JuryConsoleView;
  const rows = projectImprovementRows(view, { task: 'APPROVED' });
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.approval, 'APPROVED');
  assert.equal(rows[0]?.agentStatus, 'PENDING');
  assert.equal(rows[0]?.sourceService, 'Shop');
});

test('product handoff reuses the existing writer and does not call an adapter', () => {
  const source = readFileSync(new URL('./product-handoff.ts', import.meta.url), 'utf8');
  assert.equal(source.includes('persistHumanAgentHandoff'), true);
  assert.equal(source.includes("action: 'improvement.write'"), true);
  assert.equal(source.includes('HUMAN_IMPROVEMENT_KIND'), true);
  assert.equal(source.includes('REVIEW_NOT_COMPLETED'), true);
  for (const token of [
    'fakeCursorAdapter',
    'FakeCursorAdapter',
    'executeHumanAgentExecution',
    'evaluateChangeGate',
    'evaluateHumanChangeGate',
    'runReviewBoardPipeline',
    'fetch(',
    'FULL_AUTO',
  ]) {
    assert.equal(source.includes(token), false, token);
  }
  const ui = readFileSync(path.resolve(process.cwd(), 'src/app/(root)/jury/ui.tsx'), 'utf8');
  const body = ui.slice(ui.indexOf('export function ImprovementsBody'), ui.indexOf('export function ImprovementTraceBody'));
  assert.equal(body.includes('Send to Agent'), true);
  assert.equal(body.includes('approval'), true);
  const visible = body.replaceAll('Run Agent (Mock)', '').replaceAll('Run Change Gate', '').replaceAll('Run Re-review', '');
  for (const label of ['Run Agent', 'Run Change Gate', 'Run Re-review', 'Auto Fix', 'Run Loop']) {
    assert.equal(visible.includes(label), false, label);
  }
});

test('approved product improvement tasks open one pending agent execution', { timeout: 540_000 }, async () => {
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
    const verified = await verifyService(prisma, 'phase75-verify', core);
    const opened = await connectProductReviewImprovement({
      userId: owner.userId,
      memberships: [owner],
      reviewId: verified.resultId,
      clientTenantId: FOREIGN,
    });
    assert.equal(opened.ok, true);
    if (!opened.ok || !opened.taskId) return;
    assert.equal(opened.taskType, 'VERIFICATION');

    const auditorTry = await handoffProductImprovement({
      userId: auditor.userId,
      memberships: [auditor],
      improvementTaskId: opened.taskId,
      clientTenantId: FOREIGN,
    });
    assert.equal(auditorTry.ok, false);
    if (!auditorTry.ok) assert.equal(auditorTry.reason, 'FORBIDDEN');
    const foreignTry = await handoffProductImprovement({
      userId: foreign.userId,
      memberships: [foreign],
      improvementTaskId: opened.taskId,
      clientTenantId: TENANT,
    });
    assert.equal(foreignTry.ok, false);
    if (!foreignTry.ok) assert.equal(foreignTry.reason, 'NOT_FOUND');

    const beforeHandoff = pipelines;
    const [left, right] = await Promise.all([
      handoffProductImprovement({ userId: owner.userId, memberships: [owner], improvementTaskId: opened.taskId, clientTenantId: FOREIGN }),
      handoffProductImprovement({ userId: member.userId, memberships: [member], improvementTaskId: opened.taskId, clientTenantId: FOREIGN }),
    ]);
    assert.equal([left, right].filter((row) => row.ok && row.created).length, 1);
    assert.equal(pipelines, beforeHandoff);
    const replay = await handoffProductImprovement({
      userId: member.userId,
      memberships: [member],
      improvementTaskId: opened.taskId,
    });
    assert.equal(replay.ok, true);
    if (replay.ok) {
      assert.equal(replay.created, false);
      assert.equal(replay.status, 'PENDING');
      assert.equal(replay.agent, 'CURSOR');
    }
    assert.equal(await prisma.juryAgentExecution.count({ where: { tenantId: TENANT, taskId: opened.taskId } }), 1);
    const stored = await prisma.juryAgentExecution.findFirst({ where: { tenantId: TENANT, taskId: opened.taskId } });
    assert.equal(stored?.status, 'PENDING');
    assert.equal(stored?.agent, 'CURSOR');
    assert.equal(stored?.startedAt, null);
    assert.equal(stored?.finishedAt, null);
    const workspace = stored?.workspaceRef as { type?: string; ref?: string };
    assert.equal(workspace?.type, 'PROJECT');
    assert.equal(workspace?.ref, 'jury-product');
    assert.equal(await prisma.juryAuditEvent.count({
      where: { tenantId: TENANT, improvementTaskId: opened.taskId, action: 'AGENT_HANDOFF_CREATED' },
    }), 1);
    const secretText = JSON.stringify({
      snapshot: stored?.inputSnapshot,
      provenance: stored?.provenance,
      audit: await prisma.juryAuditEvent.findMany({ where: { tenantId: TENANT, action: 'AGENT_HANDOFF_CREATED' } }),
    });
    assert.equal(secretText.includes(REF), false);
    assert.equal(secretText.toLowerCase().includes('password'), false);
    assert.equal(secretText.includes('credentialRef'), false);

    await prisma.juryAgentExecution.update({ where: { id: stored?.id }, data: { status: 'RUNNING' } });
    const running = await handoffProductImprovement({
      userId: owner.userId,
      memberships: [owner],
      improvementTaskId: opened.taskId,
    });
    assert.equal(running.ok, false);
    assert.equal(await prisma.juryAgentExecution.count({ where: { tenantId: TENANT, taskId: opened.taskId } }), 1);

    const pending = await verifyService(prisma, 'phase75-pending', core);
    const pendingTask = await connectProductReviewImprovement({
      userId: owner.userId,
      memberships: [owner],
      reviewId: pending.resultId,
    });
    assert.equal(pendingTask.ok, true);
    if (!pendingTask.ok || !pendingTask.taskId) return;
    await prisma.juryHumanDecision.deleteMany({ where: { tenantId: TENANT, reviewResultId: pending.resultId } });
    const pendingHandoff = await handoffProductImprovement({
      userId: owner.userId,
      memberships: [owner],
      improvementTaskId: pendingTask.taskId,
    });
    assert.equal(pendingHandoff.ok, false);
    if (!pendingHandoff.ok) assert.equal(pendingHandoff.reason, 'HUMAN_APPROVAL_REQUIRED');
    assert.equal(await prisma.juryAgentExecution.count({ where: { taskId: pendingTask.taskId } }), 0);

    const rejected = await verifyService(prisma, 'phase75-rejected', core);
    const rejectedTask = await connectProductReviewImprovement({
      userId: owner.userId,
      memberships: [owner],
      reviewId: rejected.resultId,
    });
    assert.equal(rejectedTask.ok, true);
    if (!rejectedTask.ok || !rejectedTask.taskId) return;
    await prisma.juryHumanDecision.updateMany({
      where: { tenantId: TENANT, reviewResultId: rejected.resultId },
      data: { decision: 'ACCEPT' },
    });
    const rejectedHandoff = await handoffProductImprovement({
      userId: owner.userId,
      memberships: [owner],
      improvementTaskId: rejectedTask.taskId,
    });
    assert.equal(rejectedHandoff.ok, false);
    if (!rejectedHandoff.ok) assert.equal(rejectedHandoff.reason, 'HUMAN_APPROVAL_REQUIRED');
    assert.equal(await prisma.juryAgentExecution.count({ where: { taskId: rejectedTask.taskId } }), 0);

    const broken = await verifyService(prisma, 'phase75-broken', core);
    const brokenTask = await connectProductReviewImprovement({
      userId: owner.userId,
      memberships: [owner],
      reviewId: broken.resultId,
    });
    assert.equal(brokenTask.ok, true);
    if (!brokenTask.ok || !brokenTask.taskId) return;
    const original = await prisma.juryImprovementTask.findFirst({
      where: { id: brokenTask.taskId, tenantId: TENANT },
      select: { provenance: true, evidenceId: true },
    });
    await prisma.juryReviewRequest.update({ where: { id: broken.requestId }, data: { status: 'RUNNING' } });
    const incomplete = await handoffProductImprovement({
      userId: owner.userId,
      memberships: [owner],
      improvementTaskId: brokenTask.taskId,
    });
    assert.equal(incomplete.ok, false);
    if (!incomplete.ok) assert.equal(incomplete.reason, 'REVIEW_NOT_COMPLETED');
    await prisma.juryReviewRequest.update({ where: { id: broken.requestId }, data: { status: 'COMPLETED' } });
    await prisma.juryImprovementTask.update({
      where: { id: brokenTask.taskId },
      data: { provenance: { kind: 'original-review-task' } },
    });
    const wrongKind = await handoffProductImprovement({
      userId: owner.userId,
      memberships: [owner],
      improvementTaskId: brokenTask.taskId,
    });
    assert.equal(wrongKind.ok, false);
    if (!wrongKind.ok) assert.equal(wrongKind.reason, 'HUMAN_APPROVAL_REQUIRED');
    await prisma.juryImprovementTask.update({
      where: { id: brokenTask.taskId },
      data: { provenance: original?.provenance ?? {}, evidenceId: null },
    });
    const missingLineage = await handoffProductImprovement({
      userId: owner.userId,
      memberships: [owner],
      improvementTaskId: brokenTask.taskId,
    });
    assert.equal(missingLineage.ok, false);
    if (!missingLineage.ok) assert.equal(missingLineage.reason, 'NOT_FOUND');
    await prisma.juryImprovementTask.update({
      where: { id: brokenTask.taskId },
      data: { evidenceId: original?.evidenceId, diagnosis: 'password=hidden' },
    });
    const unsafe = await handoffProductImprovement({
      userId: owner.userId,
      memberships: [owner],
      improvementTaskId: brokenTask.taskId,
    });
    assert.equal(unsafe.ok, false);
    if (!unsafe.ok) assert.equal(unsafe.reason, 'SNAPSHOT_UNSAFE');
    assert.equal(await prisma.juryAgentExecution.count({ where: { taskId: brokenTask.taskId } }), 0);
    assert.equal(pipelines, 4);

    const where = { tenantId: { in: [TENANT, FOREIGN] } };
    assert.equal(await prisma.juryAgentExecution.count({ where: { ...where, status: { in: ['COMPLETED', 'BLOCKED'] } } }), 0);
    assert.equal(await prisma.juryChangeGateResult.count({ where }), 0);
    assert.equal(await prisma.juryReReviewResult.count({ where }), 0);
    assert.equal(await prisma.juryAutoLoopActivation.count({ where }), 0);
    assert.equal(await prisma.juryDecisionCycle.count({ where }), 0);
    assert.deepEqual(await liveSnapshot(prisma), liveBefore);
  } finally {
    await removeFixture(prisma);
  }
});

async function verifyService(
  prisma: Awaited<typeof import('@/lib/prisma')>['prisma'],
  serviceKey: string,
  core: ProductReviewCore,
) {
  const connectionId = await connect(ownerActor, serviceKey, serviceKey);
  const collected = await runConnectedServiceEvidenceCollection(collectCommand(connectionId));
  if (!collected.ok) throw new Error(collected.reason);
  await diverge(prisma, collected.evidenceId);
  const reviewed = await runConnectedServiceReview({
    actor: ownerActor,
    connectionId,
    evidenceId: collected.evidenceId,
    clientTenantId: FOREIGN,
    core,
  });
  if (!reviewed.ok) throw new Error(reviewed.reason);
  assert.equal(reviewed.decision, 'VERIFY');
  return reviewed;
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

function collectCommand(connectionId: string): CollectionCommand {
  return {
    actor: ownerActor,
    connectionId,
    purpose: 'aisle-self-observation',
    periodStart: PERIOD[0],
    periodEnd: PERIOD[1],
    timezone: 'Asia/Seoul',
    clientTenantId: FOREIGN,
  };
}

async function connect(actorRow: Extract<JuryActor, { ok: true }>, serviceKey: string, displayName: string): Promise<string> {
  const created = await persistServiceOnboarding({
    actor: actorRow,
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
    actor: actorRow,
    connectionId: created.connectionId,
    clientTenantId: FOREIGN,
    now: NOW,
  });
  if (!discovery.ok) throw new Error(discovery.reason);
  const approved = await persistOnboardingScopeDecision({
    actor: actorRow,
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
  await prisma.juryChangeGateResult.deleteMany({ where });
  await prisma.juryReReviewResult.deleteMany({ where });
  await prisma.juryAgentExecution.deleteMany({ where });
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
    where: { username: { in: ['phase75-owner', 'phase75-member', 'phase75-auditor', 'phase75-foreign'] } },
  });
}
