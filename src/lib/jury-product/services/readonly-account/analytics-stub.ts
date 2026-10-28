/**
 * I-097: well-known analytics / ad / tag hosts. GET/HEAD subresource requests to these hosts are answered locally
 * (no outbound traffic) instead of aborted, so pages that assume gtag/dataLayer/adsbygoogle exist keep rendering.
 * Scripts get a tiny no-op shim (200, application/javascript); everything else gets 204. Navigation, form submits
 * and non-GET methods are never stubbed (still blocked by the normal policy). Keep this list explicit and small.
 */
export const ANALYTICS_STUB_HOSTS: readonly string[] = [
  'googletagmanager.com',
  'google-analytics.com',
  'analytics.google.com',
  'googlesyndication.com',
  'doubleclick.net',
  'googleadservices.com',
  'adservice.google.com',
  'connect.facebook.net',
  'static.cloudflareinsights.com',
];

const STUB_METHODS = new Set(['GET', 'HEAD']);

export function isAnalyticsStubHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/\.$/, '');
  return ANALYTICS_STUB_HOSTS.some((d) => h === d || h.endsWith(`.${d}`));
}

export function isAnalyticsStubRequest(req: { method: string; url: string; isNavigation: boolean; isFormSubmit: boolean }): boolean {
  if (req.isNavigation || req.isFormSubmit || !STUB_METHODS.has(req.method.toUpperCase())) return false;
  try {
    const u = new URL(req.url);
    return u.protocol === 'https:' && !u.username && !u.password && isAnalyticsStubHost(u.hostname);
  } catch {
    return false;
  }
}

/** No-op shim: defines the common globals only when absent; never makes network calls. */
export const ANALYTICS_STUB_SCRIPT = `(function(){try{var w=window;w.dataLayer=w.dataLayer||[];if(typeof w.gtag!=='function'){w.gtag=function(){w.dataLayer.push(arguments);};}w.adsbygoogle=w.adsbygoogle||[];if(typeof w.fbq!=='function'){var f=function(){};f.queue=[];f.push=f;f.loaded=true;w.fbq=f;}}catch(e){}})();`;

export type StubResponse = { status: number; contentType?: string; body: string };

export function analyticsStubResponse(resourceType: string | undefined): StubResponse {
  if (resourceType === 'script') return { status: 200, contentType: 'application/javascript; charset=utf-8', body: ANALYTICS_STUB_SCRIPT };
  return { status: 204, body: '' };
}
