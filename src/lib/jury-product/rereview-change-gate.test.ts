import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import type { JuryActor } from './access';
import { fakeCursorAdapter } from './agents/fake-cursor-adapter';
import { persistHumanAgentHandoff } from './human-agent-handoff';
import { JURY_CORE_CONTRACT_VERSION, type JuryDecision, type JuryFinalSurface, type JuryMembership } from './records';
import { loadReviewConsole, projectReviewConsole } from './review-console';
import { approveReReviewAgent, persistReReviewAgentHandoff } from './rereview-agent-handoff';
import { evaluateReReviewChangeGate } from './rereview-change-gate';
import { executeReReviewAgentExecution } from './rereview-agent-execution';
import { reReviewImprovementTaskId } from './rereview-improvement-bridge';

const TENANT = 'phase57-rereview';
const FOREIGN = 'phase57-foreign';
const CONN = 'phase57-conn';
const EVIDENCE = 'phase57-evidence';
const NOW = '2026-10-02T16:20:00.000Z';
const COPY = 'workspace/mock-aisle/user-facing-copy.ts';
const LIVE_REVIEW = '3707202563ecae9b38f324a4eefd9243a14bc69420ed6cdda16c4c5794f62e0d';
const LIVE_CYCLE = '14308b4c999ccbe8ca54b7f31da5385385d4073c49bbf2955582a6bb96afb01e';

const owner = membership('phase57-owner-m', TENANT, 'phase57-owner', 'OWNER');
const member = membership('phase57-member-m', TENANT, 'phase57-member', 'DEVELOPER');
const auditor = membership('phase57-auditor-m', TENANT, 'phase57-auditor', 'VIEWER');
const foreign = membership('phase57-foreign-m', FOREIGN, 'phase57-foreign', 'OWNER');
const ownerActor: JuryActor = { ok: true, userId: owner.userId, tenantId: TENANT, role: 'OWNER', membershipId: owner.id };
const memberActor: JuryActor = { ok: true, userId: member.userId, tenantId: TENANT, role: 'DEVELOPER', membershipId: member.id };
const auditorActor: JuryActor = { ok: true, userId: auditor.userId, tenantId: TENANT, role: 'VIEWER', membershipId: auditor.id };

test('second change gate control follows a completed second execution', () => {
  const base = {
    actor: ownerActor,
    result: { id: 'original', tenantId: TENANT, expectedDecision: 'VERIFY' as const, finalSurface: face('steady'), completedAt: NOW },
    status: 'COMPLETED' as const,
    evidenceId: EVIDENCE,
    metrics: [],
    humanDecision: 'VERIFY' as const,
    improvementTask: { id: 'source', taskType: 'VERIFICATION' as const },
    reReview: {
      id: 'cgr', status: 'EXECUTED', reviewRequestId: 'child-request', reviewResultId: 'child',
      decision: 'VERIFY' as const, completedAt: NOW,
    },
    nextImprovement: { id: 'next', taskType: 'VERIFICATION' as const, status: 'OPEN' },
    nextApproval: 'VERIFY' as const,
    nextAgentExecution: { id: 'exec', status: 'COMPLETED', agent: 'CURSOR' },
  };
  const ready = projectReviewConsole(base);
  assert.equal(ready.ok && ready.screen.canRunReReviewChangeGate, true);
  assert.equal(ready.ok && ready.screen.canRunReReviewAgent, false);
  const memberView = projectReviewConsole({ ...base, actor: memberActor });
  assert.equal(memberView.ok && memberView.screen.canRunReReviewChangeGate, false);
  const reader = projectReviewConsole({ ...base, actor: auditorActor });
  assert.equal(reader.ok && reader.screen.canRunReReviewChangeGate, false);
  const pending = projectReviewConsole({ ...base, nextAgentExecution: { id: 'exec', status: 'PENDING', agent: 'CURSOR' } });
  assert.equal(pending.ok && pending.screen.canRunReReviewChangeGate, false);
  const gated = projectReviewConsole({
    ...base,
    nextChangeGate: { id: 'gate', status: 'GATED', errorCode: null },
  });
  assert.equal(gated.ok && gated.screen.canRunReReviewChangeGate, false);
  assert.equal(gated.ok && gated.screen.nextChangeGate?.status, 'GATED');
});

