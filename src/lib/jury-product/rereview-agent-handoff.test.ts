import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import type { JuryActor } from './access';
import { projectImprovementTrace } from './improvement-trace-console';
import { readImprovementTrace } from './improvement-trace-store';
import { loadReviewConsole, projectReviewConsole } from './review-console';
import { JURY_CORE_CONTRACT_VERSION, type JuryDecision, type JuryFinalSurface, type JuryMembership } from './records';
import { approveReReviewAgent, persistReReviewAgentHandoff } from './rereview-agent-handoff';
import { reReviewImprovementTaskId } from './rereview-improvement-bridge';

const TENANT = 'phase55-rereview';
const FOREIGN = 'phase55-foreign';
const CONN = 'phase55-conn';
const EVIDENCE = 'phase55-evidence';
const NOW = '2026-10-02T14:40:00.000Z';
const LIVE_REVIEW = '3707202563ecae9b38f324a4eefd9243a14bc69420ed6cdda16c4c5794f62e0d';
const LIVE_CYCLE = '14308b4c999ccbe8ca54b7f31da5385385d4073c49bbf2955582a6bb96afb01e';

const owner = membership('phase55-owner-m', TENANT, 'phase55-owner', 'OWNER');
const member = membership('phase55-member-m', TENANT, 'phase55-member', 'DEVELOPER');
const auditor = membership('phase55-auditor-m', TENANT, 'phase55-auditor', 'VIEWER');
const foreign = membership('phase55-foreign-m', FOREIGN, 'phase55-foreign', 'OWNER');
const ownerActor: JuryActor = { ok: true, userId: owner.userId, tenantId: TENANT, role: 'OWNER', membershipId: owner.id };
const memberActor: JuryActor = { ok: true, userId: member.userId, tenantId: TENANT, role: 'DEVELOPER', membershipId: member.id };
const auditorActor: JuryActor = { ok: true, userId: auditor.userId, tenantId: TENANT, role: 'VIEWER', membershipId: auditor.id };

test('re-review handoff waits for a separate approval', () => {
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
  };
  const waiting = projectReviewConsole(base);
  assert.equal(waiting.ok, true);
  if (waiting.ok) {
    assert.equal(waiting.screen.canApproveReReviewAgent, true);
    assert.equal(waiting.screen.canHandoffReReviewAgent, false);
  }
  const approved = projectReviewConsole({ ...base, nextApproval: 'VERIFY' });
  assert.equal(approved.ok && approved.screen.canApproveReReviewAgent, false);
  assert.equal(approved.ok && approved.screen.canHandoffReReviewAgent, true);
  const memberView = projectReviewConsole({ ...base, actor: memberActor, nextApproval: 'VERIFY' });
  assert.equal(memberView.ok && memberView.screen.canHandoffReReviewAgent, false);
  const reader = projectReviewConsole({ ...base, actor: auditorActor, nextApproval: 'VERIFY' });
  assert.equal(reader.ok && reader.screen.canApproveReReviewAgent, false);
  assert.equal(reader.ok && reader.screen.canHandoffReReviewAgent, false);
  const pending = projectReviewConsole({
    ...base,
    nextApproval: 'VERIFY',
    nextAgentExecution: { id: 'exec', status: 'PENDING', agent: 'CURSOR' },
  });
  assert.equal(pending.ok && pending.screen.canHandoffReReviewAgent, false);
  assert.equal(pending.ok && pending.screen.nextAgentExecution?.status, 'PENDING');
});

