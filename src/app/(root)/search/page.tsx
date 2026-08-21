import Link from 'next/link';
import type { Metadata } from 'next';
import { SiteFooter } from '@/components/SiteFooter';
import { SearchPageAnalytics, SearchResultList } from '@/components/SearchPageClient';
import { searchPosts } from '@/lib/search-posts';
import { SEO_ROBOTS_NOINDEX_FOLLOW } from '@/lib/seo-robots';
import styles from './search.module.css';

export const dynamic = 'force-dynamic';

type PageProps = {
  searchParams: Promise<{
    q?: string | string[];
    tag?: string | string[];
    corridor?: string | string[];
  }>;
};

function parseCorridor(raw: string): 'BUILD' | 'LAUNCH' | undefined {
  const k = raw.trim().toUpperCase();
  if (k === 'BUILD' || k === 'LAUNCH') return k;
  return undefined;
}

function firstParam(v: string | string[] | undefined): string {
  if (Array.isArray(v)) return (v[0] ?? '').trim();
  return (v ?? '').trim();
}

export async function generateMetadata({ searchParams }: PageProps): Promise<Metadata> {
  const sp = await searchParams;
  const q = firstParam(sp.q);
  const tag = firstParam(sp.tag);
  const robots = SEO_ROBOTS_NOINDEX_FOLLOW;
  if (!q && !tag) {
    return { title: '검색 · AIsle', robots };
  }
  if (tag && q) {
    return { title: `「${q}」 + #${tag} · AIsle`, robots };
  }
  if (tag) {
    return { title: `#${tag} 태그 · AIsle`, robots };
  }
  return { title: `「${q}」 검색 · AIsle`, robots };
}

export default async function SearchPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const q = firstParam(sp.q);
  const tag = firstParam(sp.tag);
  const corridor = parseCorridor(firstParam(sp.corridor));

  const hasQuery = q.length > 0 || tag.length > 0 || Boolean(corridor);
  const results = hasQuery
    ? await searchPosts({ q, tag: tag || undefined, corridor })
    : [];
  const searchTerm = q || (tag ? `#${tag}` : corridor ? `corridor:${corridor}` : '');

  return (
    <>
      {hasQuery && searchTerm ? (
        <SearchPageAnalytics searchTerm={searchTerm} resultsCount={results.length} />
      ) : null}
      <main className={styles.shell}>
        <Link href="/" className={styles.back}>
          ← 홈으로
        </Link>
        <h1 className={styles.title}>검색</h1>
        {!hasQuery ? (
          <p className={styles.meta}>헤더 검색창에 키워드를 입력하거나, 게시글의 태그를 눌러 모아 보세요.</p>
        ) : (
          <p className={styles.meta}>
            {tag ? (
              <>
                태그 <strong>#{tag}</strong>
                {q ? (
                  <>
                    {' '}
                    + 키워드 &ldquo;{q}&rdquo;
                  </>
                ) : null}
                {corridor ? (
                  <>
                    {' '}
                    · 복도 <strong>{corridor}</strong>
                  </>
                ) : null}{' '}
                — {results.length}건
              </>
            ) : (
              <>
                &ldquo;{q}&rdquo; — {results.length}건
              </>
            )}
          </p>
        )}

        {!hasQuery ? (
          <p className={styles.empty}>검색어 또는 태그가 없습니다.</p>
        ) : results.length === 0 ? (
          <p className={styles.empty}>
            일치하는 게시글이 없습니다. 다른 키워드로 시도해 보거나{' '}
            <Link href="/upload" className={styles.emptyLink}>
              새 글을 올려 보세요
            </Link>
            .
          </p>
        ) : (
          <SearchResultList
            results={results.map((post) => ({
              id: post.id,
              title: post.title,
              category: post.category,
              categoryLabel: post.categoryLabel,
              authorUsername: post.authorUsername,
              createdAtIso: post.createdAt.toISOString(),
              snippet: post.snippet,
            }))}
          />
        )}
      </main>
      <SiteFooter />
    </>
  );
}
