import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import type { JuryActor } from './access';
import { JURY_CORE_CONTRACT_VERSION, JURY_PRODUCT_DATA_ROOT, type JuryDecision, type JuryFinalSurface, type JuryMembership } from './records';
import { loadReviewConsole, projectReviewConsole } from './review-console';
import type { ProductReviewCore } from './review-boundary';
import { approveReReviewAgent, persistReReviewAgentHandoff } from './rereview-agent-handoff';
import { reReviewImprovementTaskId } from './rereview-improvement-bridge';
import { evaluateLaterChangeGate } from './rereview-later-change-gate';
import { evaluateSecondChangeGate } from './rereview-second-change-gate';
import { approveLaterImprovement } from './rereview-later-approval';
import { handoffLaterImprovement } from './rereview-later-handoff';
import { persistLaterReReviewImprovement } from './rereview-later-improvement';
import { evaluateLaterReReview } from './rereview-later-review';
import { approveSecondImprovement } from './rereview-second-approval';
import { handoffSecondImprovement } from './rereview-second-handoff';
import { persistSecondReReviewImprovement } from './rereview-second-improvement';

const TENANT = 'phase69-rereview';
const FOREIGN = 'phase69-foreign';
const CONN = 'phase69-conn';
const EVIDENCE = 'phase69-evidence';
const NOW = '2026-10-04T10:46:00.000Z';
const LIVE_REVIEW = '3707202563ecae9b38f324a4eefd9243a14bc69420ed6cdda16c4c5794f62e0d';
const LIVE_CYCLE = '14308b4c999ccbe8ca54b7f31da5385385d4073c49bbf2955582a6bb96afb01e';
const SECRET = 'password=hidden postgres://db api_key=abc access_token=xyz';

const owner = membership('phase69-owner-m', TENANT, 'phase69-owner', 'OWNER');
const member = membership('phase69-member-m', TENANT, 'phase69-member', 'MEMBER');
const auditor = membership('phase69-auditor-m', TENANT, 'phase69-auditor', 'AUDITOR');
const foreign = membership('phase69-foreign-m', FOREIGN, 'phase69-foreign', 'OWNER');
const ownerActor: JuryActor = { ok: true, userId: owner.userId, tenantId: TENANT, role: 'OWNER', membershipId: owner.id };
const memberActor: JuryActor = { ok: true, userId: member.userId, tenantId: TENANT, role: 'MEMBER', membershipId: member.id };
const auditorActor: JuryActor = { ok: true, userId: auditor.userId, tenantId: TENANT, role: 'AUDITOR', membershipId: auditor.id };

test('later change gate control follows a completed second execution', () => {
  const base = {
    actor: ownerActor,
    result: { id: 'original', tenantId: TENANT, expectedDecision: 'VERIFY' as const, finalSurface: face('steady'), completedAt: NOW },
    status: 'COMPLETED' as const,
    evidenceId: EVIDENCE,
    metrics: [],
    humanDecision: 'VERIFY' as const,
    nextLaterReReview: { id: 'later-review', status: 'EXECUTED', reviewResultId: 'later-result', decision: 'VERIFY' as const },
    nextLaterImprovement: { id: 'later-task', taskType: 'VERIFICATION' as const, status: 'OPEN' },
    nextLaterApproval: 'VERIFY' as const,
    nextLaterAgentExecution: { id: 'exec', status: 'COMPLETED', agent: 'CURSOR' },
  };
  const ready = projectReviewConsole(base);
  assert.equal(ready.ok && ready.screen.canRunLaterChangeGate, true);
  assert.equal(ready.ok && ready.screen.canRunLaterAgent, false);
  const memberView = projectReviewConsole({ ...base, actor: memberActor });
  assert.equal(memberView.ok && memberView.screen.canRunLaterChangeGate, false);
  const reader = projectReviewConsole({ ...base, actor: auditorActor });
  assert.equal(reader.ok && reader.screen.canRunLaterChangeGate, false);
  const pending = projectReviewConsole({
    ...base,
    nextLaterAgentExecution: { id: 'exec', status: 'PENDING', agent: 'CURSOR' },
  });
  assert.equal(pending.ok && pending.screen.canRunLaterChangeGate, false);
  const gated = projectReviewConsole({
    ...base,
    nextLaterChangeGate: { id: 'gate', status: 'GATED', errorCode: null },
  });
  assert.equal(gated.ok && gated.screen.canRunLaterChangeGate, false);
  assert.equal(gated.ok && gated.screen.nextLaterChangeGate?.status, 'GATED');
  const approvedView = projectReviewConsole({
    ...base,
    nextLaterChangeGate: { id: 'gate', status: 'APPROVED', errorCode: null },
  });
  assert.equal(approvedView.ok && approvedView.screen.nextLaterChangeGate?.status, 'APPROVED');
  const blockedView = projectReviewConsole({
    ...base,
    nextLaterChangeGate: { id: 'gate', status: 'BLOCKED', errorCode: 'NO_CHANGES' },
  });
  assert.equal(blockedView.ok && blockedView.screen.nextLaterChangeGate?.status, 'BLOCKED');
});

