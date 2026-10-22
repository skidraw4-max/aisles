'use client';

import { useEffect, useRef, useState } from 'react';
import styles from './post.module.css';

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

function ExternalLinkIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width={20}
      height={20}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  );
}

export type LaunchVisitSize = 'hero' | 'footer' | 'sidebar';

type Props = {
  href: string;
  size: LaunchVisitSize;
};

export function LaunchVisitProjectCta({ href, size }: Props) {
  const url = safeHref(href);
  const [navigating, setNavigating] = useState(false);
  const clearRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (clearRef.current) clearTimeout(clearRef.current);
    };
  }, []);

  if (!url) return null;

  const rootClass =
    size === 'hero'
      ? `${styles.launchVisitRoot} ${styles.launchVisitRootHero}`
      : size === 'footer'
        ? `${styles.launchVisitRoot} ${styles.launchVisitRootFooter}`
        : `${styles.launchVisitRoot} ${styles.launchVisitRootSidebar}`;

  const linkClass =
    size === 'hero'
      ? `${styles.launchVisitLink} ${styles.launchVisitLinkHero}`
      : size === 'footer'
        ? `${styles.launchVisitLink} ${styles.launchVisitLinkFooter}`
        : `${styles.launchVisitLink} ${styles.launchVisitLinkSidebar}`;

  function handleClick() {
    setNavigating(true);
    if (clearRef.current) clearTimeout(clearRef.current);
    clearRef.current = setTimeout(() => {
      setNavigating(false);
      clearRef.current = null;
    }, 1400);
  }

  return (
    <div className={rootClass}>
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className={linkClass}
        onClick={handleClick}
        aria-busy={navigating}
      >
        <span className={styles.launchVisitGlow} aria-hidden />
        <span className={styles.launchVisitSheen} aria-hidden />
        <span className={styles.launchVisitInner}>
          {navigating ? (
            <span className={styles.launchVisitLoading}>이동 중입니다…</span>
          ) : (
            <>
              <span className={styles.launchVisitTitleRow}>
                <span className={styles.launchVisitTitle}>Visit Project</span>
                <ExternalLinkIcon className={styles.launchVisitIcon} />
              </span>
              {size === 'footer' ? (
                <span className={styles.launchVisitSub}>새 탭에서 프로젝트가 열립니다</span>
              ) : (
                <span className={styles.launchVisitSubCompact}>새 탭으로 열기</span>
              )}
            </>
          )}
        </span>
      </a>
    </div>
  );
}
