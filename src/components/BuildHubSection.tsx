'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { sendGAEvent } from '@/lib/ga4';
import { extractBuildFilterKeys } from '@/lib/ugc-hub.shared';
import type { FeedPostJson } from '@/lib/home-feed';
import styles from './build-hub-section.module.css';

type Props = {
  posts: FeedPostJson[];
  uploadHref: string;
};

export function BuildHubSection({ posts, uploadHref }: Props) {
  const tools = useMemo(() => {
    const set = new Set<string>();
    for (const p of posts) {
      for (const k of extractBuildFilterKeys(p.metadata?.params)) {
        set.add(k);
      }
      for (const t of p.tags ?? []) {
        if (t.trim()) set.add(t.trim());
      }
    }
    return [...set].sort((a, b) => a.localeCompare(b, 'ko'));
  }, [posts]);

  const [toolFilter, setToolFilter] = useState<string | null>(null);

  const filtered = useMemo(() => {
    if (!toolFilter) return posts;
    return posts.filter((p) => {
      const keys = extractBuildFilterKeys(p.metadata?.params);
      if (keys.some((k) => k === toolFilter)) return true;
      return (p.tags ?? []).some((t) => t.trim() === toolFilter);
    });
  }, [posts, toolFilter]);

  return (
    <section className={styles.wrap} aria-labelledby="build-hub-heading">
      <h2 id="build-hub-heading" className={styles.heading}>
        이번 주 인기 레시피
      </h2>
      <div className={styles.ctaRow}>
        <Link
          href={uploadHref}
          className={styles.ctaPrimary}
          onClick={() => sendGAEvent('build_hub_cta_upload')}
        >
          레시피 등록하기
        </Link>
      </div>
      {tools.length > 0 ? (
        <div className={styles.filterRow} role="group" aria-label="도구·태그 필터">
          <button
            type="button"
            className={`${styles.filterPill} ${toolFilter === null ? styles.filterPillActive : ''}`}
            onClick={() => setToolFilter(null)}
          >
            전체
          </button>
          {tools.map((t) => (
            <button
              key={t}
              type="button"
              className={`${styles.filterPill} ${toolFilter === t ? styles.filterPillActive : ''}`}
              onClick={() => setToolFilter(t)}
            >
              {t}
            </button>
          ))}
        </div>
      ) : null}
      {filtered.length === 0 ? (
        <p className={styles.empty}>이번 주 인기 레시피가 아직 없습니다. 첫 레시피를 등록해 보세요.</p>
      ) : (
        <ol className={styles.list}>
          {filtered.map((post, i) => (
            <li key={post.id} className={styles.row}>
              <span className={styles.rank} aria-hidden>
                {i + 1}
              </span>
              <Link
                href={`/post/${post.id}`}
                className={styles.link}
                onClick={() =>
                  sendGAEvent('build_popular_click', { post_id: post.id, rank: i + 1 })
                }
              >
                <div className={styles.title}>{post.title}</div>
                <div className={styles.meta}>
                  ♥ {post.likeCount} · {post.author.username}
                </div>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
