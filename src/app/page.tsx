import Link from 'next/link';
import { Suspense } from 'react';
import { SiteHeader } from '@/components/SiteHeader';
import { SiteFooter } from '@/components/SiteFooter';
import { MediaThumb } from '@/components/MediaThumb';
import { HomeAllFeed } from '@/components/HomeAllFeed';
import { HomeMainHero } from '@/components/HomeMainHero';
import { TodaysBest } from '@/components/TodaysBest';
import { HomeContentTabs } from '@/components/HomeContentTabs';
import { HomeQuasarBoard } from '@/components/HomeQuasarBoard';
import { SHOW_HOME_MAIN_HERO } from '@/lib/home-flags';
import { prisma } from '@/lib/prisma';
import { homeViewFromSearchParams } from '@/lib/content-tab';
import { isSupabaseAuthLinkError } from '@/lib/supabase-auth-url-errors';
import { fetchFeedPosts, serializeFeedPost } from '@/lib/home-feed';
import { POST_CATEGORY_OPTIONS } from '@/lib/post-categories';
import type { Category } from '@prisma/client';
import styles from './page.module.css';

export const dynamic = 'force-dynamic';

type PageProps = {
  searchParams: Promise<{
    category?: string | string[];
    sort?: string | string[];
    error?: string | string[];
    error_code?: string | string[];
    error_description?: string | string[];
  }>;
};

function pickSearchParam(v: string | string[] | undefined): string | undefined {
  if (v === undefined) return undefined;
  return Array.isArray(v) ? v[0] : v;
}

function categoryUiLabel(c: Category) {
  return POST_CATEGORY_OPTIONS.find((o) => o.value === c)?.label ?? c;
}

export default async function HomePage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const { category: filterCategory } = homeViewFromSearchParams(sp);

  const authErrParams = new URLSearchParams();
  const ec = pickSearchParam(sp.error_code);
  const er = pickSearchParam(sp.error);
  const ed = pickSearchParam(sp.error_description);
  if (ec) authErrParams.set('error_code', ec);
  if (er) authErrParams.set('error', er);
  if (ed) authErrParams.set('error_description', ed);
  const showInvalidEmailLinkBanner = isSupabaseAuthLinkError(authErrParams);

  const recentAll = await prisma.post.findMany({
    orderBy: { createdAt: 'desc' },
    take: 8,
    include: { author: { select: { username: true } } },
  });

  const firstHomeFeed = await fetchFeedPosts(0, 12, filterCategory, []);

  let heroLead: string;
  if (filterCategory) {
    heroLead = `${categoryUiLabel(filterCategory)} 복도입니다. 콘텐츠 탭으로 전체나 다른 복도를 전환할 수 있습니다.`;
  } else {
    heroLead = '세상의 모든 AI 창작자와 함께 실험하고, 만들고, 성장하세요.';
  }

  return (
    <>
      <SiteHeader />
      {showInvalidEmailLinkBanner ? (
        <div className={styles.supabaseLinkError} role="alert">
          <p className={styles.supabaseLinkErrorTitle}>이메일 링크가 만료되었거나 유효하지 않습니다.</p>
          <p className={styles.supabaseLinkErrorHint}>
            비밀번호 재설정이 필요하면{' '}
            <Link href="/login" className={styles.supabaseLinkErrorLink}>
              로그인
            </Link>{' '}
            화면에서 다시 요청해 주세요.
          </p>
        </div>
      ) : null}
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
                Collect. Build. Launch.
                <br />
                with AIsleHub.
              </>
            )}
          </h1>
          <p className={styles.heroLead}>{heroLead}</p>
        </section>

        <section className={styles.section} style={{ paddingTop: 12, paddingBottom: 8 }}>
          <Suspense fallback={<div className={styles.contentTabBarFallback} aria-hidden />}>
            <HomeContentTabs />
          </Suspense>
        </section>

        {!filterCategory && SHOW_HOME_MAIN_HERO ? (
          <section className={`${styles.section} ${styles.quasarHeroBanner}`}>
            <div className={styles.feedLayoutHeroFull}>
              <HomeMainHero />
            </div>
          </section>
        ) : null}

        {!filterCategory ? (
          <section className={styles.section} style={{ paddingTop: 8 }}>
            <HomeQuasarBoard />
          </section>
        ) : null}

        <section className={styles.section}>
          <div className={styles.feedBadgeRow}>
            <span className={styles.badge}>{filterCategory ? categoryUiLabel(filterCategory) : 'ALL'}</span>
          </div>
          <div
            className={[
              styles.feedLayoutRow,
              !filterCategory || !SHOW_HOME_MAIN_HERO ? styles.feedLayoutRowNoHero : '',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            {filterCategory && SHOW_HOME_MAIN_HERO ? (
              <div className={styles.feedLayoutHeroFull}>
                <HomeMainHero />
              </div>
            ) : null}
            <div className={styles.feedLayoutAside}>
              <div className={styles.feedAsideStack}>
                <TodaysBest />
                <aside className={styles.recentPostsAside} aria-labelledby="recent-posts-aside-heading">
                  <h3 id="recent-posts-aside-heading" className={styles.recentPostsAsideTitle}>
                    최근 게시물
                  </h3>
                  {recentAll.length === 0 ? (
                    <p className={styles.recentPostsAsideEmpty}>
                      아직 게시글이 없습니다.{' '}
                      <Link href="/upload">업로드</Link>
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
                </aside>
              </div>
            </div>
            <div className={styles.feedLayoutMainFeed}>
              <HomeAllFeed
                key={filterCategory ?? 'all'}
                category={filterCategory}
                excludeIds={[]}
                initialPosts={firstHomeFeed.posts.map(serializeFeedPost)}
                initialHasMore={firstHomeFeed.hasMore}
              />
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
