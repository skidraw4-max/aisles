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
import { evaluateSecondReReview } from './rereview-second-review';

const TENANT = 'phase58-rereview';
const FOREIGN = 'phase58-foreign';
const CONN = 'phase58-conn';
const EVIDENCE = 'phase58-evidence';
const NOW = '2026-10-03T01:40:00.000Z';
const LIVE_REVIEW = '3707202563ecae9b38f324a4eefd9243a14bc69420ed6cdda16c4c5794f62e0d';
const LIVE_CYCLE = '14308b4c999ccbe8ca54b7f31da5385385d4073c49bbf2955582a6bb96afb01e';
const SECRET = 'password=hidden';

const owner = membership('phase58-owner-m', TENANT, 'phase58-owner', 'OWNER');
const member = membership('phase58-member-m', TENANT, 'phase58-member', 'MEMBER');
const auditor = membership('phase58-auditor-m', TENANT, 'phase58-auditor', 'AUDITOR');
const foreign = membership('phase58-foreign-m', FOREIGN, 'phase58-foreign', 'OWNER');
const ownerActor: JuryActor = { ok: true, userId: owner.userId, tenantId: TENANT, role: 'OWNER', membershipId: owner.id };
const memberActor: JuryActor = { ok: true, userId: member.userId, tenantId: TENANT, role: 'MEMBER', membershipId: member.id };
const auditorActor: JuryActor = { ok: true, userId: auditor.userId, tenantId: TENANT, role: 'AUDITOR', membershipId: auditor.id };

test('second re-review control follows an approved second change gate', () => {
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
  };
  const ready = projectReviewConsole(base);
  assert.equal(ready.ok && ready.screen.canRunSecondReReview, true);
  assert.equal(ready.ok && ready.screen.canRunReReviewChangeGate, false);
  const memberView = projectReviewConsole({ ...base, actor: memberActor });
  assert.equal(memberView.ok && memberView.screen.canRunSecondReReview, true);
  const reader = projectReviewConsole({ ...base, actor: auditorActor });
  assert.equal(reader.ok && reader.screen.canRunSecondReReview, false);
  const pending = projectReviewConsole({ ...base, nextAgentExecution: { id: 'exec', status: 'PENDING', agent: 'CURSOR' } });
  assert.equal(pending.ok && pending.screen.canRunSecondReReview, false);
  const gated = projectReviewConsole({ ...base, nextChangeGate: { id: 'gate', status: 'GATED', errorCode: 'AGENT_REPORTED_FILE_NOT_FOUND_IN_WORKSPACE' } });
  assert.equal(gated.ok && gated.screen.canRunSecondReReview, false);
  const blocked = projectReviewConsole({ ...base, nextChangeGate: { id: 'gate', status: 'BLOCKED', errorCode: 'WORKSPACE_NOT_ALLOWED' } });
  assert.equal(blocked.ok && blocked.screen.canRunSecondReReview, false);
  const done = projectReviewConsole({ ...base, nextSecondReReview: { id: 'second', status: 'EXECUTED' } });
  assert.equal(done.ok && done.screen.canRunSecondReReview, false);
});

