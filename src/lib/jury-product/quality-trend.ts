/**
 * RM-16 (M-013): 품질 추세. Service-level verdict time series, VERIFIED_REAL only (metric-rules M-013).
 * Fewer than 3 points → section hidden. Categorical only (결론 범주 + 수정 필요 항목 수); no score, no ratio.
 */
import type { JuryActor } from './access';
import type { ComparisonSide } from './review-comparison';

export const TREND_MIN_POINTS = 3;
export const TREND_SOURCE = 'VERIFIED_REAL';

export type TrendPoint = { resultId: string; completedAt: string; decision: string; problems: number | null };
export type QualityTrend = { visible: false; reason: string; excluded: number } | { visible: true; points: TrendPoint[]; excluded: number };

export function buildQualityTrend(sides: readonly ComparisonSide[]): QualityTrend {
  const eligible = sides.filter((s) => s.display.source.value === TREND_SOURCE && !s.display.decision.withheld && s.display.resultId);
  const excluded = sides.length - eligible.length;
  if (eligible.length < TREND_MIN_POINTS) {
    return { visible: false, reason: `검증된 실모델 결과 ${eligible.length}건 — ${TREND_MIN_POINTS}건 이상일 때 추세를 표시해요.`, excluded };
  }
  const points = [...eligible]
    .sort((a, b) => a.completedAt.localeCompare(b.completedAt))
    .map((s) => ({
      resultId: s.display.resultId!,
      completedAt: s.completedAt,
      decision: s.display.decision.label,
      problems: s.display.problems.state === 'UNAVAILABLE' ? null : s.display.problems.count,
    }));
  return { visible: true, points, excluded };
}

export async function loadQualityTrend(actor: JuryActor, connectionId: string, limit = 50): Promise<QualityTrend | null> {
  if (!actor.ok || !connectionId.trim()) return null;
  const { prisma } = await import('@/lib/prisma');
  const { REVIEW_SIDE_SELECT, sideFromRow } = await import('./review-comparison-db');
  const rows = await prisma.juryReviewResult.findMany({
    where: {
      tenantId: actor.tenantId,
      request: { tenantId: actor.tenantId, evidence: { tenantId: actor.tenantId, connectionId } },
    },
    orderBy: { completedAt: 'desc' },
    take: limit,
    select: REVIEW_SIDE_SELECT,
  });
  return buildQualityTrend(rows.filter((r) => r.tenantId === actor.tenantId).map((r) => sideFromRow(r as Parameters<typeof sideFromRow>[0], actor.tenantId)));
}
