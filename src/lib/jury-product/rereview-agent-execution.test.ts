import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import type { JuryActor } from './access';
import { fakeCursorAdapter } from './agents/fake-cursor-adapter';
import { projectImprovementTrace } from './improvement-trace-console';
import { readImprovementTrace } from './improvement-trace-store';
import { persistHumanAgentHandoff } from './human-agent-handoff';
import { JURY_CORE_CONTRACT_VERSION, type JuryDecision, type JuryFinalSurface, type JuryMembership } from './records';
import { loadReviewConsole, projectReviewConsole } from './review-console';
import { approveReReviewAgent, persistReReviewAgentHandoff } from './rereview-agent-handoff';
import { executeReReviewAgentExecution } from './rereview-agent-execution';
import { reReviewImprovementTaskId } from './rereview-improvement-bridge';

const TENANT = 'phase56-rereview';
const FOREIGN = 'phase56-foreign';
const CONN = 'phase56-conn';
const EVIDENCE = 'phase56-evidence';
const NOW = '2026-10-02T15:10:00.000Z';
const LIVE_REVIEW = '3707202563ecae9b38f324a4eefd9243a14bc69420ed6cdda16c4c5794f62e0d';
const LIVE_CYCLE = '14308b4c999ccbe8ca54b7f31da5385385d4073c49bbf2955582a6bb96afb01e';

const owner = membership('phase56-owner-m', TENANT, 'phase56-owner', 'OWNER');
const member = membership('phase56-member-m', TENANT, 'phase56-member', 'DEVELOPER');
const auditor = membership('phase56-auditor-m', TENANT, 'phase56-auditor', 'VIEWER');
const foreign = membership('phase56-foreign-m', FOREIGN, 'phase56-foreign', 'OWNER');
const ownerActor: JuryActor = { ok: true, userId: owner.userId, tenantId: TENANT, role: 'OWNER', membershipId: owner.id };
const memberActor: JuryActor = { ok: true, userId: member.userId, tenantId: TENANT, role: 'DEVELOPER', membershipId: member.id };
const auditorActor: JuryActor = { ok: true, userId: auditor.userId, tenantId: TENANT, role: 'VIEWER', membershipId: auditor.id };

test('second iteration run control is only the pending execution', () => {
  const base = {
    actor: ownerActor,
    result: { id: 'original', tenantId: TENANT, expectedDecision: 'VERIFY' as const, finalSurface: face('steady'), completedAt: NOW },
    status: 'COMPLETED' as const,
    evidenceId: EVIDENCE,
    metrics: [],
    humanDecision: 'VERIFY' as const,
    improvementTask: { id: 'source', taskType: 'VERIFICATION' as const },
    reReview: {
      id: 'cgr',
      status: 'EXECUTED',
      reviewRequestId: 'child-request',
      reviewResultId: 'child',
      decision: 'VERIFY' as const,
      completedAt: NOW,
    },
    nextImprovement: { id: 'next', taskType: 'VERIFICATION' as const, status: 'OPEN' },
    nextApproval: 'VERIFY' as const,
    nextAgentExecution: { id: 'exec', status: 'PENDING', agent: 'CURSOR' },
  };
  const ready = projectReviewConsole(base);
  assert.equal(ready.ok && ready.screen.canRunReReviewAgent, true);
  assert.equal(ready.ok && ready.screen.canHandoffReReviewAgent, false);
  const memberView = projectReviewConsole({ ...base, actor: memberActor });
  assert.equal(memberView.ok && memberView.screen.canRunReReviewAgent, false);
  const reader = projectReviewConsole({ ...base, actor: auditorActor });
  assert.equal(reader.ok && reader.screen.canRunReReviewAgent, false);
  const running = projectReviewConsole({ ...base, nextAgentExecution: { id: 'exec', status: 'RUNNING', agent: 'CURSOR' } });
  assert.equal(running.ok && running.screen.canRunReReviewAgent, false);
  assert.equal(running.ok && running.screen.nextAgentExecution?.status, 'RUNNING');
  const completed = projectReviewConsole({ ...base, nextAgentExecution: { id: 'exec', status: 'COMPLETED', agent: 'CURSOR' } });
  assert.equal(completed.ok && completed.screen.canRunReReviewAgent, false);
  assert.equal(completed.ok && completed.screen.nextAgentExecution?.status, 'COMPLETED');
});

