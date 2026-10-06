/**
 * Stores a REWORD improvement task. It does not start an agent.
 */
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import type { JuryMembership } from './records';
import { JURY_CORE_CONTRACT_VERSION, JURY_PRODUCT_DATA_ROOT } from './records';
import type { DecisionTaskDraft } from './decision-task';
import {
  REWORD_FIXTURE_OBJECTIVE,
  REWORD_FIXTURE_REASON,
  bridgeImprovement,
  type ImprovementTaskDraft,
  type ImprovementWriteTx,
} from './improvement-bridge';

type BridgeOutcome = Awaited<ReturnType<typeof bridgeImprovement>>;

function stableId(parts: readonly string[]): string {
  return createHash('sha256').update(parts.join('\n')).digest('hex');
}

export async function ensureRewordFixture(input: {
  userId: string | null;
  memberships: readonly JuryMembership[];
  clientTenantId?: string | null;
  now: string;
  evidenceId: string;
}): Promise<{ ok: true; reviewResultId: string; created: boolean } | { ok: false; reason: 'TENANT_MISMATCH' | 'EVIDENCE_MISSING' }> {
  const { prisma } = await import('@/lib/prisma');
  const { resolveJuryActor } = await import('./access');
  const actor = resolveJuryActor({
    userId: input.userId,
    memberships: input.memberships,
    clientTenantId: input.clientTenantId,
  });
  if (!actor.ok) return { ok: false, reason: 'TENANT_MISMATCH' };
  const evidence = await prisma.juryEvidence.findUnique({ where: { id: input.evidenceId } });
  if (!evidence) return { ok: false, reason: 'EVIDENCE_MISSING' };
  if (evidence.tenantId !== actor.tenantId) return { ok: false, reason: 'TENANT_MISMATCH' };
  const requestId = stableId([actor.tenantId, evidence.id, 'phase16-reword-fixture']);
  const resultId = stableId([requestId, 'reword-result']);
  const existing = await prisma.juryReviewResult.findUnique({ where: { id: resultId } });
  if (existing) return { ok: true, reviewResultId: existing.id, created: false };
  await prisma.$transaction(async (tx) => {
    await tx.juryReviewRequest.create({
      data: {
        id: requestId,
        tenantId: actor.tenantId,
        connectionId: evidence.connectionId,
        evidenceId: evidence.id,
        reviewType: 'FULL_REVIEW',
        claim: null,
        mode: 'AISLE_SELF',
        status: 'COMPLETED',
        coreRootDir: JURY_PRODUCT_DATA_ROOT,
        requestedByUserId: actor.userId,
      },
    });
    await tx.juryReviewResult.create({
      data: {
        id: resultId,
        tenantId: actor.tenantId,
        reviewRequestId: requestId,
        boardRunId: 'fixture-reword-phase16',
        evidenceStrength: 'moderate',
        claimStrength: 'weak',
        conflictDetected: false,
        overclaimDetected: true,
        revisionRequired: true,
        expectedDecision: 'REWORD',
        finalSurface: {
          statusSummary: REWORD_FIXTURE_REASON,
          topProblems: [],
          expectedUserEffect: '',
          risk: '',
          dimensionEvidence: [],
          supportedClaims: [],
          partiallySupportedClaims: [],
          hypotheses: [],
        },
        contractVersion: JURY_CORE_CONTRACT_VERSION,
        completedAt: new Date(input.now),
      },
    });
  });
  return { ok: true, reviewResultId: resultId, created: true };
}

export async function persistImprovementBridge(input: {
  userId: string | null;
  memberships: readonly JuryMembership[];
  clientTenantId?: string | null;
  now: string;
  decisionTaskId: string;
  reason: string;
  objective: string;
}): Promise<BridgeOutcome> {
  const { prisma } = await import('@/lib/prisma');
  const { resolveJuryActor } = await import('./access');
  const actor = resolveJuryActor({
    userId: input.userId,
    memberships: input.memberships,
    clientTenantId: input.clientTenantId,
  });
  if (!actor.ok) return actor;
  const task = await prisma.juryDecisionTask.findUnique({ where: { id: input.decisionTaskId } });
  if (!task) return { ok: false, reason: 'TASK_NOT_FOUND' };
  const review = await prisma.juryReviewResult.findUnique({ where: { id: task.reviewResultId } });
  const evidence = await prisma.juryEvidence.findUnique({ where: { id: task.evidenceId } });
  if (!review || !evidence) return { ok: false, reason: 'TASK_NOT_FOUND' };
  return prisma.$transaction(async (tx) =>
    bridgeImprovement(
      {
        userId: input.userId,
        memberships: input.memberships,
        clientTenantId: input.clientTenantId,
        now: input.now,
        decisionTask: mapTask(task),
        reviewResult: {
          id: review.id,
          tenantId: review.tenantId,
          evidenceId: task.evidenceId,
          expectedDecision: review.expectedDecision,
          evidenceStrength: review.evidenceStrength,
          claimStrength: review.claimStrength,
          conflictDetected: review.conflictDetected,
          overclaimDetected: review.overclaimDetected,
          revisionRequired: review.revisionRequired,
        },
        evidence: { id: evidence.id, tenantId: evidence.tenantId },
        reason: input.reason,
        objective: input.objective,
      },
      prismaTx(tx, input.userId),
    ),
  );
}

