import type { DimensionScore, EvidenceItem } from './types';

/**
 * evidence가 없거나 inference-only면 score를 null로 내려 confidence 패널티 근거로 쓴다.
 * AI 주관 점수만으로 통과시키지 않기 위함.
 */
export function normalizeDimensionScore(raw: DimensionScore): DimensionScore {
  const evidence = Array.isArray(raw.evidence) ? raw.evidence : [];
  const hasHardEvidence = evidence.some(
    (e: EvidenceItem) => e.kind === 'observation' || e.kind === 'metric' || e.kind === 'doc',
  );
  let score = raw.score;
  if (typeof score !== 'number' || !Number.isFinite(score)) {
    score = null;
  } else {
    // 모델이 1–5 / 1–10 척도로 응답한 경우 0–100으로 보정
    if (score > 0 && score <= 5) score = Math.round(score * 20);
    else if (score > 5 && score <= 10) score = Math.round(score * 10);
    score = Math.max(0, Math.min(100, Math.round(score)));
  }
  if (score !== null && !hasHardEvidence) {
    score = null;
  }
  return { dimension: raw.dimension, score, evidence };
}

export function normalizeDimensionScores(scores: DimensionScore[]): DimensionScore[] {
  return scores.map(normalizeDimensionScore);
}

/** evidence 없는 (원본) 점수가 있었는지 — Critic용 */
export function listScoresLackingHardEvidence(scores: DimensionScore[]): string[] {
  const out: string[] = [];
  for (const s of scores) {
    const hasHard = (s.evidence ?? []).some(
      (e) => e.kind === 'observation' || e.kind === 'metric' || e.kind === 'doc',
    );
    if (!hasHard) out.push(s.dimension);
  }
  return out;
}

/**
 * Chairman용: evidence·confidence 가중 합성 (단순 평균 금지).
 * hard evidence 있는 점수만 가중. confidence는 0–1.
 */
export function weightedOverallScore(
  memberScores: { scores: DimensionScore[]; confidence: number }[],
): number | null {
  let weightedSum = 0;
  let weightTotal = 0;
  for (const m of memberScores) {
    const conf = Math.max(0.05, Math.min(1, m.confidence));
    for (const s of m.scores) {
      const normalized = normalizeDimensionScore(s);
      if (normalized.score === null) continue;
      const hardCount = normalized.evidence.filter(
        (e) => e.kind === 'observation' || e.kind === 'metric' || e.kind === 'doc',
      ).length;
      const w = conf * (1 + Math.min(3, hardCount) * 0.25);
      weightedSum += normalized.score * w;
      weightTotal += w;
    }
  }
  if (weightTotal <= 0) return null;
  return Math.round(weightedSum / weightTotal);
}
