import type { Metadata } from 'next';
import Link from 'next/link';
import { SiteFooter } from '@/components/SiteFooter';
import { fetchPopularTags } from '@/lib/popular-tags.server';
import { getCanonicalSiteUrl } from '@/lib/canonical-site-url';
import { SEO_ROBOTS_PUBLIC } from '@/lib/seo-robots';
import { SEARCH_CORRIDORS } from '@/lib/search-corridor';
import { TagsHubGalleryBanner } from './TagsHubGalleryBanner';
import styles from './tags.module.css';

export const revalidate = 300;

export async function generateMetadata(): Promise<Metadata> {
  const base = getCanonicalSiteUrl().replace(/\/$/, '');
  const url = `${base}/tags`;
  const title = '인기 태그 · AIsle';
  const description = 'AIsle에서 많이 쓰인 태그로 게시글을 모아 보세요. 복도별 검색도 함께 제공합니다.';
  return {
    title,
    description,
    alternates: { canonical: url },
    robots: SEO_ROBOTS_PUBLIC,
    openGraph: { title, description, url, type: 'website' },
  };
}

export default async function TagsHubPage() {
  const tags = await fetchPopularTags(40);

  return (
    <>
      <main className={styles.shell}>
        <h1 className={styles.title}>인기 태그</h1>
        <p className={styles.lede}>
          큐레이션된 태그 허브입니다. 태그를 누르면 관련 글을 모아서 볼 수 있습니다.
        </p>

        <TagsHubGalleryBanner />

        <section aria-labelledby="corridors">
          <h2 id="corridors" className={styles.sectionTitle}>
            복도로 찾기
          </h2>
          <ul className={styles.corridorList}>
            {SEARCH_CORRIDORS.map((c) => (
              <li key={c}>
                <Link href={`/search?corridor=${c}`} className={styles.chip}>
                  {c}
                </Link>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="tags">
          <h2 id="tags" className={styles.sectionTitle}>
            태그
          </h2>
          {tags.length === 0 ? (
            <p className={styles.empty}>아직 집계된 태그가 없습니다.</p>
          ) : (
            <ul className={styles.tagList}>
              {tags.map((t) => (
                <li key={t.tag}>
                  <Link href={`/search?tag=${encodeURIComponent(t.tag)}`} className={styles.chip}>
                    #{t.tag}
                    <span className={styles.count}>{t.count}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
