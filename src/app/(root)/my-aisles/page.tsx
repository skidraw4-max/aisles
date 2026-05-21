import type { Metadata } from 'next';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { prisma } from '@/lib/prisma';
import { getAllUiLabels } from '@/lib/ui-config';
import type { FeedPostCardModel } from '@/components/FeedPostCard';
import { SEO_ROBOTS_PRIVATE } from '@/lib/seo-robots';
import type { MyPostRow } from './MyPostsGrid';
import { MyAislesView } from './MyAislesView';
import { MyAislesLoginGate } from './MyAislesLoginGate';
import styles from './my-aisles.module.css';

export const metadata: Metadata = {
  title: 'My Aisles — AIsle',
  robots: SEO_ROBOTS_PRIVATE,
};

export const dynamic = 'force-dynamic';

type PageProps = { searchParams: Promise<{ tab?: string | string[] }> };

export default async function MyAislesPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const raw = sp.tab;
  const tabParam = Array.isArray(raw) ? raw[0] : raw;
  const initialTab = tabParam === 'bookmarks' ? ('bookmarks' as const) : ('posts' as const);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.email) {
    return <MyAislesLoginGate />;
  }

  const ui = await getAllUiLabels();

  const [rows, bookmarkRows] = await Promise.all([
    prisma.post.findMany({
      where: { authorId: user.id },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        title: true,
        category: true,
        thumbnail: true,
        metadata: { select: { params: true } },
        createdAt: true,
        views: true,
        likeCount: true,
        featuredOnHome: true,
        launchBannerUntil: true,
        author: { select: { username: true } },
      },
    }),
    prisma.bookmark.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      include: {
        post: {
          select: {
            id: true,
            title: true,
            content: true,
            thumbnail: true,
            category: true,
            createdAt: true,
            likeCount: true,
            metadata: { select: { params: true } },
            author: { select: { username: true } },
          },
        },
      },
    }),
  ]);

  const now = Date.now();
  const posts: MyPostRow[] = rows.map((p) => {
    let launchBannerStatus: 'live' | 'expired' | null = null;
    if (p.category === 'LAUNCH' && p.featuredOnHome) {
      const until = p.launchBannerUntil?.getTime();
      launchBannerStatus = until == null || until > now ? 'live' : 'expired';
    }
    return {
      id: p.id,
      title: p.title,
      category: p.category,
      thumbnail: p.thumbnail,
      metadataParams: p.metadata?.params,
      createdAt: p.createdAt.toISOString(),
      views: p.views,
      likeCount: p.likeCount,
      authorUsername: p.author.username,
      launchBannerStatus,
    };
  });

  const bookmarkCards: FeedPostCardModel[] = bookmarkRows.map((b) => ({
    id: b.post.id,
    title: b.post.title,
    content: b.post.content,
    thumbnail: b.post.thumbnail,
    category: b.post.category,
    createdAt: b.post.createdAt.toISOString(),
    likeCount: b.post.likeCount,
    authorUsername: b.post.author.username,
    metadataParams: b.post.metadata?.params,
  }));

  return (
    <>
      <main className={styles.main}>
        <div className={styles.inner}>
          <nav className={styles.breadcrumb} aria-label="경로">
            <Link href="/">홈</Link>
            <span aria-hidden>/</span>
            <span>My Aisles</span>
          </nav>
          <h1 className={styles.title}>My Aisles</h1>
          <p className={styles.lead}>
            내가 작성한 글과 저장해 둔 소식을 한곳에서 볼 수 있습니다. 북마크는 글 상단의 별 아이콘으로 저장할 수
            있습니다.
          </p>
          <MyAislesView
            initialTab={initialTab}
            ui={ui}
            myPosts={posts}
            bookmarkCards={bookmarkCards}
          />
        </div>
      </main>
    </>
  );
}
