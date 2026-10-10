/**
 * Persists auto-loop on/off for one test tenant and leaves live tenants off.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';
import { persistAutoLoopActivation, persistAutoLoopMode, guardImprovementAutoLoop } from './auto-loop-activation-store';
import { persistImprovementAutoLoop } from './improvement-auto-loop-store';
import { persistIntegratedAutoLoop } from './improvement-auto-loop-integration';
import type { JuryMembership } from './records';

const TENANT = 'phase35-activation';
const FOREIGN = 'phase35-foreign';
const NOW = '2026-10-02T05:00:00.000Z';
const LATER = '2026-10-02T05:00:01.000Z';
const LIVE_REVIEW = '3707202563ecae9b38f324a4eefd9243a14bc69420ed6cdda16c4c5794f62e0d';
const LIVE_CYCLE = '14308b4c999ccbe8ca54b7f31da5385385d4073c49bbf2955582a6bb96afb01e';
const SECRET = 'postgres://hidden';

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

function membership(id: string, tenantId: string, userId: string, role: JuryMembership['role']): JuryMembership {
  return { id, tenantId, userId, role, createdAt: NOW };
}

function safeMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : 'failed';
  return message.replace(/postgres(?:ql)?:\/\/\S+/gi, '[redacted]').slice(0, 240);
}

test('phase 35 activation gate stays off until an owner turns it on', { timeout: 120_000 }, async () => {
  loadEnv();
  assert.ok(process.env.DATABASE_URL, 'DATABASE_URL is required');
  const { prisma } = await import('@/lib/prisma');
  const liveBefore = await liveSnapshot(prisma);
  const liveCountsBefore = await liveTenantCounts(prisma, liveBefore.reviewTenantId);
  const owner = membership('phase35-owner-mem', TENANT, 'phase35-owner', 'OWNER');
  const member = membership('phase35-member-mem', TENANT, 'phase35-member', 'DEVELOPER');
  const auditor = membership('phase35-auditor-mem', TENANT, 'phase35-auditor', 'VIEWER');
  const foreign = membership('phase35-foreign-mem', FOREIGN, 'phase35-foreign', 'OWNER');
  let cleanupError: string | null = null;
  try {
    await removeTenants(prisma);
    await seed(prisma, owner, member, auditor, foreign);
    await prisma.juryProductLoopPolicy.create({
      data: {
        id: 'phase35-policy',
        tenantId: TENANT,
        maxIterations: 5,
        createdAt: new Date(NOW),
        updatedAt: new Date(NOW),
      },
    });

    const off = await persistImprovementAutoLoop({
      userId: owner.userId,
      memberships: [owner],
      now: NOW,
      reviewResultId: 'phase35-missing-review',
    });
    assert.equal(off.stop, 'AUTO_LOOP_DISABLED');
    assert.equal(off.agentRuns, 0);
    assert.equal(off.gateRuns, 0);
    assert.equal(off.coreRuns, 0);
    assert.equal(await prisma.juryAutoLoopActivation.count({ where: { tenantId: TENANT } }), 0);

    const memberSet = await persistAutoLoopActivation({
      userId: member.userId,
      memberships: [member],
      now: NOW,
      enabled: true,
    });
    assert.equal(memberSet.ok, false);
    if (!memberSet.ok) assert.equal(memberSet.reason, 'FORBIDDEN');
    const auditorSet = await persistAutoLoopActivation({
      userId: auditor.userId,
      memberships: [auditor],
      now: NOW,
      enabled: true,
    });
    assert.equal(auditorSet.ok, false);
    if (!auditorSet.ok) assert.equal(auditorSet.reason, 'FORBIDDEN');
    const stranger = await persistAutoLoopActivation({ userId: 'phase35-stranger', memberships: [], now: NOW, enabled: true });
    assert.equal(stranger.ok, false);
    if (!stranger.ok) assert.equal(stranger.reason, 'FORBIDDEN');
    const crossed = await persistAutoLoopActivation({
      userId: foreign.userId,
      memberships: [foreign],
      clientTenantId: TENANT,
      now: NOW,
      enabled: true,
    });
    assert.equal(crossed.ok, false);
    if (!crossed.ok) assert.equal(crossed.reason, 'TENANT_MISMATCH');
    assert.equal(await prisma.juryAutoLoopActivation.count({ where: { tenantId: { in: [TENANT, FOREIGN] } } }), 0);

    const memberRun = await guardImprovementAutoLoop({
      userId: member.userId,
      memberships: [member],
      reviewResultId: 'phase35-missing-review',
    });
    assert.equal(memberRun?.stop, 'AUTO_LOOP_DISABLED');

    const enabled = await persistAutoLoopActivation({
      userId: owner.userId,
      memberships: [owner],
      clientTenantId: 'forged-tenant',
      now: NOW,
      enabled: true,
    });
    assert.equal(enabled.ok, false);
    if (!enabled.ok) assert.equal(enabled.reason, 'TENANT_MISMATCH');
    const turnedOn = await persistAutoLoopActivation({
      userId: owner.userId,
      memberships: [owner],
      now: NOW,
      enabled: true,
    });
    assert.equal(turnedOn.ok, true);
    if (turnedOn.ok) assert.equal(turnedOn.changed, true);
    const again = await persistAutoLoopActivation({
      userId: owner.userId,
      memberships: [owner],
      now: LATER,
      enabled: true,
    });
    assert.equal(again.ok, true);
    if (again.ok) assert.equal(again.changed, false);
    assert.equal(await prisma.juryAutoLoopActivation.count({ where: { tenantId: TENANT } }), 1);
    assert.equal(
      await prisma.juryAuditEvent.count({ where: { tenantId: TENANT, action: 'AUTO_LOOP_ENABLED' } }),
      1,
    );

    const modeStillOff = await persistImprovementAutoLoop({
      userId: owner.userId,
      memberships: [owner],
      now: NOW,
      reviewResultId: 'phase35-missing-review',
    });
    assert.equal(modeStillOff.stop, 'AUTO_LOOP_DISABLED');
    const fullAuto = await persistAutoLoopMode({
      userId: owner.userId,
      memberships: [owner],
      now: LATER,
      mode: 'FULL_AUTO',
    });
    assert.equal(fullAuto.ok, true);

    let coreCalls = 0;
    const entered = await persistIntegratedAutoLoop({
      userId: owner.userId,
      memberships: [owner],
      clientTenantId: 'forged-tenant',
      now: NOW,
      reviewResultId: 'phase35-missing-review',
      adapter: {
        async run() {
          throw new Error('adapter');
        },
      },
      core: async () => {
        coreCalls += 1;
        throw new Error('core');
      },
      inspect: async () => ({ ok: false, reason: 'WORKSPACE_NOT_ALLOWED' }),
    });
    assert.equal(entered.stop, 'REVIEW_NOT_FOUND');
    assert.equal(coreCalls, 0);
    assert.equal(await prisma.juryAgentExecution.count({ where: { tenantId: TENANT } }), 0);
    assert.equal(await prisma.juryChangeGateResult.count({ where: { tenantId: TENANT } }), 0);

    const turnedOff = await persistAutoLoopActivation({
      userId: owner.userId,
      memberships: [owner],
      now: LATER,
      enabled: false,
    });
    assert.equal(turnedOff.ok, true);
    if (turnedOff.ok) assert.equal(turnedOff.enabled, false);
    const offAgain = await persistImprovementAutoLoop({
      userId: owner.userId,
      memberships: [owner],
      now: LATER,
      reviewResultId: 'phase35-missing-review',
    });
    assert.equal(offAgain.stop, 'AUTO_LOOP_DISABLED');
    const repeatOff = await persistAutoLoopActivation({
      userId: owner.userId,
      memberships: [owner],
      now: '2026-10-02T05:00:02.000Z',
      enabled: false,
    });
    assert.equal(repeatOff.ok, true);
    if (repeatOff.ok) assert.equal(repeatOff.changed, false);
    assert.equal(
      await prisma.juryAuditEvent.count({ where: { tenantId: TENANT, action: 'AUTO_LOOP_DISABLED' } }),
      1,
    );

    const [left, right] = await Promise.all([
      persistAutoLoopActivation({ userId: owner.userId, memberships: [owner], now: '2026-10-02T05:00:03.000Z', enabled: true }),
      persistAutoLoopActivation({ userId: owner.userId, memberships: [owner], now: '2026-10-02T05:00:04.000Z', enabled: false }),
    ]);
    assert.equal(left.ok && right.ok, true);
    assert.equal(await prisma.juryAutoLoopActivation.count({ where: { tenantId: TENANT } }), 1);
    const finalRow = await prisma.juryAutoLoopActivation.findUnique({ where: { tenantId: TENANT } });
    assert.equal(typeof finalRow?.enabled, 'boolean');

    const secret = await persistAutoLoopActivation({
      userId: owner.userId,
      memberships: [owner],
      now: '2026-10-02T05:00:05.000Z',
      enabled: true,
      note: SECRET,
    });
    assert.equal(secret.ok, false);
    if (!secret.ok) assert.equal(secret.reason, 'CREDENTIAL_IN_REASON');
    const audits = await prisma.juryAuditEvent.findMany({ where: { tenantId: TENANT } });
    assert.equal(JSON.stringify(audits).includes(SECRET), false);
    assert.equal(audits.every((row) => row.tenantId === TENANT && row.actor === owner.userId && row.timestamp instanceof Date), true);
    assert.ok(audits.some((row) => row.action === 'AUTO_LOOP_ENABLED'));
    assert.ok(audits.some((row) => row.action === 'AUTO_LOOP_DISABLED'));

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
    const liveRun = await persistImprovementAutoLoop({
      userId: liveActor.userId,
      memberships: [liveActor],
      clientTenantId: TENANT,
      now: NOW,
      reviewResultId: LIVE_REVIEW,
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
  await step('audits', () => prisma.juryAuditEvent.deleteMany({ where }));
  await step('activation', () => prisma.juryAutoLoopActivation.deleteMany({ where }));
  await step('policies', () => prisma.juryProductLoopPolicy.deleteMany({ where }));
  await step('memberships', () => prisma.juryMembership.deleteMany({ where }));
  await step('tenants', () => prisma.juryTenant.deleteMany({ where: { id: { in: tenants } } }));
  await step('users', () =>
    prisma.user.deleteMany({
      where: { username: { in: ['phase35-owner', 'phase35-member', 'phase35-auditor', 'phase35-foreign'] } },
    }),
  );
  if (errors.length > 0) throw new Error(errors.join(' | '));
}
