'use client';

import Link from 'next/link';
import { trackTagsHubGalleryClick } from '@/lib/ga4';
import styles from './tags.module.css';

export function TagsHubGalleryBanner() {
  return (
    <section className={styles.galleryBanner} aria-label="AI 이미지 갤러리">
      <h2 className={styles.galleryBannerTitle}>AI 이미지 역분석</h2>
      <p className={styles.galleryBannerMeta}>
        프롬프트·스타일 역분석 예시는 갤러리 복도에서 모아 볼 수 있습니다.
      </p>
      <Link
        href="/?category=GALLERY"
        className={styles.galleryBannerCta}
        onClick={() => trackTagsHubGalleryClick()}
      >
        갤러리에서 역분석 예시 보기 →
      </Link>
    </section>
  );
}
