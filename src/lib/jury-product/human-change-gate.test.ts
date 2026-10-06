import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import type { JuryActor } from './access';
import { evaluateHumanChangeGate } from './human-change-gate';
import { executeHumanAgentExecution } from './human-agent-execution';
import { persistHumanAgentHandoff } from './human-agent-handoff';
import { persistHumanImprovement } from './human-improvement-bridge';
import { loadReviewConsole, noteHumanNextAction, projectReviewConsole } from './review-console';
import { JURY_CORE_CONTRACT_VERSION, type JuryDecision, type JuryFinalSurface, type JuryMembership } from './records';

const TENANT = 'phase52-gate';
const FOREIGN = 'phase52-foreign';
const CONN = 'phase52-conn';
const FOREIGN_CONN = 'phase52-foreign-conn';
const EVIDENCE = 'phase52-evidence';
const NOW = '2026-10-02T12:20:00.000Z';
const LIVE_REVIEW = '3707202563ecae9b38f324a4eefd9243a14bc69420ed6cdda16c4c5794f62e0d';
const LIVE_CYCLE = '14308b4c999ccbe8ca54b7f31da5385385d4073c49bbf2955582a6bb96afb01e';
const COPY = 'workspace/mock-aisle/user-facing-copy.ts';
const SECRET = 'example-secret-value';

const owner = membership('phase52-owner-m', TENANT, 'phase52-owner', 'OWNER');
const member = membership('phase52-member-m', TENANT, 'phase52-member', 'MEMBER');
const auditor = membership('phase52-auditor-m', TENANT, 'phase52-auditor', 'AUDITOR');
const foreign = membership('phase52-foreign-m', FOREIGN, 'phase52-foreign', 'OWNER');
const ownerActor: JuryActor = { ok: true, userId: owner.userId, tenantId: TENANT, role: 'OWNER', membershipId: owner.id };
const auditorActor: JuryActor = { ok: true, userId: auditor.userId, tenantId: TENANT, role: 'AUDITOR', membershipId: auditor.id };

test('change gate control follows a completed owner execution', () => {
  const surface = face();
  const base = {
    actor: ownerActor,
    result: { id: 'verify', tenantId: TENANT, expectedDecision: 'VERIFY' as const, finalSurface: surface, completedAt: NOW },
    status: 'COMPLETED' as const,
    evidenceId: EVIDENCE,
    metrics: [],
    humanDecision: 'VERIFY' as const,
    improvementTask: { id: 'task', taskType: 'VERIFICATION' as const },
  };
  const ready = projectReviewConsole({
    ...base,
    agentExecution: { id: 'exec', status: 'COMPLETED', agent: 'CURSOR' },
  });
  assert.equal(ready.ok, true);
  if (ready.ok) {
    assert.equal(ready.screen.canRunChangeGate, true);
    assert.equal(ready.screen.changeGate, null);
  }
  const pending = projectReviewConsole({
    ...base,
    agentExecution: { id: 'exec', status: 'PENDING', agent: 'CURSOR' },
  });
  assert.equal(pending.ok, true);
  if (pending.ok) assert.equal(pending.screen.canRunChangeGate, false);
  const reader = projectReviewConsole({
    ...base,
    actor: auditorActor,
    agentExecution: { id: 'exec', status: 'COMPLETED', agent: 'CURSOR' },
  });
  assert.equal(reader.ok, true);
  if (reader.ok) assert.equal(reader.screen.canRunChangeGate, false);
  const gated = projectReviewConsole({
    ...base,
    agentExecution: { id: 'exec', status: 'COMPLETED', agent: 'CURSOR' },
    changeGate: { id: 'gate', status: 'GATED', errorCode: null, discrepancy: true, reasons: ['AGENT_REPORTED_FILE_NOT_FOUND_IN_WORKSPACE'] },
  });
  assert.equal(gated.ok, true);
  if (gated.ok) {
    assert.equal(gated.screen.canRunChangeGate, false);
    assert.equal(gated.screen.changeGate?.status, 'GATED');
  }
});

