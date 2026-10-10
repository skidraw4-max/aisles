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
import { evaluateSecondChangeGate } from './rereview-second-change-gate';
import { handoffSecondImprovement } from './rereview-second-handoff';
import { persistSecondReReviewImprovement } from './rereview-second-improvement';

const TENANT = 'phase63-rereview';
const FOREIGN = 'phase63-foreign';
const CONN = 'phase63-conn';
const EVIDENCE = 'phase63-evidence';
const NOW = '2026-10-03T04:20:00.000Z';
const LIVE_REVIEW = '3707202563ecae9b38f324a4eefd9243a14bc69420ed6cdda16c4c5794f62e0d';
const LIVE_CYCLE = '14308b4c999ccbe8ca54b7f31da5385385d4073c49bbf2955582a6bb96afb01e';
const COPY = 'workspace/mock-aisle/user-facing-copy.ts';
const SECRET = 'password=hidden';

const owner = membership('phase63-owner-m', TENANT, 'phase63-owner', 'OWNER');
const member = membership('phase63-member-m', TENANT, 'phase63-member', 'DEVELOPER');
const auditor = membership('phase63-auditor-m', TENANT, 'phase63-auditor', 'VIEWER');
const foreign = membership('phase63-foreign-m', FOREIGN, 'phase63-foreign', 'OWNER');
const ownerActor: JuryActor = { ok: true, userId: owner.userId, tenantId: TENANT, role: 'OWNER', membershipId: owner.id };
const memberActor: JuryActor = { ok: true, userId: member.userId, tenantId: TENANT, role: 'DEVELOPER', membershipId: member.id };
const auditorActor: JuryActor = { ok: true, userId: auditor.userId, tenantId: TENANT, role: 'VIEWER', membershipId: auditor.id };

test('second change gate control follows a completed second execution', () => {
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
  };
  const ready = projectReviewConsole(base);
  assert.equal(ready.ok && ready.screen.canRunSecondChangeGate, true);
  assert.equal(ready.ok && ready.screen.canHandoffSecondImprovement, false);
  const memberView = projectReviewConsole({ ...base, actor: memberActor });
  assert.equal(memberView.ok && memberView.screen.canRunSecondChangeGate, false);
  const reader = projectReviewConsole({ ...base, actor: auditorActor });
  assert.equal(reader.ok && reader.screen.canRunSecondChangeGate, false);
  const pending = projectReviewConsole({
    ...base,
    nextSecondAgentExecution: { id: 'exec', status: 'PENDING', agent: 'CURSOR' },
  });
  assert.equal(pending.ok && pending.screen.canRunSecondChangeGate, false);
  const gated = projectReviewConsole({
    ...base,
    nextSecondChangeGate: { id: 'gate', status: 'GATED', errorCode: null },
  });
  assert.equal(gated.ok && gated.screen.canRunSecondChangeGate, false);
  assert.equal(gated.ok && gated.screen.nextSecondChangeGate?.status, 'GATED');
  const approvedView = projectReviewConsole({
    ...base,
    nextSecondChangeGate: { id: 'gate', status: 'APPROVED', errorCode: null },
  });
  assert.equal(approvedView.ok && approvedView.screen.canRunSecondChangeGate, false);
  assert.equal(approvedView.ok && approvedView.screen.nextSecondChangeGate?.status, 'APPROVED');
  const blockedView = projectReviewConsole({
    ...base,
    nextSecondChangeGate: { id: 'gate', status: 'BLOCKED', errorCode: 'NO_CHANGES' },
  });
  assert.equal(blockedView.ok && blockedView.screen.nextSecondChangeGate?.status, 'BLOCKED');
  assert.equal(blockedView.ok && blockedView.screen.nextSecondChangeGate?.errorCode, 'NO_CHANGES');
});

