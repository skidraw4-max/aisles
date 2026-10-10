/**
 * A product PENDING execution completes through the existing writer and FakeCursorAdapter.
 * Run: node --import tsx --test src/lib/jury-product/product-execution.test.ts
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import type { JuryActor } from './access';
import { fakeCursorAdapter } from './agents/fake-cursor-adapter';
import {
  runConnectedServiceEvidenceCollection,
  runConnectedServiceReview,
  type CollectionCommand,
} from './connected-service-review';
import { handoffProductImprovement } from './product-handoff';
import { connectProductReviewImprovement } from './product-improvement';
import { completeProductAgentExecution, executeProductAgentExecution } from './product-execution';
import type { ProductReviewCore } from './review-boundary';
import type { JuryMembership } from './records';
import {
  persistOnboardingDiscovery,
  persistOnboardingScopeDecision,
  persistServiceOnboarding,
} from './service-onboarding';

const TENANT = 'phase76-execute';
const FOREIGN = 'phase76-execute-foreign';
const NOW = '2026-10-05T08:00:00.000Z';
const LIVE_REVIEW = '3707202563ecae9b38f324a4eefd9243a14bc69420ed6cdda16c4c5794f62e0d';
const LIVE_CYCLE = '14308b4c999ccbe8ca54b7f31da5385385d4073c49bbf2955582a6bb96afb01e';
const REF = 'mock-connection-001';
const PERIOD = ['2026-09-01', '2026-09-07'] as const;
const SUMMARY = '사용자 노출 문구를 작업 제약 안에서 조정하는 변경을 준비했다.';

const owner = membership('phase76-owner-m', TENANT, 'phase76-owner', 'OWNER');
const member = membership('phase76-member-m', TENANT, 'phase76-member', 'DEVELOPER');
const auditor = membership('phase76-auditor-m', TENANT, 'phase76-auditor', 'VIEWER');
const foreign = membership('phase76-foreign-m', FOREIGN, 'phase76-foreign', 'OWNER');
const ownerActor = actor(owner);

test('product execution reuses the human writer and does not call a live agent', () => {
  const source = readFileSync(new URL('./product-execution.ts', import.meta.url), 'utf8');
  const executeBody = source.slice(
    source.indexOf('export async function executeProductAgentExecution'),
    source.indexOf('export async function claimProductAgentExecution'),
  );
  const claimBody = source.slice(
    source.indexOf('export async function claimProductAgentExecution'),
    source.indexOf('export async function completeProductAgentExecution'),
  );
  assert.equal(executeBody.includes('await claimProductAgentExecution'), true);
  assert.equal(executeBody.includes('adapter.run'), true);
  assert.equal(executeBody.includes('await completeProductAgentExecution'), true);
  assert.equal(executeBody.indexOf('await claimProductAgentExecution') < executeBody.indexOf('adapter.run'), true);
  assert.equal(executeBody.indexOf('adapter.run') < executeBody.indexOf('await completeProductAgentExecution'), true);
  assert.equal(executeBody.includes('$transaction'), false);
  assert.equal(claimBody.includes('$transaction'), true);
  assert.equal(claimBody.includes('adapter.run'), false);
  assert.equal(claimBody.includes("status: 'RUNNING'"), true);
  assert.equal(source.includes("action: 'agent.execute'"), true);
  assert.equal(source.includes('HUMAN_IMPROVEMENT_KIND'), true);
  assert.equal(source.includes('human-agent-handoff'), true);
  for (const token of [
    'child_process',
    'claude',
    'evaluateChangeGate',
    'evaluateHumanChangeGate',
    'runReviewBoardPipeline',
    'executeReReviewAgentExecution',
    'fetch(',
    'FULL_AUTO',
  ]) {
    assert.equal(source.includes(token), false, token);
  }
  const ui = readFileSync(path.resolve(process.cwd(), 'src/app/(root)/jury/ui.tsx'), 'utf8');
  const body = ui.slice(ui.indexOf('export function ImprovementsBody'), ui.indexOf('export function ImprovementTraceBody'));
  assert.equal(body.includes('Run Agent (Mock)'), true);
  assert.equal(body.includes('Completed'), true);
  assert.equal(body.includes('Mock'), true);
  assert.equal(body.includes('Blocked'), true);
});

test('a product pending execution completes once through the fake adapter', { timeout: 540_000 }, async () => {
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
    const ready = await openExecution(prisma, 'phase76-ready', core);
    const held = await openExecution(prisma, 'phase76-held', core);
    const failed = await openExecution(prisma, 'phase76-failed', core);
    const evidenceBefore = await prisma.juryEvidence.count({ where: { tenantId: TENANT } });
    const tasksBefore = await prisma.juryImprovementTask.count({ where: { tenantId: TENANT } });
    const executionsBefore = await prisma.juryAgentExecution.count({ where: { tenantId: TENANT } });
    assert.equal(pipelines, 3);

    const denied = fakeCursorAdapter('success');
    const auditorTry = await executeProductAgentExecution({
      userId: auditor.userId,
      memberships: [auditor],
      agentExecutionId: ready.executionId,
      clientTenantId: FOREIGN,
      adapter: denied,
    });
    assert.equal(auditorTry.ok, false);
    if (!auditorTry.ok) assert.equal(auditorTry.reason, 'FORBIDDEN');
    assert.equal(denied.calls.length, 0);
    const memberDenied = fakeCursorAdapter('success');
    const memberTry = await executeProductAgentExecution({
      userId: member.userId,
      memberships: [member],
      agentExecutionId: ready.executionId,
      adapter: memberDenied,
    });
    assert.equal(memberTry.ok, false);
    if (!memberTry.ok) assert.equal(memberTry.reason, 'FORBIDDEN');
    assert.equal(memberDenied.calls.length, 0);
    const foreignTry = await executeProductAgentExecution({
      userId: foreign.userId,
      memberships: [foreign],
      agentExecutionId: ready.executionId,
      clientTenantId: TENANT,
      adapter: denied,
    });
    assert.equal(foreignTry.ok, false);
    if (!foreignTry.ok) assert.equal(foreignTry.reason, 'NOT_FOUND');
    assert.equal(denied.calls.length, 0);

    const inner = fakeCursorAdapter('success');
    const shared = {
      calls: inner.calls,
      async run(runInput: Parameters<typeof inner.run>[0]) {
        const visible = await prisma.juryAgentExecution.findFirst({
          where: { id: runInput.executionId, tenantId: TENANT },
          select: { status: true, startedAt: true },
        });
        assert.equal(visible?.status, 'RUNNING');
        assert.ok(visible?.startedAt);
        return inner.run(runInput);
      },
    };
    const raced = await Promise.all([
      executeProductAgentExecution({
        userId: owner.userId,
        memberships: [owner],
        agentExecutionId: ready.executionId,
        clientTenantId: FOREIGN,
        adapter: shared,
      }),
      executeProductAgentExecution({
        userId: owner.userId,
        memberships: [owner],
        agentExecutionId: ready.executionId,
        adapter: shared,
      }),
    ]);
    const completed = raced.filter((item) => item.ok && item.status === 'COMPLETED');
    const busy = raced.filter((item) => !item.ok && item.reason === 'ALREADY_RUNNING');
    assert.equal(completed.length, 1);
    assert.equal(busy.length, 1);
    const ownerRun = completed[0];
    if (ownerRun?.ok) {
      assert.equal(ownerRun.adapterCalled, true);
      assert.equal(ownerRun.result?.summary, SUMMARY);
    }
    assert.equal(shared.calls.length, 1);
    assert.equal(pipelines, 3);
    const stored = await prisma.juryAgentExecution.findFirst({ where: { id: ready.executionId, tenantId: TENANT } });
    assert.equal(stored?.status, 'COMPLETED');
    assert.equal(stored?.agent, 'CURSOR');
    assert.ok(stored?.startedAt);
    assert.ok(stored?.finishedAt);
    const workspace = stored?.workspaceRef as { type?: string; ref?: string };
    assert.equal(workspace?.type, 'PROJECT');
    assert.equal(workspace?.ref, 'jury-product');
    assert.equal(JSON.stringify(stored?.provenance).includes(SUMMARY), true);
    const replay = fakeCursorAdapter('success');
    const again = await executeProductAgentExecution({
      userId: owner.userId,
      memberships: [owner],
      agentExecutionId: ready.executionId,
      adapter: replay,
    });
    assert.equal(again.ok, true);
    if (again.ok) {
      assert.equal(again.status, 'COMPLETED');
      assert.equal(again.adapterCalled, false);
    }
    assert.equal(replay.calls.length, 0);
    const repeated = await completeProductAgentExecution({
      userId: owner.userId,
      memberships: [owner],
      agentExecutionId: ready.executionId,
      result: { ok: true, changedFiles: ['other.ts'], summary: '다시 쓰지 않는다', testsRun: [], testsPassed: null },
    });
    assert.equal(repeated.ok, true);
    if (repeated.ok) {
      assert.equal(repeated.adapterCalled, false);
      assert.equal(repeated.result?.summary, SUMMARY);
    }
    assert.equal(await prisma.juryAuditEvent.count({
      where: { tenantId: TENANT, agentExecutionId: ready.executionId, action: 'AGENT_EXECUTION_COMPLETED' },
    }), 1);
    assert.equal(await prisma.juryAuditEvent.count({
      where: { tenantId: TENANT, agentExecutionId: ready.executionId, action: 'AGENT_EXECUTION_STARTED' },
    }), 1);
    assert.equal(await prisma.juryAuditEvent.count({
      where: { tenantId: TENANT, agentExecutionId: ready.executionId, action: 'AGENT_EXECUTION_COMPLETED' },
    }), 1);
    const secretText = JSON.stringify({
      execution: stored,
      audits: await prisma.juryAuditEvent.findMany({
        where: { tenantId: TENANT, agentExecutionId: ready.executionId },
      }),
    });
    assert.equal(secretText.includes(REF), false);
    assert.equal(secretText.toLowerCase().includes('password'), false);

    await prisma.juryAgentExecution.update({ where: { id: held.executionId }, data: { status: 'RUNNING' } });
    const runningAdapter = fakeCursorAdapter('success');
    const running = await executeProductAgentExecution({
      userId: owner.userId,
      memberships: [owner],
      agentExecutionId: held.executionId,
      adapter: runningAdapter,
    });
    assert.equal(running.ok, false);
    if (!running.ok) assert.equal(running.reason, 'ALREADY_RUNNING');
    assert.equal(runningAdapter.calls.length, 0);
    await prisma.juryAgentExecution.update({ where: { id: held.executionId }, data: { status: 'PENDING', startedAt: null } });

    await prisma.juryReviewRequest.update({ where: { id: held.requestId }, data: { status: 'RUNNING' } });
    const incomplete = await executeProductAgentExecution({
      userId: owner.userId,
      memberships: [owner],
      agentExecutionId: held.executionId,
      adapter: runningAdapter,
    });
    assert.equal(incomplete.ok, false);
    if (!incomplete.ok) assert.equal(incomplete.reason, 'REVIEW_NOT_COMPLETED');
    await prisma.juryReviewRequest.update({ where: { id: held.requestId }, data: { status: 'COMPLETED' } });

    const originalTask = await prisma.juryImprovementTask.findFirst({
      where: { id: held.taskId, tenantId: TENANT },
      select: { provenance: true },
    });
    await prisma.juryImprovementTask.update({
      where: { id: held.taskId },
      data: { provenance: { kind: 'rereview-improvement' } },
    });
    const rereview = await executeProductAgentExecution({
      userId: owner.userId,
      memberships: [owner],
      agentExecutionId: held.executionId,
      adapter: runningAdapter,
    });
    assert.equal(rereview.ok, false);
    if (!rereview.ok) assert.equal(rereview.reason, 'HUMAN_APPROVAL_REQUIRED');
    await prisma.juryImprovementTask.update({
      where: { id: held.taskId },
      data: { provenance: originalTask?.provenance ?? {} },
    });

    const originalExecution = await prisma.juryAgentExecution.findFirst({
      where: { id: held.executionId, tenantId: TENANT },
      select: { provenance: true, workspaceRef: true, inputSnapshot: true },
    });
    await prisma.juryAgentExecution.update({
      where: { id: held.executionId },
      data: { provenance: { kind: 'other-iteration', improvementTaskId: held.taskId } },
    });
    const otherKind = await executeProductAgentExecution({
      userId: owner.userId,
      memberships: [owner],
      agentExecutionId: held.executionId,
      adapter: runningAdapter,
    });
    assert.equal(otherKind.ok, false);
    if (!otherKind.ok) assert.equal(otherKind.reason, 'NOT_FOUND');
    await prisma.juryAgentExecution.update({
      where: { id: held.executionId },
      data: { provenance: originalExecution?.provenance ?? {}, workspaceRef: { type: 'PROJECT', ref: 'elsewhere' } },
    });
    const wrongWorkspace = await executeProductAgentExecution({
      userId: owner.userId,
      memberships: [owner],
      agentExecutionId: held.executionId,
      adapter: runningAdapter,
    });
    assert.equal(wrongWorkspace.ok, false);
    if (!wrongWorkspace.ok) assert.equal(wrongWorkspace.reason, 'NOT_FOUND');
    await prisma.juryAgentExecution.update({
      where: { id: held.executionId },
      data: { workspaceRef: originalExecution?.workspaceRef ?? {}, inputSnapshot: { password: 'hidden' } },
    });
    const unsafe = await executeProductAgentExecution({
      userId: owner.userId,
      memberships: [owner],
      agentExecutionId: held.executionId,
      adapter: runningAdapter,
    });
    assert.equal(unsafe.ok, false);
    if (!unsafe.ok) assert.equal(unsafe.reason, 'SNAPSHOT_UNSAFE');
    assert.equal(await prisma.juryAgentExecution.findFirst({
      where: { id: held.executionId },
      select: { status: true },
    }).then((row) => row?.status), 'PENDING');
    await prisma.juryAgentExecution.update({
      where: { id: held.executionId },
      data: { inputSnapshot: originalExecution?.inputSnapshot ?? {} },
    });

    const poisonId = createHash('sha256').update([TENANT, 'AGENT_EXECUTION_COMPLETED', held.executionId].join('\n')).digest('hex');
    await prisma.juryAuditEvent.create({
      data: {
        id: poisonId,
        tenantId: TENANT,
        timestamp: new Date(NOW),
        actor: owner.userId,
        action: 'AGENT_EXECUTION_COMPLETED',
        agentExecutionId: held.executionId,
        reviewId: held.resultId,
      },
    });
    const poisonAdapter = fakeCursorAdapter('success');
    const poisoned = await executeProductAgentExecution({
      userId: owner.userId,
      memberships: [owner],
      agentExecutionId: held.executionId,
      adapter: poisonAdapter,
    });
    assert.equal(poisoned.ok, false);
    if (!poisoned.ok) assert.equal(poisoned.reason, 'PERSISTENCE_FAILED');
    assert.equal(poisonAdapter.calls.length, 1);
    assert.equal(await prisma.juryAgentExecution.findFirst({
      where: { id: held.executionId },
      select: { status: true },
    }).then((row) => row?.status), 'RUNNING');
    await prisma.juryAgentExecution.update({
      where: { id: held.executionId },
      data: { status: 'PENDING', startedAt: null },
    });
    await prisma.juryAuditEvent.deleteMany({ where: { agentExecutionId: held.executionId } });

    await prisma.juryHumanDecision.updateMany({
      where: { tenantId: TENANT, reviewResultId: held.resultId },
      data: { decision: 'ACCEPT' },
    });
    const rejected = await executeProductAgentExecution({
      userId: owner.userId,
      memberships: [owner],
      agentExecutionId: held.executionId,
      adapter: runningAdapter,
    });
    assert.equal(rejected.ok, false);
    if (!rejected.ok) assert.equal(rejected.reason, 'HUMAN_APPROVAL_REQUIRED');
    assert.equal(runningAdapter.calls.length, 0);

    const failAdapter = fakeCursorAdapter('fail');
    const broken = await executeProductAgentExecution({
      userId: owner.userId,
      memberships: [owner],
      agentExecutionId: failed.executionId,
      adapter: failAdapter,
    });
    assert.equal(broken.ok, true);
    if (broken.ok) assert.equal(broken.status, 'BLOCKED');
    assert.equal(failAdapter.calls.length, 1);
    assert.equal(await prisma.juryAgentExecution.findFirst({
      where: { id: failed.executionId },
      select: { status: true, finishedAt: true, errorCode: true },
    }).then((row) => row?.status), 'BLOCKED');
    const blockedAgain = await executeProductAgentExecution({
      userId: owner.userId,
      memberships: [owner],
      agentExecutionId: failed.executionId,
      adapter: failAdapter,
    });
    assert.equal(blockedAgain.ok, true);
    if (blockedAgain.ok) {
      assert.equal(blockedAgain.status, 'BLOCKED');
      assert.equal(blockedAgain.adapterCalled, false);
    }
    assert.equal(failAdapter.calls.length, 1);

    assert.equal(await prisma.juryEvidence.count({ where: { tenantId: TENANT } }), evidenceBefore);
    assert.equal(await prisma.juryImprovementTask.count({ where: { tenantId: TENANT } }), tasksBefore);
    assert.equal(await prisma.juryAgentExecution.count({ where: { tenantId: TENANT } }), executionsBefore);
    assert.equal(pipelines, 3);
    const where = { tenantId: { in: [TENANT, FOREIGN] } };
    assert.equal(await prisma.juryChangeGateResult.count({ where }), 0);
    assert.equal(await prisma.juryReReviewResult.count({ where }), 0);
    assert.equal(await prisma.juryAutoLoopActivation.count({ where }), 0);
    assert.equal(await prisma.juryDecisionCycle.count({ where }), 0);
    assert.deepEqual(await liveSnapshot(prisma), liveBefore);
  } finally {
    await removeFixture(prisma);
  }
});

async function openExecution(
  prisma: Awaited<typeof import('@/lib/prisma')>['prisma'],
  serviceKey: string,
  core: ProductReviewCore,
) {
  const reviewed = await verifyService(prisma, serviceKey, core);
  const task = await connectProductReviewImprovement({
    userId: owner.userId,
    memberships: [owner],
    reviewId: reviewed.resultId,
    clientTenantId: FOREIGN,
  });
  if (!task.ok || !task.taskId) throw new Error(task.ok ? 'task missing' : task.reason);
  const handed = await handoffProductImprovement({
    userId: owner.userId,
    memberships: [owner],
    improvementTaskId: task.taskId,
    clientTenantId: FOREIGN,
  });
  if (!handed.ok) throw new Error(handed.reason);
  assert.equal(handed.status, 'PENDING');
  return { ...reviewed, taskId: task.taskId, executionId: handed.agentExecutionId };
}

async function verifyService(
  prisma: Awaited<typeof import('@/lib/prisma')>['prisma'],
  serviceKey: string,
  core: ProductReviewCore,
) {
  const connectionId = await connect(ownerActor, serviceKey);
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

async function connect(actorRow: Extract<JuryActor, { ok: true }>, serviceKey: string): Promise<string> {
  const created = await persistServiceOnboarding({
    actor: actorRow,
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
    where: { username: { in: ['phase76-owner', 'phase76-member', 'phase76-auditor', 'phase76-foreign'] } },
  });
}
