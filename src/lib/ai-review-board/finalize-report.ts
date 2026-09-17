import { SCORE_DIMENSIONS, type ScoreDimension } from './score-dimensions';
import { normalizeDimensionScore, weightedOverallScore } from './scoring';
import type {
  CriticReport,
  DimensionScore,
  EvidenceItem,
  FinalReport,
  IndependentAnalysis,
} from './types';

/**
 * Chairman이 영역 점수를 비우거나 evidence 없이 돌려준 경우,
 * 독립 분석의 evidence·confidence 가중으로 보완 (단순 평균 아님).
 */
export function enrichFinalReport(
  final: FinalReport,
  independent: IndependentAnalysis[],
  critic: CriticReport | null,
): FinalReport {
  const existing = final.dimensionScores ?? [];
  const hasAnyScored = existing.some((s) => s.score !== null);
  let dimensionScores = existing;

  if (!hasAnyScored) {
    dimensionScores = SCORE_DIMENSIONS.map((dimension) =>
      mergeDimensionFromMembers(dimension, independent),
    );
  } else {
    dimensionScores = existing.map(normalizeDimensionScore);
  }

  let overallTrendScore = final.overallTrendScore;
  if (overallTrendScore === null || overallTrendScore === undefined) {
    overallTrendScore = weightedOverallScore(
      independent.map((i) => ({ scores: i.scores, confidence: i.confidence })),
    );
  }

  let confidence = final.confidence;
  if (critic?.herdingDetected) {
    confidence = Math.min(confidence, confidence * 0.9);
  }

  return {
    ...final,
    dimensionScores,
    overallTrendScore,
    confidence,
  };
}

function mergeDimensionFromMembers(
  dimension: ScoreDimension,
  independent: IndependentAnalysis[],
): DimensionScore {
  let weightedSum = 0;
  let weightTotal = 0;
  const evidence: EvidenceItem[] = [];

  for (const m of independent) {
    const raw = m.scores.find((s) => s.dimension === dimension);
    if (!raw) continue;
    const s = normalizeDimensionScore(raw);
    if (s.score === null) {
      evidence.push(...s.evidence);
      continue;
    }
    const conf = Math.max(0.05, Math.min(1, m.confidence));
    const hardCount = s.evidence.filter(
      (e) => e.kind === 'observation' || e.kind === 'metric' || e.kind === 'doc',
    ).length;
    const w = conf * (1 + Math.min(3, hardCount) * 0.25);
    weightedSum += s.score * w;
    weightTotal += w;
    evidence.push(...s.evidence);
  }

  const deduped = dedupeEvidence(evidence).slice(0, 8);
  return normalizeDimensionScore({
    dimension,
    score: weightTotal > 0 ? Math.round(weightedSum / weightTotal) : null,
    evidence: deduped,
  });
}

function dedupeEvidence(items: EvidenceItem[]): EvidenceItem[] {
  const seen = new Set<string>();
  const out: EvidenceItem[] = [];
  for (const e of items) {
    const key = `${e.kind}:${e.text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out;
}
