/** Jury entry check. Hub signup and confirmation settings stay unchanged. */
export function juryEmailVerification(
  user: { email_confirmed_at?: string | null } | null,
): 'verified' | 'unauthenticated' | 'unverified' {
  if (!user) return 'unauthenticated';
  if (!user.email_confirmed_at) return 'unverified';
  return 'verified';
}
