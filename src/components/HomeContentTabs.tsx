'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import type { ContentTabId } from '@/lib/content-tab';
import { getContentTabFromSearchParams } from '@/lib/content-tab';
import styles from '@/app/(root)/page.module.css';

/** 상단 헤더 복도(`MainNav` `HOME_NAV_ITEMS`)와 동일 한글 라벨 */
const TABS: { id: ContentTabId; label: string; href: string }[] = [
  { id: 'latest', label: '전체', href: '/' },
  { id: 'lab', label: 'AI 연구소', href: '/?category=LAB' },
  { id: 'gallery', label: '쇼케이스', href: '/?category=GALLERY' },
  { id: 'lounge', label: 'AI 트렌드', href: '/?category=LOUNGE' },
  { id: 'gossip', label: '커뮤니티', href: '/?category=GOSSIP' },
  { id: 'build', label: '제작기', href: '/?category=BUILD' },
  { id: 'launch', label: '출시', href: '/?category=LAUNCH' },
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
