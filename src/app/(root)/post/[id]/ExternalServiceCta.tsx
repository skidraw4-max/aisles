import styles from './post.module.css';

export type ExternalServiceCtaVariant = 'launchFooter' | 'buildBand' | 'sidebar';

type Props = {
  href: string;
  variant: ExternalServiceCtaVariant;
  /** 사이드바에서 LAUNCH일 때 글로우 강화 */
  sidebarHighlight?: boolean;
};

function safeHref(raw: string): string | null {
  const t = raw.trim();
  if (!t.toLowerCase().startsWith('https://')) return null;
  try {
    const u = new URL(t);
    if (u.protocol !== 'https:') return null;
    return u.href;
  } catch {
    return null;
  }
}

export function ExternalServiceCta({ href, variant, sidebarHighlight }: Props) {
  const url = safeHref(href);
  if (!url) return null;

  const rootClass =
    variant === 'launchFooter'
      ? `${styles.externalCtaRoot} ${styles.externalCtaRootFooter}`
      : variant === 'buildBand'
        ? `${styles.externalCtaRoot} ${styles.externalCtaRootBuild}`
        : `${styles.externalCtaRoot} ${styles.externalCtaRootSidebar}${sidebarHighlight ? ` ${styles.externalCtaRootSidebarLaunch}` : ''}`;

  const linkClass =
    variant === 'launchFooter'
      ? `${styles.externalCtaLink} ${styles.externalCtaLinkFooter}`
      : variant === 'buildBand'
        ? `${styles.externalCtaLink} ${styles.externalCtaLinkBuild}`
        : `${styles.externalCtaLink} ${styles.externalCtaLinkSidebar}${sidebarHighlight ? ` ${styles.externalCtaLinkSidebarBoost}` : ''}`;

  const isVisitProject = variant === 'launchFooter';

  return (
    <div className={rootClass}>
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className={linkClass}
      >
        <span className={styles.externalCtaGlow} aria-hidden />
        <span className={styles.externalCtaInner}>
          {isVisitProject ? (
            <>
              <span className={styles.externalCtaTitleFooter}>Visit Project</span>
              <span className={styles.externalCtaSubFooter}>새 탭에서 프로젝트 열기</span>
            </>
          ) : (
            <>
              <span className={styles.externalCtaTitle}>사이트 방문하기</span>
              <span className={styles.externalCtaSub}>Visit Service</span>
            </>
          )}
        </span>
        <span className={isVisitProject ? styles.externalCtaArrowFooter : styles.externalCtaArrow} aria-hidden>
          ↗
        </span>
      </a>
    </div>
  );
}
