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
import { displayText, userLabel } from '@/lib/jury-product/ui-labels';
import { TranslationHint } from './ui-primitives';
import { ReviewSubmitButton } from './review-submit-button';
import { CONNECTED_REVIEW_PENDING_NOTE } from '@/lib/jury-product/connected-service-copy';
import styles from './jury.module.css';

function mark(value: boolean): string {
  return value ? '✓' : '—';
}

function NextAction({ model }: { model: ServiceOperationModel }) {
  const action = model.next;
  if (!action) return null;
  return (
    <section>
      <h3>다음 할 일</h3>
      <p title={action.label}>{displayText(action.label)}</p>
      <p>상태 <span className={styles.badge}>{userLabel(action.state)}</span></p>
      {action.state === 'AVAILABLE' && action.id === 'discover' ? (
        <form action={runOnboardingDiscovery}>
          <input type="hidden" name="connectionId" value={model.connectionId} />
          <input type="hidden" name="tenantId" value="client-supplied-tenant" />
          <button className={styles.button} type="submit">서비스 확인 실행</button>
        </form>
      ) : null}
      {action.state === 'AVAILABLE' && action.id === 'collect-evidence' ? (
        <form action={collectConnectedServiceEvidence}>
          <input type="hidden" name="connectionId" value={model.connectionId} />
          <input type="hidden" name="tenantId" value="client-supplied-tenant" />
          <input type="hidden" name="purpose" value="aisle-self-observation" />
          <CollectPeriodFields />
          <input type="hidden" name="timezone" value="Asia/Seoul" />
          <button className={styles.button} type="submit">검증 근거 수집</button>
        </form>
      ) : null}
      {action.state === 'AVAILABLE' && action.id === 'run-review' && model.evidence.evidenceId && model.review.running ? (
        <p className={styles.muted} role="status">진행 중인 심사가 있어요. 잠시 후 결과를 확인하세요.</p>
      ) : null}
      {action.state === 'AVAILABLE' && action.id === 'run-review' && model.evidence.evidenceId && !model.review.running ? (
        <form action={runConnectedServiceJuryReview}>
          <input type="hidden" name="connectionId" value={model.connectionId} />
          <input type="hidden" name="evidenceId" value={model.evidence.evidenceId} />
          <input type="hidden" name="tenantId" value="client-supplied-tenant" />
          <ReviewSubmitButton label="심사 실행" pendingLabel="심사 진행 중" pendingNote={CONNECTED_REVIEW_PENDING_NOTE} />
          <p className={styles.muted}>{CONNECTED_REVIEW_PENDING_NOTE}</p>
        </form>
      ) : null}
      {action.state === 'AVAILABLE' && (action.id === 'review-improvement' || action.id === 'run-agent') && model.improvement.latestId ? (
        <p><Link className={styles.inline} href={juryHref(`/improvements/${model.improvement.latestId}`)}>{displayText(action.label)}</Link></p>
      ) : null}
      {action.state === 'LOCKED' ? <p className={styles.muted}>현재 서비스 권한으로는 이 작업을 할 수 없습니다.</p> : null}
      {action.state === 'NOT_READY' ? <p className={styles.muted}>앞 단계가 완료되면 이 작업을 할 수 있습니다.</p> : null}
    </section>
  );
}

export function ServiceOperationsList({
  rows,
  error,
  providers = {},
}: {
  rows: ServiceOperationModel[] | null;
  error: string | null;
  providers?: Record<string, SafeProviderView>;
}) {
  return (
    <section className={styles.panel}>
      <div className={styles.pageIntro}>
        <div>
          <p className={styles.eyebrow}>현재 메뉴 · 서비스</p>
          <h2 className={styles.pageTitle}>서비스</h2>
          <p className={styles.pageDescription}>서비스별 연결 상태, 검증 근거, 심사, 개선, 에이전트 상태를 확인합니다. 접근 권한 변경은 관리 &gt; 서비스 연결에서 합니다.</p>
        </div>
      </div>
      <p><Link className={styles.inline} href={juryHref('/services/github')}>GitHub 연결</Link></p>
      {error ? <p>{error}</p> : null}
      {!error && rows && rows.length === 0 ? <p>현재 권한으로 볼 수 있는 서비스가 없습니다.</p> : null}
      {rows && rows.length > 0 ? (
        <div className={styles.servicesTableWrap}>
        <table className={`${styles.table} ${styles.servicesTable} ${styles.servicesTableWide}`}>
          <thead>
            <tr>
              <th>서비스 이름</th>
              <th>제공자</th>
              <th>연결 상태</th>
              <th>운영 상태</th>
              <th>최근 검증 근거</th>
              <th>최근 심사</th>
              <th>현재 결론</th>
              <th>열린 개선 작업</th>
              <th>에이전트 상태</th>
              <th>최근 활동</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.connectionId}>
                <td><Link className={`${styles.inline} ${styles.ellipsisText}`} href={juryHref(`/services/${row.connectionId}`)} title={row.name}>{row.name}</Link></td>
                <td>{providers[row.connectionId]?.displayName ?? displayText('Unknown')}</td>
                <td><span className={styles.badge} title={row.connectionStatus}>{userLabel(row.connectionStatus)}</span></td>
                <td title={row.phase ?? undefined}>{row.phase ? userLabel(row.phase) : '—'}</td>
                <td>{row.parts.evidence === 'READY' ? userLabel('READY') : displayText('No evidence collected yet')}</td>
                <td>{hasReviewAccess(row) ? displayText(row.lastReview) : '—'}</td>
                <td>{hasReviewAccess(row) ? displayText(row.review.decision ?? 'No review') : '—'}</td>
                <td>{improvementOpenCountCell(row)}</td>
                <td>{hasReviewAccess(row) ? displayText(row.agent.status ?? 'No execution') : '—'}</td>
                <td>{displayText(row.lastActivity)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      ) : null}
    </section>
  );
}

