import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import type { JuryActor } from './access';
import { REWORD_CONSTRAINTS } from './improvement-bridge';
import { JURY_CORE_CONTRACT_VERSION, JURY_PRODUCT_DATA_ROOT, type JuryDecision, type JuryFinalSurface, type JuryMembership } from './records';
import { loadReviewConsole, projectReviewConsole } from './review-console';
import { approveReReviewAgent, persistReReviewAgentHandoff } from './rereview-agent-handoff';
import { reReviewImprovementTaskId } from './rereview-improvement-bridge';
import { persistSecondReReviewImprovement } from './rereview-second-improvement';

const TENANT = 'phase59-rereview';
const FOREIGN = 'phase59-foreign';
const CONN = 'phase59-conn';
const EVIDENCE = 'phase59-evidence';
const NOW = '2026-10-03T02:40:00.000Z';
const LIVE_REVIEW = '3707202563ecae9b38f324a4eefd9243a14bc69420ed6cdda16c4c5794f62e0d';
const LIVE_CYCLE = '14308b4c999ccbe8ca54b7f31da5385385d4073c49bbf2955582a6bb96afb01e';
const SECRET = 'password=hidden';

const owner = membership('phase59-owner-m', TENANT, 'phase59-owner', 'OWNER');
const member = membership('phase59-member-m', TENANT, 'phase59-member', 'MEMBER');
const auditor = membership('phase59-auditor-m', TENANT, 'phase59-auditor', 'AUDITOR');
const foreign = membership('phase59-foreign-m', FOREIGN, 'phase59-foreign', 'OWNER');
const ownerActor: JuryActor = { ok: true, userId: owner.userId, tenantId: TENANT, role: 'OWNER', membershipId: owner.id };
const memberActor: JuryActor = { ok: true, userId: member.userId, tenantId: TENANT, role: 'MEMBER', membershipId: member.id };
const auditorActor: JuryActor = { ok: true, userId: auditor.userId, tenantId: TENANT, role: 'AUDITOR', membershipId: auditor.id };

test('second improvement control follows a stored second re-review', () => {
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
    nextChangeGate: { id: 'gate', status: 'APPROVED', errorCode: null },
    nextSecondReReview: { id: 'second-review', status: 'EXECUTED' },
    secondReReviewResultId: 'second-result',
    secondReReviewDecision: 'VERIFY' as const,
  };
  const ready = projectReviewConsole(base);
  assert.equal(ready.ok && ready.screen.canCreateSecondImprovement, true);
  assert.equal(ready.ok && ready.screen.canRunSecondReReview, false);
  const memberView = projectReviewConsole({ ...base, actor: memberActor });
  assert.equal(memberView.ok && memberView.screen.canCreateSecondImprovement, true);
  const reader = projectReviewConsole({ ...base, actor: auditorActor });
  assert.equal(reader.ok && reader.screen.canCreateSecondImprovement, false);
  const accept = projectReviewConsole({ ...base, secondReReviewDecision: 'ACCEPT' });
  assert.equal(accept.ok && accept.screen.canCreateSecondImprovement, false);
  const tasked = projectReviewConsole({
    ...base,
    nextSecondImprovement: { id: 'later', taskType: 'VERIFICATION', status: 'OPEN' },
  });
  assert.equal(tasked.ok && tasked.screen.canCreateSecondImprovement, false);
  assert.equal(tasked.ok && tasked.screen.nextSecondImprovement?.id, 'later');
});

