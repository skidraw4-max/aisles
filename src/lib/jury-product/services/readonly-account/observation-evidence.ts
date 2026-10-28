/**
 * I-042: stored credential → executor → evidence/review pipeline.
 * Output carries counts and visibility only: no snapshot text, no URLs beyond the scoped path, no username/password.
 */
import type { EvidencePack } from '@/lib/ai-review-board/types';
import type { ObservationScope } from './consent';
import { decryptAccountCredential, type CredentialKeyProvider, type EncryptedAccountCredential } from './credential-crypto';
import type { DiscoveryOptions, PageStats } from './discovery';
import { toBlockedDetails, type BlockedDetail } from './blocked-details';
import { blockedHostCounts } from './same-site';
import { runReadonlyObservation, type ExecutorReport, type LoginPlan, type ObservationAction, type ObservationDriver } from './executor';

export type ObservedPage = { label: string; path: string; visible: boolean; textLength: number; discovered?: boolean; stats?: PageStats };

export type ObservationSummary = {
  source: 'READ_ONLY_ACCOUNT';
  ok: boolean;
  stop: ExecutorReport['stop'] | null;
  challenge: ExecutorReport['challenge'] | null;
  loginAttempts: number;
  pagesObserved: number;
  pages: ObservedPage[];
  /** I-049: auto-discovery outcome (not persisted as a column; pages carry discovered=true). */
  discovery: ExecutorReport['discovery'] | null;
  blockedRequestCount: number;
  blockedByReason: Record<'ORIGIN' | 'METHOD' | 'FORM_SUBMIT' | 'LOGIN_ALREADY_USED', number> & { STUBBED?: number };
  /** I-055: blocked request hostnames → count (no paths/queries), top 20. */
  blockedHosts: Record<string, number>;
  /** I-096: first BLOCKED_DETAILS_CAP blocked requests (origin+path, method, reason, page, time). */
  blockedDetails?: BlockedDetail[];
  /** I-047: origin + path of the last page (no query string). */
  finalOrigin: string | null;
  finalPath: string | null;
  /** I-056: diagnosis for stopped runs (step names only). */
  failedStep?: ExecutorReport['failedStep'] | null;
  missingField?: ExecutorReport['missingField'] | null;
  piiExcluded: true;
  readOnly: true;
};

function finalOf(url: string | undefined): { finalOrigin: string | null; finalPath: string | null } {
  if (!url) return { finalOrigin: null, finalPath: null };
  try {
    const u = new URL(url);
    return { finalOrigin: u.origin, finalPath: u.pathname };
  } catch {
    return { finalOrigin: null, finalPath: null };
  }
}

function pathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return '';
  }
}

/** I-045: method + origin + path only (no query string, no headers/bodies/values). */
export function describeBlockedRequests(report: ExecutorReport): { method: string; origin: string; path: string; reason: string }[] {
  return report.blockedRequests.map((b) => {
    try {
      const u = new URL(b.url);
      return { method: b.method, origin: u.origin, path: u.pathname, reason: b.reason };
    } catch {
      return { method: b.method, origin: 'invalid', path: '', reason: b.reason };
    }
  });
}

export function logBlockedRequests(report: ExecutorReport, connectionId: string, log: (line: string) => void = console.info): void {
  log(
    JSON.stringify({
      event: 'readonly_account_observation',
      connectionId,
      ok: report.ok,
      stop: report.stop ?? null,
      failedStep: report.failedStep ?? null,
      elapsedMs: report.elapsedMs ?? null,
      missingField: report.missingField ?? null,
      loginAttempts: report.loginAttempts,
      loginRequestUsed: report.loginRequestUsed ?? null,
      finalUrl: report.finalUrl ?? null,
      // I-047: per-page counts only; page text is never logged.
      pagesObserved: report.snapshots.length,
      pages: report.snapshots.map((s) => ({ label: s.label.slice(0, 64), visible: s.text.trim().length > 0, textLength: s.text.length })),
      discovery: report.discovery ?? null,
      // I-056: counts first so the line stays useful when the log viewer truncates it; list capped at 40.
      blockedCount: report.blockedRequests.length,
      blockedHosts: blockedHostCounts(report.blockedRequests),
      blocked: describeBlockedRequests(report).slice(0, 40),
    }),
  );
}

