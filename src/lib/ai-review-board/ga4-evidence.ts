/**
 * GA4 Data API → EvidencePack.ga4 (read-only). Never overwrites DB aggregates.
 * Additive v2: period (Asia/Seoul), nested slices, evidenceItems, errorCode.
 */
import fs from 'node:fs';
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
  newUsers:
    'GA4 newUsers in the selected date range. NOT the same as DB newUsersLast7d (signups). Cite source as GA4.',
  sessions: 'GA4 sessions in the selected date range. Not DB signups or posts.',
  screenPageViews:
    'GA4 screenPageViews (web page views). NOT the same as DB viewsLast7d (PostViewDaily) or totalViews (Post.views sum). Cite source as GA4.',
  engagedSessions: 'GA4 engagedSessions in the selected date range.',
  engagementRate: 'GA4 engagementRate in the selected date range (0–1). DIRECT_FACT only; "low engagement" is INFERENCE.',
  averageSessionDurationSec:
    'GA4 averageSessionDuration in seconds (API metric averageSessionDuration).',
  eventCountByName:
    'GA4 eventCount keyed by eventName for tracked custom events only. Missing key = not observed in range (do not invent). Actual 0 means zero events.',
} as const;

export type Ga4ErrorCode =
  | 'NOT_CONFIGURED'
  | 'INVALID_CREDENTIALS'
  | 'API_ERROR'
  | 'PROPERTY_ACCESS'
  | null;

export type Ga4Period = {
  start: string;
  end: string;
  timezone: 'Asia/Seoul';
};

export type Ga4EvidenceMetrics = {
  activeUsers: number | null;
  sessions: number | null;
  screenPageViews: number | null;
  engagedSessions: number | null;
  averageSessionDurationSec: number | null;
  eventCountByName: Record<string, number>;
};

export type Ga4UsersSlice = {
  totalUsers: number | null;
  activeUsers: number | null;
  newUsers: number | null;
  returningUsers: number | null;
};

export type Ga4EngagementSlice = {
  sessions: number | null;
  engagedSessions: number | null;
  engagementRate: number | null;
  averageEngagementTime: number | null;
};

export type Ga4ViewsSlice = {
  screenPageViews: number | null;
  topPages: Array<{ path: string; views: number }>;
};

export type Ga4AcquisitionSlice = {
  channels: Array<{ channel: string; sessions: number }>;
  sourceMedium: Array<{ sourceMedium: string; sessions: number }>;
};

export type Ga4DeviceSlice = {
  mobile: number | null;
  desktop: number | null;
  tablet: number | null;
};

export type Ga4GeographyRow = { country: string; activeUsers: number };
export type Ga4TopEvent = { name: string; count: number };

export type Ga4EvidenceBlock = {
  available: boolean;
  propertyId: string | null;
  /** GA API dateRanges (YYYY-MM-DD preferred; legacy relative still accepted) */
  range: { startDate: string; endDate: string };
  /** Calendar window aligned with DB (Asia/Seoul) */
  period?: Ga4Period;
  fetchedAt: string | null;
  queriedAt?: string | null;
  dataFreshness?: string | null;
  error: string | null;
  errorCode?: Ga4ErrorCode;
  metrics: Ga4EvidenceMetrics;
  metricDefinitions: typeof GA4_EVIDENCE_METRIC_DEFINITIONS;
  users?: Ga4UsersSlice;
  engagement?: Ga4EngagementSlice;
  views?: Ga4ViewsSlice;
  acquisition?: Ga4AcquisitionSlice;
  device?: Ga4DeviceSlice;
  geography?: Ga4GeographyRow[];
  events?: { topEvents: Ga4TopEvent[] };
};

export type EvidenceItem = {
  id: string;
  source: 'GA4' | 'DATABASE';
  metric: string;
  value: number | null;
};

export type Ga4ServiceAccountCreds = {
  type?: string;
  client_email: string;
  private_key: string;
  [key: string]: unknown;
};

