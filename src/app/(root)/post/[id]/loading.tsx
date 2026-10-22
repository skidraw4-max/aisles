import styles from './post-detail-loading.module.css';

export default function PostDetailLoading() {
  return (
    <main className={styles.wrap} aria-busy="true" aria-label="게시글 불러오는 중">
      <div className={`${styles.pulse} ${styles.lineWide}`} />
      <div className={styles.meta}>
        <div className={`${styles.pulse} ${styles.metaDot}`} />
        <div style={{ flex: 1 }}>
          <div className={`${styles.pulse} ${styles.line}`} style={{ width: '40%' }} />
          <div className={`${styles.pulse} ${styles.line}`} style={{ width: '28%' }} />
        </div>
      </div>
      <div className={`${styles.pulse} ${styles.block}`} />
      <div className={`${styles.pulse} ${styles.line}`} />
      <div className={`${styles.pulse} ${styles.line}`} style={{ width: '92%' }} />
      <div className={`${styles.pulse} ${styles.line}`} style={{ width: '88%' }} />
      <div className={`${styles.pulse} ${styles.line}`} style={{ width: '76%' }} />
      <p className={styles.hint}>게시글을 불러오는 중입니다…</p>
    </main>
  );
}
