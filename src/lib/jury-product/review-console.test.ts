import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import type { JuryActor } from './access';
import {
  formatReviewMetric,
  humanDecisionAuditId,
  loadReviewConsole,
  noteHumanNextAction,
  planHumanNextAction,
  projectReviewConsole,
} from './review-console';
import { JURY_CORE_CONTRACT_VERSION, type JuryDecision, type JuryFinalSurface, type JuryMembership } from './records';

const TENANT = 'phase47-review';
const FOREIGN = 'phase47-foreign';
const CONN = 'phase47-conn';
const FOREIGN_CONN = 'phase47-foreign-conn';
const EVIDENCE = 'phase47-evidence';
const NOW = '2026-10-02T03:00:00.000Z';
const LIVE_REVIEW = '3707202563ecae9b38f324a4eefd9243a14bc69420ed6cdda16c4c5794f62e0d';
const LIVE_CYCLE = '14308b4c999ccbe8ca54b7f31da5385385d4073c49bbf2955582a6bb96afb01e';

const owner = membership('phase47-owner-m', TENANT, 'phase47-owner', 'OWNER');
const member = membership('phase47-member-m', TENANT, 'phase47-member', 'DEVELOPER');
const auditor = membership('phase47-auditor-m', TENANT, 'phase47-auditor', 'VIEWER');
const foreign = membership('phase47-foreign-m', FOREIGN, 'phase47-foreign', 'OWNER');
const ownerActor: JuryActor = { ok: true, userId: owner.userId, tenantId: TENANT, role: 'OWNER', membershipId: owner.id };
const memberActor: JuryActor = { ok: true, userId: member.userId, tenantId: TENANT, role: 'DEVELOPER', membershipId: member.id };
const auditorActor: JuryActor = { ok: true, userId: auditor.userId, tenantId: TENANT, role: 'VIEWER', membershipId: auditor.id };

