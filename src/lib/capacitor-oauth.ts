import type { Provider } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getPublicSiteUrl } from '@/lib/site-url';

const NATIVE_SCHEME = 'com.aisleshub.app';

/** Capacitor WebView(네이티브) 여부. 브릿지가 주입되기 전이면 false. */
export function isCapacitorNative(): boolean {
  if (typeof window === 'undefined') return false;
  const cap = (window as Window & { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  return cap?.isNativePlatform?.() ?? false;
}

/** Supabase OAuth `redirectTo`용 커스텀 스킴 URL (웹 콜백의 쿼리 파라미터 보존). */
export function getCapacitorOAuthRedirectUrl(webCallbackUrl: string): string {
  const web = new URL(webCallbackUrl);
  const native = new URL(`${NATIVE_SCHEME}://auth/callback`);
  web.searchParams.forEach((value, key) => {
    native.searchParams.set(key, value);
  });
  return native.href;
}

function isAuthCallbackDeepLink(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== `${NATIVE_SCHEME}:`) return false;
    return (u.hostname === 'auth' && u.pathname === '/callback') || u.pathname === '/auth/callback';
  } catch {
    return false;
  }
}

function webCallbackUrlFromDeepLink(deepLinkUrl: string): string {
  const deep = new URL(deepLinkUrl);
  const base = getPublicSiteUrl().replace(/\/$/, '');
  const web = new URL('/auth/callback', `${base}/`);
  deep.searchParams.forEach((value, key) => {
    web.searchParams.set(key, value);
  });
  return web.href;
}

type OAuthOptions = {
  redirectTo: string;
  queryParams?: Record<string, string>;
};

/**
 * Google 등 OAuth: 네이티브는 시스템 브라우저 + 딥링크, 웹은 기존 리다이렉트.
 */
export async function signInWithOAuth(
  supabase: SupabaseClient,
  provider: Provider,
  options: OAuthOptions
): Promise<void> {
  if (isCapacitorNative()) {
    await signInWithOAuthNative(supabase, provider, options);
    return;
  }

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo: options.redirectTo,
      queryParams: options.queryParams,
    },
  });
  if (error) throw error;
  if (data.url) {
    window.location.assign(data.url);
    return;
  }
  throw new Error('Google 로그인 URL을 받지 못했습니다.');
}

async function signInWithOAuthNative(
  supabase: SupabaseClient,
  provider: Provider,
  options: OAuthOptions
): Promise<void> {
  const [{ App }, { Browser }] = await Promise.all([
    import('@capacitor/app'),
    import('@capacitor/browser'),
  ]);

  const nativeRedirectTo = getCapacitorOAuthRedirectUrl(options.redirectTo);

  const listener = await App.addListener('appUrlOpen', async (event) => {
    if (!isAuthCallbackDeepLink(event.url)) return;
    await listener.remove();
    try {
      await Browser.close();
    } catch {
      /* 브라우저가 이미 닫힌 경우 */
    }
    window.location.assign(webCallbackUrlFromDeepLink(event.url));
  });

  try {
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: nativeRedirectTo,
        skipBrowserRedirect: true,
        queryParams: options.queryParams,
      },
    });
    if (error) throw error;
    if (!data.url) throw new Error('Google 로그인 URL을 받지 못했습니다.');
    await Browser.open({ url: data.url });
  } catch (err) {
    await listener.remove();
    throw err;
  }
}
