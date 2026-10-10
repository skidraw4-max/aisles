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
import { handoffLaterImprovement } from './rereview-later-handoff';
import { persistLaterReReviewImprovement } from './rereview-later-improvement';
import { evaluateLaterReReview } from './rereview-later-review';
import { evaluateFollowingReReview } from './rereview-following-review';
import { approveSecondImprovement } from './rereview-second-approval';
import { handoffSecondImprovement } from './rereview-second-handoff';
import { persistSecondReReviewImprovement } from './rereview-second-improvement';

const TENANT = 'phase70-rereview';
const FOREIGN = 'phase70-foreign';
const CONN = 'phase70-conn';
const EVIDENCE = 'phase70-evidence';
const NOW = '2026-10-04T10:46:00.000Z';
const SECRET = 'password=hidden postgres://db api_key=abc access_token=xyz';
const LIVE_REVIEW = '3707202563ecae9b38f324a4eefd9243a14bc69420ed6cdda16c4c5794f62e0d';
const LIVE_CYCLE = '14308b4c999ccbe8ca54b7f31da5385385d4073c49bbf2955582a6bb96afb01e';

const owner = membership('phase70-owner-m', TENANT, 'phase70-owner', 'OWNER');
const member = membership('phase70-member-m', TENANT, 'phase70-member', 'DEVELOPER');
const auditor = membership('phase70-auditor-m', TENANT, 'phase70-auditor', 'VIEWER');
const foreign = membership('phase70-foreign-m', FOREIGN, 'phase70-foreign', 'OWNER');
const ownerActor: JuryActor = { ok: true, userId: owner.userId, tenantId: TENANT, role: 'OWNER', membershipId: owner.id };
const memberActor: JuryActor = { ok: true, userId: member.userId, tenantId: TENANT, role: 'DEVELOPER', membershipId: member.id };
const auditorActor: JuryActor = { ok: true, userId: auditor.userId, tenantId: TENANT, role: 'VIEWER', membershipId: auditor.id };

test('following re-review control follows an approved later change gate', () => {
  const surface = face('steady');
  const base = {
    actor: ownerActor,
    result: { id: 'original', tenantId: TENANT, expectedDecision: 'VERIFY' as const, finalSurface: surface, completedAt: NOW },
    status: 'COMPLETED' as const,
    evidenceId: EVIDENCE,
    metrics: [],
    humanDecision: 'VERIFY' as const,
    nextLaterReReview: { id: 'later-review', status: 'EXECUTED', reviewResultId: 'later-result', decision: 'VERIFY' as const },
    nextLaterImprovement: { id: 'later-task', taskType: 'VERIFICATION' as const, status: 'OPEN' },
    nextLaterApproval: 'VERIFY' as const,
    nextLaterAgentExecution: { id: 'exec', status: 'COMPLETED', agent: 'CURSOR' },
    nextLaterChangeGate: { id: 'gate', status: 'APPROVED', errorCode: null },
  };
  const ready = projectReviewConsole(base);
  assert.equal(ready.ok && ready.screen.canRunFollowingReReview, true);
  assert.equal(ready.ok && ready.screen.canRunLaterChangeGate, false);
  const memberView = projectReviewConsole({ ...base, actor: memberActor });
  assert.equal(memberView.ok && memberView.screen.canRunFollowingReReview, true);
  const reader = projectReviewConsole({ ...base, actor: auditorActor });
  assert.equal(reader.ok && reader.screen.canRunFollowingReReview, false);
  const pending = projectReviewConsole({
    ...base,
    nextLaterAgentExecution: { id: 'exec', status: 'PENDING', agent: 'CURSOR' },
  });
  assert.equal(pending.ok && pending.screen.canRunFollowingReReview, false);
  const gated = projectReviewConsole({
    ...base,
    nextLaterChangeGate: { id: 'gate', status: 'GATED', errorCode: null },
  });
  assert.equal(gated.ok && gated.screen.canRunFollowingReReview, false);
  const blocked = projectReviewConsole({
    ...base,
    nextLaterChangeGate: { id: 'gate', status: 'BLOCKED', errorCode: 'NO_CHANGES' },
  });
  assert.equal(blocked.ok && blocked.screen.canRunFollowingReReview, false);
  const done = projectReviewConsole({
    ...base,
    nextFollowingReReview: {
      id: 'review',
      status: 'EXECUTED',
      reviewResultId: 'child',
      decision: 'VERIFY',
      surface,
    },
  });
  assert.equal(done.ok && done.screen.canRunFollowingReReview, false);
  assert.equal(done.ok && done.screen.nextFollowingReReview?.decision, 'VERIFY');
  assert.equal(done.ok && done.screen.nextFollowingReReview?.surface?.statusSummary, 'steady');
});

