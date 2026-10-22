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
  const ga4Defs = evidence.ga4?.metricDefinitions;
  const ga4Guard = evidence.ga4
    ? `

GA4 BLOCK RULES:
- EvidencePack.ga4 metrics come from Google Analytics Data API when available=true.
- GA4 activeUsers ≠ DB aggregates.activeUsersLast7d.
- GA4 newUsers ≠ DB newUsersLast7d (signups). Definitions differ.
- GA4 screenPageViews ≠ DB aggregates.viewsLast7d / totalViews.
- If ga4.available=false, treat GA metrics as UNKNOWN; do not invent from DB; do not treat as 0 or low activity.
- Real metric value 0 is DIRECT_FACT zero for that GA metric only — not proof the product has no users.
- Prefer evidenceItems ids (GA_* / DB_*) in evidenceRefs. Source must be cited as GA4 or DATABASE.
- GA vs DB gaps → needsVerification / HYPOTHESIS only; never auto-causal.
${ga4Defs ? `ga4.metricDefinitions:\n${JSON.stringify(ga4Defs, null, 2)}` : ''}`
    : '';

  return `${EVIDENCE_METRIC_PROMPT_GUARD}${ga4Guard}

metricDefinitions (authoritative DB):
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
    (au.includes('newusers') || au.includes('신규')) &&
    (vv.includes('postviewdaily') || vv.includes('totalviews')) &&
    (tv.includes('전체') || tv.includes('all') || tv.includes('sum'))
  );
}
