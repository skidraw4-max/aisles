import {
  EVIDENCE_METRIC_DEFINITIONS,
  EVIDENCE_METRIC_PROMPT_GUARD,
  type EvidencePack,
} from './types';

/**
 * LLM에 넣을 EvidencePack 텍스트.
 * metricDefinitions + 가드를 JSON 앞에 두어 수치 오해석을 줄인다.
 * (Debate/Critic/Chairman 구조는 변경하지 않음 — 입력 표현만 강화)
 */
export function formatEvidencePackForPrompt(evidence: EvidencePack): string {
  const defs = evidence.metricDefinitions ?? EVIDENCE_METRIC_DEFINITIONS;
  return `${EVIDENCE_METRIC_PROMPT_GUARD}

metricDefinitions (authoritative):
${JSON.stringify(defs, null, 2)}

EvidencePack JSON (read-only, no PII):
${JSON.stringify(evidence, null, 2)}`;
}

/** 정의 문구가 필수 금지 해석을 포함하는지 (회귀 방지) */
export function metricDefinitionsForbidActiveUserMisread(
  defs: typeof EVIDENCE_METRIC_DEFINITIONS = EVIDENCE_METRIC_DEFINITIONS,
): boolean {
  const nu = defs.newUsersLast7d.toLowerCase();
  const us = defs.usersLast7d.toLowerCase();
  const au = defs.activeUsersLast7d.toLowerCase();
  const vv = defs.viewsLast7d.toLowerCase();
  const tv = defs.totalViews.toLowerCase();
  return (
    nu.includes('not active') &&
    (us.includes('not') || us.includes('활성')) &&
    (us.includes('active') || us.includes('dau')) &&
    au.includes('null') &&
    vv.includes('null') &&
    (tv.includes('전체') || tv.includes('all') || tv.includes('sum'))
  );
}
