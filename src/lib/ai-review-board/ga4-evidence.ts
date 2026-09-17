/**
 * GA4 Data API → EvidencePack.ga4 (read-only). Never overwrites DB aggregates.
 */
import type { EvidencePack } from './types';

/** Events we always request counts for (docs/ga4-events.md + Phase 1). */
export const TRACKED_GA4_EVENT_NAMES = [
  'comment_submit',
  'stance_vote',
  'feed_post_click',
  'corridor_tab_select',
  'share_click',
  'site_search',
  'digest_modal_subscribe',
  'fortune_subscribe_cta_click',
  'home_fortune_card_click',
  'launch_banner_click',
  'guest_bookmark_save',
  'related_post_click',
] as const;

export const GA4_EVIDENCE_METRIC_DEFINITIONS = {
  activeUsers:
    'GA4 activeUsers (reporting API, selected date range). NOT the same as DB aggregates.activeUsersLast7d (Post|Comment|Like|Bookmark|GameScore). Do not equate or substitute. Cite source as GA4.',
  sessions: 'GA4 sessions in the selected date range. Not DB signups or posts.',
  screenPageViews:
    'GA4 screenPageViews (web page views). NOT the same as DB viewsLast7d (PostViewDaily) or totalViews (Post.views sum). Cite source as GA4.',
  engagedSessions: 'GA4 engagedSessions in the selected date range.',
  averageSessionDurationSec:
    'GA4 averageSessionDuration in seconds (API metric averageSessionDuration).',
  eventCountByName:
    'GA4 eventCount keyed by eventName for tracked custom events only. Missing key = 0 or not fired in range.',
} as const;

export type Ga4EvidenceMetrics = {
  activeUsers: number | null;
  sessions: number | null;
  screenPageViews: number | null;
  engagedSessions: number | null;
  averageSessionDurationSec: number | null;
  eventCountByName: Record<string, number>;
};

export type Ga4EvidenceBlock = {
  available: boolean;
  propertyId: string | null;
  range: { startDate: string; endDate: string };
  fetchedAt: string | null;
  error: string | null;
  metrics: Ga4EvidenceMetrics;
  metricDefinitions: typeof GA4_EVIDENCE_METRIC_DEFINITIONS;
};

export type Ga4ServiceAccountCreds = {
  type?: string;
  client_email: string;
  private_key: string;
  [key: string]: unknown;
};

export type Ga4TotalsRow = {
  activeUsers: number | null;
  sessions: number | null;
  screenPageViews: number | null;
  engagedSessions: number | null;
  averageSessionDuration: number | null;
};

export type Ga4EventRow = { eventName: string; eventCount: number };

export type Ga4FetchInput = {
  propertyId: string;
  range: { startDate: string; endDate: string };
  credentials: Ga4ServiceAccountCreds;
};

export type Ga4ReportFetcher = (input: Ga4FetchInput) => Promise<{
  totals: Ga4TotalsRow;
  eventRows: Ga4EventRow[];
}>;

const DEFAULT_RANGE = { startDate: '7daysAgo', endDate: 'today' } as const;

function emptyMetrics(): Ga4EvidenceMetrics {
  return {
    activeUsers: null,
    sessions: null,
    screenPageViews: null,
    engagedSessions: null,
    averageSessionDurationSec: null,
    eventCountByName: {},
  };
}

export function emptyGa4EvidenceUnavailable(error: string): Ga4EvidenceBlock {
  return {
    available: false,
    propertyId: null,
    range: { ...DEFAULT_RANGE },
    fetchedAt: null,
    error,
    metrics: emptyMetrics(),
    metricDefinitions: GA4_EVIDENCE_METRIC_DEFINITIONS,
  };
}

export function parseGa4ServiceAccountJson(
  raw: string | undefined | null,
): Ga4ServiceAccountCreds | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;

  const tryParse = (s: string): Ga4ServiceAccountCreds | null => {
    try {
      const obj = JSON.parse(s) as Ga4ServiceAccountCreds;
      if (
        typeof obj?.client_email === 'string' &&
        typeof obj?.private_key === 'string' &&
        obj.client_email &&
        obj.private_key
      ) {
        return obj;
      }
      return null;
    } catch {
      return null;
    }
  };

  const direct = tryParse(trimmed);
  if (direct) return direct;

  try {
    const decoded = Buffer.from(trimmed, 'base64').toString('utf8');
    return tryParse(decoded);
  } catch {
    return null;
  }
}

export function summarizeGa4RowsToEvidence(input: {
  propertyId: string;
  range: { startDate: string; endDate: string };
  totals: Ga4TotalsRow;
  eventRows: Ga4EventRow[];
}): Ga4EvidenceBlock {
  const tracked = new Set<string>(TRACKED_GA4_EVENT_NAMES);
  const eventCountByName: Record<string, number> = {};
  for (const row of input.eventRows) {
    if (!tracked.has(row.eventName)) continue;
    eventCountByName[row.eventName] = row.eventCount;
  }

  return {
    available: true,
    propertyId: input.propertyId,
    range: input.range,
    fetchedAt: new Date().toISOString(),
    error: null,
    metrics: {
      activeUsers: input.totals.activeUsers,
      sessions: input.totals.sessions,
      screenPageViews: input.totals.screenPageViews,
      engagedSessions: input.totals.engagedSessions,
      averageSessionDurationSec: input.totals.averageSessionDuration,
      eventCountByName,
    },
    metricDefinitions: GA4_EVIDENCE_METRIC_DEFINITIONS,
  };
}

