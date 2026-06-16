'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import type { ContentTabId } from '@/lib/content-tab';
import { getContentTabFromSearchParams } from '@/lib/content-tab';
import { shouldShowBuildLaunchInNav } from '@/lib/hide-build-launch-menu';
import { HOME_ALL_HREF, useNavigateHomeAll } from '@/lib/home-corridor-nav';
import { useUiLabels } from '@/components/UiLabelsProvider';
import styles from '@/app/(root)/page.module.css';

/** 상단 헤더 복도(`MainNav` `HOME_NAV_ITEMS`)와 동일 UI 키 */
const TABS: { id: ContentTabId; labelKey: string; href: string }[] = [
  { id: 'latest', labelKey: 'corridor.all', href: HOME_ALL_HREF },
  { id: 'lab', labelKey: 'corridor.lab', href: '/?category=LAB' },
  { id: 'gallery', labelKey: 'corridor.gallery', href: '/?category=GALLERY' },
  { id: 'lounge', labelKey: 'corridor.lounge', href: '/?category=LOUNGE' },
  { id: 'gossip', labelKey: 'corridor.gossip', href: '/?category=GOSSIP' },
  { id: 'build', labelKey: 'corridor.build', href: '/?category=BUILD' },
  { id: 'launch', labelKey: 'corridor.launch', href: '/?category=LAUNCH' },
  { id: 'ai_fortune', labelKey: 'corridor.ai_fortune', href: '/?category=AI_FORTUNE' },
];

function visibleTabs() {
  return TABS.filter((tab) => shouldShowBuildLaunchInNav(tab.id));
}

export function HomeContentTabs() {
  const searchParams = useSearchParams();
  const active = getContentTabFromSearchParams(searchParams);
  const navigateHomeAll = useNavigateHomeAll();
  const m = useUiLabels();

  return (
    <nav className={`${styles.contentTabBar} ${styles.contentTabBarStrip}`} aria-label="콘텐츠 구분">
      <ul className={styles.contentTabList}>
        {visibleTabs().map((tab) => {
          const isActive = tab.id === active;
          const label = m?.[tab.labelKey] ?? '';
          return (
            <li key={tab.id}>
              <Link
                href={tab.href}
                scroll={false}
                prefetch
                className={isActive ? `${styles.contentTabPill} ${styles.contentTabPillActive}` : styles.contentTabPill}
                aria-current={isActive ? 'page' : undefined}
                onClick={tab.id === 'latest' ? navigateHomeAll : undefined}
              >
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
