import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { Prisma } from '@prisma/client';
import type { JuryActor } from './access';
import {
  humanAgentExecutionId,
  humanAgentHandoffAuditId,
  persistHumanAgentHandoff,
} from './human-agent-handoff';
import { persistHumanImprovement } from './human-improvement-bridge';
import { loadReviewConsole, noteHumanNextAction, projectReviewConsole } from './review-console';
import { JURY_CORE_CONTRACT_VERSION, type JuryDecision, type JuryFinalSurface, type JuryMembership } from './records';

const TENANT = 'phase50-handoff';
const FOREIGN = 'phase50-foreign';
const CONN = 'phase50-conn';
const FOREIGN_CONN = 'phase50-foreign-conn';
const EVIDENCE = 'phase50-evidence';
const NOW = '2026-10-02T11:30:00.000Z';
const LIVE_REVIEW = '3707202563ecae9b38f324a4eefd9243a14bc69420ed6cdda16c4c5794f62e0d';
const LIVE_CYCLE = '14308b4c999ccbe8ca54b7f31da5385385d4073c49bbf2955582a6bb96afb01e';

const owner = membership('phase50-owner-m', TENANT, 'phase50-owner', 'OWNER');
const member = membership('phase50-member-m', TENANT, 'phase50-member', 'DEVELOPER');
const auditor = membership('phase50-auditor-m', TENANT, 'phase50-auditor', 'VIEWER');
const foreign = membership('phase50-foreign-m', FOREIGN, 'phase50-foreign', 'OWNER');
const ownerActor: JuryActor = { ok: true, userId: owner.userId, tenantId: TENANT, role: 'OWNER', membershipId: owner.id };
const auditorActor: JuryActor = { ok: true, userId: auditor.userId, tenantId: TENANT, role: 'VIEWER', membershipId: auditor.id };

test('handoff controls stay behind a human-approved task', () => {
  const surface = face();
  const ready = projectReviewConsole({
    actor: ownerActor,
    result: { id: 'verify', tenantId: TENANT, expectedDecision: 'VERIFY', finalSurface: surface, completedAt: NOW },
    status: 'COMPLETED',
    evidenceId: EVIDENCE,
    metrics: [],
    humanDecision: 'VERIFY',
    improvementTask: { id: 'task-verify', taskType: 'VERIFICATION' },
  });
  assert.equal(ready.ok, true);
  if (ready.ok) {
    assert.equal(ready.screen.canHandoff, true);
    assert.equal(ready.screen.agentExecution, null);
  }
  const pending = projectReviewConsole({
    actor: ownerActor,
    result: { id: 'verify', tenantId: TENANT, expectedDecision: 'VERIFY', finalSurface: surface, completedAt: NOW },
    status: 'COMPLETED',
    evidenceId: EVIDENCE,
    metrics: [],
    humanDecision: 'VERIFY',
    improvementTask: { id: 'task-verify', taskType: 'VERIFICATION' },
    agentExecution: { id: 'exec-1', status: 'PENDING', agent: 'CURSOR' },
  });
  assert.equal(pending.ok, true);
  if (pending.ok) {
    assert.equal(pending.screen.canHandoff, false);
    assert.equal(pending.screen.agentExecution?.status, 'PENDING');
    assert.equal(pending.screen.agentExecution?.agent, 'CURSOR');
  }
  const reader = projectReviewConsole({
    actor: auditorActor,
    result: { id: 'reword', tenantId: TENANT, expectedDecision: 'REWORD', finalSurface: surface, completedAt: NOW },
    status: 'COMPLETED',
    evidenceId: EVIDENCE,
    metrics: [],
    humanDecision: 'REWORD',
    improvementTask: { id: 'task-reword', taskType: 'REWORD' },
  });
  assert.equal(reader.ok, true);
  if (reader.ok) assert.equal(reader.screen.canHandoff, false);
});

