'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useInView } from 'react-intersection-observer';
import { Image } from 'lucide-react';
import { MediaThumb } from '@/components/MediaThumb';
import {
  categoryToHomeQuery,
  isFeedBoardListCategory,
  shouldHideAuthorInFeedList,
} from '@/lib/post-categories';
import { formatAiFortuneWeekKeyLabel } from '@/lib/ai-fortune/kst-week';
import { fortuneSubtitleFromPost } from '@/lib/ai-fortune/latest-fortune.shared';
import { useCorridorLabel } from '@/components/UiLabelsProvider';
import { PostThumbnail } from '@/components/post/PostThumbnail';
import type { Category } from '@prisma/client';
import { ALL_CARD_FEED_INITIAL_COUNT } from '@/lib/home-all-card-feed';
import type { FeedPostJson } from '@/lib/home-feed';
import { tryCreateBrowserClient } from '@/lib/supabase/client';
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

function formatDateYYMMDD(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '--/--/--';
  const yy = String(d.getFullYear()).slice(-2);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yy}/${mm}/${dd}`;
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

function fortuneBoardMeta(post: FeedPostJson): string | null {
  if (post.category !== 'AI_FORTUNE') return null;
  if (post.aiFortuneWeekKey) return formatAiFortuneWeekKeyLabel(post.aiFortuneWeekKey);
  return fortuneSubtitleFromPost({
    title: post.title,
    createdAt: new Date(post.createdAt),
    aiFortuneWeekKey: post.aiFortuneWeekKey ?? null,
    aiFortunePayload: null,
  });
}

function FeedBoardRow({
  post,
  gossipReportStyle,
  showDateInMeta,
  hideAuthor,
  showFortuneWeek,
}: {
  post: FeedPostJson;
  gossipReportStyle: boolean;
  showDateInMeta: boolean;
  hideAuthor: boolean;
  showFortuneWeek?: boolean;
}) {
  const cc = commentCount(post);
  const hasMedia = Boolean(post.thumbnail?.trim());
  const weekMeta = showFortuneWeek ? fortuneBoardMeta(post) : null;

  return (
    <li className={styles.feedBoardRow}>
      <Link href={`/post/${post.id}`} prefetch={showDateInMeta} className={styles.feedBoardFreeLink}>
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
            {weekMeta ? (
              <span className={styles.feedBoardFortuneWeek} title={weekMeta}>
                {weekMeta}
              </span>
            ) : null}
            <span className={styles.feedBoardTitleStr}>{post.title}</span>
            <span className={styles.feedBoardCommentBadge} title={`댓글 ${cc}개`}>
              [{cc}]
            </span>
          </span>
        </span>
        <span className={styles.feedBoardFreeMeta}>
          {!hideAuthor &&
            (showDateInMeta ? (
              <span className={`${styles.feedBoardFreeAuthor} ${styles.feedBoardFreeDate}`} title={post.createdAt}>
                {formatDateYYMMDD(post.createdAt)}
              </span>
            ) : (
              <span className={styles.feedBoardFreeAuthor} title={post.author.username}>
                {post.author.username}
              </span>
            ))}
          <span className={styles.feedBoardFreeViews} title="조회수">
            {post.views.toLocaleString('ko-KR')}
          </span>
        </span>
      </Link>
    </li>
  );
}

function LoungeSubscribeNoticeBar() {
  const [ready, setReady] = useState(false);
  const [loggedIn, setLoggedIn] = useState(false);
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const supabase = tryCreateBrowserClient();
      if (!supabase) {
        if (!cancelled) {
          setLoggedIn(false);
          setSubscribed(false);
          setReady(true);
        }
        return;
      }
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) {
        if (!cancelled) {
          setLoggedIn(false);
          setSubscribed(false);
          setReady(true);
        }
        return;
      }
      try {
        const res = await fetch('/api/news-subscription', {
          cache: 'no-store',
          credentials: 'include',
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = (await res.json().catch(() => ({}))) as { subscribed?: boolean };
        if (!cancelled) {
          setLoggedIn(true);
          setSubscribed(Boolean(data.subscribed));
          setReady(true);
        }
      } catch {
        if (!cancelled) {
          setLoggedIn(true);
          setSubscribed(false);
          setReady(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const runPatch = async (next: boolean) => {
    setBanner(null);
    const supabase = tryCreateBrowserClient();
    if (!supabase) return;
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) {
      window.alert('회원가입후 구독이 가능합니다.');
      setLoggedIn(false);
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/news-subscription', {
        method: 'PATCH',
        cache: 'no-store',
        credentials: 'include',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ subscribed: next, digestFrequency: 'DAILY' }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; subscribed?: boolean };
      if (!res.ok) {
        setBanner(data.error ?? '구독 설정을 바꾸지 못했습니다.');
        return;
      }
      setSubscribed(Boolean(data.subscribed));
    } catch {
      setBanner('네트워크 오류로 저장하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  };

  const onClick = () => {
    setBanner(null);
    if (!loggedIn) {
      window.alert('회원가입후 구독이 가능합니다.');
      return;
    }
    void runPatch(!subscribed);
  };

  const label = subscribed ? '뉴스 구독 취소하기' : '뉴스 구독하기';

  return (
    <div className={styles.loungeSubscribeNoticeRow} role="note">
      <p className={styles.loungeSubscribeNoticeText}>
        회원가입 후 AI 트렌드 뉴스 구독을 켜면 새 글을 이메일 다이제스트로 받아볼 수 있어요.
      </p>
      <button
        type="button"
        className={styles.loungeSubscribeNoticeBtn}
        onClick={onClick}
        disabled={!ready || busy}
      >
        {label}
      </button>
      {banner ? (
        <p className={styles.loungeSubscribeNoticeBanner} role="status">
          {banner}
        </p>
      ) : null}
    </div>
  );
}

function FeedBoardTable({
  posts,
  gossipReportStyle,
  showDateInMeta,
  hideAuthor,
  showFortuneWeek,
}: {
  posts: FeedPostJson[];
  gossipReportStyle: boolean;
  showDateInMeta: boolean;
  hideAuthor: boolean;
  showFortuneWeek?: boolean;
}) {
  return (
    <>
      <div className={`${styles.feedBoardSurface} ${gossipReportStyle ? styles.feedBoardSurfaceGossip : ''}`}>
        <div className={styles.feedBoardScroll}>
          <div className={styles.feedBoardFreeHead} role="row">
            <span className={styles.feedBoardFreeHeadMain} role="columnheader">
              제목
            </span>
            <span className={styles.feedBoardFreeHeadMeta} role="presentation">
              {!hideAuthor ? (
                <span role="columnheader" className={showDateInMeta ? styles.feedBoardHeadDateLabel : undefined}>
                  {showDateInMeta ? '등록일' : '글쓴이'}
                </span>
              ) : null}
              <span role="columnheader">조회</span>
            </span>
          </div>
          <ul className={styles.feedBoardList} role="list">
            {posts.map((post) => (
              <FeedBoardRow
                key={post.id}
                post={post}
                gossipReportStyle={gossipReportStyle}
                showDateInMeta={showDateInMeta}
                hideAuthor={hideAuthor}
                showFortuneWeek={showFortuneWeek}
              />
            ))}
          </ul>
        </div>
      </div>
    </>
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
  const loungeDateMeta = category === 'LOUNGE';
  const hideAuthor = category !== null && shouldHideAuthorInFeedList(category);
  const fortuneArchive = category === 'AI_FORTUNE' && boardList;
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

  const showLoungeSubscribeBar = category === 'LOUNGE' && boardList;

  return (
    <>
      {showLoungeSubscribeBar ? <LoungeSubscribeNoticeBar /> : null}
      {posts.length === 0 ? (
        <p className={styles.emptySection}>
          아직 게시글이 없습니다. 첫 번째 주인공이 되어보세요!{' '}
          <Link href="/upload">업로드 페이지로 이동</Link>
        </p>
      ) : fortuneArchive ? (
        <>
          <h3 className={styles.fortuneArchiveHeading}>이번 주</h3>
          <FeedBoardTable
            posts={posts.slice(0, 1)}
            gossipReportStyle={gossipReportStyle}
            showDateInMeta={loungeDateMeta}
            hideAuthor={hideAuthor}
            showFortuneWeek
          />
          {posts.length > 1 ? (
            <>
              <h3 className={styles.fortuneArchiveHeadingPast}>지난 주차</h3>
              <FeedBoardTable
                posts={posts.slice(1)}
                gossipReportStyle={gossipReportStyle}
                showDateInMeta={loungeDateMeta}
                hideAuthor={hideAuthor}
                showFortuneWeek
              />
            </>
          ) : null}
        </>
      ) : boardList ? (
        <FeedBoardTable
          posts={posts}
          gossipReportStyle={gossipReportStyle}
          showDateInMeta={loungeDateMeta}
          hideAuthor={hideAuthor}
        />
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
