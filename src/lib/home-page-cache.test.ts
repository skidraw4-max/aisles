/**
 * Run: node --import tsx --test src/lib/home-page-cache.test.ts
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Category } from '@prisma/client';
import { reviveHomePageCache, serializeHomePageCache } from './home-page-cache';

type FeedLike = {
  id: string;
  category: Category;
  title: string;
  content: string | null;
  thumbnail: string | null;
  attachmentUrls: string[];
  views: number;
  likeCount: number;
  isFeatured: boolean;
  featuredOnHome: boolean;
  launchBannerUntil: Date | null;
  aiFortuneWeekKey: string | null;
  tags: string[];
  createdAt: Date;
  author: { username: string };
  launchInfo: { serviceUrl: string | null; status: string } | null;
  _count: { comments: number };
  metadata: { params: unknown };
};

function sampleFeedPost(createdAt: Date): FeedLike {
  return {
    id: 'post-1',
    category: 'RECIPE',
    title: 'Hello',
    content: 'body',
    thumbnail: null,
    attachmentUrls: [],
    views: 3,
    likeCount: 1,
    isFeatured: false,
    featuredOnHome: false,
    launchBannerUntil: new Date('2026-02-01T00:00:00.000Z'),
    aiFortuneWeekKey: null,
    tags: [],
    createdAt,
    author: { username: 'ada' },
    launchInfo: null,
    _count: { comments: 2 },
    metadata: { params: null },
  };
}

describe('home page cache Date-safe serialization', () => {
  it('stores Date fields as ISO strings so unstable_cache JSON cannot break toISOString', () => {
    const createdAt = new Date('2026-01-15T12:00:00.000Z');
    const serialized = serializeHomePageCache({
      recentAll: [
        {
          id: 'r1',
          title: 'Recent',
          thumbnail: null,
          category: 'GALLERY',
          createdAt,
          author: { username: 'bob' },
          metadata: { params: null },
        },
      ],
      firstHomeFeed: { posts: [sampleFeedPost(createdAt)], hasMore: true },
      launchBannerPosts: [sampleFeedPost(createdAt)],
    });

    assert.equal(typeof serialized.recentAll[0].createdAt, 'string');
    assert.equal(serialized.recentAll[0].createdAt, createdAt.toISOString());
    assert.equal(typeof serialized.firstHomeFeed.posts[0].createdAt, 'string');
    assert.equal(typeof serialized.firstHomeFeed.posts[0].launchBannerUntil, 'string');
    assert.equal(serialized.firstHomeFeed.hasMore, true);
  });

  it('revives ISO strings to Date so callers can use toISOString after JSON round-trip', () => {
    const createdAt = new Date('2026-03-02T08:30:00.000Z');
    const cached = serializeHomePageCache({
      recentAll: [],
      firstHomeFeed: { posts: [sampleFeedPost(createdAt)], hasMore: false },
      launchBannerPosts: [],
    });
    const jsonRoundTrip = JSON.parse(JSON.stringify(cached)) as typeof cached;
    const revived = reviveHomePageCache(jsonRoundTrip);
    const post = revived.firstHomeFeed.posts[0];

    assert.ok(post.createdAt instanceof Date);
    assert.equal(post.createdAt.toISOString(), createdAt.toISOString());
    assert.ok(post.launchBannerUntil instanceof Date);
    assert.equal(post.launchBannerUntil.toISOString(), '2026-02-01T00:00:00.000Z');
    assert.equal(post._count.comments, 2);
  });
});
