import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import type { JuryActor } from './access';
import { evaluateHumanReReview } from './human-re-review';
import { loadReviewConsole, projectReviewConsole } from './review-console';
import { JURY_CORE_CONTRACT_VERSION, JURY_PRODUCT_DATA_ROOT, type JuryDecision, type JuryFinalSurface, type JuryMembership } from './records';
import type { ProductReviewCore } from './review-boundary';

const TENANT = 'phase53-rereview';
const FOREIGN = 'phase53-foreign';
const CONN = 'phase53-conn';
const EVIDENCE = 'phase53-evidence';
const NOW = '2026-10-02T13:40:00.000Z';
const LIVE_REVIEW = '3707202563ecae9b38f324a4eefd9243a14bc69420ed6cdda16c4c5794f62e0d';
const LIVE_CYCLE = '14308b4c999ccbe8ca54b7f31da5385385d4073c49bbf2955582a6bb96afb01e';

const owner = membership('phase53-owner-m', TENANT, 'phase53-owner', 'OWNER');
const auditor = membership('phase53-auditor-m', TENANT, 'phase53-auditor', 'AUDITOR');
const foreign = membership('phase53-foreign-m', FOREIGN, 'phase53-foreign', 'OWNER');
const ownerActor: JuryActor = { ok: true, userId: owner.userId, tenantId: TENANT, role: 'OWNER', membershipId: owner.id };
const auditorActor: JuryActor = { ok: true, userId: auditor.userId, tenantId: TENANT, role: 'AUDITOR', membershipId: auditor.id };

test('re-review control follows an approved owner gate', () => {
  const surface = face();
  const base = {
    actor: ownerActor,
    result: { id: 'verify', tenantId: TENANT, expectedDecision: 'VERIFY' as const, finalSurface: surface, completedAt: NOW },
    status: 'COMPLETED' as const,
    evidenceId: EVIDENCE,
    metrics: [],
    humanDecision: 'VERIFY' as const,
    improvementTask: { id: 'task', taskType: 'VERIFICATION' as const },
    agentExecution: { id: 'exec', status: 'COMPLETED', agent: 'CURSOR' },
    changeGate: { id: 'gate', status: 'APPROVED', discrepancy: false, reasons: [] },
  };
  const open = projectReviewConsole(base);
  assert.equal(open.ok, true);
  if (open.ok) {
    assert.equal(open.screen.canRunReReview, true);
    assert.equal(open.screen.reReview, null);
  }
  const gated = projectReviewConsole({ ...base, changeGate: { id: 'gate', status: 'GATED', discrepancy: true, reasons: [] } });
  assert.equal(gated.ok && gated.screen.canRunReReview, false);
  const blocked = projectReviewConsole({ ...base, changeGate: { id: 'gate', status: 'BLOCKED', discrepancy: false, reasons: [] } });
  assert.equal(blocked.ok && blocked.screen.canRunReReview, false);
  const pending = projectReviewConsole({ ...base, agentExecution: { id: 'exec', status: 'PENDING', agent: 'CURSOR' } });
  assert.equal(pending.ok && pending.screen.canRunReReview, false);
  const auditorScreen = projectReviewConsole({ ...base, actor: auditorActor });
  assert.equal(auditorScreen.ok && auditorScreen.screen.canRunReReview, false);
  const done = projectReviewConsole({
    ...base,
    reReview: { id: 'again', status: 'EXECUTED', reviewResultId: 'child', decision: 'VERIFY', completedAt: NOW },
  });
  assert.equal(done.ok, true);
  if (done.ok) {
    assert.equal(done.screen.canRunReReview, false);
    assert.equal(done.screen.reReview?.decision, 'VERIFY');
    assert.equal(done.screen.reviewId, 'verify');
  }
});