test('second change gate reuses the phase 52 evaluator', async () => {
  loadEnv();
  const { prisma } = await import('@/lib/prisma');
  let cleanupError: string | null = null;
  const liveBefore = await liveSnapshot(prisma);
  try {
    await removeFixture(prisma);
    await seed(prisma);
    const reported = await chain(prisma, 'phase57-reported', 'VERIFY');
    const workspace = await chain(prisma, 'phase57-workspace', 'VERIFY');
    const secret = await chain(prisma, 'phase57-secret', 'VERIFY');
    const concurrent = await chain(prisma, 'phase57-concurrent', 'VERIFY');
    const pending = await chain(prisma, 'phase57-pending', 'VERIFY');
    const running = await chain(prisma, 'phase57-running', 'VERIFY');
    const blocked = await chain(prisma, 'phase57-blocked', 'VERIFY');
    const missing = await chain(prisma, 'phase57-missing', 'VERIFY');
    const wrong = await chain(prisma, 'phase57-wrong', 'VERIFY');
    const other = await chain(prisma, 'phase57-other', 'VERIFY');
    const broken = await chain(prisma, 'phase57-broken', 'VERIFY');
    const foreignChain = await chain(prisma, 'phase57-foreign-review', 'VERIFY', FOREIGN);
    const plain = await plainTask(prisma);

    const reportedId = await pendingExecution(reported.nextTaskId);
    const workspaceId = await pendingExecution(workspace.nextTaskId);
    const secretId = await pendingExecution(secret.nextTaskId);
    const concurrentId = await pendingExecution(concurrent.nextTaskId);
    const pendingId = await pendingExecution(pending.nextTaskId);
    const runningId = await pendingExecution(running.nextTaskId);
    const blockedId = await pendingExecution(blocked.nextTaskId);
    const wrongId = await pendingExecution(wrong.nextTaskId);
    const otherId = await pendingExecution(other.nextTaskId);
    const brokenId = await pendingExecution(broken.nextTaskId);
    const foreignId = await pendingExecution(foreignChain.nextTaskId, foreign);
    const missingId = `${missing.nextTaskId}-exec`;
    await prisma.juryAgentExecution.create({
      data: {
        id: missingId, tenantId: TENANT, taskId: missing.nextTaskId, agent: 'CURSOR', allowedPaths: [COPY], deniedPaths: [],
        status: 'COMPLETED', workspaceRef: { type: 'PROJECT', ref: 'mock-aisle' },
        provenance: completedProvenance(missing, missing.humanId, { summary: 'safe', changedFiles: [COPY], testsRun: [], testsPassed: null }),
        finishedAt: new Date(NOW), createdAt: new Date(NOW), updatedAt: new Date(NOW),
      },
    });
    const plainHandoff = await persistHumanAgentHandoff({ userId: owner.userId, memberships: [owner], improvementTaskId: plain.taskId });
    assert.equal(plainHandoff.ok, true);
    if (!plainHandoff.ok) return;

    await finish(prisma, reported, reportedId, { type: 'PROJECT', ref: 'mock-aisle' }, [COPY], [COPY]);
    await finish(prisma, secret, secretId, { type: 'PROJECT', ref: 'mock-aisle' }, [COPY], [COPY], 'password=hidden');
    await finish(prisma, concurrent, concurrentId, { type: 'PROJECT', ref: 'mock-aisle' }, [COPY], [COPY]);
    await prisma.juryAgentExecution.updateMany({ where: { id: runningId, tenantId: TENANT }, data: { status: 'RUNNING' } });
    await prisma.juryAgentExecution.updateMany({ where: { id: blockedId, tenantId: TENANT }, data: { status: 'BLOCKED' } });
    const wrongApproval = await prisma.juryHumanDecision.findFirst({
      where: { tenantId: TENANT, reviewResultId: wrong.reReviewResultId }, select: { id: true },
    });
    await finish(prisma, wrong, wrongId, { type: 'PROJECT', ref: 'mock-aisle' }, [COPY], [COPY]);
    await prisma.juryAgentExecution.updateMany({
      where: { id: wrongId, tenantId: TENANT },
      data: { provenance: completedProvenance(wrong, wrong.humanId, { summary: 'safe', changedFiles: [COPY], testsRun: [], testsPassed: null }) },
    });
    await finish(prisma, other, otherId, { type: 'PROJECT', ref: 'mock-aisle' }, [COPY], [COPY]);
    await prisma.juryAgentExecution.updateMany({
      where: { id: otherId, tenantId: TENANT },
      data: { provenance: completedProvenance(other, wrongApproval?.id ?? 'other-approval', { summary: 'safe', changedFiles: [COPY], testsRun: [], testsPassed: null }) },
    });
    await finish(prisma, broken, brokenId, { type: 'PROJECT', ref: 'mock-aisle' }, [COPY], [COPY]);
    await prisma.juryReviewResult.updateMany({
      where: { id: broken.reReviewResultId, tenantId: TENANT },
      data: { parentReviewResultId: plain.reviewId },
    });

    const ran = await executeReReviewAgentExecution({
      userId: owner.userId, memberships: [owner], agentExecutionId: workspaceId, adapter: fakeCursorAdapter('success'),
    });
    assert.equal(ran.ok, true);

    const executionBefore = await prisma.juryAgentExecution.findFirst({ where: { id: reportedId, tenantId: TENANT } });
    const sourceBefore = await prisma.juryAgentExecution.findFirst({ where: { id: reported.executionId, tenantId: TENANT } });
    const sourceGateBefore = await prisma.juryChangeGateResult.findFirst({ where: { id: reported.gateId, tenantId: TENANT } });
    const taskBefore = await prisma.juryImprovementTask.findFirst({ where: { id: reported.nextTaskId, tenantId: TENANT } });
    const before = await counts(prisma);
    const waiting = await loadReviewConsole(ownerActor, reported.reviewId);
    assert.equal(waiting.ok && waiting.screen.canRunReReviewChangeGate, true);

    const memberTry = await evaluateReReviewChangeGate({ userId: member.userId, memberships: [member], agentExecutionId: reportedId });
    assert.equal(memberTry.ok, false);
    if (!memberTry.ok) assert.equal(memberTry.reason, 'FORBIDDEN');
    const auditorTry = await evaluateReReviewChangeGate({ userId: auditor.userId, memberships: [auditor], agentExecutionId: reportedId });
    assert.equal(auditorTry.ok, false);
    if (!auditorTry.ok) assert.equal(auditorTry.reason, 'FORBIDDEN');
    assert.equal(await prisma.juryChangeGateResult.count({ where: { executionId: reportedId } }), 0);

    const gated = await evaluateReReviewChangeGate({ userId: owner.userId, memberships: [owner], agentExecutionId: reportedId });
    assert.equal(gated.ok, true);
    if (gated.ok) {
      assert.equal(gated.created, true);
      assert.equal(gated.reviewId, reported.reviewId);
      assert.equal(gated.gate.status, 'GATED');
      assert.equal(gated.gate.errorCode, null);
      assert.equal(gated.gate.discrepancy, true);
      assert.equal(gated.gate.reasons.includes('AGENT_REPORTED_FILE_NOT_FOUND_IN_WORKSPACE'), true);
    }
    const replay = await evaluateReReviewChangeGate({ userId: owner.userId, memberships: [owner], agentExecutionId: reportedId });
    assert.equal(replay.ok, true);
    if (replay.ok && gated.ok) {
      assert.equal(replay.created, false);
      assert.equal(replay.gate.id, gated.gate.id);
      assert.equal(replay.gate.status, 'GATED');
    }
    assert.equal(await prisma.juryChangeGateResult.count({ where: { executionId: reportedId, tenantId: TENANT } }), 1);

    const [left, right] = await Promise.all([
      evaluateReReviewChangeGate({ userId: owner.userId, memberships: [owner], agentExecutionId: concurrentId }),
      evaluateReReviewChangeGate({ userId: owner.userId, memberships: [owner], agentExecutionId: concurrentId }),
    ]);
    assert.equal(left.ok && right.ok, true);
    if (left.ok && right.ok) assert.equal(left.gate.id, right.gate.id);
    assert.equal(await prisma.juryChangeGateResult.count({ where: { executionId: concurrentId, tenantId: TENANT } }), 1);
    if (left.ok) assert.equal(left.gate.status, 'GATED');

    const workspaceGate = await evaluateReReviewChangeGate({ userId: owner.userId, memberships: [owner], agentExecutionId: workspaceId });
    assert.equal(workspaceGate.ok, true);
    if (workspaceGate.ok) {
      assert.equal(workspaceGate.gate.status, 'BLOCKED');
      assert.equal(workspaceGate.gate.errorCode, 'WORKSPACE_NOT_ALLOWED');
    }
    const secretGate = await evaluateReReviewChangeGate({ userId: owner.userId, memberships: [owner], agentExecutionId: secretId });
    assert.equal(secretGate.ok, true);
    if (secretGate.ok) {
      assert.equal(secretGate.gate.status, 'BLOCKED');
      assert.equal(secretGate.gate.errorCode, 'CREDENTIAL_DETECTED');
      assert.equal(secretGate.gate.credentialDetected, true);
    }
    const secretRow = await prisma.juryChangeGateResult.findFirst({ where: { executionId: secretId, tenantId: TENANT } });
    assert.equal(JSON.stringify(secretRow).toLowerCase().includes('password'), false);

    for (const id of [pendingId, runningId, blockedId]) {
      const refused = await evaluateReReviewChangeGate({ userId: owner.userId, memberships: [owner], agentExecutionId: id });
      assert.equal(refused.ok, false, id);
      if (!refused.ok) assert.equal(refused.reason, 'EXECUTION_NOT_COMPLETED');
      assert.equal(await prisma.juryChangeGateResult.count({ where: { executionId: id, tenantId: TENANT } }), 0);
    }
    for (const id of [missingId, wrongId, otherId]) {
      const refused = await evaluateReReviewChangeGate({ userId: owner.userId, memberships: [owner], agentExecutionId: id });
      assert.equal(refused.ok, false, id);
      if (!refused.ok) assert.equal(refused.reason, 'HUMAN_APPROVAL_REQUIRED');
      assert.equal(await prisma.juryChangeGateResult.count({ where: { executionId: id, tenantId: TENANT } }), 0);
    }
    const firstIteration = await evaluateReReviewChangeGate({ userId: owner.userId, memberships: [owner], agentExecutionId: reported.executionId });
    assert.equal(firstIteration.ok, false);
    if (!firstIteration.ok) assert.equal(firstIteration.reason, 'NOT_REREVIEW_IMPROVEMENT_TASK');
    const plainTry = await evaluateReReviewChangeGate({
      userId: owner.userId, memberships: [owner], agentExecutionId: plainHandoff.agentExecutionId,
    });
    assert.equal(plainTry.ok, false);
    if (!plainTry.ok) assert.equal(plainTry.reason, 'NOT_REREVIEW_IMPROVEMENT_TASK');
    const brokenTry = await evaluateReReviewChangeGate({ userId: owner.userId, memberships: [owner], agentExecutionId: brokenId });
    assert.equal(brokenTry.ok, false);
    if (!brokenTry.ok) assert.equal(brokenTry.reason, 'NOT_REREVIEW_IMPROVEMENT_TASK');
    assert.equal(await prisma.juryChangeGateResult.count({ where: { executionId: brokenId } }), 0);
    const foreignTry = await evaluateReReviewChangeGate({ userId: owner.userId, memberships: [owner], agentExecutionId: foreignId });
    assert.equal(foreignTry.ok, false);
    if (!foreignTry.ok) assert.equal(foreignTry.reason, 'NOT_FOUND');
    assert.equal(await prisma.juryChangeGateResult.count({ where: { tenantId: FOREIGN, executionId: foreignId } }), 0);

    const executionAfter = await prisma.juryAgentExecution.findFirst({ where: { id: reportedId, tenantId: TENANT } });
    const sourceAfter = await prisma.juryAgentExecution.findFirst({ where: { id: reported.executionId, tenantId: TENANT } });
    const sourceGateAfter = await prisma.juryChangeGateResult.findFirst({ where: { id: reported.gateId, tenantId: TENANT } });
    const taskAfter = await prisma.juryImprovementTask.findFirst({ where: { id: reported.nextTaskId, tenantId: TENANT } });
    const child = await prisma.juryReviewResult.findFirst({ where: { id: reported.reReviewResultId, tenantId: TENANT } });
    assert.equal(executionAfter?.updatedAt?.toISOString(), executionBefore?.updatedAt?.toISOString());
    assert.equal(sourceAfter?.updatedAt?.toISOString(), sourceBefore?.updatedAt?.toISOString());
    assert.equal(sourceGateAfter?.updatedAt?.toISOString(), sourceGateBefore?.updatedAt?.toISOString());
    assert.equal(sourceGateAfter?.status, 'APPROVED');
    assert.equal(taskAfter?.updatedAt?.toISOString(), taskBefore?.updatedAt?.toISOString());
    assert.equal(child?.expectedDecision, 'VERIFY');
    const zero = await prisma.juryNormalizedMetric.findFirst({ where: { id: 'phase57-zero', tenantId: TENANT } });
    const missingMetric = await prisma.juryNormalizedMetric.findFirst({ where: { id: 'phase57-null', tenantId: TENANT } });
    assert.equal(zero?.value, 0);
    assert.equal(missingMetric?.value, null);
    const after = await counts(prisma);
    assert.equal(after.results, before.results);
    assert.equal(after.tasks, before.tasks);
    assert.equal(after.executions, before.executions);
    assert.equal(after.gateReviews, before.gateReviews);
    assert.equal(after.evidence, before.evidence);
    assert.equal(after.cycles, 0);
    assert.equal(after.loops, 0);
    assert.equal(after.gates, before.gates + 4);
    const shown = await loadReviewConsole(ownerActor, reported.reviewId);
    assert.equal(shown.ok && shown.screen.canRunReReviewChangeGate, false);
    assert.equal(shown.ok && shown.screen.nextChangeGate?.status, 'GATED');
  } finally {
    try {
      await removeFixture(prisma);
    } catch (error) {
      cleanupError = error instanceof Error ? error.message.replace(/postgres(?:ql)?:\/\/\S+/gi, '[redacted]') : 'failed';
    }
    assert.deepEqual(await liveSnapshot(prisma), liveBefore);
    if (cleanupError) throw new Error(`CLEANUP_FAILED ${cleanupError}`);
  }
});