export function ServiceOperationDetail({
  model,
  provider,
}: {
  model: ServiceOperationModel;
  provider?: SafeProviderView | null;
}) {
  return (
    <section className={styles.panel}>
      <h2 className={styles.pageTitle}>{model.name}</h2>
      <p>연결 <span className={styles.badge} title={model.connectionStatus}>{userLabel(model.connectionStatus)}</span></p>
      {model.phase ? <p>운영 상태 <span className={styles.badge} title={model.phase}>{userLabel(model.phase)}</span></p> : null}
      {model.health ? <p>서비스 상태 <span className={styles.badge} title={model.health}>{userLabel(model.health)}</span></p> : null}
      {provider ? (
        <>
          <h3>연결 설정</h3>
          <p>제공자 {provider.displayName}</p>
          <p>연결 방식 <span title={provider.configuration.connectionMethod}>{displayText(provider.configuration.connectionMethod)}</span></p>
          <p>접근 방식 <span title={provider.configuration.accessMode}>{displayText(provider.configuration.accessMode)}</span></p>
          <p>자격 증명 상태 <span className={styles.badge} title={provider.configuration.credentialStatus}>{userLabel(provider.configuration.credentialStatus)}</span></p>
          <p>연결 상태 <span className={styles.badge} title={provider.configuration.connectionStatus}>{userLabel(provider.configuration.connectionStatus)}</span></p>
          <p>수명 주기 <span className={styles.badge} title={provider.configuration.lifecycle}>{userLabel(provider.configuration.lifecycle)}</span></p>
          <p>준비 상태 <span className={styles.badge} title={provider.configuration.readiness}>{userLabel(provider.configuration.readiness)}</span></p>
          <p>연결 상태 점검 <span className={styles.badge} title={provider.health}>{userLabel(provider.health)}</span></p>
          <p>기능 {provider.configuration.capabilities.join(', ')}</p>
          <p>{provider.configuration.notice}</p>
          {provider.provider === 'GITHUB' ? <p><Link className={styles.inline} href={juryHref('/services/github')}>GitHub 저장소</Link></p> : null}
        </>
      ) : null}

      <h3>개요</h3>
      <p>검증 근거 {userLabel(model.parts.evidence)}</p>
      {model.parts.review ? <p>심사 {userLabel(model.parts.review)}</p> : null}
      {model.parts.improvement ? <p>개선 {userLabel(model.parts.improvement)}</p> : null}
      {model.parts.agent ? <p>에이전트 {userLabel(model.parts.agent)}</p> : null}

      <h3>연결 준비</h3>
      <p>서비스 확인 {userLabel(model.onboarding.discovery)}</p>
      <p>범위 {userLabel(model.onboarding.scope)}</p>
      <p>연결 {userLabel(model.onboarding.connection)}</p>

      <h3>검증 근거</h3>
      {model.evidence.empty ? <p>{displayText('No evidence collected yet')}</p> : (
        <>
          <p>기간 {model.evidence.period}</p>
          <p>최근 수집 {formatKstFull(model.evidence.collectedAt)}</p>
          <p>수집 방식 {model.evidence.adapter}</p>
          <p>측정된 지표 {model.evidence.measuredCount}</p>
          <p>측정되지 않은 지표 {model.evidence.notMeasuredCount}</p>
          <p>검증 근거 항목 {model.evidence.evidenceItemCount}</p>
          <p>GA4 {model.evidence.ga4}</p>
          <p>수집 상태 <span title={model.evidence.collectionStatus}>{displayText(model.evidence.collectionStatus)}</span></p>
        </>
      )}

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

      <NextAction model={model} />

      <h3>최근 활동</h3>
      {model.activity.length === 0 ? <p>{displayText('No activity')}</p> : model.activity.map((row) => (
        <p key={row.id}>{displayText(row.label)} · {displayText(row.age)}</p>
      ))}

      <h3>내 권한</h3>
      <p>조직 역할 <span title={model.access.organizationRole}>{userLabel(model.access.organizationRole)}</span></p>
      <p>서비스 권한 {model.access.servicePermission ?? '없음'}</p>
      <p>열람(VIEW) {mark(model.access.capabilities.VIEW)}</p>
      <p>심사(REVIEW) {mark(model.access.capabilities.REVIEW)}</p>
      <p>개선(IMPROVE) {mark(model.access.capabilities.IMPROVE)}</p>
      <p>에이전트(AGENT) {mark(model.access.capabilities.AGENT)}</p>
      <p className={styles.muted}>권한 변경은 관리 &gt; 서비스 연결에서 합니다.</p>
      <p><Link className={styles.inline} href={juryHref('/organization/services')}>서비스 연결</Link></p>
    </section>
  );
}

export function ServiceOperationState({
  reason,
}: {
  reason: 'NOT_FOUND' | 'FORBIDDEN' | 'STORE_UNAVAILABLE' | 'UNAUTHENTICATED' | 'NO_MEMBERSHIP';
}) {
  const copy = {
    NOT_FOUND: '서비스를 찾을 수 없습니다.',
    FORBIDDEN: '이 서비스에 접근할 권한이 없습니다.',
    STORE_UNAVAILABLE: 'Jury 저장소가 아직 준비되지 않았습니다.',
    UNAUTHENTICATED: '로그인이 필요합니다.',
    NO_MEMBERSHIP: '조직 멤버십이 필요합니다.',
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
      <p className={styles.muted}>검증된 실모델 결과만 표시합니다{trend.excluded ? ` (그 외 ${trend.excluded}건 제외)` : ''}. 점수·비율은 표시하지 않습니다.</p>
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
