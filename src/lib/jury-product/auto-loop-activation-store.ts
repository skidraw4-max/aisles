/**
 * Stores one on/off row per tenant and blocks the auto loop while it is off.
 * It does not read loop-guard numbers and does not start an agent.
 */
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { decideJuryMutation, resolveJuryActor } from './access';
import {
  autoLoopEntry,
  autoLoopExecutionMode,
  autoLoopIsEnabled,
  canonicalAutoLoopMode,
  planAutoLoopActivation,
  type AutoLoopEntryResult,
  type AutoLoopExecutionMode,
} from './auto-loop-activation';
import type { JuryMembership } from './records';

export async function readAutoLoopEnabled(tenantId: string): Promise<boolean> {
  const { prisma } = await import('@/lib/prisma');
  const row = await prisma.juryAutoLoopActivation.findUnique({
    where: { tenantId },
    select: { enabled: true },
  });
  return autoLoopIsEnabled(row);
}

export async function persistAutoLoopActivation(input: {
  userId: string | null;
  memberships: readonly JuryMembership[];
  clientTenantId?: string | null;
  now: string;
  enabled: boolean;
  note?: string | null;
}): Promise<
  | { ok: true; enabled: boolean; changed: boolean }
  | { ok: false; reason: 'FORBIDDEN' | 'TENANT_MISMATCH' | 'CREDENTIAL_IN_REASON' }
> {
  const plan = planAutoLoopActivation(input);
  if (!plan.ok) return plan;
  const { prisma } = await import('@/lib/prisma');
  try {
    return await prisma.$transaction((tx) => writeActivation(tx, plan.tenantId, plan.userId, input.now, input.enabled));
  } catch (error) {
    if (!isUnique(error)) throw error;
    return prisma.$transaction((tx) => writeActivation(tx, plan.tenantId, plan.userId, input.now, input.enabled));
  }
}

export async function persistAutoLoopMode(input: {
  userId: string | null;
  memberships: readonly JuryMembership[];
  clientTenantId?: string | null;
  now: string;
  mode: string;
  note?: string | null;
}): Promise<
  | { ok: true; mode: AutoLoopExecutionMode; changed: boolean }
  | { ok: false; reason: 'FORBIDDEN' | 'TENANT_MISMATCH' | 'CREDENTIAL_IN_REASON' }
> {
  const plan = planAutoLoopActivation(input);
  if (!plan.ok) return plan;
  const mode = canonicalAutoLoopMode(input.mode);
  const { prisma } = await import('@/lib/prisma');
  try {
    return await prisma.$transaction((tx) => writeMode(tx, plan.tenantId, plan.userId, input.now, mode));
  } catch (error) {
    if (!isUnique(error)) throw error;
    return prisma.$transaction((tx) => writeMode(tx, plan.tenantId, plan.userId, input.now, mode));
  }
}

export async function admitImprovementAutoLoop(input: {
  userId: string | null;
  memberships: readonly JuryMembership[];
  clientTenantId?: string | null;
  reviewResultId: string;
}): Promise<AutoLoopEntryResult | { ok: true; mode: 'TASK_ONLY' | 'FULL_AUTO' }> {
  const actorPlan = planAutoLoopRun(input);
  if (!actorPlan.ok) return autoLoopEntry(actorPlan.reason, input.reviewResultId);
  const { prisma } = await import('@/lib/prisma');
  const review = await prisma.juryReviewResult.findUnique({
    where: { id: input.reviewResultId },
    select: { tenantId: true },
  });
  if (review && review.tenantId !== actorPlan.tenantId) return autoLoopEntry('TENANT_MISMATCH', input.reviewResultId);
  const row = await prisma.juryAutoLoopActivation.findUnique({
    where: { tenantId: actorPlan.tenantId },
    select: { enabled: true, mode: true },
  });
  const mode = autoLoopExecutionMode(row);
  if (mode === 'TASK_ONLY' || mode === 'FULL_AUTO') return { ok: true, mode };
  return autoLoopEntry('AUTO_LOOP_DISABLED', input.reviewResultId);
}

export async function guardImprovementAutoLoop(input: {
  userId: string | null;
  memberships: readonly JuryMembership[];
  clientTenantId?: string | null;
  reviewResultId: string;
}): Promise<AutoLoopEntryResult | null> {
  const admission = await admitImprovementAutoLoop(input);
  if (!admission.ok) return admission;
  return null;
}

