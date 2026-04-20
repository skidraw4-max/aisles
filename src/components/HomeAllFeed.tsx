'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useInView } from 'react-intersection-observer';
import { Image } from 'lucide-react';
import { MediaThumb } from '@/components/MediaThumb';
import { categoryToHomeQuery, isFeedBoardListCategory } from '@/lib/post-categories';
import { useCorridorLabel } from '@/components/UiLabelsProvider';
import { PostThumbnail } from '@/components/post/PostThumbnail';
import type { Category } from '@prisma/client';
import { ALL_CARD_FEED_INITIAL_COUNT } from '@/lib/home-all-card-feed';
import type { FeedPostJson } from '@/lib/home-feed';
import styles from '@/app/(root)/page.module.css';

const PAGE_SIZE = 12;

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
  return post.commentCount ?? 0;
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

function FeedPostCard({ post, imagePriority }: { post: FeedPostJson; imagePriority?: boolean }) {
  const badge = useCorridorLabel(post.category);
  return (
    <div className={styles.feedCardWrap}>
      <Link href={`/post/${post.id}`} className={styles.feedCard}>
        <div className={styles.feedCardMedia}>
          <PostThumbnail
            thumbnail={post.thumbnail}
            category={post.category}
            alt=""
            layout="card"
            metadataParams={post.metadata?.params}
            priority={imagePriority}
            sizes="(max-width: 479px) 100vw, (max-width: 959px) 50vw, 25vw"
          />
          <span className={styles.feedCardBadge}>{badge}</span>
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

function FeedBoardRow({ post, gossipReportStyle }: { post: FeedPostJson; gossipReportStyle: boolean }) {
  const cc = commentCount(post);
  const hasMedia = Boolean(post.thumbnail?.trim());

  return (
    <li className={styles.feedBoardRow}>
      <Link href={`/post/${post.id}`} className={styles.feedBoardFreeLink}>
        <span className={styles.feedBoardFreeMain}>
          {gossipReportStyle ? (
            <span className={styles.feedBoardGossipThumb} aria-hidden>
              {hasMedia ? (
                <MediaThumb url={post.thumbnail!} alt="" objectFit="cover" />
              ) : (
                <span className={styles.feedBoardGossipThumbFallback} />
              )}
            </span>
          ) : hasMedia ? (
            <span className={styles.feedBoardMediaIconWrap} title="이미지·동영상 첨부">
              <Image className={styles.feedBoardMediaIcon} size={15} strokeWidth={2.25} aria-hidden />
            </span>
          ) : (
            <span className={styles.feedBoardMediaIconSpacer} aria-hidden />
          )}
          <span className={styles.feedBoardFreeTitleLine}>
            <span className={styles.feedBoardTitleStr}>{post.title}</span>
            <span className={styles.feedBoardCommentBadge} title={`댓글 ${cc}개`}>
              [{cc}]
            </span>
          </span>
        </span>
        <span className={styles.feedBoardFreeMeta}>
          <span className={styles.feedBoardFreeAuthor} title={post.author.username}>
            {post.author.username}
          </span>
          <span className={styles.feedBoardFreeViews} title="조회수">
            {post.views.toLocaleString('ko-KR')}
          </span>
        </span>
      </Link>
    </li>
  );
}

function FeedBoardTable({ posts, gossipReportStyle }: { posts: FeedPostJson[]; gossipReportStyle: boolean }) {
  return (
    <div className={`${styles.feedBoardSurface} ${gossipReportStyle ? styles.feedBoardSurfaceGossip : ''}`}>
      <div className={styles.feedBoardScroll}>
        <div className={styles.feedBoardFreeHead} role="row">
          <span className={styles.feedBoardFreeHeadMain} role="columnheader">
            제목
          </span>
          <span className={styles.feedBoardFreeHeadMeta} role="presentation">
            <span role="columnheader">글쓴이</span>
            <span role="columnheader">조회</span>
          </span>
        </div>
        <ul className={styles.feedBoardList} role="list">
          {posts.map((post) => (
            <FeedBoardRow key={post.id} post={post} gossipReportStyle={gossipReportStyle} />
          ))}
        </ul>
      </div>
    </div>
  );
}

type Props = {
  category: Category | null;
  excludeIds: string[];
  initialPosts: FeedPostJson[];
  initialHasMore: boolean;
};

export function HomeAllFeed({ category, excludeIds, initialPosts, initialHasMore }: Props) {
  const [posts, setPosts] = useState<FeedPostJson[]>(initialPosts);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const wasLoadingRef = useRef(false);
  const excludeQs =
    excludeIds.length > 0 ? `&exclude=${excludeIds.map(encodeURIComponent).join('%2C')}` : '';
  const catQs = category
    ? `&category=${encodeURIComponent(categoryToHomeQuery(category))}`
    : '';
  const excludeCommunityQs = category === null ? '&excludeCommunity=1' : '';

  const boardList = isFeedBoardListCategory(category);
  const gossipReportStyle = category === 'GOSSIP';
  const allCardFeed = category === null && !boardList;

  const [visibleCount, setVisibleCount] = useState(() =>
    Math.min(ALL_CARD_FEED_INITIAL_COUNT, initialPosts.length)
  );

  const fetchJson = useCallback(
    async (url: string, signal: AbortSignal) => {
      const res = await fetch(url, { signal, cache: 'no-store' });
      if (!res.ok) throw new Error('feed failed');
      return res.json() as Promise<{ posts: FeedPostJson[]; hasMore?: boolean }>;
    },
    []
  );

  const loadPage = useCallback(
    async (skip: number, replace: boolean) => {
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      const base = `/api/feed?skip=${skip}&limit=${PAGE_SIZE}${catQs}${excludeQs}${excludeCommunityQs}`;
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
    [fetchJson, excludeQs, catQs, excludeCommunityQs]
  );

  useEffect(() => {
    if (!allCardFeed || !wasLoadingRef.current || loading) {
      wasLoadingRef.current = loading;
      return;
    }
    wasLoadingRef.current = loading;
    setVisibleCount(posts.length);
  }, [allCardFeed, loading, posts.length]);

  const { ref: sentinelRef, inView } = useInView({
    rootMargin: '240px 0px',
    threshold: 0,
  });

  useEffect(() => {
    if (category === null) return;
    if (!inView || !hasMore || loading) return;
    setLoading(true);
    void loadPage(posts.length, false);
  }, [inView, hasMore, loading, posts.length, loadPage, category]);

  const handleAllCardLoadMore = useCallback(() => {
    if (!allCardFeed) return;
    if (visibleCount < posts.length) {
      setVisibleCount(posts.length);
      return;
    }
    if (!hasMore || loading) return;
    setLoading(true);
    void loadPage(posts.length, false);
  }, [allCardFeed, visibleCount, posts.length, hasMore, loading, loadPage]);

  const cardGridPosts = allCardFeed ? posts.slice(0, visibleCount) : posts;
  const showAllCardMoreBtn =
    allCardFeed &&
    posts.length > 0 &&
    (visibleCount < posts.length || hasMore);

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
          {cardGridPosts.map((post, i) => (
            <li key={post.id}>
              <FeedPostCard post={post} imagePriority={i < 4} />
            </li>
          ))}
        </ul>
      )}

      {showAllCardMoreBtn ? (
        <div className={styles.allFeedMoreWrap}>
          <button
            type="button"
            className={styles.allFeedMoreBtn}
            onClick={handleAllCardLoadMore}
            disabled={loading}
          >
            +더보기
          </button>
        </div>
      ) : null}

      {category !== null ? (
        <div ref={sentinelRef} className={styles.feedSentinel} aria-hidden />
      ) : null}

      {loading && posts.length > 0 ? (
        <p className={styles.feedLoadingMore} role="status">
          더 불러오는 중…
        </p>
      ) : null}

      {!hasMore && posts.length > 0 && (!allCardFeed || visibleCount >= posts.length) ? (
        <p className={styles.feedEndNote} role="status">
          모든 글을 불러왔습니다.
        </p>
      ) : null}
    </>
  );
}