test('second change gate does not grow a new evaluator', () => {
  const source = readFileSync(path.resolve(process.cwd(), 'src/lib/jury-product/rereview-change-gate.ts'), 'utf8');
  for (const token of [
    'buildEvidencePackFromDb',
    'attachGa4Evidence',
    'runAisleAdapter',
    'GA4_PROPERTY_ID',
    'inspectAllowlistedWorkspace',
    'child_process',
    'spawn',
    'writeFile',
    'findUnique',
    'evaluateHumanChangeGate',
    'evaluateHumanReReview',
    'persistChangeGateReReview',
    'persistReReviewImprovement',
    'recordDecisionCycle',
    'persistImprovementAutoLoop',
    'callFrozenReviewPipeline',
  ]) {
    assert.equal(source.includes(token), false, token);
  }
  assert.equal(source.includes('recordHumanChangeGate'), true);
  assert.equal(source.includes("action: 'agent.execute'"), true);
  assert.equal(source.includes('input.agentExecutionId'), true);
  const human = readFileSync(path.resolve(process.cwd(), 'src/lib/jury-product/human-change-gate.ts'), 'utf8');
  assert.equal(human.includes('evaluateChangeGate'), true);
  assert.equal(human.includes('inspection: { files: [], present: [] }'), true);
  const actions = readFileSync(path.resolve(process.cwd(), 'src/app/(root)/jury/actions.ts'), 'utf8');
  const fn = actions.slice(actions.indexOf('export async function runReReviewChangeGate'));
  assert.equal(fn.includes("formData.get('agentExecutionId')"), true);
  for (const key of ['tenantId', 'provider', 'workspace', 'taskId', 'humanDecision', 'prompt', 'changedFiles', 'gatePolicy']) {
    assert.equal(fn.includes(`formData.get('${key}')`), false, key);
  }
  const ui = readFileSync(path.resolve(process.cwd(), 'src/app/(root)/jury/ui.tsx'), 'utf8');
  const body = ui.slice(ui.indexOf('export function ReReviewChangeGateBody'), ui.indexOf('export function SecondReReviewBody'));
  assert.equal(body.includes('Run Change Gate'), true);
  assert.equal(body.includes('Change Gate: APPROVED'), true);
  assert.equal(body.includes('Change Gate: GATED'), true);
  assert.equal(body.includes('Change Gate: BLOCKED'), true);
  for (const label of ['Re-review', 'Run Jury', 'Auto Fix', 'Run Loop', 'Next Improvement']) {
    assert.equal(body.includes(label), false, label);
  }
});