test('approved human execution reaches one re-review', { timeout: 180_000 }, async () => {
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
    const verify = await planted(prisma, 'phase53-verify', 'VERIFY', 'COMPLETED', 'APPROVED');
    const reword = await planted(prisma, 'phase53-reword', 'REWORD', 'COMPLETED', 'APPROVED');
    const gated = await planted(prisma, 'phase53-gated', 'VERIFY', 'COMPLETED', 'GATED');
    const blockedGate = await planted(prisma, 'phase53-blocked-gate', 'VERIFY', 'COMPLETED', 'BLOCKED');
    const pending = await planted(prisma, 'phase53-pending', 'VERIFY', 'PENDING', 'APPROVED');
    const running = await planted(prisma, 'phase53-running', 'VERIFY', 'RUNNING', 'APPROVED');
    const blockedExec = await planted(prisma, 'phase53-blocked-exec', 'VERIFY', 'BLOCKED', 'APPROVED');
    const accepted = await planted(prisma, 'phase53-accept', 'ACCEPT', 'COMPLETED', 'APPROVED');
    const missing = await planted(prisma, 'phase53-none', 'VERIFY', 'COMPLETED', 'APPROVED', { human: false });
    const resultMismatch = await planted(prisma, 'phase53-result', 'VERIFY', 'COMPLETED', 'APPROVED', { provenanceResult: 'other-result' });
    const requestMismatch = await planted(prisma, 'phase53-request', 'VERIFY', 'COMPLETED', 'APPROVED', { provenanceRequest: 'other-request' });
    const gateMismatch = await planted(prisma, 'phase53-gate-mismatch', 'VERIFY', 'COMPLETED', null);
    await planted(prisma, 'phase53-decoy', 'VERIFY', 'COMPLETED', 'APPROVED');
    const foreignExec = await planted(prisma, 'phase53-foreign-review', 'VERIFY', 'COMPLETED', 'APPROVED', { tenantId: FOREIGN });

    const before = cores;
    const opened = await run(verify.executionId, core);
    assert.equal(opened.ok, true, opened.ok ? '' : opened.reason);
    if (opened.ok) {
      assert.equal(opened.created, true);
      assert.equal(opened.reReview.status, 'EXECUTED');
      assert.ok(opened.reReview.reviewRequestId);
      assert.ok(opened.reReview.reviewResultId);
      assert.notEqual(opened.reReview.reviewResultId, verify.reviewId);
      assert.ok(opened.reReview.decision);
      assert.ok(opened.reReview.completedAt);
    }
    assert.equal(cores, before + 1);

    const again = await run(verify.executionId, core);
    assert.equal(again.ok, true);
    if (again.ok && opened.ok) {
      assert.equal(again.created, false);
      assert.equal(again.reReview.reviewResultId, opened.reReview.reviewResultId);
    }
    assert.equal(cores, before + 1);

    const reworded = await run(reword.executionId, core);
    assert.equal(reworded.ok, true, reworded.ok ? '' : reworded.reason);
    assert.equal(cores, before + 2);

    const [left, right] = await Promise.all([
      run('phase53-decoy-exec', core),
      run('phase53-decoy-exec', core),
    ]);
    assert.equal(left.ok || right.ok, true);
    assert.equal(await prisma.juryChangeGateReview.count({ where: { changeGateResultId: 'phase53-decoy-gate', tenantId: TENANT } }), 1);
    assert.equal(cores, before + 3);

    for (const executionId of [gated.executionId, blockedGate.executionId]) {
      const denied = await run(executionId, core);
      assert.equal(denied.ok, false);
      if (!denied.ok) assert.equal(denied.reason, 'RE-REVIEW_NOT_APPROVED');
    }
    for (const executionId of [pending.executionId, running.executionId, blockedExec.executionId]) {
      const denied = await run(executionId, core);
      assert.equal(denied.ok, false);
      if (!denied.ok) assert.equal(denied.reason, 'EXECUTION_NOT_COMPLETED');
    }
    for (const executionId of [accepted.executionId, missing.executionId, resultMismatch.executionId, requestMismatch.executionId]) {
      const denied = await run(executionId, core);
      assert.equal(denied.ok, false);
      if (!denied.ok) assert.equal(denied.reason, 'HUMAN_APPROVAL_REQUIRED');
    }
    const mismatchedGate = await run(gateMismatch.executionId, core);
    assert.equal(mismatchedGate.ok, false);
    if (!mismatchedGate.ok) assert.equal(mismatchedGate.reason, 'RE-REVIEW_NOT_APPROVED');
    const crossed = await run(foreignExec.executionId, core);
    assert.equal(crossed.ok, false);
    if (!crossed.ok) assert.equal(crossed.reason, 'NOT_FOUND');
    const auditorRun = await run(verify.executionId, core, auditor);
    assert.equal(auditorRun.ok, false);
    if (!auditorRun.ok) assert.equal(auditorRun.reason, 'FORBIDDEN');
    assert.equal(cores, before + 3);
    assert.equal(await prisma.juryChangeGateReview.count({ where: { tenantId: FOREIGN } }), 0);

    const original = await prisma.juryReviewResult.findFirst({ where: { id: verify.reviewId, tenantId: TENANT } });
    assert.equal(original?.expectedDecision, 'VERIFY');
    const human = await prisma.juryHumanDecision.findFirst({ where: { reviewResultId: verify.reviewId, tenantId: TENANT } });
    assert.equal(human?.decision, 'VERIFY');
    const task = await prisma.juryImprovementTask.findFirst({ where: { id: verify.taskId, tenantId: TENANT } });
    assert.equal(task?.status, 'OPEN');
    const gate = await prisma.juryChangeGateResult.findFirst({ where: { id: verify.gateId, tenantId: TENANT } });
    assert.equal(gate?.status, 'APPROVED');
    const zero = await prisma.juryNormalizedMetric.findFirst({ where: { id: 'phase53-zero', tenantId: TENANT } });
    const absent = await prisma.juryNormalizedMetric.findFirst({ where: { id: 'phase53-null', tenantId: TENANT } });
    assert.equal(zero?.value, 0);
    assert.equal(absent?.value, null);
    assert.equal(await prisma.juryEvidence.count({ where: { tenantId: TENANT } }), 1);
    assert.equal(await prisma.juryDecisionCycle.count({ where: { tenantId: { in: [TENANT, FOREIGN] } } }), 0);
    assert.equal(await prisma.juryAutoLoopActivation.count({ where: { tenantId: { in: [TENANT, FOREIGN] } } }), 0);
    assert.equal(await prisma.juryReReviewResult.count({ where: { tenantId: { in: [TENANT, FOREIGN] } } }), 0);

    const childId = opened.ok ? opened.reReview.reviewResultId : null;
    const child = await prisma.juryReviewResult.findFirst({ where: { id: childId ?? '', tenantId: TENANT } });
    assert.equal(child?.parentReviewResultId, verify.reviewId);
    assert.notEqual(child?.id, verify.reviewId);
    const shown = await loadReviewConsole(ownerActor, verify.reviewId);
    assert.equal(shown.ok, true);
    if (shown.ok) {
      assert.equal(shown.screen.reviewId, verify.reviewId);
      assert.equal(shown.screen.reReview?.reviewResultId, childId);
      assert.equal(shown.screen.canRunReReview, false);
    }
    const childScreen = await loadReviewConsole(ownerActor, childId ?? '');
    assert.equal(childScreen.ok, true);
    if (childScreen.ok && opened.ok) assert.equal(childScreen.screen.decision, opened.reReview.decision);
    const provenance = await prisma.juryChangeGateReview.findFirst({
      where: { changeGateResultId: verify.gateId, tenantId: TENANT },
      select: { provenance: true },
    });
    const text = JSON.stringify(provenance);
    assert.equal(text.includes(verify.reviewId), true);
    assert.equal(text.includes('phase53-verify-human'), true);
    assert.equal(text.includes('password'), false);
    assert.equal(text.includes('postgres://'), false);
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

test('human re-review reuses the existing change-gate review', () => {
  const source = readFileSync(path.resolve(process.cwd(), 'src/lib/jury-product/human-re-review.ts'), 'utf8');
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
  ]) {
    assert.equal(source.includes(token), false, token);
  }
  assert.equal(source.includes('persistChangeGateReReviewRequest'), true);
  assert.equal(source.includes('persistChangeGateReReviewExecution'), true);
  assert.equal(source.includes("action: 'review.start'"), true);
  assert.equal(source.includes('input.agentExecutionId'), true);
  const actions = readFileSync(path.resolve(process.cwd(), 'src/app/(root)/jury/actions.ts'), 'utf8');
  const fn = actions.slice(actions.indexOf('export async function runHumanReReview'), actions.indexOf('async function tenantReviewCore'));
  assert.equal(fn.includes("formData.get('agentExecutionId')"), true);
  for (const key of ['tenantId', 'reviewResultId', 'improvementTaskId', 'evidenceId', 'humanDecision', 'gateResult']) {
    assert.equal(fn.includes(`formData.get('${key}')`), false, key);
  }
  const ui = readFileSync(path.resolve(process.cwd(), 'src/app/(root)/jury/ui.tsx'), 'utf8');
  const gateBody = ui.slice(ui.indexOf('export function HumanChangeGateBody'), ui.indexOf('export function EvidenceBody'));
  assert.equal(gateBody.includes('Re-review'), false);
  const reviewBody = ui.slice(ui.indexOf('export function HumanReReviewBody'), ui.indexOf('export function HumanChangeGateBody'));
  assert.equal(reviewBody.includes('Run Re-review'), true);
  assert.equal(reviewBody.includes('Original Review'), true);
  assert.equal(reviewBody.includes('Re-review:'), true);
});