test('second iteration execution runs the pending handoff once', async () => {
  loadEnv();
  const { prisma } = await import('@/lib/prisma');
  let cleanupError: string | null = null;
  const liveBefore = await liveSnapshot(prisma);
  try {
    await removeFixture(prisma);
    await seed(prisma);
    const verify = await chain(prisma, 'phase56-verify', 'VERIFY');
    const reword = await chain(prisma, 'phase56-reword', 'REWORD');
    const concurrent = await chain(prisma, 'phase56-concurrent', 'VERIFY');
    const running = await chain(prisma, 'phase56-running', 'VERIFY');
    const blocked = await chain(prisma, 'phase56-blocked', 'VERIFY');
    const missing = await chain(prisma, 'phase56-missing', 'VERIFY');
    const wrong = await chain(prisma, 'phase56-wrong', 'VERIFY');
    const other = await chain(prisma, 'phase56-other', 'VERIFY');
    const secret = await chain(prisma, 'phase56-secret', 'VERIFY');
    const broken = await chain(prisma, 'phase56-broken', 'VERIFY');
    const foreignChain = await chain(prisma, 'phase56-foreign-review', 'VERIFY', FOREIGN);
    const plain = await plainTask(prisma);

    const verifyId = await pendingExecution(verify.nextTaskId);
    const rewordId = await pendingExecution(reword.nextTaskId);
    const concurrentId = await pendingExecution(concurrent.nextTaskId);
    const runningId = await pendingExecution(running.nextTaskId);
    const blockedId = await pendingExecution(blocked.nextTaskId);
    const wrongId = await pendingExecution(wrong.nextTaskId);
    const otherId = await pendingExecution(other.nextTaskId);
    const secretId = await pendingExecution(secret.nextTaskId);
    const brokenId = await pendingExecution(broken.nextTaskId);
    const foreignId = await pendingExecution(foreignChain.nextTaskId, foreign);
    const missingId = `${missing.nextTaskId}-pending`;
    await prisma.juryAgentExecution.create({
      data: {
        id: missingId,
        tenantId: TENANT,
        taskId: missing.nextTaskId,
        agent: 'CURSOR',
        allowedPaths: [],
        deniedPaths: [],
        status: 'PENDING',
        workspaceRef: { type: 'PROJECT', ref: 'jury-product' },
        inputSnapshot: { kind: 'human-agent-handoff', diagnosis: 'safe' },
        provenance: { kind: 'human-agent-handoff', humanDecisionId: missing.humanId },
        createdAt: new Date(NOW),
        updatedAt: new Date(NOW),
      },
    });
    const plainHandoff = await persistHumanAgentHandoff({
      userId: owner.userId,
      memberships: [owner],
      improvementTaskId: plain.taskId,
    });
    assert.equal(plainHandoff.ok, true);
    if (!plainHandoff.ok) return;

    await prisma.juryAgentExecution.updateMany({
      where: { id: runningId, tenantId: TENANT },
      data: { status: 'RUNNING', startedAt: new Date(NOW) },
    });
    await prisma.juryAgentExecution.updateMany({
      where: { id: blockedId, tenantId: TENANT },
      data: { status: 'BLOCKED', errorCode: 'AGENT_EXECUTION_FAILED' },
    });
    await prisma.juryAgentExecution.updateMany({
      where: { id: wrongId, tenantId: TENANT },
      data: { provenance: { kind: 'human-agent-handoff', humanDecisionId: wrong.humanId } },
    });
    const wrongApproval = await prisma.juryHumanDecision.findFirst({
      where: { tenantId: TENANT, reviewResultId: wrong.reReviewResultId },
      select: { id: true },
    });
    await prisma.juryAgentExecution.updateMany({
      where: { id: otherId, tenantId: TENANT },
      data: { provenance: { kind: 'human-agent-handoff', humanDecisionId: wrongApproval?.id ?? 'missing-approval' } },
    });
    await prisma.juryReviewResult.updateMany({
      where: { id: broken.reReviewResultId, tenantId: TENANT },
      data: { parentReviewResultId: plain.reviewId },
    });
    await prisma.juryAgentExecution.updateMany({
      where: { id: secretId, tenantId: TENANT },
      data: { inputSnapshot: { kind: 'human-agent-handoff', note: 'password' } },
    });

    const sourceBefore = await prisma.juryAgentExecution.findFirst({ where: { id: verify.executionId, tenantId: TENANT } });
    const sourceTaskBefore = await prisma.juryImprovementTask.findFirst({ where: { id: verify.taskId, tenantId: TENANT } });
    const nextTaskBefore = await prisma.juryImprovementTask.findFirst({ where: { id: verify.nextTaskId, tenantId: TENANT } });
    const sourceHumanBefore = await prisma.juryHumanDecision.findFirst({ where: { id: verify.humanId, tenantId: TENANT } });
    const gateBefore = await prisma.juryChangeGateResult.findFirst({ where: { id: verify.gateId, tenantId: TENANT } });
    const foreignBefore = await prisma.juryAgentExecution.findFirst({ where: { id: foreignId, tenantId: FOREIGN } });
    const before = await counts(prisma);
    const waiting = await loadReviewConsole(ownerActor, verify.reviewId);
    assert.equal(waiting.ok && waiting.screen.canRunReReviewAgent, true);
    assert.equal(waiting.ok && waiting.screen.nextAgentExecution?.status, 'PENDING');

    const memberAdapter = fakeCursorAdapter('success');
    const memberTry = await executeReReviewAgentExecution({
      userId: member.userId,
      memberships: [member],
      agentExecutionId: verifyId,
      adapter: memberAdapter,
    });
    assert.equal(memberTry.ok, false);
    if (!memberTry.ok) assert.equal(memberTry.reason, 'FORBIDDEN');
    assert.equal(memberAdapter.calls.length, 0);
    const auditorAdapter = fakeCursorAdapter('success');
    const auditorTry = await executeReReviewAgentExecution({
      userId: auditor.userId,
      memberships: [auditor],
      agentExecutionId: verifyId,
      adapter: auditorAdapter,
    });
    assert.equal(auditorTry.ok, false);
    if (!auditorTry.ok) assert.equal(auditorTry.reason, 'FORBIDDEN');
    assert.equal(auditorAdapter.calls.length, 0);
    assert.equal((await prisma.juryAgentExecution.findFirst({ where: { id: verifyId, tenantId: TENANT } }))?.status, 'PENDING');

    const verifyAdapter = fakeCursorAdapter('success');
    const ran = await executeReReviewAgentExecution({
      userId: owner.userId,
      memberships: [owner],
      agentExecutionId: verifyId,
      adapter: verifyAdapter,
    });
    assert.equal(ran.ok, true);
    if (ran.ok) {
      assert.equal(ran.adapterCalled, true);
      assert.equal(ran.status, 'COMPLETED');
      assert.equal(ran.reviewId, verify.reviewId);
      assert.equal(ran.result?.testsPassed, null);
    }
    assert.equal(verifyAdapter.calls.length, 1);
    assert.equal(verifyAdapter.calls[0]?.workspaceRoot, '');
    assert.equal(verifyAdapter.calls[0]?.executionId, verifyId);
    const stored = await prisma.juryAgentExecution.findFirst({ where: { id: verifyId, tenantId: TENANT } });
    assert.equal(stored?.status, 'COMPLETED');
    assert.ok(stored?.startedAt);
    assert.ok(stored?.finishedAt);
    const storedText = JSON.stringify(stored?.provenance);
    assert.equal(storedText.includes('사용자 노출 문구를 작업 제약 안에서 조정하는 변경을 준비했다.'), true);
    assert.equal(storedText.toLowerCase().includes('password'), false);
    const replayAdapter = fakeCursorAdapter('success');
    const replay = await executeReReviewAgentExecution({
      userId: owner.userId,
      memberships: [owner],
      agentExecutionId: verifyId,
      adapter: replayAdapter,
    });
    assert.equal(replay.ok, true);
    if (replay.ok) {
      assert.equal(replay.adapterCalled, false);
      assert.equal(replay.status, 'COMPLETED');
    }
    assert.equal(replayAdapter.calls.length, 0);

    const shared = fakeCursorAdapter('success');
    const [left, right] = await Promise.all([
      executeReReviewAgentExecution({ userId: owner.userId, memberships: [owner], agentExecutionId: concurrentId, adapter: shared }),
      executeReReviewAgentExecution({ userId: owner.userId, memberships: [owner], agentExecutionId: concurrentId, adapter: shared }),
    ]);
    assert.equal(left.ok && right.ok, true);
    if (left.ok && right.ok) assert.equal(Number(left.adapterCalled) + Number(right.adapterCalled), 1);
    assert.equal(shared.calls.length, 1);
    assert.equal((await prisma.juryAgentExecution.findFirst({ where: { id: concurrentId, tenantId: TENANT } }))?.status, 'COMPLETED');

    const runningAdapter = fakeCursorAdapter('success');
    const runningTry = await executeReReviewAgentExecution({
      userId: owner.userId,
      memberships: [owner],
      agentExecutionId: runningId,
      adapter: runningAdapter,
    });
    assert.equal(runningTry.ok, false);
    if (!runningTry.ok) assert.equal(runningTry.reason, 'ALREADY_RUNNING');
    assert.equal(runningAdapter.calls.length, 0);
    assert.equal((await prisma.juryAgentExecution.findFirst({ where: { id: runningId, tenantId: TENANT } }))?.status, 'RUNNING');

    const blockedAdapter = fakeCursorAdapter('success');
    const blockedTry = await executeReReviewAgentExecution({
      userId: owner.userId,
      memberships: [owner],
      agentExecutionId: blockedId,
      adapter: blockedAdapter,
    });
    assert.equal(blockedTry.ok, true);
    if (blockedTry.ok) {
      assert.equal(blockedTry.status, 'BLOCKED');
      assert.equal(blockedTry.adapterCalled, false);
    }
    assert.equal(blockedAdapter.calls.length, 0);

    const missingAdapter = fakeCursorAdapter('success');
    const missingTry = await executeReReviewAgentExecution({
      userId: owner.userId,
      memberships: [owner],
      agentExecutionId: missingId,
      adapter: missingAdapter,
    });
    assert.equal(missingTry.ok, false);
    if (!missingTry.ok) assert.equal(missingTry.reason, 'HUMAN_APPROVAL_REQUIRED');
    assert.equal(missingAdapter.calls.length, 0);
    assert.equal((await prisma.juryAgentExecution.findFirst({ where: { id: missingId, tenantId: TENANT } }))?.status, 'PENDING');

    const wrongAdapter = fakeCursorAdapter('success');
    const wrongTry = await executeReReviewAgentExecution({
      userId: owner.userId,
      memberships: [owner],
      agentExecutionId: wrongId,
      adapter: wrongAdapter,
    });
    assert.equal(wrongTry.ok, false);
    if (!wrongTry.ok) assert.equal(wrongTry.reason, 'HUMAN_APPROVAL_REQUIRED');
    assert.equal(wrongAdapter.calls.length, 0);
    assert.equal((await prisma.juryAgentExecution.findFirst({ where: { id: wrongId, tenantId: TENANT } }))?.status, 'PENDING');

    const otherAdapter = fakeCursorAdapter('success');
    const otherTry = await executeReReviewAgentExecution({
      userId: owner.userId,
      memberships: [owner],
      agentExecutionId: otherId,
      adapter: otherAdapter,
    });
    assert.equal(otherTry.ok, false);
    if (!otherTry.ok) assert.equal(otherTry.reason, 'HUMAN_APPROVAL_REQUIRED');
    assert.equal(otherAdapter.calls.length, 0);

    const plainAdapter = fakeCursorAdapter('success');
    const plainTry = await executeReReviewAgentExecution({
      userId: owner.userId,
      memberships: [owner],
      agentExecutionId: plainHandoff.agentExecutionId,
      adapter: plainAdapter,
    });
    assert.equal(plainTry.ok, false);
    if (!plainTry.ok) assert.equal(plainTry.reason, 'NOT_REREVIEW_IMPROVEMENT_TASK');
    assert.equal(plainAdapter.calls.length, 0);
    assert.equal((await prisma.juryAgentExecution.findFirst({ where: { id: plainHandoff.agentExecutionId, tenantId: TENANT } }))?.status, 'PENDING');

    const brokenAdapter = fakeCursorAdapter('success');
    const brokenTry = await executeReReviewAgentExecution({
      userId: owner.userId,
      memberships: [owner],
      agentExecutionId: brokenId,
      adapter: brokenAdapter,
    });
    assert.equal(brokenTry.ok, false);
    if (!brokenTry.ok) assert.equal(brokenTry.reason, 'NOT_REREVIEW_IMPROVEMENT_TASK');
    assert.equal(brokenAdapter.calls.length, 0);
    assert.equal((await prisma.juryAgentExecution.findFirst({ where: { id: brokenId, tenantId: TENANT } }))?.status, 'PENDING');

    const foreignAdapter = fakeCursorAdapter('success');
    const foreignTry = await executeReReviewAgentExecution({
      userId: owner.userId,
      memberships: [owner],
      agentExecutionId: foreignId,
      adapter: foreignAdapter,
    });
    assert.equal(foreignTry.ok, false);
    if (!foreignTry.ok) assert.equal(foreignTry.reason, 'NOT_FOUND');
    assert.equal(foreignAdapter.calls.length, 0);
    const foreignAfter = await prisma.juryAgentExecution.findFirst({ where: { id: foreignId, tenantId: FOREIGN } });
    assert.equal(foreignAfter?.status, 'PENDING');
    assert.equal(foreignAfter?.updatedAt?.toISOString(), foreignBefore?.updatedAt?.toISOString());

    const secretAdapter = fakeCursorAdapter('success');
    const secretTry = await executeReReviewAgentExecution({
      userId: owner.userId,
      memberships: [owner],
      agentExecutionId: secretId,
      adapter: secretAdapter,
    });
    assert.equal(secretTry.ok, false);
    if (!secretTry.ok) assert.equal(secretTry.reason, 'SNAPSHOT_UNSAFE');
    assert.equal(secretAdapter.calls.length, 0);
    assert.equal((await prisma.juryAgentExecution.findFirst({ where: { id: secretId, tenantId: TENANT } }))?.status, 'PENDING');

    const rewordAdapter = fakeCursorAdapter('success');
    const reworded = await executeReReviewAgentExecution({
      userId: owner.userId,
      memberships: [owner],
      agentExecutionId: rewordId,
      adapter: rewordAdapter,
    });
    assert.equal(reworded.ok, true);
    if (reworded.ok) assert.equal(reworded.status, 'COMPLETED');
    assert.equal(rewordAdapter.calls.length, 1);

    const sourceAfter = await prisma.juryAgentExecution.findFirst({ where: { id: verify.executionId, tenantId: TENANT } });
    const sourceTaskAfter = await prisma.juryImprovementTask.findFirst({ where: { id: verify.taskId, tenantId: TENANT } });
    const nextTaskAfter = await prisma.juryImprovementTask.findFirst({ where: { id: verify.nextTaskId, tenantId: TENANT } });
    const sourceHumanAfter = await prisma.juryHumanDecision.findFirst({ where: { id: verify.humanId, tenantId: TENANT } });
    const original = await prisma.juryReviewResult.findFirst({ where: { id: verify.reviewId, tenantId: TENANT } });
    const child = await prisma.juryReviewResult.findFirst({ where: { id: verify.reReviewResultId, tenantId: TENANT } });
    const gateAfter = await prisma.juryChangeGateResult.findFirst({ where: { id: verify.gateId, tenantId: TENANT } });
    assert.equal(sourceAfter?.status, 'COMPLETED');
    assert.equal(sourceAfter?.updatedAt?.toISOString(), sourceBefore?.updatedAt?.toISOString());
    assert.equal(sourceTaskAfter?.diagnosis, sourceTaskBefore?.diagnosis);
    assert.equal(sourceTaskAfter?.updatedAt?.toISOString(), sourceTaskBefore?.updatedAt?.toISOString());
    assert.equal(nextTaskAfter?.diagnosis, nextTaskBefore?.diagnosis);
    assert.equal(nextTaskAfter?.updatedAt?.toISOString(), nextTaskBefore?.updatedAt?.toISOString());
    assert.equal(sourceHumanAfter?.decision, sourceHumanBefore?.decision);
    assert.equal(original?.expectedDecision, 'VERIFY');
    assert.equal(child?.expectedDecision, 'VERIFY');
    assert.equal(gateAfter?.status, 'APPROVED');
    assert.equal(gateAfter?.updatedAt?.toISOString(), gateBefore?.updatedAt?.toISOString());
    const zero = await prisma.juryNormalizedMetric.findFirst({ where: { id: 'phase56-zero', tenantId: TENANT } });
    const missingMetric = await prisma.juryNormalizedMetric.findFirst({ where: { id: 'phase56-null', tenantId: TENANT } });
    assert.equal(zero?.value, 0);
    assert.equal(missingMetric?.value, null);

    const after = await counts(prisma);
    assert.equal(after.results, before.results);
    assert.equal(after.gates, before.gates);
    assert.equal(after.gateReviews, before.gateReviews);
    assert.equal(after.tasks, before.tasks);
    assert.equal(after.evidence, before.evidence);
    assert.equal(after.cycles, 0);
    assert.equal(after.loops, 0);
    assert.equal(after.running, 1);

    const shown = await loadReviewConsole(ownerActor, verify.reviewId);
    assert.equal(shown.ok, true);
    if (shown.ok) {
      assert.equal(shown.screen.canRunReReviewAgent, false);
      assert.equal(shown.screen.nextAgentExecution?.status, 'COMPLETED');
    }
    const traced = await readImprovementTrace({ userId: owner.userId, memberships: [owner], improvementTaskId: verify.taskId });
    assert.equal(traced.ok, true);
    if (traced.ok) {
      const timeline = projectImprovementTrace(traced.trace).timeline;
      assert.equal(timeline.some((item) => item.title === 'AgentExecution' && item.status === 'COMPLETED'), true);
    }
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

test('second iteration execution reuses the locked lifecycle', () => {
  const source = readFileSync(path.resolve(process.cwd(), 'src/lib/jury-product/rereview-agent-execution.ts'), 'utf8');
  for (const token of [
    'buildEvidencePackFromDb',
    'attachGa4Evidence',
    'runAisleAdapter',
    'GA4_PROPERTY_ID',
    'GA4_SERVICE_ACCOUNT',
    'findUnique',
    'child_process',
    'callFrozenReviewPipeline',
    'persistChangeGateReReview',
    'evaluateHumanChangeGate',
    'persistReReviewImprovement',
    'persistHumanAgentHandoff',
    'executeHumanAgentExecution',
    'persistImprovementAutoLoop',
    'recordDecisionCycle',
  ]) {
    assert.equal(source.includes(token), false, token);
  }
  assert.equal(source.includes('advanceLockedHumanExecution'), true);
  assert.equal(source.includes('fakeCursorAdapter'), true);
  assert.equal(source.includes("action: 'agent.execute'"), true);
  assert.equal(source.includes('input.agentExecutionId'), true);
  assert.equal(source.includes('HUMAN_APPROVAL_REQUIRED'), true);
  const actions = readFileSync(path.resolve(process.cwd(), 'src/app/(root)/jury/actions.ts'), 'utf8');
  const fn = actions.slice(
    actions.indexOf('export async function runReReviewAgentExecution'),
    actions.indexOf('export async function runReReviewChangeGate'),
  );
  assert.equal(fn.includes("formData.get('agentExecutionId')"), true);
  for (const key of ['tenantId', 'provider', 'workspace', 'taskId', 'humanDecision', 'prompt', 'reviewResultId', 'reReviewResultId']) {
    assert.equal(fn.includes(`formData.get('${key}')`), false, key);
  }
  const ui = readFileSync(path.resolve(process.cwd(), 'src/app/(root)/jury/ui.tsx'), 'utf8');
  const body = ui.slice(ui.indexOf('export function ReReviewAgentRunBody'), ui.indexOf('export function ReReviewChangeGateBody'));
  assert.equal(body.includes('Run Agent'), true);
  assert.equal(body.includes('Agent Running'), true);
  assert.equal(body.includes('Agent Completed'), true);
  for (const label of ['Run Change Gate', 'Re-review', 'Auto Fix', 'Run Loop', 'Run Again', 'Execute Agent']) {
    assert.equal(body.includes(label), false, label);
  }
  const handoff = ui.slice(ui.indexOf('export function ReReviewAgentHandoffBody'), ui.indexOf('export function HumanReReviewBody'));
  assert.equal(handoff.includes('Run Agent'), false);
});

function pendingExecution(improvementTaskId: string, actor: JuryMembership = owner) {
  return approveReReviewAgent({ userId: actor.userId, memberships: [actor], improvementTaskId }).then(async (approved) => {
    assert.equal(approved.ok, true);
    const opened = await persistReReviewAgentHandoff({ userId: actor.userId, memberships: [actor], improvementTaskId });
    assert.equal(opened.ok, true);
    if (!opened.ok) throw new Error('handoff failed');
    return opened.agentExecutionId;
  });
}

function loadEnv(): void {
  for (const [file, override] of [['.env', false], ['.env.local', true]] as const) {
    let text = '';
    try {
      text = readFileSync(path.resolve(process.cwd(), file), 'utf8');
    } catch {
      continue;
    }
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
  await connection(prisma, 'phase56-foreign-conn', FOREIGN, foreign.userId);
  await evidenceRow(prisma, EVIDENCE, TENANT, CONN);
  await evidenceRow(prisma, 'phase56-foreign-evidence', FOREIGN, 'phase56-foreign-conn');
  await prisma.juryNormalizedMetric.createMany({
    data: [
      metric('phase56-zero', 'userCount', 0, 'AVAILABLE'),
      metric('phase56-null', 'postsLast7d', null, 'NOT_MEASURED'),
    ],
  });
}

async function plainTask(prisma: Awaited<typeof import('@/lib/prisma')>['prisma']) {
  const requestId = 'phase56-plain-request';
  const reviewId = 'phase56-plain-review';
  const humanId = 'phase56-plain-human';
  const taskId = 'phase56-plain-task';
  await prisma.juryReviewRequest.create({
    data: {
      id: requestId, tenantId: TENANT, connectionId: CONN, evidenceId: EVIDENCE, reviewType: 'FULL_REVIEW',
      claim: '측정된 범위의 문구만 사용한다.', mode: 'AISLE_SELF', status: 'COMPLETED', coreRootDir: 'data/jury-product',
      requestedByUserId: owner.userId,
    },
  });
  await prisma.juryReviewResult.create({
    data: {
      id: reviewId, tenantId: TENANT, reviewRequestId: requestId, boardRunId: `${reviewId}-board`, evidenceStrength: 'strong',
      claimStrength: 'weak', conflictDetected: false, overclaimDetected: false, revisionRequired: false, expectedDecision: 'VERIFY',
      finalSurface: face('plain'), contractVersion: JURY_CORE_CONTRACT_VERSION, completedAt: new Date(NOW),
    },
  });
  await prisma.juryHumanDecision.create({
    data: {
      id: humanId, tenantId: TENANT, reviewResultId: reviewId, reviewRequestId: requestId, decision: 'VERIFY',
      actorUserId: owner.userId, createdAt: new Date(NOW),
    },
  });
  await prisma.juryImprovementTask.create({
    data: {
      id: taskId, tenantId: TENANT, reviewResultId: reviewId, diagnosis: 'plain', acceptanceCriteria: ['plain'], status: 'OPEN',
      loopIndex: 0, loopPolicy: { maxIterations: null, maxRuntimeMs: null, maxCostUsd: null }, taskType: 'VERIFICATION',
      provenance: { kind: 'human-decision-improvement', humanDecisionId: humanId, reviewRequestId: requestId, reviewResultId: reviewId },
      createdAt: new Date(NOW), updatedAt: new Date(NOW),
    },
  });
  return { reviewId, taskId };
}

async function chain(
  prisma: Awaited<typeof import('@/lib/prisma')>['prisma'],
  id: string,
  reDecision: JuryDecision,
  tenantId = TENANT,
) {
  const actor = tenantId === TENANT ? owner : foreign;
  const connectionId = tenantId === TENANT ? CONN : 'phase56-foreign-conn';
  const evidenceId = tenantId === TENANT ? EVIDENCE : 'phase56-foreign-evidence';
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
      mode: 'AISLE_SELF', status: 'COMPLETED', coreRootDir: 'data/jury-product', requestedByUserId: actor.userId,
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
      workspaceRef: { type: 'PROJECT', ref: 'phase56-fixture' }, provenance: { kind: 'human-agent-execution' },
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
      mode: 'AISLE_SELF', status: 'COMPLETED', coreRootDir: 'data/jury-product', requestedByUserId: actor.userId,
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
        kind: 'rereview-improvement',
        reReviewReviewRequestId: reReviewRequestId,
        reReviewReviewResultId: reReviewResultId,
        originalReviewRequestId: requestId,
        originalReviewResultId: reviewId,
        humanDecisionId: humanId,
        sourceImprovementTaskId: taskId,
        improvementTaskId: nextTaskId,
        agentExecutionId: executionId,
        changeGateResultId: gateId,
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
  const [results, gates, gateReviews, tasks, evidence, cycles, loops, running] = await Promise.all([
    prisma.juryReviewResult.count({ where }),
    prisma.juryChangeGateResult.count({ where }),
    prisma.juryChangeGateReview.count({ where }),
    prisma.juryImprovementTask.count({ where }),
    prisma.juryEvidence.count({ where }),
    prisma.juryDecisionCycle.count({ where }),
    prisma.juryAutoLoopActivation.count({ where }),
    prisma.juryAgentExecution.count({ where: { ...where, status: 'RUNNING' } }),
  ]);
  return { results, gates, gateReviews, tasks, evidence, cycles, loops, running };
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
  await prisma.juryServiceConnection.deleteMany({ where });
  await prisma.juryMembership.deleteMany({ where });
  await prisma.juryTenant.deleteMany({ where: { id: { in: tenants } } });
  await prisma.user.deleteMany({
    where: { username: { in: ['phase56-owner', 'phase56-member', 'phase56-auditor', 'phase56-foreign'] } },
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