test('following re-review reuses the existing change-gate review lifecycle', () => {
  const source = readFileSync(path.resolve(process.cwd(), 'src/lib/jury-product/rereview-following-review.ts'), 'utf8');
  for (const token of [
    'evaluateChangeGate',
    'evaluateImprovementChangeScope',
    'recordHumanChangeGate',
    'persistLaterReReviewImprovement',
    'persistSecondReReviewImprovement',
    'noteHumanNextAction',
    'recordDecisionCycle',
    'persistImprovementAutoLoop',
    'callFrozenReviewPipeline',
    'buildEvidencePackFromDb',
    'attachGa4Evidence',
    'child_process',
    'inspectAllowlistedWorkspace',
    'fakeCursorAdapter',
    'timeout:',
  ]) {
    assert.equal(source.includes(token), false, token);
  }
  assert.equal(source.includes('evaluateSecondReReview'), true);
  assert.equal(source.includes("action: 'review.start'"), true);
  assert.equal(source.includes('input.agentExecutionId'), true);
  assert.equal(source.includes('HUMAN_APPROVAL_REQUIRED'), true);
  assert.equal(source.includes('EXECUTION_NOT_COMPLETED'), true);
  const reused = readFileSync(path.resolve(process.cwd(), 'src/lib/jury-product/rereview-second-review.ts'), 'utf8');
  assert.equal(reused.includes('persistChangeGateReReviewRequest'), true);
  assert.equal(reused.includes('persistChangeGateReReviewExecution'), true);
  const actions = readFileSync(path.resolve(process.cwd(), 'src/app/(root)/jury/actions.ts'), 'utf8');
  const fn = actions.slice(actions.indexOf('export async function runFollowingReReview'));
  assert.equal(fn.includes("formData.get('agentExecutionId')"), true);
  for (const key of ['tenantId', 'improvementTaskId', 'reviewResultId', 'humanDecisionId', 'changeGateResultId', 'provider', 'workspace', 'status', 'decision']) {
    assert.equal(fn.includes(`formData.get('${key}')`), false, key);
  }
  const ui = readFileSync(path.resolve(process.cwd(), 'src/app/(root)/jury/ui.tsx'), 'utf8');
  const body = ui.slice(ui.indexOf('export function FollowingReReviewBody'));
  assert.equal(body.includes('Run Re-review'), true);
  assert.equal(body.includes('statusSummary'), true);
  assert.equal(body.includes('topProblems'), true);
  assert.equal(body.includes('expectedUserEffect'), true);
  assert.equal(body.includes('supportedClaims'), true);
  assert.equal(body.includes('partiallySupportedClaims'), true);
  assert.equal(body.includes('hypotheses'), true);
  for (const label of ['Create Improvement Task', 'Approve Improvement', 'Send to Agent', 'Run Agent', 'Run Change Gate', 'Auto Fix', 'Run Loop', 'Auto Loop']) {
    assert.equal(body.includes(label), false, label);
  }
});