test('completed second execution is gated by the existing change gate evaluator', { timeout: 540_000 }, async () => {
  loadEnv();
  const { prisma } = await import('@/lib/prisma');
  const liveBefore = await liveSnapshot(prisma);
  let cleanupError: string | null = null;
  try {
    await removeFixture(prisma);
    await seed(prisma);
    const approved = await prepare(prisma, 'phase63-approved', 'VERIFY', 'approved');
    const reported = await prepare(prisma, 'phase63-gated', 'VERIFY', 'gated');
    const concurrent = await prepare(prisma, 'phase63-concurrent', 'VERIFY', 'gated');
    const workspace = await prepare(prisma, 'phase63-workspace', 'VERIFY', 'workspace');
    const secret = await prepare(prisma, 'phase63-secret', 'VERIFY', 'secret');
    const status = await prepare(prisma, 'phase63-status', 'VERIFY', 'pending');
    const missing = await prepare(prisma, 'phase63-missing', 'VERIFY', 'approved');
    const tamperTask = await prepare(prisma, 'phase63-task', 'VERIFY', 'approved');
    const tamperParent = await prepare(prisma, 'phase63-parent', 'VERIFY', 'approved');
    const tamperExecution = await prepare(prisma, 'phase63-source-exec', 'VERIFY', 'approved');
    const tamperGate = await prepare(prisma, 'phase63-source-gate', 'VERIFY', 'approved');
    const foreignRow = await prepare(prisma, 'phase63-foreign-review', 'VERIFY', 'approved', FOREIGN);

    const phase55 = await prisma.juryHumanDecision.findFirst({
      where: { tenantId: TENANT, reviewResultId: approved.firstResultId },
      select: { id: true },
    });
    const otherApproval = await prisma.juryHumanDecision.findFirst({
      where: { tenantId: TENANT, reviewResultId: reported.secondResultId },
      select: { id: true },
    });
    await setHuman(prisma, approved.executionId, approved.rootHumanId);
    const originalApproval = await evaluateSecondChangeGate({ userId: owner.userId, memberships: [owner], agentExecutionId: approved.executionId });
    assert.equal(originalApproval.ok, false);
    if (!originalApproval.ok) assert.equal(originalApproval.reason, 'HUMAN_APPROVAL_REQUIRED');
    await setHuman(prisma, approved.executionId, phase55?.id ?? 'missing-phase55');
    const firstApproval = await evaluateSecondChangeGate({ userId: owner.userId, memberships: [owner], agentExecutionId: approved.executionId });
    assert.equal(firstApproval.ok, false);
    if (!firstApproval.ok) assert.equal(firstApproval.reason, 'HUMAN_APPROVAL_REQUIRED');
    await setHuman(prisma, approved.executionId, otherApproval?.id ?? 'missing-other');
    const other = await evaluateSecondChangeGate({ userId: owner.userId, memberships: [owner], agentExecutionId: approved.executionId });
    assert.equal(other.ok, false);
    if (!other.ok) assert.equal(other.reason, 'HUMAN_APPROVAL_REQUIRED');
    await setHuman(prisma, approved.executionId, approved.approvalId);
    assert.equal(await prisma.juryChangeGateResult.count({ where: { executionId: approved.executionId, tenantId: TENANT } }), 0);

    await prisma.juryImprovementTask.updateMany({ where: { id: missing.taskId, tenantId: TENANT }, data: { taskType: 'REWORD' } });
    const mismatch = await evaluateSecondChangeGate({ userId: owner.userId, memberships: [owner], agentExecutionId: missing.executionId });
    assert.equal(mismatch.ok, false);
    if (!mismatch.ok) assert.equal(mismatch.reason, 'HUMAN_APPROVAL_REQUIRED');
    await prisma.juryImprovementTask.updateMany({ where: { id: missing.taskId, tenantId: TENANT }, data: { taskType: 'VERIFICATION' } });
    await prisma.juryHumanDecision.deleteMany({ where: { tenantId: TENANT, reviewResultId: missing.secondResultId } });
    const missingApproval = await evaluateSecondChangeGate({ userId: owner.userId, memberships: [owner], agentExecutionId: missing.executionId });
    assert.equal(missingApproval.ok, false);
    if (!missingApproval.ok) assert.equal(missingApproval.reason, 'HUMAN_APPROVAL_REQUIRED');
    assert.equal(await prisma.juryChangeGateResult.count({ where: { executionId: missing.executionId, tenantId: TENANT } }), 0);

    await prisma.juryImprovementTask.updateMany({
      where: { id: tamperTask.taskId, tenantId: TENANT },
      data: { provenance: { kind: 'human-decision-improvement' } },
    });
    await prisma.juryReviewResult.updateMany({
      where: { id: tamperParent.secondResultId, tenantId: TENANT },
      data: { parentReviewResultId: tamperParent.rootId },
    });
    await prisma.juryAgentExecution.updateMany({
      where: { id: tamperExecution.sourceExecutionId, tenantId: TENANT },
      data: { status: 'BLOCKED' },
    });
    await prisma.juryChangeGateResult.updateMany({
      where: { id: tamperGate.sourceGateId, tenantId: TENANT },
      data: { status: 'GATED', gate: 'NEEDS_APPROVAL' },
    });

    const before = await counts(prisma);
    const metricsBefore = await metricSnapshot(prisma);
    const evidenceBefore = await prisma.juryEvidence.findFirst({ where: { id: EVIDENCE, tenantId: TENANT }, select: { contentHash: true } });
    const approvedExecution = await prisma.juryAgentExecution.findFirst({ where: { id: approved.executionId, tenantId: TENANT } });
    const approvedTask = await prisma.juryImprovementTask.findFirst({ where: { id: approved.taskId, tenantId: TENANT } });
    const approvedHuman = await prisma.juryHumanDecision.findFirst({ where: { id: approved.approvalId, tenantId: TENANT } });
    const approvedResult = await prisma.juryReviewResult.findFirst({ where: { id: approved.secondResultId, tenantId: TENANT } });
    const waiting = await loadReviewConsole(ownerActor, approved.rootId);
    assert.equal(waiting.ok && waiting.screen.canRunSecondChangeGate, true);
    assert.equal(waiting.ok && waiting.screen.nextSecondAgentExecution?.status, 'COMPLETED');

    const memberTry = await evaluateSecondChangeGate({ userId: member.userId, memberships: [member], agentExecutionId: reported.executionId });
    assert.equal(memberTry.ok, false);
    if (!memberTry.ok) assert.equal(memberTry.reason, 'FORBIDDEN');
    const auditorTry = await evaluateSecondChangeGate({ userId: auditor.userId, memberships: [auditor], agentExecutionId: reported.executionId });
    assert.equal(auditorTry.ok, false);
    if (!auditorTry.ok) assert.equal(auditorTry.reason, 'FORBIDDEN');
    assert.equal(await prisma.juryChangeGateResult.count({ where: { executionId: reported.executionId, tenantId: TENANT } }), 0);

    const passed = await evaluateSecondChangeGate({ userId: owner.userId, memberships: [owner], agentExecutionId: approved.executionId });
    assert.equal(passed.ok, true, passed.ok ? '' : passed.reason);
    if (passed.ok) {
      assert.equal(passed.created, true);
      assert.equal(passed.reviewId, approved.rootId);
      assert.equal(passed.agentExecutionId, approved.executionId);
      assert.equal(passed.gate.status, 'BLOCKED');
      assert.equal(passed.gate.errorCode, 'NO_CHANGES');
      assert.equal(passed.gate.reasons.includes('NO_CHANGES'), true);
    }
    const replay = await evaluateSecondChangeGate({ userId: owner.userId, memberships: [owner], agentExecutionId: approved.executionId });
    assert.equal(replay.ok, true);
    if (replay.ok && passed.ok) {
      assert.equal(replay.created, false);
      assert.equal(replay.gate.id, passed.gate.id);
      assert.equal(replay.gate.status, 'BLOCKED');
    }
    const approvedGate = await prisma.juryChangeGateResult.findFirst({ where: { executionId: approved.executionId, tenantId: TENANT } });
    assert.equal(approvedGate?.improvementTaskId, approved.taskId);
    assert.equal(textField(approvedGate?.provenance, 'agentExecutionId'), approved.executionId);
    assert.equal(await prisma.juryChangeGateResult.count({ where: { executionId: approved.executionId, tenantId: TENANT } }), 1);
    const shown = await loadReviewConsole(ownerActor, approved.rootId);
    assert.equal(shown.ok && shown.screen.nextSecondChangeGate?.status, 'BLOCKED');
    assert.equal(shown.ok && shown.screen.nextSecondChangeGate?.errorCode, 'NO_CHANGES');
    assert.equal(shown.ok && shown.screen.canRunSecondChangeGate, false);

    const gated = await evaluateSecondChangeGate({ userId: owner.userId, memberships: [owner], agentExecutionId: reported.executionId });
    assert.equal(gated.ok, true, gated.ok ? '' : gated.reason);
    if (gated.ok) {
      assert.equal(gated.gate.status, 'GATED');
      assert.equal(gated.gate.reasons.includes('AGENT_REPORTED_FILE_NOT_FOUND_IN_WORKSPACE'), true);
    }
    const [left, right] = await Promise.all([
      evaluateSecondChangeGate({ userId: owner.userId, memberships: [owner], agentExecutionId: concurrent.executionId }),
      evaluateSecondChangeGate({ userId: owner.userId, memberships: [owner], agentExecutionId: concurrent.executionId }),
    ]);
    assert.equal(left.ok && right.ok, true);
    if (left.ok && right.ok) {
      assert.equal(left.gate.id, right.gate.id);
      assert.equal(left.gate.status, 'GATED');
    }
    assert.equal(await prisma.juryChangeGateResult.count({ where: { executionId: concurrent.executionId, tenantId: TENANT } }), 1);

    const blockedWorkspace = await evaluateSecondChangeGate({ userId: owner.userId, memberships: [owner], agentExecutionId: workspace.executionId });
    assert.equal(blockedWorkspace.ok, true, blockedWorkspace.ok ? '' : blockedWorkspace.reason);
    if (blockedWorkspace.ok) {
      assert.equal(blockedWorkspace.gate.status, 'BLOCKED');
      assert.equal(blockedWorkspace.gate.errorCode, 'WORKSPACE_NOT_ALLOWED');
    }
    const blockedSecret = await evaluateSecondChangeGate({ userId: owner.userId, memberships: [owner], agentExecutionId: secret.executionId });
    assert.equal(blockedSecret.ok, true, blockedSecret.ok ? '' : blockedSecret.reason);
    if (blockedSecret.ok) {
      assert.equal(blockedSecret.gate.status, 'BLOCKED');
      assert.equal(blockedSecret.gate.errorCode, 'CREDENTIAL_DETECTED');
      assert.equal(blockedSecret.gate.credentialDetected, true);
    }
    const secretRow = await prisma.juryChangeGateResult.findFirst({ where: { executionId: secret.executionId, tenantId: TENANT } });
    const secretAudits = await prisma.juryAuditEvent.findMany({ where: { tenantId: TENANT, agentExecutionId: secret.executionId, action: { in: ['CHANGE_GATE_STARTED', 'CHANGE_GATE_BLOCKED', 'CHANGE_GATE_COMPLETED'] } } });
    assert.equal(JSON.stringify(secretRow).toLowerCase().includes('password'), false);
    assert.equal(JSON.stringify(secretRow).includes('postgres://'), false);
    assert.equal(JSON.stringify(secretAudits).toLowerCase().includes('password'), false);

    const pendingTry = await evaluateSecondChangeGate({ userId: owner.userId, memberships: [owner], agentExecutionId: status.executionId });
    assert.equal(pendingTry.ok, false);
    if (!pendingTry.ok) assert.equal(pendingTry.reason, 'EXECUTION_NOT_COMPLETED');
    await prisma.juryAgentExecution.updateMany({ where: { id: status.executionId, tenantId: TENANT }, data: { status: 'RUNNING' } });
    const runningTry = await evaluateSecondChangeGate({ userId: owner.userId, memberships: [owner], agentExecutionId: status.executionId });
    assert.equal(runningTry.ok, false);
    if (!runningTry.ok) assert.equal(runningTry.reason, 'EXECUTION_NOT_COMPLETED');
    await prisma.juryAgentExecution.updateMany({ where: { id: status.executionId, tenantId: TENANT }, data: { status: 'BLOCKED' } });
    const blockedTry = await evaluateSecondChangeGate({ userId: owner.userId, memberships: [owner], agentExecutionId: status.executionId });
    assert.equal(blockedTry.ok, false);
    if (!blockedTry.ok) assert.equal(blockedTry.reason, 'EXECUTION_NOT_COMPLETED');
    assert.equal(await prisma.juryChangeGateResult.count({ where: { executionId: status.executionId, tenantId: TENANT } }), 0);

    for (const id of [approved.sourceExecutionId, approved.originalExecutionId]) {
      const gatesBefore = await prisma.juryChangeGateResult.count({ where: { executionId: id, tenantId: TENANT } });
      const refused = await evaluateSecondChangeGate({ userId: owner.userId, memberships: [owner], agentExecutionId: id });
      assert.equal(refused.ok, false, id);
      if (!refused.ok) assert.equal(refused.reason, 'NOT_REREVIEW_IMPROVEMENT_TASK');
      assert.equal(await prisma.juryChangeGateResult.count({ where: { executionId: id, tenantId: TENANT } }), gatesBefore);
    }
    const empty = await evaluateSecondChangeGate({ userId: owner.userId, memberships: [owner], agentExecutionId: ' ' });
    assert.equal(empty.ok, false);
    if (!empty.ok) assert.equal(empty.reason, 'NOT_FOUND');

    for (const row of [tamperTask, tamperParent, tamperExecution, tamperGate]) {
      const refused = await evaluateSecondChangeGate({ userId: owner.userId, memberships: [owner], agentExecutionId: row.executionId });
      assert.equal(refused.ok, false, row.executionId);
      if (!refused.ok) assert.equal(refused.reason, 'NOT_REREVIEW_IMPROVEMENT_TASK');
      assert.equal(await prisma.juryChangeGateResult.count({ where: { executionId: row.executionId, tenantId: TENANT } }), 0);
    }
    const foreignBefore = await prisma.juryChangeGateResult.count({ where: { tenantId: FOREIGN } });
    const foreignTry = await evaluateSecondChangeGate({ userId: owner.userId, memberships: [owner], agentExecutionId: foreignRow.executionId });
    assert.equal(foreignTry.ok, false);
    if (!foreignTry.ok) assert.equal(foreignTry.reason, 'NOT_FOUND');
    assert.equal(await prisma.juryChangeGateResult.count({ where: { tenantId: FOREIGN } }), foreignBefore);
    assert.equal(await prisma.juryChangeGateResult.count({ where: { executionId: foreignRow.executionId, tenantId: FOREIGN } }), 0);

    const after = await counts(prisma);
    assert.equal(after.gates, before.gates + 5);
    assert.equal(after.executions, before.executions);
    assert.equal(after.tasks, before.tasks);
    assert.equal(after.humans, before.humans);
    assert.equal(after.results, before.results);
    assert.equal(after.gateReviews, before.gateReviews);
    assert.equal(after.evidence, before.evidence);
    assert.equal(after.cycles, 0);
    assert.equal(after.loops, 0);
    assert.deepEqual(await prisma.juryAgentExecution.findFirst({ where: { id: approved.executionId, tenantId: TENANT } }), approvedExecution);
    assert.deepEqual(await prisma.juryImprovementTask.findFirst({ where: { id: approved.taskId, tenantId: TENANT } }), approvedTask);
    assert.deepEqual(await prisma.juryHumanDecision.findFirst({ where: { id: approved.approvalId, tenantId: TENANT } }), approvedHuman);
    assert.deepEqual(await prisma.juryReviewResult.findFirst({ where: { id: approved.secondResultId, tenantId: TENANT } }), approvedResult);
    assert.deepEqual(await metricSnapshot(prisma), metricsBefore);
    const evidenceAfter = await prisma.juryEvidence.findFirst({ where: { id: EVIDENCE, tenantId: TENANT }, select: { contentHash: true } });
    assert.equal(evidenceAfter?.contentHash, evidenceBefore?.contentHash);
    assert.deepEqual(await liveSnapshot(prisma), liveBefore);
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

test('second change gate reuses the existing evaluator contract', () => {
  const source = readFileSync(path.resolve(process.cwd(), 'src/lib/jury-product/rereview-second-change-gate.ts'), 'utf8');
  for (const token of [
    'evaluateHumanChangeGate',
    'executeReReviewAgentExecution',
    'fakeCursorAdapter',
    'FakeCursorAdapter',
    'evaluateSecondReReview',
    'persistReReviewImprovement',
    'persistSecondReReviewImprovement',
    'noteHumanNextAction',
    'handoffSecondImprovement',
    'recordDecisionCycle',
    'persistImprovementAutoLoop',
    'callFrozenReviewPipeline',
    'findUnique',
    'buildEvidencePackFromDb',
    'attachGa4Evidence',
    'child_process',
    'inspectAllowlistedWorkspace',
  ]) {
    assert.equal(source.includes(token), false, token);
  }
  assert.equal(source.includes('evaluateReReviewChangeGate'), true);
  assert.equal(source.includes("action: 'agent.execute'"), true);
  assert.equal(source.includes('input.agentExecutionId'), true);
  const human = readFileSync(path.resolve(process.cwd(), 'src/lib/jury-product/human-change-gate.ts'), 'utf8');
  assert.equal(human.includes('evaluateChangeGate'), true);
  assert.equal(human.includes('inspection: { files: [], present: [] }'), true);
  const actions = readFileSync(path.resolve(process.cwd(), 'src/app/(root)/jury/actions.ts'), 'utf8');
  const fn = actions.slice(
    actions.indexOf('export async function runSecondChangeGate'),
    actions.indexOf('export async function runLaterReReview'),
  );
  assert.equal(fn.includes("formData.get('agentExecutionId')"), true);
  for (const key of ['tenantId', 'provider', 'workspace', 'taskId', 'humanDecision', 'prompt', 'changedFiles', 'gatePolicy', 'improvementTaskId']) {
    assert.equal(fn.includes(`formData.get('${key}')`), false, key);
  }
  const ui = readFileSync(path.resolve(process.cwd(), 'src/app/(root)/jury/ui.tsx'), 'utf8');
  const body = ui.slice(
    ui.indexOf('export function SecondChangeGateBody'),
    ui.indexOf('export function LaterReReviewBody'),
  );
  assert.equal(body.includes('Run Change Gate'), true);
  assert.equal(body.includes('Agent Completed'), true);
  assert.equal(body.includes('Change Gate: APPROVED'), true);
  assert.equal(body.includes('Change Gate: GATED'), true);
  assert.equal(body.includes('Change Gate: BLOCKED'), true);
  for (const label of ['Run Re-review', 'Next Improvement', 'Approve for Agent', 'Send to Agent', 'Run Agent', 'Auto Fix', 'Run Loop']) {
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
};

async function prepare(
  prisma: Awaited<typeof import('@/lib/prisma')>['prisma'],
  id: string,
  decision: JuryDecision,
  finish: 'approved' | 'gated' | 'workspace' | 'secret' | 'pending',
  tenantId = TENANT,
): Promise<Prepared> {
  const actor = tenantId === TENANT ? owner : foreign;
  const row = await chain(prisma, id, decision, tenantId);
  const second = await openedSecond(prisma, row, decision, `${id}-summary`, 'safe summary', tenantId);
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
  if (finish !== 'pending') {
    const reported = finish === 'gated' ? [COPY] : [];
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
          humanDecisionId: approval?.id ?? '',
          improvementTaskId: taskId,
          reviewResultId: second.resultId,
          result: { summary: finish === 'secret' ? SECRET : 'safe summary', changedFiles: reported, testsRun: [], testsPassed: null },
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
  };
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
  decision: JuryDecision,
  summary: string,
  executionSummary = 'safe summary',
  tenantId = TENANT,
) {
  const actor = tenantId === TENANT ? owner : foreign;
  const connectionId = tenantId === TENANT ? CONN : 'phase63-foreign-conn';
  const evidenceId = tenantId === TENANT ? EVIDENCE : 'phase63-foreign-evidence';
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
    data: { id: 'phase63-foreign-conn', tenantId: FOREIGN, serviceKey: 'phase63-foreign-conn', displayName: 'phase63-foreign-conn', accessMethod: 'FILE_UPLOAD', status: 'CONNECTED', createdByUserId: foreign.userId },
  });
  await evidenceRow(prisma, EVIDENCE, TENANT, CONN);
  await evidenceRow(prisma, 'phase63-foreign-evidence', FOREIGN, 'phase63-foreign-conn');
  await prisma.juryNormalizedMetric.createMany({
    data: [
      metric('phase63-zero', 'userCount', 0, 'AVAILABLE'),
      metric('phase63-null', 'postsLast7d', null, 'NOT_MEASURED'),
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
  const connectionId = tenantId === TENANT ? CONN : 'phase63-foreign-conn';
  const evidenceId = tenantId === TENANT ? EVIDENCE : 'phase63-foreign-evidence';
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
      workspaceRef: { type: 'PROJECT', ref: 'phase63-fixture' }, provenance: { kind: 'human-agent-execution' },
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
    where: { username: { in: ['phase63-owner', 'phase63-member', 'phase63-auditor', 'phase63-foreign'] } },
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
