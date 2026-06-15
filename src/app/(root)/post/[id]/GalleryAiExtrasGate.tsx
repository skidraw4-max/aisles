'use client';

import type { ReactNode } from 'react';
import { MemberAiExtrasLoginGate } from '@/components/post/MemberAiExtrasLoginGate';
import { usePostViewer } from './PostViewerContext';

type Props = {
  postId: string;
  loggedInContent: ReactNode;
};

/** 갤러리 AI 역분석 — 로그인은 클라이언트 viewer-state */
export function GalleryAiExtrasGate({ postId, loggedInContent }: Props) {
  const { isLoggedIn, loaded } = usePostViewer();
  if (!loaded || !isLoggedIn) {
    return (
      <MemberAiExtrasLoginGate
        loginNextPath={`/post/${postId}`}
        headingId="gallery-reverse-heading"
        eyebrow="Image intelligence"
        title="AI 이미지 역분석"
        description="AI 이미지 역분석·추정 프롬프트·키워드 패널은 로그인한 회원만 볼 수 있습니다. 본문 설명은 그대로 읽을 수 있어요."
      />
    );
  }
  return <>{loggedInContent}</>;
}
