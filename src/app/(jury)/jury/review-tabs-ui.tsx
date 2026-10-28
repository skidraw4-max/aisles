/**
 * Review result tabs (phase 3). Display only: reads ReviewConsoleScreen, never writes,
 * never calls the review board and never changes decision values or result codes.
 */
import Link from 'next/link';
import { juryHref } from '@/lib/jury-product/jury-url';
import type { ReviewConsoleScreen } from '@/lib/jury-product/review-console';
import {
  committeeRoleLabel,
  confidenceLabel,
  EVIDENCE_STRENGTH_LABELS,
  MEMBER_OPINION_NOTICE,
  userLabel,
} from '@/lib/jury-product/ui-labels';
import { buildResultDetailView } from '@/lib/jury-product/review-result-detail';
import type { ReviewComparisonView } from '@/lib/jury-product/review-comparison';
import { Tabs, TranslationHint, type TabItem } from './ui-primitives';
import styles from './jury.module.css';
import { StatusBadge } from './jury-controls';

export const REVIEW_TAB_IDS = ['summary', 'members', 'evidence', 'history'] as const;
export type ReviewTabId = (typeof REVIEW_TAB_IDS)[number];

const REVIEW_TAB_LABELS: Record<ReviewTabId, string> = {
  summary: '요약',
  members: '위원 의견',
  evidence: '심사 근거',
  history: '이력',
};

/** Unknown or missing ?tab= falls back to 요약. */
export function reviewTabFrom(value: string | string[] | undefined): ReviewTabId {
  const raw = Array.isArray(value) ? value[0] : value;
  return (REVIEW_TAB_IDS as readonly string[]).includes(raw ?? '') ? (raw as ReviewTabId) : 'summary';
}

export function reviewTabHref(reviewId: string, tab: ReviewTabId): string {
  return juryHref(`/reviews/${reviewId}`, tab === 'summary' ? undefined : { tab });
}

export function ReviewTabs({ reviewId, active }: { reviewId: string; active: ReviewTabId }) {
  const items: TabItem[] = REVIEW_TAB_IDS.map((id) => ({ id, label: REVIEW_TAB_LABELS[id], href: reviewTabHref(reviewId, id) }));
  return <Tabs items={items} activeId={active} label="심사 결과 탭" />;
}

/**
 * RM-07: fixed summary shown above every result tab. Everything comes from AGG-01 (screen.display);
 * without it nothing is counted ("집계 불가"). No composite score, no severity (D-13).
 */
export function ResultFixedSummary({ screen }: { screen: ReviewConsoleScreen }) {
  if (!screen.display) {
    return (
      <section className={styles.panel} aria-label="결과 고정 요약">
        <p className={styles.eyebrow}>결과 고정 요약</p>
        <p className={styles.muted}>표시 모델이 없어 집계 불가</p>
      </section>
    );
  }
  const view = buildResultDetailView(screen.display);
  return (
    <section className={styles.panel} aria-label="결과 고정 요약">
      <p className={styles.eyebrow}>결과 고정 요약</p>
      <div className={styles.row}>
        <span className={styles.label}>결론</span>
        <span>
          <strong><StatusBadge>{view.summary.decision}</StatusBadge></strong>{' '}
          <StatusBadge data-source-tone={view.summary.source.tone}>{view.summary.source.label}</StatusBadge>
        </span>
      </div>
      {view.summary.decisionNote ? <p className={styles.muted}>{view.summary.decisionNote}</p> : null}
      {view.summary.source.note ? <p className={styles.muted}>{view.summary.source.note}</p> : null}
      {view.summary.facts.map((fact) => (
        <div className={styles.row} key={fact.label}><span className={styles.label}>{fact.label}</span><span>{fact.value}</span></div>
      ))}
      {view.summary.warnings.length > 0 ? (
        <ul className={styles.muted}>{view.summary.warnings.map((text) => <li key={text}>⚠ {text}</li>)}</ul>
      ) : null}
    </section>
  );
}

