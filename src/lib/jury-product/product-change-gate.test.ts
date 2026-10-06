/**
 * A completed product execution reaches one Change Gate through the existing evaluator.
 * Run: node --import tsx --test src/lib/jury-product/product-change-gate.test.ts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import type { JuryActor } from './access';
import { inspectAllowlistedWorkspace } from './change-gate-workspace';
import type { WorkspaceChange } from './change-gate';
import {
  runConnectedServiceEvidenceCollection,
  runConnectedServiceReview,
  type CollectionCommand,
} from './connected-service-review';
import { executeProductAgentExecution } from './product-execution';
import { evaluateProductChangeGate } from './product-change-gate';
import { handoffProductImprovement } from './product-handoff';
import { connectProductReviewImprovement } from './product-improvement';
import type { ProductReviewCore } from './review-boundary';
import type { JuryMembership } from './records';
import {
  persistOnboardingDiscovery,
  persistOnboardingScopeDecision,
  persistServiceOnboarding,
} from './service-onboarding';

const TENANT = 'phase77-gate';
const FOREIGN = 'phase77-gate-foreign';
const NOW = '2026-10-05T08:00:00.000Z';
const LIVE_REVIEW = '3707202563ecae9b38f324a4eefd9243a14bc69420ed6cdda16c4c5794f62e0d';
const LIVE_CYCLE = '14308b4c999ccbe8ca54b7f31da5385385d4073c49bbf2955582a6bb96afb01e';
const REF = 'mock-connection-001';
const PERIOD = ['2026-09-01', '2026-09-07'] as const;
const COPY = 'workspace/mock-aisle/user-facing-copy.ts';
const SECRET = 'password=hidden';

const owner = membership('phase77-owner-m', TENANT, 'phase77-owner', 'OWNER');
const member = membership('phase77-member-m', TENANT, 'phase77-member', 'MEMBER');
const auditor = membership('phase77-auditor-m', TENANT, 'phase77-auditor', 'AUDITOR');
const foreign = membership('phase77-foreign-m', FOREIGN, 'phase77-foreign', 'OWNER');
const ownerActor = actor(owner);

test('product change gate reuses the existing evaluator and stops at the gate', () => {
  const source = readFileSync(new URL('./product-change-gate.ts', import.meta.url), 'utf8');
  assert.equal(source.includes('evaluateChangeGate('), true);
  assert.equal(source.includes('inspectAllowlistedWorkspace'), true);
  assert.equal(source.includes("action: 'agent.execute'"), true);
  assert.equal(source.includes('HUMAN_IMPROVEMENT_KIND'), true);
  assert.equal(source.includes('human-agent-execution'), true);
  for (const token of [
    'evaluateHumanChangeGate',
    'evaluateHumanReReview',
    'evaluateReReviewChangeGate',
    'evaluateLaterChangeGate',
    'runReviewBoardPipeline',
    'fetch(',
    'FULL_AUTO',
    'child_process',
    'claude',
  ]) {
    assert.equal(source.includes(token), false, token);
  }
  const ui = readFileSync(path.resolve(process.cwd(), 'src/app/(root)/jury/ui.tsx'), 'utf8');
  const body = ui.slice(ui.indexOf('export function ImprovementsBody'), ui.indexOf('export function ImprovementTraceBody'));
  assert.equal(body.includes('Run Change Gate'), true);
  assert.equal(body.includes('Change Gate'), true);
  assert.equal(body.includes('Pending'), true);
  assert.equal(body.includes('APPROVED'), true);
  assert.equal(body.includes('BLOCKED'), true);
  assert.equal(body.includes('GATED'), true);
  assert.equal(body.includes('Run Re-review'), true);
  assert.equal(body.includes('New review'), true);
});

test('a completed product execution is gated by the existing evaluator', { timeout: 540_000 }, async () => {
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
    const ready = await openExecution(prisma, 'phase77-ready', core);
    const race = await openExecution(prisma, 'phase77-race', core);
    const held = await openExecution(prisma, 'phase77-held', core);
    const secretRun = await openExecution(prisma, 'phase77-secret', core);
    const allowed = await openExecution(prisma, 'phase77-allowed', core);
    const evidenceBefore = await prisma.juryEvidence.count({ where: { tenantId: TENANT } });
    const tasksBefore = await prisma.juryImprovementTask.count({ where: { tenantId: TENANT } });
    const executionsBefore = await prisma.juryAgentExecution.count({ where: { tenantId: TENANT } });
    assert.equal(pipelines, 5);

    const denied = watch();
    const auditorTry = await evaluateProductChangeGate({
      userId: auditor.userId,
      memberships: [auditor],
      agentExecutionId: ready.executionId,
      clientTenantId: FOREIGN,
      inspect: denied.inspect,
    });
    assert.equal(auditorTry.ok, false);
    if (!auditorTry.ok) assert.equal(auditorTry.reason, 'FORBIDDEN');
    const memberTry = await evaluateProductChangeGate({
      userId: member.userId,
      memberships: [member],
      agentExecutionId: ready.executionId,
      inspect: denied.inspect,
    });
    assert.equal(memberTry.ok, false);
    if (!memberTry.ok) assert.equal(memberTry.reason, 'FORBIDDEN');
    const foreignTry = await evaluateProductChangeGate({
      userId: foreign.userId,
      memberships: [foreign],
      agentExecutionId: ready.executionId,
      clientTenantId: TENANT,
      inspect: denied.inspect,
    });
    assert.equal(foreignTry.ok, false);
    if (!foreignTry.ok) assert.equal(foreignTry.reason, 'NOT_FOUND');
    assert.equal(denied.calls, 0);
    assert.equal(await prisma.juryChangeGateResult.count({ where: { executionId: ready.executionId } }), 0);

    const firstWatch = watch();
    const first = await evaluateProductChangeGate({
      userId: owner.userId,
      memberships: [owner],
      agentExecutionId: ready.executionId,
      clientTenantId: FOREIGN,
      inspect: firstWatch.inspect,
    });
    assert.equal(first.ok, true);
    if (first.ok) {
      assert.equal(first.created, true);
      assert.equal(first.evaluated, true);
      assert.equal(first.gate.status, 'BLOCKED');
      assert.equal(first.gate.errorCode, 'WORKSPACE_NOT_ALLOWED');
      assert.equal(first.gate.reasons.includes('WORKSPACE_NOT_ALLOWED'), true);
    }
    assert.equal(firstWatch.calls, 0);
    const stored = await prisma.juryChangeGateResult.findFirst({
      where: { executionId: ready.executionId, tenantId: TENANT },
    });
    const storedText = JSON.stringify(stored);
    assert.equal(storedText.includes(ready.executionId), true);
    assert.equal(storedText.includes(ready.taskId), true);
    assert.equal(storedText.includes(ready.resultId), true);
    const task = await prisma.juryImprovementTask.findFirst({
      where: { id: ready.taskId, tenantId: TENANT },
      select: { reviewResultId: true, evidenceId: true },
    });
    const request = await prisma.juryReviewRequest.findFirst({
      where: { id: ready.requestId, tenantId: TENANT },
      select: { evidenceId: true, connectionId: true },
    });
    assert.equal(task?.reviewResultId, ready.resultId);
    assert.equal(task?.evidenceId, ready.evidenceId);
    assert.equal(request?.evidenceId, ready.evidenceId);
    assert.equal(request?.connectionId, ready.connectionId);
    const replayWatch = watch();
    const replay = await evaluateProductChangeGate({
      userId: owner.userId,
      memberships: [owner],
      agentExecutionId: ready.executionId,
      inspect: replayWatch.inspect,
    });
    assert.equal(replay.ok, true);
    if (replay.ok) {
      assert.equal(replay.created, false);
      assert.equal(replay.evaluated, false);
      assert.equal(replay.gate.id, first.ok ? first.gate.id : '');
    }
    assert.equal(replayWatch.calls, 0);
    assert.equal(await prisma.juryChangeGateResult.count({ where: { executionId: ready.executionId, tenantId: TENANT } }), 1);
    assert.equal(await prisma.juryAuditEvent.count({
      where: { tenantId: TENANT, agentExecutionId: ready.executionId, action: 'CHANGE_GATE_STARTED' },
    }), 1);
    assert.equal(await prisma.juryAuditEvent.count({
      where: { tenantId: TENANT, agentExecutionId: ready.executionId, action: 'CHANGE_GATE_BLOCKED' },
    }), 1);

    const raceWatch = watch();
    const [left, right] = await Promise.all([
      evaluateProductChangeGate({
        userId: owner.userId,
        memberships: [owner],
        agentExecutionId: race.executionId,
        inspect: raceWatch.inspect,
      }),
      evaluateProductChangeGate({
        userId: owner.userId,
        memberships: [owner],
        agentExecutionId: race.executionId,
        inspect: raceWatch.inspect,
      }),
    ]);
    assert.equal(left.ok && right.ok, true);
    if (left.ok && right.ok) {
      assert.equal([left, right].filter((row) => row.created).length, 1);
      assert.equal([left, right].filter((row) => row.evaluated).length, 1);
      assert.equal(left.gate.status, 'BLOCKED');
      assert.equal(right.gate.status, 'BLOCKED');
    }
    assert.equal(raceWatch.calls, 0);
    assert.equal(await prisma.juryChangeGateResult.count({ where: { executionId: race.executionId, tenantId: TENANT } }), 1);

    const idle = watch();
    for (const status of ['PENDING', 'RUNNING', 'BLOCKED'] as const) {
      await prisma.juryAgentExecution.update({ where: { id: held.executionId }, data: { status } });
      const refused = await evaluateProductChangeGate({
        userId: owner.userId,
        memberships: [owner],
        agentExecutionId: held.executionId,
        inspect: idle.inspect,
      });
      assert.equal(refused.ok, false);
      if (!refused.ok) assert.equal(refused.reason, 'EXECUTION_NOT_COMPLETED');
      assert.equal(await prisma.juryChangeGateResult.count({ where: { executionId: held.executionId } }), 0);
    }
    await prisma.juryAgentExecution.update({ where: { id: held.executionId }, data: { status: 'COMPLETED' } });
    const originalExecution = await prisma.juryAgentExecution.findFirst({
      where: { id: held.executionId, tenantId: TENANT },
      select: { provenance: true, workspaceRef: true, inputSnapshot: true },
    });
    await prisma.juryAgentExecution.update({
      where: { id: held.executionId },
      data: { provenance: { kind: 'other-iteration', improvementTaskId: held.taskId } },
    });
    const otherKind = await evaluateProductChangeGate({
      userId: owner.userId,
      memberships: [owner],
      agentExecutionId: held.executionId,
      inspect: idle.inspect,
    });
    assert.equal(otherKind.ok, false);
    if (!otherKind.ok) assert.equal(otherKind.reason, 'NOT_FOUND');
    await prisma.juryAgentExecution.update({
      where: { id: held.executionId },
      data: { provenance: { kind: 'human-agent-execution', improvementTaskId: held.taskId, reReviewResultId: 'phase77-rereview' } },
    });
    const rereviewExecution = await evaluateProductChangeGate({
      userId: owner.userId,
      memberships: [owner],
      agentExecutionId: held.executionId,
      inspect: idle.inspect,
    });
    assert.equal(rereviewExecution.ok, false);
    if (!rereviewExecution.ok) assert.equal(rereviewExecution.reason, 'NOT_FOUND');
    await prisma.juryAgentExecution.update({
      where: { id: held.executionId },
      data: { provenance: originalExecution?.provenance ?? {} },
    });
    const originalTask = await prisma.juryImprovementTask.findFirst({
      where: { id: held.taskId, tenantId: TENANT },
      select: { provenance: true },
    });
    await prisma.juryImprovementTask.update({
      where: { id: held.taskId },
      data: { provenance: { kind: 'rereview-improvement' } },
    });
    const rereviewTask = await evaluateProductChangeGate({
      userId: owner.userId,
      memberships: [owner],
      agentExecutionId: held.executionId,
      inspect: idle.inspect,
    });
    assert.equal(rereviewTask.ok, false);
    if (!rereviewTask.ok) assert.equal(rereviewTask.reason, 'HUMAN_APPROVAL_REQUIRED');
    await prisma.juryImprovementTask.update({
      where: { id: held.taskId },
      data: { provenance: originalTask?.provenance ?? {} },
    });
    await prisma.juryAgentExecution.update({
      where: { id: held.executionId },
      data: { inputSnapshot: { password: 'hidden' } },
    });
    const unsafe = await evaluateProductChangeGate({
      userId: owner.userId,
      memberships: [owner],
      agentExecutionId: held.executionId,
      inspect: idle.inspect,
    });
    assert.equal(unsafe.ok, false);
    if (!unsafe.ok) assert.equal(unsafe.reason, 'SNAPSHOT_UNSAFE');
    assert.equal(await prisma.juryChangeGateResult.count({ where: { executionId: held.executionId } }), 0);
    await prisma.juryAgentExecution.update({
      where: { id: held.executionId },
      data: { inputSnapshot: originalExecution?.inputSnapshot ?? {}, workspaceRef: { type: 'PROJECT', ref: 'mock-aisle' } },
    });
    assert.equal(idle.calls, 0);

    const missingWatch = watch();
    const missing = await evaluateProductChangeGate({
      userId: owner.userId,
      memberships: [owner],
      agentExecutionId: held.executionId,
      inspect: missingWatch.inspect,
    });
    assert.equal(missing.ok, true);
    if (missing.ok) {
      assert.equal(missing.evaluated, true);
      assert.equal(missing.gate.status, 'GATED');
      assert.equal(missing.gate.reasons.includes('AGENT_REPORTED_FILE_NOT_FOUND_IN_WORKSPACE'), true);
    }
    assert.equal(missingWatch.calls, 1);

    await prisma.juryAgentExecution.update({
      where: { id: secretRun.executionId },
      data: { workspaceRef: { type: 'PROJECT', ref: 'mock-aisle' } },
    });
    const secretWatch = watch(async () => ({
      ok: true as const,
      files: [{ path: COPY, kind: 'modified' as const, additions: 1, deletions: 0, patch: SECRET }],
      present: [COPY],
    }));
    const credential = await evaluateProductChangeGate({
      userId: owner.userId,
      memberships: [owner],
      agentExecutionId: secretRun.executionId,
      inspect: secretWatch.inspect,
    });
    assert.equal(credential.ok, true);
    if (credential.ok) {
      assert.equal(credential.evaluated, true);
      assert.equal(credential.gate.status, 'BLOCKED');
      assert.equal(credential.gate.credentialDetected, true);
      assert.equal(credential.gate.reasons.includes('CREDENTIAL_DETECTED'), true);
    }
    assert.equal(secretWatch.calls, 1);
    const secretRow = JSON.stringify(await prisma.juryChangeGateResult.findFirst({
      where: { executionId: secretRun.executionId, tenantId: TENANT },
    }));
    const secretAudits = JSON.stringify(await prisma.juryAuditEvent.findMany({
      where: { tenantId: TENANT, agentExecutionId: secretRun.executionId, action: { in: ['CHANGE_GATE_STARTED', 'CHANGE_GATE_BLOCKED', 'CHANGE_GATE_COMPLETED'] } },
    }));
    assert.equal(secretRow.includes(SECRET), false);
    assert.equal(secretAudits.includes(SECRET), false);

    await prisma.juryAgentExecution.update({
      where: { id: allowed.executionId },
      data: { workspaceRef: { type: 'PROJECT', ref: 'mock-aisle' } },
    });
    const allowedWatch = watch(async () => ({
      ok: true as const,
      files: [{ path: COPY, kind: 'modified' as const, additions: 1, deletions: 0 }],
      present: [COPY],
    }));
    const approved = await evaluateProductChangeGate({
      userId: owner.userId,
      memberships: [owner],
      agentExecutionId: allowed.executionId,
      inspect: allowedWatch.inspect,
    });
    assert.equal(approved.ok, true);
    if (approved.ok) {
      assert.equal(approved.evaluated, true);
      assert.equal(approved.created, true);
      assert.equal(approved.gate.status, 'APPROVED');
    }
    assert.equal(allowedWatch.calls, 1);

    assert.equal(await prisma.juryEvidence.count({ where: { tenantId: TENANT } }), evidenceBefore);
    assert.equal(await prisma.juryImprovementTask.count({ where: { tenantId: TENANT } }), tasksBefore);
    assert.equal(await prisma.juryAgentExecution.count({ where: { tenantId: TENANT } }), executionsBefore);
    assert.equal(pipelines, 5);
    const where = { tenantId: { in: [TENANT, FOREIGN] } };
    assert.equal(await prisma.juryReReviewResult.count({ where }), 0);
    assert.equal(await prisma.juryChangeGateReview.count({ where }), 0);
    assert.equal(await prisma.juryAutoLoopActivation.count({ where }), 0);
    assert.equal(await prisma.juryDecisionCycle.count({ where }), 0);
    assert.equal(await prisma.juryChangeGateResult.count({ where }), 5);
    assert.deepEqual(await liveSnapshot(prisma), liveBefore);
  } finally {
    await removeFixture(prisma);
  }
});

function watch(
  inner: (relativeRoot: string) => Promise<
    | { ok: true; files: WorkspaceChange[]; present: string[] }
    | { ok: false; reason: 'WORKSPACE_NOT_ALLOWED' | 'WORKSPACE_ESCAPE' }
  > = inspectAllowlistedWorkspace,
) {
  const box = { calls: 0 };
  return {
    get calls() {
      return box.calls;
    },
    inspect: async (relativeRoot: string) => {
      box.calls += 1;
      return inner(relativeRoot);
    },
  };
}

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
  const ran = await executeProductAgentExecution({
    userId: owner.userId,
    memberships: [owner],
    agentExecutionId: handed.agentExecutionId,
    clientTenantId: FOREIGN,
  });
  if (!ran.ok) throw new Error(ran.reason);
  assert.equal(ran.status, 'COMPLETED');
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
  return { ...reviewed, evidenceId: collected.evidenceId, connectionId };
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
  await prisma.juryChangeGateResolution.deleteMany({ where });
  await prisma.juryChangeGateReview.deleteMany({ where });
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
    where: { username: { in: ['phase77-owner', 'phase77-member', 'phase77-auditor', 'phase77-foreign'] } },
  });
}
