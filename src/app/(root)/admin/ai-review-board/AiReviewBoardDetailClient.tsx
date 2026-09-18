'use client';

import { useMemo, useState } from 'react';
import type { ReviewBoardRun } from '@/lib/ai-review-board/types';
import { reviewBoardPhaseLabelKo } from '@/lib/ai-review-board/phase-label';
import { SCORE_DIMENSION_LABELS } from '@/lib/ai-review-board/score-dimensions';
import {
  computeRunObservationMetrics,
  formatRunWhen,
  resolveMemberRevisionView,
} from '@/lib/ai-review-board/run-observation';
import { runSemanticReferenceEvaluation } from '@/lib/ai-review-board/semantic-reference-eval';
import styles from './board.module.css';

/** 관찰 핵심 탭을 앞에 두고, 기존 Overview/Members/Scores도 유지 */
const TABS = [
  'Overview',
  'Independent',
  'Debate',
  'Semantic Judge',
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
  const [verdictFilter, setVerdictFilter] = useState<string>('ALL');
  const [leapFilter, setLeapFilter] = useState<string>('ALL');
  const obs = useMemo(() => computeRunObservationMetrics(run), [run]);
  const judgments = run.semanticJudgments ?? [];
  const referenceEval = useMemo(() => runSemanticReferenceEvaluation(), []);
  const liveSummary = run.final?.semanticJudgeSummary;
  const filteredJudgments = useMemo(() => {
    return judgments.filter((j) => {
      if (verdictFilter !== 'ALL' && j.verdict !== verdictFilter) return false;
      if (leapFilter !== 'ALL' && j.semanticLeap.type !== leapFilter) return false;
      return true;
    });
  }, [judgments, verdictFilter, leapFilter]);

  return (
    <div className={styles.detail}>
      <div className={styles.detailSummary}>
        <span>{formatRunWhen(run)}</span>
        <span className={styles.statusPill} title={run.status}>
          {reviewBoardPhaseLabelKo(run.status)}
        </span>
        <span>
          calls {run.budget.usedCalls}/{run.budget.maxCalls} · est ${run.budget.estimatedCostUsd}
        </span>
        <span>
          agree {obs.agreementCount ?? '—'} · disagree {obs.disagreementCount ?? '—'} · weakEv{' '}
          {obs.weakEvidenceCount ?? '—'} · rev {obs.revisionCount ?? '—'} · P{' '}
          {obs.partialRevisionCount ?? '—'} · F {obs.fullRevisionCount ?? '—'} · conf{' '}
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
            <strong>Status:</strong> {reviewBoardPhaseLabelKo(run.status)}{' '}
            <span className={styles.muted}>({run.status})</span>
          </p>
          <p>
            <strong>Run ID:</strong> {run.runId}
          </p>
          {run.evidence?.ga4 ? (
            <div className={styles.listBlock} style={{ marginTop: '1rem' }}>
              <h4>
                GA4 Summary{' '}
                <span className={styles.countBadge}>
                  {run.evidence.ga4.available ? 'available' : 'unavailable'}
                </span>
              </h4>
              {run.evidence.ga4.error ? (
                <p className={styles.muted}>
                  error: {run.evidence.ga4.error}
                  {run.evidence.ga4.errorCode
                    ? ` (${run.evidence.ga4.errorCode})`
                    : ''}
                </p>
              ) : null}
              <p className={styles.muted}>
                기간:{' '}
                {run.evidence.analysisPeriod
                  ? `${run.evidence.analysisPeriod.start} ~ ${run.evidence.analysisPeriod.end} (${run.evidence.analysisPeriod.timezone})`
                  : run.evidence.ga4.period
                    ? `${run.evidence.ga4.period.start} ~ ${run.evidence.ga4.period.end} (${run.evidence.ga4.period.timezone})`
                    : `${run.evidence.ga4.range.startDate} → ${run.evidence.ga4.range.endDate}`}
                {' · '}
                property {run.evidence.ga4.propertyId ?? '—'} · fetched{' '}
                {run.evidence.ga4.fetchedAt ?? '—'}
              </p>
              {run.evidence.ga4.available ? (
                <>
                  <ul>
                    <li>
                      <span className={styles.countBadge}>GA4</span> Active Users:{' '}
                      {run.evidence.ga4.metrics.activeUsers ??
                        run.evidence.ga4.users?.activeUsers ??
                        '—'}
                    </li>
                    <li>
                      <span className={styles.countBadge}>GA4</span> New Users:{' '}
                      {run.evidence.ga4.users?.newUsers ?? '—'}
                    </li>
                    <li>
                      <span className={styles.countBadge}>GA4</span> Sessions:{' '}
                      {run.evidence.ga4.metrics.sessions ?? '—'}
                    </li>
                    <li>
                      <span className={styles.countBadge}>GA4</span> Engagement Rate:{' '}
                      {run.evidence.ga4.engagement?.engagementRate ?? '—'}
                    </li>
                    <li>
                      <span className={styles.countBadge}>GA4</span> Page Views:{' '}
                      {run.evidence.ga4.metrics.screenPageViews ?? '—'}
                    </li>
                    <li>
                      <span className={styles.countBadge}>GA4</span> Engaged Sessions:{' '}
                      {run.evidence.ga4.metrics.engagedSessions ?? '—'}
                    </li>
                    <li>
                      <span className={styles.countBadge}>DB</span> newUsersLast7d:{' '}
                      {run.evidence.aggregates.newUsersLast7d ?? '—'}
                    </li>
                    <li>
                      <span className={styles.countBadge}>DB</span> activeUsersLast7d:{' '}
                      {run.evidence.aggregates.activeUsersLast7d ?? '—'}
                    </li>
                  </ul>
                  {(run.evidence.ga4.views?.topPages?.length ?? 0) > 0 ? (
                    <>
                      <h4>
                        Top Pages <span className={styles.countBadge}>GA4</span>
                      </h4>
                      <ul>
                        {run.evidence.ga4.views!.topPages.slice(0, 8).map((p) => (
                          <li key={p.path}>
                            {p.path}: {p.views}
                          </li>
                        ))}
                      </ul>
                    </>
                  ) : null}
                  {(run.evidence.ga4.acquisition?.channels?.length ?? 0) > 0 ? (
                    <>
                      <h4>
                        Acquisition Channels <span className={styles.countBadge}>GA4</span>
                      </h4>
                      <ul>
                        {run.evidence.ga4.acquisition!.channels.slice(0, 8).map((c) => (
                          <li key={c.channel}>
                            {c.channel}: {c.sessions}
                          </li>
                        ))}
                      </ul>
                    </>
                  ) : null}
                  {run.evidence.ga4.device ? (
                    <>
                      <h4>
                        Device <span className={styles.countBadge}>GA4</span>
                      </h4>
                      <ul>
                        <li>mobile: {run.evidence.ga4.device.mobile ?? '—'}</li>
                        <li>desktop: {run.evidence.ga4.device.desktop ?? '—'}</li>
                        <li>tablet: {run.evidence.ga4.device.tablet ?? '—'}</li>
                      </ul>
                    </>
                  ) : null}
                  <h4>
                    Tracked events{' '}
                    <span className={styles.countBadge}>
                      {Object.keys(run.evidence.ga4.metrics.eventCountByName).length}
                    </span>
                  </h4>
                  {Object.keys(run.evidence.ga4.metrics.eventCountByName).length === 0 ? (
                    <p className={styles.muted}>—</p>
                  ) : (
                    <ul>
                      {Object.entries(run.evidence.ga4.metrics.eventCountByName)
                        .sort((a, b) => b[1] - a[1])
                        .map(([name, count]) => (
                          <li key={name}>
                            {name}: {count}
                          </li>
                        ))}
                    </ul>
                  )}
                  <p className={styles.muted}>
                    GA4 수치는 DB aggregates와 별개입니다. activeUsers(GA4) ≠
                    activeUsersLast7d(DB). UNKNOWN ≠ 0.
                  </p>
                </>
              ) : (
                <p className={styles.muted}>GA4 unavailable</p>
              )}
            </div>
          ) : (
            <p className={styles.muted} style={{ marginTop: '1rem' }}>
              GA4 unavailable — 이 런에는 EvidencePack.ga4 블록이 없습니다.
            </p>
          )}
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
              const rev = resolveMemberRevisionView(run, id);
              return (
                <li key={id} className={styles.memberCard}>
                  <strong>AI-{id}</strong>
                  <span>{ind ? 'independent ✓' : '—'}</span>
                  <span>
                    debate {deb ? '✓' : '—'} · rev {rev.revisionStatus ?? '—'}
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
            Debate Timeline — 동의/반대/근거 부족/누락/추가검증. Revision은 v4+ revisions 우선, 구런은
            debate fallback.
          </p>
          <p className={styles.obsInline}>
            Σ agree {obs.agreementCount ?? '—'} · disagree {obs.disagreementCount ?? '—'} ·
            weakEvidence {obs.weakEvidenceCount ?? '—'} · revised {obs.revisionCount ?? '—'} · confΔ{' '}
            {obs.avgConfidenceBefore ?? '—'}→{obs.avgConfidenceAfter ?? '—'}
          </p>
          {run.debate.length === 0 ? (
            <p className={styles.muted}>토론 데이터 없음</p>
          ) : (
            run.debate.map((d, idx) => {
              const initial = run.independent.find((i) => i.memberId === d.memberId);
              const rev = resolveMemberRevisionView(run, d.memberId);
              return (
                <article key={`${d.memberId}-${idx}`} className={styles.timelineItem}>
                  <header>
                    <strong>AI-{d.memberId}</strong>
                    {rev.revisionStatus === 'FULL' ? (
                      <span className={styles.badgeRev}>FULL</span>
                    ) : rev.revisionStatus === 'PARTIAL' ? (
                      <span className={styles.badgeRev}>PARTIAL</span>
                    ) : (
                      <span className={styles.badgeOk}>{rev.revisionStatus ?? '—'}</span>
                    )}
                    <span className={styles.muted}>
                      source {rev.source ?? '—'} · conf {rev.confidenceBefore ?? '—'}→
                      {rev.confidenceAfter ?? '—'}
                    </span>
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

                  {(() => {
                    const cal = (run.claimCalibrations ?? []).find(
                      (c) => c.memberId === d.memberId,
                    );
                    if (!cal) {
                      return <p className={styles.muted}>Claim Calibration —</p>;
                    }
                    const checks = (run.calibrationRevisionChecks ?? []).filter(
                      (c) => c.memberId === d.memberId,
                    );
                    const revFull = (run.revisions ?? []).find((r) => r.memberId === d.memberId);
                    return (
                      <>
                        <div className={styles.listBlock}>
                          <h4>
                            Claim Calibration{' '}
                            <span className={styles.countBadge}>{cal.claims.length}</span>
                          </h4>
                          <ul>
                            {cal.claims.map((c) => (
                              <li key={c.claimId}>
                                <strong>{c.claimId}</strong> [{c.evidenceType}/{c.supportLevel}/impact=
                                {c.evidenceImpact}/overclaim={c.riskOfOverclaiming}] {c.claimText}
                                <br />
                                <span className={styles.muted}>
                                  refs: {c.evidenceRefs.join(', ') || '—'} · missing:{' '}
                                  {c.missingEvidence.join(', ') || '—'} · {c.reason || '—'}
                                </span>
                              </li>
                            ))}
                          </ul>
                        </div>
                        <div className={styles.listBlock}>
                          <h4>
                            Evidence Semantics{' '}
                            <span className={styles.countBadge}>
                              {
                                (
                                  (run.evidenceSemantics ?? []).find(
                                    (s) => s.memberId === d.memberId,
                                  )?.claims ?? []
                                ).length
                              }
                            </span>
                          </h4>
                          {(() => {
                            const sem = (run.evidenceSemantics ?? []).find(
                              (s) => s.memberId === d.memberId,
                            );
                            if (!sem || sem.claims.length === 0) {
                              return <p className={styles.muted}>—</p>;
                            }
                            return (
                              <ul>
                                {sem.claims.map((c) => (
                                  <li key={`sem-${c.claimId}`}>
                                    <strong>{c.claimId}</strong> {c.evidenceRelation}/
                                    {c.entailmentLevel}/risk={c.semanticRisk}
                                    {c.unsupportedLeap ? ' · LEAP' : ''}
                                    <br />
                                    <span className={styles.muted}>
                                      {c.claimText} — {c.explanation || '—'}
                                    </span>
                                  </li>
                                ))}
                              </ul>
                            );
                          })()}
                        </div>
                        <div className={styles.listBlock}>
                          <h4>
                            Claim Calibration → Revision{' '}
                            <span className={styles.countBadge}>{checks.length}</span>
                          </h4>
                          {checks.length === 0 ? (
                            <p className={styles.muted}>—</p>
                          ) : (
                            <ul>
                              {checks.map((ch) => {
                                const claim = cal.claims.find((c) => c.claimId === ch.claimId);
                                const assessed =
                                  revFull?.calibrationImpactAssessment?.affectedClaims?.find(
                                    (a) => a.claimId === ch.claimId,
                                  );
                                return (
                                  <li key={`${ch.memberId}-${ch.claimId}`}>
                                    <strong>{ch.claimId}</strong>{' '}
                                    {claim?.claimText ? `“${claim.claimText}”` : ''}
                                    <br />
                                    <span className={styles.muted}>
                                      {claim?.evidenceType ?? '—'} · {ch.calibrationSupportLevel} ·
                                      impact={ch.calibrationEvidenceImpact} · overclaim=
                                      {ch.calibrationRiskOfOverclaiming} · {ch.revisionStatus} ·{' '}
                                      {ch.revisionAction}
                                      {assessed ? ` (${assessed.actionReason || '—'})` : ''} ·{' '}
                                      {ch.consistency}/{ch.severity}
                                      {(ch.flags?.length ?? 0) > 0
                                        ? ` · flags: ${ch.flags!.join(',')}`
                                        : ''}
                                    </span>
                                  </li>
                                );
                              })}
                            </ul>
                          )}
                        </div>
                      </>
                    );
                  })()}

                  <div className={styles.revision}>
                    <p>
                      <strong>Revision status:</strong> {rev.revisionStatus ?? '—'}
                    </p>
                    {rev.revised ? (
                      <>
                        <p>
                          <strong>revisionReason:</strong> {rev.revisionReason ?? '—'}
                        </p>
                        <ListBlock title="changedClaims" items={rev.changedClaims} />
                      </>
                    ) : (
                      <p>
                        <strong>retainReason:</strong> {rev.retainReason ?? '—'}
                      </p>
                    )}
                    <p>
                      <strong>confidenceChangeReason:</strong>{' '}
                      {rev.confidenceChangeReason ?? '—'}
                    </p>
                    <ListBlock title="newEvidenceAccepted" items={rev.newEvidenceAccepted} />
                    {rev.rejectedArguments.length > 0 ? (
                      <div className={styles.listBlock}>
                        <h4>
                          rejectedArguments{' '}
                          <span className={styles.countBadge}>{rev.rejectedArguments.length}</span>
                        </h4>
                        <ul>
                          {rev.rejectedArguments.map((ra, i) => (
                            <li key={i}>
                              {ra.argument} — {ra.reason}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : (
                      <p className={styles.muted}>rejectedArguments —</p>
                    )}
                  </div>
                  <p>
                    <strong>Final opinion:</strong> {rev.finalOpinion ?? '—'}
                  </p>
                </article>
              );
            })
          )}
        </section>
      )}

      {tab === 'Semantic Judge' && (
        <section className={styles.panel}>
          <h3>Live Run</h3>
          {!run.semanticJudgments || run.semanticJudgments.length === 0 ? (
            <p className={styles.muted}>Semantic Judge —</p>
          ) : (
            <>
              <div className={styles.flagGrid}>
                <span>total: {liveSummary?.totalClaims ?? judgments.length}</span>
                <span>reviewed: {liveSummary?.judgeReviewedClaims ?? judgments.length}</span>
                <span>
                  cal agree/disagree: {judgments.filter((j) => j.calibrationAgreement === 'AGREE').length}/
                  {judgments.filter((j) => j.calibrationAgreement === 'DISAGREE').length}
                </span>
                <span>leaps: {liveSummary?.semanticLeapCount ?? '—'}</span>
                <span>unknownNeg: {liveSummary?.unknownAsNegativeEvidenceCount ?? '—'}</span>
                <span>causal: {liveSummary?.causalLeapCount ?? '—'}</span>
                <span>trend: {liveSummary?.trendLeapCount ?? '—'}</span>
                <span>tech: {liveSummary?.techQualityLeapCount ?? '—'}</span>
                <span>mismatch: {liveSummary?.judgeRevisionMismatchCount ?? '—'}</span>
                <span>
                  revInfluence: trig={liveSummary?.judgeTriggeredRevision ?? '—'} narrow=
                  {liveSummary?.judgeTriggeredNarrow ?? '—'} ignored=
                  {liveSummary?.judgeIgnoredRisk ?? '—'}
                </span>
                <span className={styles.muted}>
                  live TP/FP: {liveSummary?.truePositive ?? 'null'}/
                  {liveSummary?.falsePositive ?? 'null'} (regression-only elsewhere)
                </span>
                <span>
                  chairmanReliability:{' '}
                  {(run.final?.chairmanReliabilityFlags ?? []).length
                    ? (run.final?.chairmanReliabilityFlags ?? []).join(', ')
                    : '—'}
                </span>
              </div>
              <h4>Claim Table</h4>
              <div style={{ overflowX: 'auto' }}>
                <table className={styles.table ?? undefined} style={{ width: '100%', fontSize: 12 }}>
                  <thead>
                    <tr>
                      <th>Claim</th>
                      <th>Calibration</th>
                      <th>Judge</th>
                      <th>Support</th>
                      <th>Risk</th>
                      <th>Leap</th>
                      <th>Action</th>
                      <th>Mismatch</th>
                      <th>Agree</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredJudgments.map((j) => (
                      <tr key={`row-${j.memberId}-${j.claimId}`}>
                        <td>
                          {j.memberId}/{j.claimId}: {j.claimText.slice(0, 60)}
                          {j.claimText.length > 60 ? '…' : ''}
                        </td>
                        <td>{j.originalSemanticClassification.supportLevel}</td>
                        <td>{j.judgeClassification.supportLevel}</td>
                        <td>{j.judgeClassification.evidenceRelation}</td>
                        <td>{j.judgeClassification.overclaimRisk}</td>
                        <td>{j.semanticLeap.type}</td>
                        <td>{j.recommendedAction}</td>
                        <td>{j.mismatchType ?? '—'}</td>
                        <td>{j.calibrationAgreement ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className={styles.flagGrid}>
                <label>
                  Verdict{' '}
                  <select
                    value={verdictFilter}
                    onChange={(e) => setVerdictFilter(e.target.value)}
                  >
                    <option value="ALL">ALL</option>
                    <option value="TRUE_POSITIVE">TRUE_POSITIVE</option>
                    <option value="FALSE_POSITIVE">FALSE_POSITIVE</option>
                    <option value="TRUE_NEGATIVE">TRUE_NEGATIVE</option>
                    <option value="FALSE_NEGATIVE">FALSE_NEGATIVE</option>
                    <option value="SEMANTICALLY_AMBIGUOUS">SEMANTICALLY_AMBIGUOUS</option>
                  </select>
                </label>
                <label>
                  Leap{' '}
                  <select value={leapFilter} onChange={(e) => setLeapFilter(e.target.value)}>
                    <option value="ALL">ALL</option>
                    <option value="UNKNOWN_AS_NEGATIVE_EVIDENCE">
                      UNKNOWN_AS_NEGATIVE_EVIDENCE
                    </option>
                    <option value="FACT_TO_CAUSALITY">FACT_TO_CAUSALITY</option>
                    <option value="FACT_TO_TREND">FACT_TO_TREND</option>
                    <option value="FACT_TO_GLOBAL_CONCLUSION">FACT_TO_GLOBAL_CONCLUSION</option>
                    <option value="TECH_STACK_TO_QUALITY">TECH_STACK_TO_QUALITY</option>
                    <option value="NONE">NONE</option>
                  </select>
                </label>
                <span className={styles.muted}>
                  showing {filteredJudgments.length}/{judgments.length}
                </span>
              </div>
              {filteredJudgments.map((j) => (
                <article key={`${j.memberId}-${j.claimId}`} className={styles.timelineItem}>
                  <header>
                    <strong>
                      AI-{j.memberId} / {j.claimId}
                    </strong>
                    <span className={styles.muted}>
                      {j.verdict} · agree={j.calibrationAgreement ?? '—'} · leap=
                      {j.semanticLeap.type} · risk=
                      {j.judgeClassification.overclaimRisk} · {j.recommendedAction}
                    </span>
                  </header>
                  <p>{j.claimText}</p>
                  <p className={styles.muted}>
                    refs: {j.evidenceRefs.join(', ') || '—'} · missing:{' '}
                    {j.missingEvidence.join(', ') || '—'}
                    {j.overlayFlags && j.overlayFlags.length > 0
                      ? ` · overlay: ${j.overlayFlags.join(', ')}`
                      : ''}
                  </p>
                  <p>
                    <strong>Calibration:</strong> {j.originalSemanticClassification.evidenceType}/
                    {j.originalSemanticClassification.supportLevel}/
                    {j.originalSemanticClassification.evidenceRelation}
                  </p>
                  <p>
                    <strong>Judge:</strong> {j.judgeClassification.evidenceType}/
                    {j.judgeClassification.supportLevel}/{j.judgeClassification.evidenceRelation}
                  </p>
                  <p>
                    <strong>Reason:</strong> {j.judgeReason || '—'}
                  </p>
                  <p className={styles.muted}>confidence {j.confidence}</p>
                </article>
              ))}
            </>
          )}

          <h3 style={{ marginTop: '1.5rem' }}>Regression Reference</h3>
          <p className={styles.muted}>
            Human Expected fixture (SEM-* + CASE-01…10). Not mixed into this Live run. TP/FP apply
            here only.
          </p>
          <div className={styles.flagGrid}>
            <span>
              cases: {referenceEval.metrics.cases} (SEM{' '}
              {referenceEval.results.filter((r) => r.id.startsWith('SEM-')).length} + CASE{' '}
              {referenceEval.results.filter((r) => r.id.startsWith('CASE-')).length})
            </span>
            <span>
              classification: {(referenceEval.metrics.classificationAccuracy * 100).toFixed(0)}%
            </span>
            <span>support: {(referenceEval.metrics.supportAccuracy * 100).toFixed(0)}%</span>
            <span>
              relation: {(referenceEval.metrics.evidenceRelationAccuracy * 100).toFixed(0)}%
            </span>
            <span>
              overclaim P/R:{' '}
              {referenceEval.metrics.overclaimPrecision == null
                ? '—'
                : (referenceEval.metrics.overclaimPrecision * 100).toFixed(0)}
              % /
              {referenceEval.metrics.overclaimRecall == null
                ? '—'
                : (referenceEval.metrics.overclaimRecall * 100).toFixed(0)}
              %
            </span>
            <span>
              leap recalls: unk=
              {referenceEval.metrics.unknownNegativeRecall == null
                ? '—'
                : (referenceEval.metrics.unknownNegativeRecall * 100).toFixed(0)}
              % causal=
              {referenceEval.metrics.causalLeapRecall == null
                ? '—'
                : (referenceEval.metrics.causalLeapRecall * 100).toFixed(0)}
              % trend=
              {referenceEval.metrics.trendLeapRecall == null
                ? '—'
                : (referenceEval.metrics.trendLeapRecall * 100).toFixed(0)}
              % global=
              {referenceEval.metrics.globalConclusionRecall == null
                ? '—'
                : (referenceEval.metrics.globalConclusionRecall * 100).toFixed(0)}
              % tech=
              {referenceEval.metrics.techQualityRecall == null
                ? '—'
                : (referenceEval.metrics.techQualityRecall * 100).toFixed(0)}
              %
            </span>
            <span>
              TP/FP/TN/FN: {referenceEval.metrics.truePositive}/
              {referenceEval.metrics.falsePositive}/{referenceEval.metrics.trueNegative}/
              {referenceEval.metrics.falseNegative}
            </span>
          </div>
          {referenceEval.results.map((r) => (
            <article key={r.id} className={styles.timelineItem}>
              <header>
                <strong>{r.id}</strong>
                <span className={styles.muted}>
                  {r.match.classification && r.match.semanticLeap ? 'MATCH' : 'DIFF'} ·{' '}
                  {r.verdict}
                </span>
              </header>
              <p>{r.claim}</p>
              <p className={styles.muted}>
                expected: {r.expected.supportLevel}/{r.expected.semanticLeap} → actual:{' '}
                {r.actual.supportLevel}/{r.actual.semanticLeap}
                {r.overlayFlags.length ? ` · overlay: ${r.overlayFlags.join(', ')}` : ''}
              </p>
              <p className={styles.muted}>{r.reason}</p>
            </article>
          ))}
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
              {(
                [
                  'revisionIntegrity',
                  'evidenceGrounding',
                  'overclaiming',
                  'herding',
                  'confidenceIntegrity',
                  'fabrication',
                  'statusConsistency',
                  'claimCalibrationIntegrity',
                  'evidenceMappingIntegrity',
                  'unsupportedClaimFlags',
                  'overclaimingFlags',
                  'unknownAsEvidenceFlags',
                  'causalClaimWithoutEvidenceFlags',
                  'confidenceCalibrationFlags',
                  'herdingFlags',
                  'calibrationRevisionMismatchFlags',
                  'overclaimRetainedFlags',
                  'unknownAsNegativeEvidenceFlags',
                  'unjustifiedConfidenceFlags',
                  'majorityDrivenRevisionFlags',
                  'evidenceClaimSemanticMismatchFlags',
                  'absenceOfEvidenceAsAbsenceFlags',
                  'unsupportedCausalClaimFlags',
                  'unsupportedRelativeClaimFlags',
                  'unsupportedTimeTrendFlags',
                  'unsupportedLeapFlags',
                  'contextMistakenAsEvidenceFlags',
                  'peerOpinionAsEvidenceFlags',
                  'falsePositiveFlags',
                  'falseNegativeFlags',
                  'semanticLeapFlags',
                  'causalClaimFlags',
                  'trendClaimFlags',
                  'techQualityLeapFlags',
                  'majorityDrivenJudgeFlags',
                  'judgeRevisionMismatchFlags',
                ] as const
              ).map((key) => {
                const check = run.critic?.[key];
                return (
                  <p key={key}>
                    <strong>{key}:</strong>{' '}
                    {check
                      ? `${check.ok ? 'ok' : 'FLAG'} · ${(check.flags || []).join('; ') || '—'}`
                      : '—'}
                  </p>
                );
              })}
              {run.critic.calibrationRevisionIntegrity && (
                <div className={styles.listBlock}>
                  <h4>
                    calibrationRevisionIntegrity:{' '}
                    {run.critic.calibrationRevisionIntegrity.status}
                  </h4>
                  <p className={styles.muted}>
                    {run.critic.calibrationRevisionIntegrity.summary}
                  </p>
                  {(run.critic.calibrationRevisionIntegrity.issues?.length ?? 0) > 0 ? (
                    <ul>
                      {run.critic.calibrationRevisionIntegrity.issues.map((issue, i) => (
                        <li key={i}>{issue}</li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              )}
              {run.critic.semanticJudgeIntegrity && (
                <div className={styles.listBlock}>
                  <h4>
                    semanticJudgeIntegrity: {run.critic.semanticJudgeIntegrity.status}
                  </h4>
                  <p className={styles.muted}>{run.critic.semanticJudgeIntegrity.summary}</p>
                </div>
              )}
              {run.critic.evidenceSemanticsIntegrity && (
                <div className={styles.listBlock}>
                  <h4>
                    evidenceSemanticsIntegrity:{' '}
                    {run.critic.evidenceSemanticsIntegrity.status}
                  </h4>
                  <p className={styles.muted}>
                    {run.critic.evidenceSemanticsIntegrity.summary}
                  </p>
                  {(run.critic.evidenceSemanticsIntegrity.issues?.length ?? 0) > 0 ? (
                    <ul>
                      {run.critic.evidenceSemanticsIntegrity.issues.map((issue, i) => (
                        <li key={i}>{issue}</li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              )}
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
              <h3>Confirmed Facts</h3>
              <ListBlock title="" items={run.final.confirmedFacts ?? []} />
              <h3>Unknown / Missing Data</h3>
              <ListBlock title="" items={run.final.unknownMissingData ?? []} />
              <h3>Hypotheses</h3>
              <ListBlock title="" items={run.final.hypotheses ?? []} />
              <h3>Disputed Points</h3>
              <ListBlock title="" items={run.final.disputedPoints ?? []} />
              <h3>Validated Improvements</h3>
              <ListBlock title="" items={run.final.validatedImprovements ?? []} />
              <h3>Supported Claims</h3>
              <ListBlock title="" items={run.final.supportedClaims ?? []} />
              <h3>Partially Supported Claims</h3>
              <ListBlock title="" items={run.final.partiallySupportedClaims ?? []} />
              <h3>Unsupported / Hypothesis Claims</h3>
              <ListBlock title="" items={run.final.unsupportedHypothesisClaims ?? []} />
              <h3>Calibration → Revision Findings</h3>
              <ListBlock title="" items={run.final.calibrationRevisionFindings ?? []} />
              <h3>Evidence Semantics Findings</h3>
              <ListBlock title="" items={run.final.evidenceSemanticsFindings ?? []} />
              <h3>Semantic Judge Findings</h3>
              <ListBlock title="" items={run.final.semanticJudgeFindings ?? []} />
              <h3>Semantic Risks</h3>
              <ListBlock title="" items={run.final.semanticRisks ?? []} />
              {run.final.semanticJudgeSummary && (
                <p className={styles.muted}>
                  Judge summary: reviewed={run.final.semanticJudgeSummary.judgeReviewedClaims} ·
                  ambiguous={run.final.semanticJudgeSummary.ambiguous} · leaps=
                  {run.final.semanticJudgeSummary.semanticLeapCount} · mismatch=
                  {run.final.semanticJudgeSummary.judgeRevisionMismatchCount} · TP/FP/TN/FN=
                  {run.final.semanticJudgeSummary.truePositive ?? '—'}/
                  {run.final.semanticJudgeSummary.falsePositive ?? '—'}/
                  {run.final.semanticJudgeSummary.trueNegative ?? '—'}/
                  {run.final.semanticJudgeSummary.falseNegative ?? '—'}
                </p>
              )}
              <h3>Directly Supported Claims</h3>
              <ListBlock title="" items={run.final.directlySupportedClaims ?? []} />
              <h3>Supported Inferences</h3>
              <ListBlock title="" items={run.final.supportedInferences ?? []} />
              <h3>Weak / Limited Inferences</h3>
              <ListBlock title="" items={run.final.weakLimitedInferences ?? []} />
              <h3>Revision Summary</h3>
              {run.final.revisionSummary ? (
                <>
                  <ListBlock title="UNCHANGED" items={run.final.revisionSummary.unchanged} />
                  <ListBlock title="PARTIAL" items={run.final.revisionSummary.partial} />
                  <ListBlock title="FULL" items={run.final.revisionSummary.full} />
                  <ListBlock
                    title="confidenceShifts"
                    items={run.final.revisionSummary.confidenceShifts}
                  />
                  <ListBlock
                    title="claimSofteningFromEvidenceGap"
                    items={run.final.revisionSummary.claimSofteningFromEvidenceGap}
                  />
                  <ListBlock title="herdingRisks" items={run.final.revisionSummary.herdingRisks} />
                </>
              ) : (
                <p className={styles.muted}>—</p>
              )}
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