test('approved second change gate reaches one re-review', { timeout: 360_000 }, async () => {
  loadEnv();
  const { prisma } = await import('@/lib/prisma');
  const liveBefore = await liveSnapshot(prisma);
  const runs: string[] = [];
  let cores = 0;
  const core: ProductReviewCore = async (args) => {
    cores += 1;
    const { callFrozenReviewPipeline } = await import('./review-core');
    const { createMockReviewBoardLlm } = await import('../ai-review-board/mock-llm');
    const reading = await callFrozenReviewPipeline({ ...args, llm: createMockReviewBoardLlm() });
    runs.push(reading.boardRunId);
    return reading;
  };
  let cleanupError: string | null = null;
  try {
    await removeFixture(prisma);
    await seed(prisma);
    const approved = await chain(prisma, 'phase58-approved', 'VERIFY');
    const concurrent = await chain(prisma, 'phase58-concurrent', 'VERIFY');
    const gated = await chain(prisma, 'phase58-gated', 'VERIFY');
    const blockedGate = await chain(prisma, 'phase58-blocked-gate', 'VERIFY');
    const missing = await chain(prisma, 'phase58-missing', 'VERIFY');
    const pending = await chain(prisma, 'phase58-pending', 'VERIFY');
    const running = await chain(prisma, 'phase58-running', 'VERIFY');
    const blockedExec = await chain(prisma, 'phase58-blocked-exec', 'VERIFY');
    const noApproval = await chain(prisma, 'phase58-no-approval', 'VERIFY');
    const firstStamp = await chain(prisma, 'phase58-first-stamp', 'VERIFY');
    const otherTask = await chain(prisma, 'phase58-other-task', 'VERIFY');
    const otherApproval = await chain(prisma, 'phase58-other-approval', 'VERIFY');
    const foreignStamp = await chain(prisma, 'phase58-foreign-stamp', 'VERIFY');
    const tamperTask = await chain(prisma, 'phase58-tamper-task', 'VERIFY');
    const tamperParent = await chain(prisma, 'phase58-tamper-parent', 'VERIFY');
    const tamperSource = await chain(prisma, 'phase58-tamper-source', 'VERIFY');
    const foreignChain = await chain(prisma, 'phase58-foreign-review', 'VERIFY', FOREIGN);

    const approvedId = await completedSecond(prisma, approved, SECRET);
    const concurrentId = await completedSecond(prisma, concurrent, SECRET);
    const gatedId = await completedSecond(prisma, gated);
    const blockedGateId = await completedSecond(prisma, blockedGate);
    const missingId = await completedSecond(prisma, missing);
    const pendingId = await pendingExecution(pending.nextTaskId);
    const runningId = await pendingExecution(running.nextTaskId);
    const blockedExecId = await pendingExecution(blockedExec.nextTaskId);
    const noApprovalId = await bareCompleted(prisma, noApproval, noApproval.humanId);
    const firstStampId = await completedSecond(prisma, firstStamp);
    const otherTaskId = await completedSecond(prisma, otherTask);
    const otherApprovalId = await completedSecond(prisma, otherApproval);
    const foreignStampId = await completedSecond(prisma, foreignStamp);
    const tamperTaskId = await completedSecond(prisma, tamperTask);
    const tamperParentId = await completedSecond(prisma, tamperParent);
    const tamperSourceId = await completedSecond(prisma, tamperSource);
    const foreignId = await completedSecond(prisma, foreignChain, 'safe', FOREIGN);

    await plantGate(prisma, approved, approvedId, 'APPROVED');
    await plantGate(prisma, concurrent, concurrentId, 'APPROVED');
    await plantGate(prisma, gated, gatedId, 'GATED');
    await plantGate(prisma, blockedGate, blockedGateId, 'BLOCKED');
    await plantGate(prisma, pending, pendingId, 'APPROVED');
    await plantGate(prisma, running, runningId, 'APPROVED');
    await plantGate(prisma, blockedExec, blockedExecId, 'APPROVED');
    await plantGate(prisma, noApproval, noApprovalId, 'APPROVED');
    await plantGate(prisma, firstStamp, firstStampId, 'APPROVED');
    await plantGate(prisma, otherTask, otherTaskId, 'APPROVED');
    await plantGate(prisma, otherApproval, otherApprovalId, 'APPROVED');
    await plantGate(prisma, foreignStamp, foreignStampId, 'APPROVED');
    await plantGate(prisma, tamperTask, tamperTaskId, 'APPROVED');
    await plantGate(prisma, tamperParent, tamperParentId, 'APPROVED');
    await plantGate(prisma, tamperSource, tamperSourceId, 'APPROVED');
    await plantGate(prisma, foreignChain, foreignId, 'APPROVED', FOREIGN);

    await prisma.juryAgentExecution.updateMany({ where: { id: runningId, tenantId: TENANT }, data: { status: 'RUNNING' } });
    await prisma.juryAgentExecution.updateMany({ where: { id: blockedExecId, tenantId: TENANT }, data: { status: 'BLOCKED' } });
    await prisma.juryAgentExecution.updateMany({
      where: { id: firstStampId, tenantId: TENANT },
      data: { provenance: completedProvenance(firstStamp, firstStamp.humanId, safeResult()) },
    });
    const otherHuman = await prisma.juryHumanDecision.findFirst({
      where: { tenantId: TENANT, reviewResultId: otherApproval.reReviewResultId },
      select: { id: true },
    });
    await prisma.juryAgentExecution.updateMany({
      where: { id: otherTaskId, tenantId: TENANT },
      data: { provenance: completedProvenance(otherTask, otherHuman?.id ?? 'missing-other', safeResult()) },
    });
    const foreignHuman = await prisma.juryHumanDecision.findFirst({
      where: { tenantId: FOREIGN, reviewResultId: foreignChain.reReviewResultId },
      select: { id: true },
    });
    await prisma.juryAgentExecution.updateMany({
      where: { id: foreignStampId, tenantId: TENANT },
      data: { provenance: completedProvenance(foreignStamp, foreignHuman?.id ?? 'missing-foreign', safeResult()) },
    });
    await prisma.juryImprovementTask.updateMany({
      where: { id: tamperTask.nextTaskId, tenantId: TENANT },
      data: {
        provenance: {
          kind: 'rereview-improvement',
          reReviewReviewRequestId: tamperTask.reReviewRequestId,
          reReviewReviewResultId: tamperTask.reReviewResultId,
          originalReviewRequestId: 'phase58-tamper-task-request',
          originalReviewResultId: tamperTask.reviewId,
          humanDecisionId: tamperTask.humanId,
          sourceImprovementTaskId: tamperTask.taskId,
          improvementTaskId: tamperTask.nextTaskId,
          agentExecutionId: tamperTask.executionId,
          changeGateResultId: 'tampered-gate',
        },
      },
    });
    await prisma.juryReviewResult.updateMany({
      where: { id: tamperParent.reReviewResultId, tenantId: TENANT },
      data: { parentReviewResultId: approved.reviewId },
    });
    await prisma.juryAgentExecution.updateMany({
      where: { id: tamperSource.executionId, tenantId: TENANT },
      data: { status: 'BLOCKED' },
    });

    const before = await counts(prisma);
    const sourceGateBefore = await prisma.juryChangeGateResult.findFirst({
      where: { id: approved.gateId, tenantId: TENANT },
      select: { status: true, updatedAt: true },
    });
    const sourceReviewBefore = await prisma.juryChangeGateReview.findFirst({
      where: { changeGateResultId: approved.gateId, tenantId: TENANT },
      select: { reviewResultId: true, status: true },
    });
    const evidenceBefore = await prisma.juryNormalizedMetric.findFirst({ where: { id: 'phase58-zero', tenantId: TENANT } });
    const absentBefore = await prisma.juryNormalizedMetric.findFirst({ where: { id: 'phase58-null', tenantId: TENANT } });
    const started = cores;

    const deniedAuditor = await run(approvedId, core, auditor);
    assert.equal(deniedAuditor.ok, false);
    if (!deniedAuditor.ok) assert.equal(deniedAuditor.reason, 'FORBIDDEN');
    assert.equal(cores, started);

    const opened = await run(approvedId, core, member);
    assert.equal(opened.ok, true, opened.ok ? '' : opened.reason);
    if (opened.ok) {
      assert.equal(opened.created, true);
      assert.equal(opened.reReview.status, 'EXECUTED');
      assert.ok(opened.reReview.reviewResultId);
      assert.notEqual(opened.reReview.reviewResultId, approved.reReviewResultId);
      assert.notEqual(opened.reReview.reviewResultId, approved.reviewId);
    }
    assert.equal(cores, started + 1);
    const childId = opened.ok ? opened.reReview.reviewResultId : '';
    const child = await prisma.juryReviewResult.findFirst({ where: { id: childId ?? '', tenantId: TENANT } });
    assert.equal(child?.parentReviewResultId, approved.reReviewResultId);
    assert.notEqual(child?.parentReviewResultId, approved.reviewId);

    const again = await run(approvedId, core, owner);
    assert.equal(again.ok, true);
    if (again.ok && opened.ok) {
      assert.equal(again.created, false);
      assert.equal(again.reReview.reviewResultId, opened.reReview.reviewResultId);
    }
    assert.equal(cores, started + 1);

    const [left, right] = await Promise.all([
      run(concurrentId, core, owner),
      run(concurrentId, core, owner),
    ]);
    assert.equal(left.ok || right.ok, true);
    assert.equal(await prisma.juryChangeGateReview.count({ where: { changeGateResultId: `${concurrent.nextTaskId}-second-gate`, tenantId: TENANT } }), 1);
    const concurrentResults = await prisma.juryReviewResult.count({
      where: { tenantId: TENANT, parentReviewResultId: concurrent.reReviewResultId },
    });
    assert.equal(concurrentResults, 1);
    assert.equal(cores, started + 2);

    for (const executionId of [gatedId, blockedGateId, missingId]) {
      const denied = await run(executionId, core);
      assert.equal(denied.ok, false);
      if (!denied.ok) assert.equal(denied.reason, 'RE-REVIEW_NOT_APPROVED');
    }
    for (const executionId of [pendingId, runningId, blockedExecId]) {
      const denied = await run(executionId, core);
      assert.equal(denied.ok, false);
      if (!denied.ok) assert.equal(denied.reason, 'EXECUTION_NOT_COMPLETED');
    }
    for (const executionId of [noApprovalId, firstStampId, otherTaskId, foreignStampId]) {
      const denied = await run(executionId, core);
      assert.equal(denied.ok, false);
      if (!denied.ok) assert.equal(denied.reason, 'HUMAN_APPROVAL_REQUIRED');
    }
    for (const executionId of [approved.executionId, tamperTaskId, tamperParentId, tamperSourceId]) {
      const denied = await run(executionId, core);
      assert.equal(denied.ok, false);
      if (!denied.ok) assert.equal(denied.reason, 'NOT_REREVIEW_IMPROVEMENT_TASK');
    }
    const crossed = await run(foreignId, core, owner);
    assert.equal(crossed.ok, false);
    if (!crossed.ok) assert.equal(crossed.reason, 'NOT_FOUND');
    const inbound = await run(approvedId, core, foreign);
    assert.equal(inbound.ok, false);
    if (!inbound.ok) assert.equal(inbound.reason, 'NOT_FOUND');
    const blank = await evaluateSecondReReview({ userId: owner.userId, memberships: [owner], agentExecutionId: '  ', core });
    assert.equal(blank.ok, false);
    assert.equal(cores, started + 2);

    const after = await counts(prisma);
    assert.equal(after.results, before.results + 2);
    assert.equal(after.requests, before.requests + 2);
    assert.equal(after.gateReviews, before.gateReviews + 2);
    assert.equal(after.gates, before.gates);
    assert.equal(after.tasks, before.tasks);
    assert.equal(after.executions, before.executions);
    assert.equal(after.evidence, before.evidence);
    assert.equal(after.humans, before.humans);
    assert.equal(after.cycles, 0);
    assert.equal(after.loops, 0);
    assert.equal(await prisma.juryChangeGateReview.count({ where: { tenantId: FOREIGN } }), 1);
    assert.equal(await prisma.juryReviewResult.count({ where: { tenantId: FOREIGN } }), 2);

    const sourceGateAfter = await prisma.juryChangeGateResult.findFirst({
      where: { id: approved.gateId, tenantId: TENANT },
      select: { status: true, updatedAt: true },
    });
    assert.equal(sourceGateAfter?.status, 'APPROVED');
    assert.equal(sourceGateAfter?.updatedAt?.toISOString(), sourceGateBefore?.updatedAt?.toISOString());
    const sourceReviewAfter = await prisma.juryChangeGateReview.findFirst({
      where: { changeGateResultId: approved.gateId, tenantId: TENANT },
      select: { reviewResultId: true, status: true },
    });
    assert.equal(sourceReviewAfter?.status, 'EXECUTED');
    assert.equal(sourceReviewAfter?.reviewResultId, sourceReviewBefore?.reviewResultId);
    const original = await prisma.juryReviewResult.findFirst({ where: { id: approved.reviewId, tenantId: TENANT } });
    assert.equal(original?.expectedDecision, 'VERIFY');
    const previous = await prisma.juryReviewResult.findFirst({ where: { id: approved.reReviewResultId, tenantId: TENANT } });
    assert.equal(previous?.expectedDecision, 'VERIFY');
    const human = await prisma.juryHumanDecision.findFirst({ where: { id: approved.humanId, tenantId: TENANT } });
    assert.equal(human?.decision, 'VERIFY');
    const sourceExecution = await prisma.juryAgentExecution.findFirst({ where: { id: approved.executionId, tenantId: TENANT } });
    assert.equal(sourceExecution?.status, 'COMPLETED');
    assert.equal(evidenceBefore?.value, 0);
    assert.equal((await prisma.juryNormalizedMetric.findFirst({ where: { id: 'phase58-zero', tenantId: TENANT } }))?.value, 0);
    assert.equal(absentBefore?.value, null);
    assert.equal((await prisma.juryNormalizedMetric.findFirst({ where: { id: 'phase58-null', tenantId: TENANT } }))?.value, null);

    const secondReview = await prisma.juryChangeGateReview.findFirst({
      where: { changeGateResultId: `${approved.nextTaskId}-second-gate`, tenantId: TENANT },
      select: { provenance: true, agentExecutionId: true, parentReviewResultId: true },
    });
    const provenance = JSON.stringify(secondReview?.provenance ?? {});
    const secondHuman = await prisma.juryHumanDecision.findFirst({
      where: { tenantId: TENANT, reviewResultId: approved.reReviewResultId },
      select: { id: true },
    });
    assert.equal(provenance.includes(approved.reviewId), true);
    assert.equal(provenance.includes(approved.reReviewResultId), true);
    assert.equal(provenance.includes(approved.nextTaskId), true);
    assert.equal(provenance.includes(secondHuman?.id ?? 'missing-second-human'), true);
    assert.notEqual(secondHuman?.id, approved.humanId);
    assert.equal(provenance.includes(approvedId), true);
    assert.equal(provenance.includes(`${approved.nextTaskId}-second-gate`), true);
    assert.equal(provenance.includes(SECRET), false);
    assert.equal(provenance.includes('postgres://'), false);
    assert.equal(secondReview?.agentExecutionId, approvedId);
    assert.equal(secondReview?.parentReviewResultId, approved.reReviewResultId);
    const childText = JSON.stringify(child);
    assert.equal(childText.includes(SECRET), false);
    assert.equal(childText.includes('postgres://'), false);
    const shown = await loadReviewConsole(ownerActor, approved.reviewId);
    assert.equal(shown.ok && shown.screen.nextSecondReReview?.status, 'EXECUTED');
    assert.equal(shown.ok && shown.screen.canRunSecondReReview, false);
  } finally {
    try {
      await removeFixture(prisma);
    } catch (error) {
      cleanupError = error instanceof Error ? error.message.replace(/postgres(?:ql)?:\/\/\S+/gi, '[redacted]') : 'failed';
    }
    for (const runId of runs) {
      if (!/^run-/.test(runId)) continue;
      rmSync(path.resolve(process.cwd(), JURY_PRODUCT_DATA_ROOT, runId), { recursive: true, force: true });
    }
    assert.deepEqual(await liveSnapshot(prisma), liveBefore);
    if (cleanupError) throw new Error(`CLEANUP_FAILED ${cleanupError}`);
  }
});

