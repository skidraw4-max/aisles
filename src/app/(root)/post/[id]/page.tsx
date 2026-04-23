import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import type { Metadata } from 'next';
import type { Category, Role } from '@prisma/client';
import { MediaThumb } from '@/components/MediaThumb';
import { prisma } from '@/lib/prisma';
import { createClient } from '@/lib/supabase/server';
import { homeHrefForCategory, labKindFromMetadataParams } from '@/lib/post-categories';
import { corridorLabel, getAllUiLabels } from '@/lib/ui-config';
import { resolveRecipePrompt } from '@/lib/recipe-prompt';
import { fingerprintPrompt } from '@/lib/prompt-analysis-fingerprint';
import { parseStoredPromptAnalysisJson } from '@/lib/prompt-analysis';
import { PostEngagement } from './PostEngagement';
import { PostLikeProvider } from './PostLikeContext';
import { PostSocialIndicatorBar } from './PostSocialIndicatorBar';
import { RecipePromptSection } from './RecipePromptSection';
import { GalleryPostMedia } from './GalleryPostMedia';
import { BuildLaunchDoc } from './BuildLaunchDoc';
import { PostTopBreadcrumb } from './PostTopBreadcrumb';
import { PostSidebar } from './PostSidebar';
import { PostAdjacentNav } from './PostAdjacentNav';
import { DosDontsSection } from './DosDontsSection';
import { ExternalServiceCta } from './ExternalServiceCta';
import { LaunchVisitProjectCta } from './LaunchVisitProjectCta';
import { PostAiAnalysis } from '@/components/post/PostAiAnalysis';
import {
  GalleryImageReverseFallback,
  GalleryImageReverseFromDb,
  GalleryImageReverseLoginShell,
  GalleryImageReverseSection,
} from './GalleryImageReverse';
import { PostCategoryBoardList } from './PostCategoryBoardList';
import { PostTags } from './PostTags';
import { incrementPostViews } from './actions';
import { PostOwnerActions } from './PostOwnerActions';
import { PostRichContent } from '@/lib/PostRichContent';
import { getCanonicalSiteUrl } from '@/lib/canonical-site-url';
import { buildPostMetaDescription } from '@/lib/post-meta-description';
import { PostDescriptionEmptyCallout } from './PostDescriptionEmptyCallout';
import styles from './post.module.css';

export const dynamic = 'force-dynamic';

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
  const ui = await getAllUiLabels();
  try {
    const post = await prisma.post.findUnique({
      where: { id },
      select: { title: true, content: true, thumbnail: true, createdAt: true, category: true },
    });
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
    const ogImages = thumbAbs
      ? [{ url: thumbAbs, alt: post.title }]
      : [{ url: defaultOg, width: 1200, height: 630, alt: post.title }];
    return {
      title: docTitle,
      description,
      keywords: [post.title, catLabel, 'AIsle', 'AI', '프롬프트'].filter(Boolean),
      alternates: { canonical: url },
      robots: { index: true, follow: true },
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
        images: ogImages.map((i) => i.url),
      },
    };
  } catch {
    return { title: '게시글 — AIsle' };
  }
}