test('later change gate reuses the existing evaluator', () => {
  const source = readFileSync(path.resolve(process.cwd(), 'src/lib/jury-product/rereview-later-change-gate.ts'), 'utf8');
  for (const token of [
    'fakeCursorAdapter',
    'FakeCursorAdapter',
    'executeReReviewAgentExecution',
    'executeLaterAgentExecution',
    'evaluateLaterReReview',
    'child_process',
    'recordDecisionCycle',
    'persistImprovementAutoLoop',
    'noteHumanNextAction',
    'persistReReviewAgentHandoff',
    'callFrozenReviewPipeline',
    'buildEvidencePackFromDb',
    'attachGa4Evidence',
    'inspectAllowlistedWorkspace',
    'timeout:',
  ]) {
    assert.equal(source.includes(token), false, token);
  }
  assert.equal(source.includes('evaluateReReviewChangeGate'), true);
  assert.equal(source.includes("action: 'agent.execute'"), true);
  assert.equal(source.includes('input.agentExecutionId'), true);
  assert.equal(source.includes('HUMAN_APPROVAL_REQUIRED'), true);
  assert.equal(source.includes('EXECUTION_NOT_COMPLETED'), true);
  const human = readFileSync(path.resolve(process.cwd(), 'src/lib/jury-product/human-change-gate.ts'), 'utf8');
  assert.equal(human.includes('evaluateChangeGate'), true);
  assert.equal(human.includes('evaluateImprovementChangeScope'), true);
  assert.equal(human.includes('inspection: { files: [], present: [] }'), true);
  const actions = readFileSync(path.resolve(process.cwd(), 'src/app/(root)/jury/actions.ts'), 'utf8');
  const fn = actions.slice(
    actions.indexOf('export async function runLaterChangeGate'),
    actions.indexOf('export async function runFollowingReReview'),
  );
  assert.equal(fn.includes("formData.get('agentExecutionId')"), true);
  for (const key of ['tenantId', 'improvementTaskId', 'reviewResultId', 'humanDecisionId', 'changeGateResultId', 'provider', 'workspace', 'status']) {
    assert.equal(fn.includes(`formData.get('${key}')`), false, key);
  }
  const ui = readFileSync(path.resolve(process.cwd(), 'src/app/(root)/jury/ui.tsx'), 'utf8');
  const body = ui.slice(
    ui.indexOf('export function LaterChangeGateBody'),
    ui.indexOf('export function FollowingReReviewBody'),
  );
  assert.equal(body.includes('Run Change Gate'), true);
  assert.equal(body.includes('Change Gate: APPROVED'), true);
  assert.equal(body.includes('Change Gate: GATED'), true);
  assert.equal(body.includes('Change Gate: BLOCKED'), true);
  for (const label of ['Run Re-review', 'Re-review', 'Auto Fix', 'Run Agent', 'Run Loop', 'Auto Loop', 'Create Improvement Task', 'Next Improvement']) {
    assert.equal(body.includes(label), false, label);
  }
});

