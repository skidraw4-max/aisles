import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import type { JuryActor } from './access';
import { projectImprovementTrace } from './improvement-trace-console';
import { readImprovementTrace } from './improvement-trace-store';
import { loadReviewConsole, projectReviewConsole } from './review-console';
import { JURY_CORE_CONTRACT_VERSION, type JuryDecision, type JuryFinalSurface, type JuryMembership } from './records';
import { persistReReviewImprovement, reReviewImprovementTaskId } from './rereview-improvement-bridge';

const TENANT = 'phase54-rereview';
const FOREIGN = 'phase54-foreign';
const CONN = 'phase54-conn';
const EVIDENCE = 'phase54-evidence';
const NOW = '2026-10-02T14:20:00.000Z';
const LIVE_REVIEW = '3707202563ecae9b38f324a4eefd9243a14bc69420ed6cdda16c4c5794f62e0d';
const LIVE_CYCLE = '14308b4c999ccbe8ca54b7f31da5385385d4073c49bbf2955582a6bb96afb01e';

const owner = membership('phase54-owner-m', TENANT, 'phase54-owner', 'OWNER');
const member = membership('phase54-member-m', TENANT, 'phase54-member', 'MEMBER');
const auditor = membership('phase54-auditor-m', TENANT, 'phase54-auditor', 'AUDITOR');
const foreign = membership('phase54-foreign-m', FOREIGN, 'phase54-foreign', 'OWNER');
const ownerActor: JuryActor = { ok: true, userId: owner.userId, tenantId: TENANT, role: 'OWNER', membershipId: owner.id };
const auditorActor: JuryActor = { ok: true, userId: auditor.userId, tenantId: TENANT, role: 'AUDITOR', membershipId: auditor.id };

test('re-review improvement control follows the stored re-review decision', () => {
  const base = {
    actor: ownerActor,
    result: { id: 'original', tenantId: TENANT, expectedDecision: 'VERIFY' as const, finalSurface: face('steady'), completedAt: NOW },
    status: 'COMPLETED' as const,
    evidenceId: EVIDENCE,
    metrics: [],
    humanDecision: 'VERIFY' as const,
    improvementTask: { id: 'source', taskType: 'VERIFICATION' as const },
    agentExecution: { id: 'exec', status: 'COMPLETED', agent: 'CURSOR' },
    changeGate: { id: 'gate', status: 'APPROVED', discrepancy: false, reasons: [] },
    reReview: {
      id: 'cgr',
      status: 'EXECUTED',
      reviewRequestId: 'child-request',
      reviewResultId: 'child',
      decision: 'VERIFY' as const,
      completedAt: NOW,
    },
  };
  const verify = projectReviewConsole(base);
  assert.equal(verify.ok, true);
  if (verify.ok) {
    assert.equal(verify.screen.canCreateReReviewImprovement, true);
    assert.equal(verify.screen.nextImprovement, null);
    assert.equal(verify.screen.canRunReReview, false);
  }
  const reword = projectReviewConsole({
    ...base,
    reReview: { ...base.reReview, decision: 'REWORD' },
  });
  assert.equal(reword.ok && reword.screen.canCreateReReviewImprovement, true);
  const accept = projectReviewConsole({
    ...base,
    reReview: { ...base.reReview, decision: 'ACCEPT' },
  });
  assert.equal(accept.ok && accept.screen.canCreateReReviewImprovement, false);
  const tasked = projectReviewConsole({
    ...base,
    nextImprovement: { id: 'next', taskType: 'VERIFICATION', status: 'OPEN' },
  });
  assert.equal(tasked.ok && tasked.screen.canCreateReReviewImprovement, false);
  if (tasked.ok) assert.equal(tasked.screen.nextImprovement?.id, 'next');
  const reader = projectReviewConsole({ ...base, actor: auditorActor });
  assert.equal(reader.ok && reader.screen.canCreateReReviewImprovement, false);
});

