import Link from 'next/link';
import { juryHref } from '@/lib/jury-product/jury-url';
import type { GithubRepository } from '@/lib/jury-product/services/github/discovery';
import { projectGithubPermissionGuide, projectGithubUiState, type GithubProductScreen } from '@/lib/jury-product/services/github/product-flow';
import {
  chooseGithubRepository,
  collectGithubEvidence,
  disconnectGithub,
  reviewGithubEvidence,
  startGithubConnect,
} from '../../github-actions';
import styles from '../../jury.module.css';

export function GithubPanel({
  configured,
  canConnect,
  canGrant,
  connection,
  repositories,
  selected,
  screen,
  notice,
}: {
  configured: boolean;
  canConnect: boolean;
  canGrant: boolean;
  connection: { id: string; displayName: string; status: string } | null;
  repositories: readonly GithubRepository[] | null;
  selected: string | null;
  screen: GithubProductScreen | null;
  notice: string | null;
}) {
  const guide = projectGithubPermissionGuide({
    connected: Boolean(connection && screen),
    canView: Boolean(screen?.canView),
    canGrant,
  });
  const state = projectGithubUiState({
    connected: Boolean(connection),
    configured,
    canView: Boolean(screen?.canView),
    repositorySelected: Boolean(selected),
    repositoryCount: repositories ? repositories.length : null,
    evidenceStatus: screen?.evidenceStatus ?? null,
    reviewStatus: screen?.reviewStatus ?? null,
  });
  const repositoriesVisible = Boolean(screen?.canView && repositories);
  return (
    <section className={styles.panel}>
      <h2 className={styles.pageTitle}>GitHub</h2>
      <p>Provider GitHub</p>
      <p>Source {screen?.source === 'fixture' ? 'Fixture' : 'GitHub'}</p>
      <p>Environment {screen?.environment === 'fixture' ? 'Test' : configured ? 'GitHub App' : 'Not configured'}</p>
      <p>Read-only repository evidence. This connection does not modify a repository.</p>
      {notice ? <p>{notice}</p> : null}
      {state === 'no-connection' ? <p>GitHub is not connected for this organization.</p> : null}
      {!configured ? <p>GitHub App configuration is not available.</p> : null}
      {state === 'no-scope' ? <p>No repository is selected. Choose a read-only repository before collecting evidence.</p> : null}
      {state === 'evidence-failed' ? <p>Evidence collection failed. A review was not started.</p> : null}
      {state === 'evidence-partial' ? <p>Evidence is partial. Unavailable sections stay unavailable.</p> : null}
      {state === 'review-running' ? <p>A review is in progress.</p> : null}
      {state === 'review-completed' ? <p>The review is complete.</p> : null}
      {!canConnect && !connection ? <p>Your organization role cannot connect a service.</p> : null}
      {guide.needed ? (
        <>
          <p>GitHub is connected for this organization. You do not have service access.</p>
          <p>View is the minimum permission. Review is required to collect evidence and start a review.</p>
          <p>{guide.canGrant ? 'You can grant service access. An organization role does not grant it by itself.' : 'An organization owner or admin can grant service access.'}</p>
          <p><Link className={styles.inline} href={juryHref('/organization/services')}>Service access</Link></p>
        </>
      ) : null}
      {screen?.canView && !screen.canCollect && selected ? <p>Evidence collection and review need Review permission.</p> : null}
      {canConnect && !connection ? (
        <form action={startGithubConnect}>
          <input type="hidden" name="tenantId" value="client-supplied-tenant" />
          <input type="hidden" name="organizationId" value="client-supplied-org" />
          <input type="hidden" name="userId" value="client-supplied-user" />
          <input type="hidden" name="role" value="OWNER" />
          <input type="hidden" name="permission" value="AGENT" />
          <button className={styles.button} type="submit">Connect GitHub</button>
        </form>
      ) : null}
      {connection ? (
        <>
          <p>Account {connection.displayName}</p>
          <p>Connection status <span className={styles.badge}>{connection.status}</span></p>
          {state === 'no-repository' ? <p>No repositories are available to this installation.</p> : null}
          {repositoriesVisible && repositories && repositories.length > 0 ? (
            <ul>
              {repositories.map((repository) => (
                <li key={repository.fullName}>
                  {repository.owner} {repository.name} {repository.fullName} {repository.visibility} {repository.private ? 'private' : 'public'} {repository.defaultBranch || 'branch not available'} {repository.archived ? 'archived' : ''} {repository.disabled ? 'disabled' : ''}
                </li>
              ))}
            </ul>
          ) : null}
          {canConnect && repositoriesVisible && repositories && repositories.length > 0 ? (
            <form action={chooseGithubRepository}>
              <input type="hidden" name="connectionId" value={connection.id} />
              <input type="hidden" name="tenantId" value="client-supplied-tenant" />
              <input type="hidden" name="operation" value="write" />
              <input type="hidden" name="readonly" value="false" />
              <label>
                Repository
                <select name="fullName" defaultValue={selected ?? repositories[0]?.fullName}>
                  {repositories.map((repository) => (
                    <option key={repository.fullName} value={repository.fullName}>{repository.fullName}</option>
                  ))}
                </select>
              </label>
              <button className={styles.button} type="submit">Use repository</button>
            </form>
          ) : null}
          {screen?.scope ? <p>Scope {screen.scope.resource} {screen.scope.operation} readonly</p> : null}
          {screen?.canCollect && selected ? (
            <form action={collectGithubEvidence}>
              <input type="hidden" name="connectionId" value={connection.id} />
              <input type="hidden" name="fullName" value={selected} />
              <input type="hidden" name="tenantId" value="client-supplied-tenant" />
              <input type="hidden" name="operation" value="write" />
              <button className={styles.button} type="submit">Collect evidence</button>
            </form>
          ) : null}
          {screen?.evidenceStatus ? (
            <>
              <h3>Evidence summary</h3>
              <p>Status {screen.evidenceStatus}</p>
              <p>Repository {screen.repository}</p>
              <p>Default branch {screen.defaultBranch ?? 'not available'}</p>
              <p>README {screen.readme}{screen.readmeEmpty ? ' empty' : ''}</p>
              {screen.readmeNote ? <p>{screen.readmeNote}</p> : null}
              <p>README size {screen.readmeBytes === null ? 'not available' : screen.readmeBytes}</p>
              <p>Commits {screen.commitCount === null ? 'not available' : screen.commitCount}</p>
              <p>{screen.commitNote}</p>
              <p>Structure {screen.structureState}{screen.structureCount === null ? '' : ` ${screen.structureCount}`}</p>
              {screen.structureNote ? <p>{screen.structureNote}</p> : null}
              <p>Collected {screen.collectedAt ?? 'not available'}</p>
              <p>Sensitive files excluded</p>
              {screen.excerpt ? <p>README excerpt {screen.excerpt}</p> : null}
              {screen.unavailable.length > 0 ? <p>Unavailable {screen.unavailable.join(', ')}</p> : null}
            </>
          ) : null}
          {screen?.reviewStatus ? <p>Review status <span className={styles.badge}>{screen.reviewStatus}</span></p> : null}
          {screen?.reviewStatus === 'FAILED' ? <p>The review did not complete. Collect evidence again before another review.</p> : null}
          {screen?.canStartReview ? (
            <form action={reviewGithubEvidence}>
              <input type="hidden" name="connectionId" value={connection.id} />
              <input type="hidden" name="tenantId" value="client-supplied-tenant" />
              <button className={styles.button} type="submit">Start review</button>
            </form>
          ) : null}
          {screen?.reviewView ? (
            <>
              <h3>Review result</h3>
              <p>This review was based on GitHub repository evidence.</p>
              <p>Provider GitHub</p>
              <p>Repository {screen.repository}</p>
              <p>Evidence status {screen.evidenceStatus}</p>
              <p>Decision {screen.reviewView.decision}</p>
              <p>Evidence strength {screen.reviewView.evidenceStrength ?? 'not stored'}</p>
              <p>Claim strength {screen.reviewView.claimStrength ?? 'not stored'}</p>
              <p>Risk {screen.reviewView.risk || 'not stored'}</p>
              <p>{screen.reviewView.statusSummary}</p>
              {screen.reviewView.topProblems.length > 0 ? <ul>{screen.reviewView.topProblems.map((item) => <li key={item}>{item}</li>)}</ul> : null}
              <p>Expected user effect {screen.reviewView.expectedUserEffect}</p>
              <details>
                <summary>Additional claims</summary>
                {screen.reviewView.collapsed.dimensionEvidence.length > 0 ? <ul>{screen.reviewView.collapsed.dimensionEvidence.map((item) => <li key={item}>{item}</li>)}</ul> : null}
                {screen.reviewView.collapsed.supportedClaims.length > 0 ? <ul>{screen.reviewView.collapsed.supportedClaims.map((item) => <li key={item}>{item}</li>)}</ul> : null}
                {screen.reviewView.collapsed.partiallySupportedClaims.length > 0 ? <ul>{screen.reviewView.collapsed.partiallySupportedClaims.map((item) => <li key={item}>{item}</li>)}</ul> : null}
                {screen.reviewView.collapsed.hypotheses.length > 0 ? <ul>{screen.reviewView.collapsed.hypotheses.map((item) => <li key={item}>{item}</li>)}</ul> : null}
              </details>
              <p><Link className={styles.inline} href={juryHref(`/reviews/${screen.result?.id}`)}>Open the existing review</Link></p>
            </>
          ) : null}
          {screen?.improvement.offered ? (
            <p><Link className={styles.inline} href={juryHref(`/reviews/${screen.improvement.reviewId}`)}>Open the existing improvement step</Link></p>
          ) : null}
          {canConnect && connection.status !== 'DISCONNECTED' ? (
            <form action={disconnectGithub}>
              <input type="hidden" name="connectionId" value={connection.id} />
              <input type="hidden" name="tenantId" value="client-supplied-tenant" />
              <button className={styles.button} type="submit">Disconnect GitHub</button>
            </form>
          ) : null}
          <p>Disconnect stops this Jury connection. It does not uninstall the GitHub App.</p>
        </>
      ) : null}
    </section>
  );
}
