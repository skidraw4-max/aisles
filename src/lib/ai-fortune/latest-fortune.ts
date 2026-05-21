import { prisma } from '@/lib/prisma';
import { aiFortunePayloadFromDb } from '@/lib/ai-fortune/payload';
import { formatAiFortuneWeekKeyLabel, getKstParts, weekOfMonthKst } from '@/lib/ai-fortune/kst-week';

export type LatestAiFortuneSummary = {
  id: string;
  title: string;
  subtitle: string;
  weekKey: string | null;
};

export function fortuneSubtitleFromPost(post: {
  title: string;
  createdAt: Date;
  aiFortuneWeekKey: string | null;
  aiFortunePayload: unknown;
}): string {
  const payload = aiFortunePayloadFromDb(post.aiFortunePayload);
  if (payload?.weekLabel?.trim()) return payload.weekLabel.trim();
  if (post.aiFortuneWeekKey) return formatAiFortuneWeekKeyLabel(post.aiFortuneWeekKey);
  const { year, month } = getKstParts(post.createdAt);
  return `${year}년 ${month}월 ${weekOfMonthKst(post.createdAt)}주차`;
}

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
