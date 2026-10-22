import type { Metadata } from 'next';
import Link from 'next/link';
import { SiteFooter } from '@/components/SiteFooter';
import { NoticeAdminLink } from '@/components/NoticeAdminLink';
import { prisma } from '@/lib/prisma';
import { isPrismaNoticeTableMissing } from '@/lib/prisma-notice';
import { getCanonicalSiteUrl } from '@/lib/canonical-site-url';
import { SEO_ROBOTS_PUBLIC } from '@/lib/seo-robots';
import styles from './notices.module.css';

const noticesPath = '/notices';

export const metadata: Metadata = (() => {
  const base = getCanonicalSiteUrl().replace(/\/$/, '');
  const url = `${base}${noticesPath}`;
  return {
    title: '공지사항 — AIsle',
    description: 'AIsle 서비스 공지사항 목록입니다.',
    alternates: { canonical: url },
    robots: SEO_ROBOTS_PUBLIC,
    openGraph: {
      type: 'website',
      locale: 'ko_KR',
      siteName: 'AIsle',
      url,
      title: '공지사항 — AIsle',
      description: 'AIsle 서비스 공지사항 목록입니다.',
    },
  };
})();

export default async function NoticesPage() {
  let rows: {
    id: string;
    title: string;
    isRolling: boolean;
    priority: number;
    createdAt: Date;
  }[] = [];
  try {
    rows = await prisma.notice.findMany({
      orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
      select: {
        id: true,
        title: true,
        isRolling: true,
        priority: true,
        createdAt: true,
      },
    });
  } catch (e) {
    if (!isPrismaNoticeTableMissing(e)) {
      console.error('[NoticesPage]', e);
    }
  }

  return (
    <>
      <main className={styles.main}>
        <div className={styles.inner}>
          <div className={styles.headRow}>
            <h1 className={styles.h1}>공지사항</h1>
            <NoticeAdminLink />
          </div>
          {rows.length === 0 ? (
            <p className={styles.empty}>등록된 공지가 없습니다.</p>
          ) : (
            <ul className={styles.list}>
              {rows.map((n) => (
                <li key={n.id} className={styles.item}>
                  <Link href={`/notices/${n.id}`} className={styles.itemLink}>
                    {n.title}
                  </Link>
                  <span className={styles.meta}>
                    {n.isRolling ? '롤링' : '일반'} · 우선 {n.priority}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
