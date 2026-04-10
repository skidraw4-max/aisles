'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import styles from './SiteHeader.module.css';

/** ALL + 퀘이사존 스타일 탭 순서 (LAB … LAUNCH) */
export const HOME_NAV_ITEMS: { href: string; queryKey: string | null; label: string }[] = [
  { href: '/', queryKey: null, label: 'ALL' },
  { href: '/?category=LAB', queryKey: 'LAB', label: 'LAB' },
  { href: '/?category=GALLERY', queryKey: 'GALLERY', label: 'GALLERY' },
  { href: '/?category=LOUNGE', queryKey: 'LOUNGE', label: 'LOUNGE' },
  { href: '/?category=GOSSIP', queryKey: 'GOSSIP', label: 'GOSSIP' },
  { href: '/?category=BUILD', queryKey: 'BUILD', label: 'BUILD' },
  { href: '/?category=LAUNCH', queryKey: 'LAUNCH', label: 'LAUNCH' },
];

function navClassName(active: boolean) {
  return active
    ? `${styles.navLink} ${styles.navLinkQuasi} ${styles.navLinkActive}`
    : `${styles.navLink} ${styles.navLinkQuasi}`;
}

/** `useSearchParams` 사용 — 상위에서 `<Suspense>`로 감쌀 것 */
export function MainNav() {
  const searchParams = useSearchParams();
  const raw = searchParams.get('category');
  const current = raw?.trim() ? raw.trim().toUpperCase() : null;

  return (
    <nav className={`${styles.nav} ${styles.navQuasi}`} aria-label="주요 메뉴">
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
    <nav className={`${styles.nav} ${styles.navQuasi}`} aria-label="주요 메뉴">
      {HOME_NAV_ITEMS.map((item) => (
        <Link key={item.href} href={item.href} className={`${styles.navLink} ${styles.navLinkQuasi}`}>
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