test('completed later execution reaches one change gate', { timeout: 900_000 }, async () => {
  loadEnv();
  const { prisma } = await import('@/lib/prisma');
  const liveBefore = await liveSnapshot(prisma);
  let cleanupError: string | null = null;
  try {
    await removeFixture(prisma);
    await seed(prisma);
    const empty = await prepare(prisma, 'phase69-empty');
    const reported = await prepare(prisma, 'phase69-gated');
    const concurrent = await prepare(prisma, 'phase69-concurrent');
    const workspace = await prepare(prisma, 'phase69-workspace');
    const secretRow = await prepare(prisma, 'phase69-secret');
    const status = await prepare(prisma, 'phase69-status');
    const missing = await prepare(prisma, 'phase69-missing');
    const wrong = await prepare(prisma, 'phase69-wrong');
    const lineage = await prepare(prisma, 'phase69-lineage');
    const fixture = await prepare(prisma, 'phase69-fixture');
    const foreignRow = await prepare(prisma, 'phase69-foreign-review', FOREIGN);

    const emptyResult = await openLater(prisma, empty, 'VERIFY', 'phase69-empty-summary');
    const reportedResult = await openLater(prisma, reported, 'VERIFY', 'phase69-gated-summary');
    const concurrentResult = await openLater(prisma, concurrent, 'VERIFY', 'phase69-concurrent-summary');
    const workspaceResult = await openLater(prisma, workspace, 'VERIFY', 'phase69-workspace-summary');
    const secretResult = await openLater(prisma, secretRow, 'VERIFY', 'phase69-secret-summary');
    const statusResult = await openLater(prisma, status, 'VERIFY', 'phase69-status-summary');
    const missingResult = await openLater(prisma, missing, 'VERIFY', 'phase69-missing-summary');
    const wrongResult = await openLater(prisma, wrong, 'VERIFY', 'phase69-wrong-summary');
    const lineageResult = await openLater(prisma, lineage, 'VERIFY', 'phase69-lineage-summary');
    const fixtureResult = await openLater(prisma, fixture, 'VERIFY', 'phase69-fixture-summary');
    const foreignResult = await openLater(prisma, foreignRow, 'VERIFY', 'phase69-foreign-summary', false, FOREIGN);

    const emptyTask = await openTask(emptyResult);
    const reportedTask = await openTask(reportedResult);
    const concurrentTask = await openTask(concurrentResult);
    const workspaceTask = await openTask(workspaceResult);
    const secretTask = await openTask(secretResult);
    const statusTask = await openTask(statusResult);
    const missingTask = await openTask(missingResult);
    const wrongTask = await openTask(wrongResult);
    const lineageTask = await openTask(lineageResult);
    const fixtureTask = await openTask(fixtureResult);
    const foreignTask = await openTask(foreignResult, foreign);

    const emptyExecution = await pendingLater(emptyTask);
    const reportedExecution = await pendingLater(reportedTask);
    const concurrentExecution = await pendingLater(concurrentTask);
    const workspaceExecution = await pendingLater(workspaceTask);
    const secretExecution = await pendingLater(secretTask);
    const statusExecution = await pendingLater(statusTask);
    const missingExecution = await pendingLater(missingTask);
    const wrongExecution = await pendingLater(wrongTask);
    const lineageExecution = await pendingLater(lineageTask);
    const fixtureExecution = await pendingLater(fixtureTask);
    const foreignExecution = await pendingLater(foreignTask, foreign);

    await completeLater(prisma, emptyExecution, emptyTask, emptyResult, 'empty');
    await completeLater(prisma, reportedExecution, reportedTask, reportedResult, 'gated');
    await completeLater(prisma, concurrentExecution, concurrentTask, concurrentResult, 'gated');
    await completeLater(prisma, workspaceExecution, workspaceTask, workspaceResult, 'workspace');
    await completeLater(prisma, secretExecution, secretTask, secretResult, 'secret');
    await completeLater(prisma, missingExecution, missingTask, missingResult, 'empty');
    await completeLater(prisma, wrongExecution, wrongTask, wrongResult, 'empty');
    await completeLater(prisma, lineageExecution, lineageTask, lineageResult, 'empty');
    await completeLater(prisma, fixtureExecution, fixtureTask, fixtureResult, 'empty');
    await completeLater(prisma, foreignExecution, foreignTask, foreignResult, 'empty', FOREIGN);

    const phase60 = await prisma.juryHumanDecision.findFirst({
      where: { tenantId: TENANT, reviewResultId: wrong.secondResultId },
      select: { id: true },
    });
    const phase55 = await prisma.juryHumanDecision.findFirst({
      where: { tenantId: TENANT, reviewResultId: wrong.firstResultId },
      select: { id: true },
    });
    const rootHuman = await prisma.juryHumanDecision.findFirst({
      where: { tenantId: TENANT, reviewResultId: wrong.rootId },
      select: { id: true },
    });
    await setHuman(prisma, wrongExecution, phase60?.id ?? 'missing-phase60');
    const phase60Try = await gate(wrongExecution);
    assert.equal(phase60Try.ok, false);
    if (!phase60Try.ok) assert.equal(phase60Try.reason, 'HUMAN_APPROVAL_REQUIRED');
    await setHuman(prisma, wrongExecution, phase55?.id ?? 'missing-phase55');
    const phase55Try = await gate(wrongExecution);
    assert.equal(phase55Try.ok, false);
    if (!phase55Try.ok) assert.equal(phase55Try.reason, 'HUMAN_APPROVAL_REQUIRED');
    await setHuman(prisma, wrongExecution, rootHuman?.id ?? 'missing-root');
    const rootTry = await gate(wrongExecution);
    assert.equal(rootTry.ok, false);
    if (!rootTry.ok) assert.equal(rootTry.reason, 'HUMAN_APPROVAL_REQUIRED');
    assert.equal(await gatesOn(prisma, wrongExecution), 0);

    await prisma.juryHumanDecision.deleteMany({ where: { tenantId: TENANT, reviewResultId: missingResult } });
    const missingTry = await gate(missingExecution);
    assert.equal(missingTry.ok, false);
    if (!missingTry.ok) assert.equal(missingTry.reason, 'HUMAN_APPROVAL_REQUIRED');
    assert.equal(await gatesOn(prisma, missingExecution), 0);

    await prisma.juryImprovementTask.updateMany({
      where: { id: lineage.sourceTaskId, tenantId: TENANT },
      data: { provenance: { kind: 'human-decision-improvement' } },
    });
    const lineageTry = await gate(lineageExecution);
    assert.equal(lineageTry.ok, false);
    if (!lineageTry.ok) assert.equal(lineageTry.reason, 'NOT_REREVIEW_IMPROVEMENT_TASK');
    assert.equal(await gatesOn(prisma, lineageExecution), 0);

    await prisma.juryChangeGateResult.create({
      data: {
        id: `${fixtureExecution}-approved`,
        tenantId: TENANT,
        executionId: fixtureExecution,
        improvementTaskId: fixtureTask,
        changedFiles: [],
        riskFlags: [],
        gate: 'PASS',
        status: 'APPROVED',
        createdAt: new Date(NOW),
        updatedAt: new Date(NOW),
      },
    });

    const before = await counts(prisma);
    const executionBefore = await prisma.juryAgentExecution.findFirst({ where: { id: emptyExecution, tenantId: TENANT } });
    const taskBefore = await taskSnapshot(prisma, emptyTask);
    const humanBefore = await prisma.juryHumanDecision.findFirst({
      where: { tenantId: TENANT, reviewResultId: emptyResult },
      select: { id: true, decision: true, reviewResultId: true, reviewRequestId: true, actorUserId: true },
    });
    const resultBefore = await prisma.juryReviewResult.findFirst({
      where: { id: emptyResult, tenantId: TENANT },
      select: { expectedDecision: true, parentReviewResultId: true, completedAt: true },
    });
    const requestBefore = await prisma.juryReviewRequest.count({ where: { tenantId: { in: [TENANT, FOREIGN] } } });
    const waiting = await loadReviewConsole(ownerActor, empty.rootId);
    assert.equal(waiting.ok && waiting.screen.canRunLaterChangeGate, true);
    assert.equal(waiting.ok && waiting.screen.nextLaterAgentExecution?.status, 'COMPLETED');
    const memberWaiting = await loadReviewConsole(memberActor, empty.rootId);
    assert.equal(memberWaiting.ok && memberWaiting.screen.canRunLaterChangeGate, false);

    const memberTry = await gate(emptyExecution, member);
    assert.equal(memberTry.ok, false);
    if (!memberTry.ok) assert.equal(memberTry.reason, 'FORBIDDEN');
    const auditorTry = await gate(emptyExecution, auditor);
    assert.equal(auditorTry.ok, false);
    if (!auditorTry.ok) assert.equal(auditorTry.reason, 'FORBIDDEN');
    assert.equal(await gatesOn(prisma, emptyExecution), 0);

    const previousGate = await evaluateSecondChangeGate({
      userId: owner.userId,
      memberships: [owner],
      agentExecutionId: emptyExecution,
    });
    assert.equal(previousGate.ok, false);
    if (!previousGate.ok) assert.equal(previousGate.reason, 'NOT_REREVIEW_IMPROVEMENT_TASK');
    assert.equal(await gatesOn(prisma, emptyExecution), 0);
    for (const id of [empty.executionId, 'phase69-empty-exec']) {
      const gatesBefore = await gatesOn(prisma, id);
      const refused = await gate(id);
      assert.equal(refused.ok, false, id);
      if (!refused.ok) assert.equal(refused.reason, 'NOT_REREVIEW_IMPROVEMENT_TASK');
      assert.equal(await gatesOn(prisma, id), gatesBefore);
    }

    const pendingTry = await gate(statusExecution);
    assert.equal(pendingTry.ok, false);
    if (!pendingTry.ok) assert.equal(pendingTry.reason, 'EXECUTION_NOT_COMPLETED');
    await prisma.juryAgentExecution.updateMany({ where: { id: statusExecution, tenantId: TENANT }, data: { status: 'RUNNING' } });
    const runningTry = await gate(statusExecution);
    assert.equal(runningTry.ok, false);
    if (!runningTry.ok) assert.equal(runningTry.reason, 'EXECUTION_NOT_COMPLETED');
    await prisma.juryAgentExecution.updateMany({ where: { id: statusExecution, tenantId: TENANT }, data: { status: 'BLOCKED' } });
    const blockedTry = await gate(statusExecution);
    assert.equal(blockedTry.ok, false);
    if (!blockedTry.ok) assert.equal(blockedTry.reason, 'EXECUTION_NOT_COMPLETED');
    assert.equal(await gatesOn(prisma, statusExecution), 0);

    const foreignTry = await gate(foreignExecution);
    assert.equal(foreignTry.ok, false);
    if (!foreignTry.ok) assert.equal(foreignTry.reason, 'NOT_FOUND');
    assert.equal(await gatesOn(prisma, foreignExecution, FOREIGN), 0);

    const passed = await gate(emptyExecution);
    assert.equal(passed.ok, true, passed.ok ? '' : passed.reason);
    if (passed.ok) {
      assert.equal(passed.created, true);
      assert.equal(passed.reviewId, empty.rootId);
      assert.equal(passed.agentExecutionId, emptyExecution);
      assert.equal(passed.gate.status, 'BLOCKED');
      assert.equal(passed.gate.errorCode, 'NO_CHANGES');
      assert.equal(passed.gate.reasons.includes('NO_CHANGES'), true);
    }
    const replay = await gate(emptyExecution);
    assert.equal(replay.ok, true);
    if (replay.ok && passed.ok) {
      assert.equal(replay.created, false);
      assert.equal(replay.gate.id, passed.gate.id);
    }
    assert.equal(await gatesOn(prisma, emptyExecution), 1);
    assert.equal(await startedAudits(prisma, emptyExecution), 1);
    const shown = await loadReviewConsole(ownerActor, empty.rootId);
    assert.equal(shown.ok && shown.screen.nextLaterChangeGate?.status, 'BLOCKED');
    assert.equal(shown.ok && shown.screen.canRunLaterChangeGate, false);

    const gated = await gate(reportedExecution);
    assert.equal(gated.ok, true, gated.ok ? '' : gated.reason);
    if (gated.ok) {
      assert.equal(gated.gate.status, 'GATED');
      assert.equal(gated.gate.reasons.includes('AGENT_REPORTED_FILE_NOT_FOUND_IN_WORKSPACE'), true);
    }
    const [left, right] = await Promise.all([gate(concurrentExecution), gate(concurrentExecution)]);
    assert.equal(left.ok && right.ok, true);
    if (left.ok && right.ok) {
      assert.equal(left.gate.id, right.gate.id);
      assert.equal(left.gate.status, 'GATED');
      assert.equal(left.created !== right.created, true);
    }
    assert.equal(await gatesOn(prisma, concurrentExecution), 1);
    assert.equal(await startedAudits(prisma, concurrentExecution), 1);

    const blockedWorkspace = await gate(workspaceExecution);
    assert.equal(blockedWorkspace.ok, true, blockedWorkspace.ok ? '' : blockedWorkspace.reason);
    if (blockedWorkspace.ok) {
      assert.equal(blockedWorkspace.gate.status, 'BLOCKED');
      assert.equal(blockedWorkspace.gate.errorCode, 'WORKSPACE_NOT_ALLOWED');
    }
    const blockedSecret = await gate(secretExecution);
    assert.equal(blockedSecret.ok, true, blockedSecret.ok ? '' : blockedSecret.reason);
    if (blockedSecret.ok) {
      assert.equal(blockedSecret.gate.status, 'BLOCKED');
      assert.equal(blockedSecret.gate.errorCode, 'CREDENTIAL_DETECTED');
      assert.equal(blockedSecret.gate.credentialDetected, true);
    }
    const secretStored = await prisma.juryChangeGateResult.findFirst({ where: { executionId: secretExecution, tenantId: TENANT } });
    assert.equal(JSON.stringify(secretStored).toLowerCase().includes('password'), false);
    assert.equal(JSON.stringify(secretStored).includes('postgres://'), false);

    const fixtureReplay = await gate(fixtureExecution);
    assert.equal(fixtureReplay.ok, true, fixtureReplay.ok ? '' : fixtureReplay.reason);
    if (fixtureReplay.ok) {
      assert.equal(fixtureReplay.created, false);
      assert.equal(fixtureReplay.gate.status, 'APPROVED');
    }
    assert.equal(await startedAudits(prisma, fixtureExecution), 0);
    assert.equal(await gatesOn(prisma, fixtureExecution), 1);

    const after = await counts(prisma);
    assert.equal(after.gates, before.gates + 5);
    assert.equal(after.executions, before.executions);
    assert.equal(after.tasks, before.tasks);
    assert.equal(after.humans, before.humans);
    assert.equal(after.results, before.results);
    assert.equal(after.gateReviews, before.gateReviews);
    assert.equal(after.requests, requestBefore);
    assert.equal(after.evidence, before.evidence);
    assert.equal(after.cycles, 0);
    assert.equal(after.loops, 0);
    assert.deepEqual(await prisma.juryAgentExecution.findFirst({ where: { id: emptyExecution, tenantId: TENANT } }), executionBefore);
    assert.deepEqual(await taskSnapshot(prisma, emptyTask), taskBefore);
    assert.deepEqual(await prisma.juryHumanDecision.findFirst({
      where: { tenantId: TENANT, reviewResultId: emptyResult },
      select: { id: true, decision: true, reviewResultId: true, reviewRequestId: true, actorUserId: true },
    }), humanBefore);
    assert.deepEqual(await prisma.juryReviewResult.findFirst({
      where: { id: emptyResult, tenantId: TENANT },
      select: { expectedDecision: true, parentReviewResultId: true, completedAt: true },
    }), resultBefore);
  } finally {
    try {
      await removeFixture(prisma);
    } catch (error) {
      cleanupError = error instanceof Error ? error.message.replace(/postgres(?:ql)?:\/\/\S+/gi, '[redacted]') : 'cleanup failed';
    }
    assert.deepEqual(await liveSnapshot(prisma), liveBefore);
    if (cleanupError) throw new Error(cleanupError);
  }
});