function run(agentExecutionId: string, core: ProductReviewCore, actor: JuryMembership = owner) {
  return evaluateHumanReReview({ userId: actor.userId, memberships: [actor], agentExecutionId, core });
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
  for (const actor of [owner, auditor, foreign]) {
    await prisma.user.create({ data: { id: actor.userId, username: actor.userId, email: `${actor.userId}@example.invalid` } });
    await prisma.juryTenant.upsert({ where: { id: actor.tenantId }, update: {}, create: { id: actor.tenantId, name: actor.tenantId } });
    await prisma.juryMembership.create({
      data: { id: actor.id, tenantId: actor.tenantId, userId: actor.userId, role: actor.role, createdAt: new Date(NOW) },
    });
  }
  await connection(prisma, CONN, TENANT);
  await connection(prisma, 'phase53-foreign-conn', FOREIGN);
  await prisma.juryAccessScope.create({
    data: {
      id: 'phase53-scope',
      tenantId: TENANT,
      connectionId: CONN,
      status: 'APPROVED',
      grants: [],
      approvedByUserId: owner.userId,
      approvedAt: new Date(NOW),
    },
  });
  await prisma.juryAccessScope.create({
    data: {
      id: 'phase53-foreign-scope',
      tenantId: FOREIGN,
      connectionId: 'phase53-foreign-conn',
      status: 'APPROVED',
      grants: [],
      approvedByUserId: foreign.userId,
      approvedAt: new Date(NOW),
    },
  });
  await evidenceRow(prisma, EVIDENCE, TENANT, CONN, ['phase53-zero', 'phase53-null']);
  await evidenceRow(prisma, 'phase53-foreign-evidence', FOREIGN, 'phase53-foreign-conn', []);
  await prisma.juryNormalizedMetric.create({ data: metric('phase53-zero', 'userCount', 0, 'AVAILABLE') });
  await prisma.juryNormalizedMetric.create({ data: metric('phase53-null', 'postsLast7d', null, 'NOT_MEASURED') });
}