test('approved re-review task hands off one pending execution', async () => {
  loadEnv();
  const { prisma } = await import('@/lib/prisma');
  let cleanupError: string | null = null;
  const liveBefore = await liveSnapshot(prisma);
  try {
    await removeFixture(prisma);
    await seed(prisma);
    const verify = await chain(prisma, 'phase55-verify', 'VERIFY');
    const reword = await chain(prisma, 'phase55-reword', 'REWORD');
    const bare = await chain(prisma, 'phase55-bare', 'VERIFY');
    const accepted = await chain(prisma, 'phase55-accept', 'VERIFY');
    await prisma.juryHumanDecision.create({
      data: {
        id: `${accepted.reReviewResultId}-accept`,
        tenantId: TENANT,
        reviewResultId: accepted.reReviewResultId,
        reviewRequestId: accepted.reReviewRequestId,
        decision: 'ACCEPT',
        actorUserId: owner.userId,
        createdAt: new Date(NOW),
      },
    });
    const plain = await plainTask(prisma);
    const lineage = await chain(prisma, 'phase55-lineage', 'VERIFY');
    await prisma.juryReviewResult.updateMany({
      where: { id: lineage.reReviewResultId, tenantId: TENANT },
      data: { parentReviewResultId: plain.reviewId },
    });
    const gateMismatch = await chain(prisma, 'phase55-gate', 'VERIFY');
    await retargetGate(prisma, gateMismatch);
    const executionMismatch = await chain(prisma, 'phase55-exec', 'VERIFY');
    await prisma.juryAgentExecution.updateMany({
      where: { id: executionMismatch.executionId, tenantId: TENANT },
      data: { taskId: executionMismatch.spareTaskId },
    });
    const foreignChain = await chain(prisma, 'phase55-foreign-review', 'VERIFY', FOREIGN);
    const concurrent = await chain(prisma, 'phase55-concurrent', 'VERIFY');
    const secret = await chain(prisma, 'phase55-secret', 'VERIFY');
    const before = await counts(prisma);

    const missingApproval = await handoff(bare.nextTaskId);
    assert.equal(missingApproval.ok, false);
    if (!missingApproval.ok) assert.equal(missingApproval.reason, 'HUMAN_APPROVAL_REQUIRED');
    assert.equal(await prisma.juryAgentExecution.count({ where: { taskId: bare.nextTaskId } }), 0);
    const acceptTry = await handoff(accepted.nextTaskId);
    assert.equal(acceptTry.ok, false);
    if (!acceptTry.ok) assert.equal(acceptTry.reason, 'HUMAN_APPROVAL_REQUIRED');
    assert.equal(await prisma.juryAgentExecution.count({ where: { taskId: accepted.nextTaskId } }), 0);
    const humanTask = await handoff(plain.taskId);
    assert.equal(humanTask.ok, false);
    if (!humanTask.ok) assert.equal(humanTask.reason, 'NOT_REREVIEW_IMPROVEMENT_TASK');
    for (const broken of [lineage, gateMismatch, executionMismatch]) {
      const blocked = await handoff(broken.nextTaskId);
      assert.equal(blocked.ok, false, broken.nextTaskId);
      if (!blocked.ok) assert.equal(blocked.reason, 'NOT_REREVIEW_IMPROVEMENT_TASK');
    }
    const foreignTry = await handoff(foreignChain.nextTaskId);
    assert.equal(foreignTry.ok, false);
    if (!foreignTry.ok) assert.equal(foreignTry.reason, 'NOT_FOUND');

    const approved = await approveReReviewAgent({ userId: member.userId, memberships: [member], improvementTaskId: verify.nextTaskId });
    assert.equal(approved.ok, true);
    if (approved.ok) assert.equal(approved.decision, 'VERIFY');
    assert.equal(await prisma.juryAgentExecution.count({ where: { taskId: verify.nextTaskId } }), 0);
    const memberTry = await handoff(verify.nextTaskId, member);
    assert.equal(memberTry.ok, false);
    if (!memberTry.ok) assert.equal(memberTry.reason, 'FORBIDDEN');
    const auditorTry = await handoff(verify.nextTaskId, auditor);
    assert.equal(auditorTry.ok, false);
    if (!auditorTry.ok) assert.equal(auditorTry.reason, 'FORBIDDEN');
    assert.equal(await prisma.juryAgentExecution.count({ where: { taskId: verify.nextTaskId } }), 0);

    const taskBefore = await prisma.juryImprovementTask.findFirst({ where: { id: verify.nextTaskId, tenantId: TENANT } });
    const opened = await handoff(verify.nextTaskId, owner);
    assert.equal(opened.ok, true);
    if (opened.ok) {
      assert.equal(opened.created, true);
      assert.equal(opened.status, 'PENDING');
      assert.equal(opened.agent, 'CURSOR');
    }
    const replay = await handoff(verify.nextTaskId, owner);
    assert.equal(replay.ok, true);
    if (replay.ok && opened.ok) {
      assert.equal(replay.created, false);
      assert.equal(replay.agentExecutionId, opened.agentExecutionId);
    }
    const row = await prisma.juryAgentExecution.findFirst({ where: { taskId: verify.nextTaskId, tenantId: TENANT } });
    assert.equal(row?.status, 'PENDING');
    assert.equal(row?.agent, 'CURSOR');
    assert.equal(row?.startedAt, null);
    assert.equal(row?.finishedAt, null);
    assert.deepEqual(row?.workspaceRef, { type: 'PROJECT', ref: 'jury-product' });
    const snapshot = JSON.stringify(row?.inputSnapshot);
    assert.equal(snapshot.includes(verify.reReviewResultId), true);
    assert.equal(snapshot.includes('password'), false);
    assert.equal(snapshot.includes('postgres://'), false);
    const taskAfter = await prisma.juryImprovementTask.findFirst({ where: { id: verify.nextTaskId, tenantId: TENANT } });
    assert.equal(taskAfter?.diagnosis, taskBefore?.diagnosis);
    assert.equal(taskAfter?.status, 'OPEN');
    assert.equal(taskAfter?.updatedAt?.toISOString(), taskBefore?.updatedAt?.toISOString());
    assert.equal(await prisma.juryAuditEvent.count({
      where: { tenantId: TENANT, improvementTaskId: verify.nextTaskId, action: 'AGENT_HANDOFF_CREATED' },
    }), 1);

    const rewordedApproval = await approveReReviewAgent({ userId: owner.userId, memberships: [owner], improvementTaskId: reword.nextTaskId });
    assert.equal(rewordedApproval.ok, true);
    const reworded = await handoff(reword.nextTaskId, owner);
    assert.equal(reworded.ok, true);
    if (reworded.ok) assert.equal(reworded.status, 'PENDING');
    assert.equal((await prisma.juryImprovementTask.findFirst({ where: { id: reword.nextTaskId } }))?.taskType, 'REWORD');

    const concurrentApproval = await approveReReviewAgent({ userId: owner.userId, memberships: [owner], improvementTaskId: concurrent.nextTaskId });
    assert.equal(concurrentApproval.ok, true);
    const [left, right] = await Promise.all([handoff(concurrent.nextTaskId, owner), handoff(concurrent.nextTaskId, owner)]);
    assert.equal(left.ok && right.ok, true);
    if (left.ok && right.ok) assert.equal(left.agentExecutionId, right.agentExecutionId);
    assert.equal(await prisma.juryAgentExecution.count({ where: { taskId: concurrent.nextTaskId } }), 1);
    assert.equal(await prisma.juryAuditEvent.count({
      where: { tenantId: TENANT, improvementTaskId: concurrent.nextTaskId, action: 'AGENT_HANDOFF_CREATED' },
    }), 1);

    await approveReReviewAgent({ userId: owner.userId, memberships: [owner], improvementTaskId: secret.nextTaskId });
    await prisma.juryImprovementTask.updateMany({
      where: { id: secret.nextTaskId, tenantId: TENANT },
      data: { diagnosis: 'password' },
    });
    const unsafe = await handoff(secret.nextTaskId, owner);
    assert.equal(unsafe.ok, false);
    if (!unsafe.ok) assert.equal(unsafe.reason, 'SNAPSHOT_UNSAFE');
    assert.equal(await prisma.juryAgentExecution.count({ where: { taskId: secret.nextTaskId } }), 0);

    const after = await counts(prisma);
    assert.equal(after.results, before.results);
    assert.equal(after.gates, before.gates);
    assert.equal(after.gateReviews, before.gateReviews);
    assert.equal(after.tasks, before.tasks);
    assert.equal(after.cycles, 0);
    assert.equal(after.loops, 0);
    assert.equal(after.pending, 3);
    assert.equal(after.running, 0);
    const original = await prisma.juryReviewResult.findFirst({ where: { id: verify.reviewId, tenantId: TENANT } });
    const child = await prisma.juryReviewResult.findFirst({ where: { id: verify.reReviewResultId, tenantId: TENANT } });
    const sourceHuman = await prisma.juryHumanDecision.findFirst({ where: { id: verify.humanId, tenantId: TENANT } });
    const gate = await prisma.juryChangeGateResult.findFirst({ where: { id: verify.gateId, tenantId: TENANT } });
    assert.equal(original?.expectedDecision, 'VERIFY');
    assert.equal(child?.expectedDecision, 'VERIFY');
    assert.equal(sourceHuman?.decision, 'VERIFY');
    assert.equal(gate?.status, 'APPROVED');
    const zero = await prisma.juryNormalizedMetric.findFirst({ where: { id: 'phase55-zero', tenantId: TENANT } });
    const missing = await prisma.juryNormalizedMetric.findFirst({ where: { id: 'phase55-null', tenantId: TENANT } });
    assert.equal(zero?.value, 0);
    assert.equal(missing?.value, null);
    const shown = await loadReviewConsole(ownerActor, verify.reviewId);
    assert.equal(shown.ok, true);
    if (shown.ok) {
      assert.equal(shown.screen.nextApproval, 'VERIFY');
      assert.equal(shown.screen.nextAgentExecution?.status, 'PENDING');
      assert.equal(shown.screen.canHandoffReReviewAgent, false);
    }
    const traced = await readImprovementTrace({ userId: owner.userId, memberships: [owner], improvementTaskId: verify.taskId });
    assert.equal(traced.ok, true);
    if (traced.ok) {
      const timeline = projectImprovementTrace(traced.trace).timeline;
      assert.equal(timeline.some((item) => item.title === 'Human Approval' && item.status === 'VERIFY'), true);
      assert.equal(timeline.some((item) => item.title === 'AgentExecution' && item.status === 'PENDING'), true);
    }
    assert.equal(await prisma.juryAgentExecution.count({ where: { tenantId: FOREIGN, taskId: foreignChain.nextTaskId } }), 0);
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

test('re-review handoff stays on the pending contract', () => {
  const source = readFileSync(path.resolve(process.cwd(), 'src/lib/jury-product/rereview-agent-handoff.ts'), 'utf8');
  for (const token of [
    'FakeCursorAdapter',
    'buildEvidencePackFromDb',
    'attachGa4Evidence',
    'runAisleAdapter',
    'GA4_PROPERTY_ID',
    'findUnique',
    'child_process',
    'persistImprovementAutoLoop',
    'recordDecisionCycle',
    'callFrozenReviewPipeline',
    'persistChangeGateReReview',
    'evaluateHumanChangeGate',
    'executeHumanAgentExecution',
    'persistHumanAgentHandoff',
    'persistReReviewImprovement',
  ]) {
    assert.equal(source.includes(token), false, token);
  }
  assert.equal(source.includes('HUMAN_HANDOFF_AGENT'), true);
  assert.equal(source.includes('HUMAN_HANDOFF_WORKSPACE'), true);
  assert.equal(source.includes('humanAgentExecutionId'), true);
  assert.equal(source.includes("action: 'agent.execute'"), true);
  assert.equal(source.includes("action: 'improvement.write'"), true);
  assert.equal(source.includes('input.improvementTaskId'), true);
  assert.equal(source.includes('noteHumanNextAction'), true);
  const actions = readFileSync(path.resolve(process.cwd(), 'src/app/(root)/jury/actions.ts'), 'utf8');
  const fn = actions.slice(
    actions.indexOf('export async function handoffReReviewImprovement'),
    actions.indexOf('export async function runReReviewAgentExecution'),
  );
  assert.equal(fn.includes("formData.get('improvementTaskId')"), true);
  for (const key of ['tenantId', 'reviewResultId', 'reReviewResultId', 'provider', 'workspace', 'humanDecision', 'taskType']) {
    assert.equal(fn.includes(`formData.get('${key}')`), false, key);
  }
  const ui = readFileSync(path.resolve(process.cwd(), 'src/app/(root)/jury/ui.tsx'), 'utf8');
  const body = ui.slice(ui.indexOf('export function ReReviewAgentHandoffBody'), ui.indexOf('export function HumanReReviewBody'));
  assert.equal(body.includes('Approve for Agent'), true);
  assert.equal(body.includes('Send to Agent'), true);
  assert.equal(body.includes('Agent Pending'), true);
  for (const label of ['Run Agent', 'Execute Agent', 'Run Change Gate', 'Run Re-review', 'Auto Fix', 'Run Loop']) {
    assert.equal(body.includes(label), false, label);
  }
  const reviewBody = ui.slice(ui.indexOf('export function HumanReReviewBody'), ui.indexOf('export function HumanChangeGateBody'));
  assert.equal(reviewBody.includes('Send to Agent'), false);
});

function handoff(improvementTaskId: string, actor: JuryMembership = owner) {
  return persistReReviewAgentHandoff({ userId: actor.userId, memberships: [actor], improvementTaskId });
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
  await connection(prisma, 'phase55-foreign-conn', FOREIGN, foreign.userId);
  await evidenceRow(prisma, EVIDENCE, TENANT, CONN);
  await evidenceRow(prisma, 'phase55-foreign-evidence', FOREIGN, 'phase55-foreign-conn');
  await prisma.juryNormalizedMetric.createMany({
    data: [
      metric('phase55-zero', 'userCount', 0, 'AVAILABLE'),
      metric('phase55-null', 'postsLast7d', null, 'NOT_MEASURED'),
    ],
  });
}

async function plainTask(prisma: Awaited<typeof import('@/lib/prisma')>['prisma']) {
  const requestId = 'phase55-plain-request';
  const reviewId = 'phase55-plain-review';
  const humanId = 'phase55-plain-human';
  const taskId = 'phase55-plain-task';
  await prisma.juryReviewRequest.create({
    data: {
      id: requestId,
      tenantId: TENANT,
      connectionId: CONN,
      evidenceId: EVIDENCE,
      reviewType: 'FULL_REVIEW',
      claim: '측정된 범위의 문구만 사용한다.',
      mode: 'AISLE_SELF',
      status: 'COMPLETED',
      coreRootDir: 'data/jury-product',
      requestedByUserId: owner.userId,
    },
  });
  await prisma.juryReviewResult.create({
    data: {
      id: reviewId,
      tenantId: TENANT,
      reviewRequestId: requestId,
      boardRunId: `${reviewId}-board`,
      evidenceStrength: 'strong',
      claimStrength: 'weak',
      conflictDetected: false,
      overclaimDetected: false,
      revisionRequired: false,
      expectedDecision: 'VERIFY',
      finalSurface: face('plain'),
      contractVersion: JURY_CORE_CONTRACT_VERSION,
      completedAt: new Date(NOW),
    },
  });
  await prisma.juryHumanDecision.create({
    data: {
      id: humanId,
      tenantId: TENANT,
      reviewResultId: reviewId,
      reviewRequestId: requestId,
      decision: 'VERIFY',
      actorUserId: owner.userId,
      createdAt: new Date(NOW),
    },
  });
  await prisma.juryImprovementTask.create({
    data: {
      id: taskId,
      tenantId: TENANT,
      reviewResultId: reviewId,
      diagnosis: 'plain',
      acceptanceCriteria: ['plain'],
      status: 'OPEN',
      loopIndex: 0,
      loopPolicy: { maxIterations: null, maxRuntimeMs: null, maxCostUsd: null },
      taskType: 'VERIFICATION',
      provenance: {
        kind: 'human-decision-improvement',
        humanDecisionId: humanId,
        reviewRequestId: requestId,
        reviewResultId: reviewId,
      },
      createdAt: new Date(NOW),
      updatedAt: new Date(NOW),
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
  const connectionId = tenantId === TENANT ? CONN : 'phase55-foreign-conn';
  const evidenceId = tenantId === TENANT ? EVIDENCE : 'phase55-foreign-evidence';
  const requestId = `${id}-request`;
  const reviewId = `${id}-review`;
  const humanId = `${id}-human`;
  const taskId = `${id}-task`;
  const executionId = `${id}-exec`;
  const gateId = `${id}-gate`;
  const reReviewRequestId = `${id}-rerequest`;
  const reReviewResultId = `${id}-reresult`;
  const nextTaskId = reReviewImprovementTaskId(tenantId, reReviewResultId);
  const spareTaskId = `${id}-spare`;
  await prisma.juryReviewRequest.create({
    data: {
      id: requestId, tenantId, connectionId, evidenceId, reviewType: 'FULL_REVIEW', claim: '측정된 범위의 문구만 사용한다.',
      mode: 'AISLE_SELF', status: 'COMPLETED', coreRootDir: 'data/jury-product', requestedByUserId: actor.userId,
    },
  });
  await prisma.juryReviewResult.create({
    data: {
      id: reviewId, tenantId, reviewRequestId: requestId, boardRunId: `${reviewId}-board`, evidenceStrength: 'strong',
      claimStrength: 'weak', conflictDetected: false, overclaimDetected: false, revisionRequired: false,
      expectedDecision: 'VERIFY', finalSurface: face(`${id}-original`), contractVersion: JURY_CORE_CONTRACT_VERSION, completedAt: new Date(NOW),
    },
  });
  await prisma.juryHumanDecision.create({
    data: {
      id: humanId, tenantId, reviewResultId: reviewId, reviewRequestId: requestId, decision: 'VERIFY',
      actorUserId: actor.userId, createdAt: new Date(NOW),
    },
  });
  await prisma.juryImprovementTask.create({
    data: {
      id: taskId, tenantId, reviewResultId: reviewId, evidenceId, diagnosis: 'source', acceptanceCriteria: ['source'],
      status: 'OPEN', loopIndex: 0, loopPolicy: { maxIterations: null, maxRuntimeMs: null, maxCostUsd: null },
      taskType: 'VERIFICATION',
      provenance: { kind: 'human-decision-improvement', humanDecisionId: humanId, reviewRequestId: requestId, reviewResultId: reviewId },
      createdAt: new Date(NOW), updatedAt: new Date(NOW),
    },
  });
  await prisma.juryImprovementTask.create({
    data: {
      id: spareTaskId, tenantId, reviewResultId: reviewId, diagnosis: 'spare', acceptanceCriteria: ['spare'],
      status: 'OPEN', loopIndex: 0, loopPolicy: { maxIterations: null, maxRuntimeMs: null, maxCostUsd: null },
      taskType: 'VERIFICATION', createdAt: new Date(NOW), updatedAt: new Date(NOW),
    },
  });
  await prisma.juryAgentExecution.create({
    data: {
      id: executionId, tenantId, taskId, agent: 'CURSOR', allowedPaths: [], deniedPaths: [], status: 'COMPLETED',
      workspaceRef: { type: 'PROJECT', ref: 'phase55-fixture' }, provenance: { kind: 'human-agent-execution' },
      finishedAt: new Date(NOW), createdAt: new Date(NOW), updatedAt: new Date(NOW),
    },
  });
  await prisma.juryChangeGateResult.create({
    data: {
      id: gateId, tenantId, executionId, improvementTaskId: taskId, changedFiles: [], riskFlags: [],
      gate: 'PASS', status: 'APPROVED', createdAt: new Date(NOW), updatedAt: new Date(NOW),
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
      id: nextTaskId, tenantId, reviewResultId: reReviewResultId, parentTaskId: taskId, evidenceId,
      diagnosis: `${id}-diagnosis`, acceptanceCriteria: [`${id}-criterion`], status: 'OPEN', loopIndex: 0,
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
  return { reviewId, humanId, taskId, executionId, gateId, reReviewResultId, reReviewRequestId, nextTaskId, spareTaskId };
}

async function retargetGate(
  prisma: Awaited<typeof import('@/lib/prisma')>['prisma'],
  row: { reviewId: string; spareTaskId: string; reReviewResultId: string },
) {
  const executionId = `${row.reviewId}-decoy-exec`;
  const gateId = `${row.reviewId}-decoy-gate`;
  await prisma.juryAgentExecution.create({
    data: {
      id: executionId, tenantId: TENANT, taskId: row.spareTaskId, agent: 'CURSOR', allowedPaths: [], deniedPaths: [],
      status: 'COMPLETED', workspaceRef: { type: 'PROJECT', ref: 'phase55-fixture' }, provenance: { kind: 'human-agent-execution' },
      finishedAt: new Date(NOW), createdAt: new Date(NOW), updatedAt: new Date(NOW),
    },
  });
  await prisma.juryChangeGateResult.create({
    data: {
      id: gateId, tenantId: TENANT, executionId, improvementTaskId: row.spareTaskId, changedFiles: [], riskFlags: [],
      gate: 'PASS', status: 'APPROVED', createdAt: new Date(NOW), updatedAt: new Date(NOW),
    },
  });
  await prisma.juryChangeGateReview.updateMany({
    where: { reviewResultId: row.reReviewResultId, tenantId: TENANT },
    data: { changeGateResultId: gateId },
  });
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
  const [results, gates, gateReviews, tasks, cycles, loops, pending, running] = await Promise.all([
    prisma.juryReviewResult.count({ where }),
    prisma.juryChangeGateResult.count({ where }),
    prisma.juryChangeGateReview.count({ where }),
    prisma.juryImprovementTask.count({ where }),
    prisma.juryDecisionCycle.count({ where }),
    prisma.juryAutoLoopActivation.count({ where }),
    prisma.juryAgentExecution.count({ where: { ...where, status: 'PENDING' } }),
    prisma.juryAgentExecution.count({ where: { ...where, status: 'RUNNING' } }),
  ]);
  return { results, gates, gateReviews, tasks, cycles, loops, pending, running };
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
    where: { username: { in: ['phase55-owner', 'phase55-member', 'phase55-auditor', 'phase55-foreign'] } },
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
