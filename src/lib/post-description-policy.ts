import type { Category } from '@prisma/client';

/** LOUNGE 제외 복도 — 설명 최소 길이 (애드센스·SEO 품질) */
export const MIN_POST_DESCRIPTION_LENGTH = 30;

export function categoryExemptFromMinDescription(category: Category): boolean {
  return category === 'LOUNGE';
}

/**
 * 신규 글·설명 필드 수정 시 검증. `null`이면 통과.
 */
export function validateContentMinForCategory(
  category: Category,
  content: string | null | undefined
): string | null {
  if (categoryExemptFromMinDescription(category)) return null;
  const t = (content ?? '').trim();
  if (t.length < MIN_POST_DESCRIPTION_LENGTH) {
    return `설명(Description)은 ${MIN_POST_DESCRIPTION_LENGTH}자 이상 입력해 주세요. (LOUNGE 복도는 제외)`;
  }
  return null;
}
