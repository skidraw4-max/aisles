'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import styles from './SiteHeader.module.css';

export const HOME_NAV_ITEMS: { href: string; queryKey: string | null; label: string }[] = [
  { href: '/', queryKey: null, label: 'All' },
  { href: '/?category=LAB', queryKey: 'LAB', label: 'Lab' },
  { href: '/?category=GALLERY', queryKey: 'GALLERY', label: 'Gallery' },
  { href: '/?category=BUILD', queryKey: 'BUILD', label: 'Build' },
  { href: '/?category=LAUNCH', queryKey: 'LAUNCH', label: 'Launch' },
];

function navClassName(active: boolean) {
  return active ? `${styles.navLink} ${styles.navLinkActive}` : styles.navLink;
}

/** `useSearchParams` 사용 — 상위에서 `<Suspense>`로 감쌀 것 */
export function MainNav() {
  const searchParams = useSearchParams();
  const raw = searchParams.get('category');
  const current = raw?.trim() ? raw.trim().toUpperCase() : null;

  return (
    <nav className={styles.nav} aria-label="주요 메뉴">
      {HOME_NAV_ITEMS.map((item) => {
        const active = item.queryKey === null ? current === null : current === item.queryKey;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={navClassName(active)}
            aria-current={active ? 'page' : undefined}
            scroll={false}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

/** Suspense fallback: 동일 링크, 활성 표시 없음 */
export function MainNavFallback() {
  return (
    <nav className={styles.nav} aria-label="주요 메뉴">
      {HOME_NAV_ITEMS.map((item) => (
        <Link key={item.href} href={item.href} className={styles.navLink}>
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
