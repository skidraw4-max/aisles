'use client';

import type { ReactNode } from 'react';
import nextDynamic from 'next/dynamic';
import type { Category } from '@prisma/client';
import type { FeedPostJson } from '@/lib/home-feed';
import { AdBanner } from '@/components/AdBanner';
import { LaunchFeedSlider, type LaunchFeedSlide } from '@/components/LaunchFeedSlider';
import { useUiLabels } from '@/components/UiLabelsProvider';
import styles from '@/app/(root)/page.module.css';

const TodaysBest = nextDynamic(
  () => import('@/components/TodaysBest').then((m) => ({ default: m.TodaysBest })),
  {
    ssr: false,
    loading: () => <div className={styles.dynamicClientTodaysBestFallback} aria-hidden />,
  }
);

const HomeAllFeed = nextDynamic(
  () => import('@/components/HomeAllFeed').then((m) => ({ default: m.HomeAllFeed })),
  {
    ssr: false,
    loading: () => (
      <div
        className={styles.dynamicClientFeedFallback}
        aria-busy="true"
        role="status"
        aria-label="피드 로딩"
      />
    ),
  }
);

export type HomeDeferredLowerProps = {
  heroColumn?: ReactNode;
  fortuneCard?: ReactNode;
  mainFeedPrefix?: ReactNode;
  layoutRowNoHero: boolean;
  recentAside: ReactNode;
  filterCategory: Category | null;
  launchSlides: LaunchFeedSlide[];
  homeAllFeed: {
    feedKey: string;
    category: Category | null;
    excludeIds: string[];
    initialPosts: FeedPostJson[];
    initialHasMore: boolean;
  };
};

/** 메인 하단: TodaysBest·LAUNCH·ALL 피드 등 무거운 클라 번들을 ssr:false로 분리 */
export function HomeDeferredLower({
  heroColumn,
  fortuneCard,
  mainFeedPrefix,
  layoutRowNoHero,
  recentAside,
  filterCategory,
  launchSlides,
  homeAllFeed,
}: HomeDeferredLowerProps) {
  const m = useUiLabels();
  const launchHeading = m?.['home.section.launch_heading'] ?? '';
  const allHeading = m?.['home.section.all_feed_heading'] ?? '';
  const adRemountKey = homeAllFeed.feedKey;

  return (
    <div
      className={[
        styles.feedLayoutRow,
        layoutRowNoHero ? styles.feedLayoutRowNoHero : '',
        filterCategory ? styles.feedLayoutRowMobileCategory : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {heroColumn}
      <div className={styles.feedLayoutAside}>
        <div className={styles.feedAsideStack}>
          <TodaysBest />
          {recentAside}
          <div className={styles.sidebarAdWrap}>
            <AdBanner variant="kakao-infeed" remountKey={adRemountKey} />
          </div>
        </div>
      </div>
      <div className={styles.feedLayoutMainFeed}>
        {mainFeedPrefix}
        {fortuneCard}
        {!filterCategory ? (
          <div className={styles.mainStripAdWrap}>
            <AdBanner variant="kakao-leaderboard" remountKey={adRemountKey} />
          </div>
        ) : null}
        {!filterCategory ? (
          <div className={styles.launchBlockWrap}>
            <h2 className={styles.launchSectionHeading}>{launchHeading}</h2>
            {launchSlides.length > 0 ? <LaunchFeedSlider slides={launchSlides} /> : null}
          </div>
        ) : null}
        {!filterCategory ? <h2 className={styles.allFeedSectionHeading}>{allHeading}</h2> : null}
        <HomeAllFeed
          key={homeAllFeed.feedKey}
          category={homeAllFeed.category}
          excludeIds={homeAllFeed.excludeIds}
          initialPosts={homeAllFeed.initialPosts}
          initialHasMore={homeAllFeed.initialHasMore}
        />
      </div>
    </div>
  );
}
