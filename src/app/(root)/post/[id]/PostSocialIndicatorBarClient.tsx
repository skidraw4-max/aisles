'use client';

import { useEffect, useState } from 'react';
import { usePostViewer } from './PostViewerContext';
import { PostSocialIndicatorBar } from './PostSocialIndicatorBar';

type Props = {
  /** ISR 캐시된 조회수(증분 전) */
  cachedViews: number;
  commentCount: number;
};

/** 조회수는 캐시값 표시 후 클라이언트에서 +1 반영(실제 증분은 서버 after 훅) */
export function PostSocialIndicatorBarClient({ cachedViews, commentCount }: Props) {
  const { loaded } = usePostViewer();
  const [views, setViews] = useState(cachedViews);

  useEffect(() => {
    setViews(cachedViews);
  }, [cachedViews]);

  useEffect(() => {
    if (loaded) {
      setViews((v) => Math.max(v, cachedViews + 1));
    }
  }, [loaded, cachedViews]);

  return <PostSocialIndicatorBar views={views} commentCount={commentCount} />;
}
