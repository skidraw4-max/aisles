import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import type { JuryActor } from './access';
import { REWORD_CONSTRAINTS } from './improvement-bridge';
import { JURY_CORE_CONTRACT_VERSION, JURY_PRODUCT_DATA_ROOT, type JuryDecision, type JuryFinalSurface, type JuryMembership } from './records';
import { loadReviewConsole, projectReviewConsole } from './review-console';
import type { ProductReviewCore } from './review-boundary';
import { approveReReviewAgent, persistReReviewAgentHandoff } from './rereview-agent-handoff';
import { reReviewImprovementTaskId } from './rereview-improvement-bridge';
import { persistLaterReReviewImprovement } from './rereview-later-improvement';
import { evaluateLaterReReview } from './rereview-later-review';
import { approveSecondImprovement } from './rereview-second-approval';
import { handoffSecondImprovement } from './rereview-second-handoff';
import { persistSecondReReviewImprovement } from './rereview-second-improvement';

const TENANT = 'phase65-rereview';
const FOREIGN = 'phase65-foreign';
const CONN = 'phase65-conn';
const EVIDENCE = 'phase65-evidence';
const NOW = '2026-10-03T06:20:00.000Z';
const LIVE_REVIEW = '3707202563ecae9b38f324a4eefd9243a14bc69420ed6cdda16c4c5794f62e0d';
const LIVE_CYCLE = '14308b4c999ccbe8ca54b7f31da5385385d4073c49bbf2955582a6bb96afb01e';
const SECRET_PROBLEMS = ['password=hidden', 'postgres://db', 'api_key=abc', 'access_token=xyz'];

const owner = membership('phase65-owner-m', TENANT, 'phase65-owner', 'OWNER');
const member = membership('phase65-member-m', TENANT, 'phase65-member', 'DEVELOPER');
const auditor = membership('phase65-auditor-m', TENANT, 'phase65-auditor', 'VIEWER');
const foreign = membership('phase65-foreign-m', FOREIGN, 'phase65-foreign', 'OWNER');
const ownerActor: JuryActor = { ok: true, userId: owner.userId, tenantId: TENANT, role: 'OWNER', membershipId: owner.id };
const memberActor: JuryActor = { ok: true, userId: member.userId, tenantId: TENANT, role: 'DEVELOPER', membershipId: member.id };
const auditorActor: JuryActor = { ok: true, userId: auditor.userId, tenantId: TENANT, role: 'VIEWER', membershipId: auditor.id };

test('later improvement control follows a stored later re-review', () => {
  const base = {
    actor: ownerActor,
    result: { id: 'original', tenantId: TENANT, expectedDecision: 'VERIFY' as const, finalSurface: face('steady'), completedAt: NOW },
    status: 'COMPLETED' as const,
    evidenceId: EVIDENCE,
    metrics: [],
    humanDecision: 'VERIFY' as const,
    nextLaterReReview: { id: 'later-review', status: 'EXECUTED', reviewResultId: 'later-result', decision: 'VERIFY' as const },
  };
  const ready = projectReviewConsole(base);
  assert.equal(ready.ok && ready.screen.canCreateLaterImprovement, true);
  assert.equal(ready.ok && ready.screen.canRunLaterReReview, false);
  const memberView = projectReviewConsole({ ...base, actor: memberActor });
  assert.equal(memberView.ok && memberView.screen.canCreateLaterImprovement, true);
  const reader = projectReviewConsole({ ...base, actor: auditorActor });
  assert.equal(reader.ok && reader.screen.canCreateLaterImprovement, false);
  const accept = projectReviewConsole({ ...base, nextLaterReReview: { id: 'later-review', status: 'EXECUTED', reviewResultId: 'later-result', decision: 'ACCEPT' } });
  assert.equal(accept.ok && accept.screen.canCreateLaterImprovement, false);
  const reword = projectReviewConsole({ ...base, nextLaterReReview: { id: 'later-review', status: 'EXECUTED', reviewResultId: 'later-result', decision: 'REWORD' } });
  assert.equal(reword.ok && reword.screen.canCreateLaterImprovement, true);
  const tasked = projectReviewConsole({
    ...base,
    nextLaterImprovement: { id: 'later-task', taskType: 'VERIFICATION', status: 'OPEN' },
  });
  assert.equal(tasked.ok && tasked.screen.canCreateLaterImprovement, false);
  assert.equal(tasked.ok && tasked.screen.nextLaterImprovement?.id, 'later-task');
  const missing = projectReviewConsole({ ...base, nextLaterReReview: null });
  assert.equal(missing.ok && missing.screen.canCreateLaterImprovement, false);
});

