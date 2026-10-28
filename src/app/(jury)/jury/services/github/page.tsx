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
  connected: 'GitHub 연결을 저장했어요. 저장소는 수정하지 않아요.',
  selected: '저장소를 읽기 전용 범위로 선택했어요.',
  disconnected: 'Jury 연결을 끊었어요. GitHub App은 제거하지 않아요.',
  'not-configured': 'GitHub App 설정이 아직 준비되지 않았어요.',
  unauthorized: 'GitHub 인증에 실패했어요. 다시 연결해 주세요.',
  forbidden: 'GitHub에서 읽기 요청을 거부했어요. 저장소 권한을 확인해 주세요.',
  'not-found': 'GitHub에서 대상을 찾지 못했어요.',
  'rate-limit': 'GitHub 요청 한도에 걸렸어요. 잠시 후 다시 시도해 주세요.',
  unavailable: 'GitHub 요청이 완료되지 않았어요. 잠시 후 다시 시도해 주세요.',
  'state-invalid': 'GitHub 연결 요청이 올바르지 않아요. 처음부터 다시 연결해 주세요.',
  limit: '수집 한도에 도달해서 읽기를 멈췄어요.',
  collected: 'GitHub 심사 근거를 수집했어요. 저장소는 수정하지 않았어요.',
  partial: 'GitHub 심사 근거가 일부만 수집됐어요. 빠진 항목은 비어 있어요.',
  reviewed: '심사 결과를 저장했어요.',
  'in-progress': '이미 진행 중인 심사가 있어요.',
  'evidence-failed': '심사 근거가 없어서 심사를 시작하지 않았어요.',
  'review-failed': '심사가 완료되지 않았어요. 심사 근거를 다시 수집한 뒤 시도해 주세요.',
  'review-exists': '이 심사 근거에는 이미 저장된 심사가 있어요.',
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
