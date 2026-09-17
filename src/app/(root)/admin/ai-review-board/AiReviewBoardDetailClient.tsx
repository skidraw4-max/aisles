'use client';

import { useMemo, useState } from 'react';
import type { ReviewBoardRun } from '@/lib/ai-review-board/types';
import { SCORE_DIMENSION_LABELS } from '@/lib/ai-review-board/score-dimensions';
import {
  computeRunObservationMetrics,
  formatRunWhen,
} from '@/lib/ai-review-board/run-observation';
import styles from './board.module.css';

/** 관찰 핵심 탭을 앞에 두고, 기존 Overview/Members/Scores도 유지 */
const TABS = [
  'Overview',
  'Independent',
  'Debate',
  'Critic',
  'Final',
  'Scores',
  'Members',
  'Raw',
] as const;

type Tab = (typeof TABS)[number];

function ListBlock({ title, items }: { title: string; items: string[] }) {
  return (
    <div className={styles.listBlock}>
      <h4>
        {title} <span className={styles.countBadge}>{items.length}</span>
      </h4>
      {items.length === 0 ? (
        <p className={styles.muted}>—</p>
      ) : (
        <ul>
          {items.map((x, i) => (
            <li key={`${title}-${i}`}>{x}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function AiReviewBoardDetailClient({ run }: { run: ReviewBoardRun }) {
  const [tab, setTab] = useState<Tab>('Debate');
  const obs = useMemo(() => computeRunObservationMetrics(run), [run]);

  return (
    <div className={styles.detail}>
      <div className={styles.detailSummary}>
        <span>{formatRunWhen(run)}</span>
        <span className={styles.statusPill}>{run.status}</span>
        <span>
          calls {run.budget.usedCalls}/{run.budget.maxCalls} · est ${run.budget.estimatedCostUsd}
        </span>
        <span>
          agree {obs.agreementCount ?? '—'} · disagree {obs.disagreementCount ?? '—'} · weakEv{' '}
          {obs.weakEvidenceCount ?? '—'} · rev {obs.revisionCount ?? '—'} · conf{' '}
          {obs.averageConfidence ?? '—'}
        </span>
      </div>

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
            <strong>When:</strong> {formatRunWhen(run)}
          </p>
          <p>
            <strong>Budget:</strong> {run.budget.usedCalls}/{run.budget.maxCalls} calls · est $
            {run.budget.estimatedCostUsd}
            {run.budget.warnings.length > 0 ? ` · ${run.budget.warnings.join(', ')}` : ''}
          </p>
          <p>
            <strong>Overall:</strong> {run.final?.overallTrendScore ?? '—'} · final confidence{' '}
            {run.final?.confidence ?? '—'}
          </p>
          <p>
            <strong>Debate 관찰:</strong> agree {obs.agreementCount ?? '—'} · disagree{' '}
            {obs.disagreementCount ?? '—'} · weakEvidence {obs.weakEvidenceCount ?? '—'} ·
            revisions {obs.revisionCount ?? '—'} · avg conf {obs.averageConfidence ?? '—'} (
            {obs.confidenceSource ?? 'n/a'})
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
                    debate{' '}
                    {deb
                      ? deb.revisionStatus
                        ? deb.revisionStatus
                        : deb.revised
                          ? 'revised'
                          : 'unchanged'
                      : '—'}
                  </span>
                  {deb && (
                    <span className={styles.muted}>
                      a{deb.agreement.length}/d{deb.disagreement.length}/w
                      {deb.weakEvidence.length}
                    </span>
                  )}
                </li>
              );
            })}
            <li className={styles.memberCard}>
              <strong>AI-F</strong>
              <span>{run.critic ? 'critic ✓' : '—'}</span>
              {run.critic && (
                <span>
                  herding={String(run.critic.herdingDetected)}
                </span>
              )}
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
          <p className={styles.leadInline}>
            최초 독립 분석 (originalOpinion은 토론 후에도 보존).
          </p>
          {run.independent.map((a) => (
            <article key={a.memberId} className={styles.block}>
              <h3>
                AI-{a.memberId}{' '}
                <span className={styles.countBadge}>conf {a.confidence}</span>
              </h3>
              <p>
                <em>originalOpinion:</em> {a.originalOpinion}
              </p>
              <p>
                <strong>Current state:</strong> {a.currentState}
              </p>
              <p>
                <strong>Strengths:</strong> {a.strengths.join(' · ') || '—'}
              </p>
              <p>
                <strong>Problems:</strong> {a.problems.join(' · ') || '—'}
              </p>
              <p>
                <strong>Trend gap:</strong> {a.trendGap || '—'}
              </p>
              <p>
                <strong>Judgment basis:</strong> {a.judgmentBasis || '—'}
              </p>
              {a.improvements.length > 0 && (
                <div>
                  <strong>Improvements:</strong>
                  <ol>
                    {a.improvements.map((imp) => (
                      <li key={imp.id}>
                        {imp.title} (P{imp.priority}, {imp.difficulty}/{imp.risk})
                      </li>
                    ))}
                  </ol>
                </div>
              )}
            </article>
          ))}
        </section>
      )}

      {tab === 'Debate' && (
        <section className={styles.panel}>
          <p className={styles.leadInline}>
            Debate Timeline — 동의/반대/근거 부족/누락/추가검증/의견 변경을 관찰하세요.
          </p>
          <p className={styles.obsInline}>
            Σ agree {obs.agreementCount ?? '—'} · disagree {obs.disagreementCount ?? '—'} ·
            weakEvidence {obs.weakEvidenceCount ?? '—'} · revised {obs.revisionCount ?? '—'}
          </p>
          {run.debate.length === 0 ? (
            <p className={styles.muted}>토론 데이터 없음</p>
          ) : (
            run.debate.map((d, idx) => {
              const initial = run.independent.find((i) => i.memberId === d.memberId);
              return (
                <article key={`${d.memberId}-${idx}`} className={styles.timelineItem}>
                  <header>
                    <strong>AI-{d.memberId}</strong>
                    {d.revisionStatus === 'FULL' ? (
                      <span className={styles.badgeRev}>FULL</span>
                    ) : d.revisionStatus === 'PARTIAL' ? (
                      <span className={styles.badgeRev}>PARTIAL</span>
                    ) : (
                      <span className={styles.badgeOk}>
                        {d.revisionStatus ?? (d.revised ? 'revised' : 'UNCHANGED')}
                      </span>
                    )}
                    <span className={styles.muted}>conf {d.confidence}</span>
                  </header>

                  {initial && (
                    <div className={styles.initialBox}>
                      <strong>Initial (independent):</strong> {initial.originalOpinion}
                    </div>
                  )}

                  <div className={styles.grid2}>
                    <ListBlock title="Agreement" items={d.agreement} />
                    <ListBlock title="Disagreement" items={d.disagreement} />
                  </div>
                  <div className={styles.grid2}>
                    <ListBlock title="Weak evidence" items={d.weakEvidence} />
                    <ListBlock title="Missed" items={d.missed} />
                  </div>
                  <ListBlock title="Needs verification" items={d.needsVerification} />

                  {(d.revisionStatus === 'PARTIAL' ||
                    d.revisionStatus === 'FULL' ||
                    d.revised) ? (
                    <div className={styles.revision}>
                      <p>
                        <strong>Status:</strong> {d.revisionStatus ?? 'revised'}
                      </p>
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
                  ) : (
                    <p className={styles.muted}>
                      UNCHANGED — {d.revisionReason || '독립 판단 유지'} (반박·weakEvidence는 위
                      목록으로 확인)
                    </p>
                  )}
                  <p>
                    <strong>Final opinion:</strong> {d.finalOpinion}
                  </p>
                </article>
              );
            })
          )}
        </section>
      )}

      {tab === 'Critic' && (
        <section className={styles.panel}>
          {run.critic ? (
            <>
              <div className={styles.flagGrid}>
                <span>factVsSpeculationOk: {String(run.critic.factVsSpeculationOk)}</span>
                <span>evidenceSufficient: {String(run.critic.evidenceSufficient)}</span>
                <span>herdingDetected: {String(run.critic.herdingDetected)}</span>
                <span>trendEvidenceOk: {String(run.critic.trendEvidenceOk)}</span>
                <span>userBenefitLikely: {String(run.critic.userBenefitLikely)}</span>
                <span>existingFeatureRisk: {String(run.critic.existingFeatureRisk)}</span>
                <span>overEngineering: {String(run.critic.overEngineering)}</span>
                <span>confidence: {run.critic.confidence}</span>
              </div>
              <p>
                <strong>dominantMemberInfluence:</strong>{' '}
                {run.critic.dominantMemberInfluence ?? '—'}
              </p>
              <ListBlock title="Notes" items={run.critic.notes} />
              <ListBlock
                title="Scores without evidence"
                items={run.critic.scoresWithoutEvidence}
              />
            </>
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
              <p>
                <strong>Overall trend score:</strong> {run.final.overallTrendScore ?? '—'} ·{' '}
                <strong>Confidence:</strong> {run.final.confidence}
              </p>
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
                    {imp.expectedEffect ? (
                      <>
                        <br />
                        <span className={styles.muted}>효과: {imp.expectedEffect}</span>
                      </>
                    ) : null}
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
              <p>
                <strong>Risk / difficulty:</strong> {run.final.risk} /{' '}
                {run.final.expectedDifficulty}
              </p>
              <p>
                <strong>Expected user effect:</strong> {run.final.expectedUserEffect}
              </p>
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
