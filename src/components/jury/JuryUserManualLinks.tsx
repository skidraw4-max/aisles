import { JURY_USER_MANUAL_PDF, JURY_USER_MANUAL_VERSION } from '@/lib/jury-product/jury-user-manual';
import styles from './jury-user-manual.module.css';

type Variant = 'footer' | 'auth' | 'header';

export function JuryUserManualLinks({ variant = 'auth' }: { variant?: Variant }) {
  const meta = `(PDF v${JURY_USER_MANUAL_VERSION})`;
  return (
    <p className={variant === 'footer' ? styles.footer : variant === 'header' ? styles.header : styles.auth}>
      {variant === 'footer' ? (
        <span className={styles.footerLabel}>User manual (KO) {meta}</span>
      ) : (
        <span className={styles.label}>사용자 매뉴얼 {meta}</span>
      )}
      <span className={styles.links}>
        <a href={JURY_USER_MANUAL_PDF} target="_blank" rel="noopener noreferrer">
          보기
        </a>
        <span aria-hidden="true">·</span>
        <a href={JURY_USER_MANUAL_PDF} download>
          다운로드
        </a>
      </span>
    </p>
  );
}