test('review console keeps decision, zero, and null apart from hypotheses', () => {
  const surface = face();
  const accept = projectReviewConsole({
    actor: ownerActor,
    result: { id: 'accept', tenantId: TENANT, expectedDecision: 'ACCEPT', finalSurface: surface, completedAt: NOW },
    status: 'COMPLETED',
    evidenceId: EVIDENCE,
    metrics: [
      { id: 'zero', metric: 'newUsersLast7d', value: 0, availability: 'AVAILABLE' },
      { id: 'missing', metric: 'postsLast7d', value: null, availability: 'NOT_MEASURED' },
    ],
  });
  assert.equal(accept.ok, true);
  if (!accept.ok) return;
  assert.equal(accept.screen.decision, 'ACCEPT');
  assert.equal(accept.screen.decisionMeaning.length > 0, true);
  assert.equal(accept.screen.humanChoices.map((choice) => choice.label).join(','), '확인 완료,검증 필요,수정 필요');
  assert.equal(accept.screen.humanDecision, null);
  assert.equal(accept.screen.measured[0]?.text, '0');
  assert.equal(accept.screen.measured[0]?.value, 0);
  assert.equal(accept.screen.measured[1]?.value, null);
  assert.equal(accept.screen.measured[1]?.text, '측정되지 않음');
  assert.equal(accept.screen.measured[1]?.text.includes('0'), false);
  assert.equal(accept.screen.hypotheses[0], 'hypothesis');
  assert.notEqual(accept.screen.summary, accept.screen.measured[0]?.text);

  const verify = projectReviewConsole({
    actor: memberActor,
    result: { id: 'verify', tenantId: TENANT, expectedDecision: 'VERIFY', finalSurface: surface, completedAt: NOW },
    status: 'COMPLETED',
    evidenceId: EVIDENCE,
    metrics: [],
  });
  assert.equal(verify.ok, true);
  if (verify.ok) assert.equal(verify.screen.humanChoices.some((choice) => choice.code === 'ACCEPT'), true);

  const reword = projectReviewConsole({
    actor: ownerActor,
    result: { id: 'reword', tenantId: TENANT, expectedDecision: 'REWORD', finalSurface: surface, completedAt: NOW },
    status: 'COMPLETED',
    evidenceId: null,
    metrics: [],
  });
  assert.equal(reword.ok, true);
  if (reword.ok) {
    assert.equal(reword.screen.decision, 'REWORD');
    assert.equal(reword.screen.humanChoices.some((choice) => choice.label === '수정 필요'), true);
  }

  const read = projectReviewConsole({
    actor: auditorActor,
    result: { id: 'accept', tenantId: TENANT, expectedDecision: 'ACCEPT', finalSurface: surface, completedAt: NOW },
    status: 'COMPLETED',
    evidenceId: EVIDENCE,
    metrics: [],
  });
  assert.equal(read.ok, true);
  if (read.ok) {
    assert.equal(read.screen.decision, 'ACCEPT');
    assert.equal(read.screen.humanChoices.length, 0);
  }
  assert.equal(formatReviewMetric(0, 'AVAILABLE').text, '0');
  assert.equal(formatReviewMetric(null, 'NOT_MEASURED').value, null);
  const blocked = planHumanNextAction({
    actor: auditorActor,
    review: { id: 'accept', tenantId: TENANT, expectedDecision: 'ACCEPT' },
    action: 'ACCEPT',
  });
  assert.equal(blocked.ok, false);
  if (!blocked.ok) assert.equal(blocked.reason, 'FORBIDDEN');
  const invalid = planHumanNextAction({
    actor: ownerActor,
    review: { id: 'accept', tenantId: TENANT, expectedDecision: 'VERIFY' },
    action: 'FIX',
  });
  assert.equal(invalid.ok, false);
  if (!invalid.ok) assert.equal(invalid.reason, 'INVALID_ACTION');
  const differ = planHumanNextAction({
    actor: ownerActor,
    review: { id: 'accept', tenantId: TENANT, expectedDecision: 'VERIFY' },
    action: 'ACCEPT',
  });
  assert.equal(differ.ok, true);
  const foreignNote = planHumanNextAction({
    actor: ownerActor,
    review: { id: 'other', tenantId: FOREIGN, expectedDecision: 'VERIFY' },
    action: 'ACCEPT',
  });
  assert.equal(foreignNote.ok, false);
  if (!foreignNote.ok) assert.equal(foreignNote.reason, 'NOT_FOUND');
});

