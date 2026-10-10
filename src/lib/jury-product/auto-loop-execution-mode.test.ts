/**
 * Execution mode stops before an agent unless the owner has set FULL_AUTO.
 * The test tenant is deleted afterwards. Live reviews are not executed.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';
import { persistAutoLoopActivation, persistAutoLoopMode } from './auto-loop-activation-store';
import { persistIntegratedAutoLoop } from './improvement-auto-loop-integration';
import { JURY_CORE_CONTRACT_VERSION, JURY_PRODUCT_DATA_ROOT, type JuryMembership } from './records';
import type { FrozenCoreReading } from './review-boundary';
import { persistProductReview } from './review-store';

const TENANT = 'phase36-mode';
const FOREIGN = 'phase36-foreign';
const NOW = '2026-10-02T06:00:00.000Z';
const LATER = '2026-10-02T06:00:01.000Z';
const SECRET = 'postgres://hidden';
const LIVE_REVIEW = '3707202563ecae9b38f324a4eefd9243a14bc69420ed6cdda16c4c5794f62e0d';
const LIVE_CYCLE = '14308b4c999ccbe8ca54b7f31da5385385d4073c49bbf2955582a6bb96afb01e';

function stable(label: string): string {
  return createHash('sha256').update(`phase36:${label}`).digest('hex');
}

function loadEnv(): void {
  for (const file of ['.env', '.env.local']) {
    const text = readFileSync(path.resolve(process.cwd(), file), 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (!match) continue;
      const [, key, raw] = match;
      let value = raw ?? '';
      const override = file === '.env.local';
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (override || process.env[key] === undefined) process.env[key] = value;
    }
  }
}

function membership(id: string, tenantId: string, userId: string, role: JuryMembership['role']): JuryMembership {
  return { id, tenantId, userId, role, createdAt: NOW };
}

function safeMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : 'failed';
  return message.replace(/postgres(?:ql)?:\/\/\S+/gi, '[redacted]').slice(0, 240);
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

test('phase 36 execution mode keeps the agent behind FULL_AUTO', { timeout: 120_000 }, async () => {
  loadEnv();
  assert.ok(process.env.DATABASE_URL, 'DATABASE_URL is required');
  const { prisma } = await import('@/lib/prisma');
  const liveBefore = await liveSnapshot(prisma);
  const liveCountsBefore = await liveTenantCounts(prisma, liveBefore.reviewTenantId);
  const owner = membership('phase36-owner-mem', TENANT, 'phase36-owner', 'OWNER');
  const member = membership('phase36-member-mem', TENANT, 'phase36-member', 'DEVELOPER');
  const auditor = membership('phase36-auditor-mem', TENANT, 'phase36-auditor', 'VIEWER');
  const foreign = membership('phase36-foreign-mem', FOREIGN, 'phase36-foreign', 'OWNER');
  let cleanupError: string | null = null;
  try {
    await removeTenants(prisma);
    await seed(prisma, owner, member, auditor, foreign);
    await seedReview(prisma, owner, 'reword', 'REWORD');
    await seedReview(prisma, owner, 'concurrent', 'REWORD');

    const off = await persistIntegratedAutoLoop(loopInput(owner, stable('reword-review')));
    assert.equal(off.stop, 'AUTO_LOOP_DISABLED');
    assert.equal(off.agentRuns, 0);
    assert.equal(await prisma.juryDecisionTask.count({ where: { tenantId: TENANT } }), 0);
    assert.equal(await prisma.juryImprovementTask.count({ where: { tenantId: TENANT } }), 0);

    const turnedOn = await persistAutoLoopActivation({
      userId: owner.userId,
      memberships: [owner],
      now: NOW,
      enabled: true,
    });
    assert.equal(turnedOn.ok, true);
    const enabledRow = await prisma.juryAutoLoopActivation.findUnique({ where: { tenantId: TENANT } });
    assert.equal(enabledRow?.mode, 'OFF');
    const stillOff = await persistIntegratedAutoLoop(loopInput(owner, stable('reword-review')));
    assert.equal(stillOff.stop, 'AUTO_LOOP_DISABLED');
    assert.equal(await prisma.juryImprovementTask.count({ where: { tenantId: TENANT } }), 0);

    const memberMode = await persistAutoLoopMode({ userId: member.userId, memberships: [member], now: NOW, mode: 'TASK_ONLY' });
    assert.equal(memberMode.ok, false);
    if (!memberMode.ok) assert.equal(memberMode.reason, 'FORBIDDEN');
    const auditorMode = await persistAutoLoopMode({ userId: auditor.userId, memberships: [auditor], now: NOW, mode: 'TASK_ONLY' });
    assert.equal(auditorMode.ok, false);
    if (!auditorMode.ok) assert.equal(auditorMode.reason, 'FORBIDDEN');
    const stranger = await persistAutoLoopMode({ userId: 'phase36-stranger', memberships: [], now: NOW, mode: 'FULL_AUTO' });
    assert.equal(stranger.ok, false);
    if (!stranger.ok) assert.equal(stranger.reason, 'FORBIDDEN');
    const crossed = await persistAutoLoopMode({
      userId: foreign.userId,
      memberships: [foreign],
      clientTenantId: TENANT,
      now: NOW,
      mode: 'FULL_AUTO',
    });
    assert.equal(crossed.ok, false);
    if (!crossed.ok) assert.equal(crossed.reason, 'TENANT_MISMATCH');
    assert.equal(await prisma.juryAutoLoopActivation.count({ where: { tenantId: FOREIGN } }), 0);

    const taskOnly = await persistAutoLoopMode({
      userId: owner.userId,
      memberships: [owner],
      now: NOW,
      mode: 'TASK_ONLY',
    });
    assert.equal(taskOnly.ok, true);
    if (taskOnly.ok) assert.equal(taskOnly.changed, true);
    const sameMode = await persistAutoLoopMode({
      userId: owner.userId,
      memberships: [owner],
      now: LATER,
      mode: 'TASK_ONLY',
    });
    assert.equal(sameMode.ok, true);
    if (sameMode.ok) assert.equal(sameMode.changed, false);
    assert.equal(await prisma.juryAuditEvent.count({ where: { tenantId: TENANT, action: 'AUTO_LOOP_MODE_CHANGED' } }), 1);

    const reword = await persistIntegratedAutoLoop(loopInput(owner, stable('reword-review'), 'forged-tenant'));
    assert.equal(reword.stop, 'TASK_ONLY');
    assert.equal(reword.agentRuns, 0);
    assert.equal(reword.gateRuns, 0);
    assert.equal(reword.rereviewRuns, 0);
    assert.equal(reword.coreRuns, 0);
    assert.equal(await prisma.juryDecisionTask.count({ where: { reviewResultId: stable('reword-review'), taskType: 'REWORD' } }), 1);
    assert.equal(await prisma.juryImprovementTask.count({ where: { reviewResultId: stable('reword-review') } }), 1);
    assert.equal(await prisma.juryAgentExecution.count({ where: { tenantId: TENANT } }), 0);
    assert.equal(await prisma.juryChangeGateResult.count({ where: { tenantId: TENANT } }), 0);
    assert.equal(await prisma.juryChangeGateReview.count({ where: { tenantId: TENANT } }), 0);

    const again = await persistIntegratedAutoLoop(loopInput(owner, stable('reword-review')));
    assert.equal(again.stop, 'TASK_ONLY');
    assert.equal(await prisma.juryDecisionTask.count({ where: { reviewResultId: stable('reword-review') } }), 1);
    assert.equal(await prisma.juryImprovementTask.count({ where: { reviewResultId: stable('reword-review') } }), 1);

    const [left, right] = await Promise.all([
      persistIntegratedAutoLoop(loopInput(owner, stable('concurrent-review'))),
      persistIntegratedAutoLoop(loopInput(owner, stable('concurrent-review'))),
    ]);
    assert.equal(left.stop, 'TASK_ONLY');
    assert.equal(right.stop, 'TASK_ONLY');
    assert.equal(await prisma.juryDecisionTask.count({ where: { reviewResultId: stable('concurrent-review'), taskType: 'REWORD' } }), 1);
    assert.equal(await prisma.juryImprovementTask.count({ where: { reviewResultId: stable('concurrent-review') } }), 1);
    assert.equal(await prisma.juryAgentExecution.count({ where: { tenantId: TENANT } }), 0);

    await seedReview(prisma, owner, 'verify', 'VERIFY', stable('reword-review'));
    const verify = await persistIntegratedAutoLoop(loopInput(owner, stable('verify-review')));
    assert.equal(verify.stop, 'TASK_ONLY');
    assert.equal(await prisma.juryDecisionTask.count({ where: { reviewResultId: stable('verify-review'), taskType: 'VERIFICATION' } }), 1);
    assert.equal(await prisma.juryVerificationResult.count({ where: { tenantId: TENANT } }), 0);
    assert.equal(await prisma.juryChangeGateReview.count({ where: { tenantId: TENANT } }), 0);
    assert.equal(verify.coreRuns, 0);
    const verifyAgain = await persistIntegratedAutoLoop(loopInput(owner, stable('verify-review')));
    assert.equal(verifyAgain.stop, 'TASK_ONLY');
    assert.equal(await prisma.juryDecisionTask.count({ where: { reviewResultId: stable('verify-review'), taskType: 'VERIFICATION' } }), 1);

    const secret = await persistAutoLoopMode({
      userId: owner.userId,
      memberships: [owner],
      now: '2026-10-02T06:00:02.000Z',
      mode: 'FULL_AUTO',
      note: SECRET,
    });
    assert.equal(secret.ok, false);
    if (!secret.ok) assert.equal(secret.reason, 'CREDENTIAL_IN_REASON');
    assert.equal((await prisma.juryAutoLoopActivation.findUnique({ where: { tenantId: TENANT } }))?.mode, 'TASK_ONLY');

    const fullAuto = await persistAutoLoopMode({
      userId: owner.userId,
      memberships: [owner],
      now: '2026-10-02T06:00:03.000Z',
      mode: 'FULL_AUTO',
    });
    assert.equal(fullAuto.ok, true);
    if (fullAuto.ok) assert.equal(fullAuto.changed, true);
    const modeAudit = await prisma.juryAuditEvent.findFirst({
      where: { tenantId: TENANT, action: 'AUTO_LOOP_MODE_CHANGED', timestamp: new Date('2026-10-02T06:00:03.000Z') },
    });
    const provenance = modeAudit?.provenance as { oldMode?: string; newMode?: string } | null;
    assert.equal(provenance?.oldMode, 'TASK_ONLY');
    assert.equal(provenance?.newMode, 'FULL_AUTO');
    assert.equal(modeAudit?.actor, owner.userId);
    assert.equal(JSON.stringify(await prisma.juryAuditEvent.findMany({ where: { tenantId: TENANT } })).includes(SECRET), false);

    const entered = await persistIntegratedAutoLoop(loopInput(owner, 'phase36-missing-review'));
    assert.equal(entered.stop, 'REVIEW_NOT_FOUND');
    assert.equal(entered.agentRuns, 0);
    assert.equal(entered.coreRuns, 0);

    const liveOwner = await prisma.juryMembership.findFirst({
      where: { tenantId: liveBefore.reviewTenantId ?? '', role: 'OWNER' },
    });
    assert.ok(liveOwner);
    const liveActor: JuryMembership = {
      id: liveOwner.id,
      tenantId: liveOwner.tenantId,
      userId: liveOwner.userId,
      role: 'OWNER',
      createdAt: liveOwner.createdAt.toISOString(),
    };
    const liveRun = await persistIntegratedAutoLoop({
      ...loopInput(liveActor, LIVE_REVIEW),
      clientTenantId: TENANT,
    });
    assert.equal(liveRun.stop, 'AUTO_LOOP_DISABLED');
    assert.equal(liveRun.agentRuns, 0);
    assert.equal(liveRun.gateRuns, 0);
    assert.equal(liveRun.rereviewRuns, 0);
    assert.equal(liveRun.coreRuns, 0);
    assert.equal(await prisma.juryAutoLoopActivation.count({ where: { tenantId: liveActor.tenantId } }), 0);
    assert.deepEqual(await liveSnapshot(prisma), liveBefore);
    assert.deepEqual(await liveTenantCounts(prisma, liveBefore.reviewTenantId), liveCountsBefore);
  } finally {
    try {
      await removeTenants(prisma);
    } catch (error) {
      cleanupError = safeMessage(error);
    }
    if (cleanupError) throw new Error(`CLEANUP_FAILED ${cleanupError}`);
    assert.deepEqual(await liveSnapshot(prisma), liveBefore);
    assert.deepEqual(await liveTenantCounts(prisma, liveBefore.reviewTenantId), liveCountsBefore);
  }
});

type PrismaClient = Awaited<typeof import('@/lib/prisma')>['prisma'];

function loopInput(actor: JuryMembership, reviewResultId: string, clientTenantId?: string) {
  return {
    userId: actor.userId,
    memberships: [actor],
    clientTenantId,
    now: NOW,
    reviewResultId,
    adapter: {
      async run(): Promise<never> {
        throw new Error('agent');
      },
    },
    core: async (): Promise<never> => {
      throw new Error('core');
    },
    inspect: async (): Promise<never> => {
      throw new Error('inspect');
    },
  };
}

async function seed(
  prisma: PrismaClient,
  owner: JuryMembership,
  member: JuryMembership,
  auditor: JuryMembership,
  foreign: JuryMembership,
): Promise<void> {
  for (const actor of [owner, member, auditor, foreign]) {
    await prisma.user.create({
      data: { id: actor.userId, username: actor.userId, email: `${actor.userId}@example.invalid` },
    });
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
      id: stable('connection'),
      tenantId: TENANT,
      serviceKey: 'phase36',
      displayName: 'phase36',
      accessMethod: 'FILE_UPLOAD',
      status: 'CONNECTED',
      createdByUserId: owner.userId,
    },
  });
  await prisma.juryAccessScope.create({
    data: {
      id: stable('scope'),
      tenantId: TENANT,
      connectionId: stable('connection'),
      status: 'APPROVED',
      grants: [],
      approvedByUserId: owner.userId,
      approvedAt: new Date(NOW),
    },
  });
  await prisma.juryEvidence.create({
    data: {
      id: stable('evidence'),
      tenantId: TENANT,
      connectionId: stable('connection'),
      purpose: 'phase36-mode',
      periodStart: '2026-09-01',
      periodEnd: '2026-09-07',
      timezone: 'Asia/Seoul',
      metricIds: [],
      adapterKey: 'aisle-self',
      collectedAt: new Date(NOW),
      contentHash: stable('content'),
      piiExcluded: true,
      readOnly: true,
    },
  });
}

async function seedReview(
  prisma: PrismaClient,
  owner: JuryMembership,
  label: string,
  decision: 'REWORD' | 'VERIFY',
  parentReviewResultId?: string,
): Promise<void> {
  const stored = await persistProductReview({
    request: {
      id: stable(`${label}-request`),
      tenantId: TENANT,
      connectionId: stable('connection'),
      evidenceId: stable('evidence'),
      reviewType: 'FULL_REVIEW',
      claim: '측정된 범위의 문구만 사용한다.',
      mode: 'AISLE_SELF',
      status: 'COMPLETED',
      coreRootDir: JURY_PRODUCT_DATA_ROOT,
      requestedByUserId: owner.userId,
    },
    result: {
      id: stable(`${label}-review`),
      tenantId: TENANT,
      reviewRequestId: stable(`${label}-request`),
      boardRunId: `run-phase36-${label}`,
      evidenceStrength: 'strong',
      claimStrength: 'weak',
      conflictDetected: decision === 'REWORD',
      overclaimDetected: false,
      revisionRequired: decision === 'REWORD',
      expectedDecision: decision,
      finalSurface: surface(),
      contractVersion: JURY_CORE_CONTRACT_VERSION,
      completedAt: NOW,
    },
  });
  assert.equal(stored.ok, true);
  if (parentReviewResultId) {
    await prisma.juryReviewResult.update({
      where: { id: stable(`${label}-review`) },
      data: { parentReviewResultId },
    });
  }
}

async function liveSnapshot(prisma: PrismaClient) {
  const review = await prisma.juryReviewResult.findUnique({
    where: { id: LIVE_REVIEW },
    select: { tenantId: true, expectedDecision: true, parentReviewResultId: true, completedAt: true },
  });
  const cycle = await prisma.juryDecisionCycle.findUnique({ where: { id: LIVE_CYCLE } });
  return {
    reviewTenantId: review?.tenantId ?? null,
    review: review
      ? {
          expectedDecision: review.expectedDecision,
          parentReviewResultId: review.parentReviewResultId,
          completedAt: review.completedAt.toISOString(),
        }
      : null,
    cycle: cycle
      ? {
          status: cycle.status,
          iteration: cycle.iteration,
          rootReviewResultId: cycle.rootReviewResultId,
          currentReviewResultId: cycle.currentReviewResultId,
          verificationAttempts: cycle.verificationAttempts,
          sameDecisionCount: cycle.sameDecisionCount,
          sameConflictCount: cycle.sameConflictCount,
          updatedAt: cycle.updatedAt.toISOString(),
        }
      : null,
    tasksForLiveReview: await prisma.juryDecisionTask.count({ where: { reviewResultId: LIVE_REVIEW } }),
  };
}

async function liveTenantCounts(prisma: PrismaClient, tenantId: string | null) {
  const where = { tenantId: tenantId ?? 'missing-live-tenant' };
  return {
    executions: await prisma.juryAgentExecution.count({ where }),
    gates: await prisma.juryChangeGateResult.count({ where }),
    changeGateReviews: await prisma.juryChangeGateReview.count({ where }),
    reviewResults: await prisma.juryReviewResult.count({ where }),
    cycles: await prisma.juryDecisionCycle.count({ where }),
    activations: await prisma.juryAutoLoopActivation.count({ where }),
  };
}

async function removeTenants(prisma: PrismaClient): Promise<void> {
  const tenants = [TENANT, FOREIGN];
  const where = { tenantId: { in: tenants } };
  const errors: string[] = [];
  const step = async (name: string, run: () => Promise<unknown>) => {
    try {
      await run();
    } catch (error) {
      errors.push(`${name}: ${safeMessage(error)}`);
    }
  };
  await step('null reviews', () =>
    prisma.juryReviewResult.updateMany({
      where,
      data: { parentReviewResultId: null, verificationResultId: null, decisionTaskId: null, reReviewRequestId: null },
    }),
  );
  await step('audits', () => prisma.juryAuditEvent.deleteMany({ where }));
  await step('cycles', () => prisma.juryDecisionCycle.deleteMany({ where }));
  await step('improvement tasks', () => prisma.juryImprovementTask.deleteMany({ where }));
  await step('decision tasks', () => prisma.juryDecisionTask.deleteMany({ where }));
  await step('review results', () => prisma.juryReviewResult.deleteMany({ where }));
  await step('review requests', () => prisma.juryReviewRequest.deleteMany({ where }));
  await step('evidence', () => prisma.juryEvidence.deleteMany({ where }));
  await step('scopes', () => prisma.juryAccessScope.deleteMany({ where }));
  await step('connections', () => prisma.juryServiceConnection.deleteMany({ where }));
  await step('activation', () => prisma.juryAutoLoopActivation.deleteMany({ where }));
  await step('memberships', () => prisma.juryMembership.deleteMany({ where }));
  await step('tenants', () => prisma.juryTenant.deleteMany({ where: { id: { in: tenants } } }));
  await step('users', () =>
    prisma.user.deleteMany({
      where: { username: { in: ['phase36-owner', 'phase36-member', 'phase36-auditor', 'phase36-foreign'] } },
    }),
  );
  if (errors.length > 0) throw new Error(errors.join(' | '));
}
