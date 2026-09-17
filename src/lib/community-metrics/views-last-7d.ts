/** Rolling 7-day view counts from PostViewDaily (not Post.views cumulative). */

export type ViewsLast7dDb = {
  postViewDaily: {
    aggregate: (args: {
      where: { day: { gte: Date; lt?: Date } };
      _sum: { count: true };
    }) => Promise<{ _sum: { count: number | null } }>;
  };
};

/** UTC calendar day start for a timestamp. */
export function utcDayStart(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/**
 * Sum PostViewDaily counts from sinceDay (inclusive).
 * Optional untilDayExclusive caps the window (same analysisPeriod as GA4).
 */
export async function countViewsLast7d(
  db: ViewsLast7dDb,
  sinceDay: Date,
  untilDayExclusive?: Date,
): Promise<number> {
  const dayFilter =
    untilDayExclusive != null
      ? { gte: sinceDay, lt: untilDayExclusive }
      : { gte: sinceDay };
  const agg = await db.postViewDaily.aggregate({
    where: { day: dayFilter },
    _sum: { count: true },
  });
  return agg._sum.count ?? 0;
}
