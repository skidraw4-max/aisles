import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { SiteFooter } from '@/components/SiteFooter';
import { getViewerIsAdmin } from '@/lib/auth/require-admin';
import { SEO_ROBOTS_PRIVATE } from '@/lib/seo-robots';
import {
  computeRunObservationMetrics,
  formatRunWhen,
} from '@/lib/ai-review-board/run-observation';
import { DEFAULT_REVIEW_BOARD_ROOT, listRuns, loadRun } from '@/lib/ai-review-board/store';
import styles from './board.module.css';

export const metadata: Metadata = {
  title: 'AI 운영위원회 — AIsle',
  robots: SEO_ROBOTS_PRIVATE,
};

export const dynamic = 'force-dynamic';

function fmtCount(n: number | null): string {
  return n === null ? '—' : String(n);
}

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
            관찰 전용 대시보드. 실행은 로컬 CLI만 (
            <code>npx tsx scripts/run-ai-review-board.ts</code>). 파이프라인·자동 실행은 변경하지
            않습니다.
          </p>
        </header>

        {runs.length === 0 ? (
          <p className={styles.empty}>
            아직 저장된 런이 없습니다. CLI로 실행하면 <code>data/ai-review-board/</code>에
            결과가 쌓입니다.
          </p>
        ) : (
          <ul className={styles.list}>
            {runs.map(({ id, run }) => {
              const r = run!;
              const obs = computeRunObservationMetrics(r);
              return (
                <li key={id}>
                  <Link href={`/admin/ai-review-board/${id}`} className={styles.card}>
                    <div className={styles.cardTop}>
                      <span className={styles.runWhen}>{formatRunWhen(r)}</span>
                      <span className={styles.statusPill}>{r.status}</span>
                    </div>
                    <span className={styles.runId}>{id}</span>
                    <div className={styles.cardStats}>
                      <span>
                        calls {r.budget?.usedCalls ?? '—'}/{r.budget?.maxCalls ?? '—'}
                      </span>
                      <span>est ${r.budget?.estimatedCostUsd ?? '—'}</span>
                      <span>score {r.final?.overallTrendScore ?? '—'}</span>
                    </div>
                    <div className={styles.obsRow} aria-label="관찰 지표">
                      <span title="agreement items">agree {fmtCount(obs.agreementCount)}</span>
                      <span title="disagreement items">disagree {fmtCount(obs.disagreementCount)}</span>
                      <span title="weakEvidence items">weakEv {fmtCount(obs.weakEvidenceCount)}</span>
                      <span title="revised turns">rev {fmtCount(obs.revisionCount)}</span>
                      <span title={`avg confidence (${obs.confidenceSource ?? 'n/a'})`}>
                        conf {obs.averageConfidence ?? '—'}
                      </span>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </main>
      <SiteFooter />
    </>
  );
}