/** RM-07: 주장 → 근거 → 결론 → 기대 comparison and 문제 → 원인 링크 (summary tab). */
export function ResultComparison({ screen }: { screen: ReviewConsoleScreen }) {
  if (!screen.display) return null;
  const view = buildResultDetailView(screen.display);
  return (
    <>
      <section className={styles.panel}>
        <h2>주장 → 근거 → 결론 → 기대</h2>
        {view.comparison.map((row) => (
          <div className={styles.row} key={row.step}>
            <span className={styles.label}>{row.step}</span>
            <span lang={row.step === '기대' && row.note ? 'en' : undefined}>
              {row.value}{row.note ? <> <StatusBadge>{row.note}</StatusBadge></> : null}
            </span>
          </div>
        ))}
      </section>
      <section className={styles.panel}>
        <h2>수정이 필요한 문제와 원인</h2>
        {view.problems.state !== 'LISTED' ? <p className={styles.muted}>{view.problems.emptyText}</p> : (
          <ul>
            {view.problems.items.map((item) => (
              <li key={item.text}>
                <span lang="en">{item.text}</span>{' '}
                <Link className={styles.inline} href={reviewTabHref(screen.reviewId, item.cause.tab)}>{item.cause.text}</Link>
              </li>
            ))}
          </ul>
        )}
        {screen.display.problems.severityNote ? <p className={styles.muted}>{screen.display.problems.severityNote}</p> : null}
      </section>
    </>
  );
}

/** RM-07: 미검사 목록 (evidence tab). */
export function UncheckedMetricsPanel({ screen }: { screen: ReviewConsoleScreen }) {
  const view = screen.display ? buildResultDetailView(screen.display) : null;
  return (
    <section className={styles.panel}>
      <h2>미검사 목록</h2>
      {!view ? <p className={styles.muted}>집계 불가</p> : view.unchecked.state !== 'LISTED' ? (
        <p className={styles.muted}>{view.unchecked.text}</p>
      ) : (
        <ul>{view.unchecked.items.map((name) => <li key={name}><StatusBadge>미검사</StatusBadge> {name}</li>)}</ul>
      )}
    </section>
  );
}

/** RM-11 (M-011, UI-06): 이전 대비. 결론 범주 변화 + 문제 수 차이(정수)만; 비율·종합 점수 없음. */
export function PreviousResultComparison({ comparison }: { comparison: ReviewComparisonView | null }) {
  return (
    <section className={styles.panel}>
      <h2>이전 결과와 비교</h2>
      {!comparison ? <p className={styles.muted}>비교 불가 — 집계 불가</p> : comparison.state === 'NOT_COMPARABLE' ? (
        <p className={styles.muted}>{comparison.text}</p>
      ) : (
        <>
          <p>{comparison.text}</p>
          <p className={styles.muted}>
            이전 결과 {comparison.previousResultId ? (
              <Link className={styles.inline} href={juryHref(`/reviews/${comparison.previousResultId}`)}>{comparison.previousResultId.slice(0, 8)}</Link>
            ) : '—'} · 수정 필요 항목 {comparison.problems.previous ?? '집계 불가'} → {comparison.problems.current ?? '집계 불가'}
          </p>
        </>
      )}
    </section>
  );
}

/** Confidence line: board confidence, else evidence strength (older results), else 확인 불가. */
/** RM-20 phase 1 (I-024): claim strength line; '주장 입력 없음' when the request had no input claim. */
function ClaimStrengthLine({ screen }: { screen: ReviewConsoleScreen }) {
  const display = screen.display;
  if (!display || !display.strength.claim) return null;
  return <p className={styles.muted}>주장 강도: {display.strength.claim}{display.claimInput === 'NONE' ? ' (입력된 주장이 없어 강도를 확정하지 않음)' : ''}</p>;
}

export function ConfidenceLine({ screen }: { screen: ReviewConsoleScreen }) {
  return (
    <>
      <ConfidenceValueLine screen={screen} />
      <ClaimStrengthLine screen={screen} />
    </>
  );
}

