import Link from 'next/link';
import { SiteHeader } from '@/components/SiteHeader';
import { MediaThumb } from '@/components/MediaThumb';
import { HomeAllFeed } from '@/components/HomeAllFeed';
import { HomeMainHero } from '@/components/HomeMainHero';
import { TodaysBest } from '@/components/TodaysBest';
import { SHOW_HOME_MAIN_HERO } from '@/lib/home-flags';
import { prisma } from '@/lib/prisma';
import { homeViewFromSearchParams } from '@/lib/content-tab';
import { fetchFeedPosts, serializeFeedPost } from '@/lib/home-feed';
import { POST_CATEGORY_OPTIONS } from '@/lib/post-categories';
import type { Category } from '@prisma/client';
import styles from './page.module.css';

export const dynamic = 'force-dynamic';

type PageProps = {
  searchParams: Promise<{ category?: string | string[]; sort?: string | string[] }>;
};

function categoryUiLabel(c: Category) {
  return POST_CATEGORY_OPTIONS.find((o) => o.value === c)?.label ?? c;
}

export default async function HomePage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const { category: filterCategory, sort: feedSort } = homeViewFromSearchParams(sp);

  const recentAll = await prisma.post.findMany({
    orderBy: { createdAt: 'desc' },
    take: 8,
    include: { author: { select: { username: true } } },
  });

  const firstHomeFeed = await fetchFeedPosts(feedSort, 0, 12, filterCategory, []);

  let heroLead: string;
  if (filterCategory) {
    heroLead = `${categoryUiLabel(filterCategory)} 복도입니다. 콘텐츠 탭으로 전체·인기·다른 복도를 전환할 수 있습니다.`;
  } else if (feedSort === 'hot') {
    heroLead = '조회·좋아요 반응을 반영한 인기 피드입니다. 탭으로 최신이나 복도별 보기로 바꿀 수 있습니다.';
  } else {
    heroLead = '네 개의 복도를 한 화면에서 탐색하세요. 콘텐츠 탭으로 정렬과 복도를 고릅니다.';
  }

  return (
    <>
      <SiteHeader />
      <main className={styles.mainShell}>
        <section className={styles.hero}>
          <p className={styles.eyebrow}>Four aisles, one workspace</p>
          <h1 className={styles.heroTitle}>
            {filterCategory ? (
              <>
                {categoryUiLabel(filterCategory)} <span style={{ fontWeight: 600 }}>aisle</span>
              </>
            ) : (
              <>
                실험하고, 전시하고,
                <br />
                빌드하고, 출시하세요.
              </>
            )}
          </h1>
          <p className={styles.heroLead}>{heroLead}</p>
        </section>

        <section className={styles.section}>
          <div
            className={[
              styles.feedLayoutRow,
              !SHOW_HOME_MAIN_HERO ? styles.feedLayoutRowNoHero : '',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            {SHOW_HOME_MAIN_HERO ? (
              <div className={styles.feedLayoutHeroFull}>
                <HomeMainHero />
              </div>
            ) : null}
            <div className={styles.feedLayoutAside}>
              <TodaysBest />
            </div>
            <div className={styles.feedLayoutMainFeed}>
              <HomeAllFeed
                key={`${feedSort}-${filterCategory ?? 'all'}`}
                sort={feedSort}
                category={filterCategory}
                excludeIds={[]}
                initialPosts={firstHomeFeed.posts.map(serializeFeedPost)}
                initialHasMore={firstHomeFeed.hasMore}
              />
            </div>
          </div>
        </section>

        <section className={styles.section} style={{ paddingTop: 0 }}>
          <div className={styles.widget} style={{ maxWidth: 520 }}>
            <h3>최근 8개 (전체 복도)</h3>
            {recentAll.length === 0 ? (
              <p className={styles.emptyInline}>
                아직 게시글이 없습니다. 첫 번째 주인공이 되어보세요!{' '}
                <Link href="/upload">업로드 페이지로 이동</Link>
              </p>
            ) : (
              <ul className={styles.builders}>
                {recentAll.map((post) => (
                  <li key={post.id} className={styles.builderRow}>
                    <Link href={`/post/${post.id}`} className={styles.recentLink}>
                      {post.thumbnail ? (
                        <div className={styles.recentThumb}>
                          <MediaThumb url={post.thumbnail} alt={post.title} />
                        </div>
                      ) : (
                        <span className={styles.avatar} aria-hidden />
                      )}
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div className={styles.recentTitle}>{post.title}</div>
                        <div className={styles.recentMeta}>
                          {categoryUiLabel(post.category)} · {post.author.username}
                        </div>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </main>
      <footer className={styles.footer}>
        <span>AIsle</span>
        <span className={styles.footerMuted}>Supabase Auth · Prisma · Next.js</span>
      </footer>
    </>
  );
}
