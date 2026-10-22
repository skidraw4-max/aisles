import { prisma } from '@/lib/prisma';
import { utcDayStart } from './views-last-7d';

/**
 * Increment cumulative Post.views and today's PostViewDaily bucket.
 * Best-effort: daily upsert failure does not roll back cumulative views.
 */
export async function recordPostView(postId: string): Promise<number | null> {
  try {
    const row = await prisma.post.update({
      where: { id: postId },
      data: { views: { increment: 1 } },
      select: { views: true },
    });

    const day = utcDayStart(new Date());
    try {
      await prisma.postViewDaily.upsert({
        where: { postId_day: { postId, day } },
        create: { postId, day, count: 1 },
        update: { count: { increment: 1 } },
      });
    } catch (e) {
      console.error('[recordPostView] PostViewDaily upsert failed', e);
    }

    return row.views;
  } catch {
    return null;
  }
}
