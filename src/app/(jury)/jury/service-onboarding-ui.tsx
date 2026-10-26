import Link from 'next/link';
import { formatKstFull } from './review-summary-format';
import { displayText } from '@/lib/jury-product/ui-labels';
import { CollectPeriodFields } from './collect-period-fields';
import { summarizeProblems } from '@/lib/jury-product/review-display-model';
import { juryHref } from '@/lib/jury-product/jury-url';
import type { JuryActor } from '@/lib/jury-product/access';
import { JURY_ACCESS_METHODS } from '@/lib/jury-product/records';
import type { JuryConsoleView } from '@/lib/jury-product/console-view';
import { projectConnectedServiceFlow } from '@/lib/jury-product/connected-service-review';
import { formatMeasuredValue } from '@/lib/jury-product/product-shell';
import {
  MOCK_ONBOARDING_SERVICE,
  ONBOARDING_EMPTY_SCOPES,
  projectServiceOnboarding,
  scopePurpose,
} from '@/lib/jury-product/service-onboarding';
import {
  isGithubInstallationConnection,
  isSyntheticMockDiscovery,
} from '@/lib/jury-product/services/github/onboarding-discovery';
import {
  collectConnectedServiceEvidence,
  decideOnboardingScope,
  runConnectedServiceJuryReview,
  runOnboardingDiscovery,
  startServiceOnboarding,
} from './actions';
import { OnboardingSubmit } from './shell-client';
import { ReviewSubmitButton } from './review-submit-button';
import { ConnectedReviewStatus } from './connected-review-status';
import {
  CONNECTED_REVIEW_PENDING_NOTE,
  CONNECTED_REVIEW_STALE_TEXT,
  UNMEASURED_METRICS_NOTE,
  connectedMetricText,
  connectedReviewStatusText,
} from '@/lib/jury-product/connected-service-copy';
import { canShowWrite } from './ui';
import styles from './jury.module.css';

export function AddServiceBody({ actor }: { actor: Extract<JuryActor, { ok: true }> }) {
  if (!canShowWrite(actor, 'connection.write')) {
    return (
      <section className={styles.panel}>
        <h2 className={styles.pageTitle}>서비스 연결</h2>
        <p className={styles.muted}>현재 역할에는 서비스 연결 권한이 없습니다.</p>
      </section>
    );
  }
  return (
    <section className={styles.panel}>
      <p className={styles.eyebrow}>관리 · 서비스 연결</p>
      <h2 className={styles.pageTitle}>서비스 연결</h2>
      <p className={styles.muted}>{MOCK_ONBOARDING_SERVICE.description}</p>
      <ol className={styles.stepper} aria-label="서비스 연결 단계">
        <li className={styles.stepActive}><strong>1</strong><span>서비스 선택</span></li>
        <li><strong>2</strong><span>연결 방식 안내</span></li>
        <li><strong>3</strong><span>연결 확인</span></li>
      </ol>
      <form action={startServiceOnboarding}>
        <p>
          <span className={styles.muted}>연결할 서비스</span>
          <br />
          <strong>{MOCK_ONBOARDING_SERVICE.label}</strong>
        </p>
        <details className={styles.technicalDetails}>
          <summary>기술 정보 자세히 보기</summary>
          <p className={styles.muted}>연결 방식: {MOCK_ONBOARDING_SERVICE.adapterKey}</p>
        </details>
        <input type="hidden" name="adapterKey" value={MOCK_ONBOARDING_SERVICE.adapterKey} />
        <input type="hidden" name="tenantId" value="client-supplied-tenant" />
        <label>
          서비스 이름
          <input className={styles.field} name="displayName" required autoComplete="off" />
        </label>
        <label>
          서비스 식별 정보
          <input className={styles.field} name="serviceKey" required autoComplete="off" />
        </label>
        <label>
          연결 방식
          <select className={styles.field} name="accessMethod" defaultValue="FILE_UPLOAD">
            {JURY_ACCESS_METHODS.map((method) => (
              <option key={method} value={method}>{method}</option>
            ))}
          </select>
        </label>
        <label>
          연결 정보 참조
          <input className={styles.field} name="credentialRef" required autoComplete="off" placeholder="mock-connection-001" />
        </label>
        <OnboardingSubmit label="연결 만들기" pendingLabel="연결 중" />
      </form>
    </section>
  );
}

