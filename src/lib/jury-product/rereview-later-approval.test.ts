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
import { approveLaterImprovement } from './rereview-later-approval';
import { persistLaterReReviewImprovement } from './rereview-later-improvement';
import { evaluateLaterReReview } from './rereview-later-review';
import { approveSecondImprovement } from './rereview-second-approval';
import { handoffSecondImprovement } from './rereview-second-handoff';
import { persistSecondReReviewImprovement } from './rereview-second-improvement';

const TENANT = 'phase66-rereview';
const FOREIGN = 'phase66-foreign';
const CONN = 'phase66-conn';
const EVIDENCE = 'phase66-evidence';
const NOW = '2026-10-04T02:40:00.000Z';
const LIVE_REVIEW = '3707202563ecae9b38f324a4eefd9243a14bc69420ed6cdda16c4c5794f62e0d';
const LIVE_CYCLE = '14308b4c999ccbe8ca54b7f31da5385385d4073c49bbf2955582a6bb96afb01e';
const SECRET = 'password=hidden postgres://db api_key=abc access_token=xyz';

const owner = membership('phase66-owner-m', TENANT, 'phase66-owner', 'OWNER');
const member = membership('phase66-member-m', TENANT, 'phase66-member', 'DEVELOPER');
const auditor = membership('phase66-auditor-m', TENANT, 'phase66-auditor', 'VIEWER');
const foreign = membership('phase66-foreign-m', FOREIGN, 'phase66-foreign', 'OWNER');
const ownerActor: JuryActor = { ok: true, userId: owner.userId, tenantId: TENANT, role: 'OWNER', membershipId: owner.id };
const memberActor: JuryActor = { ok: true, userId: member.userId, tenantId: TENANT, role: 'DEVELOPER', membershipId: member.id };
const auditorActor: JuryActor = { ok: true, userId: auditor.userId, tenantId: TENANT, role: 'VIEWER', membershipId: auditor.id };

test('later approval control follows the later task type', () => {
  const base = {
    actor: ownerActor,
    result: { id: 'original', tenantId: TENANT, expectedDecision: 'VERIFY' as const, finalSurface: face('steady'), completedAt: NOW },
    status: 'COMPLETED' as const,
    evidenceId: EVIDENCE,
    metrics: [],
    humanDecision: 'VERIFY' as const,
    nextLaterReReview: { id: 'later-review', status: 'EXECUTED', reviewResultId: 'later-result', decision: 'VERIFY' as const },
    nextLaterImprovement: { id: 'later-task', taskType: 'VERIFICATION' as const, status: 'OPEN' },
  };
  const ready = projectReviewConsole(base);
  assert.equal(ready.ok && ready.screen.canApproveLaterImprovement, true);
  assert.equal(ready.ok && ready.screen.nextLaterApproval, null);
  const memberView = projectReviewConsole({ ...base, actor: memberActor });
  assert.equal(memberView.ok && memberView.screen.canApproveLaterImprovement, true);
  const reader = projectReviewConsole({ ...base, actor: auditorActor });
  assert.equal(reader.ok && reader.screen.canApproveLaterImprovement, false);
  const reword = projectReviewConsole({
    ...base,
    nextLaterReReview: { id: 'later-review', status: 'EXECUTED', reviewResultId: 'later-result', decision: 'REWORD' },
    nextLaterImprovement: { id: 'later-task', taskType: 'REWORD', status: 'OPEN' },
  });
  assert.equal(reword.ok && reword.screen.canApproveLaterImprovement, true);
  const mismatch = projectReviewConsole({
    ...base,
    nextLaterImprovement: { id: 'later-task', taskType: 'REWORD', status: 'OPEN' },
  });
  assert.equal(mismatch.ok && mismatch.screen.canApproveLaterImprovement, false);
  const noted = projectReviewConsole({ ...base, nextLaterApproval: 'VERIFY' });
  assert.equal(noted.ok && noted.screen.canApproveLaterImprovement, false);
  assert.equal(noted.ok && noted.screen.nextLaterApproval, 'VERIFY');
  const accept = projectReviewConsole({
    ...base,
    nextLaterReReview: { id: 'later-review', status: 'EXECUTED', reviewResultId: 'later-result', decision: 'ACCEPT' },
    nextLaterImprovement: null,
  });
  assert.equal(accept.ok && accept.screen.canApproveLaterImprovement, false);
});