test('human-approved tasks hand off to one pending execution', { timeout: 120_000 }, async () => {
  loadEnv();
  const { prisma } = await import('@/lib/prisma');
  const liveBefore = await liveSnapshot(prisma);
  let cleanupError: string | null = null;
  try {
    await removeFixture(prisma);
    await seed(prisma);
    await note(owner, 'phase50-verify', 'VERIFY');
    await note(owner, 'phase50-reword', 'REWORD');
    await note(owner, 'phase50-accept', 'ACCEPT');
    await note(owner, 'phase50-rollback', 'REWORD');
    const verifyTask = await persistHumanImprovement({ userId: owner.userId, memberships: [owner], reviewId: 'phase50-verify' });
    const rewordTask = await persistHumanImprovement({ userId: member.userId, memberships: [member], reviewId: 'phase50-reword' });
    const rollbackTask = await persistHumanImprovement({ userId: owner.userId, memberships: [owner], reviewId: 'phase50-rollback' });
    assert.equal(verifyTask.ok && rewordTask.ok && rollbackTask.ok, true);
    if (!verifyTask.ok || !rewordTask.ok || !rollbackTask.ok || !verifyTask.taskId || !rewordTask.taskId || !rollbackTask.taskId) return;

    const acceptHuman = await prisma.juryHumanDecision.findFirst({
      where: { tenantId: TENANT, reviewResultId: 'phase50-accept' },
      select: { id: true, reviewRequestId: true },
    });
    assert.ok(acceptHuman);
    await prisma.juryImprovementTask.create({
      data: taskRow('phase50-accept-task', 'phase50-accept', 'VERIFICATION', {
        kind: 'human-decision-improvement',
        reviewRequestId: acceptHuman.reviewRequestId,
        reviewResultId: 'phase50-accept',
        humanDecisionId: acceptHuman.id,
        humanDecision: 'REWORD',
        juryDecision: 'VERIFY',
      }),
    });
    await prisma.juryImprovementTask.create({
      data: taskRow('phase50-orphan-task', 'phase50-none', 'VERIFICATION', { kind: 'human-decision-improvement' }),
    });
    await prisma.juryImprovementTask.create({
      data: taskRow('phase50-foreign-task', 'phase50-foreign-review', 'VERIFICATION', { kind: 'human-decision-improvement' }, FOREIGN),
    });

    const auditorTry = await persistHumanAgentHandoff({
      userId: auditor.userId,
      memberships: [auditor],
      improvementTaskId: verifyTask.taskId,
    });
    assert.equal(auditorTry.ok, false);
    if (!auditorTry.ok) assert.equal(auditorTry.reason, 'FORBIDDEN');
    assert.equal(await prisma.juryAgentExecution.count({ where: { tenantId: TENANT } }), 0);

    const foreignTry = await persistHumanAgentHandoff({
      userId: owner.userId,
      memberships: [owner],
      improvementTaskId: 'phase50-foreign-task',
    });
    assert.equal(foreignTry.ok, false);
    if (!foreignTry.ok) assert.equal(foreignTry.reason, 'NOT_FOUND');
    assert.equal(await prisma.juryAgentExecution.count({ where: { tenantId: FOREIGN } }), 0);
    assert.equal(await prisma.juryAuditEvent.count({ where: { tenantId: FOREIGN, action: 'AGENT_HANDOFF_CREATED' } }), 0);

    const missing = await persistHumanAgentHandoff({
      userId: owner.userId,
      memberships: [owner],
      improvementTaskId: 'phase50-missing',
    });
    assert.equal(missing.ok, false);
    if (!missing.ok) assert.equal(missing.reason, 'NOT_FOUND');

    const acceptTry = await persistHumanAgentHandoff({
      userId: owner.userId,
      memberships: [owner],
      improvementTaskId: 'phase50-accept-task',
    });
    assert.equal(acceptTry.ok, false);
    if (!acceptTry.ok) assert.equal(acceptTry.reason, 'HUMAN_APPROVAL_REQUIRED');
    assert.equal(await prisma.juryAgentExecution.count({ where: { taskId: 'phase50-accept-task' } }), 0);

    const orphanTry = await persistHumanAgentHandoff({
      userId: owner.userId,
      memberships: [owner],
      improvementTaskId: 'phase50-orphan-task',
    });
    assert.equal(orphanTry.ok, false);
    if (!orphanTry.ok) assert.equal(orphanTry.reason, 'HUMAN_APPROVAL_REQUIRED');
    assert.equal(await prisma.juryAgentExecution.count({ where: { taskId: 'phase50-orphan-task' } }), 0);

    const first = await persistHumanAgentHandoff({
      userId: owner.userId,
      memberships: [owner],
      improvementTaskId: verifyTask.taskId,
    });
    assert.equal(first.ok, true);
    if (first.ok) {
      assert.equal(first.created, true);
      assert.equal(first.status, 'PENDING');
      assert.equal(first.agent, 'CURSOR');
    }
    const again = await persistHumanAgentHandoff({
      userId: member.userId,
      memberships: [member],
      improvementTaskId: verifyTask.taskId,
    });
    assert.equal(again.ok, true);
    if (again.ok) assert.equal(again.created, false);
    assert.equal(await prisma.juryAgentExecution.count({ where: { tenantId: TENANT, taskId: verifyTask.taskId } }), 1);
    assert.equal(await prisma.juryAuditEvent.count({
      where: { tenantId: TENANT, improvementTaskId: verifyTask.taskId, action: 'AGENT_HANDOFF_CREATED' },
    }), 1);

    const reword = await persistHumanAgentHandoff({
      userId: member.userId,
      memberships: [member],
      improvementTaskId: rewordTask.taskId,
    });
    assert.equal(reword.ok, true);
    if (reword.ok) {
      assert.equal(reword.created, true);
      assert.equal(reword.status, 'PENDING');
      assert.equal(reword.agent, 'CURSOR');
    }

    const stored = await prisma.juryAgentExecution.findFirst({
      where: { tenantId: TENANT, taskId: verifyTask.taskId },
    });
    assert.equal(stored?.status, 'PENDING');
    assert.equal(stored?.agent, 'CURSOR');
    assert.equal(stored?.startedAt, null);
    assert.equal(stored?.finishedAt, null);
    assert.equal(await prisma.juryAgentExecution.count({
      where: { tenantId: TENANT, status: { in: ['RUNNING', 'COMPLETED', 'BLOCKED'] } },
    }), 0);
    const snapshot = JSON.stringify(stored?.inputSnapshot).toLowerCase();
    for (const word of ['credentialref', 'password', 'secret', 'cookie', 'api_key', 'api key', 'access_token', 'token', 'newuserslast7d']) {
      assert.equal(snapshot.includes(word), false, word);
    }
    const workspace = stored?.workspaceRef as { type?: string; ref?: string };
    assert.equal(workspace?.type, 'PROJECT');
    assert.equal(workspace?.ref, 'jury-product');
    assert.equal(workspace.ref.includes('/'), false);
    assert.equal(workspace.ref.includes('\\'), false);
    const audit = await prisma.juryAuditEvent.findFirst({
      where: { tenantId: TENANT, improvementTaskId: verifyTask.taskId, action: 'AGENT_HANDOFF_CREATED' },
    });
    const auditText = JSON.stringify(audit?.provenance).toLowerCase();
    assert.equal(audit?.agentExecutionId, stored?.id);
    assert.equal(auditText.includes('humandecisionid'), true);
    assert.equal(auditText.includes('credential'), false);
    assert.equal(await prisma.juryReviewResult.findFirst({
      where: { id: 'phase50-verify', tenantId: TENANT },
      select: { expectedDecision: true },
    }).then((row) => row?.expectedDecision), 'VERIFY');

    const shown = await loadReviewConsole(ownerActor, 'phase50-verify');
    assert.equal(shown.ok, true);
    if (shown.ok) {
      assert.equal(shown.screen.agentExecution?.status, 'PENDING');
      assert.equal(shown.screen.agentExecution?.agent, 'CURSOR');
      assert.equal(shown.screen.canHandoff, false);
      assert.equal(shown.screen.measured.find((row) => row.metric === 'newUsersLast7d')?.value, 0);
      assert.equal(shown.screen.measured.find((row) => row.metric === 'postsLast7d')?.value, null);
    }

    const poisonId = humanAgentHandoffAuditId(TENANT, humanAgentExecutionId(TENANT, rollbackTask.taskId));
    await prisma.juryAuditEvent.create({
      data: {
        id: poisonId,
        tenantId: TENANT,
        timestamp: new Date(NOW),
        actor: owner.userId,
        action: 'AGENT_HANDOFF_CREATED',
        improvementTaskId: rollbackTask.taskId,
        reviewId: 'phase50-rollback',
        decision: 'REWORD',
      },
    });
    const rolled = await persistHumanAgentHandoff({
      userId: owner.userId,
      memberships: [owner],
      improvementTaskId: rollbackTask.taskId,
    });
    assert.equal(rolled.ok, false);
    if (!rolled.ok) assert.equal(rolled.reason, 'PERSISTENCE_FAILED');
    assert.equal(await prisma.juryAgentExecution.count({ where: { taskId: rollbackTask.taskId } }), 0);
    await prisma.juryAuditEvent.deleteMany({ where: { id: poisonId } });
    const restored = await persistHumanAgentHandoff({
      userId: owner.userId,
      memberships: [owner],
      improvementTaskId: rollbackTask.taskId,
    });
    assert.equal(restored.ok, true);
    if (restored.ok) assert.equal(restored.status, 'PENDING');

    const zero = await prisma.juryNormalizedMetric.findFirst({ where: { id: 'phase50-zero', tenantId: TENANT } });
    const absent = await prisma.juryNormalizedMetric.findFirst({ where: { id: 'phase50-null', tenantId: TENANT } });
    assert.equal(zero?.value, 0);
    assert.equal(zero?.availability, 'AVAILABLE');
    assert.equal(absent?.value, null);
    assert.equal(absent?.availability, 'NOT_MEASURED');
    assert.equal(await prisma.juryChangeGateResult.count({ where: { tenantId: TENANT } }), 0);
    assert.equal(await prisma.juryChangeGateReview.count({ where: { tenantId: TENANT } }), 0);
    assert.equal(await prisma.juryReReviewResult.count({ where: { tenantId: TENANT } }), 0);
    assert.equal(await prisma.juryDecisionCycle.count({ where: { tenantId: TENANT } }), 0);
    assert.equal(await prisma.juryAutoLoopActivation.count({ where: { tenantId: TENANT } }), 0);
    assert.equal(await prisma.juryAgentExecution.count({ where: { tenantId: TENANT, status: 'PENDING' } }), 3);
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

test('human agent handoff stays off host collectors and execution', () => {
  const source = readFileSync(path.resolve(process.cwd(), 'src/lib/jury-product/human-agent-handoff.ts'), 'utf8');
  for (const token of [
    'buildEvidencePackFromDb',
    'attachGa4Evidence',
    'runAisleAdapter',
    'GA4_PROPERTY_ID',
    'GA4_SERVICE_ACCOUNT',
    'findUnique',
    'FakeCursorAdapter',
    'executeAgent',
    'child_process',
    'FULL_AUTO',
    'TASK_ONLY',
  ]) {
    assert.equal(source.includes(token), false, token);
  }
  assert.equal(source.includes('input.improvementTaskId'), true);
  assert.equal(source.includes('input.agentType'), false);
  assert.equal(source.includes('input.provider'), false);
  assert.equal(source.includes('input.workspace'), false);
  assert.equal(source.includes("action: 'improvement.write'"), true);
  assert.equal(source.includes("status: 'PENDING'"), true);
  const actions = readFileSync(path.resolve(process.cwd(), 'src/app/(root)/jury/actions.ts'), 'utf8');
  const fn = actions.slice(actions.indexOf('export async function handoffHumanImprovement'), actions.indexOf('async function tenantReviewCore'));
  assert.equal(fn.includes("formData.get('improvementTaskId')"), true);
  for (const key of ['tenantId', 'decision', 'action', 'agentType', 'provider', 'workspace', 'prompt']) {
    assert.equal(fn.includes(`formData.get('${key}')`), false, key);
  }
  const ui = readFileSync(path.resolve(process.cwd(), 'src/app/(root)/jury/ui.tsx'), 'utf8');
  const body = ui.slice(ui.indexOf('export function ReviewDetailBody'), ui.indexOf('const INTAKE_AVAILABILITY'));
  assert.equal(body.includes('Send to Agent'), true);
  assert.equal(body.includes('Status:'), true);
  assert.equal(body.includes('Provider:'), true);
  for (const label of ['Run Agent', 'Auto Fix', 'Apply Fix', 'Send to Cursor and Run', 'Re-review', 'Change Gate']) {
    assert.equal(body.includes(label), false, label);
  }
});

async function note(actor: JuryMembership, reviewId: string, action: JuryDecision) {
  const saved = await noteHumanNextAction({ userId: actor.userId, memberships: [actor], reviewId, action });
  assert.equal(saved.ok, true);
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

function taskRow(
  id: string,
  reviewResultId: string,
  taskType: 'VERIFICATION' | 'REWORD',
  provenance: Prisma.InputJsonValue,
  tenantId = TENANT,
) {
  return {
    id,
    tenantId,
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
  await evidence(prisma, EVIDENCE, TENANT, CONN, ['phase50-zero', 'phase50-null']);
  await evidence(prisma, 'phase50-foreign-evidence', FOREIGN, FOREIGN_CONN, []);
  await prisma.juryNormalizedMetric.create({ data: metric('phase50-zero', 'newUsersLast7d', 0, 'AVAILABLE') });
  await prisma.juryNormalizedMetric.create({ data: metric('phase50-null', 'postsLast7d', null, 'NOT_MEASURED') });
  await review(prisma, 'phase50-verify', 'phase50-verify-req', TENANT, CONN, EVIDENCE, 'VERIFY');
  await review(prisma, 'phase50-reword', 'phase50-reword-req', TENANT, CONN, EVIDENCE, 'REWORD');
  await review(prisma, 'phase50-accept', 'phase50-accept-req', TENANT, CONN, EVIDENCE, 'VERIFY');
  await review(prisma, 'phase50-none', 'phase50-none-req', TENANT, CONN, EVIDENCE, 'VERIFY');
  await review(prisma, 'phase50-rollback', 'phase50-rollback-req', TENANT, CONN, EVIDENCE, 'REWORD');
  await review(prisma, 'phase50-foreign-review', 'phase50-foreign-req', FOREIGN, FOREIGN_CONN, 'phase50-foreign-evidence', 'VERIFY');
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
      serviceKey: 'phase50',
      displayName: 'Phase 50',
      accessMethod: 'FILE_UPLOAD',
      status: 'DISCOVERY_PENDING',
      credentialRef: null,
    },
  });
}

async function evidence(
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
      boardRunId: 'phase50-board',
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
    where: { username: { in: ['phase50-owner', 'phase50-member', 'phase50-auditor', 'phase50-foreign'] } },
  });
}
