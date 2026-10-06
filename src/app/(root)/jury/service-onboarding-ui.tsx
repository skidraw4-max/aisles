import Link from 'next/link';
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
  collectConnectedServiceEvidence,
  decideOnboardingScope,
  runConnectedServiceJuryReview,
  runOnboardingDiscovery,
  startServiceOnboarding,
} from './actions';
import { OnboardingSubmit } from './shell-client';
import { canShowWrite } from './ui';
import styles from './jury.module.css';

export function AddServiceBody({ actor }: { actor: Extract<JuryActor, { ok: true }> }) {
  if (!canShowWrite(actor, 'connection.write')) {
    return (
      <section className={styles.panel}>
        <h2 className={styles.pageTitle}>Add Service</h2>
        <p className={styles.muted}>Add Service: 현재 역할에는 이 변경 권한이 없습니다.</p>
      </section>
    );
  }
  return (
    <section className={styles.panel}>
      <h2 className={styles.pageTitle}>Add Service</h2>
      <p className={styles.muted}>{MOCK_ONBOARDING_SERVICE.description}</p>
      <form action={startServiceOnboarding}>
        <p>
          <span className={styles.muted}>Service</span>
          <br />
          <strong>{MOCK_ONBOARDING_SERVICE.label}</strong>
        </p>
        <p className={styles.muted}>adapterKey {MOCK_ONBOARDING_SERVICE.adapterKey}</p>
        <input type="hidden" name="adapterKey" value={MOCK_ONBOARDING_SERVICE.adapterKey} />
        <input type="hidden" name="tenantId" value="client-supplied-tenant" />
        <label>
          Service name
          <input className={styles.field} name="displayName" required autoComplete="off" />
        </label>
        <label>
          Service key
          <input className={styles.field} name="serviceKey" required autoComplete="off" />
        </label>
        <label>
          Connection type
          <select className={styles.field} name="accessMethod" defaultValue="FILE_UPLOAD">
            {JURY_ACCESS_METHODS.map((method) => (
              <option key={method} value={method}>{method}</option>
            ))}
          </select>
        </label>
        <label>
          Credential reference
          <input className={styles.field} name="credentialRef" required autoComplete="off" placeholder="mock-connection-001" />
        </label>
        <OnboardingSubmit label="Create connection" pendingLabel="Creating connection" />
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
        <h2 className={styles.pageTitle}>Service</h2>
        <p>현재 tenant에서 이 서비스를 찾지 못했습니다.</p>
      </section>
    );
  }
  const { connection, discovery, scopes } = detail;
  return (
    <section className={styles.panel}>
      <h2 className={styles.pageTitle}>{connection.displayName}</h2>
      <p className={styles.muted}>Connection → Discovery → Access Scopes → Activation</p>

      <h3>Connection</h3>
      <p>Service name {connection.displayName}</p>
      <p>Connection type <span className={styles.badge}>{connection.accessMethod}</span></p>
      <p>Status <span className={styles.badge}>{connection.status}</span></p>
      <p>adapterKey {MOCK_ONBOARDING_SERVICE.adapterKey}</p>
      <p>Credential reference {detail.credentialLabel}</p>
      <p>Created At {connection.createdAt}</p>
      <p>Updated At {connection.updatedAt}</p>

      <h3>Discovery</h3>
      <p>Discovery status <span className={styles.badge}>{detail.discoveryStatus}</span></p>
      {discovery ? (
        <>
          <p>Adapter MockDiscoveryAdapter</p>
          <p>Explored {discovery.exploredAt}</p>
          <p>Resources {discovery.surfaces.join(', ')} · {discovery.menus.join(', ')}</p>
          <p>Data sources {discovery.dataSources.join(', ')}</p>
          <p>Feasibility {discovery.feasibility}</p>
          {discovery.proposedMetrics.map((item) => (
            <p key={item.metric}>{item.metric}: {item.reason}</p>
          ))}
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

      <h3>Access Scopes</h3>
      {scopes.length === 0 ? <p>{ONBOARDING_EMPTY_SCOPES}</p> : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Resource</th>
              <th>Purpose</th>
              <th>Access mode</th>
              <th>Grant</th>
              <th>Approval</th>
            </tr>
          </thead>
          <tbody>
            {scopes.map((scope) => (
              <tr key={scope.id}>
                <td>{scope.grants.map((grant) => grant.resource).join(', ') || 'Not available'}</td>
                <td>{scope.grants.map((grant) => scopePurpose(grant.resource, discovery)).join(', ')}</td>
                <td>{scope.grants.map((grant) => grant.mode).join(', ') || 'Not available'}</td>
                <td>{scope.grants.some((grant) => grant.mode === 'READ') ? 'READ' : 'Not available'}</td>
                <td><span className={styles.badge}>{scope.status}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {scopes.filter((scope) => scope.status === 'PROPOSED').map((scope) => (
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

      <h3>Activation</h3>
      <p>Status <span className={styles.badge}>{connection.status}</span></p>
      {connection.status === 'CONNECTED' ? <p>CONNECTED</p> : <p>Not connected</p>}
      <h3>Evidence</h3>
      {connection.status === 'CONNECTED' ? (
        canShowWrite(actor, 'connection.write') ? (
          <form action={collectConnectedServiceEvidence}>
            <input type="hidden" name="connectionId" value={connection.id} />
            <input type="hidden" name="tenantId" value="client-supplied-tenant" />
            <input type="hidden" name="purpose" value="aisle-self-observation" />
            <input type="hidden" name="periodStart" value="2026-09-01" />
            <input type="hidden" name="periodEnd" value="2026-09-07" />
            <input type="hidden" name="timezone" value="Asia/Seoul" />
            <p className={styles.muted}>purpose aisle-self-observation · 2026-09-01 – 2026-09-07 · Asia/Seoul</p>
            <OnboardingSubmit label="Collect Evidence" pendingLabel="Collecting evidence" />
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
          <p>contentHash {row.contentHash ?? 'Not available'}</p>
          <p>collection status <span className={styles.badge}>{row.collectionStatus}</span></p>
          <p>readOnly {row.readOnly ? 'true' : 'false'}</p>
          <p>piiExcluded {row.piiExcluded ? 'true' : 'false'}</p>
          {row.metrics.map((metric) => (
            <p key={metric.id}>{metric.metric} {formatMeasuredValue(metric.value, metric.availability)}</p>
          ))}
          <p>Review status <span className={styles.badge}>{row.reviewStatus ?? 'Not started'}</span></p>
          {row.decision ? <p>Decision {row.decision}</p> : null}
          {row.completedAt ? <p>Completed At {row.completedAt}</p> : null}
          {row.summary ? <p>Summary {row.summary}</p> : null}
          {row.topProblems.length > 0 ? <p>Top Problems {row.topProblems.join(', ')}</p> : null}
          {row.expectedUserEffect ? <p>Expected User Effect {row.expectedUserEffect}</p> : null}
          {row.risk ? <p>Risk {row.risk}</p> : null}
          {row.collectionStatus === 'AVAILABLE' && row.reviewStatus !== 'RUNNING' && canShowWrite(actor, 'review.start') ? (
            <form action={runConnectedServiceJuryReview}>
              <input type="hidden" name="connectionId" value={connection.id} />
              <input type="hidden" name="evidenceId" value={row.id} />
              <input type="hidden" name="tenantId" value="client-supplied-tenant" />
              <OnboardingSubmit label="Run Review" pendingLabel="Review running" />
            </form>
          ) : null}
          {row.resultId ? <p><Link className={styles.inline} href={`/jury/reviews/${row.resultId}`}>Reviews</Link></p> : null}
        </article>
      ))}
      {detail.canOpenEvidence ? (
        <p>
          <Link className={styles.inline} href="/jury/evidence">Evidence</Link>
          {' · '}
          <Link className={styles.inline} href="/jury/reviews">Reviews</Link>
        </p>
      ) : null}
    </section>
  );
}
