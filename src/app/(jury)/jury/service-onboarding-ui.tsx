import Link from 'next/link';
import { formatKstFull } from './review-summary-format';
import { reasonDisplay } from '@/lib/jury-product/services/readonly-account/flow';
import { dataSourceLabels, discoveryMenuText, displayText, metricLabel, scopeResourceLabel, surfaceLabels } from '@/lib/jury-product/ui-labels';
import { CollectPeriodFields } from './collect-period-fields';
import { summarizeProblems } from '@/lib/jury-product/review-display-model';
import { juryHref } from '@/lib/jury-product/jury-url';
import type { JuryActor } from '@/lib/jury-product/access';
import { selectableAccessMethods } from '@/lib/jury-product/services/selectable-methods';
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
import { InfoRow, InfoTable } from './info-table';
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
import type { ServiceTab } from './service-detail-tabs-model';
import styles from './jury.module.css';
import { StatusBadge } from './jury-controls';



export function AddServiceBody({ actor }: { actor: Extract<JuryActor, { ok: true }> }) {
  const methods = selectableAccessMethods();
  if (!canShowWrite(actor, 'connection.write')) {
    return (
      <section className={styles.panel}>
        <h2 className={styles.pageTitle}>서비스 연결</h2>
        <p className={styles.muted}>현재 역할에는 서비스 연결 권한이 없어요.</p>
      </section>
    );
  }
  return (
    <section className={styles.panel}>
      <p className={styles.eyebrow}>관리 · 서비스 연결</p>
      <h2 className={styles.pageTitle}>서비스 연결</h2>
      <p className={styles.muted}>{MOCK_ONBOARDING_SERVICE.description}</p>
      <ol className={styles.stepper} aria-label="서비스 연결 단계">
        <li className={styles.stepActive}><strong>1</strong><span>서비스 정보 입력</span></li>
        <li><strong>2</strong><span>연결 확인</span></li>
      </ol>
      <form action={startServiceOnboarding}>
        <input type="hidden" name="adapterKey" value={MOCK_ONBOARDING_SERVICE.adapterKey} />
        <input type="hidden" name="tenantId" value="client-supplied-tenant" />
        <label>
          서비스 이름
          <input className={styles.field} name="displayName" required autoComplete="off" placeholder="예: 우리 쇼핑몰 웹" />
        </label>
        <label>
          서비스 식별 정보
          <input className={styles.field} name="serviceKey" required autoComplete="off" placeholder="예: shop-web 또는 https://shop.example.com" />
        </label>
        <label>
          연결 방식
          <select className={styles.field} name="accessMethod" defaultValue={methods[0]?.value} required>
            {methods.map((method) => (
              <option key={method.value} value={method.value}>{method.label}</option>
            ))}
          </select>
        </label>
        <p className={styles.muted}>GitHub 저장소는 <Link className={styles.inline} href={juryHref('/services/github')}>GitHub 연결</Link>에서 연결해요.</p>
        {/* UX stage 2: the connection reference is not a user decision; fill a fixed non-secret pointer. */}
        <input type="hidden" name="credentialRef" value="manual-entry" />
        <OnboardingSubmit label="연결 만들기" pendingLabel="연결 중" />
      </form>
    </section>
  );
}

