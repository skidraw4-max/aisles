/**
 * Persists one verification re-review.
 * The frozen pipeline is called from review-core.ts, and only after the READY claim.
 */
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import type { JuryMembership, JuryNormalizedMetric, JuryScopeStatus } from './records';
import type { ProductReviewCore } from './review-boundary';
import {
  executeVerificationReReview,
  type ReReviewIo,
  type ReReviewSnapshot,
} from './verification-rereview';

type ExecutionOutcome = Awaited<ReturnType<typeof executeVerificationReReview>>;

export async function persistVerificationReReviewExecution(input: {
  userId: string | null;
  memberships: readonly JuryMembership[];
  clientTenantId?: string | null;
  now: string;
  requestId: string;
  siteName: string;
},
core?: ProductReviewCore,
): Promise<ExecutionOutcome> {
  const { prisma } = await import('@/lib/prisma');
  let loaded: ReReviewSnapshot | null | undefined;
  const load = async (requestId: string) => {
    if (loaded === undefined || loaded?.review.id !== requestId) {
      loaded = await readSnapshot(requestId);
    }
    return loaded;
  };
  const io: ReReviewIo = {
    load,
    async claimReady(requestId) {
      const updated = await prisma.juryVerificationReview.updateMany({
        where: { id: requestId, status: 'READY' },
        data: { status: 'RUNNING', updatedAt: new Date(input.now) },
      });
      if (updated.count === 1) return 'CLAIMED';
      const row = await prisma.juryVerificationReview.findUnique({ where: { id: requestId } });
      if (!row) return 'MISSING';
      if (row.status === 'EXECUTED') return 'EXECUTED';
      if (row.status === 'RUNNING') return 'RUNNING';
      return 'NOT_READY';
    },
    async core(args) {
      if (core) return core(args);
      const { callFrozenReviewPipeline } = await import('./review-core');
      const { createGeminiReviewBoardLlm } = await import('../ai-review-board/gemini-llm');
      return callFrozenReviewPipeline({ ...args, llm: createGeminiReviewBoardLlm() });
    },
    async commit({ request, result }) {
      await prisma.$transaction(async (tx) => {
        await tx.juryReviewRequest.create({
          data: {
            id: request.id,
            tenantId: request.tenantId,
            connectionId: request.connectionId,
            evidenceId: request.evidenceId,
            reviewType: request.reviewType,
            claim: 'claim' in request ? request.claim ?? null : null,
            mode: request.mode,
            status: request.status,
            coreRootDir: request.coreRootDir,
            requestedByUserId: request.requestedByUserId ?? null,
          },
        });
        await tx.juryReviewResult.create({
          data: {
            id: result.id,
            tenantId: result.tenantId,
            reviewRequestId: result.reviewRequestId,
            boardRunId: result.boardRunId,
            evidenceStrength: result.evidenceStrength,
            claimStrength: result.claimStrength,
            conflictDetected: result.conflictDetected,
            overclaimDetected: result.overclaimDetected,
            revisionRequired: result.revisionRequired,
            expectedDecision: result.expectedDecision,
            finalSurface: result.finalSurface as Prisma.InputJsonValue,
            contractVersion: result.contractVersion,
            completedAt: new Date(result.completedAt),
            parentReviewResultId: result.parentReviewResultId,
            verificationResultId: result.verificationResultId,
            decisionTaskId: result.decisionTaskId,
            reReviewRequestId: result.reReviewRequestId,
          },
        });
        const finished = await tx.juryVerificationReview.updateMany({
          where: { id: result.reReviewRequestId, status: 'RUNNING' },
          data: { status: 'EXECUTED', updatedAt: new Date(input.now) },
        });
        if (finished.count !== 1) throw new Error('REVIEW_NOT_RUNNING');
      });
    },
    async fail(requestId) {
      await prisma.juryVerificationReview.updateMany({
        where: { id: requestId, status: 'RUNNING' },
        data: { status: 'FAILED', updatedAt: new Date(input.now) },
      });
    },
    async audit(action) {
      const snapshot = await load(input.requestId);
      if (!snapshot) return;
      await prisma.juryAuditEvent.create({
        data: {
          id: createHash('sha256').update([snapshot.review.id, action].join('\n')).digest('hex'),
          tenantId: snapshot.review.tenantId,
          timestamp: new Date(input.now),
          actor: input.userId ?? 'unknown',
          action,
          evidenceId: snapshot.review.evidenceId,
          reviewId: snapshot.review.parentReviewResultId,
          decision: snapshot.parent.expectedDecision,
          improvementTaskId: snapshot.review.decisionTaskId,
        },
      });
    },
  };
  return executeVerificationReReview(input, io);
}

