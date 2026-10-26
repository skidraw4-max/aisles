/**
 * I-042: stored credential → executor → evidence/review pipeline.
 * Output carries counts and visibility only: no snapshot text, no URLs beyond the scoped path, no username/password.
 */
import type { EvidencePack } from '@/lib/ai-review-board/types';
import { decryptAccountCredential, type CredentialKeyProvider, type EncryptedAccountCredential } from './credential-crypto';
import { runReadonlyObservation, type ExecutorReport, type LoginPlan, type ObservationAction, type ObservationDriver } from './executor';

export type ObservationSummary = {
  source: 'READ_ONLY_ACCOUNT';
  ok: boolean;
  stop: ExecutorReport['stop'] | null;
  challenge: ExecutorReport['challenge'] | null;
  loginAttempts: number;
  pagesObserved: number;
  pages: { label: string; path: string; visible: boolean; textLength: number }[];
  blockedRequestCount: number;
  blockedByReason: Record<'ORIGIN' | 'METHOD' | 'FORM_SUBMIT' | 'LOGIN_ALREADY_USED', number>;
  piiExcluded: true;
  readOnly: true;
};

function pathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return '';
  }
}

export function summarizeObservation(report: ExecutorReport): ObservationSummary {
  const blockedByReason = { ORIGIN: 0, METHOD: 0, FORM_SUBMIT: 0, LOGIN_ALREADY_USED: 0 };
  for (const b of report.blockedRequests) blockedByReason[b.reason] += 1;
  const pages = report.snapshots.map((s) => ({ label: s.label.slice(0, 64), path: pathOf(s.url), visible: s.text.trim().length > 0, textLength: s.text.length }));
  return {
    source: 'READ_ONLY_ACCOUNT',
    ok: report.ok,
    stop: report.stop ?? null,
    challenge: report.challenge ?? null,
    loginAttempts: report.loginAttempts,
    pagesObserved: pages.length,
    pages,
    blockedRequestCount: report.blockedRequests.length,
    blockedByReason,
    piiExcluded: true,
    readOnly: true,
  };
}

/** Feeds the summary into an existing EvidencePack as reviewer hints (aggregates are never overwritten). */
export function attachObservationToPack(pack: EvidencePack, summary: ObservationSummary): EvidencePack {
  const visible = summary.pages.filter((p) => p.visible).length;
  const hints = [
    `READ_ONLY_ACCOUNT observation: ok=${summary.ok}${summary.stop ? ` stop=${summary.stop}` : ''}${summary.challenge ? ` challenge=${summary.challenge}` : ''}`,
    `READ_ONLY_ACCOUNT pages: observed=${summary.pagesObserved} visible=${visible} (${summary.pages.map((p) => `${p.label}:${p.visible ? 'visible' : 'empty'}`).join(', ') || 'none'})`,
    `READ_ONLY_ACCOUNT blocked requests: total=${summary.blockedRequestCount} origin=${summary.blockedByReason.ORIGIN} method=${summary.blockedByReason.METHOD} form=${summary.blockedByReason.FORM_SUBMIT} loginReuse=${summary.blockedByReason.LOGIN_ALREADY_USED}`,
  ];
  return {
    ...pack,
    site: { ...pack.site, stackNotes: [...pack.site.stackNotes, 'access: READ_ONLY_ACCOUNT (Jury-enforced read-only)'] },
    docsHints: [...pack.docsHints, ...hints],
  };
}

export type ObservationRunResult = { ok: true; summary: ObservationSummary } | { ok: false; reason: 'CREDENTIAL_UNAVAILABLE' | 'CREDENTIAL_EXPIRED' | 'DECRYPT_FAILED' };

export async function observeWithStoredCredential(input: {
  record: Omit<EncryptedAccountCredential, 'usernameHint'> & { expiresAt: Date; destroyedAt: Date | null };
  context: { tenantId: string; connectionId: string };
  provider: CredentialKeyProvider;
  driver: ObservationDriver;
  scope: { allowedOrigins: string[]; paths: string[] };
  login: LoginPlan;
  actions: ObservationAction[];
  now?: Date;
  /** Defaults to READONLY_ACCOUNT_EXECUTOR_ENABLED. */
  executorEnabled?: boolean;
}): Promise<ObservationRunResult> {
  if (input.record.destroyedAt || !input.record.ciphertext) {
    await input.driver.close().catch(() => undefined);
    return { ok: false, reason: 'CREDENTIAL_UNAVAILABLE' };
  }
  if (input.record.expiresAt.getTime() <= (input.now ?? new Date()).getTime()) {
    await input.driver.close().catch(() => undefined);
    return { ok: false, reason: 'CREDENTIAL_EXPIRED' };
  }
  const dec = await decryptAccountCredential(input.record, input.context, input.provider);
  if (!dec.ok) {
    await input.driver.close().catch(() => undefined);
    return { ok: false, reason: 'DECRYPT_FAILED' };
  }
  const report = await runReadonlyObservation({ driver: input.driver, credential: dec.secret, scope: input.scope, login: input.login, actions: input.actions }, input.executorEnabled);
  return { ok: true, summary: summarizeObservation(report) };
}
