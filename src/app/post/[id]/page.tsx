import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import type { Role } from '@prisma/client';
import { SiteHeader } from '@/components/SiteHeader';
import { MediaThumb } from '@/components/MediaThumb';
import { prisma } from '@/lib/prisma';
import { createClient } from '@/lib/supabase/server';
import { POST_CATEGORY_OPTIONS, homeHrefForCategory } from '@/lib/post-categories';
import { resolveRecipePrompt } from '@/lib/recipe-prompt';
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
import { PostCategoryBoardList } from './PostCategoryBoardList';
import { PostTags } from './PostTags';
import { incrementPostViews } from './actions';
import { PostOwnerActions } from './PostOwnerActions';
import { PostRichContent } from '@/lib/PostRichContent';
import styles from './post.module.css';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ id: string }> };

function categoryLabel(value: string) {
  return POST_CATEGORY_OPTIONS.find((o) => o.value === value)?.label ?? value;
}

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

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  try {
    const post = await prisma.post.findUnique({
      where: { id },
      select: { title: true },
    });
    if (!post) return { title: '게시글 — AIsle' };
    return { title: `${post.title} — AIsle` };
  } catch {
    return { title: '게시글 — AIsle' };
  }
}

export default async function PostPage({ params }: Props) {
  const { id } = await params;
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
      select: { id: true, title: true, thumbnail: true, likeCount: true, content: true },
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
      select: { id: true, title: true, thumbnail: true, likeCount: true, content: true },
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
  const isLoungeOrGossip = post.category === 'LOUNGE' || post.category === 'GOSSIP';
  const isBuildOrLaunch = post.category === 'BUILD' || post.category === 'LAUNCH';
  const hasHeroMedia = Boolean(post.thumbnail?.trim());
  const metaPrompt = post.metadata?.prompt?.trim() ?? '';
  const labPromptText = resolveRecipePrompt(post);
  const showLabDescription = isLab && Boolean(post.content?.trim()) && Boolean(metaPrompt);

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
  }));

  const listHref = homeHrefForCategory(post.category);

  const categoryBoardItems = categoryBoardPosts.map((p) => ({
    id: p.id,
    title: p.title,
    views: p.views,
    authorUsername: p.author.username,
    commentCount: p._count.comments,
  }));
  const externalHref = (post.externalLink ?? '').trim();
  const extraAttachments = (post.attachmentUrls ?? []).filter((u) => u.trim().length > 0);
  const catLabel = categoryLabel(post.category);
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
        <h1 className={styles.magazineTitle}>{post.title}</h1>
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
      />
    </div>
  );

  return (
    <>
      <SiteHeader />
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
                  <PostTopBreadcrumb category={post.category} />
                  {isGallery ? (
                    <>
                      {mainMediaBlock}
                      {postDetailHeader}
                    </>
                  ) : (
                    <>
                      {postDetailHeader}
                    {showLabDescription && post.content ? (
                      <PostRichContent
                        text={post.content}
                        className={styles.magazineIntro}
                        textClassName={styles.postRichInline}
                        embedMediaClassName={styles.postBodyEmbed}
                      />
                    ) : null}
                    {mainMediaBlock}
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

                {isGallery && post.category === 'BUILD' && externalHref ? (
                  <ExternalServiceCta href={externalHref} variant="buildBand" />
                ) : null}

                {isLab ? <RecipePromptSection postId={post.id} promptText={labPromptText} /> : null}
                {isLab ? <DosDontsSection /> : null}

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

                {!isGallery && !isLab && !isBuildOrLaunch && post.content ? (
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
                        파라미터: <code>{JSON.stringify(post.metadata.params)}</code>
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
