import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import type { JuryActor } from './access';
import {
  humanImprovementAuditId,
  humanImprovementTaskId,
  persistHumanImprovement,
} from './human-improvement-bridge';
import { noteHumanNextAction, projectReviewConsole } from './review-console';
import { JURY_CORE_CONTRACT_VERSION, type JuryDecision, type JuryFinalSurface, type JuryMembership } from './records';

const TENANT = 'phase49-bridge';
const FOREIGN = 'phase49-foreign';
const CONN = 'phase49-conn';
const FOREIGN_CONN = 'phase49-foreign-conn';
const EVIDENCE = 'phase49-evidence';
const NOW = '2026-10-02T11:00:00.000Z';
const LIVE_REVIEW = '3707202563ecae9b38f324a4eefd9243a14bc69420ed6cdda16c4c5794f62e0d';
const LIVE_CYCLE = '14308b4c999ccbe8ca54b7f31da5385385d4073c49bbf2955582a6bb96afb01e';

const owner = membership('phase49-owner-m', TENANT, 'phase49-owner', 'OWNER');
const member = membership('phase49-member-m', TENANT, 'phase49-member', 'MEMBER');
const auditor = membership('phase49-auditor-m', TENANT, 'phase49-auditor', 'AUDITOR');
const foreign = membership('phase49-foreign-m', FOREIGN, 'phase49-foreign', 'OWNER');
const ownerActor: JuryActor = { ok: true, userId: owner.userId, tenantId: TENANT, role: 'OWNER', membershipId: owner.id };
const auditorActor: JuryActor = { ok: true, userId: auditor.userId, tenantId: TENANT, role: 'AUDITOR', membershipId: auditor.id };

test('human improvement controls follow the stored decision', () => {
  const surface = face();
  const verify = projectReviewConsole({
    actor: ownerActor,
    result: { id: 'verify', tenantId: TENANT, expectedDecision: 'VERIFY', finalSurface: surface, completedAt: NOW },
    status: 'COMPLETED',
    evidenceId: EVIDENCE,
    metrics: [],
    humanDecision: 'VERIFY',
  });
  assert.equal(verify.ok, true);
  if (verify.ok) {
    assert.equal(verify.screen.canCreateImprovement, true);
    assert.equal(verify.screen.improvementTask, null);
  }
  const accept = projectReviewConsole({
    actor: ownerActor,
    result: { id: 'accept', tenantId: TENANT, expectedDecision: 'VERIFY', finalSurface: surface, completedAt: NOW },
    status: 'COMPLETED',
    evidenceId: EVIDENCE,
    metrics: [],
    humanDecision: 'ACCEPT',
  });
  assert.equal(accept.ok, true);
  if (accept.ok) assert.equal(accept.screen.canCreateImprovement, false);
  const created = projectReviewConsole({
    actor: ownerActor,
    result: { id: 'reword', tenantId: TENANT, expectedDecision: 'REWORD', finalSurface: surface, completedAt: NOW },
    status: 'COMPLETED',
    evidenceId: EVIDENCE,
    metrics: [],
    humanDecision: 'REWORD',
    improvementTask: { id: 'task-1', taskType: 'REWORD' },
  });
  assert.equal(created.ok, true);
  if (created.ok) {
    assert.equal(created.screen.canCreateImprovement, false);
    assert.equal(created.screen.improvementTask?.taskType, 'REWORD');
  }
  const reader = projectReviewConsole({
    actor: auditorActor,
    result: { id: 'verify', tenantId: TENANT, expectedDecision: 'VERIFY', finalSurface: surface, completedAt: NOW },
    status: 'COMPLETED',
    evidenceId: EVIDENCE,
    metrics: [],
    humanDecision: 'VERIFY',
  });
  assert.equal(reader.ok, true);
  if (reader.ok) assert.equal(reader.screen.canCreateImprovement, false);
});

