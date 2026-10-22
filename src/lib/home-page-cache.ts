function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

type RecentRowIn = { createdAt: Date | string };
type FeedPostIn = { createdAt: Date | string; launchBannerUntil: Date | string | null };

export type HomePageCachePayload<
  R extends RecentRowIn = RecentRowIn,
  P extends FeedPostIn = FeedPostIn,
> = {
  recentAll: Array<Omit<R, 'createdAt'> & { createdAt: string }>;
  firstHomeFeed: {
    posts: Array<Omit<P, 'createdAt' | 'launchBannerUntil'> & { createdAt: string; launchBannerUntil: string | null }>;
    hasMore: boolean;
  };
  launchBannerPosts: Array<
    Omit<P, 'createdAt' | 'launchBannerUntil'> & { createdAt: string; launchBannerUntil: string | null }
  >;
};

export function serializeCachedFeedPost<T extends FeedPostIn>(
  post: T
): Omit<T, 'createdAt' | 'launchBannerUntil'> & { createdAt: string; launchBannerUntil: string | null } {
  return {
    ...post,
    createdAt: toIso(post.createdAt),
    launchBannerUntil: post.launchBannerUntil == null ? null : toIso(post.launchBannerUntil),
  };
}

export function reviveCachedFeedPost<T extends FeedPostIn>(
  post: T
): Omit<T, 'createdAt' | 'launchBannerUntil'> & { createdAt: Date; launchBannerUntil: Date | null } {
  return {
    ...post,
    createdAt: toDate(post.createdAt),
    launchBannerUntil: post.launchBannerUntil == null ? null : toDate(post.launchBannerUntil),
  };
}

/** Date → ISO string before `unstable_cache` JSON serialization. */
export function serializeHomePageCache<R extends RecentRowIn, P extends FeedPostIn>(input: {
  recentAll: R[];
  firstHomeFeed: { posts: P[]; hasMore: boolean };
  launchBannerPosts: P[];
}): HomePageCachePayload<R, P> {
  return {
    recentAll: input.recentAll.map((row) => ({
      ...row,
      createdAt: toIso(row.createdAt),
    })),
    firstHomeFeed: {
      posts: input.firstHomeFeed.posts.map(serializeCachedFeedPost),
      hasMore: input.firstHomeFeed.hasMore,
    },
    launchBannerPosts: input.launchBannerPosts.map(serializeCachedFeedPost),
  };
}

/** ISO string → Date after cache read so Prisma-shaped callers can use toISOString. */
export function reviveHomePageCache<R extends RecentRowIn, P extends FeedPostIn>(
  payload: HomePageCachePayload<R, P>
) {
  return {
    recentAll: payload.recentAll.map((row) => ({
      ...row,
      createdAt: toDate(row.createdAt),
    })),
    firstHomeFeed: {
      posts: payload.firstHomeFeed.posts.map(reviveCachedFeedPost),
      hasMore: payload.firstHomeFeed.hasMore,
    },
    launchBannerPosts: payload.launchBannerPosts.map(reviveCachedFeedPost),
  };
}
