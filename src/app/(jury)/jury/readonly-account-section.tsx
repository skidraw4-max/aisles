/**
 * Service detail section for READ_ONLY_ACCOUNT (I-040 UI wiring). Server component.
 * Renders nothing unless READONLY_ACCOUNT_UI_ENABLED is on and the connection uses READ_ONLY_ACCOUNT.
 * State is loaded only when shown, so no DB query runs while the flag is off.
 */
import * as React from 'react';
import { READONLY_ACCOUNT_PHASE1_ENABLED, READONLY_ACCOUNT_UI_ENABLED, shouldShowReadonlyAccountSection } from '@/lib/jury-product/services/readonly-account/flags';
import { ReadOnlyAccountCredentialForm } from './ReadOnlyAccountCredentialForm';
import { acceptReadonlyAccountConsentAction, storeReadonlyAccountCredentialAction } from './readonly-account-actions';

export type ReadonlyAccountSectionState = { consentAccepted: boolean; stored: { usernameHint: string; expiresAt: string } | null };

async function loadState(tenantId: string, connectionId: string) {
  const { prisma } = await import('@/lib/prisma');
  const [consent, credential] = await Promise.all([
    prisma.juryConnectionConsent.findFirst({ where: { tenantId, connectionId }, select: { id: true } }),
    prisma.juryAccountCredential.findFirst({ where: { tenantId, connectionId, destroyedAt: null }, orderBy: { createdAt: 'desc' }, select: { usernameHint: true, expiresAt: true } }),
  ]);
  const state: ReadonlyAccountSectionState = {
    consentAccepted: Boolean(consent),
    stored: credential ? { usernameHint: credential.usernameHint ?? '', expiresAt: credential.expiresAt.toISOString() } : null,
  };
  return state;
}

async function consentFormAction(formData: FormData) {
  'use server';
  await acceptReadonlyAccountConsentAction(formData);
}

async function credentialFormAction(formData: FormData) {
  'use server';
  await storeReadonlyAccountCredentialAction(formData);
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
      consentAction={consentFormAction}
      credentialAction={credentialFormAction}
      classes={{ root: props.className }}
    />
  );
}
