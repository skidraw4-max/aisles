'use client';

import { useEffect, useRef } from 'react';
import { FeedPostLink } from '@/components/FeedPostLink';
import { sendGAEvent } from '@/lib/ga4';
import type { Category } from '@prisma/client';
import styles from '@/app/(root)/search/search.module.css';

type SearchResult = {
  id: string;
  title: string;
  category: Category;
  categoryLabel: string;
  authorUsername: string;
  createdAtIso: string;
  snippet: string | null;
};

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString('ko-KR', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return '';
  }
}

type AnalyticsProps = {
  searchTerm: string;
  resultsCount: number;
};

/** `/search` 결과 로드 시 `site_search` 1회 (results_count 포함) */
export function SearchPageAnalytics({ searchTerm, resultsCount }: AnalyticsProps) {
  const firedRef = useRef(false);

  useEffect(() => {
    if (!searchTerm || firedRef.current) return;
    firedRef.current = true;
    sendGAEvent('site_search', { search_term: searchTerm, results_count: resultsCount });
  }, [searchTerm, resultsCount]);

  return null;
}

export function SearchResultList({ results }: { results: SearchResult[] }) {
  return (
    <ul className={styles.list}>
      {results.map((post) => (
        <li key={post.id} className={styles.row}>
          <FeedPostLink
            href={`/post/${post.id}`}
            className={styles.link}
            postId={post.id}
            category={post.category}
            surface="search_result"
          >
            <h2 className={styles.rowTitle}>{post.title}</h2>
            <p className={styles.rowMeta}>
              {post.categoryLabel} · {post.authorUsername} · {formatDate(post.createdAtIso)}
            </p>
            {post.snippet ? <p className={styles.snippet}>{post.snippet}</p> : null}
          </FeedPostLink>
        </li>
      ))}
    </ul>
  );
}
