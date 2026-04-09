'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useInView } from 'react-intersection-observer';
import { MediaThumb } from '@/components/MediaThumb';
import { POST_CATEGORY_OPTIONS } from '@/lib/post-categories';
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

function FeedPostCard({
  post,
  featuredVisual,
}: {
  post: FeedPostJson;
  featuredVisual?: boolean;
}) {
  const wrapClass = featuredVisual
    ? `${styles.feedCardWrap} ${styles.feedCardWrapFeatured}`
    : styles.feedCardWrap;

  return (
    <div className={wrapClass}>
      {featuredVisual ? (
        <span className={styles.featuredRibbon} aria-label="Editor's Choice">
          Editor&apos;s Choice
        </span>
      ) : null}
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

type Props = {
  sort: HomeFeedSort;
  initialFeatured: FeedPostJson[];
  initialPosts: FeedPostJson[];
  initialHasMore: boolean;
};

export function HomeAllFeed({ sort, initialFeatured, initialPosts, initialHasMore }: Props) {
  const [posts, setPosts] = useState<FeedPostJson[]>(initialPosts);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [loading, setLoading] = useState(false);
  const [featured] = useState<FeedPostJson[]>(initialFeatured);
  const abortRef = useRef<AbortController | null>(null);

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
      const base = `/api/feed?sort=${nextSort}&skip=${skip}&limit=${PAGE_SIZE}`;
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
    [fetchJson]
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
      {featured.length > 0 ? (
        <section className={styles.featuredSection} aria-labelledby="editor-choice-heading">
          <div className={styles.featuredSectionHead}>
            <h2 id="editor-choice-heading" className={styles.featuredSectionTitle}>
              Editor&apos;s Choice
            </h2>
            <p className={styles.featuredSectionDesc}>
              에디터가 고른 하이라이트 글입니다. (조회·반응과 별도로 상단에 고정 노출됩니다.)
            </p>
          </div>
          <div className={styles.featuredStrip} role="list">
            {featured.map((post) => (
              <div key={post.id} className={styles.featuredStripItem} role="listitem">
                <FeedPostCard post={post} featuredVisual />
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {posts.length === 0 ? (
        <p className={styles.emptySection}>
          아직 게시글이 없습니다. 첫 번째 주인공이 되어보세요!{' '}
          <Link href="/upload">업로드 페이지로 이동</Link>
        </p>
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
