/**
 * Service detail section for READ_ONLY_ACCOUNT (I-040 UI wiring). Server component.
 * Renders nothing unless READONLY_ACCOUNT_UI_ENABLED is on (enabled in I-044) and the connection uses READ_ONLY_ACCOUNT.
 * State is loaded only when shown, so no DB query runs while the flag is off.
 */
import * as React from 'react';
import { READONLY_ACCOUNT_PHASE1_ENABLED, READONLY_ACCOUNT_UI_ENABLED, shouldShowReadonlyAccountSection } from '@/lib/jury-product/services/readonly-account/flags';
import { READONLY_ACCOUNT_CONSENT_VERSION } from '@/lib/jury-product/services/readonly-account/consent-text';
import { loadLatestObservationRun, type LatestObservationRun } from '@/lib/jury-product/services/readonly-account/latest-observation';
import { readonlySectionMode } from '@/lib/jury-product/services/readonly-account/flow';
import { storedConsentScope } from '@/lib/jury-product/services/readonly-account/consent';
import { storedLoginPlan } from '@/lib/jury-product/services/readonly-account/observation-run';
import styles from './jury.module.css';
import { LatestObservationResult, ReadOnlyAccountCredentialForm, type StoredLoginView, type StoredScopeView } from './ReadOnlyAccountCredentialForm';
import { acceptReadonlyAccountConsentAction, runReadonlyAccountObservationAction, storeReadonlyAccountCredentialAction } from './readonly-account-actions';

export type ReadonlyAccountSectionState = {
  consentAccepted: boolean;
  stored: { usernameHint: string; expiresAt: string } | null;
  latestRun?: LatestObservationRun | null;
  /** I-054: hash-verified scope / login plan saved with the latest consent (null for older consents). */
  scope?: StoredScopeView | null;
  login?: StoredLoginView | null;
  /** Any consent exists (possibly an outdated version): ① then reopens with a re-consent notice. */
  hadConsent?: boolean;
};


/** I-054: true when a READ_ONLY_ACCOUNT connection has no successful observation yet (header 다음 할 일 → 관찰 실행). */
export async function readonlyObservationNeeded(input: { tenantId: string; connectionId: string; accessMethod: string | null | undefined; uiEnabled?: boolean }): Promise<boolean> {
  if (!shouldShowReadonlyAccountSection({ uiEnabled: input.uiEnabled ?? READONLY_ACCOUNT_UI_ENABLED, accessMethod: input.accessMethod })) return false;
  try {
    const { prisma } = await import('@/lib/prisma');
    const ok = await prisma.juryReadonlyObservationRun.findFirst({ where: { tenantId: input.tenantId, connectionId: input.connectionId, ok: true }, select: { id: true } });
    return !ok;
  } catch {
    return false;
  }
}

function scopeView(consent: { version: string; scopeHash: string; scope: unknown } | null): StoredScopeView | null {
  const scope = storedConsentScope(consent);
  return scope ? { allowedOrigins: scope.allowedOrigins, authOrigins: scope.authOrigins ?? [], paths: scope.paths } : null;
}

async function loadState(tenantId: string, connectionId: string) {
  const { prisma } = await import('@/lib/prisma');
  const [consent, credential, latestRun] = await Promise.all([
    prisma.juryConnectionConsent.findFirst({
      // Latest consent of any version: an outdated one counts as "needs re-consent", not as done.
      where: { tenantId, connectionId },
      orderBy: { acceptedAt: 'desc' },
      select: { id: true, version: true, scopeHash: true, scope: true, loginSettings: true },
    }),
    prisma.juryAccountCredential.findFirst({ where: { tenantId, connectionId, destroyedAt: null }, orderBy: { createdAt: 'desc' }, select: { usernameHint: true, expiresAt: true } }),
    loadLatestObservationRun(prisma, tenantId, connectionId).catch(() => null),
  ]);
  const state: ReadonlyAccountSectionState = {
    consentAccepted: consent?.version === READONLY_ACCOUNT_CONSENT_VERSION,
    hadConsent: Boolean(consent),
    stored: credential ? { usernameHint: credential.usernameHint ?? '', expiresAt: credential.expiresAt.toISOString() } : null,
    latestRun,
    scope: scopeView(consent),
    login: consent ? storedLoginPlan(consent.loginSettings) : null,
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
  /** I-051: 'form' = 1-2-3 steps (연결 설정 tab), 'result' = latest observation only (관찰 결과 tab). */
  view?: 'form' | 'result';
}) {
  if (!shouldShowReadonlyAccountSection({ uiEnabled: props.uiEnabled ?? READONLY_ACCOUNT_UI_ENABLED, accessMethod: props.accessMethod })) return null;
  const state = await (props.load ?? loadState)(props.tenantId, props.connectionId);
  if (props.view === 'result') {
    return (
      <section className={props.className ?? styles.panel} aria-label="읽기 전용 관찰 결과">
        <LatestObservationResult run={state.latestRun ?? null} />
      </section>
    );
  }
  return (
    <ReadOnlyAccountCredentialForm
      connectionId={props.connectionId}
      enabled={READONLY_ACCOUNT_PHASE1_ENABLED}
      mode={readonlySectionMode(state)}
      scope={state.scope ?? null}
      login={state.login ?? null}
      consentAccepted={state.consentAccepted}
      hadConsent={state.hadConsent ?? state.consentAccepted}
      stored={state.stored ?? undefined}
      latestRun={state.latestRun ?? null}
      consentAction={consentFormAction}
      credentialAction={credentialFormAction}
      observationAction={observationFormAction}
      classes={{
        root: props.className,
        field: styles.field,
        help: styles.fieldHelp,
        required: styles.requiredMark,
        optional: styles.optionalMark,
        step: styles.stepCard,
        steps: styles.stepList,
        badge: styles.badge,
        button: styles.button,
        notice: styles.notice,
        pill: styles.stepPill,
        pillDone: styles.stepPillDone,
        pillCurrent: styles.stepPillCurrent,
        pillLocked: styles.stepPillLocked,
        success: styles.successNotice,
        primary: styles.primaryButton,
        big: styles.bigButton,
        summary: styles.stepSummary,
      }}
    />
  );
}
