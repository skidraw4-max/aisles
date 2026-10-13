import { redirect } from 'next/navigation';
import { JuryEmailNotice } from '@/components/jury/JuryEmailNotice';
import { juryHref, juryLoginHref } from '@/lib/jury-product/jury-url';
import { getJuryEntry } from '@/lib/jury-product/session';
import { canManageServiceAccess, highestServicePermission } from '@/lib/jury-product/service-member-management';
import { listUserServiceGrants } from '@/lib/jury-product/service-feature-guard';
import { publicGithubConfiguration } from '@/lib/jury-product/services/github/config';
import { listGithubRepositories, loadGithubProductScreen } from '@/lib/jury-product/services/github/product';
import { JuryChrome } from '../../ui';
import { loadJuryShell, readJurySessionEmail } from '../../load';
import { GithubPanel } from './github-panel';

function noticeFor(code: string): string {
  if (code === 'GITHUB_NOT_CONFIGURED') return NOTICES['not-configured'] ?? '';
  if (code === 'GITHUB_UNAUTHORIZED') return NOTICES.unauthorized ?? '';
  if (code === 'GITHUB_FORBIDDEN' || code === 'CONNECTION_UNAUTHORIZED' || code === 'READ_ACCESS_REQUIRED') return NOTICES.forbidden ?? '';
  if (code === 'GITHUB_NOT_FOUND' || code === 'CONNECTION_NOT_FOUND') return NOTICES['not-found'] ?? '';
  if (code === 'GITHUB_RATE_LIMIT') return NOTICES['rate-limit'] ?? '';
  if (code === 'GITHUB_STATE_INVALID') return NOTICES['state-invalid'] ?? '';
  if (code === 'COLLECTION_LIMIT_EXCEEDED') return NOTICES.limit ?? '';
  return NOTICES.unavailable ?? '';
}

const NOTICES: Record<string, string> = {
  connected: 'GitHub 연결을 저장했습니다. 저장소는 수정하지 않습니다.',
  selected: '저장소를 읽기 전용 범위로 선택했습니다.',
  disconnected: 'Jury 연결을 끊었습니다. GitHub App은 제거하지 않습니다.',
  'not-configured': 'GitHub App configuration is not available.',
  unauthorized: 'GitHub authentication failed.',
  forbidden: 'GitHub denied the requested read.',
  'not-found': 'The GitHub resource was not found.',
  'rate-limit': 'GitHub is rate limiting requests.',
  unavailable: 'GitHub did not complete the request.',
  'state-invalid': 'The GitHub connection request is not valid.',
  limit: 'The read stopped because the collection limit was reached.',
  collected: 'GitHub evidence was collected. The repository was not modified.',
  partial: 'GitHub evidence is partial. Missing sections stay unavailable.',
  reviewed: 'The existing Jury review pipeline stored a result.',
  'in-progress': 'A review is already in progress.',
  'evidence-failed': 'Evidence is not available, so a review was not started.',
  'review-failed': 'The review did not complete. Collect evidence again before another review.',
  'review-exists': 'This evidence already has a stored review.',
};

export default async function GithubServicePage({
  searchParams,
}: {
  searchParams: Promise<{ result?: string | string[] }>;
}) {
  const entry = await getJuryEntry();
  if (!entry.ok && entry.reason === 'EMAIL_UNVERIFIED') {
    return <JuryEmailNotice email={await readJurySessionEmail()} />;
  }
  if (!entry.ok && entry.reason === 'UNAUTHENTICATED') redirect(juryLoginHref('/jury/services/github'));
  if (!entry.ok && entry.reason === 'NO_MEMBERSHIP') redirect(juryHref('/organization/create'));
  const query = await searchParams;
  const { actor, view } = await loadJuryShell(Promise.resolve({}));
  const result = typeof query.result === 'string' ? query.result : '';
  const configuration = publicGithubConfiguration();
  const connection = actor.ok && view
    ? view.connections.find((row) => row.tenantId === actor.tenantId && row.serviceKey.startsWith('github-')) ?? null
    : null;
  const grant = connection && view
    ? view.scopes.find((scope) => scope.connectionId === connection.id && scope.tenantId === connection.tenantId && scope.status === 'APPROVED')
    : null;
  const selectedGrant = grant?.grants.find((item) => item.mode === 'READ' && item.resource.startsWith('repository:'));
  const selected = selectedGrant ? selectedGrant.resource.slice('repository:'.length) : null;
  const canConnect = actor.ok && (actor.role === 'OWNER' || actor.role === 'ADMIN');
  const permission = actor.ok && connection
    ? highestServicePermission((await listUserServiceGrants(actor.tenantId, actor.userId)).filter((grantRow) => grantRow.connectionId === connection.id))
    : null;
  const loadedScreen = actor.ok && connection
    ? await loadGithubProductScreen({
      actor,
      connectionId: connection.id,
      configured: configuration.configured,
      servicePermission: permission,
      repository: selected,
    })
    : null;
  const screen = loadedScreen && loadedScreen.ok ? loadedScreen.screen : null;
  let repositories = null;
  let loadNotice: string | null = loadedScreen && !loadedScreen.ok ? noticeFor(loadedScreen.code) : null;
  if (screen?.canView && configuration.configured && connection && actor.ok) {
    const loaded = await listGithubRepositories({ actor, connectionId: connection.id });
    if (loaded.ok) repositories = loaded.repositories;
    else loadNotice = noticeFor(loaded.code);
  }
  return (
    <JuryChrome actor={actor}>
      {actor.ok ? (
        <GithubPanel
          configured={configuration.configured}
          canConnect={canConnect}
          canGrant={canManageServiceAccess(actor)}
          connection={connection ? { id: connection.id, displayName: connection.displayName, status: connection.status } : null}
          repositories={repositories}
          selected={selected}
          screen={screen}
          notice={NOTICES[result] ?? loadNotice}
        />
      ) : null}
    </JuryChrome>
  );
}
