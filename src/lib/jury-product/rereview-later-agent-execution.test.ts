import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import type { JuryActor } from './access';
import { JURY_CORE_CONTRACT_VERSION, JURY_PRODUCT_DATA_ROOT, type JuryDecision, type JuryFinalSurface, type JuryMembership } from './records';
import { loadReviewConsole, projectReviewConsole } from './review-console';
import type { ProductReviewCore } from './review-boundary';
import { fakeCursorAdapter } from './agents/fake-cursor-adapter';
import { approveReReviewAgent, persistReReviewAgentHandoff } from './rereview-agent-handoff';
import { reReviewImprovementTaskId } from './rereview-improvement-bridge';
import { executeLaterAgentExecution } from './rereview-later-agent-execution';
import { approveLaterImprovement } from './rereview-later-approval';
import { handoffLaterImprovement } from './rereview-later-handoff';
import { persistLaterReReviewImprovement } from './rereview-later-improvement';
import { evaluateLaterReReview } from './rereview-later-review';
import { approveSecondImprovement } from './rereview-second-approval';
import { handoffSecondImprovement } from './rereview-second-handoff';
import { persistSecondReReviewImprovement } from './rereview-second-improvement';

const TENANT = 'phase68-rereview';
const FOREIGN = 'phase68-foreign';
const CONN = 'phase68-conn';
const EVIDENCE = 'phase68-evidence';
const NOW = '2026-10-04T10:46:00.000Z';
const LIVE_REVIEW = '3707202563ecae9b38f324a4eefd9243a14bc69420ed6cdda16c4c5794f62e0d';
const LIVE_CYCLE = '14308b4c999ccbe8ca54b7f31da5385385d4073c49bbf2955582a6bb96afb01e';
const SECRET = 'password=hidden postgres://db api_key=abc access_token=xyz';

const owner = membership('phase68-owner-m', TENANT, 'phase68-owner', 'OWNER');
const member = membership('phase68-member-m', TENANT, 'phase68-member', 'MEMBER');
const auditor = membership('phase68-auditor-m', TENANT, 'phase68-auditor', 'AUDITOR');
const foreign = membership('phase68-foreign-m', FOREIGN, 'phase68-foreign', 'OWNER');
const ownerActor: JuryActor = { ok: true, userId: owner.userId, tenantId: TENANT, role: 'OWNER', membershipId: owner.id };
const memberActor: JuryActor = { ok: true, userId: member.userId, tenantId: TENANT, role: 'MEMBER', membershipId: member.id };
const auditorActor: JuryActor = { ok: true, userId: auditor.userId, tenantId: TENANT, role: 'AUDITOR', membershipId: auditor.id };

test('later agent run control follows a pending second execution', () => {
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
    nextLaterAgentExecution: { id: 'exec', status: 'PENDING', agent: 'CURSOR' },
  };
  const ready = projectReviewConsole(base);
  assert.equal(ready.ok && ready.screen.canRunLaterAgent, true);
  assert.equal(ready.ok && ready.screen.canHandoffLaterImprovement, false);
  const memberView = projectReviewConsole({ ...base, actor: memberActor });
  assert.equal(memberView.ok && memberView.screen.canRunLaterAgent, false);
  const reader = projectReviewConsole({ ...base, actor: auditorActor });
  assert.equal(reader.ok && reader.screen.canRunLaterAgent, false);
  const unapproved = projectReviewConsole({ ...base, nextLaterApproval: null });
  assert.equal(unapproved.ok && unapproved.screen.canRunLaterAgent, false);
  const reword = projectReviewConsole({
    ...base,
    nextLaterImprovement: { id: 'later-task', taskType: 'REWORD', status: 'OPEN' },
    nextLaterApproval: 'REWORD',
  });
  assert.equal(reword.ok && reword.screen.canRunLaterAgent, true);
  const mismatch = projectReviewConsole({ ...base, nextLaterApproval: 'REWORD' });
  assert.equal(mismatch.ok && mismatch.screen.canRunLaterAgent, false);
  const running = projectReviewConsole({
    ...base,
    nextLaterAgentExecution: { id: 'exec', status: 'RUNNING', agent: 'CURSOR' },
  });
  assert.equal(running.ok && running.screen.canRunLaterAgent, false);
  const completed = projectReviewConsole({
    ...base,
    nextLaterAgentExecution: { id: 'exec', status: 'COMPLETED', agent: 'CURSOR' },
  });
  assert.equal(completed.ok && completed.screen.canRunLaterAgent, false);
});

