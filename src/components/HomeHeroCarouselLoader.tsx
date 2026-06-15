'use client';

import nextDynamic from 'next/dynamic';
import styles from '@/app/(root)/page.module.css';

export const HomeHeroCarousel = nextDynamic(
  () => import('@/components/HomeHeroCarousel').then((m) => ({ default: m.HomeHeroCarousel })),
  {
    ssr: false,
    loading: () => (
      <section
        className={styles.heroCarousel}
        aria-busy="true"
        role="status"
        aria-label="홈 히어로 로딩"
        style={{ minHeight: '18rem' }}
      />
    ),
  }
);
