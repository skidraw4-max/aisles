import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import type { JuryActor } from './access';
import { JURY_CORE_CONTRACT_VERSION, JURY_PRODUCT_DATA_ROOT, type JuryDecision, type JuryFinalSurface, type JuryMembership } from './records';
import { loadReviewConsole, projectReviewConsole } from './review-console';
import { approveReReviewAgent, persistReReviewAgentHandoff } from './rereview-agent-handoff';
import { reReviewImprovementTaskId } from './rereview-improvement-bridge';
import { approveSecondImprovement } from './rereview-second-approval';
import { persistSecondReReviewImprovement } from './rereview-second-improvement';

const TENANT = 'phase60-rereview';
const FOREIGN = 'phase60-foreign';
const CONN = 'phase60-conn';
const EVIDENCE = 'phase60-evidence';
const NOW = '2026-10-03T03:10:00.000Z';
const LIVE_REVIEW = '3707202563ecae9b38f324a4eefd9243a14bc69420ed6cdda16c4c5794f62e0d';
const LIVE_CYCLE = '14308b4c999ccbe8ca54b7f31da5385385d4073c49bbf2955582a6bb96afb01e';
const SECRET = 'password=hidden';

const owner = membership('phase60-owner-m', TENANT, 'phase60-owner', 'OWNER');
const member = membership('phase60-member-m', TENANT, 'phase60-member', 'DEVELOPER');
const auditor = membership('phase60-auditor-m', TENANT, 'phase60-auditor', 'VIEWER');
const foreign = membership('phase60-foreign-m', FOREIGN, 'phase60-foreign', 'OWNER');
const ownerActor: JuryActor = { ok: true, userId: owner.userId, tenantId: TENANT, role: 'OWNER', membershipId: owner.id };
const memberActor: JuryActor = { ok: true, userId: member.userId, tenantId: TENANT, role: 'DEVELOPER', membershipId: member.id };
const auditorActor: JuryActor = { ok: true, userId: auditor.userId, tenantId: TENANT, role: 'VIEWER', membershipId: auditor.id };

test('second improvement approval follows the stored next task', () => {
  const base = {
    actor: ownerActor,
    result: { id: 'original', tenantId: TENANT, expectedDecision: 'VERIFY' as const, finalSurface: face('steady'), completedAt: NOW },
    status: 'COMPLETED' as const,
    evidenceId: EVIDENCE,
    metrics: [],
    humanDecision: 'VERIFY' as const,
    nextSecondReReview: { id: 'second-review', status: 'EXECUTED' },
    secondReReviewResultId: 'second-result',
    secondReReviewDecision: 'VERIFY' as const,
    nextSecondImprovement: { id: 'later', taskType: 'VERIFICATION' as const, status: 'OPEN' },
  };
  const ready = projectReviewConsole(base);
  assert.equal(ready.ok && ready.screen.canApproveSecondImprovement, true);
  assert.equal(ready.ok && ready.screen.nextSecondImprovement?.taskType, 'VERIFICATION');
  const memberView = projectReviewConsole({ ...base, actor: memberActor });
  assert.equal(memberView.ok && memberView.screen.canApproveSecondImprovement, true);
  const reader = projectReviewConsole({ ...base, actor: auditorActor });
  assert.equal(reader.ok && reader.screen.canApproveSecondImprovement, false);
  const accept = projectReviewConsole({ ...base, secondReReviewDecision: 'ACCEPT', nextSecondImprovement: null });
  assert.equal(accept.ok && accept.screen.canApproveSecondImprovement, false);
  const mismatched = projectReviewConsole({ ...base, secondReReviewDecision: 'REWORD' });
  assert.equal(mismatched.ok && mismatched.screen.canApproveSecondImprovement, false);
  const approved = projectReviewConsole({ ...base, nextSecondApproval: 'VERIFY' });
  assert.equal(approved.ok && approved.screen.canApproveSecondImprovement, false);
  assert.equal(approved.ok && approved.screen.nextSecondApproval, 'VERIFY');
});