test('second re-review reuses the phase 53 change-gate review', () => {
  const source = readFileSync(path.resolve(process.cwd(), 'src/lib/jury-product/rereview-second-review.ts'), 'utf8');
  for (const token of [
    'buildEvidencePackFromDb',
    'attachGa4Evidence',
    'runAisleAdapter',
    'GA4_PROPERTY_ID',
    'inspectAllowlistedWorkspace',
    'child_process',
    'findUnique',
    'evaluateHumanReReview',
    'recordHumanChangeGate',
    'evaluateChangeGate',
    'persistReReviewImprovement',
    'recordDecisionCycle',
    'persistImprovementAutoLoop',
    'callFrozenReviewPipeline',
  ]) {
    assert.equal(source.includes(token), false, token);
  }
  assert.equal(source.includes('persistChangeGateReReviewRequest'), true);
  assert.equal(source.includes('persistChangeGateReReviewExecution'), true);
  assert.equal(source.includes("action: 'review.start'"), true);
  assert.equal(source.includes('input.agentExecutionId'), true);
  assert.equal(source.includes('RE-REVIEW_NOT_APPROVED'), true);
  assert.equal(source.includes('HUMAN_APPROVAL_REQUIRED'), true);
  const actions = readFileSync(path.resolve(process.cwd(), 'src/app/(root)/jury/actions.ts'), 'utf8');
  const fn = actions.slice(actions.indexOf('export async function runSecondReReview'));
  assert.equal(fn.includes("formData.get('agentExecutionId')"), true);
  for (const key of ['tenantId', 'taskId', 'reviewResultId', 'changeGateResultId', 'approvalId', 'provider', 'workspace']) {
    assert.equal(fn.includes(`formData.get('${key}')`), false, key);
  }
  const ui = readFileSync(path.resolve(process.cwd(), 'src/app/(root)/jury/ui.tsx'), 'utf8');
  const body = ui.slice(ui.indexOf('export function SecondReReviewBody'), ui.indexOf('export function SecondImprovementBody'));
  assert.equal(body.includes('Run Re-review'), true);
  assert.equal(body.includes('Re-review Running'), true);
  assert.equal(body.includes('Re-review Completed'), true);
  for (const label of ['Next Improvement', 'Approve for Agent', 'Send to Agent', 'Run Agent', 'Run Change Gate', 'Auto Fix', 'Run Loop']) {
    assert.equal(body.includes(label), false, label);
  }
  const gate = ui.slice(ui.indexOf('export function ReReviewChangeGateBody'), ui.indexOf('export function SecondReReviewBody'));
  assert.equal(gate.includes('Re-review'), false);
});

