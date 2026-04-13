'use client';

import type { ReactNode } from 'react';
import nextDynamic from 'next/dynamic';
import type { Category } from '@prisma/client';
import type { FeedPostJson } from '@/lib/home-feed';
import type { LaunchFeedSlide } from '@/components/LaunchFeedSlider';
import styles from '@/app/(root)/page.module.css';

const TodaysBest = nextDynamic(
  () => import('@/components/TodaysBest').then((m) => ({ default: m.TodaysBest })),
  {
    ssr: false,
    loading: () => <div className={styles.dynamicClientTodaysBestFallback} aria-hidden />,
  }
);

const LaunchFeedSlider = nextDynamic(
  () => import('@/components/LaunchFeedSlider').then((m) => ({ default: m.LaunchFeedSlider })),
  {
    ssr: false,
    loading: () => <div className={styles.dynamicClientLaunchFallback} aria-hidden />,
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
  layoutRowNoHero,
  recentAside,
  filterCategory,
  launchSlides,
  homeAllFeed,
}: HomeDeferredLowerProps) {
  return (
    <div
      className={[styles.feedLayoutRow, layoutRowNoHero ? styles.feedLayoutRowNoHero : '']
        .filter(Boolean)
        .join(' ')}
    >
      {heroColumn}
      <div className={styles.feedLayoutAside}>
        <div className={styles.feedAsideStack}>
          <TodaysBest />
          {recentAside}
        </div>
      </div>
      <div className={styles.feedLayoutMainFeed}>
        {!filterCategory ? (
          <div className={styles.launchBlockWrap}>
            <h2 className={styles.launchSectionHeading}>LAUNCH</h2>
            {launchSlides.length > 0 ? <LaunchFeedSlider slides={launchSlides} /> : null}
          </div>
        ) : null}
        {!filterCategory ? <h2 className={styles.allFeedSectionHeading}>ALL</h2> : null}
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