export function ServiceDetailBody({
  actor,
  view,
  connectionId,
}: {
  actor: Extract<JuryActor, { ok: true }>;
  view: JuryConsoleView;
  connectionId: string;
}) {
  const detail = projectServiceOnboarding(view, connectionId);
  if (!detail) {
    return (
      <section className={styles.panel} role="alert">
        <h2 className={styles.pageTitle}>서비스</h2>
        <p>현재 tenant에서 이 서비스를 찾지 못했습니다.</p>
      </section>
    );
  }
  const { connection, discovery, scopes } = detail;
  const github = isGithubInstallationConnection(connection);
  const synthetic = discovery ? isSyntheticMockDiscovery(connection.serviceKey, discovery.proposedMetrics) : false;
  return (
    <section className={styles.panel}>
      <h2 className={styles.pageTitle}>{connection.displayName}</h2>
      <p className={styles.muted}>연결 → 서비스 확인 → 접근 범위 → 활성화</p>

      <h3>연결 상태</h3>
      <p>서비스 이름 {connection.displayName}</p>
      <p>연결 방식 <span className={styles.badge}>{displayText(connection.accessMethod)}</span></p>
      <p>상태 <span className={styles.badge}>{connection.status === 'CONNECTED' ? '연결됨' : connection.status}</span></p>
      <details className={styles.technicalDetails}>
        <summary>관리자용 기술 정보</summary>
        <p>연결 어댑터 {github ? 'github' : MOCK_ONBOARDING_SERVICE.adapterKey}</p>
        <p>연결 정보 참조 {detail.credentialLabel}</p>
        <p>생성일 {formatKstFull(connection.createdAt)}</p>
        <p>수정일 {formatKstFull(connection.updatedAt)}</p>
      </details>

      <h3>서비스 확인</h3>
      <p>상태 <span className={styles.badge}>{detail.discoveryStatus === 'DISCOVERY_PENDING' ? '서비스 확인 중' : detail.discoveryStatus}</span></p>
      {discovery ? (
        <>
          {/* I-049: READ_ONLY_ACCOUNT does not use the mock discovery adapter; hide the misleading name. */}
          {connection.accessMethod === 'READ_ONLY_ACCOUNT' ? null : <p>어댑터 {github && !synthetic ? 'GitHubRepositoryDiscovery' : 'MockDiscoveryAdapter'}</p>}
          {github && synthetic ? <p>This discovery is a mock placeholder. It is not a GitHub repository list.</p> : null}
          <p>탐색 시각 {formatKstFull(discovery.exploredAt)}</p>
          <p>자원 {discovery.surfaces.join(', ')} · {discovery.menus.join(', ')}</p>
          <p>데이터 원천 {discovery.dataSources.join(', ')}</p>
          <p>수집 가능성 {discovery.feasibility}</p>
          {discovery.proposedMetrics.map((item) => (
            <p key={item.metric}>{item.metric}: {item.reason}</p>
          ))}
          {github && synthetic && canShowWrite(actor, 'discovery.approve') ? (
            <form action={runOnboardingDiscovery}>
              <input type="hidden" name="connectionId" value={connection.id} />
              <input type="hidden" name="tenantId" value="client-supplied-tenant" />
              <OnboardingSubmit label="Run GitHub Discovery" pendingLabel="Discovery running" />
            </form>
          ) : null}
        </>
      ) : canShowWrite(actor, 'discovery.approve') ? (
        <form action={runOnboardingDiscovery}>
          <input type="hidden" name="connectionId" value={connection.id} />
          <input type="hidden" name="tenantId" value="client-supplied-tenant" />
          <OnboardingSubmit label="Run Discovery" pendingLabel="Discovery running" />
        </form>
      ) : (
        <p className={styles.muted}>Discovery 실행: 현재 역할에는 이 변경 권한이 없습니다.</p>
      )}

      <h3>접근 범위</h3>
      {scopes.length === 0 ? <p>{ONBOARDING_EMPTY_SCOPES}</p> : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>자원</th>
              <th>목적</th>
              <th>접근 방식</th>
              <th>권한</th>
              <th>승인</th>
            </tr>
          </thead>
          <tbody>
            {scopes.map((scope) => (
              <tr key={scope.id}>
                <td>{scope.grants.map((grant) => grant.resource).join(', ') || 'Not available'}</td>
                <td>{scope.grants.map((grant) => scopePurpose(grant.resource, discovery)).join(', ')}</td>
                <td>{scope.grants.map((grant) => grant.mode).join(', ') || 'Not available'}</td>
                <td>{scope.grants.some((grant) => grant.mode === 'READ') ? 'READ' : 'Not available'}</td>
                <td><span className={styles.badge}>{displayText(scope.status)}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {scopes.filter((scope) => scope.status === 'PROPOSED' && !github).map((scope) => (
        canShowWrite(actor, 'scope.write') ? (
          <form action={decideOnboardingScope} key={scope.id}>
            <input type="hidden" name="scopeId" value={scope.id} />
            <input type="hidden" name="connectionId" value={connection.id} />
            <input type="hidden" name="tenantId" value="client-supplied-tenant" />
            <OnboardingSubmit label="Approve" pendingLabel="Saving approval" name="decision" value="APPROVE" />
            <OnboardingSubmit label="Reject" pendingLabel="Saving rejection" name="decision" value="REJECT" />
          </form>
        ) : (
          <p className={styles.muted} key={scope.id}>scope 승인: 현재 역할에는 이 변경 권한이 없습니다.</p>
        )
      ))}

      <h3>활성화</h3>
      <p>상태 <span className={styles.badge}>{displayText(connection.status)}</span></p>
      {connection.status === 'CONNECTED' ? <p>연결됨</p> : <p>연결되지 않음</p>}
      <h3>자료</h3>
      {github ? (
        <p>
          Evidence collection stays closed until one repository scope is approved.
          {' '}
          <Link className={styles.inline} href={juryHref('/services/github')}>GitHub 저장소</Link>
        </p>
      ) : connection.status === 'CONNECTED' ? (
        canShowWrite(actor, 'connection.write') ? (
          <form action={collectConnectedServiceEvidence}>
            <input type="hidden" name="connectionId" value={connection.id} />
            <input type="hidden" name="tenantId" value="client-supplied-tenant" />
            <input type="hidden" name="purpose" value="aisle-self-observation" />
            <CollectPeriodFields />
            <input type="hidden" name="timezone" value="Asia/Seoul" />
            <p className={styles.muted}>purpose aisle-self-observation · Asia/Seoul</p>
            <OnboardingSubmit label="자료 수집" pendingLabel="자료 수집 중" />
          </form>
        ) : (
          <p className={styles.muted}>Evidence 수집: 현재 역할에는 이 변경 권한이 없습니다.</p>
        )
      ) : (
        <p>Evidence collection stays closed until the service is CONNECTED.</p>
      )}
      {projectConnectedServiceFlow(view, connection.id).map((row) => (
        <article key={row.id}>
          <p>purpose {row.purpose}</p>
          <p>period {row.periodStart} – {row.periodEnd} · {row.timezone}</p>
          <p>adapter {row.adapterKey}</p>
          <p>contentHash {row.contentHash ?? '기록 없음'}</p>
          <p>collection status <span className={styles.badge}>{row.collectionStatus}</span></p>
          <p>readOnly {row.readOnly ? 'true' : 'false'}</p>
          <p>piiExcluded {row.piiExcluded ? 'true' : 'false'}</p>
          {row.metrics.map((metric) => (
            <p key={metric.id}>{metric.metric} {connectedMetricText(metric.value, metric.availability, formatMeasuredValue)}</p>
          ))}
          {row.metrics.some((metric) => metric.availability !== 'AVAILABLE') ? <p className={styles.muted}>{UNMEASURED_METRICS_NOTE}</p> : null}
          <ConnectedReviewStatus
            badgeClass={styles.badge}
            mutedClass={styles.muted}
            statusText={connectedReviewStatusText(row.reviewStatus, row.reviewStale, displayText)}
            staleText={row.reviewStale ? CONNECTED_REVIEW_STALE_TEXT : null}
          />
          {row.decision ? <p>판정 {displayText(row.decision)}</p> : null}
          {row.completedAt ? <p>완료 시각 {formatKstFull(row.completedAt)}</p> : null}
          {row.summary ? <p>요약 {row.summary}</p> : null}
          {row.decision ? <p>주요 문제 {summarizeProblems(row.decision, row.topProblems).items.join(', ') || summarizeProblems(row.decision, row.topProblems).emptyText}</p> : null}
          {row.expectedUserEffect ? <p>예상 사용자 영향 {row.expectedUserEffect}</p> : null}
          {row.risk ? <p>위험 {row.risk}</p> : null}
          {row.collectionStatus === 'AVAILABLE' && (row.reviewStatus !== 'RUNNING' || row.reviewStale) && canShowWrite(actor, 'review.start') ? (
            <form action={runConnectedServiceJuryReview}>
              <input type="hidden" name="connectionId" value={connection.id} />
              <input type="hidden" name="evidenceId" value={row.id} />
              <input type="hidden" name="tenantId" value="client-supplied-tenant" />
              <ReviewSubmitButton label="심사 실행" pendingLabel="심사 진행 중" pendingNote={CONNECTED_REVIEW_PENDING_NOTE} />
              <p className={styles.muted}>{CONNECTED_REVIEW_PENDING_NOTE}</p>
            </form>
          ) : null}
          {row.resultId ? <p><Link className={styles.inline} href={juryHref(`/reviews/${row.resultId}`)}>심사 결과</Link></p> : null}
        </article>
      ))}
      {detail.canOpenEvidence ? (
        <p>
          <Link className={styles.inline} href={juryHref('/evidence')}>자료</Link>
          {' · '}
          <Link className={styles.inline} href={juryHref('/reviews')}>심사 결과</Link>
        </p>
      ) : null}
    </section>
  );
}
