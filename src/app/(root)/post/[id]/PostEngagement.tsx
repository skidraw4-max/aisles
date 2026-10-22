'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { createClient } from '@/lib/supabase/client';
import { usePostLike } from './PostLikeContext';
import { usePostBookmark } from './PostBookmarkContext';
import { usePostViewerOptional } from './PostViewerContext';
import { PostSignupPromptModal } from './PostSignupPromptModalLoader';
import { copyTextToClipboard } from '@/lib/clipboard-copy';
import { buildKakaoShareUrl, buildXShareUrl } from '@/lib/share-social';
import { sendGAEvent } from '@/lib/ga4';
import { PostStanceStrip } from './PostStanceStrip';
import styles from './post.module.css';

const COMMENT_PROMPTS = [
  '가장 인상 깊었던 한 가지는?',
  '동의하거나 다른 점이 있다면?',
  '다음에 궁금한 점을 남겨 주세요',
] as const;

const SIGNUP_PROMPT_COUNT_KEY = 'aisle.signupPrompt.articleViews';
const SIGNUP_PROMPT_HIDE_UNTIL_KEY = 'aisle.signupPrompt.hideUntil';
const SIGNUP_PROMPT_COOLDOWN_DAYS = 7;
const SIGNUP_PROMPT_TRIGGER_COUNT = 3;

export type CommentDTO = {
  id: string;
  content: string;
  createdAt: string;
  authorId: string;
  authorUsername: string;
  authorAvatarUrl: string | null;
};

type Props = {
  postId: string;
  initialComments: CommentDTO[];
  currentUserId: string | null;
  /** 로그인 시 Prisma 프로필 닉네임(낙관적 댓글·표시용) */
  currentUsername: string | null;
  currentAvatarUrl: string | null;
  listHref: string;
  adjacentNav?: ReactNode;
  /** AI/시스템 글 등 — 동의·반박 스트립 표시 */
  showStance?: boolean;
  /** 홈 피처드 주간 토론 */
  isWeeklyDiscussion?: boolean;
};

function avatarInitials(username: string) {
  const t = username.trim();
  if (!t) return '?';
  const parts = t.split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase().slice(0, 2);
  return t.slice(0, 2).toUpperCase();
}

