'use client';

import { useState } from 'react';
import type { ReviewBoardRun } from '@/lib/ai-review-board/types';
import { SCORE_DIMENSION_LABELS } from '@/lib/ai-review-board/score-dimensions';
import styles from '../board.module.css';

const TABS = [
  'Overview',
  'Members',
  'Independent',
  'Debate',
  'Critic',
  'Scores',
  'Final',
  'Raw',
] as const;

type Tab = (typeof TABS)[number];

export function AiReviewBoardDetailClient({ run }: { run: ReviewBoardRun }) {
  const [tab, setTab] = useState<Tab>('Debate');

  return (
    <div className={styles.detail}>
      <div className={styles.tabs} role="tablist" aria-label="리뷰 보드 섹션">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            className={tab === t ? styles.tabActive : styles.tab}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'Overview' && (
        <section className={styles.panel}>
          <p>
            <strong>Status:</strong> {run.status}
          </p>
          <p>
            <strong>Budget:</strong> {run.budget.usedCalls}/{run.budget.maxCalls} calls · est $
            {run.budget.estimatedCostUsd}
            {run.budget.warnings.length > 0 ? ` · ${run.budget.warnings.join(', ')}` : ''}
          </p>
          <p>
            <strong>Overall:</strong> {run.final?.overallTrendScore ?? '—'} · confidence{' '}
            {run.final?.confidence ?? '—'}
          </p>
          <p className={styles.muted}>{run.final?.statusSummary}</p>
        </section>
      )}

      {tab === 'Members' && (
        <section className={styles.panel}>
          <ul className={styles.memberList}>
            {(['A', 'B', 'C', 'D', 'E'] as const).map((id) => {
              const ind = run.independent.find((i) => i.memberId === id);
              const deb = run.debate.find((d) => d.memberId === id);
              return (
                <li key={id} className={styles.memberCard}>
                  <strong>AI-{id}</strong>
                  <span>{ind ? 'independent ✓' : '—'}</span>
                  <span>
                    debate {deb ? (deb.revised ? 'revised' : 'unchanged') : '—'}
                  </span>
                </li>
              );
            })}
            <li className={styles.memberCard}>
              <strong>AI-F</strong>
              <span>{run.critic ? 'critic ✓' : '—'}</span>
            </li>
            <li className={styles.memberCard}>
              <strong>Chairman</strong>
              <span>{run.final ? 'final ✓' : '—'}</span>
            </li>
          </ul>
        </section>
      )}

      {tab === 'Independent' && (
        <section className={styles.panel}>
          {run.independent.map((a) => (
            <article key={a.memberId} className={styles.block}>
              <h3>AI-{a.memberId}</h3>
              <p>
                <em>originalOpinion:</em> {a.originalOpinion}
              </p>
              <p>{a.currentState}</p>
              <p>
                <strong>Problems:</strong> {a.problems.join(' · ') || '—'}
              </p>
              <p>
                <strong>Confidence:</strong> {a.confidence}
              </p>
            </article>
          ))}
        </section>
      )}

      {tab === 'Debate' && (
        <section className={styles.panel}>
          <p className={styles.leadInline}>
            Debate Timeline — 동의/반대/의견 변경 이유를 관찰하세요.
          </p>
          {run.debate.map((d, idx) => (
            <article key={`${d.memberId}-${idx}`} className={styles.timelineItem}>
              <header>
                <strong>AI-{d.memberId}</strong>
                {d.revised ? (
                  <span className={styles.badgeRev}>revised</span>
                ) : (
                  <span className={styles.badgeOk}>unchanged</span>
                )}
              </header>
              <div className={styles.grid2}>
                <div>
                  <h4>Agreement</h4>
                  <ul>
                    {d.agreement.map((x) => (
                      <li key={x}>{x}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <h4>Disagreement</h4>
                  <ul>
                    {d.disagreement.map((x) => (
                      <li key={x}>{x}</li>
                    ))}
                  </ul>
                </div>
              </div>
              {d.revised && (
                <div className={styles.revision}>
                  <p>
                    <strong>Before:</strong> {d.previousOpinion}
                  </p>
                  <p>
                    <strong>After:</strong> {d.revisedOpinion}
                  </p>
                  <p>
                    <strong>Why:</strong> {d.revisionReason}
                  </p>
                </div>
              )}
              <p>
                <strong>Final:</strong> {d.finalOpinion}
              </p>
            </article>
          ))}
        </section>
      )}

      {tab === 'Critic' && (
        <section className={styles.panel}>
          {run.critic ? (
            <pre className={styles.pre}>{JSON.stringify(run.critic, null, 2)}</pre>
          ) : (
            <p>—</p>
          )}
        </section>
      )}

      {tab === 'Scores' && (
        <section className={styles.panel}>
          {(run.final?.dimensionScores ?? []).map((s) => (
            <div key={s.dimension} className={styles.scoreRow}>
              <div className={styles.scoreHead}>
                <strong>{SCORE_DIMENSION_LABELS[s.dimension] ?? s.dimension}</strong>
                <span>{s.score === null ? 'null (no hard evidence)' : s.score}</span>
              </div>
              <ul className={styles.evidenceList}>
                {s.evidence.map((e, i) => (
                  <li key={i}>
                    [{e.kind}] {e.text}
                    {e.source ? ` (${e.source})` : ''}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      )}

      {tab === 'Final' && (
        <section className={styles.panel}>
          {run.final ? (
            <>
              <h3>Status</h3>
              <p>{run.final.statusSummary}</p>
              <h3>Top problems</h3>
              <ul>
                {run.final.topProblems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
              <h3>Improvements</h3>
              <ol>
                {run.final.improvements.map((imp) => (
                  <li key={imp.id}>
                    <strong>{imp.title}</strong> (P{imp.priority}, {imp.difficulty}/{imp.risk})
                    <br />
                    {imp.rationale}
                  </li>
                ))}
              </ol>
              <h3>Opinion differences</h3>
              <ul>
                {run.final.opinionDifferences.map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
              <h3>Needs verification</h3>
              <ul>
                {run.final.needsFurtherVerification.map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
            </>
          ) : (
            <p>—</p>
          )}
        </section>
      )}

      {tab === 'Raw' && (
        <section className={styles.panel}>
          <pre className={styles.pre}>{JSON.stringify(run, null, 2)}</pre>
        </section>
      )}
    </div>
  );
}
