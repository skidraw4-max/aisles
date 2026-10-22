import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { SiteFooter } from '@/components/SiteFooter';
import { getViewerIsAdmin } from '@/lib/auth/require-admin';
import { SEO_ROBOTS_PRIVATE } from '@/lib/seo-robots';
import { DEFAULT_REVIEW_BOARD_ROOT, loadRun } from '@/lib/ai-review-board/store';
import { liveVersionLabel, liveVersionNote } from '@/lib/ai-review-board/live-run-versions';
import {
  isInProgressReviewBoardPhase,
  reviewBoardPhaseLabelKo,
} from '@/lib/ai-review-board/phase-label';
import { runSemanticReferenceEvaluation } from '@/lib/ai-review-board/semantic-reference-eval';
import { AiReviewBoardDetailClient } from '../AiReviewBoardDetailClient';
import { AiReviewBoardRunPoller } from '../AiReviewBoardRunPoller';
import styles from '../board.module.css';

export const metadata: Metadata = {
  title: 'AI 운영위원회 런 — AIsle',
  robots: SEO_ROBOTS_PRIVATE,
};

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ runId: string }> };

export default async function AiReviewBoardRunPage({ params }: Props) {
  const isAdmin = await getViewerIsAdmin();
  if (!isAdmin) redirect('/');

  const { runId } = await params;
  if (!runId.startsWith('run-') || runId.includes('..') || runId.includes('/') || runId.includes('\\')) {
    notFound();
  }

  const run = await loadRun(DEFAULT_REVIEW_BOARD_ROOT, runId);
  if (!run) notFound();

  const ver = liveVersionLabel(runId);
  const note = liveVersionNote(runId);
  const referenceEval = runSemanticReferenceEvaluation();

  return (
    <>
      <main className={styles.wrap}>
        <p className={styles.back}>
          <Link href="/admin/ai-review-board">← 런 목록</Link>
        </p>
        <header className={styles.header}>
          <h1 className={styles.title}>
            {ver ? `${ver} · ` : ''}
            {runId}
          </h1>
          <p className={styles.lead}>
            <span
              className={
                isInProgressReviewBoardPhase(run.status)
                  ? `${styles.statusPill} ${styles.phaseBusy}`
                  : styles.statusPill
              }
              title={run.status}
            >
              {reviewBoardPhaseLabelKo(run.status)}
            </span>
          </p>
          {note ? <p className={styles.lead}>{note}</p> : null}
        </header>
        <AiReviewBoardRunPoller status={run.status} />
        <AiReviewBoardDetailClient run={run} referenceEval={referenceEval} />
      </main>
      <SiteFooter />
    </>
  );
}