async function planted(
  prisma: Awaited<typeof import('@/lib/prisma')>['prisma'],
  reviewId: string,
  action: JuryDecision,
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'BLOCKED',
  gate: 'APPROVED' | 'GATED' | 'BLOCKED' | null,
  patch: { human?: boolean; provenanceResult?: string; provenanceRequest?: string; tenantId?: string } = {},
) {
  const tenantId = patch.tenantId ?? TENANT;
  const requestId = `${reviewId}-req`;
  const connectionId = tenantId === TENANT ? CONN : 'phase53-foreign-conn';
  const evidenceId = tenantId === TENANT ? EVIDENCE : 'phase53-foreign-evidence';
  const actor = tenantId === TENANT ? owner : foreign;
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
      coreRootDir: JURY_PRODUCT_DATA_ROOT,
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
      expectedDecision: action === 'ACCEPT' ? 'ACCEPT' : action,
      finalSurface: face(),
      contractVersion: JURY_CORE_CONTRACT_VERSION,
      completedAt: new Date(NOW),
    },
  });
  const humanId = `${reviewId}-human`;
  if (patch.human !== false && action !== 'ACCEPT') {
    await prisma.juryHumanDecision.create({
      data: {
        id: humanId,
        tenantId,
        reviewResultId: reviewId,
        reviewRequestId: requestId,
        decision: action,
        actorUserId: actor.userId,
        createdAt: new Date(NOW),
      },
    });
  }
  if (action === 'ACCEPT') {
    await prisma.juryHumanDecision.create({
      data: {
        id: humanId,
        tenantId,
        reviewResultId: reviewId,
        reviewRequestId: requestId,
        decision: 'ACCEPT',
        actorUserId: actor.userId,
        createdAt: new Date(NOW),
      },
    });
  }
  const taskId = `${reviewId}-task`;
  const taskType = action === 'REWORD' ? 'REWORD' : 'VERIFICATION';
  await prisma.juryImprovementTask.create({
    data: {
      id: taskId,
      tenantId,
      reviewResultId: reviewId,
      evidenceId,
      diagnosis: 'steady',
      acceptanceCriteria: ['gap'],
      status: 'OPEN',
      loopIndex: 0,
      loopPolicy: { maxIterations: null, maxRuntimeMs: null, maxCostUsd: null },
      taskType: action === 'ACCEPT' ? 'VERIFICATION' : taskType,
      provenance: {
        kind: 'human-decision-improvement',
        humanDecisionId: patch.human === false ? 'missing-human' : humanId,
        reviewRequestId: patch.provenanceRequest ?? requestId,
        reviewResultId: patch.provenanceResult ?? reviewId,
      },
      createdAt: new Date(NOW),
      updatedAt: new Date(NOW),
    },
  });
  const executionId = `${reviewId}-exec`;
  await prisma.juryAgentExecution.create({
    data: {
      id: executionId,
      tenantId,
      taskId,
      agent: 'CURSOR',
      allowedPaths: [],
      deniedPaths: [],
      status,
      workspaceRef: { type: 'PROJECT', ref: 'phase53-fixture' },
      provenance: { kind: 'human-agent-execution' },
      finishedAt: new Date(NOW),
      createdAt: new Date(NOW),
      updatedAt: new Date(NOW),
    },
  });
  const gateId = `${reviewId}-gate`;
  if (gate) {
    await prisma.juryChangeGateResult.create({
      data: {
        id: gateId,
        tenantId,
        executionId,
        improvementTaskId: taskId,
        changedFiles: [],
        riskFlags: [],
        gate: gate === 'APPROVED' ? 'PASS' : gate === 'BLOCKED' ? 'BLOCK' : 'NEEDS_APPROVAL',
        status: gate,
        createdAt: new Date(NOW),
        updatedAt: new Date(NOW),
      },
    });
  }
  return { reviewId, requestId, taskId, executionId, gateId };
}

