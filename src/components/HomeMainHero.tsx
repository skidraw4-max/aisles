'use client';

import { useCallback, useEffect, useState } from 'react';
import styles from '@/app/page.module.css';

const CAROUSEL_SLIDES = [
  {
    title: '오늘의 추천 레시피',
    sub: 'Lab 복도에서 에디터가 고른 프롬프트·워크플로를 확인해 보세요.',
  },
  {
    title: '이달의 베스트 프로젝트',
    sub: 'Launch와 Build에서 반응이 뜨거웠던 작품과 빌드 노트를 모았습니다.',
  },
  {
    title: '갤러리 신작 하이라이트',
    sub: 'Gallery에서 비주얼 트렌드와 아이디어 스파크를 수집하세요.',
  },
] as const;

const INTERVAL_MS = 5500;

export function HomeMainHero() {
  const [index, setIndex] = useState(0);

  const go = useCallback((i: number) => {
    setIndex(((i % CAROUSEL_SLIDES.length) + CAROUSEL_SLIDES.length) % CAROUSEL_SLIDES.length);
  }, []);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (mq.matches) return;
    const t = window.setInterval(() => {
      setIndex((i) => (i + 1) % CAROUSEL_SLIDES.length);
    }, INTERVAL_MS);
    return () => window.clearInterval(t);
  }, []);

  const slide = CAROUSEL_SLIDES[index];

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
          The Gateway to AI Creativity.
        </h2>
        <p className={styles.homeMainHeroSub}>
          실험부터 출시까지, AI 프로젝트의 모든 복도(Aisles)가 모이는 곳.
        </p>

        <div className={styles.homeMainHeroCarousel} aria-live="polite" aria-atomic="true">
          <p key={slide.title} className={styles.homeMainHeroSpotlight}>
            {slide.title}
          </p>
          <p key={`${slide.title}-sub`} className={styles.homeMainHeroSpotlightSub}>
            {slide.sub}
          </p>
        </div>

        <div className={styles.homeMainHeroDots} role="tablist" aria-label="히어로 슬라이드">
          {CAROUSEL_SLIDES.map((_, i) => (
            <button
              key={i}
              type="button"
              role="tab"
              aria-selected={i === index}
              aria-label={`${CAROUSEL_SLIDES[i].title} 보기`}
              className={i === index ? `${styles.homeMainHeroDot} ${styles.homeMainHeroDotActive}` : styles.homeMainHeroDot}
              onClick={() => go(i)}
            />
          ))}
        </div>

        <a href="#content-showcase-heading" className={styles.homeMainHeroCta}>
          Explore Now
        </a>
      </div>
    </section>
  );
}
