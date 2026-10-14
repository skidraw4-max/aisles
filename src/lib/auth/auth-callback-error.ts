/**
 * Auth callback failure classification. Client/server-safe; no Supabase text is ever surfaced.
 * Only these fixed `?error=` values reach the login pages.
 */

/** Email link (verifyOtp) failure. Existing value; keeps the email-link-expired notice. */
export const AUTH_CALLBACK_EMAIL_QUERY = 'auth_callback' as const;
/** Sign-in callback failure that is not an email link (OAuth provider error, code exchange, missing params). */
export const AUTH_CALLBACK_SIGNIN_QUERY = 'oauth_callback' as const;

/** Fixed marker on email-verification redirect URLs. Only selects the failure message; never trusted for auth. */
export const AUTH_CALLBACK_FLOW_PARAM = 'flow' as const;
export const AUTH_CALLBACK_EMAIL_FLOW = 'email' as const;

/** True only for the exact marker value; missing or unknown values keep OAuth behavior. */
export function isEmailLinkFlow(value: string | null | undefined): boolean {
  return value === AUTH_CALLBACK_EMAIL_FLOW;
}

/** Adds `flow=email` to an absolute callback URL, keeping existing query (e.g. `next`). */
export function withEmailFlowMarker(redirectTo: string): string {
  const url = new URL(redirectTo);
  url.searchParams.set(AUTH_CALLBACK_FLOW_PARAM, AUTH_CALLBACK_EMAIL_FLOW);
  return url.href;
}

export type AuthCallbackFailure =
  | 'provider_error'
  | 'code_exchange_failed'
  | 'code_no_session'
  | 'missing_params'
  | 'otp_failed'
  | 'otp_no_session';

/**
 * Login `?error=` value for a failure. Fixed-path flows (password reset) are email links only,
 * so they keep the existing email value.
 */
export function authCallbackFailureQuery(kind: AuthCallbackFailure, emailLinkFlow = false): string {
  if (emailLinkFlow || kind === 'otp_failed' || kind === 'otp_no_session') return AUTH_CALLBACK_EMAIL_QUERY;
  return AUTH_CALLBACK_SIGNIN_QUERY;
}

/** Allowlisted error code for logs: lowercase/underscore only; anything else is replaced. */
export function safeAuthErrorCode(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw === '') return null;
  return /^[a-z_]{1,64}$/.test(raw) ? raw : 'unrecognized';
}

/** Log text: classification plus allowlisted codes only (never code, token, cookie, or description). */
export function authCallbackLogLine(
  kind: AuthCallbackFailure,
  detail: { error?: unknown; errorCode?: unknown; emailFlow?: boolean } = {},
): string {
  const parts = [`kind=${kind}`];
  if (detail.emailFlow) parts.push('email_flow=true');
  const error = safeAuthErrorCode(detail.error);
  const errorCode = safeAuthErrorCode(detail.errorCode);
  if (error) parts.push(`error=${error}`);
  if (errorCode) parts.push(`error_code=${errorCode}`);
  return parts.join(' ');
}