async function connection(prisma: Awaited<typeof import('@/lib/prisma')>['prisma'], id: string, tenantId: string) {
  await prisma.juryServiceConnection.create({
    data: {
      id,
      tenantId,
      serviceKey: id,
      displayName: id,
      accessMethod: 'FILE_UPLOAD',
      status: 'CONNECTED',
      createdByUserId: tenantId === TENANT ? owner.userId : foreign.userId,
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

async function liveSnapshot(prisma: Awaited<typeof import('@/lib/prisma')>['prisma']) {
  const review = await prisma.juryReviewResult.findUnique({
    where: { id: LIVE_REVIEW },
    select: { expectedDecision: true, parentReviewResultId: true, completedAt: true },
  });
  const cycle = await prisma.juryDecisionCycle.findUnique({ where: { id: LIVE_CYCLE } });
  return {
    review: review ? { ...review, completedAt: review.completedAt.toISOString() } : null,
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
  await prisma.juryChangeGateReview.deleteMany({ where });
  await prisma.juryReviewResult.deleteMany({ where: { tenantId: { in: tenants }, parentReviewResultId: { not: null } } });
  await prisma.juryReviewRequest.deleteMany({ where: { id: { in: children.map((row) => row.reviewRequestId) } } });
  await prisma.juryChangeGateResult.deleteMany({ where });
  await prisma.juryAgentExecution.deleteMany({ where });
  await prisma.juryImprovementTask.deleteMany({ where });
  await prisma.juryHumanDecision.deleteMany({ where });
  await prisma.juryReviewResult.deleteMany({ where });
  await prisma.juryReviewRequest.deleteMany({ where });
  await prisma.juryNormalizedMetric.deleteMany({ where });
  await prisma.juryEvidence.deleteMany({ where });
  await prisma.juryAccessScope.deleteMany({ where });
  await prisma.juryServiceConnection.deleteMany({ where });
  await prisma.juryAuditEvent.deleteMany({ where });
  await prisma.juryMembership.deleteMany({ where });
  await prisma.juryTenant.deleteMany({ where: { id: { in: tenants } } });
  await prisma.user.deleteMany({
    where: { username: { in: ['phase53-owner', 'phase53-auditor', 'phase53-foreign'] } },
  });
}

function membership(id: string, tenantId: string, userId: string, role: JuryMembership['role']): JuryMembership {
  return { id, tenantId, userId, role, createdAt: NOW };
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
