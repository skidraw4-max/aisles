'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { startAiReviewBoardRun } from './actions';
import { reviewBoardPhaseLabelKo } from '@/lib/ai-review-board/phase-label';
import type { ReviewBoardPhase } from '@/lib/ai-review-board/types';
import styles from './board.module.css';

type Props = {
  inProgressRunId: string | null;
  inProgressStatus: ReviewBoardPhase | null;
};

export function AiReviewBoardStartClient({ inProgressRunId, inProgressStatus }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const busy = Boolean(inProgressRunId) || pending;
  const busyLabel =
    inProgressStatus != null
      ? reviewBoardPhaseLabelKo(inProgressStatus)
      : pending
        ? '증거 수집 중'
        : null;

  return (
    <div className={styles.startRow}>
      <button
        type="button"
        className={styles.startButton}
        disabled={busy}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const res = await startAiReviewBoardRun();
            if (!res.ok) {
              if (res.code === 'IN_PROGRESS' && res.inProgressRunId) {
                router.push(`/admin/ai-review-board/${res.inProgressRunId}`);
                return;
              }
              setError(res.error);
              return;
            }
            router.push(`/admin/ai-review-board/${res.runId}`);
          });
        }}
      >
        {busy && busyLabel ? busyLabel : '운영위원회 일시키기'}
      </button>
      {inProgressRunId ? (
        <button
          type="button"
          className={styles.linkButton}
          onClick={() => router.push(`/admin/ai-review-board/${inProgressRunId}`)}
        >
          진행 중 런 보기
        </button>
      ) : null}
      {error ? <p className={styles.startError}>{error}</p> : null}
    </div>
  );
}
