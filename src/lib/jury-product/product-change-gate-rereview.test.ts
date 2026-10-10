/**
 * An APPROVED product Change Gate reuses the existing re-review boundary and stops at a new ReviewResult.
 * Run: node --import tsx --test src/lib/jury-product/product-change-gate-rereview.test.ts
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import type { JuryActor } from './access';
import {
  runConnectedServiceEvidenceCollection,
  runConnectedServiceReview,
  type CollectionCommand,
} from './connected-service-review';
import { evaluateProductChangeGate } from './product-change-gate';
import { runProductChangeGateReReview } from './product-change-gate-rereview';
import { executeProductAgentExecution } from './product-execution';
import { handoffProductImprovement } from './product-handoff';
import { connectProductReviewImprovement } from './product-improvement';
import type { ProductReviewCore } from './review-boundary';
import type { JuryMembership } from './records';
import { JURY_DECISIONS } from './records';
import {
  persistOnboardingDiscovery,
  persistOnboardingScopeDecision,
  persistServiceOnboarding,
} from './service-onboarding';
import { removeMockAisleWorkspace, withMockAisleLock } from './mock-aisle-lock';

const TENANT = 'phase78-rereview';
const FOREIGN = 'phase78-rereview-foreign';
const NOW = '2026-10-05T08:00:00.000Z';
const LIVE_REVIEW = '3707202563ecae9b38f324a4eefd9243a14bc69420ed6cdda16c4c5794f62e0d';
const LIVE_CYCLE = '14308b4c999ccbe8ca54b7f31da5385385d4073c49bbf2955582a6bb96afb01e';
const REF = 'mock-connection-001';
const PERIOD = ['2026-09-01', '2026-09-07'] as const;
const COPY = 'workspace/mock-aisle/user-facing-copy.ts';
const SECRET = 'password=hidden';

const owner = membership('phase78-owner-m', TENANT, 'phase78-owner', 'OWNER');
const member = membership('phase78-member-m', TENANT, 'phase78-member', 'DEVELOPER');
const auditor = membership('phase78-auditor-m', TENANT, 'phase78-auditor', 'VIEWER');
const foreign = membership('phase78-foreign-m', FOREIGN, 'phase78-foreign', 'OWNER');
const ownerActor = actor(owner);

test('product re-review reuses the existing boundary and stops at the new result', () => {
  const source = readFileSync(new URL('./product-change-gate-rereview.ts', import.meta.url), 'utf8');
  assert.equal(source.includes('evaluateHumanReReview'), true);
  assert.equal(source.includes("action: 'review.start'"), true);
  assert.equal(source.includes('HUMAN_IMPROVEMENT_KIND'), true);
  assert.equal(source.includes('human-agent-execution'), true);
  for (const token of [
    'evaluateSecondReReview',
    'evaluateFollowingReReview',
    'persistHumanImprovement',
    'executeProductAgentExecution',
    'evaluateProductChangeGate',
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
  assert.equal(body.includes("gates[task.agentExecutionId] === 'APPROVED'"), true);
  assert.equal(body.includes('Run Re-review'), true);
  assert.equal(body.includes('New review'), true);
  assert.equal(body.includes('Original review'), true);
  const actions = readFileSync(path.resolve(process.cwd(), 'src/app/(root)/jury/actions.ts'), 'utf8');
  const fn = actions.slice(
    actions.indexOf('export async function runProductChangeGateReReview'),
    actions.indexOf('export async function runHumanReReview'),
  );
  assert.equal(fn.includes("formData.get('agentExecutionId')"), true);
  for (const key of ['tenantId', 'changeGateResultId', 'reviewResultId', 'provider', 'workspace']) {
    assert.equal(fn.includes(`formData.get('${key}')`), false, key);
  }
});

test('an approved product change gate runs one re-review and stops', { timeout: 540_000 }, async () => {
  loadEnv();
  const { prisma } = await import('@/lib/prisma');
  const liveBefore = await liveSnapshot(prisma);
  let pipelines = 0;
  const decisions: string[] = [];
  const core: ProductReviewCore = async (args) => {
    pipelines += 1;
    const { callFrozenReviewPipeline } = await import('./review-core');
    const { createMockReviewBoardLlm } = await import('../ai-review-board/mock-llm');
    const reading = await callFrozenReviewPipeline({ ...args, llm: createMockReviewBoardLlm() });
    decisions.push(reading.expectedDecision);
    return reading;
  };
  let failureCalls = 0;
  const failing: ProductReviewCore = async () => {
    failureCalls += 1;
    throw new Error('REVIEW_CORE_FAILED');
  };
  await withMockAisleLock(async () => {
  try {
    await removeMockAisle();
    await removeFixture(prisma);
    await seed(prisma);
    const approved = await openExecution(prisma, 'phase78-approved', core);
    const blocked = await openExecution(prisma, 'phase78-blocked', core);
    const held = await openExecution(prisma, 'phase78-held', core);
    const broken = await openExecution(prisma, 'phase78-broken', core);
    const tasksBefore = await prisma.juryImprovementTask.count({ where: { tenantId: TENANT } });
    const executionsBefore = await prisma.juryAgentExecution.count({ where: { tenantId: TENANT } });
    const evidenceBefore = await prisma.juryEvidence.count({ where: { tenantId: TENANT } });
    assert.equal(pipelines, 4);
    assert.equal(tasksBefore, 4);
    assert.equal(executionsBefore, 4);

    const missing = await runProductChangeGateReReview({
      userId: owner.userId,
      memberships: [owner],
      agentExecutionId: approved.executionId,
      clientTenantId: FOREIGN,
      core,
    });
    assert.equal(missing.ok, false);
    if (!missing.ok) assert.equal(missing.reason, 'RE-REVIEW_NOT_APPROVED');
    assert.equal(pipelines, 4);

    const opened = await approveGate(prisma, approved.executionId);
    assert.equal(opened.ok, true);
    if (opened.ok) assert.equal(opened.gate.status, 'APPROVED');
    const auditorTry = await runProductChangeGateReReview({
      userId: auditor.userId,
      memberships: [auditor],
      agentExecutionId: approved.executionId,
      clientTenantId: FOREIGN,
      core,
    });
    assert.equal(auditorTry.ok, false);
    if (!auditorTry.ok) assert.equal(auditorTry.reason, 'FORBIDDEN');
    const foreignTry = await runProductChangeGateReReview({
      userId: foreign.userId,
      memberships: [foreign],
      agentExecutionId: approved.executionId,
      clientTenantId: TENANT,
      core,
    });
    assert.equal(foreignTry.ok, false);
    if (!foreignTry.ok) assert.equal(foreignTry.reason, 'NOT_FOUND');
    assert.equal(pipelines, 4);

    const [left, right] = await Promise.all([
      runProductChangeGateReReview({
        userId: owner.userId,
        memberships: [owner],
        agentExecutionId: approved.executionId,
        clientTenantId: FOREIGN,
        core,
      }),
      runProductChangeGateReReview({
        userId: member.userId,
        memberships: [member],
        agentExecutionId: approved.executionId,
        clientTenantId: FOREIGN,
        core,
      }),
    ]);
    assert.equal(left.ok, true);
    assert.equal(right.ok, true);
    if (left.ok && right.ok) {
      assert.equal([left.created, right.created].filter(Boolean).length, 1);
      assert.equal(left.reReview.reviewResultId, right.reReview.reviewResultId);
      assert.equal(left.reReview.decision, right.reReview.decision);
    }
    const replay = await runProductChangeGateReReview({
      userId: owner.userId,
      memberships: [owner],
      agentExecutionId: approved.executionId,
      clientTenantId: FOREIGN,
      core,
    });
    assert.equal(replay.ok, true);
    if (replay.ok) assert.equal(replay.created, false);
    assert.equal(pipelines, 5);
    assert.equal(decisions.length, 5);
    const nextDecision = decisions[4];
    if (!nextDecision) throw new Error('re-review decision missing');
    assert.equal((JURY_DECISIONS as readonly string[]).includes(nextDecision), true);

    const children = await prisma.juryReviewResult.findMany({
      where: { tenantId: TENANT, parentReviewResultId: approved.resultId },
    });
    assert.equal(children.length, 1);
    const child = children[0];
    if (!child) throw new Error('new review missing');
    assert.notEqual(child.id, approved.resultId);
    assert.equal(child.parentReviewResultId, approved.resultId);
    assert.equal(child.expectedDecision, nextDecision);
    if (replay.ok) {
      assert.equal(replay.reReview.reviewResultId, child.id);
      assert.equal(replay.reReview.decision, nextDecision);
      assert.equal(replay.reReview.status, 'EXECUTED');
    }
    const original = await prisma.juryReviewResult.findFirst({
      where: { id: approved.resultId, tenantId: TENANT },
    });
    assert.equal(original?.expectedDecision, 'VERIFY');
    assert.equal(original?.parentReviewResultId, null);
    assert.notEqual(child.reviewRequestId, approved.requestId);
    const gateReview = await prisma.juryChangeGateReview.findFirst({
      where: { agentExecutionId: approved.executionId, tenantId: TENANT },
    });
    assert.equal(gateReview?.status, 'EXECUTED');
    assert.equal(gateReview?.parentReviewResultId, approved.resultId);
    assert.equal(gateReview?.reviewResultId, child.id);
    const provenance = gateReview?.provenance;
    const root = provenance && typeof provenance === 'object' && !Array.isArray(provenance)
      ? (provenance as { originalReviewResultId?: string }).originalReviewResultId
      : null;
    assert.equal(root, approved.resultId);
    assert.equal(await prisma.juryChangeGateReview.count({ where: { agentExecutionId: approved.executionId, tenantId: TENANT } }), 1);
    for (const action of ['REVIEW_REREVIEW_REQUESTED', 'REVIEW_REREVIEW_STARTED', 'REVIEW_REREVIEW_COMPLETED']) {
      assert.equal(await prisma.juryAuditEvent.count({
        where: { tenantId: TENANT, agentExecutionId: approved.executionId, action },
      }), 1, action);
    }

    const blockedGate = await evaluateProductChangeGate({
      userId: owner.userId,
      memberships: [owner],
      agentExecutionId: blocked.executionId,
      clientTenantId: FOREIGN,
    });
    assert.equal(blockedGate.ok, true);
    if (blockedGate.ok) {
      assert.equal(blockedGate.gate.status, 'GATED');
      assert.notEqual(blockedGate.gate.status, 'APPROVED');
    }
    const blockedReview = await runProductChangeGateReReview({
      userId: owner.userId,
      memberships: [owner],
      agentExecutionId: blocked.executionId,
      core,
    });
    assert.equal(blockedReview.ok, false);
    if (!blockedReview.ok) assert.equal(blockedReview.reason, 'RE-REVIEW_NOT_APPROVED');

    const heldRow = await prisma.juryAgentExecution.findFirst({
      where: { id: held.executionId, tenantId: TENANT },
      select: { status: true, provenance: true, inputSnapshot: true },
    });
    const taskRow = await prisma.juryImprovementTask.findFirst({
      where: { id: held.taskId, tenantId: TENANT },
      select: { provenance: true },
    });
    await prisma.juryAgentExecution.update({ where: { id: held.executionId }, data: { status: 'PENDING' } });
    const pending = await runProductChangeGateReReview({
      userId: owner.userId,
      memberships: [owner],
      agentExecutionId: held.executionId,
      core,
    });
    assert.equal(pending.ok, false);
    if (!pending.ok) assert.equal(pending.reason, 'EXECUTION_NOT_COMPLETED');
    await prisma.juryAgentExecution.update({
      where: { id: held.executionId },
      data: { status: 'COMPLETED', provenance: { kind: 'other-iteration', improvementTaskId: held.taskId } },
    });
    const wrong = await runProductChangeGateReReview({
      userId: owner.userId,
      memberships: [owner],
      agentExecutionId: held.executionId,
      core,
    });
    assert.equal(wrong.ok, false);
    if (!wrong.ok) assert.equal(wrong.reason, 'NOT_FOUND');
    await prisma.juryAgentExecution.update({
      where: { id: held.executionId },
      data: { provenance: heldRow?.provenance ?? {} },
    });
    await prisma.juryImprovementTask.update({
      where: { id: held.taskId },
      data: { provenance: { kind: 'rereview-improvement', reviewResultId: held.resultId } },
    });
    const wrongTask = await runProductChangeGateReReview({
      userId: owner.userId,
      memberships: [owner],
      agentExecutionId: held.executionId,
      core,
    });
    assert.equal(wrongTask.ok, false);
    if (!wrongTask.ok) assert.equal(wrongTask.reason, 'HUMAN_APPROVAL_REQUIRED');
    await prisma.juryImprovementTask.update({
      where: { id: held.taskId },
      data: { provenance: taskRow?.provenance ?? {} },
    });
    await prisma.juryAgentExecution.update({
      where: { id: held.executionId },
      data: { inputSnapshot: { password: 'hidden' } },
    });
    const unsafe = await runProductChangeGateReReview({
      userId: owner.userId,
      memberships: [owner],
      agentExecutionId: held.executionId,
      core,
    });
    assert.equal(unsafe.ok, false);
    if (!unsafe.ok) assert.equal(unsafe.reason, 'SNAPSHOT_UNSAFE');
    await prisma.juryAgentExecution.update({
      where: { id: held.executionId },
      data: { inputSnapshot: heldRow?.inputSnapshot ?? {} },
    });
    await prisma.juryAgentExecution.update({
      where: { id: held.executionId },
      data: { workspaceRef: { type: 'PROJECT', ref: 'mock-aisle' } },
    });
    const gated = await evaluateProductChangeGate({
      userId: owner.userId,
      memberships: [owner],
      agentExecutionId: held.executionId,
      clientTenantId: FOREIGN,
    });
    assert.equal(gated.ok, true);
    if (gated.ok) assert.equal(gated.gate.status, 'GATED');
    const gatedReview = await runProductChangeGateReReview({
      userId: owner.userId,
      memberships: [owner],
      agentExecutionId: held.executionId,
      core,
    });
    assert.equal(gatedReview.ok, false);
    if (!gatedReview.ok) assert.equal(gatedReview.reason, 'RE-REVIEW_NOT_APPROVED');
    assert.equal(pipelines, 5);

    const failedGate = await approveGate(prisma, broken.executionId);
    assert.equal(failedGate.ok, true);
    if (failedGate.ok) assert.equal(failedGate.gate.status, 'APPROVED');
    const failed = await runProductChangeGateReReview({
      userId: owner.userId,
      memberships: [owner],
      agentExecutionId: broken.executionId,
      core: failing,
    });
    assert.equal(failed.ok, false);
    if (!failed.ok) assert.equal(failed.reason, 'REVIEW_CORE_FAILED');
    assert.equal(failureCalls, 1);
    assert.equal(pipelines, 5);
    assert.equal(await prisma.juryReviewResult.count({ where: { tenantId: TENANT, parentReviewResultId: broken.resultId } }), 0);
    assert.equal(await prisma.juryAuditEvent.count({
      where: { tenantId: TENANT, agentExecutionId: broken.executionId, action: 'REVIEW_REREVIEW_COMPLETED' },
    }), 0);

    assert.equal(await prisma.juryImprovementTask.count({ where: { tenantId: TENANT } }), tasksBefore);
    assert.equal(await prisma.juryAgentExecution.count({ where: { tenantId: TENANT } }), executionsBefore);
    assert.equal(await prisma.juryEvidence.count({ where: { tenantId: TENANT } }), evidenceBefore);
    assert.equal(await prisma.juryChangeGateResult.count({ where: { tenantId: TENANT } }), 4);
    assert.equal(await prisma.juryReviewResult.count({ where: { tenantId: TENANT, parentReviewResultId: { not: null } } }), 1);
    assert.equal(await prisma.juryReReviewResult.count({ where: { tenantId: TENANT } }), 0);
    assert.equal(await prisma.juryDecisionCycle.count({ where: { tenantId: TENANT } }), 0);
    assert.equal(await prisma.juryAutoLoopActivation.count({ where: { tenantId: TENANT } }), 0);
    const auditText = JSON.stringify(await prisma.juryAuditEvent.findMany({ where: { tenantId: TENANT } }));
    assert.equal(auditText.includes(SECRET), false);
    assert.deepEqual(await liveSnapshot(prisma), liveBefore);
  } finally {
    await removeMockAisle();
    await removeFixture(prisma);
  }
  });
});

test('a real git diff approval runs one product re-review', { timeout: 540_000 }, async () => {
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
  await withMockAisleLock(async () => {
  try {
    await prepareMockAisleGit();
    await removeFixture(prisma);
    await seed(prisma);
    const ready = await openExecution(prisma, 'phase78-git', core);
    assert.equal(pipelines, 1);
    const execution = await prisma.juryAgentExecution.findFirst({
      where: { id: ready.executionId, tenantId: TENANT },
      select: { workspaceRef: true },
    });
    assert.deepEqual(execution?.workspaceRef, { type: 'PROJECT', ref: 'jury-product' });
    const approved = await evaluateProductChangeGate({
      userId: owner.userId,
      memberships: [owner],
      agentExecutionId: ready.executionId,
      clientTenantId: FOREIGN,
    });
    assert.equal(approved.ok, true);
    if (approved.ok) assert.equal(approved.gate.status, 'APPROVED');
    const reviewed = await runProductChangeGateReReview({
      userId: owner.userId,
      memberships: [owner],
      agentExecutionId: ready.executionId,
      clientTenantId: FOREIGN,
      core,
    });
    assert.equal(reviewed.ok, true);
    assert.equal(pipelines, 2);
    const children = await prisma.juryReviewResult.count({
      where: { tenantId: TENANT, parentReviewResultId: ready.resultId },
    });
    assert.equal(children, 1);
    const again = await runProductChangeGateReReview({
      userId: owner.userId,
      memberships: [owner],
      agentExecutionId: ready.executionId,
      clientTenantId: FOREIGN,
      core,
    });
    assert.equal(again.ok, true);
    if (again.ok) assert.equal(again.created, false);
    assert.equal(pipelines, 2);
    assert.deepEqual(await liveSnapshot(prisma), liveBefore);
  } finally {
    await removeMockAisle();
    await removeFixture(prisma);
  }
  });
});

const MOCK_AISLE = path.resolve(process.cwd(), 'data/jury-product/workspaces/mock-aisle');

async function removeMockAisle(): Promise<void> {
  await removeMockAisleWorkspace();
}

async function prepareMockAisleGit(): Promise<void> {
  await removeMockAisle();
  const file = path.join(MOCK_AISLE, 'workspace', 'mock-aisle', 'user-facing-copy.ts');
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, 'export const userFacingCopy = "before";\n', 'utf8');
  gitInMock(['init']);
  gitInMock(['add', 'workspace/mock-aisle/user-facing-copy.ts']);
  gitInMock(['-c', 'user.email=jury-fixture@example.com', '-c', 'user.name=jury-fixture', 'commit', '-m', 'baseline']);
}

function gitInMock(args: string[]): void {
  const result = spawnSync('git', args, { cwd: MOCK_AISLE, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || 'git failed');
}

async function approveGate(
  prisma: Awaited<typeof import('@/lib/prisma')>['prisma'],
  executionId: string,
) {
  await prisma.juryAgentExecution.update({
    where: { id: executionId },
    data: { workspaceRef: { type: 'PROJECT', ref: 'mock-aisle' } },
  });
  return evaluateProductChangeGate({
    userId: owner.userId,
    memberships: [owner],
    agentExecutionId: executionId,
    clientTenantId: FOREIGN,
    inspect: async () => ({
      ok: true,
      files: [{ path: COPY, kind: 'modified' as const, additions: 1, deletions: 0 }],
      present: [COPY],
    }),
  });
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
  await prisma.juryDecisionCycle.deleteMany({ where });
  await prisma.juryAutoLoopActivation.deleteMany({ where });
  await prisma.juryAgentExecution.deleteMany({ where });
  await prisma.juryImprovementTask.deleteMany({ where });
  await prisma.juryHumanDecision.deleteMany({ where });
  await prisma.juryReviewResult.deleteMany({ where: { ...where, parentReviewResultId: { not: null } } });
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
    where: { username: { in: ['phase78-owner', 'phase78-member', 'phase78-auditor', 'phase78-foreign'] } },
  });
}
