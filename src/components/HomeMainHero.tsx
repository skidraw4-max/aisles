'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useUiLabels } from '@/components/UiLabelsProvider';
import { useAuth } from '@/components/SessionProvider';
import { trackHeroAnalysisCtaClick } from '@/lib/ga4';
import { galleryUploadHref } from '@/lib/gallery-upload-href';
import styles from '@/app/(root)/page.module.css';

const CAROUSEL_INDICES = [0, 1, 2] as const;

const INTERVAL_MS = 5500;

const GALLERY_HREF = '/?category=GALLERY';

export function HomeMainHero() {
  const m = useUiLabels();
  const { isAuthenticated, authReady } = useAuth();
  const [index, setIndex] = useState(0);
  const loggedIn = authReady && isAuthenticated;
  const uploadHref = galleryUploadHref(loggedIn);

  const slides = CAROUSEL_INDICES.map((i) => ({
    title: m?.[`home.main_hero.carousel.${i}.title`] ?? '',
    sub: m?.[`home.main_hero.carousel.${i}.sub`] ?? '',
  }));

  const go = useCallback(
    (i: number) => {
      setIndex(((i % slides.length) + slides.length) % slides.length);
    },
    [slides.length]
  );

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (mq.matches) return;
    const t = window.setInterval(() => {
      setIndex((i) => (i + 1) % slides.length);
    }, INTERVAL_MS);
    return () => window.clearInterval(t);
  }, [slides.length]);

  const slide = slides[index] ?? slides[0];
  const headingEn = m?.['home.main_hero.heading_en'] ?? '';
  const subKo = m?.['home.main_hero.sub_ko'] ?? '';
  const ctaGallery = m?.['home.main_hero.cta_gallery'] ?? 'AI 이미지 역분석 예시 보기';
  const ctaUpload = m?.['home.main_hero.cta_upload'] ?? '내 이미지 분석하기';

  return (
    <section className={styles.homeMainHero} aria-labelledby="home-main-hero-title">
      <div className={styles.homeMainHeroBgStack} aria-hidden>
        <div
          className={`${styles.homeMainHeroBgSlide} ${styles.homeMainHeroBgTunnel}`}
          data-active={index === 0}
        />
        <div
          className={`${styles.homeMainHeroBgSlide} ${styles.homeMainHeroBgGrid}`}
          data-active={index === 1}
        />
        <div
          className={`${styles.homeMainHeroBgSlide} ${styles.homeMainHeroBgFlow}`}
          data-active={index === 2}
        />
      </div>
      <div className={styles.homeMainHeroOverlay} aria-hidden />

      <div className={styles.homeMainHeroInner}>
        <h2 id="home-main-hero-title" className={styles.homeMainHeroTitle}>
          {headingEn}
        </h2>
        <p className={styles.homeMainHeroSub}>{subKo}</p>

        <div className={styles.homeMainHeroCarousel} aria-live="polite" aria-atomic="true">
          <p key={slide.title} className={styles.homeMainHeroSpotlight}>
            {slide.title}
          </p>
          <p key={`${slide.title}-sub`} className={styles.homeMainHeroSpotlightSub}>
            {slide.sub}
          </p>
        </div>

        <div className={styles.homeMainHeroDots} role="tablist" aria-label="히어로 슬라이드">
          {slides.map((s, i) => (
            <button
              key={i}
              type="button"
              role="tab"
              aria-selected={i === index}
              aria-label={`${s.title} 보기`}
              className={
                i === index ? `${styles.homeMainHeroDot} ${styles.homeMainHeroDotActive}` : styles.homeMainHeroDot
              }
              onClick={() => go(i)}
            />
          ))}
        </div>

        <div className={styles.homeMainHeroCtaRow}>
          <Link
            href={GALLERY_HREF}
            className={styles.homeMainHeroCta}
            onClick={() => trackHeroAnalysisCtaClick('gallery')}
          >
            {ctaGallery}
          </Link>
          <Link
            href={uploadHref}
            className={styles.homeMainHeroCtaSecondary}
            onClick={() =>
              trackHeroAnalysisCtaClick(loggedIn ? 'upload' : 'upload_login')
            }
          >
            {ctaUpload}
          </Link>
        </div>
      </div>
    </section>
  );
}
