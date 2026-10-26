/**
 * Service detail section for READ_ONLY_ACCOUNT (I-040 UI wiring). Server component.
 * Renders nothing unless READONLY_ACCOUNT_UI_ENABLED is on (enabled in I-044) and the connection uses READ_ONLY_ACCOUNT.
 * State is loaded only when shown, so no DB query runs while the flag is off.
 */
import * as React from 'react';
import { READONLY_ACCOUNT_PHASE1_ENABLED, READONLY_ACCOUNT_UI_ENABLED, shouldShowReadonlyAccountSection } from '@/lib/jury-product/services/readonly-account/flags';
import { READONLY_ACCOUNT_CONSENT_VERSION } from '@/lib/jury-product/services/readonly-account/consent-text';
import { loadLatestObservationRun, type LatestObservationRun } from '@/lib/jury-product/services/readonly-account/latest-observation';
import { ReadOnlyAccountCredentialForm } from './ReadOnlyAccountCredentialForm';
import { acceptReadonlyAccountConsentAction, runReadonlyAccountObservationAction, storeReadonlyAccountCredentialAction } from './readonly-account-actions';

export type ReadonlyAccountSectionState = {
  consentAccepted: boolean;
  stored: { usernameHint: string; expiresAt: string } | null;
  latestRun?: LatestObservationRun | null;
};

async function loadState(tenantId: string, connectionId: string) {
  const { prisma } = await import('@/lib/prisma');
  const [consent, credential, latestRun] = await Promise.all([
    prisma.juryConnectionConsent.findFirst({ where: { tenantId, connectionId, version: READONLY_ACCOUNT_CONSENT_VERSION }, select: { id: true } }),
    prisma.juryAccountCredential.findFirst({ where: { tenantId, connectionId, destroyedAt: null }, orderBy: { createdAt: 'desc' }, select: { usernameHint: true, expiresAt: true } }),
    loadLatestObservationRun(prisma, tenantId, connectionId).catch(() => null),
  ]);
  const state: ReadonlyAccountSectionState = {
    consentAccepted: Boolean(consent),
    stored: credential ? { usernameHint: credential.usernameHint ?? '', expiresAt: credential.expiresAt.toISOString() } : null,
    latestRun,
  };
  return state;
}

async function consentFormAction(_prev: unknown, formData: FormData) {
  'use server';
  return acceptReadonlyAccountConsentAction(formData);
}

async function credentialFormAction(_prev: unknown, formData: FormData) {
  'use server';
  return storeReadonlyAccountCredentialAction(formData);
}

async function observationFormAction(_prev: unknown, formData: FormData) {
  'use server';
  return runReadonlyAccountObservationAction(formData);
}

export async function ReadonlyAccountSection(props: {
  tenantId: string;
  connectionId: string;
  accessMethod: string | null | undefined;
  uiEnabled?: boolean;
  load?: typeof loadState;
  className?: string;
}) {
  if (!shouldShowReadonlyAccountSection({ uiEnabled: props.uiEnabled ?? READONLY_ACCOUNT_UI_ENABLED, accessMethod: props.accessMethod })) return null;
  const state = await (props.load ?? loadState)(props.tenantId, props.connectionId);
  return (
    <ReadOnlyAccountCredentialForm
      connectionId={props.connectionId}
      enabled={READONLY_ACCOUNT_PHASE1_ENABLED}
      consentAccepted={state.consentAccepted}
      stored={state.stored ?? undefined}
      latestRun={state.latestRun ?? null}
      consentAction={consentFormAction}
      credentialAction={credentialFormAction}
      observationAction={observationFormAction}
      classes={{ root: props.className }}
    />
  );
}
