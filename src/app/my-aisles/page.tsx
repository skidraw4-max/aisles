import Link from 'next/link';
import { redirect } from 'next/navigation';
import { SiteHeader } from '@/components/SiteHeader';
import { createClient } from '@/lib/supabase/server';
import { prisma } from '@/lib/prisma';
import { isEmailVerifiedForApp } from '@/lib/auth-email-verified';
import { MyPostsGrid, type MyPostRow } from './MyPostsGrid';
import styles from './my-aisles.module.css';

export const metadata = {
  title: 'My Aisles — AIsle',
};

export const dynamic = 'force-dynamic';

export default async function MyAislesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.email) {
    redirect('/login?next=/my-aisles');
  }
  if (!isEmailVerifiedForApp(user)) {
    redirect('/login?error=email_not_confirmed&next=/my-aisles');
  }

  const rows = await prisma.post.findMany({
    where: { authorId: user.id },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      title: true,
      category: true,
      thumbnail: true,
      createdAt: true,
      views: true,
      likeCount: true,
      author: { select: { username: true } },
    },
  });

  const posts: MyPostRow[] = rows.map((p) => ({
    id: p.id,
    title: p.title,
    category: p.category,
    thumbnail: p.thumbnail,
    createdAt: p.createdAt.toISOString(),
    views: p.views,
    likeCount: p.likeCount,
    authorUsername: p.author.username,
  }));

  return (
    <>
      <SiteHeader />
      <main className={styles.main}>
        <div className={styles.inner}>
          <nav className={styles.breadcrumb} aria-label="경로">
            <Link href="/">홈</Link>
            <span aria-hidden>/</span>
            <span>My Aisles</span>
          </nav>
          <h1 className={styles.title}>My Aisles</h1>
          <p className={styles.lead}>내가 작성한 게시글만 모아서 관리할 수 있습니다. 수정·삭제 후 목록은 자동으로 갱신됩니다.</p>
          <MyPostsGrid posts={posts} />
        </div>
      </main>
    </>
  );
}
