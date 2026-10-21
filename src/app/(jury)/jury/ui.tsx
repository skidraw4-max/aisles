import Link from 'next/link';
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
import type { ReviewConsoleScreen } from '@/lib/jury-product/review-console';
import { projectImprovementRows } from '@/lib/jury-product/product-improvement';
import { formatMeasuredValue, projectAudit, projectDashboard, projectTraceLineage, SHELL_EMPTY, SHELL_UNAVAILABLE } from '@/lib/jury-product/product-shell';
import { projectServiceRows } from '@/lib/jury-product/service-onboarding';
import { acknowledgeHumanReview, changeJuryMembership, createHumanImprovementTask, createJuryTenant, decideCatalogScope, decideJuryScope, handoffHumanImprovement, proposeCatalogScope, runHumanAgentExecution, runHumanChangeGate, runProductChangeGate, runProductChangeGateReReview, runHumanReReview, createReReviewImprovementTask, approveReReviewAgentAction, handoffReReviewImprovement, runReReviewAgentExecution, runReReviewChangeGate, runSecondReReview, createSecondReReviewImprovementTask, approveSecondImprovementTask, handoffSecondImprovementTask, runSecondChangeGate, runLaterReReview, createLaterReReviewImprovementTask, approveLaterImprovementTask, handoffLaterImprovementTask, runLaterAgentExecution, runLaterChangeGate, runFollowingReReview, runJuryDiscovery, stopJuryAutoLoop, submitJuryAction, submitTenantEvidenceIntake, submitTenantReview } from './actions';
import type { ProductReReviewState } from '@/lib/jury-product/product-change-gate-rereview';
import { loadShellIdentity } from './load';
import { LogoutButton, ProductNav } from './shell-client';
import { TranslationHint } from './ui-primitives';
import type { JuryMembership } from '@/lib/jury-product/records';
import { auditActionLabel, displayText, traceLabel, userLabel } from '@/lib/jury-product/ui-labels';
import styles from './jury.module.css';

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
              역할 <span className={styles.badge} title={actor.role}>{userLabel(actor.role)}</span>
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
              <Link className={styles.inline} href="/login">
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
  if (code === 'PERSISTENCE_FAILED') return 'Evidence를 저장하지 못했습니다. Review는 실행하지 않습니다.';
  if (code === 'EVIDENCE_CREATED') return 'Evidence를 만들었습니다.';
  if (code === 'EVIDENCE_REUSED') return '같은 Evidence가 이미 있습니다.';
  if (code === 'EVIDENCE_CONNECTION_MISMATCH') return 'Evidence와 connection이 일치하지 않습니다.';
  if (code === 'PROJECTION_FAILED') return 'Evidence를 Review 입력으로 만들지 못했습니다. Review는 실행하지 않습니다.';
  if (code === 'REVIEW_NOT_EXECUTED') return 'Review를 실행하지 못했습니다.';
  if (code === 'REVIEW_ALREADY_EXISTS') return '같은 Review 요청이 이미 있습니다.';
  if (code === 'CLAIM_REQUIRED') return '이 Review에는 claim이 필요합니다.';
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
      <button className={styles.button} type="submit">
        내 tenant 만들기
      </button>
    </form>
  );
}

export function canShowWrite(actor: JuryActor, action: JuryAction): boolean {
  if (!actor.ok) return false;
  return decideJuryMutation({ actor, action, resourceTenantId: actor.tenantId }).ok;
}

