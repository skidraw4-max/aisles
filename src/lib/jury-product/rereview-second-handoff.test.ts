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
import { handoffSecondImprovement } from './rereview-second-handoff';
import { persistSecondReReviewImprovement } from './rereview-second-improvement';

const TENANT = 'phase61-rereview';
const FOREIGN = 'phase61-foreign';
const CONN = 'phase61-conn';
const EVIDENCE = 'phase61-evidence';
const NOW = '2026-10-03T04:10:00.000Z';
const LIVE_REVIEW = '3707202563ecae9b38f324a4eefd9243a14bc69420ed6cdda16c4c5794f62e0d';
const LIVE_CYCLE = '14308b4c999ccbe8ca54b7f31da5385385d4073c49bbf2955582a6bb96afb01e';
const SECRET = 'password=hidden';

const owner = membership('phase61-owner-m', TENANT, 'phase61-owner', 'OWNER');
const member = membership('phase61-member-m', TENANT, 'phase61-member', 'DEVELOPER');
const auditor = membership('phase61-auditor-m', TENANT, 'phase61-auditor', 'VIEWER');
const foreign = membership('phase61-foreign-m', FOREIGN, 'phase61-foreign', 'OWNER');
const ownerActor: JuryActor = { ok: true, userId: owner.userId, tenantId: TENANT, role: 'OWNER', membershipId: owner.id };
const memberActor: JuryActor = { ok: true, userId: member.userId, tenantId: TENANT, role: 'DEVELOPER', membershipId: member.id };
const auditorActor: JuryActor = { ok: true, userId: auditor.userId, tenantId: TENANT, role: 'VIEWER', membershipId: auditor.id };

test('second handoff control follows a stored second approval', () => {
  const base = {
    actor: ownerActor,
    result: { id: 'original', tenantId: TENANT, expectedDecision: 'VERIFY' as const, finalSurface: face('steady'), completedAt: NOW },
    status: 'COMPLETED' as const,
    evidenceId: EVIDENCE,
    metrics: [],
    humanDecision: 'VERIFY' as const,
    secondReReviewDecision: 'VERIFY' as const,
    nextSecondImprovement: { id: 'later', taskType: 'VERIFICATION' as const, status: 'OPEN' },
    nextSecondApproval: 'VERIFY' as const,
  };
  const ready = projectReviewConsole(base);
  assert.equal(ready.ok && ready.screen.canHandoffSecondImprovement, true);
  const memberView = projectReviewConsole({ ...base, actor: memberActor });
  assert.equal(memberView.ok && memberView.screen.canHandoffSecondImprovement, false);
  const reader = projectReviewConsole({ ...base, actor: auditorActor });
  assert.equal(reader.ok && reader.screen.canHandoffSecondImprovement, false);
  const unapproved = projectReviewConsole({ ...base, nextSecondApproval: null });
  assert.equal(unapproved.ok && unapproved.screen.canHandoffSecondImprovement, false);
  const pending = projectReviewConsole({
    ...base,
    nextSecondAgentExecution: { id: 'exec', status: 'PENDING', agent: 'CURSOR' },
  });
  assert.equal(pending.ok && pending.screen.canHandoffSecondImprovement, false);
  assert.equal(pending.ok && pending.screen.nextSecondAgentExecution?.status, 'PENDING');
});

