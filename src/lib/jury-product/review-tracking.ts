/**
 * RM-01: persists review attempt lifecycle (RUNNING -> COMPLETED/FAILED), failure reason,
 * result source and per-LLM-call metadata. Tracking is best-effort: a tracking write failure
 * never changes the review outcome (it is reported via the returned flag only).
 */
import { createHash, randomUUID } from 'node:crypto';
import type { JuryResultSourceValue, LlmCallRecord } from './llm-call-log';

type TrackingPrisma = {
  juryReviewAttempt: {
    create(args: unknown): Promise<unknown>;
    update(args: unknown): Promise<unknown>;
  };
  juryLlmCallLog: { createMany(args: unknown): Promise<unknown> };
  juryReviewRequest: { updateMany(args: unknown): Promise<unknown> };
};

export type ReviewAttemptStart = {
  tenantId: string;
  reviewRequestKey: string;
  evidenceId: string;
  reviewType: string;
  startedAt: Date;
};

export async function startReviewAttempt(prisma: TrackingPrisma, input: ReviewAttemptStart): Promise<string | null> {
  const id = createHash('sha256').update([input.reviewRequestKey, randomUUID()].join('\n')).digest('hex');
  try {
    await prisma.juryReviewAttempt.create({
      data: {
        id,
        tenantId: input.tenantId,
        reviewRequestKey: input.reviewRequestKey,
        evidenceId: input.evidenceId,
        reviewType: input.reviewType,
        status: 'RUNNING',
        startedAt: input.startedAt,
      },
    });
    return id;
  } catch {
    return null;
  }
}

export type ReviewAttemptFinish = {
  tenantId: string;
  reviewRequestKey: string;
  status: 'COMPLETED' | 'FAILED';
  failureReason?: string | null;
  resultSource: JuryResultSourceValue;
  boardRunId?: string | null;
  calls: readonly LlmCallRecord[];
  finishedAt: Date;
};

export async function finishReviewAttempt(
  prisma: TrackingPrisma,
  attemptId: string | null,
  input: ReviewAttemptFinish,
): Promise<boolean> {
  if (!attemptId) return false;
  try {
    await prisma.juryReviewAttempt.update({
      where: { id: attemptId },
      data: {
        status: input.status,
        failureReason: input.failureReason ?? null,
        resultSource: input.resultSource,
        boardRunId: input.boardRunId ?? null,
        finishedAt: input.finishedAt,
      },
    });
    if (input.calls.length > 0) {
      await prisma.juryLlmCallLog.createMany({
        data: input.calls.map((call) => ({
          id: `${attemptId}:${call.seq}`,
          tenantId: input.tenantId,
          attemptId,
          seq: call.seq,
          provider: call.provider,
          model: call.model,
          operation: call.operation,
          memberId: call.memberId,
          status: call.status,
          errorCode: call.errorCode,
          latencyMs: call.latencyMs,
          startedAt: new Date(call.startedAt),
        })),
        skipDuplicates: true,
      });
    }
    if (input.status === 'COMPLETED') {
      await prisma.juryReviewRequest.updateMany({
        where: { id: input.reviewRequestKey, tenantId: input.tenantId },
        data: { resultSource: input.resultSource, failureReason: null },
      });
    }
    return true;
  } catch {
    return false;
  }
}
