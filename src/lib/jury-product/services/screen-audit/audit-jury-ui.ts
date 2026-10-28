/** I-099 client-safe helpers (no node: imports) — used by AuditJuryReviewButton. */

export const AUDIT_JURY_STEPS = ['화면 심사', '위원 심사', '개선 제안'] as const;
export type AuditJuryPhase = 'idle' | 'starting' | 'running' | 'done' | 'failed';

/** Step states for the 3-step progress row. 화면 심사 is already finished when the button is shown. */
export function auditJurySteps(phase: AuditJuryPhase): { label: (typeof AUDIT_JURY_STEPS)[number]; state: 'done' | 'active' | 'todo' | 'failed' }[] {
  const review = phase === 'done' ? 'done' : phase === 'failed' ? 'failed' : phase === 'idle' ? 'todo' : 'active';
  const proposals = phase === 'done' ? 'done' : 'todo';
  return [
    { label: '화면 심사', state: 'done' },
    { label: '위원 심사', state: review },
    { label: '개선 제안', state: proposals },
  ];
}

export const AUDIT_JURY_RESULT_ANCHOR = 'improvement-proposals';
/** Evidence purpose label for the one-click path (kept apart from 'aisle-self-observation'). */
export const SCREEN_AUDIT_EVIDENCE_PURPOSE = 'screen-audit';
export const AUDIT_JURY_REUSED_NOTICE = '이전에 저장된 위원 심사 결과를 다시 열었어요. 같은 화면 심사·근거로 이미 끝난 심사라 새로 실행하지 않았어요.';
export function auditJuryResultHref(resultId: string, reused = false): string {
  return `/jury/reviews/${resultId}${reused ? '?reused=1' : ''}#${AUDIT_JURY_RESULT_ANCHOR}`;
}
/** Start/poll failure → readable text (NO_AUDIT blocks instead of falling back). */
export function auditJuryFailureText(reason: string): string {
  if (reason === 'NO_AUDIT') return '화면 심사가 끝나면 위원 심사를 할 수 있어요. 먼저 화면 심사를 완료해 주세요.';
  return `위원 심사를 끝내지 못했어요 (${reason}). 잠시 후 다시 눌러 주세요.`;
}

/** Poll result → phase. RUNNING past the I-048 stale window (330s) is reported as failed so the user can retry. */
export type AuditJuryPoll =
  | { state: 'RUNNING'; elapsedMs: number }
  | { state: 'COMPLETED'; resultId: string }
  | { state: 'FAILED'; reason: string }
  | { state: 'NOT_FOUND' };
