import { redirect } from 'next/navigation';
import { JuryEmailNotice } from '@/components/jury/JuryEmailNotice';
import { juryHref, juryLoginHref } from '@/lib/jury-product/jury-url';
import { loadServiceOperation } from '@/lib/jury-product/service-operations';
import { providerViewsFor } from '@/lib/jury-product/services/provider-boundary';
import { getJuryEntry } from '@/lib/jury-product/session';
import { loadQualityTrend } from '@/lib/jury-product/quality-trend';
import { GithubRefreshStatus } from '../../github-refresh-status';
import { ServiceDetailBody } from '../../service-onboarding-ui';
import { QualityTrendPanel, ServiceOperationDetail, ServiceOperationState } from '../../service-operations-ui';
import { JuryChrome } from '../../ui';
import { ReadonlyAccountSection } from '../../readonly-account-section';
import { loadJuryShell, readJurySessionEmail } from '../../load';

/**
 * READ_ONLY_ACCOUNT observation runs a headless browser from this page's server action (I-044),
 * and the connected-service review (LLM, up to 240s budget) runs here too. I-048: a page-level
 * value overrides the layout's 300s, so it must not be lower than the layout.
 */
export const maxDuration = 300;

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
  const trend = operation.ok ? await loadQualityTrend(actor, connectionId) : null;
  return (
    <JuryChrome actor={actor} notice={notice}>
      {operation.ok ? <ServiceOperationDetail model={operation.model} provider={providers[connectionId] ?? null} /> : <ServiceOperationState reason={operation.reason} />}
      {trend?.visible ? <QualityTrendPanel trend={trend} /> : null}
      {operation.ok && actor.ok && view ? <ServiceDetailBody actor={actor} view={view} connectionId={connectionId} /> : null}
      {operation.ok && actor.ok && view ? (
        <ReadonlyAccountSection
          tenantId={actor.tenantId}
          connectionId={connectionId}
          accessMethod={view.connections.find((row) => row.id === connectionId && row.tenantId === actor.tenantId)?.accessMethod}
        />
      ) : null}
      <GithubRefreshStatus connectionId={connectionId} />
    </JuryChrome>
  );
}
