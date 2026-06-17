import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { SiteFooter } from '@/components/SiteFooter';
import { RecentPostListThumb } from '@/components/RecentPostListThumb';
import { HomeMainHero } from '@/components/HomeMainHero';
import { HomeHeroCarousel } from '@/components/HomeHeroCarouselLoader';
import { HomeContentTabs } from '@/components/HomeContentTabs';
import { HomeCorridorStripBanner } from '@/components/HomeCorridorStripBanner';
import { HomeQuasarBoard } from '@/components/HomeQuasarBoard';
import { HomeDeferredLower } from '@/components/HomeDeferredLower';
import { SHOW_HOME_MAIN_HERO } from '@/lib/home-flags';
import { homeViewFromSearchParams } from '@/lib/content-tab';
import { isSupabaseAuthLinkError } from '@/lib/supabase-auth-url-errors';
import { categoryKeyForCache, getHomePageQueries } from '@/lib/home-page-data';
import { serializeFeedPost, type HomeFeedPost } from '@/lib/home-feed';
import { applyTemplate, corridorLabel, getAllUiLabels } from '@/lib/ui-config';
import {
  categoryToHomeQuery,
  parseHomeCategoryQuery,
  shouldHideAuthorInRecentSidebar,
} from '@/lib/post-categories';
import { getCanonicalSiteUrl } from '@/lib/canonical-site-url';
import { buildHomeWebApplicationJsonLd } from '@/lib/home-web-application-json-ld';
import { fetchLatestAiFortunePost } from '@/lib/ai-fortune/latest-fortune.server';
import { AiFortuneCategoryIntro } from '@/components/AiFortuneCategoryIntro';
import { HomeFortuneCard } from '@/components/HomeFortuneCard';
import { BuildHubSection } from '@/components/BuildHubSection';
import { UgcWeeklyBest } from '@/components/UgcWeeklyBest';
import { fetchBuildPopularWeekly, fetchUgcWeeklyTop } from '@/lib/ugc-hub.server';
import type { Category } from '@prisma/client';
import styles from './page.module.css';

const AI_FORTUNE_SEO_TITLE = 'AI FORTUNE — AI로 보는 주간 운세 및 커리어 가이드';
const AI_FORTUNE_SEO_DESCRIPTION =
  '지난주 글로벌 AI 트렌드와 MBTI 16유형별 AI 활용 전략·행운의 키워드·피할 습관을 담은 AIsle 주간 운세 리포트입니다. 별도 가입 없이 전체 유형을 한눈에 볼 수 있습니다.';

type PageProps = {
  searchParams: Promise<{
    category?: string | string[];
    sort?: string | string[];
    error?: string | string[];
    error_code?: string | string[];
    error_description?: string | string[];
    posted?: string | string[];
  }>;
};

/** 60초 ISR — 동일 URL·복도 조합은 캐시된 RSC 페이로드 재사용 */
export const revalidate = 60;

