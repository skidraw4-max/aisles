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

/** 게시글 본문·사이드바·OG·홈(퀘이사) 캐시 무효화 — CLI/스크립트 등 Next 요청 밖에서는 no-op */
export function revalidatePostCaches(postId: string) {
  try {
    revalidateTag(`post-${postId}`);
    for (const tag of HOME_CACHE_TAGS) {
      revalidateTag(tag);
    }
    for (const path of homePathsToRevalidate(postId)) {
      revalidatePath(path);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('static generation store missing') || msg.includes('revalidate')) {
      console.warn('[revalidatePostCaches] skipped outside Next request', { postId, msg });
      return;
    }
    throw e;
  }
}