export type Ga4TotalsRow = {
  activeUsers: number | null;
  newUsers?: number | null;
  totalUsers?: number | null;
  sessions: number | null;
  screenPageViews: number | null;
  engagedSessions: number | null;
  engagementRate?: number | null;
  averageSessionDuration: number | null;
  averageEngagementTime?: number | null;
};

export type Ga4EventRow = { eventName: string; eventCount: number };

export type Ga4FetchInput = {
  propertyId: string;
  range: { startDate: string; endDate: string };
  credentials: Ga4ServiceAccountCreds;
};

export type Ga4ReportBundle = {
  totals: Ga4TotalsRow;
  eventRows: Ga4EventRow[];
  topPages?: Array<{ path: string; views: number }>;
  channels?: Array<{ channel: string; sessions: number }>;
  sourceMedium?: Array<{ sourceMedium: string; sessions: number }>;
  device?: Ga4DeviceSlice;
  geography?: Ga4GeographyRow[];
  returningUsers?: number | null;
};

export type Ga4ReportFetcher = (input: Ga4FetchInput) => Promise<Ga4ReportBundle>;

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

function emptyNestedUnavailable(): Pick<
  Ga4EvidenceBlock,
  'users' | 'engagement' | 'views' | 'acquisition' | 'device' | 'geography' | 'events'
> {
  return {
    users: {
      totalUsers: null,
      activeUsers: null,
      newUsers: null,
      returningUsers: null,
    },
    engagement: {
      sessions: null,
      engagedSessions: null,
      engagementRate: null,
      averageEngagementTime: null,
    },
    views: { screenPageViews: null, topPages: [] },
    acquisition: { channels: [], sourceMedium: [] },
    device: { mobile: null, desktop: null, tablet: null },
    geography: [],
    events: { topEvents: [] },
  };
}

