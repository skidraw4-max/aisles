import Link from 'next/link';
import { juryHref } from '@/lib/jury-product/jury-url';
import type { ServiceOperationModel } from '@/lib/jury-product/service-operations-status';
import type { SafeProviderView } from '@/lib/jury-product/services/provider-boundary';
import {
  collectConnectedServiceEvidence,
  runConnectedServiceJuryReview,
  runOnboardingDiscovery,
} from './actions';
import styles from './jury.module.css';

function mark(value: boolean): string {
  return value ? '✓' : '—';
}

function NextAction({ model }: { model: ServiceOperationModel }) {
  const action = model.next;
  return (
    <section>
      <h3>Next action</h3>
      <p>{action.label}</p>
      <p>State <span className={styles.badge}>{action.state}</span></p>
      {action.state === 'AVAILABLE' && action.id === 'discover' ? (
        <form action={runOnboardingDiscovery}>
          <input type="hidden" name="connectionId" value={model.connectionId} />
          <input type="hidden" name="tenantId" value="client-supplied-tenant" />
          <button className={styles.button} type="submit">Run discovery</button>
        </form>
      ) : null}
      {action.state === 'AVAILABLE' && action.id === 'collect-evidence' ? (
        <form action={collectConnectedServiceEvidence}>
          <input type="hidden" name="connectionId" value={model.connectionId} />
          <input type="hidden" name="tenantId" value="client-supplied-tenant" />
          <input type="hidden" name="purpose" value="aisle-self-observation" />
          <input type="hidden" name="periodStart" value="2026-09-01" />
          <input type="hidden" name="periodEnd" value="2026-09-07" />
          <input type="hidden" name="timezone" value="Asia/Seoul" />
          <button className={styles.button} type="submit">Collect evidence</button>
        </form>
      ) : null}
      {action.state === 'AVAILABLE' && action.id === 'run-review' && model.evidence.evidenceId ? (
        <form action={runConnectedServiceJuryReview}>
          <input type="hidden" name="connectionId" value={model.connectionId} />
          <input type="hidden" name="evidenceId" value={model.evidence.evidenceId} />
          <input type="hidden" name="tenantId" value="client-supplied-tenant" />
          <button className={styles.button} type="submit">Run review</button>
        </form>
      ) : null}
      {action.state === 'AVAILABLE' && (action.id === 'review-improvement' || action.id === 'run-agent') && model.improvement.latestId ? (
        <p><Link className={styles.inline} href={juryHref(`/improvements/${model.improvement.latestId}`)}>{action.label}</Link></p>
      ) : null}
      {action.state === 'LOCKED' ? <p className={styles.muted}>Your current service permission does not allow this action.</p> : null}
      {action.state === 'NOT_READY' ? <p className={styles.muted}>This action is waiting on an earlier step.</p> : null}
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
      <h2 className={styles.pageTitle}>Service operations</h2>
      <p className={styles.muted}>Health, evidence, review, improvement, and agent status. Access changes stay on Service access.</p>
      <p><Link className={styles.inline} href={juryHref('/services/github')}>Connect GitHub</Link></p>
      {error ? <p>{error}</p> : null}
      {!error && rows && rows.length === 0 ? <p>No services are available for your access.</p> : null}
      {rows && rows.length > 0 ? (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Service Name</th>
              <th>Provider</th>
              <th>Connection Status</th>
              <th>Operational Status</th>
              <th>Last Evidence</th>
              <th>Last Review</th>
              <th>Current Decision</th>
              <th>Open Improvements</th>
              <th>Agent Status</th>
              <th>Last Activity</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.connectionId}>
                <td><Link className={styles.inline} href={juryHref(`/services/${row.connectionId}`)}>{row.name}</Link></td>
                <td>{providers[row.connectionId]?.displayName ?? 'Unknown'}</td>
                <td><span className={styles.badge}>{row.connectionStatus}</span></td>
                <td>{row.phase}</td>
                <td>{row.parts.evidence === 'READY' ? 'Ready' : 'No evidence collected yet'}</td>
                <td>{row.lastReview}</td>
                <td>{row.review.decision ?? 'No review'}</td>
                <td>{row.improvement.openCount}</td>
                <td>{row.agent.status ?? 'No execution'}</td>
                <td>{row.lastActivity}</td>
              </tr>
            ))}
          </tbody>
        </table>
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
      <p>Connection <span className={styles.badge}>{model.connectionStatus}</span></p>
      <p>Operational <span className={styles.badge}>{model.phase}</span></p>
      <p>Health <span className={styles.badge}>{model.health}</span></p>
      {provider ? (
        <>
          <h3>Connection configuration</h3>
          <p>Provider {provider.displayName}</p>
          <p>Connection method {provider.configuration.connectionMethod}</p>
          <p>Access {provider.configuration.accessMode}</p>
          <p>Credential status <span className={styles.badge}>{provider.configuration.credentialStatus}</span></p>
          <p>Connection status <span className={styles.badge}>{provider.configuration.connectionStatus}</span></p>
          <p>Lifecycle <span className={styles.badge}>{provider.configuration.lifecycle}</span></p>
          <p>Readiness <span className={styles.badge}>{provider.configuration.readiness}</span></p>
          <p>Connection health <span className={styles.badge}>{provider.health}</span></p>
          <p>Capabilities {provider.configuration.capabilities.join(', ')}</p>
          <p>{provider.configuration.notice}</p>
          {provider.provider === 'GITHUB' ? <p><Link className={styles.inline} href={juryHref('/services/github')}>GitHub repositories</Link></p> : null}
        </>
      ) : null}

      <h3>Overview</h3>
      <p>Evidence {model.parts.evidence}</p>
      <p>Review {model.parts.review}</p>
      <p>Improvement {model.parts.improvement}</p>
      <p>Agent {model.parts.agent}</p>

      <h3>Onboarding</h3>
      <p>Discovery {model.onboarding.discovery}</p>
      <p>Scope {model.onboarding.scope}</p>
      <p>Connection {model.onboarding.connection}</p>

      <h3>Evidence</h3>
      {model.evidence.empty ? <p>No evidence collected yet</p> : (
        <>
          <p>Period {model.evidence.period}</p>
          <p>Last collected {model.evidence.collectedAt}</p>
          <p>Adapter {model.evidence.adapter}</p>
          <p>Measured metrics {model.evidence.measuredCount}</p>
          <p>Not measured {model.evidence.notMeasuredCount}</p>
          <p>Evidence items {model.evidence.evidenceItemCount}</p>
          <p>GA4 {model.evidence.ga4}</p>
          <p>Collection {model.evidence.collectionStatus}</p>
        </>
      )}

      <h3>Review</h3>
      {model.review.empty ? <p>No review</p> : (
        <>
          <p>Decision {model.review.decision}</p>
          <p>Summary {model.review.statusSummary}</p>
          <p>Top problems {model.review.topProblems.join(', ') || 'None'}</p>
          <p>Expected user effect {model.review.expectedUserEffect}</p>
          <p>Risk {model.review.risk}</p>
          <p>Reviewed {model.review.reviewedAt}</p>
        </>
      )}

      <h3>Improvement</h3>
      {model.improvement.empty ? <p>No improvement</p> : (
        <>
          <p>Open tasks {model.improvement.openCount}</p>
          <p>Latest {model.improvement.latestStatus}</p>
          <p>{model.improvement.latestTitle}</p>
        </>
      )}

      <h3>Agent</h3>
      {model.agent.empty ? <p>No execution</p> : (
        <>
          <p>Status {model.agent.status}</p>
          <p>Provider {model.agent.provider}</p>
          <p>Started {model.agent.startedAt ?? 'Not available'}</p>
          <p>Finished {model.agent.finishedAt ?? 'Not available'}</p>
          <p>Changed files {model.agent.changedFilesCount ?? 0}</p>
          <p>Tests passed {model.agent.testsPassed === null ? 'Not available' : model.agent.testsPassed ? 'true' : 'false'}</p>
        </>
      )}

      <h3>Change flow</h3>
      <p>Agent {model.flow.agent}</p>
      <p>Change Gate {model.flow.changeGate}</p>
      <p>Re-review {model.flow.reReview}</p>
      <p>Jury {model.flow.jury}</p>

      <NextAction model={model} />

      <h3>Recent activity</h3>
      {model.activity.length === 0 ? <p>No activity</p> : model.activity.map((row) => (
        <p key={row.id}>{row.label} · {row.age}</p>
      ))}

      <h3>Your access</h3>
      <p>Organization role {model.access.organizationRole}</p>
      <p>Service permission {model.access.servicePermission ?? 'None'}</p>
      <p>VIEW {mark(model.access.capabilities.VIEW)}</p>
      <p>REVIEW {mark(model.access.capabilities.REVIEW)}</p>
      <p>IMPROVE {mark(model.access.capabilities.IMPROVE)}</p>
      <p>AGENT {mark(model.access.capabilities.AGENT)}</p>
      <p className={styles.muted}>Permission changes stay on Service access.</p>
      <p><Link className={styles.inline} href={juryHref('/organization/services')}>Service access</Link></p>
    </section>
  );
}

export function ServiceOperationState({
  reason,
}: {
  reason: 'NOT_FOUND' | 'FORBIDDEN' | 'STORE_UNAVAILABLE' | 'UNAUTHENTICATED' | 'NO_MEMBERSHIP';
}) {
  const copy = {
    NOT_FOUND: 'Service not found',
    FORBIDDEN: 'You do not have access to this service',
    STORE_UNAVAILABLE: 'Jury 저장소가 아직 준비되지 않았습니다.',
    UNAUTHENTICATED: 'Sign in required',
    NO_MEMBERSHIP: 'Organization membership required',
  }[reason];
  return <section className={styles.panel}><h2>Service operations</h2><p>{copy}</p></section>;
}
