import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import type { JuryActor } from './access';
import { JURY_CORE_CONTRACT_VERSION, JURY_PRODUCT_DATA_ROOT, type JuryDecision, type JuryFinalSurface, type JuryMembership } from './records';
import { loadReviewConsole, projectReviewConsole } from './review-console';
import type { ProductReviewCore } from './review-boundary';
import { approveReReviewAgent, persistReReviewAgentHandoff } from './rereview-agent-handoff';
import { reReviewImprovementTaskId } from './rereview-improvement-bridge';
import { approveSecondImprovement } from './rereview-second-approval';
import { handoffSecondImprovement } from './rereview-second-handoff';
import { persistSecondReReviewImprovement } from './rereview-second-improvement';
import { evaluateLaterReReview } from './rereview-later-review';

const TENANT = 'phase64-rereview';
const FOREIGN = 'phase64-foreign';
const CONN = 'phase64-conn';
const EVIDENCE = 'phase64-evidence';
const NOW = '2026-10-03T05:10:00.000Z';
const LIVE_REVIEW = '3707202563ecae9b38f324a4eefd9243a14bc69420ed6cdda16c4c5794f62e0d';
const LIVE_CYCLE = '14308b4c999ccbe8ca54b7f31da5385385d4073c49bbf2955582a6bb96afb01e';

const owner = membership('phase64-owner-m', TENANT, 'phase64-owner', 'OWNER');
const member = membership('phase64-member-m', TENANT, 'phase64-member', 'MEMBER');
const auditor = membership('phase64-auditor-m', TENANT, 'phase64-auditor', 'AUDITOR');
const foreign = membership('phase64-foreign-m', FOREIGN, 'phase64-foreign', 'OWNER');
const ownerActor: JuryActor = { ok: true, userId: owner.userId, tenantId: TENANT, role: 'OWNER', membershipId: owner.id };
const memberActor: JuryActor = { ok: true, userId: member.userId, tenantId: TENANT, role: 'MEMBER', membershipId: member.id };
const auditorActor: JuryActor = { ok: true, userId: auditor.userId, tenantId: TENANT, role: 'AUDITOR', membershipId: auditor.id };

test('later re-review control follows an approved later change gate', () => {
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
    nextSecondAgentExecution: { id: 'exec', status: 'COMPLETED', agent: 'CURSOR' },
    nextSecondChangeGate: { id: 'gate', status: 'APPROVED', errorCode: null },
  };
  const ready = projectReviewConsole(base);
  assert.equal(ready.ok && ready.screen.canRunLaterReReview, true);
  assert.equal(ready.ok && ready.screen.canRunSecondChangeGate, false);
  const memberView = projectReviewConsole({ ...base, actor: memberActor });
  assert.equal(memberView.ok && memberView.screen.canRunLaterReReview, true);
  const reader = projectReviewConsole({ ...base, actor: auditorActor });
  assert.equal(reader.ok && reader.screen.canRunLaterReReview, false);
  const gated = projectReviewConsole({ ...base, nextSecondChangeGate: { id: 'gate', status: 'GATED', errorCode: 'AGENT_REPORTED_FILE_NOT_FOUND_IN_WORKSPACE' } });
  assert.equal(gated.ok && gated.screen.canRunLaterReReview, false);
  const blocked = projectReviewConsole({ ...base, nextSecondChangeGate: { id: 'gate', status: 'BLOCKED', errorCode: 'WORKSPACE_NOT_ALLOWED' } });
  assert.equal(blocked.ok && blocked.screen.canRunLaterReReview, false);
  const missing = projectReviewConsole({ ...base, nextSecondChangeGate: null });
  assert.equal(missing.ok && missing.screen.canRunLaterReReview, false);
  const pending = projectReviewConsole({ ...base, nextSecondAgentExecution: { id: 'exec', status: 'PENDING', agent: 'CURSOR' } });
  assert.equal(pending.ok && pending.screen.canRunLaterReReview, false);
  const done = projectReviewConsole({
    ...base,
    nextLaterReReview: { id: 'review', status: 'EXECUTED', reviewResultId: 'child', decision: 'VERIFY' },
  });
  assert.equal(done.ok && done.screen.canRunLaterReReview, false);
  assert.equal(done.ok && done.screen.nextLaterReReview?.decision, 'VERIFY');
});