test('human decisions stay beside the jury result', { timeout: 120_000 }, async () => {
  loadEnv();
  const { prisma } = await import('@/lib/prisma');
  const liveBefore = await liveSnapshot(prisma);
  let cleanupError: string | null = null;
  try {
    await removeFixture(prisma);
    await seed(prisma);
    const ownerView = await loadReviewConsole(ownerActor, 'phase47-accept');
    assert.equal(ownerView.ok, true);
    if (ownerView.ok) {
      assert.equal(ownerView.screen.decision, 'ACCEPT');
      assert.equal(ownerView.screen.measured.find((row) => row.metric === 'newUsersLast7d')?.value, 0);
      assert.equal(ownerView.screen.measured.find((row) => row.metric === 'postsLast7d')?.value, null);
    }
    const verifySaved = await noteHumanNextAction({
      userId: member.userId,
      memberships: [member],
      reviewId: 'phase47-verify',
      action: 'VERIFY',
    });
    assert.equal(verifySaved.ok, true);
    if (verifySaved.ok) {
      assert.equal(verifySaved.persisted, true);
      assert.equal(verifySaved.created, true);
      assert.equal(verifySaved.juryDecision, 'VERIFY');
      assert.equal(verifySaved.humanDecision, 'VERIFY');
    }
    const again = await noteHumanNextAction({
      userId: owner.userId,
      memberships: [owner],
      reviewId: 'phase47-verify',
      action: 'VERIFY',
    });
    assert.equal(again.ok, true);
    if (again.ok) assert.equal(again.created, false);
    assert.equal(await prisma.juryHumanDecision.count({ where: { tenantId: TENANT, reviewResultId: 'phase47-verify' } }), 1);
    assert.equal(await prisma.juryAuditEvent.count({ where: { tenantId: TENANT, action: 'HUMAN_DECISION_RECORDED' } }), 1);

    const different = await noteHumanNextAction({
      userId: owner.userId,
      memberships: [owner],
      reviewId: 'phase47-verify',
      action: 'ACCEPT',
    });
    assert.equal(different.ok, false);
    if (!different.ok) assert.equal(different.reason, 'DECISION_LOCKED');
    const override = await noteHumanNextAction({
      userId: member.userId,
      memberships: [member],
      reviewId: 'phase47-accept',
      action: 'ACCEPT',
    });
    assert.equal(override.ok, true);
    if (override.ok) {
      assert.equal(override.juryDecision, 'ACCEPT');
      assert.equal(override.humanDecision, 'ACCEPT');
    }
    const differed = await noteHumanNextAction({
      userId: member.userId,
      memberships: [member],
      reviewId: 'phase47-differ',
      action: 'ACCEPT',
    });
    assert.equal(differed.ok, true);
    if (differed.ok) {
      assert.equal(differed.juryDecision, 'VERIFY');
      assert.equal(differed.humanDecision, 'ACCEPT');
    }
    const differJury = await prisma.juryReviewResult.findFirst({
      where: { id: 'phase47-differ', tenantId: TENANT },
      select: { expectedDecision: true },
    });
    assert.equal(differJury?.expectedDecision, 'VERIFY');

    const auditorNote = await noteHumanNextAction({
      userId: auditor.userId,
      memberships: [auditor],
      reviewId: 'phase47-accept',
      action: 'REWORD',
    });
    assert.equal(auditorNote.ok, false);
    if (!auditorNote.ok) assert.equal(auditorNote.reason, 'FORBIDDEN');
    const foreignNote = await noteHumanNextAction({
      userId: owner.userId,
      memberships: [owner],
      reviewId: 'phase47-foreign-review',
      action: 'VERIFY',
    });
    assert.equal(foreignNote.ok, false);
    if (!foreignNote.ok) assert.equal(foreignNote.reason, 'NOT_FOUND');
    const missing = await noteHumanNextAction({
      userId: owner.userId,
      memberships: [owner],
      reviewId: 'phase47-missing',
      action: 'ACCEPT',
    });
    assert.equal(missing.ok, false);
    if (!missing.ok) assert.equal(missing.reason, 'NOT_FOUND');
    const invalid = await noteHumanNextAction({
      userId: owner.userId,
      memberships: [owner],
      reviewId: 'phase47-accept',
      action: 'FIX',
    });
    assert.equal(invalid.ok, false);
    if (!invalid.ok) assert.equal(invalid.reason, 'INVALID_ACTION');

    const acceptRow = await prisma.juryHumanDecision.findFirst({
      where: { tenantId: TENANT, reviewResultId: 'phase47-accept' },
    });
    assert.equal(acceptRow?.decision, 'ACCEPT');
    const jury = await prisma.juryReviewResult.findFirst({
      where: { id: 'phase47-accept', tenantId: TENANT },
      select: { expectedDecision: true },
    });
    assert.equal(jury?.expectedDecision, 'ACCEPT');
    const verifyRow = await prisma.juryHumanDecision.findFirst({
      where: { tenantId: TENANT, reviewResultId: 'phase47-verify' },
      select: { decision: true, reviewRequestId: true },
    });
    assert.equal(verifyRow?.decision, 'VERIFY');
    assert.equal(verifyRow?.reviewRequestId, 'phase47-verify-req');
    const audit = await prisma.juryAuditEvent.findFirst({
      where: { tenantId: TENANT, reviewId: 'phase47-verify', action: 'HUMAN_DECISION_RECORDED' },
    });
    assert.equal(audit?.actor, member.userId);
    assert.equal(JSON.stringify(audit?.provenance).includes('credentialRef'), false);

    const zero = await prisma.juryNormalizedMetric.findFirst({ where: { id: 'phase47-zero' } });
    const missingMetric = await prisma.juryNormalizedMetric.findFirst({ where: { id: 'phase47-null' } });
    assert.equal(zero?.value, 0);
    assert.equal(missingMetric?.value, null);
    const shown = await loadReviewConsole(auditorActor, 'phase47-verify');
    assert.equal(shown.ok, true);
    if (shown.ok) {
      assert.equal(shown.screen.decision, 'VERIFY');
      assert.equal(shown.screen.humanDecision, 'VERIFY');
      assert.equal(shown.screen.humanChoices.length, 0);
    }

    await prisma.juryAuditEvent.create({
      data: {
        id: humanDecisionAuditId(TENANT, 'phase47-reword'),
        tenantId: TENANT,
        timestamp: new Date(NOW),
        actor: owner.userId,
        action: 'HUMAN_DECISION_RECORDED',
        reviewId: 'phase47-reword',
        decision: 'ACCEPT',
      },
    });
    await prisma.juryHumanDecision.deleteMany({ where: { reviewResultId: 'phase47-reword' } });
    const rolled = await noteHumanNextAction({
      userId: owner.userId,
      memberships: [owner],
      reviewId: 'phase47-reword',
      action: 'REWORD',
    });
    assert.equal(rolled.ok, false);
    if (!rolled.ok) assert.equal(rolled.reason, 'PERSISTENCE_FAILED');
    assert.equal(await prisma.juryHumanDecision.count({ where: { reviewResultId: 'phase47-reword' } }), 0);

    await prisma.juryAuditEvent.deleteMany({ where: { id: humanDecisionAuditId(TENANT, 'phase47-reword') } });
    const reworded = await noteHumanNextAction({
      userId: owner.userId,
      memberships: [owner],
      reviewId: 'phase47-reword',
      action: 'REWORD',
    });
    assert.equal(reworded.ok, true);

    assert.equal(await prisma.juryHumanDecision.count({ where: { tenantId: FOREIGN } }), 0);
    assert.equal(await prisma.juryAuditEvent.count({ where: { tenantId: FOREIGN } }), 0);
    assert.equal(await prisma.juryImprovementTask.count({ where: { tenantId: TENANT } }), 0);
    assert.equal(await prisma.juryAgentExecution.count({ where: { tenantId: TENANT } }), 0);
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

test('review console source stays off host collectors and improvement actions', () => {
  const source = readFileSync(path.resolve(process.cwd(), 'src/lib/jury-product/review-console.ts'), 'utf8');
  for (const token of ['buildEvidencePackFromDb', 'attachGa4Evidence', 'runAisleAdapter', 'GA4_PROPERTY_ID', 'GA4_SERVICE_ACCOUNT', 'findUnique', 'if (!value)']) {
    assert.equal(source.includes(token), false, token);
  }
  assert.equal(source.includes('tenantId: actor.tenantId'), true);
  const ui = readFileSync(path.resolve(process.cwd(), 'src/app/(root)/jury/ui.tsx'), 'utf8');
  const body = ui.slice(ui.indexOf('export function ReviewDetailBody'), ui.indexOf('const INTAKE_AVAILABILITY'));
  assert.equal(body.includes('acknowledgeHumanReview'), true);
  assert.equal(body.includes('name="reviewId"'), true);
  assert.equal(body.includes('name="action"'), true);
  assert.equal(body.includes('name="tenantId"'), false);
  assert.equal(body.includes('sourceRef'), false);
  assert.equal(body.includes('선택 완료'), true);
  assert.equal(body.includes('Jury Decision:'), true);
  assert.equal(body.includes('Human Decision:'), true);
  assert.equal(body.includes('아직 확인되지 않은 내용'), true);
  assert.equal(body.includes('Create Improvement Task'), true);
  assert.equal(body.includes('Improvement Task Created'), true);
  assert.equal(body.includes('createHumanImprovementTask'), true);
  for (const label of ['Send to Cursor', 'Auto Fix', 'Run Agent', 'Execute Improvement', 'Re-review']) {
    assert.equal(body.includes(label), false, label);
  }
  assert.equal(source.includes('확인 완료'), true);
  assert.equal(source.includes('검증 필요'), true);
  assert.equal(source.includes('수정 필요'), true);
  const actions = readFileSync(path.resolve(process.cwd(), 'src/app/(root)/jury/actions.ts'), 'utf8');
  const note = actions.slice(actions.indexOf('export async function acknowledgeHumanReview'));
  assert.equal(note.includes("formData.get('tenantId')"), false);
  assert.equal(note.includes('noteHumanNextAction'), true);
});

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
  await connection(prisma, CONN, TENANT);
  await connection(prisma, FOREIGN_CONN, FOREIGN);
  await evidence(prisma, EVIDENCE, TENANT, CONN);
  await evidence(prisma, 'phase47-foreign-evidence', FOREIGN, FOREIGN_CONN);
  await prisma.juryNormalizedMetric.create({
    data: metric('phase47-zero', TENANT, CONN, EVIDENCE, 'newUsersLast7d', 0, 'AVAILABLE'),
  });
  await prisma.juryNormalizedMetric.create({
    data: metric('phase47-null', TENANT, CONN, EVIDENCE, 'postsLast7d', null, 'NOT_MEASURED'),
  });
  await review(prisma, 'phase47-accept', 'phase47-accept-req', TENANT, CONN, EVIDENCE, 'ACCEPT');
  await review(prisma, 'phase47-verify', 'phase47-verify-req', TENANT, CONN, EVIDENCE, 'VERIFY');
  await review(prisma, 'phase47-reword', 'phase47-reword-req', TENANT, CONN, EVIDENCE, 'REWORD');
  await review(prisma, 'phase47-differ', 'phase47-differ-req', TENANT, CONN, EVIDENCE, 'VERIFY');
  await review(prisma, 'phase47-foreign-review', 'phase47-foreign-req', FOREIGN, FOREIGN_CONN, 'phase47-foreign-evidence', 'VERIFY');
}

function metric(
  id: string,
  tenantId: string,
  connectionId: string,
  evidenceId: string,
  name: string,
  value: number | null,
  availability: 'AVAILABLE' | 'NOT_MEASURED',
) {
  return {
    id,
    tenantId,
    connectionId,
    evidenceId,
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
      serviceKey: 'phase47',
      displayName: 'Phase 47',
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
      metricIds: id === EVIDENCE ? ['phase47-zero', 'phase47-null'] : [],
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
      boardRunId: 'phase47-board',
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
  await prisma.juryHumanDecision.deleteMany({ where });
  await prisma.juryReviewResult.deleteMany({ where });
  await prisma.juryReviewRequest.deleteMany({ where });
  await prisma.juryNormalizedMetric.deleteMany({ where });
  await prisma.juryEvidence.deleteMany({ where });
  await prisma.juryAuditEvent.deleteMany({ where });
  await prisma.juryAccessScope.deleteMany({ where });
  await prisma.juryServiceConnection.deleteMany({ where });
  await prisma.juryMembership.deleteMany({ where });
  await prisma.juryTenant.deleteMany({ where: { id: { in: [TENANT, FOREIGN] } } });
  await prisma.user.deleteMany({
    where: { username: { in: ['phase47-owner', 'phase47-member', 'phase47-auditor', 'phase47-foreign'] } },
  });
}
