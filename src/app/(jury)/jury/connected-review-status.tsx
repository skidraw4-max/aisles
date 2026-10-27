'use client';

/**
 * I-049: connected-service review status line. While a new review submit is in flight (ReviewSubmitButton dispatches
 * REVIEW_SUBMITTING_EVENT), the stale "중단됨" word and message are replaced by "진행 중" until the page re-renders.
 */
import { useEffect, useState } from 'react';
import { StatusBadge } from './jury-controls';
import { REVIEW_SUBMITTING_EVENT } from '@/lib/jury-product/connected-service-copy';

export function ConnectedReviewStatus(props: { statusText: string; staleText: string | null; mutedClass?: string }) {
  const [submitting, setSubmitting] = useState(false);
  useEffect(() => {
    const on = () => setSubmitting(true);
    window.addEventListener(REVIEW_SUBMITTING_EVENT, on);
    return () => window.removeEventListener(REVIEW_SUBMITTING_EVENT, on);
  }, []);
  const status = submitting && props.staleText ? '진행 중' : props.statusText;
  return (
    <>
      <p>
        심사 상태 <StatusBadge>{status}</StatusBadge>
      </p>
      {props.staleText && !submitting ? (
        <p className={props.mutedClass} role="status">
          {props.staleText}
        </p>
      ) : null}
    </>
  );
}