test('later agent execution reuses the locked lifecycle', () => {
  const source = readFileSync(path.resolve(process.cwd(), 'src/lib/jury-product/rereview-later-agent-execution.ts'), 'utf8');
  for (const token of [
    'child_process',
    'evaluateChangeGate',
    'evaluateLaterReReview',
    'noteHumanNextAction',
    'recordDecisionCycle',
    'persistImprovementAutoLoop',
    'persistReReviewAgentHandoff',
    'callFrozenReviewPipeline',
    'buildEvidencePackFromDb',
    'attachGa4Evidence',
    'timeout:',
  ]) {
    assert.equal(source.includes(token), false, token);
  }
  assert.equal(source.includes('executeReReviewAgentExecution'), true);
  assert.equal(source.includes('input.agentExecutionId'), true);
  assert.equal(source.includes('HUMAN_APPROVAL_REQUIRED'), true);
  assert.equal(source.includes('NOT_REREVIEW_IMPROVEMENT_TASK'), true);
  const executor = readFileSync(path.resolve(process.cwd(), 'src/lib/jury-product/rereview-agent-execution.ts'), 'utf8');
  assert.equal(executor.includes('advanceLockedHumanExecution'), true);
  assert.equal(executor.includes('fakeCursorAdapter'), true);
  assert.equal(executor.includes("action: 'agent.execute'"), true);
  assert.equal(executor.includes('containsSecret'), true);
  assert.equal(executor.includes('FOR UPDATE'), true);
  const actions = readFileSync(path.resolve(process.cwd(), 'src/app/(root)/jury/actions.ts'), 'utf8');
  const fn = actions.slice(
    actions.indexOf('export async function runLaterAgentExecution'),
    actions.indexOf('export async function runLaterChangeGate'),
  );
  assert.equal(fn.includes("formData.get('agentExecutionId')"), true);
  for (const key of ['tenantId', 'improvementTaskId', 'reviewResultId', 'humanDecisionId', 'changeGateResultId', 'provider', 'workspace', 'status']) {
    assert.equal(fn.includes(`formData.get('${key}')`), false, key);
  }
  const ui = readFileSync(path.resolve(process.cwd(), 'src/app/(root)/jury/ui.tsx'), 'utf8');
  const body = ui.slice(
    ui.indexOf('export function LaterAgentRunBody'),
    ui.indexOf('export function LaterChangeGateBody'),
  );
  assert.equal(body.includes('Run Agent'), true);
  assert.equal(body.includes('Agent Running'), true);
  assert.equal(body.includes('Agent Completed'), true);
  for (const label of ['Run Change Gate', 'Re-review', 'Auto Fix', 'Run Loop', 'Auto Loop', 'Send to Agent']) {
    assert.equal(body.includes(label), false, label);
  }
});

