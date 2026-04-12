'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import type { ContentTabId } from '@/lib/content-tab';
import { getContentTabFromSearchParams } from '@/lib/content-tab';
import styles from '@/app/page.module.css';

const TABS: { id: ContentTabId; label: string; href: string }[] = [
  { id: 'latest', label: '최신', href: '/' },
  { id: 'lab', label: 'LAB', href: '/?category=LAB' },
  { id: 'gallery', label: 'GALLERY', href: '/?category=GALLERY' },
  { id: 'lounge', label: 'LOUNGE', href: '/?category=LOUNGE' },
  { id: 'gossip', label: 'GOSSIP', href: '/?category=GOSSIP' },
  { id: 'build', label: 'BUILD', href: '/?category=BUILD' },
  { id: 'launch', label: 'LAUNCH', href: '/?category=LAUNCH' },
];

export function HomeContentTabs() {
  const searchParams = useSearchParams();
  const active = getContentTabFromSearchParams(searchParams);

  return (
    <nav className={`${styles.contentTabBar} ${styles.contentTabBarStrip}`} aria-label="콘텐츠 구분">
      <ul className={styles.contentTabList}>
        {TABS.map((tab) => {
          const isActive = tab.id === active;
          return (
            <li key={tab.id}>
              <Link
                href={tab.href}
                scroll={false}
                prefetch
                className={isActive ? `${styles.contentTabPill} ${styles.contentTabPillActive}` : styles.contentTabPill}
                aria-current={isActive ? 'page' : undefined}
              >
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
