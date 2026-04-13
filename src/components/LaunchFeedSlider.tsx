'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { MediaThumb } from '@/components/MediaThumb';
import pageStyles from '@/app/page.module.css';
import styles from './LaunchFeedSlider.module.css';

export type LaunchFeedSlide = {
  id: string;
  title: string;
  imageUrl: string | null;
};

const INTERVAL_MS = 6000;

type Props = {
  slides: LaunchFeedSlide[];
};

export function LaunchFeedSlider({ slides }: Props) {
  const [index, setIndex] = useState(0);

  const go = useCallback(
    (i: number) => {
      if (slides.length === 0) return;
      setIndex(((i % slides.length) + slides.length) % slides.length);
    },
    [slides.length]
  );

  useEffect(() => {
    if (slides.length <= 1) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (mq.matches) return;
    const t = window.setInterval(() => {
      setIndex((prev) => (prev + 1) % slides.length);
    }, INTERVAL_MS);
    return () => window.clearInterval(t);
  }, [slides.length]);

  if (slides.length === 0) return null;

  return (
    <section className={styles.banner} aria-label="Launch 최신">
      <span className={styles.badge}>Launch</span>
      <div className={styles.viewport}>
        <div
          className={styles.track}
          style={{ transform: `translateX(-${index * 100}%)` }}
        >
          {slides.map((slide, slideIndex) => (
            <Link
              key={slide.id}
              href={`/post/${slide.id}`}
              className={styles.slide}
              prefetch
            >
              <div className={styles.titleCol}>
                <h2 className={styles.title}>{slide.title}</h2>
              </div>
              <div className={styles.imageCol}>
                {slide.imageUrl ? (
                  <MediaThumb
                    url={slide.imageUrl}
                    alt=""
                    className={pageStyles.mediaFill}
                    objectFit="cover"
                    objectPosition="center"
                    priority={slideIndex === 0}
                    sizes="(max-width: 520px) 100vw, 40vw"
                  />
                ) : (
                  <span className={styles.imagePlaceholder} aria-hidden />
                )}
              </div>
            </Link>
          ))}
        </div>
      </div>
      {slides.length > 1 ? (
        <div className={styles.controls} role="tablist" aria-label="슬라이드 선택">
          {slides.map((slide, i) => (
            <button
              key={slide.id}
              type="button"
              role="tab"
              aria-selected={i === index}
              aria-label={`${i + 1}번째 Launch 글`}
              className={`${styles.dot} ${i === index ? styles.dotActive : ''}`}
              onClick={() => go(i)}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}