function run(
  agentExecutionId: string,
  core: ProductReviewCore,
  actor: JuryMembership = owner,
) {
  return evaluateSecondReReview({ userId: actor.userId, memberships: [actor], agentExecutionId, core });
}

async function completedSecond(
  prisma: Awaited<typeof import('@/lib/prisma')>['prisma'],
  row: Chain,
  summary = 'safe summary',
  tenantId = TENANT,
) {
  const actor = tenantId === TENANT ? owner : foreign;
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
      provenance: completedProvenance(row, approval?.id ?? '', { ...safeResult(), summary }),
    },
  });
  return executionId;
}

async function bareCompleted(
  prisma: Awaited<typeof import('@/lib/prisma')>['prisma'],
  row: Chain,
  humanDecisionId: string,
) {
  const id = `${row.nextTaskId}-bare`;
  await prisma.juryAgentExecution.create({
    data: {
      id,
      tenantId: TENANT,
      taskId: row.nextTaskId,
      agent: 'CURSOR',
      allowedPaths: [],
      deniedPaths: [],
      status: 'COMPLETED',
      workspaceRef: { type: 'PROJECT', ref: 'mock-aisle' },
      provenance: completedProvenance(row, humanDecisionId, safeResult()),
      finishedAt: new Date(NOW),
      createdAt: new Date(NOW),
      updatedAt: new Date(NOW),
    },
  });
  return id;
}