export function PostEngagement({
  postId,
  initialComments,
  currentUserId: currentUserIdProp,
  currentUsername: currentUsernameProp,
  currentAvatarUrl: currentAvatarUrlProp,
  listHref,
  adjacentNav,
  showStance = false,
  isWeeklyDiscussion = false,
}: Props) {
  const viewer = usePostViewerOptional();
  const currentUserId = viewer?.userId ?? currentUserIdProp;
  const currentUsername = viewer?.username ?? currentUsernameProp;
  const currentAvatarUrl = viewer?.avatarUrl ?? currentAvatarUrlProp;
  const { likeCount, liked, likePending, toggleLike, likeError } = usePostLike();
  const { bookmarked, bookmarkPending, bookmarkError, toggleBookmark } = usePostBookmark();
  const [comments, setComments] = useState(initialComments);
  const [body, setBody] = useState('');
  const [commentLoading, setCommentLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shareHint, setShareHint] = useState<'copied' | 'error' | null>(null);
  const [shareUrl, setShareUrl] = useState('');
  const [showSignupPrompt, setShowSignupPrompt] = useState(false);
  const [effectiveUserId, setEffectiveUserId] = useState<string | null>(currentUserId);
  const [promptIndex, setPromptIndex] = useState(0);

  useEffect(() => {
    setPromptIndex(Math.floor(Date.now() / 86_400_000) % COMMENT_PROMPTS.length);
  }, [postId]);

  useEffect(() => {
    setEffectiveUserId(currentUserId);
  }, [currentUserId]);

  useEffect(() => {
    void (async () => {
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const sid = session?.user?.id;
      if (sid) {
        setEffectiveUserId((prev) => prev ?? sid);
      }
    })();
  }, []);

  useEffect(() => {
    if (effectiveUserId) {
      setShowSignupPrompt(false);
      return;
    }
    try {
      const now = Date.now();
      const hideUntilRaw = window.localStorage.getItem(SIGNUP_PROMPT_HIDE_UNTIL_KEY);
      const hideUntil = hideUntilRaw ? Number(hideUntilRaw) : 0;
      if (Number.isFinite(hideUntil) && hideUntil > now) {
        return;
      }

      const prevCountRaw = window.localStorage.getItem(SIGNUP_PROMPT_COUNT_KEY);
      const prevCount = prevCountRaw ? Number(prevCountRaw) : 0;
      const nextCount = Number.isFinite(prevCount) ? prevCount + 1 : 1;
      window.localStorage.setItem(SIGNUP_PROMPT_COUNT_KEY, String(nextCount));

      if (nextCount >= SIGNUP_PROMPT_TRIGGER_COUNT) {
        setShowSignupPrompt(true);
      }
    } catch {
      // localStorage 접근 실패(시크릿 모드 등) 시 팝업 로직만 건너뜀
    }
  }, [effectiveUserId, postId]);

  async function getToken() {
    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    return session?.access_token ?? null;
  }

  const scrollToComments = useCallback(() => {
    document.getElementById('post-comments')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  async function handleShare() {
    setShareHint(null);
    const url = typeof window !== 'undefined' ? window.location.href : '';
    try {
      if (navigator.share) {
        await navigator.share({ title: document.title, url });
        sendGAEvent('share_click', { post_id: postId, method: 'web_share' });
        return;
      }
      await copyTextToClipboard(url);
      sendGAEvent('share_click', { post_id: postId, method: 'clipboard' });
      setShareUrl(url);
      setShareHint('copied');
      window.setTimeout(() => setShareHint(null), 6000);
    } catch {
      setShareHint('error');
      window.setTimeout(() => setShareHint(null), 2200);
    }
  }

  function closeSignupPrompt() {
    setShowSignupPrompt(false);
    try {
      const hideUntil = Date.now() + SIGNUP_PROMPT_COOLDOWN_DAYS * 24 * 60 * 60 * 1000;
      window.localStorage.setItem(SIGNUP_PROMPT_HIDE_UNTIL_KEY, String(hideUntil));
      window.localStorage.setItem(SIGNUP_PROMPT_COUNT_KEY, '0');
    } catch {
      // noop
    }
  }

  async function handleComment(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const token = await getToken();
    if (!token) {
      setError('로그인 후 댓글을 작성할 수 있습니다.');
      return;
    }
    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const uid = session?.user?.id;
    if (!uid) {
      setError('로그인 후 댓글을 작성할 수 있습니다.');
      return;
    }

    const trimmed = body.trim();
    if (!trimmed) return;

    const optimisticId = `optimistic:${crypto.randomUUID()}`;
    const nick = currentUsername?.trim() || '나';
    const optimistic: CommentDTO = {
      id: optimisticId,
      content: trimmed,
      createdAt: new Date().toISOString(),
      authorId: uid,
      authorUsername: nick,
      authorAvatarUrl: currentAvatarUrl,
    };

    setComments((prev) => [...prev, optimistic]);
    setBody('');
    setCommentLoading(true);

    try {
      const res = await fetch(`/api/posts/${postId}/comments`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ content: trimmed }),
      });
      const data = (await res.json()) as { error?: string; comment?: CommentDTO };
      if (!res.ok) throw new Error(data.error || '요청에 실패했습니다.');
      if (data.comment) {
        setComments((prev) => {
          const rest = prev.filter((c) => c.id !== optimisticId);
          return [...rest, data.comment!];
        });
        sendGAEvent('comment_submit', { post_id: postId });
      } else {
        setComments((prev) => prev.filter((c) => c.id !== optimisticId));
        setBody(trimmed);
        throw new Error('서버 응답에 댓글이 없습니다.');
      }
    } catch (e) {
      setComments((prev) => prev.filter((c) => c.id !== optimisticId));
      setBody(trimmed);
      setError(e instanceof Error ? e.message : '댓글 저장에 실패했습니다.');
    } finally {
      setCommentLoading(false);
    }
  }

  async function handleDeleteComment(commentId: string) {
    if (commentId.startsWith('optimistic:')) return;
    setError(null);
    const token = await getToken();
    if (!token) return;
    const res = await fetch(`/api/posts/${postId}/comments/${commentId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) {
      setError(data.error || '삭제에 실패했습니다.');
      return;
    }
    setComments((prev) => prev.filter((c) => c.id !== commentId));
  }

  function formatCommentDate(iso: string) {
    return new Date(iso).toLocaleString('ko-KR', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  return (
    <div className={styles.engagementMagazine}>
      <div className={styles.floatingBar} role="toolbar" aria-label="게시글 상호작용">
        <button
          type="button"
          className={liked ? styles.floatingLikeActive : styles.floatingLike}
          onClick={() => void toggleLike()}
          disabled={likePending}
          aria-pressed={liked}
          aria-busy={likePending}
        >
          <span className={styles.floatingLikeIcon} aria-hidden>
            {liked ? '♥' : '♡'}
          </span>
          <span className={styles.floatingLikeLabel}>추천</span>
          <span className={styles.floatingCount}>{likeCount.toLocaleString('ko-KR')}</span>
        </button>

        <button type="button" className={styles.floatingGhost} onClick={scrollToComments}>
          <span className={styles.floatingIconBtn} aria-hidden>
            💬
          </span>
          댓글 <span className={styles.floatingCountMuted}>{comments.length}</span>
        </button>

        <button type="button" className={styles.floatingIconOnly} onClick={() => void handleShare()} aria-label="공유">
          <span aria-hidden>↗</span>
        </button>

        <button
          type="button"
          className={bookmarked ? styles.floatingIconOnlyActive : styles.floatingIconOnly}
          onClick={() => void toggleBookmark()}
          disabled={bookmarkPending}
          aria-busy={bookmarkPending}
          aria-pressed={bookmarked}
          aria-label={bookmarked ? '북마크 해제' : '북마크'}
        >
          <span aria-hidden>{bookmarked ? '★' : '☆'}</span>
        </button>

        <Link href={listHref} className={styles.floatingListBtn}>
          목록으로
        </Link>
      </div>

      {shareHint === 'copied' && shareUrl ? (
        <p className={styles.shareHint} role="status">
          링크 복사됨 ·{' '}
          <a
            href={buildXShareUrl(shareUrl, typeof document !== 'undefined' ? document.title : 'AIsle')}
            target="_blank"
            rel="noopener noreferrer"
            className={styles.shareHintLink}
          >
            X에 공유
          </a>
          {' · '}
          <a
            href={buildKakaoShareUrl(shareUrl)}
            target="_blank"
            rel="noopener noreferrer"
            className={styles.shareHintLink}
          >
            카카오 공유
          </a>
        </p>
      ) : shareHint === 'error' ? (
        <p className={styles.shareHint} role="status">
          공유를 완료할 수 없습니다.
        </p>
      ) : null}

      {error || likeError || bookmarkError ? (
        <p className={styles.engagementErr} role="alert">
          {error || likeError || bookmarkError}
        </p>
      ) : null}

      {showSignupPrompt ? (
        <PostSignupPromptModal postId={postId} onClose={closeSignupPrompt} />
      ) : null}

      {adjacentNav}

      {isWeeklyDiscussion ? (
        <p className={styles.weeklyDiscussionBadge} role="status">
          이번 주 토론
        </p>
      ) : null}

      {showStance ? (
        <PostStanceStrip
          postId={postId}
          onPrefillComment={(text) => {
            setBody((prev) => (prev.trim() ? prev : text));
          }}
        />
      ) : null}

      <section className={styles.commentsMagazine} id="post-comments" aria-labelledby="comments-heading">
        <h2 id="comments-heading" className={styles.commentsMagazineTitle}>
          댓글 <span className={styles.commentsMagazineCount}>{comments.length}</span>
        </h2>

        {comments.length === 0 ? (
          <p className={styles.commentsEmptyMagazine}>
            {effectiveUserId
              ? '아직 댓글이 없습니다. 아래 프롬프트로 첫 의견을 남겨 보세요.'
              : '아직 댓글이 없습니다. 로그인하면 바로 의견을 남길 수 있습니다.'}
          </p>
        ) : (
          <ul className={styles.commentListMagazine}>
            {comments.map((c) => (
              <li key={c.id} className={styles.commentItemMagazine}>
                <div className={styles.commentAvatarWrap}>
                  {c.authorAvatarUrl ? (
                    <Image
                      src={c.authorAvatarUrl}
                      alt=""
                      width={36}
                      height={36}
                      className={styles.commentAvatarImg}
                    />
                  ) : (
                    <span className={styles.commentAvatarFallback}>{avatarInitials(c.authorUsername)}</span>
                  )}
                </div>
                <div className={styles.commentItemBody}>
                  <div className={styles.commentHeadMagazine}>
                    <span className={styles.commentAuthorMagazine}>{c.authorUsername}</span>
                    <time className={styles.commentDateMagazine} dateTime={c.createdAt}>
                      {formatCommentDate(c.createdAt)}
                    </time>
                    {effectiveUserId === c.authorId && !c.id.startsWith('optimistic:') ? (
                      <button
                        type="button"
                        className={styles.commentDeleteMagazine}
                        onClick={() => void handleDeleteComment(c.id)}
                      >
                        삭제
                      </button>
                    ) : null}
                  </div>
                  <p className={styles.commentBodyMagazine}>{c.content}</p>
                </div>
              </li>
            ))}
          </ul>
        )}

        <form className={styles.commentFormMagazine} onSubmit={handleComment}>
          <label className={styles.commentLabelMagazine} htmlFor="comment-input">
            댓글 작성
          </label>
          <div className={styles.commentPromptChips} role="group" aria-label="댓글 프롬프트">
            {COMMENT_PROMPTS.map((p, i) => (
              <button
                key={p}
                type="button"
                className={
                  i === promptIndex ? styles.commentPromptChipActive : styles.commentPromptChip
                }
                disabled={!effectiveUserId || commentLoading}
                onClick={() => {
                  setPromptIndex(i);
                  setBody((prev) => (prev.trim() ? prev : `${p} `));
                }}
              >
                {p}
              </button>
            ))}
          </div>
          <div className={styles.commentFormRow}>
            <textarea
              id="comment-input"
              className={styles.commentTextareaMagazine}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              maxLength={2000}
              rows={3}
              placeholder={
                effectiveUserId
                  ? COMMENT_PROMPTS[promptIndex]
                  : '로그인 후 댓글을 작성할 수 있습니다'
              }
              disabled={!effectiveUserId || commentLoading}
            />
            <button
              type="submit"
              className={styles.commentSubmitMagazine}
              disabled={!effectiveUserId || commentLoading}
            >
              {commentLoading ? '등록 중…' : '등록'}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