export function WriteControl({
  actor,
  action,
  label,
  returnTo,
  resourceId,
}: {
  actor: JuryActor;
  action: JuryAction;
  label: string;
  returnTo: string;
  resourceId?: string;
}) {
  if (!canShowWrite(actor, action)) {
    return <p className={styles.muted}>{label}: 현재 역할에는 이 변경 권한이 없습니다.</p>;
  }
  return (
    <form action={submitJuryAction}>
      <input type="hidden" name="action" value={action} />
      <input type="hidden" name="tenantId" value="client-supplied-tenant" />
      <input type="hidden" name="resourceId" value={resourceId ?? ''} />
      <input type="hidden" name="returnTo" value={returnTo} />
      <button className={styles.button} type="submit">{label}</button>
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
      <div className={styles.pageIntro}>
        <div>
          <p className={styles.eyebrow}>현재 메뉴 · 홈</p>
          <h2 className={styles.pageTitle}>홈</h2>
          <p className={styles.pageDescription}>지금 해야 할 일과 최근 결과를 한눈에 확인하세요.</p>
        </div>
        <Link className={styles.primaryButton} href={juryHref('/evidence')}>리뷰 요청 시작</Link>
      </div>
      <section className={`${styles.panel} ${styles.nextAction}`}>
        <div>
          <p className={styles.eyebrow}>지금 할 일</p>
          <h2>최근 리뷰 결과를 확인하세요</h2>
          <p className={styles.muted}>새로운 결과가 도착하면 주요 문제와 권장 조치를 바로 확인할 수 있습니다.</p>
        </div>
        <Link className={styles.primaryButton} href={juryHref('/reviews')}>결과 보기</Link>
      </section>
      <div className={styles.cards}>
        <section className={styles.panel}>
          <h2>연결된 서비스</h2>
          <p className={styles.metric}>{board.services}</p>
          <p className={styles.muted}>정상 연결된 서비스</p>
        </section>
        <section className={styles.panel}>
          <h2>리뷰 자료</h2>
          <p className={styles.metric}>{board.evidence}</p>
          <p className={styles.muted}>최근 분석에 사용된 자료</p>
        </section>
        <section className={styles.panel}>
          <h2>진행 중 리뷰</h2>
          <p className={styles.metric}>{board.reviews}</p>
          <p className={styles.muted}>{board.reviewDetail}</p>
        </section>
        <section className={styles.panel}>
          <h2>개선 작업</h2>
          <p className={styles.metric}>{board.openImprovements}</p>
          <p className={styles.muted}>진행 중 {board.activeImprovements}건</p>
        </section>
      </div>
      <section className={styles.panel}>
        <h2>최근 결과와 활동</h2>
        {board.activity.length === 0 ? <p>{displayText(SHELL_EMPTY.audit)}</p> : (
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
                  <td>{event.timestamp}</td>
                  <td className={styles.identifier} title={event.actor}>{compactIdentifier(event.actor)}</td>
                  <td title={event.action}>{auditActionLabel(event.action)}</td>
                  <td className={styles.identifier} title={event.resource}>{compactIdentifier(event.resource)}</td>
                  <td><span className={styles.statusBadge} title={event.status}>{auditActionLabel(event.status)}</span></td>
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
        <p><Link className={styles.button} href={juryHref('/services/new')}>서비스 추가</Link></p>
      ) : (
        <p className={styles.muted}>서비스 추가: 현재 역할에는 이 변경 권한이 없습니다.</p>
      )}
      {rows.length === 0 ? <p>{displayText(SHELL_EMPTY.services)}</p> : (
        <table className={styles.table}>
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
                <td><Link className={styles.inline} href={juryHref(`/services/${row.id}`)}>{row.displayName}</Link></td>
                <td title={row.accessMethod}>{displayText(row.accessMethod)}</td>
                <td><span className={styles.badge} title={row.status}>{userLabel(row.status)}</span></td>
                <td>{row.createdAt}</td>
                <td>{row.updatedAt}</td>
                <td title={row.discoveryStatus}>{displayText(row.discoveryStatus)}</td>
                <td title={row.scopeStatus}>{displayText(row.scopeStatus)}</td>
              </tr>
            ))}
          </tbody>
        </table>
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
            <button className={styles.button} type="submit">Mock Discovery 실행</button>
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
                <button className={styles.button} name="decision" value="APPROVE" type="submit">승인</button>
                <button className={styles.button} name="decision" value="REJECT" type="submit">거부</button>
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
        <h2>Catalog Metric Scope</h2>
        <p className={styles.muted}>Catalog scope 승인: 현재 역할에는 이 변경 권한이 없습니다.</p>
      </>
    );
  }
  return (
    <>
      <h2>Catalog Metric Scope</h2>
      <p className={styles.muted}>Catalog metric만 선택합니다. Discovery placeholder는 승인 대상이 아닙니다.</p>
      {form.connections.map((connection) => (
        <form action={proposeCatalogScope} key={connection.id}>
          <p>{connection.label}</p>
          <input type="hidden" name="connectionId" value={connection.id} />
          <label>
            Metric
            <select className={styles.field} name="metric" defaultValue={form.metrics[0]}>
              {form.metrics.map((metric) => (
                <option key={metric} value={metric}>{metric}</option>
              ))}
            </select>
          </label>
          <button className={styles.button} type="submit">Catalog Scope 제안</button>
        </form>
      ))}
      {form.pending.map((scope) => (
        <form action={decideCatalogScope} key={scope.scopeId}>
          <p>{scope.label}</p>
          <input type="hidden" name="scopeId" value={scope.scopeId} />
          <button className={styles.button} name="decision" value="APPROVE" type="submit">Catalog 승인</button>
          <button className={styles.button} name="decision" value="REJECT" type="submit">Catalog 거부</button>
        </form>
      ))}
    </>
  );
}

