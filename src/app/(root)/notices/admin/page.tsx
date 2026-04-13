import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { SiteFooter } from '@/components/SiteFooter';
import { prisma } from '@/lib/prisma';
import { getViewerIsAdmin } from '@/lib/auth/require-admin';
import { isPrismaNoticeTableMissing } from '@/lib/prisma-notice';
import { NoticesAdminClient, type NoticeAdminRow } from './NoticesAdminClient';
import styles from './admin.module.css';

export const metadata: Metadata = {
  title: '공지 관리 — AIsle',
  robots: { index: false, follow: false },
};

export default async function NoticesAdminPage() {
  const isAdmin = await getViewerIsAdmin();
  if (!isAdmin) {
    redirect('/notices');
  }

  let rows: Awaited<ReturnType<typeof prisma.notice.findMany>> = [];
  try {
    rows = await prisma.notice.findMany({
      orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
    });
  } catch (e) {
    if (!isPrismaNoticeTableMissing(e)) {
      throw e;
    }
  }

  const initial: NoticeAdminRow[] = rows.map((r) => ({
    id: r.id,
    title: r.title,
    content: r.content,
    link: r.link,
    isRolling: r.isRolling,
    priority: r.priority,
    createdAt: r.createdAt.toISOString(),
  }));

  return (
    <>
      <main className={styles.main}>
        <div className={styles.inner}>
          <NoticesAdminClient initialNotices={initial} />
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