function gate(agentExecutionId: string, actor: JuryMembership = owner) {
  return evaluateLaterChangeGate({ userId: actor.userId, memberships: [actor], agentExecutionId });
}

async function completeLater(
  prisma: Awaited<typeof import('@/lib/prisma')>['prisma'],
  executionId: string,
  taskId: string,
  reviewResultId: string,
  finish: 'empty' | 'gated' | 'workspace' | 'secret',
  tenantId = TENANT,
) {
  const approval = await prisma.juryHumanDecision.findFirst({
    where: { tenantId, reviewResultId },
    select: { id: true, decision: true },
  });
  const review = await prisma.juryReviewResult.findFirst({
    where: { id: reviewResultId, tenantId },
    select: { reviewRequestId: true, expectedDecision: true },
  });
  const reported = finish === 'gated' ? ['workspace/mock-aisle/user-facing-copy.ts'] : [];
  await prisma.juryAgentExecution.updateMany({
    where: { id: executionId, tenantId },
    data: {
      status: 'COMPLETED',
      startedAt: new Date(NOW),
      finishedAt: new Date(NOW),
      workspaceRef: finish === 'workspace' ? { type: 'PROJECT', ref: 'jury-product' } : { type: 'PROJECT', ref: 'mock-aisle' },
      allowedPaths: reported,
      provenance: {
        kind: 'human-agent-execution',
        reviewRequestId: review?.reviewRequestId ?? '',
        reviewResultId,
        humanDecisionId: approval?.id ?? '',
        improvementTaskId: taskId,
        humanDecision: approval?.decision ?? 'VERIFY',
        juryDecision: review?.expectedDecision ?? 'VERIFY',
        taskType: 'VERIFICATION',
        result: {
          summary: finish === 'secret' ? SECRET : 'safe summary',
          changedFiles: reported,
          testsRun: [],
          testsPassed: null,
        },
      },
    },
  });
}