test('second re-review decision creates one next improvement task', { timeout: 240_000 }, async () => {
  loadEnv();
  const { prisma } = await import('@/lib/prisma');
  const liveBefore = await liveSnapshot(prisma);
  let cleanupError: string | null = null;
  try {
    await removeFixture(prisma);
    await seed(prisma);
    const accepted = await chain(prisma, 'phase59-accept', 'VERIFY');
    const verify = await chain(prisma, 'phase59-verify', 'VERIFY');
    const reword = await chain(prisma, 'phase59-reword', 'REWORD');
    const concurrentVerify = await chain(prisma, 'phase59-concurrent-verify', 'VERIFY');
    const concurrentReword = await chain(prisma, 'phase59-concurrent-reword', 'REWORD');
    const tamperTask = await chain(prisma, 'phase59-tamper-task', 'VERIFY');
    const tamperParent = await chain(prisma, 'phase59-tamper-parent', 'VERIFY');
    const tamperSource = await chain(prisma, 'phase59-tamper-source', 'VERIFY');
    const tamperReview = await chain(prisma, 'phase59-tamper-review', 'VERIFY');
    const foreignChain = await chain(prisma, 'phase59-foreign-review', 'VERIFY', FOREIGN);
    const plainId = 'phase59-plain-review';
    await prisma.juryReviewRequest.create({
      data: {
        id: 'phase59-plain-request', tenantId: TENANT, connectionId: CONN, evidenceId: EVIDENCE, reviewType: 'FULL_REVIEW',
        claim: '측정된 범위의 문구만 사용한다.', mode: 'AISLE_SELF', status: 'COMPLETED', coreRootDir: JURY_PRODUCT_DATA_ROOT,
        requestedByUserId: owner.userId,
      },
    });
    await prisma.juryReviewResult.create({
      data: {
        id: plainId, tenantId: TENANT, reviewRequestId: 'phase59-plain-request', boardRunId: 'phase59-plain-board',
        evidenceStrength: 'strong', claimStrength: 'weak', conflictDetected: false, overclaimDetected: false,
        revisionRequired: false, expectedDecision: 'VERIFY', finalSurface: face('plain'), contractVersion: JURY_CORE_CONTRACT_VERSION,
        completedAt: new Date(NOW),
      },
    });

    const acceptedSecond = await openedSecond(prisma, accepted, 'ACCEPT', 'phase59-accept-summary');
    const verifySecond = await openedSecond(prisma, verify, 'VERIFY', 'phase59-verify-summary', SECRET);
    const rewordSecond = await openedSecond(prisma, reword, 'REWORD', 'phase59-reword-summary');
    const concurrentVerifySecond = await openedSecond(prisma, concurrentVerify, 'VERIFY', 'phase59-cverify-summary');
    const concurrentRewordSecond = await openedSecond(prisma, concurrentReword, 'REWORD', 'phase59-creword-summary');
    const tamperTaskSecond = await openedSecond(prisma, tamperTask, 'VERIFY', 'phase59-tamper-task-summary');
    const tamperParentSecond = await openedSecond(prisma, tamperParent, 'VERIFY', 'phase59-tamper-parent-summary');
    const tamperSourceSecond = await openedSecond(prisma, tamperSource, 'VERIFY', 'phase59-tamper-source-summary');
    const tamperReviewSecond = await openedSecond(prisma, tamperReview, 'VERIFY', 'phase59-tamper-review-summary');
    const foreignSecond = await openedSecond(prisma, foreignChain, 'VERIFY', 'phase59-foreign-summary', 'safe', FOREIGN);

    await prisma.juryImprovementTask.updateMany({
      where: { id: tamperTask.nextTaskId, tenantId: TENANT },
      data: {
        provenance: {
          kind: 'rereview-improvement',
          reReviewReviewRequestId: tamperTask.reReviewRequestId,
          reReviewReviewResultId: tamperTask.reReviewResultId,
          originalReviewRequestId: 'phase59-tamper-task-request',
          originalReviewResultId: tamperTask.reviewId,
          humanDecisionId: tamperTask.humanId,
          sourceImprovementTaskId: tamperTask.taskId,
          improvementTaskId: tamperTask.nextTaskId,
          agentExecutionId: tamperTask.executionId,
          changeGateResultId: tamperTaskSecond.gateId,
          reReviewDecision: 'VERIFY',
        },
      },
    });
    await prisma.juryReviewResult.updateMany({
      where: { id: tamperParentSecond.resultId, tenantId: TENANT },
      data: { parentReviewResultId: tamperParent.reviewId },
    });
    await prisma.juryAgentExecution.updateMany({
      where: { id: tamperSource.executionId, tenantId: TENANT },
      data: { status: 'BLOCKED' },
    });
    await prisma.juryChangeGateReview.updateMany({
      where: { id: tamperReviewSecond.reviewId, tenantId: TENANT },
      data: { reviewResultId: tamperReview.reReviewResultId },
    });

    const before = await counts(prisma);
    const sourceTaskBefore = await prisma.juryImprovementTask.findFirst({
      where: { id: verify.taskId, tenantId: TENANT },
      select: { diagnosis: true, status: true, updatedAt: true },
    });
    const deniedAuditor = await run(verifySecond.resultId, auditor);
    assert.equal(deniedAuditor.ok, false);
    if (!deniedAuditor.ok) assert.equal(deniedAuditor.reason, 'FORBIDDEN');

    const accept = await run(acceptedSecond.resultId, member);
    assert.equal(accept.ok, true, accept.ok ? '' : accept.reason);
    if (accept.ok) {
      assert.equal(accept.outcome, 'NO_IMPROVEMENT');
      assert.equal(accept.taskId, null);
      assert.equal(accept.created, false);
      assert.equal(accept.reviewId, accepted.reviewId);
    }
    const opened = await run(verifySecond.resultId, member);
    assert.equal(opened.ok, true, opened.ok ? '' : opened.reason);
    if (opened.ok) {
      assert.equal(opened.created, true);
      assert.equal(opened.outcome, 'IMPROVEMENT');
      assert.equal(opened.taskType, 'VERIFICATION');
      assert.equal(opened.taskId, reReviewImprovementTaskId(TENANT, verifySecond.resultId));
      assert.notEqual(opened.taskId, verify.nextTaskId);
      assert.equal(opened.reviewId, verify.reviewId);
    }
    const replay = await run(verifySecond.resultId, owner);
    assert.equal(replay.ok, true);
    if (replay.ok && opened.ok) {
      assert.equal(replay.created, false);
      assert.equal(replay.taskId, opened.taskId);
    }
    const reworded = await run(rewordSecond.resultId, owner);
    assert.equal(reworded.ok, true, reworded.ok ? '' : reworded.reason);
    if (reworded.ok) {
      assert.equal(reworded.created, true);
      assert.equal(reworded.taskType, 'REWORD');
    }
    const rewordReplay = await run(rewordSecond.resultId, member);
    assert.equal(rewordReplay.ok, true);
    if (rewordReplay.ok && reworded.ok) assert.equal(rewordReplay.taskId, reworded.taskId);

    const [left, right] = await Promise.all([
      run(concurrentVerifySecond.resultId, owner),
      run(concurrentVerifySecond.resultId, member),
    ]);
    assert.equal(left.ok && right.ok, true);
    if (left.ok && right.ok) assert.equal(left.taskId, right.taskId);
    const [rewordLeft, rewordRight] = await Promise.all([
      run(concurrentRewordSecond.resultId, owner),
      run(concurrentRewordSecond.resultId, member),
    ]);
    assert.equal(rewordLeft.ok && rewordRight.ok, true);
    if (rewordLeft.ok && rewordRight.ok) {
      assert.equal(rewordLeft.taskType, 'REWORD');
      assert.equal(rewordLeft.taskId, rewordRight.taskId);
    }

    for (const id of [verify.reviewId, verify.reReviewResultId, plainId, tamperTaskSecond.resultId, tamperParentSecond.resultId, tamperSourceSecond.resultId, tamperReviewSecond.resultId]) {
      const denied = await run(id);
      assert.equal(denied.ok, false, id);
      if (!denied.ok) assert.equal(denied.reason, 'NOT_REREVIEW_RESULT');
    }
    const crossed = await run(foreignSecond.resultId, owner);
    assert.equal(crossed.ok, false);
    if (!crossed.ok) assert.equal(crossed.reason, 'NOT_FOUND');
    const inbound = await run(verifySecond.resultId, foreign);
    assert.equal(inbound.ok, false);
    if (!inbound.ok) assert.equal(inbound.reason, 'NOT_FOUND');
    const blank = await persistSecondReReviewImprovement({ userId: owner.userId, memberships: [owner], reReviewResultId: '  ' });
    assert.equal(blank.ok, false);

    const verifyTask = await prisma.juryImprovementTask.findFirst({
      where: { id: reReviewImprovementTaskId(TENANT, verifySecond.resultId), tenantId: TENANT },
    });
    assert.equal(verifyTask?.taskType, 'VERIFICATION');
    assert.equal(verifyTask?.reviewResultId, verifySecond.resultId);
    assert.equal(verifyTask?.parentTaskId, verify.nextTaskId);
    assert.notEqual(verifyTask?.parentTaskId, verify.taskId);
    assert.equal(verifyTask?.evidenceId, EVIDENCE);
    assert.equal(verifyTask?.diagnosis, 'phase59-verify-summary');
    assert.deepEqual(verifyTask?.acceptanceCriteria, ['phase59-verify-summary-gap']);
    const provenance = JSON.stringify(verifyTask?.provenance);
    assert.equal(provenance.includes(verifySecond.resultId), true);
    assert.equal(provenance.includes(verify.reReviewResultId), true);
    assert.equal(provenance.includes(verify.nextTaskId), true);
    assert.equal(provenance.includes(verifySecond.executionId), true);
    assert.equal(provenance.includes(verifySecond.gateId), true);
    assert.equal(provenance.includes(SECRET), false);
    assert.equal(provenance.includes('postgres://'), false);
    const rewordTask = await prisma.juryImprovementTask.findFirst({
      where: { id: reReviewImprovementTaskId(TENANT, rewordSecond.resultId), tenantId: TENANT },
    });
    assert.equal(rewordTask?.taskType, 'REWORD');
    assert.equal(rewordTask?.reviewResultId, rewordSecond.resultId);
    assert.equal(rewordTask?.parentTaskId, reword.nextTaskId);
    assert.deepEqual(rewordTask?.constraints, [...REWORD_CONSTRAINTS]);
    assert.equal(JSON.stringify(rewordTask).includes(SECRET), false);

    assert.equal(await prisma.juryImprovementTask.count({ where: { tenantId: TENANT, reviewResultId: acceptedSecond.resultId } }), 0);
    assert.equal(await prisma.juryImprovementTask.count({ where: { tenantId: TENANT, reviewResultId: verifySecond.resultId } }), 1);
    assert.equal(await prisma.juryImprovementTask.count({ where: { tenantId: TENANT, reviewResultId: rewordSecond.resultId } }), 1);
    assert.equal(await prisma.juryAuditEvent.count({ where: { tenantId: TENANT, reviewId: acceptedSecond.resultId, action: 'IMPROVEMENT_TASK_CREATED' } }), 0);
    assert.equal(await prisma.juryAuditEvent.count({ where: { tenantId: TENANT, reviewId: verifySecond.resultId, action: 'IMPROVEMENT_TASK_CREATED' } }), 1);
    assert.equal(await prisma.juryAuditEvent.count({ where: { tenantId: TENANT, reviewId: rewordSecond.resultId, action: 'IMPROVEMENT_TASK_CREATED' } }), 1);
    assert.equal(await prisma.juryAuditEvent.count({ where: { tenantId: TENANT, reviewId: concurrentVerifySecond.resultId, action: 'IMPROVEMENT_TASK_CREATED' } }), 1);
    assert.equal(await prisma.juryAuditEvent.count({ where: { tenantId: TENANT, reviewId: concurrentRewordSecond.resultId, action: 'IMPROVEMENT_TASK_CREATED' } }), 1);
    const audit = JSON.stringify(await prisma.juryAuditEvent.findFirst({
      where: { tenantId: TENANT, reviewId: verifySecond.resultId, action: 'IMPROVEMENT_TASK_CREATED' },
    }));
    assert.equal(audit.includes(SECRET), false);
    assert.equal(audit.includes('postgres://'), false);

    const after = await counts(prisma);
    assert.equal(after.tasks, before.tasks + 4);
    assert.equal(after.executions, before.executions);
    assert.equal(after.gates, before.gates);
    assert.equal(after.gateReviews, before.gateReviews);
    assert.equal(after.humans, before.humans);
    assert.equal(after.results, before.results);
    assert.equal(after.evidence, before.evidence);
    assert.equal(after.cycles, 0);
    assert.equal(after.loops, 0);
    const sourceTaskAfter = await prisma.juryImprovementTask.findFirst({
      where: { id: verify.taskId, tenantId: TENANT },
      select: { diagnosis: true, status: true, updatedAt: true },
    });
    assert.equal(sourceTaskAfter?.diagnosis, sourceTaskBefore?.diagnosis);
    assert.equal(sourceTaskAfter?.status, sourceTaskBefore?.status);
    assert.equal(sourceTaskAfter?.updatedAt?.toISOString(), sourceTaskBefore?.updatedAt?.toISOString());
    const previous = await prisma.juryReviewResult.findFirst({ where: { id: verify.reReviewResultId, tenantId: TENANT } });
    const second = await prisma.juryReviewResult.findFirst({ where: { id: verifySecond.resultId, tenantId: TENANT } });
    assert.equal(previous?.expectedDecision, 'VERIFY');
    assert.equal(second?.expectedDecision, 'VERIFY');
    assert.equal((await prisma.juryNormalizedMetric.findFirst({ where: { id: 'phase59-zero', tenantId: TENANT } }))?.value, 0);
    assert.equal((await prisma.juryNormalizedMetric.findFirst({ where: { id: 'phase59-null', tenantId: TENANT } }))?.value, null);
    const shown = await loadReviewConsole(ownerActor, verify.reviewId);
    assert.equal(shown.ok && shown.screen.nextSecondImprovement?.taskType, 'VERIFICATION');
    assert.equal(shown.ok && shown.screen.canCreateSecondImprovement, false);
    const acceptedScreen = await loadReviewConsole(ownerActor, accepted.reviewId);
    assert.equal(acceptedScreen.ok && acceptedScreen.screen.secondReReviewDecision, 'ACCEPT');
    assert.equal(acceptedScreen.ok && acceptedScreen.screen.canCreateSecondImprovement, false);
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

test('second improvement reuses the phase 54 task writer', () => {
  const source = readFileSync(path.resolve(process.cwd(), 'src/lib/jury-product/rereview-second-improvement.ts'), 'utf8');
  for (const token of [
    'buildEvidencePackFromDb',
    'attachGa4Evidence',
    'runAisleAdapter',
    'GA4_PROPERTY_ID',
    'findUnique',
    'child_process',
    'persistReReviewImprovement',
    'evaluateSecondReReview',
    'evaluateHumanReReview',
    'persistHumanAgentHandoff',
    'executeReReviewAgentExecution',
    'recordDecisionCycle',
    'persistImprovementAutoLoop',
    'callFrozenReviewPipeline',
  ]) {
    assert.equal(source.includes(token), false, token);
  }
  assert.equal(source.includes('recordReReviewImprovement'), true);
  assert.equal(source.includes("action: 'improvement.write'"), true);
  assert.equal(source.includes('input.reReviewResultId'), true);
  assert.equal(source.includes('NOT_REREVIEW_RESULT'), true);
  const bridge = readFileSync(path.resolve(process.cwd(), 'src/lib/jury-product/rereview-improvement-bridge.ts'), 'utf8');
  assert.equal(bridge.includes('REWORD_CONSTRAINTS'), true);
  assert.equal(bridge.includes('NO_IMPROVEMENT'), true);
  const actions = readFileSync(path.resolve(process.cwd(), 'src/app/(root)/jury/actions.ts'), 'utf8');
  const fn = actions.slice(
    actions.indexOf('export async function createSecondReReviewImprovementTask'),
    actions.indexOf('export async function approveReReviewAgentAction'),
  );
  assert.equal(fn.includes("formData.get('reReviewResultId')"), true);
  for (const key of ['tenantId', 'taskId', 'agentExecutionId', 'changeGateResultId', 'approvalId', 'taskType', 'diagnosis']) {
    assert.equal(fn.includes(`formData.get('${key}')`), false, key);
  }
  const ui = readFileSync(path.resolve(process.cwd(), 'src/app/(root)/jury/ui.tsx'), 'utf8');
  const body = ui.slice(
    ui.indexOf('export function SecondImprovementBody'),
    ui.indexOf('export function SecondImprovementApprovalBody'),
  );
  assert.equal(body.includes('Next Improvement Task'), true);
  assert.equal(body.includes('No further improvement required'), true);
  for (const label of ['Approve for Agent', 'Send to Agent', 'Run Agent', 'Run Change Gate', 'Run Re-review', 'Auto Fix', 'Run Loop']) {
    assert.equal(body.includes(label), false, label);
  }
});

function run(reReviewResultId: string, actor: JuryMembership = owner) {
  return persistSecondReReviewImprovement({ userId: actor.userId, memberships: [actor], reReviewResultId });
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
  const connectionId = tenantId === TENANT ? CONN : 'phase59-foreign-conn';
  const evidenceId = tenantId === TENANT ? EVIDENCE : 'phase59-foreign-evidence';
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
    data: { id: 'phase59-foreign-conn', tenantId: FOREIGN, serviceKey: 'phase59-foreign-conn', displayName: 'phase59-foreign-conn', accessMethod: 'FILE_UPLOAD', status: 'CONNECTED', createdByUserId: foreign.userId },
  });
  await evidenceRow(prisma, EVIDENCE, TENANT, CONN);
  await evidenceRow(prisma, 'phase59-foreign-evidence', FOREIGN, 'phase59-foreign-conn');
  await prisma.juryNormalizedMetric.createMany({
    data: [
      metric('phase59-zero', 'userCount', 0, 'AVAILABLE'),
      metric('phase59-null', 'postsLast7d', null, 'NOT_MEASURED'),
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
  const connectionId = tenantId === TENANT ? CONN : 'phase59-foreign-conn';
  const evidenceId = tenantId === TENANT ? EVIDENCE : 'phase59-foreign-evidence';
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
      workspaceRef: { type: 'PROJECT', ref: 'phase59-fixture' }, provenance: { kind: 'human-agent-execution' },
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
    where: { username: { in: ['phase59-owner', 'phase59-member', 'phase59-auditor', 'phase59-foreign'] } },
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