function prismaTx(
  tx: {
    juryImprovementTask: {
      findFirst(args: { where: { decisionTaskId: string; taskType: 'REWORD' } }): Promise<ImprovementRow | null>;
      create(args: { data: ReturnType<typeof taskData> }): Promise<unknown>;
    };
    juryAuditEvent: {
      create(args: { data: Record<string, unknown> }): Promise<unknown>;
    };
  },
  userId: string | null,
): ImprovementWriteTx {
  return {
    async findByDecisionTask(decisionTaskId, taskType) {
      const row = await tx.juryImprovementTask.findFirst({ where: { decisionTaskId, taskType } });
      return row ? mapImprovement(row) : null;
    },
    async insert(task) {
      await tx.juryImprovementTask.create({ data: taskData(task) });
    },
    async audit(action, task) {
      await tx.juryAuditEvent.create({
        data: {
          id: createHash('sha256').update([task.id, action].join('\n')).digest('hex'),
          tenantId: task.tenantId,
          timestamp: new Date(task.createdAt),
          actor: userId ?? 'unknown',
          action,
          evidenceId: task.evidenceId,
          reviewId: task.reviewResultId,
          decision: 'REWORD',
          improvementTaskId: task.id,
          decisionTaskId: task.decisionTaskId,
        },
      });
    },
  };
}

type ImprovementRow = {
  id: string;
  tenantId: string;
  reviewResultId: string;
  decisionTaskId: string | null;
  evidenceId: string | null;
  taskType: 'REWORD' | 'VERIFICATION' | null;
  title: string | null;
  description: string | null;
  reason: string | null;
  objective: string | null;
  constraints: unknown;
  diagnosis: string;
  acceptanceCriteria: unknown;
  status: string;
  loopIndex: number;
  loopPolicy: unknown;
  provenance: unknown;
  createdAt: Date | null;
  updatedAt: Date | null;
};

function mapImprovement(row: ImprovementRow): ImprovementTaskDraft {
  if (!row.decisionTaskId || !row.evidenceId || row.taskType !== 'REWORD' || row.status !== 'OPEN') {
    throw new Error('IMPROVEMENT_SHAPE');
  }
  const provenance = row.provenance as ImprovementTaskDraft['provenance'];
  const constraints = Array.isArray(row.constraints) ? row.constraints.filter((item): item is string => typeof item === 'string') : [];
  const acceptance = Array.isArray(row.acceptanceCriteria)
    ? row.acceptanceCriteria.filter((item): item is string => typeof item === 'string')
    : [];
  return {
    id: row.id,
    tenantId: row.tenantId,
    reviewResultId: row.reviewResultId,
    decisionTaskId: row.decisionTaskId,
    evidenceId: row.evidenceId,
    taskType: 'REWORD',
    title: row.title ?? '',
    description: row.description ?? '',
    reason: row.reason ?? '',
    objective: row.objective ?? '',
    constraints,
    diagnosis: row.diagnosis,
    acceptanceCriteria: acceptance,
    status: 'OPEN',
    loopIndex: row.loopIndex,
    loopPolicy: row.loopPolicy as ImprovementTaskDraft['loopPolicy'],
    provenance,
    createdAt: row.createdAt?.toISOString() ?? '',
    updatedAt: row.updatedAt?.toISOString() ?? '',
  };
}

function taskData(task: ImprovementTaskDraft) {
  return {
    id: task.id,
    tenantId: task.tenantId,
    reviewResultId: task.reviewResultId,
    diagnosis: task.diagnosis,
    acceptanceCriteria: task.acceptanceCriteria,
    status: task.status,
    loopIndex: task.loopIndex,
    loopPolicy: task.loopPolicy,
    decisionTaskId: task.decisionTaskId,
    evidenceId: task.evidenceId,
    taskType: task.taskType,
    title: task.title,
    description: task.description,
    reason: task.reason,
    objective: task.objective,
    constraints: task.constraints,
    provenance: task.provenance as Prisma.InputJsonValue,
    createdAt: new Date(task.createdAt),
    updatedAt: new Date(task.updatedAt),
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

export { REWORD_FIXTURE_OBJECTIVE, REWORD_FIXTURE_REASON };
