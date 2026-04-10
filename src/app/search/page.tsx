import Link from 'next/link';
import type { Metadata } from 'next';
import { SiteHeader } from '@/components/SiteHeader';
import { SiteFooter } from '@/components/SiteFooter';
import { searchPosts } from '@/lib/search-posts';
import styles from './search.module.css';

export const dynamic = 'force-dynamic';

type PageProps = {
  searchParams: Promise<{ q?: string | string[]; tag?: string | string[] }>;
};

function firstParam(v: string | string[] | undefined): string {
  if (Array.isArray(v)) return (v[0] ?? '').trim();
  return (v ?? '').trim();
}

export async function generateMetadata({ searchParams }: PageProps): Promise<Metadata> {
  const sp = await searchParams;
  const q = firstParam(sp.q);
  const tag = firstParam(sp.tag);
  if (!q && !tag) {
    return { title: '검색 · AIsle' };
  }
  if (tag && q) {
    return { title: `「${q}」 + #${tag} · AIsle` };
  }
  if (tag) {
    return { title: `#${tag} 태그 · AIsle` };
  }
  return { title: `「${q}」 검색 · AIsle` };
}

function formatDate(d: Date) {
  try {
    return d.toLocaleDateString('ko-KR', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return '';
  }
}

export default async function SearchPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const q = firstParam(sp.q);
  const tag = firstParam(sp.tag);

  const hasQuery = q.length > 0 || tag.length > 0;
  const results = hasQuery ? await searchPosts({ q, tag: tag || undefined }) : [];

  return (
    <>
      <SiteHeader />
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
          <ul className={styles.list}>
            {results.map((post) => (
              <li key={post.id} className={styles.row}>
                <Link href={`/post/${post.id}`} className={styles.link}>
                  <h2 className={styles.rowTitle}>{post.title}</h2>
                  <p className={styles.rowMeta}>
                    {post.categoryLabel} · {post.authorUsername} · {formatDate(post.createdAt)}
                  </p>
                  {post.snippet ? <p className={styles.snippet}>{post.snippet}</p> : null}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
      <SiteFooter />
    </>
  );
}
