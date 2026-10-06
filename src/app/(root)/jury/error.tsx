'use client';

import styles from './jury.module.css';

export default function JuryError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className={styles.wrap}>
      <section className={styles.panel} role="alert">
        <h1 className={styles.title}>Jury Console</h1>
        <p>화면을 읽지 못했습니다. 다시 시도하거나 페이지를 새로고침하세요.</p>
        <button type="button" className={styles.button} onClick={() => reset()}>Retry</button>
      </section>
    </main>
  );
}
