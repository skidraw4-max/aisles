import Link from 'next/link';
import { listHref, pageList, type ListQuery } from '@/lib/jury-product/list-paging';
import type { ReactNode } from 'react';
import { DISPLAY_FLAG_LABELS, cycleStatusLabel, displayModelForCatalogRow } from '@/lib/jury-product/review-display-model';
import { buildRequestStatusRows } from '@/lib/jury-product/review-request-status';
import { redirect } from 'next/navigation';
import { juryEntrySurface } from '@/components/jury/entry';
import { OrganizationSwitcher } from '@/components/jury/OrganizationSwitcher';
import { listOrganizationsForUser } from '@/lib/jury-product/jury-db';
import { juryHref } from '@/lib/jury-product/jury-url';
import {
  JURY_GA4_EVENT_PREFIX,
  JURY_PROJECTABLE_DB_METRICS,
  JURY_PROJECTABLE_GA4_METRICS,
} from '@/lib/jury-product';
import { decideJuryMutation, JURY_ACTIONS, type JuryAction, type JuryActor } from '@/lib/jury-product/access';
import type { JuryConsoleView } from '@/lib/jury-product/console-view';
import { projectImprovementTrace } from '@/lib/jury-product/improvement-trace-console';
import type { ImprovementTrace } from '@/lib/jury-product/improvement-trace';
import type { ConsoleLoopScreen } from '@/lib/jury-product/console-loop-operations';
import { projectCatalogScopeForm, scopeForDiscovery } from '@/lib/jury-product/console-catalog-scope';
import { projectConsoleEvidence, projectConsoleIntakeForm } from '@/lib/jury-product/console-evidence-intake';
import { intakePeriodDefaults } from '@/lib/jury-product/evidence-period';
import type { ReviewConsoleScreen } from '@/lib/jury-product/review-console';
import { projectImprovementRows } from '@/lib/jury-product/product-improvement';
import { formatMeasuredValue, projectAudit, projectDashboard, projectTraceLineage, SHELL_EMPTY, SHELL_UNAVAILABLE } from '@/lib/jury-product/product-shell';
import { projectServiceRows } from '@/lib/jury-product/service-onboarding';
import { acknowledgeHumanReview, changeJuryMembership, createHumanImprovementTask, createJuryTenant, decideCatalogScope, decideJuryScope, handoffHumanImprovement, proposeCatalogScope, runHumanAgentExecution, runHumanChangeGate, runProductChangeGate, runProductChangeGateReReview, runHumanReReview, createReReviewImprovementTask, approveReReviewAgentAction, handoffReReviewImprovement, runReReviewAgentExecution, runReReviewChangeGate, runSecondReReview, createSecondReReviewImprovementTask, approveSecondImprovementTask, handoffSecondImprovementTask, runSecondChangeGate, runLaterReReview, createLaterReReviewImprovementTask, approveLaterImprovementTask, handoffLaterImprovementTask, runLaterAgentExecution, runLaterChangeGate, runFollowingReReview, runJuryDiscovery, stopJuryAutoLoop, submitJuryAction, submitTenantEvidenceIntake, submitTenantReview } from './actions';
import type { ProductReReviewState } from '@/lib/jury-product/product-change-gate-rereview';
import { loadShellIdentity } from './load';
import { LogoutButton, ProductNav } from './shell-client';
import { TranslationHint } from './ui-primitives';
import { CopyIdButton, ReviewSummaryDialog } from './ReviewSummaryDialog';
import { AcceptanceCriteriaDialog } from './AcceptanceCriteriaDialog';
import { formatKstFull, formatKstShort, shortId } from './review-summary-format';
import { ConfidenceLine, ResultComparison, reviewTabHref } from './review-tabs-ui';
import type { JuryMembership } from '@/lib/jury-product/records';
import { JURY_CLAIM_MAX_LENGTH } from '@/lib/jury-product/records';
import { ReviewRequestFields } from './review-request-fields';
import { CONNECTED_EVIDENCE_REVIEW_NOTICE, evidenceReviewPath } from '@/lib/jury-product/evidence-review-path';
import { ReviewSubmitButton } from './review-submit-button';
import { evidenceReviewStatus } from '@/lib/jury-product/evidence-review-status';
import { auditActionLabel, DECISION_GUIDANCE, displayText, traceLabel, userLabel } from '@/lib/jury-product/ui-labels';
import styles from './jury.module.css';
import { Button, ButtonLink, StatusBadge, buttonClass } from './jury-controls';
import { EmptyState, PageHeader } from './page-layout';
import { ArrowRight, Check, FileText, Lightbulb, Play, Plus, Send, Square, X } from 'lucide-react';

const GATE_COPY: Record<Exclude<JuryActor, { ok: true }>['reason'], string> = {
  UNAUTHENTICATED: '로그인한 뒤 Jury membership이 있는 계정으로 다시 열어야 합니다.',
  NO_MEMBERSHIP: '이 사용자에게 연결된 Jury membership이 없습니다. 관리자 권한만으로는 tenant에 들어갈 수 없습니다.',
  AMBIGUOUS_MEMBERSHIP: '이 사용자에게 membership이 둘 이상입니다. 클라이언트가 tenant를 고르지 않으며, 서버에 활성 membership이 하나일 때만 엽니다.',
  STORE_UNAVAILABLE: 'Jury 저장소가 아직 준비되지 않았습니다. migration을 적용하기 전에는 tenant 데이터를 열지 않습니다.',
};

function compactIdentifier(value: string, start = 10, end = 8): string {
  if (value.length <= start + end + 1) return value;
  return `${value.slice(0, start)}…${value.slice(-end)}`;
}

export async function JuryChrome({
  actor,
  notice,
  children,
}: {
  actor: JuryActor;
  notice?: string;
  children: React.ReactNode;
}) {
  if (juryEntrySurface(actor) === 'landing') redirect(juryHref('/'));
  if (!actor.ok && actor.reason === 'NO_MEMBERSHIP') redirect(juryHref('/organization/create'));
  const identity = actor.ok ? await loadShellIdentity(actor) : null;
  const listed = actor.ok ? await listOrganizationsForUser(actor.userId).catch(() => []) : [];
  const organizations = listed.length > 0
    ? listed
    : actor.ok && identity?.tenantName
      ? [{ tenantId: actor.tenantId, name: identity.tenantName, role: actor.role }]
      : [];
  return (
    <div className={styles.wrap}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>AIsles Jury</h1>
          <p className={styles.lead}>
            리뷰 요청부터 결과 확인, 조직 관리까지 한 곳에서 진행합니다.
          </p>
        </div>
        {actor.ok ? (
          <div className={styles.identity}>
            <OrganizationSwitcher organizations={organizations} activeTenantId={actor.tenantId} />
            <p className={styles.muted}>
              <Link className={styles.inline} href={juryHref('/organization/members')}>멤버</Link>
              {' · '}
              <Link className={styles.inline} href={juryHref('/organization/services')}>서비스 권한</Link>
              {' · '}
              <Link className={styles.inline} href={juryHref('/organization/security')}>보안</Link>
              {decideJuryMutation({ actor, action: 'membership.write', resourceTenantId: actor.tenantId }).ok ? (
                <>
                  {' · '}
                  <Link className={styles.inline} href={juryHref('/organization/invitations')}>초대</Link>
                </>
              ) : null}
            </p>
            <p className={styles.muted}>
              사용자 <strong>{identity?.userLabel ?? displayText(SHELL_UNAVAILABLE)}</strong>
              {' · '}
              역할 <StatusBadge status={actor.role} title={actor.role}>{userLabel(actor.role)}</StatusBadge>
            </p>
            <LogoutButton />
          </div>
        ) : null}
      </header>
      <ProductNav />
      <main>
      {notice ? <p className={styles.notice} role="status">{noticeText(notice)}</p> : null}
      {actor.ok ? (
        children
      ) : (
        <section className={styles.panel} role="alert">
          <h2>접근할 수 없습니다</h2>
          <p>{GATE_COPY[actor.reason]}</p>
          {actor.reason === 'UNAUTHENTICATED' ? (
            <p>
              <Link className={styles.inline} href={juryHref('/login')}>
                로그인
              </Link>
            </p>
          ) : null}
          {actor.reason === 'NO_MEMBERSHIP' ? <CreateTenantForm /> : null}
        </section>
      )}
      </main>
    </div>
  );
}

