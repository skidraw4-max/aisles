/**
 * One isolated Product tenant proves the existing auto loop on real persistence.
 * It deletes that tenant afterwards and does not call a live review.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';
import type { AgentAdapter } from './agents/agent-adapter';
import { FIXTURE_ROOT } from './improvement-loop-fixture';
import { persistAutoLoopActivation, persistAutoLoopMode } from './auto-loop-activation-store';
import { persistIntegratedAutoLoop } from './improvement-auto-loop-integration';
import { persistReReviewDecision } from './decision-cycle-resolution-store';
import { persistChangeGateReReviewRequest } from './change-gate-rereview-store';
import { persistImprovementAgentRun } from './improvement-agent-run-store';
import { JURY_CORE_CONTRACT_VERSION, JURY_PRODUCT_DATA_ROOT, type JuryMembership } from './records';
import type { FrozenCoreReading, ProductReviewCore } from './review-boundary';
import { persistProductReview } from './review-store';

const TENANT = 'phase34-integration';
const FOREIGN = 'phase34-foreign';
const NOTE = 'phase34-note.md';
const LIVE_REVIEW = '3707202563ecae9b38f324a4eefd9243a14bc69420ed6cdda16c4c5794f62e0d';
const LIVE_CYCLE = '14308b4c999ccbe8ca54b7f31da5385385d4073c49bbf2955582a6bb96afb01e';
const NOW = '2026-10-02T04:00:00.000Z';
const SECRET_PROBE = 'postgres://hidden';

function loadEnv(): void {
  for (const [file, override] of [
    ['.env', false],
    ['.env.local', true],
  ] as const) {
    let text = '';
    try {
      text = readFileSync(path.resolve(process.cwd(), file), 'utf8');
    } catch {
      continue;
    }
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq < 1) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (override || process.env[key] === undefined) process.env[key] = value;
    }
  }
}

function stable(label: string): string {
  return createHash('sha256').update(`phase34:${label}`).digest('hex');
}

const IDS = {
  connection: stable('connection'),
  scope: stable('scope'),
  evidence: stable('evidence'),
  metricDb: stable('metric-db'),
  metricGa4: stable('metric-ga4'),
  request: stable('root-request'),
  review: stable('root-review'),
};

function membership(id: string, tenantId: string, userId: string, role: JuryMembership['role']): JuryMembership {
  return { id, tenantId, userId, role, createdAt: NOW };
}

function surface(): FrozenCoreReading['finalSurface'] {
  return {
    statusSummary: 'measured',
    topProblems: [],
    expectedUserEffect: '',
    risk: '',
    dimensionEvidence: [],
    supportedClaims: [],
    partiallySupportedClaims: [],
    hypotheses: [],
  };
}

function reading(decision: 'VERIFY' | 'ACCEPT'): FrozenCoreReading {
  return {
    boardRunId: decision === 'VERIFY' ? 'run-phase34-verify' : 'run-phase34-accept',
    evidenceStrength: 'strong',
    claimStrength: 'weak',
    conflictDetected: false,
    overclaimDetected: false,
    revisionRequired: false,
    expectedDecision: decision,
    finalSurface: surface(),
    completedAt: NOW,
  };
}

function safeMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : 'failed';
  return message.replace(/postgres(?:ql)?:\/\/\S+/gi, '[redacted]').slice(0, 240);
}

test('phase 34 persisted auto loop stays inside one test tenant', { timeout: 180_000 }, async () => {
  loadEnv();
  assert.ok(process.env.DATABASE_URL, 'DATABASE_URL is required');
  const { prisma } = await import('@/lib/prisma');
  const copyPath = path.resolve(process.cwd(), FIXTURE_ROOT, 'user-facing-copy.ts');
  const copyBefore = await readFile(copyPath, 'utf8');
  const liveBefore = await liveSnapshot(prisma);
  const outsideBefore = await outsideCounts(prisma);
  const report: Record<string, unknown> = {};
  let cleanupError: string | null = null;
  try {
    await removeTenants(prisma);
    const owner = membership('phase34-owner-mem', TENANT, 'phase34-owner', 'OWNER');
    const auditor = membership('phase34-auditor-mem', TENANT, 'phase34-auditor', 'AUDITOR');
    const foreign = membership('phase34-foreign-mem', FOREIGN, 'phase34-foreign', 'OWNER');
    await seedActors(prisma, owner, auditor, foreign);
    await seedReview(prisma, owner);
    const seeded = await persistReReviewDecision({
      userId: owner.userId,
      memberships: [owner],
      now: NOW,
      reviewResultId: IDS.review,
    });
    assert.equal(seeded.ok, true, seeded.ok ? '' : seeded.reason);
    if (!seeded.ok || !('improvementTask' in seeded) || !seeded.improvementTask) {
      throw new Error('seed did not open an improvement task');
    }
    const task = await prisma.juryImprovementTask.findUnique({ where: { id: seeded.improvementTask.id } });
    assert.ok(task);
    const provenance =
      task.provenance && typeof task.provenance === 'object' && !Array.isArray(task.provenance) ? task.provenance : {};
    await prisma.juryImprovementTask.update({
      where: { id: task.id },
      data: { provenance: { ...provenance, workspaceRef: { type: 'PROJECT', ref: 're-review-fixture' } } },
    });
    const seededCycle = await prisma.juryDecisionCycle.findFirst({ where: { tenantId: TENANT } });
    assert.equal(seededCycle?.status, 'ACTIVE');

    const beforeWork = await tenantCounts(prisma);
    const auditorRun = await persistIntegratedAutoLoop(loopInput(auditor, coreHarness().core));
    assert.equal(auditorRun.stop, 'FORBIDDEN');
    assert.deepEqual(await tenantCounts(prisma), beforeWork);
    const foreignRun = await persistIntegratedAutoLoop(loopInput(foreign, coreHarness().core));
    assert.equal(foreignRun.stop, 'TENANT_MISMATCH');
    assert.deepEqual(await tenantCounts(prisma), beforeWork);
    const turnedOn = await persistAutoLoopActivation({
      userId: owner.userId,
      memberships: [owner],
      now: NOW,
      enabled: true,
    });
    assert.equal(turnedOn.ok, true);
    const fullAuto = await persistAutoLoopMode({
      userId: owner.userId,
      memberships: [owner],
      now: NOW,
      mode: 'FULL_AUTO',
    });
    assert.equal(fullAuto.ok, true);

    const harness = coreHarness();
    const [first, second] = await Promise.all([
      persistIntegratedAutoLoop(loopInput(owner, harness.core, 'forged-tenant')),
      persistIntegratedAutoLoop(loopInput(owner, harness.core, 'forged-tenant')),
    ]);
    const stops = [first.stop, second.stop].sort();
    report.concurrentStops = stops;
    report.coreCalls = harness.calls.n;
    assert.equal(harness.calls.n, 2, JSON.stringify({ stops, first, second }));
    assert.ok(stops.every((stop) => stop === 'ACCEPT'), JSON.stringify({ stops, first, second }));

    const counts = await tenantCounts(prisma);
    report.counts = counts;
    assert.deepEqual(counts, {
      cycles: 1,
      rewordTasks: 1,
      verificationTasks: 1,
      improvementTasks: 1,
      executions: 1,
      gates: 1,
      changeGateReviews: 1,
      verificationReviews: 1,
      verificationResults: 1,
      reviewRequests: 3,
      reviewResults: 3,
    });

    const again = await persistIntegratedAutoLoop(loopInput(owner, harness.core, 'forged-tenant'));
    assert.equal(again.stop, 'ACCEPT');
    assert.equal(harness.calls.n, 2);
    assert.deepEqual(await tenantCounts(prisma), counts);
    report.idempotent = true;

    const state = await readState(prisma);
    report.state = state;
    assert.equal(state.cycle?.status, 'COMPLETED');
    assert.deepEqual(
      state.reviews.map((review) => review.expectedDecision),
      ['REWORD', 'VERIFY', 'ACCEPT'],
    );
    assert.equal(state.execution?.status, 'COMPLETED');
    assert.ok(state.execution?.startedAt && state.execution.finishedAt);
    assert.equal(state.gate?.status, 'APPROVED');
    assert.equal(state.changeGateReview?.status, 'EXECUTED');
    assert.equal(state.verificationResult?.status, 'RESOLVED');
    assert.equal(state.verificationReview?.status, 'EXECUTED');
    assert.equal(state.reviews[1]?.parentReviewResultId, state.reviews[0]?.id);
    assert.equal(state.reviews[2]?.parentReviewResultId, state.reviews[1]?.id);
    assert.equal(state.reviews.every((review) => review.tenantId === TENANT), true);
    assert.equal(JSON.stringify(state).includes('forged-tenant'), false);

    const audits = await prisma.juryAuditEvent.findMany({ where: { tenantId: TENANT } });
    report.auditActions = [...new Set(audits.map((row) => row.action))].sort();
    assert.ok(audits.length > 0);
    assert.equal(audits.every((row) => row.tenantId === TENANT), true);
    assert.equal(JSON.stringify(audits).includes(SECRET_PROBE), false);

    const credential = await credentialProbe(prisma, owner, state);
    report.credential = credential;
    assert.equal(credential.reasonRejected, 'CREDENTIAL_IN_REASON');
    assert.equal(credential.evidenceRejected, 'CREDENTIAL_IN_REASON');
    assert.equal(credential.taskRejected, 'CREDENTIAL_DATA_DETECTED');
    assert.equal(credential.stored, false);
    assert.deepEqual(await tenantCounts(prisma), counts);
    assert.deepEqual(await outsideCounts(prisma), outsideBefore);
    assert.deepEqual(await liveSnapshot(prisma), liveBefore);
  } finally {
    await unlink(path.resolve(process.cwd(), FIXTURE_ROOT, NOTE)).catch(() => undefined);
    try {
      await removeTenants(prisma);
    } catch (error) {
      cleanupError = safeMessage(error);
    }
    const copyAfter = await readFile(copyPath, 'utf8');
    assert.equal(copyAfter, copyBefore);
    report.cleanup = cleanupError ?? 'deleted';
    console.log(`PHASE34_REPORT ${JSON.stringify(report)}`);
    if (cleanupError) throw new Error(`CLEANUP_FAILED ${cleanupError}`);
    assert.deepEqual(await liveSnapshot(prisma), liveBefore);
    assert.deepEqual(await outsideCounts(prisma), outsideBefore);
  }
});

function loopInput(actor: JuryMembership, core: ProductReviewCore, clientTenantId?: string) {
  return {
    userId: actor.userId,
    memberships: [actor],
    clientTenantId,
    now: NOW,
    reviewResultId: IDS.review,
    adapter: phase34Adapter(),
    core,
    inspect: phase34Inspect,
  };
}

function coreHarness(): { core: ProductReviewCore; calls: { n: number } } {
  const calls = { n: 0 };
  let stage = 0;
  let tail = Promise.resolve();
  const core: ProductReviewCore = () => {
    const run = tail.then(() => {
      calls.n += 1;
      const decision = stage === 0 ? 'VERIFY' : 'ACCEPT';
      stage += 1;
      return reading(decision);
    });
    tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };
  return { core, calls };
}

function phase34Adapter(): AgentAdapter {
  return {
    async run(input) {
      const { mkdir, writeFile } = await import('node:fs/promises');
      const root = path.resolve(process.cwd(), input.workspaceRoot);
      const file = path.resolve(root, NOTE);
      if (!file.startsWith(root + path.sep)) throw new Error('workspace escape');
      await mkdir(root, { recursive: true });
      await writeFile(file, 'phase34 workspace note\n', 'utf8');
      return { ok: true, changedFiles: [NOTE], summary: 'phase34 note', testsRun: ['phase34'], testsPassed: true };
    },
  };
}

async function phase34Inspect(relativeRoot: string) {
  if (relativeRoot !== FIXTURE_ROOT) return { ok: false as const, reason: 'WORKSPACE_NOT_ALLOWED' as const };
  try {
    await readFile(path.resolve(process.cwd(), FIXTURE_ROOT, NOTE), 'utf8');
  } catch {
    return { ok: true as const, files: [], present: [] };
  }
  return {
    ok: true as const,
    files: [{ path: NOTE, kind: 'added' as const, additions: 1, deletions: 0, patch: 'phase34 workspace note' }],
    present: [NOTE],
  };
}

async function seedActors(
  prisma: PrismaClient,
  owner: JuryMembership,
  auditor: JuryMembership,
  foreign: JuryMembership,
): Promise<void> {
  for (const actor of [owner, auditor, foreign]) {
    await prisma.user.create({
      data: { id: actor.userId, username: actor.userId, email: `${actor.userId}@example.invalid` },
    });
  }
  await prisma.juryTenant.create({ data: { id: TENANT, name: TENANT } });
  await prisma.juryTenant.create({ data: { id: FOREIGN, name: FOREIGN } });
  for (const actor of [owner, auditor, foreign]) {
    await prisma.juryMembership.create({
      data: { id: actor.id, tenantId: actor.tenantId, userId: actor.userId, role: actor.role, createdAt: new Date(NOW) },
    });
  }
}

async function seedReview(prisma: PrismaClient, owner: JuryMembership): Promise<void> {
  await prisma.juryServiceConnection.create({
    data: {
      id: IDS.connection,
      tenantId: TENANT,
      serviceKey: 'phase34',
      displayName: 'phase34',
      accessMethod: 'FILE_UPLOAD',
      status: 'CONNECTED',
      createdByUserId: owner.userId,
    },
  });
  await prisma.juryAccessScope.create({
    data: {
      id: IDS.scope,
      tenantId: TENANT,
      connectionId: IDS.connection,
      status: 'APPROVED',
      grants: [],
      approvedByUserId: owner.userId,
      approvedAt: new Date(NOW),
    },
  });
  await prisma.juryEvidence.create({
    data: {
      id: IDS.evidence,
      tenantId: TENANT,
      connectionId: IDS.connection,
      purpose: 'phase34-integration',
      periodStart: '2026-09-01',
      periodEnd: '2026-09-07',
      timezone: 'Asia/Seoul',
      metricIds: [IDS.metricDb, IDS.metricGa4],
      adapterKey: 'aisle-self',
      collectedAt: new Date(NOW),
      contentHash: stable('content'),
      piiExcluded: true,
      readOnly: true,
    },
  });
  for (const metric of [
    { id: IDS.metricDb, metric: 'newUsersLast7d', sourceSystem: 'DATABASE' as const, sourceRef: 'phase34-db' },
    { id: IDS.metricGa4, metric: 'ga4.newUsers', sourceSystem: 'GA4' as const, sourceRef: 'phase34-ga4' },
  ]) {
    await prisma.juryNormalizedMetric.create({
      data: {
        id: metric.id,
        tenantId: TENANT,
        connectionId: IDS.connection,
        evidenceId: IDS.evidence,
        metric: metric.metric,
        value: 0,
        unit: 'COUNT',
        periodStart: '2026-09-01',
        periodEnd: '2026-09-07',
        timezone: 'Asia/Seoul',
        sourceSystem: metric.sourceSystem,
        sourceRef: metric.sourceRef,
        collectedAt: new Date(NOW),
        availability: 'AVAILABLE',
        rawPayloadRef: 'phase34-pack',
        adapterKey: 'aisle-self',
        adapterVersion: 'aisle-self-v1',
        ruleId: 'normalize.evidence-pack.aggregate.v1',
      },
    });
  }
  const stored = await persistProductReview({
    request: {
      id: IDS.request,
      tenantId: TENANT,
      connectionId: IDS.connection,
      evidenceId: IDS.evidence,
      reviewType: 'FULL_REVIEW',
      claim: '측정된 범위의 문구만 사용한다.',
      mode: 'AISLE_SELF',
      status: 'COMPLETED',
      coreRootDir: JURY_PRODUCT_DATA_ROOT,
      requestedByUserId: owner.userId,
    },
    result: {
      id: IDS.review,
      tenantId: TENANT,
      reviewRequestId: IDS.request,
      boardRunId: 'run-phase34-root',
      evidenceStrength: 'strong',
      claimStrength: 'weak',
      conflictDetected: true,
      overclaimDetected: false,
      revisionRequired: true,
      expectedDecision: 'REWORD',
      finalSurface: surface(),
      contractVersion: JURY_CORE_CONTRACT_VERSION,
      completedAt: NOW,
    },
  });
  assert.equal(stored.ok, true);
}

async function credentialProbe(
  prisma: PrismaClient,
  owner: JuryMembership,
  state: Awaited<ReturnType<typeof readState>>,
): Promise<{ reasonRejected: string; evidenceRejected: string; taskRejected: string; stored: boolean }> {
  const gateId = state.gate?.id ?? '';
  const evidenceId = IDS.evidence;
  const parentId = IDS.review;
  const reason = await persistChangeGateReReviewRequest({
    userId: owner.userId,
    memberships: [owner],
    now: NOW,
    changeGateResultId: gateId,
    evidenceId,
    sourceEvidenceId: evidenceId,
    parentReviewResultId: parentId,
    reason: { code: 'NOTE', message: SECRET_PROBE },
  });
  const evidence = await prisma.juryEvidence.findUnique({ where: { id: IDS.evidence } });
  const previousHash = evidence?.contentHash ?? '';
  const probeRequest = stable('probe-request');
  const probeReview = stable('probe-review');
  await prisma.juryEvidence.update({ where: { id: IDS.evidence }, data: { contentHash: SECRET_PROBE } });
  await persistProductReview({
    request: {
      id: probeRequest,
      tenantId: TENANT,
      connectionId: IDS.connection,
      evidenceId: IDS.evidence,
      reviewType: 'FULL_REVIEW',
      mode: 'AISLE_SELF',
      status: 'COMPLETED',
      coreRootDir: JURY_PRODUCT_DATA_ROOT,
      requestedByUserId: owner.userId,
    },
    result: {
      id: probeReview,
      tenantId: TENANT,
      reviewRequestId: probeRequest,
      boardRunId: 'run-phase34-probe',
      evidenceStrength: 'strong',
      claimStrength: 'weak',
      conflictDetected: false,
      overclaimDetected: false,
      revisionRequired: false,
      expectedDecision: 'REWORD',
      finalSurface: surface(),
      contractVersion: JURY_CORE_CONTRACT_VERSION,
      completedAt: NOW,
    },
  });
  let evidenceRejected = 'MISSING';
  try {
    const decided = await persistReReviewDecision({
      userId: owner.userId,
      memberships: [owner],
      now: NOW,
      reviewResultId: probeReview,
    });
    evidenceRejected = decided.ok ? 'WROTE' : decided.reason;
  } finally {
    await prisma.juryEvidence.update({ where: { id: IDS.evidence }, data: { contentHash: previousHash } });
    await prisma.juryDecisionCycle.deleteMany({ where: { rootReviewResultId: probeReview } });
    await prisma.juryReviewResult.deleteMany({ where: { id: probeReview } });
    await prisma.juryReviewRequest.deleteMany({ where: { id: probeRequest } });
  }
  const task = await prisma.juryImprovementTask.findFirst({ where: { tenantId: TENANT, taskType: 'REWORD' } });
  const previousDescription = task?.description ?? '';
  let taskRejected = 'MISSING';
  if (task) {
    await prisma.juryImprovementTask.update({ where: { id: task.id }, data: { description: SECRET_PROBE } });
    try {
      const ran = await persistImprovementAgentRun({
        userId: owner.userId,
        memberships: [owner],
        now: NOW,
        improvementTaskId: task.id,
        adapter: phase34Adapter(),
      });
      taskRejected = ran.ok ? 'WROTE' : ran.reason;
    } finally {
      await prisma.juryImprovementTask.update({ where: { id: task.id }, data: { description: previousDescription } });
    }
  }
  const audits = await prisma.juryAuditEvent.findMany({ where: { tenantId: TENANT } });
  const evidenceAfter = await prisma.juryEvidence.findUnique({ where: { id: IDS.evidence } });
  const taskAfter = task ? await prisma.juryImprovementTask.findUnique({ where: { id: task.id } }) : null;
  const stored =
    JSON.stringify(audits).includes(SECRET_PROBE) ||
    evidenceAfter?.contentHash === SECRET_PROBE ||
    taskAfter?.description === SECRET_PROBE;
  return {
    reasonRejected: reason.ok ? 'WROTE' : reason.reason,
    evidenceRejected,
    taskRejected,
    stored,
  };
}

type PrismaClient = Awaited<typeof import('@/lib/prisma')>['prisma'];

async function tenantCounts(prisma: PrismaClient) {
  const [tasks, reviews] = await Promise.all([
    prisma.juryDecisionTask.findMany({ where: { tenantId: TENANT }, select: { taskType: true } }),
    prisma.juryReviewResult.findMany({ where: { tenantId: TENANT }, select: { id: true } }),
  ]);
  return {
    cycles: await prisma.juryDecisionCycle.count({ where: { tenantId: TENANT } }),
    rewordTasks: tasks.filter((task) => task.taskType === 'REWORD').length,
    verificationTasks: tasks.filter((task) => task.taskType === 'VERIFICATION').length,
    improvementTasks: await prisma.juryImprovementTask.count({ where: { tenantId: TENANT } }),
    executions: await prisma.juryAgentExecution.count({ where: { tenantId: TENANT } }),
    gates: await prisma.juryChangeGateResult.count({ where: { tenantId: TENANT } }),
    changeGateReviews: await prisma.juryChangeGateReview.count({ where: { tenantId: TENANT } }),
    verificationReviews: await prisma.juryVerificationReview.count({ where: { tenantId: TENANT } }),
    verificationResults: await prisma.juryVerificationResult.count({ where: { tenantId: TENANT } }),
    reviewRequests: await prisma.juryReviewRequest.count({ where: { tenantId: TENANT } }),
    reviewResults: reviews.length,
  };
}

async function readState(prisma: PrismaClient) {
  const reviews = await prisma.juryReviewResult.findMany({
    where: { tenantId: TENANT },
    orderBy: { completedAt: 'asc' },
    select: { id: true, tenantId: true, expectedDecision: true, parentReviewResultId: true },
  });
  const root = reviews.find((review) => review.id === IDS.review);
  const verify = reviews.find((review) => review.parentReviewResultId === IDS.review);
  const accept = reviews.find((review) => verify && review.parentReviewResultId === verify.id);
  const ordered = [root, verify, accept].filter((review): review is (typeof reviews)[number] => Boolean(review));
  return {
    cycle: await prisma.juryDecisionCycle.findFirst({
      where: { tenantId: TENANT },
      select: { id: true, status: true, rootReviewResultId: true, currentReviewResultId: true, iteration: true },
    }),
    reviews: ordered,
    rewordTask: await prisma.juryDecisionTask.findFirst({
      where: { tenantId: TENANT, taskType: 'REWORD' },
      select: { id: true },
    }),
    verificationTask: await prisma.juryDecisionTask.findFirst({
      where: { tenantId: TENANT, taskType: 'VERIFICATION' },
      select: { id: true },
    }),
    improvementTask: await prisma.juryImprovementTask.findFirst({
      where: { tenantId: TENANT },
      select: { id: true, status: true },
    }),
    execution: await prisma.juryAgentExecution.findFirst({
      where: { tenantId: TENANT },
      select: { id: true, status: true, startedAt: true, finishedAt: true },
    }),
    gate: await prisma.juryChangeGateResult.findFirst({
      where: { tenantId: TENANT },
      select: { id: true, status: true },
    }),
    changeGateReview: await prisma.juryChangeGateReview.findFirst({
      where: { tenantId: TENANT },
      select: { id: true, status: true },
    }),
    verificationResult: await prisma.juryVerificationResult.findFirst({
      where: { tenantId: TENANT },
      select: { id: true, status: true },
    }),
    verificationReview: await prisma.juryVerificationReview.findFirst({
      where: { tenantId: TENANT },
      select: { id: true, status: true },
    }),
  };
}

async function outsideCounts(prisma: PrismaClient) {
  // Other phase fixtures may be committing their own tenants while this test runs.
  // The leak check stays a before/after snapshot of every tenant that is not a phase fixture,
  // including the live tenant and any id this test might forge.
  const fixtureTenants = new Set([TENANT, FOREIGN]);
  const tenants = await prisma.juryTenant.findMany({ select: { id: true } });
  for (const tenant of tenants) {
    if (/^phase\d+/.test(tenant.id)) fixtureTenants.add(tenant.id);
  }
  const where = { tenantId: { notIn: [...fixtureTenants] } };
  return {
    executions: await prisma.juryAgentExecution.count({ where }),
    gates: await prisma.juryChangeGateResult.count({ where }),
    changeGateReviews: await prisma.juryChangeGateReview.count({ where }),
    verificationReviews: await prisma.juryVerificationReview.count({ where }),
    verificationResults: await prisma.juryVerificationResult.count({ where }),
    reviewResults: await prisma.juryReviewResult.count({ where }),
    cycles: await prisma.juryDecisionCycle.count({ where }),
  };
}

async function liveSnapshot(prisma: PrismaClient) {
  const review = await prisma.juryReviewResult.findUnique({
    where: { id: LIVE_REVIEW },
    select: { expectedDecision: true, parentReviewResultId: true, boardRunId: true, conflictDetected: true, completedAt: true },
  });
  const cycle = await prisma.juryDecisionCycle.findUnique({ where: { id: LIVE_CYCLE } });
  return {
    review: review
      ? { ...review, completedAt: review.completedAt.toISOString() }
      : null,
    cycle: cycle
      ? {
          rootReviewResultId: cycle.rootReviewResultId,
          currentReviewResultId: cycle.currentReviewResultId,
          iteration: cycle.iteration,
          verificationAttempts: cycle.verificationAttempts,
          sameDecisionCount: cycle.sameDecisionCount,
          sameConflictCount: cycle.sameConflictCount,
          status: cycle.status,
          updatedAt: cycle.updatedAt.toISOString(),
        }
      : null,
    tasksForLiveReview: await prisma.juryDecisionTask.count({ where: { reviewResultId: LIVE_REVIEW } }),
  };
}

async function removeTenants(prisma: PrismaClient): Promise<void> {
  const tenants = [TENANT, FOREIGN];
  const executions = await prisma.juryAgentExecution.findMany({
    where: { tenantId: { in: tenants } },
    select: { id: true },
  });
  for (const execution of executions) {
    await unlink(path.resolve(process.cwd(), 'data/jury-product/agent-executions', `${execution.id}.json`)).catch(() => undefined);
  }
  const errors: string[] = [];
  const step = async (name: string, run: () => Promise<unknown>) => {
    try {
      await run();
    } catch (error) {
      errors.push(`${name}: ${safeMessage(error)}`);
    }
  };
  const where = { tenantId: { in: tenants } };
  await step('null reviews', () =>
    prisma.juryReviewResult.updateMany({
      where,
      data: { parentReviewResultId: null, verificationResultId: null, decisionTaskId: null, reReviewRequestId: null },
    }),
  );
  await step('audits', () => prisma.juryAuditEvent.deleteMany({ where }));
  await step('change gate reviews', () => prisma.juryChangeGateReview.deleteMany({ where }));
  await step('change gate resolutions', () => prisma.juryChangeGateResolution.deleteMany({ where }));
  await step('verification reviews', () => prisma.juryVerificationReview.deleteMany({ where }));
  await step('re-review results', () => prisma.juryReReviewResult.deleteMany({ where }));
  await step('cycles', () => prisma.juryDecisionCycle.deleteMany({ where }));
  await step('gates', () => prisma.juryChangeGateResult.deleteMany({ where }));
  await step('executions', () => prisma.juryAgentExecution.deleteMany({ where }));
  await step('verification results', () => prisma.juryVerificationResult.deleteMany({ where }));
  await step('improvement tasks', () => prisma.juryImprovementTask.deleteMany({ where }));
  await step('decision tasks', () => prisma.juryDecisionTask.deleteMany({ where }));
  await step('review results', () => prisma.juryReviewResult.deleteMany({ where }));
  await step('review requests', () => prisma.juryReviewRequest.deleteMany({ where }));
  await step('metrics', () => prisma.juryNormalizedMetric.deleteMany({ where }));
  await step('evidence', () => prisma.juryEvidence.deleteMany({ where }));
  await step('scopes', () => prisma.juryAccessScope.deleteMany({ where }));
  await step('connections', () => prisma.juryServiceConnection.deleteMany({ where }));
  await step('discoveries', () => prisma.juryDiscoveryResult.deleteMany({ where }));
  await step('policies', () => prisma.juryProductLoopPolicy.deleteMany({ where }));
  await step('auto loop activation', () => prisma.juryAutoLoopActivation.deleteMany({ where }));
  await step('memberships', () => prisma.juryMembership.deleteMany({ where }));
  await step('tenants', () => prisma.juryTenant.deleteMany({ where: { id: { in: tenants } } }));
  await step('users', () =>
    prisma.user.deleteMany({ where: { username: { in: ['phase34-owner', 'phase34-auditor', 'phase34-foreign'] } } }),
  );
  if (errors.length > 0) throw new Error(errors.join(' | '));
}
