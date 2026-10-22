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
import { Tabs, TranslationHint, type TabItem } from './ui-primitives';
import styles from './jury.module.css';

export const REVIEW_TAB_IDS = ['summary', 'members', 'evidence', 'history'] as const;
export type ReviewTabId = (typeof REVIEW_TAB_IDS)[number];

const REVIEW_TAB_LABELS: Record<ReviewTabId, string> = {
  summary: '요약',
  members: '위원 의견',
  evidence: '검증 근거',
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
  return <Tabs items={items} activeId={active} label="리뷰 결과 탭" />;
}

/** Confidence line: board confidence, else evidence strength (older results), else 확인 불가. */
export function ConfidenceLine({ screen }: { screen: ReviewConsoleScreen }) {
  const confidence = screen.confidence;
  if (confidence?.source === 'BOARD') {
    return <p className={styles.muted}>위원회 확신도: {confidenceLabel(confidence.value)}</p>;
  }
  if (confidence?.source === 'EVIDENCE_STRENGTH' && confidence.evidenceStrength) {
    return (
      <p className={styles.muted}>
        근거 강도: {EVIDENCE_STRENGTH_LABELS[confidence.evidenceStrength] ?? confidence.evidenceStrength} (근거 강도 기준, 위원회 확신도 없음)
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
        <p className={styles.eyebrow}>현재 메뉴 · 결과 · 검증 근거</p>
        <h2>측정된 사실</h2>
        <p className={styles.muted}>리뷰 자료</p>
        <div className={styles.row}><span className={styles.label}>Evidence ID</span><span>{screen.evidenceId ?? '없음'}</span></div>
        <Link className={styles.inline} href={juryHref('/evidence')}>리뷰 자료 목록</Link>
        {screen.measured.length === 0 ? <p className={styles.muted}>측정된 값이 없습니다.</p> : null}
        {screen.measured.map((metric) => (
          <div className={styles.row} key={metric.id}>
            <span>{metric.metric}</span>
            <span>{metric.text} <span className={styles.badge}>{userLabel(metric.availability)}</span></span>
          </div>
        ))}
      </section>
      <section className={styles.panel}>
        <h2>확인된 주장</h2>
        {claimList(screen, 'supported').length === 0 ? <p className={styles.muted}>{claimEmptyText(screen)}</p> : (
          <ul lang="en">{claimList(screen, 'supported').map((item) => <li key={item}><span className={styles.badge}>확인됨</span> {item}</li>)}</ul>
        )}
        <h3>판단 근거</h3>
        {screen.dimensionEvidence.length === 0 ? <p className={styles.muted}>없음</p> : (
          <ul lang="en">{screen.dimensionEvidence.map((item) => <li key={item}>{item}</li>)}</ul>
        )}
      </section>
      <section className={styles.panel}>
        <h2>부족한 근거</h2>
        <p className={styles.muted}>일부만 확인된 주장과 아직 확인되지 않은 가설입니다. 자료를 보완하면 다시 요청할 수 있습니다.</p>
        <h3>일부만 확인된 주장</h3>
        {claimList(screen, 'partial').length === 0 ? <p className={styles.muted}>{claimEmptyText(screen)}</p> : (
          <ul lang="en">{claimList(screen, 'partial').map((item) => <li key={item}><span className={styles.badge}>일부 확인</span> {item}</li>)}</ul>
        )}
        <h3>확인되지 않은 가설</h3>
        {claimList(screen, 'unverified').length === 0 ? <p className={styles.muted}>{claimEmptyText(screen)}</p> : (
          <ul lang="en">{claimList(screen, 'unverified').map((item) => <li key={item}><span className={styles.badge}>미확인</span> {item}</li>)}</ul>
        )}
        <TranslationHint />
      </section>
    </>
  );
}

export function ReviewHistoryIntro({ hasHistory }: { hasHistory: boolean }) {
  return (
    <section className={styles.panel}>
      <p className={styles.eyebrow}>현재 메뉴 · 결과 · 이력</p>
      <h2>재심사·개선 이력</h2>
      {hasHistory ? null : <p className={styles.muted}>이 리뷰에 이어진 재심사나 개선 작업이 아직 없습니다.</p>}
    </section>
  );
}

/** Shown on 요약 when follow-up blocks exist, so actions moved to 이력 stay discoverable. */
export function ReviewHistoryHint({ reviewId, hasHistory }: { reviewId: string; hasHistory: boolean }) {
  if (!hasHistory) return null;
  return (
    <section className={styles.panel}>
      <p className={styles.muted}>
        재심사·개선 작업이 이어지고 있습니다. <Link className={styles.inline} href={reviewTabHref(reviewId, 'history')}>이력 탭에서 진행하기</Link>
      </p>
    </section>
  );
}

// RM-02b AGG-01: claim lists come from screen.display (deduped, highest stage); missing data is not "없음".
function claimList(screen: ReviewConsoleScreen, stage: 'supported' | 'partial' | 'unverified'): string[] {
  const display = screen.display;
  if (display) return display.claims[stage];
  return stage === 'supported' ? screen.supportedClaims : stage === 'partial' ? screen.partiallySupportedClaims : screen.hypotheses;
}

function claimEmptyText(screen: ReviewConsoleScreen): string {
  const state = screen.display?.claims.state;
  if (state === 'NONE_RECORDED') return '주장 기록 없음';
  if (state === 'UNAVAILABLE') return '집계 불가';
  return '없음';
}