test('second improvement task records one separate human approval', { timeout: 360_000 }, async () => {
  loadEnv();
  const { prisma } = await import('@/lib/prisma');
  const liveBefore = await liveSnapshot(prisma);
  let cleanupError: string | null = null;
  try {
    await removeFixture(prisma);
    await seed(prisma);
    const accepted = await chain(prisma, 'phase60-accept', 'VERIFY');
    const verify = await chain(prisma, 'phase60-verify', 'VERIFY');
    const reword = await chain(prisma, 'phase60-reword', 'REWORD');
    const concurrent = await chain(prisma, 'phase60-concurrent', 'VERIFY');
    const mismatchVerify = await chain(prisma, 'phase60-mismatch-verify', 'VERIFY');
    const mismatchReword = await chain(prisma, 'phase60-mismatch-reword', 'REWORD');
    const auditorChain = await chain(prisma, 'phase60-auditor', 'VERIFY');
    const tamper = await chain(prisma, 'phase60-tamper', 'VERIFY');
    const foreignChain = await chain(prisma, 'phase60-foreign-review', 'VERIFY', FOREIGN);
    const plainId = 'phase60-plain-review';
    await prisma.juryReviewRequest.create({
      data: {
        id: 'phase60-plain-request', tenantId: TENANT, connectionId: CONN, evidenceId: EVIDENCE, reviewType: 'FULL_REVIEW',
        claim: '측정된 범위의 문구만 사용한다.', mode: 'AISLE_SELF', status: 'COMPLETED', coreRootDir: JURY_PRODUCT_DATA_ROOT,
        requestedByUserId: owner.userId,
      },
    });
    await prisma.juryReviewResult.create({
      data: {
        id: plainId, tenantId: TENANT, reviewRequestId: 'phase60-plain-request', boardRunId: 'phase60-plain-board',
        evidenceStrength: 'strong', claimStrength: 'weak', conflictDetected: false, overclaimDetected: false,
        revisionRequired: false, expectedDecision: 'VERIFY', finalSurface: face('plain'), contractVersion: JURY_CORE_CONTRACT_VERSION,
        completedAt: new Date(NOW),
      },
    });
    await prisma.juryImprovementTask.create({
      data: {
        id: 'phase60-plain-task', tenantId: TENANT, reviewResultId: plainId, evidenceId: EVIDENCE, diagnosis: 'plain',
        acceptanceCriteria: ['plain'], status: 'OPEN', loopIndex: 0,
        loopPolicy: { maxIterations: null, maxRuntimeMs: null, maxCostUsd: null }, taskType: 'VERIFICATION',
        provenance: { kind: 'human-decision-improvement' }, createdAt: new Date(NOW), updatedAt: new Date(NOW),
      },
    });

    const acceptedSecond = await openedSecond(prisma, accepted, 'ACCEPT', 'phase60-accept-summary');
    const verifySecond = await openedSecond(prisma, verify, 'VERIFY', 'phase60-verify-summary', SECRET);
    const rewordSecond = await openedSecond(prisma, reword, 'REWORD', 'phase60-reword-summary');
    const concurrentSecond = await openedSecond(prisma, concurrent, 'VERIFY', 'phase60-concurrent-summary');
    const mismatchVerifySecond = await openedSecond(prisma, mismatchVerify, 'VERIFY', 'phase60-mismatch-verify-summary');
    const mismatchRewordSecond = await openedSecond(prisma, mismatchReword, 'REWORD', 'phase60-mismatch-reword-summary');
    const auditorSecond = await openedSecond(prisma, auditorChain, 'VERIFY', 'phase60-auditor-summary');
    const tamperSecond = await openedSecond(prisma, tamper, 'VERIFY', 'phase60-tamper-summary');
    const foreignSecond = await openedSecond(prisma, foreignChain, 'VERIFY', 'phase60-foreign-summary', 'safe', FOREIGN);

    const acceptTask = await persistSecondReReviewImprovement({ userId: member.userId, memberships: [member], reReviewResultId: acceptedSecond.resultId });
    assert.equal(acceptTask.ok, true, acceptTask.ok ? '' : acceptTask.reason);
    if (acceptTask.ok) assert.equal(acceptTask.taskId, null);
    const verifyTask = await taskFor(verifySecond.resultId, member);
    const rewordTask = await taskFor(rewordSecond.resultId, owner);
    const concurrentTask = await taskFor(concurrentSecond.resultId, owner);
    const mismatchVerifyTask = await taskFor(mismatchVerifySecond.resultId, owner);
    const mismatchRewordTask = await taskFor(mismatchRewordSecond.resultId, owner);
    const auditorTask = await taskFor(auditorSecond.resultId, owner);
    const tamperTask = await taskFor(tamperSecond.resultId, owner);
    const foreignTask = await taskFor(foreignSecond.resultId, foreign);
    assert.equal(verifyTask.ok && verifyTask.taskType, 'VERIFICATION');
    assert.equal(rewordTask.ok && rewordTask.taskType, 'REWORD');

    await prisma.juryImprovementTask.updateMany({
      where: { id: mismatchVerifyTask.ok ? mismatchVerifyTask.taskId ?? '' : '', tenantId: TENANT },
      data: { taskType: 'REWORD' },
    });
    await prisma.juryImprovementTask.updateMany({
      where: { id: mismatchRewordTask.ok ? mismatchRewordTask.taskId ?? '' : '', tenantId: TENANT },
      data: { taskType: 'VERIFICATION' },
    });
    await prisma.juryImprovementTask.updateMany({
      where: { id: tamperTask.ok ? tamperTask.taskId ?? '' : '', tenantId: TENANT },
      data: { reviewResultId: plainId },
    });

    const before = await counts(prisma);
    const metricsBefore = await metricSnapshot(prisma);
    const evidenceBefore = await prisma.juryEvidence.findFirst({ where: { id: EVIDENCE, tenantId: TENANT }, select: { contentHash: true } });
    const verifyTaskBefore = await prisma.juryImprovementTask.findFirst({
      where: { id: verifyTask.ok ? verifyTask.taskId ?? '' : '', tenantId: TENANT },
      select: { status: true, diagnosis: true, updatedAt: true },
    });
    const pending = await loadReviewConsole(memberActor, verify.reviewId);
    assert.equal(pending.ok && pending.screen.canApproveSecondImprovement, true);
    assert.equal(pending.ok && pending.screen.nextSecondApproval, null);
    const auditorView = await loadReviewConsole(auditorActor, auditorChain.reviewId);
    assert.equal(auditorView.ok && auditorView.screen.canApproveSecondImprovement, false);

    const missing = await approve('missing-task');
    assert.equal(missing.ok, false);
    if (!missing.ok) assert.equal(missing.reason, 'NOT_FOUND');
    const empty = await approve('');
    assert.equal(empty.ok, false);
    if (!empty.ok) assert.equal(empty.reason, 'NOT_FOUND');

    const verifyId = verifyTask.ok ? verifyTask.taskId ?? '' : '';
    const opened = await approve(verifyId, member);
    assert.equal(opened.ok, true, opened.ok ? '' : opened.reason);
    if (opened.ok) {
      assert.equal(opened.created, true);
      assert.equal(opened.decision, 'VERIFY');
      assert.equal(opened.reviewId, verify.reviewId);
      assert.equal(opened.reReviewResultId, verifySecond.resultId);
    }
    const replay = await approve(verifyId, owner);
    assert.equal(replay.ok, true, replay.ok ? '' : replay.reason);
    if (replay.ok) {
      assert.equal(replay.created, false);
      assert.equal(replay.decision, 'VERIFY');
    }
    assert.equal(await humansOn(prisma, verifySecond.resultId), 1);
    assert.equal(await auditsOn(prisma, verifySecond.resultId), 1);

    const rewordId = rewordTask.ok ? rewordTask.taskId ?? '' : '';
    const reworded = await approve(rewordId, owner);
    assert.equal(reworded.ok, true, reworded.ok ? '' : reworded.reason);
    if (reworded.ok) {
      assert.equal(reworded.created, true);
      assert.equal(reworded.decision, 'REWORD');
      assert.equal(reworded.reviewId, reword.reviewId);
    }
    const rewordReplay = await approve(rewordId, member);
    assert.equal(rewordReplay.ok, true);
    if (rewordReplay.ok) assert.equal(rewordReplay.created, false);
    assert.equal(await humansOn(prisma, rewordSecond.resultId), 1);
    assert.equal(await auditsOn(prisma, rewordSecond.resultId), 1);

    const concurrentId = concurrentTask.ok ? concurrentTask.taskId ?? '' : '';
    const [left, right] = await Promise.all([
      approve(concurrentId, owner),
      approve(concurrentId, member),
    ]);
    assert.equal(left.ok && right.ok, true, `${left.ok ? '' : left.reason} ${right.ok ? '' : right.reason}`);
    if (left.ok && right.ok) assert.equal(left.decision, right.decision);
    assert.equal(await humansOn(prisma, concurrentSecond.resultId), 1);
    assert.equal(await auditsOn(prisma, concurrentSecond.resultId), 1);

    const verifyHuman = await prisma.juryHumanDecision.findFirst({
      where: { tenantId: TENANT, reviewResultId: verifySecond.resultId },
    });
    assert.equal(verifyHuman?.decision, 'VERIFY');
    assert.notEqual(verifyHuman?.id, verify.humanId);
    const phase55 = await prisma.juryHumanDecision.findFirst({
      where: { tenantId: TENANT, reviewResultId: verify.reReviewResultId },
      select: { id: true },
    });
    assert.notEqual(verifyHuman?.id, phase55?.id);
    const stored = JSON.stringify(verifyHuman);
    const audit = JSON.stringify(await prisma.juryAuditEvent.findFirst({
      where: { tenantId: TENANT, reviewId: verifySecond.resultId, action: 'HUMAN_DECISION_RECORDED' },
    }));
    assert.equal(stored.includes(SECRET), false);
    assert.equal(stored.includes('postgres://'), false);
    assert.equal(audit.includes(SECRET), false);
    assert.equal(audit.includes('postgres://'), false);

    const acceptApproval = await approve(accepted.nextTaskId, member);
    assert.equal(acceptApproval.ok, false);
    if (!acceptApproval.ok) assert.equal(acceptApproval.reason, 'NOT_REREVIEW_IMPROVEMENT_TASK');
    const originalApproval = await approve(verify.taskId, owner);
    assert.equal(originalApproval.ok, false);
    if (!originalApproval.ok) assert.equal(originalApproval.reason, 'NOT_REREVIEW_IMPROVEMENT_TASK');
    const firstApproval = await approve(verify.nextTaskId, owner);
    assert.equal(firstApproval.ok, false);
    if (!firstApproval.ok) assert.equal(firstApproval.reason, 'NOT_REREVIEW_IMPROVEMENT_TASK');
    const plainApproval = await approve('phase60-plain-task', member);
    assert.equal(plainApproval.ok, false);
    if (!plainApproval.ok) assert.equal(plainApproval.reason, 'NOT_REREVIEW_IMPROVEMENT_TASK');
    const tamperApproval = await approve(tamperTask.ok ? tamperTask.taskId ?? '' : '', owner);
    assert.equal(tamperApproval.ok, false);
    if (!tamperApproval.ok) assert.equal(tamperApproval.reason, 'NOT_REREVIEW_IMPROVEMENT_TASK');
    const verifyMismatch = await approve(mismatchVerifyTask.ok ? mismatchVerifyTask.taskId ?? '' : '', owner);
    assert.equal(verifyMismatch.ok, false);
    if (!verifyMismatch.ok) assert.equal(verifyMismatch.reason, 'NOT_REREVIEW_IMPROVEMENT_TASK');
    const rewordMismatch = await approve(mismatchRewordTask.ok ? mismatchRewordTask.taskId ?? '' : '', member);
    assert.equal(rewordMismatch.ok, false);
    if (!rewordMismatch.ok) assert.equal(rewordMismatch.reason, 'NOT_REREVIEW_IMPROVEMENT_TASK');
    assert.equal(await humansOn(prisma, mismatchVerifySecond.resultId), 0);
    assert.equal(await humansOn(prisma, mismatchRewordSecond.resultId), 0);
    assert.equal(await humansOn(prisma, tamperSecond.resultId), 0);

    const foreignHumans = await prisma.juryHumanDecision.count({ where: { tenantId: FOREIGN } });
    const foreignApproval = await approve(foreignTask.ok ? foreignTask.taskId ?? '' : '', owner);
    assert.equal(foreignApproval.ok, false);
    if (!foreignApproval.ok) assert.equal(foreignApproval.reason, 'NOT_FOUND');
    assert.equal(await prisma.juryHumanDecision.count({ where: { tenantId: FOREIGN } }), foreignHumans);
    assert.equal(await humansOn(prisma, foreignSecond.resultId, FOREIGN), 0);

    const denied = await approve(auditorTask.ok ? auditorTask.taskId ?? '' : '', auditor);
    assert.equal(denied.ok, false);
    if (!denied.ok) assert.equal(denied.reason, 'FORBIDDEN');
    assert.equal(await humansOn(prisma, auditorSecond.resultId), 0);
    assert.equal(await auditsOn(prisma, auditorSecond.resultId), 0);

    const after = await counts(prisma);
    assert.equal(after.humans, before.humans + 3);
    assert.equal(after.tasks, before.tasks);
    assert.equal(after.executions, before.executions);
    assert.equal(after.gates, before.gates);
    assert.equal(after.gateReviews, before.gateReviews);
    assert.equal(after.results, before.results);
    assert.equal(after.evidence, before.evidence);
    assert.equal(after.cycles, 0);
    assert.equal(after.loops, 0);
    assert.deepEqual(await metricSnapshot(prisma), metricsBefore);
    const evidenceAfter = await prisma.juryEvidence.findFirst({ where: { id: EVIDENCE, tenantId: TENANT }, select: { contentHash: true } });
    assert.equal(evidenceAfter?.contentHash, evidenceBefore?.contentHash);
    const verifyTaskAfter = await prisma.juryImprovementTask.findFirst({
      where: { id: verifyId, tenantId: TENANT },
      select: { status: true, diagnosis: true, updatedAt: true },
    });
    assert.equal(verifyTaskAfter?.status, 'OPEN');
    assert.equal(verifyTaskAfter?.diagnosis, verifyTaskBefore?.diagnosis);
    assert.equal(verifyTaskAfter?.updatedAt?.toISOString(), verifyTaskBefore?.updatedAt?.toISOString());
    assert.equal((await prisma.juryReviewResult.findFirst({ where: { id: verifySecond.resultId, tenantId: TENANT } }))?.expectedDecision, 'VERIFY');
    assert.equal((await prisma.juryReviewResult.findFirst({ where: { id: verify.reReviewResultId, tenantId: TENANT } }))?.expectedDecision, 'VERIFY');
    const shown = await loadReviewConsole(ownerActor, verify.reviewId);
    assert.equal(shown.ok && shown.screen.nextSecondApproval, 'VERIFY');
    assert.equal(shown.ok && shown.screen.canApproveSecondImprovement, false);
    const acceptedScreen = await loadReviewConsole(ownerActor, accepted.reviewId);
    assert.equal(acceptedScreen.ok && acceptedScreen.screen.canApproveSecondImprovement, false);
  } finally {
    try {
      await removeFixture(prisma);
    } catch (error) {
      cleanupError = error instanceof Error ? error.message : 'cleanup failed';
    }
    assert.deepEqual(await liveSnapshot(prisma), liveBefore);
    if (cleanupError) throw new Error(cleanupError);
  }
});

