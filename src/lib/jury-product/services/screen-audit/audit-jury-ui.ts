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
export function auditJuryResultHref(resultId: string): string {
  return `/jury/reviews/${resultId}#${AUDIT_JURY_RESULT_ANCHOR}`;
}

/** Poll result → phase. RUNNING past the I-048 stale window (330s) is reported as failed so the user can retry. */
export type AuditJuryPoll =
  | { state: 'RUNNING'; elapsedMs: number }
  | { state: 'COMPLETED'; resultId: string }
  | { state: 'FAILED'; reason: string }
  | { state: 'NOT_FOUND' };