export function ServiceDetailBody({
  actor,
  view,
  connectionId,
  section,
}: {
  actor: Extract<JuryActor, { ok: true }>;
  view: JuryConsoleView;
  connectionId: string;
  /** I-051: render only that tab's part; omitted renders the full legacy layout. */
  section?: ServiceTab;
}) {
  const all = !section;
  const show = (tab: ServiceTab) => all || section === tab;
  const detail = projectServiceOnboarding(view, connectionId);
  if (!detail) {
    return (
      <section className={styles.panel} role="alert">
        <h2 className={styles.pageTitle}>서비스</h2>
        <p>현재 조직에서 이 서비스를 찾지 못했어요.</p>
      </section>
    );
  }
  const { connection, discovery, scopes } = detail;
  const github = isGithubInstallationConnection(connection);
  const synthetic = discovery ? isSyntheticMockDiscovery(connection.serviceKey, discovery.proposedMetrics) : false;
  return (
    <section className={styles.panel}>
      {all ? <h2 className={styles.pageTitle}>{connection.displayName}</h2> : null}
      {all || section === 'connect' ? <p className={styles.muted}>연결 → 서비스 확인 → 접근 범위 → 활성화</p> : null}

      {show('overview') ? (
        <>
      <h3>상태</h3>
      <p><StatusBadge status={connection.status}>{displayText(connection.status)}</StatusBadge> {connection.status === 'CONNECTED' ? '연결됨' : '연결되지 않음'}</p>
      <p>생성일 {formatKstFull(connection.createdAt)}</p>
      <details className={styles.technicalDetails}>
        <summary>관리자용 기술 정보</summary>
        <p>연결 방식 <StatusBadge status={connection.accessMethod}>{displayText(connection.accessMethod)}</StatusBadge></p>
        <p>연결 어댑터 {github ? 'github' : MOCK_ONBOARDING_SERVICE.adapterKey}</p>
        <p>연결 정보 참조 {detail.credentialLabel}</p>
        <p>수정일 {formatKstFull(connection.updatedAt)}</p>
      </details>
        </>
      ) : null}

      {show('connect') ? (
        <>
      <h3>서비스 확인</h3>
      {/* I-088: 항목 | 값 | 상태 table, including one row per proposed metric (지표명 | 사유). */}
      <InfoTable caption="서비스 확인">
        <InfoRow label="확인 상태" status={<StatusBadge status={detail.discoveryStatus}>{displayText(detail.discoveryStatus)}</StatusBadge>} />
        {discovery ? (
          <>
            {/* I-049: READ_ONLY_ACCOUNT does not use the mock discovery adapter; hide the misleading name. */}
            {connection.accessMethod === 'READ_ONLY_ACCOUNT' ? null : <InfoRow label="어댑터" value={github && !synthetic ? 'GitHubRepositoryDiscovery' : 'MockDiscoveryAdapter'} />}
            <InfoRow label="탐색 시각" value={formatKstFull(discovery.exploredAt)} />
            <InfoRow label="자원" value={`${surfaceLabels(discovery.surfaces)} · ${discovery.menus.map(discoveryMenuText).join(', ')}`} />
            <InfoRow label="데이터 원천" value={dataSourceLabels(discovery.dataSources)} />
            <InfoRow label="수집 가능성" value={displayText(discovery.feasibility)} />
            {discovery.proposedMetrics.map((item) => (
              <InfoRow key={item.metric} label={metricLabel(item.metric)} value={reasonDisplay(item.reason)} title={item.metric} />
            ))}
          </>
        ) : null}
      </InfoTable>
      {discovery ? (
        <>
          {github && synthetic ? <p>이 서비스 확인 결과는 예시 데이터예요. 실제 GitHub 저장소 목록이 아니에요.</p> : null}
          <details className={styles.technicalDetails}>
            <summary>기술 정보</summary>
            <p>자원 {discovery.surfaces.join(', ')}</p>
            <p>데이터 원천 {discovery.dataSources.join(', ')}</p>
            {discovery.proposedMetrics.map((item) => <p key={item.metric} className={styles.wrapText}>지표 키 {item.metric}</p>)}
          </details>
          {github && synthetic && canShowWrite(actor, 'discovery.approve') ? (
            <form action={runOnboardingDiscovery}>
              <input type="hidden" name="connectionId" value={connection.id} />
              <input type="hidden" name="tenantId" value="client-supplied-tenant" />
              <OnboardingSubmit label="GitHub 서비스 확인" pendingLabel="서비스 확인 중" />
            </form>
          ) : null}
        </>
      ) : canShowWrite(actor, 'discovery.approve') ? (
        <form action={runOnboardingDiscovery}>
          <input type="hidden" name="connectionId" value={connection.id} />
          <input type="hidden" name="tenantId" value="client-supplied-tenant" />
          <OnboardingSubmit label="서비스 확인 실행" pendingLabel="서비스 확인 중" />
        </form>
      ) : (
        <p className={styles.muted}>서비스 확인 실행: 현재 역할에는 이 변경 권한이 없어요.</p>
      )}

      <h3>접근 범위</h3>
      {scopes.length === 0 ? <p>{ONBOARDING_EMPTY_SCOPES}</p> : (
        <div className={styles.tableScroll}>
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
                <td className={styles.wrapText} title={scope.grants.map((grant) => grant.resource).join(', ')}>{scope.grants.map((grant) => scopeResourceLabel(grant.resource)).join(', ') || displayText('Not available')}</td>
                <td>{scope.grants.map((grant) => scopePurpose(grant.resource, discovery)).join(', ')}</td>
                <td>{scope.grants.map((grant) => displayText(grant.mode)).join(', ') || displayText('Not available')}</td>
                <td>{scope.grants.some((grant) => grant.mode === 'READ') ? displayText('READ') : displayText('Not available')}</td>
                <td><StatusBadge status={scope.status}>{displayText(scope.status)}</StatusBadge></td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}
      {scopes.length > 0 ? (
        <details className={styles.technicalDetails}>
          <summary>기술 정보</summary>
          {scopes.map((scope) => (
            <p key={scope.id} className={styles.wrapText}>접근 범위 원문 {scope.grants.map((grant) => `${grant.resource} (${grant.mode})`).join(', ')}</p>
          ))}
        </details>
      ) : null}
      {scopes.filter((scope) => scope.status === 'PROPOSED' && !github).map((scope) => (
        canShowWrite(actor, 'scope.write') ? (
          <form action={decideOnboardingScope} key={scope.id}>
            <input type="hidden" name="scopeId" value={scope.id} />
            <input type="hidden" name="connectionId" value={connection.id} />
            <input type="hidden" name="tenantId" value="client-supplied-tenant" />
            <OnboardingSubmit label="승인" pendingLabel="승인 저장 중" name="decision" value="APPROVE" />
            <OnboardingSubmit label="거절" pendingLabel="거절 저장 중" name="decision" value="REJECT" />
          </form>
        ) : (
          <p className={styles.muted} key={scope.id}>접근 범위 승인: 현재 역할에는 이 변경 권한이 없어요.</p>
        )
      ))}
        </>
      ) : null}

      {show('results') ? (
        <>
      <h3>자료</h3>
      {github ? (
        <p>
          저장소 하나의 접근 범위를 승인해야 심사 근거를 수집할 수 있어요.
          {' '}
          <Link className={styles.inline} href={juryHref('/services/github')}>GitHub 저장소</Link>
        </p>
      ) : connection.status === 'CONNECTED' ? (
        canShowWrite(actor, 'connection.write') ? (
          <details className={styles.technicalDetails} data-advanced="collect-evidence">
            <summary>고급: 기간을 직접 골라 자료 수집</summary>
          <form action={collectConnectedServiceEvidence}>
            <input type="hidden" name="connectionId" value={connection.id} />
            <input type="hidden" name="tenantId" value="client-supplied-tenant" />
            <input type="hidden" name="purpose" value="aisle-self-observation" />
            <CollectPeriodFields />
            <input type="hidden" name="timezone" value="Asia/Seoul" />
            <p className={styles.muted}>기준 시간대: 한국 시간(KST)</p>
            <OnboardingSubmit label="자료 수집" pendingLabel="자료 수집 중" />
          </form>
          </details>
        ) : (
          <p className={styles.muted}>자료 수집: 현재 역할에는 이 변경 권한이 없어요.</p>
        )
      ) : (
        <p>서비스가 연결된 뒤에 자료를 수집할 수 있어요.</p>
      )}
      {projectConnectedServiceFlow(view, connection.id).map((row) => (
        <article key={row.id}>
          <p>수집 기간 {row.periodStart} – {row.periodEnd} · {row.timezone === 'Asia/Seoul' ? '한국 시간' : row.timezone}</p>
          <p>수집 상태 <StatusBadge status={row.collectionStatus}>{displayText(row.collectionStatus)}</StatusBadge></p>
          {row.metrics.map((metric) => (
            <p key={metric.id} title={metric.metric}>{metricLabel(metric.metric)} {connectedMetricText(metric.value, metric.availability, formatMeasuredValue)}</p>
          ))}
          <details className={styles.technicalDetails}>
            <summary>기술 정보</summary>
            <p>수집 목적 {row.purpose === 'aisle-self-observation' ? '서비스 자체 관찰' : row.purpose} ({row.purpose})</p>
            <p>수집 어댑터 {row.adapterKey}</p>
            <p className={styles.wrapText}>지표 키 {row.metrics.map((metric) => metric.metric).join(', ')}</p>
            <p className={styles.wrapText}>내용 해시 {row.contentHash ?? '기록 없음'}</p>
            <p>읽기 전용 {row.readOnly ? '예' : '아니요'} · 개인정보 제외 {row.piiExcluded ? '예' : '아니요'}</p>
          </details>
          {row.metrics.some((metric) => metric.availability !== 'AVAILABLE') ? <p className={styles.muted}>{UNMEASURED_METRICS_NOTE}</p> : null}
          <ConnectedReviewStatus
            mutedClass={styles.muted}
            statusText={connectedReviewStatusText(row.reviewStatus, row.reviewStale, displayText)}
            staleText={row.reviewStale ? CONNECTED_REVIEW_STALE_TEXT : null}
          />
          {row.decision ? <p>결론 {displayText(row.decision)}</p> : null}
          {row.completedAt ? <p>완료 시각 {formatKstFull(row.completedAt)}</p> : null}
          {row.summary ? (
            <>
              <p>
                요약 <span lang="en">{row.summary}</span>
              </p>
              <p className={styles.muted}>요약은 AI 심사 원문(영어)을 그대로 보여줘요.</p>
            </>
          ) : null}
          {row.decision ? <p>주요 문제 {summarizeProblems(row.decision, row.topProblems).items.join(', ') || summarizeProblems(row.decision, row.topProblems).emptyText}</p> : null}
          {row.expectedUserEffect ? <p>예상 사용자 영향 {row.expectedUserEffect}</p> : null}
          {row.risk ? <p>위험 {row.risk}</p> : null}
          {row.collectionStatus === 'AVAILABLE' && (row.reviewStatus !== 'RUNNING' || row.reviewStale) && canShowWrite(actor, 'review.start') ? (
            <details className={styles.technicalDetails} data-advanced="run-review">
              <summary>고급: 이 근거로 심사 실행</summary>
            <form action={runConnectedServiceJuryReview}>
              <input type="hidden" name="connectionId" value={connection.id} />
              <input type="hidden" name="evidenceId" value={row.id} />
              <input type="hidden" name="tenantId" value="client-supplied-tenant" />
              <ReviewSubmitButton label="심사 실행" pendingLabel="심사 진행 중" pendingNote={CONNECTED_REVIEW_PENDING_NOTE} />
              <p className={styles.muted}>{CONNECTED_REVIEW_PENDING_NOTE}</p>
            </form>
            </details>
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
        </>
      ) : null}
    </section>
  );
}