function pendingExecution(improvementTaskId: string, actor: JuryMembership = owner) {
  return approveReReviewAgent({ userId: actor.userId, memberships: [actor], improvementTaskId }).then(async (approved) => {
    assert.equal(approved.ok, true);
    const opened = await persistReReviewAgentHandoff({ userId: actor.userId, memberships: [actor], improvementTaskId });
    assert.equal(opened.ok, true);
    if (!opened.ok) throw new Error('handoff failed');
    return opened.agentExecutionId;
  });
}

async function finish(
  prisma: Awaited<typeof import('@/lib/prisma')>['prisma'],
  row: { nextTaskId: string; reReviewResultId: string },
  executionId: string,
  workspaceRef: { type: 'PROJECT'; ref: string },
  allowedPaths: string[],
  changedFiles: string[],
  summary = 'safe summary',
) {
  const approval = await prisma.juryHumanDecision.findFirst({
    where: { tenantId: TENANT, reviewResultId: row.reReviewResultId },
    select: { id: true },
  });
  await prisma.juryAgentExecution.updateMany({
    where: { id: executionId, tenantId: TENANT },
    data: {
      status: 'COMPLETED',
      startedAt: new Date(NOW),
      finishedAt: new Date(NOW),
      workspaceRef,
      allowedPaths,
      provenance: completedProvenance(row, approval?.id ?? '', { summary, changedFiles, testsRun: [], testsPassed: null }),
    },
  });
}