test('later approval reuses the human decision writer', () => {
  const source = readFileSync(path.resolve(process.cwd(), 'src/lib/jury-product/rereview-later-approval.ts'), 'utf8');
  for (const token of [
    'persistReReviewAgentHandoff',
    'handoffSecondImprovement',
    'executeReReviewAgentExecution',
    'evaluateChangeGate',
    'evaluateLaterReReview',
    'persistLaterReReviewImprovement',
    'recordDecisionCycle',
    'persistImprovementAutoLoop',
    'callFrozenReviewPipeline',
    'buildEvidencePackFromDb',
    'attachGa4Evidence',
  ]) {
    assert.equal(source.includes(token), false, token);
  }
  assert.equal(source.includes('noteHumanNextAction'), true);
  assert.equal(source.includes('input.improvementTaskId'), true);
  assert.equal(source.includes('NOT_REREVIEW_IMPROVEMENT_TASK'), true);
  assert.equal(source.includes('HUMAN_APPROVAL_REQUIRED'), true);
  const writer = readFileSync(path.resolve(process.cwd(), 'src/lib/jury-product/review-console.ts'), 'utf8');
  assert.equal(writer.includes("action: 'review.start'"), true);
  assert.equal(writer.includes('HUMAN_DECISION_RECORDED'), true);
  assert.equal(writer.includes('FOR UPDATE'), true);
  const actions = readFileSync(path.resolve(process.cwd(), 'src/app/(root)/jury/actions.ts'), 'utf8');
  const fn = actions.slice(
    actions.indexOf('export async function approveLaterImprovementTask'),
    actions.indexOf('export async function handoffLaterImprovementTask'),
  );
  assert.equal(fn.includes("formData.get('improvementTaskId')"), true);
  for (const key of ['tenantId', 'reviewResultId', 'humanDecisionId', 'parentTaskId', 'agentExecutionId', 'changeGateResultId', 'reReviewResultId']) {
    assert.equal(fn.includes(`formData.get('${key}')`), false, key);
  }
  const ui = readFileSync(path.resolve(process.cwd(), 'src/app/(root)/jury/ui.tsx'), 'utf8');
  const body = ui.slice(
    ui.indexOf('export function LaterImprovementApprovalBody'),
    ui.indexOf('export function LaterImprovementHandoffBody'),
  );
  assert.equal(body.includes('Approve for Agent'), true);
  assert.equal(body.includes('Approved for Agent'), true);
  assert.equal(body.includes('Human Approval:'), true);
  for (const label of ['Send to Agent', 'Run Agent', 'Run Change Gate', 'Run Re-review', 'Next Improvement', 'Auto Fix', 'Run Loop']) {
    assert.equal(body.includes(label), false, label);
  }
});