async function setHuman(
  prisma: Awaited<typeof import('@/lib/prisma')>['prisma'],
  executionId: string,
  humanDecisionId: string,
) {
  const row = await prisma.juryAgentExecution.findFirst({
    where: { id: executionId, tenantId: TENANT },
    select: { provenance: true },
  });
  const provenance = row?.provenance && typeof row.provenance === 'object' && !Array.isArray(row.provenance)
    ? { ...row.provenance, humanDecisionId }
    : { humanDecisionId };
  await prisma.juryAgentExecution.updateMany({
    where: { id: executionId, tenantId: TENANT },
    data: { provenance },
  });
}

async function gatesOn(
  prisma: Awaited<typeof import('@/lib/prisma')>['prisma'],
  executionId: string,
  tenantId = TENANT,
) {
  return prisma.juryChangeGateResult.count({ where: { executionId, tenantId } });
}

async function startedAudits(
  prisma: Awaited<typeof import('@/lib/prisma')>['prisma'],
  executionId: string,
) {
  return prisma.juryAuditEvent.count({
    where: { tenantId: TENANT, agentExecutionId: executionId, action: 'CHANGE_GATE_STARTED' },
  });
}


function handoff(improvementTaskId: string, actor: JuryMembership = owner) {
  return handoffLaterImprovement({ userId: actor.userId, memberships: [actor], improvementTaskId });
}

async function pendingLater(improvementTaskId: string, actor: JuryMembership = owner) {
  const approved = await retry(() => approve(improvementTaskId, actor));
  assert.equal(approved.ok, true, approved.ok ? '' : approved.reason);
  const handed = await retry(() => handoff(improvementTaskId, actor));
  assert.equal(handed.ok, true, handed.ok ? '' : handed.reason);
  return handed.ok ? handed.agentExecutionId : '';
}

function approve(improvementTaskId: string, actor: JuryMembership = owner) {
  return approveLaterImprovement({ userId: actor.userId, memberships: [actor], improvementTaskId });
}

async function openTask(reReviewResultId: string, actor: JuryMembership = owner) {
  const created = await retry(() => persistLaterReReviewImprovement({
    userId: actor.userId,
    memberships: [actor],
    reReviewResultId,
  }));
  assert.equal(created.ok, true, created.ok ? '' : created.reason);
  const taskId = created.ok ? created.taskId ?? '' : '';
  assert.notEqual(taskId, '');
  return taskId;
}

type Prepared = {
  rootId: string;
  firstResultId: string;
  secondResultId: string;
  taskId: string;
  sourceTaskId: string;
  originTaskId: string;
  executionId: string;
  gateId: string;
};

