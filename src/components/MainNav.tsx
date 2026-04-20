'use client';

import { useEffect, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { X } from 'lucide-react';
import { useUiLabels } from '@/components/UiLabelsProvider';
import styles from './SiteHeader.module.css';

/** 홈 상단 복도 — `labelKey`는 UI 설정(DB) 키 */
export const HOME_NAV_ITEMS: { href: string; queryKey: string | null; labelKey: string }[] = [
  { href: '/', queryKey: null, labelKey: 'corridor.all' },
  { href: '/?category=LAB', queryKey: 'LAB', labelKey: 'corridor.lab' },
  { href: '/?category=GALLERY', queryKey: 'GALLERY', labelKey: 'corridor.gallery' },
  { href: '/?category=LOUNGE', queryKey: 'LOUNGE', labelKey: 'corridor.lounge' },
  { href: '/?category=GOSSIP', queryKey: 'GOSSIP', labelKey: 'corridor.gossip' },
  { href: '/?category=BUILD', queryKey: 'BUILD', labelKey: 'corridor.build' },
  { href: '/?category=LAUNCH', queryKey: 'LAUNCH', labelKey: 'corridor.launch' },
];

function navClassName(active: boolean) {
  return active
    ? `${styles.navLink} ${styles.navLinkQuasi} ${styles.navLinkActive}`
    : `${styles.navLink} ${styles.navLinkQuasi}`;
}

function pick(m: Record<string, string> | null, key: string): string {
  return m?.[key] ?? '';
}

/** `useSearchParams` 사용 — 상위에서 `<Suspense>`로 감쌀 것 */
export function MainNav() {
  const m = useUiLabels();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const raw = searchParams.get('category');
  const current = raw?.trim() ? raw.trim().toUpperCase() : null;
  const aboutActive = pathname === '/about';
  const guideLabel = pick(m, 'corridor.guide');

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
            {pick(m, item.labelKey)}
          </Link>
        );
      })}
      <Link
        href="/about"
        className={navClassName(aboutActive)}
        aria-current={aboutActive ? 'page' : undefined}
      >
        {guideLabel}
      </Link>
    </nav>
  );
}

/** Suspense fallback: 동일 링크, 활성 표시 없음 */
export function MainNavFallback() {
  const m = useUiLabels();
  const guideLabel = pick(m, 'corridor.guide');
  return (
    <nav className={`${styles.nav} ${styles.navQuasi}`} aria-label="주요 메뉴">
      {HOME_NAV_ITEMS.map((item) => (
        <Link key={item.href} href={item.href} className={`${styles.navLink} ${styles.navLinkQuasi}`}>
          {pick(m, item.labelKey)}
        </Link>
      ))}
      <Link href="/about" className={`${styles.navLink} ${styles.navLinkQuasi}`}>
        {guideLabel}
      </Link>
    </nav>
  );
}

function mobileNavLinkClass(active: boolean) {
  return active ? `${styles.mobileNavLink} ${styles.mobileNavLinkActive}` : styles.mobileNavLink;
}

function MobileNavShell({
  onClose,
  children,
}: {
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return (
    <div className={styles.mobileNavRoot} role="dialog" aria-modal="true" aria-label="주요 메뉴">
      <nav className={styles.mobileNavDrawer} id="mobile-main-nav-panel" onClick={(e) => e.stopPropagation()}>
        <div className={styles.mobileNavDrawerHeader}>
          <button type="button" className={styles.mobileNavClose} aria-label="메뉴 닫기" onClick={onClose}>
            <X className="h-5 w-5" strokeWidth={2} aria-hidden />
          </button>
        </div>
        <ul className={styles.mobileNavList}>{children}</ul>
      </nav>
      <button type="button" className={styles.mobileNavBackdrop} aria-label="메뉴 닫기" onClick={onClose} />
    </div>
  );
}

/** Suspense 폴백: 활성 표시 없이 동일 링크 */
export function MobileMainNavPanelFallback({ onClose }: { onClose: () => void }) {
  const m = useUiLabels();
  const guideLabel = pick(m, 'corridor.guide');
  return (
    <MobileNavShell onClose={onClose}>
      {HOME_NAV_ITEMS.map((item) => (
        <li key={item.href}>
          <Link href={item.href} className={styles.mobileNavLink} scroll={false} onClick={onClose}>
            {pick(m, item.labelKey)}
          </Link>
        </li>
      ))}
      <li>
        <Link href="/about" className={styles.mobileNavLink} onClick={onClose}>
          {guideLabel}
        </Link>
      </li>
    </MobileNavShell>
  );
}

/** 모바일 햄버거 드로어 — `useSearchParams` 사용, 상위에서 `<Suspense>`로 감쌀 것 */
export function MobileMainNavPanel({ onClose }: { onClose: () => void }) {
  const m = useUiLabels();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const raw = searchParams.get('category');
  const current = raw?.trim() ? raw.trim().toUpperCase() : null;
  const aboutActive = pathname === '/about';
  const guideLabel = pick(m, 'corridor.guide');

  return (
    <MobileNavShell onClose={onClose}>
      {HOME_NAV_ITEMS.map((item) => {
        const active = item.queryKey === null ? current === null : current === item.queryKey;
        return (
          <li key={item.href}>
            <Link
              href={item.href}
              className={mobileNavLinkClass(active)}
              aria-current={active ? 'page' : undefined}
              scroll={false}
              onClick={onClose}
            >
              {pick(m, item.labelKey)}
            </Link>
          </li>
        );
      })}
      <li>
        <Link
          href="/about"
          className={mobileNavLinkClass(aboutActive)}
          aria-current={aboutActive ? 'page' : undefined}
          onClick={onClose}
        >
          {guideLabel}
        </Link>
      </li>
    </MobileNavShell>
  );
}
