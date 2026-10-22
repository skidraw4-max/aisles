/**
 * RM-11: loads the previous result of the same service (tenant-scoped, read-only) and compares it.
 * Lineage (parentReviewResultId) wins; otherwise the latest earlier result on the same connection.
 */
import type { JuryActor } from './access';
import { buildReviewDisplayModel } from './review-display-model';
import { compareReviewResults, type ComparisonSide, type ReviewComparisonView } from './review-comparison';

export const REVIEW_SIDE_SELECT = {
  id: true,
  tenantId: true,
  boardRunId: true,
  expectedDecision: true,
  finalSurface: true,
  evidenceStrength: true,
  claimStrength: true,
  revisionRequired: true,
  conflictDetected: true,
  overclaimDetected: true,
  completedAt: true,
  parentReviewResultId: true,
  request: {
    select: {
      tenantId: true,
      status: true,
      resultSource: true,
      failureReason: true,
      evidence: {
        select: {
          id: true,
          tenantId: true,
          connectionId: true,
          metricIds: true,
          metrics: { select: { tenantId: true, metric: true, availability: true } },
        },
      },
    },
  },
} as const;

export type ReviewSideRow = {
  id: string;
  tenantId: string;
  boardRunId: string;
  expectedDecision: string;
  finalSurface: unknown;
  evidenceStrength: string | null;
  claimStrength: string | null;
  revisionRequired: boolean | null;
  conflictDetected: boolean | null;
  overclaimDetected: boolean | null;
  completedAt: Date;
  parentReviewResultId: string | null;
  request: {
    tenantId: string;
    status: string;
    resultSource: string | null;
    failureReason: string | null;
    evidence: {
      id: string;
      tenantId: string;
      connectionId: string;
      metricIds: unknown;
      metrics: { tenantId: string; metric: string; availability: string }[];
    } | null;
  } | null;
};

export function sideFromRow(row: ReviewSideRow, tenantId: string): ComparisonSide {
  const request = row.request?.tenantId === tenantId ? row.request : null;
  const evidence = request?.evidence?.tenantId === tenantId ? request.evidence : null;
  const metricIds = Array.isArray(evidence?.metricIds)
    ? (evidence!.metricIds as unknown[]).filter((v): v is string => typeof v === 'string')
    : [];
  return {
    display: buildReviewDisplayModel({
      result: {
        id: row.id,
        boardRunId: row.boardRunId,
        expectedDecision: row.expectedDecision,
        finalSurface: row.finalSurface,
        evidenceStrength: row.evidenceStrength,
        claimStrength: row.claimStrength,
        revisionRequired: row.revisionRequired,
        conflictDetected: row.conflictDetected,
        overclaimDetected: row.overclaimDetected,
      },
      request: request ? { status: request.status, failureReason: request.failureReason, resultSource: request.resultSource } : null,
      evidence: evidence
        ? { id: evidence.id, metricIds, metrics: evidence.metrics.filter((m) => m.tenantId === tenantId) }
        : null,
    }),
    connectionId: evidence?.connectionId ?? null,
    metricIds,
    completedAt: row.completedAt.toISOString(),
  };
}

export async function loadReviewComparison(actor: JuryActor, reviewId: string): Promise<ReviewComparisonView | null> {
  if (!actor.ok || !reviewId.trim()) return null;
  const { prisma } = await import('@/lib/prisma');
  const current = (await prisma.juryReviewResult.findFirst({
    where: { id: reviewId, tenantId: actor.tenantId },
    select: REVIEW_SIDE_SELECT,
  })) as ReviewSideRow | null;
  if (!current || current.tenantId !== actor.tenantId) return null;
  const cur = sideFromRow(current, actor.tenantId);
  let previous: ReviewSideRow | null = null;
  if (current.parentReviewResultId) {
    previous = (await prisma.juryReviewResult.findFirst({
      where: { id: current.parentReviewResultId, tenantId: actor.tenantId },
      select: REVIEW_SIDE_SELECT,
    })) as ReviewSideRow | null;
  }
  if (!previous && cur.connectionId) {
    const rows = (await prisma.juryReviewResult.findMany({
      where: {
        tenantId: actor.tenantId,
        id: { not: current.id },
        completedAt: { lt: current.completedAt },
        request: { tenantId: actor.tenantId, evidence: { tenantId: actor.tenantId, connectionId: cur.connectionId } },
      },
      orderBy: { completedAt: 'desc' },
      take: 20,
      select: REVIEW_SIDE_SELECT,
    })) as ReviewSideRow[];
    previous = pickPrevious(cur, rows.filter((r) => r.tenantId === actor.tenantId).map((r) => ({ row: r, side: sideFromRow(r, actor.tenantId) })))?.row ?? null;
  }
  if (previous && previous.tenantId !== actor.tenantId) previous = null;
  return compareReviewResults(cur, previous ? sideFromRow(previous, actor.tenantId) : null);
}

/** Newest earlier result with the same source grade and metric set; else the newest (shown as 비교 불가). */
export function pickPrevious<T extends { side: ComparisonSide }>(current: ComparisonSide, candidates: readonly T[]): T | null {
  const same = candidates.find((c) => compareReviewResults(current, c.side).state === 'COMPARED');
  return same ?? candidates[0] ?? null;
}
