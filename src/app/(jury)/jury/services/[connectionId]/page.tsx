import { redirect } from 'next/navigation';
import { JuryEmailNotice } from '@/components/jury/JuryEmailNotice';
import { juryHref, juryLoginHref } from '@/lib/jury-product/jury-url';
import { loadServiceOperation } from '@/lib/jury-product/service-operations';
import { providerViewsFor } from '@/lib/jury-product/services/provider-boundary';
import { getJuryEntry } from '@/lib/jury-product/session';
import { GithubRefreshStatus } from '../../github-refresh-status';
import { ServiceDetailBody } from '../../service-onboarding-ui';
import { ServiceOperationDetail, ServiceOperationState } from '../../service-operations-ui';
import { JuryChrome } from '../../ui';
import { loadJuryShell, readJurySessionEmail } from '../../load';

export default async function ServiceDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ connectionId: string }>;
  searchParams: Promise<{ result?: string | string[] }>;
}) {
  const { connectionId } = await params;
  const query = await searchParams;
  const entry = await getJuryEntry();
  if (!entry.ok && entry.reason === 'EMAIL_UNVERIFIED') {
    return <JuryEmailNotice email={await readJurySessionEmail()} />;
  }
  if (!entry.ok && entry.reason === 'UNAUTHENTICATED') redirect(juryLoginHref(`/jury/services/${connectionId}`));
  if (!entry.ok && entry.reason === 'NO_MEMBERSHIP') redirect(juryHref('/organization/create'));
  const { actor, view, notice } = await loadJuryShell(Promise.resolve({ result: query.result }));
  const providers = actor.ok && view ? providerViewsFor({
    actorTenantId: actor.tenantId,
    connections: view.connections,
    discoveryConnectionIds: view.discoveries.map((row) => row.connectionId),
    evidenceConnectionIds: view.evidence.map((row) => row.connectionId),
  }) : {};
  const operation = await loadServiceOperation(actor, connectionId, {
    tenantId: null,
    organizationId: null,
    actingUserId: null,
    actorRole: null,
    permission: null,
  });
  return (
    <JuryChrome actor={actor} notice={notice}>
      {operation.ok ? <ServiceOperationDetail model={operation.model} provider={providers[connectionId] ?? null} /> : <ServiceOperationState reason={operation.reason} />}
      {operation.ok && actor.ok && view ? <ServiceDetailBody actor={actor} view={view} connectionId={connectionId} /> : null}
      <GithubRefreshStatus connectionId={connectionId} />
    </JuryChrome>
  );
}
