/**
 * EvidencePack — 읽기 전용 집계만. INSERT/UPDATE/DELETE 금지.
 */
import type { PrismaClient } from '@prisma/client';
import { countActiveUsersLast7d } from '@/lib/community-metrics/active-users';
import { countViewsLast7d } from '@/lib/community-metrics/views-last-7d';
import {
  analysisPeriodInstantBounds,
  analysisPeriodUtcDayBounds,
  resolveAnalysisPeriod,
} from './analysis-period';
import {
  EVIDENCE_METRIC_DEFINITIONS,
  type EvidenceAggregates,
  type EvidencePack,
} from './types';

export type EvidenceDb = Pick<
  PrismaClient,
  'user' | 'post' | 'comment' | 'postLike' | 'bookmark' | 'gameScore' | 'postViewDaily'
>;

/** stub 시 aggregates 일부만 덮어쓸 수 있게 함 */
export type StubEvidencePackOverrides = Omit<
  Partial<EvidencePack>,
  'aggregates' | 'piiExcluded' | 'readOnly' | 'metricDefinitions'
> & {
  aggregates?: Partial<EvidenceAggregates>;
};

const CORRIDORS = [
  'LAB/RECIPE',
  'GALLERY',
  'LOUNGE',
  'GOSSIP',
  'BUILD',
  'LAUNCH',
  'AI_FORTUNE',
] as const;

const STACK_NOTES = [
  'Next.js 15 App Router + React 19',
  'Prisma 7 + PostgreSQL (Supabase Auth)',
  'Gemini (@google/generative-ai) for LAB/news/fortune',
  'Vercel hosting + GitHub Actions cron',
  'Capacitor mobile shell',
] as const;

const DOCS_HINTS = [
  'docs/geo-optimization.md — GEO/SEO 가이드',
  'docs/performance-seo.md',
  'docs/cron-operations.md',
  '복도형 커뮤니티 + AI Work/Fortune/Games',
  'CRITICAL: newUsersLast7d/usersLast7d = signups only, NEVER active users/DAU',
  'activeUsersLast7d = Post|Comment|PostLike|Bookmark|GameScore activity in analysisPeriod',
  'viewsLast7d = PostViewDaily sum for analysisPeriod day keys; totalViews is all-time Post.views only',
  'commentsLast7d = Comment.createdAt within analysisPeriod (Asia/Seoul)',
  'GA4 block (EvidencePack.ga4) is separate from DB aggregates — never equate GA activeUsers with DB activeUsersLast7d',
  'analysisPeriod is shared by DB aggregates and GA4 (Asia/Seoul inclusive start/end)',
] as const;

function emptyAggregates(): EvidencePack['aggregates'] {
  return {
    userCount: null,
    usersLast7d: null,
    newUsersLast7d: null,
    activeUsersLast7d: null,
    postCount: null,
    postsLast7d: null,
    commentsLast7d: null,
    viewsLast7d: null,
    totalViews: null,
    commentCount: null,
    postsByCategory: {},
  };
}

/** 테스트용 — DB 없이 고정 스냅샷 */
export function buildStubEvidencePack(overrides?: StubEvidencePackOverrides): EvidencePack {
  const analysisPeriod = overrides?.analysisPeriod ?? resolveAnalysisPeriod();
  const base: EvidencePack = {
    generatedAt: new Date().toISOString(),
    analysisPeriod,
    site: {
      name: 'AIsle',
      corridors: [...CORRIDORS],
      stackNotes: [...STACK_NOTES],
    },
    aggregates: emptyAggregates(),
    metricDefinitions: EVIDENCE_METRIC_DEFINITIONS,
    docsHints: [...DOCS_HINTS],
    piiExcluded: true,
    readOnly: true,
  };
  return {
    ...base,
    ...overrides,
    analysisPeriod: overrides?.analysisPeriod ?? analysisPeriod,
    aggregates: { ...base.aggregates, ...(overrides?.aggregates ?? {}) },
    metricDefinitions: EVIDENCE_METRIC_DEFINITIONS,
    piiExcluded: true,
    readOnly: true,
  };
}

/**
 * 프로덕션 DB 집계 읽기 전용.
 * Window = shared analysisPeriod (Asia/Seoul), same as GA4.
 */
export async function buildEvidencePackFromDb(db: EvidenceDb): Promise<EvidencePack> {
  const analysisPeriod = resolveAnalysisPeriod();
  const { gte, lt } = analysisPeriodInstantBounds(analysisPeriod);
  const dayBounds = analysisPeriodUtcDayBounds(analysisPeriod);

  const [
    userCount,
    newUsersLast7d,
    postCount,
    postsLast7d,
    commentCount,
    commentsLast7d,
    viewsAgg,
    byCategory,
    activeUsersLast7d,
    viewsLast7d,
  ] = await Promise.all([
    db.user.count(),
    db.user.count({ where: { createdAt: { gte, lt } } }),
    db.post.count(),
    db.post.count({ where: { createdAt: { gte, lt } } }),
    db.comment.count(),
    db.comment.count({ where: { createdAt: { gte, lt } } }),
    db.post.aggregate({ _sum: { views: true } }),
    db.post.groupBy({
      by: ['category'],
      _count: { _all: true },
    }),
    countActiveUsersLast7d(db, gte, lt),
    countViewsLast7d(db, dayBounds.gte, dayBounds.lt),
  ]);

  const postsByCategory: Record<string, number> = {};
  for (const row of byCategory) {
    postsByCategory[String(row.category)] = row._count._all;
  }

  return {
    generatedAt: new Date().toISOString(),
    analysisPeriod,
    site: {
      name: 'AIsle',
      corridors: [...CORRIDORS],
      stackNotes: [...STACK_NOTES],
    },
    aggregates: {
      userCount,
      usersLast7d: newUsersLast7d,
      newUsersLast7d,
      activeUsersLast7d,
      postCount,
      postsLast7d,
      commentsLast7d,
      viewsLast7d,
      totalViews: viewsAgg._sum.views ?? 0,
      commentCount,
      postsByCategory,
    },
    metricDefinitions: EVIDENCE_METRIC_DEFINITIONS,
    docsHints: [...DOCS_HINTS],
    piiExcluded: true,
    readOnly: true,
  };
}