test('approved second improvement task hands off one pending execution', { timeout: 360_000 }, async () => {
  loadEnv();
  const { prisma } = await import('@/lib/prisma');
  const liveBefore = await liveSnapshot(prisma);
  let cleanupError: string | null = null;
  try {
    await removeFixture(prisma);
    await seed(prisma);
    const accepted = await chain(prisma, 'phase61-accept', 'VERIFY');
    const verify = await chain(prisma, 'phase61-verify', 'VERIFY');
    const reword = await chain(prisma, 'phase61-reword', 'REWORD');
    const concurrent = await chain(prisma, 'phase61-concurrent', 'VERIFY');
    const missing = await chain(prisma, 'phase61-missing', 'VERIFY');
    const mismatch = await chain(prisma, 'phase61-mismatch', 'VERIFY');
    const memberChain = await chain(prisma, 'phase61-member', 'VERIFY');
    const auditorChain = await chain(prisma, 'phase61-auditor', 'VERIFY');
    const credential = await chain(prisma, 'phase61-credential', 'VERIFY');
    const foreignChain = await chain(prisma, 'phase61-foreign-review', 'VERIFY', FOREIGN);
    await prisma.juryReviewRequest.create({
      data: {
        id: 'phase61-plain-request', tenantId: TENANT, connectionId: CONN, evidenceId: EVIDENCE, reviewType: 'FULL_REVIEW',
        claim: '측정된 범위의 문구만 사용한다.', mode: 'AISLE_SELF', status: 'COMPLETED', coreRootDir: JURY_PRODUCT_DATA_ROOT,
        requestedByUserId: owner.userId,
      },
    });
    await prisma.juryReviewResult.create({
      data: {
        id: 'phase61-plain-review', tenantId: TENANT, reviewRequestId: 'phase61-plain-request', boardRunId: 'phase61-plain-board',
        evidenceStrength: 'strong', claimStrength: 'weak', conflictDetected: false, overclaimDetected: false,
        revisionRequired: false, expectedDecision: 'VERIFY', finalSurface: face('plain'), contractVersion: JURY_CORE_CONTRACT_VERSION,
        completedAt: new Date(NOW),
      },
    });
    await prisma.juryImprovementTask.create({
      data: {
        id: 'phase61-plain-task', tenantId: TENANT, reviewResultId: 'phase61-plain-review', evidenceId: EVIDENCE, diagnosis: 'plain',
        acceptanceCriteria: ['plain'], status: 'OPEN', loopIndex: 0,
        loopPolicy: { maxIterations: null, maxRuntimeMs: null, maxCostUsd: null }, taskType: 'VERIFICATION',
        provenance: { kind: 'human-decision-improvement' }, createdAt: new Date(NOW), updatedAt: new Date(NOW),
      },
    });

    const acceptedSecond = await openedSecond(prisma, accepted, 'ACCEPT', 'phase61-accept-summary');
    const verifySecond = await openedSecond(prisma, verify, 'VERIFY', 'phase61-verify-summary', SECRET);
    const rewordSecond = await openedSecond(prisma, reword, 'REWORD', 'phase61-reword-summary');
    const concurrentSecond = await openedSecond(prisma, concurrent, 'VERIFY', 'phase61-concurrent-summary');
    const missingSecond = await openedSecond(prisma, missing, 'VERIFY', 'phase61-missing-summary');
    const mismatchSecond = await openedSecond(prisma, mismatch, 'VERIFY', 'phase61-mismatch-summary');
    const memberSecond = await openedSecond(prisma, memberChain, 'VERIFY', 'phase61-member-summary');
    const auditorSecond = await openedSecond(prisma, auditorChain, 'VERIFY', 'phase61-auditor-summary');
    const credentialSecond = await openedSecond(prisma, credential, 'VERIFY', 'phase61-credential-summary');
    const foreignSecond = await openedSecond(prisma, foreignChain, 'VERIFY', 'phase61-foreign-summary', 'safe', FOREIGN);

    const acceptTask = await taskFor(acceptedSecond.resultId, member);
    assert.equal(acceptTask.ok && acceptTask.taskId, null);
    const verifyTask = await taskFor(verifySecond.resultId, member);
    const rewordTask = await taskFor(rewordSecond.resultId, owner);
    const concurrentTask = await taskFor(concurrentSecond.resultId, owner);
    const missingTask = await taskFor(missingSecond.resultId, owner);
    const mismatchTask = await taskFor(mismatchSecond.resultId, owner);
    const memberTask = await taskFor(memberSecond.resultId, owner);
    const auditorTask = await taskFor(auditorSecond.resultId, owner);
    const credentialTask = await taskFor(credentialSecond.resultId, owner);
    const foreignTask = await taskFor(foreignSecond.resultId, foreign);
    assert.equal(verifyTask.ok && verifyTask.taskId !== null, true);
    const verifyId = verifyTask.ok ? verifyTask.taskId ?? '' : '';
    const rewordId = rewordTask.ok ? rewordTask.taskId ?? '' : '';
    const concurrentId = concurrentTask.ok ? concurrentTask.taskId ?? '' : '';
    const mismatchId = mismatchTask.ok ? mismatchTask.taskId ?? '' : '';
    const memberId = memberTask.ok ? memberTask.taskId ?? '' : '';
    const auditorId = auditorTask.ok ? auditorTask.taskId ?? '' : '';
    const credentialId = credentialTask.ok ? credentialTask.taskId ?? '' : '';
    const foreignId = foreignTask.ok ? foreignTask.taskId ?? '' : '';

    assert.equal((await approve(verifyId, member)).ok, true);
    assert.equal((await approve(rewordId, owner)).ok, true);
    assert.equal((await approve(concurrentId, owner)).ok, true);
    assert.equal((await approve(mismatchId, owner)).ok, true);
    assert.equal((await approve(memberId, member)).ok, true);
    assert.equal((await approve(auditorId, owner)).ok, true);
    assert.equal((await approve(credentialId, owner)).ok, true);
    assert.equal((await approve(foreignId, foreign)).ok, true);
    await prisma.juryImprovementTask.updateMany({ where: { id: mismatchId, tenantId: TENANT }, data: { taskType: 'REWORD' } });
    await prisma.juryImprovementTask.updateMany({ where: { id: credentialId, tenantId: TENANT }, data: { diagnosis: SECRET } });

    const before = await counts(prisma);
    const metricsBefore = await metricSnapshot(prisma);
    const evidenceBefore = await prisma.juryEvidence.findFirst({ where: { id: EVIDENCE, tenantId: TENANT }, select: { contentHash: true } });
    const humansBefore = before.humans;
    const ready = await loadReviewConsole(ownerActor, verify.reviewId);
    assert.equal(ready.ok && ready.screen.canHandoffSecondImprovement, true);
    const memberView = await loadReviewConsole(memberActor, verify.reviewId);
    assert.equal(memberView.ok && memberView.screen.canHandoffSecondImprovement, false);

    const missingHandoff = await handoff(missingTask.ok ? missingTask.taskId ?? '' : '');
    assert.equal(missingHandoff.ok, false);
    if (!missingHandoff.ok) assert.equal(missingHandoff.reason, 'HUMAN_APPROVAL_REQUIRED');
    assert.equal(await pendingOn(prisma, missingTask.ok ? missingTask.taskId ?? '' : ''), 0);

    const opened = await handoff(verifyId);
    assert.equal(opened.ok, true, opened.ok ? '' : opened.reason);
    if (opened.ok) {
      assert.equal(opened.created, true);
      assert.equal(opened.status, 'PENDING');
      assert.equal(opened.agent, 'CURSOR');
      assert.equal(opened.reviewId, verify.reviewId);
      assert.equal(opened.improvementTaskId, verifyId);
    }
    const replay = await handoff(verifyId, owner);
    assert.equal(replay.ok, true, replay.ok ? '' : replay.reason);
    if (replay.ok && opened.ok) {
      assert.equal(replay.created, false);
      assert.equal(replay.agentExecutionId, opened.agentExecutionId);
    }
    const stored = await prisma.juryAgentExecution.findFirst({ where: { id: opened.ok ? opened.agentExecutionId : '', tenantId: TENANT } });
    assert.equal(stored?.status, 'PENDING');
    assert.equal(stored?.agent, 'CURSOR');
    assert.equal(stored?.startedAt, null);
    assert.equal(stored?.finishedAt, null);
    assert.equal(stored?.taskId, verifyId);
    assert.deepEqual(stored?.workspaceRef, { type: 'PROJECT', ref: 'jury-product' });
    const snapshot = JSON.stringify(stored?.inputSnapshot);
    const provenance = JSON.stringify(stored?.provenance);
    assert.equal(snapshot.includes(SECRET), false);
    assert.equal(snapshot.includes('postgres://'), false);
    assert.equal(provenance.includes('human-agent-handoff'), true);
    assert.equal(await auditsOn(prisma, verifyId), 1);
    assert.equal(await pendingOn(prisma, verifyId), 1);

    const reworded = await handoff(rewordId);
    assert.equal(reworded.ok, true, reworded.ok ? '' : reworded.reason);
    if (reworded.ok) {
      assert.equal(reworded.created, true);
      assert.equal(reworded.status, 'PENDING');
      assert.equal(reworded.reviewId, reword.reviewId);
    }
    assert.equal(await pendingOn(prisma, rewordId), 1);
    assert.equal(await auditsOn(prisma, rewordId), 1);

    const [left, right] = await Promise.all([handoff(concurrentId, owner), handoff(concurrentId, owner)]);
    assert.equal(left.ok && right.ok, true, `${left.ok ? '' : left.reason} ${right.ok ? '' : right.reason}`);
    if (left.ok && right.ok) assert.equal(left.agentExecutionId, right.agentExecutionId);
    assert.equal(await pendingOn(prisma, concurrentId), 1);
    assert.equal(await auditsOn(prisma, concurrentId), 1);

    const mismatchHandoff = await handoff(mismatchId);
    assert.equal(mismatchHandoff.ok, false);
    if (!mismatchHandoff.ok) assert.equal(mismatchHandoff.reason, 'HUMAN_APPROVAL_REQUIRED');
    assert.equal(await pendingOn(prisma, mismatchId), 0);
    const originalHandoff = await handoff(verify.taskId);
    assert.equal(originalHandoff.ok, false);
    if (!originalHandoff.ok) assert.equal(originalHandoff.reason, 'NOT_REREVIEW_IMPROVEMENT_TASK');
    const firstHandoff = await handoff(verify.nextTaskId);
    assert.equal(firstHandoff.ok, false);
    if (!firstHandoff.ok) assert.equal(firstHandoff.reason, 'NOT_REREVIEW_IMPROVEMENT_TASK');
    assert.equal(await pendingOn(prisma, verify.nextTaskId), 0);
    const plainHandoff = await handoff('phase61-plain-task');
    assert.equal(plainHandoff.ok, false);
    if (!plainHandoff.ok) assert.equal(plainHandoff.reason, 'NOT_REREVIEW_IMPROVEMENT_TASK');
    const acceptHandoff = await handoff(accepted.nextTaskId);
    assert.equal(acceptHandoff.ok, false);
    if (!acceptHandoff.ok) assert.equal(acceptHandoff.reason, 'NOT_REREVIEW_IMPROVEMENT_TASK');

    const memberHandoff = await handoff(memberId, member);
    assert.equal(memberHandoff.ok, false);
    if (!memberHandoff.ok) assert.equal(memberHandoff.reason, 'FORBIDDEN');
    assert.equal(await pendingOn(prisma, memberId), 0);
    const auditorHandoff = await handoff(auditorId, auditor);
    assert.equal(auditorHandoff.ok, false);
    if (!auditorHandoff.ok) assert.equal(auditorHandoff.reason, 'FORBIDDEN');
    assert.equal(await pendingOn(prisma, auditorId), 0);
    const unsafe = await handoff(credentialId);
    assert.equal(unsafe.ok, false);
    if (!unsafe.ok) assert.equal(unsafe.reason, 'SNAPSHOT_UNSAFE');
    assert.equal(await pendingOn(prisma, credentialId), 0);
    const foreignBefore = await prisma.juryAgentExecution.count({ where: { tenantId: FOREIGN } });
    const foreignHandoff = await handoff(foreignId, owner);
    assert.equal(foreignHandoff.ok, false);
    if (!foreignHandoff.ok) assert.equal(foreignHandoff.reason, 'NOT_FOUND');
    assert.equal(await prisma.juryAgentExecution.count({ where: { tenantId: FOREIGN } }), foreignBefore);
    assert.equal(await pendingOn(prisma, foreignId, FOREIGN), 0);

    const after = await counts(prisma);
    assert.equal(after.executions, before.executions + 3);
    assert.equal(after.humans, humansBefore);
    assert.equal(after.tasks, before.tasks);
    assert.equal(after.gates, before.gates);
    assert.equal(after.gateReviews, before.gateReviews);
    assert.equal(after.results, before.results);
    assert.equal(after.evidence, before.evidence);
    assert.equal(after.cycles, 0);
    assert.equal(after.loops, 0);
    assert.equal(await prisma.juryAgentExecution.count({ where: { tenantId: TENANT, status: 'RUNNING' } }), 0);
    assert.deepEqual(await metricSnapshot(prisma), metricsBefore);
    const evidenceAfter = await prisma.juryEvidence.findFirst({ where: { id: EVIDENCE, tenantId: TENANT }, select: { contentHash: true } });
    assert.equal(evidenceAfter?.contentHash, evidenceBefore?.contentHash);
    const shown = await loadReviewConsole(ownerActor, verify.reviewId);
    assert.equal(shown.ok && shown.screen.nextSecondAgentExecution?.status, 'PENDING');
    assert.equal(shown.ok && shown.screen.canHandoffSecondImprovement, false);
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

test('second handoff reuses the pending agent contract', () => {
  const source = readFileSync(path.resolve(process.cwd(), 'src/lib/jury-product/rereview-second-handoff.ts'), 'utf8');
  for (const token of [
    'executeReReviewAgentExecution',
    'fakeCursorAdapter',
    'FakeCursorAdapter',
    'evaluateReReviewChangeGate',
    'evaluateSecondReReview',
    'noteHumanNextAction',
    'approveSecondImprovement',
    'approveReReviewAgent',
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
  assert.equal(source.includes('persistReReviewAgentHandoff'), true);
  assert.equal(source.includes('input.improvementTaskId'), true);
  const actions = readFileSync(path.resolve(process.cwd(), 'src/app/(root)/jury/actions.ts'), 'utf8');
  const fn = actions.slice(
    actions.indexOf('export async function handoffSecondImprovementTask'),
    actions.indexOf('export async function runSecondChangeGate'),
  );
  assert.equal(fn.includes("formData.get('improvementTaskId')"), true);
  for (const key of ['tenantId', 'reviewResultId', 'humanDecisionId', 'agentExecutionId', 'changeGateResultId', 'provider', 'workspace']) {
    assert.equal(fn.includes(`formData.get('${key}')`), false, key);
  }
  const ui = readFileSync(path.resolve(process.cwd(), 'src/app/(root)/jury/ui.tsx'), 'utf8');
  const body = ui.slice(
    ui.indexOf('export function SecondImprovementHandoffBody'),
    ui.indexOf('export function SecondChangeGateBody'),
  );
  assert.equal(body.includes('Send to Agent'), true);
  assert.equal(body.includes('Agent Pending'), true);
  for (const label of ['Run Agent', 'Run Change Gate', 'Run Re-review', 'Auto Fix', 'Run Loop']) {
    assert.equal(body.includes(label), false, label);
  }
});

function handoff(improvementTaskId: string, actor: JuryMembership = owner) {
  return handoffSecondImprovement({ userId: actor.userId, memberships: [actor], improvementTaskId });
}

function approve(improvementTaskId: string, actor: JuryMembership) {
  return approveSecondImprovement({ userId: actor.userId, memberships: [actor], improvementTaskId });
}

function taskFor(reReviewResultId: string, actor: JuryMembership) {
  return persistSecondReReviewImprovement({ userId: actor.userId, memberships: [actor], reReviewResultId });
}

function pendingOn(
  prisma: Awaited<typeof import('@/lib/prisma')>['prisma'],
  taskId: string,
  tenantId = TENANT,
) {
  return prisma.juryAgentExecution.count({ where: { tenantId, taskId, status: 'PENDING' } });
}

function auditsOn(prisma: Awaited<typeof import('@/lib/prisma')>['prisma'], taskId: string) {
  return prisma.juryAuditEvent.count({ where: { tenantId: TENANT, improvementTaskId: taskId, action: 'AGENT_HANDOFF_CREATED' } });
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
  const connectionId = tenantId === TENANT ? CONN : 'phase61-foreign-conn';
  const evidenceId = tenantId === TENANT ? EVIDENCE : 'phase61-foreign-evidence';
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
    data: { id: 'phase61-foreign-conn', tenantId: FOREIGN, serviceKey: 'phase61-foreign-conn', displayName: 'phase61-foreign-conn', accessMethod: 'FILE_UPLOAD', status: 'CONNECTED', createdByUserId: foreign.userId },
  });
  await evidenceRow(prisma, EVIDENCE, TENANT, CONN);
  await evidenceRow(prisma, 'phase61-foreign-evidence', FOREIGN, 'phase61-foreign-conn');
  await prisma.juryNormalizedMetric.createMany({
    data: [
      metric('phase61-zero', 'userCount', 0, 'AVAILABLE'),
      metric('phase61-null', 'postsLast7d', null, 'NOT_MEASURED'),
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
  const connectionId = tenantId === TENANT ? CONN : 'phase61-foreign-conn';
  const evidenceId = tenantId === TENANT ? EVIDENCE : 'phase61-foreign-evidence';
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
      workspaceRef: { type: 'PROJECT', ref: 'phase61-fixture' }, provenance: { kind: 'human-agent-execution' },
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
    where: { username: { in: ['phase61-owner', 'phase61-member', 'phase61-auditor', 'phase61-foreign'] } },
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
