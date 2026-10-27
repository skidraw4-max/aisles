/**
 * I-076: GA4 Data API (REST, v1beta runReport) with the Jury service-account token.
 * Validation: activeUsers for the last 7 days, limit 1. Evidence: totals + tracked events + top pages,
 * shaped as the existing Ga4ReportBundle so ai-review-board summarises it unchanged.
 */
import { TRACKED_GA4_EVENT_NAMES, type Ga4ReportBundle, type Ga4ReportFetcher } from '@/lib/ai-review-board/ga4-evidence';
import { getGa4AccessToken, type FetchLike, type Ga4TokenFailure } from './credentials';
import type { EnvLike } from '../phase1-flags';

export const GA4_PROPERTY_ID_PATTERN = /^\d{5,15}$/;

export function normalizeGa4PropertyId(input: string): string | null {
  const v = String(input ?? '').trim().replace(/^properties\//, '');
  return GA4_PROPERTY_ID_PATTERN.test(v) ? v : null;
}

export type Ga4ValidationFailure = 'INVALID_PROPERTY_ID' | 'PERMISSION_DENIED' | 'NOT_FOUND' | 'API_ERROR' | Ga4TokenFailure;

type Row = { dimensionValues?: { value?: string }[]; metricValues?: { value?: string }[] };
type ReportResponse = { rows?: Row[]; error?: { status?: string; code?: number } };

const defaultFetch: FetchLike = (url, init) => fetch(url, init) as unknown as ReturnType<FetchLike>;

function mapApiError(status: number, body: ReportResponse): Ga4ValidationFailure {
  const s = body.error?.status;
  if (status === 403 || s === 'PERMISSION_DENIED') return 'PERMISSION_DENIED';
  if (status === 404 || s === 'NOT_FOUND') return 'NOT_FOUND';
  return 'API_ERROR';
}

async function runReport(token: string, propertyId: string, request: Record<string, unknown>, f: FetchLike) {
  const res = await f(`https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(request),
  });
  const body = (await res.json().catch(() => ({}))) as ReportResponse;
  return { ok: res.ok, status: res.status, body };
}

export async function validateGa4ViewerAccess(
  propertyInput: string,
  deps: { env?: EnvLike; fetch?: FetchLike; oidcToken?: () => Promise<string | null> } = {},
): Promise<{ ok: true; propertyId: string } | { ok: false; code: Ga4ValidationFailure }> {
  const propertyId = normalizeGa4PropertyId(propertyInput);
  if (!propertyId) return { ok: false, code: 'INVALID_PROPERTY_ID' };
  const token = await getGa4AccessToken(deps);
  if (!token.ok) return { ok: false, code: token.code };
  try {
    const r = await runReport(
      token.accessToken,
      propertyId,
      { dateRanges: [{ startDate: '7daysAgo', endDate: 'today' }], metrics: [{ name: 'activeUsers' }], limit: 1 },
      deps.fetch ?? defaultFetch,
    );
    return r.ok ? { ok: true, propertyId } : { ok: false, code: mapApiError(r.status, r.body) };
  } catch {
    return { ok: false, code: 'API_ERROR' };
  }
}

function metric(row: Row | undefined, i: number): number | null {
  const raw = row?.metricValues?.[i]?.value;
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** Ga4ReportFetcher that ignores the env credentials argument and uses the Jury service account. */
export function createJuryGa4ReportFetcher(deps: { env?: EnvLike; fetch?: FetchLike; oidcToken?: () => Promise<string | null> } = {}): Ga4ReportFetcher {
  return async (input): Promise<Ga4ReportBundle> => {
    const token = await getGa4AccessToken(deps);
    if (!token.ok) throw new Error(token.code === 'NOT_CONFIGURED' ? 'GA4 viewer not configured' : 'GA4 viewer permission token failed');
    const f = deps.fetch ?? defaultFetch;
    const dateRanges = [input.range];
    const totalsRes = await runReport(
      token.accessToken,
      input.propertyId,
      {
        dateRanges,
        metrics: ['activeUsers', 'newUsers', 'totalUsers', 'sessions', 'screenPageViews', 'engagedSessions', 'engagementRate', 'averageSessionDuration', 'userEngagementDuration'].map((name) => ({ name })),
      },
      f,
    );
    if (!totalsRes.ok) throw new Error(mapApiError(totalsRes.status, totalsRes.body) === 'PERMISSION_DENIED' ? 'permission denied' : 'GA4 API error');
    const t = totalsRes.body.rows?.[0];
    const sessions = metric(t, 3);
    const engagement = metric(t, 8);
    const eventsRes = await runReport(
      token.accessToken,
      input.propertyId,
      {
        dateRanges,
        dimensions: [{ name: 'eventName' }],
        metrics: [{ name: 'eventCount' }],
        dimensionFilter: { filter: { fieldName: 'eventName', inListFilter: { values: [...TRACKED_GA4_EVENT_NAMES] } } },
        limit: 100,
      },
      f,
    );
    const pagesRes = await runReport(
      token.accessToken,
      input.propertyId,
      { dateRanges, dimensions: [{ name: 'pagePath' }], metrics: [{ name: 'screenPageViews' }], orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }], limit: 10 },
      f,
    );
    return {
      totals: {
        activeUsers: metric(t, 0),
        newUsers: metric(t, 1),
        totalUsers: metric(t, 2),
        sessions,
        screenPageViews: metric(t, 4),
        engagedSessions: metric(t, 5),
        engagementRate: metric(t, 6),
        averageSessionDuration: metric(t, 7),
        averageEngagementTime: sessions != null && sessions > 0 && engagement != null ? engagement / sessions : null,
      },
      eventRows: (eventsRes.ok ? eventsRes.body.rows ?? [] : [])
        .map((r) => ({ eventName: r.dimensionValues?.[0]?.value ?? '', eventCount: metric(r, 0) ?? 0 }))
        .filter((r) => r.eventName),
      topPages: (pagesRes.ok ? pagesRes.body.rows ?? [] : [])
        .map((r) => ({ path: r.dimensionValues?.[0]?.value ?? '', views: metric(r, 0) ?? 0 }))
        .filter((r) => r.path),
    };
  };
}
