import { redirect } from 'next/navigation';
import { JuryEmailNotice } from '@/components/jury/JuryEmailNotice';
import { juryHref, juryLoginHref } from '@/lib/jury-product/jury-url';
import { loadServiceOperation } from '@/lib/jury-product/service-operations';
import { providerViewsFor } from '@/lib/jury-product/services/provider-boundary';
import { getJuryEntry } from '@/lib/jury-product/session';
import { loadQualityTrend } from '@/lib/jury-product/quality-trend';
import { GithubRefreshStatus } from '../../github-refresh-status';
import { ServiceDetailBody } from '../../service-onboarding-ui';
import { QualityTrendPanel, ServiceNextActionPanel, ServiceOperationDetail, ServiceOperationState, ServiceSummaryHeader } from '../../service-operations-ui';
import { parseServiceTab, serviceTabBadges, ServiceTabNav } from '../../service-detail-tabs';
import { ServiceTabMemory } from '../../service-tab-memory';
import { JuryChrome } from '../../ui';
import { ReadonlyAccountSection, readonlyObservationNeeded } from '../../readonly-account-section';
import { canShowWrite } from '../../ui';
import { guardServiceFeature } from '@/lib/jury-product/service-feature-guard';
import { ScreenAuditSection } from '../../screen-audit-section';
import { READONLY_ACCOUNT_UI_ENABLED, shouldShowReadonlyAccountSection } from '@/lib/jury-product/services/readonly-account/flags';
import { Ga4ViewerSection, OwnershipSection } from '../../phase1-sections';
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
  searchParams: Promise<{ result?: string | string[]; tab?: string | string[] }>;
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
  // I-051: summary header always visible; the rest is split into ?tab= areas (개요 default).
  const tab = parseServiceTab(query.tab);
  const trend = operation.ok && tab === 'overview' ? await loadQualityTrend(actor, connectionId) : null;
  if (!operation.ok) {
    return (
      <JuryChrome actor={actor} notice={notice}>
        <ServiceOperationState reason={operation.reason} />
      </JuryChrome>
    );
  }
  const ready = actor.ok && view;
  const accessMethod = ready ? view.connections.find((row) => row.id === connectionId && row.tenantId === actor.tenantId)?.accessMethod : undefined;
  // I-054: header 다음 할 일 points at 관찰 실행 until one read-only observation succeeds.
  const observationNeeded = ready ? await readonlyObservationNeeded({ tenantId: actor.tenantId, connectionId, accessMethod }) : false;
  // I-099: 위원 심사 button needs 근거 수집 (connection.write) + 심사 (review.start) and the review.execute grant.
  const canJuryReview =
    ready && tab === 'screen' && canShowWrite(actor, 'connection.write') && canShowWrite(actor, 'review.start')
      ? (await guardServiceFeature({ actor, feature: 'review.execute', connectionId, clientTenantId: null }).catch(() => ({ ok: false as const }))).ok
      : false;
  return (
    <JuryChrome actor={actor} notice={notice}>
      <ServiceSummaryHeader model={operation.model} observationNeeded={observationNeeded} />
      {/* I-070: tabs in their own sticky bar under the name/status row; badges use already-loaded data only. */}
      <ServiceTabNav
        connectionId={connectionId}
        active={tab}
        badges={serviceTabBadges(operation.model, observationNeeded)}
        hidden={shouldShowReadonlyAccountSection({ uiEnabled: READONLY_ACCOUNT_UI_ENABLED, accessMethod }) ? [] : ['screen']}
      />
      {tab === 'overview' ? <ServiceNextActionPanel model={operation.model} observationNeeded={observationNeeded} /> : null}
      <ServiceTabMemory connectionId={connectionId} tab={tab} />
      {/* I-052: 관찰 결과 tab shows the latest observation first, then the evidence built from it. */}
      {ready && tab === 'results' ? (
        <ReadonlyAccountSection tenantId={actor.tenantId} connectionId={connectionId} accessMethod={accessMethod} view="result" />
      ) : null}
      {/* I-070: 화면 심사 has no summary part, so skip the empty card there. */}
      {tab !== 'screen' ? <ServiceOperationDetail model={operation.model} provider={providers[connectionId] ?? null} section={tab} /> : null}
      {tab === 'overview' && trend?.visible ? <QualityTrendPanel trend={trend} /> : null}
      {ready && tab !== 'review' && tab !== 'history' && tab !== 'screen' ? <ServiceDetailBody actor={actor} view={view} connectionId={connectionId} section={tab} /> : null}
      {ready && tab === 'connect' ? (
        <ReadonlyAccountSection tenantId={actor.tenantId} connectionId={connectionId} accessMethod={accessMethod} view="form" />
      ) : null}
      {/* I-072~I-075: render nothing unless the ownership / GA4 viewer flags are on. */}
      {ready && tab === 'connect' ? <OwnershipSection tenantId={actor.tenantId} connectionId={connectionId} accessMethod={accessMethod} /> : null}
      {ready && tab === 'connect' ? <Ga4ViewerSection connectionId={connectionId} accessMethod={accessMethod} /> : null}
      {/* I-063: 화면 심사 (screen audit) tab. */}
      {ready && tab === 'screen' ? <ScreenAuditSection tenantId={actor.tenantId} connectionId={connectionId} accessMethod={accessMethod} canJuryReview={canJuryReview} /> : null}
      {tab === 'overview' ? <GithubRefreshStatus connectionId={connectionId} /> : null}
    </JuryChrome>
  );
}