test('later improvement approval records one human decision and stops', { timeout: 720_000 }, async () => {
  loadEnv();
  const { prisma } = await import('@/lib/prisma');
  const liveBefore = await liveSnapshot(prisma);
  let cleanupError: string | null = null;
  try {
    await removeFixture(prisma);
    await seed(prisma);
    const verify = await prepare(prisma, 'phase66-verify');
    const reword = await prepare(prisma, 'phase66-reword');
    const accepted = await prepare(prisma, 'phase66-accept');
    const concurrentVerify = await prepare(prisma, 'phase66-cverify');
    const concurrentReword = await prepare(prisma, 'phase66-creword');
    const lock = await prepare(prisma, 'phase66-lock');
    const lockBack = await prepare(prisma, 'phase66-lockback');
    const conflict = await prepare(prisma, 'phase66-conflict');
    const lineage = await prepare(prisma, 'phase66-lineage');
    const status = await prepare(prisma, 'phase66-status');
    const gated = await prepare(prisma, 'phase66-gated');
    const noReview = await prepare(prisma, 'phase66-noreview');
    const wrong = await prepare(prisma, 'phase66-wrong');
    const foreignRow = await prepare(prisma, 'phase66-foreign-review', FOREIGN);

    const verifyResult = await openLater(prisma, verify, 'VERIFY', 'phase66-verify-summary', true);
    const rewordResult = await openLater(prisma, reword, 'REWORD', 'phase66-reword-summary');
    const acceptedResult = await openLater(prisma, accepted, 'ACCEPT', 'phase66-accept-summary');
    const concurrentVerifyResult = await openLater(prisma, concurrentVerify, 'VERIFY', 'phase66-cverify-summary');
    const concurrentRewordResult = await openLater(prisma, concurrentReword, 'REWORD', 'phase66-creword-summary');
    const lockResult = await openLater(prisma, lock, 'VERIFY', 'phase66-lock-summary');
    const lockBackResult = await openLater(prisma, lockBack, 'REWORD', 'phase66-lockback-summary');
    const conflictResult = await openLater(prisma, conflict, 'VERIFY', 'phase66-conflict-summary');
    const lineageResult = await openLater(prisma, lineage, 'VERIFY', 'phase66-lineage-summary');
    const statusResult = await openLater(prisma, status, 'VERIFY', 'phase66-status-summary');
    const gatedResult = await openLater(prisma, gated, 'VERIFY', 'phase66-gated-summary');
    const noReviewResult = await openLater(prisma, noReview, 'VERIFY', 'phase66-noreview-summary');
    const wrongResult = await openLater(prisma, wrong, 'VERIFY', 'phase66-wrong-summary');
    const foreignResult = await openLater(prisma, foreignRow, 'VERIFY', 'phase66-foreign-summary', false, FOREIGN);

    const verifyTask = await openTask(verifyResult);
    const rewordTask = await openTask(rewordResult);
    const concurrentVerifyTask = await openTask(concurrentVerifyResult);
    const concurrentRewordTask = await openTask(concurrentRewordResult);
    const lockTask = await openTask(lockResult);
    const lockBackTask = await openTask(lockBackResult);
    const conflictTask = await openTask(conflictResult);
    const lineageTask = await openTask(lineageResult);
    const statusTask = await openTask(statusResult);
    const gatedTask = await openTask(gatedResult);
    const noReviewTask = await openTask(noReviewResult);
    const wrongTask = await openTask(wrongResult);
    const foreignTask = await openTask(foreignResult, foreign);

    await prisma.juryImprovementTask.updateMany({
      where: { id: verifyTask, tenantId: TENANT },
      data: { diagnosis: SECRET },
    });
    await prisma.juryImprovementTask.updateMany({
      where: { id: lineage.sourceTaskId, tenantId: TENANT },
      data: { provenance: { kind: 'human-decision-improvement' } },
    });
    await prisma.juryAgentExecution.updateMany({
      where: { id: status.executionId, tenantId: TENANT },
      data: { status: 'PENDING' },
    });
    await prisma.juryChangeGateResult.updateMany({
      where: { id: gated.gateId, tenantId: TENANT },
      data: { status: 'GATED', gate: 'NEEDS_APPROVAL', errorCode: 'AGENT_REPORTED_FILE_NOT_FOUND_IN_WORKSPACE' },
    });
    await prisma.juryChangeGateReview.updateMany({
      where: { reviewResultId: noReviewResult, tenantId: TENANT },
      data: { status: 'FAILED' },
    });
    await prisma.juryImprovementTask.updateMany({
      where: { id: wrongTask, tenantId: TENANT },
      data: { reviewResultId: wrong.rootId },
    });

    const before = await counts(prisma);
    const decisionAuditsBefore = await decisionAudits(prisma);
    const metricsBefore = await metricSnapshot(prisma);
    const evidenceBefore = await prisma.juryEvidence.findFirst({
      where: { id: EVIDENCE, tenantId: TENANT },
      select: { contentHash: true },
    });
    const taskBefore = await taskSnapshot(prisma, verifyTask);
    const waiting = await loadReviewConsole(ownerActor, verify.rootId);
    assert.equal(waiting.ok && waiting.screen.canApproveLaterImprovement, true);
    assert.equal(waiting.ok && waiting.screen.nextLaterApproval, null);
    const memberWaiting = await loadReviewConsole(memberActor, verify.rootId);
    assert.equal(memberWaiting.ok && memberWaiting.screen.canApproveLaterImprovement, true);
    const auditorWaiting = await loadReviewConsole(auditorActor, verify.rootId);
    assert.equal(auditorWaiting.ok && auditorWaiting.screen.canApproveLaterImprovement, false);

    const deniedAuditor = await approve(verifyTask, auditor);
    assert.equal(deniedAuditor.ok, false);
    if (!deniedAuditor.ok) assert.equal(deniedAuditor.reason, 'FORBIDDEN');
    const phase60Attempt = await approveSecondImprovement({ userId: owner.userId, memberships: [owner], improvementTaskId: verifyTask });
    assert.equal(phase60Attempt.ok, false);
    if (!phase60Attempt.ok) assert.equal(phase60Attempt.reason, 'NOT_REREVIEW_IMPROVEMENT_TASK');

    const missingAccept = await approve(reReviewImprovementTaskId(TENANT, acceptedResult));
    assert.equal(missingAccept.ok, false);
    if (!missingAccept.ok) assert.equal(missingAccept.reason, 'NOT_FOUND');
    const acceptPrevious = await approve(accepted.taskId);
    assert.equal(acceptPrevious.ok, false);
    if (!acceptPrevious.ok) assert.equal(acceptPrevious.reason, 'NOT_REREVIEW_IMPROVEMENT_TASK');
    assert.equal(await humansOn(prisma, acceptedResult), 0);

    const firstIteration = await approve(verify.sourceTaskId);
    assert.equal(firstIteration.ok, false);
    if (!firstIteration.ok) assert.equal(firstIteration.reason, 'NOT_REREVIEW_IMPROVEMENT_TASK');
    const previousIteration = await approve(verify.taskId);
    assert.equal(previousIteration.ok, false);
    if (!previousIteration.ok) assert.equal(previousIteration.reason, 'NOT_REREVIEW_IMPROVEMENT_TASK');
    const rootTask = await approve(verify.originTaskId);
    assert.equal(rootTask.ok, false);
    if (!rootTask.ok) assert.equal(rootTask.reason, 'NOT_REREVIEW_IMPROVEMENT_TASK');

    const opened = await approve(verifyTask, member);
    assert.equal(opened.ok, true, opened.ok ? '' : opened.reason);
    if (opened.ok) {
      assert.equal(opened.created, true);
      assert.equal(opened.decision, 'VERIFY');
      assert.equal(opened.reReviewResultId, verifyResult);
      assert.equal(opened.reviewId, verify.rootId);
      assert.notEqual(opened.reviewId, verify.firstResultId);
      assert.notEqual(opened.reviewId, verify.secondResultId);
    }
    const replay = await approve(verifyTask, owner);
    assert.equal(replay.ok, true);
    if (replay.ok) {
      assert.equal(replay.created, false);
      assert.equal(replay.decision, 'VERIFY');
    }
    const noted = await loadReviewConsole(ownerActor, verify.rootId);
    assert.equal(noted.ok && noted.screen.nextLaterApproval, 'VERIFY');
    assert.equal(noted.ok && noted.screen.canApproveLaterImprovement, false);
    assert.equal(noted.ok && noted.screen.nextLaterImprovement?.status, 'OPEN');

    const reworded = await approve(rewordTask, owner);
    assert.equal(reworded.ok, true, reworded.ok ? '' : reworded.reason);
    if (reworded.ok) {
      assert.equal(reworded.created, true);
      assert.equal(reworded.decision, 'REWORD');
      assert.equal(reworded.reviewId, reword.rootId);
    }
    const rewordReplay = await approve(rewordTask, member);
    assert.equal(rewordReplay.ok, true);
    if (rewordReplay.ok) assert.equal(rewordReplay.created, false);

    const [leftVerify, rightVerify] = await Promise.all([approve(concurrentVerifyTask), approve(concurrentVerifyTask, member)]);
    assert.equal(leftVerify.ok && rightVerify.ok, true);
    if (leftVerify.ok && rightVerify.ok) {
      assert.equal(leftVerify.created !== rightVerify.created, true);
      assert.equal(leftVerify.decision, 'VERIFY');
      assert.equal(rightVerify.decision, 'VERIFY');
    }
    const [leftReword, rightReword] = await Promise.all([approve(concurrentRewordTask), approve(concurrentRewordTask, member)]);
    assert.equal(leftReword.ok && rightReword.ok, true);
    if (leftReword.ok && rightReword.ok) assert.equal(leftReword.created !== rightReword.created, true);

    const lockedFirst = await approve(lockTask);
    assert.equal(lockedFirst.ok, true, lockedFirst.ok ? '' : lockedFirst.reason);
    await prisma.juryReviewResult.updateMany({
      where: { id: lockResult, tenantId: TENANT },
      data: { expectedDecision: 'REWORD' },
    });
    await prisma.juryImprovementTask.updateMany({
      where: { id: lockTask, tenantId: TENANT },
      data: { taskType: 'REWORD' },
    });
    const lockedSecond = await approve(lockTask);
    assert.equal(lockedSecond.ok, false);
    if (!lockedSecond.ok) assert.equal(lockedSecond.reason, 'HUMAN_APPROVAL_REQUIRED');

    const lockedBackFirst = await approve(lockBackTask);
    assert.equal(lockedBackFirst.ok, true, lockedBackFirst.ok ? '' : lockedBackFirst.reason);
    await prisma.juryReviewResult.updateMany({
      where: { id: lockBackResult, tenantId: TENANT },
      data: { expectedDecision: 'VERIFY' },
    });
    await prisma.juryImprovementTask.updateMany({
      where: { id: lockBackTask, tenantId: TENANT },
      data: { taskType: 'VERIFICATION' },
    });
    const lockedBackSecond = await approve(lockBackTask);
    assert.equal(lockedBackSecond.ok, false);
    if (!lockedBackSecond.ok) assert.equal(lockedBackSecond.reason, 'HUMAN_APPROVAL_REQUIRED');

    await prisma.juryImprovementTask.updateMany({
      where: { id: conflictTask, tenantId: TENANT },
      data: { taskType: 'REWORD' },
    });
    const mismatched = await approve(conflictTask);
    assert.equal(mismatched.ok, false);
    if (!mismatched.ok) assert.equal(mismatched.reason, 'NOT_REREVIEW_IMPROVEMENT_TASK');
    await prisma.juryImprovementTask.updateMany({
      where: { id: conflictTask, tenantId: TENANT },
      data: { taskType: 'VERIFICATION' },
    });
    const conflictWinner = await approve(conflictTask);
    assert.equal(conflictWinner.ok, true, conflictWinner.ok ? '' : conflictWinner.reason);
    await prisma.juryReviewResult.updateMany({
      where: { id: conflictResult, tenantId: TENANT },
      data: { expectedDecision: 'REWORD' },
    });
    await prisma.juryImprovementTask.updateMany({
      where: { id: conflictTask, tenantId: TENANT },
      data: { taskType: 'REWORD' },
    });
    const [conflictLeft, conflictRight] = await Promise.all([approve(conflictTask), approve(conflictTask, member)]);
    assert.equal(conflictLeft.ok, false);
    assert.equal(conflictRight.ok, false);
    if (!conflictLeft.ok) assert.equal(conflictLeft.reason, 'HUMAN_APPROVAL_REQUIRED');
    if (!conflictRight.ok) assert.equal(conflictRight.reason, 'HUMAN_APPROVAL_REQUIRED');

    const brokenLineage = await approve(lineageTask);
    assert.equal(brokenLineage.ok, false);
    if (!brokenLineage.ok) assert.equal(brokenLineage.reason, 'NOT_REREVIEW_IMPROVEMENT_TASK');
    const pendingExecution = await approve(statusTask);
    assert.equal(pendingExecution.ok, false);
    if (!pendingExecution.ok) assert.equal(pendingExecution.reason, 'NOT_REREVIEW_IMPROVEMENT_TASK');
    const gatedApproval = await approve(gatedTask);
    assert.equal(gatedApproval.ok, false);
    if (!gatedApproval.ok) assert.equal(gatedApproval.reason, 'NOT_REREVIEW_IMPROVEMENT_TASK');
    const missingReview = await approve(noReviewTask);
    assert.equal(missingReview.ok, false);
    if (!missingReview.ok) assert.equal(missingReview.reason, 'NOT_REREVIEW_IMPROVEMENT_TASK');
    const wrongReview = await approve(wrongTask);
    assert.equal(wrongReview.ok, false);
    if (!wrongReview.ok) assert.equal(wrongReview.reason, 'NOT_REREVIEW_IMPROVEMENT_TASK');
    const crossTenant = await approve(foreignTask);
    assert.equal(crossTenant.ok, false);
    if (!crossTenant.ok) assert.equal(crossTenant.reason, 'NOT_FOUND');

    const current = await prisma.juryHumanDecision.findFirst({ where: { tenantId: TENANT, reviewResultId: verifyResult } });
    const phase60 = await prisma.juryHumanDecision.findFirst({ where: { tenantId: TENANT, reviewResultId: verify.secondResultId } });
    const phase55 = await prisma.juryHumanDecision.findFirst({ where: { tenantId: TENANT, reviewResultId: verify.firstResultId } });
    const rootHuman = await prisma.juryHumanDecision.findFirst({ where: { tenantId: TENANT, reviewResultId: verify.rootId } });
    assert.equal(current?.decision, 'VERIFY');
    assert.ok(current && phase60 && phase55 && rootHuman);
    assert.notEqual(current?.id, phase60?.id);
    assert.notEqual(current?.id, phase55?.id);
    assert.notEqual(current?.id, rootHuman?.id);
    assert.equal(await humansOn(prisma, verifyResult), 1);
    assert.equal(await humansOn(prisma, rewordResult), 1);
    assert.equal(await humansOn(prisma, lockResult), 1);
    assert.equal(await humansOn(prisma, lockBackResult), 1);
    assert.equal(await humansOn(prisma, conflictResult), 1);
    assert.equal(await humansOn(prisma, concurrentVerifyResult), 1);
    assert.equal(await humansOn(prisma, concurrentRewordResult), 1);
    assert.equal(await humansOn(prisma, acceptedResult), 0);
    assert.equal(await humansOn(prisma, lineageResult), 0);
    assert.equal(await humansOn(prisma, statusResult), 0);
    assert.equal(await humansOn(prisma, gatedResult), 0);
    assert.equal(await humansOn(prisma, noReviewResult), 0);
    assert.equal(await humansOn(prisma, wrongResult), 0);
    assert.equal(await humansOn(prisma, foreignResult), 0);
    const lockHuman = await prisma.juryHumanDecision.findFirst({ where: { tenantId: TENANT, reviewResultId: lockResult } });
    const lockBackHuman = await prisma.juryHumanDecision.findFirst({ where: { tenantId: TENANT, reviewResultId: lockBackResult } });
    const conflictHuman = await prisma.juryHumanDecision.findFirst({ where: { tenantId: TENANT, reviewResultId: conflictResult } });
    const rewordHuman = await prisma.juryHumanDecision.findFirst({ where: { tenantId: TENANT, reviewResultId: rewordResult } });
    assert.equal(lockHuman?.decision, 'VERIFY');
    assert.equal(lockBackHuman?.decision, 'REWORD');
    assert.equal(conflictHuman?.decision, 'VERIFY');
    assert.equal(rewordHuman?.decision, 'REWORD');
    assert.equal(await decisionAuditsOn(prisma, verifyResult), 1);
    assert.equal(await decisionAuditsOn(prisma, rewordResult), 1);
    assert.equal(await decisionAuditsOn(prisma, acceptedResult), 0);
    assert.equal(await decisionAuditsOn(prisma, lineageResult), 0);

    const stored = JSON.stringify({
      human: current,
      audit: await prisma.juryAuditEvent.findMany({ where: { tenantId: TENANT, reviewId: verifyResult, action: 'HUMAN_DECISION_RECORDED' } }),
    });
    for (const secret of ['password', 'postgres://', 'api_key', 'access_token']) {
      assert.equal(stored.includes(secret), false, secret);
    }
    assert.deepEqual(await taskSnapshot(prisma, verifyTask), taskBefore);
    const evidenceAfter = await prisma.juryEvidence.findFirst({
      where: { id: EVIDENCE, tenantId: TENANT },
      select: { contentHash: true },
    });
    assert.equal(evidenceAfter?.contentHash, evidenceBefore?.contentHash);
    assert.deepEqual(await metricSnapshot(prisma), metricsBefore);
    const after = await counts(prisma);
    assert.equal(after.humans, before.humans + 7);
    assert.equal(await decisionAudits(prisma), decisionAuditsBefore + 7);
    assert.equal(after.results, before.results);
    assert.equal(after.tasks, before.tasks);
    assert.equal(after.executions, before.executions);
    assert.equal(after.gates, before.gates);
    assert.equal(after.gateReviews, before.gateReviews);
    assert.equal(after.requests, before.requests);
    assert.equal(after.evidence, before.evidence);
    assert.equal(after.cycles, 0);
    assert.equal(after.loops, 0);
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
  const connectionId = tenantId === TENANT ? CONN : 'phase66-foreign-conn';
  const evidenceId = tenantId === TENANT ? EVIDENCE : 'phase66-foreign-evidence';
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
      id: requestId, tenantId, connectionId, evidenceId, reviewType: 'FULL_REVIEW', claim: '측정된 범위의 문구만 사용한다.',
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
    data: { id: 'phase66-foreign-conn', tenantId: FOREIGN, serviceKey: 'phase66-foreign-conn', displayName: 'phase66-foreign-conn', accessMethod: 'FILE_UPLOAD', status: 'CONNECTED', createdByUserId: foreign.userId },
  });
  await prisma.juryAccessScope.create({
    data: { id: 'phase66-scope', tenantId: TENANT, connectionId: CONN, status: 'APPROVED', grants: [], approvedByUserId: owner.userId, approvedAt: new Date(NOW) },
  });
  await prisma.juryAccessScope.create({
    data: { id: 'phase66-foreign-scope', tenantId: FOREIGN, connectionId: 'phase66-foreign-conn', status: 'APPROVED', grants: [], approvedByUserId: foreign.userId, approvedAt: new Date(NOW) },
  });
  await evidenceRow(prisma, EVIDENCE, TENANT, CONN);
  await evidenceRow(prisma, 'phase66-foreign-evidence', FOREIGN, 'phase66-foreign-conn');
  await prisma.juryNormalizedMetric.createMany({
    data: [
      metric('phase66-zero', 'userCount', 0, 'AVAILABLE'),
      metric('phase66-null', 'postsLast7d', null, 'NOT_MEASURED'),
      {
        ...metric('phase66-foreign-zero', 'userCount', 0, 'AVAILABLE'),
        tenantId: FOREIGN,
        connectionId: 'phase66-foreign-conn',
        evidenceId: 'phase66-foreign-evidence',
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
  const connectionId = tenantId === TENANT ? CONN : 'phase66-foreign-conn';
  const evidenceId = tenantId === TENANT ? EVIDENCE : 'phase66-foreign-evidence';
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
      workspaceRef: { type: 'PROJECT', ref: 'phase66-fixture' }, provenance: { kind: 'human-agent-execution' },
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
      timezone: 'Asia/Seoul', metricIds: id === EVIDENCE ? ['phase66-zero', 'phase66-null'] : ['phase66-foreign-zero'], adapterKey: 'console-declared', collectedAt: new Date(NOW),
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
  await prisma.juryAccessScope.deleteMany({ where });
  await prisma.juryServiceConnection.deleteMany({ where });
  await prisma.juryMembership.deleteMany({ where });
  await prisma.juryTenant.deleteMany({ where: { id: { in: tenants } } });
  await prisma.user.deleteMany({
    where: { username: { in: ['phase66-owner', 'phase66-member', 'phase66-auditor', 'phase66-foreign'] } },
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
