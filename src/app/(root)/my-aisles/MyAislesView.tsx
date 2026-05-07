'use client';

import { Suspense, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { corridorLabel } from '@/lib/ui-config';
import { FeedPostCard, type FeedPostCardModel } from '@/components/FeedPostCard';
import { MyPostsGrid, type MyPostRow } from './MyPostsGrid';
import styles from './my-aisles.module.css';
import homeStyles from '@/app/(root)/page.module.css';
import Link from 'next/link';

type Tab = 'posts' | 'bookmarks';

function BookmarkedNewsList({ cards, ui }: { cards: FeedPostCardModel[]; ui: Record<string, string> }) {
  if (cards.length === 0) {
    return (
      <div className={styles.bookmarkEmpty}>
        <p className={styles.bookmarkEmptyText}>
          아직 저장한 소식이 없네요. 최신 AI 트렌드를 확인해 보세요!
        </p>
        <Link href="/" className={styles.bookmarkEmptyBtn}>
          메인으로 이동
        </Link>
      </div>
    );
  }

  return (
    <ul className={homeStyles.aiWorkGrid}>
      {cards.map((post) => (
        <li key={post.id} className={homeStyles.aiWorkGridCell}>
          <FeedPostCard post={post} badgeLabel={corridorLabel(ui, post.category)} />
        </li>
      ))}
    </ul>
  );
}

function MyAislesViewInner({
  ui,
  myPosts,
  bookmarkCards,
}: {
  ui: Record<string, string>;
  myPosts: MyPostRow[];
  bookmarkCards: FeedPostCardModel[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tab: Tab = searchParams.get('tab') === 'bookmarks' ? 'bookmarks' : 'posts';

  const setTab = useCallback(
    (next: Tab) => {
      const q = new URLSearchParams(searchParams.toString());
      if (next === 'bookmarks') q.set('tab', 'bookmarks');
      else q.delete('tab');
      const s = q.toString();
      router.replace(s ? `/my-aisles?${s}` : '/my-aisles', { scroll: false });
    },
    [router, searchParams],
  );

  return (
    <>
      <div className={styles.tabs} role="tablist" aria-label="My Aisles 구분">
        <button
          type="button"
          role="tab"
          id="tab-posts"
          aria-selected={tab === 'posts'}
          aria-controls="tab-panel-posts"
          className={`${styles.tabBtn} ${tab === 'posts' ? styles.tabBtnActive : ''}`}
          onClick={() => setTab('posts')}
        >
          내 포스트
        </button>
        <button
          type="button"
          role="tab"
          id="tab-bookmarks"
          aria-selected={tab === 'bookmarks'}
          aria-controls="tab-panel-bookmarks"
          className={`${styles.tabBtn} ${tab === 'bookmarks' ? styles.tabBtnActive : ''}`}
          onClick={() => setTab('bookmarks')}
        >
          북마크한 소식
        </button>
      </div>

      <div
        id="tab-panel-posts"
        role="tabpanel"
        aria-labelledby="tab-posts"
        hidden={tab !== 'posts'}
        className={styles.tabPanel}
      >
        {tab === 'posts' ? <MyPostsGrid posts={myPosts} /> : null}
      </div>
      <div
        id="tab-panel-bookmarks"
        role="tabpanel"
        aria-labelledby="tab-bookmarks"
        hidden={tab !== 'bookmarks'}
        className={styles.tabPanel}
      >
        {tab === 'bookmarks' ? <BookmarkedNewsList cards={bookmarkCards} ui={ui} /> : null}
      </div>
    </>
  );
}

export function MyAislesView(props: {
  ui: Record<string, string>;
  myPosts: MyPostRow[];
  bookmarkCards: FeedPostCardModel[];
}) {
  return (
    <Suspense fallback={<div className={styles.tabPanelMuted}>불러오는 중…</div>}>
      <MyAislesViewInner {...props} />
    </Suspense>
  );
}