test('later re-review decision creates one next improvement task', { timeout: 540_000 }, async () => {
  loadEnv();
  const { prisma } = await import('@/lib/prisma');
  const liveBefore = await liveSnapshot(prisma);
  let cleanupError: string | null = null;
  try {
    await removeFixture(prisma);
    await seed(prisma);
    const accepted = await prepare(prisma, 'phase65-accept');
    const verify = await prepare(prisma, 'phase65-verify');
    const reword = await prepare(prisma, 'phase65-reword');
    const concurrentVerify = await prepare(prisma, 'phase65-cverify');
    const concurrentReword = await prepare(prisma, 'phase65-creword');
    const parent = await prepare(prisma, 'phase65-parent');
    const execution = await prepare(prisma, 'phase65-execution');
    const status = await prepare(prisma, 'phase65-status');
    const gated = await prepare(prisma, 'phase65-gated');
    const noReview = await prepare(prisma, 'phase65-noreview');
    const noGate = await prepare(prisma, 'phase65-nogate');
    const lineage = await prepare(prisma, 'phase65-lineage');
    const foreignRow = await prepare(prisma, 'phase65-foreign-review', FOREIGN);
    const plainId = 'phase65-plain-review';
    await prisma.juryReviewRequest.create({
      data: {
        id: 'phase65-plain-request', tenantId: TENANT, connectionId: CONN, evidenceId: EVIDENCE, reviewType: 'FULL_REVIEW',
        claim: '측정된 범위의 문구만 사용한다.', mode: 'AISLE_SELF', status: 'COMPLETED', coreRootDir: JURY_PRODUCT_DATA_ROOT,
        requestedByUserId: owner.userId,
      },
    });
    await prisma.juryReviewResult.create({
      data: {
        id: plainId, tenantId: TENANT, reviewRequestId: 'phase65-plain-request', boardRunId: 'phase65-plain-board',
        evidenceStrength: 'strong', claimStrength: 'weak', conflictDetected: false, overclaimDetected: false,
        revisionRequired: false, expectedDecision: 'VERIFY', finalSurface: face('plain'), contractVersion: JURY_CORE_CONTRACT_VERSION,
        completedAt: new Date(NOW),
      },
    });

    const acceptedResult = await openLater(prisma, accepted, 'ACCEPT', 'phase65-accept-summary');
    const verifyResult = await openLater(prisma, verify, 'VERIFY', 'phase65-verify-summary', true);
    const rewordResult = await openLater(prisma, reword, 'REWORD', 'phase65-reword-summary');
    const concurrentVerifyResult = await openLater(prisma, concurrentVerify, 'VERIFY', 'phase65-cverify-summary');
    const concurrentRewordResult = await openLater(prisma, concurrentReword, 'REWORD', 'phase65-creword-summary');
    const parentResult = await openLater(prisma, parent, 'VERIFY', 'phase65-parent-summary');
    const executionResult = await openLater(prisma, execution, 'VERIFY', 'phase65-execution-summary');
    const statusResult = await openLater(prisma, status, 'VERIFY', 'phase65-status-summary');
    const gatedResult = await openLater(prisma, gated, 'VERIFY', 'phase65-gated-summary');
    const noReviewResult = await openLater(prisma, noReview, 'VERIFY', 'phase65-noreview-summary');
    const noGateResult = await openLater(prisma, noGate, 'VERIFY', 'phase65-nogate-summary');
    const lineageResult = await openLater(prisma, lineage, 'VERIFY', 'phase65-lineage-summary');
    const foreignResult = await openLater(prisma, foreignRow, 'VERIFY', 'phase65-foreign-summary', false, FOREIGN);

    await prisma.juryReviewResult.updateMany({
      where: { id: parentResult, tenantId: TENANT },
      data: { parentReviewResultId: parent.rootId },
    });
    await prisma.juryChangeGateReview.updateMany({
      where: { changeGateResultId: execution.gateId, tenantId: TENANT },
      data: { agentExecutionId: execution.sourceExecutionId },
    });
    await prisma.juryAgentExecution.updateMany({
      where: { id: status.executionId, tenantId: TENANT },
      data: { status: 'PENDING' },
    });
    await prisma.juryChangeGateResult.updateMany({
      where: { id: gated.gateId, tenantId: TENANT },
      data: { status: 'GATED', gate: 'NEEDS_APPROVAL', errorCode: 'AGENT_REPORTED_FILE_NOT_FOUND_IN_WORKSPACE' },
    });
    await prisma.juryChangeGateReview.deleteMany({ where: { reviewResultId: noReviewResult, tenantId: TENANT } });
    await prisma.juryChangeGateReview.deleteMany({ where: { changeGateResultId: noGate.gateId, tenantId: TENANT } });
    await prisma.juryChangeGateResult.deleteMany({ where: { id: noGate.gateId, tenantId: TENANT } });
    await prisma.juryImprovementTask.updateMany({
      where: { id: lineage.sourceTaskId, tenantId: TENANT },
      data: { provenance: { kind: 'human-decision-improvement' } },
    });

    const before = await counts(prisma);
    const metricsBefore = await metricSnapshot(prisma);
    const evidenceBefore = await prisma.juryEvidence.findFirst({ where: { id: EVIDENCE, tenantId: TENANT }, select: { contentHash: true } });
    const sourceBefore = await prisma.juryImprovementTask.findFirst({
      where: { id: verify.sourceTaskId, tenantId: TENANT },
      select: { diagnosis: true, status: true, updatedAt: true, provenance: true },
    });
    const secondTaskBefore = await prisma.juryImprovementTask.findFirst({
      where: { id: verify.taskId, tenantId: TENANT },
      select: { diagnosis: true, status: true, updatedAt: true, provenance: true },
    });
    const phase58Tasks = await prisma.juryImprovementTask.count({ where: { tenantId: TENANT, reviewResultId: verify.secondResultId } });
    const waiting = await loadReviewConsole(ownerActor, verify.rootId);
    assert.equal(waiting.ok && waiting.screen.canCreateLaterImprovement, true);
    assert.equal(waiting.ok && waiting.screen.nextLaterReReview?.decision, 'VERIFY');
    assert.equal(waiting.ok && waiting.screen.nextLaterImprovement, null);
    const memberWaiting = await loadReviewConsole(memberActor, verify.rootId);
    assert.equal(memberWaiting.ok && memberWaiting.screen.canCreateLaterImprovement, true);
    const auditorWaiting = await loadReviewConsole(auditorActor, verify.rootId);
    assert.equal(auditorWaiting.ok && auditorWaiting.screen.canCreateLaterImprovement, false);

    const deniedAuditor = await run(verifyResult, auditor);
    assert.equal(deniedAuditor.ok, false);
    if (!deniedAuditor.ok) assert.equal(deniedAuditor.reason, 'FORBIDDEN');

    const accept = await run(acceptedResult, member);
    assert.equal(accept.ok, true, accept.ok ? '' : accept.reason);
    if (accept.ok) {
      assert.equal(accept.outcome, 'NO_IMPROVEMENT');
      assert.equal(accept.created, false);
      assert.equal(accept.taskId, null);
      assert.equal(accept.reviewId, accepted.rootId);
    }
    const acceptReplay = await run(acceptedResult, owner);
    assert.equal(acceptReplay.ok, true);
    if (acceptReplay.ok) assert.equal(acceptReplay.taskId, null);

    const opened = await run(verifyResult, member);
    assert.equal(opened.ok, true, opened.ok ? '' : opened.reason);
    if (opened.ok) {
      assert.equal(opened.created, true);
      assert.equal(opened.outcome, 'IMPROVEMENT');
      assert.equal(opened.taskType, 'VERIFICATION');
      assert.equal(opened.taskId, reReviewImprovementTaskId(TENANT, verifyResult));
      assert.equal(opened.reviewId, verify.rootId);
      assert.notEqual(opened.reviewId, verify.firstResultId);
      assert.notEqual(opened.reviewId, verify.secondResultId);
    }
    const replay = await run(verifyResult, owner);
    assert.equal(replay.ok, true);
    if (replay.ok && opened.ok) {
      assert.equal(replay.created, false);
      assert.equal(replay.taskId, opened.taskId);
    }
    const reworded = await run(rewordResult, owner);
    assert.equal(reworded.ok, true, reworded.ok ? '' : reworded.reason);
    if (reworded.ok) {
      assert.equal(reworded.created, true);
      assert.equal(reworded.taskType, 'REWORD');
      assert.equal(reworded.reviewId, reword.rootId);
    }
    const rewordReplay = await run(rewordResult, member);
    assert.equal(rewordReplay.ok, true);
    if (rewordReplay.ok && reworded.ok) {
      assert.equal(rewordReplay.created, false);
      assert.equal(rewordReplay.taskId, reworded.taskId);
    }

    const [left, right] = await Promise.all([
      run(concurrentVerifyResult, owner),
      run(concurrentVerifyResult, member),
    ]);
    assert.equal(left.ok && right.ok, true);
    if (left.ok && right.ok) assert.equal(left.taskId, right.taskId);
    const [rewordLeft, rewordRight] = await Promise.all([
      run(concurrentRewordResult, owner),
      run(concurrentRewordResult, member),
    ]);
    assert.equal(rewordLeft.ok && rewordRight.ok, true);
    if (rewordLeft.ok && rewordRight.ok) {
      assert.equal(rewordLeft.taskType, 'REWORD');
      assert.equal(rewordLeft.taskId, rewordRight.taskId);
    }

    for (const id of [verify.rootId, verify.firstResultId, verify.secondResultId, plainId, parentResult, executionResult, statusResult, gatedResult, noReviewResult, noGateResult, lineageResult]) {
      const denied = await run(id);
      assert.equal(denied.ok, false, id);
      if (!denied.ok) assert.equal(denied.reason, 'NOT_REREVIEW_RESULT');
    }
    await prisma.juryAgentExecution.updateMany({ where: { id: status.executionId, tenantId: TENANT }, data: { status: 'RUNNING' } });
    const running = await run(statusResult);
    assert.equal(running.ok, false);
    if (!running.ok) assert.equal(running.reason, 'NOT_REREVIEW_RESULT');
    const crossed = await run(foreignResult, owner);
    assert.equal(crossed.ok, false);
    if (!crossed.ok) assert.equal(crossed.reason, 'NOT_FOUND');
    const inbound = await run(verifyResult, foreign);
    assert.equal(inbound.ok, false);
    if (!inbound.ok) assert.equal(inbound.reason, 'NOT_FOUND');
    const blank = await persistLaterReReviewImprovement({ userId: owner.userId, memberships: [owner], reReviewResultId: '  ' });
    assert.equal(blank.ok, false);
    if (!blank.ok) assert.equal(blank.reason, 'NOT_FOUND');

    const verifyTask = await prisma.juryImprovementTask.findFirst({
      where: { id: reReviewImprovementTaskId(TENANT, verifyResult), tenantId: TENANT },
    });
    assert.equal(verifyTask?.taskType, 'VERIFICATION');
    assert.equal(verifyTask?.status, 'OPEN');
    assert.equal(verifyTask?.reviewResultId, verifyResult);
    assert.equal(verifyTask?.parentTaskId, verify.taskId);
    assert.notEqual(verifyTask?.parentTaskId, verify.sourceTaskId);
    assert.notEqual(verifyTask?.parentTaskId, verify.originTaskId);
    assert.equal(verifyTask?.evidenceId, EVIDENCE);
    assert.equal(verifyTask?.diagnosis, 'phase65-verify-summary');
    assert.deepEqual(verifyTask?.acceptanceCriteria, ['phase65-verify-summary-gap']);
    const provenance = verifyTask?.provenance as Record<string, unknown>;
    assert.equal(provenance?.kind, 'rereview-improvement');
    assert.equal(provenance?.reReviewReviewResultId, verifyResult);
    assert.equal(provenance?.originalReviewResultId, verify.secondResultId);
    assert.equal(provenance?.sourceImprovementTaskId, verify.taskId);
    assert.equal(provenance?.agentExecutionId, verify.executionId);
    assert.equal(provenance?.changeGateResultId, verify.gateId);
    const stored = JSON.stringify(verifyTask);
    for (const secret of SECRET_PROBLEMS) assert.equal(stored.includes(secret.split('=')[0] ?? secret), false, secret);
    assert.equal(stored.includes('postgres://'), false);
    const rewordTask = await prisma.juryImprovementTask.findFirst({
      where: { id: reReviewImprovementTaskId(TENANT, rewordResult), tenantId: TENANT },
    });
    assert.equal(rewordTask?.taskType, 'REWORD');
    assert.equal(rewordTask?.status, 'OPEN');
    assert.equal(rewordTask?.reviewResultId, rewordResult);
    assert.equal(rewordTask?.parentTaskId, reword.taskId);
    assert.deepEqual(rewordTask?.constraints, [...REWORD_CONSTRAINTS]);
    assert.equal(rewordTask?.diagnosis, 'phase65-reword-summary');

    const later = await prisma.juryReviewResult.findFirst({ where: { id: verifyResult, tenantId: TENANT } });
    const previous = await prisma.juryReviewResult.findFirst({ where: { id: verify.secondResultId, tenantId: TENANT } });
    const first = await prisma.juryReviewResult.findFirst({ where: { id: verify.firstResultId, tenantId: TENANT } });
    assert.equal(later?.parentReviewResultId, verify.secondResultId);
    assert.equal(later?.expectedDecision, 'VERIFY');
    assert.equal(previous?.parentReviewResultId, verify.firstResultId);
    assert.equal(first?.parentReviewResultId, verify.rootId);
    assert.equal(await prisma.juryImprovementTask.count({ where: { tenantId: TENANT, reviewResultId: acceptedResult } }), 0);
    assert.equal(await prisma.juryImprovementTask.count({ where: { tenantId: TENANT, reviewResultId: verifyResult } }), 1);
    assert.equal(await prisma.juryImprovementTask.count({ where: { tenantId: TENANT, reviewResultId: rewordResult } }), 1);
    assert.equal(await prisma.juryImprovementTask.count({ where: { tenantId: TENANT, reviewResultId: verify.secondResultId } }), phase58Tasks);
    assert.equal(await prisma.juryAuditEvent.count({ where: { tenantId: TENANT, reviewId: acceptedResult, action: 'IMPROVEMENT_TASK_CREATED' } }), 0);
    assert.equal(await prisma.juryAuditEvent.count({ where: { tenantId: TENANT, reviewId: verifyResult, action: 'IMPROVEMENT_TASK_CREATED' } }), 1);
    assert.equal(await prisma.juryAuditEvent.count({ where: { tenantId: TENANT, reviewId: rewordResult, action: 'IMPROVEMENT_TASK_CREATED' } }), 1);
    assert.equal(await prisma.juryAuditEvent.count({ where: { tenantId: TENANT, reviewId: concurrentVerifyResult, action: 'IMPROVEMENT_TASK_CREATED' } }), 1);
    assert.equal(await prisma.juryAuditEvent.count({ where: { tenantId: TENANT, reviewId: concurrentRewordResult, action: 'IMPROVEMENT_TASK_CREATED' } }), 1);
    const audit = JSON.stringify(await prisma.juryAuditEvent.findFirst({
      where: { tenantId: TENANT, reviewId: verifyResult, action: 'IMPROVEMENT_TASK_CREATED' },
    }));
    for (const token of ['password', 'postgres://', 'api_key', 'access_token']) assert.equal(audit.includes(token), false, token);

    const after = await counts(prisma);
    assert.equal(after.tasks, before.tasks + 4);
    assert.equal(after.executions, before.executions);
    assert.equal(after.gates, before.gates);
    assert.equal(after.gateReviews, before.gateReviews);
    assert.equal(after.humans, before.humans);
    assert.equal(after.results, before.results);
    assert.equal(after.requests, before.requests);
    assert.equal(after.evidence, before.evidence);
    assert.equal(after.cycles, 0);
    assert.equal(after.loops, 0);
    const sourceAfter = await prisma.juryImprovementTask.findFirst({
      where: { id: verify.sourceTaskId, tenantId: TENANT },
      select: { diagnosis: true, status: true, updatedAt: true, provenance: true },
    });
    const secondTaskAfter = await prisma.juryImprovementTask.findFirst({
      where: { id: verify.taskId, tenantId: TENANT },
      select: { diagnosis: true, status: true, updatedAt: true, provenance: true },
    });
    assert.equal(sourceAfter?.diagnosis, sourceBefore?.diagnosis);
    assert.equal(sourceAfter?.status, sourceBefore?.status);
    assert.equal(sourceAfter?.updatedAt?.toISOString(), sourceBefore?.updatedAt?.toISOString());
    assert.deepEqual(sourceAfter?.provenance, sourceBefore?.provenance);
    assert.equal(secondTaskAfter?.diagnosis, secondTaskBefore?.diagnosis);
    assert.equal(secondTaskAfter?.status, secondTaskBefore?.status);
    assert.equal(secondTaskAfter?.updatedAt?.toISOString(), secondTaskBefore?.updatedAt?.toISOString());
    assert.deepEqual(secondTaskAfter?.provenance, secondTaskBefore?.provenance);
    assert.deepEqual(await metricSnapshot(prisma), metricsBefore);
    const evidenceAfter = await prisma.juryEvidence.findFirst({ where: { id: EVIDENCE, tenantId: TENANT }, select: { contentHash: true } });
    assert.equal(evidenceAfter?.contentHash, evidenceBefore?.contentHash);
    const shown = await loadReviewConsole(ownerActor, verify.rootId);
    assert.equal(shown.ok && shown.screen.nextLaterImprovement?.taskType, 'VERIFICATION');
    assert.equal(shown.ok && shown.screen.nextLaterImprovement?.status, 'OPEN');
    assert.equal(shown.ok && shown.screen.canCreateLaterImprovement, false);
    const acceptedScreen = await loadReviewConsole(ownerActor, accepted.rootId);
    assert.equal(acceptedScreen.ok && acceptedScreen.screen.nextLaterReReview?.decision, 'ACCEPT');
    assert.equal(acceptedScreen.ok && acceptedScreen.screen.canCreateLaterImprovement, false);
    assert.equal(acceptedScreen.ok && acceptedScreen.screen.nextLaterImprovement, null);
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

test('later improvement reuses the phase 59 task writer', () => {
  const source = readFileSync(path.resolve(process.cwd(), 'src/lib/jury-product/rereview-later-improvement.ts'), 'utf8');
  for (const token of [
    'evaluateChangeGate',
    'evaluateLaterReReview',
    'noteHumanNextAction',
    'handoffSecondImprovement',
    'approveSecondImprovement',
    'recordDecisionCycle',
    'persistImprovementAutoLoop',
    'callFrozenReviewPipeline',
    'buildEvidencePackFromDb',
    'attachGa4Evidence',
    'child_process',
    'findUnique',
    'REWORD_CONSTRAINTS',
  ]) {
    assert.equal(source.includes(token), false, token);
  }
  assert.equal(source.includes('persistSecondReReviewImprovement'), true);
  assert.equal(source.includes('input.reReviewResultId'), true);
  assert.equal(source.includes('NOT_REREVIEW_RESULT'), true);
  const reused = readFileSync(path.resolve(process.cwd(), 'src/lib/jury-product/rereview-second-improvement.ts'), 'utf8');
  assert.equal(reused.includes('recordReReviewImprovement'), true);
  assert.equal(reused.includes("action: 'improvement.write'"), true);
  const bridge = readFileSync(path.resolve(process.cwd(), 'src/lib/jury-product/rereview-improvement-bridge.ts'), 'utf8');
  assert.equal(bridge.includes('REWORD_CONSTRAINTS'), true);
  assert.equal(bridge.includes('humanImprovementTaskType'), true);
  assert.equal(bridge.includes('NO_IMPROVEMENT'), true);
  const actions = readFileSync(path.resolve(process.cwd(), 'src/app/(root)/jury/actions.ts'), 'utf8');
  const fn = actions.slice(
    actions.indexOf('export async function createLaterReReviewImprovementTask'),
    actions.indexOf('export async function approveLaterImprovementTask'),
  );
  assert.equal(fn.includes("formData.get('reReviewResultId')"), true);
  for (const key of ['tenantId', 'improvementTaskId', 'reviewRequestId', 'humanDecisionId', 'agentExecutionId', 'changeGateResultId', 'parentTaskId']) {
    assert.equal(fn.includes(`formData.get('${key}')`), false, key);
  }
  const ui = readFileSync(path.resolve(process.cwd(), 'src/app/(root)/jury/ui.tsx'), 'utf8');
  const body = ui.slice(
    ui.indexOf('export function LaterImprovementBody'),
    ui.indexOf('export function LaterImprovementApprovalBody'),
  );
  assert.equal(body.includes('Next Improvement Task'), true);
  assert.equal(body.includes('No Improvement'), true);
  for (const label of ['Approve for Agent', 'Send to Agent', 'Run Agent', 'Run Change Gate', 'Run Re-review', 'Auto Fix', 'Run Loop']) {
    assert.equal(body.includes(label), false, label);
  }
});

function run(reReviewResultId: string, actor: JuryMembership = owner) {
  return persistLaterReReviewImprovement({ userId: actor.userId, memberships: [actor], reReviewResultId });
}

type Prepared = {
  rootId: string;
  firstResultId: string;
  secondResultId: string;
  taskId: string;
  sourceTaskId: string;
  originTaskId: string;
  executionId: string;
  sourceExecutionId: string;
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
    sourceExecutionId: second.executionId,
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
    finalSurface: secrets ? secretFace(summary) : face(summary),
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
  const connectionId = tenantId === TENANT ? CONN : 'phase65-foreign-conn';
  const evidenceId = tenantId === TENANT ? EVIDENCE : 'phase65-foreign-evidence';
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
    data: { id: 'phase65-foreign-conn', tenantId: FOREIGN, serviceKey: 'phase65-foreign-conn', displayName: 'phase65-foreign-conn', accessMethod: 'FILE_UPLOAD', status: 'CONNECTED', createdByUserId: foreign.userId },
  });
  await prisma.juryAccessScope.create({
    data: { id: 'phase65-scope', tenantId: TENANT, connectionId: CONN, status: 'APPROVED', grants: [], approvedByUserId: owner.userId, approvedAt: new Date(NOW) },
  });
  await prisma.juryAccessScope.create({
    data: { id: 'phase65-foreign-scope', tenantId: FOREIGN, connectionId: 'phase65-foreign-conn', status: 'APPROVED', grants: [], approvedByUserId: foreign.userId, approvedAt: new Date(NOW) },
  });
  await evidenceRow(prisma, EVIDENCE, TENANT, CONN);
  await evidenceRow(prisma, 'phase65-foreign-evidence', FOREIGN, 'phase65-foreign-conn');
  await prisma.juryNormalizedMetric.createMany({
    data: [
      metric('phase65-zero', 'userCount', 0, 'AVAILABLE'),
      metric('phase65-null', 'postsLast7d', null, 'NOT_MEASURED'),
      {
        ...metric('phase65-foreign-zero', 'userCount', 0, 'AVAILABLE'),
        tenantId: FOREIGN,
        connectionId: 'phase65-foreign-conn',
        evidenceId: 'phase65-foreign-evidence',
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
  const connectionId = tenantId === TENANT ? CONN : 'phase65-foreign-conn';
  const evidenceId = tenantId === TENANT ? EVIDENCE : 'phase65-foreign-evidence';
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
      workspaceRef: { type: 'PROJECT', ref: 'phase65-fixture' }, provenance: { kind: 'human-agent-execution' },
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
      timezone: 'Asia/Seoul', metricIds: id === EVIDENCE ? ['phase65-zero', 'phase65-null'] : ['phase65-foreign-zero'], adapterKey: 'console-declared', collectedAt: new Date(NOW),
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
    where: { username: { in: ['phase65-owner', 'phase65-member', 'phase65-auditor', 'phase65-foreign'] } },
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

function secretFace(summary: string): JuryFinalSurface {
  return { ...face(summary), topProblems: [`${summary}-gap`, ...SECRET_PROBLEMS] };
}
