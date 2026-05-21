import { prisma } from '@/lib/prisma';
import {
  fortuneSubtitleFromPost,
  type LatestAiFortuneSummary,
} from '@/lib/ai-fortune/latest-fortune.shared';

/** Latest weekly AI FORTUNE post (by publish time). */
export async function fetchLatestAiFortunePost(): Promise<LatestAiFortuneSummary | null> {
  const post = await prisma.post.findFirst({
    where: { category: 'AI_FORTUNE' },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      title: true,
      createdAt: true,
      aiFortuneWeekKey: true,
      aiFortunePayload: true,
    },
  });
  if (!post) return null;
  return {
    id: post.id,
    title: post.title,
    subtitle: fortuneSubtitleFromPost(post),
    weekKey: post.aiFortuneWeekKey,
  };
}
