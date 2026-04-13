'use client';

import { Eye, MessageCircle, Heart } from 'lucide-react';
import { usePostLike } from './PostLikeContext';

type Props = {
  views: number;
  commentCount: number;
};

export function PostSocialIndicatorBar({ views, commentCount }: Props) {
  const { likeCount, liked, likePending, toggleLike } = usePostLike();

  function scrollToComments() {
    document.getElementById('post-comments')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  return (
    <div
      className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-gray-500"
      role="group"
      aria-label="게시글 통계"
    >
      <span className="inline-flex items-center gap-1.5" title="조회수">
        <Eye className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
        <span className="tabular-nums">{views.toLocaleString('ko-KR')}</span>
      </span>

      <button
        type="button"
        className="inline-flex items-center gap-1.5 hover:text-gray-400"
        onClick={scrollToComments}
        title="댓글로 이동"
      >
        <MessageCircle className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
        <span className="tabular-nums">{commentCount.toLocaleString('ko-KR')}</span>
      </button>

      <button
        type="button"
        className="inline-flex items-center gap-1.5 hover:text-gray-400 disabled:opacity-60"
        onClick={() => void toggleLike()}
        disabled={likePending}
        aria-pressed={liked}
        aria-busy={likePending}
        title="좋아요"
      >
        <Heart
          className={`h-4 w-4 shrink-0 transition-colors ${liked ? 'fill-red-500 text-red-500' : ''}`}
          strokeWidth={2}
          aria-hidden
        />
        <span className={`tabular-nums ${liked ? 'text-red-500' : ''}`}>
          {likeCount.toLocaleString('ko-KR')}
        </span>
      </button>
    </div>
  );
}
