import type * as React from 'react';
import type { QualityTrend } from '@/lib/jury-product/quality-trend';
import Link from 'next/link';
import { formatKstFull } from './review-summary-format';
import { CollectPeriodFields } from './collect-period-fields';
import { summarizeProblems } from '@/lib/jury-product/review-display-model';
import { juryHref } from '@/lib/jury-product/jury-url';
import { hasReviewAccess, improvementOpenCountCell, type ServiceOperationModel } from '@/lib/jury-product/service-operations-status';
import type { SafeProviderView } from '@/lib/jury-product/services/provider-boundary';
import {
  collectConnectedServiceEvidence,
  runConnectedServiceJuryReview,
  runOnboardingDiscovery,
} from './actions';
import { displayText, userLabel, userLabels } from '@/lib/jury-product/ui-labels';
import { observationTakesPriority } from '@/lib/jury-product/services/readonly-account/flow';
import { TranslationHint } from './ui-primitives';
import { ReviewSubmitButton } from './review-submit-button';
import { CONNECTED_REVIEW_PENDING_NOTE } from '@/lib/jury-product/connected-service-copy';
import type { ServiceTab } from './service-detail-tabs-model';
import { ConnectionDeleteDialog } from './connection-delete-dialog';
import { filterConnectionRows } from '@/lib/jury-product/services/connection-delete/list-filter';
import { countConnectionRows, DELETED_VIEW_EMPTY, DELETED_VIEW_NOTICE, DELETED_VIEW_TITLE, type DeletedConnectionMeta } from '@/lib/jury-product/services/connection-delete/deleted-view';
import styles from './jury.module.css';
import { Button, ButtonLink, StatusBadge, buttonClass } from './jury-controls';
import { Download, Link2, Play } from 'lucide-react';
import { InfoItem, InfoList, InfoRow, InfoTable } from './info-table';

function mark(value: boolean): string {
  return value ? '✓' : '—';
}




function NextAction({ model, observationNeeded }: { model: ServiceOperationModel; observationNeeded?: boolean }) {
  const action = model.next;
  if (!action) return null;
  if (observationTakesPriority(model, observationNeeded)) {
    return (
      <section className={styles.serviceNextAction}>
        <h3>다음 할 일</h3>
        <p>관찰 실행</p>
        <p>
          <a className={buttonClass('primary')} href={`/jury/services/${model.connectionId}?tab=connect#observe`}>
            ▶ 관찰 실행
          </a>
        </p>
        <p className={styles.secondaryHint}>
          읽기 전용 계정으로 관찰을 먼저 성공시킨 뒤 {displayText(action.label)}을(를) 진행하세요.
        </p>
      </section>
    );
  }
  return (
    <section className={styles.serviceNextAction}>
      <h3>다음 할 일</h3>
      <p title={action.label}>{displayText(action.label)}</p>
      <p>상태 <StatusBadge status={action.state}>{userLabel(action.state)}</StatusBadge></p>
      {action.state === 'AVAILABLE' && action.id === 'discover' ? (
        <form action={runOnboardingDiscovery}>
          <input type="hidden" name="connectionId" value={model.connectionId} />
          <input type="hidden" name="tenantId" value="client-supplied-tenant" />
          <Button variant="secondary" icon={Play} type="submit">서비스 확인 실행</Button>
        </form>
      ) : null}
      {action.state === 'AVAILABLE' && action.id === 'collect-evidence' ? (
        <details className={styles.technicalDetails} data-advanced="collect-evidence">
          <summary>고급: 기간을 직접 골라 검증 근거 수집</summary>
          <p className={styles.muted}>보통은 화면 심사 탭의 “이 결과로 위원 심사하기”를 쓰세요.</p>
        <form action={collectConnectedServiceEvidence}>
          <input type="hidden" name="connectionId" value={model.connectionId} />
          <input type="hidden" name="tenantId" value="client-supplied-tenant" />
          <input type="hidden" name="purpose" value="aisle-self-observation" />
          <CollectPeriodFields />
          <input type="hidden" name="timezone" value="Asia/Seoul" />
          <Button variant="secondary" icon={Download} type="submit">검증 근거 수집</Button>
        </form>
        </details>
      ) : null}
      {action.state === 'AVAILABLE' && action.id === 'run-review' && model.evidence.evidenceId && model.review.running ? (
        <p className={styles.muted} role="status">진행 중인 심사가 있어요. 잠시 후 결과를 확인하세요.</p>
      ) : null}
      {action.state === 'AVAILABLE' && action.id === 'run-review' && model.evidence.evidenceId && !model.review.running ? (
        <details className={styles.technicalDetails} data-advanced="run-review">
          <summary>고급: 수집한 근거로 심사 실행</summary>
        <form action={runConnectedServiceJuryReview}>
          <input type="hidden" name="connectionId" value={model.connectionId} />
          <input type="hidden" name="evidenceId" value={model.evidence.evidenceId} />
          <input type="hidden" name="tenantId" value="client-supplied-tenant" />
          <ReviewSubmitButton label="심사 실행" pendingLabel="심사 진행 중" pendingNote={CONNECTED_REVIEW_PENDING_NOTE} />
          <p className={styles.muted}>{CONNECTED_REVIEW_PENDING_NOTE}</p>
        </form>
        </details>
      ) : null}
      {action.state === 'AVAILABLE' && (action.id === 'review-improvement' || action.id === 'run-agent') && model.improvement.latestId ? (
        <p><Link className={styles.inline} href={juryHref(`/improvements/${model.improvement.latestId}`)}>{displayText(action.label)}</Link></p>
      ) : null}
      {action.state === 'LOCKED' ? <p className={styles.muted}>현재 서비스 권한으로는 이 작업을 할 수 없어요.</p> : null}
      {action.state === 'NOT_READY' ? <p className={styles.muted}>앞 단계가 완료되면 이 작업을 할 수 있어요.</p> : null}
    </section>
  );
}