function noticeText(code: string): string {
  if (code === 'FORBIDDEN') return '이 역할에는 해당 변경 권한이 없습니다.';
  if (code === 'TENANT_MISMATCH') return '다른 tenant의 데이터는 변경할 수 없습니다.';
  if (code === 'NOT_IMPLEMENTED') return '권한은 확인됐지만, 이 단계에는 저장소가 없어 변경을 기록하지 않습니다.';
  if (code === 'NO_MEMBERSHIP') return 'membership이 없는 계정입니다.';
  if (code === 'UNAUTHENTICATED') return '로그인이 필요합니다.';
  if (code === 'EMAIL_UNVERIFIED') return '이메일 인증이 필요합니다.';
  if (code === 'AMBIGUOUS_MEMBERSHIP') return 'membership이 여러 개라 tenant를 정할 수 없습니다.';
  if (code === 'STORE_UNAVAILABLE') return 'Jury 저장소가 아직 준비되지 않았습니다.';
  if (code === 'LAST_OWNER') return '마지막 OWNER는 제거하거나 내릴 수 없습니다.';
  if (code === 'ALREADY_HAS_MEMBERSHIP') return '이 사용자는 이미 Jury membership이 있습니다.';
  if (code === 'TARGET_NOT_IN_TENANT') return '현재 tenant의 멤버만 바꿀 수 있습니다.';
  if (code === 'NAME_REQUIRED') return 'tenant 이름이 필요합니다.';
  if (code === 'USER_NOT_FOUND') return '대상 사용자 계정을 찾을 수 없습니다.';
  if (code === 'OK') return 'membership 변경을 저장했습니다.';
  if (code === 'SERVICE_REGISTERED') return '탐색 대상을 등록했습니다. 자격 증명은 저장하지 않습니다.';
  if (code === 'DISCOVERY_RECORDED') return 'Discovery 제안과 PROPOSED scope를 기록했습니다. 측정값은 없습니다.';
  if (code === 'CATALOG_SCOPE_PROPOSED') return 'Catalog metric scope를 제안했습니다. OWNER 승인 후 Evidence를 만들 수 있습니다.';
  if (code === 'CATALOG_SCOPE_REUSED') return '같은 Catalog metric scope가 이미 있습니다.';
  if (code === 'SCOPE_APPROVED') return 'AccessScope를 승인했습니다. 승인되지 않은 scope가 남아 있으면 연결은 활성화되지 않습니다.';
  if (code === 'SERVICE_CONNECTED') return '필요한 scope가 승인되어 연결이 CONNECTED가 되었습니다. 수치 수집은 시작하지 않습니다.';
  if (code === 'SCOPE_REVOKED') return 'AccessScope를 거부했습니다.';
  if (code === 'SCOPE_NOT_APPROVED') return '승인된 scope에서만 Evidence를 만들 수 있습니다.';
  if (code === 'SCOPE_CONNECTION_MISMATCH') return 'scope와 connection이 일치하지 않습니다.';
  if (code === 'CONNECTION_WRITE_REQUIRED') return 'connection 쓰기 권한이 필요합니다.';
  if (code === 'METRIC_NOT_IN_CATALOG') return 'Catalog에 없는 metric입니다.';
  if (code === 'METRIC_NOT_IN_SCOPE') return '승인된 scope가 허용하지 않은 metric입니다.';
  if (code === 'INVALID_TIMEZONE') return '시간대는 Asia/Seoul만 사용할 수 있습니다.';
  if (code === 'INVALID_VALUE') return '입력값이 올바르지 않습니다.';
  if (code === 'INVALID_PERIOD') return '기간이 올바르지 않습니다. 시작일 ≤ 종료일 ≤ 오늘(KST), 최대 92일입니다.';
  if (code === 'PERSISTENCE_FAILED') return 'Evidence를 저장하지 못했습니다. Review는 실행하지 않습니다.';
  if (code === 'EVIDENCE_CREATED') return 'Evidence를 만들었습니다.';
  if (code === 'EVIDENCE_REUSED') return '같은 Evidence가 이미 있습니다.';
  if (code === 'EVIDENCE_CONNECTION_MISMATCH') return 'Evidence와 connection이 일치하지 않습니다.';
  if (code === 'PROJECTION_FAILED') return 'Evidence를 Review 입력으로 만들지 못했습니다. Review는 실행하지 않습니다.';
  if (code === 'REVIEW_NOT_EXECUTED') return 'Review를 실행하지 못했습니다.';
  if (code === 'REVIEW_ALREADY_EXISTS') return '진행 중인 심사가 있어요. 잠시 후 결과를 확인하세요.';
  if (code === 'CLAIM_REQUIRED') return '이 Review에는 claim이 필요합니다.';
  if (code === 'CLAIM_TOO_LONG') return `주장은 ${JURY_CLAIM_MAX_LENGTH}자 이하로 입력하세요.`;
  if (code === 'ALREADY_DECIDED') return '이미 결정된 scope입니다.';
  if (code === 'INVALID_ACTION') return '허용되지 않은 Human Decision입니다.';
  if (code === 'DECISION_LOCKED') return '이미 저장된 Human Decision은 바꾸지 않습니다.';
  if (code === 'HUMAN_DECISION_REQUIRED') return '저장된 Human Decision이 있어야 개선 작업을 만들 수 있습니다.';
  if (code === 'REVIEW_NOT_COMPLETED') return '완료된 Review에서만 Improvement Task를 만들 수 있습니다.';
  if (code === 'HUMAN_APPROVAL_REQUIRED') return '사람이 VERIFY 또는 REWORD로 승인한 개선 작업만 Agent에 넘길 수 있습니다.';
  if (code === 'ALREADY_RUNNING') return 'Agent 실행이 이미 진행 중입니다.';
  if (code === 'EXECUTION_NOT_COMPLETED') return 'Agent 실행이 완료된 뒤에만 Change Gate를 실행할 수 있습니다.';
  if (code === 'RE-REVIEW_NOT_APPROVED') return 'Change Gate가 APPROVED일 때만 Re-review를 실행할 수 있습니다.';
  if (code === 'NOT_REREVIEW_RESULT') return 'Re-review 결과에서만 다음 Improvement Task를 만들 수 있습니다.';
  if (code === 'NOT_REREVIEW_IMPROVEMENT_TASK') return 'Re-review에서 만든 Improvement Task만 Agent에 넘길 수 있습니다.';
  if (code === 'SNAPSHOT_UNSAFE') return '자격 증명으로 보이는 값은 저장하거나 전달하지 않습니다.';
  if (code === 'CREDENTIAL_REF_REQUIRED') return 'Credential reference가 없어 연결을 활성화하지 않았습니다.';
  if (code === 'CONNECTION_NOT_APPROVED') return 'CONNECTED가 아닌 서비스에서는 Evidence를 수집하지 않습니다.';
  if (code === 'EVIDENCE_RECORDED') return 'Evidence를 저장했습니다. Credential은 포함하지 않습니다.';
  if (code === 'COLLECTION_FAILED') return 'Evidence 수집에 실패했습니다. Review는 실행하지 않습니다.';
  if (code === 'EVIDENCE_UNAVAILABLE') return '사용할 수 있는 Evidence가 없어 Review를 실행하지 않습니다.';
  if (code === 'TIMEZONE_UNSUPPORTED') return '시간대는 Asia/Seoul만 사용할 수 있습니다.';
  if (code === 'DECISION_NOT_IN_CONTRACT') return 'Core decision이 기존 contract 밖에 있어 성공 결과로 저장하지 않았습니다.';
  if (code === 'CORE_READING_REJECTED') return 'Core 결과를 저장하지 않았습니다.';
  if (code === 'OBSERVATION_REQUIRED') return '읽기 전용 계정 관찰을 먼저 성공적으로 실행해야 검증 근거를 수집할 수 있습니다.';
  if (code === 'PACK_NOT_READ_ONLY') return 'read-only Evidence만 Review할 수 있습니다.';
  if (code === 'NOT_FOUND') return '현재 tenant에서 대상을 찾을 수 없습니다.';
  if (code === 'KEY_REQUIRED') return '서비스 키와 이름이 필요합니다.';
  if (code === 'LOOP_STOPPED') return '자동 Loop를 중지했습니다. Agent는 실행하지 않습니다.';
  if (code === 'LOOP_ALREADY_STOPPED') return '자동 Loop는 이미 중지 상태입니다.';
  if (code === 'INVALID_TRANSITION') return '이 화면에서는 중지만 할 수 있습니다.';
  if (code === 'CREDENTIAL_IN_REASON') return '자격 증명이 포함된 요청은 기록하지 않습니다.';
  return '요청을 처리하지 않았습니다.';
}

function CreateTenantForm() {
  return (
    <form action={createJuryTenant}>
      <p className={styles.muted}>이름만 입력합니다. tenant 식별자는 서버가 만듭니다.</p>
      <input className={styles.field} name="tenantName" placeholder="조직 이름" required />
      <input type="hidden" name="tenantId" value="client-supplied-tenant" />
      <button className={buttonClass('secondary')} type="submit">
        내 tenant 만들기
      </button>
    </form>
  );
}

export function canShowWrite(actor: JuryActor, action: JuryAction): boolean {
  if (!actor.ok) return false;
  return decideJuryMutation({ actor, action, resourceTenantId: actor.tenantId }).ok;
}

/** RM-05 (D-11): re-review chains run with the mock review-board LLM (change-gate-rereview-store defaultCore). */
export const MOCK_RE_REVIEW_NOTICE = 'Mock AI 응답으로 만든 결과이며 실제 심사가 아닙니다.';

export function WriteControl({
  actor,
  action,
  label,
  returnTo,
  resourceId,
  disabledHint,
}: {
  actor: JuryActor;
  action: JuryAction;
  label: string;
  returnTo: string;
  resourceId?: string;
  /** RM-05 (I-006): server action not implemented yet (planJuryCommand -> NOT_IMPLEMENTED); render disabled '준비 중' instead of a submit. */
  disabledHint?: ReactNode;
}) {
  if (!canShowWrite(actor, action)) {
    return <p className={styles.muted}>{label}: 현재 역할에는 이 변경 권한이 없습니다.</p>;
  }
  if (disabledHint !== undefined) {
    return (
      <div>
        <button className={buttonClass('secondary')} type="button" disabled aria-disabled="true">
          {label} (준비 중)
        </button>
        <p className={styles.muted}>{disabledHint}</p>
      </div>
    );
  }
  return (
    <form action={submitJuryAction}>
      <input type="hidden" name="action" value={action} />
      <input type="hidden" name="tenantId" value="client-supplied-tenant" />
      <input type="hidden" name="resourceId" value={resourceId ?? ''} />
      <input type="hidden" name="returnTo" value={returnTo} />
      <Button variant="secondary" type="submit">{label}</Button>
    </form>
  );
}

function metricLine(metric: string, value: number | null, availability: string): string {
  const shown = formatMeasuredValue(value, availability);
  const scored =
    (JURY_PROJECTABLE_DB_METRICS as readonly string[]).includes(metric) ||
    (JURY_PROJECTABLE_GA4_METRICS as readonly string[]).includes(metric) ||
    metric.startsWith(JURY_GA4_EVENT_PREFIX);
  return `${metric}: ${displayText(shown)} (${availability})${scored ? '' : ' · v9.x 품질 판정 밖'}`;
}

