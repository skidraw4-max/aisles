import Link from 'next/link';
import { SiteHeader } from '@/components/SiteHeader';
import { MediaThumb } from '@/components/MediaThumb';
import { HomeAllFeed } from '@/components/HomeAllFeed';
import { HomeFeedSortTabs } from '@/components/HomeFeedSortTabs';
import { prisma } from '@/lib/prisma';
import { parseHomeFeedSort } from '@/lib/feed-sort';
import { fetchFeaturedForHome, fetchFeedPosts, serializeFeedPost } from '@/lib/home-feed';
import { parseHomeCategoryQuery, POST_CATEGORY_OPTIONS } from '@/lib/post-categories';
import type { Category } from '@prisma/client';
import styles from './page.module.css';

export const dynamic = 'force-dynamic';

type PageProps = {
  searchParams: Promise<{ category?: string | string[]; sort?: string | string[] }>;
};

function formatDate(d: Date) {
  return d.toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function categoryUiLabel(c: Category) {
  return POST_CATEGORY_OPTIONS.find((o) => o.value === c)?.label ?? c;
}

/** 카테고리 필터 결과가 비었을 때 공통 안내 */
function EmptyFeedMessage() {
  return (
    <p className={styles.emptySection}>
      아직 게시글이 없습니다. 첫 번째 주인공이 되어보세요!{' '}
      <Link href="/upload">업로드 페이지로 이동</Link>
    </p>
  );
}

function PostCardFooter({
  username,
  likeCount,
}: {
  username: string;
  likeCount: number;
}) {
  return (
    <div className={styles.cardFooter}>
      <span className={styles.cardAuthor}>{username}</span>
      <span className={styles.likeStamp} title="좋아요 (준비 중)">
        <span className={styles.heartIcon} aria-hidden>
          ♡
        </span>
        <span className={styles.likeNum}>{likeCount}</span>
      </span>
    </div>
  );
}

export default async function HomePage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const filterCategory = parseHomeCategoryQuery(sp.category);

  const recentAll = await prisma.post.findMany({
    orderBy: { createdAt: 'desc' },
    take: 8,
    include: { author: { select: { username: true } } },
  });

  const heroFilterNote = filterCategory
    ? `${categoryUiLabel(filterCategory)} 복도만 표시 중입니다.`
    : '전체 복도 피드입니다. 상단에서 최신순(New)·인기순(Hot)을 고르고, 스크롤로 더 불러옵니다.';

  if (!filterCategory) {
    const feedSort = parseHomeFeedSort(sp.sort);
    const [featuredHome, firstHomeFeed] = await Promise.all([
      fetchFeaturedForHome(null),
      fetchFeedPosts(feedSort, 0, 12, null),
    ]);
    return (
      <>
        <SiteHeader />
        <main className={styles.mainShell}>
          <div className={styles.homeFeedToolbarWrap}>
            <HomeFeedSortTabs sort={feedSort} />
          </div>
          <section className={styles.hero}>
            <p className={styles.eyebrow}>Four aisles, one workspace</p>
            <h1 className={styles.heroTitle}>
              실험하고, 전시하고,
              <br />
              빌드하고, 출시하세요.
            </h1>
            <p className={styles.heroLead}>{heroFilterNote}</p>
          </section>

          <section className={styles.section}>
            <div className={styles.sectionHead}>
              <span className={styles.badge}>ALL</span>
              <h2>피드</h2>
              <p className={styles.sectionDesc}>
                Editor&apos;s Choice는 피드와 별도로 상단에 고정됩니다. 정렬은 URL{' '}
                <code className={styles.inlineCodeHint}>/</code> ·{' '}
                <code className={styles.inlineCodeHint}>?sort=hot</code> 과 동기화됩니다.
              </p>
            </div>
            <HomeAllFeed
              key={feedSort}
              sort={feedSort}
              initialFeatured={featuredHome.map(serializeFeedPost)}
              initialPosts={firstHomeFeed.posts.map(serializeFeedPost)}
              initialHasMore={firstHomeFeed.hasMore}
            />
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

  const posts = await prisma.post.findMany({
    where: { category: filterCategory },
    orderBy: { createdAt: 'desc' },
    include: {
      author: { select: { username: true } },
      launchInfo: { select: { serviceUrl: true, status: true } },
    },
  });

  const recipe = filterCategory === 'RECIPE' ? posts : [];
  const gallery = filterCategory === 'GALLERY' ? posts : [];
  const build = filterCategory === 'BUILD' ? posts : [];
  const launch = filterCategory === 'LAUNCH' ? posts : [];

  return (
    <>
      <SiteHeader />
      <main className={styles.mainShell}>
        <section className={styles.hero}>
          <p className={styles.eyebrow}>Four aisles, one workspace</p>
          <h1 className={styles.heroTitle}>
            {categoryUiLabel(filterCategory)} <span style={{ fontWeight: 600 }}>aisle</span>
          </h1>
          <p className={styles.heroLead}>{heroFilterNote} 전체 보기는 All 또는 로고를 누르세요.</p>
        </section>

        {filterCategory === 'RECIPE' ? (
          <section className={styles.section}>
            <div className={styles.sectionHead}>
              <span className={styles.badge}>RECIPE</span>
              <h2>Lab: Prompt Recipes</h2>
              <p className={styles.sectionDesc}>프롬프트 레시피와 실험 노트를 모읍니다.</p>
            </div>
            {recipe.length === 0 ? (
              <EmptyFeedMessage />
            ) : (
              <ul className={styles.list}>
                {recipe.map((post) => (
                  <li key={post.id} className={styles.listItem}>
                    <Link href={`/post/${post.id}`} className={styles.postListLink}>
                      {post.thumbnail ? (
                        <div className={styles.listThumbWrap}>
                          <MediaThumb url={post.thumbnail} alt={post.title} />
                        </div>
                      ) : (
                        <span className={styles.listIcon} aria-hidden>
                          ◆
                        </span>
                      )}
                      <div className={styles.postListCol}>
                        <div className={styles.listTitle}>{post.title}</div>
                        <div className={styles.listMeta}>
                          {formatDate(post.createdAt)}
                          {post.content
                            ? ` · ${post.content.slice(0, 80)}${post.content.length > 80 ? '…' : ''}`
                            : ''}
                        </div>
                        <PostCardFooter username={post.author.username} likeCount={post.likeCount} />
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ) : null}

        {filterCategory === 'GALLERY' ? (
          <section className={styles.section}>
            <div className={styles.sectionHead}>
              <span className={styles.badge}>GALLERY</span>
              <h2>Gallery: Visual Curations</h2>
              <p className={styles.sectionDesc}>생성 이미지와 영상을 한눈에.</p>
            </div>
            {gallery.length === 0 ? (
              <EmptyFeedMessage />
            ) : (
              <div className={styles.gallery}>
                {gallery.map((post) => (
                  <Link key={post.id} href={`/post/${post.id}`} className={styles.galleryCardLink}>
                    <article className={styles.galleryCard}>
                      {post.thumbnail ? (
                        <MediaThumb url={post.thumbnail} alt={post.title} />
                      ) : (
                        <div className={styles.galleryGradient} aria-hidden />
                      )}
                      <div className={styles.galleryOverlay}>
                        <span className={styles.galleryLabel}>{post.title}</span>
                        <PostCardFooter username={post.author.username} likeCount={post.likeCount} />
                      </div>
                    </article>
                  </Link>
                ))}
              </div>
            )}
          </section>
        ) : null}

        {filterCategory === 'BUILD' ? (
          <section className={styles.section}>
            <div className={styles.sectionHead}>
              <span className={styles.badge}>BUILD</span>
              <h2>Build: Tools &amp; Infrastructure</h2>
              <p className={styles.sectionDesc}>빌드·인프라 관련 게시글.</p>
            </div>
            {build.length === 0 ? (
              <EmptyFeedMessage />
            ) : (
              <div className={styles.buildGrid}>
                {build.map((post) => (
                  <Link key={post.id} href={`/post/${post.id}`} className={styles.buildCardLink}>
                    <article className={styles.buildCard}>
                      <h3>{post.title}</h3>
                      <p className={styles.listMeta} style={{ margin: '0 0 0.75rem' }}>
                        {formatDate(post.createdAt)}
                      </p>
                      {post.content ? (
                        <div className={styles.tagRow}>
                          <span className={styles.tag} style={{ maxWidth: '100%' }}>
                            {post.content.length > 120 ? `${post.content.slice(0, 120)}…` : post.content}
                          </span>
                        </div>
                      ) : post.thumbnail ? (
                        <div className={styles.tagRow}>
                          <span className={styles.tag} style={{ maxWidth: '100%' }}>
                            미디어 있음
                          </span>
                        </div>
                      ) : null}
                      <PostCardFooter username={post.author.username} likeCount={post.likeCount} />
                    </article>
                  </Link>
                ))}
              </div>
            )}
          </section>
        ) : null}

        {filterCategory === 'LAUNCH' ? (
          <section className={styles.section}>
            <div className={styles.sectionHead}>
              <span className={styles.badge}>LAUNCH</span>
              <h2>Launch Your AI Product</h2>
              <p className={styles.sectionDesc}>런치패드 복도에서 서비스를 소개합니다.</p>
            </div>
            {launch.length === 0 ? (
              <EmptyFeedMessage />
            ) : (
              <ul className={styles.launchList}>
                {launch.map((post) => (
                  <li key={post.id} className={styles.launchItem}>
                    <Link href={`/post/${post.id}`} className={styles.launchTitleLink}>
                      <h3>{post.title}</h3>
                    </Link>
                    {post.content ? <p>{post.content}</p> : null}
                    <div className={styles.launchMeta}>
                      {post.launchInfo?.status ? (
                        <span className={styles.statusPill}>{post.launchInfo.status}</span>
                      ) : null}
                      <span className={styles.listMeta} style={{ margin: 0 }}>
                        {formatDate(post.createdAt)}
                      </span>
                    </div>
                    {post.launchInfo?.serviceUrl ? (
                      <p style={{ margin: '0.65rem 0 0' }}>
                        <a href={post.launchInfo.serviceUrl} target="_blank" rel="noreferrer">
                          서비스 링크
                        </a>
                      </p>
                    ) : post.thumbnail ? (
                      <p style={{ margin: '0.65rem 0 0' }}>
                        <a href={post.thumbnail} target="_blank" rel="noreferrer">
                          미디어 링크
                        </a>
                      </p>
                    ) : null}
                    <PostCardFooter username={post.author.username} likeCount={post.likeCount} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        ) : null}
      </main>
      <footer className={styles.footer}>
        <span>AIsle</span>
        <span className={styles.footerMuted}>Supabase Auth · Prisma · Next.js</span>
      </footer>
    </>
  );
}
