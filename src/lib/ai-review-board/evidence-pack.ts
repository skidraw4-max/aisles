/**
 * EvidencePack — 읽기 전용 집계만. INSERT/UPDATE/DELETE 금지.
 */
import type { PrismaClient } from '@prisma/client';
import { countActiveUsersLast7d } from '@/lib/community-metrics/active-users';
import { countViewsLast7d, utcDayStart } from '@/lib/community-metrics/views-last-7d';
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
  'activeUsersLast7d = Post|Comment|PostLike|Bookmark|GameScore activity last 7d',
  'viewsLast7d = PostViewDaily sum last 7d UTC; totalViews is all-time Post.views only',
  'commentsLast7d = Comment.createdAt last 7d',
] as const;

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000);
}

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
  const base: EvidencePack = {
    generatedAt: new Date().toISOString(),
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
    aggregates: { ...base.aggregates, ...(overrides?.aggregates ?? {}) },
    metricDefinitions: EVIDENCE_METRIC_DEFINITIONS,
    piiExcluded: true,
    readOnly: true,
  };
}

/**
 * 프로덕션 DB 집계 읽기 전용.
 */
export async function buildEvidencePackFromDb(db: EvidenceDb): Promise<EvidencePack> {
  const since7d = daysAgo(7);
  const sinceDay = utcDayStart(since7d);

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
    db.user.count({ where: { createdAt: { gte: since7d } } }),
    db.post.count(),
    db.post.count({ where: { createdAt: { gte: since7d } } }),
    db.comment.count(),
    db.comment.count({ where: { createdAt: { gte: since7d } } }),
    db.post.aggregate({ _sum: { views: true } }),
    db.post.groupBy({
      by: ['category'],
      _count: { _all: true },
    }),
    countActiveUsersLast7d(db, since7d),
    countViewsLast7d(db, sinceDay),
  ]);

  const postsByCategory: Record<string, number> = {};
  for (const row of byCategory) {
    postsByCategory[String(row.category)] = row._count._all;
  }

  return {
    generatedAt: new Date().toISOString(),
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