async function prepare(
  prisma: Awaited<typeof import('@/lib/prisma')>['prisma'],
  id: string,
  tenantId = TENANT,
): Promise<Prepared> {
  const actor = tenantId === TENANT ? owner : foreign;
  const row = await chain(prisma, id, tenantId);
  const second = await openedSecond(prisma, row, tenantId);
  const created = await retry(() => persistSecondReReviewImprovement({ userId: actor.userId, memberships: [actor], reReviewResultId: second.resultId }));
  assert.equal(created.ok, true, created.ok ? '' : created.reason);
  const taskId = created.ok ? created.taskId ?? '' : '';
  const approved = await retry(() => approveSecondImprovement({ userId: actor.userId, memberships: [actor], improvementTaskId: taskId }));
  assert.equal(approved.ok, true, approved.ok ? '' : approved.reason);
  const handed = await retry(() => handoffSecondImprovement({ userId: actor.userId, memberships: [actor], improvementTaskId: taskId }));
  assert.equal(handed.ok, true, handed.ok ? '' : handed.reason);
  const executionId = handed.ok ? handed.agentExecutionId : '';
  const approval = await prisma.juryHumanDecision.findFirst({
    where: { tenantId, reviewResultId: second.resultId },
    select: { id: true },
  });
  await prisma.juryAgentExecution.updateMany({
    where: { id: executionId, tenantId },
    data: {
      status: 'COMPLETED',
      startedAt: new Date(NOW),
      finishedAt: new Date(NOW),
      workspaceRef: { type: 'PROJECT', ref: 'mock-aisle' },
      provenance: {
        kind: 'human-agent-execution',
        humanDecisionId: approval?.id ?? '',
        improvementTaskId: taskId,
        reviewResultId: second.resultId,
        result: { summary: 'safe summary', changedFiles: [], testsRun: [], testsPassed: null },
      },
    },
  });
  const gateId = `${taskId}-later-gate`;
  await prisma.juryChangeGateResult.create({
    data: {
      id: gateId, tenantId, executionId, improvementTaskId: taskId, changedFiles: [], riskFlags: [],
      gate: 'PASS', status: 'APPROVED', createdAt: new Date(NOW), updatedAt: new Date(NOW),
    },
  });
  return {
    rootId: row.reviewId,
    firstResultId: row.reReviewResultId,
    secondResultId: second.resultId,
    taskId,
    sourceTaskId: row.nextTaskId,
    originTaskId: row.originTaskId,
    executionId,
    gateId,
  };
}

async function openLater(
  prisma: Awaited<typeof import('@/lib/prisma')>['prisma'],
  row: Prepared,
  decision: JuryDecision,
  summary: string,
  secrets = false,
  tenantId = TENANT,
): Promise<string> {
  const actor = tenantId === TENANT ? owner : foreign;
  const core: ProductReviewCore = async () => ({
    boardRunId: `${summary}-board`,
    evidenceStrength: 'strong',
    claimStrength: 'weak',
    conflictDetected: false,
    overclaimDetected: false,
    revisionRequired: decision === 'REWORD',
    expectedDecision: decision,
    finalSurface: secrets ? { ...face(summary), topProblems: [`${summary}-gap`, SECRET] } : face(summary),
    completedAt: NOW,
  });
  const opened = await retry(() => evaluateLaterReReview({
    userId: actor.userId,
    memberships: [actor],
    agentExecutionId: row.executionId,
    core,
  }));
  assert.equal(opened.ok, true, opened.ok ? '' : opened.reason);
  return opened.ok ? opened.reReview.reviewResultId ?? '' : '';
}

async function retry<T extends { ok: boolean; reason?: string }>(runOnce: () => Promise<T>): Promise<T> {
  const first = await runOnce();
  if (first.ok || first.reason !== 'PERSISTENCE_FAILED') return first;
  return runOnce();
}

async function openedSecond(
  prisma: Awaited<typeof import('@/lib/prisma')>['prisma'],
  row: Chain,
  tenantId = TENANT,
) {
  const actor = tenantId === TENANT ? owner : foreign;
  const connectionId = tenantId === TENANT ? CONN : 'phase69-foreign-conn';
  const evidenceId = tenantId === TENANT ? EVIDENCE : 'phase69-foreign-evidence';
  const executionId = await pendingExecution(row.nextTaskId, actor);
  const approval = await prisma.juryHumanDecision.findFirst({
    where: { tenantId, reviewResultId: row.reReviewResultId },
    select: { id: true },
  });
  await prisma.juryAgentExecution.updateMany({
    where: { id: executionId, tenantId },
    data: {
      status: 'COMPLETED',
      startedAt: new Date(NOW),
      finishedAt: new Date(NOW),
      workspaceRef: { type: 'PROJECT', ref: 'mock-aisle' },
      provenance: {
        kind: 'human-agent-execution',
        humanDecisionId: approval?.id ?? '',
        improvementTaskId: row.nextTaskId,
        reviewResultId: row.reReviewResultId,
        result: { summary: 'safe summary', changedFiles: [], testsRun: [], testsPassed: null },
      },
    },
  });
  const gateId = `${row.nextTaskId}-second-gate`;
  await prisma.juryChangeGateResult.create({
    data: {
      id: gateId, tenantId, executionId, improvementTaskId: row.nextTaskId, changedFiles: [], riskFlags: [],
      gate: 'PASS', status: 'APPROVED', createdAt: new Date(NOW), updatedAt: new Date(NOW),
    },
  });
  const requestId = `${row.nextTaskId}-second-request`;
  const resultId = `${row.nextTaskId}-second-result`;
  await prisma.juryReviewRequest.create({
    data: {
      id: requestId, tenantId, connectionId, evidenceId, reviewType: 'FULL_REVIEW', claim: 'ì¸¡ì ??ë²ì??ë¬¸êµ¬ë§??¬ì©?ë¤.',
      mode: 'AISLE_SELF', status: 'COMPLETED', coreRootDir: JURY_PRODUCT_DATA_ROOT, requestedByUserId: actor.userId,
    },
  });
  await prisma.juryReviewResult.create({
    data: {
      id: resultId, tenantId, reviewRequestId: requestId, boardRunId: `${resultId}-board`, evidenceStrength: 'strong',
      claimStrength: 'weak', conflictDetected: false, overclaimDetected: false, revisionRequired: false,
      expectedDecision: 'VERIFY', finalSurface: face(`${row.reviewId}-second`), contractVersion: JURY_CORE_CONTRACT_VERSION,
      completedAt: new Date(NOW), parentReviewResultId: row.reReviewResultId,
    },
  });
  await prisma.juryChangeGateReview.create({
    data: {
      id: `${row.nextTaskId}-second-cgr`, tenantId, parentReviewResultId: row.reReviewResultId, changeGateResultId: gateId,
      agentExecutionId: executionId, improvementTaskId: row.nextTaskId, evidenceId, sourceEvidenceId: evidenceId,
      reason: { code: 'CHANGE_GATE_APPROVED', message: 'Approved change gate is ready for re-review.' },
      status: 'EXECUTED', source: 'CHANGE_GATE', reviewRequestId: requestId, reviewResultId: resultId,
      provenance: { kind: 'change-gate-rereview' }, createdAt: new Date(NOW), updatedAt: new Date(NOW),
    },
  });
  return { resultId, executionId };
}

