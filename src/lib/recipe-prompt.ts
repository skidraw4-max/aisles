import type { AiMetadata } from '@prisma/client';

/** Lab 게시글에서 표시·복사에 쓰는 프롬프트: metadata.prompt 우선, 없으면 본문 content */
export function resolveRecipePrompt(post: {
  content: string | null;
  metadata: Pick<AiMetadata, 'prompt'> | null;
}): string {
  const fromMeta = post.metadata?.prompt?.trim();
  if (fromMeta) return fromMeta;
  return post.content?.trim() ?? '';
}
