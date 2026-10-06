/**
 * Reads one tenant's loop switch and stops it.
 * An absent row stays absent. STOP does not create a row and does not start an agent.
 */
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { canonicalAutoLoopMode } from './auto-loop-activation';
import {
  planConsoleLoopRead,
  planConsoleLoopStop,
  projectConsoleLoop,
  type ConsoleLoopPolicy,
  type ConsoleLoopScreen,
} from './console-loop-operations';
import type { JuryActor } from './access';
import type { JuryMembership } from './records';

export async function readConsoleLoopOperations(
  actor: JuryActor,
): Promise<{ ok: true; screen: ConsoleLoopScreen } | { ok: false; reason: 'FORBIDDEN' | 'STORE_UNAVAILABLE' }> {
  const plan = planConsoleLoopRead(actor);
  if (!plan.ok) return plan;
  const { prisma } = await import('@/lib/prisma');
  const [activation, policy, cycles] = await Promise.all([
    prisma.juryAutoLoopActivation.findUnique({
      where: { tenantId: plan.tenantId },
      select: { enabled: true, mode: true },
    }),
    prisma.juryProductLoopPolicy.findUnique({
      where: { tenantId: plan.tenantId },
      select: {
        maxIterations: true,
        maxVerificationAttempts: true,
        maxSameDecision: true,
        maxSameConflict: true,
        maxRuntimeMs: true,
        maxCostUsd: true,
      },
    }),
    prisma.juryDecisionCycle.findMany({
      where: { tenantId: plan.tenantId },
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        status: true,
        iteration: true,
        verificationAttempts: true,
        sameDecisionCount: true,
        sameConflictCount: true,
        blockedReason: true,
      },
    }),
  ]);
  return {
    ok: true,
    screen: projectConsoleLoop({
      activation,
      policy: policy ? toPolicy(policy) : null,
      cycles,
    }),
  };
}

export async function persistConsoleLoopStop(input: {
  userId: string | null;
  memberships: readonly JuryMembership[];
  clientTenantId?: string | null;
  now: string;
  command: string;
  note?: string | null;
}): Promise<
  | { ok: true; changed: boolean; enabled: false; mode: 'OFF' }
  | { ok: false; reason: 'FORBIDDEN' | 'TENANT_MISMATCH' | 'CREDENTIAL_IN_REASON' | 'INVALID_TRANSITION' }
> {
  const plan = planConsoleLoopStop(input);
  if (!plan.ok) return plan;
  const { prisma } = await import('@/lib/prisma');
  return prisma.$transaction((tx) => stopExisting(tx, plan.tenantId, plan.userId, input.now));
}

async function stopExisting(
  tx: Prisma.TransactionClient,
  tenantId: string,
  userId: string,
  now: string,
): Promise<{ ok: true; changed: boolean; enabled: false; mode: 'OFF' }> {
  const locked = await tx.$queryRaw<Array<{ id: string; enabled: boolean; mode: string }>>(
    Prisma.sql`SELECT id, enabled, mode FROM "JuryAutoLoopActivation" WHERE "tenantId" = ${tenantId} FOR UPDATE`,
  );
  const current = locked[0];
  const previousMode = canonicalAutoLoopMode(current?.mode);
  if (!current || (!current.enabled && previousMode === 'OFF')) {
    return { ok: true, changed: false, enabled: false, mode: 'OFF' };
  }
  await tx.juryAutoLoopActivation.update({
    where: { id: current.id },
    data: { enabled: false, mode: 'OFF', updatedAt: new Date(now), updatedBy: userId },
  });
  if (current.enabled) {
    await audit(tx, tenantId, userId, now, 'AUTO_LOOP_DISABLED', [String(current.enabled)], { enabled: false });
  }
  if (previousMode !== 'OFF') {
    await audit(tx, tenantId, userId, now, 'AUTO_LOOP_MODE_CHANGED', [previousMode, 'OFF'], {
      oldMode: previousMode,
      newMode: 'OFF',
    });
  }
  return { ok: true, changed: true, enabled: false, mode: 'OFF' };
}

async function audit(
  tx: Prisma.TransactionClient,
  tenantId: string,
  userId: string,
  now: string,
  action: 'AUTO_LOOP_DISABLED' | 'AUTO_LOOP_MODE_CHANGED',
  parts: string[],
  provenance: Record<string, string | boolean>,
): Promise<void> {
  const id = createHash('sha256')
    .update([tenantId, action, now, ...parts].join('\n'))
    .digest('hex');
  const existing = await tx.juryAuditEvent.findUnique({ where: { id } });
  if (existing) return;
  await tx.juryAuditEvent.create({
    data: {
      id,
      tenantId,
      timestamp: new Date(now),
      actor: userId,
      action,
      provenance: provenance as Prisma.InputJsonValue,
    },
  });
}

function toPolicy(row: {
  maxIterations: number | null;
  maxVerificationAttempts: number | null;
  maxSameDecision: number | null;
  maxSameConflict: number | null;
  maxRuntimeMs: number | null;
  maxCostUsd: number | null;
}): ConsoleLoopPolicy {
  return {
    maxIterations: row.maxIterations,
    maxVerificationAttempts: row.maxVerificationAttempts,
    maxSameDecision: row.maxSameDecision,
    maxSameConflict: row.maxSameConflict,
    maxRuntimeMs: row.maxRuntimeMs,
    maxCostUsd: row.maxCostUsd,
  };
}