test('approved later change gate reaches one re-review', { timeout: 540_000 }, async () => {
  loadEnv();
  const { prisma } = await import('@/lib/prisma');
  const liveBefore = await liveSnapshot(prisma);
  const runs: string[] = [];
  let cores = 0;
  const realCore: ProductReviewCore = async (args) => {
    cores += 1;
    const { callFrozenReviewPipeline } = await import('./review-core');
    const { createMockReviewBoardLlm } = await import('../ai-review-board/mock-llm');
    const reading = await callFrozenReviewPipeline({ ...args, llm: createMockReviewBoardLlm() });
    runs.push(reading.boardRunId);
    return reading;
  };
  const stub = (decision: JuryDecision): ProductReviewCore => async () => {
    cores += 1;
    const boardRunId = `run-phase64-${decision.toLowerCase()}-${cores}`;
    runs.push(boardRunId);
    return {
      boardRunId,
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
    const approved = await prepare(prisma, 'phase64-approved', 'approved');
    const accepted = await prepare(prisma, 'phase64-accept', 'approved');
    const verified = await prepare(prisma, 'phase64-verify', 'approved');
    const reworded = await prepare(prisma, 'phase64-reword', 'approved');
    const concurrent = await prepare(prisma, 'phase64-concurrent', 'approved');
    const gated = await prepare(prisma, 'phase64-gated', 'approved');
    const blocked = await prepare(prisma, 'phase64-blocked', 'approved');
    const missingGate = await prepare(prisma, 'phase64-nogate', 'approved');
    const status = await prepare(prisma, 'phase64-status', 'pending');
    const wrong = await prepare(prisma, 'phase64-wrong', 'approved');
    const tamper = await prepare(prisma, 'phase64-tamper', 'approved');
    const foreignRow = await prepare(prisma, 'phase64-foreign-review', 'approved', FOREIGN);

    await plantGate(prisma, approved, 'APPROVED');
    await plantGate(prisma, accepted, 'APPROVED');
    await plantGate(prisma, verified, 'APPROVED');
    await plantGate(prisma, reworded, 'APPROVED');
    await plantGate(prisma, concurrent, 'APPROVED');
    await plantGate(prisma, gated, 'GATED');
    await plantGate(prisma, blocked, 'BLOCKED');
    await plantGate(prisma, status, 'APPROVED');
    await plantGate(prisma, wrong, 'APPROVED');
    await plantGate(prisma, tamper, 'APPROVED');
    await plantGate(prisma, foreignRow, 'APPROVED', FOREIGN);

    const phase55 = await prisma.juryHumanDecision.findFirst({
      where: { tenantId: TENANT, reviewResultId: wrong.firstResultId },
      select: { id: true },
    });
    await setHuman(prisma, wrong.executionId, wrong.rootHumanId);
    const originalApproval = await evaluateLaterReReview({ userId: owner.userId, memberships: [owner], agentExecutionId: wrong.executionId, core: stub('VERIFY') });
    assert.equal(originalApproval.ok, false);
    if (!originalApproval.ok) assert.equal(originalApproval.reason, 'HUMAN_APPROVAL_REQUIRED');
    await setHuman(prisma, wrong.executionId, phase55?.id ?? 'missing-phase55');
    const firstApproval = await evaluateLaterReReview({ userId: owner.userId, memberships: [owner], agentExecutionId: wrong.executionId, core: stub('VERIFY') });
    assert.equal(firstApproval.ok, false);
    if (!firstApproval.ok) assert.equal(firstApproval.reason, 'HUMAN_APPROVAL_REQUIRED');
    await prisma.juryHumanDecision.deleteMany({ where: { tenantId: TENANT, reviewResultId: wrong.secondResultId } });
    const missingApproval = await evaluateLaterReReview({ userId: owner.userId, memberships: [owner], agentExecutionId: wrong.executionId, core: stub('VERIFY') });
    assert.equal(missingApproval.ok, false);
    if (!missingApproval.ok) assert.equal(missingApproval.reason, 'HUMAN_APPROVAL_REQUIRED');

    await prisma.juryImprovementTask.updateMany({
      where: { id: tamper.taskId, tenantId: TENANT },
      data: { provenance: { kind: 'human-decision-improvement' } },
    });

    const before = await counts(prisma);
    const metricsBefore = await metricSnapshot(prisma);
    const evidenceBefore = await prisma.juryEvidence.findFirst({ where: { id: EVIDENCE, tenantId: TENANT }, select: { contentHash: true } });
    const started = cores;
    const waiting = await loadReviewConsole(ownerActor, approved.rootId);
    assert.equal(waiting.ok && waiting.screen.canRunLaterReReview, true);
    assert.equal(waiting.ok && waiting.screen.nextSecondChangeGate?.status, 'APPROVED');

    const auditorTry = await evaluateLaterReReview({ userId: auditor.userId, memberships: [auditor], agentExecutionId: approved.executionId, core: realCore });
    assert.equal(auditorTry.ok, false);
    if (!auditorTry.ok) assert.equal(auditorTry.reason, 'FORBIDDEN');
    assert.equal(cores, started);

    const opened = await evaluateLaterReReview({ userId: owner.userId, memberships: [owner], agentExecutionId: approved.executionId, core: realCore });
    assert.equal(opened.ok, true, opened.ok ? '' : opened.reason);
    if (opened.ok) {
      assert.equal(opened.created, true);
      assert.equal(opened.reviewId, approved.rootId);
      assert.equal(opened.reReview.status, 'EXECUTED');
      assert.ok(opened.reReview.decision);
    }
    assert.equal(cores, started + 1);
    const child = await prisma.juryReviewResult.findFirst({ where: { id: opened.ok ? opened.reReview.reviewResultId ?? '' : '', tenantId: TENANT } });
    assert.equal(child?.parentReviewResultId, approved.secondResultId);
    assert.notEqual(child?.parentReviewResultId, approved.rootId);
    assert.notEqual(child?.parentReviewResultId, approved.firstResultId);
    const previous = await prisma.juryReviewResult.findFirst({ where: { id: approved.secondResultId, tenantId: TENANT } });
    assert.equal(previous?.parentReviewResultId, approved.firstResultId);
    const first = await prisma.juryReviewResult.findFirst({ where: { id: approved.firstResultId, tenantId: TENANT } });
    assert.equal(first?.parentReviewResultId, approved.rootId);
    const stamped = await prisma.juryChangeGateReview.findFirst({ where: { changeGateResultId: approved.gateId, tenantId: TENANT } });
    assert.equal(textField(stamped?.provenance, 'originalReviewResultId'), approved.rootId);
    assert.equal(textField(stamped?.provenance, 'previousReReviewResultId'), approved.secondResultId);
    assert.equal(textField(stamped?.provenance, 'secondImprovementTaskId'), approved.taskId);
    assert.equal(textField(stamped?.provenance, 'secondHumanDecisionId'), approved.approvalId);
    assert.equal(textField(stamped?.provenance, 'secondAgentExecutionId'), approved.executionId);
    assert.equal(textField(stamped?.provenance, 'secondChangeGateResultId'), approved.gateId);
    assert.equal(JSON.stringify(stamped?.provenance).toLowerCase().includes('password'), false);

    const replay = await evaluateLaterReReview({ userId: owner.userId, memberships: [owner], agentExecutionId: approved.executionId, core: realCore });
    assert.equal(replay.ok, true);
    if (replay.ok && opened.ok) {
      assert.equal(replay.created, false);
      assert.equal(replay.reReview.reviewResultId, opened.reReview.reviewResultId);
    }
    assert.equal(cores, started + 1);
    assert.equal(await prisma.juryChangeGateReview.count({ where: { changeGateResultId: approved.gateId, tenantId: TENANT } }), 1);
    assert.equal(await prisma.juryReviewResult.count({ where: { tenantId: TENANT, parentReviewResultId: approved.secondResultId } }), 1);

    for (const [row, decision] of [[accepted, 'ACCEPT'], [verified, 'VERIFY'], [reworded, 'REWORD']] as const) {
      const ran = await evaluateLaterReReview({ userId: member.userId, memberships: [member], agentExecutionId: row.executionId, core: stub(decision) });
      assert.equal(ran.ok, true, ran.ok ? '' : ran.reason);
      if (ran.ok) assert.equal(ran.reReview.decision, decision);
      assert.equal(await prisma.juryImprovementTask.count({ where: { tenantId: TENANT, reviewResultId: ran.ok ? ran.reReview.reviewResultId ?? '' : 'none' } }), 0);
    }

    const [left, right] = await Promise.all([
      evaluateLaterReReview({ userId: owner.userId, memberships: [owner], agentExecutionId: concurrent.executionId, core: stub('VERIFY') }),
      evaluateLaterReReview({ userId: owner.userId, memberships: [owner], agentExecutionId: concurrent.executionId, core: stub('VERIFY') }),
    ]);
    assert.equal(left.ok || right.ok, true);
    assert.equal(await prisma.juryChangeGateReview.count({ where: { changeGateResultId: concurrent.gateId, tenantId: TENANT } }), 1);
    assert.equal(await prisma.juryReviewResult.count({ where: { tenantId: TENANT, parentReviewResultId: concurrent.secondResultId } }), 1);

    const gatedTry = await evaluateLaterReReview({ userId: owner.userId, memberships: [owner], agentExecutionId: gated.executionId, core: stub('VERIFY') });
    assert.equal(gatedTry.ok, false);
    if (!gatedTry.ok) assert.equal(gatedTry.reason, 'RE-REVIEW_NOT_APPROVED');
    const blockedTry = await evaluateLaterReReview({ userId: owner.userId, memberships: [owner], agentExecutionId: blocked.executionId, core: stub('VERIFY') });
    assert.equal(blockedTry.ok, false);
    if (!blockedTry.ok) assert.equal(blockedTry.reason, 'RE-REVIEW_NOT_APPROVED');
    const noGate = await evaluateLaterReReview({ userId: owner.userId, memberships: [owner], agentExecutionId: missingGate.executionId, core: stub('VERIFY') });
    assert.equal(noGate.ok, false);
    if (!noGate.ok) assert.equal(noGate.reason, 'RE-REVIEW_NOT_APPROVED');
    for (const row of [gated, blocked, missingGate]) {
      assert.equal(await prisma.juryReviewResult.count({ where: { tenantId: TENANT, parentReviewResultId: row.secondResultId } }), 0);
    }

    const pendingTry = await evaluateLaterReReview({ userId: owner.userId, memberships: [owner], agentExecutionId: status.executionId, core: stub('VERIFY') });
    assert.equal(pendingTry.ok, false);
    if (!pendingTry.ok) assert.equal(pendingTry.reason, 'EXECUTION_NOT_COMPLETED');
    await prisma.juryAgentExecution.updateMany({ where: { id: status.executionId, tenantId: TENANT }, data: { status: 'RUNNING' } });
    const runningTry = await evaluateLaterReReview({ userId: owner.userId, memberships: [owner], agentExecutionId: status.executionId, core: stub('VERIFY') });
    assert.equal(runningTry.ok, false);
    if (!runningTry.ok) assert.equal(runningTry.reason, 'EXECUTION_NOT_COMPLETED');
    assert.equal(await prisma.juryReviewResult.count({ where: { tenantId: TENANT, parentReviewResultId: status.secondResultId } }), 0);

    const sourceReviews = await prisma.juryChangeGateReview.count({ where: { changeGateResultId: approved.sourceGateId, tenantId: TENANT } });
    const firstIteration = await evaluateLaterReReview({ userId: owner.userId, memberships: [owner], agentExecutionId: approved.sourceExecutionId, core: stub('VERIFY') });
    assert.equal(firstIteration.ok, false);
    if (!firstIteration.ok) assert.equal(firstIteration.reason, 'NOT_REREVIEW_IMPROVEMENT_TASK');
    assert.equal(await prisma.juryChangeGateReview.count({ where: { changeGateResultId: approved.sourceGateId, tenantId: TENANT } }), sourceReviews);
    const originalExecution = await evaluateLaterReReview({ userId: owner.userId, memberships: [owner], agentExecutionId: approved.originalExecutionId, core: stub('VERIFY') });
    assert.equal(originalExecution.ok, false);
    if (!originalExecution.ok) assert.equal(originalExecution.reason, 'NOT_REREVIEW_IMPROVEMENT_TASK');
    const tampered = await evaluateLaterReReview({ userId: owner.userId, memberships: [owner], agentExecutionId: tamper.executionId, core: stub('VERIFY') });
    assert.equal(tampered.ok, false);
    if (!tampered.ok) assert.equal(tampered.reason, 'NOT_REREVIEW_IMPROVEMENT_TASK');
    const foreignTry = await evaluateLaterReReview({ userId: owner.userId, memberships: [owner], agentExecutionId: foreignRow.executionId, core: stub('VERIFY') });
    assert.equal(foreignTry.ok, false);
    if (!foreignTry.ok) assert.equal(foreignTry.reason, 'NOT_FOUND');
    assert.equal(cores, started + 5);

    const after = await counts(prisma);
    assert.equal(after.results, before.results + 5);
    assert.equal(after.gateReviews, before.gateReviews + 5);
    assert.equal(after.requests, before.requests + 5);
    assert.equal(after.gates, before.gates);
    assert.equal(after.executions, before.executions);
    assert.equal(after.tasks, before.tasks);
    assert.equal(after.humans, before.humans);
    assert.equal(after.evidence, before.evidence);
    assert.equal(after.cycles, 0);
    assert.equal(after.loops, 0);
    assert.deepEqual(await metricSnapshot(prisma), metricsBefore);
    const evidenceAfter = await prisma.juryEvidence.findFirst({ where: { id: EVIDENCE, tenantId: TENANT }, select: { contentHash: true } });
    assert.equal(evidenceAfter?.contentHash, evidenceBefore?.contentHash);
    const shown = await loadReviewConsole(ownerActor, approved.rootId);
    assert.equal(shown.ok && shown.screen.nextLaterReReview?.status, 'EXECUTED');
    assert.equal(shown.ok && shown.screen.canRunLaterReReview, false);
    assert.equal(shown.ok && shown.screen.nextLaterReReview?.decision, opened.ok ? opened.reReview.decision : null);
    assert.deepEqual(await liveSnapshot(prisma), liveBefore);
  } finally {
    try {
      await removeFixture(prisma);
    } catch (error) {
      cleanupError = error instanceof Error ? error.message.replace(/postgres(?:ql)?:\/\/\S+/gi, '[redacted]') : 'cleanup failed';
    }
    for (const runId of runs) {
      if (!/^run-/.test(runId)) continue;
      rmSync(path.resolve(process.cwd(), JURY_PRODUCT_DATA_ROOT, runId), { recursive: true, force: true });
    }
    assert.deepEqual(await liveSnapshot(prisma), liveBefore);
    if (cleanupError) throw new Error(cleanupError);
  }
});

test('later re-review reuses the existing change-gate review lifecycle', () => {
  const source = readFileSync(path.resolve(process.cwd(), 'src/lib/jury-product/rereview-later-review.ts'), 'utf8');
  for (const token of [
    'evaluateChangeGate',
    'evaluateImprovementChangeScope',
    'recordHumanChangeGate',
    'persistSecondReReviewImprovement',
    'persistReReviewImprovement',
    'noteHumanNextAction',
    'handoffSecondImprovement',
    'recordDecisionCycle',
    'persistImprovementAutoLoop',
    'callFrozenReviewPipeline',
    'buildEvidencePackFromDb',
    'attachGa4Evidence',
    'child_process',
    'inspectAllowlistedWorkspace',
    'findUnique',
  ]) {
    assert.equal(source.includes(token), false, token);
  }
  assert.equal(source.includes('evaluateSecondReReview'), true);
  assert.equal(source.includes('input.agentExecutionId'), true);
  const reused = readFileSync(path.resolve(process.cwd(), 'src/lib/jury-product/rereview-second-review.ts'), 'utf8');
  assert.equal(reused.includes('persistChangeGateReReviewRequest'), true);
  assert.equal(reused.includes('persistChangeGateReReviewExecution'), true);
  assert.equal(reused.includes("action: 'review.start'"), true);
  const gate = readFileSync(path.resolve(process.cwd(), 'src/lib/jury-product/change-gate.ts'), 'utf8');
  assert.equal(gate.includes('WORKSPACE_NOT_ALLOWED'), true);
  const actions = readFileSync(path.resolve(process.cwd(), 'src/app/(root)/jury/actions.ts'), 'utf8');
  const fn = actions.slice(
    actions.indexOf('export async function runLaterReReview'),
    actions.indexOf('export async function createLaterReReviewImprovementTask'),
  );
  assert.equal(fn.includes("formData.get('agentExecutionId')"), true);
  for (const key of ['tenantId', 'changeGateResultId', 'reviewResultId', 'humanDecisionId', 'improvementTaskId', 'provider', 'workspace']) {
    assert.equal(fn.includes(`formData.get('${key}')`), false, key);
  }
  const ui = readFileSync(path.resolve(process.cwd(), 'src/app/(root)/jury/ui.tsx'), 'utf8');
  const body = ui.slice(
    ui.indexOf('export function LaterReReviewBody'),
    ui.indexOf('export function LaterImprovementBody'),
  );
  assert.equal(body.includes('Run Re-review'), true);
  assert.equal(body.includes('Second Re-review Result'), true);
  assert.equal(body.includes('Decision:'), true);
  for (const label of ['Next Improvement', 'Approve for Agent', 'Send to Agent', 'Run Agent', 'Run Change Gate', 'Auto Fix', 'Run Loop']) {
    assert.equal(body.includes(label), false, label);
  }
});

type Prepared = {
  rootId: string;
  rootHumanId: string;
  taskId: string;
  executionId: string;
  approvalId: string;
  secondResultId: string;
  firstResultId: string;
  sourceExecutionId: string;
  sourceGateId: string;
  originalExecutionId: string;
  gateId: string;
};

async function prepare(
  prisma: Awaited<typeof import('@/lib/prisma')>['prisma'],
  id: string,
  finish: 'approved' | 'pending',
  tenantId = TENANT,
): Promise<Prepared> {
  const actor = tenantId === TENANT ? owner : foreign;
  const row = await chain(prisma, id, 'VERIFY', tenantId);
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
  if (finish === 'approved') {
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
  }
  return {
    rootId: row.reviewId,
    rootHumanId: row.humanId,
    taskId,
    executionId,
    approvalId: approval?.id ?? '',
    secondResultId: second.resultId,
    firstResultId: row.reReviewResultId,
    sourceExecutionId: second.executionId,
    sourceGateId: second.gateId,
    originalExecutionId: row.executionId,
    gateId: `${taskId}-later-gate`,
  };
}

async function plantGate(
  prisma: Awaited<typeof import('@/lib/prisma')>['prisma'],
  row: Prepared,
  status: 'APPROVED' | 'GATED' | 'BLOCKED',
  tenantId = TENANT,
) {
  await prisma.juryChangeGateResult.create({
    data: {
      id: row.gateId,
      tenantId,
      executionId: row.executionId,
      improvementTaskId: row.taskId,
      changedFiles: [],
      riskFlags: [],
      gate: status === 'APPROVED' ? 'PASS' : status === 'BLOCKED' ? 'BLOCK' : 'NEEDS_APPROVAL',
      status,
      errorCode: status === 'GATED' ? 'AGENT_REPORTED_FILE_NOT_FOUND_IN_WORKSPACE' : status === 'BLOCKED' ? 'WORKSPACE_NOT_ALLOWED' : null,
      createdAt: new Date(NOW),
      updatedAt: new Date(NOW),
    },
  });
}

async function setHuman(
  prisma: Awaited<typeof import('@/lib/prisma')>['prisma'],
  executionId: string,
  humanDecisionId: string,
) {
  const row = await prisma.juryAgentExecution.findFirst({ where: { id: executionId, tenantId: TENANT }, select: { provenance: true } });
  const provenance = row?.provenance && typeof row.provenance === 'object' && !Array.isArray(row.provenance)
    ? { ...row.provenance, humanDecisionId }
    : { humanDecisionId };
  await prisma.juryAgentExecution.updateMany({ where: { id: executionId, tenantId: TENANT }, data: { provenance } });
}

async function retry<T extends { ok: boolean; reason?: string }>(run: () => Promise<T>): Promise<T> {
  const first = await run();
  if (first.ok || first.reason !== 'PERSISTENCE_FAILED') return first;
  return run();
}

async function openedSecond(
  prisma: Awaited<typeof import('@/lib/prisma')>['prisma'],
  row: Chain,
  tenantId = TENANT,
) {
  const actor = tenantId === TENANT ? owner : foreign;
  const connectionId = tenantId === TENANT ? CONN : 'phase64-foreign-conn';
  const evidenceId = tenantId === TENANT ? EVIDENCE : 'phase64-foreign-evidence';
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
  return { resultId, gateId, executionId };
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
    data: { id: 'phase64-foreign-conn', tenantId: FOREIGN, serviceKey: 'phase64-foreign-conn', displayName: 'phase64-foreign-conn', accessMethod: 'FILE_UPLOAD', status: 'CONNECTED', createdByUserId: foreign.userId },
  });
  await prisma.juryAccessScope.create({
    data: { id: 'phase64-scope', tenantId: TENANT, connectionId: CONN, status: 'APPROVED', grants: [], approvedByUserId: owner.userId, approvedAt: new Date(NOW) },
  });
  await evidenceRow(prisma, EVIDENCE, TENANT, CONN);
  await evidenceRow(prisma, 'phase64-foreign-evidence', FOREIGN, 'phase64-foreign-conn');
  await prisma.juryNormalizedMetric.createMany({
    data: [
      metric('phase64-zero', 'userCount', 0, 'AVAILABLE'),
      metric('phase64-null', 'postsLast7d', null, 'NOT_MEASURED'),
    ],
  });
}

