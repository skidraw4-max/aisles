'use client';

import Image from 'next/image';
import { useCallback, useEffect, useState } from 'react';
import type { Category } from '@prisma/client';
import { MediaThumb } from '@/components/MediaThumb';
import { labKindFromMetadataParams, type LabPromptKind } from '@/lib/post-categories';
import pageStyles from '@/app/(root)/page.module.css';
import myAislesStyles from '@/app/(root)/my-aisles/my-aisles.module.css';
import postStyles from '@/app/(root)/post/[id]/post.module.css';

export type PostThumbnailLayout =
  | 'card'
  | 'compact'
  | 'showcaseLarge'
  | 'showcaseList'
  | 'myAislesCard'
  | 'sidebarPopular';

export type RecentPostLetterVariant = 'lounge' | 'gossip' | 'default';

export function categoryToLetterVariant(category: Category): RecentPostLetterVariant {
  if (category === 'LOUNGE') return 'lounge';
  if (category === 'GOSSIP') return 'gossip';
  return 'default';
}

/** 썸네일 없음·LAB 아님 — 카테고리 이니셜 타일 */
export function RecentPostLetterThumb({ variant }: { variant: RecentPostLetterVariant }) {
  const letter = variant === 'lounge' ? 'L' : variant === 'gossip' ? 'G' : 'A';
  const gradClass =
    variant === 'lounge'
      ? 'bg-gradient-to-br from-indigo-500 to-purple-600'
      : variant === 'gossip'
        ? 'bg-gradient-to-br from-orange-400 to-rose-500'
        : 'bg-gradient-to-br from-violet-600 to-indigo-700';

  return (
    <div
      className={`${gradClass} flex h-full w-full items-center justify-center rounded-lg shadow-sm transition-all duration-200 ease-out hover:scale-[1.04] hover:brightness-110 hover:shadow-md`}
      aria-hidden
    >
      <span
        className="inline-block origin-center scale-110 select-none text-xl font-bold leading-none tracking-tight text-white drop-shadow-md"
        style={{ lineHeight: 1 }}
      >
        {letter}
      </span>
    </div>
  );
}

function isVideoUrl(url: string) {
  return /\.(mp4|webm|mov)(\?|#|$)/i.test(url);
}

function resolveLabKind(
  category: Category,
  labPromptKind?: LabPromptKind,
  metadataParams?: unknown
): LabPromptKind | undefined {
  if (category !== 'RECIPE') return undefined;
  if (labPromptKind !== undefined) return labPromptKind;
  return labKindFromMetadataParams(metadataParams);
}

function LabPromptArchivePlaceholder({
  kind,
  layout,
}: {
  kind: LabPromptKind;
  layout: PostThumbnailLayout;
}) {
  const grad =
    kind === 'marketing'
      ? 'bg-gradient-to-br from-orange-400 to-rose-500'
      : 'bg-gradient-to-br from-teal-400 to-sky-500';

  const sizeClass =
    layout === 'card' || layout === 'showcaseLarge' || layout === 'myAislesCard' || layout === 'sidebarPopular'
      ? pageStyles.labNoMediaThumbCard
      : layout === 'compact'
        ? 'h-full w-full min-h-0'
        : layout === 'showcaseList'
          ? 'absolute inset-0 flex items-center justify-center overflow-hidden rounded-lg'
          : pageStyles.labNoMediaThumbCard;

  const label =
    layout === 'compact' ? (
      <span className="flex flex-col items-center justify-center gap-0 px-0.5 text-[7px] font-bold leading-none tracking-tight text-white">
        <span>PROMPT</span>
        <span>ARCHIVE</span>
      </span>
    ) : layout === 'showcaseList' ? (
      <span className="px-1 text-center text-[10px] font-bold leading-tight tracking-tight text-white">
        PROMPT ARCHIVE
      </span>
    ) : (
      <span className="select-none px-2 text-center text-2xl font-bold tracking-tight text-white drop-shadow-md">
        PROMPT ARCHIVE
      </span>
    );

  return (
    <div
      className={`${grad} ${sizeClass} flex items-center justify-center rounded-lg shadow-sm transition-transform duration-200 ease-out hover:scale-[1.03] hover:brightness-110 hover:shadow-md`}
      aria-hidden
    >
      {label}
    </div>
  );
}

export type PostThumbnailProps = {
  thumbnail: string | null | undefined;
  category: Category;
  alt: string;
  layout: PostThumbnailLayout;
  labPromptKind?: LabPromptKind;
  metadataParams?: unknown;
  priority?: boolean;
  sizes?: string;
};

function PostThumbnailCompactRemote({
  src,
  letterVariant,
  labKind,
  alt,
}: {
  src: string;
  letterVariant: RecentPostLetterVariant;
  labKind?: LabPromptKind;
  alt: string;
}) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [src]);

  const onError = useCallback(() => {
    setFailed(true);
  }, []);

  if (failed) {
    if (labKind) {
      return <LabPromptArchivePlaceholder kind={labKind} layout="compact" />;
    }
    return <RecentPostLetterThumb variant={letterVariant} />;
  }

  return (
    <Image
      src={src}
      alt={alt}
      width={40}
      height={40}
      className={pageStyles.recentThumbImg}
      onError={onError}
    />
  );
}

/**
 * 포스트 썸네일 — 미디어 유무·카테고리(LAB)에 따라 이미지 또는 LAB 전용 그라데이션(PROMPT ARCHIVE)을 한곳에서 처리합니다.
 */
export function PostThumbnail({
  thumbnail,
  category,
  alt,
  layout,
  labPromptKind,
  metadataParams,
  priority = false,
  sizes,
}: PostThumbnailProps) {
  const raw = typeof thumbnail === 'string' ? thumbnail.trim() : '';
  const letterVariant = categoryToLetterVariant(category);
  const labKind = resolveLabKind(category, labPromptKind, metadataParams);

  const defaultSizes = sizes ?? '(max-width: 479px) 100vw, (max-width: 959px) 50vw, 25vw';

  const nonLabEmpty = (() => {
    switch (layout) {
      case 'card':
        return <div className={pageStyles.feedCardPlaceholder} aria-hidden />;
      case 'compact':
        return <RecentPostLetterThumb variant={letterVariant} />;
      case 'showcaseLarge':
        return <div className={pageStyles.contentShowcaseLargePh} aria-hidden />;
      case 'showcaseList':
        return <div className={pageStyles.contentShowcaseListPh} aria-hidden />;
      case 'myAislesCard':
        return <div className={myAislesStyles.placeholder} aria-hidden />;
      case 'sidebarPopular':
        return <div className={postStyles.sidebarPopularThumbPh} aria-hidden />;
      default:
        return null;
    }
  })();

  if (!raw) {
    if (category === 'RECIPE' && labKind) {
      return <LabPromptArchivePlaceholder kind={labKind} layout={layout} />;
    }
    return nonLabEmpty;
  }

  if (layout === 'compact') {
    if (isVideoUrl(raw)) {
      return <MediaThumb url={raw} alt={alt} className={pageStyles.mediaFill} />;
    }
    return (
      <PostThumbnailCompactRemote
        src={raw}
        letterVariant={letterVariant}
        labKind={labKind}
        alt={alt}
      />
    );
  }

  return (
    <MediaThumb
      url={raw}
      alt={alt}
      objectFit="cover"
      priority={priority}
      sizes={defaultSizes}
    />
  );
}