function planAutoLoopRun(input: {
  userId: string | null;
  memberships: readonly JuryMembership[];
  clientTenantId?: string | null;
}): { ok: true; tenantId: string } | { ok: false; reason: 'FORBIDDEN' | 'TENANT_MISMATCH' } {
  const actor = resolveJuryActor({
    userId: input.userId,
    memberships: input.memberships,
    clientTenantId: input.clientTenantId,
  });
  if (!actor.ok) return { ok: false, reason: 'FORBIDDEN' };
  const allowed = decideJuryMutation({
    actor,
    action: 'review.start',
    resourceTenantId: actor.tenantId,
    clientTenantId: input.clientTenantId,
  });
  if (!allowed.ok) return { ok: false, reason: allowed.reason === 'TENANT_MISMATCH' ? 'TENANT_MISMATCH' : 'FORBIDDEN' };
  return { ok: true, tenantId: actor.tenantId };
}

async function writeActivation(
  tx: Prisma.TransactionClient,
  tenantId: string,
  userId: string,
  now: string,
  enabled: boolean,
): Promise<{ ok: true; enabled: boolean; changed: boolean }> {
  const locked = await tx.$queryRaw<Array<{ id: string; enabled: boolean }>>(
    Prisma.sql`SELECT id, enabled FROM "JuryAutoLoopActivation" WHERE "tenantId" = ${tenantId} FOR UPDATE`,
  );
  const current = locked[0];
  if (current && current.enabled === enabled) return { ok: true, enabled, changed: false };
  const id = current?.id ?? createHash('sha256').update([tenantId, 'auto-loop-activation'].join('\n')).digest('hex');
  if (current) {
    await tx.juryAutoLoopActivation.update({
      where: { id: current.id },
      data: { enabled, updatedAt: new Date(now), updatedBy: userId },
    });
  } else {
    await tx.juryAutoLoopActivation.create({
      data: { id, tenantId, enabled, mode: 'OFF', updatedAt: new Date(now), updatedBy: userId },
    });
  }
  const action = enabled ? 'AUTO_LOOP_ENABLED' : 'AUTO_LOOP_DISABLED';
  const auditId = createHash('sha256')
    .update([tenantId, action, now, current ? String(current.enabled) : 'absent'].join('\n'))
    .digest('hex');
  const existing = await tx.juryAuditEvent.findUnique({ where: { id: auditId } });
  if (!existing) {
    await tx.juryAuditEvent.create({
      data: {
        id: auditId,
        tenantId,
        timestamp: new Date(now),
        actor: userId,
        action,
        provenance: { enabled } as Prisma.InputJsonValue,
      },
    });
  }
  return { ok: true, enabled, changed: true };
}

async function writeMode(
  tx: Prisma.TransactionClient,
  tenantId: string,
  userId: string,
  now: string,
  mode: AutoLoopExecutionMode,
): Promise<{ ok: true; mode: AutoLoopExecutionMode; changed: boolean }> {
  const locked = await tx.$queryRaw<Array<{ id: string; mode: string }>>(
    Prisma.sql`SELECT id, mode FROM "JuryAutoLoopActivation" WHERE "tenantId" = ${tenantId} FOR UPDATE`,
  );
  const current = locked[0];
  const previous = canonicalAutoLoopMode(current?.mode);
  if (previous === mode) return { ok: true, mode, changed: false };
  const id = current?.id ?? createHash('sha256').update([tenantId, 'auto-loop-activation'].join('\n')).digest('hex');
  if (current) {
    await tx.juryAutoLoopActivation.update({
      where: { id: current.id },
      data: { mode, updatedAt: new Date(now), updatedBy: userId },
    });
  } else {
    await tx.juryAutoLoopActivation.create({
      data: { id, tenantId, enabled: false, mode, updatedAt: new Date(now), updatedBy: userId },
    });
  }
  const auditId = createHash('sha256')
    .update([tenantId, 'AUTO_LOOP_MODE_CHANGED', now, previous, mode].join('\n'))
    .digest('hex');
  const existing = await tx.juryAuditEvent.findUnique({ where: { id: auditId } });
  if (!existing) {
    await tx.juryAuditEvent.create({
      data: {
        id: auditId,
        tenantId,
        timestamp: new Date(now),
        actor: userId,
        action: 'AUTO_LOOP_MODE_CHANGED',
        provenance: { oldMode: previous, newMode: mode } as Prisma.InputJsonValue,
      },
    });
  }
  return { ok: true, mode, changed: true };
}

function isUnique(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}
