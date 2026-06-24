'use client';

import Link from 'next/link';
import type { ComponentProps } from 'react';
import { sendGAEvent } from '@/lib/ga4';

type Props = ComponentProps<typeof Link> & {
  postId: string;
  category: string;
  surface: string;
};

/** 피드·목록 게시글 링크 — 클릭 시 `feed_post_click` 전송 */
export function FeedPostLink({ postId, category, surface, onClick, ...props }: Props) {
  return (
    <Link
      {...props}
      onClick={(e) => {
        sendGAEvent('feed_post_click', { post_id: postId, category, surface });
        onClick?.(e);
      }}
    />
  );
}