export function DashboardBody({ view }: { view: JuryConsoleView }) {
  const board = projectDashboard(view);
  if (!board.available) {
    return (
      <section className={styles.panel} role="alert">
        <h2>홈</h2>
        <p>{displayText(SHELL_UNAVAILABLE)}</p>
      </section>
    );
  }
  return (
    <>
      <PageHeader
        crumbs={[{ label: '홈' }]}
        title="홈"
        description="지금 해야 할 일과 최근 결과를 한눈에 확인하세요."
        actions={<ButtonLink variant="primary" icon={Play} href={juryHref('/evidence')}>리뷰 요청 시작</ButtonLink>}
      />
      <section className={`${styles.panel} ${styles.nextAction}`}>
        <div>
          <p className={styles.eyebrow}>지금 할 일</p>
          <h2>최근 리뷰 결과를 확인하세요</h2>
          <p className={styles.muted}>새로운 결과가 도착하면 주요 문제와 권장 조치를 바로 확인할 수 있습니다.</p>
        </div>
        <ButtonLink variant="primary" icon={FileText} href={juryHref('/reviews')}>결과 보기</ButtonLink>
      </section>
      <div className={styles.cards}>
        <section className={styles.panel}>
          <h2>연결된 서비스</h2>
          <p className={styles.metric}>{board.connectedServices}</p>
          <p className={styles.muted}>정상 연결 {board.connectedServices}개 · 전체 {board.services}개</p>
        </section>
        <section className={styles.panel}>
          <h2>리뷰 자료</h2>
          <p className={styles.metric}>{board.evidence}</p>
          <p className={styles.muted}>최근 분석에 사용된 자료</p>
        </section>
        <section className={styles.panel}>
          <h2>진행 중 리뷰</h2>
          <p className={styles.metric}>{board.inFlightReviews}</p>
          <p className={styles.muted}>완료된 결과 {board.reviews}건 · 출처 미기록 {board.resultSummary.unknownSource} · Mock/Fixture {board.resultSummary.nonReal} · 실모델(미검증) {board.resultSummary.realUnverified} · 검증된 실모델 {board.resultSummary.aggregatable}</p>
          {board.resultSummary.withWarnings > 0 ? <p className={styles.muted}>⚠ 확인이 필요한 결과 {board.resultSummary.withWarnings}건</p> : null}
        </section>
        <section className={styles.panel}>
          <h2>개선 작업</h2>
          <p className={styles.metric}>{board.openImprovements}</p>
          <p className={styles.muted}>진행 중 {board.activeImprovements}건</p>
          <p className={styles.muted}>출처: 실모델(미검증) {board.improvementSources.realUnverified} · 검증된 실모델 {board.improvementSources.verifiedReal} · Mock/Fixture {board.improvementSources.nonReal} · 출처 미기록 {board.improvementSources.unknownSource}{board.improvementSources.unlinked > 0 ? ` · 연결 확인 불가 ${board.improvementSources.unlinked}` : ''}</p>
        </section>
      </div>
      <section className={styles.panel}>
        <h2>최근 결과와 활동</h2>
        {board.activity.length === 0 ? <EmptyState>{displayText(SHELL_EMPTY.audit)}</EmptyState> : (
          <table className={`${styles.table} ${styles.activityTable}`}>
            <thead>
              <tr>
                <th>시간</th>
                <th>사용자</th>
                <th>활동</th>
                <th>대상</th>
                <th>상태</th>
              </tr>
            </thead>
            <tbody>
              {board.activity.map((event) => (
                <tr key={event.id}>
                  <td className={styles.nowrapCell}>{formatKstFull(event.timestamp)}</td>
                  <td className={styles.identifier} title={event.actor}>{compactIdentifier(event.actor)}</td>
                  <td title={event.action}>{auditActionLabel(event.action)}</td>
                  <td className={styles.identifier} title={event.resource}>{compactIdentifier(event.resource)}</td>
                  <td className={styles.nowrapCell}><StatusBadge status={event.status} title={event.status}>{auditActionLabel(event.status)}</StatusBadge></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}

export function ServicesBody({ actor, view }: { actor: JuryActor; view: JuryConsoleView }) {
  const rows = projectServiceRows(view);
  return (
    <section className={styles.panel}>
      <h2 className={styles.pageTitle}>서비스 연결 목록</h2>
      {canShowWrite(actor, 'connection.write') ? (
        <p><ButtonLink variant="secondary" icon={Plus} href={juryHref('/services/new')}>서비스 추가</ButtonLink></p>
      ) : (
        <p className={styles.muted}>서비스 추가: 현재 역할에는 이 변경 권한이 없습니다.</p>
      )}
      {rows.length === 0 ? <EmptyState action={<ButtonLink variant="primary" icon={Plus} href={juryHref('/organization/services')}>서비스 연결</ButtonLink>}>{displayText(SHELL_EMPTY.services)}</EmptyState> : (
        <div className={styles.servicesTableWrap}>
        <table className={`${styles.table} ${styles.servicesTable}`}>
          <thead>
            <tr>
              <th>서비스 이름</th>
              <th>연결 방식</th>
              <th>상태</th>
              <th>생성일</th>
              <th>수정일</th>
              <th>서비스 확인 상태</th>
              <th>범위 상태</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td><Link className={`${styles.inline} ${styles.ellipsisText}`} href={juryHref(`/services/${row.id}`)} title={row.displayName}>{row.displayName}</Link></td>
                <td title={row.accessMethod}>{displayText(row.accessMethod)}</td>
                <td><StatusBadge status={row.status} title={row.status}>{userLabel(row.status)}</StatusBadge></td>
                <td>{formatKstFull(row.createdAt)}</td>
                <td>{formatKstFull(row.updatedAt)}</td>
                <td><StatusBadge status={row.discoveryStatus} title={row.discoveryStatus}>{displayText(row.discoveryStatus)}</StatusBadge></td>
                <td><StatusBadge status={row.scopeStatus} title={row.scopeStatus}>{displayText(row.scopeStatus)}</StatusBadge></td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}
    </section>
  );
}

export function DiscoveryBody({ actor, view }: { actor: JuryActor; view: JuryConsoleView }) {
  const discovered = new Set(view.discoveries.map((row) => row.connectionId));
  return (
    <section className={styles.panel}>
      <h2>서비스 확인</h2>
      <p className={styles.muted}>제안만 표시합니다. 측정값은 없고, scope가 승인되기 전에는 수집하지 않습니다.</p>
      {view.connections.filter((row) => !discovered.has(row.id)).map((row) => (
        <form action={runJuryDiscovery} key={row.id}>
          <p>{row.displayName}</p>
          <input type="hidden" name="connectionId" value={row.id} />
          <input type="hidden" name="tenantId" value="client-supplied-tenant" />
          {canShowWrite(actor, 'discovery.approve') ? (
            <Button variant="secondary" icon={Play} type="submit">Mock Discovery 실행</Button>
          ) : (
            <p className={styles.muted}>Discovery 실행: 현재 역할에는 이 변경 권한이 없습니다.</p>
          )}
        </form>
      ))}
      {view.discoveries.map((row) => {
        const scope = scopeForDiscovery(row, view.scopes);
        return (
          <article key={row.id}>
            <div className={styles.row}>
              <span>{row.surfaces.join(', ')}</span>
              <span>{row.feasibility} · {row.approval} · scope {scope?.status ?? '없음'}</span>
            </div>
            <p className={styles.muted}>{row.menus.join(', ')} · {row.dataSources.join(', ')}</p>
            {row.proposedMetrics.map((item) => (
              <p key={item.metric}>{item.metric}: {item.reason}</p>
            ))}
            {scope && scope.status === 'PROPOSED' && canShowWrite(actor, 'scope.write') ? (
              <form action={decideJuryScope}>
                <input type="hidden" name="scopeId" value={scope.id} />
                <input type="hidden" name="tenantId" value="client-supplied-tenant" />
                <Button variant="secondary" icon={Check} name="decision" value="APPROVE" type="submit">승인</Button>
                <Button variant="secondary" icon={X} name="decision" value="REJECT" type="submit">거부</Button>
              </form>
            ) : null}
            {scope && scope.status === 'PROPOSED' && !canShowWrite(actor, 'scope.write') ? (
              <p className={styles.muted}>scope 승인: 현재 역할에는 이 변경 권한이 없습니다.</p>
            ) : null}
          </article>
        );
      })}
      <CatalogScopeForm actor={actor} view={view} />
    </section>
  );
}

function CatalogScopeForm({ actor, view }: { actor: JuryActor; view: JuryConsoleView }) {
  const form = projectCatalogScopeForm(actor, view);
  if (!form.visible) {
    return (
      <>
        <h2>카탈로그 지표 범위</h2>
        <p className={styles.muted}>Catalog scope 승인: 현재 역할에는 이 변경 권한이 없습니다.</p>
      </>
    );
  }
  return (
    <>
      <h2>카탈로그 지표 범위</h2>
      <p className={styles.muted}>Catalog metric만 선택합니다. Discovery placeholder는 승인 대상이 아닙니다.</p>
      {form.connections.map((connection) => (
        <form action={proposeCatalogScope} key={connection.id}>
          <p>{connection.label}</p>
          <input type="hidden" name="connectionId" value={connection.id} />
          <label>
            지표
            <select className={styles.field} name="metric" defaultValue={form.metrics[0]}>
              {form.metrics.map((metric) => (
                <option key={metric} value={metric}>{metric}</option>
              ))}
            </select>
          </label>
          <Button variant="secondary" icon={Lightbulb} type="submit">Catalog Scope 제안</Button>
        </form>
      ))}
      {form.pending.map((scope) => (
        <form action={decideCatalogScope} key={scope.scopeId}>
          <p>{scope.label}</p>
          <input type="hidden" name="scopeId" value={scope.scopeId} />
          <Button variant="secondary" icon={Check} name="decision" value="APPROVE" type="submit">Catalog 승인</Button>
          <Button variant="secondary" icon={X} name="decision" value="REJECT" type="submit">Catalog 거부</Button>
        </form>
      ))}
    </>
  );
}

export function ReviewsBody({ view }: { view: JuryConsoleView }) {
  return (
    <section className={styles.panel}>
      <PageHeader
        crumbs={[{ label: '홈', href: juryHref('/') }, { label: '결과' }]}
        title="결과"
        description="결론과 주요 문제, 권장 조치를 먼저 확인하세요."
        actions={<ButtonLink variant="secondary" icon={Plus} href={juryHref('/evidence')}>새 리뷰 요청</ButtonLink>}
      />
      <RequestStatusSection view={view} />
      {view.results.length > 0 ? <TranslationHint /> : null}
      {view.results.length === 0 ? <EmptyState action={<ButtonLink variant="primary" icon={Plus} href={juryHref('/evidence')}>리뷰 요청</ButtonLink>}>{displayText(SHELL_EMPTY.reviews)}</EmptyState> : (
        <div className={styles.reviewsTableWrap}>
        <table className={`${styles.table} ${styles.reviewsTable}`}>
          <colgroup>
            <col style={{ width: 80 }} />
            <col style={{ width: 112 }} />
            <col style={{ width: 120 }} />
            <col style={{ width: 104 }} />
            <col style={{ width: 136 }} />
            <col />
          </colgroup>
          <thead>
            <tr>
              <th>상태</th>
              <th>결론</th>
              <th>완료일</th>
              <th>리뷰 유형</th>
              <th>리뷰 자료</th>
              <th>요약</th>
            </tr>
          </thead>
          <tbody>
            {view.results.map((row) => {
              const request = view.requests.find((item) => item.id === row.reviewRequestId) ?? null;
              const statusLabel = request?.status ? userLabel(request.status) : displayText(SHELL_UNAVAILABLE);
              const display = displayModelForCatalogRow(row, request, view.evidence);
              const decisionLabel = display.decision.withheld ? display.decision.label : userLabel(row.expectedDecision);
              const warnings = display.flags.filter((flag) => flag !== 'UNKNOWN_SOURCE' && flag !== 'NON_REAL_SOURCE');
              const detailHref = juryHref(`/reviews/${row.id}`);
              const evidenceId = request?.evidenceId ?? null;
              const summary = row.finalSurface.statusSummary;
              return (
                <tr key={row.id}>
                  <td title={request?.status}><StatusBadge status={request?.status}>{statusLabel}</StatusBadge></td>
                  <td title={row.expectedDecision}>
                    <Link className={styles.inline} href={detailHref}><StatusBadge>{decisionLabel}</StatusBadge></Link>
                    <StatusBadge status={display.source.value} title={display.source.value}>{display.source.label}</StatusBadge>
                    {warnings.length > 0 ? <span className={styles.muted} title={warnings.map((flag) => DISPLAY_FLAG_LABELS[flag]).join('\n')}> ⚠ {warnings.length}</span> : null}
                  </td>
                  <td title={formatKstFull(row.completedAt)}>{formatKstShort(row.completedAt)}</td>
                  <td title={request?.reviewType}>{request?.reviewType ? userLabel(request.reviewType) : displayText(SHELL_UNAVAILABLE)}</td>
                  <td>
                    {evidenceId ? (
                      <span className={styles.evidenceCell}>
                        <span className={styles.evidenceId} title={evidenceId}>{shortId(evidenceId)}</span>
                        <CopyIdButton value={evidenceId} />
                      </span>
                    ) : displayText(SHELL_UNAVAILABLE)}
                  </td>
                  <td>
                    <span className={styles.summaryCell}>
                      <span className={styles.summaryPreview} lang="en" title={summary}>{summary}</span>
                      <ReviewSummaryDialog
                        summary={summary}
                        decisionLabel={decisionLabel}
                        statusLabel={statusLabel}
                        completedAtFull={formatKstFull(row.completedAt)}
                        evidenceId={evidenceId}
                        detailHref={detailHref}
                      />
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
      )}
    </section>
  );
}

export function ReviewDetailBody({ screen, noted }: { screen: ReviewConsoleScreen; noted: boolean }) {
  // AGG-01: counts, flags and source come only from screen.display (buildReviewDisplayModel).
  const display = screen.display;
  // RM-04: no UI-side fallback recount. Without the display model every count is "집계 불가".
  const missing = display ? display.missingEvidenceCount : null;
  const supportedCount = display ? display.claims.counts?.supported ?? null : null;
  const noActionAllowed = !display || (display.decision.raw === 'ACCEPT' && display.flags.length === 0);
  const fallbackAction = noActionAllowed ? '추가 조치가 필요하지 않습니다.' : '권장 조치 기록 없음';
  return (
    <>
      <section className={styles.panel}>
        <p className={styles.eyebrow}>현재 메뉴 · 결과 · 요약</p>
        <h2 className={styles.pageTitle}>리뷰 결과</h2>
        <div className={styles.resultHighlight}>
          <span className={styles.label}>결론</span>
          <strong><StatusBadge>{display?.decision.withheld ? display.decision.label : userLabel(screen.decision)}</StatusBadge></strong>
          {display ? <StatusBadge status={display.source.value} title={display.source.value}>{display.source.label}</StatusBadge> : null}
          <p>왜: {screen.decisionMeaning}</p>
          {display && display.flags.length > 0 ? (
            <ul className={styles.muted}>
              {display.flags.map((flag) => <li key={flag}>⚠ {DISPLAY_FLAG_LABELS[flag]}</li>)}
            </ul>
          ) : null}
          <p className={styles.muted}>{DECISION_GUIDANCE[screen.decision] ?? ''}</p>
        </div>
        <ConfidenceLine screen={screen} />
        {screen.requestInput ? (
          <p className={styles.muted}>
            {screen.requestInput.reviewType === 'CLAIM_VALIDATION' ? '주장 검증' : '전체 리뷰'} · 검증한 주장: {screen.requestInput.claim ?? '주장 입력 없음'}
          </p>
        ) : null}
        <p className={styles.resultSummary} lang={screen.summary ? 'en' : undefined}>{screen.summary || '요약이 없습니다.'}</p>
        <TranslationHint />
        {screen.humanDecision ? <p className={styles.muted}>사용자 확인: {userLabel(screen.humanDecision)}</p> : null}
        <details className={styles.technicalDetails}>
          <summary>기술 정보 보기</summary>
          <div className={styles.row}><span className={styles.label}>심사 ID</span><span>{screen.reviewId}</span></div>
          <div className={styles.row}><span className={styles.label}>상태</span><span>{userLabel(screen.status)}</span></div>
          <div className={styles.row}><span className={styles.label}>완료일</span><span>{formatKstFull(screen.completedAt)}</span></div>
        </details>
      </section>
      <ResultComparison screen={screen} />
      <section className={styles.panel}>
        <div className={styles.actionPanel}>
          <div>
            <h2>권장 조치</h2>
            {screen.expectedUserEffect || screen.risk ? <StatusBadge>AI 추정</StatusBadge> : null}
            <p lang={screen.expectedUserEffect || screen.risk ? 'en' : undefined}>{screen.expectedUserEffect || screen.risk || fallbackAction}</p>
          </div>
          {screen.humanChoices.length > 0 ? <StatusBadge>확인 필요</StatusBadge> : null}
        </div>
        <p className={styles.muted}>위험도: <span lang={screen.risk ? 'en' : undefined}>{screen.risk || '기록 없음'}</span></p>
      </section>
      <section className={styles.panel}>
        <h2>근거 요약</h2>
        <div className={styles.row}>
          <span className={styles.label}>핵심 근거</span>
          <span>{supportedCount === null ? (display?.claims.state === 'NONE_RECORDED' ? '주장 기록 없음' : '확인된 주장 집계 불가') : `확인된 주장 ${supportedCount}개`} · <Link className={styles.inline} href={reviewTabHref(screen.reviewId, 'evidence')}>검증 근거 탭에서 보기</Link></span>
        </div>
        <div className={styles.row}>
          <span className={styles.label}>검증 상태</span>
          <span>{missing === null ? '부족한 근거 집계 불가' : `부족한 근거 ${missing}개`} · <Link className={styles.inline} href={reviewTabHref(screen.reviewId, 'evidence')}>부족한 근거 보기</Link></span>
        </div>
        <div className={styles.row}>
          <span className={styles.label}>위원 의견</span>
          <span><Link className={styles.inline} href={reviewTabHref(screen.reviewId, 'members')}>위원 의견 탭에서 보기</Link></span>
        </div>
      </section>
      <section className={styles.panel}>
        <h2>다음 행동</h2>
        {noted && screen.humanDecision ? <p className={styles.muted}>Human Decision을 저장했습니다.</p> : null}
        {screen.humanDecision ? <p>선택 완료</p> : null}
        {screen.humanChoices.length > 0 ? (
          <form action={acknowledgeHumanReview}>
            <input type="hidden" name="reviewId" value={screen.reviewId} />
            {screen.humanChoices.map((choice) => (
              <Button variant="secondary" key={choice.code} name="action" value={choice.code} type="submit">{choice.label}</Button>
            ))}
          </form>
        ) : null}
        {!screen.humanDecision && screen.humanChoices.length === 0 ? (
          <p className={styles.muted}>다음 행동 선택: 현재 역할에는 이 변경 권한이 없습니다.</p>
        ) : null}
        {screen.improvementTask ? <p>개선 작업을 만들었습니다</p> : null}
        {screen.canCreateImprovement ? (
          <form action={createHumanImprovementTask}>
            <input type="hidden" name="reviewId" value={screen.reviewId} />
            <Button variant="secondary" icon={Plus} type="submit">개선 작업 만들기</Button>
          </form>
        ) : null}
        {screen.agentExecution ? (
          <>
            <p>에이전트 작업</p>
            <p>상태: {screen.agentExecution.status}</p>
            <p>제공자: {screen.agentExecution.agent}</p>
            {screen.agentExecution.status === 'RUNNING' ? <p>진행 중</p> : null}
            {screen.agentExecution.status === 'COMPLETED' ? <p>완료</p> : null}
            {screen.agentExecution.status === 'BLOCKED' ? <p>중단됨</p> : null}
            {screen.agentExecution.startedAt ? <p>시작: {formatKstFull(screen.agentExecution.startedAt)}</p> : null}
            {screen.agentExecution.finishedAt ? <p>종료: {formatKstFull(screen.agentExecution.finishedAt)}</p> : null}
            {screen.agentExecution.summary ? <p>결과 요약: {screen.agentExecution.summary}</p> : null}
            {screen.agentExecution.changedFiles.map((file) => <p key={file}>변경 파일: {file}</p>)}
            {screen.agentExecution.testsRun.map((testName) => <p key={testName}>테스트: {testName}</p>)}
            {screen.agentExecution.testsPassed == null ? null : <p>테스트 통과: {screen.agentExecution.testsPassed ? '예' : '아니오'}</p>}
          </>
        ) : null}
        {screen.canRun && screen.agentExecution ? (
          <form action={runHumanAgentExecution}>
            <input type="hidden" name="agentExecutionId" value={screen.agentExecution.id} />
            <Button variant="secondary" icon={Play} type="submit">에이전트 작업 시작</Button>
          </form>
        ) : null}
        {screen.canHandoff && screen.improvementTask ? (
          <form action={handoffHumanImprovement}>
            <input type="hidden" name="improvementTaskId" value={screen.improvementTask.id} />
            <Button variant="secondary" icon={Send} type="submit">에이전트에 전달</Button>
          </form>
        ) : null}
      </section>
    </>
  );
}

const INTAKE_AVAILABILITY = ['AVAILABLE', 'NOT_MEASURED', 'NOT_AVAILABLE', 'PERMISSION_DENIED', 'COLLECTION_FAILED'] as const;

export function ReReviewAgentHandoffBody({ screen }: { screen: ReviewConsoleScreen }) {
  const execution = screen.nextAgentExecution;
  return (
    <section className={styles.panel}>
      <h2>에이전트 전달</h2>
      {screen.nextApproval ? <p>담당자 승인: {screen.nextApproval}</p> : null}
      {screen.canApproveReReviewAgent && screen.nextImprovement ? (
        <form action={approveReReviewAgentAction}>
          <input type="hidden" name="improvementTaskId" value={screen.nextImprovement.id} />
          <Button variant="secondary" icon={Check} type="submit">에이전트 작업 승인</Button>
        </form>
      ) : null}
      {screen.canHandoffReReviewAgent && screen.nextImprovement ? (
        <form action={handoffReReviewImprovement}>
          <input type="hidden" name="improvementTaskId" value={screen.nextImprovement.id} />
          <Button variant="secondary" icon={Send} type="submit">에이전트에 전달</Button>
        </form>
      ) : null}
      {execution?.status === 'PENDING' ? <p>에이전트 대기 중</p> : null}
      {execution && execution.status !== 'PENDING' ? <p>상태: {execution.status}</p> : null}
    </section>
  );
}

export function HumanReReviewBody({ screen }: { screen: ReviewConsoleScreen }) {
  return (
    <section className={styles.panel}>
      <h2>재심사</h2>
      <p>원래 심사: {screen.reviewId}</p>
      {screen.reReview ? (
        <>
          <p>재심사: {screen.reReview.status}</p>
          {screen.reReview.reviewResultId ? <p>심사 결과: {screen.reReview.reviewResultId}</p> : null}
          {screen.reReview.decision ? <p>결론: {screen.reReview.decision}</p> : null}
          {screen.reReview.completedAt ? <p>완료 시각: {formatKstFull(screen.reReview.completedAt)}</p> : null}
        </>
      ) : null}
      {screen.canRunReReview && screen.agentExecution ? (
        <form action={runHumanReReview}>
          <input type="hidden" name="agentExecutionId" value={screen.agentExecution.id} />
          <Button variant="secondary" icon={Play} type="submit">재심사 실행 (Mock)</Button>
          <p className={styles.muted}>{MOCK_RE_REVIEW_NOTICE}</p>
        </form>
      ) : null}
      {screen.reReview?.decision === 'ACCEPT' ? <p>개선이 필요하지 않습니다</p> : null}
      {screen.nextImprovement ? (
        <>
          <p>다음 개선 작업</p>
          <p>작업: {screen.nextImprovement.id}</p>
          <p>유형: {screen.nextImprovement.taskType}</p>
          <p>상태: {screen.nextImprovement.status}</p>
        </>
      ) : null}
      {screen.canCreateReReviewImprovement && screen.reReview?.reviewResultId ? (
        <form action={createReReviewImprovementTask}>
          <input type="hidden" name="reReviewResultId" value={screen.reReview.reviewResultId} />
          <Button variant="secondary" icon={Plus} type="submit">개선 작업 만들기</Button>
        </form>
      ) : null}
    </section>
  );
}

/** Track B: the next improvement task for improvement.read without agent.execute. Task id, type, and status only. */
export function ReReviewNextImprovementBody({ screen }: { screen: ReviewConsoleScreen }) {
  const task = screen.nextImprovement;
  if (!task) return null;
  return (
    <section className={styles.panel}>
      <h2>다음 개선 작업</h2>
      <p>작업: {task.id}</p>
      <p>유형: {task.taskType}</p>
      <p>상태: {task.status}</p>
    </section>
  );
}

export function HumanChangeGateBody({ screen }: { screen: ReviewConsoleScreen }) {
  return (
    <section className={styles.panel}>
      <h2>변경 검사</h2>
      {screen.changeGate ? (
        <>
          <p>변경 검사: {screen.changeGate.status}</p>
          {screen.changeGate.errorCode ? <p>사유: {screen.changeGate.errorCode}</p> : null}
          {screen.changeGate.discrepancy ? <p>불일치</p> : null}
          {screen.changeGate.reasons.map((reason) => <p key={reason}>{reason}</p>)}
        </>
      ) : null}
      {screen.canRunChangeGate && screen.agentExecution ? (
        <form action={runHumanChangeGate}>
          <input type="hidden" name="agentExecutionId" value={screen.agentExecution.id} />
          <Button variant="secondary" icon={Play} type="submit">변경 검사 실행</Button>
        </form>
      ) : null}
    </section>
  );
}

export function EvidenceBody({ actor, view, query = { q: '', filter: '', page: 1 } }: { actor: JuryActor; view: JuryConsoleView; query?: ListQuery }) {
  const form = projectConsoleIntakeForm(actor, view);
  const intakePeriod = intakePeriodDefaults();
  const allEvidence = projectConsoleEvidence(view);
  const evidencePage = pageList(allEvidence, query, {
    text: (row) => `${row.purpose} ${row.periodStart} ${row.periodEnd} ${row.metrics.map((m) => m.metric).join(' ')}`,
  });
  const evidence = evidencePage.items;
  return (
    <section className={styles.panel}>
      <PageHeader
        crumbs={[{ label: '홈', href: juryHref('/') }, { label: '리뷰 요청' }]}
        title="리뷰 요청"
        description="한 화면에서 리뷰 자료를 입력하고, 아래 목록에서 리뷰를 요청하세요."
      />
      <p className={styles.helperText}>
        <span className={styles.requiredMark}>필수</span> 항목은 반드시 입력해야 하고, <span className={styles.optionalMark}>선택</span> 항목은 비워 둘 수 있습니다. 승인된 서비스와 리뷰 자료만 표시됩니다.
      </p>
      {form.visible ? (
        form.scopes.length === 0 ? (
          <p className={styles.muted}>현재 승인된 Scope에는 입력 가능한 Catalog Metric이 없습니다.</p>
        ) : (
          form.scopes.map((scope) => (
            <form action={submitTenantEvidenceIntake} key={scope.scopeId}>
              <h3>리뷰 자료 입력</h3>
              <p className={`${styles.muted} ${styles.selectedService}`}>선택한 서비스: {scope.label}</p>
              <input type="hidden" name="connectionId" value={scope.connectionId} />
              <input type="hidden" name="scopeId" value={scope.scopeId} />
              {/* RM-09 (I-004): one evidence can carry several metrics and an explicit period. */}
              <fieldset>
                <legend>분석 기간<span className={styles.requiredMark}>필수</span></legend>
                <label>
                  시작일
                  <input className={styles.field} type="date" name="periodStart" defaultValue={intakePeriod.start} max={intakePeriod.today} required />
                </label>
                <label>
                  종료일
                  <input className={styles.field} type="date" name="periodEnd" defaultValue={intakePeriod.end} max={intakePeriod.today} required />
                </label>
                <p className={styles.muted}>Asia/Seoul 기준 · 최대 92일 · 기본값은 어제까지 7일</p>
              </fieldset>
              <fieldset>
                <legend>분석 항목<span className={styles.requiredMark}>1개 이상</span></legend>
                <p className={styles.muted}>입력하지 않을 항목은 「포함 안 함」으로 두세요. 포함하지 않은 항목은 미검사로 표시되며 문제 없음으로 보지 않습니다.</p>
                {scope.metrics.map((metric, index) => (
                  <div className={`${styles.row} ${styles.metricRow}`} key={metric}>
                    <input type="hidden" name="metricName" value={metric} />
                    <span className={styles.label}>{metric}</span>
                    <select className={styles.field} name={`availability:${metric}`} defaultValue={index === 0 ? 'AVAILABLE' : ''} aria-label={`${metric} 자료 상태`}>
                      <option value="">포함 안 함</option>
                      {INTAKE_AVAILABILITY.map((availability) => (
                        <option key={availability} value={availability}>{userLabel(availability)}</option>
                      ))}
                    </select>
                    <input
                      className={styles.field}
                      name={`value:${metric}`}
                      inputMode="decimal"
                      pattern="-?[0-9]+(\.[0-9]+)?"
                      title="숫자만 입력하세요. 예: 120 또는 12.5"
                      placeholder="측정값 (선택)"
                      aria-label={`${metric} 측정값`}
                    />
                  </div>
                ))}
              </fieldset>
              <button className={buttonClass('primary', 'lg', styles.intakeSubmit)} type="submit">리뷰 자료 만들기</button>
            </form>
          ))
        )
      ) : (
        <p className={styles.muted}>Evidence 입력: 현재 역할에는 이 변경 권한이 없습니다.</p>
      )}
      {allEvidence.length > 0 ? <ListControls path="/evidence" query={query} total={evidencePage.total} page={evidencePage.page} pages={evidencePage.pages} /> : null}
      {allEvidence.length === 0 ? <EmptyState>{displayText(SHELL_EMPTY.evidence)}</EmptyState> : evidence.length === 0 ? <p className={styles.muted}>조건에 맞는 자료 없음</p> : null}
      {evidence.map((row) => {
        const stored = view.evidence.find((item) => item.id === row.id);
        // I-029: connected-collection evidence is reviewed from its service page (FULL_REVIEW only).
        const servicePageHref = stored ? juryHref(`/services/${stored.connectionId}`) : null;
        // I-030: stored state for this card (rebuilt from the DB on every render, so it survives a refresh).
        const reviewState = evidenceReviewStatus(view, row.id, Date.now());
        return (
        <article key={row.id}>
          <div className={styles.row}><span className={styles.label}>리뷰 자료</span><span>{row.purpose}</span></div>
          <div className={styles.row}><span className={styles.label}>분석 기간</span><span>{row.periodStart} – {row.periodEnd}</span></div>
          <details className={styles.technicalDetails}>
            <summary>기술 정보 자세히 보기</summary>
            <div className={styles.row}><span className={styles.label}>시간대</span><span>{stored?.timezone ?? displayText(SHELL_UNAVAILABLE)}</span></div>
            <div className={styles.row}><span className={styles.label}>연결 방식</span><span>{stored?.adapterKey ?? displayText(SHELL_UNAVAILABLE)}</span></div>
            <div className={styles.row}><span className={styles.label}>내부 식별자</span><span>{row.id}</span></div>
            <div className={styles.row}><span className={styles.label}>읽기 전용</span><span>{stored?.readOnly === true ? '예' : stored?.readOnly === false ? '아니오' : displayText(SHELL_UNAVAILABLE)}</span></div>
          </details>
          <div className={styles.row}><span className={styles.label}>지표 수</span><span>{row.metricCount}</span></div>
          {row.metrics.map((metric) => (
            <div className={styles.row} key={metric.id}>
              <span>{metricLine(metric.metric, metric.value, metric.availability)}</span>
              <span className={styles.muted}>{metric.sourceSystem}</span>
            </div>
          ))}
          {canShowWrite(actor, 'review.start') ? (
            // I-029: only declared-intake evidence can be reviewed from this card (runTenantReview scope check).
            evidenceReviewPath(row) === 'TENANT_INTAKE' ? (
              <form action={submitTenantReview}>
                <input type="hidden" name="evidenceId" value={row.id} />
                <ReviewRequestFields />
                <ReviewSubmitButton label="리뷰 요청하기" disabledReason={reviewState.inFlight ? '이 자료로 실행 중인 리뷰가 있습니다. 끝난 뒤 새로고침하면 결과를 볼 수 있습니다.' : null} />
              </form>
            ) : (
              <p className={styles.muted}>
                {CONNECTED_EVIDENCE_REVIEW_NOTICE}
                {servicePageHref ? (
                  <>
                    {' '}
                    <Link className={styles.inline} href={servicePageHref}>서비스 화면으로 이동</Link>
                  </>
                ) : null}
              </p>
            )
          ) : null}
          {reviewState.open ? (
            <div className={styles.row}>
              <span className={styles.label}>최근 요청</span>
              <span title={[reviewState.open.reasonCode, reviewState.open.llmErrorCode].filter(Boolean).join(' / ') || undefined}>
                {reviewState.open.stateLabel}
                {reviewState.open.startedAt ? ` · 시작 ${formatKstShort(reviewState.open.startedAt)}` : ''}
                {reviewState.open.reason ? ` · ${reviewState.open.reason}` : ''}
              </span>
            </div>
          ) : null}
          {reviewState.latestResult ? (
            <div className={styles.row}>
              <span className={styles.label}>최근 결과</span>
              <Link className={styles.inline} href={juryHref(`/reviews/${reviewState.latestResult.id}`)}>
                결과 보기 · 완료 {formatKstShort(reviewState.latestResult.completedAt)}
              </Link>
            </div>
          ) : null}
          {!reviewState.attemptsLoaded ? <p className={styles.muted}>실행 기록을 불러오지 못해 진행 중인 요청은 확인할 수 없습니다.</p> : null}
        </article>
        );
      })}
    </section>
  );
}

const criteriaDialogClasses = {
  button: buttonClass('secondary'),
  dialog: styles.summaryDialog,
  inner: styles.summaryDialogInner,
  close: styles.summaryDialogClose,
  title: styles.summaryDialogTitle,
  body: styles.summaryDialogBody,
  footer: styles.summaryDialogFooter,
  secondaryButton: buttonClass('ghost'),
};

export function ImprovementsBody({
  actor,
  view,
  approvals = {},
  summaries = {},
  gates = {},
  reReviews = {},
}: {
  actor: JuryActor;
  view: JuryConsoleView;
  approvals?: Readonly<Record<string, 'APPROVED' | 'PENDING' | 'ACCEPT'>>;
  summaries?: Readonly<Record<string, string>>;
  gates?: Readonly<Record<string, 'APPROVED' | 'BLOCKED' | 'GATED' | 'PENDING'>>;
  reReviews?: Readonly<Record<string, ProductReReviewState>>;
}) {
  const rows = projectImprovementRows(view, approvals);
  const canHandoff = canShowWrite(actor, 'improvement.write');
  const canRun = canShowWrite(actor, 'agent.execute');
  const canReview = canShowWrite(actor, 'review.start');
  const agentTasks = new Set(view.agentTaskIds ?? []);
  return (
    <section className={styles.panel}>
      <PageHeader
        crumbs={[{ label: '홈', href: juryHref('/') }, { label: '개선' }]}
        title="개선"
        description="심사 결과에서 나온 개선 작업과 진행 상태를 확인하세요."
      />
      {rows.length === 0 ? <EmptyState action={<ButtonLink variant="primary" icon={FileText} href={juryHref('/reviews')}>결과 보기</ButtonLink>}>{displayText(SHELL_EMPTY.improvements)}</EmptyState> : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>상태</th>
              <th>작업 유형</th>
              <th>진단</th>
              <th>완료 기준</th>
              <th>원본 심사</th>
              <th>원본 서비스</th>
              <th>승인</th>
              <th>에이전트</th>
              <th>추적</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((task) => (
              <tr key={task.id}>
                <td><StatusBadge status={task.status} title={task.status}>{userLabel(task.status)}</StatusBadge></td>
                <td>{task.taskType ?? displayText(SHELL_UNAVAILABLE)}</td>
                <td><span className={styles.ellipsisText} title={task.diagnosis}>{task.diagnosis}</span></td>
                <td className={styles.nowrapCell}><AcceptanceCriteriaDialog criteria={task.acceptanceCriteria} classes={criteriaDialogClasses} /></td>
                <td><Link className={`${styles.inline} ${styles.identifier}`} href={juryHref(`/reviews/${task.sourceReviewId}`)} title={task.sourceReviewId}>{compactIdentifier(task.sourceReviewId)}</Link></td>
                <td>{task.sourceService ?? displayText(SHELL_UNAVAILABLE)}</td>
                <td title={task.approval ?? undefined}>{task.approval ? userLabel(task.approval) : displayText(SHELL_UNAVAILABLE)}</td>
                <td>
                  {task.agentStatus === 'RUNNING' ? <span>진행 중</span> : null}
                  {task.agentStatus === 'COMPLETED' ? (
                    <>
                      <span>완료</span>
                      <p className={styles.muted}>Mock</p>
                      {summaries[task.id] ? <p>{summaries[task.id]}</p> : null}
                      {task.agentFinishedAt ? <p>{formatKstFull(task.agentFinishedAt)}</p> : null}
                    </>
                  ) : null}
                  {task.agentStatus === 'BLOCKED' ? <span>중단됨</span> : null}
                  {task.agentStatus === 'PENDING' || !task.agentStatus ? (
                    task.agentStatus === 'PENDING' ? <span>{userLabel('PENDING')}</span> : <span>{task.approval === 'APPROVED' && agentTasks.has(task.id) ? userLabel('READY') : displayText(SHELL_UNAVAILABLE)}</span>
                  ) : null}
                  {canRun && task.approval === 'APPROVED' && task.agentStatus === 'PENDING' && task.agentExecutionId ? (
                    <form action={runHumanAgentExecution}>
                      <input type="hidden" name="agentExecutionId" value={task.agentExecutionId} />
                      <Button variant="secondary" icon={Play} type="submit">에이전트 실행 (Mock)</Button>
                    </form>
                  ) : null}
                  {task.agentStatus === 'COMPLETED' && task.agentExecutionId && gates[task.agentExecutionId] ? (
                    <>
                      <p>변경 검사</p>
                      {gates[task.agentExecutionId] === 'PENDING' ? <p>대기 중</p> : <p title={gates[task.agentExecutionId]}>{userLabel(gates[task.agentExecutionId])}</p>}
                      {canRun && gates[task.agentExecutionId] === 'PENDING' ? (
                        <form action={runProductChangeGate}>
                          <input type="hidden" name="agentExecutionId" value={task.agentExecutionId} />
                          <Button variant="secondary" icon={Play} type="submit">변경 검사 실행</Button>
                        </form>
                      ) : null}
                    </>
                  ) : null}
                  {task.agentStatus === 'COMPLETED' && task.agentExecutionId && gates[task.agentExecutionId] === 'APPROVED' ? (
                    reReviews[task.agentExecutionId] ? (
                      <>
                        <p>재심사</p>
                        <p title={reReviews[task.agentExecutionId].status}>{userLabel(reReviews[task.agentExecutionId].status)}</p>
                        {reReviews[task.agentExecutionId].decision ? <p>새 심사 결과 {userLabel(reReviews[task.agentExecutionId].decision)}</p> : null}
                        {reReviews[task.agentExecutionId].completedAt ? <p>{formatKstFull(reReviews[task.agentExecutionId].completedAt)}</p> : null}
                        {reReviews[task.agentExecutionId].parentReviewResultId ? <p>원래 심사 결과 {reReviews[task.agentExecutionId].parentReviewResultId}</p> : null}
                        {reReviews[task.agentExecutionId].evidenceId ? <p>{reReviews[task.agentExecutionId].evidenceId}</p> : null}
                        {reReviews[task.agentExecutionId].reviewResultId ? (
                          <Link className={styles.inline} href={juryHref(`/reviews/${reReviews[task.agentExecutionId].reviewResultId}`)}>새 심사 결과 열기</Link>
                        ) : null}
                      </>
                    ) : canReview ? (
                      <form action={runProductChangeGateReReview}>
                        <input type="hidden" name="agentExecutionId" value={task.agentExecutionId} />
                        <Button variant="secondary" icon={Play} type="submit">재심사 실행 (Mock)</Button>
          <p className={styles.muted}>{MOCK_RE_REVIEW_NOTICE}</p>
                      </form>
                    ) : null
                  ) : null}
                </td>
                <td>
                  <Link className={styles.inline} href={juryHref(`/improvements/${task.id}`)}>추적 보기</Link>
                  {canHandoff && agentTasks.has(task.id) && task.approval === 'APPROVED' && task.status === 'OPEN' && !task.agentStatus ? (
                    <form action={handoffHumanImprovement}>
                      <input type="hidden" name="improvementTaskId" value={task.id} />
                      <Button variant="secondary" icon={Send} type="submit">에이전트에 전달</Button>
                    </form>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <WriteControl actor={actor} action="improvement.write" label="개선 Task 작성" returnTo={juryHref('/improvements')} resourceId={view.tasks[0]?.id} disabledHint={<>아직 저장 기능이 없습니다. <Link className={styles.inline} href={juryHref('/reviews')}>결과</Link>에서 리뷰 상세를 열어 「개선 작업 만들기」를 사용하세요.</>} />
    </section>
  );
}

export function ImprovementTraceBody({ trace }: { trace: ImprovementTrace }) {
  const screen = projectImprovementTrace(trace);
  const lineage = projectTraceLineage(trace);
  return (
    <>
      <section className={styles.panel}>
        <h2>진행 경로</h2>
        {lineage.map((step) => (
          <div className={styles.row} key={step.label}>
            <span className={styles.label} title={step.label}>{traceLabel(step.label)}</span>
            <span title={step.value}>{displayText(step.value)}</span>
          </div>
        ))}
      </section>
      <section className={styles.panel}>
        <h2>개선 작업</h2>
        {screen.summary.map((line) => (
          <div className={styles.row} key={line.label}>
            <span className={styles.label} title={line.label}>{traceLabel(line.label)}</span>
            <span title={line.value}>{displayText(line.value)}</span>
          </div>
        ))}
      </section>
      <section className={styles.panel}>
        <h2>목표</h2>
        <p>{screen.objective ?? '목표 없음'}</p>
        <ul>
          {screen.constraints.map((item) => <li key={item}>{item}</li>)}
        </ul>
      </section>
      <section className={styles.panel}>
        <h2>진행 기록</h2>
        <div className={styles.timeline}>
          {screen.timeline.map((item) => (
            <article key={item.key}>
              <h3 title={item.title}>{traceLabel(item.title)}</h3>
              <p><StatusBadge status={item.status} title={item.status}>{userLabel(item.status)}</StatusBadge></p>
              {item.lines.map((line) => (
                <div className={styles.row} key={`${item.key}-${line.label}`}>
                  <span className={styles.label} title={line.label}>{traceLabel(line.label)}</span>
                  <span title={line.value}>{displayText(line.value)}</span>
                </div>
              ))}
            </article>
          ))}
        </div>
      </section>
    </>
  );
}

export function AgentsBody({ actor, view }: { actor: JuryActor; view: JuryConsoleView }) {
  return (
    <section className={styles.panel}>
      <h2>에이전트</h2>
      {view.executions.map((row) => (
        <div className={styles.row} key={row.id}>
          <span>{row.agent}</span>
          <span className={styles.muted}>{displayText(row.status)}</span>
        </div>
      ))}
      <WriteControl actor={actor} action="agent.execute" label="Agent 실행" returnTo={juryHref('/agents')} resourceId={view.executions[0]?.id} disabledHint={<>아직 저장 기능이 없습니다. <Link className={styles.inline} href={juryHref('/reviews')}>결과</Link>에서 리뷰 상세의 에이전트 실행을 사용하세요.</>} />
    </section>
  );
}

export function AutomationBody({
  actor,
  view,
  loop,
}: {
  actor: JuryActor;
  view: JuryConsoleView;
  loop: ConsoleLoopScreen | null;
}) {
  const policy = loop
    ? (loop.policy ?? {
        maxIterations: null,
        maxVerificationAttempts: null,
        maxSameDecision: null,
        maxSameConflict: null,
        maxRuntimeMs: null,
        maxCostUsd: null,
      })
    : {
        maxIterations: view.loopPolicy.maxIterations,
        maxVerificationAttempts: null,
        maxSameDecision: null,
        maxSameConflict: null,
        maxRuntimeMs: view.loopPolicy.maxRuntimeMs,
        maxCostUsd: view.loopPolicy.maxCostUsd,
      };
  return (
    <section className={styles.panel}>
      <h2>자동화</h2>
      <p className={styles.muted}>한도는 저장된 Loop Guard입니다. 이 화면은 자동 Loop를 켜지 않습니다.</p>
      {loop ? (
        <>
          <div className={styles.row}><span className={styles.label}>사용 여부</span><span>{loop.enabled ? '켜짐' : '꺼짐'}</span></div>
          <div className={styles.row}><span className={styles.label}>실행 방식</span><span title={loop.mode}>{userLabel(loop.mode)}</span></div>
          <div className={styles.row}><span className={styles.label}>중단 이유</span><span>{loop.stopReason ?? '표시된 Loop 기준 없음'}</span></div>
          <p className={styles.muted}>권한이 있는 서비스의 Loop만 표시합니다. 중단 이유도 표시된 Loop 기준입니다.</p>
          {loop.cycles.map((cycle) => (
            <div className={styles.row} key={cycle.id}>
              <span title={cycle.status}>{cycleStatusLabel(cycle.status, loop.enabled)}</span>
              <span className={styles.muted}>iteration {cycle.iteration} · {cycle.blockedReason ?? '중단 이유 없음'}</span>
            </div>
          ))}
        </>
      ) : (
        <p className={styles.muted}>Loop 상태를 읽지 못했습니다.</p>
      )}
      <div className={styles.row}><span className={styles.label}>maxIterations</span><span>{policy.maxIterations ?? '미정'}</span></div>
      <div className={styles.row}><span className={styles.label}>maxVerificationAttempts</span><span>{policy.maxVerificationAttempts ?? '미정'}</span></div>
      <div className={styles.row}><span className={styles.label}>maxSameDecision</span><span>{policy.maxSameDecision ?? '미정'}</span></div>
      <div className={styles.row}><span className={styles.label}>maxSameConflict</span><span>{policy.maxSameConflict ?? '미정'}</span></div>
      <div className={styles.row}><span className={styles.label}>maxRuntimeMs</span><span>{policy.maxRuntimeMs ?? '미정'}</span></div>
      <div className={styles.row}><span className={styles.label}>maxCostUsd</span><span>{policy.maxCostUsd ?? '미정'}</span></div>
      {canShowWrite(actor, 'automation.write') ? (
        <form action={stopJuryAutoLoop}>
          <input type="hidden" name="command" value="STOP" />
          <input type="hidden" name="tenantId" value="client-supplied-tenant" />
          <Button variant="secondary" icon={Square} type="submit">자동 Loop 중지</Button>
        </form>
      ) : (
        <p className={styles.muted}>자동 Loop 중지: 현재 역할에는 이 변경 권한이 없습니다.</p>
      )}
    </section>
  );
}

/** RM-15 (I-021): GET form for search / filter + pager. */
function ListControls({ path, query, filterLabel, filterOptions, labelOf, total, page, pages }: {
  path: string; query: ListQuery; filterLabel?: string; filterOptions?: string[]; labelOf?: (v: string) => string;
  total: number; page: number; pages: number;
}) {
  return (
    <>
      <form className={styles.listControls} method="get" action={juryHref(path)}>
        <label>검색 <input className={styles.field} type="search" name="q" defaultValue={query.q} /></label>
        {filterOptions && filterOptions.length > 0 ? (
          <label>{filterLabel ?? '구분'}
            <select className={styles.field} name="filter" defaultValue={query.filter}>
              <option value="">전체</option>
              {filterOptions.map((v) => <option key={v} value={v}>{labelOf ? labelOf(v) : v}</option>)}
            </select>
          </label>
        ) : null}
        <Button variant="secondary" icon={Check} type="submit">적용</Button>
      </form>
      <p className={styles.muted}>{total}건 · {page}/{pages}쪽</p>
    </>
  );
}

function Pager({ path, query, page, pages }: { path: string; query: ListQuery; page: number; pages: number }) {
  if (pages <= 1) return null;
  return (
    <nav className={styles.pager} aria-label="쪽 이동">
      {page > 1 ? <Link className={styles.inline} href={listHref(juryHref(path), query, page - 1)}>이전</Link> : <span className={styles.muted}>이전</span>}
      <span>{page}/{pages}</span>
      {page < pages ? <Link className={styles.inline} href={listHref(juryHref(path), query, page + 1)}>다음</Link> : <span className={styles.muted}>다음</span>}
    </nav>
  );
}

export function AuditBody({ view, query = { q: '', filter: '', page: 1 } }: { view: JuryConsoleView; query?: ListQuery }) {
  const all = projectAudit(view);
  const paged = pageList(all, query, {
    key: (e) => e.action,
    text: (e) => `${auditActionLabel(e.action)} ${e.actor} ${e.resource} ${e.status}`,
  });
  const events = paged.items;
  return (
    <section className={styles.panel}>
      <PageHeader
        crumbs={[{ label: '홈', href: juryHref('/') }, { label: '감사 이력' }]}
        title="감사 이력"
        description="누가 언제 무엇을 했는지 시간순으로 확인하세요. 원래 기록 값은 마우스를 올리면 보입니다."
      />
      {all.length > 0 ? <ListControls path="/audit" query={query} filterLabel="활동" filterOptions={paged.filterOptions} labelOf={auditActionLabel} total={paged.total} page={paged.page} pages={paged.pages} /> : null}
      {all.length === 0 ? <EmptyState>{displayText(SHELL_EMPTY.audit)}</EmptyState> : events.length === 0 ? <p className={styles.muted}>조건에 맞는 기록 없음</p> : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>시간</th>
              <th>사용자</th>
              <th>활동</th>
              <th>대상</th>
              <th>상태</th>
            </tr>
          </thead>
          <tbody>
            {events.map((event) => (
              <tr key={event.id}>
                <td className={styles.nowrapCell}>{event.timestamp}</td>
                <td className={styles.identifier} title={event.actor}>{compactIdentifier(event.actor)}</td>
                <td title={event.action}>
                  {auditActionLabel(event.action)}
                </td>
                <td className={styles.identifier} title={event.resource}>{compactIdentifier(event.resource)}</td>
                <td className={styles.nowrapCell}><StatusBadge status={event.status} title={event.status}>{auditActionLabel(event.status)}</StatusBadge></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <Pager path="/audit" query={query} page={paged.page} pages={paged.pages} />
    </section>
  );
}

export function SettingsBody({
  actor,
  view,
  members,
  tenantName = null,
  loop = null,
}: {
  actor: JuryActor;
  view: JuryConsoleView;
  members: JuryMembership[];
  tenantName?: string | null;
  loop?: ConsoleLoopScreen | null;
}) {
  return (
    <>
    <PageHeader
      crumbs={[{ label: '홈', href: juryHref('/') }, { label: '관리' }]}
      title="관리"
      description="서비스 연결, 멤버, 권한, 초대, 보안과 설정을 한 곳에서 관리합니다."
    />
    <nav className={styles.adminGrid} aria-label="관리 메뉴">
      <Link className={styles.adminCard} href={juryHref('/organization/services')}><strong>서비스 연결</strong><span>연결 상태와 서비스 권한</span></Link>
      {actor.ok && (actor.role === 'OWNER' || actor.role === 'ADMIN') ? <Link className={styles.adminCard} href={juryHref('/operations')}><strong>운영 지표</strong><span>요청 수·완료율·실패 사유·소요 시간</span></Link> : null}
      <Link className={styles.adminCard} href={juryHref('/organization/members')}><strong>멤버</strong><span>조직 역할과 상태</span></Link>
      <Link className={styles.adminCard} href={juryHref('/organization/invitations')}><strong>초대</strong><span>이메일 초대와 대기 상태</span></Link>
      <Link className={styles.adminCard} href={juryHref('/organization/security')}><strong>보안</strong><span>인증과 조직 보호</span></Link>
      <Link className={styles.adminCard} href={juryHref('/audit')}><strong>감사 기록</strong><span>사람이 읽는 활동 기록</span></Link>
      <Link className={styles.adminCard} href={juryHref('/automation')}><strong>자동화</strong><span>실행 상태와 중단</span></Link>
    </nav>
    <section className={styles.panel}>
      <h2>조직 정보</h2>
      <div className={styles.row}><span className={styles.label}>조직 이름</span><span>{tenantName ?? displayText(SHELL_UNAVAILABLE)}</span></div>
      <details className={styles.technicalDetails}>
        <summary>기술 정보 자세히 보기</summary>
        <div className={styles.row}><span className={styles.label}>조직 식별자</span><span>{view.tenantId}</span></div>
      </details>
    </section>
    <section className={styles.panel}>
      <h2>멤버와 역할</h2>
      <p className={styles.muted}>OWNER와 ADMIN만 멤버를 추가·변경·제거할 수 있습니다. 마지막 OWNER는 보호됩니다.</p>
      {members.map((row) => (
        <div className={styles.row} key={row.id}>
          <span>{userLabel(row.role)}</span>
          <span className={styles.muted}>멤버 {compactIdentifier(row.userId)}</span>
        </div>
      ))}
      {canShowWrite(actor, 'membership.write') ? (
        <form action={changeJuryMembership}>
          <label>멤버 선택 또는 사용자 이메일<input className={styles.field} name="targetUserId" placeholder="멤버 식별자" required /></label>
          <select className={styles.field} name="role" defaultValue="DEVELOPER">
            <option value="OWNER">소유자</option>
            <option value="ADMIN">관리자</option>
            <option value="REVIEWER">리뷰어</option>
            <option value="DEVELOPER">개발자</option>
            <option value="VIEWER">열람자</option>
          </select>
          <select className={styles.field} name="command" defaultValue="ADD_MEMBER">
            <option value="ADD_MEMBER">추가</option>
            <option value="CHANGE_ROLE">역할 변경</option>
            <option value="REMOVE_MEMBER">제거</option>
          </select>
          <input type="hidden" name="tenantId" value="client-supplied-tenant" />
          <button className={buttonClass('primary')} type="submit">
            역할 적용
          </button>
        </form>
      ) : (
        <p className={styles.muted}>Membership 변경: 현재 역할에는 이 변경 권한이 없습니다.</p>
      )}
      <WriteControl actor={actor} action="settings.write" label="조직 설정 변경" returnTo={juryHref('/settings')} disabledHint="아직 저장 기능이 없습니다." />
    </section>
    <section className={styles.panel}>
      <h2>권한 요약</h2>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>기능</th>
            <th>상태</th>
          </tr>
        </thead>
        <tbody>
          {JURY_ACTIONS.map((action) => (
            <tr key={action}>
              <td>{userLabel(action)}</td>
              <td>{canShowWrite(actor, action) ? '허용' : '권한 없음'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
    <section className={styles.panel}>
      <h2>자동화</h2>
      <p className={styles.muted}>저장된 Loop Guard만 보여 줍니다. 이 화면은 자동화 설정을 바꾸지 않습니다.</p>
      <div className={styles.row}><span className={styles.label}>사용 여부</span><span>{loop ? (loop.enabled ? '켜짐' : '꺼짐') : displayText(SHELL_UNAVAILABLE)}</span></div>
      <div className={styles.row}><span className={styles.label}>실행 방식</span><span title={loop?.mode}>{loop?.mode ? userLabel(loop.mode) : displayText(SHELL_UNAVAILABLE)}</span></div>
      <div className={styles.row}><span className={styles.label} title="maxIterations">최대 반복 횟수</span><span>{view.loopPolicy.maxIterations ?? displayText(SHELL_UNAVAILABLE)}</span></div>
      <div className={styles.row}><span className={styles.label} title="maxRuntimeMs">최대 실행 시간(ms)</span><span>{view.loopPolicy.maxRuntimeMs ?? displayText(SHELL_UNAVAILABLE)}</span></div>
      <div className={styles.row}><span className={styles.label} title="maxCostUsd">최대 비용(USD)</span><span>{view.loopPolicy.maxCostUsd ?? displayText(SHELL_UNAVAILABLE)}</span></div>
      <p><Link className={styles.inline} href={juryHref('/automation')}>자동화 상태</Link></p>
      <p><Link className={styles.inline} href={juryHref('/discovery')}>서비스 확인</Link></p>
      <p><Link className={styles.inline} href={juryHref('/agents')}>에이전트</Link></p>
    </section>
    </>
  );
}

export function ReReviewAgentRunBody({ screen }: { screen: ReviewConsoleScreen }) {
  const execution = screen.nextAgentExecution;
  return (
    <section className={styles.panel}>
      <h2>두 번째 반복</h2>
      {screen.canRunReReviewAgent && execution ? (
        <form action={runReReviewAgentExecution}>
          <input type="hidden" name="agentExecutionId" value={execution.id} />
          <Button variant="secondary" icon={Play} type="submit">에이전트 실행</Button>
        </form>
      ) : null}
      {execution?.status === 'RUNNING' ? <p>에이전트 진행 중</p> : null}
      {execution?.status === 'COMPLETED' ? <p>에이전트 완료</p> : null}
    </section>
  );
}

export function ReReviewChangeGateBody({ screen }: { screen: ReviewConsoleScreen }) {
  const execution = screen.nextAgentExecution;
  const gate = screen.nextChangeGate;
  return (
    <section className={styles.panel}>
      <h2>두 번째 변경 검사</h2>
      {screen.canRunReReviewChangeGate && execution ? (
        <form action={runReReviewChangeGate}>
          <input type="hidden" name="agentExecutionId" value={execution.id} />
          <Button variant="secondary" icon={Play} type="submit">변경 검사 실행</Button>
        </form>
      ) : null}
      {gate?.status === 'APPROVED' ? <p>변경 검사: 승인됨</p> : null}
      {gate?.status === 'GATED' ? <p>변경 검사: 보류됨</p> : null}
      {gate?.status === 'BLOCKED' ? <p>변경 검사: 차단됨</p> : null}
    </section>
  );
}

export function SecondReReviewBody({ screen }: { screen: ReviewConsoleScreen }) {
  const execution = screen.nextAgentExecution;
  const review = screen.nextSecondReReview;
  return (
    <section className={styles.panel}>
      <h2>두 번째 재심사</h2>
      {screen.canRunSecondReReview && execution ? (
        <form action={runSecondReReview}>
          <input type="hidden" name="agentExecutionId" value={execution.id} />
          <Button variant="secondary" icon={Play} type="submit">재심사 실행 (Mock)</Button>
          <p className={styles.muted}>{MOCK_RE_REVIEW_NOTICE}</p>
        </form>
      ) : null}
      {review?.status === 'RUNNING' ? <p>재심사 진행 중</p> : null}
      {review?.status === 'EXECUTED' ? <p>재심사 완료</p> : null}
    </section>
  );
}

export function SecondImprovementBody({ screen }: { screen: ReviewConsoleScreen }) {
  const task = screen.nextSecondImprovement;
  return (
    <section className={styles.panel}>
      <h2>다음 개선</h2>
      {screen.secondReReviewDecision === 'ACCEPT' ? <p>추가 개선이 필요하지 않습니다</p> : null}
      {task ? (
        <>
          <p>다음 개선 작업</p>
          <p>작업: {task.id}</p>
          <p>유형: {task.taskType}</p>
          <p>상태: {task.status}</p>
        </>
      ) : null}
      {screen.canCreateSecondImprovement && screen.secondReReviewResultId ? (
        <form action={createSecondReReviewImprovementTask}>
          <input type="hidden" name="reReviewResultId" value={screen.secondReReviewResultId} />
          <Button variant="secondary" icon={ArrowRight} type="submit">다음 개선 작업</Button>
        </form>
      ) : null}
    </section>
  );
}

export function SecondImprovementApprovalBody({ screen }: { screen: ReviewConsoleScreen }) {
  const task = screen.nextSecondImprovement;
  return (
    <section className={styles.panel}>
      <h2>두 번째 승인</h2>
      {screen.nextSecondApproval ? <p>에이전트 승인 완료</p> : null}
      {screen.nextSecondApproval ? <p>담당자 승인: {screen.nextSecondApproval}</p> : null}
      {screen.canApproveSecondImprovement && task ? (
        <form action={approveSecondImprovementTask}>
          <input type="hidden" name="improvementTaskId" value={task.id} />
          <Button variant="secondary" icon={Check} type="submit">에이전트 작업 승인</Button>
        </form>
      ) : null}
    </section>
  );
}

export function SecondImprovementHandoffBody({ screen }: { screen: ReviewConsoleScreen }) {
  const task = screen.nextSecondImprovement;
  const execution = screen.nextSecondAgentExecution;
  return (
    <section className={styles.panel}>
      <h2>두 번째 전달</h2>
      {execution?.status === 'PENDING' ? <p>에이전트 대기 중</p> : null}
      {screen.canHandoffSecondImprovement && task ? (
        <form action={handoffSecondImprovementTask}>
          <input type="hidden" name="improvementTaskId" value={task.id} />
          <Button variant="secondary" icon={Send} type="submit">에이전트에 전달</Button>
        </form>
      ) : null}
    </section>
  );
}

export function SecondChangeGateBody({ screen }: { screen: ReviewConsoleScreen }) {
  const execution = screen.nextSecondAgentExecution;
  const gate = screen.nextSecondChangeGate;
  return (
    <section className={styles.panel}>
      <h2>완료 후 변경 검사</h2>
      {execution?.status === 'COMPLETED' ? <p>에이전트 완료</p> : null}
      {screen.canRunSecondChangeGate && execution ? (
        <form action={runSecondChangeGate}>
          <input type="hidden" name="agentExecutionId" value={execution.id} />
          <Button variant="secondary" icon={Play} type="submit">변경 검사 실행</Button>
        </form>
      ) : null}
      {gate?.status === 'APPROVED' ? <p>변경 검사: 승인됨</p> : null}
      {gate?.status === 'GATED' ? <p>변경 검사: 보류됨</p> : null}
      {gate?.status === 'BLOCKED' ? <p>변경 검사: 차단됨</p> : null}
    </section>
  );
}

export function LaterReReviewBody({ screen }: { screen: ReviewConsoleScreen }) {
  const execution = screen.nextSecondAgentExecution;
  const review = screen.nextLaterReReview;
  return (
    <section className={styles.panel}>
      <h2>이후 재심사</h2>
      {screen.canRunLaterReReview && execution ? (
        <form action={runLaterReReview}>
          <input type="hidden" name="agentExecutionId" value={execution.id} />
          <Button variant="secondary" icon={Play} type="submit">재심사 실행 (Mock)</Button>
          <p className={styles.muted}>{MOCK_RE_REVIEW_NOTICE}</p>
        </form>
      ) : null}
      {review?.status === 'EXECUTED' ? <p>두 번째 재심사 결과</p> : null}
      {review?.decision ? <p>결론: {review.decision}</p> : null}
    </section>
  );
}

export function LaterImprovementBody({ screen }: { screen: ReviewConsoleScreen }) {
  const task = screen.nextLaterImprovement;
  const review = screen.nextLaterReReview;
  return (
    <section className={styles.panel}>
      <h2>이후 개선</h2>
      {review?.status === 'EXECUTED' && review.decision === 'ACCEPT' ? <p>개선 없음</p> : null}
      {task ? (
        <>
          <p>다음 개선 작업</p>
          <p>작업: {task.id}</p>
          <p>유형: {task.taskType}</p>
          <p>상태: {task.status}</p>
        </>
      ) : null}
      {screen.canCreateLaterImprovement && review?.reviewResultId ? (
        <form action={createLaterReReviewImprovementTask}>
          <input type="hidden" name="reReviewResultId" value={review.reviewResultId} />
          <Button variant="secondary" icon={ArrowRight} type="submit">다음 개선 작업</Button>
        </form>
      ) : null}
    </section>
  );
}

export function LaterImprovementApprovalBody({ screen }: { screen: ReviewConsoleScreen }) {
  const task = screen.nextLaterImprovement;
  return (
    <section className={styles.panel}>
      <h2>이후 승인</h2>
      {screen.nextLaterApproval ? <p>에이전트 승인 완료</p> : null}
      {screen.nextLaterApproval ? <p>담당자 승인: {screen.nextLaterApproval}</p> : null}
      {screen.canApproveLaterImprovement && task ? (
        <form action={approveLaterImprovementTask}>
          <input type="hidden" name="improvementTaskId" value={task.id} />
          <Button variant="secondary" icon={Check} type="submit">에이전트 작업 승인</Button>
        </form>
      ) : null}
    </section>
  );
}

export function LaterImprovementHandoffBody({ screen }: { screen: ReviewConsoleScreen }) {
  const task = screen.nextLaterImprovement;
  const execution = screen.nextLaterAgentExecution;
  return (
    <section className={styles.panel}>
      <h2>이후 전달</h2>
      {execution?.status === 'PENDING' ? <p>에이전트 대기 중</p> : null}
      {screen.canHandoffLaterImprovement && task ? (
        <form action={handoffLaterImprovementTask}>
          <input type="hidden" name="improvementTaskId" value={task.id} />
          <Button variant="secondary" icon={Send} type="submit">에이전트에 전달</Button>
        </form>
      ) : null}
    </section>
  );
}

export function LaterAgentRunBody({ screen }: { screen: ReviewConsoleScreen }) {
  const execution = screen.nextLaterAgentExecution;
  return (
    <section className={styles.panel}>
      <h2>이후 에이전트</h2>
      {screen.canRunLaterAgent && execution ? (
        <form action={runLaterAgentExecution}>
          <input type="hidden" name="agentExecutionId" value={execution.id} />
          <Button variant="secondary" icon={Play} type="submit">에이전트 실행</Button>
        </form>
      ) : null}
      {execution?.status === 'RUNNING' ? <p>에이전트 진행 중</p> : null}
      {execution?.status === 'COMPLETED' ? <p>에이전트 완료</p> : null}
    </section>
  );
}

export function LaterChangeGateBody({ screen }: { screen: ReviewConsoleScreen }) {
  const execution = screen.nextLaterAgentExecution;
  const gate = screen.nextLaterChangeGate;
  return (
    <section className={styles.panel}>
      <h2>이후 변경 검사</h2>
      {screen.canRunLaterChangeGate && execution ? (
        <form action={runLaterChangeGate}>
          <input type="hidden" name="agentExecutionId" value={execution.id} />
          <Button variant="secondary" icon={Play} type="submit">변경 검사 실행</Button>
        </form>
      ) : null}
      {gate?.status === 'APPROVED' ? <p>변경 검사: 승인됨</p> : null}
      {gate?.status === 'GATED' ? <p>변경 검사: 보류됨</p> : null}
      {gate?.status === 'BLOCKED' ? <p>변경 검사: 차단됨</p> : null}
    </section>
  );
}

export function FollowingReReviewBody({ screen }: { screen: ReviewConsoleScreen }) {
  const execution = screen.nextLaterAgentExecution;
  const review = screen.nextFollowingReReview;
  const surface = review?.surface;
  return (
    <section className={styles.panel}>
      <h2>다음 재심사</h2>
      {screen.canRunFollowingReReview && execution ? (
        <form action={runFollowingReReview}>
          <input type="hidden" name="agentExecutionId" value={execution.id} />
          <Button variant="secondary" icon={Play} type="submit">재심사 실행 (Mock)</Button>
          <p className={styles.muted}>{MOCK_RE_REVIEW_NOTICE}</p>
        </form>
      ) : null}
      {review?.decision ? <p>결론: {review.decision}</p> : null}
      {surface ? <TranslationHint /> : null}
      {surface ? <p lang="en">{surface.statusSummary}</p> : null}
      {surface ? (
        <ul lang="en">{surface.topProblems.map((item) => <li key={item}>{item}</li>)}</ul>
      ) : null}
      {surface ? <p lang="en">{surface.expectedUserEffect}</p> : null}
      {surface ? <p lang="en">{surface.risk}</p> : null}
      {surface ? (
        <ul lang="en">{surface.dimensionEvidence.map((item) => <li key={item}>{item}</li>)}</ul>
      ) : null}
      {surface ? (
        <ul lang="en">{surface.supportedClaims.map((item) => <li key={item}>{item}</li>)}</ul>
      ) : null}
      {surface ? (
        <ul lang="en">{surface.partiallySupportedClaims.map((item) => <li key={item}>{item}</li>)}</ul>
      ) : null}
      {surface ? (
        <ul lang="en">{surface.hypotheses.map((item) => <li key={item}>{item}</li>)}</ul>
      ) : null}
    </section>
  );
}

// RM-03 (CT-11): requests that have no result yet. Status, times and failure reason; verdict column stays empty.
function RequestStatusSection({ view }: { view: JuryConsoleView }) {
  if (!view.attempts) {
    return <p className={styles.muted}>실행 기록을 불러오지 못했습니다. 결과가 없는 요청 목록은 확인할 수 없습니다.</p>;
  }
  const rows = buildRequestStatusRows(view, Date.now());
  if (rows.length === 0) return null;
  return (
    <section className={styles.panel}>
      <h3>결과가 없는 요청</h3>
      <p className={styles.muted}>실행 중이거나 실패한 요청입니다. 판정은 표시하지 않습니다.</p>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>상태</th>
            <th>시작</th>
            <th>종료</th>
            <th>리뷰 유형</th>
            <th>리뷰 자료</th>
            <th>사유</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <td className={styles.nowrapCell} title={row.state}><StatusBadge>{row.stateLabel}</StatusBadge></td>
              <td className={styles.nowrapCell} title={row.startedAt ? formatKstFull(row.startedAt) : undefined}>{row.startedAt ? formatKstShort(row.startedAt) : '기록 없음'}</td>
              <td className={styles.nowrapCell} title={row.finishedAt ? formatKstFull(row.finishedAt) : undefined}>{row.finishedAt ? formatKstShort(row.finishedAt) : '-'}</td>
              <td title={row.reviewType}>{userLabel(row.reviewType)}</td>
              <td className={styles.identifier} title={row.evidenceId}>{shortId(row.evidenceId)}</td>
              <td title={[row.reasonCode, row.llmErrorCode].filter(Boolean).join(' / ') || undefined}>
                {row.reason ?? '-'}{row.attempts > 1 ? ` · 시도 ${row.attempts}회` : ''}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
