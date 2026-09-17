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
import { runSemanticReferenceEvaluation } from '@/lib/ai-review-board/semantic-reference-eval';
import {
  liveVersionLabel,
  liveVersionNote,
} from '@/lib/ai-review-board/live-run-versions';
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

function pct(n: number | null | undefined): string {
  if (n == null) return '—';
  return `${Math.round(n * 100)}%`;
}

export default async function AiReviewBoardPage() {
  const isAdmin = await getViewerIsAdmin();
  if (!isAdmin) redirect('/');

  const ids = await listRuns(DEFAULT_REVIEW_BOARD_ROOT);
  const runs = (
    await Promise.all(ids.map(async (id) => ({ id, run: await loadRun(DEFAULT_REVIEW_BOARD_ROOT, id) })))
  ).filter((x) => x.run);

  const ref = runSemanticReferenceEvaluation();
  const semCount = ref.results.filter((r) => r.id.startsWith('SEM-')).length;
  const caseCount = ref.results.filter((r) => r.id.startsWith('CASE-')).length;
  const caseFails = ref.results.filter(
    (r) => r.id.startsWith('CASE-') && (!r.match.support || !r.match.semanticLeap),
  );

  return (
    <>
      <main className={styles.wrap}>
        <header className={styles.header}>
          <h1 className={styles.title}>AI 운영위원회</h1>
          <p className={styles.lead}>
            관찰 전용 대시보드. Live Gemini run은 목록에 표시됩니다. 최신 Live는{' '}
            <strong>v9.1</strong>입니다. 상단 Regression Validation은 CASE-01…10
            fixture 결과입니다.
          </p>
        </header>

        <section className={styles.panel} aria-label="v9.1 Regression Validation">
          <h2 className={styles.sectionTitle}>v9.1 Regression Validation</h2>
          <p className={styles.leadInline}>
            Live run이 아닙니다. Human Expected fixture (SEM {semCount} + CASE {caseCount}) vs
            deterministic Judge. TP/FP는 여기서만 계산합니다.
          </p>
          <div className={styles.obsRow}>
            <span>cases {ref.metrics.cases}</span>
            <span>support {pct(ref.metrics.supportAccuracy)}</span>
            <span>leap-class {pct(ref.metrics.classificationAccuracy)}</span>
            <span>CASE fail {caseFails.length}</span>
            <span>
              TP/FP/TN/FN {ref.metrics.truePositive}/{ref.metrics.falsePositive}/
              {ref.metrics.trueNegative}/{ref.metrics.falseNegative}
            </span>
          </div>
          {caseFails.length === 0 ? (
            <p className={styles.okNote}>CASE-01…10 support+leap 전부 일치.</p>
          ) : (
            <p className={styles.empty}>
              CASE mismatch: {caseFails.map((f) => f.id).join(', ')}
            </p>
          )}
          <p className={styles.leadInline}>
            최신 Live Gemini는{' '}
            <Link href="/admin/ai-review-board/run-2026-09-17T12-58-30-257Z">
              v9.1 · run-2026-09-17T12-58-30-257Z
            </Link>
            . 상세의 Semantic Judge 탭에서도 Regression Reference를 볼 수 있습니다.
          </p>
        </section>

        <h2 className={styles.sectionTitle}>Live Gemini runs ({runs.length})</h2>

        {runs.length === 0 ? (
          <p className={styles.empty}>
            아직 저장된 런이 없습니다. CLI로 실행하면 <code>data/ai-review-board/</code>에
            결과가 쌓입니다. (프로덕션에서는 배포 번들에 포함된 baseline run만 보입니다.)
          </p>
        ) : (
          <ul className={styles.list}>
            {runs.map(({ id, run }) => {
              const r = run!;
              const obs = computeRunObservationMetrics(r);
              const ver = liveVersionLabel(id);
              const note = liveVersionNote(id);
              return (
                <li key={id}>
                  <Link href={`/admin/ai-review-board/${id}`} className={styles.card}>
                    <div className={styles.cardTop}>
                      <span className={styles.runWhen}>{formatRunWhen(r)}</span>
                      <span className={styles.statusPill}>{r.status}</span>
                      {ver ? <span className={styles.versionPill}>{ver}</span> : null}
                    </div>
                    <span className={styles.runId}>{id}</span>
                    {note ? <span className={styles.cardNote}>{note}</span> : null}
                    <div className={styles.cardStats}>
                      <span>
                        calls {r.budget?.usedCalls ?? '—'}/{r.budget?.maxCalls ?? '—'}
                      </span>
                      <span>est ${r.budget?.estimatedCostUsd ?? '—'}</span>
                      <span>score {r.final?.overallTrendScore ?? '—'}</span>
                    </div>
                    <div className={styles.obsRow} aria-label="관찰 지표">
                      <span title="agreement items">agree {fmtCount(obs.agreementCount)}</span>
                      <span title="disagreement items">
                        disagree {fmtCount(obs.disagreementCount)}
                      </span>
                      <span title="weakEvidence items">
                        weakEv {fmtCount(obs.weakEvidenceCount)}
                      </span>
                      <span title="revised turns">rev {fmtCount(obs.revisionCount)}</span>
                      <span title="PARTIAL">P {fmtCount(obs.partialRevisionCount)}</span>
                      <span title="FULL">F {fmtCount(obs.fullRevisionCount)}</span>
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
