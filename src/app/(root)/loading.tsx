import styles from './home-loading.module.css';

export default function RootSegmentLoading() {
  return (
    <div className={styles.shell} aria-busy="true" aria-label="페이지 불러오는 중">
      <div className={styles.heroBlock}>
        <div className={`${styles.pulse} ${styles.lineSm}`} />
        <div className={`${styles.pulse} ${styles.lineLg}`} />
        <div className={`${styles.pulse} ${styles.lineMd}`} />
      </div>
      <div className={styles.tabRow}>
        <div className={`${styles.pulse} ${styles.tabPill}`} />
        <div className={`${styles.pulse} ${styles.tabPill}`} />
        <div className={`${styles.pulse} ${styles.tabPill}`} />
        <div className={`${styles.pulse} ${styles.tabPill}`} />
      </div>
      <div className={styles.grid}>
        <div className={`${styles.pulse} ${styles.card}`} />
        <div className={`${styles.pulse} ${styles.card}`} />
        <div className={`${styles.pulse} ${styles.card}`} />
        <div className={`${styles.pulse} ${styles.card}`} />
      </div>
      <p className={styles.hint}>콘텐츠를 불러오는 중입니다…</p>
    </div>
  );
}
