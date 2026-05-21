/** Post-login retention welcome toast — set before redirect, read once after auth. */
export const RETENTION_WELCOME_KEY = 'aisle:retention-welcome';

export type RetentionWelcomeReason = 'bookmarks' | 'subscribe';

export function setRetentionWelcomePending(reason: RetentionWelcomeReason): void {
  try {
    sessionStorage.setItem(RETENTION_WELCOME_KEY, reason);
  } catch {
    /* ignore */
  }
}

export function peekRetentionWelcomeReason(): RetentionWelcomeReason | null {
  try {
    const v = sessionStorage.getItem(RETENTION_WELCOME_KEY);
    if (v === 'bookmarks' || v === 'subscribe') return v;
  } catch {
    /* ignore */
  }
  return null;
}

export function clearRetentionWelcomePending(): void {
  try {
    sessionStorage.removeItem(RETENTION_WELCOME_KEY);
  } catch {
    /* ignore */
  }
}
