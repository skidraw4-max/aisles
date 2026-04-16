import type { Category } from '@prisma/client';
import type { LabPromptKind } from '@/lib/post-categories';
import {
  PostThumbnail,
  categoryToLetterVariant,
  RecentPostLetterThumb,
  type RecentPostLetterVariant,
} from '@/components/post/PostThumbnail';

export { categoryToLetterVariant, RecentPostLetterThumb, type RecentPostLetterVariant };

type Props = {
  thumbnail: string | null | undefined;
  category: Category;
  title: string;
  /** 우선 적용 — 없으면 `metadataParams`로 LAB 종류 판별 */
  labPromptKind?: LabPromptKind;
  metadataParams?: unknown;
};

/** 메인 우측 "최근 게시물" 썸네일 — {@link PostThumbnail} compact */
export function RecentPostListThumb({
  thumbnail,
  category,
  title,
  labPromptKind,
  metadataParams,
}: Props) {
  return (
    <PostThumbnail
      thumbnail={thumbnail}
      category={category}
      alt={title}
      layout="compact"
      labPromptKind={labPromptKind}
      metadataParams={metadataParams}
    />
  );
}
