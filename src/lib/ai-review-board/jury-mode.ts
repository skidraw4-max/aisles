/**
 * I-089~I-093: Jury-only review guidelines.
 *
 * /ai-review-board never sets `EvidencePack.reviewMode`, so every helper here returns '' / no-op for it and the
 * board prompts and output stay byte-identical. Jury sets `reviewMode: 'jury'` in review-core only.
 * Judge count and call flow are unchanged (EXPECTED_PIPELINE_LLM_CALLS stays 32): the guidelines ride inside
 * the existing independent / debate / revision / chairman calls.
 */
import type { CommitteeMemberId, EvidencePack, JuryImprovementProposal, JuryProposalPriority, JuryProposalReview } from './types';

export function isJuryMode(evidence: EvidencePack | null | undefined): boolean {
  return evidence?.reviewMode === 'jury';
}

/** Shared roles stay in PERSONA_SYSTEM; this only narrows each member's participation scope for Jury. */
export const JURY_MEMBER_SCOPE: Record<CommitteeMemberId, string> = {
  A: 'Jury 참여 범위: UI/UX 주 담당 — 화면 구조, 정보 위계, 입력·버튼·표, 모바일 레이아웃.',
  B: 'Jury 참여 범위(보조): 기존 트렌드·SEO/GEO·유입 역할 유지. 화면에서 확인되는 검색 노출·첫 화면 메시지·유입 동선 요소만 다룬다. 근거 없는 시장 트렌드 단정은 하지 않는다.',
  C: 'Jury 참여 범위: 제품·기능 관점 — 핵심 가치 전달, 기능 흐름의 막힘, 경쟁 대비 빠진 기능.',
  D: 'Jury 참여 범위: 기술·운영 관점 — 접근성(대비·포커스·라벨), 반응형, 성능, 오류 처리, 보안 노출.',
  E: 'Jury 참여 범위(보조): 기존 커뮤니티·리텐션 역할 유지. 재방문·참여를 막는 화면 흐름과 빈 상태·후속 행동 안내만 다룬다.',
  F: 'Jury 참여 범위: 신뢰·근거 관점 — 근거 없는 단정, 과장, 미검증 주장을 걸러낸다.',
  Chairman: 'Jury 참여 범위: 종합 — 근거 있는 문제와 구체 수정안만 개선 제안으로 채택하고, 이견은 숨기지 않는다.',
};

export const JURY_PRINCIPLES = `JURY REVIEW PRINCIPLES (Jury 심사 전용):
1. 문제마다 근거를 붙인다. 화면 심사 결과(EvidencePack.screenAuditFindings) 또는 EvidencePack 수치에서 관찰한 것만 "observed"로 쓴다.
2. 관찰하지 않은 것은 결함으로 단정하지 않는다. 일반적인 모범 사례는 "general"로 표시하고 unverified=true로 둔다.
3. 개선안은 바로 실행할 수 있는 단계(무엇을, 어디서, 어떻게)로 쓴다. "개선이 필요하다" 같은 추상 문장은 금지.
4. 각 개선안의 기대 효과, 부작용, 모바일 영향을 함께 본다.
5. 확인 방법(검증 체크리스트)을 붙이고, 위원 간 이견은 dissent에 남긴다.
Write all proposal text in Korean.`;

const PROPOSAL_SCHEMA = `{ "problem": string, "evidence": string, "evidenceBasis": "observed"|"general", "steps": string[], "priority": "높음"|"중간"|"낮음", "expectedEffect": string, "verification": string[], "unverified": boolean, "dissent": string }`;

export type JuryStage = 'independent' | 'debate' | 'revision' | 'chairman';

/** System-prompt suffix. '' outside Jury mode. */
export function jurySystemAddon(evidence: EvidencePack | null | undefined, memberId: CommitteeMemberId): string {
  if (!isJuryMode(evidence)) return '';
  return `\n${JURY_MEMBER_SCOPE[memberId]}\n${JURY_PRINCIPLES}`;
}

/** User-prompt suffix with the extra JSON fields for each stage. '' outside Jury mode. */
export function juryUserAddon(evidence: EvidencePack | null | undefined, stage: JuryStage): string {
  if (!isJuryMode(evidence)) return '';
  switch (stage) {
    case 'independent':
      return `\n\nJury mode: also include "proposals": up to 4 items of ${PROPOSAL_SCHEMA}.`;
    case 'debate':
      return `\n\nJury mode: also include "proposalReviews": up to 4 items reviewing peers' proposals:
{ "targetMemberId": string, "proposal": string, "stance": "agree"|"disagree"|"needsVerification", "effect": string, "sideEffects": string, "mobileImpact": string }`;
    case 'revision':
      return `\n\nJury mode: also include "proposalPriorities": up to 4 items { "proposal": string, "priority": "높음"|"중간"|"낮음", "dissent": string }.`;
    case 'chairman':
      return `\n\nJury mode: also include "improvementProposals": up to ${JURY_PROPOSAL_LIMITS.items} items of ${PROPOSAL_SCHEMA}.
Adopt only proposals with concrete steps. A proposal whose evidence was not observed in EvidencePack must have evidenceBasis "general" and unverified=true. Keep members' dissent.`;
  }
}