function ConfidenceValueLine({ screen }: { screen: ReviewConsoleScreen }) {
  const confidence = screen.confidence;
  if (confidence?.source === 'BOARD') {
    return <p className={styles.muted}>위원회 확신도: {confidenceLabel(confidence.value)}</p>;
  }
  if (confidence?.source === 'EVIDENCE_STRENGTH' && confidence.evidenceStrength) {
    // RM-04 (I-016, CT-05): banner label and missing-evidence count both come from AGG-01.
    const display = screen.display;
    const label = display?.strength.evidence ?? EVIDENCE_STRENGTH_LABELS[confidence.evidenceStrength] ?? confidence.evidenceStrength;
    const missing = display ? (display.missingEvidenceCount === null ? '부족한 근거 집계 불가' : `부족한 근거 ${display.missingEvidenceCount}개`) : null;
    return (
      <p className={styles.muted}>
        근거 강도: {label} (근거 강도 기준, 위원회 확신도 없음){missing ? ` · ${missing}` : ''}
      </p>
    );
  }
  return <p className={styles.muted}>확신도: 확인 불가</p>;
}

export function ReviewMembersTab({ screen }: { screen: ReviewConsoleScreen }) {
  const opinions = screen.memberOpinions;
  const notice = screen.memberOpinionsOmitted === 'SECRET'
    ? MEMBER_OPINION_NOTICE.SECRET
    : opinions == null
      ? MEMBER_OPINION_NOTICE.LEGACY
      : opinions.length === 0
        ? MEMBER_OPINION_NOTICE.EMPTY
        : null;
  return (
    <section className={styles.panel}>
      <p className={styles.eyebrow}>현재 메뉴 · 결과 · 위원 의견</p>
      <h2>위원 의견</h2>
      <ConfidenceLine screen={screen} />
      {notice ? <p className={styles.helperText}>{notice}</p> : null}
      {opinions && opinions.length > 0 ? (
        <>
          <p className={styles.muted}>위원 {opinions.length}명</p>
          <TranslationHint />
          {opinions.map((member) => (
            <details className={styles.technicalDetails} key={member.memberId}>
              <summary>
                위원 {member.memberId} · {committeeRoleLabel(member.memberId)} · 확신도 {confidenceLabel(member.confidence)}
                {member.revised === true ? ' · 토론 후 수정' : ''}
              </summary>
              <p lang="en">{member.opinion || '의견 없음'}</p>
              {member.basis ? <p className={styles.muted}>판단 근거: <span lang="en">{member.basis}</span></p> : null}
              {member.problems.length > 0 ? (
                <ul lang="en">{member.problems.map((item) => <li key={item}>{item}</li>)}</ul>
              ) : null}
            </details>
          ))}
        </>
      ) : null}
      {(screen.opinionDifferences ?? []).length > 0 ? (
        <>
          <h3>위원 간 의견 차이</h3>
          <ul lang="en">{(screen.opinionDifferences ?? []).map((item) => <li key={item}>{item}</li>)}</ul>
        </>
      ) : null}
      {(screen.disputedPoints ?? []).length > 0 ? (
        <>
          <h3>쟁점</h3>
          <ul lang="en">{(screen.disputedPoints ?? []).map((item) => <li key={item}>{item}</li>)}</ul>
        </>
      ) : null}
    </section>
  );
}

export function ReviewEvidenceTab({ screen }: { screen: ReviewConsoleScreen }) {
  return (
    <>
      <section className={styles.panel}>
        <p className={styles.eyebrow}>현재 메뉴 · 결과 · 심사 근거</p>
        <h2>측정된 사실</h2>
        <p className={styles.muted}>심사 근거</p>
        <div className={styles.row}><span className={styles.label}>자료 ID</span><span>{screen.evidenceId ?? '근거 미연결'}</span></div>
        <Link className={styles.inline} href={juryHref('/evidence')}>심사 근거 목록</Link>
        {screen.measured.length === 0 ? <p className={styles.muted}>측정된 값이 없어요.</p> : null}
        {screen.measured.map((metric) => (
          <div className={styles.row} key={metric.id}>
            <span>{metric.metric}</span>
            <span>{metric.text} <StatusBadge status={metric.availability}>{userLabel(metric.availability)}</StatusBadge></span>
          </div>
        ))}
      </section>
      <section className={styles.panel}>
        <h2>확인된 주장</h2>
        {claimList(screen, 'supported').length === 0 ? <p className={styles.muted}>{claimEmptyText(screen)}</p> : (
          <ul lang="en">{claimList(screen, 'supported').map((item) => <li key={item}><StatusBadge>확인됨</StatusBadge> {item}</li>)}</ul>
        )}
        <h3>판단 근거</h3>
        {screen.dimensionEvidence.length === 0 ? <p className={styles.muted}>판단 근거 기록 없음</p> : (
          <ul lang="en">{screen.dimensionEvidence.map((item) => <li key={item}>{item}</li>)}</ul>
        )}
      </section>
      <section className={styles.panel}>
        <h2>부족한 근거</h2>
        <p className={styles.muted}>일부만 확인된 주장과 아직 확인되지 않은 가설이에요. 자료를 보완하면 다시 요청할 수 있어요.</p>
        <h3>일부만 확인된 주장</h3>
        {claimList(screen, 'partial').length === 0 ? <p className={styles.muted}>{claimEmptyText(screen)}</p> : (
          <ul lang="en">{claimList(screen, 'partial').map((item) => <li key={item}><StatusBadge>일부 확인</StatusBadge> {item}</li>)}</ul>
        )}
        <h3>확인되지 않은 가설</h3>
        {claimList(screen, 'unverified').length === 0 ? <p className={styles.muted}>{claimEmptyText(screen)}</p> : (
          <ul lang="en">{claimList(screen, 'unverified').map((item) => <li key={item}><StatusBadge>미확인</StatusBadge> {item}</li>)}</ul>
        )}
        <TranslationHint />
      </section>
      <UncheckedMetricsPanel screen={screen} />
    </>
  );
}

