/**
 * Persists a verification result and a READY re-review request.
 * It does not call the review core.
 */
import { createHash } from 'node:crypto';
import type { JuryMembership } from './records';
import type { DecisionTaskDraft } from './decision-task';
import {
  observationsFromStoredMetrics,
  requestVerificationReReview,
  resolveVerification,
  type VerificationObservation,
  type VerificationProvenance,
  type VerificationResultDraft,
  type VerificationReviewDraft,
  type VerificationWriteTx,
} from './verification-resolution';

type ResolutionOutcome = Awaited<ReturnType<typeof resolveVerification>>;
type ReviewOutcome = Awaited<ReturnType<typeof requestVerificationReReview>>;

export async function persistVerificationResolution(input: {
  userId: string | null;
  memberships: readonly JuryMembership[];
  clientTenantId?: string | null;
  now: string;
  decisionTaskId: string;
}): Promise<ResolutionOutcome> {
  const { prisma } = await import('@/lib/prisma');
  return prisma.$transaction(async (tx) => {
    const row = await tx.juryDecisionTask.findUnique({ where: { id: input.decisionTaskId } });
    if (!row) {
      return resolveVerification(
        {
          userId: input.userId,
          memberships: input.memberships,
          clientTenantId: input.clientTenantId,
          now: input.now,
          task: null,
          reviewResult: emptyReview(),
          evidence: { id: '', tenantId: '' },
          observations: [],
        },
        emptyTx(),
      );
    }
    const review = await tx.juryReviewResult.findUnique({ where: { id: row.reviewResultId } });
    const evidence = await tx.juryEvidence.findUnique({ where: { id: row.evidenceId } });
    if (!review || !evidence) {
      return { ok: false, reason: 'TASK_NOT_FOUND' };
    }
    const metrics = await tx.juryNormalizedMetric.findMany({
      where: { evidenceId: evidence.id, tenantId: row.tenantId },
    });
    const observations = observationsFromStoredMetrics(
      metrics.map((metric) => ({
        metric: metric.metric,
        value: metric.value,
        availability: metric.availability,
        sourceSystem: metric.sourceSystem,
        sourceRef: metric.sourceRef,
        collectedAt: metric.collectedAt.toISOString(),
        ruleId: metric.ruleId,
        evidenceId: metric.evidenceId,
        rawValueText: metric.rawValueText,
      })),
    );
    const boundary = prismaBoundary(tx, input.now, input.userId, mapTask(row));
    return resolveVerification(
      {
        userId: input.userId,
        memberships: input.memberships,
        clientTenantId: input.clientTenantId,
        now: input.now,
        task: mapTask(row),
        reviewResult: {
          id: review.id,
          tenantId: review.tenantId,
          evidenceId: row.evidenceId,
          expectedDecision: review.expectedDecision,
          conflictDetected: review.conflictDetected,
          overclaimDetected: review.overclaimDetected,
          revisionRequired: review.revisionRequired,
        },
        evidence: { id: evidence.id, tenantId: evidence.tenantId, contentHash: evidence.contentHash },
        observations,
      },
      boundary,
    );
  });
}

export async function persistVerificationReReview(input: {
  userId: string | null;
  memberships: readonly JuryMembership[];
  clientTenantId?: string | null;
  now: string;
  decisionTaskId: string;
}): Promise<ReviewOutcome> {
  const { prisma } = await import('@/lib/prisma');
  return prisma.$transaction(async (tx) => {
    const row = await tx.juryDecisionTask.findUnique({ where: { id: input.decisionTaskId } });
    const result = row
      ? await tx.juryVerificationResult.findUnique({ where: { decisionTaskId: row.id } })
      : null;
    if (!row || !result) return { ok: false, reason: 'RESULT_REQUIRED' };
    const evidence = await tx.juryEvidence.findUnique({ where: { id: row.evidenceId } });
    if (!evidence) return { ok: false, reason: 'TASK_NOT_FOUND' };
    return requestVerificationReReview(
      {
        userId: input.userId,
        memberships: input.memberships,
        clientTenantId: input.clientTenantId,
        now: input.now,
        task: mapTask(row),
        result: mapResult(result),
        evidence: { id: evidence.id, tenantId: evidence.tenantId },
        parentReviewResultId: row.reviewResultId,
      },
      prismaBoundary(tx, input.now, input.userId, mapTask(row)),
    );
  });
}

function emptyReview() {
  return {
    id: '',
    tenantId: '',
    evidenceId: '',
    expectedDecision: 'VERIFY',
    conflictDetected: false,
    overclaimDetected: false,
    revisionRequired: false,
  };
}

function emptyTx(): VerificationWriteTx {
  return {
    tasks: [],
    results: [],
    reviews: [],
    async findTask() {
      return null;
    },
    async saveTask() {},
    async findResult() {
      return null;
    },
    async insertResult() {},
    async findReview() {
      return null;
    },
    async insertReview() {},
    async audit() {},
  };
}

