/**
 * Stores one change-gate re-review.
 * The frozen pipeline runs only after READY is claimed, and only once.
 */
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { JURY_CORE_CONTRACT_VERSION, type JuryFinalSurface, type JuryMembership, type JuryNormalizedMetric, type JuryScopeStatus } from './records';
import {
  executeChangeGateReReview,
  requestChangeGateReReview,
  type ChangeGateReviewDraft,
  type ChangeGateReviewExecIo,
  type ChangeGateReviewRequestCommand,
  type ChangeGateReviewRequestTx,
  type ChangeGateReviewSnapshot,
} from './change-gate-rereview';
import type { ProductReviewCore } from './review-boundary';

type RequestOutcome = Awaited<ReturnType<typeof requestChangeGateReReview>>;
type ExecOutcome = Awaited<ReturnType<typeof executeChangeGateReReview>>;

export async function persistChangeGateReReviewRequest(input: {
  userId: string | null;
  memberships: readonly JuryMembership[];
  clientTenantId?: string | null;
  now: string;
  changeGateResultId: string;
  evidenceId: string;
  sourceEvidenceId: string;
  parentReviewResultId: string;
  reason: { code?: unknown; message?: unknown } | null;
}): Promise<RequestOutcome> {
  const { prisma } = await import('@/lib/prisma');
  const gate = await prisma.juryChangeGateResult.findUnique({ where: { id: input.changeGateResultId } });
  const execution = gate ? await prisma.juryAgentExecution.findUnique({ where: { id: gate.executionId } }) : null;
  const task = gate?.improvementTaskId
    ? await prisma.juryImprovementTask.findUnique({ where: { id: gate.improvementTaskId } })
    : null;
  const parent = await prisma.juryReviewResult.findUnique({ where: { id: input.parentReviewResultId } });
  const evidence = await prisma.juryEvidence.findUnique({ where: { id: input.evidenceId } });
  const metrics = evidence
    ? await prisma.juryNormalizedMetric.findMany({ where: { evidenceId: evidence.id, tenantId: evidence.tenantId } })
    : [];
  const scopes = evidence
    ? await prisma.juryAccessScope.findMany({
        where: { tenantId: evidence.tenantId, connectionId: evidence.connectionId },
        select: { tenantId: true, connectionId: true, status: true },
      })
    : [];
  const command: ChangeGateReviewRequestCommand = {
    userId: input.userId,
    memberships: input.memberships,
    clientTenantId: input.clientTenantId,
    now: input.now,
    reason: input.reason,
    gate: gate
      ? {
          id: gate.id,
          tenantId: gate.tenantId,
          status: gate.status ?? 'GATED',
          executionId: gate.executionId,
          improvementTaskId: gate.improvementTaskId ?? '',
        }
      : null,
    executionTenantId: execution?.tenantId ?? null,
    taskTenantId: task?.tenantId ?? null,
    parent: parent ? { id: parent.id, tenantId: parent.tenantId } : null,
    evidence: evidence ? mapEvidence(evidence) : null,
    sourceEvidenceId: input.sourceEvidenceId,
    metrics: metrics.map(mapMetric),
    scopes: scopes.map((scope) => ({
      tenantId: scope.tenantId,
      connectionId: scope.connectionId,
      status: scope.status as JuryScopeStatus,
    })),
  };
  return requestChangeGateReReview(command, requestTx(prisma, input.userId));
}

export async function persistChangeGateReReviewExecution(
  input: {
    userId: string | null;
    memberships: readonly JuryMembership[];
    clientTenantId?: string | null;
    now: string;
    requestId: string;
    siteName: string;
  },
  core?: ProductReviewCore,
): Promise<ExecOutcome> {
  const { prisma } = await import('@/lib/prisma');
  const io: ChangeGateReviewExecIo = {
    load: (requestId) => readSnapshot(requestId),
    async claimReady(requestId) {
      const updated = await prisma.juryChangeGateReview.updateMany({
        where: { id: requestId, status: 'READY' },
        data: { status: 'RUNNING', updatedAt: new Date(input.now) },
      });
      if (updated.count === 1) return 'CLAIMED';
      const row = await prisma.juryChangeGateReview.findUnique({ where: { id: requestId } });
      if (!row) return 'MISSING';
      if (row.status === 'EXECUTED') return 'EXECUTED';
      if (row.status === 'RUNNING') return 'RUNNING';
      return 'NOT_READY';
    },
    core: core ?? defaultCore,
    async commit({ request, result, review }) {
      await prisma.$transaction(async (tx) => {
        await tx.juryReviewRequest.create({
          data: {
            id: request.id,
            tenantId: request.tenantId,
            connectionId: request.connectionId,
            evidenceId: request.evidenceId,
            reviewType: request.reviewType,
            claim: request.claim ?? null,
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
          },
        });
        const finished = await tx.juryChangeGateReview.updateMany({
          where: { id: review.id, status: 'RUNNING' },
          data: {
            status: 'EXECUTED',
            reviewRequestId: request.id,
            reviewResultId: result.id,
            updatedAt: new Date(input.now),
          },
        });
        if (finished.count !== 1) throw new Error('REVIEW_NOT_RUNNING');
      });
    },
    async fail(requestId, errorCode) {
      await prisma.juryChangeGateReview.updateMany({
        where: { id: requestId, status: 'RUNNING' },
        data: { status: 'FAILED', errorCode, updatedAt: new Date(input.now) },
      });
    },
    async audit(action, review, result) {
      await prisma.juryAuditEvent.create({
        data: {
          id: createHash('sha256').update([review.id, action, result?.id ?? ''].join('\n')).digest('hex'),
          tenantId: review.tenantId,
          timestamp: new Date(input.now),
          actor: input.userId ?? 'unknown',
          action,
          evidenceId: review.evidenceId,
          reviewId: result?.id ?? review.parentReviewResultId,
          decision: result?.expectedDecision,
          improvementTaskId: review.improvementTaskId,
          agentExecutionId: review.agentExecutionId,
          provenance: {
            source: 'CHANGE_GATE',
            parentReviewResultId: review.parentReviewResultId,
            reviewRequestId: result?.reviewRequestId ?? review.reviewRequestId,
            reviewResultId: result?.id ?? review.reviewResultId,
            changeGateResultId: review.changeGateResultId,
            agentExecutionId: review.agentExecutionId,
            status: result ? 'EXECUTED' : review.status,
          } as Prisma.InputJsonValue,
        },
      });
    },
  };
  return executeChangeGateReReview(input, io);
}

