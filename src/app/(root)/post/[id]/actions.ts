'use server';

import { recordPostView } from '@/lib/community-metrics/record-post-view';

/** 게시글 상세 접속 시 조회수 +1 (+ PostViewDaily 버킷) */
export async function incrementPostViews(postId: string): Promise<number | null> {
  return recordPostView(postId);
}