/** YYYY-MM-DD in Asia/Seoul for an instant. */
export function seoulYmd(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/** Add calendar days to a YYYY-MM-DD (UTC noon anchor avoids DST edge cases for date-only). */
export function addCalendarDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  dt.setUTCDate(dt.getUTCDate() + days);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

/**
 * Shared Review Board window: end = yesterday (Asia/Seoul), start = end − 6 days (7 inclusive).
 * Alias: analysisPeriod — DB aggregates and GA4 must share this.
 */
export function resolveReviewBoardPeriod(now: Date = new Date()): Ga4Period {
  const today = seoulYmd(now);
  const end = addCalendarDays(today, -1);
  const start = addCalendarDays(end, -6);
  return { start, end, timezone: 'Asia/Seoul' };
}

export const resolveAnalysisPeriod = resolveReviewBoardPeriod;

/** Instant bounds [start 00:00 KST, end+1 00:00 KST) for createdAt filters. */
export function analysisPeriodInstantBounds(period: Ga4Period): {
  gte: Date;
  lt: Date;
} {
  return {
    gte: new Date(`${period.start}T00:00:00+09:00`),
    lt: new Date(`${addCalendarDays(period.end, 1)}T00:00:00+09:00`),
  };
}

/**
 * PostViewDaily day-key bounds using YYYY-MM-DD as UTC midnights
 * (same calendar labels as analysisPeriod start/end).
 */
export function analysisPeriodUtcDayBounds(period: Ga4Period): {
  gte: Date;
  lt: Date;
} {
  return {
    gte: new Date(`${period.start}T00:00:00.000Z`),
    lt: new Date(`${addCalendarDays(period.end, 1)}T00:00:00.000Z`),
  };
}

export function emptyGa4EvidenceUnavailable(
  error: string,
  errorCode: Ga4ErrorCode = 'NOT_CONFIGURED',
  period?: Ga4Period,
): Ga4EvidenceBlock {
  const p = period ?? resolveReviewBoardPeriod();
  return {
    available: false,
    propertyId: null,
    range: { startDate: p.start, endDate: p.end },
    period: p,
    fetchedAt: null,
    queriedAt: null,
    dataFreshness: null,
    error,
    errorCode,
    metrics: emptyMetrics(),
    metricDefinitions: GA4_EVIDENCE_METRIC_DEFINITIONS,
    ...emptyNestedUnavailable(),
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

export function buildMockGa4Evidence(
  overrides?: Partial<Ga4EvidenceBlock>,
): Ga4EvidenceBlock {
  const period = overrides?.period ?? resolveReviewBoardPeriod();
  const base: Ga4EvidenceBlock = {
    available: true,
    propertyId: overrides?.propertyId ?? 'mock',
    range: overrides?.range ?? { startDate: period.start, endDate: period.end },
    period,
    fetchedAt: new Date().toISOString(),
    queriedAt: new Date().toISOString(),
    dataFreshness: period.end,
    error: null,
    errorCode: null,
    metrics: {
      activeUsers: 10,
      sessions: 20,
      screenPageViews: 100,
      engagedSessions: 8,
      averageSessionDurationSec: 30,
      eventCountByName: {},
    },
    metricDefinitions: GA4_EVIDENCE_METRIC_DEFINITIONS,
    users: {
      totalUsers: null,
      activeUsers: 10,
      newUsers: 3,
      returningUsers: null,
    },
    engagement: {
      sessions: 20,
      engagedSessions: 8,
      engagementRate: 0.4,
      averageEngagementTime: null,
    },
    views: { screenPageViews: 100, topPages: [] },
    acquisition: { channels: [], sourceMedium: [] },
    device: { mobile: null, desktop: null, tablet: null },
    geography: [],
    events: { topEvents: [] },
  };
  return {
    ...base,
    ...overrides,
    metrics: { ...base.metrics, ...(overrides?.metrics ?? {}) },
    users: { ...base.users!, ...(overrides?.users ?? {}) },
    engagement: { ...base.engagement!, ...(overrides?.engagement ?? {}) },
    views: {
      screenPageViews:
        overrides?.views?.screenPageViews ?? base.views!.screenPageViews,
      topPages: overrides?.views?.topPages ?? base.views!.topPages,
    },
    acquisition: {
      channels: overrides?.acquisition?.channels ?? base.acquisition!.channels,
      sourceMedium:
        overrides?.acquisition?.sourceMedium ?? base.acquisition!.sourceMedium,
    },
    device: { ...base.device!, ...(overrides?.device ?? {}) },
    metricDefinitions: GA4_EVIDENCE_METRIC_DEFINITIONS,
  };
}

export function summarizeGa4RowsToEvidence(input: {
  propertyId: string;
  range: { startDate: string; endDate: string };
  period?: Ga4Period;
  totals: Ga4TotalsRow;
  eventRows: Ga4EventRow[];
  topPages?: Array<{ path: string; views: number }>;
  channels?: Array<{ channel: string; sessions: number }>;
  sourceMedium?: Array<{ sourceMedium: string; sessions: number }>;
  device?: Ga4DeviceSlice;
  geography?: Ga4GeographyRow[];
  returningUsers?: number | null;
}): Ga4EvidenceBlock {
  const tracked = new Set<string>(TRACKED_GA4_EVENT_NAMES);
  const eventCountByName: Record<string, number> = {};
  for (const row of input.eventRows) {
    if (!tracked.has(row.eventName)) continue;
    eventCountByName[row.eventName] = row.eventCount;
  }

  const period =
    input.period ??
    ({
      start: input.range.startDate,
      end: input.range.endDate,
      timezone: 'Asia/Seoul',
    } as Ga4Period);

  const topEvents: Ga4TopEvent[] = Object.entries(eventCountByName)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);

  const nowIso = new Date().toISOString();
  return {
    available: true,
    propertyId: input.propertyId,
    range: input.range,
    period,
    fetchedAt: nowIso,
    queriedAt: nowIso,
    dataFreshness: period.end,
    error: null,
    errorCode: null,
    metrics: {
      activeUsers: input.totals.activeUsers,
      sessions: input.totals.sessions,
      screenPageViews: input.totals.screenPageViews,
      engagedSessions: input.totals.engagedSessions,
      averageSessionDurationSec: input.totals.averageSessionDuration,
      eventCountByName,
    },
    metricDefinitions: GA4_EVIDENCE_METRIC_DEFINITIONS,
    users: {
      totalUsers: input.totals.totalUsers ?? null,
      activeUsers: input.totals.activeUsers,
      newUsers: input.totals.newUsers ?? null,
      returningUsers: input.returningUsers ?? null,
    },
    engagement: {
      sessions: input.totals.sessions,
      engagedSessions: input.totals.engagedSessions,
      engagementRate: input.totals.engagementRate ?? null,
      averageEngagementTime: input.totals.averageEngagementTime ?? null,
    },
    views: {
      screenPageViews: input.totals.screenPageViews,
      topPages: input.topPages ?? [],
    },
    acquisition: {
      channels: input.channels ?? [],
      sourceMedium: input.sourceMedium ?? [],
    },
    device: input.device ?? { mobile: null, desktop: null, tablet: null },
    geography: input.geography ?? [],
    events: { topEvents },
  };
}

export function buildEvidenceItems(pack: EvidencePack): EvidenceItem[] {
  const items: EvidenceItem[] = [
    {
      id: 'DB_USER_COUNT',
      source: 'DATABASE',
      metric: 'userCount',
      value: pack.aggregates.userCount,
    },
    {
      id: 'DB_NEW_USERS_7D',
      source: 'DATABASE',
      metric: 'newUsersLast7d',
      value: pack.aggregates.newUsersLast7d,
    },
    {
      id: 'DB_ACTIVE_USERS_7D',
      source: 'DATABASE',
      metric: 'activeUsersLast7d',
      value: pack.aggregates.activeUsersLast7d,
    },
    {
      id: 'DB_POSTS_7D',
      source: 'DATABASE',
      metric: 'postsLast7d',
      value: pack.aggregates.postsLast7d,
    },
    {
      id: 'DB_COMMENTS_7D',
      source: 'DATABASE',
      metric: 'commentsLast7d',
      value: pack.aggregates.commentsLast7d,
    },
    {
      id: 'DB_VIEWS_7D',
      source: 'DATABASE',
      metric: 'viewsLast7d',
      value: pack.aggregates.viewsLast7d,
    },
  ];

  const g = pack.ga4;
  if (g?.available) {
    items.push(
      {
        id: 'GA_ACTIVE_USERS_7D',
        source: 'GA4',
        metric: 'activeUsers',
        value: g.metrics.activeUsers ?? g.users?.activeUsers ?? null,
      },
      {
        id: 'GA_NEW_USERS_7D',
        source: 'GA4',
        metric: 'newUsers',
        value: g.users?.newUsers ?? null,
      },
      {
        id: 'GA_SESSIONS_7D',
        source: 'GA4',
        metric: 'sessions',
        value: g.metrics.sessions ?? g.engagement?.sessions ?? null,
      },
      {
        id: 'GA_ENGAGED_SESSIONS_7D',
        source: 'GA4',
        metric: 'engagedSessions',
        value: g.metrics.engagedSessions ?? g.engagement?.engagedSessions ?? null,
      },
      {
        id: 'GA_ENGAGEMENT_RATE_7D',
        source: 'GA4',
        metric: 'engagementRate',
        value: g.engagement?.engagementRate ?? null,
      },
      {
        id: 'GA_SCREEN_PAGE_VIEWS_7D',
        source: 'GA4',
        metric: 'screenPageViews',
        value: g.metrics.screenPageViews ?? g.views?.screenPageViews ?? null,
      },
    );
  }

  return items;
}

/** Deterministic notes only — never asserts cause. */
export function gaDbDivergenceHints(pack: EvidencePack): string[] {
  const hints: string[] = [];
  if (!pack.ga4?.available) return hints;

  const gaNew = pack.ga4.users?.newUsers ?? null;
  const dbNew = pack.aggregates.newUsersLast7d;
  if (gaNew != null && dbNew != null && gaNew !== dbNew) {
    hints.push(
      `최근 7일 GA4 newUsers=${gaNew}, DB newUsersLast7d(가입)=${dbNew}. 정의가 다름 — 원인을 단정하지 말고 needsVerification으로 두라.`,
    );
  }

  const gaActive = pack.ga4.metrics.activeUsers ?? pack.ga4.users?.activeUsers ?? null;
  const dbActive = pack.aggregates.activeUsersLast7d;
  if (gaActive != null && dbActive != null && gaActive !== dbActive) {
    hints.push(
      `GA4 activeUsers=${gaActive} ≠ DB activeUsersLast7d=${dbActive}. 동일 지표가 아님 — 혼동·대체 금지.`,
    );
  }

  if (gaActive === 0) {
    hints.push(
      'GA4 activeUsers=0 은 tracking/설정 이슈 가능성과 실제 무방문을 구분해야 함. 사용자=0 단정 금지.',
    );
  }

  return hints;
}

export type AttachGa4Options = {
  propertyId?: string | null;
  credentialsJson?: string | null;
  range?: { startDate: string; endDate: string };
  period?: Ga4Period;
  /** Inject full block (CLI --mock-ga / tests) — skips API */
  mockGa4?: Ga4EvidenceBlock;
  fetchSnapshot?: (input: Ga4FetchInput) => Promise<Ga4EvidenceBlock>;
  fetchReport?: Ga4ReportFetcher;
};

function readCredentialsJson(overrides?: AttachGa4Options): string | null {
  if (overrides?.credentialsJson !== undefined) {
    return overrides.credentialsJson;
  }
  const fromEnv =
    process.env.GA4_SERVICE_ACCOUNT_JSON?.trim() ||
    process.env.GA4_SERVICE_ACCOUNT_JSON_BASE64?.trim() ||
    null;
  if (fromEnv) return fromEnv;

  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim();
  if (credPath) {
    try {
      if (fs.existsSync(credPath)) {
        return fs.readFileSync(credPath, 'utf8');
      }
    } catch {
      return null;
    }
  }
  return null;
}

function readEnvConfig(overrides?: AttachGa4Options): {
  propertyId: string | null;
  credentialsJson: string | null;
  period: Ga4Period;
  range: { startDate: string; endDate: string };
} {
  const period = overrides?.period ?? resolveReviewBoardPeriod();
  const range =
    overrides?.range ??
    ({ startDate: period.start, endDate: period.end } as const);
  return {
    propertyId:
      overrides?.propertyId !== undefined
        ? overrides.propertyId
        : process.env.GA4_PROPERTY_ID?.trim() || null,
    credentialsJson: readCredentialsJson(overrides),
    period,
    range,
  };
}

function finalizePack(pack: EvidencePack, ga4: Ga4EvidenceBlock): EvidencePack {
  const analysisPeriod = ga4.period ?? pack.analysisPeriod ?? resolveReviewBoardPeriod();
  const withGa4: EvidencePack = {
    ...pack,
    analysisPeriod,
    ga4: { ...ga4, period: analysisPeriod },
  };
  const evidenceItems = buildEvidenceItems(withGa4);
  const divergence = gaDbDivergenceHints(withGa4);
  const docsHints =
    divergence.length > 0
      ? [...pack.docsHints, ...divergence]
      : pack.docsHints;
  return { ...withGa4, evidenceItems, docsHints };
}

/**
 * Attach GA4 snapshot onto EvidencePack. Fail-open: never throws; never mutates DB aggregates.
 */
export async function attachGa4Evidence(
  pack: EvidencePack,
  options?: AttachGa4Options,
): Promise<EvidencePack> {
  if (options?.mockGa4) {
    const period =
      options.period ??
      pack.analysisPeriod ??
      options.mockGa4.period ??
      resolveReviewBoardPeriod();
    return finalizePack(pack, {
      ...options.mockGa4,
      period,
      range: {
        startDate: period.start,
        endDate: period.end,
      },
      metricDefinitions: GA4_EVIDENCE_METRIC_DEFINITIONS,
    });
  }

  const period =
    options?.period ?? pack.analysisPeriod ?? resolveReviewBoardPeriod();
  const { propertyId, credentialsJson, range } = readEnvConfig({
    ...options,
    period,
    range: options?.range ?? { startDate: period.start, endDate: period.end },
  });

  if (!propertyId || !credentialsJson) {
    return finalizePack(
      pack,
      emptyGa4EvidenceUnavailable(
        'GA4_PROPERTY_ID or GA4_SERVICE_ACCOUNT_JSON(_BASE64) / GOOGLE_APPLICATION_CREDENTIALS not configured',
        'NOT_CONFIGURED',
        period,
      ),
    );
  }

  const credentials = parseGa4ServiceAccountJson(credentialsJson);
  if (!credentials) {
    return finalizePack(pack, {
      ...emptyGa4EvidenceUnavailable(
        'Invalid GA4 service account JSON',
        'INVALID_CREDENTIALS',
        period,
      ),
      propertyId,
      range,
      period,
    });
  }

  try {
    let ga4: Ga4EvidenceBlock;
    if (options?.fetchSnapshot) {
      ga4 = await options.fetchSnapshot({ propertyId, range, credentials });
    } else {
      const fetchReport = options?.fetchReport ?? defaultGa4ReportFetcher;
      const bundle = await fetchReport({ propertyId, range, credentials });
      ga4 = summarizeGa4RowsToEvidence({
        propertyId,
        range,
        period,
        totals: bundle.totals,
        eventRows: bundle.eventRows,
        topPages: bundle.topPages,
        channels: bundle.channels,
        sourceMedium: bundle.sourceMedium,
        device: bundle.device,
        geography: bundle.geography,
        returningUsers: bundle.returningUsers,
      });
    }
    return finalizePack(pack, ga4);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const lower = msg.toLowerCase();
    const errorCode: Ga4ErrorCode =
      lower.includes('permission') || lower.includes('403')
        ? 'PROPERTY_ACCESS'
        : 'API_ERROR';
    return finalizePack(pack, {
      ...emptyGa4EvidenceUnavailable(msg, errorCode, period),
      propertyId,
      range,
      period,
      fetchedAt: new Date().toISOString(),
      queriedAt: new Date().toISOString(),
    });
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

type Ga4Row = {
  dimensionValues?: Array<{ value?: string | null }> | null;
  metricValues?: Array<{ value?: string | null }> | null;
};

/** Default Data API fetcher — dynamic import so unit tests need no live network. */
export async function defaultGa4ReportFetcher(
  input: Ga4FetchInput,
): Promise<Ga4ReportBundle> {
  const { BetaAnalyticsDataClient } = await import('@google-analytics/data');
  const client = new BetaAnalyticsDataClient({
    credentials: {
      client_email: input.credentials.client_email,
      private_key: input.credentials.private_key.replace(/\\n/g, '\n'),
    },
  });

  const property = `properties/${input.propertyId}`;
  const dateRanges = [input.range];

  const [totalsRes] = await client.runReport({
    property,
    dateRanges,
    metrics: [
      { name: 'activeUsers' },
      { name: 'newUsers' },
      { name: 'totalUsers' },
      { name: 'sessions' },
      { name: 'screenPageViews' },
      { name: 'engagedSessions' },
      { name: 'engagementRate' },
      { name: 'averageSessionDuration' },
      { name: 'userEngagementDuration' },
    ],
  });

  const totalsRow = totalsRes.rows?.[0] as Ga4Row | undefined;
  const sessions = metricValue(totalsRow, 3);
  const engagementDuration = metricValue(totalsRow, 8);
  const averageEngagementTime =
    sessions != null && sessions > 0 && engagementDuration != null
      ? engagementDuration / sessions
      : null;

  const totals: Ga4TotalsRow = {
    activeUsers: metricValue(totalsRow, 0),
    newUsers: metricValue(totalsRow, 1),
    totalUsers: metricValue(totalsRow, 2),
    sessions,
    screenPageViews: metricValue(totalsRow, 4),
    engagedSessions: metricValue(totalsRow, 5),
    engagementRate: metricValue(totalsRow, 6),
    averageSessionDuration: metricValue(totalsRow, 7),
    averageEngagementTime,
  };

  const [eventsRes] = await client.runReport({
    property,
    dateRanges,
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

  const eventRows: Ga4EventRow[] = ((eventsRes.rows ?? []) as Ga4Row[])
    .map((row) => ({
      eventName: row.dimensionValues?.[0]?.value ?? '',
      eventCount: metricValue(row, 0) ?? 0,
    }))
    .filter((r) => r.eventName);

  const [pagesRes] = await client.runReport({
    property,
    dateRanges,
    dimensions: [{ name: 'pagePath' }],
    metrics: [{ name: 'screenPageViews' }],
    orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }],
    limit: 10,
  });
  const topPages = ((pagesRes.rows ?? []) as Ga4Row[])
    .map((row) => ({
      path: row.dimensionValues?.[0]?.value ?? '',
      views: metricValue(row, 0) ?? 0,
    }))
    .filter((r) => r.path);

  const [channelRes] = await client.runReport({
    property,
    dateRanges,
    dimensions: [{ name: 'sessionDefaultChannelGroup' }],
    metrics: [{ name: 'sessions' }],
    orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
    limit: 10,
  });
  const channels = ((channelRes.rows ?? []) as Ga4Row[])
    .map((row) => ({
      channel: row.dimensionValues?.[0]?.value ?? '',
      sessions: metricValue(row, 0) ?? 0,
    }))
    .filter((r) => r.channel);

  const [smRes] = await client.runReport({
    property,
    dateRanges,
    dimensions: [{ name: 'sessionSourceMedium' }],
    metrics: [{ name: 'sessions' }],
    orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
    limit: 10,
  });
  const sourceMedium = ((smRes.rows ?? []) as Ga4Row[])
    .map((row) => ({
      sourceMedium: row.dimensionValues?.[0]?.value ?? '',
      sessions: metricValue(row, 0) ?? 0,
    }))
    .filter((r) => r.sourceMedium);

  const [deviceRes] = await client.runReport({
    property,
    dateRanges,
    dimensions: [{ name: 'deviceCategory' }],
    metrics: [{ name: 'activeUsers' }],
  });
  const device: Ga4DeviceSlice = { mobile: null, desktop: null, tablet: null };
  for (const row of (deviceRes.rows ?? []) as Ga4Row[]) {
    const cat = (row.dimensionValues?.[0]?.value ?? '').toLowerCase();
    const n = metricValue(row, 0);
    if (cat === 'mobile') device.mobile = n;
    else if (cat === 'desktop') device.desktop = n;
    else if (cat === 'tablet') device.tablet = n;
  }

  const [geoRes] = await client.runReport({
    property,
    dateRanges,
    dimensions: [{ name: 'country' }],
    metrics: [{ name: 'activeUsers' }],
    orderBys: [{ metric: { metricName: 'activeUsers' }, desc: true }],
    limit: 10,
  });
  const geography: Ga4GeographyRow[] = ((geoRes.rows ?? []) as Ga4Row[])
    .map((row) => ({
      country: row.dimensionValues?.[0]?.value ?? '',
      activeUsers: metricValue(row, 0) ?? 0,
    }))
    .filter((r) => r.country);

  let returningUsers: number | null = null;
  try {
    const [nvRes] = await client.runReport({
      property,
      dateRanges,
      dimensions: [{ name: 'newVsReturning' }],
      metrics: [{ name: 'activeUsers' }],
    });
    for (const row of (nvRes.rows ?? []) as Ga4Row[]) {
      const label = (row.dimensionValues?.[0]?.value ?? '').toLowerCase();
      if (label.includes('returning')) {
        returningUsers = metricValue(row, 0);
      }
    }
  } catch {
    returningUsers = null;
  }

  return {
    totals,
    eventRows,
    topPages,
    channels,
    sourceMedium,
    device,
    geography,
    returningUsers,
  };
}
