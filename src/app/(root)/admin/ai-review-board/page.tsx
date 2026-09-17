import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { SiteFooter } from '@/components/SiteFooter';
import { getViewerIsAdmin } from '@/lib/auth/require-admin';
import { SEO_ROBOTS_PRIVATE } from '@/lib/seo-robots';
import { DEFAULT_REVIEW_BOARD_ROOT, listRuns, loadRun } from '@/lib/ai-review-board/store';
import styles from './board.module.css';

export const metadata: Metadata = {
  title: 'AI 운영위원회 — AIsle',
  robots: SEO_ROBOTS_PRIVATE,
};

export const dynamic = 'force-dynamic';

export default async function AiReviewBoardPage() {
  const isAdmin = await getViewerIsAdmin();
  if (!isAdmin) redirect('/');

  const ids = await listRuns(DEFAULT_REVIEW_BOARD_ROOT);
  const runs = (
    await Promise.all(ids.map(async (id) => ({ id, run: await loadRun(DEFAULT_REVIEW_BOARD_ROOT, id) })))
  ).filter((x) => x.run);

  return (
    <>
      <main className={styles.wrap}>
        <header className={styles.header}>
          <h1 className={styles.title}>AI 운영위원회</h1>
          <p className={styles.lead}>
            1차: 분석·토론·검증 결과 관찰 전용. 실행은 로컬 CLI만 (
            <code>npx tsx scripts/run-ai-review-board.ts</code>).
          </p>
        </header>

        {runs.length === 0 ? (
          <p className={styles.empty}>
            아직 저장된 런이 없습니다. CLI로 실행하면 <code>data/ai-review-board/</code>에
            결과가 쌓입니다.
          </p>
        ) : (
          <ul className={styles.list}>
            {runs.map(({ id, run }) => (
              <li key={id}>
                <Link href={`/admin/ai-review-board/${id}`} className={styles.card}>
                  <span className={styles.runId}>{id}</span>
                  <span className={styles.meta}>
                    {run!.status} · score {run!.final?.overallTrendScore ?? '—'} · conf{' '}
                    {run!.final?.confidence?.toFixed?.(2) ?? '—'}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
      <SiteFooter />
    </>
  );
}
