'use client';

import { useRef, useState } from 'react';
import styles from './jury.module.css';
import { shortId } from './review-summary-format';

export function CopyIdButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={styles.copyButton}
      aria-label={copied ? '복사됨' : '리뷰 자료 ID 복사'}
      title={copied ? '복사됨' : '전체 ID 복사'}
      onClick={() => {
        void navigator.clipboard?.writeText(value).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        }).catch(() => undefined);
      }}
    >
      {copied ? '복사됨' : '복사'}
    </button>
  );
}

export type ReviewSummaryDialogProps = {
  summary: string;
  decisionLabel: string;
  statusLabel: string;
  completedAtFull: string;
  evidenceId: string | null;
  detailHref: string;
};

/** Display-only popup for the full English review summary. Native <dialog>; no data changes. */
export function ReviewSummaryDialog(props: ReviewSummaryDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const close = () => ref.current?.close();
  return (
    <>
      <button type="button" className={styles.summaryButton} onClick={() => ref.current?.showModal()} aria-haspopup="dialog">
        상세보기
      </button>
      <dialog
        ref={ref}
        className={styles.summaryDialog}
        aria-label="요약 상세"
        onClick={(event) => {
          if (event.target === event.currentTarget) close();
        }}
      >
        <div className={styles.summaryDialogInner}>
          <button type="button" className={styles.summaryDialogClose} aria-label="닫기" onClick={close}>✕</button>
          <h3 className={styles.summaryDialogTitle}>요약 상세</h3>
          <div className={styles.summaryDialogBadges}>
            <span className={styles.badge}>결론: {props.decisionLabel}</span>
            <span className={styles.badge}>상태: {props.statusLabel}</span>
          </div>
          <p className={styles.summaryDialogMeta}>
            완료일 {props.completedAtFull}
            {props.evidenceId ? (
              <>
                {' · 리뷰 자료 '}
                <span className={styles.evidenceId} title={props.evidenceId}>{shortId(props.evidenceId)}</span>
                <CopyIdButton value={props.evidenceId} />
              </>
            ) : null}
          </p>
          <div className={styles.summaryDialogBody} lang="en">{props.summary || '요약이 없습니다.'}</div>
          <p className={styles.muted}>영문 요약입니다. 브라우저 번역 기능으로 한국어로 볼 수 있습니다.</p>
          <div className={styles.summaryDialogFooter}>
            <a className={styles.inline} href={props.detailHref}>리뷰 상세로 이동</a>
            <button type="button" className={styles.secondaryButton} onClick={close}>닫기</button>
          </div>
        </div>
      </dialog>
    </>
  );
}
