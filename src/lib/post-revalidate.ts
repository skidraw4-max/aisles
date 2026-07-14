import { revalidatePath, revalidateTag } from 'next/cache';

/** 게시글 본문·사이드바·OG 캐시 무효화 */
export function revalidatePostCaches(postId: string) {
  revalidateTag(`post-${postId}`);
  revalidateTag('post-sidebar');
  revalidateTag('ai-fortune-latest');
  revalidatePath(`/post/${postId}`);
}
