import type { JuryEntry } from './session';
import { juryCallbackNext, juryHref, safeJuryNext } from './jury-url';

export type JuryLoginOutcome =
  | { kind: 'redirect'; href: string }
  | { kind: 'form'; notice?: 'EMAIL_UNVERIFIED' | 'STORE_UNAVAILABLE' };

/**
 * Jury login page decision. Redirect targets come only from safeJuryNext / juryHref.
 * AMBIGUOUS_MEMBERSHIP keeps the form: resolveJuryActor does not return it today and
 * /jury has no organization picker for it.
 */
export function juryLoginOutcome(
  entry: JuryEntry,
  returnQuery: string | null,
  configuredOrigin?: string | null,
): JuryLoginOutcome {
  if (entry.ok) return { kind: 'redirect', href: safeJuryNext(returnQuery, configuredOrigin) };
  if (entry.reason === 'NO_MEMBERSHIP') {
    // Only a well-formed invitation path (existing callback policy) wins over organization creation.
    if (juryCallbackNext(returnQuery) !== '/jury') {
      return { kind: 'redirect', href: safeJuryNext(returnQuery, configuredOrigin) };
    }
    return { kind: 'redirect', href: juryHref('/organization/create', undefined, configuredOrigin) };
  }
  if (entry.reason === 'STORE_UNAVAILABLE') return { kind: 'form', notice: 'STORE_UNAVAILABLE' };
  if (entry.reason === 'EMAIL_UNVERIFIED') return { kind: 'form', notice: 'EMAIL_UNVERIFIED' };
  return { kind: 'form' };
}
