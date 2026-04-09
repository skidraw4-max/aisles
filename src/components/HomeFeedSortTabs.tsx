import Link from 'next/link';
import type { HomeFeedSort } from '@/lib/feed-sort';
import styles from '@/app/page.module.css';

type Props = {
  sort: HomeFeedSort;
};

/**
 * 메인(/) 전용 — 헤더 카테고리 메뉴 바로 아래, 작은 정렬 탭.
 * `/?sort=hot` · `/` 로 서버 데이터와 동기화됩니다.
 */
export function HomeFeedSortTabs({ sort }: Props) {
  return (
    <nav className={styles.homeFeedSortNav} aria-label="피드 정렬">
      <Link
        href="/"
        scroll={false}
        className={sort === 'new' ? `${styles.homeFeedSortPill} ${styles.homeFeedSortPillActive}` : styles.homeFeedSortPill}
        aria-current={sort === 'new' ? 'page' : undefined}
      >
        최신순
        <span className={styles.homeFeedSortEn}>New</span>
      </Link>
      <Link
        href="/?sort=hot"
        scroll={false}
        className={sort === 'hot' ? `${styles.homeFeedSortPill} ${styles.homeFeedSortPillActive}` : styles.homeFeedSortPill}
        aria-current={sort === 'hot' ? 'page' : undefined}
      >
        인기순
        <span className={styles.homeFeedSortEn}>Hot</span>
      </Link>
    </nav>
  );
}
