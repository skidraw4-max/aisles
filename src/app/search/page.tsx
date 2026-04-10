import Link from 'next/link';
import type { Metadata } from 'next';
import { SiteHeader } from '@/components/SiteHeader';
import { searchPostsByQuery } from '@/lib/search-posts';
import styles from './search.module.css';

export const dynamic = 'force-dynamic';

type PageProps = {
  searchParams: Promise<{ q?: string | string[] }>;
};

export async function generateMetadata({ searchParams }: PageProps): Promise<Metadata> {
  const sp = await searchParams;
  const raw = Array.isArray(sp.q) ? sp.q[0] : sp.q;
  const q = raw?.trim() ?? '';
  if (!q) {
    return { title: '검색 · AIsle' };
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
  const raw = Array.isArray(sp.q) ? sp.q[0] : sp.q;
  const q = raw?.trim() ?? '';

  const results = q.length > 0 ? await searchPostsByQuery(q) : [];

  return (
    <>
      <SiteHeader />
      <main className={styles.shell}>
        <Link href="/" className={styles.back}>
          ← 홈으로
        </Link>
        <h1 className={styles.title}>검색</h1>
        {!q ? (
          <p className={styles.meta}>헤더 검색창에 키워드를 입력한 뒤 Enter 또는 검색 버튼을 누르세요.</p>
        ) : (
          <p className={styles.meta}>
            &ldquo;{q}&rdquo; — {results.length}건
          </p>
        )}

        {!q ? (
          <p className={styles.empty}>검색어가 없습니다.</p>
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
      <footer className={styles.footer}>
        <span>AIsle</span>
        <span className={styles.footerMuted}>Supabase Auth · Prisma · Next.js</span>
      </footer>
    </>
  );
}