test('second approval reuses the stored human decision contract', () => {
  const source = readFileSync(path.resolve(process.cwd(), 'src/lib/jury-product/rereview-second-approval.ts'), 'utf8');
  for (const token of [
    'approveReReviewAgent',
    'persistReReviewAgentHandoff',
    'executeReReviewAgentExecution',
    'evaluateSecondReReview',
    'persistReReviewImprovement',
    'recordDecisionCycle',
    'persistImprovementAutoLoop',
    'callFrozenReviewPipeline',
    'findUnique',
    'buildEvidencePackFromDb',
    'attachGa4Evidence',
    'child_process',
  ]) {
    assert.equal(source.includes(token), false, token);
  }
  assert.equal(source.includes('noteHumanNextAction'), true);
  assert.equal(source.includes('input.improvementTaskId'), true);
  const actions = readFileSync(path.resolve(process.cwd(), 'src/app/(root)/jury/actions.ts'), 'utf8');
  const fn = actions.slice(
    actions.indexOf('export async function approveSecondImprovementTask'),
    actions.indexOf('export async function handoffSecondImprovementTask'),
  );
  assert.equal(fn.includes("formData.get('improvementTaskId')"), true);
  for (const key of ['tenantId', 'reviewResultId', 'reReviewResultId', 'agentExecutionId', 'changeGateResultId', 'taskType', 'humanDecision']) {
    assert.equal(fn.includes(`formData.get('${key}')`), false, key);
  }
  const ui = readFileSync(path.resolve(process.cwd(), 'src/app/(root)/jury/ui.tsx'), 'utf8');
  const body = ui.slice(
    ui.indexOf('export function SecondImprovementApprovalBody'),
    ui.indexOf('export function SecondImprovementHandoffBody'),
  );
  assert.equal(body.includes('Approve for Agent'), true);
  assert.equal(body.includes('Approved for Agent'), true);
  for (const label of ['Send to Agent', 'Run Agent', 'Run Change Gate', 'Run Re-review', 'Auto Fix', 'Run Loop']) {
    assert.equal(body.includes(label), false, label);
  }
});

