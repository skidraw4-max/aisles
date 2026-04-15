'use client';

import Image from 'next/image';
import { useCallback, useEffect, useState } from 'react';
import type { Category } from '@prisma/client';
import { MediaThumb } from '@/components/MediaThumb';
import styles from '@/app/(root)/page.module.css';

function isVideoUrl(url: string) {
  return /\.(mp4|webm|mov)(\?|#|$)/i.test(url);
}

export type RecentPostLetterVariant = 'lounge' | 'gossip' | 'default';

export function categoryToLetterVariant(category: Category): RecentPostLetterVariant {
  if (category === 'LOUNGE') return 'lounge';
  if (category === 'GOSSIP') return 'gossip';
  return 'default';
}

/** 최근 게시물 등 — 썸네일 없음·이미지 실패 시 카테고리 이니셜 타일 */
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

type Props = {
  thumbnail: string | null | undefined;
  category: Category;
  title: string;
};

function RecentRemoteImageThumb({
  src,
  letterVariant,
  alt,
}: {
  src: string;
  letterVariant: RecentPostLetterVariant;
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
    return <RecentPostLetterThumb variant={letterVariant} />;
  }

  return (
    <Image
      src={src}
      alt={alt}
      width={40}
      height={40}
      className={styles.recentThumbImg}
      onError={onError}
    />
  );
}

/**
 * 메인 우측 "최근 게시물" 썸네일 — 미디어 없음·로드 실패 시 카테고리별 이니셜 타일
 */
export function RecentPostListThumb({ thumbnail, category, title }: Props) {
  const letterVariant = categoryToLetterVariant(category);
  const raw = typeof thumbnail === 'string' ? thumbnail.trim() : '';

  if (!raw) {
    return <RecentPostLetterThumb variant={letterVariant} />;
  }

  if (isVideoUrl(raw)) {
    return <MediaThumb url={raw} alt={title} className={styles.mediaFill} />;
  }

  return <RecentRemoteImageThumb src={raw} letterVariant={letterVariant} alt={title} />;
}
