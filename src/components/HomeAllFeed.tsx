'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useInView } from 'react-intersection-observer';
import { Image } from 'lucide-react';
import { MediaThumb } from '@/components/MediaThumb';
import {
  categoryToHomeQuery,
  isFeedBoardListCategory,
  POST_CATEGORY_OPTIONS,
} from '@/lib/post-categories';
import type { Category } from '@prisma/client';
import type { HomeFeedSort } from '@/lib/feed-sort';
import type { FeedPostJson } from '@/lib/home-feed';
import styles from '@/app/page.module.css';

const PAGE_SIZE = 12;

function categoryUiLabel(c: Category) {
  return POST_CATEGORY_OPTIONS.find((o) => o.value === c)?.label ?? c;
}

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString('ko-KR', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return iso;
  }
}

function commentCount(post: FeedPostJson): number {
  return post._count?.comments ?? 0;
}

function CardFooter({ username, likeCount }: { username: string; likeCount: number }) {
  return (
    <div className={styles.cardFooter}>
      <span className={styles.cardAuthor}>{username}</span>
      <span className={styles.likeStamp} title="좋아요">
        <span className={styles.heartIcon} aria-hidden>
          ♡
        </span>
        <span className={styles.likeNum}>{likeCount}</span>
      </span>
    </div>
  );
}

function FeedPostCard({ post }: { post: FeedPostJson }) {
  return (
    <div className={styles.feedCardWrap}>
      <Link href={`/post/${post.id}`} className={styles.feedCard}>
        <div className={styles.feedCardMedia}>
          {post.thumbnail ? (
            <MediaThumb url={post.thumbnail} alt="" objectFit="cover" />
          ) : (
            <div className={styles.feedCardPlaceholder} aria-hidden />
          )}
          <span className={styles.feedCardBadge}>{categoryUiLabel(post.category)}</span>
        </div>
        <div className={styles.feedCardBody}>
          <h3 className={styles.feedCardTitle}>{post.title}</h3>
          {post.content ? (
            <p className={styles.feedCardSnippet}>
              {post.content.length > 120 ? `${post.content.slice(0, 120)}…` : post.content}
            </p>
          ) : null}
          <p className={styles.feedCardDate}>{formatDate(post.createdAt)}</p>
          <CardFooter username={post.author.username} likeCount={post.likeCount} />
        </div>
      </Link>
    </div>
  );
}

function FeedBoardRow({ post, index, gossipReportStyle }: { post: FeedPostJson; index: number; gossipReportStyle: boolean }) {
  const cc = commentCount(post);
  const hasMedia = Boolean(post.thumbnail?.trim());

  return (
    <li className={styles.feedBoardRow}>
      <Link href={`/post/${post.id}`} className={styles.feedBoardRowLink}>
        <span className={styles.feedBoardCellNum}>{index + 1}</span>
        <span className={styles.feedBoardCellTitle}>
          {gossipReportStyle ? (
            <span className={styles.feedBoardTitleCluster}>
              <span className={styles.feedBoardGossipThumb} aria-hidden>
                {hasMedia ? (
                  <MediaThumb url={post.thumbnail!} alt="" objectFit="cover" />
                ) : (
                  <span className={styles.feedBoardGossipThumbFallback} />
                )}
              </span>
              <span className={styles.feedBoardTitleLine}>
                <span className={styles.feedBoardTitleStr}>{post.title}</span>
                {cc > 0 ? (
                  <span className={styles.feedBoardCommentBadge} title={`댓글 ${cc}개`}>
                    [{cc}]
                  </span>
                ) : null}
              </span>
            </span>
          ) : (
            <span className={styles.feedBoardTitleCluster}>
              {hasMedia ? (
                <span className={styles.feedBoardMediaIconWrap} title="이미지·동영상 첨부">
                  <Image className={styles.feedBoardMediaIcon} size={15} strokeWidth={2.25} aria-hidden />
                </span>
              ) : (
                <span className={styles.feedBoardMediaIconSpacer} aria-hidden />
              )}
              <span className={styles.feedBoardTitleLine}>
                <span className={styles.feedBoardTitleStr}>{post.title}</span>
                {cc > 0 ? (
                  <span className={styles.feedBoardCommentBadge} title={`댓글 ${cc}개`}>
                    [{cc}]
                  </span>
                ) : null}
              </span>
            </span>
          )}
        </span>
        <span className={styles.feedBoardCellAuthor} title={post.author.username}>
          {post.author.username}
        </span>
        <span className={styles.feedBoardCellDate}>{formatDate(post.createdAt)}</span>
        <span className={styles.feedBoardCellViews} title="조회수">
          {post.viewCount.toLocaleString('ko-KR')}
        </span>
        <span className={styles.feedBoardCellLikes} title="추천(좋아요)">
          {post.likeCount.toLocaleString('ko-KR')}
        </span>
      </Link>
    </li>
  );
}

