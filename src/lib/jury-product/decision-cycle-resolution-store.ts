/**
 * Persists a re-review decision onto an existing cycle.
 * A missing cycle starts a new improvement cycle only for a completed REWORD review.
 */
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import type { JuryDecision, JuryMembership } from './records';
import type { DecisionTaskDraft } from './decision-task';
import type { ImprovementTaskDraft } from './improvement-bridge';
import { PRODUCT_LOOP_GUARD_DEFAULTS, type CycleReviewNode, type DecisionCycleDraft, type ProductLoopGuardPolicy } from './loop-guard';
import { resolveDecisionCycleLineage, type LineageCycleRef } from './decision-cycle-lineage';
import { loadLoopSpend } from './loop-spend';
import { resolveReReviewDecision, type ResolutionFailure, type ResolutionSnapshot } from './decision-cycle-resolution';
import {
  CycleStartAbort,
  improvementCycleAction,
  isUniqueViolation,
  startNewImprovementCycle,
  type StartIo,
  type StartLoaded,
} from './improvement-cycle-start';

type Outcome = Awaited<ReturnType<typeof resolveReReviewDecision>> | Awaited<ReturnType<typeof startNewImprovementCycle>>;

export async function persistReReviewDecision(input: {
  userId: string | null;
  memberships: readonly JuryMembership[];
  clientTenantId?: string | null;
  now: string;
  reviewResultId: string;
}): Promise<Outcome> {
  const { prisma } = await import('@/lib/prisma');
  try {
    return await prisma.$transaction((tx) => apply(tx, input));
  } catch (error) {
    if (error instanceof CycleStartAbort) return { ok: false, reason: error.reason };
    if (isUniqueViolation(error) || (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) {
      return prisma.$transaction((tx) => apply(tx, input));
    }
    throw error;
  }
}

async function apply(
  tx: Prisma.TransactionClient,
  input: {
    userId: string | null;
    memberships: readonly JuryMembership[];
    clientTenantId?: string | null;
    now: string;
    reviewResultId: string;
  },
): Promise<Outcome> {
  const primed = await readBoundary(tx, input.reviewResultId);
  const snapshot = await readSnapshot(tx, input.reviewResultId, input.now, primed);
  if (!snapshot.ok) {
    if (snapshot.reason !== 'DECISION_CYCLE_NOT_FOUND') return snapshot;
    return startNewImprovementCycle(input, startBoundary(tx, input, { id: input.reviewResultId, loaded: primed?.loaded ?? null }));
  }
  const cycle = snapshot.snapshot.cycle;
  if (cycle && improvementCycleAction({ ok: true, cycle }, input.reviewResultId) === 'REPLAY') {
    return startNewImprovementCycle(input, startBoundary(tx, input));
  }
  return resolveReReviewDecision(input, {
    async load(reviewResultId) {
      if (reviewResultId !== input.reviewResultId) {
        const againPrimed = await readBoundary(tx, reviewResultId);
        const again = await readSnapshot(tx, reviewResultId, input.now, againPrimed);
        return again.ok ? again.snapshot : null;
      }
      return snapshot.snapshot;
    },
    async saveCycle(cycle) {
      await tx.juryDecisionCycle.updateMany({
        where: { id: cycle.id, tenantId: cycle.tenantId, rootReviewResultId: cycle.rootReviewResultId, status: 'ACTIVE' },
        data: {
          currentReviewResultId: cycle.currentReviewResultId,
          iteration: cycle.iteration,
          verificationAttempts: cycle.verificationAttempts,
          sameDecisionCount: cycle.sameDecisionCount,
          sameConflictCount: cycle.sameConflictCount,
          decisionFingerprint: cycle.decisionFingerprint,
          conflictFingerprint: cycle.conflictFingerprint,
          status: cycle.status,
          blockedReason: cycle.blockedReason,
          updatedAt: new Date(cycle.updatedAt),
        },
      });
    },
    async audit(action, review, reason) {
      const id = createHash('sha256').update([review.id, action, reason].join('\n')).digest('hex');
      const existing = await tx.juryAuditEvent.findUnique({ where: { id } });
      if (existing) return;
      await tx.juryAuditEvent.create({
        data: {
          id,
          tenantId: review.tenantId,
          timestamp: new Date(input.now),
          actor: input.userId ?? 'unknown',
          action,
          evidenceId: review.evidenceId,
          reviewId: review.id,
          decision: review.expectedDecision,
          testResult: reason,
          provenance: { source: 'CHANGE_GATE', guard: reason } as Prisma.InputJsonValue,
        },
      });
    },
    decisionTx: {
      async findByResultAndType(reviewResultId, taskType) {
        const row = await tx.juryDecisionTask.findUnique({ where: { reviewResultId_taskType: { reviewResultId, taskType } } });
        return row ? mapDecision(row) : null;
      },
      async insert(task, audit) {
        await tx.juryDecisionTask.create({
          data: {
            id: task.id,
            tenantId: task.tenantId,
            reviewResultId: task.reviewResultId,
            evidenceId: task.evidenceId,
            taskType: task.taskType,
            decision: task.decision,
            title: task.title,
            description: task.description,
            reason: task.reason,
            status: task.status,
            createdAt: new Date(task.createdAt),
            updatedAt: new Date(task.updatedAt),
          },
        });
        await tx.juryAuditEvent.create({
          data: {
            id: audit.id,
            tenantId: audit.tenantId,
            timestamp: new Date(audit.timestamp),
            actor: audit.actorUserId,
            action: audit.action,
            evidenceId: audit.evidenceId,
            reviewId: audit.reviewResultId,
            decision: audit.decision,
            improvementTaskId: audit.taskId,
          },
        });
      },
    },
    improvementTx: {
      async findByDecisionTask(decisionTaskId, taskType) {
        const row = await tx.juryImprovementTask.findFirst({ where: { decisionTaskId, taskType } });
        if (!row?.decisionTaskId || !row.evidenceId || row.taskType !== 'REWORD' || row.status !== 'OPEN') return null;
        return mapImprovement(row);
      },
      async insert(task) {
        await tx.juryImprovementTask.create({
          data: {
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
          },
        });
      },
      async audit(_action, task) {
        const id = createHash('sha256').update([task.id, 'IMPROVEMENT_TASK_CREATED'].join('\n')).digest('hex');
        const existing = await tx.juryAuditEvent.findUnique({ where: { id } });
        if (existing) return;
        await tx.juryAuditEvent.create({
          data: {
            id,
            tenantId: task.tenantId,
            timestamp: new Date(task.createdAt),
            actor: input.userId ?? 'unknown',
            action: 'IMPROVEMENT_TASK_CREATED',
            evidenceId: task.evidenceId,
            reviewId: task.reviewResultId,
            decision: 'REWORD',
            improvementTaskId: task.id,
            decisionTaskId: task.decisionTaskId,
          },
        });
      },
    },
  });
}

async function readBoundary(tx: Prisma.TransactionClient, reviewResultId: string) {
  const review = await tx.juryReviewResult.findUnique({ where: { id: reviewResultId } });
  if (!review) return null;
  const request = await tx.juryReviewRequest.findUnique({ where: { id: review.reviewRequestId } });
  const evidence = request ? await tx.juryEvidence.findUnique({ where: { id: request.evidenceId } }) : null;
  if (!request || !evidence) return null;
  const cycleRow = await tx.juryDecisionCycle.findUnique({ where: { rootReviewResultId: review.id } });
  const decisionRow = await tx.juryDecisionTask.findUnique({
    where: { reviewResultId_taskType: { reviewResultId: review.id, taskType: 'REWORD' } },
  });
  const improvementRow = await tx.juryImprovementTask.findFirst({ where: { reviewResultId: review.id } });
  const decisionTask = decisionRow ? mapDecision(decisionRow) : null;
  const improvementTask =
    improvementRow?.decisionTaskId && improvementRow.evidenceId && improvementRow.taskType === 'REWORD' && improvementRow.status === 'OPEN'
      ? mapImprovement(improvementRow)
      : null;
  const loaded: StartLoaded = {
    review: {
      id: review.id,
      tenantId: review.tenantId,
      evidenceId: evidence.id,
      expectedDecision: review.expectedDecision,
      evidenceStrength: review.evidenceStrength,
      claimStrength: review.claimStrength,
      conflictDetected: review.conflictDetected,
      overclaimDetected: review.overclaimDetected,
      revisionRequired: review.revisionRequired,
      completedAt: review.completedAt.toISOString(),
      requestStatus: request.status,
      verificationResultId: review.verificationResultId,
      evidenceIdentity: evidence.contentHash ?? evidence.id,
    },
    evidence: { id: evidence.id, tenantId: evidence.tenantId },
    cycle: cycleRow ? mapCycle(cycleRow) : null,
    decisionTask,
    decisionLinked: Boolean(decisionRow),
    improvementTask,
    improvementLinked: Boolean(improvementRow),
  };
  return { loaded, review, evidence };
}

function startBoundary(
  tx: Prisma.TransactionClient,
  input: {
    userId: string | null;
    now: string;
  },
  firstLoad?: { id: string; loaded: StartLoaded | null },
): StartIo {
  let pending = firstLoad;
  return {
    async load(reviewResultId) {
      if (pending && pending.id === reviewResultId) {
        const loaded = pending.loaded;
        pending = undefined;
        return loaded;
      }
      const boundary = await readBoundary(tx, reviewResultId);
      return boundary?.loaded ?? null;
    },
    async findPolicy(tenantId) {
      const row = await tx.juryProductLoopPolicy.findUnique({ where: { tenantId } });
      if (!row) return null;
      return {
        id: row.id,
        policy: {
          maxIterations: row.maxIterations,
          maxVerificationAttempts: row.maxVerificationAttempts,
          maxSameDecision: row.maxSameDecision,
          maxSameConflict: row.maxSameConflict,
          maxRuntimeMs: row.maxRuntimeMs,
          maxCostUsd: row.maxCostUsd,
        },
      };
    },
    async insertCycle(cycle) {
      const existing = await tx.juryDecisionCycle.findUnique({ where: { rootReviewResultId: cycle.rootReviewResultId } });
      if (existing) {
        if (existing.tenantId !== cycle.tenantId) throw new CycleStartAbort('TENANT_MISMATCH');
        return;
      }
      await tx.juryDecisionCycle.create({
        data: {
          id: cycle.id,
          tenantId: cycle.tenantId,
          rootReviewResultId: cycle.rootReviewResultId,
          currentReviewResultId: cycle.currentReviewResultId,
          policyId: cycle.policyId || null,
          iteration: cycle.iteration,
          verificationAttempts: cycle.verificationAttempts,
          sameDecisionCount: cycle.sameDecisionCount,
          sameConflictCount: cycle.sameConflictCount,
          decisionFingerprint: cycle.decisionFingerprint,
          conflictFingerprint: cycle.conflictFingerprint,
          status: cycle.status,
          blockedReason: cycle.blockedReason,
          startedAt: new Date(cycle.startedAt),
          updatedAt: new Date(cycle.updatedAt),
        },
      });
    },
    async auditCycle(event) {
      const id = createHash('sha256').update([event.cycle.rootReviewResultId, 'DECISION_CYCLE_CREATED', ''].join('\n')).digest('hex');
      const existing = await tx.juryAuditEvent.findUnique({ where: { id } });
      if (existing) return;
      await tx.juryAuditEvent.create({
        data: {
          id,
          tenantId: event.review.tenantId,
          timestamp: new Date(input.now),
          actor: input.userId ?? 'unknown',
          action: 'DECISION_CYCLE_CREATED',
          reviewId: event.review.id,
          decision: 'REWORD',
          decisionTaskId: event.decisionTaskId,
          improvementTaskId: event.improvementTaskId,
          provenance: {
            sourceReviewResultId: event.review.id,
            decision: 'REWORD',
            tenantId: event.review.tenantId,
            cycleId: event.cycle.id,
            decisionTaskId: event.decisionTaskId,
            improvementTaskId: event.improvementTaskId,
          } as Prisma.InputJsonValue,
        },
      });
    },
    decisionTx: {
      async findByResultAndType(reviewResultId, taskType) {
        const row = await tx.juryDecisionTask.findUnique({ where: { reviewResultId_taskType: { reviewResultId, taskType } } });
        return row ? mapDecision(row) : null;
      },
      async insert(task, audit) {
        await tx.juryDecisionTask.create({
          data: {
            id: task.id,
            tenantId: task.tenantId,
            reviewResultId: task.reviewResultId,
            evidenceId: task.evidenceId,
            taskType: task.taskType,
            decision: task.decision,
            title: task.title,
            description: task.description,
            reason: task.reason,
            status: task.status,
            createdAt: new Date(task.createdAt),
            updatedAt: new Date(task.updatedAt),
          },
        });
        await tx.juryAuditEvent.create({
          data: {
            id: audit.id,
            tenantId: audit.tenantId,
            timestamp: new Date(audit.timestamp),
            actor: audit.actorUserId,
            action: audit.action,
            evidenceId: audit.evidenceId,
            reviewId: audit.reviewResultId,
            decision: audit.decision,
            improvementTaskId: audit.taskId,
          },
        });
      },
    },
    improvementTx: {
      async findByDecisionTask(decisionTaskId, taskType) {
        const row = await tx.juryImprovementTask.findFirst({ where: { decisionTaskId, taskType } });
        if (!row?.decisionTaskId || !row.evidenceId || row.taskType !== 'REWORD' || row.status !== 'OPEN') return null;
        return mapImprovement(row);
      },
      async insert(task) {
        await tx.juryImprovementTask.create({
          data: {
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
          },
        });
      },
      async audit(_action, task) {
        const id = createHash('sha256').update([task.id, 'IMPROVEMENT_TASK_CREATED'].join('\n')).digest('hex');
        const existing = await tx.juryAuditEvent.findUnique({ where: { id } });
        if (existing) return;
        await tx.juryAuditEvent.create({
          data: {
            id,
            tenantId: task.tenantId,
            timestamp: new Date(task.createdAt),
            actor: input.userId ?? 'unknown',
            action: 'IMPROVEMENT_TASK_CREATED',
            evidenceId: task.evidenceId,
            reviewId: task.reviewResultId,
            decision: 'REWORD',
            improvementTaskId: task.id,
            decisionTaskId: task.decisionTaskId,
          },
        });
      },
    },
  };
}

async function readSnapshot(
  tx: Prisma.TransactionClient,
  reviewResultId: string,
  now: string,
  primed: Awaited<ReturnType<typeof readBoundary>>,
): Promise<{ ok: true; snapshot: ResolutionSnapshot } | { ok: false; reason: ResolutionFailure }> {
  if (!primed || primed.review.id !== reviewResultId) return { ok: false, reason: 'REVIEW_NOT_FOUND' };
  const review = primed.review;
  const evidence = primed.evidence;
  const lineage = await resolveDecisionCycleLineage(
    { reviewResultId, tenantId: review.tenantId },
    {
      async load(id) {
        const row = id === review.id ? review : await tx.juryReviewResult.findUnique({ where: { id } });
        if (!row) return null;
        return { id: row.id, tenantId: row.tenantId, ancestorIds: await ancestorIds(tx, row) };
      },
      async cyclesFor(id) {
        if (id !== review.id) return cyclesFor(tx, id);
        const currents = await tx.juryDecisionCycle.findMany({ where: { currentReviewResultId: id } });
        const root = primed.loaded.cycle
          ? await tx.juryDecisionCycle.findUnique({ where: { id: primed.loaded.cycle.id } })
          : null;
        return mergeCycles(root, currents);
      },
    },
  );
  if (!lineage.ok) return { ok: false, reason: lineage.reason };
  const cycle = await tx.juryDecisionCycle.findUnique({ where: { id: lineage.cycle.id } });
  if (!cycle || cycle.tenantId !== review.tenantId) return { ok: false, reason: 'TENANT_MISMATCH' };
  const policyRow = await tx.juryProductLoopPolicy.findUnique({ where: { tenantId: review.tenantId } });
  const policy: ProductLoopGuardPolicy = policyRow
    ? {
        maxIterations: policyRow.maxIterations,
        maxVerificationAttempts: policyRow.maxVerificationAttempts,
        maxSameDecision: policyRow.maxSameDecision,
        maxSameConflict: policyRow.maxSameConflict,
        maxRuntimeMs: policyRow.maxRuntimeMs,
        maxCostUsd: policyRow.maxCostUsd,
      }
    : PRODUCT_LOOP_GUARD_DEFAULTS;
  return {
    ok: true,
    snapshot: {
      review: {
        id: review.id,
        tenantId: review.tenantId,
        evidenceId: evidence.id,
        expectedDecision: review.expectedDecision,
        evidenceStrength: review.evidenceStrength,
        claimStrength: review.claimStrength,
        conflictDetected: review.conflictDetected,
        overclaimDetected: review.overclaimDetected,
        revisionRequired: review.revisionRequired,
      },
      evidence: { id: evidence.id, tenantId: evidence.tenantId },
      chain: await readChain(tx, cycle.rootReviewResultId),
      cycle: mapCycle(cycle),
      policy,
      spend: await loadLoopSpend(tx, {
        tenantId: review.tenantId,
        rootReviewResultId: cycle.rootReviewResultId,
        startedAt: cycle.startedAt,
        now,
      }),
    },
  };
}

async function ancestorIds(
  tx: Prisma.TransactionClient,
  review: {
    id: string;
    parentReviewResultId: string | null;
    verificationResultId: string | null;
    decisionTaskId: string | null;
    reReviewRequestId: string | null;
  },
): Promise<string[]> {
  const ids = new Set<string>();
  if (review.parentReviewResultId) ids.add(review.parentReviewResultId);
  if (review.verificationResultId) {
    const verification = await tx.juryVerificationResult.findUnique({ where: { id: review.verificationResultId } });
    if (verification) ids.add(verification.reviewResultId);
  }
  if (review.decisionTaskId) {
    const task = await tx.juryDecisionTask.findUnique({ where: { id: review.decisionTaskId } });
    if (task) ids.add(task.reviewResultId);
  }
  if (review.reReviewRequestId) {
    const request = await tx.juryVerificationReview.findUnique({ where: { id: review.reReviewRequestId } });
    if (request) ids.add(request.parentReviewResultId);
  }
  const changeGates = await tx.juryChangeGateReview.findMany({
    where: { reviewResultId: review.id },
    select: { parentReviewResultId: true },
  });
  for (const gate of changeGates) ids.add(gate.parentReviewResultId);
  ids.delete(review.id);
  return [...ids];
}

async function cyclesFor(tx: Prisma.TransactionClient, reviewResultId: string): Promise<LineageCycleRef[]> {
  const [root, currents] = await Promise.all([
    tx.juryDecisionCycle.findUnique({ where: { rootReviewResultId: reviewResultId } }),
    tx.juryDecisionCycle.findMany({ where: { currentReviewResultId: reviewResultId } }),
  ]);
  return mergeCycles(root, currents);
}

function mergeCycles(
  root: { id: string; tenantId: string; rootReviewResultId: string; currentReviewResultId: string } | null,
  currents: Array<{ id: string; tenantId: string; rootReviewResultId: string; currentReviewResultId: string }>,
): LineageCycleRef[] {
  const found = new Map<string, LineageCycleRef>();
  for (const row of [root, ...currents]) {
    if (!row) continue;
    found.set(row.id, {
      id: row.id,
      tenantId: row.tenantId,
      rootReviewResultId: row.rootReviewResultId,
      currentReviewResultId: row.currentReviewResultId,
    });
  }
  return [...found.values()];
}

async function readChain(tx: Prisma.TransactionClient, rootReviewResultId: string): Promise<CycleReviewNode[]> {
  const root = await tx.juryReviewResult.findUnique({ where: { id: rootReviewResultId } });
  if (!root) return [];
  const rows = [root];
  const seen = new Set([root.id]);
  while (rows.length < 20) {
    const child = await tx.juryReviewResult.findFirst({
      where: { parentReviewResultId: rows[rows.length - 1]!.id, tenantId: root.tenantId },
    });
    if (!child || seen.has(child.id)) break;
    seen.add(child.id);
    rows.push(child);
  }
  const nodes: CycleReviewNode[] = [];
  for (const row of rows) {
    const decision = asDecision(row.expectedDecision);
    if (!decision) return [];
    const request = await tx.juryReviewRequest.findUnique({ where: { id: row.reviewRequestId } });
    const evidence = request ? await tx.juryEvidence.findUnique({ where: { id: request.evidenceId } }) : null;
    if (!evidence) return [];
    nodes.push({
      id: row.id,
      tenantId: row.tenantId,
      evidenceIdentity: evidence.contentHash ?? evidence.id,
      decision,
      conflictDetected: row.conflictDetected,
      overclaimDetected: row.overclaimDetected,
      revisionRequired: row.revisionRequired,
      parentReviewResultId: row.parentReviewResultId,
      verificationResultId: row.verificationResultId,
      completedAt: row.completedAt.toISOString(),
    });
  }
  return nodes;
}

function mapCycle(row: {
  id: string;
  tenantId: string;
  rootReviewResultId: string;
  currentReviewResultId: string;
  policyId: string | null;
  iteration: number;
  verificationAttempts: number;
  sameDecisionCount: number;
  sameConflictCount: number;
  decisionFingerprint: string;
  conflictFingerprint: string;
  status: DecisionCycleDraft['status'];
  blockedReason: string | null;
  startedAt: Date;
  updatedAt: Date;
}): DecisionCycleDraft {
  return {
    id: row.id,
    tenantId: row.tenantId,
    rootReviewResultId: row.rootReviewResultId,
    currentReviewResultId: row.currentReviewResultId,
    iteration: row.iteration,
    verificationAttempts: row.verificationAttempts,
    sameDecisionCount: row.sameDecisionCount,
    sameConflictCount: row.sameConflictCount,
    decisionFingerprint: row.decisionFingerprint,
    conflictFingerprint: row.conflictFingerprint,
    status: row.status,
    blockedReason: isBlockedReason(row.blockedReason) ? row.blockedReason : null,
    policyId: row.policyId ?? '',
    startedAt: row.startedAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function mapDecision(row: {
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
}): DecisionTaskDraft | null {
  if (row.decision !== 'VERIFY' && row.decision !== 'REWORD') return null;
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

function mapImprovement(row: {
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
}): ImprovementTaskDraft {
  const constraints = Array.isArray(row.constraints) ? row.constraints.filter((item): item is string => typeof item === 'string') : [];
  const acceptance = Array.isArray(row.acceptanceCriteria)
    ? row.acceptanceCriteria.filter((item): item is string => typeof item === 'string')
    : [];
  return {
    id: row.id,
    tenantId: row.tenantId,
    reviewResultId: row.reviewResultId,
    decisionTaskId: row.decisionTaskId ?? '',
    evidenceId: row.evidenceId ?? '',
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
    provenance: row.provenance as ImprovementTaskDraft['provenance'],
    createdAt: row.createdAt?.toISOString() ?? '',
    updatedAt: row.updatedAt?.toISOString() ?? '',
  };
}

function asDecision(value: string): JuryDecision | null {
  if (value === 'ACCEPT' || value === 'VERIFY' || value === 'REWORD') return value;
  return null;
}

function isBlockedReason(value: string | null): value is DecisionCycleDraft['blockedReason'] {
  return (
    value === 'MAX_ITERATIONS' ||
    value === 'MAX_VERIFICATION_ATTEMPTS' ||
    value === 'MAX_SAME_DECISION' ||
    value === 'MAX_SAME_CONFLICT' ||
    value === 'MAX_RUNTIME' ||
    value === 'MAX_COST'
  );
}