async function plantGate(
  prisma: Awaited<typeof import('@/lib/prisma')>['prisma'],
  row: Chain,
  executionId: string,
  status: 'APPROVED' | 'GATED' | 'BLOCKED',
  tenantId = TENANT,
) {
  await prisma.juryChangeGateResult.create({
    data: {
      id: `${row.nextTaskId}-second-gate`,
      tenantId,
      executionId,
      improvementTaskId: row.nextTaskId,
      changedFiles: [],
      riskFlags: [],
      gate: status === 'APPROVED' ? 'PASS' : status === 'BLOCKED' ? 'BLOCK' : 'NEEDS_APPROVAL',
      status,
      errorCode: status === 'GATED'
        ? 'AGENT_REPORTED_FILE_NOT_FOUND_IN_WORKSPACE'
        : status === 'BLOCKED'
          ? 'WORKSPACE_NOT_ALLOWED'
          : null,
      createdAt: new Date(NOW),
      updatedAt: new Date(NOW),
    },
  });
}

function pendingExecution(improvementTaskId: string, actor: JuryMembership = owner) {
  return approveReReviewAgent({ userId: actor.userId, memberships: [actor], improvementTaskId }).then(async (approved) => {
    assert.equal(approved.ok, true, approved.ok ? '' : approved.reason);
    const opened = await persistReReviewAgentHandoff({ userId: actor.userId, memberships: [actor], improvementTaskId });
    assert.equal(opened.ok, true, opened.ok ? '' : opened.reason);
    if (!opened.ok) throw new Error('handoff failed');
    return opened.agentExecutionId;
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

function safeResult() {
  return { summary: 'safe summary', changedFiles: [] as string[], testsRun: [] as string[], testsPassed: null };
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
  await connection(prisma, 'phase58-foreign-conn', FOREIGN, foreign.userId);
  await prisma.juryAccessScope.create({
    data: {
      id: 'phase58-scope', tenantId: TENANT, connectionId: CONN, status: 'APPROVED', grants: [],
      approvedByUserId: owner.userId, approvedAt: new Date(NOW),
    },
  });
  await evidenceRow(prisma, EVIDENCE, TENANT, CONN, ['phase58-zero', 'phase58-null']);
  await evidenceRow(prisma, 'phase58-foreign-evidence', FOREIGN, 'phase58-foreign-conn', []);
  await prisma.juryNormalizedMetric.createMany({
    data: [
      metric('phase58-zero', 'userCount', 0, 'AVAILABLE'),
      metric('phase58-null', 'postsLast7d', null, 'NOT_MEASURED'),
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
  const connectionId = tenantId === TENANT ? CONN : 'phase58-foreign-conn';
  const evidenceId = tenantId === TENANT ? EVIDENCE : 'phase58-foreign-evidence';
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
      workspaceRef: { type: 'PROJECT', ref: 'phase58-fixture' }, provenance: { kind: 'human-agent-execution' },
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

async function connection(prisma: Awaited<typeof import('@/lib/prisma')>['prisma'], id: string, tenantId: string, userId: string) {
  await prisma.juryServiceConnection.create({
    data: { id, tenantId, serviceKey: id, displayName: id, accessMethod: 'FILE_UPLOAD', status: 'CONNECTED', createdByUserId: userId },
  });
}

async function evidenceRow(
  prisma: Awaited<typeof import('@/lib/prisma')>['prisma'],
  id: string,
  tenantId: string,
  connectionId: string,
  metricIds: string[],
) {
  await prisma.juryEvidence.create({
    data: {
      id, tenantId, connectionId, purpose: 'tenant-declared-observation', periodStart: '2026-09-25', periodEnd: '2026-10-01',
      timezone: 'Asia/Seoul', metricIds, adapterKey: 'console-declared', collectedAt: new Date(NOW),
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
  const [results, requests, gates, gateReviews, tasks, executions, evidence, humans, cycles, loops] = await Promise.all([
    prisma.juryReviewResult.count({ where }),
    prisma.juryReviewRequest.count({ where }),
    prisma.juryChangeGateResult.count({ where }),
    prisma.juryChangeGateReview.count({ where }),
    prisma.juryImprovementTask.count({ where }),
    prisma.juryAgentExecution.count({ where }),
    prisma.juryEvidence.count({ where }),
    prisma.juryHumanDecision.count({ where }),
    prisma.juryDecisionCycle.count({ where }),
    prisma.juryAutoLoopActivation.count({ where }),
  ]);
  return { results, requests, gates, gateReviews, tasks, executions, evidence, humans, cycles, loops };
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
    where: { username: { in: ['phase58-owner', 'phase58-member', 'phase58-auditor', 'phase58-foreign'] } },
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