test('pending later execution completes through the existing lifecycle', { timeout: 900_000 }, async () => {
  loadEnv();
  const { prisma } = await import('@/lib/prisma');
  const liveBefore = await liveSnapshot(prisma);
  let cleanupError: string | null = null;
  try {
    await removeFixture(prisma);
    await seed(prisma);
    const verify = await prepare(prisma, 'phase68-verify');
    const reword = await prepare(prisma, 'phase68-reword');
    const concurrent = await prepare(prisma, 'phase68-concurrent');
    const missing = await prepare(prisma, 'phase68-missing');
    const wrongApproval = await prepare(prisma, 'phase68-wrong-approval');
    const gated = await prepare(prisma, 'phase68-gated');
    const lineage = await prepare(prisma, 'phase68-lineage');
    const secretRow = await prepare(prisma, 'phase68-secret');
    const foreignRow = await prepare(prisma, 'phase68-foreign-review', FOREIGN);
    const running = await prepare(prisma, 'phase68-running');
    const failed = await prepare(prisma, 'phase68-failed');

    const verifyResult = await openLater(prisma, verify, 'VERIFY', 'phase68-verify-summary');
    const rewordResult = await openLater(prisma, reword, 'REWORD', 'phase68-reword-summary');
    const concurrentResult = await openLater(prisma, concurrent, 'VERIFY', 'phase68-concurrent-summary');
    const missingResult = await openLater(prisma, missing, 'VERIFY', 'phase68-missing-summary');
    const wrongApprovalResult = await openLater(prisma, wrongApproval, 'VERIFY', 'phase68-wrong-approval-summary');
    const gatedResult = await openLater(prisma, gated, 'VERIFY', 'phase68-gated-summary');
    const lineageResult = await openLater(prisma, lineage, 'VERIFY', 'phase68-lineage-summary');
    const secretResult = await openLater(prisma, secretRow, 'VERIFY', 'phase68-secret-summary');
    const foreignResult = await openLater(prisma, foreignRow, 'VERIFY', 'phase68-foreign-summary', false, FOREIGN);
    const runningResult = await openLater(prisma, running, 'VERIFY', 'phase68-running-summary');
    const failedResult = await openLater(prisma, failed, 'VERIFY', 'phase68-failed-summary');

    const verifyTask = await openTask(verifyResult);
    const rewordTask = await openTask(rewordResult);
    const concurrentTask = await openTask(concurrentResult);
    const missingTask = await openTask(missingResult);
    const wrongApprovalTask = await openTask(wrongApprovalResult);
    const gatedTask = await openTask(gatedResult);
    const lineageTask = await openTask(lineageResult);
    const secretTask = await openTask(secretResult);
    const foreignTask = await openTask(foreignResult, foreign);
    const runningTask = await openTask(runningResult);
    const failedTask = await openTask(failedResult);

    const verifyExecution = await pendingLater(verifyTask);
    const rewordExecution = await pendingLater(rewordTask);
    const concurrentExecution = await pendingLater(concurrentTask);
    const missingExecution = await pendingLater(missingTask);
    const wrongApprovalExecution = await pendingLater(wrongApprovalTask);
    const gatedExecution = await pendingLater(gatedTask);
    const lineageExecution = await pendingLater(lineageTask);
    const secretExecution = await pendingLater(secretTask);
    const foreignExecution = await pendingLater(foreignTask, foreign);
    const runningExecution = await pendingLater(runningTask);
    const failedExecution = await pendingLater(failedTask);

    const phase60 = await prisma.juryHumanDecision.findFirst({
      where: { tenantId: TENANT, reviewResultId: wrongApproval.secondResultId },
      select: { id: true },
    });
    const wrongStored = await prisma.juryAgentExecution.findFirst({
      where: { id: wrongApprovalExecution, tenantId: TENANT },
      select: { provenance: true },
    });
    await prisma.juryHumanDecision.deleteMany({ where: { tenantId: TENANT, reviewResultId: missingResult } });
    await prisma.juryAgentExecution.update({
      where: { id: wrongApprovalExecution },
      data: { provenance: { ...(wrongStored?.provenance as object), humanDecisionId: phase60?.id ?? 'phase60-missing' } },
    });
    await prisma.juryChangeGateResult.updateMany({
      where: { id: gated.gateId, tenantId: TENANT },
      data: { status: 'GATED' },
    });
    await prisma.juryImprovementTask.updateMany({
      where: { id: lineage.sourceTaskId, tenantId: TENANT },
      data: { provenance: { kind: 'human-decision-improvement' } },
    });
    await prisma.juryAgentExecution.updateMany({
      where: { id: secretExecution, tenantId: TENANT },
      data: { inputSnapshot: { diagnosis: SECRET } },
    });
    await prisma.juryAgentExecution.updateMany({
      where: { id: runningExecution, tenantId: TENANT },
      data: { status: 'RUNNING' },
    });

    const before = await counts(prisma);
    const pendingBefore = await statusCount(prisma, 'PENDING');
    const runningBefore = await statusCount(prisma, 'RUNNING');
    const completedBefore = await statusCount(prisma, 'COMPLETED');
    const blockedBefore = await statusCount(prisma, 'BLOCKED');
    const taskBefore = await taskSnapshot(prisma, verifyTask);
    const humanBefore = await prisma.juryHumanDecision.findFirst({
      where: { tenantId: TENANT, reviewResultId: verifyResult },
      select: { id: true, decision: true, reviewResultId: true, reviewRequestId: true, actorUserId: true },
    });
    const resultBefore = await prisma.juryReviewResult.findFirst({
      where: { id: verifyResult, tenantId: TENANT },
      select: { expectedDecision: true, parentReviewResultId: true, completedAt: true },
    });
    const gateBefore = await prisma.juryChangeGateResult.findFirst({
      where: { id: verify.gateId, tenantId: TENANT },
      select: { status: true, updatedAt: true, executionId: true },
    });
    const reviewBefore = await prisma.juryChangeGateReview.findFirst({
      where: { reviewResultId: verifyResult, tenantId: TENANT },
      select: { status: true, source: true, updatedAt: true },
    });
    const evidenceBefore = await prisma.juryEvidence.findFirst({
      where: { id: EVIDENCE, tenantId: TENANT },
      select: { contentHash: true },
    });
    const sourceBefore = await prisma.juryAgentExecution.findFirst({
      where: { id: verify.executionId, tenantId: TENANT },
      select: { status: true, updatedAt: true, startedAt: true, finishedAt: true },
    });
    const waiting = await loadReviewConsole(ownerActor, verify.rootId);
    assert.equal(waiting.ok && waiting.screen.canRunLaterAgent, true);
    assert.equal(waiting.ok && waiting.screen.nextLaterAgentExecution?.status, 'PENDING');

    const memberAdapter = fakeCursorAdapter('success');
    const deniedMember = await run(verifyExecution, member, memberAdapter);
    assert.equal(deniedMember.ok, false);
    if (!deniedMember.ok) assert.equal(deniedMember.reason, 'FORBIDDEN');
    assert.equal(deniedMember.adapterCalled, false);
    assert.equal(memberAdapter.calls.length, 0);
    const auditorAdapter = fakeCursorAdapter('success');
    const deniedAuditor = await run(verifyExecution, auditor, auditorAdapter);
    assert.equal(deniedAuditor.ok, false);
    if (!deniedAuditor.ok) assert.equal(deniedAuditor.reason, 'FORBIDDEN');
    assert.equal(auditorAdapter.calls.length, 0);

    const firstExecution = await prisma.juryAgentExecution.findFirst({
      where: { taskId: verify.sourceTaskId, tenantId: TENANT },
      select: { id: true, status: true },
    });
    const firstAdapter = fakeCursorAdapter('success');
    const firstIteration = await run(firstExecution?.id ?? '', owner, firstAdapter);
    assert.equal(firstIteration.ok, false);
    if (!firstIteration.ok) assert.equal(firstIteration.reason, 'NOT_REREVIEW_IMPROVEMENT_TASK');
    assert.equal(firstAdapter.calls.length, 0);
    const sourceAdapter = fakeCursorAdapter('success');
    const sourceIteration = await run(verify.executionId, owner, sourceAdapter);
    assert.equal(sourceIteration.ok, false);
    if (!sourceIteration.ok) assert.equal(sourceIteration.reason, 'NOT_REREVIEW_IMPROVEMENT_TASK');
    assert.equal(sourceAdapter.calls.length, 0);
    const originAdapter = fakeCursorAdapter('success');
    const originIteration = await run('phase68-verify-exec', owner, originAdapter);
    assert.equal(originIteration.ok, false);
    if (!originIteration.ok) assert.equal(originIteration.reason, 'NOT_REREVIEW_IMPROVEMENT_TASK');
    assert.equal(originAdapter.calls.length, 0);

    const missingAdapter = fakeCursorAdapter('success');
    const missingRun = await run(missingExecution, owner, missingAdapter);
    assert.equal(missingRun.ok, false);
    if (!missingRun.ok) assert.equal(missingRun.reason, 'HUMAN_APPROVAL_REQUIRED');
    assert.equal(missingAdapter.calls.length, 0);
    const wrongAdapter = fakeCursorAdapter('success');
    const wrongRun = await run(wrongApprovalExecution, owner, wrongAdapter);
    assert.equal(wrongRun.ok, false);
    if (!wrongRun.ok) assert.equal(wrongRun.reason, 'HUMAN_APPROVAL_REQUIRED');
    assert.equal(wrongAdapter.calls.length, 0);
    const gatedAdapter = fakeCursorAdapter('success');
    const gatedRun = await run(gatedExecution, owner, gatedAdapter);
    assert.equal(gatedRun.ok, false);
    if (!gatedRun.ok) assert.equal(gatedRun.reason, 'NOT_REREVIEW_IMPROVEMENT_TASK');
    assert.equal(gatedAdapter.calls.length, 0);
    const lineageAdapter = fakeCursorAdapter('success');
    const lineageRun = await run(lineageExecution, owner, lineageAdapter);
    assert.equal(lineageRun.ok, false);
    if (!lineageRun.ok) assert.equal(lineageRun.reason, 'NOT_REREVIEW_IMPROVEMENT_TASK');
    assert.equal(lineageAdapter.calls.length, 0);
    const foreignAdapter = fakeCursorAdapter('success');
    const foreignRun = await run(foreignExecution, owner, foreignAdapter);
    assert.equal(foreignRun.ok, false);
    if (!foreignRun.ok) assert.equal(foreignRun.reason, 'NOT_FOUND');
    assert.equal(foreignAdapter.calls.length, 0);
    const secretAdapter = fakeCursorAdapter('success');
    const secretRun = await run(secretExecution, owner, secretAdapter);
    assert.equal(secretRun.ok, false);
    if (!secretRun.ok) assert.equal(secretRun.reason, 'SNAPSHOT_UNSAFE');
    assert.equal(secretAdapter.calls.length, 0);
    const runningAdapter = fakeCursorAdapter('success');
    const runningRun = await run(runningExecution, owner, runningAdapter);
    assert.equal(runningRun.ok, false);
    if (!runningRun.ok) assert.equal(runningRun.reason, 'ALREADY_RUNNING');
    assert.equal(runningAdapter.calls.length, 0);
    const emptyRun = await run('   ');
    assert.equal(emptyRun.ok, false);
    if (!emptyRun.ok) assert.equal(emptyRun.reason, 'NOT_FOUND');

    const verifyAdapter = fakeCursorAdapter('success');
    const opened = await run(verifyExecution, owner, verifyAdapter);
    assert.equal(opened.ok, true, opened.ok ? '' : opened.reason);
    if (opened.ok) {
      assert.equal(opened.adapterCalled, true);
      assert.equal(opened.status, 'COMPLETED');
      assert.equal(opened.agent, 'CURSOR');
      assert.equal(opened.agentExecutionId, verifyExecution);
      assert.equal(opened.reviewId, verify.rootId);
      assert.notEqual(opened.reviewId, verify.secondResultId);
    }
    assert.equal(verifyAdapter.calls.length, 1);
    const stored = await prisma.juryAgentExecution.findFirst({ where: { id: verifyExecution, tenantId: TENANT } });
    assert.equal(stored?.status, 'COMPLETED');
    assert.ok(stored?.startedAt);
    assert.ok(stored?.finishedAt);
    assert.equal((stored?.startedAt?.getTime() ?? 1) <= (stored?.finishedAt?.getTime() ?? 0), true);
    const completedProvenance = stored?.provenance as { kind?: string; humanDecisionId?: string; improvementTaskId?: string };
    assert.equal(completedProvenance.kind, 'human-agent-execution');
    assert.equal(completedProvenance.humanDecisionId, humanBefore?.id);
    assert.equal(completedProvenance.improvementTaskId, verifyTask);

    const replayAdapter = fakeCursorAdapter('success');
    const replay = await run(verifyExecution, owner, replayAdapter);
    assert.equal(replay.ok, true, replay.ok ? '' : replay.reason);
    if (replay.ok) {
      assert.equal(replay.adapterCalled, false);
      assert.equal(replay.status, 'COMPLETED');
      assert.equal(replay.agentExecutionId, verifyExecution);
    }
    assert.equal(replayAdapter.calls.length, 0);
    assert.equal(await executionsOn(prisma, verifyTask), 1);

    const rewordAdapter = fakeCursorAdapter('success');
    const reworded = await run(rewordExecution, owner, rewordAdapter);
    assert.equal(reworded.ok, true, reworded.ok ? '' : reworded.reason);
    if (reworded.ok) {
      assert.equal(reworded.adapterCalled, true);
      assert.equal(reworded.status, 'COMPLETED');
      assert.equal(reworded.reviewId, reword.rootId);
    }
    assert.equal(rewordAdapter.calls.length, 1);

    const shared = fakeCursorAdapter('success');
    const [left, right] = await Promise.all([
      run(concurrentExecution, owner, shared),
      run(concurrentExecution, owner, shared),
    ]);
    const called = [left, right].filter((row) => row.ok && row.adapterCalled).length;
    assert.equal(called, 1);
    assert.equal(shared.calls.length, 1);
    assert.equal(await executionsOn(prisma, concurrentTask), 1);
    const concurrentStored = await prisma.juryAgentExecution.findFirst({
      where: { id: concurrentExecution, tenantId: TENANT },
      select: { status: true },
    });
    assert.equal(concurrentStored?.status, 'COMPLETED');

    const failAdapter = fakeCursorAdapter('fail');
    const failRun = await run(failedExecution, owner, failAdapter);
    assert.equal(failRun.ok, true, failRun.ok ? '' : failRun.reason);
    if (failRun.ok) {
      assert.equal(failRun.adapterCalled, true);
      assert.equal(failRun.status, 'BLOCKED');
    }
    assert.equal(failAdapter.calls.length, 1);
    const failedStored = await prisma.juryAgentExecution.findFirst({
      where: { id: failedExecution, tenantId: TENANT },
      select: { status: true },
    });
    assert.equal(failedStored?.status, 'BLOCKED');
    const failedTaskRow = await prisma.juryImprovementTask.findFirst({
      where: { id: failedTask, tenantId: TENANT },
      select: { status: true },
    });
    assert.equal(failedTaskRow?.status, 'OPEN');

    assert.equal(await prisma.juryAgentExecution.findFirst({ where: { id: missingExecution }, select: { status: true } }).then((row) => row?.status), 'PENDING');
    assert.equal(await prisma.juryAgentExecution.findFirst({ where: { id: secretExecution }, select: { status: true } }).then((row) => row?.status), 'PENDING');
    assert.equal(await prisma.juryAgentExecution.findFirst({ where: { id: runningExecution }, select: { status: true } }).then((row) => row?.status), 'RUNNING');
    assert.equal(await prisma.juryAgentExecution.findFirst({ where: { id: foreignExecution }, select: { status: true } }).then((row) => row?.status), 'PENDING');
    assert.equal(sourceBefore?.status, 'COMPLETED');

    const shown = await loadReviewConsole(ownerActor, verify.rootId);
    assert.equal(shown.ok && shown.screen.nextLaterAgentExecution?.status, 'COMPLETED');
    assert.equal(shown.ok && shown.screen.canRunLaterAgent, false);
    assert.deepEqual(await taskSnapshot(prisma, verifyTask), taskBefore);
    const humanAfter = await prisma.juryHumanDecision.findFirst({
      where: { tenantId: TENANT, reviewResultId: verifyResult },
      select: { id: true, decision: true, reviewResultId: true, reviewRequestId: true, actorUserId: true },
    });
    assert.deepEqual(humanAfter, humanBefore);
    const resultAfter = await prisma.juryReviewResult.findFirst({
      where: { id: verifyResult, tenantId: TENANT },
      select: { expectedDecision: true, parentReviewResultId: true, completedAt: true },
    });
    assert.deepEqual(resultAfter, resultBefore);
    const gateAfter = await prisma.juryChangeGateResult.findFirst({
      where: { id: verify.gateId, tenantId: TENANT },
      select: { status: true, updatedAt: true, executionId: true },
    });
    assert.deepEqual(gateAfter, gateBefore);
    const reviewAfter = await prisma.juryChangeGateReview.findFirst({
      where: { reviewResultId: verifyResult, tenantId: TENANT },
      select: { status: true, source: true, updatedAt: true },
    });
    assert.deepEqual(reviewAfter, reviewBefore);
    const evidenceAfter = await prisma.juryEvidence.findFirst({
      where: { id: EVIDENCE, tenantId: TENANT },
      select: { contentHash: true },
    });
    assert.equal(evidenceAfter?.contentHash, evidenceBefore?.contentHash);
    const sourceAfter = await prisma.juryAgentExecution.findFirst({
      where: { id: verify.executionId, tenantId: TENANT },
      select: { status: true, updatedAt: true, startedAt: true, finishedAt: true },
    });
    assert.deepEqual(sourceAfter, sourceBefore);
    const after = await counts(prisma);
    assert.equal(after.executions, before.executions);
    assert.equal(after.humans, before.humans);
    assert.equal(after.results, before.results);
    assert.equal(after.tasks, before.tasks);
    assert.equal(after.gates, before.gates);
    assert.equal(after.gateReviews, before.gateReviews);
    assert.equal(after.requests, before.requests);
    assert.equal(after.evidence, before.evidence);
    assert.equal(after.cycles, 0);
    assert.equal(after.loops, 0);
    assert.equal(await statusCount(prisma, 'PENDING'), pendingBefore - 4);
    assert.equal(await statusCount(prisma, 'RUNNING'), runningBefore);
    assert.equal(await statusCount(prisma, 'COMPLETED'), completedBefore + 3);
    assert.equal(await statusCount(prisma, 'BLOCKED'), blockedBefore + 1);
    assert.equal(await executionsOn(prisma, rewordTask), 1);
    assert.equal(await executionsOn(prisma, failedTask), 1);
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

function run(
  agentExecutionId: string,
  actor: JuryMembership = owner,
  adapter = fakeCursorAdapter('success'),
) {
  return executeLaterAgentExecution({
    userId: actor.userId,
    memberships: [actor],
    agentExecutionId,
    adapter,
  });
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
  const connectionId = tenantId === TENANT ? CONN : 'phase68-foreign-conn';
  const evidenceId = tenantId === TENANT ? EVIDENCE : 'phase68-foreign-evidence';
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
    data: { id: 'phase68-foreign-conn', tenantId: FOREIGN, serviceKey: 'phase68-foreign-conn', displayName: 'phase68-foreign-conn', accessMethod: 'FILE_UPLOAD', status: 'CONNECTED', createdByUserId: foreign.userId },
  });
  await prisma.juryAccessScope.create({
    data: { id: 'phase68-scope', tenantId: TENANT, connectionId: CONN, status: 'APPROVED', grants: [], approvedByUserId: owner.userId, approvedAt: new Date(NOW) },
  });
  await prisma.juryAccessScope.create({
    data: { id: 'phase68-foreign-scope', tenantId: FOREIGN, connectionId: 'phase68-foreign-conn', status: 'APPROVED', grants: [], approvedByUserId: foreign.userId, approvedAt: new Date(NOW) },
  });
  await evidenceRow(prisma, EVIDENCE, TENANT, CONN);
  await evidenceRow(prisma, 'phase68-foreign-evidence', FOREIGN, 'phase68-foreign-conn');
  await prisma.juryNormalizedMetric.createMany({
    data: [
      metric('phase68-zero', 'userCount', 0, 'AVAILABLE'),
      metric('phase68-null', 'postsLast7d', null, 'NOT_MEASURED'),
      {
        ...metric('phase68-foreign-zero', 'userCount', 0, 'AVAILABLE'),
        tenantId: FOREIGN,
        connectionId: 'phase68-foreign-conn',
        evidenceId: 'phase68-foreign-evidence',
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
  const connectionId = tenantId === TENANT ? CONN : 'phase68-foreign-conn';
  const evidenceId = tenantId === TENANT ? EVIDENCE : 'phase68-foreign-evidence';
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
      workspaceRef: { type: 'PROJECT', ref: 'phase68-fixture' }, provenance: { kind: 'human-agent-execution' },
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
      timezone: 'Asia/Seoul', metricIds: id === EVIDENCE ? ['phase68-zero', 'phase68-null'] : ['phase68-foreign-zero'], adapterKey: 'console-declared', collectedAt: new Date(NOW),
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
    where: { username: { in: ['phase68-owner', 'phase68-member', 'phase68-auditor', 'phase68-foreign'] } },
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