export function ReviewHistoryIntro({ hasHistory }: { hasHistory: boolean }) {
  return (
    <section className={styles.panel}>
      <p className={styles.eyebrow}>현재 메뉴 · 결과 · 이력</p>
      <h2>재심사·개선 이력</h2>
      {hasHistory ? null : <p className={styles.muted}>이 심사에 이어진 재심사나 개선 작업이 아직 없어요.</p>}
    </section>
  );
}

/** Shown on 요약 when follow-up blocks exist, so actions moved to 이력 stay discoverable. */
export function ReviewHistoryHint({ reviewId, hasHistory }: { reviewId: string; hasHistory: boolean }) {
  if (!hasHistory) return null;
  return (
    <section className={styles.panel}>
      <p className={styles.muted}>
        재심사·개선 작업이 이어지고 있어요. <Link className={styles.inline} href={reviewTabHref(reviewId, 'history')}>이력 탭에서 진행하기</Link>
      </p>
    </section>
  );
}

// RM-02b AGG-01: claim lists come from screen.display (deduped, highest stage); missing data is not "없음".
function claimList(screen: ReviewConsoleScreen, stage: 'supported' | 'partial' | 'unverified'): string[] {
  const display = screen.display;
  // RM-04: no UI-side fallback recount; without the display model the list is treated as unavailable.
  return display ? display.claims[stage] : [];
}

function claimEmptyText(screen: ReviewConsoleScreen): string {
  const state = screen.display?.claims.state;
  if (state === 'NONE_RECORDED') return '주장 기록 없음';
  return '집계 불가';
}

/**
 * I-092: 발견된 문제 / 개선 제안 / 검증 체크리스트 (summary tab). Display only; reads screen.proposals.
 * Proposals without observed evidence are labelled 미검증 / 일반 권고 — never shown as confirmed defects.
 */
