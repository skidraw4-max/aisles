'use client';

import { useCallback, useEffect, useState } from 'react';
import { corridorLabel } from '@/lib/corridor-label';
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

function tabFromSearch(search: string): Tab {
  return new URLSearchParams(search).get('tab') === 'bookmarks' ? 'bookmarks' : 'posts';
}

export function MyAislesView(props: {
  initialTab: Tab;
  ui: Record<string, string>;
  myPosts: MyPostRow[];
  bookmarkCards: FeedPostCardModel[];
}) {
  const { initialTab, ui, myPosts, bookmarkCards } = props;
  const [tab, setTab] = useState<Tab>(initialTab);

  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);

  useEffect(() => {
    const onPopState = () => {
      setTab(tabFromSearch(window.location.search));
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const setTabInstant = useCallback((next: Tab) => {
    setTab(next);
    const path = next === 'bookmarks' ? '/my-aisles?tab=bookmarks' : '/my-aisles';
    window.history.replaceState(window.history.state, '', path);
  }, []);

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
          onClick={() => setTabInstant('posts')}
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
          onClick={() => setTabInstant('bookmarks')}
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
        <MyPostsGrid posts={myPosts} />
      </div>
      <div
        id="tab-panel-bookmarks"
        role="tabpanel"
        aria-labelledby="tab-bookmarks"
        hidden={tab !== 'bookmarks'}
        className={styles.tabPanel}
      >
        <BookmarkedNewsList cards={bookmarkCards} ui={ui} />
      </div>
    </>
  );
}
