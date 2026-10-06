import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { Prisma } from '@prisma/client';
import type { JuryActor } from './access';
import { fakeCursorAdapter } from './agents/fake-cursor-adapter';
import { executeHumanAgentExecution } from './human-agent-execution';
import { persistHumanAgentHandoff } from './human-agent-handoff';
import { persistHumanImprovement } from './human-improvement-bridge';
import { loadReviewConsole, noteHumanNextAction, projectReviewConsole } from './review-console';
import { JURY_CORE_CONTRACT_VERSION, type JuryDecision, type JuryFinalSurface, type JuryMembership } from './records';

const TENANT = 'phase51-run';
const FOREIGN = 'phase51-foreign';
const CONN = 'phase51-conn';
const FOREIGN_CONN = 'phase51-foreign-conn';
const EVIDENCE = 'phase51-evidence';
const NOW = '2026-10-02T12:10:00.000Z';
const LIVE_REVIEW = '3707202563ecae9b38f324a4eefd9243a14bc69420ed6cdda16c4c5794f62e0d';
const LIVE_CYCLE = '14308b4c999ccbe8ca54b7f31da5385385d4073c49bbf2955582a6bb96afb01e';
const FAKE_SUMMARY = '사용자 노출 문구를 작업 제약 안에서 조정하는 변경을 준비했다.';

const owner = membership('phase51-owner-m', TENANT, 'phase51-owner', 'OWNER');
const member = membership('phase51-member-m', TENANT, 'phase51-member', 'MEMBER');
const auditor = membership('phase51-auditor-m', TENANT, 'phase51-auditor', 'AUDITOR');
const foreign = membership('phase51-foreign-m', FOREIGN, 'phase51-foreign', 'OWNER');
const ownerActor: JuryActor = { ok: true, userId: owner.userId, tenantId: TENANT, role: 'OWNER', membershipId: owner.id };
const memberActor: JuryActor = { ok: true, userId: member.userId, tenantId: TENANT, role: 'MEMBER', membershipId: member.id };
const auditorActor: JuryActor = { ok: true, userId: auditor.userId, tenantId: TENANT, role: 'AUDITOR', membershipId: auditor.id };

test('run control is only offered for a pending owner execution', () => {
  const surface = face();
  const pending = projectReviewConsole({
    actor: ownerActor,
    result: { id: 'verify', tenantId: TENANT, expectedDecision: 'VERIFY', finalSurface: surface, completedAt: NOW },
    status: 'COMPLETED',
    evidenceId: EVIDENCE,
    metrics: [],
    humanDecision: 'VERIFY',
    improvementTask: { id: 'task', taskType: 'VERIFICATION' },
    agentExecution: { id: 'exec', status: 'PENDING', agent: 'CURSOR' },
  });
  assert.equal(pending.ok, true);
  if (pending.ok) assert.equal(pending.screen.canRun, true);
  const memberView = projectReviewConsole({
    actor: memberActor,
    result: { id: 'verify', tenantId: TENANT, expectedDecision: 'VERIFY', finalSurface: surface, completedAt: NOW },
    status: 'COMPLETED',
    evidenceId: EVIDENCE,
    metrics: [],
    humanDecision: 'VERIFY',
    improvementTask: { id: 'task', taskType: 'VERIFICATION' },
    agentExecution: { id: 'exec', status: 'PENDING', agent: 'CURSOR' },
  });
  assert.equal(memberView.ok, true);
  if (memberView.ok) assert.equal(memberView.screen.canRun, false);
  const reader = projectReviewConsole({
    actor: auditorActor,
    result: { id: 'verify', tenantId: TENANT, expectedDecision: 'VERIFY', finalSurface: surface, completedAt: NOW },
    status: 'COMPLETED',
    evidenceId: EVIDENCE,
    metrics: [],
    humanDecision: 'VERIFY',
    improvementTask: { id: 'task', taskType: 'VERIFICATION' },
    agentExecution: { id: 'exec', status: 'PENDING', agent: 'CURSOR' },
  });
  assert.equal(reader.ok, true);
  if (reader.ok) assert.equal(reader.screen.canRun, false);
  const done = projectReviewConsole({
    actor: ownerActor,
    result: { id: 'verify', tenantId: TENANT, expectedDecision: 'VERIFY', finalSurface: surface, completedAt: NOW },
    status: 'COMPLETED',
    evidenceId: EVIDENCE,
    metrics: [],
    humanDecision: 'VERIFY',
    improvementTask: { id: 'task', taskType: 'VERIFICATION' },
    agentExecution: { id: 'exec', status: 'COMPLETED', agent: 'CURSOR', summary: FAKE_SUMMARY, changedFiles: ['workspace/mock-aisle/user-facing-copy.ts'], testsRun: [], testsPassed: null },
  });
  assert.equal(done.ok, true);
  if (done.ok) {
    assert.equal(done.screen.canRun, false);
    assert.equal(done.screen.agentExecution?.summary, FAKE_SUMMARY);
  }
});

