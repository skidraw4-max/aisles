'use client';

import Image from 'next/image';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Category } from '@prisma/client';
import { MediaThumb } from '@/components/MediaThumb';
import styles from '@/app/(root)/page.module.css';

function isVideoUrl(url: string) {
  return /\.(mp4|webm|mov)(\?|#|$)/i.test(url);
}

export function recentPostThumbFallbackPath(category: Category): string {
  if (category === 'LOUNGE') return '/home-fallback/lounge.svg';
  if (category === 'GOSSIP') return '/home-fallback/gossip.svg';
  return '/home-fallback/aisle-default.svg';
}

type Props = {
  thumbnail: string | null | undefined;
  category: Category;
  title: string;
};

function RecentRemoteImageThumb({ src, fallback, alt }: { src: string; fallback: string; alt: string }) {
  const [active, setActive] = useState(src);
  const didFallback = useRef(false);

  useEffect(() => {
    didFallback.current = false;
    setActive(src);
  }, [src]);

  const onError = useCallback(() => {
    if (didFallback.current) return;
    didFallback.current = true;
    setActive(fallback);
  }, [fallback]);

  const unoptimized =
    active.startsWith('/home-fallback/') || /\.svg(\?|#|$)/i.test(active);

  return (
    <Image
      src={active}
      alt={alt}
      width={40}
      height={40}
      className={styles.recentThumbImg}
      onError={onError}
      unoptimized={unoptimized}
    />
  );
}

/**
 * 메인 우측 "최근 게시물" 썸네일 — 미디어 없음·로드 실패 시 카테고리별 SVG 폴백
 */
export function RecentPostListThumb({ thumbnail, category, title }: Props) {
  const fallback = recentPostThumbFallbackPath(category);
  const raw = typeof thumbnail === 'string' ? thumbnail.trim() : '';

  if (!raw) {
    return (
      <div className={styles.recentThumbFallback}>
        <Image
          src={fallback}
          alt=""
          width={28}
          height={28}
          className={styles.recentThumbFallbackIcon}
          unoptimized
        />
      </div>
    );
  }

  if (isVideoUrl(raw)) {
    return <MediaThumb url={raw} alt={title} className={styles.mediaFill} />;
  }

  return <RecentRemoteImageThumb src={raw} fallback={fallback} alt={title} />;
}