function approve(improvementTaskId: string, actor: JuryMembership = owner) {
  return approveSecondImprovement({ userId: actor.userId, memberships: [actor], improvementTaskId });
}

function taskFor(reReviewResultId: string, actor: JuryMembership) {
  return persistSecondReReviewImprovement({ userId: actor.userId, memberships: [actor], reReviewResultId });
}

function humansOn(
  prisma: Awaited<typeof import('@/lib/prisma')>['prisma'],
  reviewResultId: string,
  tenantId = TENANT,
) {
  return prisma.juryHumanDecision.count({ where: { tenantId, reviewResultId } });
}

function auditsOn(prisma: Awaited<typeof import('@/lib/prisma')>['prisma'], reviewResultId: string) {
  return prisma.juryAuditEvent.count({
    where: { tenantId: TENANT, reviewId: reviewResultId, action: 'HUMAN_DECISION_RECORDED' },
  });
}

async function openedSecond(
  prisma: Awaited<typeof import('@/lib/prisma')>['prisma'],
  row: Chain,
  decision: JuryDecision,
  summary: string,
  executionSummary = 'safe summary',
  tenantId = TENANT,
) {
  const actor = tenantId === TENANT ? owner : foreign;
  const connectionId = tenantId === TENANT ? CONN : 'phase60-foreign-conn';
  const evidenceId = tenantId === TENANT ? EVIDENCE : 'phase60-foreign-evidence';
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
        result: { summary: executionSummary, changedFiles: [], testsRun: [], testsPassed: null },
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
  const reviewId = `${row.nextTaskId}-second-cgr`;
  await prisma.juryReviewRequest.create({
    data: {
      id: requestId, tenantId, connectionId, evidenceId, reviewType: 'FULL_REVIEW', claim: '측정된 범위의 문구만 사용한다.',
      mode: 'AISLE_SELF', status: 'COMPLETED', coreRootDir: JURY_PRODUCT_DATA_ROOT, requestedByUserId: actor.userId,
    },
  });
  await prisma.juryReviewResult.create({
    data: {
      id: resultId, tenantId, reviewRequestId: requestId, boardRunId: `${resultId}-board`, evidenceStrength: 'strong',
      claimStrength: 'weak', conflictDetected: false, overclaimDetected: false, revisionRequired: decision === 'REWORD',
      expectedDecision: decision, finalSurface: face(summary), contractVersion: JURY_CORE_CONTRACT_VERSION,
      completedAt: new Date(NOW), parentReviewResultId: row.reReviewResultId,
    },
  });
  await prisma.juryChangeGateReview.create({
    data: {
      id: reviewId, tenantId, parentReviewResultId: row.reReviewResultId, changeGateResultId: gateId,
      agentExecutionId: executionId, improvementTaskId: row.nextTaskId, evidenceId, sourceEvidenceId: evidenceId,
      reason: { code: 'CHANGE_GATE_APPROVED', message: 'Approved change gate is ready for re-review.' },
      status: 'EXECUTED', source: 'CHANGE_GATE', reviewRequestId: requestId, reviewResultId: resultId,
      provenance: { kind: 'change-gate-rereview' }, createdAt: new Date(NOW), updatedAt: new Date(NOW),
    },
  });
  return { resultId, gateId, executionId, reviewId };
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
    data: { id: 'phase60-foreign-conn', tenantId: FOREIGN, serviceKey: 'phase60-foreign-conn', displayName: 'phase60-foreign-conn', accessMethod: 'FILE_UPLOAD', status: 'CONNECTED', createdByUserId: foreign.userId },
  });
  await evidenceRow(prisma, EVIDENCE, TENANT, CONN);
  await evidenceRow(prisma, 'phase60-foreign-evidence', FOREIGN, 'phase60-foreign-conn');
  await prisma.juryNormalizedMetric.createMany({
    data: [
      metric('phase60-zero', 'userCount', 0, 'AVAILABLE'),
      metric('phase60-null', 'postsLast7d', null, 'NOT_MEASURED'),
    ],
  });
}

