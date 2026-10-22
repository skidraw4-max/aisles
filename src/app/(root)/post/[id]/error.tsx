'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import styles from './post-detail-error.module.css';

export default function PostDetailError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[PostDetailError]', error);
  }, [error]);

  return (
    <main className={styles.wrap} role="alert">
      <h1 className={styles.title}>게시글을 불러오지 못했습니다</h1>
      <p className={styles.lead}>
        일시적인 서버·데이터베이스 연결 문제일 수 있습니다. 잠시 후 다시 시도해 주세요.
      </p>
      <div className={styles.actions}>
        <button type="button" className={styles.primaryBtn} onClick={() => reset()}>
          다시 시도
        </button>
        <Link href="/" className={styles.secondaryBtn}>
          홈으로
        </Link>
      </div>
    </main>
  );
}
