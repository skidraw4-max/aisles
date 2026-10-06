/**
 * Sends an APPROVED change gate into the existing re-review path.
 * GATED and BLOCKED stop before a review request or the core.
 */
import { decideJuryMutation, resolveJuryActor } from './access';
import {
  executeChangeGateReReview,
  requestChangeGateReReview,
  type ChangeGateReviewExecIo,
  type ChangeGateReviewFailure,
  type ChangeGateReviewRequestCommand,
  type ChangeGateReviewRequestTx,
} from './change-gate-rereview';
import type { JuryMembership } from './records';

export async function runApprovedGateReReview(
  command: ChangeGateReviewRequestCommand & { siteName: string },
  io: { request: ChangeGateReviewRequestTx; execution: ChangeGateReviewExecIo },
): Promise<
  | { ok: false; reason: ChangeGateReviewFailure; decision?: string }
  | Awaited<ReturnType<typeof executeChangeGateReReview>>
> {
  void command.clientTenantId;
  const actor = resolveJuryActor({
    userId: command.userId,
    memberships: command.memberships,
    clientTenantId: command.clientTenantId,
  });
  if (!actor.ok) return actor;
  const allowed = decideJuryMutation({
    actor,
    action: 'agent.execute',
    resourceTenantId: actor.tenantId,
    clientTenantId: command.clientTenantId,
  });
  if (!allowed.ok) return allowed;
  if (!command.gate) return { ok: false, reason: 'GATE_NOT_FOUND' };
  if (command.gate.tenantId !== actor.tenantId) return { ok: false, reason: 'TENANT_MISMATCH' };
  if (command.gate.status !== 'APPROVED') return { ok: false, reason: 'RE-REVIEW_NOT_APPROVED' };

  const existing = await io.request.findByGate(command.gate.id);
  if (existing?.status === 'EXECUTED') {
    return executeChangeGateReReview(
      {
        userId: command.userId,
        memberships: command.memberships,
        clientTenantId: command.clientTenantId,
        now: command.now,
        requestId: existing.id,
        siteName: command.siteName,
      },
      io.execution,
    );
  }
  const requested = await requestChangeGateReReview(command, io.request);
  if (!requested.ok) return requested;
  return executeChangeGateReReview(
    {
      userId: command.userId,
      memberships: command.memberships,
      clientTenantId: command.clientTenantId,
      now: command.now,
      requestId: requested.review.id,
      siteName: command.siteName,
    },
    io.execution,
  );
}
