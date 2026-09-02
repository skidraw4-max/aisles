'use client';

import type { ReactNode } from 'react';
import { MemberAiExtrasLoginGate } from '@/components/post/MemberAiExtrasLoginGate';
import { usePostViewer } from './PostViewerContext';

type Props = {
  postId: string;
  /** DB에 저장된 역분석 — 비로그인도 읽기 허용(API 호출 없음) */
  publicCachedContent?: ReactNode;
  /** 로그인 후 — 캐시 없을 때 새 분석 포함 */
  loggedInContent: ReactNode;
};

/**
 * 갤러리 AI 역분석
 * - 캐시 있음: 비로그인도 결과 읽기
 * - 캐시 없음: 로그인 후 분석
 */
export function GalleryAiExtrasGate({
  postId,
  publicCachedContent,
  loggedInContent,
}: Props) {
  const { isLoggedIn, loaded } = usePostViewer();

  if (!loaded) {
    return null;
  }

  if (isLoggedIn) {
    return <>{loggedInContent}</>;
  }

  if (publicCachedContent) {
    return <>{publicCachedContent}</>;
  }

  return (
    <MemberAiExtrasLoginGate
      postId={postId}
      loginNextPath={`/post/${postId}`}
      headingId="gallery-reverse-heading"
      eyebrow="Image intelligence"
      title="AI 이미지 역분석"
      description="이 이미지의 AI 역분석은 로그인 후 이용할 수 있습니다. 다른 글의 저장된 분석 예시는 갤러리에서 볼 수 있어요."
      analyticsEvent="gallery_reverse_login_click"
    />
  );
}
