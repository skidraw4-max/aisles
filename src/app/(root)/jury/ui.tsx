import Link from 'next/link';
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
import type { JuryMembership } from '@/lib/jury-product/records';
import styles from './jury.module.css';

const GATE_COPY: Record<Exclude<JuryActor, { ok: true }>['reason'], string> = {
  UNAUTHENTICATED: '로그인한 뒤 Jury membership이 있는 계정으로 다시 열어야 합니다.',
  NO_MEMBERSHIP: '이 사용자에게 연결된 Jury membership이 없습니다. 관리자 권한만으로는 tenant에 들어갈 수 없습니다.',
  AMBIGUOUS_MEMBERSHIP: '이 사용자에게 membership이 둘 이상입니다. 클라이언트가 tenant를 고르지 않으며, 서버에 활성 membership이 하나일 때만 엽니다.',
  STORE_UNAVAILABLE: 'Jury 저장소가 아직 준비되지 않았습니다. migration을 적용하기 전에는 tenant 데이터를 열지 않습니다.',
};

export async function JuryChrome({
  actor,
  notice,
  children,
}: {
  actor: JuryActor;
  notice?: string;
  children: React.ReactNode;
}) {
  const identity = actor.ok ? await loadShellIdentity(actor) : null;
  return (
    <div className={styles.wrap}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>AIsles Jury</h1>
          <p className={styles.lead}>
            제품 Console. 기존 운영위원회 화면과는 별도이며, 품질 판정은 v9.x Final Comparator 필드만 표시합니다.
          </p>
        </div>
        {actor.ok ? (
          <div className={styles.identity}>
            <p className={styles.muted}>
              tenant <strong>{identity?.tenantName ?? SHELL_UNAVAILABLE}</strong>
              {' · '}
              user <strong>{identity?.userLabel ?? SHELL_UNAVAILABLE}</strong>
              {' · '}
              role <span className={styles.badge}>{actor.role}</span>
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
          <h2>Unauthorized</h2>
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
  return `${metric}: ${shown} (${availability})${scored ? '' : ' · v9.x 품질 판정 밖'}`;
}

export function DashboardBody({ view }: { view: JuryConsoleView }) {
  const board = projectDashboard(view);
  if (!board.available) {
    return (
      <section className={styles.panel} role="alert">
        <h2>Dashboard</h2>
        <p>{SHELL_UNAVAILABLE}</p>
      </section>
    );
  }
  return (
    <>
      <h2 className={styles.pageTitle}>Dashboard</h2>
      <div className={styles.cards}>
        <section className={styles.panel}>
          <h2>Connected Services</h2>
          <p className={styles.metric}>{board.services}</p>
        </section>
        <section className={styles.panel}>
          <h2>Evidence</h2>
          <p className={styles.metric}>{board.evidence}</p>
        </section>
        <section className={styles.panel}>
          <h2>Reviews</h2>
          <p className={styles.metric}>{board.reviews}</p>
          <p className={styles.muted}>{board.reviewDetail}</p>
        </section>
        <section className={styles.panel}>
          <h2>Improvements</h2>
          <p className={styles.metric}>{board.openImprovements}</p>
          <p className={styles.muted}>OPEN · {board.activeImprovements} in progress</p>
        </section>
      </div>
      <section className={styles.panel}>
        <h2>Recent Activity</h2>
        {board.activity.length === 0 ? <p>{SHELL_EMPTY.audit}</p> : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>timestamp</th>
                <th>actor</th>
                <th>action</th>
                <th>resource</th>
                <th>status</th>
              </tr>
            </thead>
            <tbody>
              {board.activity.map((event) => (
                <tr key={event.id}>
                  <td>{event.timestamp}</td>
                  <td>{event.actor}</td>
                  <td>{event.action}</td>
                  <td>{event.resource}</td>
                  <td>{event.status}</td>
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
      <h2 className={styles.pageTitle}>Services</h2>
      {canShowWrite(actor, 'connection.write') ? (
        <p><Link className={styles.button} href="/jury/services/new">Add Service</Link></p>
      ) : (
        <p className={styles.muted}>Add Service: 현재 역할에는 이 변경 권한이 없습니다.</p>
      )}
      {rows.length === 0 ? <p>{SHELL_EMPTY.services}</p> : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Service Name</th>
              <th>Connection Type</th>
              <th>Status</th>
              <th>Created At</th>
              <th>Updated At</th>
              <th>Discovery Status</th>
              <th>Scope Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td><Link className={styles.inline} href={`/jury/services/${row.id}`}>{row.displayName}</Link></td>
                <td>{row.accessMethod}</td>
                <td><span className={styles.badge}>{row.status}</span></td>
                <td>{row.createdAt}</td>
                <td>{row.updatedAt}</td>
                <td>{row.discoveryStatus}</td>
                <td>{row.scopeStatus}</td>
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
      <h2>Discovery</h2>
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
      <h2>Reviews</h2>
      {view.results.length === 0 ? <p>{SHELL_EMPTY.reviews}</p> : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>status</th>
              <th>decision</th>
              <th>completedAt</th>
              <th>review type</th>
              <th>evidence</th>
              <th>summary</th>
            </tr>
          </thead>
          <tbody>
            {view.results.map((row) => {
              const request = view.requests.find((item) => item.id === row.reviewRequestId) ?? null;
              return (
                <tr key={row.id}>
                  <td>{request?.status ?? SHELL_UNAVAILABLE}</td>
                  <td><Link className={styles.inline} href={`/jury/reviews/${row.id}`}>{row.expectedDecision}</Link></td>
                  <td>{row.completedAt}</td>
                  <td>{request?.reviewType ?? SHELL_UNAVAILABLE}</td>
                  <td>{request?.evidenceId ?? SHELL_UNAVAILABLE}</td>
                  <td>{row.finalSurface.statusSummary}</td>
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
        <h2>Jury Review</h2>
        <div className={styles.row}><span className={styles.label}>Review ID</span><span>{screen.reviewId}</span></div>
        <div className={styles.row}><span className={styles.label}>Status</span><span>{screen.status ?? '없음'}</span></div>
        <div className={styles.row}><span className={styles.label}>completedAt</span><span>{screen.completedAt}</span></div>
      </section>
      <section className={styles.panel}>
        <h2>Decision</h2>
        <p>Jury Decision: {screen.decision}</p>
        <p className={styles.muted}>{screen.decisionMeaning}</p>
        {screen.humanDecision ? <p>Human Decision: {screen.humanDecision}</p> : null}
      </section>
      <section className={styles.panel}>
        <h2>Summary</h2>
        <p>{screen.summary || '없음'}</p>
      </section>
      <section className={styles.panel}>
        <h2>Top Problems</h2>
        {screen.topProblems.length === 0 ? <p className={styles.muted}>없음</p> : (
          <ul>{screen.topProblems.map((item) => <li key={item}>{item}</li>)}</ul>
        )}
      </section>
      <section className={styles.panel}>
        <h2>Expected User Effect</h2>
        <p>{screen.expectedUserEffect || '없음'}</p>
      </section>
      <section className={styles.panel}>
        <h2>Risk</h2>
        <p>{screen.risk || '없음'}</p>
      </section>
      <section className={styles.panel}>
        <h2>측정된 사실</h2>
        <p className={styles.muted}>Evidence</p>
        <div className={styles.row}><span className={styles.label}>Evidence ID</span><span>{screen.evidenceId ?? '없음'}</span></div>
        <Link className={styles.inline} href="/jury/evidence">Evidence 목록</Link>
        {screen.measured.map((metric) => (
          <div className={styles.row} key={metric.id}>
            <span>{metric.metric}</span>
            <span>{metric.text} ({metric.availability})</span>
          </div>
        ))}
      </section>
      <section className={styles.panel}>
        <h2>Jury 판단</h2>
        <p className={styles.muted}>dimensionEvidence</p>
        {screen.dimensionEvidence.length === 0 ? <p className={styles.muted}>없음</p> : (
          <ul>{screen.dimensionEvidence.map((item) => <li key={item}>{item}</li>)}</ul>
        )}
        <p className={styles.muted}>supportedClaims</p>
        {screen.supportedClaims.length === 0 ? <p className={styles.muted}>없음</p> : (
          <ul>{screen.supportedClaims.map((item) => <li key={item}>{item}</li>)}</ul>
        )}
      </section>
      <section className={styles.panel}>
        <h2>아직 확인되지 않은 내용</h2>
        <p className={styles.muted}>hypotheses</p>
        {screen.hypotheses.length === 0 ? <p className={styles.muted}>없음</p> : (
          <ul>{screen.hypotheses.map((item) => <li key={item}>{item}</li>)}</ul>
        )}
        <p className={styles.muted}>partiallySupportedClaims</p>
        {screen.partiallySupportedClaims.length === 0 ? <p className={styles.muted}>없음</p> : (
          <ul>{screen.partiallySupportedClaims.map((item) => <li key={item}>{item}</li>)}</ul>
        )}
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
        {screen.improvementTask ? <p>Improvement Task Created</p> : null}
        {screen.canCreateImprovement ? (
          <form action={createHumanImprovementTask}>
            <input type="hidden" name="reviewId" value={screen.reviewId} />
            <button className={styles.button} type="submit">Create Improvement Task</button>
          </form>
        ) : null}
        {screen.agentExecution ? (
          <>
            <p>AgentExecution</p>
            <p>Status: {screen.agentExecution.status}</p>
            <p>Provider: {screen.agentExecution.agent}</p>
            {screen.agentExecution.status === 'RUNNING' ? <p>Running</p> : null}
            {screen.agentExecution.status === 'COMPLETED' ? <p>Completed</p> : null}
            {screen.agentExecution.status === 'BLOCKED' ? <p>Blocked</p> : null}
            {screen.agentExecution.startedAt ? <p>Started: {screen.agentExecution.startedAt}</p> : null}
            {screen.agentExecution.finishedAt ? <p>Finished: {screen.agentExecution.finishedAt}</p> : null}
            {screen.agentExecution.summary ? <p>Result summary: {screen.agentExecution.summary}</p> : null}
            {screen.agentExecution.changedFiles.map((file) => <p key={file}>Changed file: {file}</p>)}
            {screen.agentExecution.testsRun.map((testName) => <p key={testName}>Test: {testName}</p>)}
            {screen.agentExecution.testsPassed == null ? null : <p>Tests passed: {screen.agentExecution.testsPassed ? 'yes' : 'no'}</p>}
          </>
        ) : null}
        {screen.canRun && screen.agentExecution ? (
          <form action={runHumanAgentExecution}>
            <input type="hidden" name="agentExecutionId" value={screen.agentExecution.id} />
            <button className={styles.button} type="submit">Start Agent Execution</button>
          </form>
        ) : null}
        {screen.canHandoff && screen.improvementTask ? (
          <form action={handoffHumanImprovement}>
            <input type="hidden" name="improvementTaskId" value={screen.improvementTask.id} />
            <button className={styles.button} type="submit">Send to Agent</button>
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
      <h2>Agent Handoff</h2>
      {screen.nextApproval ? <p>Human Approval: {screen.nextApproval}</p> : null}
      {screen.canApproveReReviewAgent && screen.nextImprovement ? (
        <form action={approveReReviewAgentAction}>
          <input type="hidden" name="improvementTaskId" value={screen.nextImprovement.id} />
          <button className={styles.button} type="submit">Approve for Agent</button>
        </form>
      ) : null}
      {screen.canHandoffReReviewAgent && screen.nextImprovement ? (
        <form action={handoffReReviewImprovement}>
          <input type="hidden" name="improvementTaskId" value={screen.nextImprovement.id} />
          <button className={styles.button} type="submit">Send to Agent</button>
        </form>
      ) : null}
      {execution?.status === 'PENDING' ? <p>Agent Pending</p> : null}
      {execution && execution.status !== 'PENDING' ? <p>Status: {execution.status}</p> : null}
    </section>
  );
}

export function HumanReReviewBody({ screen }: { screen: ReviewConsoleScreen }) {
  return (
    <section className={styles.panel}>
      <h2>Re-review</h2>
      <p>Original Review: {screen.reviewId}</p>
      {screen.reReview ? (
        <>
          <p>Re-review: {screen.reReview.status}</p>
          {screen.reReview.reviewResultId ? <p>ReviewResult: {screen.reReview.reviewResultId}</p> : null}
          {screen.reReview.decision ? <p>Decision: {screen.reReview.decision}</p> : null}
          {screen.reReview.completedAt ? <p>completedAt: {screen.reReview.completedAt}</p> : null}
        </>
      ) : null}
      {screen.canRunReReview && screen.agentExecution ? (
        <form action={runHumanReReview}>
          <input type="hidden" name="agentExecutionId" value={screen.agentExecution.id} />
          <button className={styles.button} type="submit">Run Re-review</button>
        </form>
      ) : null}
      {screen.reReview?.decision === 'ACCEPT' ? <p>No improvement required</p> : null}
      {screen.nextImprovement ? (
        <>
          <p>Next Improvement Task</p>
          <p>Task: {screen.nextImprovement.id}</p>
          <p>Type: {screen.nextImprovement.taskType}</p>
          <p>Status: {screen.nextImprovement.status}</p>
        </>
      ) : null}
      {screen.canCreateReReviewImprovement && screen.reReview?.reviewResultId ? (
        <form action={createReReviewImprovementTask}>
          <input type="hidden" name="reReviewResultId" value={screen.reReview.reviewResultId} />
          <button className={styles.button} type="submit">Create Improvement Task</button>
        </form>
      ) : null}
    </section>
  );
}

export function HumanChangeGateBody({ screen }: { screen: ReviewConsoleScreen }) {
  return (
    <section className={styles.panel}>
      <h2>Change Gate</h2>
      {screen.changeGate ? (
        <>
          <p>Change Gate: {screen.changeGate.status}</p>
          {screen.changeGate.errorCode ? <p>Reason: {screen.changeGate.errorCode}</p> : null}
          {screen.changeGate.discrepancy ? <p>Discrepancy</p> : null}
          {screen.changeGate.reasons.map((reason) => <p key={reason}>{reason}</p>)}
        </>
      ) : null}
      {screen.canRunChangeGate && screen.agentExecution ? (
        <form action={runHumanChangeGate}>
          <input type="hidden" name="agentExecutionId" value={screen.agentExecution.id} />
          <button className={styles.button} type="submit">Run Change Gate</button>
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
      <h2>Evidence</h2>
      {form.visible ? (
        form.scopes.length === 0 ? (
          <p className={styles.muted}>현재 승인된 Scope에는 입력 가능한 Catalog Metric이 없습니다.</p>
        ) : (
          form.scopes.map((scope) => (
            <form action={submitTenantEvidenceIntake} key={scope.scopeId}>
              <p>Scope: {scope.label}</p>
              <input type="hidden" name="connectionId" value={scope.connectionId} />
              <input type="hidden" name="scopeId" value={scope.scopeId} />
              <label>
                Metric
                <select className={styles.field} name="metric" defaultValue={scope.metrics[0]}>
                  {scope.metrics.map((metric) => (
                    <option key={metric} value={metric}>{metric}</option>
                  ))}
                </select>
              </label>
              <label>
                Availability
                <select className={styles.field} name="availability" defaultValue="AVAILABLE">
                  {INTAKE_AVAILABILITY.map((availability) => (
                    <option key={availability} value={availability}>{availability}</option>
                  ))}
                </select>
              </label>
              <label>
                Value
                <input className={styles.field} name="value" inputMode="decimal" />
              </label>
              <button className={styles.button} type="submit">Create Evidence</button>
            </form>
          ))
        )
      ) : (
        <p className={styles.muted}>Evidence 입력: 현재 역할에는 이 변경 권한이 없습니다.</p>
      )}
      {evidence.length === 0 ? <p>{SHELL_EMPTY.evidence}</p> : null}
      {evidence.map((row) => {
        const stored = view.evidence.find((item) => item.id === row.id);
        return (
        <article key={row.id}>
          <div className={styles.row}><span className={styles.label}>Evidence ID</span><span>{row.id}</span></div>
          <div className={styles.row}><span className={styles.label}>purpose</span><span>{row.purpose}</span></div>
          <div className={styles.row}><span className={styles.label}>period</span><span>{row.periodStart} – {row.periodEnd}</span></div>
          <div className={styles.row}><span className={styles.label}>timezone</span><span>{stored?.timezone ?? SHELL_UNAVAILABLE}</span></div>
          <div className={styles.row}><span className={styles.label}>adapter</span><span>{stored?.adapterKey ?? SHELL_UNAVAILABLE}</span></div>
          <div className={styles.row}><span className={styles.label}>content hash</span><span>{stored?.contentHash ?? SHELL_UNAVAILABLE}</span></div>
          <div className={styles.row}><span className={styles.label}>readOnly</span><span>{stored?.readOnly === true ? 'true' : stored?.readOnly === false ? 'false' : SHELL_UNAVAILABLE}</span></div>
          <div className={styles.row}><span className={styles.label}>piiExcluded</span><span>{stored?.piiExcluded === true ? 'true' : stored?.piiExcluded === false ? 'false' : SHELL_UNAVAILABLE}</span></div>
          <div className={styles.row}><span className={styles.label}>metric count</span><span>{row.metricCount}</span></div>
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
              <button className={styles.button} type="submit">Run Jury Review</button>
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
  return (
    <section className={styles.panel}>
      <h2>Improvements</h2>
      {rows.length === 0 ? <p>{SHELL_EMPTY.improvements}</p> : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>status</th>
              <th>task type</th>
              <th>diagnosis</th>
              <th>acceptance criteria</th>
              <th>source review</th>
              <th>source service</th>
              <th>approval</th>
              <th>agent</th>
              <th>provenance</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((task) => (
              <tr key={task.id}>
                <td><span className={styles.badge}>{task.status}</span></td>
                <td>{task.taskType ?? SHELL_UNAVAILABLE}</td>
                <td>{task.diagnosis}</td>
                <td>{task.acceptanceCriteria.join(', ')}</td>
                <td><Link className={styles.inline} href={`/jury/reviews/${task.sourceReviewId}`}>{task.sourceReviewId}</Link></td>
                <td>{task.sourceService ?? SHELL_UNAVAILABLE}</td>
                <td>{task.approval ?? SHELL_UNAVAILABLE}</td>
                <td>
                  {task.agentStatus === 'RUNNING' ? <span>Running</span> : null}
                  {task.agentStatus === 'COMPLETED' ? (
                    <>
                      <span>Completed</span>
                      <p className={styles.muted}>Mock</p>
                      {summaries[task.id] ? <p>{summaries[task.id]}</p> : null}
                      {task.agentFinishedAt ? <p>{task.agentFinishedAt}</p> : null}
                    </>
                  ) : null}
                  {task.agentStatus === 'BLOCKED' ? <span>Blocked</span> : null}
                  {task.agentStatus === 'PENDING' || !task.agentStatus ? (
                    task.agentStatus === 'PENDING' ? <span>PENDING</span> : <span>{task.approval === 'APPROVED' ? 'READY' : SHELL_UNAVAILABLE}</span>
                  ) : null}
                  {canRun && task.approval === 'APPROVED' && task.agentStatus === 'PENDING' && task.agentExecutionId ? (
                    <form action={runHumanAgentExecution}>
                      <input type="hidden" name="agentExecutionId" value={task.agentExecutionId} />
                      <button className={styles.button} type="submit">Run Agent (Mock)</button>
                    </form>
                  ) : null}
                  {task.agentStatus === 'COMPLETED' && task.agentExecutionId && gates[task.agentExecutionId] ? (
                    <>
                      <p>Change Gate</p>
                      {gates[task.agentExecutionId] === 'PENDING' ? <p>Pending</p> : <p>{gates[task.agentExecutionId]}</p>}
                      {canRun && gates[task.agentExecutionId] === 'PENDING' ? (
                        <form action={runProductChangeGate}>
                          <input type="hidden" name="agentExecutionId" value={task.agentExecutionId} />
                          <button className={styles.button} type="submit">Run Change Gate</button>
                        </form>
                      ) : null}
                    </>
                  ) : null}
                  {task.agentStatus === 'COMPLETED' && task.agentExecutionId && gates[task.agentExecutionId] === 'APPROVED' ? (
                    reReviews[task.agentExecutionId] ? (
                      <>
                        <p>Re-review</p>
                        <p>{reReviews[task.agentExecutionId].status}</p>
                        {reReviews[task.agentExecutionId].decision ? <p>New review {reReviews[task.agentExecutionId].decision}</p> : null}
                        {reReviews[task.agentExecutionId].completedAt ? <p>{reReviews[task.agentExecutionId].completedAt}</p> : null}
                        {reReviews[task.agentExecutionId].parentReviewResultId ? <p>Original review {reReviews[task.agentExecutionId].parentReviewResultId}</p> : null}
                        {reReviews[task.agentExecutionId].evidenceId ? <p>{reReviews[task.agentExecutionId].evidenceId}</p> : null}
                        {reReviews[task.agentExecutionId].reviewResultId ? (
                          <Link className={styles.inline} href={`/jury/reviews/${reReviews[task.agentExecutionId].reviewResultId}`}>Open new review</Link>
                        ) : null}
                      </>
                    ) : canReview ? (
                      <form action={runProductChangeGateReReview}>
                        <input type="hidden" name="agentExecutionId" value={task.agentExecutionId} />
                        <button className={styles.button} type="submit">Run Re-review</button>
                      </form>
                    ) : null
                  ) : null}
                </td>
                <td>
                  <Link className={styles.inline} href={`/jury/improvements/${task.id}`}>Open trace</Link>
                  {canHandoff && task.approval === 'APPROVED' && task.status === 'OPEN' && !task.agentStatus ? (
                    <form action={handoffHumanImprovement}>
                      <input type="hidden" name="improvementTaskId" value={task.id} />
                      <button className={styles.button} type="submit">Send to Agent</button>
                    </form>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <WriteControl actor={actor} action="improvement.write" label="개선 Task 작성" returnTo="/jury/improvements" resourceId={view.tasks[0]?.id} />
    </section>
  );
}

export function ImprovementTraceBody({ trace }: { trace: ImprovementTrace }) {
  const screen = projectImprovementTrace(trace);
  const lineage = projectTraceLineage(trace);
  return (
    <>
      <section className={styles.panel}>
        <h2>Lineage</h2>
        {lineage.map((step) => (
          <div className={styles.row} key={step.label}>
            <span className={styles.label}>{step.label}</span>
            <span>{step.value}</span>
          </div>
        ))}
      </section>
      <section className={styles.panel}>
        <h2>Improvement</h2>
        {screen.summary.map((line) => (
          <div className={styles.row} key={line.label}>
            <span className={styles.label}>{line.label}</span>
            <span>{line.value}</span>
          </div>
        ))}
      </section>
      <section className={styles.panel}>
        <h2>Objective</h2>
        <p>{screen.objective ?? '목표 없음'}</p>
        <ul>
          {screen.constraints.map((item) => <li key={item}>{item}</li>)}
        </ul>
      </section>
      <section className={styles.panel}>
        <h2>Timeline</h2>
        <div className={styles.timeline}>
          {screen.timeline.map((item) => (
            <article key={item.key}>
              <h3>{item.title}</h3>
              <p><span className={styles.badge}>{item.status}</span></p>
              {item.lines.map((line) => (
                <div className={styles.row} key={`${item.key}-${line.label}`}>
                  <span className={styles.label}>{line.label}</span>
                  <span>{line.value}</span>
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
      <h2>Agents</h2>
      {view.executions.map((row) => (
        <div className={styles.row} key={row.id}>
          <span>{row.agent}</span>
          <span className={styles.muted}>{row.status}</span>
        </div>
      ))}
      <WriteControl actor={actor} action="agent.execute" label="Agent 실행" returnTo="/jury/agents" resourceId={view.executions[0]?.id} />
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
      <h2>Automation</h2>
      <p className={styles.muted}>한도는 저장된 Loop Guard입니다. 이 화면은 자동 Loop를 켜지 않습니다.</p>
      {loop ? (
        <>
          <div className={styles.row}><span className={styles.label}>enabled</span><span>{loop.enabled ? '켜짐' : '꺼짐'}</span></div>
          <div className={styles.row}><span className={styles.label}>mode</span><span>{loop.mode}</span></div>
          <div className={styles.row}><span className={styles.label}>중단 이유</span><span>{loop.stopReason ?? '없음'}</span></div>
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
      <h2>Audit</h2>
      {events.length === 0 ? <p>{SHELL_EMPTY.audit}</p> : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>timestamp</th>
              <th>actor</th>
              <th>action</th>
              <th>resource</th>
              <th>status</th>
            </tr>
          </thead>
          <tbody>
            {events.map((event) => (
              <tr key={event.id}>
                <td>{event.timestamp}</td>
                <td>{event.actor}</td>
                <td>{event.action}</td>
                <td>{event.resource}</td>
                <td>{event.status}</td>
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
    <section className={styles.panel}>
      <h2>Tenant</h2>
      <div className={styles.row}><span className={styles.label}>name</span><span>{tenantName ?? SHELL_UNAVAILABLE}</span></div>
      <div className={styles.row}><span className={styles.label}>identifier</span><span>{view.tenantId}</span></div>
    </section>
    <section className={styles.panel}>
      <h2>Members</h2>
      <p className={styles.muted}>OWNER만 membership을 추가, 변경, 제거할 수 있습니다. 마지막 OWNER는 남깁니다. MEMBER는 Review 시작과 개선 Task까지이고, AUDITOR는 조회만 합니다.</p>
      {members.map((row) => (
        <div className={styles.row} key={row.id}>
          <span>{row.role}</span>
          <span className={styles.muted}>{row.userId}</span>
        </div>
      ))}
      {canShowWrite(actor, 'membership.write') ? (
        <form action={changeJuryMembership}>
          <input className={styles.field} name="targetUserId" placeholder="대상 user id" required />
          <select className={styles.field} name="role" defaultValue="MEMBER">
            <option value="OWNER">OWNER</option>
            <option value="MEMBER">MEMBER</option>
            <option value="AUDITOR">AUDITOR</option>
          </select>
          <select className={styles.field} name="command" defaultValue="ADD_MEMBER">
            <option value="ADD_MEMBER">추가</option>
            <option value="CHANGE_ROLE">역할 변경</option>
            <option value="REMOVE_MEMBER">제거</option>
          </select>
          <input type="hidden" name="tenantId" value="client-supplied-tenant" />
          <button className={styles.button} type="submit">
            Membership 적용
          </button>
        </form>
      ) : (
        <p className={styles.muted}>Membership 변경: 현재 역할에는 이 변경 권한이 없습니다.</p>
      )}
      <WriteControl actor={actor} action="settings.write" label="설정 변경" returnTo="/jury/settings" />
    </section>
    <section className={styles.panel}>
      <h2>Permissions</h2>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>permission</th>
            <th>status</th>
          </tr>
        </thead>
        <tbody>
          {JURY_ACTIONS.map((action) => (
            <tr key={action}>
              <td>{action}</td>
              <td>{canShowWrite(actor, action) ? 'Allowed' : 'Not granted'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
    <section className={styles.panel}>
      <h2>Automation</h2>
      <p className={styles.muted}>저장된 Loop Guard만 보여 줍니다. 이 화면은 Automation을 바꾸지 않습니다.</p>
      <div className={styles.row}><span className={styles.label}>enabled</span><span>{loop ? (loop.enabled ? '켜짐' : '꺼짐') : SHELL_UNAVAILABLE}</span></div>
      <div className={styles.row}><span className={styles.label}>mode</span><span>{loop?.mode ?? SHELL_UNAVAILABLE}</span></div>
      <div className={styles.row}><span className={styles.label}>maxIterations</span><span>{view.loopPolicy.maxIterations ?? SHELL_UNAVAILABLE}</span></div>
      <div className={styles.row}><span className={styles.label}>maxRuntimeMs</span><span>{view.loopPolicy.maxRuntimeMs ?? SHELL_UNAVAILABLE}</span></div>
      <div className={styles.row}><span className={styles.label}>maxCostUsd</span><span>{view.loopPolicy.maxCostUsd ?? SHELL_UNAVAILABLE}</span></div>
      <p><Link className={styles.inline} href="/jury/automation">Automation status</Link></p>
      <p><Link className={styles.inline} href="/jury/discovery">Discovery</Link></p>
      <p><Link className={styles.inline} href="/jury/agents">Agents</Link></p>
    </section>
    </>
  );
}

export function ReReviewAgentRunBody({ screen }: { screen: ReviewConsoleScreen }) {
  const execution = screen.nextAgentExecution;
  return (
    <section className={styles.panel}>
      <h2>Second Iteration</h2>
      {screen.canRunReReviewAgent && execution ? (
        <form action={runReReviewAgentExecution}>
          <input type="hidden" name="agentExecutionId" value={execution.id} />
          <button className={styles.button} type="submit">Run Agent</button>
        </form>
      ) : null}
      {execution?.status === 'RUNNING' ? <p>Agent Running</p> : null}
      {execution?.status === 'COMPLETED' ? <p>Agent Completed</p> : null}
    </section>
  );
}

export function ReReviewChangeGateBody({ screen }: { screen: ReviewConsoleScreen }) {
  const execution = screen.nextAgentExecution;
  const gate = screen.nextChangeGate;
  return (
    <section className={styles.panel}>
      <h2>Second Change Gate</h2>
      {screen.canRunReReviewChangeGate && execution ? (
        <form action={runReReviewChangeGate}>
          <input type="hidden" name="agentExecutionId" value={execution.id} />
          <button className={styles.button} type="submit">Run Change Gate</button>
        </form>
      ) : null}
      {gate?.status === 'APPROVED' ? <p>Change Gate: APPROVED</p> : null}
      {gate?.status === 'GATED' ? <p>Change Gate: GATED</p> : null}
      {gate?.status === 'BLOCKED' ? <p>Change Gate: BLOCKED</p> : null}
    </section>
  );
}

export function SecondReReviewBody({ screen }: { screen: ReviewConsoleScreen }) {
  const execution = screen.nextAgentExecution;
  const review = screen.nextSecondReReview;
  return (
    <section className={styles.panel}>
      <h2>Second Re-review</h2>
      {screen.canRunSecondReReview && execution ? (
        <form action={runSecondReReview}>
          <input type="hidden" name="agentExecutionId" value={execution.id} />
          <button className={styles.button} type="submit">Run Re-review</button>
        </form>
      ) : null}
      {review?.status === 'RUNNING' ? <p>Re-review Running</p> : null}
      {review?.status === 'EXECUTED' ? <p>Re-review Completed</p> : null}
    </section>
  );
}

export function SecondImprovementBody({ screen }: { screen: ReviewConsoleScreen }) {
  const task = screen.nextSecondImprovement;
  return (
    <section className={styles.panel}>
      <h2>Next Improvement</h2>
      {screen.secondReReviewDecision === 'ACCEPT' ? <p>No further improvement required</p> : null}
      {task ? (
        <>
          <p>Next Improvement Task</p>
          <p>Task: {task.id}</p>
          <p>Type: {task.taskType}</p>
          <p>Status: {task.status}</p>
        </>
      ) : null}
      {screen.canCreateSecondImprovement && screen.secondReReviewResultId ? (
        <form action={createSecondReReviewImprovementTask}>
          <input type="hidden" name="reReviewResultId" value={screen.secondReReviewResultId} />
          <button className={styles.button} type="submit">Next Improvement Task</button>
        </form>
      ) : null}
    </section>
  );
}

export function SecondImprovementApprovalBody({ screen }: { screen: ReviewConsoleScreen }) {
  const task = screen.nextSecondImprovement;
  return (
    <section className={styles.panel}>
      <h2>Second Approval</h2>
      {screen.nextSecondApproval ? <p>Approved for Agent</p> : null}
      {screen.nextSecondApproval ? <p>Human Approval: {screen.nextSecondApproval}</p> : null}
      {screen.canApproveSecondImprovement && task ? (
        <form action={approveSecondImprovementTask}>
          <input type="hidden" name="improvementTaskId" value={task.id} />
          <button className={styles.button} type="submit">Approve for Agent</button>
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
      <h2>Second Handoff</h2>
      {execution?.status === 'PENDING' ? <p>Agent Pending</p> : null}
      {screen.canHandoffSecondImprovement && task ? (
        <form action={handoffSecondImprovementTask}>
          <input type="hidden" name="improvementTaskId" value={task.id} />
          <button className={styles.button} type="submit">Send to Agent</button>
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
      <h2>Completed Change Gate</h2>
      {execution?.status === 'COMPLETED' ? <p>Agent Completed</p> : null}
      {screen.canRunSecondChangeGate && execution ? (
        <form action={runSecondChangeGate}>
          <input type="hidden" name="agentExecutionId" value={execution.id} />
          <button className={styles.button} type="submit">Run Change Gate</button>
        </form>
      ) : null}
      {gate?.status === 'APPROVED' ? <p>Change Gate: APPROVED</p> : null}
      {gate?.status === 'GATED' ? <p>Change Gate: GATED</p> : null}
      {gate?.status === 'BLOCKED' ? <p>Change Gate: BLOCKED</p> : null}
    </section>
  );
}

export function LaterReReviewBody({ screen }: { screen: ReviewConsoleScreen }) {
  const execution = screen.nextSecondAgentExecution;
  const review = screen.nextLaterReReview;
  return (
    <section className={styles.panel}>
      <h2>Later Re-review</h2>
      {screen.canRunLaterReReview && execution ? (
        <form action={runLaterReReview}>
          <input type="hidden" name="agentExecutionId" value={execution.id} />
          <button className={styles.button} type="submit">Run Re-review</button>
        </form>
      ) : null}
      {review?.status === 'EXECUTED' ? <p>Second Re-review Result</p> : null}
      {review?.decision ? <p>Decision: {review.decision}</p> : null}
    </section>
  );
}

export function LaterImprovementBody({ screen }: { screen: ReviewConsoleScreen }) {
  const task = screen.nextLaterImprovement;
  const review = screen.nextLaterReReview;
  return (
    <section className={styles.panel}>
      <h2>Later Improvement</h2>
      {review?.status === 'EXECUTED' && review.decision === 'ACCEPT' ? <p>No Improvement</p> : null}
      {task ? (
        <>
          <p>Next Improvement Task</p>
          <p>Task: {task.id}</p>
          <p>Type: {task.taskType}</p>
          <p>Status: {task.status}</p>
        </>
      ) : null}
      {screen.canCreateLaterImprovement && review?.reviewResultId ? (
        <form action={createLaterReReviewImprovementTask}>
          <input type="hidden" name="reReviewResultId" value={review.reviewResultId} />
          <button className={styles.button} type="submit">Next Improvement Task</button>
        </form>
      ) : null}
    </section>
  );
}

export function LaterImprovementApprovalBody({ screen }: { screen: ReviewConsoleScreen }) {
  const task = screen.nextLaterImprovement;
  return (
    <section className={styles.panel}>
      <h2>Later Approval</h2>
      {screen.nextLaterApproval ? <p>Approved for Agent</p> : null}
      {screen.nextLaterApproval ? <p>Human Approval: {screen.nextLaterApproval}</p> : null}
      {screen.canApproveLaterImprovement && task ? (
        <form action={approveLaterImprovementTask}>
          <input type="hidden" name="improvementTaskId" value={task.id} />
          <button className={styles.button} type="submit">Approve for Agent</button>
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
      <h2>Later Handoff</h2>
      {execution?.status === 'PENDING' ? <p>Agent Pending</p> : null}
      {screen.canHandoffLaterImprovement && task ? (
        <form action={handoffLaterImprovementTask}>
          <input type="hidden" name="improvementTaskId" value={task.id} />
          <button className={styles.button} type="submit">Send to Agent</button>
        </form>
      ) : null}
    </section>
  );
}

export function LaterAgentRunBody({ screen }: { screen: ReviewConsoleScreen }) {
  const execution = screen.nextLaterAgentExecution;
  return (
    <section className={styles.panel}>
      <h2>Later Agent</h2>
      {screen.canRunLaterAgent && execution ? (
        <form action={runLaterAgentExecution}>
          <input type="hidden" name="agentExecutionId" value={execution.id} />
          <button className={styles.button} type="submit">Run Agent</button>
        </form>
      ) : null}
      {execution?.status === 'RUNNING' ? <p>Agent Running</p> : null}
      {execution?.status === 'COMPLETED' ? <p>Agent Completed</p> : null}
    </section>
  );
}

export function LaterChangeGateBody({ screen }: { screen: ReviewConsoleScreen }) {
  const execution = screen.nextLaterAgentExecution;
  const gate = screen.nextLaterChangeGate;
  return (
    <section className={styles.panel}>
      <h2>Later Change Gate</h2>
      {screen.canRunLaterChangeGate && execution ? (
        <form action={runLaterChangeGate}>
          <input type="hidden" name="agentExecutionId" value={execution.id} />
          <button className={styles.button} type="submit">Run Change Gate</button>
        </form>
      ) : null}
      {gate?.status === 'APPROVED' ? <p>Change Gate: APPROVED</p> : null}
      {gate?.status === 'GATED' ? <p>Change Gate: GATED</p> : null}
      {gate?.status === 'BLOCKED' ? <p>Change Gate: BLOCKED</p> : null}
    </section>
  );
}

export function FollowingReReviewBody({ screen }: { screen: ReviewConsoleScreen }) {
  const execution = screen.nextLaterAgentExecution;
  const review = screen.nextFollowingReReview;
  const surface = review?.surface;
  return (
    <section className={styles.panel}>
      <h2>Following Re-review</h2>
      {screen.canRunFollowingReReview && execution ? (
        <form action={runFollowingReReview}>
          <input type="hidden" name="agentExecutionId" value={execution.id} />
          <button className={styles.button} type="submit">Run Re-review</button>
        </form>
      ) : null}
      {review?.decision ? <p>Decision: {review.decision}</p> : null}
      {surface ? <p>{surface.statusSummary}</p> : null}
      {surface ? (
        <ul>{surface.topProblems.map((item) => <li key={item}>{item}</li>)}</ul>
      ) : null}
      {surface ? <p>{surface.expectedUserEffect}</p> : null}
      {surface ? <p>{surface.risk}</p> : null}
      {surface ? (
        <ul>{surface.dimensionEvidence.map((item) => <li key={item}>{item}</li>)}</ul>
      ) : null}
      {surface ? (
        <ul>{surface.supportedClaims.map((item) => <li key={item}>{item}</li>)}</ul>
      ) : null}
      {surface ? (
        <ul>{surface.partiallySupportedClaims.map((item) => <li key={item}>{item}</li>)}</ul>
      ) : null}
      {surface ? (
        <ul>{surface.hypotheses.map((item) => <li key={item}>{item}</li>)}</ul>
      ) : null}
    </section>
  );
}