export async function generateMetadata({ searchParams }: PageProps): Promise<Metadata> {
  const sp = await searchParams;
  const category = parseHomeCategoryQuery(sp.category);
  const siteUrl = getCanonicalSiteUrl();
  if (!category) {
    return { alternates: { canonical: siteUrl } };
  }
  const pageUrl = `${siteUrl}/?category=${categoryToHomeQuery(category)}`;
  if (category === 'AI_FORTUNE') {
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
  const ui = await getAllUiLabels();
  const label = corridorLabel(ui, category);
  return {
    alternates: { canonical: pageUrl },
    openGraph: { url: pageUrl, title: `${label} — AIsle` },
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
  const postedFlag = pickSearchParam(sp.posted);
  const ugcPostedMessage =
    postedFlag === 'launch'
      ? 'LAUNCH 글이 등록되었습니다. 메인 배너는 운영팀 검토 후 노출됩니다.'
      : postedFlag === 'build'
        ? 'BUILD 레시피가 등록되었습니다. 이번 주 인기 레시피 후보로 집계됩니다.'
        : null;

  const cacheKey = categoryKeyForCache(filterCategory);
  const showFortuneCard = !filterCategory || filterCategory === 'LOUNGE';
  const buildHub = filterCategory === 'BUILD';
  const ugcWeekly =
    filterCategory === 'BUILD' || filterCategory === 'LAUNCH' ? filterCategory : null;

  const [ui, { recentAll, firstHomeFeed, launchBannerPosts }, latestFortune, buildPopular, weeklyTop] =
    await Promise.all([
      getAllUiLabels(),
      getHomePageQueries(cacheKey),
      showFortuneCard ? fetchLatestAiFortunePost() : Promise.resolve(null),
      buildHub ? fetchBuildPopularWeekly(5) : Promise.resolve([]),
      ugcWeekly ? fetchUgcWeeklyTop(ugcWeekly, 5) : Promise.resolve([]),
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

  const webAppJsonLd = !filterCategory ? buildHomeWebApplicationJsonLd() : null;

  return (
    <>
      {webAppJsonLd ? (
        <script
          type="application/ld+json"
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: JSON.stringify(webAppJsonLd) }}
        />
      ) : null}
      {ugcPostedMessage ? (
        <div className={styles.supabaseLinkError} role="status" style={{ borderColor: 'rgba(34,197,94,0.35)' }}>
          <p className={styles.supabaseLinkErrorTitle}>{ugcPostedMessage}</p>
        </div>
      ) : null}
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
        {!filterCategory ? (
          <HomeHeroCarousel
            fortune={{
              eyebrow: 'AI FORTUNE · 주간 운세',
              titleLine1: '프로필에 MBTI를 등록하면',
              titleLine2: '내 유형 맞춤 AI FORTUNE을 매주 받아요',
              lead:
                '글로벌 AI 트렌드와 16유형별 활용 전략·행운 키워드·피할 습관을 담은 주간 리포트입니다. 프로필에서 MBTI를 저장하면 리포트에서 내 카드가 강조됩니다.',
              profileHref: '/profile#profile-mbti-heading',
              profileCtaLabel: '프로필 등록하러가기',
              fortuneHref: latestFortune
                ? `/post/${latestFortune.id}`
                : '/?category=AI_FORTUNE',
              fortuneLinkLabel: latestFortune ? '이번 주 AI FORTUNE 보기' : 'AI FORTUNE 복도 보기',
            }}
            prompt={{
              eyebrow: ui['home.hero.eyebrow_home'] ?? '',
              titleLine1: ui['home.hero.title_home_line1'] ?? '',
              titleLine2Accent: ui['home.hero.title_home_line2_accent'] ?? '',
              titleLine2Rest: ui['home.hero.title_home_line2_rest'] ?? '',
              lead: ui['home.hero.lead_home'] ?? '',
              ctaHref: '/?category=LAB',
              ctaLabel: ui['home.hero.cta_primary'] ?? '',
            }}
          />
        ) : (
          <section className={styles.hero}>
            <p className={styles.eyebrow}>{ui['home.hero.eyebrow_filtered']}</p>
            <h1 className={styles.heroTitle}>
              {corridorLabel(ui, filterCategory)} <span style={{ fontWeight: 600 }}>aisle</span>
            </h1>
            <p className={styles.heroLead}>{heroLead}</p>
          </section>
        )}

        <section className={styles.section} style={{ paddingTop: 12, paddingBottom: 8 }}>
          <Suspense fallback={<div className={styles.contentTabBarFallback} aria-hidden />}>
            <HomeContentTabs />
          </Suspense>
        </section>

        {filterCategory ? (
          <section className={`${styles.section} ${styles.corridorStripAdSection}`}>
            <HomeCorridorStripBanner remountKey={cacheKey} />
          </section>
        ) : null}

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
            <HomeQuasarBoard fortune={!filterCategory && latestFortune ? latestFortune : null} />
          </section>
        ) : null}

        <section
          className={`${styles.section} ${!filterCategory ? styles.sectionFeedAfterQuasar : ''}`}
        >
          <HomeDeferredLower
            key={cacheKey}
            mainFeedPrefix={
              filterCategory ? (
                <>
                  <div className={styles.feedBadgeRow}>
                    <span className={styles.badge}>{corridorLabel(ui, filterCategory)}</span>
                  </div>
                  {filterCategory === 'BUILD' && buildPopular.length > 0 ? (
                    <BuildHubSection
                      posts={buildPopular.map(serializeFeedPost)}
                      uploadHref="/upload?category=BUILD"
                    />
                  ) : null}
                  {ugcWeekly && weeklyTop.length > 0 ? (
                    <UgcWeeklyBest
                      categoryLabel={corridorLabel(ui, ugcWeekly)}
                      posts={weeklyTop}
                    />
                  ) : null}
                  {filterCategory === 'AI_FORTUNE' ? <AiFortuneCategoryIntro /> : null}
                </>
              ) : null
            }
            fortuneCard={
              filterCategory === 'LOUNGE' && latestFortune ? (
                <div className={styles.homeFortuneSlot}>
                  <HomeFortuneCard fortune={latestFortune} />
                </div>
              ) : null
            }
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
                              {corridorLabel(ui, post.category)}
                              {!shouldHideAuthorInRecentSidebar(post.category)
                                ? ` · ${post.author.username}`
                                : ''}
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
