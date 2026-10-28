/**
 * RM-11 (M-011, UI-06, CT-10): 이전 대비 비교. Pure projection of two AGG-01 display models.
 * Output = 결론 범주 변화 + 문제 수 차이(정수). No ratios, no composite score.
 * Either side MOCK/FIXTURE/UNKNOWN_LEGACY → "비교 불가". Different service or metric set → "비교 불가".
 * Does not run a review and does not touch JuryReReviewResult (D-08 undecided).
 */
import type { ReviewDisplayModel } from './review-display-model';

export type ComparisonSide = {
  display: ReviewDisplayModel;
  connectionId: string | null;
  metricIds: readonly string[];
  completedAt: string;
};

export type ComparisonBlock =
  | 'NO_PREVIOUS'
  | 'NON_REAL_SOURCE'
  | 'LEGACY_SOURCE'
  | 'DIFFERENT_SOURCE_GRADE'
  | 'DIFFERENT_SERVICE'
  | 'DIFFERENT_METRICS'
  | 'DECISION_WITHHELD';

export const COMPARISON_BLOCK_LABELS: Record<ComparisonBlock, string> = {
  NO_PREVIOUS: '같은 서비스의 이전 실제 결과가 없어요.',
  NON_REAL_SOURCE: 'Mock/Fixture 결과가 포함되어 비교할 수 없어요.',
  LEGACY_SOURCE: '출처를 판별할 수 없는 과거 결과가 포함되어 비교할 수 없어요.',
  DIFFERENT_SOURCE_GRADE: '두 결과의 출처 등급(실모델/검증된 실모델)이 달라 비교할 수 없어요.',
  DIFFERENT_SERVICE: '서비스가 달라 비교할 수 없어요.',
  DIFFERENT_METRICS: '두 결과의 지표 구성이 달라 비교할 수 없어요.',
  DECISION_WITHHELD: '한쪽 결론이 표시 보류 상태라 비교할 수 없어요.',
};

export type ReviewComparisonView =
  | { state: 'NOT_COMPARABLE'; reason: ComparisonBlock; text: string; previousResultId: string | null }
  | {
      state: 'COMPARED';
      previousResultId: string | null;
      previousCompletedAt: string;
      decision: { previous: string; current: string; changed: boolean };
      /** 정수 차이(현재 − 이전). null = 한쪽 문제 수 집계 불가. */
      problemDelta: number | null;
      problems: { previous: number | null; current: number | null };
      text: string;
    };

function sourceBlock(d: ReviewDisplayModel): ComparisonBlock | null {
  if (d.source.value === 'MOCK' || d.source.value === 'FIXTURE') return 'NON_REAL_SOURCE';
  if (d.source.value === 'UNKNOWN_LEGACY') return 'LEGACY_SOURCE';
  return null;
}

const sameSet = (a: readonly string[], b: readonly string[]) => {
  const x = new Set(a);
  const y = new Set(b);
  return x.size === y.size && [...x].every((v) => y.has(v));
};

export function compareReviewResults(current: ComparisonSide, previous: ComparisonSide | null): ReviewComparisonView {
  const block = (reason: ComparisonBlock): ReviewComparisonView => ({
    state: 'NOT_COMPARABLE', reason, text: `비교 불가 — ${COMPARISON_BLOCK_LABELS[reason]}`,
    previousResultId: previous?.display.resultId ?? null,
  });
  if (!previous) return block('NO_PREVIOUS');
  const src = sourceBlock(current.display) ?? sourceBlock(previous.display);
  if (src) return block(src);
  if (current.display.source.value !== previous.display.source.value) return block('DIFFERENT_SOURCE_GRADE');
  if (!current.connectionId || current.connectionId !== previous.connectionId) return block('DIFFERENT_SERVICE');
  if (!sameSet(current.metricIds, previous.metricIds)) return block('DIFFERENT_METRICS');
  if (current.display.decision.withheld || previous.display.decision.withheld) return block('DECISION_WITHHELD');
  const prevCount = previous.display.problems.state === 'UNAVAILABLE' ? null : previous.display.problems.count;
  const curCount = current.display.problems.state === 'UNAVAILABLE' ? null : current.display.problems.count;
  const delta = prevCount === null || curCount === null ? null : curCount - prevCount;
  const changed = previous.display.decision.raw !== current.display.decision.raw;
  const decisionText = changed
    ? `결론 ${previous.display.decision.label} → ${current.display.decision.label}`
    : `결론 변화 없음 (${current.display.decision.label})`;
  const problemText = delta === null
    ? '문제 수 차이 집계 불가'
    : delta === 0 ? '수정 필요 항목 수 변화 없음' : `수정 필요 항목 ${delta > 0 ? '+' : ''}${delta}건`;
  return {
    state: 'COMPARED',
    previousResultId: previous.display.resultId,
    previousCompletedAt: previous.completedAt,
    decision: { previous: previous.display.decision.label, current: current.display.decision.label, changed },
    problemDelta: delta,
    problems: { previous: prevCount, current: curCount },
    text: `${decisionText} · ${problemText}`,
  };
}
