import { notFound } from 'next/navigation';
import { after } from 'next/server';
import { Suspense } from 'react';
import type { Metadata } from 'next';
import type { Category, Role } from '@prisma/client';
import { MediaThumb } from '@/components/MediaThumb';
import {
  EMPTY_POST_SIDEBAR,
  getPostComments,
  getPostDetail,
  getPostMetadataFields,
  getPostSidebarData,
} from '@/lib/post-page-data';
import { homeHrefForCategory, labKindFromMetadataParams } from '@/lib/post-categories';
import { corridorLabel, getAllUiLabels } from '@/lib/ui-config';
import { defaultUiLabelMap } from '@/lib/ui-config-defaults';
import { resolveRecipePrompt } from '@/lib/recipe-prompt';
import { fingerprintPrompt } from '@/lib/prompt-analysis-fingerprint';
import { parseStoredPromptAnalysisJson } from '@/lib/prompt-analysis';
import { PostEngagement } from './PostEngagement';
import { PostEngagementProviders } from './PostEngagementProviders';
import { PostViewerProvider } from './PostViewerContext';
import { PostSocialIndicatorBarClient } from './PostSocialIndicatorBarClient';
import { PostAuthorAvatar } from './PostAuthorAvatar';
import { PostOwnerActionsGate } from './PostOwnerActionsGate';
import { PostAiAnalysisWithViewer } from './PostAiAnalysisWithViewer';
import { GalleryAiExtrasGate } from './GalleryAiExtrasGate';
import { RecipePromptSection } from './RecipePromptSection';
import { GalleryPostMedia } from './GalleryPostMedia';
import { BuildLaunchDoc } from './BuildLaunchDoc';
import { PostTopBreadcrumb } from './PostTopBreadcrumb';
import { PostSidebar } from './PostSidebar';
import { PostAdjacentNav } from './PostAdjacentNav';
import { DosDontsSection } from './DosDontsSection';
import { ExternalServiceCta } from './ExternalServiceCta';
import { LaunchVisitProjectCta } from './LaunchVisitProjectCta';
import {
  GalleryImageReverseFallback,
  GalleryImageReverseFromDb,
  GalleryImageReverseSection,
} from './GalleryImageReverse';
import { PostCategoryBoardList } from './PostCategoryBoardList';
import { PostTags } from './PostTags';
import { incrementPostViews } from './actions';
import { PostRichContent } from '@/lib/PostRichContent';
import { getCanonicalSiteUrl } from '@/lib/canonical-site-url';
import { categoryUsesDynamicPostOg } from '@/lib/post-dynamic-og';
import { buildPostMetaDescription } from '@/lib/post-meta-description';
import { SEO_ROBOTS_PUBLIC } from '@/lib/seo-robots';
import { PostDescriptionEmptyCallout } from './PostDescriptionEmptyCallout';
import { AiFortunePostView } from './AiFortunePostView';
import { AiFortunePromoBanner } from './AiFortunePromoBanner';
import { PostRelatedPosts } from './PostRelatedPosts';
import { PostScrollSubscribeModal } from './PostScrollSubscribeModalLoader';
import { PostContentGroupAnalytics } from './PostContentGroupAnalytics';
import { ContentReportLink } from '@/components/ContentReportLink';
import { getKstParts, weekOfMonthKst } from '@/lib/ai-fortune/kst-week';
import { aiFortunePayloadFromDb } from '@/lib/ai-fortune/payload';
import { buildPostArticleJsonLd } from '@/lib/post-json-ld';
import styles from './post.module.css';

/** 3600초 ISR — 좋아요·북마크·조회수 개인화는 클라이언트·API 분리 */
export const revalidate = 3600;

/** lucide 에 Youtube 전용 마크가 없어 브랜드에 가까운 간단 SVG 사용 */
function YoutubeGlyph({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" width={24} height={24} aria-hidden>
      <path
        fill="currentColor"
        d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"
      />
    </svg>
  );
}