test('approved following change gate reaches one re-review', { timeout: 900_000 }, async () => {
  loadEnv();
  const { prisma } = await import('@/lib/prisma');
  const liveBefore = await liveSnapshot(prisma);
  let cores = 0;
  const stub = (decision: JuryDecision): ProductReviewCore => async () => {
    cores += 1;
    return {
      boardRunId: `run-phase70-${decision.toLowerCase()}-${cores}`,
      evidenceStrength: 'strong',
      claimStrength: 'weak',
      conflictDetected: false,
      overclaimDetected: false,
      revisionRequired: decision === 'REWORD',
      expectedDecision: decision,
      finalSurface: face(decision),
      completedAt: NOW,
    };
  };
  let cleanupError: string | null = null;
  try {
    await removeFixture(prisma);
    await seed(prisma);
    const approved = await prepare(prisma, 'phase70-approved');
    const accepted = await prepare(prisma, 'phase70-accept');
    const verified = await prepare(prisma, 'phase70-verify');
    const reworded = await prepare(prisma, 'phase70-reword');
    const concurrent = await prepare(prisma, 'phase70-concurrent');
    const gated = await prepare(prisma, 'phase70-gated');
    const blocked = await prepare(prisma, 'phase70-blocked');
    const missing = await prepare(prisma, 'phase70-missing');
    const wrong = await prepare(prisma, 'phase70-wrong');
    const mismatch = await prepare(prisma, 'phase70-mismatch');
    const status = await prepare(prisma, 'phase70-status');
    const lineage = await prepare(prisma, 'phase70-lineage');
    const foreignRow = await prepare(prisma, 'phase70-foreign-review', FOREIGN);

    const approvedResult = await openLater(prisma, approved, 'VERIFY', 'phase70-approved-summary');
    const acceptedResult = await openLater(prisma, accepted, 'VERIFY', 'phase70-accept-summary');
    const verifiedResult = await openLater(prisma, verified, 'VERIFY', 'phase70-verify-summary');
    const rewordedResult = await openLater(prisma, reworded, 'VERIFY', 'phase70-reword-summary');
    const concurrentResult = await openLater(prisma, concurrent, 'VERIFY', 'phase70-concurrent-summary');
    const gatedResult = await openLater(prisma, gated, 'VERIFY', 'phase70-gated-summary');
    const blockedResult = await openLater(prisma, blocked, 'VERIFY', 'phase70-blocked-summary');
    const missingResult = await openLater(prisma, missing, 'VERIFY', 'phase70-missing-summary');
    const wrongResult = await openLater(prisma, wrong, 'VERIFY', 'phase70-wrong-summary');
    const mismatchResult = await openLater(prisma, mismatch, 'VERIFY', 'phase70-mismatch-summary');
    const statusResult = await openLater(prisma, status, 'VERIFY', 'phase70-status-summary');
    const lineageResult = await openLater(prisma, lineage, 'VERIFY', 'phase70-lineage-summary');
    const foreignResult = await openLater(prisma, foreignRow, 'VERIFY', 'phase70-foreign-summary', false, FOREIGN);

    const approvedTask = await openTask(approvedResult);
    const acceptedTask = await openTask(acceptedResult);
    const verifiedTask = await openTask(verifiedResult);
    const rewordedTask = await openTask(rewordedResult);
    const concurrentTask = await openTask(concurrentResult);
    const gatedTask = await openTask(gatedResult);
    const blockedTask = await openTask(blockedResult);
    const missingTask = await openTask(missingResult);
    const wrongTask = await openTask(wrongResult);
    const mismatchTask = await openTask(mismatchResult);
    const statusTask = await openTask(statusResult);
    const lineageTask = await openTask(lineageResult);
    const foreignTask = await openTask(foreignResult, foreign);

    const approvedExecution = await pendingLater(approvedTask);
    const acceptedExecution = await pendingLater(acceptedTask);
    const verifiedExecution = await pendingLater(verifiedTask);
    const rewordedExecution = await pendingLater(rewordedTask);
    const concurrentExecution = await pendingLater(concurrentTask);
    const gatedExecution = await pendingLater(gatedTask);
    const blockedExecution = await pendingLater(blockedTask);
    const missingExecution = await pendingLater(missingTask);
    const wrongExecution = await pendingLater(wrongTask);
    const mismatchExecution = await pendingLater(mismatchTask);
    const statusExecution = await pendingLater(statusTask);
    const lineageExecution = await pendingLater(lineageTask);
    const foreignExecution = await pendingLater(foreignTask, foreign);

    await completeLater(prisma, approvedExecution, approvedTask, approvedResult, 'empty');
    await completeLater(prisma, acceptedExecution, acceptedTask, acceptedResult, 'empty');
    await completeLater(prisma, verifiedExecution, verifiedTask, verifiedResult, 'empty');
    await completeLater(prisma, rewordedExecution, rewordedTask, rewordedResult, 'empty');
    await completeLater(prisma, concurrentExecution, concurrentTask, concurrentResult, 'empty');
    await completeLater(prisma, gatedExecution, gatedTask, gatedResult, 'empty');
    await completeLater(prisma, blockedExecution, blockedTask, blockedResult, 'empty');
    await completeLater(prisma, missingExecution, missingTask, missingResult, 'empty');
    await completeLater(prisma, wrongExecution, wrongTask, wrongResult, 'empty');
    await completeLater(prisma, mismatchExecution, mismatchTask, mismatchResult, 'empty');
    await completeLater(prisma, lineageExecution, lineageTask, lineageResult, 'empty');
    await completeLater(prisma, foreignExecution, foreignTask, foreignResult, 'empty', FOREIGN);

    await plantGate(prisma, approvedExecution, approvedTask, 'APPROVED', 'PASS');
    await plantGate(prisma, acceptedExecution, acceptedTask, 'APPROVED', 'PASS');
    await plantGate(prisma, verifiedExecution, verifiedTask, 'APPROVED', 'PASS');
    await plantGate(prisma, rewordedExecution, rewordedTask, 'APPROVED', 'PASS');
    await plantGate(prisma, concurrentExecution, concurrentTask, 'APPROVED', 'PASS');
    await plantGate(prisma, gatedExecution, gatedTask, 'GATED', 'NEEDS_APPROVAL');
    await plantGate(prisma, blockedExecution, blockedTask, 'BLOCKED', 'BLOCK');
    await plantGate(prisma, wrongExecution, wrongTask, 'APPROVED', 'PASS');
    await plantGate(prisma, mismatchExecution, mismatchTask, 'APPROVED', 'PASS');
    await plantGate(prisma, lineageExecution, lineageTask, 'APPROVED', 'PASS');
    await plantGate(prisma, foreignExecution, foreignTask, 'APPROVED', 'PASS', FOREIGN);

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
    const phase60Try = await review(wrongExecution, stub('VERIFY'));
    assert.equal(phase60Try.ok, false);
    if (!phase60Try.ok) assert.equal(phase60Try.reason, 'HUMAN_APPROVAL_REQUIRED');
    await setHuman(prisma, wrongExecution, phase55?.id ?? 'missing-phase55');
    const phase55Try = await review(wrongExecution, stub('VERIFY'));
    assert.equal(phase55Try.ok, false);
    if (!phase55Try.ok) assert.equal(phase55Try.reason, 'HUMAN_APPROVAL_REQUIRED');
    await setHuman(prisma, wrongExecution, rootHuman?.id ?? 'missing-root');
    const rootTry = await review(wrongExecution, stub('VERIFY'));
    assert.equal(rootTry.ok, false);
    if (!rootTry.ok) assert.equal(rootTry.reason, 'HUMAN_APPROVAL_REQUIRED');
    await prisma.juryHumanDecision.deleteMany({ where: { tenantId: TENANT, reviewResultId: wrongResult } });
    const missingApproval = await review(wrongExecution, stub('VERIFY'));
    assert.equal(missingApproval.ok, false);
    if (!missingApproval.ok) assert.equal(missingApproval.reason, 'HUMAN_APPROVAL_REQUIRED');
    await prisma.juryHumanDecision.updateMany({
      where: { tenantId: TENANT, reviewResultId: mismatchResult },
      data: { decision: 'REWORD' },
    });
    const mismatchTry = await review(mismatchExecution, stub('VERIFY'));
    assert.equal(mismatchTry.ok, false);
    if (!mismatchTry.ok) assert.equal(mismatchTry.reason, 'HUMAN_APPROVAL_REQUIRED');
    assert.equal(cores, 0);
    assert.equal(await childCount(prisma, wrongResult), 0);
    assert.equal(await childCount(prisma, mismatchResult), 0);

    await prisma.juryImprovementTask.updateMany({
      where: { id: lineage.sourceTaskId, tenantId: TENANT },
      data: { provenance: { kind: 'human-decision-improvement' } },
    });
    const lineageTry = await review(lineageExecution, stub('VERIFY'));
    assert.equal(lineageTry.ok, false);
    if (!lineageTry.ok) assert.equal(lineageTry.reason, 'NOT_REREVIEW_IMPROVEMENT_TASK');
    const earlier = await evaluateLaterReReview({
      userId: owner.userId,
      memberships: [owner],
      agentExecutionId: approvedExecution,
      core: stub('VERIFY'),
    });
    assert.equal(earlier.ok, false);
    if (!earlier.ok) assert.equal(earlier.reason, 'NOT_REREVIEW_IMPROVEMENT_TASK');
    for (const id of [approved.executionId, 'phase70-approved-exec']) {
      const reviewsBefore = await prisma.juryChangeGateReview.count({ where: { agentExecutionId: id, tenantId: TENANT } });
      const refused = await review(id, stub('VERIFY'));
      assert.equal(refused.ok, false, id);
      if (!refused.ok) assert.equal(refused.reason, 'NOT_REREVIEW_IMPROVEMENT_TASK');
      assert.equal(await prisma.juryChangeGateReview.count({ where: { agentExecutionId: id, tenantId: TENANT } }), reviewsBefore);
    }
    assert.equal(cores, 0);

    const pendingTry = await review(statusExecution, stub('VERIFY'));
    assert.equal(pendingTry.ok, false);
    if (!pendingTry.ok) assert.equal(pendingTry.reason, 'EXECUTION_NOT_COMPLETED');
    await prisma.juryAgentExecution.updateMany({ where: { id: statusExecution, tenantId: TENANT }, data: { status: 'RUNNING' } });
    const runningTry = await review(statusExecution, stub('VERIFY'));
    assert.equal(runningTry.ok, false);
    if (!runningTry.ok) assert.equal(runningTry.reason, 'EXECUTION_NOT_COMPLETED');
    await prisma.juryAgentExecution.updateMany({ where: { id: statusExecution, tenantId: TENANT }, data: { status: 'BLOCKED' } });
    const blockedStatus = await review(statusExecution, stub('VERIFY'));
    assert.equal(blockedStatus.ok, false);
    if (!blockedStatus.ok) assert.equal(blockedStatus.reason, 'EXECUTION_NOT_COMPLETED');
    assert.equal(await childCount(prisma, statusResult), 0);

    const foreignTry = await review(foreignExecution, stub('VERIFY'));
    assert.equal(foreignTry.ok, false);
    if (!foreignTry.ok) assert.equal(foreignTry.reason, 'NOT_FOUND');
    assert.equal(await childCount(prisma, foreignResult, FOREIGN), 0);
    assert.equal(cores, 0);

    const gatedTry = await review(gatedExecution, stub('VERIFY'));
    assert.equal(gatedTry.ok, false);
    if (!gatedTry.ok) assert.equal(gatedTry.reason, 'RE-REVIEW_NOT_APPROVED');
    const blockedTry = await review(blockedExecution, stub('VERIFY'));
    assert.equal(blockedTry.ok, false);
    if (!blockedTry.ok) assert.equal(blockedTry.reason, 'RE-REVIEW_NOT_APPROVED');
    const noGate = await review(missingExecution, stub('VERIFY'));
    assert.equal(noGate.ok, false);
    if (!noGate.ok) assert.equal(noGate.reason, 'RE-REVIEW_NOT_APPROVED');
    for (const resultId of [gatedResult, blockedResult, missingResult]) {
      assert.equal(await childCount(prisma, resultId), 0);
    }
    assert.equal(cores, 0);

    const before = await counts(prisma);
    const evidenceBefore = await prisma.juryEvidence.findFirst({
      where: { id: EVIDENCE, tenantId: TENANT },
      select: { contentHash: true, adapterKey: true, purpose: true },
    });
    const executionBefore = await prisma.juryAgentExecution.findFirst({ where: { id: approvedExecution, tenantId: TENANT } });
    const gateBefore = await prisma.juryChangeGateResult.findFirst({ where: { executionId: approvedExecution, tenantId: TENANT } });
    const taskBefore = await taskSnapshot(prisma, approvedTask);
    const humanBefore = await prisma.juryHumanDecision.findFirst({
      where: { tenantId: TENANT, reviewResultId: approvedResult },
      select: { id: true, decision: true, reviewResultId: true, reviewRequestId: true, actorUserId: true },
    });
    const waiting = await loadReviewConsole(ownerActor, approved.rootId);
    assert.equal(waiting.ok && waiting.screen.canRunFollowingReReview, true);
    assert.equal(waiting.ok && waiting.screen.nextLaterChangeGate?.status, 'APPROVED');
    const memberWaiting = await loadReviewConsole(memberActor, approved.rootId);
    assert.equal(memberWaiting.ok && memberWaiting.screen.canRunFollowingReReview, true);
    const auditorWaiting = await loadReviewConsole(auditorActor, approved.rootId);
    assert.equal(auditorWaiting.ok && auditorWaiting.screen.canRunFollowingReReview, false);

    const auditorTry = await review(approvedExecution, stub('VERIFY'), auditor);
    assert.equal(auditorTry.ok, false);
    if (!auditorTry.ok) assert.equal(auditorTry.reason, 'FORBIDDEN');
    assert.equal(cores, 0);

    const opened = await review(approvedExecution, stub('VERIFY'));
    assert.equal(opened.ok, true, opened.ok ? '' : opened.reason);
    if (opened.ok) {
      assert.equal(opened.created, true);
      assert.equal(opened.reviewId, approved.rootId);
      assert.equal(opened.reReview.status, 'EXECUTED');
      assert.equal(opened.reReview.decision, 'VERIFY');
    }
    assert.equal(cores, 1);
    const child = await prisma.juryReviewResult.findFirst({
      where: { id: opened.ok ? opened.reReview.reviewResultId ?? '' : '', tenantId: TENANT },
    });
    assert.equal(child?.parentReviewResultId, approvedResult);
    assert.notEqual(child?.parentReviewResultId, approved.rootId);
    assert.notEqual(child?.parentReviewResultId, approved.firstResultId);
    assert.notEqual(child?.parentReviewResultId, approved.secondResultId);
    const current = await prisma.juryReviewResult.findFirst({ where: { id: approvedResult, tenantId: TENANT } });
    assert.equal(current?.parentReviewResultId, approved.secondResultId);
    const stamped = await prisma.juryChangeGateReview.findFirst({
      where: { changeGateResultId: gateBefore?.id ?? '', tenantId: TENANT },
    });
    assert.equal(textField(stamped?.provenance, 'originalReviewResultId'), approved.rootId);
    assert.equal(textField(stamped?.provenance, 'previousReReviewResultId'), approvedResult);
    assert.equal(JSON.stringify(stamped?.provenance).toLowerCase().includes('password'), false);
    assert.equal(await prisma.juryImprovementTask.count({
      where: { tenantId: TENANT, reviewResultId: opened.ok ? opened.reReview.reviewResultId ?? '' : 'none' },
    }), 0);

    const replay = await review(approvedExecution, stub('VERIFY'));
    assert.equal(replay.ok, true);
    if (replay.ok && opened.ok) {
      assert.equal(replay.created, false);
      assert.equal(replay.reReview.reviewResultId, opened.reReview.reviewResultId);
    }
    assert.equal(cores, 1);
    assert.equal(await prisma.juryChangeGateReview.count({ where: { changeGateResultId: gateBefore?.id ?? '', tenantId: TENANT } }), 1);
    assert.equal(await childCount(prisma, approvedResult), 1);

    for (const row of [
      { executionId: acceptedExecution, resultId: acceptedResult, rootId: accepted.rootId, decision: 'ACCEPT' as const },
      { executionId: verifiedExecution, resultId: verifiedResult, rootId: verified.rootId, decision: 'VERIFY' as const },
      { executionId: rewordedExecution, resultId: rewordedResult, rootId: reworded.rootId, decision: 'REWORD' as const },
    ]) {
      const ran = await review(row.executionId, stub(row.decision), member);
      assert.equal(ran.ok, true, ran.ok ? '' : ran.reason);
      if (ran.ok) {
        assert.equal(ran.reReview.decision, row.decision);
        assert.equal(ran.reviewId, row.rootId);
      }
      assert.equal(await prisma.juryImprovementTask.count({
        where: { tenantId: TENANT, reviewResultId: ran.ok ? ran.reReview.reviewResultId ?? '' : 'none' },
      }), 0);
      assert.equal(await childCount(prisma, row.resultId), 1);
    }
    assert.equal(cores, 4);

    const concurrentStart = cores;
    const [left, right] = await Promise.all([
      review(concurrentExecution, stub('VERIFY')),
      review(concurrentExecution, stub('VERIFY')),
    ]);
    assert.equal(left.ok || right.ok, true);
    assert.equal(await prisma.juryChangeGateReview.count({ where: { agentExecutionId: concurrentExecution, tenantId: TENANT } }), 1);
    assert.equal(await childCount(prisma, concurrentResult), 1);
    assert.equal(cores, concurrentStart + 1);

    const after = await counts(prisma);
    assert.equal(after.results, before.results + 5);
    assert.equal(after.gateReviews, before.gateReviews + 5);
    assert.equal(after.requests, before.requests + 5);
    assert.equal(after.gates, before.gates);
    assert.equal(after.executions, before.executions);
    assert.equal(after.tasks, before.tasks);
    assert.equal(after.humans, before.humans);
    assert.equal(after.evidence, before.evidence);
    assert.equal(after.cycles, before.cycles);
    assert.equal(after.loops, before.loops);
    assert.deepEqual(await prisma.juryAgentExecution.findFirst({ where: { id: approvedExecution, tenantId: TENANT } }), executionBefore);
    assert.deepEqual(await prisma.juryChangeGateResult.findFirst({ where: { executionId: approvedExecution, tenantId: TENANT } }), gateBefore);
    assert.deepEqual(await taskSnapshot(prisma, approvedTask), taskBefore);
    assert.deepEqual(await prisma.juryHumanDecision.findFirst({
      where: { tenantId: TENANT, reviewResultId: approvedResult },
      select: { id: true, decision: true, reviewResultId: true, reviewRequestId: true, actorUserId: true },
    }), humanBefore);
    const evidenceAfter = await prisma.juryEvidence.findFirst({
      where: { id: EVIDENCE, tenantId: TENANT },
      select: { contentHash: true, adapterKey: true, purpose: true },
    });
    assert.deepEqual(evidenceAfter, evidenceBefore);
    const shown = await loadReviewConsole(ownerActor, approved.rootId);
    assert.equal(shown.ok && shown.screen.canRunFollowingReReview, false);
    assert.equal(shown.ok && shown.screen.nextFollowingReReview?.status, 'EXECUTED');
    assert.equal(shown.ok && shown.screen.nextFollowingReReview?.decision, 'VERIFY');
    assert.equal(shown.ok && shown.screen.nextFollowingReReview?.surface?.statusSummary, 'VERIFY');
    assert.equal(shown.ok && shown.screen.nextFollowingReReview?.surface?.topProblems.includes('VERIFY-gap'), true);
    assert.deepEqual(await liveSnapshot(prisma), liveBefore);
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

function review(agentExecutionId: string, core: ProductReviewCore, actor: JuryMembership = owner) {
  return evaluateFollowingReReview({ userId: actor.userId, memberships: [actor], agentExecutionId, core });
}

async function plantGate(
  prisma: Awaited<typeof import('@/lib/prisma')>['prisma'],
  executionId: string,
  taskId: string,
  status: 'APPROVED' | 'GATED' | 'BLOCKED',
  gate: 'PASS' | 'NEEDS_APPROVAL' | 'BLOCK',
  tenantId = TENANT,
) {
  await prisma.juryChangeGateResult.create({
    data: {
      id: `${executionId}-gate`,
      tenantId,
      executionId,
      improvementTaskId: taskId,
      changedFiles: [],
      riskFlags: [],
      gate,
      status,
      createdAt: new Date(NOW),
      updatedAt: new Date(NOW),
    },
  });
}

async function childCount(
  prisma: Awaited<typeof import('@/lib/prisma')>['prisma'],
  parentId: string,
  tenantId = TENANT,
) {
  return prisma.juryReviewResult.count({ where: { tenantId, parentReviewResultId: parentId } });
}

function textField(value: unknown, key: string): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = (value as Record<string, unknown>)[key];
  return typeof row === 'string' && row.length > 0 ? row : null;
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
  const connectionId = tenantId === TENANT ? CONN : 'phase70-foreign-conn';
  const evidenceId = tenantId === TENANT ? EVIDENCE : 'phase70-foreign-evidence';
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
    data: { id: 'phase70-foreign-conn', tenantId: FOREIGN, serviceKey: 'phase70-foreign-conn', displayName: 'phase70-foreign-conn', accessMethod: 'FILE_UPLOAD', status: 'CONNECTED', createdByUserId: foreign.userId },
  });
  await prisma.juryAccessScope.create({
    data: { id: 'phase70-scope', tenantId: TENANT, connectionId: CONN, status: 'APPROVED', grants: [], approvedByUserId: owner.userId, approvedAt: new Date(NOW) },
  });
  await prisma.juryAccessScope.create({
    data: { id: 'phase70-foreign-scope', tenantId: FOREIGN, connectionId: 'phase70-foreign-conn', status: 'APPROVED', grants: [], approvedByUserId: foreign.userId, approvedAt: new Date(NOW) },
  });
  await evidenceRow(prisma, EVIDENCE, TENANT, CONN);
  await evidenceRow(prisma, 'phase70-foreign-evidence', FOREIGN, 'phase70-foreign-conn');
  await prisma.juryNormalizedMetric.createMany({
    data: [
      metric('phase70-zero', 'userCount', 0, 'AVAILABLE'),
      metric('phase70-null', 'postsLast7d', null, 'NOT_MEASURED'),
      {
        ...metric('phase70-foreign-zero', 'userCount', 0, 'AVAILABLE'),
        tenantId: FOREIGN,
        connectionId: 'phase70-foreign-conn',
        evidenceId: 'phase70-foreign-evidence',
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
  const connectionId = tenantId === TENANT ? CONN : 'phase70-foreign-conn';
  const evidenceId = tenantId === TENANT ? EVIDENCE : 'phase70-foreign-evidence';
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
      workspaceRef: { type: 'PROJECT', ref: 'phase70-fixture' }, provenance: { kind: 'human-agent-execution' },
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
      timezone: 'Asia/Seoul', metricIds: id === EVIDENCE ? ['phase70-zero', 'phase70-null'] : ['phase70-foreign-zero'], adapterKey: 'console-declared', collectedAt: new Date(NOW),
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
    where: { username: { in: ['phase70-owner', 'phase70-member', 'phase70-auditor', 'phase70-foreign'] } },
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