function completedProvenance(
  row: { nextTaskId: string; reReviewResultId: string },
  humanDecisionId: string,
  result: { summary: string; changedFiles: string[]; testsRun: string[]; testsPassed: null },
) {
  return {
    kind: 'human-agent-execution',
    humanDecisionId,
    improvementTaskId: row.nextTaskId,
    reviewResultId: row.reReviewResultId,
    result,
  };
}

function loadEnv(): void {
  for (const [file, override] of [['.env', false], ['.env.local', true]] as const) {
    let text = '';
    try { text = readFileSync(path.resolve(process.cwd(), file), 'utf8'); } catch { continue; }
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
  for (const actor of [owner, member, auditor, foreign]) {
    await prisma.user.create({ data: { id: actor.userId, username: actor.userId, email: `${actor.userId}@example.invalid` } });
    await prisma.juryTenant.upsert({ where: { id: actor.tenantId }, update: {}, create: { id: actor.tenantId, name: actor.tenantId } });
    await prisma.juryMembership.create({
      data: { id: actor.id, tenantId: actor.tenantId, userId: actor.userId, role: actor.role, createdAt: new Date(NOW) },
    });
  }
  await connection(prisma, CONN, TENANT, owner.userId);
  await connection(prisma, 'phase57-foreign-conn', FOREIGN, foreign.userId);
  await evidenceRow(prisma, EVIDENCE, TENANT, CONN);
  await evidenceRow(prisma, 'phase57-foreign-evidence', FOREIGN, 'phase57-foreign-conn');
  await prisma.juryNormalizedMetric.createMany({
    data: [
      metric('phase57-zero', 'userCount', 0, 'AVAILABLE'),
      metric('phase57-null', 'postsLast7d', null, 'NOT_MEASURED'),
    ],
  });
}

async function plainTask(prisma: Awaited<typeof import('@/lib/prisma')>['prisma']) {
  const requestId = 'phase57-plain-request';
  const reviewId = 'phase57-plain-review';
  const humanId = 'phase57-plain-human';
  const taskId = 'phase57-plain-task';
  await prisma.juryReviewRequest.create({
    data: {
      id: requestId, tenantId: TENANT, connectionId: CONN, evidenceId: EVIDENCE, reviewType: 'FULL_REVIEW',
      claim: '측정된 범위의 문구만 사용한다.', mode: 'AISLE_SELF', status: 'COMPLETED', coreRootDir: 'data/jury-product',
      requestedByUserId: owner.userId,
    },
  });
  await prisma.juryReviewResult.create({
    data: {
      id: reviewId, tenantId: TENANT, reviewRequestId: requestId, boardRunId: `${reviewId}-board`, evidenceStrength: 'strong',
      claimStrength: 'weak', conflictDetected: false, overclaimDetected: false, revisionRequired: false, expectedDecision: 'VERIFY',
      finalSurface: face('plain'), contractVersion: JURY_CORE_CONTRACT_VERSION, completedAt: new Date(NOW),
    },
  });
  await prisma.juryHumanDecision.create({
    data: {
      id: humanId, tenantId: TENANT, reviewResultId: reviewId, reviewRequestId: requestId, decision: 'VERIFY',
      actorUserId: owner.userId, createdAt: new Date(NOW),
    },
  });
  await prisma.juryImprovementTask.create({
    data: {
      id: taskId, tenantId: TENANT, reviewResultId: reviewId, diagnosis: 'plain', acceptanceCriteria: ['plain'], status: 'OPEN',
      loopIndex: 0, loopPolicy: { maxIterations: null, maxRuntimeMs: null, maxCostUsd: null }, taskType: 'VERIFICATION',
      provenance: { kind: 'human-decision-improvement', humanDecisionId: humanId, reviewRequestId: requestId, reviewResultId: reviewId },
      createdAt: new Date(NOW), updatedAt: new Date(NOW),
    },
  });
  return { reviewId, taskId };
}

async function chain(
  prisma: Awaited<typeof import('@/lib/prisma')>['prisma'],
  id: string,
  reDecision: JuryDecision,
  tenantId = TENANT,
) {
  const actor = tenantId === TENANT ? owner : foreign;
  const connectionId = tenantId === TENANT ? CONN : 'phase57-foreign-conn';
  const evidenceId = tenantId === TENANT ? EVIDENCE : 'phase57-foreign-evidence';
  const requestId = `${id}-request`;
  const reviewId = `${id}-review`;
  const humanId = `${id}-human`;
  const taskId = `${id}-task`;
  const executionId = `${id}-exec`;
  const gateId = `${id}-gate`;
  const reReviewRequestId = `${id}-rerequest`;
  const reReviewResultId = `${id}-reresult`;
  const nextTaskId = reReviewImprovementTaskId(tenantId, reReviewResultId);
  await prisma.juryReviewRequest.create({
    data: {
      id: requestId, tenantId, connectionId, evidenceId, reviewType: 'FULL_REVIEW', claim: '측정된 범위의 문구만 사용한다.',
      mode: 'AISLE_SELF', status: 'COMPLETED', coreRootDir: 'data/jury-product', requestedByUserId: actor.userId,
    },
  });
  await prisma.juryReviewResult.create({
    data: {
      id: reviewId, tenantId, reviewRequestId: requestId, boardRunId: `${reviewId}-board`, evidenceStrength: 'strong',
      claimStrength: 'weak', conflictDetected: false, overclaimDetected: false, revisionRequired: false, expectedDecision: 'VERIFY',
      finalSurface: face(`${id}-original`), contractVersion: JURY_CORE_CONTRACT_VERSION, completedAt: new Date(NOW),
    },
  });
  await prisma.juryHumanDecision.create({
    data: {
      id: humanId, tenantId, reviewResultId: reviewId, reviewRequestId: requestId, decision: 'VERIFY', actorUserId: actor.userId,
      createdAt: new Date(NOW),
    },
  });
  await prisma.juryImprovementTask.create({
    data: {
      id: taskId, tenantId, reviewResultId: reviewId, evidenceId, diagnosis: 'source', acceptanceCriteria: ['source'], status: 'OPEN',
      loopIndex: 0, loopPolicy: { maxIterations: null, maxRuntimeMs: null, maxCostUsd: null }, taskType: 'VERIFICATION',
      provenance: { kind: 'human-decision-improvement', humanDecisionId: humanId, reviewRequestId: requestId, reviewResultId: reviewId },
      createdAt: new Date(NOW), updatedAt: new Date(NOW),
    },
  });
  await prisma.juryAgentExecution.create({
    data: {
      id: executionId, tenantId, taskId, agent: 'CURSOR', allowedPaths: [], deniedPaths: [], status: 'COMPLETED',
      workspaceRef: { type: 'PROJECT', ref: 'phase57-fixture' }, provenance: { kind: 'human-agent-execution' },
      finishedAt: new Date(NOW), createdAt: new Date(NOW), updatedAt: new Date(NOW),
    },
  });
  await prisma.juryChangeGateResult.create({
    data: {
      id: gateId, tenantId, executionId, improvementTaskId: taskId, changedFiles: [], riskFlags: [], gate: 'PASS', status: 'APPROVED',
      createdAt: new Date(NOW), updatedAt: new Date(NOW),
    },
  });
  await prisma.juryReviewRequest.create({
    data: {
      id: reReviewRequestId, tenantId, connectionId, evidenceId, reviewType: 'FULL_REVIEW', claim: '측정된 범위의 문구만 사용한다.',
      mode: 'AISLE_SELF', status: 'COMPLETED', coreRootDir: 'data/jury-product', requestedByUserId: actor.userId,
    },
  });
  await prisma.juryReviewResult.create({
    data: {
      id: reReviewResultId, tenantId, reviewRequestId: reReviewRequestId, boardRunId: `${reReviewResultId}-board`,
      evidenceStrength: 'strong', claimStrength: 'weak', conflictDetected: false, overclaimDetected: false,
      revisionRequired: reDecision === 'REWORD', expectedDecision: reDecision, finalSurface: face(`${id}-summary`),
      contractVersion: JURY_CORE_CONTRACT_VERSION, completedAt: new Date(NOW), parentReviewResultId: reviewId,
    },
  });
  await prisma.juryChangeGateReview.create({
    data: {
      id: `${id}-cgr`, tenantId, parentReviewResultId: reviewId, changeGateResultId: gateId, agentExecutionId: executionId,
      improvementTaskId: taskId, evidenceId, sourceEvidenceId: evidenceId,
      reason: { code: 'CHANGE_GATE_APPROVED', message: 'Approved change gate is ready for re-review.' },
      status: 'EXECUTED', source: 'CHANGE_GATE', reviewRequestId: reReviewRequestId, reviewResultId: reReviewResultId,
      provenance: { kind: 'change-gate-rereview' }, createdAt: new Date(NOW), updatedAt: new Date(NOW),
    },
  });
  await prisma.juryImprovementTask.create({
    data: {
      id: nextTaskId, tenantId, reviewResultId: reReviewResultId, parentTaskId: taskId, evidenceId, diagnosis: `${id}-diagnosis`,
      acceptanceCriteria: [`${id}-criterion`], status: 'OPEN', loopIndex: 0,
      loopPolicy: { maxIterations: null, maxRuntimeMs: null, maxCostUsd: null },
      taskType: reDecision === 'REWORD' ? 'REWORD' : 'VERIFICATION',
      provenance: {
        kind: 'rereview-improvement', reReviewReviewRequestId: reReviewRequestId, reReviewReviewResultId: reReviewResultId,
        originalReviewRequestId: requestId, originalReviewResultId: reviewId, humanDecisionId: humanId,
        sourceImprovementTaskId: taskId, improvementTaskId: nextTaskId, agentExecutionId: executionId, changeGateResultId: gateId,
        reReviewDecision: reDecision,
      },
      createdAt: new Date(NOW), updatedAt: new Date(NOW),
    },
  });
  return { reviewId, humanId, taskId, executionId, gateId, reReviewResultId, reReviewRequestId, nextTaskId };
}

async function connection(prisma: Awaited<typeof import('@/lib/prisma')>['prisma'], id: string, tenantId: string, userId: string) {
  await prisma.juryServiceConnection.create({
    data: { id, tenantId, serviceKey: id, displayName: id, accessMethod: 'FILE_UPLOAD', status: 'CONNECTED', createdByUserId: userId },
  });
}

async function evidenceRow(prisma: Awaited<typeof import('@/lib/prisma')>['prisma'], id: string, tenantId: string, connectionId: string) {
  await prisma.juryEvidence.create({
    data: {
      id, tenantId, connectionId, purpose: 'tenant-declared-observation', periodStart: '2026-09-25', periodEnd: '2026-10-01',
      timezone: 'Asia/Seoul', metricIds: [], adapterKey: 'console-declared', collectedAt: new Date(NOW),
      contentHash: `${id}-hash`, piiExcluded: true, readOnly: true,
    },
  });
}

function metric(id: string, name: string, value: number | null, availability: 'AVAILABLE' | 'NOT_MEASURED') {
  return {
    id, tenantId: TENANT, connectionId: CONN, evidenceId: EVIDENCE, metric: name, value, unit: 'COUNT' as const,
    periodStart: '2026-09-25', periodEnd: '2026-10-01', timezone: 'Asia/Seoul', sourceSystem: 'DATABASE' as const,
    sourceRef: 'tenant-declared', collectedAt: new Date(NOW), availability, rawPayloadRef: 'tenant-declared',
    adapterKey: 'console-declared', adapterVersion: 'v1', ruleId: 'normalize.tenant-declared.v1',
  };
}

async function counts(prisma: Awaited<typeof import('@/lib/prisma')>['prisma']) {
  const where = { tenantId: { in: [TENANT, FOREIGN] } };
  const [results, gates, gateReviews, tasks, executions, evidence, cycles, loops] = await Promise.all([
    prisma.juryReviewResult.count({ where }),
    prisma.juryChangeGateResult.count({ where }),
    prisma.juryChangeGateReview.count({ where }),
    prisma.juryImprovementTask.count({ where }),
    prisma.juryAgentExecution.count({ where }),
    prisma.juryEvidence.count({ where }),
    prisma.juryDecisionCycle.count({ where }),
    prisma.juryAutoLoopActivation.count({ where }),
  ]);
  return { results, gates, gateReviews, tasks, executions, evidence, cycles, loops };
}

async function liveSnapshot(prisma: Awaited<typeof import('@/lib/prisma')>['prisma']) {
  const review = await prisma.juryReviewResult.findUnique({
    where: { id: LIVE_REVIEW },
    select: { tenantId: true, expectedDecision: true, parentReviewResultId: true, completedAt: true },
  });
  const cycle = await prisma.juryDecisionCycle.findUnique({ where: { id: LIVE_CYCLE } });
  const tenantId = review?.tenantId;
  const where = tenantId ? { tenantId } : { id: 'missing-live-tenant' };
  const [results, tasks, executions, gates, gateReviews, cycles, loops] = tenantId
    ? await Promise.all([
        prisma.juryReviewResult.count({ where }),
        prisma.juryImprovementTask.count({ where }),
        prisma.juryAgentExecution.count({ where }),
        prisma.juryChangeGateResult.count({ where }),
        prisma.juryChangeGateReview.count({ where }),
        prisma.juryDecisionCycle.count({ where }),
        prisma.juryAutoLoopActivation.count({ where }),
      ])
    : [0, 0, 0, 0, 0, 0, 0];
  return {
    results, tasks, executions, gates, gateReviews, cycles, loops,
    review: review ? { expectedDecision: review.expectedDecision, parentReviewResultId: review.parentReviewResultId, completedAt: review.completedAt.toISOString() } : null,
    cycle: cycle ? { status: cycle.status, iteration: cycle.iteration, updatedAt: cycle.updatedAt.toISOString() } : null,
  };
}

async function removeFixture(prisma: Awaited<typeof import('@/lib/prisma')>['prisma']): Promise<void> {
  const tenants = [TENANT, FOREIGN];
  const where = { tenantId: { in: tenants } };
  const children = await prisma.juryReviewResult.findMany({
    where: { tenantId: { in: tenants }, parentReviewResultId: { not: null } },
    select: { reviewRequestId: true },
  });
  await prisma.juryDecisionCycle.deleteMany({ where });
  await prisma.juryAutoLoopActivation.deleteMany({ where });
  await prisma.juryAuditEvent.deleteMany({ where });
  await prisma.juryChangeGateReview.deleteMany({ where });
  await prisma.juryChangeGateResult.deleteMany({ where });
  await prisma.juryAgentExecution.deleteMany({ where });
  await prisma.juryImprovementTask.deleteMany({ where });
  await prisma.juryHumanDecision.deleteMany({ where });
  await prisma.juryReviewResult.deleteMany({ where: { tenantId: { in: tenants }, parentReviewResultId: { not: null } } });
  await prisma.juryReviewRequest.deleteMany({ where: { id: { in: children.map((row) => row.reviewRequestId) } } });
  await prisma.juryReviewResult.deleteMany({ where });
  await prisma.juryReviewRequest.deleteMany({ where });
  await prisma.juryNormalizedMetric.deleteMany({ where });
  await prisma.juryEvidence.deleteMany({ where });
  await prisma.juryServiceConnection.deleteMany({ where });
  await prisma.juryMembership.deleteMany({ where });
  await prisma.juryTenant.deleteMany({ where: { id: { in: tenants } } });
  await prisma.user.deleteMany({
    where: { username: { in: ['phase57-owner', 'phase57-member', 'phase57-auditor', 'phase57-foreign'] } },
  });
}

function membership(id: string, tenantId: string, userId: string, role: JuryMembership['role']): JuryMembership {
  return { id, tenantId, userId, role, createdAt: NOW };
}

function face(summary: string): JuryFinalSurface {
  return {
    statusSummary: summary, topProblems: ['gap'], expectedUserEffect: 'effect', risk: 'risk',
    dimensionEvidence: ['measured sentence'], supportedClaims: ['supported'], partiallySupportedClaims: ['partial'], hypotheses: ['hypothesis'],
  };
}
