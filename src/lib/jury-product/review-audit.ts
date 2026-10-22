/**
 * RM-08 (I-005): REVIEW_STARTED / REVIEW_COMPLETED / REVIEW_FAILED audit events on BOTH
 * review execution paths (/evidence tenant review and connected-service review).
 * Best-effort: an audit write failure is swallowed and never changes the review outcome.
 * Uses the existing JuryAuditEvent table (no schema change).
 */
import { randomUUID } from 'node:crypto';

export type ReviewAuditAction = 'REVIEW_STARTED' | 'REVIEW_COMPLETED' | 'REVIEW_FAILED';

type AuditPrisma = { juryAuditEvent: { create(args: unknown): Promise<unknown> } };

export type ReviewAuditInput = {
  tenantId: string;
  actorUserId: string;
  action: ReviewAuditAction;
  evidenceId: string;
  /** STARTED/FAILED: review request id. COMPLETED: review result id (same as connected path). */
  reviewId: string;
  decision?: string | null;
  path: 'TENANT_EVIDENCE' | 'CONNECTED_SERVICE';
  reviewType: string;
  failureReason?: string | null;
};

export async function recordReviewAudit(prisma: AuditPrisma, input: ReviewAuditInput): Promise<boolean> {
  try {
    await prisma.juryAuditEvent.create({
      data: {
        id: randomUUID(),
        tenantId: input.tenantId,
        timestamp: new Date(),
        actor: input.actorUserId,
        action: input.action,
        evidenceId: input.evidenceId,
        reviewId: input.reviewId,
        ...(input.decision ? { decision: input.decision } : {}),
        provenance: {
          path: input.path,
          reviewType: input.reviewType,
          ...(input.failureReason ? { failureReason: input.failureReason } : {}),
          readOnly: true,
          piiExcluded: true,
        },
      },
    });
    return true;
  } catch (error) {
    console.warn('[review-audit] write failed', { action: input.action, code: (error as { code?: string })?.code ?? 'UNKNOWN' });
    return false;
  }
}
