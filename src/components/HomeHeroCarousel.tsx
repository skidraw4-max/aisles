'use client';

import Link from 'next/link';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import styles from '@/app/(root)/page.module.css';

const INTERVAL_MS = 6000;
const SLIDE_COUNT = 2;

export type HomeHeroFortuneSlide = {
  eyebrow: string;
  titleLine1: string;
  titleLine2: string;
  lead: string;
  profileHref: string;
  profileCtaLabel: string;
  fortuneHref: string;
  fortuneLinkLabel: string;
};

export type HomeHeroPromptSlide = {
  eyebrow: string;
  titleLine1: string;
  titleLine2Accent: string;
  titleLine2Rest: string;
  lead: string;
  ctaHref: string;
  ctaLabel: string;
};

type HomeHeroCarouselProps = {
  fortune: HomeHeroFortuneSlide;
  prompt: HomeHeroPromptSlide;
};

export function HomeHeroCarousel({ fortune, prompt }: HomeHeroCarouselProps) {
  const carouselId = useId();
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const intervalRef = useRef<number | null>(null);

  const go = useCallback((i: number) => {
    setIndex(((i % SLIDE_COUNT) + SLIDE_COUNT) % SLIDE_COUNT);
  }, []);

  const clearTimer = useCallback(() => {
    if (intervalRef.current) {
      window.clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const startTimer = useCallback(() => {
    clearTimer();
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (mq.matches || paused) return;
    intervalRef.current = window.setInterval(() => {
      setIndex((i) => (i + 1) % SLIDE_COUNT);
    }, INTERVAL_MS);
  }, [clearTimer, paused]);

  useEffect(() => {
    startTimer();
    return clearTimer;
  }, [startTimer, clearTimer]);

  const slideLabels = ['AI Fortune', '프롬프트 역설계'];

  return (
    <section
      className={styles.heroCarousel}
      aria-roledescription="carousel"
      aria-label="홈 히어로"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          setPaused(false);
        }
      }}
    >
      <div className={styles.heroCarouselTrack}>
        <article
          id={`${carouselId}-slide-0`}
          className={`${styles.heroCarouselSlide} ${styles.heroCarouselSlideFortune}`}
          data-active={index === 0}
          aria-hidden={index !== 0}
        >
          <div className={styles.heroCarouselSlideInner}>
            <p className={`${styles.heroCarouselEyebrow} ${styles.heroCarouselEyebrowFortune}`}>
              {fortune.eyebrow}
            </p>
            <h1 className={`${styles.heroTitle} ${styles.heroTitleHome} ${styles.heroTitleFortune}`}>
              <span className={styles.heroTitleLine}>{fortune.titleLine1}</span>
              <span className={styles.heroTitleLine}>
                <span className={styles.heroTitleAccentFortune}>{fortune.titleLine2}</span>
              </span>
            </h1>
            <p className={`${styles.heroLead} ${styles.heroLeadHome} ${styles.heroLeadFortune}`}>
              {fortune.lead}
            </p>
            <div
              className={`${styles.heroCtaRow} ${styles.heroCarouselCtaRow} ${styles.heroCarouselCtaRowStack}`}
              data-cta-count="2"
            >
              <Link href={fortune.profileHref} className={styles.heroCtaFortune}>
                {fortune.profileCtaLabel}
              </Link>
              <Link href={fortune.fortuneHref} className={styles.heroCtaFortuneSecondary}>
                {fortune.fortuneLinkLabel}
              </Link>
            </div>
          </div>
        </article>

        <article
          id={`${carouselId}-slide-1`}
          className={`${styles.heroCarouselSlide} ${styles.heroCarouselSlidePrompt}`}
          data-active={index === 1}
          aria-hidden={index !== 1}
        >
          <div className={styles.heroCarouselSlideInner}>
            <p className={`${styles.heroCarouselEyebrow} ${styles.heroCarouselEyebrowPrompt}`}>
              {prompt.eyebrow}
            </p>
            <h1 className={`${styles.heroTitle} ${styles.heroTitleHome}`}>
              <span className={styles.heroTitleLine}>{prompt.titleLine1}</span>
              <span className={styles.heroTitleLine}>
                <span className={styles.heroTitleAccent}>{prompt.titleLine2Accent}</span>
                <span className={styles.heroTitleRest}>{prompt.titleLine2Rest}</span>
              </span>
            </h1>
            <p className={`${styles.heroLead} ${styles.heroLeadHome}`}>{prompt.lead}</p>
            <div
              className={`${styles.heroCtaRow} ${styles.heroCarouselCtaRow} ${styles.heroCarouselCtaRowStack}`}
              data-cta-count="1"
            >
              <Link href={prompt.ctaHref} className={styles.heroCtaPrimary}>
                {prompt.ctaLabel}
              </Link>
              <span className={styles.heroCarouselCtaSpacer} aria-hidden="true" />
            </div>
          </div>
        </article>
      </div>

      <div className={styles.heroCarouselControls} aria-live="polite">
        <div className={styles.heroCarouselNav}>
          <button
            type="button"
            className={styles.heroCarouselArrow}
            aria-label="이전 슬라이드"
            onClick={() => go(index - 1)}
          >
            ‹
          </button>
          <div className={styles.heroCarouselDots} role="tablist" aria-label="히어로 슬라이드">
            {slideLabels.map((label, i) => (
              <button
                key={label}
                type="button"
                role="tab"
                id={`${carouselId}-tab-${i}`}
                aria-controls={`${carouselId}-slide-${i}`}
                aria-selected={i === index}
                aria-label={`${label} 보기`}
                className={
                  i === index
                    ? `${styles.heroCarouselDot} ${styles.heroCarouselDotActive}`
                    : styles.heroCarouselDot
                }
                data-variant={i === 0 ? 'fortune' : 'prompt'}
                onClick={() => go(i)}
              />
            ))}
          </div>
          <button
            type="button"
            className={styles.heroCarouselArrow}
            aria-label="다음 슬라이드"
            onClick={() => go(index + 1)}
          >
            ›
          </button>
        </div>
      </div>
    </section>
  );
}
