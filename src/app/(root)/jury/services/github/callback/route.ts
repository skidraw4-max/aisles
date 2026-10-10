import { NextResponse } from 'next/server';
import { juryHref, juryLoginHref } from '@/lib/jury-product/jury-url';
import { getJuryActor } from '@/lib/jury-product/session';
import type { ProviderErrorCode } from '@/lib/jury-product/services/provider-types';
import { finishGithubCallback } from '@/lib/jury-product/services/github/store';

const RESULTS: Partial<Record<ProviderErrorCode, string>> = {
  GITHUB_NOT_CONFIGURED: 'not-configured',
  GITHUB_UNAUTHORIZED: 'unauthorized',
  GITHUB_FORBIDDEN: 'forbidden',
  GITHUB_NOT_FOUND: 'not-found',
  GITHUB_RATE_LIMIT: 'rate-limit',
  GITHUB_UNAVAILABLE: 'unavailable',
  GITHUB_STATE_INVALID: 'state-invalid',
  CONNECTION_NOT_FOUND: 'not-found',
  CONNECTION_UNAUTHORIZED: 'forbidden',
  PROVIDER_UNAVAILABLE: 'unavailable',
  SECRET_REJECTED: 'unavailable',
  DISCOVERY_FAILED: 'unavailable',
};

export async function GET(request: Request): Promise<NextResponse> {
  const actor = await getJuryActor(null);
  if (!actor.ok) {
    return NextResponse.redirect(new URL(juryLoginHref('/jury/services/github'), request.url));
  }
  const url = new URL(request.url);
  const installationId = url.searchParams.get('installation_id') ?? '';
  const setupAction = url.searchParams.get('setup_action') ?? '';
  const state = url.searchParams.get('state') ?? '';
  if (!/^\d{1,12}$/.test(installationId) || (setupAction !== 'install' && setupAction !== 'update') || state.length === 0) {
    return NextResponse.redirect(new URL(juryHref('/services/github', { result: 'state-invalid' }), request.url));
  }
  const finished = await finishGithubCallback({
    actor,
    state,
    installationId,
    setupAction,
    clientTenantId: null,
    clientOrganizationId: null,
    clientUserId: null,
    clientRole: null,
    clientPermission: null,
  });
  const result = finished.ok ? 'connected' : RESULTS[finished.code] ?? 'unavailable';
  return NextResponse.redirect(new URL(juryHref('/services/github', { result }), request.url));
}
