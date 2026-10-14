/** Jury signup checks. Same email shape and minimum length as hub signup. */

export const JURY_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const JURY_MIN_PASSWORD = 6;

export type JurySignupIssue =
  | 'email_required'
  | 'email_invalid'
  | 'password_required'
  | 'password_short'
  | 'password_mismatch';

export type JurySignUpOutcome = 'verify' | 'enter' | 'existing' | 'failed';

const ISSUE_MESSAGE: Record<JurySignupIssue, string> = {
  email_required: 'Email is required.',
  email_invalid: 'Enter a valid email.',
  password_required: 'Password is required.',
  password_short: 'Password must be at least 6 characters.',
  password_mismatch: 'Passwords do not match.',
};

export function validateJurySignup(input: {
  email: string;
  password: string;
  confirmPassword: string;
}): JurySignupIssue | null {
  const email = input.email.trim();
  if (!email) return 'email_required';
  if (!JURY_EMAIL_RE.test(email)) return 'email_invalid';
  if (!input.password) return 'password_required';
  if (input.password.length < JURY_MIN_PASSWORD) return 'password_short';
  if (input.password !== input.confirmPassword) return 'password_mismatch';
  return null;
}

export function jurySignupIssueMessage(issue: JurySignupIssue): string {
  return ISSUE_MESSAGE[issue];
}

export function maskJuryEmail(email: string): string {
  const at = email.indexOf('@');
  if (at <= 0 || at !== email.lastIndexOf('@')) return '***';
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (!domain) return '***';
  return `${local.slice(0, 1)}***@${domain}`;
}

/** Known auth failures only. Never return the provider's raw text. */
export function juryAuthErrorMessage(raw: string | null | undefined): string {
  const text = (raw ?? '').toLowerCase();
  if (/already been registered|already exists|already registered|duplicate/.test(text)) {
    return 'This email is already registered. Sign in instead.';
  }
  if (/password/.test(text) && /weak|short|least|6|character/.test(text)) {
    return 'Password must be at least 6 characters.';
  }
  if (/invalid/.test(text) && /email/.test(text)) return 'Enter a valid email.';
  if (/rate limit|too many/.test(text)) return 'Too many attempts. Wait a moment and try again.';
  return 'Could not create the account. Try again.';
}

export function classifyJurySignUpResult(result: {
  errorMessage?: string | null;
  user?: { email_confirmed_at?: string | null; identities?: unknown[] | null } | null;
  session?: unknown | null;
}): JurySignUpOutcome {
  if (result.errorMessage && /already been registered|already exists|already registered|duplicate/i.test(result.errorMessage)) {
    return 'existing';
  }
  if (result.errorMessage) return 'failed';
  const identities = result.user?.identities;
  if (Array.isArray(identities) && identities.length === 0) return 'existing';
  if (result.user?.email_confirmed_at && result.session) return 'enter';
  if (result.user) return 'verify';
  return 'failed';
}
