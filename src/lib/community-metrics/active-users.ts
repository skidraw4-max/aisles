/** Distinct users with qualifying activity in a time window. */

export const ACTIVE_USER_ACTIVITY_KINDS = [
  'post',
  'comment',
  'like',
  'bookmark',
  'gameScore',
] as const;

export type ActiveUsersDb = {
  post: {
    findMany: (args: {
      where: { createdAt: { gte: Date } };
      select: { authorId: true };
      distinct: ['authorId'];
    }) => Promise<{ authorId: string }[]>;
  };
  comment: {
    findMany: (args: {
      where: { createdAt: { gte: Date } };
      select: { authorId: true };
      distinct: ['authorId'];
    }) => Promise<{ authorId: string }[]>;
  };
  postLike: {
    findMany: (args: {
      where: { createdAt: { gte: Date } };
      select: { userId: true };
      distinct: ['userId'];
    }) => Promise<{ userId: string }[]>;
  };
  bookmark: {
    findMany: (args: {
      where: { createdAt: { gte: Date } };
      select: { userId: true };
      distinct: ['userId'];
    }) => Promise<{ userId: string }[]>;
  };
  gameScore: {
    findMany: (args: {
      where: { updatedAt: { gte: Date } };
      select: { userId: true };
      distinct: ['userId'];
    }) => Promise<{ userId: string }[]>;
  };
};

export async function countActiveUsersLast7d(
  db: ActiveUsersDb,
  since: Date,
): Promise<number> {
  const [posts, comments, likes, bookmarks, scores] = await Promise.all([
    db.post.findMany({
      where: { createdAt: { gte: since } },
      select: { authorId: true },
      distinct: ['authorId'],
    }),
    db.comment.findMany({
      where: { createdAt: { gte: since } },
      select: { authorId: true },
      distinct: ['authorId'],
    }),
    db.postLike.findMany({
      where: { createdAt: { gte: since } },
      select: { userId: true },
      distinct: ['userId'],
    }),
    db.bookmark.findMany({
      where: { createdAt: { gte: since } },
      select: { userId: true },
      distinct: ['userId'],
    }),
    db.gameScore.findMany({
      where: { updatedAt: { gte: since } },
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