async function pendingExecution(improvementTaskId: string, actor: JuryMembership = owner) {
  let last = 'PERSISTENCE_FAILED';
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const approved = await approveReReviewAgent({ userId: actor.userId, memberships: [actor], improvementTaskId });
    assert.equal(approved.ok, true, approved.ok ? '' : approved.reason);
    const opened = await persistReReviewAgentHandoff({ userId: actor.userId, memberships: [actor], improvementTaskId });
    if (opened.ok) return opened.agentExecutionId;
    last = opened.reason;
    if (opened.reason !== 'PERSISTENCE_FAILED') break;
  }
  assert.equal(false, true, last);
  throw new Error('handoff failed');
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
  await prisma.juryServiceConnection.create({
    data: { id: CONN, tenantId: TENANT, serviceKey: CONN, displayName: CONN, accessMethod: 'FILE_UPLOAD', status: 'CONNECTED', createdByUserId: owner.userId },
  });
  await prisma.juryServiceConnection.create({
    data: { id: 'phase69-foreign-conn', tenantId: FOREIGN, serviceKey: 'phase69-foreign-conn', displayName: 'phase69-foreign-conn', accessMethod: 'FILE_UPLOAD', status: 'CONNECTED', createdByUserId: foreign.userId },
  });
  await prisma.juryAccessScope.create({
    data: { id: 'phase69-scope', tenantId: TENANT, connectionId: CONN, status: 'APPROVED', grants: [], approvedByUserId: owner.userId, approvedAt: new Date(NOW) },
  });
  await prisma.juryAccessScope.create({
    data: { id: 'phase69-foreign-scope', tenantId: FOREIGN, connectionId: 'phase69-foreign-conn', status: 'APPROVED', grants: [], approvedByUserId: foreign.userId, approvedAt: new Date(NOW) },
  });
  await evidenceRow(prisma, EVIDENCE, TENANT, CONN);
  await evidenceRow(prisma, 'phase69-foreign-evidence', FOREIGN, 'phase69-foreign-conn');
  await prisma.juryNormalizedMetric.createMany({
    data: [
      metric('phase69-zero', 'userCount', 0, 'AVAILABLE'),
      metric('phase69-null', 'postsLast7d', null, 'NOT_MEASURED'),
      {
        ...metric('phase69-foreign-zero', 'userCount', 0, 'AVAILABLE'),
        tenantId: FOREIGN,
        connectionId: 'phase69-foreign-conn',
        evidenceId: 'phase69-foreign-evidence',
      },
    ],
  });
}

type Chain = {
  reviewId: string;
  reReviewResultId: string;
  nextTaskId: string;
  originTaskId: string;
};

async function chain(
  prisma: Awaited<typeof import('@/lib/prisma')>['prisma'],
  id: string,
  tenantId = TENANT,
): Promise<Chain> {
  const actor = tenantId === TENANT ? owner : foreign;
  const connectionId = tenantId === TENANT ? CONN : 'phase69-foreign-conn';
  const evidenceId = tenantId === TENANT ? EVIDENCE : 'phase69-foreign-evidence';
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
      id: requestId, tenantId, connectionId, evidenceId, reviewType: 'FULL_REVIEW', claim: 'ì¸¡ì ??ë²ì??ë¬¸êµ¬ë§??¬ì©?ë¤.',
      mode: 'AISLE_SELF', status: 'COMPLETED', coreRootDir: JURY_PRODUCT_DATA_ROOT, requestedByUserId: actor.userId,
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
      workspaceRef: { type: 'PROJECT', ref: 'phase69-fixture' }, provenance: { kind: 'human-agent-execution' },
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
      id: reReviewRequestId, tenantId, connectionId, evidenceId, reviewType: 'FULL_REVIEW', claim: 'ì¸¡ì ??ë²ì??ë¬¸êµ¬ë§??¬ì©?ë¤.',
      mode: 'AISLE_SELF', status: 'COMPLETED', coreRootDir: JURY_PRODUCT_DATA_ROOT, requestedByUserId: actor.userId,
    },
  });
  await prisma.juryReviewResult.create({
    data: {
      id: reReviewResultId, tenantId, reviewRequestId: reReviewRequestId, boardRunId: `${reReviewResultId}-board`,
      evidenceStrength: 'strong', claimStrength: 'weak', conflictDetected: false, overclaimDetected: false,
      revisionRequired: false, expectedDecision: 'VERIFY', finalSurface: face(`${id}-summary`),
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
      taskType: 'VERIFICATION',
      provenance: {
        kind: 'rereview-improvement', reReviewReviewRequestId: reReviewRequestId, reReviewReviewResultId: reReviewResultId,
        originalReviewRequestId: requestId, originalReviewResultId: reviewId, humanDecisionId: humanId,
        sourceImprovementTaskId: taskId, improvementTaskId: nextTaskId, agentExecutionId: executionId, changeGateResultId: gateId,
        reReviewDecision: 'VERIFY',
      },
      createdAt: new Date(NOW), updatedAt: new Date(NOW),
    },
  });
  return { reviewId, reReviewResultId, nextTaskId, originTaskId: taskId };
}