test('pending human executions run once through the fake adapter', { timeout: 120_000 }, async () => {
  loadEnv();
  const { prisma } = await import('@/lib/prisma');
  const liveBefore = await liveSnapshot(prisma);
  let cleanupError: string | null = null;
  try {
    await removeFixture(prisma);
    await seed(prisma);
    await note(owner, 'phase51-verify', 'VERIFY');
    await note(owner, 'phase51-reword', 'REWORD');
    await note(owner, 'phase51-accept', 'ACCEPT');
    await note(owner, 'phase51-mismatch', 'VERIFY');
    await note(owner, 'phase51-running', 'VERIFY');
    await note(owner, 'phase51-blocked', 'REWORD');
    const verifyTask = await persistHumanImprovement({ userId: owner.userId, memberships: [owner], reviewId: 'phase51-verify' });
    const rewordTask = await persistHumanImprovement({ userId: owner.userId, memberships: [owner], reviewId: 'phase51-reword' });
    const mismatchTask = await persistHumanImprovement({ userId: owner.userId, memberships: [owner], reviewId: 'phase51-mismatch' });
    const runningTask = await persistHumanImprovement({ userId: owner.userId, memberships: [owner], reviewId: 'phase51-running' });
    const blockedTask = await persistHumanImprovement({ userId: owner.userId, memberships: [owner], reviewId: 'phase51-blocked' });
    assert.equal(verifyTask.ok && rewordTask.ok && mismatchTask.ok && runningTask.ok && blockedTask.ok, true);
    if (!verifyTask.ok || !rewordTask.ok || !mismatchTask.ok || !runningTask.ok || !blockedTask.ok) return;
    if (!verifyTask.taskId || !rewordTask.taskId || !mismatchTask.taskId || !runningTask.taskId || !blockedTask.taskId) return;
    const verifyHandoff = await persistHumanAgentHandoff({ userId: owner.userId, memberships: [owner], improvementTaskId: verifyTask.taskId });
    const rewordHandoff = await persistHumanAgentHandoff({ userId: owner.userId, memberships: [owner], improvementTaskId: rewordTask.taskId });
    const mismatchHandoff = await persistHumanAgentHandoff({ userId: owner.userId, memberships: [owner], improvementTaskId: mismatchTask.taskId });
    const runningHandoff = await persistHumanAgentHandoff({ userId: owner.userId, memberships: [owner], improvementTaskId: runningTask.taskId });
    const blockedHandoff = await persistHumanAgentHandoff({ userId: owner.userId, memberships: [owner], improvementTaskId: blockedTask.taskId });
    assert.equal(verifyHandoff.ok && rewordHandoff.ok && mismatchHandoff.ok && runningHandoff.ok && blockedHandoff.ok, true);
    if (!verifyHandoff.ok || !mismatchHandoff.ok || !runningHandoff.ok || !blockedHandoff.ok) return;

    const acceptHuman = await prisma.juryHumanDecision.findFirst({
      where: { tenantId: TENANT, reviewResultId: 'phase51-accept' },
      select: { id: true, reviewRequestId: true },
    });
    assert.ok(acceptHuman);
    await prisma.juryImprovementTask.create({
      data: taskRow('phase51-accept-task', 'phase51-accept', 'VERIFICATION', {
        kind: 'human-decision-improvement',
        reviewRequestId: acceptHuman.reviewRequestId,
        reviewResultId: 'phase51-accept',
        humanDecisionId: acceptHuman.id,
      }),
    });
    await pendingExecution(prisma, 'phase51-accept-exec', 'phase51-accept-task');
    await prisma.juryImprovementTask.create({
      data: taskRow('phase51-none-task', 'phase51-none', 'VERIFICATION', { kind: 'human-decision-improvement' }),
    });
    await pendingExecution(prisma, 'phase51-none-exec', 'phase51-none-task');
    await pendingExecution(prisma, 'phase51-foreign-exec', 'phase51-foreign-task', FOREIGN);
    const mismatchRow = await prisma.juryImprovementTask.findFirst({
      where: { id: mismatchTask.taskId, tenantId: TENANT },
      select: { provenance: true },
    });
    const mismatchProvenance = { ...(mismatchRow?.provenance as Record<string, string>), reviewRequestId: 'phase51-other-req' };
    await prisma.juryImprovementTask.updateMany({
      where: { id: mismatchTask.taskId, tenantId: TENANT },
      data: { provenance: mismatchProvenance as Prisma.InputJsonValue },
    });
    await prisma.juryAgentExecution.updateMany({
      where: { id: runningHandoff.agentExecutionId, tenantId: TENANT },
      data: { status: 'RUNNING', startedAt: new Date(NOW) },
    });
    await prisma.juryAgentExecution.updateMany({
      where: { id: blockedHandoff.agentExecutionId, tenantId: TENANT },
      data: { status: 'BLOCKED', errorCode: 'CREDENTIAL_DATA_DETECTED', finishedAt: new Date(NOW) },
    });

    const auditorTry = await executeHumanAgentExecution({
      userId: auditor.userId,
      memberships: [auditor],
      agentExecutionId: verifyHandoff.agentExecutionId,
      adapter: fakeCursorAdapter('success'),
    });
    assert.equal(auditorTry.ok, false);
    if (!auditorTry.ok) assert.equal(auditorTry.reason, 'FORBIDDEN');
    assert.equal(auditorTry.adapterCalled, false);
    const memberTry = await executeHumanAgentExecution({
      userId: member.userId,
      memberships: [member],
      agentExecutionId: verifyHandoff.agentExecutionId,
      adapter: fakeCursorAdapter('success'),
    });
    assert.equal(memberTry.ok, false);
    if (!memberTry.ok) assert.equal(memberTry.reason, 'FORBIDDEN');
    const foreignTry = await executeHumanAgentExecution({
      userId: owner.userId,
      memberships: [owner],
      agentExecutionId: 'phase51-foreign-exec',
      adapter: fakeCursorAdapter('success'),
    });
    assert.equal(foreignTry.ok, false);
    if (!foreignTry.ok) assert.equal(foreignTry.reason, 'NOT_FOUND');
    assert.equal(await prisma.juryAgentExecution.findFirst({
      where: { id: 'phase51-foreign-exec', tenantId: FOREIGN },
      select: { status: true },
    }).then((row) => row?.status), 'PENDING');
    assert.equal(await prisma.juryAuditEvent.count({ where: { tenantId: FOREIGN, action: { in: ['AGENT_EXECUTION_STARTED', 'AGENT_EXECUTION_COMPLETED'] } } }), 0);

    const acceptTry = await executeHumanAgentExecution({
      userId: owner.userId,
      memberships: [owner],
      agentExecutionId: 'phase51-accept-exec',
      adapter: fakeCursorAdapter('success'),
    });
    assert.equal(acceptTry.ok, false);
    if (!acceptTry.ok) assert.equal(acceptTry.reason, 'HUMAN_APPROVAL_REQUIRED');
    assert.equal(await prisma.juryAgentExecution.findFirst({ where: { id: 'phase51-accept-exec', tenantId: TENANT } }).then((row) => row?.status), 'PENDING');

    const noneTry = await executeHumanAgentExecution({
      userId: owner.userId,
      memberships: [owner],
      agentExecutionId: 'phase51-none-exec',
      adapter: fakeCursorAdapter('success'),
    });
    assert.equal(noneTry.ok, false);
    if (!noneTry.ok) assert.equal(noneTry.reason, 'HUMAN_APPROVAL_REQUIRED');
    assert.equal(await prisma.juryAgentExecution.findFirst({ where: { id: 'phase51-none-exec', tenantId: TENANT } }).then((row) => row?.status), 'PENDING');

    const mismatchTry = await executeHumanAgentExecution({
      userId: owner.userId,
      memberships: [owner],
      agentExecutionId: mismatchHandoff.agentExecutionId,
      adapter: fakeCursorAdapter('success'),
    });
    assert.equal(mismatchTry.ok, false);
    if (!mismatchTry.ok) assert.equal(mismatchTry.reason, 'HUMAN_APPROVAL_REQUIRED');
    assert.equal(await prisma.juryAgentExecution.findFirst({
      where: { id: mismatchHandoff.agentExecutionId, tenantId: TENANT },
    }).then((row) => row?.status), 'PENDING');

    const blockedAdapter = fakeCursorAdapter('success');
    const blockedTry = await executeHumanAgentExecution({
      userId: owner.userId,
      memberships: [owner],
      agentExecutionId: blockedHandoff.agentExecutionId,
      adapter: blockedAdapter,
    });
    assert.equal(blockedTry.ok, true);
    if (blockedTry.ok) assert.equal(blockedTry.status, 'BLOCKED');
    assert.equal(blockedAdapter.calls.length, 0);
    assert.equal(await prisma.juryAgentExecution.findFirst({
      where: { id: blockedHandoff.agentExecutionId, tenantId: TENANT },
    }).then((row) => row?.status), 'BLOCKED');

    const runningAdapter = fakeCursorAdapter('success');
    const runningTry = await executeHumanAgentExecution({
      userId: owner.userId,
      memberships: [owner],
      agentExecutionId: runningHandoff.agentExecutionId,
      adapter: runningAdapter,
    });
    assert.equal(runningTry.ok, false);
    if (!runningTry.ok) assert.equal(runningTry.reason, 'ALREADY_RUNNING');
    assert.equal(runningAdapter.calls.length, 0);
    assert.equal(await prisma.juryAgentExecution.findFirst({
      where: { id: runningHandoff.agentExecutionId, tenantId: TENANT },
    }).then((row) => row?.status), 'RUNNING');

    const shared = fakeCursorAdapter('success');
    const [first, second] = await Promise.all([
      executeHumanAgentExecution({ userId: owner.userId, memberships: [owner], agentExecutionId: verifyHandoff.agentExecutionId, adapter: shared }),
      executeHumanAgentExecution({ userId: owner.userId, memberships: [owner], agentExecutionId: verifyHandoff.agentExecutionId, adapter: shared }),
    ]);
    assert.equal(shared.calls.length, 1);
    assert.equal(shared.calls[0]?.workspaceRoot, '');
    assert.equal(shared.calls[0]?.instruction, '');
    assert.equal(first.adapterCalled || second.adapterCalled, true);
    const stored = await prisma.juryAgentExecution.findFirst({ where: { id: verifyHandoff.agentExecutionId, tenantId: TENANT } });
    assert.equal(stored?.status, 'COMPLETED');
    assert.equal(stored?.agent, 'CURSOR');
    assert.equal(stored?.taskId, verifyTask.taskId);
    assert.ok(stored?.startedAt);
    assert.ok(stored?.finishedAt);
    const resultText = JSON.stringify(stored?.provenance);
    assert.equal(resultText.includes(FAKE_SUMMARY), true);
    assert.equal(resultText.includes('workspace/mock-aisle/user-facing-copy.ts'), true);
    for (const word of ['credentialref', 'password', 'secret', 'cookie', 'api_key', 'access_token', 'token']) {
      assert.equal(resultText.toLowerCase().includes(word), false, word);
    }
    const replay = fakeCursorAdapter('success');
    const again = await executeHumanAgentExecution({
      userId: owner.userId,
      memberships: [owner],
      agentExecutionId: verifyHandoff.agentExecutionId,
      adapter: replay,
    });
    assert.equal(again.ok, true);
    if (again.ok) {
      assert.equal(again.adapterCalled, false);
      assert.equal(again.status, 'COMPLETED');
      assert.equal(again.result?.summary, FAKE_SUMMARY);
      assert.equal(again.result?.testsPassed, null);
    }
    assert.equal(replay.calls.length, 0);
    const after = await prisma.juryAgentExecution.findFirst({ where: { id: verifyHandoff.agentExecutionId, tenantId: TENANT } });
    assert.equal(after?.finishedAt?.toISOString(), stored?.finishedAt?.toISOString());
    assert.equal(await prisma.juryAuditEvent.count({
      where: { tenantId: TENANT, agentExecutionId: verifyHandoff.agentExecutionId, action: 'AGENT_EXECUTION_STARTED' },
    }), 1);
    assert.equal(await prisma.juryAuditEvent.count({
      where: { tenantId: TENANT, agentExecutionId: verifyHandoff.agentExecutionId, action: 'AGENT_EXECUTION_COMPLETED' },
    }), 1);
    const audit = await prisma.juryAuditEvent.findFirst({
      where: { tenantId: TENANT, agentExecutionId: verifyHandoff.agentExecutionId, action: 'AGENT_EXECUTION_COMPLETED' },
    });
    const auditText = JSON.stringify(audit?.provenance).toLowerCase();
    assert.equal(auditText.includes('credential'), false);
    assert.equal(auditText.includes(FAKE_SUMMARY.toLowerCase()), false);

    const rewordRun = await executeHumanAgentExecution({
      userId: owner.userId,
      memberships: [owner],
      agentExecutionId: rewordHandoff.ok ? rewordHandoff.agentExecutionId : '',
    });
    assert.equal(rewordRun.ok, true);
    if (rewordRun.ok) {
      assert.equal(rewordRun.status, 'COMPLETED');
      assert.equal(rewordRun.adapterCalled, true);
      assert.deepEqual(rewordRun.result?.changedFiles, ['workspace/mock-aisle/user-facing-copy.ts']);
    }

    const shown = await loadReviewConsole(ownerActor, 'phase51-verify');
    assert.equal(shown.ok, true);
    if (shown.ok) {
      assert.equal(shown.screen.agentExecution?.status, 'COMPLETED');
      assert.equal(shown.screen.agentExecution?.agent, 'CURSOR');
      assert.equal(shown.screen.canRun, false);
      assert.equal(shown.screen.agentExecution?.summary, FAKE_SUMMARY);
      assert.equal(shown.screen.measured.find((row) => row.metric === 'newUsersLast7d')?.value, 0);
      assert.equal(shown.screen.measured.find((row) => row.metric === 'postsLast7d')?.value, null);
    }
    const zero = await prisma.juryNormalizedMetric.findFirst({ where: { id: 'phase51-zero', tenantId: TENANT } });
    const absent = await prisma.juryNormalizedMetric.findFirst({ where: { id: 'phase51-null', tenantId: TENANT } });
    assert.equal(zero?.value, 0);
    assert.equal(absent?.value, null);
    assert.equal(await prisma.juryReviewResult.findFirst({
      where: { id: 'phase51-verify', tenantId: TENANT },
      select: { expectedDecision: true },
    }).then((row) => row?.expectedDecision), 'VERIFY');
    assert.equal(await prisma.juryChangeGateResult.count({ where: { tenantId: TENANT } }), 0);
    assert.equal(await prisma.juryReReviewResult.count({ where: { tenantId: TENANT } }), 0);
    assert.equal(await prisma.juryDecisionCycle.count({ where: { tenantId: TENANT } }), 0);
    assert.equal(await prisma.juryAutoLoopActivation.count({ where: { tenantId: TENANT } }), 0);
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

test('human agent execution stays on the fake adapter', () => {
  const source = readFileSync(path.resolve(process.cwd(), 'src/lib/jury-product/human-agent-execution.ts'), 'utf8');
  for (const token of [
    'buildEvidencePackFromDb',
    'attachGa4Evidence',
    'runAisleAdapter',
    'GA4_PROPERTY_ID',
    'GA4_SERVICE_ACCOUNT',
    'findUnique',
    'child_process',
    'executeAgent',
    'resolveAllowedWorkspace',
    'writeFile',
    'FULL_AUTO',
    'TASK_ONLY',
  ]) {
    assert.equal(source.includes(token), false, token);
  }
  assert.equal(source.includes('fakeCursorAdapter'), true);
  assert.equal(source.includes("action: 'agent.execute'"), true);
  assert.equal(source.includes('input.agentExecutionId'), true);
  const actions = readFileSync(path.resolve(process.cwd(), 'src/app/(root)/jury/actions.ts'), 'utf8');
  const fn = actions.slice(actions.indexOf('export async function runHumanAgentExecution'), actions.indexOf('async function tenantReviewCore'));
  assert.equal(fn.includes("formData.get('agentExecutionId')"), true);
  for (const key of ['tenantId', 'provider', 'workspace', 'taskId', 'humanDecision', 'prompt']) {
    assert.equal(fn.includes(`formData.get('${key}')`), false, key);
  }
  const ui = readFileSync(path.resolve(process.cwd(), 'src/app/(root)/jury/ui.tsx'), 'utf8');
  const body = ui.slice(ui.indexOf('export function ReviewDetailBody'), ui.indexOf('const INTAKE_AVAILABILITY'));
  assert.equal(body.includes('Start Agent Execution'), true);
  assert.equal(body.includes('Running'), true);
  assert.equal(body.includes('Completed'), true);
  assert.equal(body.includes('Blocked'), true);
  for (const label of ['Approve Change', 'Apply Change', 'Change Gate', 'Re-review', 'Auto Fix', 'Run Loop', 'Retry Loop']) {
    assert.equal(body.includes(label), false, label);
  }
});

async function note(actor: JuryMembership, reviewId: string, action: JuryDecision) {
  const saved = await noteHumanNextAction({ userId: actor.userId, memberships: [actor], reviewId, action });
  assert.equal(saved.ok, true);
}

async function pendingExecution(
  prisma: Awaited<typeof import('@/lib/prisma')>['prisma'],
  id: string,
  taskId: string,
  tenantId = TENANT,
) {
  await prisma.juryAgentExecution.create({
    data: {
      id,
      tenantId,
      taskId,
      agent: 'CURSOR',
      allowedPaths: [],
      deniedPaths: [],
      status: 'PENDING',
      inputSnapshot: { kind: 'human-agent-handoff', improvementTaskId: taskId },
      workspaceRef: { type: 'PROJECT', ref: 'jury-product' },
      provenance: { kind: 'human-agent-handoff', improvementTaskId: taskId },
      requestedAt: new Date(NOW),
      createdAt: new Date(NOW),
      updatedAt: new Date(NOW),
    },
  });
}

function face(): JuryFinalSurface {
  return {
    statusSummary: 'steady',
    topProblems: ['gap'],
    expectedUserEffect: 'effect',
    risk: 'risk',
    dimensionEvidence: ['measured sentence'],
    supportedClaims: ['supported'],
    partiallySupportedClaims: ['partial'],
    hypotheses: ['hypothesis'],
  };
}

function membership(id: string, tenantId: string, userId: string, role: JuryMembership['role']): JuryMembership {
  return { id, tenantId, userId, role, createdAt: NOW };
}

function taskRow(id: string, reviewResultId: string, taskType: 'VERIFICATION' | 'REWORD', provenance: Prisma.InputJsonValue) {
  return {
    id,
    tenantId: TENANT,
    reviewResultId,
    diagnosis: 'steady',
    acceptanceCriteria: ['gap'],
    status: 'OPEN' as const,
    loopIndex: 0,
    loopPolicy: { maxIterations: null, maxRuntimeMs: null, maxCostUsd: null },
    taskType,
    provenance,
    createdAt: new Date(NOW),
    updatedAt: new Date(NOW),
  };
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
  }
  await prisma.juryTenant.create({ data: { id: TENANT, name: TENANT } });
  await prisma.juryTenant.create({ data: { id: FOREIGN, name: FOREIGN } });
  for (const actor of [owner, member, auditor, foreign]) {
    await prisma.juryMembership.create({
      data: { id: actor.id, tenantId: actor.tenantId, userId: actor.userId, role: actor.role, createdAt: new Date(NOW) },
    });
  }
  await connection(prisma, CONN, TENANT);
  await connection(prisma, FOREIGN_CONN, FOREIGN);
  await evidenceRow(prisma, EVIDENCE, TENANT, CONN, ['phase51-zero', 'phase51-null']);
  await evidenceRow(prisma, 'phase51-foreign-evidence', FOREIGN, FOREIGN_CONN, []);
  await prisma.juryNormalizedMetric.create({ data: metric('phase51-zero', 'newUsersLast7d', 0, 'AVAILABLE') });
  await prisma.juryNormalizedMetric.create({ data: metric('phase51-null', 'postsLast7d', null, 'NOT_MEASURED') });
  await review(prisma, 'phase51-verify', 'phase51-verify-req', TENANT, CONN, EVIDENCE, 'VERIFY');
  await review(prisma, 'phase51-reword', 'phase51-reword-req', TENANT, CONN, EVIDENCE, 'REWORD');
  await review(prisma, 'phase51-accept', 'phase51-accept-req', TENANT, CONN, EVIDENCE, 'VERIFY');
  await review(prisma, 'phase51-none', 'phase51-none-req', TENANT, CONN, EVIDENCE, 'VERIFY');
  await review(prisma, 'phase51-mismatch', 'phase51-mismatch-req', TENANT, CONN, EVIDENCE, 'VERIFY');
  await review(prisma, 'phase51-running', 'phase51-running-req', TENANT, CONN, EVIDENCE, 'VERIFY');
  await review(prisma, 'phase51-blocked', 'phase51-blocked-req', TENANT, CONN, EVIDENCE, 'REWORD');
  await review(prisma, 'phase51-foreign-review', 'phase51-foreign-req', FOREIGN, FOREIGN_CONN, 'phase51-foreign-evidence', 'VERIFY');
  await prisma.juryImprovementTask.create({
    data: { ...taskRow('phase51-foreign-task', 'phase51-foreign-review', 'VERIFICATION', { kind: 'human-decision-improvement' }), tenantId: FOREIGN },
  });
}

function metric(id: string, name: string, value: number | null, availability: 'AVAILABLE' | 'NOT_MEASURED') {
  return {
    id,
    tenantId: TENANT,
    connectionId: CONN,
    evidenceId: EVIDENCE,
    metric: name,
    value,
    unit: 'COUNT' as const,
    periodStart: '2026-09-25',
    periodEnd: '2026-10-01',
    timezone: 'Asia/Seoul',
    sourceSystem: 'OTHER' as const,
    sourceRef: 'console-declared',
    collectedAt: new Date(NOW),
    availability,
    rawPayloadRef: 'tenant-declared:console-declared',
    adapterKey: 'console-declared',
    adapterVersion: 'v1',
    ruleId: 'normalize.tenant-declared.v1',
  };
}

async function connection(prisma: Awaited<typeof import('@/lib/prisma')>['prisma'], id: string, tenantId: string) {
  await prisma.juryServiceConnection.create({
    data: {
      id,
      tenantId,
      serviceKey: 'phase51',
      displayName: 'Phase 51',
      accessMethod: 'FILE_UPLOAD',
      status: 'DISCOVERY_PENDING',
      credentialRef: null,
    },
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
      id,
      tenantId,
      connectionId,
      purpose: 'tenant-declared-observation',
      periodStart: '2026-09-25',
      periodEnd: '2026-10-01',
      timezone: 'Asia/Seoul',
      metricIds,
      adapterKey: 'console-declared',
      collectedAt: new Date(NOW),
      piiExcluded: true,
      readOnly: true,
    },
  });
}

async function review(
  prisma: Awaited<typeof import('@/lib/prisma')>['prisma'],
  id: string,
  requestId: string,
  tenantId: string,
  connectionId: string,
  evidenceId: string,
  decision: JuryDecision,
) {
  await prisma.juryReviewRequest.create({
    data: {
      id: requestId,
      tenantId,
      connectionId,
      evidenceId,
      reviewType: 'FULL_REVIEW',
      mode: 'EXTERNAL_SERVICE',
      status: 'COMPLETED',
      coreRootDir: 'data/jury-product',
    },
  });
  await prisma.juryReviewResult.create({
    data: {
      id,
      tenantId,
      reviewRequestId: requestId,
      boardRunId: 'phase51-board',
      evidenceStrength: 'strong',
      claimStrength: 'weak',
      conflictDetected: decision === 'VERIFY',
      overclaimDetected: decision === 'REWORD',
      revisionRequired: decision === 'REWORD',
      expectedDecision: decision,
      finalSurface: face(),
      contractVersion: JURY_CORE_CONTRACT_VERSION,
      completedAt: new Date(NOW),
    },
  });
}

async function liveSnapshot(prisma: Awaited<typeof import('@/lib/prisma')>['prisma']) {
  const reviewRow = await prisma.juryReviewResult.findUnique({
    where: { id: LIVE_REVIEW },
    select: { expectedDecision: true, tenantId: true, completedAt: true },
  });
  const cycle = await prisma.juryDecisionCycle.findUnique({
    where: { id: LIVE_CYCLE },
    select: { status: true, iteration: true, updatedAt: true },
  });
  const tenantId = reviewRow?.tenantId ?? 'missing';
  return {
    decision: reviewRow?.expectedDecision ?? null,
    reviewCompletedAt: reviewRow?.completedAt.toISOString() ?? null,
    status: cycle?.status ?? null,
    iteration: cycle?.iteration ?? null,
    cycleUpdatedAt: cycle?.updatedAt.toISOString() ?? null,
    activations: await prisma.juryAutoLoopActivation.count({ where: { tenantId } }),
    executions: await prisma.juryAgentExecution.count({ where: { tenantId } }),
    gates: await prisma.juryChangeGateResult.count({ where: { tenantId } }),
    reviews: await prisma.juryReviewResult.count({ where: { tenantId } }),
    reReviews: await prisma.juryReReviewResult.count({ where: { tenantId } }),
    tasks: await prisma.juryImprovementTask.count({ where: { tenantId } }),
  };
}

async function removeFixture(prisma: Awaited<typeof import('@/lib/prisma')>['prisma']): Promise<void> {
  const where = { tenantId: { in: [TENANT, FOREIGN] } };
  await prisma.juryAgentExecution.deleteMany({ where });
  await prisma.juryImprovementTask.deleteMany({ where });
  await prisma.juryHumanDecision.deleteMany({ where });
  await prisma.juryReviewResult.deleteMany({ where });
  await prisma.juryReviewRequest.deleteMany({ where });
  await prisma.juryNormalizedMetric.deleteMany({ where });
  await prisma.juryEvidence.deleteMany({ where });
  await prisma.juryAuditEvent.deleteMany({ where });
  await prisma.juryServiceConnection.deleteMany({ where });
  await prisma.juryMembership.deleteMany({ where });
  await prisma.juryTenant.deleteMany({ where: { id: { in: [TENANT, FOREIGN] } } });
  await prisma.user.deleteMany({
    where: { username: { in: ['phase51-owner', 'phase51-member', 'phase51-auditor', 'phase51-foreign'] } },
  });
}
