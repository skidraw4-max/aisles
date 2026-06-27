import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { SiteFooter } from '@/components/SiteFooter';
import { NoticeAdminLink } from '@/components/NoticeAdminLink';
import { NoticeContent } from '@/components/NoticeContent';
import { prisma } from '@/lib/prisma';
import { isPrismaNoticeTableMissing } from '@/lib/prisma-notice';
import { getCanonicalSiteUrl } from '@/lib/canonical-site-url';
import { SEO_ROBOTS_PUBLIC } from '@/lib/seo-robots';
import styles from './notice-detail.module.css';

type PageProps = {
  params: Promise<{ id: string }>;
};

function isExternalHref(href: string) {
  return /^https?:\/\//i.test(href);
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  try {
    const n = await prisma.notice.findUnique({
      where: { id },
      select: { title: true },
    });
    if (!n) {
      return { title: '공지 — AIsle' };
    }
    const base = getCanonicalSiteUrl().replace(/\/$/, '');
    const url = `${base}/notices/${id}`;
    return {
      title: `${n.title} — 공지 · AIsle`,
      alternates: { canonical: url },
      robots: SEO_ROBOTS_PUBLIC,
      openGraph: {
        type: 'article',
        locale: 'ko_KR',
        siteName: 'AIsle',
        url,
        title: `${n.title} — 공지 · AIsle`,
      },
    };
  } catch {
    return { title: '공지 — AIsle' };
  }
}

export default async function NoticeDetailPage({ params }: PageProps) {
  const { id } = await params;

  let notice: {
    title: string;
    content: string;
    link: string | null;
    createdAt: Date;
  } | null = null;

  try {
    notice = await prisma.notice.findUnique({
      where: { id },
      select: {
        title: true,
        content: true,
        link: true,
        createdAt: true,
      },
    });
  } catch (e) {
    if (!isPrismaNoticeTableMissing(e)) {
      throw e;
    }
  }

  if (!notice) {
    notFound();
  }

  const dateStr = notice.createdAt.toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const linkTrim = notice.link?.trim() ?? '';

  return (
    <>
      <main className={styles.main}>
        <div className={styles.inner}>
          <div className={styles.headRow}>
            <Link href="/notices" className={styles.back}>
              ← 공지 목록
            </Link>
            <NoticeAdminLink />
          </div>
          <article className={styles.article}>
            <h1 className={styles.h1}>{notice.title}</h1>
            <time className={styles.time} dateTime={notice.createdAt.toISOString()}>
              {dateStr}
            </time>
            <NoticeContent content={notice.content} />
            {linkTrim ? (
              <div className={styles.extraLinkWrap}>
                <p className={styles.extraLabel}>관련 링크</p>
                {isExternalHref(linkTrim) ? (
                  <a
                    href={linkTrim}
                    className={styles.extraLink}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {linkTrim}
                  </a>
                ) : (
                  <Link href={linkTrim} className={styles.extraLink}>
                    {linkTrim}
                  </Link>
                )}
              </div>
            ) : null}
          </article>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