async function readSnapshot(requestId: string): Promise<ReReviewSnapshot | null> {
  const { prisma } = await import('@/lib/prisma');
  const review = await prisma.juryVerificationReview.findUnique({ where: { id: requestId } });
  if (!review) return null;
  const [parent, verification, task, evidence, metrics, scopes] = await Promise.all([
    prisma.juryReviewResult.findUnique({ where: { id: review.parentReviewResultId } }),
    prisma.juryVerificationResult.findUnique({ where: { id: review.verificationResultId } }),
    prisma.juryDecisionTask.findUnique({ where: { id: review.decisionTaskId } }),
    prisma.juryEvidence.findUnique({ where: { id: review.evidenceId } }),
    prisma.juryNormalizedMetric.findMany({ where: { evidenceId: review.evidenceId, tenantId: review.tenantId } }),
    prisma.juryAccessScope.findMany({
      where: { tenantId: review.tenantId },
      select: { tenantId: true, connectionId: true, status: true },
    }),
  ]);
  if (!parent || !verification || !task) return null;
  return {
    review: {
      id: review.id,
      tenantId: review.tenantId,
      evidenceId: review.evidenceId,
      parentReviewResultId: review.parentReviewResultId,
      verificationResultId: review.verificationResultId,
      decisionTaskId: review.decisionTaskId,
      type: review.type,
      status: review.status,
    },
    parent: {
      id: parent.id,
      tenantId: parent.tenantId,
      expectedDecision: parent.expectedDecision,
      conflictDetected: parent.conflictDetected,
      completedAt: parent.completedAt.toISOString(),
    },
    verification: {
      id: verification.id,
      tenantId: verification.tenantId,
      status: verification.status,
      finding: verification.finding,
      fingerprint: verification.fingerprint,
      reviewResultId: verification.reviewResultId,
      decisionTaskId: verification.decisionTaskId,
      evidenceId: verification.evidenceId,
    },
    task: {
      id: task.id,
      tenantId: task.tenantId,
      status: task.status,
      taskType: task.taskType,
      reviewResultId: task.reviewResultId,
      evidenceId: task.evidenceId,
    },
    evidence: evidence
      ? {
          id: evidence.id,
          tenantId: evidence.tenantId,
          connectionId: evidence.connectionId,
          purpose: evidence.purpose,
          periodStart: evidence.periodStart,
          periodEnd: evidence.periodEnd,
          timezone: evidence.timezone,
          metricIds: stringList(evidence.metricIds),
          adapterKey: evidence.adapterKey,
          collectedAt: evidence.collectedAt.toISOString(),
          contentHash: evidence.contentHash,
          piiExcluded: evidence.piiExcluded,
          readOnly: evidence.readOnly,
        }
      : null,
    metrics: metrics.map(mapMetric),
    scopes: scopes.map((scope) => ({
      tenantId: scope.tenantId,
      connectionId: scope.connectionId,
      status: scope.status,
    })),
  };
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function mapMetric(metric: {
  id: string;
  tenantId: string;
  connectionId: string;
  evidenceId: string | null;
  metric: string;
  value: number | null;
  unit: JuryNormalizedMetric['unit'];
  periodStart: string;
  periodEnd: string;
  timezone: string;
  sourceSystem: JuryNormalizedMetric['sourceSystem'];
  sourceRef: string;
  collectedAt: Date;
  availability: JuryNormalizedMetric['availability'];
  rawValueText: string | null;
  rawPayloadRef: string;
  adapterKey: string;
  adapterVersion: string;
  ruleId: string;
}): JuryNormalizedMetric {
  return {
    id: metric.id,
    tenantId: metric.tenantId,
    connectionId: metric.connectionId,
    ...(metric.evidenceId ? { evidenceId: metric.evidenceId } : {}),
    metric: metric.metric,
    value: metric.value,
    unit: metric.unit,
    periodStart: metric.periodStart,
    periodEnd: metric.periodEnd,
    timezone: metric.timezone,
    sourceSystem: metric.sourceSystem,
    sourceRef: metric.sourceRef,
    collectedAt: metric.collectedAt.toISOString(),
    availability: metric.availability,
    ...(metric.rawValueText != null ? { rawValueText: metric.rawValueText } : {}),
    rawPayloadRef: metric.rawPayloadRef,
    adapterKey: metric.adapterKey,
    adapterVersion: metric.adapterVersion,
    ruleId: metric.ruleId,
  };
}

export type { JuryScopeStatus };