async function evidenceRow(prisma: Awaited<typeof import('@/lib/prisma')>['prisma'], id: string, tenantId: string, connectionId: string) {
  await prisma.juryEvidence.create({
    data: {
      id, tenantId, connectionId, purpose: 'tenant-declared-observation', periodStart: '2026-09-25', periodEnd: '2026-10-01',
      timezone: 'Asia/Seoul', metricIds: id === EVIDENCE ? ['phase69-zero', 'phase69-null'] : ['phase69-foreign-zero'], adapterKey: 'console-declared', collectedAt: new Date(NOW),
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

async function taskSnapshot(prisma: Awaited<typeof import('@/lib/prisma')>['prisma'], id: string) {
  return prisma.juryImprovementTask.findFirst({
    where: { id, tenantId: TENANT },
    select: { diagnosis: true, acceptanceCriteria: true, provenance: true, taskType: true, parentTaskId: true, status: true, updatedAt: true },
  });
}

async function humansOn(prisma: Awaited<typeof import('@/lib/prisma')>['prisma'], reviewResultId: string) {
  return prisma.juryHumanDecision.count({ where: { reviewResultId } });
}

async function decisionAuditsOn(prisma: Awaited<typeof import('@/lib/prisma')>['prisma'], reviewId: string) {
  return prisma.juryAuditEvent.count({ where: { reviewId, action: 'HUMAN_DECISION_RECORDED' } });
}

async function decisionAudits(prisma: Awaited<typeof import('@/lib/prisma')>['prisma']) {
  return prisma.juryAuditEvent.count({
    where: { tenantId: { in: [TENANT, FOREIGN] }, action: 'HUMAN_DECISION_RECORDED' },
  });
}

async function executionsOn(prisma: Awaited<typeof import('@/lib/prisma')>['prisma'], taskId: string) {
  return prisma.juryAgentExecution.count({ where: { taskId } });
}

async function handoffAuditsOn(prisma: Awaited<typeof import('@/lib/prisma')>['prisma'], improvementTaskId: string) {
  return prisma.juryAuditEvent.count({ where: { improvementTaskId, action: 'AGENT_HANDOFF_CREATED' } });
}

async function handoffAudits(prisma: Awaited<typeof import('@/lib/prisma')>['prisma']) {
  return prisma.juryAuditEvent.count({
    where: { tenantId: { in: [TENANT, FOREIGN] }, action: 'AGENT_HANDOFF_CREATED' },
  });
}

async function statusCount(prisma: Awaited<typeof import('@/lib/prisma')>['prisma'], status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'BLOCKED') {
  return prisma.juryAgentExecution.count({ where: { tenantId: { in: [TENANT, FOREIGN] }, status } });
}

async function metricSnapshot(prisma: Awaited<typeof import('@/lib/prisma')>['prisma']) {
  const rows = await prisma.juryNormalizedMetric.findMany({
    where: { tenantId: TENANT },
    orderBy: { id: 'asc' },
    select: { id: true, value: true, availability: true },
  });
  return rows.map((row) => ({ id: row.id, value: row.value, availability: row.availability }));
}

async function counts(prisma: Awaited<typeof import('@/lib/prisma')>['prisma']) {
  const where = { tenantId: { in: [TENANT, FOREIGN] } };
  const [results, gates, gateReviews, tasks, executions, evidence, humans, cycles, loops, requests] = await Promise.all([
    prisma.juryReviewResult.count({ where }),
    prisma.juryChangeGateResult.count({ where }),
    prisma.juryChangeGateReview.count({ where }),
    prisma.juryImprovementTask.count({ where }),
    prisma.juryAgentExecution.count({ where }),
    prisma.juryEvidence.count({ where }),
    prisma.juryHumanDecision.count({ where }),
    prisma.juryDecisionCycle.count({ where }),
    prisma.juryAutoLoopActivation.count({ where }),
    prisma.juryReviewRequest.count({ where }),
  ]);
  return { results, gates, gateReviews, tasks, executions, evidence, humans, cycles, loops, requests };
}

async function liveSnapshot(prisma: Awaited<typeof import('@/lib/prisma')>['prisma']) {
  const review = await prisma.juryReviewResult.findUnique({
    where: { id: LIVE_REVIEW },
    select: { tenantId: true, expectedDecision: true, parentReviewResultId: true, completedAt: true },
  });
  const cycle = await prisma.juryDecisionCycle.findUnique({ where: { id: LIVE_CYCLE } });
  const tenantId = review?.tenantId;
  const where = tenantId ? { tenantId } : { id: 'missing-live-tenant' };
  const [results, tasks, humans, executions, gates, gateReviews, cycles, loops] = tenantId
    ? await Promise.all([
        prisma.juryReviewResult.count({ where }),
        prisma.juryImprovementTask.count({ where }),
        prisma.juryHumanDecision.count({ where }),
        prisma.juryAgentExecution.count({ where }),
        prisma.juryChangeGateResult.count({ where }),
        prisma.juryChangeGateReview.count({ where }),
        prisma.juryDecisionCycle.count({ where }),
        prisma.juryAutoLoopActivation.count({ where }),
      ])
    : [0, 0, 0, 0, 0, 0, 0, 0];
  return {
    results, tasks, humans, executions, gates, gateReviews, cycles, loops,
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
  await prisma.juryAccessScope.deleteMany({ where });
  await prisma.juryServiceConnection.deleteMany({ where });
  await prisma.juryMembership.deleteMany({ where });
  await prisma.juryTenant.deleteMany({ where: { id: { in: tenants } } });
  await prisma.user.deleteMany({
    where: { username: { in: ['phase69-owner', 'phase69-member', 'phase69-auditor', 'phase69-foreign'] } },
  });
}

function membership(id: string, tenantId: string, userId: string, role: JuryMembership['role']): JuryMembership {
  return { id, tenantId, userId, role, createdAt: NOW };
}

function face(summary: string): JuryFinalSurface {
  return {
    statusSummary: summary, topProblems: [`${summary}-gap`], expectedUserEffect: 'effect', risk: 'risk',
    dimensionEvidence: ['measured sentence'], supportedClaims: ['supported'], partiallySupportedClaims: ['partial'], hypotheses: ['hypothesis'],
  };
}
