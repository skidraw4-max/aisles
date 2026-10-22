/** Distinct users with qualifying activity in a time window. */

export const ACTIVE_USER_ACTIVITY_KINDS = [
  'post',
  'comment',
  'like',
  'bookmark',
  'gameScore',
] as const;

type TimeWindow = { gte: Date; lt?: Date };

export type ActiveUsersDb = {
  post: {
    findMany: (args: {
      where: { createdAt: TimeWindow };
      select: { authorId: true };
      distinct: ['authorId'];
    }) => Promise<{ authorId: string }[]>;
  };
  comment: {
    findMany: (args: {
      where: { createdAt: TimeWindow };
      select: { authorId: true };
      distinct: ['authorId'];
    }) => Promise<{ authorId: string }[]>;
  };
  postLike: {
    findMany: (args: {
      where: { createdAt: TimeWindow };
      select: { userId: true };
      distinct: ['userId'];
    }) => Promise<{ userId: string }[]>;
  };
  bookmark: {
    findMany: (args: {
      where: { createdAt: TimeWindow };
      select: { userId: true };
      distinct: ['userId'];
    }) => Promise<{ userId: string }[]>;
  };
  gameScore: {
    findMany: (args: {
      where: { updatedAt: TimeWindow };
      select: { userId: true };
      distinct: ['userId'];
    }) => Promise<{ userId: string }[]>;
  };
};

function windowFilter(since: Date, untilExclusive?: Date): TimeWindow {
  return untilExclusive != null ? { gte: since, lt: untilExclusive } : { gte: since };
}

/**
 * Distinct active users since `since`.
 * Optional `untilExclusive` aligns with shared analysisPeriod (Asia/Seoul).
 */
export async function countActiveUsersLast7d(
  db: ActiveUsersDb,
  since: Date,
  untilExclusive?: Date,
): Promise<number> {
  const createdAt = windowFilter(since, untilExclusive);
  const updatedAt = windowFilter(since, untilExclusive);
  const [posts, comments, likes, bookmarks, scores] = await Promise.all([
    db.post.findMany({
      where: { createdAt },
      select: { authorId: true },
      distinct: ['authorId'],
    }),
    db.comment.findMany({
      where: { createdAt },
      select: { authorId: true },
      distinct: ['authorId'],
    }),
    db.postLike.findMany({
      where: { createdAt },
      select: { userId: true },
      distinct: ['userId'],
    }),
    db.bookmark.findMany({
      where: { createdAt },
      select: { userId: true },
      distinct: ['userId'],
    }),
    db.gameScore.findMany({
      where: { updatedAt },
      select: { userId: true },
      distinct: ['userId'],
    }),
  ]);

  const ids = new Set<string>();
  for (const r of posts) ids.add(r.authorId);
  for (const r of comments) ids.add(r.authorId);
  for (const r of likes) ids.add(r.userId);
  for (const r of bookmarks) ids.add(r.userId);
  for (const r of scores) ids.add(r.userId);
  return ids.size;
}
