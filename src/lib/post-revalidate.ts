import { revalidatePath, revalidateTag } from 'next/cache';

/** Tags cleared when a post is created/updated/deleted — home AI Work + feed. */
export const HOME_CACHE_TAGS = [
  'post-sidebar',
  'ai-fortune-latest',
  'home-page',
  'home-quasar',
] as const;

export function homePathsToRevalidate(postId: string): string[] {
  return ['/', `/post/${postId}`];
}

/** 게시글 본문·사이드바·OG·홈(퀘이사) 캐시 무효화 */
export function revalidatePostCaches(postId: string) {
  revalidateTag(`post-${postId}`);
  for (const tag of HOME_CACHE_TAGS) {
    revalidateTag(tag);
  }
  for (const path of homePathsToRevalidate(postId)) {
    revalidatePath(path);
  }
}
