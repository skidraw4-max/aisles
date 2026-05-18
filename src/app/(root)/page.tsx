import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { SiteFooter } from '@/components/SiteFooter';
import { RecentPostListThumb } from '@/components/RecentPostListThumb';
import { HomeMainHero } from '@/components/HomeMainHero';
import { HomeContentTabs } from '@/components/HomeContentTabs';
import { HomeQuasarBoard } from '@/components/HomeQuasarBoard';
import { HomeDeferredLower } from '@/components/HomeDeferredLower';
import { SHOW_HOME_MAIN_HERO } from '@/lib/home-flags';
import { homeViewFromSearchParams } from '@/lib/content-tab';
import { isSupabaseAuthLinkError } from '@/lib/supabase-auth-url-errors';
import { categoryKeyForCache, getHomePageQueries } from '@/lib/home-page-data';
import { serializeFeedPost, type HomeFeedPost } from '@/lib/home-feed';
import { applyTemplate, corridorLabel, getAllUiLabels } from '@/lib/ui-config';
import { parseHomeCategoryQuery } from '@/lib/post-categories';
import { getCanonicalSiteUrl } from '@/lib/canonical-site-url';
import type { Category } from '@prisma/client';
import styles from './page.module.css';

const AI_FORTUNE_SEO_TITLE = 'AI FORTUNE — AI로 보는 주간 운세 및 커리어 가이드';
const AI_FORTUNE_SEO_DESCRIPTION =
  '지난주 글로벌 AI 트렌드를 바탕으로, 행운의 키워드·피해야 할 행동·추천 학습 분야를 유머러스하게 전해 드리는 AIsle 주간 운세 복도입니다. My Aisle에서 MBTI를 등록하면 맞춤 가이드를 준비할 수 있습니다.';

type PageProps = {
  searchParams: Promise<{
    category?: string | string[];
    sort?: string | string[];
    error?: string | string[];
    error_code?: string | string[];
    error_description?: string | string[];
  }>;
};

/** 60초 ISR — 동일 URL·복도 조합은 캐시된 RSC 페이로드 재사용 */
export const revalidate = 60;

export async function generateMetadata({ searchParams }: PageProps): Promise<Metadata> {
  const sp = await searchParams;
  const category = parseHomeCategoryQuery(sp.category);
  if (category !== 'AI_FORTUNE') {
    return {};
  }
  const siteUrl = getCanonicalSiteUrl();
  const pageUrl = `${siteUrl}/?category=AI_FORTUNE`;
  return {
    title: AI_FORTUNE_SEO_TITLE,
    description: AI_FORTUNE_SEO_DESCRIPTION,
    alternates: { canonical: pageUrl },
    openGraph: {
      title: AI_FORTUNE_SEO_TITLE,
      description: AI_FORTUNE_SEO_DESCRIPTION,
      url: pageUrl,
    },
  };
}

function pickSearchParam(v: string | string[] | undefined): string | undefined {
  if (v === undefined) return undefined;
  return Array.isArray(v) ? v[0] : v;
}

function launchBannerImageUrl(post: Pick<HomeFeedPost, 'thumbnail' | 'attachmentUrls'>): string | null {
  const t = post.thumbnail?.trim();
  if (t) return t;
  const u = post.attachmentUrls?.find((x) => Boolean(x?.trim()));
  return u?.trim() || null;
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

  const cacheKey = categoryKeyForCache(filterCategory);
  const [ui, { recentAll, firstHomeFeed, launchBannerPosts }] = await Promise.all([
    getAllUiLabels(),
    getHomePageQueries(cacheKey),
  ]);

  const launchSlides = launchBannerPosts.map((p) => ({
    id: p.id,
    title: p.title,
    imageUrl: launchBannerImageUrl(p),
  }));

  const heroLead = filterCategory
    ? applyTemplate(ui['home.hero.lead_filtered'] ?? '', {
        category: corridorLabel(ui, filterCategory),
      })
    : (ui['home.hero.lead_home'] ?? '');

  return (
    <>
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
          <p className={styles.eyebrow}>
            {filterCategory ? ui['home.hero.eyebrow_filtered'] : ui['home.hero.eyebrow_home']}
          </p>
          <h1
            className={
              filterCategory ? styles.heroTitle : `${styles.heroTitle} ${styles.heroTitleHome}`
            }
          >
            {filterCategory ? (
              <>
                {corridorLabel(ui, filterCategory)} <span style={{ fontWeight: 600 }}>aisle</span>
              </>
            ) : (
              <>
                <span className={styles.heroTitleLine}>{ui['home.hero.title_home_line1']}</span>
                <span className={styles.heroTitleLine}>
                  <span className={styles.heroTitleAccent}>{ui['home.hero.title_home_line2_accent']}</span>
                  <span className={styles.heroTitleRest}>{ui['home.hero.title_home_line2_rest']}</span>
                </span>
              </>
            )}
          </h1>
          <p
            className={
              filterCategory ? styles.heroLead : `${styles.heroLead} ${styles.heroLeadHome}`
            }
          >
            {heroLead}
          </p>
          {!filterCategory ? (
            <div className={styles.heroCtaRow}>
              <Link href="/?category=LAB" className={styles.heroCtaPrimary}>
                {ui['home.hero.cta_primary']}
              </Link>
            </div>
          ) : null}
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
          <section
            className={`${styles.section} ${styles.sectionQuasarBeforeFeed}`}
            style={{ paddingTop: 8 }}
          >
            <HomeQuasarBoard />
          </section>
        ) : null}

        <section
          className={`${styles.section} ${!filterCategory ? styles.sectionFeedAfterQuasar : ''}`}
        >
          {filterCategory ? (
            <div className={styles.feedBadgeRow}>
              <span className={styles.badge}>{corridorLabel(ui, filterCategory)}</span>
            </div>
          ) : null}
          <HomeDeferredLower
            heroColumn={
              filterCategory && SHOW_HOME_MAIN_HERO ? (
                <div className={styles.feedLayoutHeroFull}>
                  <HomeMainHero />
                </div>
              ) : null
            }
            layoutRowNoHero={!filterCategory || !SHOW_HOME_MAIN_HERO}
            recentAside={
              <aside className={styles.recentPostsAside} aria-labelledby="recent-posts-aside-heading">
                <h3 id="recent-posts-aside-heading" className={styles.recentPostsAsideTitle}>
                  {ui['home.recent.title']}
                </h3>
                {recentAll.length === 0 ? (
                  <p className={styles.recentPostsAsideEmpty}>
                    {ui['home.recent.empty']}{' '}
                    <Link href="/upload">업로드</Link>
                  </p>
                ) : (
                  <ul className={styles.builders}>
                    {recentAll.map((post) => (
                      <li key={post.id} className={styles.builderRow}>
                        <Link href={`/post/${post.id}`} className={styles.recentLink}>
                          <div className={styles.recentThumb}>
                            <RecentPostListThumb
                              thumbnail={post.thumbnail}
                              category={post.category}
                              title={post.title}
                              metadataParams={post.metadata?.params}
                            />
                          </div>
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <div className={styles.recentTitle}>{post.title}</div>
                            <div className={styles.recentMeta}>
                              {corridorLabel(ui, post.category)} · {post.author.username}
                            </div>
                          </div>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </aside>
            }
            filterCategory={filterCategory}
            launchSlides={launchSlides}
            homeAllFeed={{
              feedKey: filterCategory ?? 'all',
              category: filterCategory,
              excludeIds: [],
              initialPosts: firstHomeFeed.posts.map(serializeFeedPost),
              initialHasMore: firstHomeFeed.hasMore,
            }}
          />
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
