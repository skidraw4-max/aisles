import type { DebateTurn, IndependentAnalysis, ReviewBoardRun } from './types';
import { revisionStatusImpliesChange } from './types';

/** 기존 debate/independent 배열에서만 집계. 없으면 null (추정 금지). */
export type RunObservationMetrics = {
  agreementCount: number | null;
  disagreementCount: number | null;
  weakEvidenceCount: number | null;
  revisionCount: number | null;
  /** v3+: PARTIAL 횟수 (없으면 null — 필드 없는 구런) */
  partialRevisionCount: number | null;
  /** v3+: FULL 횟수 */
  fullRevisionCount: number | null;
  /** v3+: UNCHANGED 횟수 */
  unchangedCount: number | null;
  averageConfidence: number | null;
  /** debate confidence 우선, 없으면 independent */
  confidenceSource: 'debate' | 'independent' | null;
};

function sumLengths(turns: DebateTurn[], key: keyof DebateTurn): number {
  return turns.reduce((n, t) => {
    const v = t[key];
    return n + (Array.isArray(v) ? v.length : 0);
  }, 0);
}

function avgConfidence(
  items: { confidence: number }[],
): number | null {
  if (items.length === 0) return null;
  const sum = items.reduce((s, i) => s + (typeof i.confidence === 'number' ? i.confidence : 0), 0);
  return Number((sum / items.length).toFixed(3));
}

/**
 * Run 목록·Overview용 관찰 지표.
 * debate가 비어 있으면 debate 기반 count는 null.
 */
export function computeRunObservationMetrics(run: ReviewBoardRun): RunObservationMetrics {
  const debate = Array.isArray(run.debate) ? run.debate : [];
  const independent = Array.isArray(run.independent) ? run.independent : [];

  if (debate.length === 0) {
    const avgInd = avgConfidence(independent as IndependentAnalysis[]);
    return {
      agreementCount: null,
      disagreementCount: null,
      weakEvidenceCount: null,
      revisionCount: null,
      partialRevisionCount: null,
      fullRevisionCount: null,
      unchangedCount: null,
      averageConfidence: avgInd,
      confidenceSource: avgInd === null ? null : 'independent',
    };
  }

  const hasStatusField = debate.some((d) => typeof d.revisionStatus === 'string');

  return {
    agreementCount: sumLengths(debate, 'agreement'),
    disagreementCount: sumLengths(debate, 'disagreement'),
    weakEvidenceCount: sumLengths(debate, 'weakEvidence'),
    revisionCount: debate.filter((d) =>
      d.revisionStatus
        ? revisionStatusImpliesChange(d.revisionStatus)
        : Boolean(d.revised),
    ).length,
    partialRevisionCount: hasStatusField
      ? debate.filter((d) => d.revisionStatus === 'PARTIAL').length
      : null,
    fullRevisionCount: hasStatusField
      ? debate.filter((d) => d.revisionStatus === 'FULL').length
      : null,
    unchangedCount: hasStatusField
      ? debate.filter((d) => d.revisionStatus === 'UNCHANGED').length
      : null,
    averageConfidence: avgConfidence(debate),
    confidenceSource: 'debate',
  };
}

export function formatRunWhen(run: ReviewBoardRun): string {
  const raw = run.createdAt || run.updatedAt;
  if (!raw) return '—';
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  return d.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', hour12: false });
}