function prismaBoundary(
  tx: {
    juryDecisionTask: {
      update(args: { where: { id: string }; data: { status: DecisionTaskDraft['status']; updatedAt: Date } }): Promise<unknown>;
    };
    juryVerificationResult: {
      findUnique(args: { where: { decisionTaskId: string } }): Promise<Parameters<typeof mapResult>[0] | null>;
      create(args: { data: ReturnType<typeof resultData> }): Promise<unknown>;
    };
    juryVerificationReview: {
      findUnique(args: { where: { verificationResultId: string } }): Promise<Parameters<typeof mapReview>[0] | null>;
      create(args: { data: ReturnType<typeof reviewData> }): Promise<unknown>;
    };
    juryAuditEvent: {
      create(args: { data: Record<string, unknown> }): Promise<unknown>;
    };
  },
  now: string,
  userId: string | null,
  loaded: DecisionTaskDraft,
): VerificationWriteTx {
  let current = loaded;
  return {
    tasks: [],
    results: [],
    reviews: [],
    async findTask(id) {
      return current.id === id ? current : null;
    },
    async saveTask(task) {
      await tx.juryDecisionTask.update({
        where: { id: task.id },
        data: { status: task.status, updatedAt: new Date(task.updatedAt) },
      });
      current = task;
    },
    async findResult(decisionTaskId) {
      const row = await tx.juryVerificationResult.findUnique({ where: { decisionTaskId } });
      return row ? mapResult(row) : null;
    },
    async insertResult(result) {
      await tx.juryVerificationResult.create({ data: resultData(result) });
    },
    async findReview(verificationResultId) {
      const row = await tx.juryVerificationReview.findUnique({ where: { verificationResultId } });
      return row ? mapReview(row) : null;
    },
    async insertReview(review) {
      await tx.juryVerificationReview.create({ data: reviewData(review) });
    },
    async audit(action) {
      await tx.juryAuditEvent.create({
        data: {
          id: createHash('sha256').update([current.id, action].join('\n')).digest('hex'),
          tenantId: current.tenantId,
          timestamp: new Date(now),
          actor: userId ?? 'unknown',
          action,
          evidenceId: current.evidenceId,
          reviewId: current.reviewResultId,
          decision: current.decision,
          improvementTaskId: current.id,
        },
      });
    },
  };
}

function mapTask(row: {
  id: string;
  tenantId: string;
  reviewResultId: string;
  evidenceId: string;
  taskType: DecisionTaskDraft['taskType'];
  decision: string;
  title: string;
  description: string;
  reason: string;
  status: DecisionTaskDraft['status'];
  createdAt: Date;
  updatedAt: Date;
}): DecisionTaskDraft {
  if (row.decision !== 'VERIFY' && row.decision !== 'REWORD') throw new Error('DECISION_NOT_IN_CONTRACT');
  return {
    id: row.id,
    tenantId: row.tenantId,
    reviewResultId: row.reviewResultId,
    evidenceId: row.evidenceId,
    taskType: row.taskType,
    decision: row.decision,
    title: row.title,
    description: row.description,
    reason: row.reason,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function mapResult(row: {
  id: string;
  tenantId: string;
  decisionTaskId: string;
  reviewResultId: string;
  evidenceId: string;
  status: VerificationResultDraft['status'];
  finding: string;
  verificationGoal: string;
  provenance: unknown;
  fingerprint: string;
  createdAt: Date;
  updatedAt: Date;
}): VerificationResultDraft {
  return {
    id: row.id,
    tenantId: row.tenantId,
    decisionTaskId: row.decisionTaskId,
    reviewResultId: row.reviewResultId,
    evidenceId: row.evidenceId,
    status: row.status,
    finding: row.finding,
    verificationGoal: row.verificationGoal,
    provenance: row.provenance as VerificationProvenance,
    fingerprint: row.fingerprint,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function mapReview(row: {
  id: string;
  tenantId: string;
  evidenceId: string;
  parentReviewResultId: string;
  verificationResultId: string;
  decisionTaskId: string;
  type: 'VERIFICATION_REREVIEW';
  status: VerificationReviewDraft['status'];
  createdAt: Date;
  updatedAt: Date;
}): VerificationReviewDraft {
  return {
    id: row.id,
    tenantId: row.tenantId,
    evidenceId: row.evidenceId,
    parentReviewResultId: row.parentReviewResultId,
    verificationResultId: row.verificationResultId,
    decisionTaskId: row.decisionTaskId,
    type: row.type,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function resultData(result: VerificationResultDraft) {
  return {
    id: result.id,
    tenantId: result.tenantId,
    decisionTaskId: result.decisionTaskId,
    reviewResultId: result.reviewResultId,
    evidenceId: result.evidenceId,
    status: result.status,
    finding: result.finding,
    verificationGoal: result.verificationGoal,
    provenance: result.provenance,
    fingerprint: result.fingerprint,
    createdAt: new Date(result.createdAt),
    updatedAt: new Date(result.updatedAt),
  };
}

function reviewData(review: VerificationReviewDraft) {
  return {
    id: review.id,
    tenantId: review.tenantId,
    evidenceId: review.evidenceId,
    parentReviewResultId: review.parentReviewResultId,
    verificationResultId: review.verificationResultId,
    decisionTaskId: review.decisionTaskId,
    type: review.type,
    status: review.status,
    createdAt: new Date(review.createdAt),
    updatedAt: new Date(review.updatedAt),
  };
}

export type { VerificationObservation };