export default async function PostPage({ params }: Props) {
  const { id } = await params;
  const ui = await getAllUiLabels();
  let post;
  try {
    post = await prisma.post.findUnique({
      where: { id },
      include: {
        author: true,
        metadata: true,
        launchInfo: true,
      },
    });
  } catch {
    notFound();
  }
  if (!post) notFound();

  /** 상세 페이지 요청마다 조회수 +1 (서버 액션) */
  let displayViews = post.views;
  const nextViews = await incrementPostViews(post.id);
  if (nextViews != null) {
    displayViews = nextViews;
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [likedRow, comments, meProfile, relatedPosts, weekPopular, prevPost, nextPost, categoryBoardPosts] =
    await Promise.all([
    user?.id
      ? prisma.postLike.findUnique({
          where: { postId_userId: { postId: id, userId: user.id } },
          select: { postId: true },
        })
      : Promise.resolve(null),
    prisma.comment.findMany({
      where: { postId: id },
      orderBy: { createdAt: 'asc' },
      include: { author: { select: { id: true, username: true, avatarUrl: true } } },
    }),
    user?.id
      ? prisma.user.findUnique({
          where: { id: user.id },
          select: { username: true, avatarUrl: true },
        })
      : Promise.resolve(null),
    prisma.post.findMany({
      where: { category: post.category, id: { not: id } },
      orderBy: { createdAt: 'desc' },
      take: 4,
      select: { id: true, title: true, likeCount: true },
    }),
    prisma.post.findMany({
      where: { id: { not: id }, createdAt: { gte: weekAgo } },
      orderBy: { likeCount: 'desc' },
      take: 3,
      select: {
        id: true,
        title: true,
        thumbnail: true,
        likeCount: true,
        content: true,
        category: true,
        metadata: { select: { params: true } },
      },
    }),
    prisma.post.findFirst({
      where: {
        category: post.category,
        id: { not: post.id },
        OR: [
          { createdAt: { lt: post.createdAt } },
          { AND: [{ createdAt: post.createdAt }, { id: { lt: post.id } }] },
        ],
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { id: true, title: true },
    }),
    prisma.post.findFirst({
      where: {
        category: post.category,
        id: { not: post.id },
        OR: [
          { createdAt: { gt: post.createdAt } },
          { AND: [{ createdAt: post.createdAt }, { id: { gt: post.id } }] },
        ],
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true, title: true },
    }),
    prisma.post.findMany({
      where: { category: post.category },
      orderBy: { createdAt: 'desc' },
      take: 150,
      select: {
        id: true,
        title: true,
        views: true,
        author: { select: { username: true } },
        _count: { select: { comments: true } },
      },
    }),
  ]);

  let popularPosts = weekPopular;
  if (popularPosts.length < 3) {
    const exclude = new Set<string>([id, ...popularPosts.map((p) => p.id)]);
    const more = await prisma.post.findMany({
      where: { id: { notIn: [...exclude] } },
      orderBy: { likeCount: 'desc' },
      take: 3 - popularPosts.length,
      select: {
        id: true,
        title: true,
        thumbnail: true,
        likeCount: true,
        content: true,
        category: true,
        metadata: { select: { params: true } },
      },
    });
    popularPosts = [...popularPosts, ...more];
  }

  const initialComments = comments.map((c) => ({
    id: c.id,
    content: c.content,
    createdAt: c.createdAt.toISOString(),
    authorId: c.authorId,
    authorUsername: c.author.username,
    authorAvatarUrl: c.author.avatarUrl,
  }));

  const isLab = post.category === 'RECIPE';
  const isGallery = post.category === 'GALLERY';
  const siteBase = getCanonicalSiteUrl();
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
    Boolean(user) &&
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
  /** 자동 수집 글(GeekNews·HN·Verge)은 원문 URL이 전용 필드에만 있을 수 있음 → 방문 CTA용으로 통합 */
  const externalHref = (
    post.externalLink ??
    post.geeknewsOriginalUrl ??
    post.hackerNewsOriginalUrl ??
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
      <PostSocialIndicatorBar views={displayViews} commentCount={comments.length} />
      <div className={styles.authorStatsRow}>
        <div className={styles.authorBlock}>
          <div className={styles.authorAvatar}>
            {post.author.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- 외부 R2 URL
              <img
                src={post.author.avatarUrl}
                alt={`${post.author.username} 프로필`}
                className={styles.authorAvatarImg}
              />
            ) : (
              <span className={styles.authorAvatarFallback} title={post.author.username}>
                {authorInitials}
              </span>
            )}
          </div>
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

  return (
    <>
      <main className={styles.magazineShell}>
        <div className={styles.magazineInner}>
          <div className={styles.magazineGrid}>
            <div className={styles.magazineMainCol}>
              <article className={styles.magazineArticle}>
                <PostLikeProvider
                  postId={post.id}
                  initialLikeCount={post.likeCount}
                  initialLiked={Boolean(likedRow)}
                >
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
                  ) : user ? (
                    <Suspense fallback={<GalleryImageReverseFallback />}>
                      <GalleryImageReverseSection
                        postId={post.id}
                        imageUrl={galleryAnalysisUrl}
                        authorOriginalPrompt={galleryAuthorPromptText}
                      />
                    </Suspense>
                  ) : (
                    <GalleryImageReverseLoginShell loginNextPath={`/post/${post.id}`} />
                  )
                ) : null}

                {isGallery && post.category === 'BUILD' && externalHref ? (
                  <ExternalServiceCta href={externalHref} variant="buildBand" />
                ) : null}

                {isLab && !ytId ? <RecipePromptSection promptText={labPromptText} /> : null}
                {isLab && !ytId ? <DosDontsSection /> : null}
                {isLab && labPromptText.trim() && !ytId ? (
                  <PostAiAnalysis
                    postId={post.id}
                    promptText={labPromptText}
                    initialCachedAnalysis={initialCachedPromptAnalysis}
                    promptAnalysisJobStatus={promptJobStatus}
                    isLoggedIn={Boolean(user)}
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

                  <PostEngagement
                    postId={post.id}
                    initialComments={initialComments}
                    currentUserId={user?.id ?? null}
                    currentUsername={meProfile?.username ?? null}
                    currentAvatarUrl={meProfile?.avatarUrl ?? null}
                    listHref={listHref}
                    adjacentNav={<PostAdjacentNav prev={prevPost} next={nextPost} />}
                  />

                  {user?.id === post.authorId ? (
                    <PostOwnerActions postId={post.id} postTitle={post.title} afterDeleteHref={listHref} />
                  ) : null}

                  <PostCategoryBoardList
                    category={post.category}
                    categoryLabel={catLabel}
                    currentPostId={post.id}
                    posts={categoryBoardItems}
                  />
                </PostLikeProvider>
              </article>
            </div>
            {sidebar}
          </div>
        </div>
      </main>
    </>
  );
}
