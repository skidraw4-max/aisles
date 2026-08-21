import type { Metadata } from 'next';
import Link from 'next/link';
import { SiteFooter } from '@/components/SiteFooter';
import { fetchLatestAiFortunePost } from '@/lib/ai-fortune/latest-fortune.server';
import { fetchFortuneArchive } from '@/lib/ai-fortune/fortune-archive.server';
import { getCanonicalSiteUrl } from '@/lib/canonical-site-url';
import { SEO_ROBOTS_PUBLIC } from '@/lib/seo-robots';
import styles from './fortune.module.css';

export const revalidate = 120;

export async function generateMetadata(): Promise<Metadata> {
  const base = getCanonicalSiteUrl().replace(/\/$/, '');
  const url = `${base}/fortune`;
  const title = 'AI FORTUNE · 주간 AI 운세 허브 · AIsle';
  const description =
    '이번 주 AI FORTUNE 리포트와 지난 주간 아카이브. 트렌드 요약과 MBTI 운세를 한곳에서 확인하세요.';
  return {
    title,
    description,
    alternates: { canonical: url },
    robots: SEO_ROBOTS_PUBLIC,
    openGraph: { title, description, url, type: 'website' },
    twitter: { card: 'summary_large_image', title, description },
  };
}

export default async function FortuneHubPage() {
  const [latest, archive] = await Promise.all([
    fetchLatestAiFortunePost(),
    fetchFortuneArchive(40),
  ]);
  const older = latest ? archive.filter((a) => a.id !== latest.id) : archive;

  return (
    <>
      <main className={styles.shell}>
        <p className={styles.eyebrow}>AI FORTUNE</p>
        <h1 className={styles.title}>주간 AI 운세 허브</h1>
        <p className={styles.lede}>
          매주 발행되는 AI 트렌드·MBTI 운세 리포트의 고정 랜딩입니다. 최신 리포트를 먼저 읽고, 지난
          주차는 아카이브에서 이어서 보세요.
        </p>

        {latest ? (
          <section className={styles.latest} aria-labelledby="fortune-latest">
            <h2 id="fortune-latest" className={styles.sectionTitle}>
              이번 주 리포트
            </h2>
            <Link href={`/post/${latest.id}`} className={styles.latestCard}>
              <span className={styles.week}>{latest.weekKey ?? 'LATEST'}</span>
              <span className={styles.latestTitle}>{latest.title}</span>
              {latest.subtitle ? <span className={styles.sub}>{latest.subtitle}</span> : null}
              <span className={styles.cta}>리포트 읽기 →</span>
            </Link>
          </section>
        ) : (
          <p className={styles.empty}>아직 발행된 AI FORTUNE 리포트가 없습니다.</p>
        )}

        <section className={styles.archive} aria-labelledby="fortune-archive">
          <h2 id="fortune-archive" className={styles.sectionTitle}>
            아카이브
          </h2>
          {older.length === 0 ? (
            <p className={styles.empty}>이전 주차 리포트가 없습니다.</p>
          ) : (
            <ul className={styles.list}>
              {older.map((item) => (
                <li key={item.id}>
                  <Link href={`/post/${item.id}`} className={styles.row}>
                    <span className={styles.week}>{item.weekKey ?? '—'}</span>
                    <span className={styles.rowTitle}>{item.title}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <p className={styles.more}>
          <Link href="/?category=AI_FORTUNE">복도 피드에서 더 보기</Link>
          {' · '}
          <Link href="/games">게임 허브</Link>
        </p>
      </main>
      <SiteFooter />
    </>
  );
}
