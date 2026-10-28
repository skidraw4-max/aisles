/**
 * RM-07 (UI-05): result detail layout = fixed summary + 4 tabs.
 * Pure projection of the AGG-01 display model. No recounting, no composite score,
 * no severity (D-13), missing data is never rendered as "no problem".
 */
import { DISPLAY_FLAG_LABELS, type ReviewDisplayModel } from './review-display-model';

export type SourceTone = 'REAL' | 'NON_REAL' | 'LEGACY';
export type DetailLink = { text: string; tab: 'evidence' | 'members' | 'history' | 'summary' };

export type ResultDetailView = {
  summary: {
    decision: string;
    decisionNote: string | null;
    source: { label: string; tone: SourceTone; note: string | null };
    facts: { label: string; value: string }[];
    warnings: string[];
  };
  /** 주장 → 근거 → 결론 → 기대 */
  comparison: { step: '주장' | '근거' | '결론' | '기대'; value: string; note: string | null }[];
  /** 수정 필요 → 원인 링크. PC-03: no problem→evidence link exists, so each cause points at result-level evidence. */
  problems: { state: 'LISTED' | 'EMPTY' | 'UNAVAILABLE'; emptyText: string | null; items: { text: string; cause: DetailLink }[] };
  unchecked: { state: 'LISTED' | 'NONE' | 'UNKNOWN'; text: string | null; items: string[] };
};

const count = (n: number | null, unit: string, nullText = '집계 불가') => (n === null ? nullText : `${n}${unit}`);

export function buildResultDetailView(display: ReviewDisplayModel): ResultDetailView {
  const tone: SourceTone = display.source.value === 'MOCK' || display.source.value === 'FIXTURE'
    ? 'NON_REAL'
    : display.source.value === 'UNKNOWN_LEGACY' ? 'LEGACY' : 'REAL';
  const sourceNote = tone === 'NON_REAL'
    ? '실제 심사 결과가 아니며 종합 상태·비교·추세 집계에서 제외돼요.'
    : tone === 'LEGACY' ? '출처를 판별할 수 없는 과거 결과예요.' : null;

  const decisionNote = display.decision.withheld
    ? `결론 표시 보류 — ${display.decision.withheldReason ? DISPLAY_FLAG_LABELS[display.decision.withheldReason] : '근거 미연결'}`
    : null;

  const claims = display.claims;
  const claimsText = claims.state === 'RECORDED' && claims.counts
    ? `확인 ${claims.counts.supported} · 일부 확인 ${claims.counts.partial} · 미확인 ${claims.counts.unverified}`
    : claims.state === 'NONE_RECORDED' ? '주장 기록 없음' : '집계 불가';

  const problemsText = display.problems.state === 'UNAVAILABLE'
    ? '집계 불가'
    : display.problems.count === 0
      ? (display.flags.includes('DECISION_PROBLEM_MISMATCH') ? '문제 목록 없음 — 결론과 불일치' : '문제 목록 없음')
      : `${display.problems.count}건 (${display.problems.severityNote ?? '심각도 미기록'})`;

  const scope = display.scope;
  const scopeText = scope.state === 'LINKED'
    ? `지표 ${scope.metricCount ?? 0}개 · 미검사 ${count(scope.uncheckedCount, '개')}`
    : scope.state === 'UNLINKED' ? '근거 미연결' : '집계 불가';

  const committee = display.committee;
  const committeeText = committee.conflictDetected === null && committee.overclaimDetected === null
    ? '기록 없음'
    : `의견 충돌 ${committee.conflictDetected === null ? '기록 없음' : committee.conflictDetected ? '있음' : '없음'} · 과장 주장 ${committee.overclaimDetected === null ? '기록 없음' : committee.overclaimDetected ? '있음' : '없음'}`;

  const facts = [
    { label: '문제', value: problemsText },
    { label: '주장 확인 현황', value: claimsText },
    { label: '부족한 근거', value: count(display.missingEvidenceCount, '개') },
    { label: '검사 범위', value: scopeText },
    { label: '근거 강도', value: display.strength.evidence ?? '기록 없음' },
    { label: '위원 의견', value: committeeText },
  ];

  const comparison: ResultDetailView['comparison'] = [
    { step: '주장', value: claimsText, note: null },
    { step: '근거', value: scopeText, note: display.strength.evidence ? `근거 강도: ${display.strength.evidence}` : null },
    { step: '결론', value: display.decision.label, note: decisionNote },
    {
      step: '기대',
      value: display.aiInference.expectedUserEffect ?? '기록 없음',
      note: display.aiInference.expectedUserEffect ? display.aiInference.label : null,
    },
  ];

  const cause: DetailLink = { text: '문제별 근거 연결 없음 — 결과 근거 보기', tab: 'evidence' };
  const problems: ResultDetailView['problems'] = display.problems.state === 'UNAVAILABLE'
    ? { state: 'UNAVAILABLE', emptyText: '집계 불가', items: [] }
    : display.problems.items.length === 0
      ? { state: 'EMPTY', emptyText: problemsText, items: [] }
      : { state: 'LISTED', emptyText: null, items: display.problems.items.map((text) => ({ text, cause })) };

  const unchecked: ResultDetailView['unchecked'] = scope.state !== 'LINKED'
    ? { state: 'UNKNOWN', text: scope.state === 'UNLINKED' ? '근거 미연결 — 검사 범위 미정' : '집계 불가', items: [] }
    : scope.unchecked.length === 0
      ? { state: 'NONE', text: '미검사 지표 없음', items: [] }
      : { state: 'LISTED', text: null, items: scope.unchecked };

  return {
    summary: {
      decision: display.decision.label,
      decisionNote,
      source: { label: display.source.label, tone, note: sourceNote },
      facts,
      warnings: display.flags.map((flag) => DISPLAY_FLAG_LABELS[flag]),
    },
    comparison,
    problems,
    unchecked,
  };
}
