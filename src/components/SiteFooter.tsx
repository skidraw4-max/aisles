import Link from 'next/link';
import styles from './site-footer.module.css';

type Props = {
  /** 기술 스택 등 보조 문구 (선택) */
  techNote?: string;
};

export function SiteFooter({ techNote = 'Supabase Auth · Prisma · Next.js' }: Props) {
  return (
    <footer className={styles.footer}>
      <div className={styles.footerLeft}>
        <span className={styles.footerBrand}>AIsle</span>
        {techNote ? <span className={styles.footerMuted}>{techNote}</span> : null}
      </div>
      <nav className={styles.footerNav} aria-label="정책·고객지원">
        <Link href="/legal/terms">이용약관</Link>
        <Link href="/legal/privacy">개인정보처리방침</Link>
        <Link href="/support">고객지원</Link>
      </nav>
    </footer>
  );
}
