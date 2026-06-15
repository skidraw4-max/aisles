'use client';

import { PostAiAnalysis, type PostAiAnalysisProps } from '@/components/post/PostAiAnalysis';
import { usePostViewer } from './PostViewerContext';

type Props = Omit<PostAiAnalysisProps, 'isLoggedIn' | 'initialCachedAnalysis'> & {
  /** 로그인·해시 일치 시 서버에서 계산한 캐시 분석(비로그인 ISR 셸에서는 null) */
  serverCachedAnalysis: PostAiAnalysisProps['initialCachedAnalysis'];
};

/** ISR 셸 — 로그인 여부·캐시 분석은 클라이언트 viewer-state 반영 */
export function PostAiAnalysisWithViewer({ serverCachedAnalysis, ...props }: Props) {
  const { isLoggedIn } = usePostViewer();
  return (
    <PostAiAnalysis
      {...props}
      isLoggedIn={isLoggedIn}
      initialCachedAnalysis={isLoggedIn ? serverCachedAnalysis : null}
    />
  );
}
