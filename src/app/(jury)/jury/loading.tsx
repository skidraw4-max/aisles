import styles from './jury.module.css';

export default function JuryLoading() {
  return (
    <div className={styles.wrap} aria-busy="true" aria-live="polite">
      <p className={styles.muted}>Loading Jury Console</p>
      <div className={styles.skeleton}>
        <div className={styles.skeletonBar} />
        <div className={styles.skeletonBar} />
        <div className={styles.skeletonBar} />
      </div>
    </div>
  );
}