test('completed human execution reaches one change gate', { timeout: 180_000 }, async () => {
  loadEnv();
  const { prisma } = await import('@/lib/prisma');
  const liveBefore = await liveSnapshot(prisma);
  let cleanupError: string | null = null;
  try {
    await removeFixture(prisma);
    await seed(prisma);
    const verify = await finished(prisma, 'phase52-verify', 'VERIFY');
    const reword = await finished(prisma, 'phase52-reword', 'REWORD');
    const pending = await planted(prisma, 'phase52-pending', 'VERIFY', { workspace: 'mock-aisle', files: [COPY], testsPassed: null, allowedPaths: [COPY], status: 'PENDING' });
    const running = await planted(prisma, 'phase52-running', 'VERIFY', { workspace: 'mock-aisle', files: [COPY], testsPassed: null, allowedPaths: [COPY], status: 'RUNNING' });
    const blocked = await planted(prisma, 'phase52-blocked', 'REWORD', { workspace: 'mock-aisle', files: [COPY], testsPassed: null, allowedPaths: [COPY], status: 'BLOCKED' });
    const missing = await planted(prisma, 'phase52-missing', 'VERIFY', { workspace: 'mock-aisle', files: [COPY], testsPassed: false, allowedPaths: [COPY] });
    const escape = await planted(prisma, 'phase52-escape', 'VERIFY', { workspace: 'mock-aisle', files: ['../outside.ts'], testsPassed: null, allowedPaths: [] });
    const scope = await planted(prisma, 'phase52-scope', 'VERIFY', {
      workspace: 'mock-aisle',
      files: [COPY],
      testsPassed: null,
      allowedPaths: ['workspace/mock-aisle/other.ts'],
    });
    const secret = await planted(prisma, 'phase52-secret', 'VERIFY', {
      workspace: 'mock-aisle',
      files: [COPY],
      testsPassed: null,
      allowedPaths: [COPY],
      summary: `password=${SECRET}`,
    });
    const schema = await planted(prisma, 'phase52-schema', 'VERIFY', { workspace: 'mock-aisle', files: ['prisma/schema.prisma'], testsPassed: null, allowedPaths: [] });
    const migration = await planted(prisma, 'phase52-migration', 'VERIFY', { workspace: 'mock-aisle', files: ['prisma/migrations/001.sql'], testsPassed: null, allowedPaths: [] });
    const auth = await planted(prisma, 'phase52-auth', 'VERIFY', { workspace: 'mock-aisle', files: ['auth.ts'], testsPassed: null, allowedPaths: [] });
    const deploy = await planted(prisma, 'phase52-deploy', 'VERIFY', { workspace: 'mock-aisle', files: ['vercel.json'], testsPassed: null, allowedPaths: [] });
    const concurrent = await planted(prisma, 'phase52-concurrent', 'VERIFY', { workspace: 'mock-aisle', files: [COPY], testsPassed: null, allowedPaths: [COPY] });
    const mismatch = await planted(prisma, 'phase52-mismatch', 'VERIFY', { workspace: 'mock-aisle', files: [COPY], testsPassed: null, allowedPaths: [COPY] });
    await note(owner, 'phase52-accept', 'ACCEPT');
    const foreignRun = await plantedForeign(prisma);

    await prisma.juryImprovementTask.updateMany({
      where: { id: mismatch.taskId, tenantId: TENANT },
      data: { provenance: { kind: 'human-decision-improvement', humanDecisionId: 'other', reviewRequestId: 'phase52-mismatch-req', reviewResultId: 'phase52-mismatch' } },
    });
    const acceptHuman = await prisma.juryHumanDecision.findFirst({
      where: { tenantId: TENANT, reviewResultId: 'phase52-accept' },
    });
    assert.ok(acceptHuman);
    await prisma.juryImprovementTask.create({
      data: taskRow('phase52-accept-task', 'phase52-accept', 'VERIFICATION', {
        kind: 'human-decision-improvement',
        humanDecisionId: acceptHuman?.id ?? '',
        reviewRequestId: 'phase52-accept-req',
        reviewResultId: 'phase52-accept',
      }),
    });
    await executionRow(prisma, 'phase52-accept-exec', 'phase52-accept-task');
    await prisma.juryImprovementTask.create({
      data: taskRow('phase52-none-task', 'phase52-none', 'VERIFICATION', {
        kind: 'human-decision-improvement',
        humanDecisionId: 'missing-human',
        reviewRequestId: 'phase52-none-req',
        reviewResultId: 'phase52-none',
      }),
    });
    await executionRow(prisma, 'phase52-none-exec', 'phase52-none-task');

    const before = await loadReviewConsole(ownerActor, 'phase52-verify');
    assert.equal(before.ok, true);
    if (before.ok) {
      assert.equal(before.screen.agentExecution?.status, 'COMPLETED');
      assert.equal(before.screen.canRunChangeGate, true);
      assert.equal(before.screen.changeGate, null);
    }
    const auditorView = await loadReviewConsole(auditorActor, 'phase52-verify');
    assert.equal(auditorView.ok, true);
    if (auditorView.ok) assert.equal(auditorView.screen.canRunChangeGate, false);

    const first = await gate(verify.executionId);
    assert.equal(first.ok, true);
    if (first.ok) {
      assert.equal(first.created, true);
      assert.equal(first.gate.status, 'BLOCKED');
      assert.equal(first.gate.errorCode, 'WORKSPACE_NOT_ALLOWED');
      assert.equal(first.gate.discrepancy, true);
    }
    const storedGate = await prisma.juryChangeGateResult.findFirst({
      where: { executionId: verify.executionId, tenantId: TENANT },
    });
    const storedText = JSON.stringify(storedGate);
    assert.equal(storedText.includes(verify.executionId), true);
    assert.equal(storedText.includes(verify.taskId), true);
    assert.equal(storedText.includes('phase52-verify'), true);
    assert.equal(storedText.includes('phase52-verify-req'), true);
    const verifyHuman = await prisma.juryHumanDecision.findFirst({ where: { tenantId: TENANT, reviewResultId: 'phase52-verify' } });
    assert.equal(storedText.includes(verifyHuman?.id ?? 'missing-human'), true);
    assert.equal(storedGate?.credentialDetected, false);

    const replay = await gate(verify.executionId);
    assert.equal(replay.ok, true);
    if (replay.ok) assert.equal(replay.created, false);
    assert.equal(await prisma.juryChangeGateResult.count({ where: { executionId: verify.executionId, tenantId: TENANT } }), 1);
    assert.equal(await prisma.juryAuditEvent.count({
      where: { tenantId: TENANT, agentExecutionId: verify.executionId, action: { in: ['CHANGE_GATE_STARTED', 'CHANGE_GATE_COMPLETED', 'CHANGE_GATE_BLOCKED'] } },
    }), 2);

    const rewordGate = await gate(reword.executionId);
    assert.equal(rewordGate.ok, true);
    if (rewordGate.ok) assert.equal(rewordGate.gate.status === 'APPROVED', false);

    for (const id of [pending.executionId, running.executionId, blocked.executionId]) {
      const refused = await gate(id);
      assert.equal(refused.ok, false);
      if (!refused.ok) assert.equal(refused.reason, 'EXECUTION_NOT_COMPLETED');
      assert.equal(await prisma.juryChangeGateResult.count({ where: { executionId: id, tenantId: TENANT } }), 0);
    }
    const acceptGate = await gate('phase52-accept-exec');
    assert.equal(acceptGate.ok, false);
    if (!acceptGate.ok) assert.equal(acceptGate.reason, 'HUMAN_APPROVAL_REQUIRED');
    const noneGate = await gate('phase52-none-exec');
    assert.equal(noneGate.ok, false);
    if (!noneGate.ok) assert.equal(noneGate.reason, 'HUMAN_APPROVAL_REQUIRED');
    const mismatchGate = await gate(mismatch.executionId);
    assert.equal(mismatchGate.ok, false);
    if (!mismatchGate.ok) assert.equal(mismatchGate.reason, 'HUMAN_APPROVAL_REQUIRED');
    assert.equal(await prisma.juryChangeGateResult.count({ where: { executionId: mismatch.executionId, tenantId: TENANT } }), 0);

    const cross = await gate(foreignRun.executionId);
    assert.equal(cross.ok, false);
    if (!cross.ok) assert.equal(cross.reason, 'NOT_FOUND');
    const crossBack = await evaluateHumanChangeGate({
      userId: foreign.userId,
      memberships: [foreign],
      agentExecutionId: verify.executionId,
    });
    assert.equal(crossBack.ok, false);
    if (!crossBack.ok) assert.equal(crossBack.reason, 'NOT_FOUND');
    assert.equal(await prisma.juryChangeGateResult.count({ where: { tenantId: FOREIGN } }), 0);

    const auditorTry = await gate(verify.executionId, auditor);
    const memberTry = await gate(missing.executionId, member);
    assert.equal(auditorTry.ok, false);
    assert.equal(memberTry.ok, false);
    if (!auditorTry.ok) assert.equal(auditorTry.reason, 'FORBIDDEN');
    if (!memberTry.ok) assert.equal(memberTry.reason, 'FORBIDDEN');

    const missingGate = await gate(missing.executionId);
    assert.equal(missingGate.ok, true);
    if (missingGate.ok) {
      assert.equal(missingGate.gate.status, 'GATED');
      assert.equal(missingGate.gate.errorCode, null);
      assert.equal(missingGate.gate.discrepancy, true);
      assert.equal(missingGate.gate.testsPassed, false);
      assert.equal(missingGate.gate.reasons.includes('AGENT_REPORTED_FILE_NOT_FOUND_IN_WORKSPACE'), true);
      assert.equal(missingGate.gate.reasons.includes('PATH_ESCAPE'), false);
      assert.equal(missingGate.gate.reasons.includes('SCOPE_EXCEEDED'), false);
      assert.equal(missingGate.gate.reasons.includes('TEST_FAILURE'), false);
    }
    const escapeGate = await gate(escape.executionId);
    assert.equal(escapeGate.ok, true);
    if (escapeGate.ok) {
      assert.equal(escapeGate.gate.status, 'BLOCKED');
      assert.equal(escapeGate.gate.errorCode, 'PATH_ESCAPE');
    }
    const scopeGate = await gate(scope.executionId);
    assert.equal(scopeGate.ok, true);
    if (scopeGate.ok) {
      assert.equal(scopeGate.gate.status, 'BLOCKED');
      assert.equal(scopeGate.gate.errorCode, 'SCOPE_EXCEEDED');
    }
    const secretGate = await gate(secret.executionId);
    assert.equal(secretGate.ok, true);
    if (secretGate.ok) {
      assert.equal(secretGate.gate.status, 'BLOCKED');
      assert.equal(secretGate.gate.errorCode, 'CREDENTIAL_DETECTED');
      assert.equal(secretGate.gate.credentialDetected, true);
    }
    const secretRow = await prisma.juryChangeGateResult.findFirst({
      where: { executionId: secret.executionId, tenantId: TENANT },
    });
    const secretText = JSON.stringify(secretRow);
    assert.equal(secretText.includes(SECRET), false);
    assert.equal(secretText.toLowerCase().includes('password'), false);
    const schemaGate = await gate(schema.executionId);
    assert.equal(schemaGate.ok, true);
    if (schemaGate.ok) {
      assert.equal(schemaGate.gate.status, 'BLOCKED');
      assert.equal(schemaGate.gate.errorCode, 'FORBIDDEN_SCHEMA');
    }
    const migrationGate = await gate(migration.executionId);
    assert.equal(migrationGate.ok, true);
    if (migrationGate.ok) {
      assert.equal(migrationGate.gate.status, 'BLOCKED');
      assert.equal(migrationGate.gate.errorCode, 'FORBIDDEN_MIGRATION');
    }
    const authGate = await gate(auth.executionId);
    assert.equal(authGate.ok, true);
    if (authGate.ok) {
      assert.equal(authGate.gate.status, 'BLOCKED');
      assert.equal(authGate.gate.errorCode, 'FORBIDDEN_SECURITY_CONFIG');
    }
    const deployGate = await gate(deploy.executionId);
    assert.equal(deployGate.ok, true);
    if (deployGate.ok) {
      assert.equal(deployGate.gate.status, 'BLOCKED');
      assert.equal(deployGate.gate.errorCode, 'FORBIDDEN_DEPLOYMENT');
    }

    const [left, right] = await Promise.all([gate(concurrent.executionId), gate(concurrent.executionId)]);
    assert.equal(left.ok && right.ok, true);
    assert.equal(await prisma.juryChangeGateResult.count({ where: { executionId: concurrent.executionId, tenantId: TENANT } }), 1);
    if (left.ok && right.ok) assert.equal(left.created !== right.created, true);

    const shown = await loadReviewConsole(ownerActor, 'phase52-missing');
    assert.equal(shown.ok, true);
    if (shown.ok) {
      assert.equal(shown.screen.changeGate?.status, 'GATED');
      assert.equal(shown.screen.canRunChangeGate, false);
      assert.equal(shown.screen.agentExecution?.summary?.includes(SECRET), false);
    }
    const hidden = await loadReviewConsole(ownerActor, 'phase52-secret');
    assert.equal(hidden.ok, true);
    if (hidden.ok) {
      assert.equal(hidden.screen.agentExecution?.summary, null);
      assert.equal(JSON.stringify(hidden.screen).includes(SECRET), false);
    }

    const zero = await prisma.juryNormalizedMetric.findFirst({ where: { id: 'phase52-zero', tenantId: TENANT } });
    const absent = await prisma.juryNormalizedMetric.findFirst({ where: { id: 'phase52-null', tenantId: TENANT } });
    assert.equal(zero?.value, 0);
    assert.equal(absent?.value, null);
    assert.equal(await prisma.juryEvidence.count({ where: { tenantId: TENANT } }), 1);
    assert.equal(await prisma.juryReviewResult.findFirst({
      where: { id: 'phase52-verify', tenantId: TENANT },
      select: { expectedDecision: true },
    }).then((row) => row?.expectedDecision), 'VERIFY');
    assert.equal(await prisma.juryReReviewResult.count({ where: { tenantId: { in: [TENANT, FOREIGN] } } }), 0);
    assert.equal(await prisma.juryDecisionCycle.count({ where: { tenantId: { in: [TENANT, FOREIGN] } } }), 0);
    assert.equal(await prisma.juryAutoLoopActivation.count({ where: { tenantId: { in: [TENANT, FOREIGN] } } }), 0);
    assert.equal(await prisma.juryChangeGateReview.count({ where: { tenantId: { in: [TENANT, FOREIGN] } } }), 0);
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

test('human change gate reuses the existing evaluator', () => {
  const source = readFileSync(path.resolve(process.cwd(), 'src/lib/jury-product/human-change-gate.ts'), 'utf8');
  for (const token of [
    'buildEvidencePackFromDb',
    'attachGa4Evidence',
    'runAisleAdapter',
    'GA4_PROPERTY_ID',
    'GA4_SERVICE_ACCOUNT',
    'findUnique',
    'child_process',
    'inspectAllowlistedWorkspace',
    'writeFile',
    'spawn',
    'JuryReReview',
    'recordDecisionCycle',
    'persistImprovementAutoLoop',
    'FULL_AUTO',
  ]) {
    assert.equal(source.includes(token), false, token);
  }
  assert.equal(source.includes('evaluateChangeGate'), true);
  assert.equal(source.includes('evaluateImprovementChangeScope'), true);
  assert.equal(source.includes("action: 'agent.execute'"), true);
  assert.equal(source.includes('input.agentExecutionId'), true);
  assert.equal(source.includes('inspection: { files: [], present: [] }'), true);
  const actions = readFileSync(path.resolve(process.cwd(), 'src/app/(root)/jury/actions.ts'), 'utf8');
  const fn = actions.slice(actions.indexOf('export async function runHumanChangeGate'), actions.indexOf('async function tenantReviewCore'));
  assert.equal(fn.includes("formData.get('agentExecutionId')"), true);
  for (const key of ['tenantId', 'provider', 'workspace', 'taskId', 'humanDecision', 'prompt', 'changedFiles', 'gatePolicy']) {
    assert.equal(fn.includes(`formData.get('${key}')`), false, key);
  }
  const ui = readFileSync(path.resolve(process.cwd(), 'src/app/(root)/jury/ui.tsx'), 'utf8');
  const body = ui.slice(ui.indexOf('export function ReviewDetailBody'), ui.indexOf('const INTAKE_AVAILABILITY'));
  assert.equal(body.includes('Change Gate'), false);
  const gateBody = ui.slice(ui.indexOf('export function HumanChangeGateBody'), ui.indexOf('export function EvidenceBody'));
  assert.equal(gateBody.includes('Run Change Gate'), true);
  assert.equal(gateBody.includes('Change Gate:'), true);
  for (const label of ['Re-review', 'Run Jury', 'Auto Fix', 'Retry Loop', 'Apply Change', 'Deploy']) {
    assert.equal(gateBody.includes(label), false, label);
  }
});

async function gate(agentExecutionId: string, actor: JuryMembership = owner) {
  return evaluateHumanChangeGate({ userId: actor.userId, memberships: [actor], agentExecutionId });
}

async function note(actor: JuryMembership, reviewId: string, action: JuryDecision) {
  const saved = await noteHumanNextAction({ userId: actor.userId, memberships: [actor], reviewId, action });
  assert.equal(saved.ok, true);
}

async function finished(
  prisma: Awaited<typeof import('@/lib/prisma')>['prisma'],
  reviewId: string,
  action: JuryDecision,
) {
  await note(owner, reviewId, action);
  const task = await persistHumanImprovement({ userId: owner.userId, memberships: [owner], reviewId });
  assert.equal(task.ok, true);
  if (!task.ok || !task.taskId) throw new Error('task');
  const handoff = await persistHumanAgentHandoff({ userId: owner.userId, memberships: [owner], improvementTaskId: task.taskId });
  assert.equal(handoff.ok, true);
  if (!handoff.ok) throw new Error('handoff');
  const run = await executeHumanAgentExecution({
    userId: owner.userId,
    memberships: [owner],
    agentExecutionId: handoff.agentExecutionId,
  });
  assert.equal(run.ok, true);
  if (run.ok) assert.equal(run.status, 'COMPLETED');
  return { reviewId, taskId: task.taskId, executionId: handoff.agentExecutionId };
}

async function planted(
  prisma: Awaited<typeof import('@/lib/prisma')>['prisma'],
  reviewId: string,
  action: JuryDecision,
  patch: { workspace: string; files: string[]; testsPassed: boolean | null; allowedPaths: string[]; summary?: string; status?: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'BLOCKED' },
) {
  await prisma.juryHumanDecision.create({
    data: {
      id: `${reviewId}-human`,
      tenantId: TENANT,
      reviewResultId: reviewId,
      reviewRequestId: `${reviewId}-req`,
      decision: action,
      actorUserId: owner.userId,
      createdAt: new Date(NOW),
    },
  });
  const humanId = `${reviewId}-human`;
  const taskType = action === 'REWORD' ? 'REWORD' : 'VERIFICATION';
  const taskId = `${reviewId}-task`;
  const executionId = `${reviewId}-exec`;
  await prisma.juryImprovementTask.create({
    data: taskRow(taskId, reviewId, taskType, {
      kind: 'human-decision-improvement',
      humanDecisionId: humanId,
      reviewRequestId: `${reviewId}-req`,
      reviewResultId: reviewId,
    }),
  });
  await prisma.juryAgentExecution.create({
    data: {
      id: executionId,
      tenantId: TENANT,
      taskId,
      agent: 'CURSOR',
      allowedPaths: patch.allowedPaths,
      deniedPaths: [],
      status: patch.status ?? 'COMPLETED',
      workspaceRef: { type: 'PROJECT', ref: patch.workspace },
      provenance: {
        kind: 'human-agent-execution',
        reviewRequestId: `${reviewId}-req`,
        reviewResultId: reviewId,
        humanDecisionId: humanId,
        improvementTaskId: taskId,
        humanDecision: action,
        juryDecision: action,
        taskType,
        result: {
          summary: patch.summary ?? 'safe summary',
          changedFiles: patch.files,
          testsRun: patch.testsPassed == null ? [] : ['npm test'],
          testsPassed: patch.testsPassed,
        },
      },
      finishedAt: new Date(NOW),
      createdAt: new Date(NOW),
      updatedAt: new Date(NOW),
    },
  });
  return { reviewId, taskId, executionId };
}

async function plantedForeign(prisma: Awaited<typeof import('@/lib/prisma')>['prisma']) {
  await prisma.juryHumanDecision.create({
    data: {
      id: 'phase52-foreign-human',
      tenantId: FOREIGN,
      reviewResultId: 'phase52-foreign-review',
      reviewRequestId: 'phase52-foreign-req',
      decision: 'VERIFY',
      actorUserId: foreign.userId,
      createdAt: new Date(NOW),
    },
  });
  const taskId = 'phase52-foreign-task';
  const executionId = 'phase52-foreign-exec';
  await prisma.juryImprovementTask.create({
    data: {
      ...taskRow(taskId, 'phase52-foreign-review', 'VERIFICATION', {
        kind: 'human-decision-improvement',
        humanDecisionId: 'phase52-foreign-human',
        reviewRequestId: 'phase52-foreign-req',
        reviewResultId: 'phase52-foreign-review',
      }),
      tenantId: FOREIGN,
    },
  });
  await prisma.juryAgentExecution.create({
    data: {
      id: executionId,
      tenantId: FOREIGN,
      taskId,
      agent: 'CURSOR',
      allowedPaths: [COPY],
      deniedPaths: [],
      status: 'COMPLETED',
      workspaceRef: { type: 'PROJECT', ref: 'mock-aisle' },
      provenance: {
        kind: 'human-agent-execution',
        result: { summary: 'safe summary', changedFiles: [COPY], testsRun: [], testsPassed: null },
      },
      finishedAt: new Date(NOW),
      createdAt: new Date(NOW),
      updatedAt: new Date(NOW),
    },
  });
  return { executionId };
}

async function executionRow(
  prisma: Awaited<typeof import('@/lib/prisma')>['prisma'],
  id: string,
  taskId: string,
) {
  await prisma.juryAgentExecution.create({
    data: {
      id,
      tenantId: TENANT,
      taskId,
      agent: 'CURSOR',
      allowedPaths: [],
      deniedPaths: [],
      status: 'COMPLETED',
      workspaceRef: { type: 'PROJECT', ref: 'mock-aisle' },
      provenance: { kind: 'human-agent-execution', result: { summary: 'safe summary', changedFiles: [COPY], testsRun: [], testsPassed: null } },
      finishedAt: new Date(NOW),
      createdAt: new Date(NOW),
      updatedAt: new Date(NOW),
    },
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
  await evidenceRow(prisma, EVIDENCE, TENANT, CONN, ['phase52-zero', 'phase52-null']);
  await evidenceRow(prisma, 'phase52-foreign-evidence', FOREIGN, FOREIGN_CONN, []);
  await prisma.juryNormalizedMetric.create({ data: metric('phase52-zero', 'newUsersLast7d', 0, 'AVAILABLE') });
  await prisma.juryNormalizedMetric.create({ data: metric('phase52-null', 'postsLast7d', null, 'NOT_MEASURED') });
  for (const id of [
    'phase52-verify',
    'phase52-reword',
    'phase52-pending',
    'phase52-running',
    'phase52-blocked',
    'phase52-accept',
    'phase52-none',
    'phase52-mismatch',
    'phase52-missing',
    'phase52-escape',
    'phase52-scope',
    'phase52-secret',
    'phase52-schema',
    'phase52-migration',
    'phase52-auth',
    'phase52-deploy',
    'phase52-concurrent',
  ]) {
    const decision: JuryDecision = id === 'phase52-reword' || id === 'phase52-blocked' ? 'REWORD' : 'VERIFY';
    await review(prisma, id, `${id}-req`, TENANT, CONN, EVIDENCE, decision);
  }
  await review(prisma, 'phase52-foreign-review', 'phase52-foreign-req', FOREIGN, FOREIGN_CONN, 'phase52-foreign-evidence', 'VERIFY');
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
      serviceKey: 'phase52',
      displayName: 'Phase 52',
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
      boardRunId: 'phase52-board',
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

function taskRow(id: string, reviewResultId: string, taskType: 'VERIFICATION' | 'REWORD', provenance: Record<string, string>) {
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
  await prisma.juryChangeGateResult.deleteMany({ where });
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
    where: { username: { in: ['phase52-owner', 'phase52-member', 'phase52-auditor', 'phase52-foreign'] } },
  });
}