type Props = {
  params: Promise<{ id: string }>;
};

function categoryTagClass(category: string): string {
  switch (category) {
    case 'RECIPE':
      return styles.tagLab;
    case 'GALLERY':
      return styles.tagGallery;
    case 'LOUNGE':
      return styles.tagLounge;
    case 'GOSSIP':
      return styles.tagGossip;
    case 'BUILD':
      return styles.tagBuild;
    case 'LAUNCH':
      return styles.tagLaunch;
    case 'TREND':
      return styles.tagTrend;
    default:
      return styles.tagDefault;
  }
}

function formatDateShort(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}.${m}.${day}`;
}

function roleLabel(role: Role) {
  switch (role) {
    case 'ADMIN':
      return '운영자';
    case 'BUILDER':
      return '빌더';
    default:
      return '멤버';
  }
}

function excerptFrom(text: string | null | undefined) {
  const t = text?.trim() ?? '';
  if (!t) return 'AIsle에서 인기 있는 글입니다.';
  return t.length > 96 ? `${t.slice(0, 96)}…` : t;
}

function galleryHeroImageUrl(post: { thumbnail: string | null; attachmentUrls: string[] }): string | null {
  const t = post.thumbnail?.trim();
  if (t) return t;
  const a = post.attachmentUrls.find((u) => u?.trim());
  return a?.trim() ?? null;
}

function isProbablyVideoAssetUrl(url: string): boolean {
  return /\.(mp4|webm|mov)(\?|#|$)/i.test(url);
}

function toAbsoluteMediaUrl(raw: string, siteBase: string): string {
  const u = raw.trim();
  if (u.startsWith('http://') || u.startsWith('https://')) return u;
  if (u.startsWith('//')) return `https:${u}`;
  return new URL(u.startsWith('/') ? u : `/${u}`, siteBase).href;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const base = getCanonicalSiteUrl();
  let ui: Record<string, string>;
  try {
    ui = await getAllUiLabels();
  } catch {
    ui = defaultUiLabelMap();
  }
  try {
    const post = await getPostMetadataFields(id);
    if (!post) return { title: '게시글 — AIsle' };
    const catLabel = corridorLabel(ui, post.category);
    const description = buildPostMetaDescription({
      title: post.title,
      content: post.content,
      categoryLabel: catLabel,
    });
    const docTitle = `${post.title} · ${catLabel} | AIsle`;
    const socialTitle = `${post.title} · ${catLabel}`;
    const url = `${base}/post/${id}`;
    const thumbRaw = post.thumbnail?.trim();
    const thumbAbs =
      thumbRaw && (thumbRaw.startsWith('http://') || thumbRaw.startsWith('https://'))
        ? thumbRaw
        : thumbRaw
          ? new URL(thumbRaw.startsWith('/') ? thumbRaw : `/${thumbRaw}`, base).href
          : undefined;
    const defaultOg = new URL('/og-image.png', base).href;
    const dynamicOgUrl = new URL(`/og/post/${id}`, base).href;
    const ogAlt = `${post.title} — AIsle 공유 카드`;
    const ogImages = categoryUsesDynamicPostOg(post.category)
      ? [{ url: dynamicOgUrl, width: 1200, height: 630, alt: ogAlt }]
      : thumbAbs
        ? [{ url: thumbAbs, alt: post.title }]
        : [{ url: defaultOg, width: 1200, height: 630, alt: post.title }];
    return {
      title: docTitle,
      description,
      keywords: [post.title, catLabel, 'AIsle', 'AI', '프롬프트'].filter(Boolean),
      alternates: { canonical: url },
      robots: SEO_ROBOTS_PUBLIC,
      openGraph: {
        type: 'article',
        locale: 'ko_KR',
        siteName: 'AIsle',
        url,
        title: socialTitle,
        description,
        publishedTime: post.createdAt.toISOString(),
        images: ogImages,
      },
      twitter: {
        card: 'summary_large_image',
        title: socialTitle,
        description,
        images: ogImages,
      },
    };
  } catch {
    return { title: '게시글 — AIsle' };
  }
}

export default async function PostPage({ params }: Props) {
  const { id } = await params;
  let ui: Record<string, string>;
  try {
    ui = await getAllUiLabels();
  } catch {
    ui = defaultUiLabelMap();
  }
  let post;
  try {
    post = await getPostDetail(id);
  } catch {
    notFound();
  }
  if (!post) notFound();

  after(() => {
    void incrementPostViews(post.id);
  });

  const [commentsResult, sidebarResult] = await Promise.allSettled([
    getPostComments(id),
    getPostSidebarData(post.id, post.category, post.createdAt),
  ]);

  const comments = commentsResult.status === 'fulfilled' ? commentsResult.value : [];
  const sidebarData =
    sidebarResult.status === 'fulfilled' ? sidebarResult.value : EMPTY_POST_SIDEBAR;
  const {
    relatedPosts,
    popularPosts,
    prevPost,
    nextPost,
    categoryBoardPosts,
    latestAiFortuneId,
  } = sidebarData;

  const initialComments = comments.map((c) => ({
    id: c.id,
    content: c.content,
    createdAt: c.createdAt.toISOString(),
    authorId: c.authorId,
    authorUsername: c.author.username,
    authorAvatarUrl: c.author.avatarUrl,
  }));

  if (post.category === 'AI_FORTUNE') {
    const { year, month } = getKstParts(post.createdAt);
    const weekLabel = `${year}년 ${month}월 ${weekOfMonthKst(post.createdAt)}주차`;
    const relatedSidebar = relatedPosts.map((p) => ({
      id: p.id,
      title: p.title,
      likeCount: p.likeCount,
    }));
    const popularSidebar = popularPosts.map((p) => ({
      id: p.id,
      title: p.title,
      thumbnail: p.thumbnail,
      likeCount: p.likeCount,
      excerpt: excerptFrom(p.content),
      category: p.category,
      metadataParams: p.metadata?.params,
    }));
    const fortunePayload = aiFortunePayloadFromDb(post.aiFortunePayload);
    const siteBaseFortune = getCanonicalSiteUrl();
    const fortuneJsonLd = buildPostArticleJsonLd({
      id: post.id,
      title: post.title,
      content: post.content,
      category: post.category,
      createdAt: post.createdAt,
      thumbnail: post.thumbnail,
      authorUsername: post.author.username,
      categoryLabel: corridorLabel(ui, post.category),
      siteBase: siteBaseFortune,
      aiFortuneTrendBullets: fortunePayload?.trendBullets,
    });
    return (
      <>
        <PostContentGroupAnalytics category={post.category} />
        {fortuneJsonLd ? (
          <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{ __html: JSON.stringify(fortuneJsonLd) }}
          />
        ) : null}
        <AiFortunePostView
        post={{
          id: post.id,
          title: post.title,
          content: post.content,
          category: post.category,
          createdAt: post.createdAt,
          likeCount: post.likeCount,
          author: { id: post.author.id, username: post.author.username },
          aiFortunePayload: post.aiFortunePayload,
        }}
        weekLabel={weekLabel}
        initialComments={initialComments}
        prevPost={prevPost}
        nextPost={nextPost}
        related={relatedSidebar}
        popular={popularSidebar}
        uiLabels={ui}
      />
      </>
    );
  }

  const aiFortuneCtaHref = latestAiFortuneId
    ? `/post/${latestAiFortuneId}`
    : '/?category=AI_FORTUNE';

  const isLab = post.category === 'RECIPE';
  const isGallery = post.category === 'GALLERY';
  const siteBase = getCanonicalSiteUrl();
  const postPageUrl = `${siteBase.replace(/\/$/, '')}/post/${post.id}`;
  const galleryRawUrl = isGallery ? galleryHeroImageUrl(post) : null;
  const galleryAnalysisUrl =
    galleryRawUrl && !isProbablyVideoAssetUrl(galleryRawUrl)
      ? toAbsoluteMediaUrl(galleryRawUrl, siteBase)
      : null;
  const isLoungeOrGossip = post.category === 'LOUNGE' || post.category === 'GOSSIP';
  const isBuildOrLaunch = post.category === 'BUILD' || post.category === 'LAUNCH';
  const hasHeroMedia = Boolean(post.thumbnail?.trim());
  const metaPrompt = post.metadata?.prompt?.trim() ?? '';
  const labPromptText = resolveRecipePrompt(post);
  const galleryAuthorPromptText = isGallery ? resolveRecipePrompt(post) : '';
  const labPromptFingerprint = labPromptText.trim() ? fingerprintPrompt(labPromptText) : '';
  const promptJobStatus = post.metadata?.promptAnalysisStatus ?? null;
  const initialCachedPromptAnalysis =
    isLab &&
    labPromptFingerprint &&
    post.metadata?.promptAnalysisPromptHash === labPromptFingerprint &&
    post.metadata.promptAnalysis != null &&
    promptJobStatus !== 'PENDING' &&
    promptJobStatus !== 'FAILED'
      ? parseStoredPromptAnalysisJson(post.metadata.promptAnalysis)
      : null;
  const ytId = post.youtubeVideoId?.trim() ?? '';
  const ytSourceRaw = post.youtubeSyndicationSource?.trim();
  const ytBadge =
    ytSourceRaw === 'MIT_OCW' ? '[MIT 연구]' : ytSourceRaw === 'DEEPMIND' ? '[DeepMind 공식]' : null;

  const showLabDescription =
    isLab &&
    Boolean(post.content?.trim()) &&
    (Boolean(metaPrompt) || Boolean(ytId));

  const relatedSidebar = relatedPosts.map((p) => ({
    id: p.id,
    title: p.title,
    likeCount: p.likeCount,
  }));

  const relatedPostsInline = relatedPosts.map((p) => ({
    id: p.id,
    title: p.title,
    thumbnail: p.thumbnail,
    category: p.category,
    authorUsername: p.author.username,
    metadataParams: p.metadata?.params,
  }));

  const popularSidebar = popularPosts.map((p) => ({
    id: p.id,
    title: p.title,
    thumbnail: p.thumbnail,
    likeCount: p.likeCount,
    excerpt: excerptFrom(p.content),
    category: p.category,
    metadataParams: p.metadata?.params,
  }));

  const listHref = homeHrefForCategory(post.category);

  const categoryBoardItems = categoryBoardPosts.map((p) => ({
    id: p.id,
    title: p.title,
    views: p.views,
    authorUsername: p.author.username,
    commentCount: p._count.comments,
  }));
  /** 자동 수집 글(GeekNews·HN·Lobsters·Techmeme·Verge 등)은 원문 URL이 전용 필드에만 있을 수 있음 → 방문 CTA용으로 통합 */
  const externalHref = (
    post.externalLink ??
    post.geeknewsOriginalUrl ??
    post.hackerNewsOriginalUrl ??
    post.lobstersOriginalUrl ??
    post.techmemeOriginalUrl ??
    post.vergeOriginalUrl ??
    post.aiBreakfastOriginalUrl ??
    post.mitNewsOriginalUrl ??
    (ytId ? `https://www.youtube.com/watch?v=${ytId}` : '')
  ).trim();
  const extraAttachments = (post.attachmentUrls ?? []).filter((u) => u.trim().length > 0);
  const catLabel = corridorLabel(ui, post.category);
  const heroCaption = post.metadata?.modelName
    ? `모델 · ${post.metadata.modelName}`
    : `${catLabel} · 대표 미디어`;

  const authorInitials = post.author.username.trim().slice(0, 2).toUpperCase() || '?';

  const titleLaunchCta =
    post.category === 'LAUNCH' && externalHref ? (
      <LaunchVisitProjectCta href={externalHref} size="hero" />
    ) : null;

  const postDetailHeader = (
    <header className={styles.magazinePostHeader}>
      <span className={`${styles.categoryTag} ${categoryTagClass(post.category)}`}>{catLabel}</span>
      <div
        className={
          titleLaunchCta
            ? `${styles.magazineTitleWrap} ${styles.magazineTitleWrapLaunch}`
            : styles.magazineTitleWrap
        }
      >
        {ytId ? (
          <div className={styles.youtubeTitleRow}>
            <YoutubeGlyph className={styles.titleYoutubeIcon} />
            {ytBadge ? <span className={styles.youtubeSourceBadge}>{ytBadge}</span> : null}
            <h1 className={styles.magazineTitle}>{post.title}</h1>
          </div>
        ) : (
          <h1 className={styles.magazineTitle}>{post.title}</h1>
        )}
        {titleLaunchCta}
      </div>
      <PostSocialIndicatorBarClient cachedViews={post.views} commentCount={comments.length} />
      <div className={styles.authorStatsRow}>
        <div className={styles.authorBlock}>
          {post.author.avatarUrl ? (
            <PostAuthorAvatar
              src={post.author.avatarUrl}
              alt={`${post.author.username} 프로필`}
            />
          ) : (
            <div className={styles.authorAvatar}>
              <span className={styles.authorAvatarFallback} title={post.author.username}>
                {authorInitials}
              </span>
            </div>
          )}
          <div className={styles.authorText}>
            <p className={styles.authorName}>{post.author.username}</p>
            <span className={styles.authorRolePill}>{roleLabel(post.author.role)}</span>
          </div>
        </div>
        <div className={styles.statsBlock}>
          <time
            className={styles.statItem}
            dateTime={post.createdAt.toISOString()}
            title={post.createdAt.toLocaleString('ko-KR')}
          >
            {formatDateShort(post.createdAt)}
          </time>
        </div>
      </div>
    </header>
  );

  const mainMediaBlock = isGallery ? (
    <div className={styles.galleryMagazineBlock}>
      <GalleryPostMedia url={post.thumbnail} alt={post.title} compact />
      <p className={styles.magazineCaption}>{heroCaption}</p>
    </div>
  ) : isLoungeOrGossip && !hasHeroMedia ? null : (
    <div className={styles.magazineHeroWrap}>
      <figure className={styles.magazineHeroFigure}>
        {post.thumbnail ? (
          <div className={styles.magazineHeroInner}>
            <MediaThumb
              url={post.thumbnail}
              alt={post.title}
              objectFit="contain"
              videoControls
              intrinsic
            />
          </div>
        ) : (
          <div className={styles.magazineHeroInner}>
            <div className={styles.heroMediaPlaceholder} />
          </div>
        )}
      </figure>
      <p className={styles.magazineCaption}>{heroCaption}</p>
    </div>
  );

  const sidebar = (
    <div className={styles.magazineSidebar}>
      <PostSidebar
        category={post.category}
        related={relatedSidebar}
        popular={popularSidebar}
        externalLink={externalHref || null}
        uiLabels={ui}
      />
    </div>
  );

  const articleJsonLd = buildPostArticleJsonLd({
    id: post.id,
    title: post.title,
    content: post.content,
    category: post.category,
    createdAt: post.createdAt,
    thumbnail: post.thumbnail,
    authorUsername: post.author.username,
    categoryLabel: catLabel,
    siteBase,
    externalLink: post.externalLink,
    geeknewsOriginalUrl: post.geeknewsOriginalUrl,
    hackerNewsOriginalUrl: post.hackerNewsOriginalUrl,
    lobstersOriginalUrl: post.lobstersOriginalUrl,
    techmemeOriginalUrl: post.techmemeOriginalUrl,
    vergeOriginalUrl: post.vergeOriginalUrl,
    aiBreakfastOriginalUrl: post.aiBreakfastOriginalUrl,
    mitNewsOriginalUrl: post.mitNewsOriginalUrl,
    youtubeVideoId: post.youtubeVideoId,
  });

  return (
    <>
      <PostContentGroupAnalytics category={post.category} />
      {articleJsonLd ? (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(articleJsonLd) }}
        />
      ) : null}
      <main className={styles.magazineShell}>
        <div className={styles.magazineInner}>
          <div className={styles.magazineGrid}>
            <div className={styles.magazineMainCol}>
              <article className={styles.magazineArticle}>
                <PostViewerProvider postId={post.id}>
                  <PostEngagementProviders postId={post.id} initialLikeCount={post.likeCount}>
                  <PostTopBreadcrumb category={post.category} label={catLabel} />
                  {isGallery ? (
                    <>
                      {mainMediaBlock}
                      {postDetailHeader}
                    </>
                  ) : (
                    <>
                      {postDetailHeader}
                      {ytId ? (
                        <div className={styles.youtubeEmbedShell}>
                          <iframe
                            title="YouTube 영상"
                            className={styles.youtubeEmbedFrame}
                            src={`https://www.youtube.com/embed/${ytId}`}
                            loading="lazy"
                            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                            allowFullScreen
                          />
                        </div>
                      ) : null}
                      {showLabDescription && post.content ? (
                        <PostRichContent
                          text={post.content}
                          className={styles.magazineIntro}
                          textClassName={styles.postRichInline}
                          embedMediaClassName={styles.postBodyEmbed}
                        />
                      ) : null}
                      {!ytId ? mainMediaBlock : null}
                    </>
                  )}

                {isGallery && showLabDescription && post.content ? (
                  <div className={`${styles.magazineBodyCard} ${styles.magazineCard}`}>
                    <h2 className={styles.bodyLabel}>설명</h2>
                    <PostRichContent
                      text={post.content}
                      className={styles.body}
                      textClassName={styles.postRichInline}
                      embedMediaClassName={styles.postBodyEmbed}
                    />
                  </div>
                ) : null}

                {isGallery && galleryAnalysisUrl ? (
                  <GalleryAiExtrasGate
                    postId={post.id}
                    loggedInContent={
                      post.aiReversePrompt?.trim() ? (
                        <GalleryImageReverseFromDb
                          authorOriginalPrompt={galleryAuthorPromptText}
                          aiReversePrompt={post.aiReversePrompt}
                          aiImageAnalysis={
                            post.aiImageAnalysis != null &&
                            typeof post.aiImageAnalysis === 'object' &&
                            !Array.isArray(post.aiImageAnalysis)
                              ? (post.aiImageAnalysis as Record<string, unknown>)
                              : null
                          }
                        />
                      ) : (
                        <Suspense fallback={<GalleryImageReverseFallback />}>
                          <GalleryImageReverseSection
                            postId={post.id}
                            imageUrl={galleryAnalysisUrl}
                            authorOriginalPrompt={galleryAuthorPromptText}
                          />
                        </Suspense>
                      )
                    }
                  />
                ) : null}

                {isGallery && post.category === 'BUILD' && externalHref ? (
                  <ExternalServiceCta href={externalHref} variant="buildBand" />
                ) : null}

                {isLab && !ytId ? <RecipePromptSection promptText={labPromptText} /> : null}
                {isLab && !ytId ? <DosDontsSection /> : null}
                {isLab && labPromptText.trim() && !ytId ? (
                  <PostAiAnalysisWithViewer
                    postId={post.id}
                    promptText={labPromptText}
                    serverCachedAnalysis={initialCachedPromptAnalysis}
                    promptAnalysisJobStatus={promptJobStatus}
                    loginNextPath={`/post/${post.id}`}
                  />
                ) : null}

                {!isGallery && isBuildOrLaunch ? (
                  <>
                    <BuildLaunchDoc
                      category={post.category}
                      content={post.content}
                      serviceUrl={post.launchInfo?.serviceUrl}
                      status={post.launchInfo?.status}
                    />
                    {post.category === 'BUILD' && externalHref ? (
                      <ExternalServiceCta href={externalHref} variant="buildBand" />
                    ) : null}
                  </>
                ) : null}

                {!isGallery &&
                !isBuildOrLaunch &&
                post.content &&
                !(isLab && ytId) ? (
                  <div className={`${styles.magazineBodyCard} ${styles.magazineCard}`}>
                    <h2 className={styles.bodyLabel}>설명</h2>
                    <PostRichContent
                      text={post.content}
                      className={styles.body}
                      textClassName={styles.postRichInline}
                      embedMediaClassName={styles.postBodyEmbed}
                    />
                  </div>
                ) : null}

                {extraAttachments.length > 0 ? (
                  <section className={styles.postAttachmentStrip} aria-label="추가 첨부 미디어">
                    <h2 className={styles.bodyLabel}>첨부 미디어</h2>
                    <ul className={styles.postAttachmentGrid}>
                      {extraAttachments.map((url) => (
                        <li key={url}>
                          <div className={styles.postAttachmentCell}>
                            <MediaThumb url={url} alt="" objectFit="cover" videoControls />
                          </div>
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}

                {!isGallery && !isBuildOrLaunch && post.metadata && (post.metadata.modelName || post.metadata.params != null) ? (
                  <div className={`${styles.aiMeta} ${styles.magazineCard}`}>
                    {post.metadata.modelName ? <div>모델: {post.metadata.modelName}</div> : null}
                    {post.metadata.params != null ? (
                      <div style={{ marginTop: '0.35rem' }}>
                        {post.category === 'RECIPE' ? (
                          <span>
                            {labKindFromMetadataParams(post.metadata.params) === 'marketing'
                              ? 'LAB 콘텐츠 유형: 마케팅·카피(텍스트)'
                              : 'LAB 콘텐츠 유형: 이미지·비주얼'}
                          </span>
                        ) : (
                          <>
                            파라미터: <code>{JSON.stringify(post.metadata.params)}</code>
                          </>
                        )}
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {externalHref && post.category !== 'LAUNCH' && post.category !== 'BUILD' ? (
                  <ExternalServiceCta href={externalHref} variant="buildBand" />
                ) : null}

                {post.category === 'LAUNCH' && externalHref ? (
                  <LaunchVisitProjectCta href={externalHref} size="footer" />
                ) : null}

                {!String(post.content ?? '').trim() ? (
                  <PostDescriptionEmptyCallout category={post.category} />
                ) : null}

                <PostTags tags={post.tags} />

                <AiFortunePromoBanner
                  ctaHref={aiFortuneCtaHref}
                  postId={post.id}
                  category={post.category}
                />

                <PostRelatedPosts fromPostId={post.id} posts={relatedPostsInline} />

                  <PostEngagement
                    postId={post.id}
                    initialComments={initialComments}
                    currentUserId={null}
                    currentUsername={null}
                    currentAvatarUrl={null}
                    listHref={listHref}
                    adjacentNav={<PostAdjacentNav prev={prevPost} next={nextPost} />}
                  />

                  <ContentReportLink postUrl={postPageUrl} />

                  <PostOwnerActionsGate
                    postId={post.id}
                    postTitle={post.title}
                    authorId={post.authorId}
                    afterDeleteHref={listHref}
                  />

                  <PostCategoryBoardList
                    category={post.category}
                    categoryLabel={catLabel}
                    currentPostId={post.id}
                    posts={categoryBoardItems}
                  />
                  </PostEngagementProviders>
                </PostViewerProvider>
              </article>
            </div>
            {sidebar}
          </div>
        </div>
      </main>
      <PostScrollSubscribeModal postId={post.id} />
    </>
  );
}