type Chain = {
  reviewId: string;
  humanId: string;
  executionId: string;
  reReviewResultId: string;
  nextTaskId: string;
};

async function chain(
  prisma: Awaited<typeof import('@/lib/prisma')>['prisma'],
  id: string,
  reDecision: JuryDecision,
  tenantId = TENANT,
): Promise<Chain> {
  const actor = tenantId === TENANT ? owner : foreign;
  const connectionId = tenantId === TENANT ? CONN : 'phase64-foreign-conn';
  const evidenceId = tenantId === TENANT ? EVIDENCE : 'phase64-foreign-evidence';
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
      workspaceRef: { type: 'PROJECT', ref: 'phase64-fixture' }, provenance: { kind: 'human-agent-execution' },
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
      taskType: 'VERIFICATION',
      provenance: {
        kind: 'rereview-improvement', reReviewReviewRequestId: reReviewRequestId, reReviewReviewResultId: reReviewResultId,
        originalReviewRequestId: requestId, originalReviewResultId: reviewId, humanDecisionId: humanId,
        sourceImprovementTaskId: taskId, improvementTaskId: nextTaskId, agentExecutionId: executionId, changeGateResultId: gateId,
        reReviewDecision: reDecision,
      },
      createdAt: new Date(NOW), updatedAt: new Date(NOW),
    },
  });
  return { reviewId, humanId, executionId, reReviewResultId, nextTaskId };
}

async function evidenceRow(prisma: Awaited<typeof import('@/lib/prisma')>['prisma'], id: string, tenantId: string, connectionId: string) {
  await prisma.juryEvidence.create({
    data: {
      id, tenantId, connectionId, purpose: 'tenant-declared-observation', periodStart: '2026-09-25', periodEnd: '2026-10-01',
      timezone: 'Asia/Seoul', metricIds: id === EVIDENCE ? ['phase64-zero', 'phase64-null'] : [], adapterKey: 'console-declared', collectedAt: new Date(NOW),
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
    where: { username: { in: ['phase64-owner', 'phase64-member', 'phase64-auditor', 'phase64-foreign'] } },
  });
}

function textField(value: unknown, key: string): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = (value as Record<string, unknown>)[key];
  return typeof row === 'string' && row.length > 0 ? row : null;
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