export function ImprovementProposalsPanel({ screen }: { screen: ReviewConsoleScreen }) {
  const view = screen.proposals;
  if (!view) return null;
  return (
    <>
      <section className={styles.panel} aria-labelledby="found-problems">
        <h2 id="found-problems">발견된 문제</h2>
        {view.findings.length === 0 ? <p className={styles.muted}>{view.notice ?? '기록된 문제가 없어요 (0건 확인이 아님).'}</p> : (
          <div className={styles.resultTableWrap}>
            <table className={`${styles.resultTable} ${styles.proposalTable}`}>
              <caption className={styles.srOnly}>발견된 문제</caption>
              <thead><tr><th scope="col">문제</th><th scope="col">근거</th><th scope="col">상태</th></tr></thead>
              <tbody>
                {view.findings.map((f, i) => (
                  <tr key={`${i}-${f.problem}`}>
                    <th scope="row">{f.problem}</th>
                    <td>{f.evidence || <><span aria-hidden="true" className={styles.noStatus}>—</span><span className={styles.srOnly}>근거 없음</span></>}</td>
                    <td><StatusBadge data-proposal-status={f.status === '관찰됨' ? 'observed' : 'unverified'}>{f.status === '관찰됨' ? '관찰됨' : '미검증'}</StatusBadge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {view.state === 'LEGACY' && view.findings.length > 0 ? <p className={styles.muted}>{view.notice}</p> : null}
      </section>
      <section className={styles.panel} aria-labelledby="improvement-proposals">
        <h2 id="improvement-proposals">개선 제안</h2>
        {view.proposals.length === 0 ? <p className={styles.muted}>{view.state === 'LEGACY' ? PROPOSAL_LEGACY_SHORT : view.notice}</p> : (
          <div className={styles.resultTableWrap}>
            <table className={`${styles.resultTable} ${styles.proposalTable}`}>
              <caption className={styles.srOnly}>개선 제안</caption>
              <thead><tr><th scope="col">우선순위</th><th scope="col">수정 방법</th><th scope="col">기대 효과</th><th scope="col">근거 구분</th></tr></thead>
              <tbody>
                {view.proposals.map((p, i) => (
                  <tr key={`${i}-${p.problem}`}>
                    <td><StatusBadge data-priority={p.priority}>{p.priority}</StatusBadge></td>
                    <td>
                      <strong>{p.problem}</strong>
                      {p.goal ? <p className={styles.muted}>목표: {p.goal}</p> : null}
                      <ol className={styles.proposalSteps}>{p.steps.map((step, j) => <li key={j}>{step}</li>)}</ol>
                      {p.dissent ? <p className={styles.muted}>이견: {p.dissent}</p> : null}
                    </td>
                    <td>{p.expectedEffect || <><span aria-hidden="true" className={styles.noStatus}>—</span><span className={styles.srOnly}>기대 효과 없음</span></>} <StatusBadge>AI 추정</StatusBadge></td>
                    <td>
                      <StatusBadge data-proposal-status={p.statusLabel === '근거 있음' ? 'observed' : 'unverified'}>{p.basisLabel} · {p.statusLabel}</StatusBadge>
                      {p.rationaleLabel ? <p className={styles.muted}><StatusBadge data-rationale={p.rationaleType}>{p.rationaleLabel}</StatusBadge>{p.rationale ? ` ${p.rationale}` : ''}</p> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {view.noChange.length > 0 ? (
        <section className={styles.panel} aria-labelledby="no-change-items">
          <h2 id="no-change-items">수정 불필요</h2>
          <p className={styles.muted}>검토했지만 바꿀 근거가 없어 그대로 두는 것이 좋다고 판단한 부분이에요.</p>
          <div className={styles.resultTableWrap}>
            <table className={`${styles.resultTable} ${styles.proposalTable}`}>
              <caption className={styles.srOnly}>수정 불필요</caption>
              <thead><tr><th scope="col">영역</th><th scope="col">유지 이유</th><th scope="col">근거</th></tr></thead>
              <tbody>
                {view.noChange.map((n, i) => (
                  <tr key={`${i}-${n.area}`}>
                    <th scope="row">{n.area}</th>
                    <td>{n.reason}</td>
                    <td>{n.evidence || <><span aria-hidden="true" className={styles.noStatus}>—</span><span className={styles.srOnly}>근거 없음</span></>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
      <section className={styles.panel} aria-labelledby="verification-checklist">
        <h2 id="verification-checklist">검증 체크리스트</h2>
        {view.checklist.length === 0 ? <p className={styles.muted}>확인할 항목이 없어요.</p> : (
          <div className={styles.resultTableWrap}>
            <table className={`${styles.resultTable} ${styles.proposalTable}`}>
              <caption className={styles.srOnly}>검증 체크리스트</caption>
              <thead><tr><th scope="col">확인 항목</th><th scope="col">관련 문제</th><th scope="col">상태</th></tr></thead>
              <tbody>
                {view.checklist.map((c, i) => (
                  <tr key={`${i}-${c.item}`}><th scope="row">{c.item}</th><td>{c.problem}</td><td><StatusBadge>확인 전</StatusBadge></td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

const PROPOSAL_LEGACY_SHORT = '이전 형식 결과 — 개선 제안 없음';