export function ReviewsBody({ view }: { view: JuryConsoleView }) {
  return (
    <section className={styles.panel}>
      <div className={styles.pageIntro}>
        <div>
          <p className={styles.eyebrow}>현재 메뉴 · 결과</p>
          <h2 className={styles.pageTitle}>결과</h2>
          <p className={styles.pageDescription}>결론과 주요 문제, 권장 조치를 먼저 확인하세요.</p>
        </div>
        <Link className={styles.secondaryButton} href={juryHref('/evidence')}>새 리뷰 요청</Link>
      </div>
      {view.results.length > 0 ? <TranslationHint /> : null}
      {view.results.length === 0 ? <p>{displayText(SHELL_EMPTY.reviews)}</p> : (
        <table className={styles.table}>
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
              return (
                <tr key={row.id}>
                  <td title={request?.status}>{request?.status ? userLabel(request.status) : displayText(SHELL_UNAVAILABLE)}</td>
                  <td><Link className={styles.inline} href={juryHref(`/reviews/${row.id}`)}>{userLabel(row.expectedDecision)}</Link></td>
                  <td>{row.completedAt}</td>
                  <td title={request?.reviewType}>{request?.reviewType ? userLabel(request.reviewType) : displayText(SHELL_UNAVAILABLE)}</td>
                  <td>{request?.evidenceId ?? displayText(SHELL_UNAVAILABLE)}</td>
                  <td lang="en">{row.finalSurface.statusSummary}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}

export function ReviewDetailBody({ screen, noted }: { screen: ReviewConsoleScreen; noted: boolean }) {
  return (
    <>
      <section className={styles.panel}>
        <p className={styles.eyebrow}>현재 메뉴 · 결과</p>
        <h2 className={styles.pageTitle}>리뷰 결과</h2>
        <div className={styles.resultHighlight}>
          <span className={styles.label}>결론</span>
          <strong>{userLabel(screen.decision)}</strong>
          <p>{screen.decisionMeaning}</p>
        </div>
        <p className={styles.resultSummary} lang={screen.summary ? 'en' : undefined}>{screen.summary || '요약이 없습니다.'}</p>
        <TranslationHint />
        {screen.humanDecision ? <p className={styles.muted}>사용자 확인: {userLabel(screen.humanDecision)}</p> : null}
        <details className={styles.technicalDetails}>
          <summary>기술 정보 보기</summary>
          <div className={styles.row}><span className={styles.label}>Review ID</span><span>{screen.reviewId}</span></div>
          <div className={styles.row}><span className={styles.label}>상태</span><span>{userLabel(screen.status)}</span></div>
          <div className={styles.row}><span className={styles.label}>완료일</span><span>{screen.completedAt}</span></div>
        </details>
      </section>
      <section className={styles.panel}>
        <h2>주요 문제</h2>
        {screen.topProblems.length === 0 ? <p className={styles.muted}>없음</p> : (
          <ul lang="en">{screen.topProblems.map((item) => <li key={item}>{item}</li>)}</ul>
        )}
      </section>
      <section className={styles.panel}>
        <div className={styles.actionPanel}>
          <div>
            <h2>권장 조치</h2>
            <p lang={screen.expectedUserEffect || screen.risk ? 'en' : undefined}>{screen.expectedUserEffect || screen.risk || '추가 조치가 필요하지 않습니다.'}</p>
          </div>
          {screen.humanChoices.length > 0 ? <span className={styles.badge}>확인 필요</span> : null}
        </div>
        <p className={styles.muted}>위험도: <span lang={screen.risk ? 'en' : undefined}>{screen.risk || '특이 사항 없음'}</span></p>
      </section>
      <section className={styles.panel}>
        <details className={styles.technicalDetails}>
          <summary>근거 자세히 보기</summary>
          <h3>측정된 사실</h3>
          <p className={styles.muted}>리뷰 자료</p>
          <div className={styles.row}><span className={styles.label}>Evidence ID</span><span>{screen.evidenceId ?? '없음'}</span></div>
          <Link className={styles.inline} href={juryHref('/evidence')}>리뷰 자료 목록</Link>
          {screen.measured.map((metric) => (
            <div className={styles.row} key={metric.id}>
              <span>{metric.metric}</span>
              <span>{metric.text} ({userLabel(metric.availability)})</span>
            </div>
          ))}
        </details>
      </section>
      <section className={styles.panel}>
        <details className={styles.technicalDetails}>
        <summary>판단 근거 자세히 보기</summary>
        <h2>판단 근거</h2>
        {screen.dimensionEvidence.length === 0 ? <p className={styles.muted}>없음</p> : (
          <ul lang="en">{screen.dimensionEvidence.map((item) => <li key={item}>{item}</li>)}</ul>
        )}
        <p className={styles.muted}>확인된 주장</p>
        {screen.supportedClaims.length === 0 ? <p className={styles.muted}>없음</p> : (
          <ul lang="en">{screen.supportedClaims.map((item) => <li key={item}>{item}</li>)}</ul>
        )}
        </details>
      </section>
      <section className={styles.panel}>
        <details className={styles.technicalDetails}>
        <summary>아직 확인되지 않은 내용</summary>
        <p className={styles.muted}>hypotheses</p>
        {screen.hypotheses.length === 0 ? <p className={styles.muted}>없음</p> : (
          <ul>{screen.hypotheses.map((item) => <li key={item}>{item}</li>)}</ul>
        )}
        <p className={styles.muted}>partiallySupportedClaims</p>
        {screen.partiallySupportedClaims.length === 0 ? <p className={styles.muted}>없음</p> : (
          <ul>{screen.partiallySupportedClaims.map((item) => <li key={item}>{item}</li>)}</ul>
        )}
        </details>
      </section>
      <section className={styles.panel}>
        <h2>다음 행동</h2>
        {noted && screen.humanDecision ? <p className={styles.muted}>Human Decision을 저장했습니다.</p> : null}
        {screen.humanDecision ? <p>선택 완료</p> : null}
        {screen.humanChoices.length > 0 ? (
          <form action={acknowledgeHumanReview}>
            <input type="hidden" name="reviewId" value={screen.reviewId} />
            {screen.humanChoices.map((choice) => (
              <button className={styles.button} key={choice.code} name="action" value={choice.code} type="submit">{choice.label}</button>
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
            <button className={styles.button} type="submit">개선 작업 만들기</button>
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
            {screen.agentExecution.startedAt ? <p>시작: {screen.agentExecution.startedAt}</p> : null}
            {screen.agentExecution.finishedAt ? <p>종료: {screen.agentExecution.finishedAt}</p> : null}
            {screen.agentExecution.summary ? <p>결과 요약: {screen.agentExecution.summary}</p> : null}
            {screen.agentExecution.changedFiles.map((file) => <p key={file}>변경 파일: {file}</p>)}
            {screen.agentExecution.testsRun.map((testName) => <p key={testName}>테스트: {testName}</p>)}
            {screen.agentExecution.testsPassed == null ? null : <p>테스트 통과: {screen.agentExecution.testsPassed ? '예' : '아니오'}</p>}
          </>
        ) : null}
        {screen.canRun && screen.agentExecution ? (
          <form action={runHumanAgentExecution}>
            <input type="hidden" name="agentExecutionId" value={screen.agentExecution.id} />
            <button className={styles.button} type="submit">에이전트 작업 시작</button>
          </form>
        ) : null}
        {screen.canHandoff && screen.improvementTask ? (
          <form action={handoffHumanImprovement}>
            <input type="hidden" name="improvementTaskId" value={screen.improvementTask.id} />
            <button className={styles.button} type="submit">에이전트에 전달</button>
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
          <button className={styles.button} type="submit">에이전트 작업 승인</button>
        </form>
      ) : null}
      {screen.canHandoffReReviewAgent && screen.nextImprovement ? (
        <form action={handoffReReviewImprovement}>
          <input type="hidden" name="improvementTaskId" value={screen.nextImprovement.id} />
          <button className={styles.button} type="submit">에이전트에 전달</button>
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
          {screen.reReview.completedAt ? <p>완료 시각: {screen.reReview.completedAt}</p> : null}
        </>
      ) : null}
      {screen.canRunReReview && screen.agentExecution ? (
        <form action={runHumanReReview}>
          <input type="hidden" name="agentExecutionId" value={screen.agentExecution.id} />
          <button className={styles.button} type="submit">재심사 실행</button>
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
          <button className={styles.button} type="submit">개선 작업 만들기</button>
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
          <button className={styles.button} type="submit">변경 검사 실행</button>
        </form>
      ) : null}
    </section>
  );
}

export function EvidenceBody({ actor, view }: { actor: JuryActor; view: JuryConsoleView }) {
  const form = projectConsoleIntakeForm(actor, view);
  const evidence = projectConsoleEvidence(view);
  return (
    <section className={styles.panel}>
      <div className={styles.pageIntro}>
        <div>
          <p className={styles.eyebrow}>현재 메뉴 · 리뷰 요청</p>
          <h2 className={styles.pageTitle}>리뷰 요청</h2>
          <p className={styles.pageDescription}>서비스를 선택하고 분석 범위를 확인한 뒤 리뷰를 요청하세요.</p>
        </div>
      </div>
      <ol className={styles.stepper} aria-label="리뷰 요청 단계">
        <li className={styles.stepActive}><strong>1</strong><span>서비스 선택</span></li>
        <li><strong>2</strong><span>범위·기간 확인</span></li>
        <li><strong>3</strong><span>요청 완료</span></li>
      </ol>
      <p className={styles.helperText}>승인된 서비스와 리뷰 자료만 표시됩니다. 기술 정보는 필요한 경우에만 자세히 볼 수 있습니다.</p>
      {form.visible ? (
        form.scopes.length === 0 ? (
          <p className={styles.muted}>현재 승인된 Scope에는 입력 가능한 Catalog Metric이 없습니다.</p>
        ) : (
          form.scopes.map((scope) => (
            <form action={submitTenantEvidenceIntake} key={scope.scopeId}>
              <h3>2. 범위와 기간 확인</h3>
              <p className={styles.muted}>선택한 서비스: {scope.label}</p>
              <input type="hidden" name="connectionId" value={scope.connectionId} />
              <input type="hidden" name="scopeId" value={scope.scopeId} />
              <label>
                분석 항목
                <select className={styles.field} name="metric" defaultValue={scope.metrics[0]}>
                  {scope.metrics.map((metric) => (
                    <option key={metric} value={metric}>{metric}</option>
                  ))}
                </select>
              </label>
              <label>
                자료 상태
                <select className={styles.field} name="availability" defaultValue="AVAILABLE">
                  {INTAKE_AVAILABILITY.map((availability) => (
                    <option key={availability} value={availability}>{userLabel(availability)}</option>
                  ))}
                </select>
              </label>
              <label>
                측정값
                <input className={styles.field} name="value" inputMode="decimal" />
              </label>
              <button className={styles.primaryButton} type="submit">리뷰 자료 만들기</button>
            </form>
          ))
        )
      ) : (
        <p className={styles.muted}>Evidence 입력: 현재 역할에는 이 변경 권한이 없습니다.</p>
      )}
      {evidence.length === 0 ? <p>{displayText(SHELL_EMPTY.evidence)}</p> : null}
      {evidence.map((row) => {
        const stored = view.evidence.find((item) => item.id === row.id);
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
            <form action={submitTenantReview}>
              <input type="hidden" name="evidenceId" value={row.id} />
              <input type="hidden" name="reviewType" value="FULL_REVIEW" />
              <button className={styles.primaryButton} type="submit">3. 리뷰 요청하기</button>
            </form>
          ) : null}
        </article>
        );
      })}
    </section>
  );
}

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
      <div className={styles.pageIntro}>
        <div>
          <p className={styles.eyebrow}>현재 메뉴 · 개선</p>
          <h2 className={styles.pageTitle}>개선</h2>
          <p className={styles.pageDescription}>심사 결과에서 나온 개선 작업과 진행 상태를 확인하세요.</p>
        </div>
      </div>
      {rows.length === 0 ? <p>{displayText(SHELL_EMPTY.improvements)}</p> : (
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
                <td><span className={styles.badge} title={task.status}>{userLabel(task.status)}</span></td>
                <td>{task.taskType ?? displayText(SHELL_UNAVAILABLE)}</td>
                <td>{task.diagnosis}</td>
                <td>{task.acceptanceCriteria.join(', ')}</td>
                <td><Link className={styles.inline} href={juryHref(`/reviews/${task.sourceReviewId}`)}>{task.sourceReviewId}</Link></td>
                <td>{task.sourceService ?? displayText(SHELL_UNAVAILABLE)}</td>
                <td title={task.approval ?? undefined}>{task.approval ? userLabel(task.approval) : displayText(SHELL_UNAVAILABLE)}</td>
                <td>
                  {task.agentStatus === 'RUNNING' ? <span>진행 중</span> : null}
                  {task.agentStatus === 'COMPLETED' ? (
                    <>
                      <span>완료</span>
                      <p className={styles.muted}>Mock</p>
                      {summaries[task.id] ? <p>{summaries[task.id]}</p> : null}
                      {task.agentFinishedAt ? <p>{task.agentFinishedAt}</p> : null}
                    </>
                  ) : null}
                  {task.agentStatus === 'BLOCKED' ? <span>중단됨</span> : null}
                  {task.agentStatus === 'PENDING' || !task.agentStatus ? (
                    task.agentStatus === 'PENDING' ? <span>{userLabel('PENDING')}</span> : <span>{task.approval === 'APPROVED' && agentTasks.has(task.id) ? userLabel('READY') : displayText(SHELL_UNAVAILABLE)}</span>
                  ) : null}
                  {canRun && task.approval === 'APPROVED' && task.agentStatus === 'PENDING' && task.agentExecutionId ? (
                    <form action={runHumanAgentExecution}>
                      <input type="hidden" name="agentExecutionId" value={task.agentExecutionId} />
                      <button className={styles.button} type="submit">에이전트 실행 (Mock)</button>
                    </form>
                  ) : null}
                  {task.agentStatus === 'COMPLETED' && task.agentExecutionId && gates[task.agentExecutionId] ? (
                    <>
                      <p>변경 검사</p>
                      {gates[task.agentExecutionId] === 'PENDING' ? <p>대기 중</p> : <p title={gates[task.agentExecutionId]}>{userLabel(gates[task.agentExecutionId])}</p>}
                      {canRun && gates[task.agentExecutionId] === 'PENDING' ? (
                        <form action={runProductChangeGate}>
                          <input type="hidden" name="agentExecutionId" value={task.agentExecutionId} />
                          <button className={styles.button} type="submit">변경 검사 실행</button>
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
                        {reReviews[task.agentExecutionId].completedAt ? <p>{reReviews[task.agentExecutionId].completedAt}</p> : null}
                        {reReviews[task.agentExecutionId].parentReviewResultId ? <p>원래 심사 결과 {reReviews[task.agentExecutionId].parentReviewResultId}</p> : null}
                        {reReviews[task.agentExecutionId].evidenceId ? <p>{reReviews[task.agentExecutionId].evidenceId}</p> : null}
                        {reReviews[task.agentExecutionId].reviewResultId ? (
                          <Link className={styles.inline} href={juryHref(`/reviews/${reReviews[task.agentExecutionId].reviewResultId}`)}>새 심사 결과 열기</Link>
                        ) : null}
                      </>
                    ) : canReview ? (
                      <form action={runProductChangeGateReReview}>
                        <input type="hidden" name="agentExecutionId" value={task.agentExecutionId} />
                        <button className={styles.button} type="submit">재심사 실행</button>
                      </form>
                    ) : null
                  ) : null}
                </td>
                <td>
                  <Link className={styles.inline} href={juryHref(`/improvements/${task.id}`)}>추적 보기</Link>
                  {canHandoff && agentTasks.has(task.id) && task.approval === 'APPROVED' && task.status === 'OPEN' && !task.agentStatus ? (
                    <form action={handoffHumanImprovement}>
                      <input type="hidden" name="improvementTaskId" value={task.id} />
                      <button className={styles.button} type="submit">에이전트에 전달</button>
                    </form>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <WriteControl actor={actor} action="improvement.write" label="개선 Task 작성" returnTo={juryHref('/improvements')} resourceId={view.tasks[0]?.id} />
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
              <p><span className={styles.badge} title={item.status}>{userLabel(item.status)}</span></p>
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
          <span className={styles.muted}>{row.status}</span>
        </div>
      ))}
      <WriteControl actor={actor} action="agent.execute" label="Agent 실행" returnTo={juryHref('/agents')} resourceId={view.executions[0]?.id} />
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
              <span>{cycle.status}</span>
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
          <button className={styles.button} type="submit">자동 Loop 중지</button>
        </form>
      ) : (
        <p className={styles.muted}>자동 Loop 중지: 현재 역할에는 이 변경 권한이 없습니다.</p>
      )}
    </section>
  );
}

export function AuditBody({ view }: { view: JuryConsoleView }) {
  const events = projectAudit(view);
  return (
    <section className={styles.panel}>
      <div className={styles.pageIntro}>
        <div>
          <p className={styles.eyebrow}>현재 메뉴 · 감사 이력</p>
          <h2 className={styles.pageTitle}>감사 이력</h2>
          <p className={styles.pageDescription}>누가 언제 무엇을 했는지 시간순으로 확인하세요. 원래 기록 값은 마우스를 올리면 보입니다.</p>
        </div>
      </div>
      {events.length === 0 ? <p>{displayText(SHELL_EMPTY.audit)}</p> : (
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
                <td>{event.timestamp}</td>
                <td className={styles.identifier} title={event.actor}>{compactIdentifier(event.actor)}</td>
                <td title={event.action}>
                  {auditActionLabel(event.action)}
                  <br />
                  <span className={styles.muted}>{event.action}</span>
                </td>
                <td className={styles.identifier} title={event.resource}>{compactIdentifier(event.resource)}</td>
                <td title={event.status}>{auditActionLabel(event.status)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
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
    <div className={styles.pageIntro}>
      <div>
        <p className={styles.eyebrow}>현재 메뉴 · 관리</p>
        <h2 className={styles.pageTitle}>관리</h2>
        <p className={styles.pageDescription}>서비스 연결, 멤버, 권한, 초대, 보안과 설정을 한 곳에서 관리합니다.</p>
      </div>
    </div>
    <nav className={styles.adminGrid} aria-label="관리 메뉴">
      <Link className={styles.adminCard} href={juryHref('/organization/services')}><strong>서비스 연결</strong><span>연결 상태와 서비스 권한</span></Link>
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
            <option value="OWNER">OWNER</option>
            <option value="ADMIN">ADMIN</option>
            <option value="REVIEWER">REVIEWER</option>
            <option value="DEVELOPER">DEVELOPER</option>
            <option value="VIEWER">VIEWER</option>
          </select>
          <select className={styles.field} name="command" defaultValue="ADD_MEMBER">
            <option value="ADD_MEMBER">추가</option>
            <option value="CHANGE_ROLE">역할 변경</option>
            <option value="REMOVE_MEMBER">제거</option>
          </select>
          <input type="hidden" name="tenantId" value="client-supplied-tenant" />
          <button className={styles.primaryButton} type="submit">
            역할 적용
          </button>
        </form>
      ) : (
        <p className={styles.muted}>Membership 변경: 현재 역할에는 이 변경 권한이 없습니다.</p>
      )}
      <WriteControl actor={actor} action="settings.write" label="조직 설정 변경" returnTo={juryHref('/settings')} />
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
          <button className={styles.button} type="submit">에이전트 실행</button>
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
          <button className={styles.button} type="submit">변경 검사 실행</button>
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
          <button className={styles.button} type="submit">재심사 실행</button>
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
          <button className={styles.button} type="submit">다음 개선 작업</button>
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
          <button className={styles.button} type="submit">에이전트 작업 승인</button>
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
          <button className={styles.button} type="submit">에이전트에 전달</button>
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
          <button className={styles.button} type="submit">변경 검사 실행</button>
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
          <button className={styles.button} type="submit">재심사 실행</button>
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
          <button className={styles.button} type="submit">다음 개선 작업</button>
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
          <button className={styles.button} type="submit">에이전트 작업 승인</button>
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
          <button className={styles.button} type="submit">에이전트에 전달</button>
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
          <button className={styles.button} type="submit">에이전트 실행</button>
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
          <button className={styles.button} type="submit">변경 검사 실행</button>
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
          <button className={styles.button} type="submit">재심사 실행</button>
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
