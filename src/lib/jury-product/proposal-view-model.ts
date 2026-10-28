/**
 * I-092: display model for 발견된 문제 / 개선 제안 / 검증 체크리스트. Pure; reads finalSurface tolerantly.
 * Old results (stored before I-091) have no `improvementProposals` and render as LEGACY using topProblems.
 * Missing evidence is shown as 미검증 — never as a confirmed defect.
 */
import { parseJuryNoChangeItems, parseJuryProposals } from '../ai-review-board/jury-mode';
import type { JuryImprovementProposal, JuryNoChangeItem, JuryRationaleType } from '../ai-review-board/types';

export type ProposalFinding = { problem: string; evidence: string; status: '관찰됨' | '미검증' };
export type ProposalRow = JuryImprovementProposal & { basisLabel: '화면·데이터 근거' | '일반 권고'; statusLabel: '근거 있음' | '미검증'; rationaleLabel: string | null };

/** P3: Korean labels for the optional rationale type. */
export const RATIONALE_LABELS: Record<JuryRationaleType, string> = { principle: '공통 원칙', siteTrait: '사이트 특성', general: '일반 권고' };
export type ProposalView = {
  state: 'READY' | 'EMPTY' | 'LEGACY' | 'OMITTED';
  notice: string | null;
  findings: ProposalFinding[];
  proposals: ProposalRow[];
  checklist: { item: string; problem: string }[];
  /** P3: areas kept as-is (수정 불필요). Empty on older results. */
  noChange: JuryNoChangeItem[];
};

export const PROPOSAL_NOTICES = {
  LEGACY: '이 결과는 개선 제안 형식 도입 전에 저장되었어요. 문제 목록만 표시해요.',
  EMPTY: '근거와 구체 수정안을 갖춘 개선 제안이 없어요.',
  OMITTED: '민감 정보가 포함되어 개선 제안을 표시하지 않아요.',
} as const;

function strings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0) : [];
}

export function buildProposalView(finalSurface: unknown): ProposalView {
  const surface = finalSurface && typeof finalSurface === 'object' && !Array.isArray(finalSurface) ? (finalSurface as Record<string, unknown>) : {};
  if (surface.improvementProposalsOmitted === 'SECRET') {
    return { state: 'OMITTED', notice: PROPOSAL_NOTICES.OMITTED, findings: [], proposals: [], checklist: [], noChange: [] };
  }
  const noChange = parseJuryNoChangeItems(surface.noChangeItems);
  if (!Object.hasOwn(surface, 'improvementProposals')) {
    return {
      state: 'LEGACY',
      notice: PROPOSAL_NOTICES.LEGACY,
      findings: strings(surface.topProblems).slice(0, 8).map((problem) => ({ problem, evidence: '', status: '미검증' })),
      proposals: [],
      checklist: [],
      noChange: [],
    };
  }
  const proposals: ProposalRow[] = parseJuryProposals(surface.improvementProposals).map((p) => ({
    ...p,
    basisLabel: p.evidenceBasis === 'observed' ? '화면·데이터 근거' : '일반 권고',
    statusLabel: p.evidenceBasis === 'observed' && !p.unverified ? '근거 있음' : '미검증',
    rationaleLabel: p.rationaleType ? RATIONALE_LABELS[p.rationaleType] : null,
  }));
  if (proposals.length === 0) return { state: 'EMPTY', notice: PROPOSAL_NOTICES.EMPTY, findings: [], proposals: [], checklist: [], noChange };
  return {
    state: 'READY',
    notice: null,
    findings: proposals.map((p) => ({ problem: p.problem, evidence: p.evidence, status: p.statusLabel === '근거 있음' ? '관찰됨' : '미검증' })),
    proposals,
    checklist: proposals.flatMap((p) => p.verification.map((item) => ({ item, problem: p.problem }))),
    noChange,
  };
}
