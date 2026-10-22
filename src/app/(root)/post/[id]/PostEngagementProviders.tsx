'use client';

import type { ReactNode } from 'react';
import { usePostViewer } from './PostViewerContext';
import { PostLikeProvider } from './PostLikeContext';
import { PostBookmarkProvider } from './PostBookmarkContext';

type Props = {
  postId: string;
  initialLikeCount: number;
  children: ReactNode;
};

/** viewer-state API 결과를 좋아요·북마크 Provider에 연결 */
export function PostEngagementProviders({ postId, initialLikeCount, children }: Props) {
  const { liked, bookmarked } = usePostViewer();
  return (
    <PostLikeProvider postId={postId} initialLikeCount={initialLikeCount} initialLiked={liked}>
      <PostBookmarkProvider postId={postId} initialBookmarked={bookmarked}>
        {children}
      </PostBookmarkProvider>
    </PostLikeProvider>
  );
}