type Chain = {
  reviewId: string;
  humanId: string;
  taskId: string;
  executionId: string;
  gateId: string;
  reReviewResultId: string;
  reReviewRequestId: string;
  nextTaskId: string;
};

async function chain(
  prisma: Awaited<typeof import('@/lib/prisma')>['prisma'],
  id: string,
  reDecision: JuryDecision,
  tenantId = TENANT,
): Promise<Chain> {
  const actor = tenantId === TENANT ? owner : foreign;
  const connectionId = tenantId === TENANT ? CONN : 'phase60-foreign-conn';
  const evidenceId = tenantId === TENANT ? EVIDENCE : 'phase60-foreign-evidence';
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
      workspaceRef: { type: 'PROJECT', ref: 'phase60-fixture' }, provenance: { kind: 'human-agent-execution' },
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
  const [results, gates, gateReviews, tasks, executions, evidence, humans, cycles, loops] = await Promise.all([
    prisma.juryReviewResult.count({ where }),
    prisma.juryChangeGateResult.count({ where }),
    prisma.juryChangeGateReview.count({ where }),
    prisma.juryImprovementTask.count({ where }),
    prisma.juryAgentExecution.count({ where }),
    prisma.juryEvidence.count({ where }),
    prisma.juryHumanDecision.count({ where }),
    prisma.juryDecisionCycle.count({ where }),
    prisma.juryAutoLoopActivation.count({ where }),
  ]);
  return { results, gates, gateReviews, tasks, executions, evidence, humans, cycles, loops };
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
    where: { username: { in: ['phase60-owner', 'phase60-member', 'phase60-auditor', 'phase60-foreign'] } },
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