test('re-review decision creates one next improvement task', async () => {
  loadEnv();
  const { prisma } = await import('@/lib/prisma');
  let cleanupError: string | null = null;
  const liveBefore = await liveSnapshot(prisma);
  try {
    await removeFixture(prisma);
    await seed(prisma);
    const accepted = await chain(prisma, 'phase54-accept', 'VERIFY', 'ACCEPT');
    const verify = await chain(prisma, 'phase54-verify', 'REWORD', 'VERIFY');
    const reword = await chain(prisma, 'phase54-reword', 'VERIFY', 'REWORD');
    const plain = await reviewOnly(prisma, 'phase54-plain');
    const lineage = await chain(prisma, 'phase54-lineage', 'VERIFY', 'VERIFY');
    await prisma.juryReviewResult.updateMany({
      where: { id: lineage.reReviewResultId, tenantId: TENANT },
      data: { parentReviewResultId: plain.reviewId },
    });
    const gateMismatch = await chain(prisma, 'phase54-gate', 'VERIFY', 'VERIFY');
    const decoyTask = `${gateMismatch.reviewId}-decoy-task`;
    await prisma.juryImprovementTask.create({
      data: {
        id: decoyTask,
        tenantId: TENANT,
        reviewResultId: gateMismatch.reviewId,
        diagnosis: 'decoy',
        acceptanceCriteria: ['decoy'],
        status: 'OPEN',
        loopIndex: 0,
        loopPolicy: { maxIterations: null, maxRuntimeMs: null, maxCostUsd: null },
        taskType: 'VERIFICATION',
        createdAt: new Date(NOW),
        updatedAt: new Date(NOW),
      },
    });
    const decoyExec = `${gateMismatch.reviewId}-decoy-exec`;
    await prisma.juryAgentExecution.create({
      data: {
        id: decoyExec,
        tenantId: TENANT,
        taskId: decoyTask,
        agent: 'CURSOR',
        allowedPaths: [],
        deniedPaths: [],
        status: 'COMPLETED',
        workspaceRef: { type: 'PROJECT', ref: 'phase54-fixture' },
        provenance: { kind: 'human-agent-execution' },
        finishedAt: new Date(NOW),
        createdAt: new Date(NOW),
        updatedAt: new Date(NOW),
      },
    });
    const decoyGate = `${gateMismatch.reviewId}-decoy-gate`;
    await prisma.juryChangeGateResult.create({
      data: {
        id: decoyGate,
        tenantId: TENANT,
        executionId: decoyExec,
        improvementTaskId: decoyTask,
        changedFiles: [],
        riskFlags: [],
        gate: 'PASS',
        status: 'APPROVED',
        createdAt: new Date(NOW),
        updatedAt: new Date(NOW),
      },
    });
    await prisma.juryChangeGateReview.updateMany({
      where: { id: gateMismatch.changeGateReviewId, tenantId: TENANT },
      data: { changeGateResultId: decoyGate },
    });
    const executionMismatch = await chain(prisma, 'phase54-exec', 'VERIFY', 'VERIFY');
    const spareTask = `${executionMismatch.reviewId}-spare-task`;
    await prisma.juryImprovementTask.create({
      data: {
        id: spareTask,
        tenantId: TENANT,
        reviewResultId: executionMismatch.reviewId,
        diagnosis: 'spare',
        acceptanceCriteria: ['spare'],
        status: 'OPEN',
        loopIndex: 0,
        loopPolicy: { maxIterations: null, maxRuntimeMs: null, maxCostUsd: null },
        taskType: 'VERIFICATION',
        createdAt: new Date(NOW),
        updatedAt: new Date(NOW),
      },
    });
    await prisma.juryAgentExecution.updateMany({
      where: { id: executionMismatch.executionId, tenantId: TENANT },
      data: { taskId: spareTask },
    });
    const humanMismatch = await chain(prisma, 'phase54-human', 'VERIFY', 'VERIFY', { humanProvenance: 'other-human' });
    const foreignChain = await chain(prisma, 'phase54-foreign-review', 'VERIFY', 'VERIFY', { tenantId: FOREIGN });
    const concurrentVerify = await chain(prisma, 'phase54-concurrent-verify', 'VERIFY', 'VERIFY');
    const concurrentReword = await chain(prisma, 'phase54-concurrent-reword', 'VERIFY', 'REWORD');
    const before = await counts(prisma);

    const plainResult = await run(plain.reviewId);
    assert.equal(plainResult.ok, false);
    if (!plainResult.ok) assert.equal(plainResult.reason, 'NOT_REREVIEW_RESULT');
    const foreignResult = await run(foreignChain.reReviewResultId);
    assert.equal(foreignResult.ok, false);
    if (!foreignResult.ok) assert.equal(foreignResult.reason, 'NOT_FOUND');
    for (const broken of [lineage, gateMismatch, executionMismatch, humanMismatch]) {
      const blocked = await run(broken.reReviewResultId);
      assert.equal(blocked.ok, false, broken.reviewId);
      if (!blocked.ok) assert.equal(blocked.reason, 'NOT_REREVIEW_RESULT');
    }
    const accept = await run(accepted.reReviewResultId);
    assert.equal(accept.ok, true);
    if (accept.ok) {
      assert.equal(accept.outcome, 'NO_IMPROVEMENT');
      assert.equal(accept.taskId, null);
      assert.equal(accept.created, false);
    }
    const auditorBlocked = await run(verify.reReviewResultId, auditor);
    assert.equal(auditorBlocked.ok, false);
    if (!auditorBlocked.ok) assert.equal(auditorBlocked.reason, 'FORBIDDEN');

    const opened = await run(verify.reReviewResultId, member);
    assert.equal(opened.ok, true);
    if (opened.ok) {
      assert.equal(opened.created, true);
      assert.equal(opened.outcome, 'IMPROVEMENT');
      assert.equal(opened.taskType, 'VERIFICATION');
      assert.equal(opened.taskId, reReviewImprovementTaskId(TENANT, verify.reReviewResultId));
    }
    const replay = await run(verify.reReviewResultId, owner);
    assert.equal(replay.ok, true);
    if (replay.ok && opened.ok) {
      assert.equal(replay.created, false);
      assert.equal(replay.taskId, opened.taskId);
    }
    const reworded = await run(reword.reReviewResultId);
    assert.equal(reworded.ok, true);
    if (reworded.ok) {
      assert.equal(reworded.created, true);
      assert.equal(reworded.taskType, 'REWORD');
    }
    const rewordReplay = await run(reword.reReviewResultId, owner);
    assert.equal(rewordReplay.ok, true);
    if (rewordReplay.ok && reworded.ok) assert.equal(rewordReplay.taskId, reworded.taskId);

    const [left, right] = await Promise.all([
      run(concurrentVerify.reReviewResultId, owner),
      run(concurrentVerify.reReviewResultId, member),
    ]);
    assert.equal(left.ok && right.ok, true);
    if (left.ok && right.ok) assert.equal(left.taskId, right.taskId);
    const [rewordLeft, rewordRight] = await Promise.all([
      run(concurrentReword.reReviewResultId, owner),
      run(concurrentReword.reReviewResultId, member),
    ]);
    assert.equal(rewordLeft.ok && rewordRight.ok, true);
    if (rewordLeft.ok && rewordRight.ok) {
      assert.equal(rewordLeft.taskType, 'REWORD');
      assert.equal(rewordLeft.taskId, rewordRight.taskId);
    }

    const verifyTask = await prisma.juryImprovementTask.findFirst({
      where: { id: reReviewImprovementTaskId(TENANT, verify.reReviewResultId), tenantId: TENANT },
    });
    assert.ok(verifyTask);
    assert.equal(verifyTask?.taskType, 'VERIFICATION');
    assert.equal(verifyTask?.reviewResultId, verify.reReviewResultId);
    assert.equal(verifyTask?.parentTaskId, verify.taskId);
    assert.equal(verifyTask?.diagnosis, 'phase54-verify-summary');
    assert.deepEqual(verifyTask?.acceptanceCriteria, ['phase54-verify-problem']);
    assert.equal(verifyTask?.evidenceId, EVIDENCE);
    assert.equal(verifyTask?.loopIndex, 0);
    const provenance = JSON.stringify(verifyTask?.provenance);
    assert.equal(provenance.includes(verify.reReviewResultId), true);
    assert.equal(provenance.includes(verify.reviewId), true);
    assert.equal(provenance.includes(verify.humanId), true);
    assert.equal(provenance.includes('password'), false);
    assert.equal(provenance.includes('postgres://'), false);
    assert.equal(await prisma.juryImprovementTask.count({
      where: { tenantId: TENANT, reviewResultId: verify.reReviewResultId },
    }), 1);
    assert.equal(await prisma.juryImprovementTask.count({
      where: { tenantId: TENANT, reviewResultId: reword.reReviewResultId },
    }), 1);
    assert.equal(await prisma.juryImprovementTask.count({
      where: { tenantId: TENANT, reviewResultId: accepted.reReviewResultId },
    }), 0);
    assert.equal(await prisma.juryAuditEvent.count({
      where: { tenantId: TENANT, reviewId: verify.reReviewResultId, action: 'IMPROVEMENT_TASK_CREATED' },
    }), 1);
    assert.equal(await prisma.juryAuditEvent.count({
      where: { tenantId: TENANT, reviewId: reword.reReviewResultId, action: 'IMPROVEMENT_TASK_CREATED' },
    }), 1);
    assert.equal(await prisma.juryAuditEvent.count({
      where: { tenantId: TENANT, reviewId: concurrentVerify.reReviewResultId, action: 'IMPROVEMENT_TASK_CREATED' },
    }), 1);
    assert.equal(await prisma.juryAuditEvent.count({
      where: { tenantId: TENANT, reviewId: concurrentReword.reReviewResultId, action: 'IMPROVEMENT_TASK_CREATED' },
    }), 1);
    assert.equal(await prisma.juryAuditEvent.count({
      where: { tenantId: TENANT, reviewId: accepted.reReviewResultId, action: 'IMPROVEMENT_TASK_CREATED' },
    }), 0);

    const after = await counts(prisma);
    assert.equal(after.executions, before.executions);
    assert.equal(after.gates, before.gates);
    assert.equal(after.gateReviews, before.gateReviews);
    assert.equal(after.humans, before.humans);
    assert.equal(after.results, before.results);
    assert.equal(after.cycles, 0);
    assert.equal(after.loops, 0);
    assert.equal(after.reReviewRows, 0);
    assert.equal(after.tasks, before.tasks + 4);
    const original = await prisma.juryReviewResult.findFirst({ where: { id: verify.reviewId, tenantId: TENANT } });
    const child = await prisma.juryReviewResult.findFirst({ where: { id: verify.reReviewResultId, tenantId: TENANT } });
    const human = await prisma.juryHumanDecision.findFirst({ where: { id: verify.humanId, tenantId: TENANT } });
    const gate = await prisma.juryChangeGateResult.findFirst({ where: { id: verify.gateId, tenantId: TENANT } });
    const execution = await prisma.juryAgentExecution.findFirst({ where: { id: verify.executionId, tenantId: TENANT } });
    assert.equal(original?.expectedDecision, 'VERIFY');
    assert.equal(child?.expectedDecision, 'VERIFY');
    assert.equal(human?.decision, 'REWORD');
    assert.equal(gate?.status, 'APPROVED');
    assert.equal(execution?.status, 'COMPLETED');
    const zero = await prisma.juryNormalizedMetric.findFirst({ where: { id: 'phase54-zero', tenantId: TENANT } });
    const missing = await prisma.juryNormalizedMetric.findFirst({ where: { id: 'phase54-null', tenantId: TENANT } });
    assert.equal(zero?.value, 0);
    assert.equal(missing?.value, null);
    assert.equal(await prisma.juryEvidence.count({ where: { tenantId: TENANT } }), 1);

    const shown = await loadReviewConsole(ownerActor, verify.reviewId);
    assert.equal(shown.ok, true);
    if (shown.ok) {
      assert.equal(shown.screen.reReview?.decision, 'VERIFY');
      assert.equal(shown.screen.nextImprovement?.taskType, 'VERIFICATION');
      assert.equal(shown.screen.canCreateReReviewImprovement, false);
      assert.equal(shown.screen.reviewId, verify.reviewId);
    }
    const traced = await readImprovementTrace({
      userId: owner.userId,
      memberships: [owner],
      improvementTaskId: verify.taskId,
    });
    assert.equal(traced.ok, true);
    if (traced.ok) {
      const timeline = projectImprovementTrace(traced.trace).timeline;
      assert.equal(timeline.some((item) => item.title === 'Re-review'), true);
      assert.equal(timeline.some((item) => item.title === 'Next Improvement Task' && item.status === 'VERIFICATION'), true);
    }
    assert.equal(await prisma.juryImprovementTask.count({
      where: { tenantId: FOREIGN, reviewResultId: foreignChain.reReviewResultId },
    }), 0);
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

test('re-review improvement bridge stays off host collectors and later phases', () => {
  const source = readFileSync(path.resolve(process.cwd(), 'src/lib/jury-product/rereview-improvement-bridge.ts'), 'utf8');
  for (const token of [
    'buildEvidencePackFromDb',
    'attachGa4Evidence',
    'runAisleAdapter',
    'GA4_PROPERTY_ID',
    'findUnique',
    'child_process',
    'persistImprovementAutoLoop',
    'recordDecisionCycle',
    'JuryDecisionCycle',
    'callFrozenReviewPipeline',
    'persistChangeGateReReview',
    'evaluateHumanChangeGate',
    'executeHumanAgentExecution',
    'persistHumanImprovement',
    'evaluateHumanReReview',
  ]) {
    assert.equal(source.includes(token), false, token);
  }
  assert.equal(source.includes("action: 'improvement.write'"), true);
  assert.equal(source.includes('input.reReviewResultId'), true);
  assert.equal(source.includes('humanImprovementTaskType'), true);
  assert.equal(source.includes('NO_IMPROVEMENT'), true);
  assert.equal(source.includes('containsSecret'), true);
  const actions = readFileSync(path.resolve(process.cwd(), 'src/app/(root)/jury/actions.ts'), 'utf8');
  const fn = actions.slice(actions.indexOf('export async function createReReviewImprovementTask'));
  assert.equal(fn.includes("formData.get('reReviewResultId')"), true);
  for (const key of ['tenantId', 'taskType', 'reviewId', 'diagnosis', 'acceptanceCriteria', 'humanDecision']) {
    assert.equal(fn.includes(`formData.get('${key}')`), false, key);
  }
  const ui = readFileSync(path.resolve(process.cwd(), 'src/app/(root)/jury/ui.tsx'), 'utf8');
  const reviewBody = ui.slice(ui.indexOf('export function HumanReReviewBody'), ui.indexOf('export function HumanChangeGateBody'));
  assert.equal(reviewBody.includes('Create Improvement Task'), true);
  assert.equal(reviewBody.includes('No improvement required'), true);
  assert.equal(reviewBody.includes('Next Improvement Task'), true);
  assert.equal(reviewBody.includes('Run Re-review'), true);
  for (const label of ['Send to Agent', 'Run Change Gate', 'Auto Fix', 'Run Loop']) {
    assert.equal(reviewBody.includes(label), false, label);
  }
  const gateBody = ui.slice(ui.indexOf('export function HumanChangeGateBody'), ui.indexOf('export function EvidenceBody'));
  assert.equal(gateBody.includes('Re-review'), false);
});

function run(reReviewResultId: string, actor: JuryMembership = member) {
  return persistReReviewImprovement({ userId: actor.userId, memberships: [actor], reReviewResultId });
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
  await connection(prisma, 'phase54-foreign-conn', FOREIGN, foreign.userId);
  await evidenceRow(prisma, EVIDENCE, TENANT, CONN);
  await evidenceRow(prisma, 'phase54-foreign-evidence', FOREIGN, 'phase54-foreign-conn');
  await prisma.juryNormalizedMetric.createMany({
    data: [
      metric('phase54-zero', 'userCount', 0, 'AVAILABLE'),
      metric('phase54-null', 'postsLast7d', null, 'NOT_MEASURED'),
    ],
  });
}

async function reviewOnly(prisma: Awaited<typeof import('@/lib/prisma')>['prisma'], id: string) {
  const requestId = `${id}-request`;
  const reviewId = `${id}-review`;
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
  return { reviewId, reReviewResultId: reviewId };
}

async function chain(
  prisma: Awaited<typeof import('@/lib/prisma')>['prisma'],
  id: string,
  humanDecision: JuryDecision,
  reDecision: JuryDecision,
  patch: { tenantId?: string; humanProvenance?: string } = {},
) {
  const tenantId = patch.tenantId ?? TENANT;
  const actor = tenantId === TENANT ? owner : foreign;
  const connectionId = tenantId === TENANT ? CONN : 'phase54-foreign-conn';
  const evidenceId = tenantId === TENANT ? EVIDENCE : 'phase54-foreign-evidence';
  const requestId = `${id}-request`;
  const reviewId = `${id}-review`;
  const humanId = `${id}-human`;
  const taskId = `${id}-task`;
  const executionId = `${id}-exec`;
  const gateId = `${id}-gate`;
  const childRequestId = `${id}-rerequest`;
  const reReviewResultId = `${id}-reresult`;
  const changeGateReviewId = `${id}-cgr`;
  await prisma.juryReviewRequest.create({
    data: {
      id: requestId,
      tenantId,
      connectionId,
      evidenceId,
      reviewType: 'FULL_REVIEW',
      claim: '측정된 범위의 문구만 사용한다.',
      mode: 'AISLE_SELF',
      status: 'COMPLETED',
      coreRootDir: 'data/jury-product',
      requestedByUserId: actor.userId,
    },
  });
  await prisma.juryReviewResult.create({
    data: {
      id: reviewId,
      tenantId,
      reviewRequestId: requestId,
      boardRunId: `${reviewId}-board`,
      evidenceStrength: 'strong',
      claimStrength: 'weak',
      conflictDetected: false,
      overclaimDetected: false,
      revisionRequired: false,
      expectedDecision: 'VERIFY',
      finalSurface: face(`${id}-original`),
      contractVersion: JURY_CORE_CONTRACT_VERSION,
      completedAt: new Date(NOW),
    },
  });
  await prisma.juryHumanDecision.create({
    data: {
      id: humanId,
      tenantId,
      reviewResultId: reviewId,
      reviewRequestId: requestId,
      decision: humanDecision,
      actorUserId: actor.userId,
      createdAt: new Date(NOW),
    },
  });
  await prisma.juryImprovementTask.create({
    data: {
      id: taskId,
      tenantId,
      reviewResultId: reviewId,
      evidenceId,
      diagnosis: 'source',
      acceptanceCriteria: ['source'],
      status: 'OPEN',
      loopIndex: 0,
      loopPolicy: { maxIterations: null, maxRuntimeMs: null, maxCostUsd: null },
      taskType: humanDecision === 'REWORD' ? 'REWORD' : 'VERIFICATION',
      provenance: {
        kind: 'human-decision-improvement',
        humanDecisionId: patch.humanProvenance ?? humanId,
        reviewRequestId: requestId,
        reviewResultId: reviewId,
      },
      createdAt: new Date(NOW),
      updatedAt: new Date(NOW),
    },
  });
  await prisma.juryAgentExecution.create({
    data: {
      id: executionId,
      tenantId,
      taskId,
      agent: 'CURSOR',
      allowedPaths: [],
      deniedPaths: [],
      status: 'COMPLETED',
      workspaceRef: { type: 'PROJECT', ref: 'phase54-fixture' },
      provenance: { kind: 'human-agent-execution' },
      finishedAt: new Date(NOW),
      createdAt: new Date(NOW),
      updatedAt: new Date(NOW),
    },
  });
  await prisma.juryChangeGateResult.create({
    data: {
      id: gateId,
      tenantId,
      executionId,
      improvementTaskId: taskId,
      changedFiles: [],
      riskFlags: [],
      gate: 'PASS',
      status: 'APPROVED',
      createdAt: new Date(NOW),
      updatedAt: new Date(NOW),
    },
  });
  await prisma.juryReviewRequest.create({
    data: {
      id: childRequestId,
      tenantId,
      connectionId,
      evidenceId,
      reviewType: 'FULL_REVIEW',
      claim: '측정된 범위의 문구만 사용한다.',
      mode: 'AISLE_SELF',
      status: 'COMPLETED',
      coreRootDir: 'data/jury-product',
      requestedByUserId: actor.userId,
    },
  });
  await prisma.juryReviewResult.create({
    data: {
      id: reReviewResultId,
      tenantId,
      reviewRequestId: childRequestId,
      boardRunId: `${reReviewResultId}-board`,
      evidenceStrength: 'strong',
      claimStrength: 'weak',
      conflictDetected: false,
      overclaimDetected: false,
      revisionRequired: reDecision === 'REWORD',
      expectedDecision: reDecision,
      finalSurface: face(`${id}-summary`, [`${id}-problem`]),
      contractVersion: JURY_CORE_CONTRACT_VERSION,
      completedAt: new Date(NOW),
      parentReviewResultId: reviewId,
    },
  });
  await prisma.juryChangeGateReview.create({
    data: {
      id: changeGateReviewId,
      tenantId,
      parentReviewResultId: reviewId,
      changeGateResultId: gateId,
      agentExecutionId: executionId,
      improvementTaskId: taskId,
      evidenceId,
      sourceEvidenceId: evidenceId,
      reason: { code: 'CHANGE_GATE_APPROVED', message: 'Approved change gate is ready for re-review.' },
      status: 'EXECUTED',
      source: 'CHANGE_GATE',
      reviewRequestId: childRequestId,
      reviewResultId: reReviewResultId,
      provenance: { kind: 'change-gate-rereview' },
      createdAt: new Date(NOW),
      updatedAt: new Date(NOW),
    },
  });
  return { reviewId, requestId, humanId, taskId, executionId, gateId, reReviewResultId, changeGateReviewId };
}

async function connection(
  prisma: Awaited<typeof import('@/lib/prisma')>['prisma'],
  id: string,
  tenantId: string,
  userId: string,
) {
  await prisma.juryServiceConnection.create({
    data: {
      id,
      tenantId,
      serviceKey: id,
      displayName: id,
      accessMethod: 'FILE_UPLOAD',
      status: 'CONNECTED',
      createdByUserId: userId,
    },
  });
}

async function evidenceRow(
  prisma: Awaited<typeof import('@/lib/prisma')>['prisma'],
  id: string,
  tenantId: string,
  connectionId: string,
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
      metricIds: [],
      adapterKey: 'console-declared',
      collectedAt: new Date(NOW),
      contentHash: `${id}-hash`,
      piiExcluded: true,
      readOnly: true,
    },
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
    sourceSystem: 'DATABASE' as const,
    sourceRef: 'tenant-declared',
    collectedAt: new Date(NOW),
    availability,
    rawPayloadRef: 'tenant-declared',
    adapterKey: 'console-declared',
    adapterVersion: 'v1',
    ruleId: 'normalize.tenant-declared.v1',
  };
}

async function counts(prisma: Awaited<typeof import('@/lib/prisma')>['prisma']) {
  const where = { tenantId: { in: [TENANT, FOREIGN] } };
  const [executions, gates, gateReviews, humans, results, tasks, cycles, loops, reReviewRows] = await Promise.all([
    prisma.juryAgentExecution.count({ where }),
    prisma.juryChangeGateResult.count({ where }),
    prisma.juryChangeGateReview.count({ where }),
    prisma.juryHumanDecision.count({ where }),
    prisma.juryReviewResult.count({ where }),
    prisma.juryImprovementTask.count({ where }),
    prisma.juryDecisionCycle.count({ where }),
    prisma.juryAutoLoopActivation.count({ where }),
    prisma.juryReReviewResult.count({ where }),
  ]);
  return { executions, gates, gateReviews, humans, results, tasks, cycles, loops, reReviewRows };
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
    results,
    tasks,
    executions,
    gates,
    gateReviews,
    cycles,
    loops,
    review: review
      ? { expectedDecision: review.expectedDecision, parentReviewResultId: review.parentReviewResultId, completedAt: review.completedAt.toISOString() }
      : null,
    cycle: cycle
      ? { status: cycle.status, iteration: cycle.iteration, updatedAt: cycle.updatedAt.toISOString() }
      : null,
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
    where: { username: { in: ['phase54-owner', 'phase54-member', 'phase54-auditor', 'phase54-foreign'] } },
  });
}

function membership(id: string, tenantId: string, userId: string, role: JuryMembership['role']): JuryMembership {
  return { id, tenantId, userId, role, createdAt: NOW };
}

function face(summary: string, problems: string[] = ['gap']): JuryFinalSurface {
  return {
    statusSummary: summary,
    topProblems: problems,
    expectedUserEffect: 'effect',
    risk: 'risk',
    dimensionEvidence: ['measured sentence'],
    supportedClaims: ['supported'],
    partiallySupportedClaims: ['partial'],
    hypotheses: ['hypothesis'],
  };
}
