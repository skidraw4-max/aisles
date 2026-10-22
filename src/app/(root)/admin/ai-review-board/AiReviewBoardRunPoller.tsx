'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { isInProgressReviewBoardPhase } from '@/lib/ai-review-board/phase-label';
import type { ReviewBoardPhase } from '@/lib/ai-review-board/types';

const POLL_MS = 2500;

/** 진행 중이면 router.refresh로 상세 스냅샷을 갱신한다. */
export function AiReviewBoardRunPoller({ status }: { status: ReviewBoardPhase }) {
  const router = useRouter();

  useEffect(() => {
    if (!isInProgressReviewBoardPhase(status)) return;
    const id = window.setInterval(() => {
      router.refresh();
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [status, router]);

  return null;
}
