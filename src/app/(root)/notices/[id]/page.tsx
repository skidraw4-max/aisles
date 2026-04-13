import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { SiteFooter } from '@/components/SiteFooter';
import { NoticeAdminLink } from '@/components/NoticeAdminLink';
import { prisma } from '@/lib/prisma';
import { isPrismaNoticeTableMissing } from '@/lib/prisma-notice';
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
    return { title: `${n.title} — 공지 · AIsle` };
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
            {notice.content.trim() ? (
              <div className={styles.body}>{notice.content}</div>
            ) : (
              <p className={`${styles.body} ${styles.bodyEmpty}`}>등록된 본문이 없습니다.</p>
            )}
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