export function ServiceOperationsList({
  rows,
  error,
  providers = {},
  showDeleted = false,
  canDelete = false,
  githubConnectionIds = [],
  deletedMeta = {},
}: {
  rows: ServiceOperationModel[] | null;
  error: string | null;
  providers?: Record<string, SafeProviderView>;
  /** I-079: '삭제된 연결' filter. Deleted (DISCONNECTED) connections are hidden by default. */
  showDeleted?: boolean;
  canDelete?: boolean;
  githubConnectionIds?: readonly string[];
  /** I-080: deletion time + actor label for deleted rows. */
  deletedMeta?: Record<string, DeletedConnectionMeta>;
}) {
  const visible = rows ? filterConnectionRows(rows, showDeleted) : null;
  const counts = countConnectionRows(rows ?? []);
  const activeHref = juryHref('/services');
  const deletedHref = juryHref('/services', { filter: 'deleted' });
  return (
    <section className={`${styles.panel} ${styles.servicesPanelDark}`}>
      <div className={styles.pageIntro}>
        <div>
          <p className={styles.eyebrow}>현재 메뉴 · 서비스</p>
          <h2 className={styles.pageTitle}>{showDeleted ? DELETED_VIEW_TITLE : '서비스'}</h2>
          <p className={styles.pageDescription}>서비스별 연결 상태, 검증 근거, 심사, 개선, 에이전트 상태를 확인해요. 접근 권한 변경은 관리 &gt; 서비스 연결에서 해요.</p>
        </div>
      </div>
      <p><Link className={styles.inline} href={juryHref('/services/github')}>GitHub 연결</Link></p>
      <div className={styles.segTabs} role="tablist" aria-label="연결 목록 보기">
        <Link role="tab" aria-selected={!showDeleted} className={`${styles.segTab} ${!showDeleted ? styles.segTabActive : ''}`} href={activeHref}>연결 중 <span className={styles.segTabCount}>{counts.active}</span></Link>
        <Link role="tab" aria-selected={showDeleted} className={`${styles.segTab} ${showDeleted ? styles.segTabActive : ''}`} href={deletedHref}>삭제된 연결 <span className={styles.segTabCount}>{counts.deleted}</span></Link>
      </div>
      {showDeleted ? (
        <div className={styles.deletedNotice} role="note">
          <span>{DELETED_VIEW_NOTICE}</span>
          <ButtonLink variant="secondary" icon={Link2} href={activeHref}>연결 중 목록으로</ButtonLink>
        </div>
      ) : null}
      {error ? <p>{error}</p> : null}
      {!error && visible && visible.length === 0 ? <p>{showDeleted ? DELETED_VIEW_EMPTY : '현재 권한으로 볼 수 있는 서비스가 없어요.'}</p> : null}
      {visible && visible.length > 0 ? (
        <div className={styles.servicesTableWrap}>
        <table className={`${styles.table} ${styles.servicesTable} ${styles.servicesTableWide}`}>
          <thead>
            <tr>
              <th>서비스 이름</th>
              <th>제공자</th>
              {showDeleted ? <><th>삭제 시각 (KST)</th><th>삭제한 사람</th></> : <th>연결 상태</th>}
              {showDeleted ? null : <th>운영 상태</th>}
              <th>최근 검증 근거</th>
              <th>최근 심사</th>
              <th>현재 결론</th>
              <th className={styles.num}>열린 개선 작업</th>
              <th>에이전트 상태</th>
              <th>최근 활동</th>
              {canDelete && !showDeleted ? <th className={styles.rowActions}>관리</th> : null}
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => (
              <tr key={row.connectionId} className={showDeleted ? styles.mutedRow : undefined}>
                <td><Link className={`${styles.inline} ${styles.ellipsisText}`} href={juryHref(`/services/${row.connectionId}`)} title={row.name}>{row.name}</Link>{showDeleted ? <> <StatusBadge status="DELETED">삭제됨</StatusBadge></> : null}</td>
                <td>{providers[row.connectionId]?.displayName ?? displayText('Unknown')}</td>
                {showDeleted ? (
                  <>
                    <td>{formatKstFull(deletedMeta[row.connectionId]?.disconnectedAt)}</td>
                    <td>{deletedMeta[row.connectionId]?.deletedBy ?? '—'}</td>
                  </>
                ) : (
                  <td><StatusBadge status={row.connectionStatus} title={row.connectionStatus}>{userLabel(row.connectionStatus)}</StatusBadge></td>
                )}
                {showDeleted ? null : <td>{row.phase ? <StatusBadge status={row.phase} title={row.phase}>{userLabel(row.phase)}</StatusBadge> : '—'}</td>}
                <td>{row.parts.evidence === 'READY' ? userLabel('READY') : displayText('No evidence collected yet')}</td>
                <td>{hasReviewAccess(row) ? displayText(row.lastReview) : '—'}</td>
                <td>{hasReviewAccess(row) ? displayText(row.review.decision ?? 'No review') : '—'}</td>
                <td className={styles.num}>{improvementOpenCountCell(row)}</td>
                <td>{hasReviewAccess(row) ? <StatusBadge status={row.agent.status ?? undefined} title={row.agent.status ?? undefined}>{displayText(row.agent.status ?? 'No execution')}</StatusBadge> : '—'}</td>
                <td>{displayText(row.lastActivity)}</td>
                {canDelete && !showDeleted ? (
                  <td className={styles.rowActions}><ConnectionDeleteDialog connectionId={row.connectionId} displayName={row.name} github={githubConnectionIds.includes(row.connectionId)} /></td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      ) : null}
    </section>
  );
}

/** I-051: always-visible summary header (name once, status badges). I-070: 다음 할 일 moved to ServiceNextActionPanel. */
export function ServiceSummaryHeader({ model, children, observationNeeded }: { model: ServiceOperationModel; children?: React.ReactNode; observationNeeded?: boolean }) {
  return (
    <section className={styles.panel}>
      <h2 className={styles.pageTitle}>{model.name}</h2>
      <div className={styles.summaryHeader}>
        <p>연결 <StatusBadge status={model.connectionStatus} title={model.connectionStatus}>{userLabel(model.connectionStatus)}</StatusBadge></p>
        {model.phase ? <p>운영 상태 <StatusBadge status={model.phase} title={model.phase}>{userLabel(model.phase)}</StatusBadge></p> : null}
        {model.health ? <p>서비스 상태 <StatusBadge status={model.health} title={model.health}>{userLabel(model.health)}</StatusBadge></p> : null}
      </div>
      {children}
    </section>
  );
}

/** I-070: 다음 할 일 guidance, shown in the 개요 area below the service tabs. */
export function ServiceNextActionPanel({ model, observationNeeded }: { model: ServiceOperationModel; observationNeeded?: boolean }) {
  if (!model.next) return null;
  return (
    <section className={styles.panel}>
      <NextAction model={model} observationNeeded={observationNeeded} />
    </section>
  );
}

/** I-051: `section` renders only that tab's part; without it the full legacy layout is rendered. */
export function ServiceOperationDetail({
  model,
  provider,
  section,
}: {
  model: ServiceOperationModel;
  provider?: SafeProviderView | null;
  section?: ServiceTab;
}) {
  const all = !section;
  const show = (tab: ServiceTab) => all || section === tab;
  return (
    <section className={styles.resultCard}>
      {all ? (
        <>
          <h2 className={styles.pageTitle}>{model.name}</h2>
          <p>연결 <StatusBadge status={model.connectionStatus} title={model.connectionStatus}>{userLabel(model.connectionStatus)}</StatusBadge></p>
          {model.phase ? <p>운영 상태 <StatusBadge status={model.phase} title={model.phase}>{userLabel(model.phase)}</StatusBadge></p> : null}
          {model.health ? <p>서비스 상태 <StatusBadge status={model.health} title={model.health}>{userLabel(model.health)}</StatusBadge></p> : null}
        </>
      ) : null}
      {show('connect') && provider ? (
        <>
          <h3>연결 설정</h3>
          {/* I-088: 항목 | 값 | 상태 table; rows without a status show a faint — plus srOnly 상태 없음. */}
          <InfoTable caption="연결 설정">
            <InfoRow label="제공자" value={provider.displayName} />
            <InfoRow label="연결 방식" value={displayText(provider.configuration.connectionMethod)} title={provider.configuration.connectionMethod} />
            <InfoRow label="접근 방식" value={displayText(provider.configuration.accessMode)} title={provider.configuration.accessMode} />
            <InfoRow label="자격 증명 상태" status={<StatusBadge status={provider.configuration.credentialStatus} title={provider.configuration.credentialStatus}>{userLabel(provider.configuration.credentialStatus)}</StatusBadge>} />
            <InfoRow label="연결 상태" status={<StatusBadge status={provider.configuration.connectionStatus} title={provider.configuration.connectionStatus}>{userLabel(provider.configuration.connectionStatus)}</StatusBadge>} />
            <InfoRow label="수명 주기" status={<StatusBadge status={provider.configuration.lifecycle} title={provider.configuration.lifecycle}>{userLabel(provider.configuration.lifecycle)}</StatusBadge>} />
            <InfoRow label="준비 상태" status={<StatusBadge status={provider.configuration.readiness} title={provider.configuration.readiness}>{userLabel(provider.configuration.readiness)}</StatusBadge>} />
            <InfoRow label="연결 점검" status={<StatusBadge status={provider.health} title={provider.health}>{userLabel(provider.health)}</StatusBadge>} />
            <InfoRow label="기능" value={userLabels(provider.configuration.capabilities)} />
          </InfoTable>
          <p className={styles.infoNote}>{provider.configuration.notice}</p>
          {provider.provider === 'GITHUB' ? <p><Link className={styles.inline} href={juryHref('/services/github')}>GitHub 저장소</Link></p> : null}
        </>
      ) : null}

      {show('overview') ? (
        <>
      <h3>개요</h3>
      <p>검증 근거 {userLabel(model.parts.evidence)}</p>
      {model.parts.review ? <p>심사 {userLabel(model.parts.review)}</p> : null}
      {model.parts.improvement ? <p>개선 {userLabel(model.parts.improvement)}</p> : null}
      {model.parts.agent ? <p>에이전트 {userLabel(model.parts.agent)}</p> : null}
        </>
      ) : null}

      {show('connect') ? (
        <>
      <h3>연결 준비</h3>
      <InfoList label="연결 준비">
        <InfoItem term="서비스 확인"><StatusBadge status={model.onboarding.discovery} title={model.onboarding.discovery}>{userLabel(model.onboarding.discovery)}</StatusBadge></InfoItem>
        <InfoItem term="범위"><StatusBadge status={model.onboarding.scope} title={model.onboarding.scope}>{userLabel(model.onboarding.scope)}</StatusBadge></InfoItem>
        <InfoItem term="연결"><StatusBadge status={model.onboarding.connection} title={model.onboarding.connection}>{userLabel(model.onboarding.connection)}</StatusBadge></InfoItem>
      </InfoList>
        </>
      ) : null}

      {show('results') ? (
        <>
      <h3>검증 근거</h3>
      {model.evidence.empty ? <p>{displayText('No evidence collected yet')}</p> : (
        <>
          <p>근거 수집 시각 {formatKstFull(model.evidence.collectedAt)}</p>
          <p className={styles.muted}>검증 근거는 [자료 수집]을 실행한 시점의 관찰 결과로 만들어져요. 그 뒤에 실행한 관찰은 자료를 다시 수집해야 반영돼요.</p>
          <p>기간 {model.evidence.period}</p>
          <p>측정된 지표 {model.evidence.measuredCount}</p>
          <p>측정되지 않은 지표 {model.evidence.notMeasuredCount}</p>
          <p>검증 근거 항목 {model.evidence.evidenceItemCount}</p>
          <p>수집 상태 <span title={model.evidence.collectionStatus}>{displayText(model.evidence.collectionStatus)}</span></p>
          <details className={styles.technicalDetails}>
            <summary>기술 정보</summary>
            <p>수집 어댑터 {model.evidence.adapter ?? '기록 없음'}</p>
            <p>GA4 {model.evidence.ga4 === 'available' ? '측정됨' : model.evidence.ga4 === 'not measured' ? '측정 안 됨' : '연동 없음'}</p>
          </details>
        </>
      )}
        </>
      ) : null}

      {show('review') ? (
        <>
      {hasReviewAccess(model) ? (
        <>
          <h3>심사</h3>
          {model.review.empty ? (model.review.running ? <p>진행 중</p> : <p>심사 없음</p>) : (
            <>
              <p>결론 <span title={model.review.decision ?? undefined}>{displayText(model.review.decision)}</span></p>
              <p>요약 <span lang="en">{model.review.statusSummary}</span></p>
              <ProblemLine decision={model.review.decision} topProblems={model.review.topProblems} />
              <p>예상 사용자 효과 <span lang="en">{model.review.expectedUserEffect}</span></p>
              <p>위험 <span lang="en">{model.review.risk}</span></p>
              <TranslationHint />
              <p>심사 시각 {formatKstFull(model.review.reviewedAt)}</p>
            </>
          )}

          <h3>개선</h3>
          {model.improvement.empty ? <p>개선 없음</p> : (
            <>
              <p>열린 작업 {model.improvement.openCount}</p>
              <p>최근 상태 <span title={model.improvement.latestStatus ?? undefined}>{displayText(model.improvement.latestStatus)}</span></p>
              <p>{model.improvement.latestTitle}</p>
            </>
          )}

          <h3>에이전트</h3>
          {model.agent.empty ? <p>실행 없음</p> : (
            <>
              <p>상태 <span title={model.agent.status ?? undefined}>{displayText(model.agent.status)}</span></p>
              <p>제공자 {model.agent.provider}</p>
              <p>시작 {model.agent.startedAt ?? '기록 없음'}</p>
              <p>종료 {model.agent.finishedAt ?? '기록 없음'}</p>
              <p>변경 파일 {model.agent.changedFilesCount ?? 0}</p>
              <p>테스트 통과 {model.agent.testsPassed === null ? '기록 없음' : model.agent.testsPassed ? '예' : '아니오'}</p>
            </>
          )}
        </>
      ) : null}

      {model.flow ? (
        <>
          <h3>변경 흐름</h3>
          <p>에이전트 {userLabel(model.flow.agent)}</p>
          <p>변경 검사 {userLabel(model.flow.changeGate)}</p>
          <p>재심사 {userLabel(model.flow.reReview)}</p>
          <p>Jury 심사 {userLabel(model.flow.jury)}</p>
        </>
      ) : null}
        </>
      ) : null}

      {all ? <NextAction model={model} /> : null}

      {show('history') ? (
        <>
      <h3>최근 활동</h3>
      {model.activity.length === 0 ? <p>{displayText('No activity')}</p> : model.activity.map((row) => (
        <p key={row.id}>{displayText(row.label)} · {displayText(row.age)}</p>
      ))}

      <h3>내 권한</h3>
      <p>조직 역할 <span title={model.access.organizationRole}>{userLabel(model.access.organizationRole)}</span></p>
      <p>서비스 권한 {model.access.servicePermission ? userLabel(model.access.servicePermission) : '없음'}</p>
      <p>열람(VIEW) {mark(model.access.capabilities.VIEW)}</p>
      <p>심사(REVIEW) {mark(model.access.capabilities.REVIEW)}</p>
      <p>개선(IMPROVE) {mark(model.access.capabilities.IMPROVE)}</p>
      <p>에이전트(AGENT) {mark(model.access.capabilities.AGENT)}</p>
      <p className={styles.muted}>권한 변경은 관리 &gt; 서비스 연결에서 해요.</p>
      <p><Link className={styles.inline} href={juryHref('/organization/services')}>서비스 연결</Link></p>
        </>
      ) : null}
    </section>
  );
}

export function ServiceOperationState({
  reason,
}: {
  reason: 'NOT_FOUND' | 'FORBIDDEN' | 'STORE_UNAVAILABLE' | 'UNAUTHENTICATED' | 'NO_MEMBERSHIP';
}) {
  const copy = {
    NOT_FOUND: '서비스를 찾을 수 없어요.',
    FORBIDDEN: '이 서비스에 접근할 권한이 없어요.',
    STORE_UNAVAILABLE: 'Jury 저장소가 아직 준비되지 않았어요.',
    UNAUTHENTICATED: '로그인이 필요해요.',
    NO_MEMBERSHIP: '조직 멤버십이 필요해요.',
  }[reason];
  return <section className={styles.panel}><h2>서비스</h2><p>{copy}</p></section>;
}

// RM-02b AGG-01: shared problem summary; an empty list is never shown as "없음".
function ProblemLine({ decision, topProblems }: { decision: string | null | undefined; topProblems: unknown }) {
  const problems = summarizeProblems(decision, topProblems);
  return (
    <p>
      주요 문제{' '}
      {problems.items.length > 0 ? <span lang="en">{problems.items.join(', ')}</span> : <span>{problems.emptyText}</span>}
      {problems.severityNote ? <span> · {problems.severityNote}</span> : null}
    </p>
  );
}

/** RM-16 (M-013): 품질 추세 — 검증된 실모델 결과 3건 이상일 때만 렌더링(호출부에서 visible 확인). */
export function QualityTrendPanel({ trend }: { trend: Extract<QualityTrend, { visible: true }> }) {
  return (
    <section className={styles.panel}>
      <h2>품질 추세</h2>
      <p className={styles.muted}>검증된 실모델 결과만 표시해요{trend.excluded ? ` (그 외 ${trend.excluded}건 제외)` : ''}. 점수·비율은 표시하지 않아요.</p>
      <ol>
        {trend.points.map((p) => (
          <li key={p.resultId}>
            {formatKstFull(p.completedAt)} · {p.decision} · 수정 필요 항목 {p.problems === null ? '집계 불가' : `${p.problems}건`}
          </li>
        ))}
      </ol>
    </section>
  );
}
