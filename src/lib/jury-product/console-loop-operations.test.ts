/**
 * Console loop operations can show and stop an existing switch.
 * They do not enable the loop, start an agent, or write the live tenant.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import type { JuryActor } from './access';
import { persistAutoLoopActivation, persistAutoLoopMode } from './auto-loop-activation-store';
import { planConsoleLoopRead, planConsoleLoopStop, projectConsoleLoop } from './console-loop-operations';
import { persistConsoleLoopStop, readConsoleLoopOperations } from './console-loop-operations-store';
import type { JuryMembership } from './records';

const TENANT = 'phase44-ops';
const FOREIGN = 'phase44-foreign';
const NOW = '2026-10-02T06:44:00.000Z';
const LIVE_REVIEW = '3707202563ecae9b38f324a4eefd9243a14bc69420ed6cdda16c4c5794f62e0d';
const LIVE_CYCLE = '14308b4c999ccbe8ca54b7f31da5385385d4073c49bbf2955582a6bb96afb01e';
const SECRET = 'postgres://hidden';

const owner = membership('phase44-owner-mem', TENANT, 'phase44-owner', 'OWNER');
const member = membership('phase44-member-mem', TENANT, 'phase44-member', 'DEVELOPER');
const auditor = membership('phase44-auditor-mem', TENANT, 'phase44-auditor', 'VIEWER');

test('a stopped switch and a blocked cycle stay readable', () => {
  const off = projectConsoleLoop({ activation: null, policy: null, cycles: [] });
  assert.equal(off.enabled, false);
  assert.equal(off.mode, 'OFF');
  assert.equal(off.stopReason, 'AUTO_LOOP_DISABLED');
  const running = projectConsoleLoop({
    activation: { enabled: true, mode: 'FULL_AUTO' },
    policy: {
      maxIterations: 5,
      maxVerificationAttempts: 2,
      maxSameDecision: 3,
      maxSameConflict: 2,
      maxRuntimeMs: 1_800_000,
      maxCostUsd: 1,
    },
    cycles: [
      {
        id: 'cycle-1',
        status: 'ACTIVE',
        iteration: 2,
        verificationAttempts: 1,
        sameDecisionCount: 2,
        sameConflictCount: 2,
        blockedReason: null,
      },
    ],
  });
  assert.equal(running.mode, 'FULL_AUTO');
  assert.equal(running.stopReason, null);
  assert.equal(running.policy?.maxRuntimeMs, 1_800_000);
  const blocked = projectConsoleLoop({
    activation: { enabled: true, mode: 'FULL_AUTO' },
    policy: null,
    cycles: [
      {
        id: 'cycle-2',
        status: 'BLOCKED',
        iteration: 3,
        verificationAttempts: 1,
        sameDecisionCount: 1,
        sameConflictCount: 0,
        blockedReason: 'MAX_RUNTIME',
      },
    ],
  });
  assert.equal(blocked.stopReason, 'MAX_RUNTIME');
  const same = {
    activation: { enabled: true, mode: 'FULL_AUTO' as const },
    policy: null,
    cycles: [
      {
        id: 'cycle-2',
        status: 'BLOCKED',
        iteration: 3,
        verificationAttempts: 1,
        sameDecisionCount: 1,
        sameConflictCount: 0,
        blockedReason: 'MAX_RUNTIME',
      },
    ],
  };
  assert.deepEqual(projectConsoleLoop(same), projectConsoleLoop(same));
  const hidden = projectConsoleLoop({
    activation: null,
    policy: null,
    cycles: [
      {
        id: 'cycle-3',
        status: 'BLOCKED',
        iteration: 1,
        verificationAttempts: 0,
        sameDecisionCount: 0,
        sameConflictCount: 0,
        blockedReason: SECRET,
      },
    ],
  });
  assert.equal(JSON.stringify(hidden).includes(SECRET), false);
  assert.equal(hidden.cycles[0]?.blockedReason, null);
});

test('only STOP is an allowed console transition', () => {
  const actor: JuryActor = {
    ok: true,
    userId: owner.userId,
    tenantId: TENANT,
    role: 'OWNER',
    membershipId: owner.id,
  };
  assert.equal(planConsoleLoopRead(actor).ok, true);
  assert.equal(planConsoleLoopRead({ ...actor, role: 'VIEWER' }).ok, true);
  assert.equal(planConsoleLoopRead({ ok: false, reason: 'UNAUTHENTICATED' }).ok, false);
  const stop = planConsoleLoopStop({ userId: owner.userId, memberships: [owner], command: 'STOP' });
  assert.equal(stop.ok, true);
  const start = planConsoleLoopStop({ userId: owner.userId, memberships: [owner], command: 'FULL_AUTO' });
  assert.equal(start.ok, false);
  if (!start.ok) assert.equal(start.reason, 'INVALID_TRANSITION');
  const memberStop = planConsoleLoopStop({ userId: member.userId, memberships: [member], command: 'STOP' });
  assert.equal(memberStop.ok, false);
  if (!memberStop.ok) assert.equal(memberStop.reason, 'FORBIDDEN');
  const mismatch = planConsoleLoopStop({
    userId: owner.userId,
    memberships: [owner],
    clientTenantId: FOREIGN,
    command: 'STOP',
  });
  assert.equal(mismatch.ok, false);
  if (!mismatch.ok) assert.equal(mismatch.reason, 'TENANT_MISMATCH');
  const secret = planConsoleLoopStop({
    userId: owner.userId,
    memberships: [owner],
    command: 'STOP',
    note: SECRET,
  });
  assert.equal(secret.ok, false);
  if (!secret.ok) assert.equal(secret.reason, 'CREDENTIAL_IN_REASON');
  assert.equal(JSON.stringify(secret).includes(SECRET), false);
});

test('the console stops an existing switch and leaves an absent switch absent', { timeout: 120_000 }, async () => {
  loadEnv();
  assert.ok(process.env.DATABASE_URL, 'DATABASE_URL is required');
  const { prisma } = await import('@/lib/prisma');
  const liveBefore = await liveSnapshot(prisma);
  let cleanupError: string | null = null;
  try {
    await removeTenants(prisma);
    await seed(prisma);
    const absent = await persistConsoleLoopStop(command('STOP'));
    assert.equal(absent.ok, true);
    if (absent.ok) assert.equal(absent.changed, false);
    assert.equal(await prisma.juryAutoLoopActivation.count({ where: { tenantId: TENANT } }), 0);

    await prisma.juryProductLoopPolicy.create({
      data: {
        id: 'phase44-policy',
        tenantId: TENANT,
        maxIterations: 5,
        maxVerificationAttempts: 2,
        maxSameDecision: 3,
        maxSameConflict: 2,
        maxRuntimeMs: 1_800_000,
        maxCostUsd: 1,
        createdAt: new Date(NOW),
        updatedAt: new Date(NOW),
      },
    });
    assert.equal((await persistAutoLoopActivation({ ...command('STOP'), enabled: true })).ok, true);
    assert.equal((await persistAutoLoopMode({ ...command('STOP'), mode: 'FULL_AUTO' })).ok, true);

    const ownerActor: JuryActor = {
      ok: true,
      userId: owner.userId,
      tenantId: TENANT,
      role: 'OWNER',
      membershipId: owner.id,
    };
    const before = await readConsoleLoopOperations(ownerActor);
    assert.equal(before.ok, true);
    if (before.ok) {
      assert.equal(before.screen.enabled, true);
      assert.equal(before.screen.mode, 'FULL_AUTO');
      assert.equal(before.screen.policy?.maxCostUsd, 1);
    }

    const invalid = await persistConsoleLoopStop(command('FULL_AUTO'));
    assert.equal(invalid.ok, false);
    if (!invalid.ok) assert.equal(invalid.reason, 'INVALID_TRANSITION');
    const leaked = await persistConsoleLoopStop({ ...command('STOP'), note: SECRET });
    assert.equal(leaked.ok, false);
    assert.equal(JSON.stringify(leaked).includes(SECRET), false);
    const denied = await persistConsoleLoopStop({
      userId: member.userId,
      memberships: [member],
      now: NOW,
      command: 'STOP',
    });
    assert.equal(denied.ok, false);
    const auditorDenied = await persistConsoleLoopStop({
      userId: auditor.userId,
      memberships: [auditor],
      now: NOW,
      command: 'STOP',
    });
    assert.equal(auditorDenied.ok, false);
    const foreign = await persistConsoleLoopStop({ ...command('STOP'), clientTenantId: FOREIGN });
    assert.equal(foreign.ok, false);
    if (!foreign.ok) assert.equal(foreign.reason, 'TENANT_MISMATCH');
    assert.equal(await prisma.juryAutoLoopActivation.count({ where: { tenantId: TENANT, enabled: true } }), 1);

    const stopped = await persistConsoleLoopStop(command('STOP'));
    assert.equal(stopped.ok, true);
    if (stopped.ok) assert.equal(stopped.changed, true);
    const again = await persistConsoleLoopStop(command('STOP'));
    assert.equal(again.ok, true);
    if (again.ok) assert.equal(again.changed, false);
    assert.equal(await prisma.juryAuditEvent.count({ where: { tenantId: TENANT, action: 'AUTO_LOOP_DISABLED' } }), 1);
    const after = await readConsoleLoopOperations({ ...ownerActor, role: 'VIEWER' });
    assert.equal(after.ok, true);
    if (after.ok) {
      assert.equal(after.screen.enabled, false);
      assert.equal(after.screen.mode, 'OFF');
      assert.equal(after.screen.stopReason, 'AUTO_LOOP_DISABLED');
    }

    await prisma.juryAuditEvent.deleteMany({ where: { tenantId: TENANT } });
    await prisma.juryAutoLoopActivation.updateMany({
      where: { tenantId: TENANT },
      data: { enabled: true, mode: 'FULL_AUTO', updatedAt: new Date(NOW), updatedBy: owner.userId },
    });
    const [first, second] = await Promise.all([
      persistConsoleLoopStop(command('STOP')),
      persistConsoleLoopStop(command('STOP')),
    ]);
    assert.equal(first.ok && second.ok, true);
    if (first.ok && second.ok) assert.equal(first.changed !== second.changed, true);
    assert.equal(await prisma.juryAutoLoopActivation.count({ where: { tenantId: TENANT, enabled: false, mode: 'OFF' } }), 1);
    assert.equal(await prisma.juryAuditEvent.count({ where: { tenantId: TENANT, action: 'AUTO_LOOP_DISABLED' } }), 1);
    assert.equal(await prisma.juryAgentExecution.count({ where: { tenantId: TENANT } }), 0);
    assert.equal(await prisma.juryChangeGateResult.count({ where: { tenantId: TENANT } }), 0);
    assert.equal(await prisma.juryReviewResult.count({ where: { tenantId: TENANT } }), 0);
  } finally {
    try {
      await removeTenants(prisma);
    } catch (error) {
      cleanupError = error instanceof Error ? error.message.replace(/postgres(?:ql)?:\/\/\S+/gi, '[redacted]') : 'failed';
    }
    assert.deepEqual(await liveSnapshot(prisma), liveBefore);
    if (cleanupError) throw new Error(`CLEANUP_FAILED ${cleanupError}`);
  }
});

test('loop operations do not enable the loop or trust a client tenant', () => {
  const files = [
    'src/lib/jury-product/console-loop-operations.ts',
    'src/lib/jury-product/console-loop-operations-store.ts',
    'src/app/(root)/jury/automation/page.tsx',
  ];
  for (const file of files) {
    const source = readFileSync(path.resolve(process.cwd(), file), 'utf8');
    assert.equal(source.includes('persistIntegratedAutoLoop'), false, file);
    assert.equal(source.includes('persistImprovementAgentRun'), false, file);
    assert.equal(source.includes('runReviewBoardPipeline'), false, file);
    assert.equal(source.includes(LIVE_REVIEW.slice(0, 16)), false, file);
  }
  const ui = readFileSync(path.resolve(process.cwd(), 'src/app/(root)/jury/ui.tsx'), 'utf8');
  assert.equal(ui.includes('자동 Loop 중지'), true);
  assert.equal(ui.includes('자동화 정책 변경'), false);
  const action = readFileSync(path.resolve(process.cwd(), 'src/app/(root)/jury/actions.ts'), 'utf8');
  const stop = action.slice(action.indexOf('export async function stopJuryAutoLoop'));
  assert.equal(stop.includes('clientTenantId: null'), true);
  assert.equal(stop.includes('persistAutoLoopActivation'), false);
  assert.equal(stop.includes('FULL_AUTO'), false);
});

function command(commandName: string) {
  return {
    userId: owner.userId,
    memberships: [owner],
    now: NOW,
    command: commandName,
  };
}

function membership(id: string, tenantId: string, userId: string, role: JuryMembership['role']): JuryMembership {
  return { id, tenantId, userId, role, createdAt: NOW };
}

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
      const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (!match) continue;
      const [, key, raw] = match;
      if (!key || (process.env[key] && !override)) continue;
      process.env[key] = raw.replace(/^"|"$/g, '');
    }
  }
}

async function seed(prisma: Awaited<typeof import('@/lib/prisma')>['prisma']): Promise<void> {
  for (const actor of [owner, member, auditor]) {
    await prisma.user.create({
      data: { id: actor.userId, username: actor.userId, email: `${actor.userId}@example.invalid` },
    });
  }
  await prisma.juryTenant.create({ data: { id: TENANT, name: TENANT } });
  for (const actor of [owner, member, auditor]) {
    await prisma.juryMembership.create({
      data: { id: actor.id, tenantId: actor.tenantId, userId: actor.userId, role: actor.role, createdAt: new Date(NOW) },
    });
  }
}

async function liveSnapshot(prisma: Awaited<typeof import('@/lib/prisma')>['prisma']) {
  const review = await prisma.juryReviewResult.findUnique({
    where: { id: LIVE_REVIEW },
    select: { expectedDecision: true, tenantId: true },
  });
  const cycle = await prisma.juryDecisionCycle.findUnique({
    where: { id: LIVE_CYCLE },
    select: {
      status: true,
      iteration: true,
      verificationAttempts: true,
      sameDecisionCount: true,
      sameConflictCount: true,
      updatedAt: true,
    },
  });
  return {
    decision: review?.expectedDecision ?? null,
    status: cycle?.status ?? null,
    iteration: cycle?.iteration ?? null,
    verificationAttempts: cycle?.verificationAttempts ?? null,
    sameDecisionCount: cycle?.sameDecisionCount ?? null,
    sameConflictCount: cycle?.sameConflictCount ?? null,
    updatedAt: cycle?.updatedAt.toISOString() ?? null,
    activations: await prisma.juryAutoLoopActivation.count({ where: { tenantId: review?.tenantId ?? 'missing' } }),
    executions: await prisma.juryAgentExecution.count({ where: { tenantId: review?.tenantId ?? 'missing' } }),
    gates: await prisma.juryChangeGateResult.count({ where: { tenantId: review?.tenantId ?? 'missing' } }),
    reviews: await prisma.juryReviewResult.count({ where: { tenantId: review?.tenantId ?? 'missing' } }),
  };
}

async function removeTenants(prisma: Awaited<typeof import('@/lib/prisma')>['prisma']): Promise<void> {
  const where = { tenantId: TENANT };
  await prisma.juryAuditEvent.deleteMany({ where });
  await prisma.juryAutoLoopActivation.deleteMany({ where });
  await prisma.juryProductLoopPolicy.deleteMany({ where });
  await prisma.juryMembership.deleteMany({ where });
  await prisma.juryTenant.deleteMany({ where: { id: TENANT } });
  await prisma.user.deleteMany({
    where: { username: { in: ['phase44-owner', 'phase44-member', 'phase44-auditor'] } },
  });
}