export const JURY_PROPOSAL_LIMITS = { items: 6, text: 240, steps: 5, step: 160, verification: 4 } as const;

const PRIORITIES: readonly JuryProposalPriority[] = ['높음', '중간', '낮음'];

function str(v: unknown, max: number): string {
  if (typeof v !== 'string') return '';
  const t = v.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

function strList(v: unknown, items: number, max: number): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => str(x, max)).filter((x) => x.length > 0).slice(0, items);
}

/** Tolerant parser: drops malformed items (no problem or no steps), caps count and length, forces unverified for general advice. */
export function parseJuryProposals(raw: unknown): JuryImprovementProposal[] {
  if (!Array.isArray(raw)) return [];
  const out: JuryImprovementProposal[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const problem = str(o.problem, JURY_PROPOSAL_LIMITS.text);
    const steps = strList(o.steps, JURY_PROPOSAL_LIMITS.steps, JURY_PROPOSAL_LIMITS.step);
    if (!problem || steps.length === 0) continue;
    const evidence = str(o.evidence, JURY_PROPOSAL_LIMITS.text);
    const evidenceBasis = o.evidenceBasis === 'observed' && evidence ? 'observed' : 'general';
    out.push({
      problem,
      evidence,
      evidenceBasis,
      steps,
      priority: PRIORITIES.includes(o.priority as JuryProposalPriority) ? (o.priority as JuryProposalPriority) : '중간',
      expectedEffect: str(o.expectedEffect, JURY_PROPOSAL_LIMITS.text),
      verification: strList(o.verification, JURY_PROPOSAL_LIMITS.verification, JURY_PROPOSAL_LIMITS.step),
      unverified: evidenceBasis === 'general' ? true : o.unverified === true,
      dissent: str(o.dissent, JURY_PROPOSAL_LIMITS.text),
    });
    if (out.length >= JURY_PROPOSAL_LIMITS.items) break;
  }
  return out;
}

export function parseJuryProposalReviews(raw: unknown): JuryProposalReview[] {
  if (!Array.isArray(raw)) return [];
  const out: JuryProposalReview[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const proposal = str(o.proposal, JURY_PROPOSAL_LIMITS.text);
    if (!proposal) continue;
    const stance = o.stance === 'agree' || o.stance === 'disagree' ? o.stance : 'needsVerification';
    out.push({
      targetMemberId: str(o.targetMemberId, 16),
      proposal,
      stance,
      effect: str(o.effect, JURY_PROPOSAL_LIMITS.text),
      sideEffects: str(o.sideEffects, JURY_PROPOSAL_LIMITS.text),
      mobileImpact: str(o.mobileImpact, JURY_PROPOSAL_LIMITS.text),
    });
    if (out.length >= 4) break;
  }
  return out;
}

export function parseJuryProposalPriorities(raw: unknown): { proposal: string; priority: JuryProposalPriority; dissent: string }[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
    .map((o) => ({
      proposal: str(o.proposal, JURY_PROPOSAL_LIMITS.text),
      priority: PRIORITIES.includes(o.priority as JuryProposalPriority) ? (o.priority as JuryProposalPriority) : ('중간' as const),
      dissent: str(o.dissent, JURY_PROPOSAL_LIMITS.text),
    }))
    .filter((x) => x.proposal)
    .slice(0, 4);
}

/** Deterministic Jury proposals for the mock LLM (tests / mock runs only). */
export function mockJuryProposals(evidence: EvidencePack): JuryImprovementProposal[] {
  const finding = evidence.screenAuditFindings?.findings[0];
  const observed: JuryImprovementProposal[] = finding
    ? [{
        problem: `화면 심사에서 확인된 문제: ${finding.message}`.slice(0, JURY_PROPOSAL_LIMITS.text),
        evidence: `화면 심사 ${finding.rule} (${finding.viewport}${finding.path ? ` ${finding.path}` : ''})`,
        evidenceBasis: 'observed',
        steps: ['해당 화면 요소의 스타일을 수정한다', '같은 규칙으로 화면 심사를 다시 실행한다'],
        priority: finding.severity === 'HIGH' ? '높음' : '중간',
        expectedEffect: '화면 심사 경고 해소',
        verification: ['화면 심사 재실행 시 같은 규칙이 통과', '모바일 화면에서도 확인'],
        unverified: false,
        dissent: '',
      }]
    : [];
  return [
    ...observed,
    {
      problem: '빈 상태에서 다음 행동 안내가 부족할 수 있음',
      evidence: '',
      evidenceBasis: 'general',
      steps: ['빈 목록에 다음 행동 버튼을 추가한다'],
      priority: '낮음',
      expectedEffect: '첫 사용 흐름 이탈 감소 기대',
      verification: ['빈 상태 화면에서 버튼이 보이는지 확인'],
      unverified: true,
      dissent: 'B: 유입 지표 없이 효과 단정 어려움',
    },
  ];
}
