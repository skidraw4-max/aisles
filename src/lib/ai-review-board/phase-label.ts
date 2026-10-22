import type { ReviewBoardPhase } from './types';

const PHASE_LABEL_KO: Record<ReviewBoardPhase, string> = {
  queued: '대기 중',
  collecting_evidence: '증거 수집 중',
  independent: '독립 분석 중',
  debate: '위원회 토론 중',
  claim_calibration: 'Claim Calibration 중',
  evidence_semantics: 'Evidence Semantics 중',
  semantic_judge: 'Semantic Judge 중',
  revision: 'Revision 중',
  consistency_check: 'Consistency Check 중',
  critic: 'Critic 검증 중',
  chairman: 'Chairman 종합 중',
  completed: '완료',
  failed: '실패',
};

export function isTerminalReviewBoardPhase(status: ReviewBoardPhase): boolean {
  return status === 'completed' || status === 'failed';
}

export function isInProgressReviewBoardPhase(status: ReviewBoardPhase): boolean {
  return !isTerminalReviewBoardPhase(status);
}

/** Admin UI용 phase별 한글 라벨 (debate = 위원회 토론 중). */
export function reviewBoardPhaseLabelKo(status: ReviewBoardPhase): string {
  return PHASE_LABEL_KO[status] ?? status;
}
