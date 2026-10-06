/**
 * Replays an already executed APPROVED change-gate re-review.
 * It does not run the core for a GATED or BLOCKED result.
 */
import { decideJuryMutation, resolveJuryActor } from './access';
import { persistChangeGateReReviewExecution } from './change-gate-rereview-store';
import type { JuryMembership } from './records';

export async function persistApprovedGateReReview(input: {
  userId: string | null;
  memberships: readonly JuryMembership[];
  clientTenantId?: string | null;
  now: string;
  changeGateResultId: string;
  siteName: string;
}) {
  void input.clientTenantId;
  const actor = resolveJuryActor({
    userId: input.userId,
    memberships: input.memberships,
    clientTenantId: input.clientTenantId,
  });
  if (!actor.ok) return actor;
  const allowed = decideJuryMutation({
    actor,
    action: 'agent.execute',
    resourceTenantId: actor.tenantId,
    clientTenantId: input.clientTenantId,
  });
  if (!allowed.ok) return allowed;
  const { prisma } = await import('@/lib/prisma');
  const gate = await prisma.juryChangeGateResult.findUnique({ where: { id: input.changeGateResultId } });
  if (!gate || !gate.status) return { ok: false as const, reason: 'GATE_NOT_FOUND' as const };
  if (gate.tenantId !== actor.tenantId) return { ok: false as const, reason: 'TENANT_MISMATCH' as const };
  if (gate.status !== 'APPROVED') return { ok: false as const, reason: 'RE-REVIEW_NOT_APPROVED' as const };
  const review = await prisma.juryChangeGateReview.findUnique({ where: { changeGateResultId: gate.id } });
  if (!review || review.status !== 'EXECUTED' || !review.reviewResultId) {
    return { ok: false as const, reason: 'REQUEST_NOT_FOUND' as const };
  }
  return persistChangeGateReReviewExecution({
    userId: input.userId,
    memberships: input.memberships,
    clientTenantId: input.clientTenantId,
    now: input.now,
    requestId: review.id,
    siteName: input.siteName,
  });
}