export type AttachGa4Options = {
  propertyId?: string | null;
  credentialsJson?: string | null;
  range?: { startDate: string; endDate: string };
  /** Injected for tests; default uses Data API when package + creds present */
  fetchSnapshot?: (input: Ga4FetchInput) => Promise<Ga4EvidenceBlock>;
  fetchReport?: Ga4ReportFetcher;
};

function readEnvConfig(overrides?: AttachGa4Options): {
  propertyId: string | null;
  credentialsJson: string | null;
  range: { startDate: string; endDate: string };
} {
  return {
    propertyId:
      overrides?.propertyId !== undefined
        ? overrides.propertyId
        : process.env.GA4_PROPERTY_ID?.trim() || null,
    credentialsJson:
      overrides?.credentialsJson !== undefined
        ? overrides.credentialsJson
        : process.env.GA4_SERVICE_ACCOUNT_JSON?.trim() ||
          process.env.GA4_SERVICE_ACCOUNT_JSON_BASE64?.trim() ||
          null,
    range: overrides?.range ?? { ...DEFAULT_RANGE },
  };
}

/**
 * Attach GA4 snapshot onto EvidencePack. Fail-open: never throws; never mutates DB aggregates.
 */
export async function attachGa4Evidence(
  pack: EvidencePack,
  options?: AttachGa4Options,
): Promise<EvidencePack> {
  const { propertyId, credentialsJson, range } = readEnvConfig(options);

  if (!propertyId || !credentialsJson) {
    return {
      ...pack,
      ga4: emptyGa4EvidenceUnavailable(
        'GA4_PROPERTY_ID or GA4_SERVICE_ACCOUNT_JSON(_BASE64) not configured',
      ),
    };
  }

  const credentials = parseGa4ServiceAccountJson(credentialsJson);
  if (!credentials) {
    return {
      ...pack,
      ga4: {
        ...emptyGa4EvidenceUnavailable('Invalid GA4 service account JSON'),
        propertyId,
        range,
      },
    };
  }

  try {
    let ga4: Ga4EvidenceBlock;
    if (options?.fetchSnapshot) {
      ga4 = await options.fetchSnapshot({ propertyId, range, credentials });
    } else {
      const fetchReport = options?.fetchReport ?? defaultGa4ReportFetcher;
      const { totals, eventRows } = await fetchReport({
        propertyId,
        range,
        credentials,
      });
      ga4 = summarizeGa4RowsToEvidence({ propertyId, range, totals, eventRows });
    }
    return { ...pack, ga4 };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ...pack,
      ga4: {
        ...emptyGa4EvidenceUnavailable(msg),
        propertyId,
        range,
        fetchedAt: new Date().toISOString(),
      },
    };
  }
}

function metricValue(
  row: { metricValues?: Array<{ value?: string | null }> | null } | undefined,
  index: number,
): number | null {
  const raw = row?.metricValues?.[index]?.value;
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** Default Data API fetcher — dynamic import so unit tests need no package. */
export async function defaultGa4ReportFetcher(
  input: Ga4FetchInput,
): Promise<{ totals: Ga4TotalsRow; eventRows: Ga4EventRow[] }> {
  const { BetaAnalyticsDataClient } = await import('@google-analytics/data');
  const client = new BetaAnalyticsDataClient({
    credentials: {
      client_email: input.credentials.client_email,
      private_key: input.credentials.private_key.replace(/\\n/g, '\n'),
    },
  });

  const property = `properties/${input.propertyId}`;

  const [totalsRes] = await client.runReport({
    property,
    dateRanges: [input.range],
    metrics: [
      { name: 'activeUsers' },
      { name: 'sessions' },
      { name: 'screenPageViews' },
      { name: 'engagedSessions' },
      { name: 'averageSessionDuration' },
    ],
  });

  const totalsRow = totalsRes.rows?.[0];
  const totals: Ga4TotalsRow = {
    activeUsers: metricValue(totalsRow, 0),
    sessions: metricValue(totalsRow, 1),
    screenPageViews: metricValue(totalsRow, 2),
    engagedSessions: metricValue(totalsRow, 3),
    averageSessionDuration: metricValue(totalsRow, 4),
  };

  const [eventsRes] = await client.runReport({
    property,
    dateRanges: [input.range],
    dimensions: [{ name: 'eventName' }],
    metrics: [{ name: 'eventCount' }],
    dimensionFilter: {
      filter: {
        fieldName: 'eventName',
        inListFilter: {
          values: [...TRACKED_GA4_EVENT_NAMES],
        },
      },
    },
    limit: 100,
  });

  const eventRows: Ga4EventRow[] = (eventsRes.rows ?? []).map((row) => ({
    eventName: row.dimensionValues?.[0]?.value ?? '',
    eventCount: metricValue(row, 0) ?? 0,
  })).filter((r) => r.eventName);

  return { totals, eventRows };
}