test('stored human decisions choose whether an improvement task exists', { timeout: 120_000 }, async () => {
  loadEnv();
  const { prisma } = await import('@/lib/prisma');
  const liveBefore = await liveSnapshot(prisma);
  let cleanupError: string | null = null;
  try {
    await removeFixture(prisma);
    await seed(prisma);
    await note(owner, 'phase49-verify', 'VERIFY');
    await note(owner, 'phase49-reword', 'REWORD');
    await note(owner, 'phase49-verify-accept', 'ACCEPT');
    await note(owner, 'phase49-reword-accept', 'ACCEPT');
    await note(owner, 'phase49-rollback', 'REWORD');

    const auditorTry = await persistHumanImprovement({
      userId: auditor.userId,
      memberships: [auditor],
      reviewId: 'phase49-verify',
    });
    assert.equal(auditorTry.ok, false);
    if (!auditorTry.ok) assert.equal(auditorTry.reason, 'FORBIDDEN');
    assert.equal(await prisma.juryImprovementTask.count({ where: { tenantId: TENANT } }), 0);

    const foreignTry = await persistHumanImprovement({
      userId: foreign.userId,
      memberships: [foreign],
      reviewId: 'phase49-verify',
    });
    assert.equal(foreignTry.ok, false);
    if (!foreignTry.ok) assert.equal(foreignTry.reason, 'NOT_FOUND');
    assert.equal(await prisma.juryImprovementTask.count({ where: { tenantId: FOREIGN } }), 0);
    assert.equal(await prisma.juryAuditEvent.count({ where: { tenantId: FOREIGN, action: 'IMPROVEMENT_TASK_CREATED' } }), 0);

    const missing = await persistHumanImprovement({
      userId: owner.userId,
      memberships: [owner],
      reviewId: 'phase49-missing',
    });
    assert.equal(missing.ok, false);
    if (!missing.ok) assert.equal(missing.reason, 'NOT_FOUND');

    const noHuman = await persistHumanImprovement({
      userId: owner.userId,
      memberships: [owner],
      reviewId: 'phase49-none',
    });
    assert.equal(noHuman.ok, false);
    if (!noHuman.ok) assert.equal(noHuman.reason, 'HUMAN_DECISION_REQUIRED');
    assert.equal(await prisma.juryImprovementTask.count({ where: { reviewResultId: 'phase49-none' } }), 0);

    const verifyTask = await persistHumanImprovement({
      userId: owner.userId,
      memberships: [owner],
      reviewId: 'phase49-verify',
    });
    assert.equal(verifyTask.ok, true);
    if (verifyTask.ok) {
      assert.equal(verifyTask.created, true);
      assert.equal(verifyTask.juryDecision, 'VERIFY');
      assert.equal(verifyTask.humanDecision, 'VERIFY');
      assert.equal(verifyTask.taskType, 'VERIFICATION');
    }
    const verifyAgain = await persistHumanImprovement({
      userId: member.userId,
      memberships: [member],
      reviewId: 'phase49-verify',
    });
    assert.equal(verifyAgain.ok, true);
    if (verifyAgain.ok) assert.equal(verifyAgain.created, false);
    assert.equal(await prisma.juryImprovementTask.count({ where: { tenantId: TENANT, reviewResultId: 'phase49-verify' } }), 1);
    assert.equal(await prisma.juryAuditEvent.count({
      where: { tenantId: TENANT, reviewId: 'phase49-verify', action: 'IMPROVEMENT_TASK_CREATED' },
    }), 1);

    const rewordTask = await persistHumanImprovement({
      userId: member.userId,
      memberships: [member],
      reviewId: 'phase49-reword',
    });
    assert.equal(rewordTask.ok, true);
    if (rewordTask.ok) {
      assert.equal(rewordTask.created, true);
      assert.equal(rewordTask.humanDecision, 'REWORD');
      assert.equal(rewordTask.taskType, 'REWORD');
    }
    assert.equal(await prisma.juryImprovementTask.count({ where: { tenantId: TENANT, reviewResultId: 'phase49-reword' } }), 1);

    const verifyAccept = await persistHumanImprovement({
      userId: owner.userId,
      memberships: [owner],
      reviewId: 'phase49-verify-accept',
    });
    assert.equal(verifyAccept.ok, true);
    if (verifyAccept.ok) {
      assert.equal(verifyAccept.humanDecision, 'ACCEPT');
      assert.equal(verifyAccept.taskId, null);
    }
    const verifyAcceptAgain = await persistHumanImprovement({
      userId: owner.userId,
      memberships: [owner],
      reviewId: 'phase49-verify-accept',
    });
    assert.equal(verifyAcceptAgain.ok, true);
    if (verifyAcceptAgain.ok) assert.equal(verifyAcceptAgain.created, false);
    assert.equal(await prisma.juryImprovementTask.count({ where: { reviewResultId: 'phase49-verify-accept' } }), 0);

    const rewordAccept = await persistHumanImprovement({
      userId: owner.userId,
      memberships: [owner],
      reviewId: 'phase49-reword-accept',
    });
    assert.equal(rewordAccept.ok, true);
    if (rewordAccept.ok) assert.equal(rewordAccept.juryDecision, 'REWORD');
    assert.equal(await prisma.juryImprovementTask.count({ where: { reviewResultId: 'phase49-reword-accept' } }), 0);
    assert.equal(await prisma.juryReviewResult.findFirst({
      where: { id: 'phase49-reword-accept', tenantId: TENANT },
      select: { expectedDecision: true },
    }).then((row) => row?.expectedDecision), 'REWORD');
    assert.equal(await prisma.juryHumanDecision.findFirst({
      where: { tenantId: TENANT, reviewResultId: 'phase49-verify-accept' },
      select: { decision: true },
    }).then((row) => row?.decision), 'ACCEPT');

    const stored = await prisma.juryImprovementTask.findFirst({
      where: { tenantId: TENANT, reviewResultId: 'phase49-verify' },
    });
    const provenance = JSON.stringify(stored?.provenance);
    assert.equal(stored?.taskType, 'VERIFICATION');
    assert.equal(provenance.includes('"humanDecision":"VERIFY"'), true);
    assert.equal(provenance.includes('"juryDecision":"VERIFY"'), true);
    assert.equal(provenance.includes('credentialRef'), false);
    assert.equal(provenance.includes('rawPayload'), false);
    const audit = await prisma.juryAuditEvent.findFirst({
      where: { tenantId: TENANT, reviewId: 'phase49-verify', action: 'IMPROVEMENT_TASK_CREATED' },
    });
    const auditText = JSON.stringify(audit?.provenance);
    assert.equal(audit?.improvementTaskId, stored?.id);
    assert.equal(auditText.includes('humanDecisionId'), true);
    assert.equal(auditText.includes('credential'), false);

    const shown = await (await import('./review-console')).loadReviewConsole(ownerActor, 'phase49-verify');
    assert.equal(shown.ok, true);
    if (shown.ok) {
      assert.equal(shown.screen.improvementTask?.taskType, 'VERIFICATION');
      assert.equal(shown.screen.canCreateImprovement, false);
      assert.equal(shown.screen.measured.find((row) => row.metric === 'newUsersLast7d')?.value, 0);
      assert.equal(shown.screen.measured.find((row) => row.metric === 'postsLast7d')?.value, null);
    }

    const human = await prisma.juryHumanDecision.findFirst({
      where: { tenantId: TENANT, reviewResultId: 'phase49-rollback' },
      select: { id: true },
    });
    assert.ok(human);
    await prisma.juryAuditEvent.create({
      data: {
        id: humanImprovementAuditId(TENANT, humanImprovementTaskId(TENANT, 'phase49-rollback', human.id)),
        tenantId: TENANT,
        timestamp: new Date(NOW),
        actor: owner.userId,
        action: 'IMPROVEMENT_TASK_CREATED',
        reviewId: 'phase49-rollback',
        decision: 'REWORD',
      },
    });
    const rolled = await persistHumanImprovement({
      userId: owner.userId,
      memberships: [owner],
      reviewId: 'phase49-rollback',
    });
    assert.equal(rolled.ok, false);
    if (!rolled.ok) assert.equal(rolled.reason, 'PERSISTENCE_FAILED');
    assert.equal(await prisma.juryImprovementTask.count({ where: { reviewResultId: 'phase49-rollback' } }), 0);
    await prisma.juryAuditEvent.deleteMany({
      where: { id: humanImprovementAuditId(TENANT, humanImprovementTaskId(TENANT, 'phase49-rollback', human.id)) },
    });
    const restored = await persistHumanImprovement({
      userId: owner.userId,
      memberships: [owner],
      reviewId: 'phase49-rollback',
    });
    assert.equal(restored.ok, true);
    if (restored.ok) assert.equal(restored.created, true);

    const zero = await prisma.juryNormalizedMetric.findFirst({ where: { id: 'phase49-zero', tenantId: TENANT } });
    const absent = await prisma.juryNormalizedMetric.findFirst({ where: { id: 'phase49-null', tenantId: TENANT } });
    assert.equal(zero?.value, 0);
    assert.equal(zero?.availability, 'AVAILABLE');
    assert.equal(absent?.value, null);
    assert.equal(absent?.availability, 'NOT_MEASURED');
    assert.equal(await prisma.juryAgentExecution.count({ where: { tenantId: TENANT } }), 0);
    assert.equal(await prisma.juryChangeGateResult.count({ where: { tenantId: TENANT } }), 0);
    assert.equal(await prisma.juryChangeGateReview.count({ where: { tenantId: TENANT } }), 0);
    assert.equal(await prisma.juryReReviewResult.count({ where: { tenantId: TENANT } }), 0);
    assert.equal(await prisma.juryDecisionCycle.count({ where: { tenantId: TENANT } }), 0);
    assert.equal(await prisma.juryAutoLoopActivation.count({ where: { tenantId: TENANT } }), 0);
    assert.equal(await prisma.juryDecisionTask.count({ where: { tenantId: TENANT } }), 0);
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

test('human improvement bridge stays off host collectors and agent execution', () => {
  const source = readFileSync(path.resolve(process.cwd(), 'src/lib/jury-product/human-improvement-bridge.ts'), 'utf8');
  for (const token of ['buildEvidencePackFromDb', 'attachGa4Evidence', 'runAisleAdapter', 'GA4_PROPERTY_ID', 'GA4_SERVICE_ACCOUNT', 'findUnique', 'AgentExecution', 'FULL_AUTO', 'TASK_ONLY']) {
    assert.equal(source.includes(token), false, token);
  }
  assert.equal(source.includes('input.reviewId'), true);
  assert.equal(source.includes('input.decision'), false);
  assert.equal(source.includes("action: 'improvement.write'"), true);
  const actions = readFileSync(path.resolve(process.cwd(), 'src/app/(root)/jury/actions.ts'), 'utf8');
  const fn = actions.slice(actions.indexOf('export async function createHumanImprovementTask'), actions.indexOf('async function tenantReviewCore'));
  assert.equal(fn.includes("formData.get('reviewId')"), true);
  assert.equal(fn.includes("formData.get('tenantId')"), false);
  assert.equal(fn.includes("formData.get('decision')"), false);
  assert.equal(fn.includes("formData.get('action')"), false);
  assert.equal(fn.includes('reviewRequestId'), false);
  assert.equal(fn.includes('humanDecisionId'), false);
  const ui = readFileSync(path.resolve(process.cwd(), 'src/app/(root)/jury/ui.tsx'), 'utf8');
  const body = ui.slice(ui.indexOf('export function ReviewDetailBody'), ui.indexOf('const INTAKE_AVAILABILITY'));
  assert.equal(body.includes('Create Improvement Task'), true);
  assert.equal(body.includes('Improvement Task Created'), true);
  for (const label of ['Send to Cursor', 'Run Agent', 'Auto Fix', 'Execute Improvement', 'Re-review']) {
    assert.equal(body.includes(label), false, label);
  }
});

async function note(actor: JuryMembership, reviewId: string, action: JuryDecision) {
  const saved = await noteHumanNextAction({
    userId: actor.userId,
    memberships: [actor],
    reviewId,
    action,
  });
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
  await prisma.juryServiceConnection.create({
    data: {
      id: CONN,
      tenantId: TENANT,
      serviceKey: 'phase49',
      displayName: 'Phase 49',
      accessMethod: 'FILE_UPLOAD',
      status: 'DISCOVERY_PENDING',
      credentialRef: null,
    },
  });
  await prisma.juryServiceConnection.create({
    data: {
      id: FOREIGN_CONN,
      tenantId: FOREIGN,
      serviceKey: 'phase49',
      displayName: 'Phase 49',
      accessMethod: 'FILE_UPLOAD',
      status: 'DISCOVERY_PENDING',
      credentialRef: null,
    },
  });
  await prisma.juryEvidence.create({
    data: {
      id: EVIDENCE,
      tenantId: TENANT,
      connectionId: CONN,
      purpose: 'tenant-declared-observation',
      periodStart: '2026-09-25',
      periodEnd: '2026-10-01',
      timezone: 'Asia/Seoul',
      metricIds: ['phase49-zero', 'phase49-null'],
      adapterKey: 'console-declared',
      collectedAt: new Date(NOW),
      piiExcluded: true,
      readOnly: true,
    },
  });
  await prisma.juryEvidence.create({
    data: {
      id: 'phase49-foreign-evidence',
      tenantId: FOREIGN,
      connectionId: FOREIGN_CONN,
      purpose: 'tenant-declared-observation',
      periodStart: '2026-09-25',
      periodEnd: '2026-10-01',
      timezone: 'Asia/Seoul',
      metricIds: [],
      adapterKey: 'console-declared',
      collectedAt: new Date(NOW),
      piiExcluded: true,
      readOnly: true,
    },
  });
  await prisma.juryNormalizedMetric.create({
    data: metric('phase49-zero', 'newUsersLast7d', 0, 'AVAILABLE'),
  });
  await prisma.juryNormalizedMetric.create({
    data: metric('phase49-null', 'postsLast7d', null, 'NOT_MEASURED'),
  });
  await review(prisma, 'phase49-verify', 'phase49-verify-req', TENANT, CONN, EVIDENCE, 'VERIFY');
  await review(prisma, 'phase49-reword', 'phase49-reword-req', TENANT, CONN, EVIDENCE, 'REWORD');
  await review(prisma, 'phase49-verify-accept', 'phase49-verify-accept-req', TENANT, CONN, EVIDENCE, 'VERIFY');
  await review(prisma, 'phase49-reword-accept', 'phase49-reword-accept-req', TENANT, CONN, EVIDENCE, 'REWORD');
  await review(prisma, 'phase49-none', 'phase49-none-req', TENANT, CONN, EVIDENCE, 'VERIFY');
  await review(prisma, 'phase49-rollback', 'phase49-rollback-req', TENANT, CONN, EVIDENCE, 'REWORD');
  await review(prisma, 'phase49-foreign-review', 'phase49-foreign-req', FOREIGN, FOREIGN_CONN, 'phase49-foreign-evidence', 'VERIFY');
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
      boardRunId: 'phase49-board',
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
    where: { username: { in: ['phase49-owner', 'phase49-member', 'phase49-auditor', 'phase49-foreign'] } },
  });
}
