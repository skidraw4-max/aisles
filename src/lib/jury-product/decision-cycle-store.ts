/**
 * Stores one product decision cycle and its tenant policy.
 * It does not create a task or call the review core.
 */
import { createHash } from 'node:crypto';
import type { JuryDecision, JuryMembership } from './records';
import {
  recordDecisionCycle,
  type CycleReviewNode,
  type DecisionCycleDraft,
  type DecisionCycleWriteTx,
  type GuardReason,
  type ProductLoopGuardPolicy,
} from './loop-guard';

type Outcome = Awaited<ReturnType<typeof recordDecisionCycle>>;

const GUARD_REASONS = [
  'MAX_ITERATIONS',
  'MAX_VERIFICATION_ATTEMPTS',
  'MAX_SAME_DECISION',
  'MAX_SAME_CONFLICT',
  'MAX_RUNTIME',
  'MAX_COST',
] as const;

export async function persistDecisionCycle(input: {
  userId: string | null;
  memberships: readonly JuryMembership[];
  clientTenantId?: string | null;
  now: string;
  rootReviewResultId: string;
}): Promise<Outcome> {
  const { prisma } = await import('@/lib/prisma');
  return prisma.$transaction(async (tx) => {
    let chain: CycleReviewNode[] | null = null;
    const boundary: DecisionCycleWriteTx = {
      async loadChain(rootReviewResultId) {
        chain = await readChain(tx, rootReviewResultId);
        return chain;
      },
      async findPolicy(tenantId) {
        const row = await tx.juryProductLoopPolicy.findUnique({ where: { tenantId } });
        if (!row) return null;
        return { id: row.id, policy: mapPolicy(row) };
      },
      async insertPolicy(tenantId, policy) {
        const id = createHash('sha256').update([tenantId, 'product-loop-policy'].join('\n')).digest('hex');
        await tx.juryProductLoopPolicy.create({
          data: {
            id,
            tenantId,
            ...policy,
            createdAt: new Date(input.now),
            updatedAt: new Date(input.now),
          },
        });
        return id;
      },
      async findCycle(rootReviewResultId) {
        const row = await tx.juryDecisionCycle.findUnique({ where: { rootReviewResultId } });
        return row ? mapCycle(row) : null;
      },
      async insertCycle(cycle) {
        await tx.juryDecisionCycle.create({ data: cycleData(cycle) });
      },
      async audit(action, reason) {
        const current = chain?.[chain.length - 1];
        await tx.juryAuditEvent.create({
          data: {
            id: createHash('sha256').update([input.rootReviewResultId, action, reason ?? ''].join('\n')).digest('hex'),
            tenantId: current?.tenantId ?? '',
            timestamp: new Date(input.now),
            actor: input.userId ?? 'unknown',
            action,
            reviewId: current?.id ?? input.rootReviewResultId,
            decision: current?.decision,
            testResult: reason,
          },
        });
      },
    };
    return recordDecisionCycle(input, boundary);
  });
}

type PolicyRow = {
  maxIterations: number | null;
  maxVerificationAttempts: number | null;
  maxSameDecision: number | null;
  maxSameConflict: number | null;
  maxRuntimeMs: number | null;
  maxCostUsd: number | null;
};

function mapPolicy(row: PolicyRow): ProductLoopGuardPolicy {
  return {
    maxIterations: row.maxIterations,
    maxVerificationAttempts: row.maxVerificationAttempts,
    maxSameDecision: row.maxSameDecision,
    maxSameConflict: row.maxSameConflict,
    maxRuntimeMs: row.maxRuntimeMs,
    maxCostUsd: row.maxCostUsd,
  };
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
    policyId: row.policyId ?? '',
    iteration: row.iteration,
    verificationAttempts: row.verificationAttempts,
    sameDecisionCount: row.sameDecisionCount,
    sameConflictCount: row.sameConflictCount,
    decisionFingerprint: row.decisionFingerprint,
    conflictFingerprint: row.conflictFingerprint,
    status: row.status,
    blockedReason: isGuardReason(row.blockedReason) ? row.blockedReason : null,
    startedAt: row.startedAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function cycleData(cycle: DecisionCycleDraft) {
  return {
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
  };
}

function isGuardReason(value: string | null): value is Exclude<GuardReason, 'ALLOWED'> {
  return value !== null && (GUARD_REASONS as readonly string[]).includes(value);
}

type ReviewReader = {
  juryReviewResult: {
    findUnique(args: { where: { id: string } }): Promise<{
      id: string;
      tenantId: string;
      reviewRequestId: string;
      expectedDecision: string;
      conflictDetected: boolean;
      overclaimDetected: boolean;
      revisionRequired: boolean;
      parentReviewResultId: string | null;
      verificationResultId: string | null;
      completedAt: Date;
    } | null>;
    findFirst(args: { where: { parentReviewResultId: string; tenantId: string } }): Promise<{
      id: string;
      tenantId: string;
      reviewRequestId: string;
      expectedDecision: string;
      conflictDetected: boolean;
      overclaimDetected: boolean;
      revisionRequired: boolean;
      parentReviewResultId: string | null;
      verificationResultId: string | null;
      completedAt: Date;
    } | null>;
  };
  juryReviewRequest: {
    findUnique(args: { where: { id: string } }): Promise<{ evidenceId: string } | null>;
  };
  juryEvidence: {
    findUnique(args: { where: { id: string } }): Promise<{ id: string; contentHash: string | null } | null>;
  };
};

async function readChain(tx: ReviewReader, rootReviewResultId: string): Promise<CycleReviewNode[] | null> {
  const root = await tx.juryReviewResult.findUnique({ where: { id: rootReviewResultId } });
  if (!root) return null;
  const chain = [root];
  const seen = new Set([root.id]);
  while (chain.length < 20) {
    const child = await tx.juryReviewResult.findFirst({
      where: { parentReviewResultId: chain[chain.length - 1].id, tenantId: root.tenantId },
    });
    if (!child || seen.has(child.id)) break;
    seen.add(child.id);
    chain.push(child);
  }
  const nodes: CycleReviewNode[] = [];
  for (const review of chain) {
    const decision = asDecision(review.expectedDecision);
    if (!decision) return null;
    const request = await tx.juryReviewRequest.findUnique({ where: { id: review.reviewRequestId } });
    if (!request) return null;
    const evidence = await tx.juryEvidence.findUnique({ where: { id: request.evidenceId } });
    if (!evidence) return null;
    nodes.push({
      id: review.id,
      tenantId: review.tenantId,
      evidenceIdentity: evidence.contentHash ?? evidence.id,
      decision,
      conflictDetected: review.conflictDetected,
      overclaimDetected: review.overclaimDetected,
      revisionRequired: review.revisionRequired,
      parentReviewResultId: review.parentReviewResultId,
      verificationResultId: review.verificationResultId,
      completedAt: review.completedAt.toISOString(),
    });
  }
  return nodes;
}

function asDecision(value: string): JuryDecision | null {
  if (value === 'ACCEPT' || value === 'VERIFY' || value === 'REWORD') return value;
  return null;
}