function FeedBoardTable({ posts, gossipReportStyle }: { posts: FeedPostJson[]; gossipReportStyle: boolean }) {
  return (
    <div className={`${styles.feedBoardSurface} ${gossipReportStyle ? styles.feedBoardSurfaceGossip : ''}`}>
      <div className={styles.feedBoardScroll}>
        <div className={styles.feedBoardHead} role="row">
          <span role="columnheader">번호</span>
          <span role="columnheader">제목</span>
          <span role="columnheader">글쓴이</span>
          <span role="columnheader">날짜</span>
          <span role="columnheader">조회</span>
          <span role="columnheader">추천</span>
        </div>
        <ul className={styles.feedBoardList} role="list">
          {posts.map((post, i) => (
            <FeedBoardRow key={post.id} post={post} index={i} gossipReportStyle={gossipReportStyle} />
          ))}
        </ul>
      </div>
    </div>
  );
}

type Props = {
  sort: HomeFeedSort;
  category: Category | null;
  excludeIds: string[];
  initialPosts: FeedPostJson[];
  initialHasMore: boolean;
};

export function HomeAllFeed({ sort, category, excludeIds, initialPosts, initialHasMore }: Props) {
  const [posts, setPosts] = useState<FeedPostJson[]>(initialPosts);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const excludeQs =
    excludeIds.length > 0 ? `&exclude=${excludeIds.map(encodeURIComponent).join('%2C')}` : '';
  const catQs = category
    ? `&category=${encodeURIComponent(categoryToHomeQuery(category))}`
    : '';

  const boardList = isFeedBoardListCategory(category);
  const gossipReportStyle = category === 'GOSSIP';

  const fetchJson = useCallback(
    async (url: string, signal: AbortSignal) => {
      const res = await fetch(url, { signal });
      if (!res.ok) throw new Error('feed failed');
      return res.json() as Promise<{ posts: FeedPostJson[]; hasMore?: boolean }>;
    },
    []
  );

  const loadPage = useCallback(
    async (nextSort: HomeFeedSort, skip: number, replace: boolean) => {
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      const base = `/api/feed?sort=${nextSort}&skip=${skip}&limit=${PAGE_SIZE}${catQs}${excludeQs}`;
      try {
        const data = await fetchJson(base, ac.signal);
        if (replace) {
          setPosts(data.posts);
        } else {
          setPosts((prev) => {
            const seen = new Set(prev.map((p) => p.id));
            const merged = [...prev];
            for (const p of data.posts) {
              if (!seen.has(p.id)) {
                seen.add(p.id);
                merged.push(p);
              }
            }
            return merged;
          });
        }
        setHasMore(Boolean(data.hasMore));
      } catch (e) {
        if (e instanceof Error && e.name === 'AbortError') return;
      } finally {
        if (!ac.signal.aborted) {
          setLoading(false);
        }
      }
    },
    [fetchJson, excludeQs, catQs]
  );

  const { ref: sentinelRef, inView } = useInView({
    rootMargin: '240px 0px',
    threshold: 0,
  });

  useEffect(() => {
    if (!inView || !hasMore || loading) return;
    setLoading(true);
    void loadPage(sort, posts.length, false);
  }, [inView, hasMore, loading, sort, posts.length, loadPage]);

  return (
    <>
      {posts.length === 0 ? (
        <p className={styles.emptySection}>
          아직 게시글이 없습니다. 첫 번째 주인공이 되어보세요!{' '}
          <Link href="/upload">업로드 페이지로 이동</Link>
        </p>
      ) : boardList ? (
        <FeedBoardTable posts={posts} gossipReportStyle={gossipReportStyle} />
      ) : (
        <ul className={styles.allFeed}>
          {posts.map((post) => (
            <li key={post.id}>
              <FeedPostCard post={post} />
            </li>
          ))}
        </ul>
      )}

      <div ref={sentinelRef} className={styles.feedSentinel} aria-hidden />

      {loading && posts.length > 0 ? (
        <p className={styles.feedLoadingMore} role="status">
          더 불러오는 중…
        </p>
      ) : null}

      {!hasMore && posts.length > 0 ? (
        <p className={styles.feedEndNote} role="status">
          모든 글을 불러왔습니다.
        </p>
      ) : null}
    </>
  );
}