export function summarizeObservation(report: ExecutorReport): ObservationSummary {
  // I-097: STUBBED (answered locally) is reported separately and not counted as blocked.
  const blockedByReason: ObservationSummary['blockedByReason'] = { ORIGIN: 0, METHOD: 0, FORM_SUBMIT: 0, LOGIN_ALREADY_USED: 0 };
  const hardBlocked = report.blockedRequests.filter((b) => b.reason !== 'STUBBED');
  const stubbed = report.blockedRequests.length - hardBlocked.length;
  for (const b of hardBlocked) blockedByReason[b.reason as keyof typeof blockedByReason] += 1;
  if (stubbed > 0) blockedByReason.STUBBED = stubbed;
  const pages: ObservedPage[] = report.snapshots.map((s) => ({
    label: s.label.slice(0, 64),
    path: pathOf(s.url),
    visible: s.text.trim().length > 0,
    textLength: s.text.length,
    ...(s.discovered ? { discovered: true } : {}),
    ...(s.stats ? { stats: s.stats } : {}),
  }));
  return {
    source: 'READ_ONLY_ACCOUNT',
    ok: report.ok,
    stop: report.stop ?? null,
    challenge: report.challenge ?? null,
    loginAttempts: report.loginAttempts,
    pagesObserved: pages.length,
    pages,
    discovery: report.discovery ?? null,
    blockedRequestCount: hardBlocked.length,
    blockedByReason,
    blockedHosts: blockedHostCounts(hardBlocked),
    blockedDetails: toBlockedDetails(report.blockedRequests),
    ...finalOf(report.finalUrl),
    failedStep: report.failedStep ?? null,
    missingField: report.missingField ?? null,
    piiExcluded: true,
    readOnly: true,
  };
}

/** Feeds the summary into an existing EvidencePack as reviewer hints (aggregates are never overwritten). */
export function attachObservationToPack(
  pack: EvidencePack,
  summary: Pick<ObservationSummary, 'ok' | 'pagesObserved' | 'pages' | 'blockedRequestCount' | 'blockedByReason'> & { stop?: string | null; challenge?: string | null },
): EvidencePack {
  const visible = summary.pages.filter((p) => p.visible).length;
  const hints = [
    `READ_ONLY_ACCOUNT observation: ok=${summary.ok}${summary.stop ? ` stop=${summary.stop}` : ''}${summary.challenge ? ` challenge=${summary.challenge}` : ''}`,
    `READ_ONLY_ACCOUNT pages: observed=${summary.pagesObserved} visible=${visible} (${summary.pages.map((p) => `${p.label}:${p.visible ? 'visible' : 'empty'}${p.stats ? ` [${p.path} lists=${p.stats.listItems} cards=${p.stats.cards} rows=${p.stats.tableRows} headings=${p.stats.headings}]` : ''}`).join(', ') || 'none'})`,
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
  scope: ObservationScope;
  login: LoginPlan;
  actions: ObservationAction[];
  discover?: Partial<DiscoveryOptions> | false;
  now?: Date;
  /** Defaults to READONLY_ACCOUNT_EXECUTOR_ENABLED. */
  executorEnabled?: boolean;
  /** I-059: screen audit hook. */
  onPage?: (page: { label: string; url: string }) => Promise<void>;
  /** I-069: earlier-observation paths visited first (screen audit). */
  seedPaths?: readonly string[];
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
  const report = await runReadonlyObservation({ driver: input.driver, credential: dec.secret, scope: input.scope, login: input.login, actions: input.actions, discover: input.discover, onPage: input.onPage, seedPaths: input.seedPaths }, input.executorEnabled);
  logBlockedRequests(report, input.context.connectionId);
  return { ok: true, summary: summarizeObservation(report) };
}