async function defaultCore(args: Parameters<ProductReviewCore>[0]) {
  const { callFrozenReviewPipeline } = await import('./review-core');
  const { createMockReviewBoardLlm } = await import('../ai-review-board/mock-llm');
  return callFrozenReviewPipeline({ ...args, llm: createMockReviewBoardLlm() });
}

function requestTx(
  prisma: {
    juryChangeGateReview: {
      findUnique(args: { where: { changeGateResultId: string } }): Promise<ReviewRow | null>;
      create(args: { data: Prisma.JuryChangeGateReviewUncheckedCreateInput }): Promise<unknown>;
    };
    juryAuditEvent: {
      create(args: { data: Prisma.JuryAuditEventUncheckedCreateInput }): Promise<unknown>;
    };
  },
  userId: string | null,
): ChangeGateReviewRequestTx {
  return {
    async findByGate(changeGateResultId) {
      const row = await prisma.juryChangeGateReview.findUnique({ where: { changeGateResultId } });
      return row ? mapReview(row) : null;
    },
    async insert(row) {
      await prisma.juryChangeGateReview.create({
        data: {
          id: row.id,
          tenantId: row.tenantId,
          parentReviewResultId: row.parentReviewResultId,
          changeGateResultId: row.changeGateResultId,
          agentExecutionId: row.agentExecutionId,
          improvementTaskId: row.improvementTaskId,
          evidenceId: row.evidenceId,
          sourceEvidenceId: row.sourceEvidenceId,
          reason: row.reason,
          status: row.status,
          source: row.source,
          errorCode: row.errorCode,
          reviewRequestId: row.reviewRequestId,
          reviewResultId: row.reviewResultId,
          provenance: row.provenance as Prisma.InputJsonValue,
          createdAt: new Date(row.createdAt),
          updatedAt: new Date(row.updatedAt),
        },
      });
    },
    async auditRequested(row) {
      await prisma.juryAuditEvent.create({
        data: {
          id: createHash('sha256').update([row.id, 'REVIEW_REREVIEW_REQUESTED'].join('\n')).digest('hex'),
          tenantId: row.tenantId,
          timestamp: new Date(row.createdAt),
          actor: userId ?? 'unknown',
          action: 'REVIEW_REREVIEW_REQUESTED',
          evidenceId: row.evidenceId,
          reviewId: row.parentReviewResultId,
          improvementTaskId: row.improvementTaskId,
          agentExecutionId: row.agentExecutionId,
          provenance: {
            source: 'CHANGE_GATE',
            parentReviewResultId: row.parentReviewResultId,
            changeGateResultId: row.changeGateResultId,
            agentExecutionId: row.agentExecutionId,
            status: row.status,
          } as Prisma.InputJsonValue,
        },
      });
    },
  };
}

type ReviewRow = {
  id: string;
  tenantId: string;
  parentReviewResultId: string;
  changeGateResultId: string;
  agentExecutionId: string;
  improvementTaskId: string;
  evidenceId: string;
  sourceEvidenceId: string;
  reason: unknown;
  status: ChangeGateReviewDraft['status'];
  source: 'CHANGE_GATE';
  errorCode: string | null;
  reviewRequestId: string | null;
  reviewResultId: string | null;
  provenance: unknown;
  createdAt: Date;
  updatedAt: Date;
};

