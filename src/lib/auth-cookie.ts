/** Cookie names that mean a Supabase SSR session exists (not PKCE verifier). */
const AUTH_TOKEN_COOKIE = /^sb-.+-auth-token(?:\.\d+)?$/;

export function hasSupabaseAuthCookie(cookies: readonly { name: string }[]): boolean {
  return cookies.some((cookie) => AUTH_TOKEN_COOKIE.test(cookie.name));
}
