import { redirect } from 'next/navigation';
import { JuryEmailNotice } from '@/components/jury/JuryEmailNotice';
import { juryHref, juryLoginHref } from '@/lib/jury-product/jury-url';
import { loadServiceOperations } from '@/lib/jury-product/service-operations';
import { providerViewsFor } from '@/lib/jury-product/services/provider-boundary';
import { canDeleteConnection, isGithubConnection } from '@/lib/jury-product/services/connection-delete/delete';
import { loadDeletedConnectionMeta } from '@/lib/jury-product/services/connection-delete/deleted-view';
import { getJuryEntry } from '@/lib/jury-product/session';
import { ServiceOperationsList } from '../service-operations-ui';
import { JuryChrome, ServicesBody } from '../ui';
import { loadJuryShell, readJurySessionEmail } from '../load';

export default async function JuryServicesPage({
  searchParams,
}: {
  searchParams: Promise<{ result?: string | string[]; filter?: string | string[] }>;
}) {
  const entry = await getJuryEntry();
  if (!entry.ok && entry.reason === 'EMAIL_UNVERIFIED') {
    return <JuryEmailNotice email={await readJurySessionEmail()} />;
  }
  if (!entry.ok && entry.reason === 'UNAUTHENTICATED') redirect(juryLoginHref('/jury/services'));
  if (!entry.ok && entry.reason === 'NO_MEMBERSHIP') redirect(juryHref('/organization/create'));
  const { actor, view, notice } = await loadJuryShell(searchParams);
  const filter = (await searchParams).filter;
  const showDeleted = (Array.isArray(filter) ? filter[0] : filter) === 'deleted';
  const operations = actor.ok ? await loadServiceOperations(actor) : null;
  const deletedMeta = actor.ok && showDeleted ? await loadDeletedConnectionMeta(actor.tenantId).catch(() => ({})) : {};
  const error = !actor.ok
    ? actor.reason === 'STORE_UNAVAILABLE'
      ? 'Jury 저장소가 아직 준비되지 않았습니다.'
      : '서비스 정보를 불러오지 못했습니다.'
    : operations && !operations.ok
      ? 'Jury 저장소가 아직 준비되지 않았습니다.'
      : null;
  return (
    <JuryChrome actor={actor} notice={notice}>
      <ServiceOperationsList
        rows={operations?.ok ? operations.rows : null}
        error={error}
        showDeleted={showDeleted}
        deletedMeta={deletedMeta}
        canDelete={canDeleteConnection(actor)}
        githubConnectionIds={view ? view.connections.filter(isGithubConnection).map((row) => row.id) : []}
        providers={actor.ok && view ? providerViewsFor({
          actorTenantId: actor.tenantId,
          connections: view.connections,
          discoveryConnectionIds: view.discoveries.map((row) => row.connectionId),
          evidenceConnectionIds: view.evidence.map((row) => row.connectionId),
        }) : {}}
      />
      {view ? <ServicesBody actor={actor} view={view} /> : null}
    </JuryChrome>
  );
}