function mapReview(row: ReviewRow): ChangeGateReviewDraft {
  const reason = row.reason as { code?: unknown; message?: unknown };
  return {
    id: row.id,
    tenantId: row.tenantId,
    parentReviewResultId: row.parentReviewResultId,
    changeGateResultId: row.changeGateResultId,
    agentExecutionId: row.agentExecutionId,
    improvementTaskId: row.improvementTaskId,
    evidenceId: row.evidenceId,
    sourceEvidenceId: row.sourceEvidenceId,
    reason: {
      code: typeof reason.code === 'string' ? reason.code : '',
      message: typeof reason.message === 'string' ? reason.message : '',
    },
    status: row.status,
    source: 'CHANGE_GATE',
    errorCode: row.errorCode,
    reviewRequestId: row.reviewRequestId,
    reviewResultId: row.reviewResultId,
    provenance: row.provenance as ChangeGateReviewDraft['provenance'],
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function readSnapshot(requestId: string): Promise<ChangeGateReviewSnapshot | null> {
  const { prisma } = await import('@/lib/prisma');
  const review = await prisma.juryChangeGateReview.findUnique({ where: { id: requestId } });
  if (!review) return null;
  const [gate, execution, task, parent, evidence, metrics, scopes, result] = await Promise.all([
    prisma.juryChangeGateResult.findUnique({ where: { id: review.changeGateResultId } }),
    prisma.juryAgentExecution.findUnique({ where: { id: review.agentExecutionId } }),
    prisma.juryImprovementTask.findUnique({ where: { id: review.improvementTaskId } }),
    prisma.juryReviewResult.findUnique({ where: { id: review.parentReviewResultId } }),
    prisma.juryEvidence.findUnique({ where: { id: review.evidenceId } }),
    prisma.juryNormalizedMetric.findMany({ where: { evidenceId: review.evidenceId, tenantId: review.tenantId } }),
    prisma.juryAccessScope.findMany({
      where: { tenantId: review.tenantId },
      select: { tenantId: true, connectionId: true, status: true },
    }),
    review.reviewResultId ? prisma.juryReviewResult.findUnique({ where: { id: review.reviewResultId } }) : Promise.resolve(null),
  ]);
  return {
    review: mapReview(review),
    gate: gate
      ? {
          id: gate.id,
          tenantId: gate.tenantId,
          status: gate.status ?? 'GATED',
          executionId: gate.executionId,
          improvementTaskId: gate.improvementTaskId ?? '',
        }
      : null,
    executionTenantId: execution?.tenantId ?? null,
    taskTenantId: task?.tenantId ?? null,
    parent: parent ? { id: parent.id, tenantId: parent.tenantId } : null,
    evidence: evidence ? mapEvidence(evidence) : null,
    sourceEvidenceId: review.sourceEvidenceId,
    metrics: metrics.map(mapMetric),
    scopes: scopes.map((scope) => ({
      tenantId: scope.tenantId,
      connectionId: scope.connectionId,
      status: scope.status as JuryScopeStatus,
    })),
    result: result
      ? {
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
          finalSurface: result.finalSurface as JuryFinalSurface,
          contractVersion: JURY_CORE_CONTRACT_VERSION,
          completedAt: result.completedAt.toISOString(),
          parentReviewResultId: result.parentReviewResultId ?? review.parentReviewResultId,
          changeGateResultId: review.changeGateResultId,
          agentExecutionId: review.agentExecutionId,
        }
      : null,
  };
}

function mapEvidence(row: {
  id: string;
  tenantId: string;
  connectionId: string;
  purpose: string;
  periodStart: string;
  periodEnd: string;
  timezone: string;
  metricIds: unknown;
  adapterKey: string;
  collectedAt: Date;
  contentHash: string | null;
  piiExcluded: boolean;
  readOnly: boolean;
}): NonNullable<ChangeGateReviewRequestCommand['evidence']> {
  return {
    id: row.id,
    tenantId: row.tenantId,
    connectionId: row.connectionId,
    purpose: row.purpose,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    timezone: row.timezone,
    metricIds: Array.isArray(row.metricIds) ? row.metricIds.filter((item): item is string => typeof item === 'string') : [],
    adapterKey: row.adapterKey,
    collectedAt: row.collectedAt.toISOString(),
    contentHash: row.contentHash,
    piiExcluded: row.piiExcluded,
    readOnly: row.readOnly,
  };
}

function mapMetric(row: {
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
    id: row.id,
    tenantId: row.tenantId,
    connectionId: row.connectionId,
    evidenceId: row.evidenceId ?? undefined,
    metric: row.metric,
    value: row.value,
    unit: row.unit,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    timezone: row.timezone,
    sourceSystem: row.sourceSystem,
    sourceRef: row.sourceRef,
    collectedAt: row.collectedAt.toISOString(),
    availability: row.availability,
    rawValueText: row.rawValueText ?? undefined,
    rawPayloadRef: row.rawPayloadRef,
    adapterKey: row.adapterKey,
    adapterVersion: row.adapterVersion,
    ruleId: row.ruleId,
  };
}
